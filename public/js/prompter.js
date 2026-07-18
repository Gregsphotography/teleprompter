/* ==========================================================================
   AeroPrompter - Prompter view: launch, HUD, tokenization, auto-scroll
   ========================================================================== */

import {
  state,
  DOM,
  showToast,
  cleanWordText
} from './core.js';
import {
  getActiveScript,
  isVoiceScrollEnabled,
  updateActiveScriptState,
  flushPersist
} from './storage.js';
import {
  updateStats,
  updateLivePreview
} from './editor.js';
import {
  startVoiceEngine,
  stopVoiceEngine
} from './voice.js';

export function setupPrompterHUDListeners() {
  DOM.hudBtnBack.addEventListener('click', exitTeleprompter);
  DOM.hudBtnRestart.addEventListener('click', restartTeleprompter);

  DOM.hudBtnPlay.addEventListener('click', togglePlayback);
  
  DOM.hudBtnSlower.addEventListener('click', () => adjustWpm(-5));
  DOM.hudBtnFaster.addEventListener('click', () => adjustWpm(5));
  
  DOM.hudBtnMirror.addEventListener('click', () => {
    const flipped = DOM.prompterTextBody.classList.toggle('flipped');
    DOM.hudBtnMirror.classList.toggle('active', flipped);
    DOM.hudBtnMirror.setAttribute('aria-pressed', String(flipped));
    
    // Synced configuration back
    DOM.configMirrorMode.checked = flipped;
    updateActiveScriptState('mirrorMode', flipped);
    updateLivePreview();
    
    // Layout might shift, recalculate positions
    setTimeout(calculateWordOffsets, 100);
    showToast(flipped ? 'Mirror Mode Active' : 'Mirror Mode Disabled');
  });
  
  DOM.hudBtnGuides.addEventListener('click', () => {
    const visible = DOM.focusZone.classList.toggle('visible');
    DOM.hudBtnGuides.classList.toggle('active', visible);
    DOM.hudBtnGuides.setAttribute('aria-pressed', String(visible));
    
    DOM.configFocusOverlay.checked = visible;
    updateActiveScriptState('focusOverlay', visible);
    showToast(visible ? 'Focus Guides Visible' : 'Focus Guides Hidden');
  });
  
  // Track scroll activity to auto-hide HUD and sync manual viewport scrolling
  DOM.prompterViewport.addEventListener('scroll', handleViewportScroll);
  DOM.prompterViewport.addEventListener('mousemove', triggerHUDVisibility);
  DOM.prompterViewport.addEventListener('touchstart', triggerHUDVisibility);
}

export function triggerHUDVisibility() {
  DOM.hudWrapper.classList.remove('fade-out');
  clearTimeout(state.hudFadeTimeout);
  
  // Hide HUD controls after 3 seconds of inactivity if actively playing
  if (state.isPlaying) {
    state.hudFadeTimeout = setTimeout(() => {
      DOM.hudWrapper.classList.add('fade-out');
    }, 3000);
  }
}

function handleViewportScroll() {
  // If the user manually scrolls, synchronize our physics variables to avoid jumping stutters
  if (!state.isPlaying || state.scrollMode === 'voice') {
    state.currentScrollY = DOM.prompterViewport.scrollTop;
    state.targetScrollY = DOM.prompterViewport.scrollTop;
  }
}

export function adjustWpm(delta) {
  const script = getActiveScript();
  if (!script) return;
  
  let newWpm = parseInt(DOM.configWpm.value) + delta;
  newWpm = Math.max(50, Math.min(300, newWpm));
  
  DOM.configWpm.value = newWpm;
  DOM.displayWpm.textContent = `${newWpm} WPM`;
  DOM.hudSpeedText.textContent = `${newWpm} WPM`;
  
  updateActiveScriptState('wpm', newWpm);
  updateStats();
  computeAutoScrollRate();

  showToast(`Speed: ${newWpm} WPM`);
}

export function setupGlobalShortcuts() {
  window.addEventListener('keydown', (e) => {
    // Only capture keys if prompter is active
    if (!DOM.prompterView.classList.contains('active')) return;
    
    switch (e.code) {
      case 'Space':
        e.preventDefault();
        togglePlayback();
        break;
      case 'ArrowUp':
        e.preventDefault();
        adjustWpm(5);
        break;
      case 'ArrowDown':
        e.preventDefault();
        adjustWpm(-5);
        break;
      case 'KeyR':
        restartTeleprompter();
        break;
      case 'KeyM':
        DOM.hudBtnMirror.click();
        break;
      case 'KeyG':
        DOM.hudBtnGuides.click();
        break;
      case 'Escape':
        e.preventDefault();
        exitTeleprompter();
        break;
    }
  });
}

export function launchTeleprompter() {
  flushPersist();
  const script = getActiveScript();
  if (!script || !script.body.trim()) {
    showToast('Please type some script text first!', 'error');
    return;
  }

  // 1. Setup UI configurations from active script settings
  applyPromptSizingConfigs(script);
  
  // 2. Tokenize editor content
  tokenizeScriptText(script.body);
  
  // 3. Toggle View states
  DOM.dashboardView.classList.add('hidden');
  DOM.dashboardView.classList.remove('active');
  DOM.prompterView.classList.add('active');
  enterFullscreen();
  requestWakeLock();
  
  // Reset scroll metrics
  DOM.prompterViewport.scrollTop = 0;
  state.currentScrollY = 0;
  state.targetScrollY = 0;
  state.currentWordIndex = 0;
  resetParagraphTopAlignment();
  
  // Calculate offsets for precise LERP/Voice tracking
  setTimeout(() => {
    calculateWordOffsets();
  }, 300);
  
  // 4. Start appropriate engine
  state.scrollMode = isVoiceScrollEnabled(script) ? 'voice' : 'auto';
  state.isPlaying = false;
  resetTimeRemainingDisplay();

  updateHUDButtonState();
  triggerHUDVisibility();

  if (!DOM.configAutoStart.checked) {
    showToast('Ready. Press Space or Play to begin.');
    return;
  }

  // Give the presenter a moment to get in position before scrolling starts
  runStartCountdown(() => {
    state.isPlaying = true;
    updateHUDButtonState();
    triggerHUDVisibility();

    if (state.scrollMode === 'voice') {
      startVoiceEngine();
    } else {
      startAutoScrollLoop();
      showToast('Auto-Scroll Active (Space to Pause)');
    }
  });
}

function runStartCountdown(onDone) {
  const token = ++state.countdownToken;
  let step = 3;
  DOM.countdownOverlay.hidden = false;

  const tick = () => {
    if (token !== state.countdownToken || !DOM.prompterView.classList.contains('active')) {
      DOM.countdownOverlay.hidden = true;
      return;
    }
    if (step === 0) {
      DOM.countdownOverlay.hidden = true;
      onDone();
      return;
    }
    DOM.countdownNumber.textContent = step;
    DOM.countdownNumber.classList.remove('pop');
    void DOM.countdownNumber.offsetWidth; // restart the pop animation
    DOM.countdownNumber.classList.add('pop');
    step--;
    state.countdownTimeout = setTimeout(tick, 800);
  };
  tick();
}

export function cancelStartCountdown() {
  state.countdownToken++;
  clearTimeout(state.countdownTimeout);
  DOM.countdownOverlay.hidden = true;
}

export function exitTeleprompter() {
  // Stop engines
  state.isPlaying = false;
  state.scrollLoopId++;
  cancelStartCountdown();
  stopVoiceEngine();
  releaseWakeLock();
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
  }
  
  // Switch Views
  DOM.prompterView.classList.remove('active');
  DOM.dashboardView.classList.add('active');
  DOM.dashboardView.classList.remove('hidden');
  
  showToast('Back to editor mode.');
}

export function restartTeleprompter() {
  const wasPlaying = state.isPlaying;

  // Stop current engines cleanly
  state.isPlaying = false;
  state.scrollLoopId++;
  cancelStartCountdown();
  stopVoiceEngine();

  // Reset to the top
  state.currentScrollY = 0;
  state.targetScrollY = 0;
  state.currentWordIndex = 0;
  resetParagraphTopAlignment();
  DOM.prompterViewport.scrollTop = 0;

  // Clear word highlights
  clearWordHighlights();

  if (!wasPlaying) {
    showToast('Restarted. Press Space or Play to begin.');
    return;
  }

  // Resume from top
  state.isPlaying = true;
  updateHUDButtonState();
  triggerHUDVisibility();

  if (state.scrollMode === 'voice') {
    startVoiceEngine();
  } else {
    startAutoScrollLoop();
    showToast('Restarted from beginning.');
  }
}

export function togglePlayback() {
  cancelStartCountdown();
  state.isPlaying = !state.isPlaying;
  updateHUDButtonState();
  triggerHUDVisibility();
  
  if (state.isPlaying) {
    showToast(state.scrollMode === 'voice' ? 'Listening...' : 'Scrolling Resumed');

    if (state.scrollMode === 'voice') {
      startVoiceEngine();
    } else {
      startAutoScrollLoop();
    }
  } else {
    showToast('Paused');
    state.scrollLoopId++;
    stopVoiceEngine();
  }
}

export function updateHUDButtonState() {
  if (state.isPlaying) {
    DOM.hudBtnPlay.classList.add('active');
    DOM.hudBtnPlay.setAttribute('aria-label', 'Pause');
    DOM.hudSvgPlay.style.display = 'none';
    DOM.hudSvgPause.style.display = 'block';
  } else {
    DOM.hudBtnPlay.classList.remove('active');
    DOM.hudBtnPlay.setAttribute('aria-label', 'Play');
    DOM.hudSvgPlay.style.display = 'block';
    DOM.hudSvgPause.style.display = 'none';
  }
}

export function getPrompterLayoutMetrics(script) {
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 1024;
  const isNarrowViewport = viewportWidth <= 760;
  const configuredFontSize = script ? (parseInt(script.fontSize) || 42) : 42;
  const configuredMarginWidth = script ? (parseInt(script.marginWidth) || 700) : 700;

  if (!isNarrowViewport) {
    return {
      fontSize: configuredFontSize,
      marginWidth: configuredMarginWidth
    };
  }

  const mobileFontScale = 0.8;
  const maxReadableFontSize = Math.max(28, Math.min(44, viewportWidth * 0.105));
  const maxReadableWidth = Math.max(280, viewportWidth - 32);

  return {
    fontSize: Math.min(configuredFontSize, maxReadableFontSize) * mobileFontScale,
    marginWidth: Math.min(configuredMarginWidth, maxReadableWidth)
  };
}

export function applyFocusPosition(percent) {
  DOM.prompterView.style.setProperty('--focus-position', `${percent}%`);
}

export function getFocusPositionRatio() {
  const script = getActiveScript();
  return (script?.focusPosition || 50) / 100;
}

export function applyPromptSizingConfigs(script) {
  applyFocusPosition(script.focusPosition || 50);

  // Clear layout properties
  DOM.prompterTextBody.className = 'prompter-text-body';
  DOM.prompterTextBody.classList.add(`prompter-font-${script.fontFamily || 'sans'}`);
  
  if (script.mirrorMode) {
    DOM.prompterTextBody.classList.add('flipped');
    DOM.hudBtnMirror.classList.add('active');
    DOM.hudBtnMirror.setAttribute('aria-pressed', 'true');
  } else {
    DOM.hudBtnMirror.classList.remove('active');
    DOM.hudBtnMirror.setAttribute('aria-pressed', 'false');
  }
  
  DOM.focusZone.classList.toggle('visible', script.focusOverlay !== false);
  DOM.hudBtnGuides.classList.toggle('active', script.focusOverlay !== false);
  DOM.hudBtnGuides.setAttribute('aria-pressed', String(script.focusOverlay !== false));
  
  // CSS dimensions applied
  const layoutMetrics = getPrompterLayoutMetrics(script);
  DOM.prompterTextBody.style.fontSize = `${layoutMetrics.fontSize}px`;
  DOM.prompterTextBody.style.lineHeight = `${script.lineHeight || 1.6}`;
  DOM.prompterTextBody.style.maxWidth = `${layoutMetrics.marginWidth}px`;
  
  // Sync Speed HUD
  DOM.hudSpeedText.textContent = `${script.wpm} WPM`;
  if (isVoiceScrollEnabled(script)) {
    DOM.hudSpeedWrapper.style.display = 'none';
  } else {
    DOM.hudSpeedWrapper.style.display = 'flex';
  }
}

export function tokenizeScriptText(text) {
  DOM.prompterTextBody.innerHTML = '';
  state.scriptWords = [];
  state.wordElements = [];
  state.wordOffsets = [];
  state.paragraphElements = [];
  state.highlightedWordIndex = -1;
  state.activeParagraphEl = null;
  state.autoScrollPixelsPerSecond = 0;

  const paragraphs = text.split(/\n+/).filter(p => p.trim());
  let wordIndex = 0;
  
  paragraphs.forEach(paraText => {
    const paraEl = document.createElement('div');
    paraEl.className = 'prompter-paragraph';
    
    // Split into words while retaining spacing
    const rawWords = paraText.split(/(\s+)/);
    
    rawWords.forEach(segment => {
      if (segment.trim().length === 0) {
        // Just text spaces
        paraEl.appendChild(document.createTextNode(segment));
      } else {
        // Actual word token
        const wordClean = cleanWordText(segment);
        
        const span = document.createElement('span');
        span.className = 'prompter-word';
        span.textContent = segment;
        span.dataset.wordIndex = wordIndex;
        
        paraEl.appendChild(span);
        
        state.scriptWords.push(wordClean);
        state.wordElements.push(span);
        
        wordIndex++;
      }
    });
    
    DOM.prompterTextBody.appendChild(paraEl);
    state.paragraphElements.push(paraEl);
  });
}

export function calculateWordOffsets() {
  if (state.wordElements.length === 0) return;
  
  // Cache word coordinates in memory for highly optimized reading loops
  state.wordOffsets = state.wordElements.map(el => {
    return {
      top: el.offsetTop,
      height: el.clientHeight,
      paragraph: el.closest('.prompter-paragraph')
    };
  });

  computeAutoScrollRate();
}

function isMobilePrompterViewport() {
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 1024;
  return viewportWidth <= 760;
}

function getParagraphTopScrollTarget(paragraphEl) {
  if (!paragraphEl) return 0;

  return Math.max(0, paragraphEl.offsetTop - getPrompterViewportTopPadding());
}

function getFirstPrompterParagraph() {
  return state.paragraphElements[0] || null;
}

function getPrompterViewportTopPadding() {
  const viewportStyles = window.getComputedStyle(DOM.prompterViewport);
  return parseFloat(viewportStyles.paddingTop) || 0;
}

function getPrompterParagraphs() {
  return state.paragraphElements;
}

export function resetParagraphTopAlignment() {
  state.activeParagraphForTopAlign = isMobilePrompterViewport()
    ? getFirstPrompterParagraph()
    : null;
}

function maybeAdvanceAutoParagraphTopAlign() {
  if (!isMobilePrompterViewport() || state.scrollMode !== 'auto') return false;

  const paragraphs = getPrompterParagraphs();
  if (paragraphs.length === 0) return false;

  let currentIndex = paragraphs.indexOf(state.activeParagraphForTopAlign);
  if (currentIndex === -1) {
    currentIndex = 0;
    state.activeParagraphForTopAlign = paragraphs[currentIndex];
  }

  const currentParagraph = paragraphs[currentIndex];
  const nextParagraph = paragraphs[currentIndex + 1];
  if (!currentParagraph || !nextParagraph) return false;

  const viewportTop = DOM.prompterViewport.scrollTop + getPrompterViewportTopPadding();
  const currentParagraphBottom = currentParagraph.offsetTop + currentParagraph.offsetHeight;
  if (viewportTop < currentParagraphBottom) return false;

  state.activeParagraphForTopAlign = nextParagraph;
  state.targetScrollY = getParagraphTopScrollTarget(nextParagraph);
  return true;
}

export function setupResponsiveLayoutListeners() {
  let resizeTimeout = null;

  window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
      updateLivePreview();

      const script = getActiveScript();
      if (!script || !DOM.prompterView.classList.contains('active')) return;

      applyPromptSizingConfigs(script);
      calculateWordOffsets();
      state.currentScrollY = DOM.prompterViewport.scrollTop;
      state.targetScrollY = DOM.prompterViewport.scrollTop;
    }, 120);
  });
}

export function startAutoScrollLoop() {
  const loopId = ++state.scrollLoopId;
  state.lastTime = performance.now();
  requestAnimationFrame(timestamp => renderAutoScrollTicker(timestamp, loopId));
}

// Derive px/sec from actual reading geometry:
// estimate words per line from column width, then scale to line height in pixels.
// 0.52em avg char width × 5.5 avg chars/word gives avg word width in px.
// Recomputed only when layout can change (launch, resize, WPM adjustments)
// so the RAF loop never touches getComputedStyle.
export function computeAutoScrollRate() {
  const script = getActiveScript();
  const wpm = script ? script.wpm : 130;
  const renderedStyles = window.getComputedStyle(DOM.prompterTextBody);
  const fontSize = parseFloat(renderedStyles.fontSize) || (script ? script.fontSize : 42);
  const lineHeight = script ? script.lineHeight : 1.6;
  const marginWidth = DOM.prompterTextBody.clientWidth || (script ? (script.marginWidth || 700) : 700);

  const wordsPerLine = marginWidth / (fontSize * 0.52 * 5.5);
  state.autoScrollPixelsPerSecond = (wpm / 60 / wordsPerLine) * (fontSize * lineHeight);
}

function renderAutoScrollTicker(timestamp, loopId) {
  if (loopId !== state.scrollLoopId || !state.isPlaying || state.scrollMode !== 'auto') return;

  // Clamp so a background-tab wake advances at most one normal step,
  // while slow frames (< 10 fps) still keep scrolling.
  const elapsed = Math.min((timestamp - state.lastTime) / 1000, 0.1);
  state.lastTime = timestamp;

  if (!state.autoScrollPixelsPerSecond) computeAutoScrollRate();

  state.targetScrollY += state.autoScrollPixelsPerSecond * elapsed;

  // LERP transition for ultra smooth, non-choppy tracking
  state.currentScrollY += (state.targetScrollY - state.currentScrollY) * 0.12;

  DOM.prompterViewport.scrollTop = Math.round(state.currentScrollY);

  // Identify and highlight active reading paragraphs based on scroll viewport position
  highlightActiveWordByScrollPosition();

  if (timestamp - state.lastRemainingUpdate > 500) {
    state.lastRemainingUpdate = timestamp;
    updateTimeRemainingDisplay();
  }

  requestAnimationFrame(nextTimestamp => renderAutoScrollTicker(nextTimestamp, loopId));
}

function updateTimeRemainingDisplay() {
  const viewport = DOM.prompterViewport;
  const remainingPx = Math.max(0, viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop);
  const pps = state.autoScrollPixelsPerSecond;
  if (!pps) return;

  const totalSeconds = Math.round(remainingPx / pps);
  const min = Math.floor(totalSeconds / 60);
  const sec = totalSeconds % 60;
  DOM.hudTimeRemaining.textContent = `${min}:${String(sec).padStart(2, '0')}`;
}

function resetTimeRemainingDisplay() {
  DOM.hudTimeRemaining.textContent = '–:––';
}

function findWordIndexClosestTo(y) {
  // wordOffsets are in document order, so tops are non-decreasing: binary search
  const offsets = state.wordOffsets;
  let lo = 0;
  let hi = offsets.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (offsets[mid].top < y) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  if (lo > 0 && Math.abs(offsets[lo - 1].top - y) <= Math.abs(offsets[lo].top - y)) {
    return lo - 1;
  }
  return lo;
}

export function setActiveWordHighlight(index) {
  // Move current-word / active-paragraph markers, touching only changed nodes
  if (index === state.highlightedWordIndex) return;

  const prevEl = state.wordElements[state.highlightedWordIndex];
  if (prevEl) prevEl.classList.remove('current-word');

  const el = state.wordElements[index];
  if (!el) return;
  el.classList.remove('spoken');
  el.classList.add('current-word');

  const para = state.wordOffsets[index]?.paragraph || el.closest('.prompter-paragraph');
  if (para !== state.activeParagraphEl) {
    state.activeParagraphEl?.classList.remove('active-paragraph');
    para.classList.add('active-paragraph');
    state.activeParagraphEl = para;
  }

  state.highlightedWordIndex = index;
}

export function clearWordHighlights() {
  state.wordElements.forEach(el => el.classList.remove('current-word', 'spoken'));
  state.paragraphElements.forEach(p => p.classList.remove('active-paragraph'));
  state.highlightedWordIndex = -1;
  state.activeParagraphEl = null;
}

export function highlightActiveWordByScrollPosition() {
  if (!state.wordOffsets || state.wordOffsets.length === 0) return;

  // Highlight the word that lies on the focus line
  const focusLine = DOM.prompterViewport.scrollTop + (DOM.prompterViewport.clientHeight * getFocusPositionRatio());
  setActiveWordHighlight(findWordIndexClosestTo(focusLine));
  maybeAdvanceAutoParagraphTopAlign();
}

async function enterFullscreen() {
  if (!document.fullscreenEnabled || document.fullscreenElement) return;

  try {
    await DOM.prompterView.requestFullscreen();
  } catch (error) {
    console.info('Fullscreen request skipped', error);
  }
}

async function requestWakeLock() {
  if (!('wakeLock' in navigator) || state.wakeLock) return;

  try {
    state.wakeLock = await navigator.wakeLock.request('screen');
    state.wakeLock.addEventListener('release', () => {
      state.wakeLock = null;
    });
  } catch (error) {
    console.info('Wake lock unavailable', error);
  }
}

async function releaseWakeLock() {
  if (!state.wakeLock) return;

  try {
    await state.wakeLock.release();
  } catch (error) {
    console.info('Wake lock release skipped', error);
  } finally {
    state.wakeLock = null;
  }
}
