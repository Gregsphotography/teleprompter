/* ==========================================================================
   AeroPrompter - Voice-activated scrolling

   Two recognition backends feed the same matching engine:
   - Web: SpeechRecognition / webkitSpeechRecognition (browsers)
   - Native: SFSpeechRecognizer via the Capacitor SpeechRecognition plugin
     (the iOS app shell — WKWebView has no Web Speech API)
   ========================================================================== */

import {
  state,
  DOM,
  showToast,
  cleanWordText
} from './core.js';
import {
  getVoiceLang
} from './storage.js';
import {
  startAutoScrollLoop,
  updateHUDButtonState,
  setActiveWordHighlight,
  clearWordHighlights,
  getFocusPositionRatio
} from './prompter.js';
import { isNativeApp, getNativePlugin } from './platform.js';

// Native (Capacitor) recognition bookkeeping
let nativeSpeech = null;          // Capacitor SpeechRecognition plugin handle
let nativeListenersReady = false;
let nativeLastTranscript = '';    // iOS partial results are cumulative per session
let nativeRestartTimer = null;

function disableVoiceUI(message) {
  console.warn(message);
  DOM.configVoiceScroll.disabled = true;
  DOM.configVoiceScroll.checked = false;
  DOM.configVoiceLang.disabled = true;
  DOM.configAutoScroll.checked = true;
  if (DOM.containerVoiceScroll) {
    const voiceHelp = DOM.containerVoiceScroll.querySelector('.tooltip-help');
    DOM.containerVoiceScroll.style.opacity = '0.4';
    voiceHelp?.setAttribute('data-tooltip', message);
    voiceHelp?.setAttribute('aria-label', message);
  }
}

export function initSpeechRecognition() {
  if (isNativeApp()) {
    initNativeSpeechRecognition();
    return;
  }

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    disableVoiceUI('Microphone speech tracking not supported in this browser. Use Chrome or Safari.');
    return;
  }

  const rec = new SpeechRecognition();
  rec.continuous = true;
  rec.interimResults = true;
  rec.lang = getVoiceLang();
  
  rec.onstart = () => {
    state.recognitionActive = true;
    DOM.hudVoiceIndicator.classList.add('listening');
    DOM.hudVoiceText.textContent = 'Listening...';
    showToast('Microphone Active. Speak script aloud.', 'success');
  };
  
  rec.onerror = (event) => {
    console.error('Speech Recognition Error', event.error);
    if (event.error === 'not-allowed') {
      fallbackToAutoScroll('Microphone denied. Auto-scroll started.');
    } else if (event.error === 'network') {
      fallbackToAutoScroll('Speech recognition needs internet. Auto-scroll started.');
    }
  };
  
  rec.onend = () => {
    state.recognitionActive = false;
    DOM.hudVoiceIndicator.classList.remove('listening');
    DOM.hudVoiceText.textContent = 'Voice Scroll Off';
    
    // Auto restart if still actively playing and voice scroll is active
    if (state.isPlaying && state.scrollMode === 'voice') {
      console.log('Voice recognition stopped unexpectedly, restarting...');
      try {
        state.recognition.start();
      } catch (err) {
        console.error('Failed to restart speech engine', err);
      }
    }
  };
  
  rec.onresult = (event) => {
    if (!state.isPlaying || state.scrollMode !== 'voice') return;

    let finalPhrase = "";
    let interimPhrase = "";

    for (let i = event.resultIndex; i < event.results.length; ++i) {
      if (event.results[i].isFinal) {
        finalPhrase += event.results[i][0].transcript;
      } else {
        interimPhrase += event.results[i][0].transcript;
      }
    }

    if (finalPhrase) {
      processSpokenPhrase(finalPhrase, false);
    } else if (interimPhrase) {
      processSpokenPhrase(interimPhrase, true);
    }
  };
  
  state.recognition = rec;
}

function initNativeSpeechRecognition() {
  nativeSpeech = getNativePlugin('SpeechRecognition');
  if (!nativeSpeech) {
    disableVoiceUI('Speech recognition is unavailable on this device.');
    return;
  }

  // Sentinel object: callers only check truthiness, and the language picker
  // writes .lang to it (native sessions read getVoiceLang() at start anyway).
  state.recognition = { native: true, lang: getVoiceLang() };

  nativeSpeech.available?.()
    .then(result => {
      if (result && result.available === false) {
        state.recognition = null;
        disableVoiceUI('Speech recognition is unavailable on this device.');
      }
    })
    .catch(() => {});
}

async function beginNativeSession() {
  if (!state.isPlaying || state.scrollMode !== 'voice') return;

  nativeLastTranscript = '';
  try {
    await nativeSpeech.start({
      language: getVoiceLang(),
      partialResults: true,
      popup: false
    });
    state.recognitionActive = true;
    DOM.hudVoiceIndicator.classList.add('listening');
    DOM.hudVoiceText.textContent = 'Listening...';
  } catch {
    // A session that is still winding down throws; stop it and retry once.
    try {
      await nativeSpeech.stop();
      await nativeSpeech.start({ language: getVoiceLang(), partialResults: true, popup: false });
      state.recognitionActive = true;
      DOM.hudVoiceIndicator.classList.add('listening');
      DOM.hudVoiceText.textContent = 'Listening...';
    } catch (retryErr) {
      console.error('Native voice engine start error', retryErr);
      fallbackToAutoScroll('Could not start microphone. Auto-scroll started.');
    }
  }
}

async function startNativeVoiceEngine() {
  try {
    const perm = await nativeSpeech.requestPermissions?.();
    const status = perm?.speechRecognition;
    if (status && status !== 'granted') {
      fallbackToAutoScroll('Microphone denied. Auto-scroll started.');
      return;
    }

    if (!nativeListenersReady) {
      nativeListenersReady = true;

      await nativeSpeech.addListener('partialResults', data => {
        if (!state.isPlaying || state.scrollMode !== 'voice') return;
        const transcript = Array.isArray(data?.matches) ? (data.matches[0] || '') : '';
        // Cumulative per session; the matcher only weighs the last few words,
        // so feed the whole transcript but skip unchanged repeats.
        if (transcript && transcript !== nativeLastTranscript) {
          nativeLastTranscript = transcript;
          processSpokenPhrase(transcript, true);
        }
      });

      await nativeSpeech.addListener('listeningState', data => {
        const listening = data?.status === 'started';
        state.recognitionActive = listening;
        DOM.hudVoiceIndicator.classList.toggle('listening', listening);
        DOM.hudVoiceText.textContent = listening ? 'Listening...' : 'Voice Scroll Off';

        // iOS caps SFSpeechRecognizer sessions (~1 minute); restart while playing
        if (!listening && state.isPlaying && state.scrollMode === 'voice') {
          clearTimeout(nativeRestartTimer);
          nativeRestartTimer = setTimeout(beginNativeSession, 250);
        }
      });
    }

    await beginNativeSession();
  } catch (err) {
    console.error('Native voice engine setup error', err);
    fallbackToAutoScroll('Could not start microphone. Auto-scroll started.');
  }
}

export function startVoiceEngine() {
  if (!state.recognition) {
    fallbackToAutoScroll('Speech recognition not supported. Auto-scroll started.');
    return;
  }

  DOM.hudVoiceIndicator.style.display = 'flex';
  DOM.hudVoiceText.textContent = 'Activating...';

  // Run background interpolation loop for scrolling to target index Y smoothly
  startVoiceScrollLoop();

  if (state.recognition.native) {
    startNativeVoiceEngine();
    return;
  }

  // A recent stop() may still be winding down; recognition can't be started
  // again until its onend fires, and onend auto-restarts while playing.
  if (state.recognitionActive) {
    DOM.hudVoiceIndicator.classList.add('listening');
    DOM.hudVoiceText.textContent = 'Listening...';
    return;
  }

  try {
    state.recognition.start();
  } catch (err) {
    if (err && err.name === 'InvalidStateError') {
      // Already started (stop/start race) — onend will resync state.
      return;
    }
    console.error('Voice engine start error', err);
    fallbackToAutoScroll('Could not start microphone. Auto-scroll started.');
  }
}

function fallbackToAutoScroll(message) {
  // Session-only fallback: switch the running engine without rewriting the
  // script's saved voiceScroll preference or the dashboard toggles.
  if (state.recognition && state.recognitionActive) {
    stopVoiceEngine();
  }

  state.scrollMode = 'auto';
  state.isPlaying = true;
  DOM.hudSpeedWrapper.style.display = 'flex';
  DOM.hudVoiceText.textContent = 'Voice unavailable';
  updateHUDButtonState();
  startAutoScrollLoop();
  showToast(message, 'error');
}

export function stopVoiceEngine() {
  if (state.recognition?.native) {
    clearTimeout(nativeRestartTimer);
    if (state.recognitionActive) {
      nativeSpeech?.stop?.().catch(() => {});
    }
    state.recognitionActive = false;
  } else if (state.recognition && state.recognitionActive) {
    state.recognition.stop();
  }
  DOM.hudVoiceIndicator.classList.remove('listening');
  DOM.hudVoiceText.textContent = 'Voice Scroll Off';
}

function processSpokenPhrase(spokenText, isInterim = false) {
  if (state.scriptWords.length === 0) return;

  const spokenWords = spokenText.trim().toLowerCase().split(/\s+/).map(cleanWordText).filter(Boolean);
  if (spokenWords.length === 0) return;

  // Interim results require stronger evidence to advance (prevents rapid-fire partial matches)
  const minScore  = isInterim ? 12 : 9;  // interim: ~3 consecutive words; final: ~2
  const maxJump   = isInterim ?  4 : 8;  // interim: cautious advance; final: allow catch-up
  const lookAhead = 15;                  // reduced from 35 to prevent large false-positive jumps

  const startIndex = state.currentWordIndex;
  const maxIndex   = Math.min(state.scriptWords.length, startIndex + lookAhead);

  let bestMatchIndex = -1;
  let maxScore = 0;

  for (let s = startIndex; s < maxIndex; s++) {
    let score = 0;
    for (let w = 0; w < Math.min(spokenWords.length, 5); w++) {
      const spoke      = spokenWords[spokenWords.length - 1 - w];
      const scriptWord = state.scriptWords[s - w];
      if (spoke && scriptWord && spoke === scriptWord) {
        score += (5 - w);
      }
    }
    if (score > maxScore) {
      maxScore = score;
      bestMatchIndex = s;
    }
  }

  if (bestMatchIndex !== -1 && maxScore >= minScore && bestMatchIndex >= state.currentWordIndex) {
    const cappedIndex = Math.min(bestMatchIndex, state.currentWordIndex + maxJump);
    scrollToWordIndex(cappedIndex);
  }
}

function scrollToWordIndex(index) {
  const from = Math.max(state.currentWordIndex, 0);

  if (index < from) {
    // Rewind (restart handles the common case): rebuild spoken markers
    clearWordHighlights();
    for (let i = 0; i < index; i++) {
      state.wordElements[i].classList.add('spoken');
    }
  } else {
    // Normal forward advance: only the newly passed words change
    for (let i = from; i < index; i++) {
      state.wordElements[i].classList.add('spoken');
    }
  }

  state.currentWordIndex = index;
  setActiveWordHighlight(index);

  // Compute target Y coordinate to position active word on the focus line
  const wordOffset = state.wordOffsets[index];
  if (wordOffset) {
    const viewportHeight = DOM.prompterViewport.clientHeight;
    state.targetScrollY = wordOffset.top - (viewportHeight * getFocusPositionRatio()) + (wordOffset.height / 2);
  }
}

function startVoiceScrollLoop() {
  const loopId = ++state.scrollLoopId;
  requestAnimationFrame(() => renderVoiceScrollTicker(loopId));
}

function renderVoiceScrollTicker(loopId) {
  if (loopId !== state.scrollLoopId || !state.isPlaying || state.scrollMode !== 'voice') return;

  // Gently slide the viewport scroll position towards the target vertical Y coordinate
  const diff = state.targetScrollY - state.currentScrollY;

  if (Math.abs(diff) > 0.5) {
    // Elegant proportional LERP interpolation
    state.currentScrollY += diff * 0.08;
    DOM.prompterViewport.scrollTop = Math.round(state.currentScrollY);
  }

  requestAnimationFrame(() => renderVoiceScrollTicker(loopId));
}
