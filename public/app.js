/* ==========================================================================
   AeroPrompter - Premium Script Editor & Scrolling Engine
   ========================================================================== */

const VOICE_SCROLL_DEFAULT_VERSION = '2';
const EXPORT_FORMAT_VERSION = 1;

// --- Global Application State ---
const state = {
  scripts: [],
  activeScriptId: null,
  isPlaying: false,
  scrollMode: 'voice', // 'auto' or 'voice'
  
  // High-precision scrolling physics
  currentScrollY: 0,
  targetScrollY: 0,
  lastTime: 0,
  scrollLoopId: 0,       // Generation counter so stale RAF loops self-terminate

  // Voice engine tracking
  recognition: null,
  recognitionActive: false,
  scriptWords: [],       // Flat array of lowercased words for matching
  wordElements: [],      // DOM references for highlighting
  wordOffsets: [],       // Cached word coordinates for scroll tracking
  paragraphElements: [], // Cached paragraph nodes (rebuilt on tokenize)
  currentWordIndex: 0,
  activeParagraphForTopAlign: null,

  // Highlight bookkeeping so per-frame updates touch only changed nodes
  highlightedWordIndex: -1,
  activeParagraphEl: null,

  // Cached auto-scroll rate (recomputed on launch/resize/WPM change)
  autoScrollPixelsPerSecond: 0,

  // Debounced persistence
  persistTimeout: null,
  sidebarRefreshPending: false,
  
  // Pre-start countdown
  countdownToken: 0,
  countdownTimeout: null,

  // HUD time-remaining throttle
  lastRemainingUpdate: 0,

  // Interface state
  hudFadeTimeout: null,
  toastTimeout: null,
  wakeLock: null
};

const DEFAULT_VOICE_LANG = 'en-US';

// --- Default Welcome Scripts for Onboarding ---
const DEFAULT_SCRIPTS = [
  {
    id: 'welcome-script',
    title: 'Welcome to AeroPrompter 🚀',
    body: `Welcome to AeroPrompter! This is a state-of-the-art teleprompter designed to run directly in your browser. It features standard Auto-Scroll as well as high-performance, voice-activated scrolling that follows you as you speak.

How to use the Teleprompter:
1. You can edit this text right now, or click "+ New Script" in the sidebar to write your own speech.
2. In the right panel, customize your fonts, font sizes, line height, and reading margins to fit your screen.
3. Check out the "Hardware Rig Control" if you are using physical beamsplitter glass. Mirror Mode will instantly flip the text horizontally so it displays correctly through your glass mirror.
4. Try toggling "Voice-Activated Scroll". AeroPrompter will listen to your microphone, match what you say with the text, and scroll only when you speak!

Try reading this paragraph out loud:
"AeroPrompter uses advanced browser recognition. It matches my voice against the script, automatically scrolling to the center of the focus zone. I don't need any clickers, and I don't need to touch my keyboard. If I stop talking to take a breath, the prompter pauses. If I speak faster, the prompter speeds up. It is completely hands-free!"

Keyboard Shortcuts in Prompter Mode:
• Spacebar: Play / Pause scrolling or voice tracking
• Up / Down Arrows: Speed up or slow down auto-scrolling
• G Key: Toggle the glassmorphic focus overlay guides
• M Key: Mirror text horizontally (Mirror Mode)
• Escape Key: Exit prompter mode and return to this editor

Click the "Launch Prompter" button in the top right to test it out!`,
    wpm: 140,
    fontSize: 40,
    lineHeight: 1.6,
    marginWidth: 700,
    mirrorMode: false,
    voiceScroll: true,
    focusOverlay: false,
    updatedAt: Date.now()
  },
  {
    id: 'short-test',
    title: 'Quick Speech Demo 🎙️',
    body: `A quick brown fox jumps over the lazy dog. The sun shines brightly on the mountain tops, and a gentle breeze blows across the green meadows. 

If speech recognition is active, speaking these words aloud will scroll the text smoothly into the highlight guide. This is a perfect test script to see the alignment in action. Enjoy your reading experience!`,
    wpm: 130,
    fontSize: 44,
    lineHeight: 1.7,
    marginWidth: 650,
    mirrorMode: false,
    voiceScroll: true,
    focusOverlay: false,
    updatedAt: Date.now()
  }
];

// --- DOM Cache Elements ---
const DOM = {
  scriptsList: document.getElementById('scripts-list'),
  btnNewScript: document.getElementById('btn-new-script'),
  btnImportScripts: document.getElementById('btn-import-scripts'),
  btnExportScripts: document.getElementById('btn-export-scripts'),
  btnDuplicateScript: document.getElementById('btn-duplicate-script'),
  btnFeedback: document.getElementById('btn-feedback'),
  scriptImportFile: document.getElementById('script-import-file'),
  scriptTitleField: document.getElementById('script-title-field'),
  scriptEditorBody: document.getElementById('script-editor-body'),
  btnLaunch: document.getElementById('btn-launch'),
  
  // Config inputs
  configVoiceScroll: document.getElementById('config-voice-scroll'),
  configAutoScroll: document.getElementById('config-auto-scroll'),
  configWpm: document.getElementById('config-wpm'),
  configFontFamily: document.getElementById('config-font-family'),
  configFontSize: document.getElementById('config-font-size'),
  configLineHeight: document.getElementById('config-line-height'),
  configMarginWidth: document.getElementById('config-margin-width'),
  configMirrorMode: document.getElementById('config-mirror-mode'),
  configFocusOverlay: document.getElementById('config-focus-overlay'),
  configColorblindMode: document.getElementById('config-colorblind-mode'),
  configAutoStart: document.getElementById('config-auto-start'),
  configVoiceLang: document.getElementById('config-voice-lang'),
  configFocusPosition: document.getElementById('config-focus-position'),
  displayFocusPosition: document.getElementById('display-focus-position'),
  containerVoiceScroll: document.getElementById('container-voice-control'),
  
  // Displays
  displayWpm: document.getElementById('display-wpm'),
  displayFontSize: document.getElementById('display-font-size'),
  displayLineHeight: document.getElementById('display-line-height'),
  displayMarginWidth: document.getElementById('display-margin-width'),
  groupSpeedControl: document.getElementById('group-speed-control'),
  
  // Stats
  statWords: document.getElementById('stat-words'),
  statChars: document.getElementById('stat-chars'),
  statTime: document.getElementById('stat-time'),
  
  // Typography preview
  typographyPreview: document.getElementById('typography-preview'),
  
  // View Panels
  dashboardView: document.getElementById('dashboard-view'),
  prompterView: document.getElementById('prompter-view'),
  
  // Prompter layout
  focusZone: document.getElementById('focus-zone'),
  prompterViewport: document.getElementById('prompter-viewport'),
  prompterTextBody: document.getElementById('prompter-text-body'),
  
  // HUD Elements
  hudWrapper: document.getElementById('hud-wrapper'),
  hudBtnBack: document.getElementById('hud-btn-back'),
  hudBtnPlay: document.getElementById('hud-btn-play'),
  hudSvgPlay: document.getElementById('hud-svg-play'),
  hudSvgPause: document.getElementById('hud-svg-pause'),
  hudBtnSlower: document.getElementById('hud-btn-slower'),
  hudBtnFaster: document.getElementById('hud-btn-faster'),
  hudSpeedText: document.getElementById('hud-speed-text'),
  hudSpeedWrapper: document.getElementById('hud-speed-wrapper'),
  hudVoiceIndicator: document.getElementById('hud-voice-indicator'),
  hudVoiceText: document.getElementById('hud-voice-text'),
  hudBtnMirror: document.getElementById('hud-btn-mirror'),
  hudBtnGuides: document.getElementById('hud-btn-guides'),
  hudBtnRestart: document.getElementById('hud-btn-restart'),
  hudTimeRemaining: document.getElementById('hud-time-remaining'),

  // Countdown overlay
  countdownOverlay: document.getElementById('countdown-overlay'),
  countdownNumber: document.getElementById('countdown-number'),
  
  // Toast
  appToast: document.getElementById('app-toast'),
  toastMessage: document.getElementById('toast-message'),

  // Feedback modal
  feedbackModal: document.getElementById('feedback-modal'),
  feedbackBackdrop: document.getElementById('feedback-backdrop'),
  feedbackClose: document.getElementById('feedback-close'),
  feedbackCancel: document.getElementById('feedback-cancel'),
  feedbackForm: document.getElementById('feedback-form'),
  feedbackName: document.getElementById('feedback-name'),
  feedbackEmail: document.getElementById('feedback-email'),
  feedbackMessage: document.getElementById('feedback-message'),
  feedbackCompany: document.getElementById('feedback-company'),
  feedbackSubmit: document.getElementById('feedback-submit')
};

/* ==========================================================================
   Core Initialization
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
  loadFromLocalStorage();
  loadGlobalPreferences();
  setupEditorListeners();
  setupTooltips();
  setupPrompterHUDListeners();
  setupFeedbackListeners();
  setupGlobalShortcuts();
  setupResponsiveLayoutListeners();
  setupPanelResize();
  initSpeechRecognition();
  registerServiceWorker();

  // Ensure debounced edits reach localStorage when the tab is hidden or closed
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushPersist();
  });
  window.addEventListener('pagehide', flushPersist);

  // Trigger initial UI sizing update
  updateStats();
});

/* ==========================================================================
   State & LocalStorage Sync
   ========================================================================== */

function loadFromLocalStorage() {
  try {
    const savedScripts = localStorage.getItem('aeroprompter_scripts');
    const savedActiveId = localStorage.getItem('aeroprompter_active_id');
    const savedVoiceDefaultVersion = localStorage.getItem('aeroprompter_voice_default_version');
    
    if (savedScripts) {
      state.scripts = JSON.parse(savedScripts);
    } else {
      state.scripts = [...DEFAULT_SCRIPTS];
      saveToLocalStorage();
    }

    if (savedVoiceDefaultVersion !== VOICE_SCROLL_DEFAULT_VERSION) {
      state.scripts.forEach(script => {
        script.voiceScroll = true;
      });
      localStorage.setItem('aeroprompter_voice_default_version', VOICE_SCROLL_DEFAULT_VERSION);
      saveToLocalStorage();
    }
    
    if (savedActiveId && state.scripts.find(s => s.id === savedActiveId)) {
      state.activeScriptId = savedActiveId;
    } else if (state.scripts.length > 0) {
      state.activeScriptId = state.scripts[0].id;
    }
    
    renderScriptsSidebar();
    loadActiveScriptIntoEditor();
  } catch (e) {
    console.error('Failed to load from local storage', e);
    showToast('Failed to load scripts from browser storage.', 'error');
  }
}

function loadGlobalPreferences() {
  const colorblind = localStorage.getItem('aeroprompter_colorblind') === 'true';
  DOM.configColorblindMode.checked = colorblind;
  document.body.classList.toggle('colorblind-mode', colorblind);

  const savedLang = localStorage.getItem('aeroprompter_voice_lang');
  if (savedLang && [...DOM.configVoiceLang.options].some(opt => opt.value === savedLang)) {
    DOM.configVoiceLang.value = savedLang;
  }
}

function getVoiceLang() {
  return DOM.configVoiceLang.value || DEFAULT_VOICE_LANG;
}

function saveToLocalStorage() {
  try {
    localStorage.setItem('aeroprompter_scripts', JSON.stringify(state.scripts));
    if (state.activeScriptId) {
      localStorage.setItem('aeroprompter_active_id', state.activeScriptId);
    }
  } catch (e) {
    console.error('Failed to save to local storage', e);
  }
}

function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, numeric));
}

function normalizeScript(rawScript, fallbackIndex = 0) {
  const now = Date.now();
  return {
    id: typeof rawScript.id === 'string' && rawScript.id ? rawScript.id : `script_${now}_${fallbackIndex}`,
    title: typeof rawScript.title === 'string' && rawScript.title.trim() ? rawScript.title : 'Untitled Script',
    body: typeof rawScript.body === 'string' ? rawScript.body : '',
    wpm: clampNumber(rawScript.wpm, 50, 300, 130),
    fontSize: clampNumber(rawScript.fontSize, 24, 80, 42),
    lineHeight: clampNumber(rawScript.lineHeight, 1.2, 2.2, 1.6),
    marginWidth: clampNumber(rawScript.marginWidth, 400, 1200, 700),
    mirrorMode: !!rawScript.mirrorMode,
    voiceScroll: rawScript.voiceScroll !== false,
    focusOverlay: rawScript.focusOverlay !== false,
    focusPosition: clampNumber(rawScript.focusPosition, 30, 70, 50),
    fontFamily: ['sans', 'serif', 'mono'].includes(rawScript.fontFamily) ? rawScript.fontFamily : 'sans',
    updatedAt: Number.isFinite(rawScript.updatedAt) ? rawScript.updatedAt : now
  };
}

function getActiveScript() {
  return state.scripts.find(s => s.id === state.activeScriptId);
}

function isVoiceScrollEnabled(script) {
  return script?.voiceScroll !== false;
}

/* ==========================================================================
   Editor Panel Controller
   ========================================================================== */

function renderScriptsSidebar() {
  DOM.scriptsList.innerHTML = '';
  
  // Sort scripts by last modification date
  const sorted = [...state.scripts].sort((a, b) => b.updatedAt - a.updatedAt);
  
  sorted.forEach(script => {
    const item = document.createElement('div');
    item.className = `script-item ${script.id === state.activeScriptId ? 'active' : ''}`;
    item.dataset.id = script.id;
    
    const info = document.createElement('div');
    info.className = 'script-info';
    
    const title = document.createElement('div');
    title.className = 'script-title';
    title.textContent = script.title || 'Untitled Script';
    
    const wordsCount = script.body ? script.body.trim().split(/\s+/).filter(Boolean).length : 0;
    const meta = document.createElement('div');
    meta.className = 'script-meta';
    meta.textContent = `${wordsCount} words • ${calculateReadingTime(wordsCount, script.wpm).min}m read`;
    
    info.appendChild(title);
    info.appendChild(meta);
    item.appendChild(info);
    
    // Delete Button
    const delBtn = document.createElement('button');
    delBtn.className = 'btn-delete';
    delBtn.title = 'Delete Script';
    delBtn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="3 6 5 6 21 6"></polyline>
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
      </svg>
    `;
    
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteScript(script.id);
    });
    
    item.appendChild(delBtn);
    
    item.addEventListener('click', () => {
      selectScript(script.id);
    });
    
    DOM.scriptsList.appendChild(item);
  });
}

function loadActiveScriptIntoEditor() {
  const script = getActiveScript();
  if (!script) return;
  
  // Set text fields
  DOM.scriptTitleField.value = script.title;
  DOM.scriptEditorBody.value = script.body;
  
  // Set configurations
  DOM.configWpm.value = script.wpm;
  DOM.displayWpm.textContent = `${script.wpm} WPM`;
  
  DOM.configFontFamily.value = script.fontFamily || 'sans';
  DOM.configFontSize.value = script.fontSize || 42;
  DOM.displayFontSize.textContent = `${DOM.configFontSize.value}px`;
  
  DOM.configLineHeight.value = script.lineHeight || 1.6;
  DOM.displayLineHeight.textContent = `${DOM.configLineHeight.value}x`;
  
  DOM.configMarginWidth.value = script.marginWidth || 700;
  DOM.displayMarginWidth.textContent = `${DOM.configMarginWidth.value}px`;
  
  DOM.configMirrorMode.checked = !!script.mirrorMode;
  DOM.configFocusOverlay.checked = script.focusOverlay !== false;

  DOM.configFocusPosition.value = script.focusPosition || 50;
  DOM.displayFocusPosition.textContent = `${DOM.configFocusPosition.value}%`;
  
  // Set Scroll Modes
  const isVoice = isVoiceScrollEnabled(script);
  DOM.configVoiceScroll.checked = isVoice;
  DOM.configAutoScroll.checked = !isVoice;
  
  toggleScrollModeUI(isVoice);
  updateStats();
  updateLivePreview();
}

function selectScript(id) {
  flushPersist();
  state.activeScriptId = id;
  renderScriptsSidebar();
  loadActiveScriptIntoEditor();
  saveToLocalStorage();
}

function createNewScript() {
  const newId = 'script_' + Date.now();
  const newScript = {
    id: newId,
    title: 'Untitled Script',
    body: '',
    wpm: 130,
    fontSize: 42,
    lineHeight: 1.6,
    marginWidth: 700,
    mirrorMode: false,
    voiceScroll: true,
    focusOverlay: false,
    fontFamily: 'sans',
    updatedAt: Date.now()
  };
  
  state.scripts.unshift(newScript);
  state.activeScriptId = newId;
  
  renderScriptsSidebar();
  loadActiveScriptIntoEditor();
  saveToLocalStorage();
  
  DOM.scriptTitleField.focus();
  DOM.scriptTitleField.select();
  showToast('New script created.', 'success');
}

function duplicateActiveScript() {
  const script = getActiveScript();
  if (!script) return;

  const duplicate = {
    ...script,
    id: `script_${Date.now()}`,
    title: `${script.title || 'Untitled Script'} Copy`,
    updatedAt: Date.now()
  };

  state.scripts.unshift(duplicate);
  state.activeScriptId = duplicate.id;
  renderScriptsSidebar();
  loadActiveScriptIntoEditor();
  saveToLocalStorage();
  showToast('Script duplicated.', 'success');
}

function exportScripts() {
  const payload = {
    app: 'AeroPrompter',
    version: EXPORT_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    scripts: state.scripts.map(script => normalizeScript(script))
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const stamp = new Date().toISOString().slice(0, 10);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `aeroprompter-scripts-${stamp}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  showToast('Scripts exported.', 'success');
}

function importScriptsFromFile(file) {
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      const importedScripts = Array.isArray(parsed) ? parsed : parsed.scripts;

      if (!Array.isArray(importedScripts) || importedScripts.length === 0) {
        throw new Error('No scripts found');
      }

      const existingIds = new Set(state.scripts.map(script => script.id));
      const normalized = importedScripts.map((script, index) => {
        const nextScript = normalizeScript(script, index);
        if (existingIds.has(nextScript.id)) {
          nextScript.id = `script_${Date.now()}_${index}`;
        }
        existingIds.add(nextScript.id);
        return nextScript;
      });

      state.scripts = [...normalized, ...state.scripts];
      state.activeScriptId = normalized[0].id;
      renderScriptsSidebar();
      loadActiveScriptIntoEditor();
      saveToLocalStorage();
      showToast(`${normalized.length} script${normalized.length === 1 ? '' : 's'} imported.`, 'success');
    } catch (error) {
      console.error('Script import failed', error);
      showToast('Import failed. Choose a valid AeroPrompter JSON file.', 'error');
    } finally {
      DOM.scriptImportFile.value = '';
    }
  };
  reader.onerror = () => {
    showToast('Could not read import file.', 'error');
    DOM.scriptImportFile.value = '';
  };
  reader.readAsText(file);
}

function deleteScript(id) {
  const index = state.scripts.findIndex(s => s.id === id);
  if (index === -1) return;
  
  // Confirm deletion
  if (state.scripts.length === 1) {
    showToast('You must keep at least one script.', 'error');
    return;
  }
  
  const title = state.scripts[index].title;
  if (!confirm(`Are you sure you want to delete "${title}"?`)) return;
  
  state.scripts.splice(index, 1);
  
  if (state.activeScriptId === id) {
    state.activeScriptId = state.scripts[0].id;
  }
  
  renderScriptsSidebar();
  loadActiveScriptIntoEditor();
  saveToLocalStorage();
  showToast('Script deleted.', 'success');
}

function updateActiveScriptState(field, value) {
  const script = getActiveScript();
  if (!script) return;

  script[field] = value;
  script.updatedAt = Date.now();

  schedulePersist(field === 'title' || field === 'body' || field === 'wpm');
}

// Batch localStorage writes and sidebar rebuilds instead of doing both on
// every keystroke. Flushed on a short timer and on lifecycle boundaries.
function schedulePersist(refreshSidebar) {
  if (refreshSidebar) state.sidebarRefreshPending = true;
  clearTimeout(state.persistTimeout);
  state.persistTimeout = setTimeout(flushPersist, 300);
}

function flushPersist() {
  clearTimeout(state.persistTimeout);
  state.persistTimeout = null;
  if (state.sidebarRefreshPending) {
    state.sidebarRefreshPending = false;
    renderScriptsSidebar();
  }
  saveToLocalStorage();
}

function toggleScrollModeUI(isVoiceActive) {
  if (isVoiceActive) {
    DOM.groupSpeedControl.style.opacity = '0.35';
    DOM.groupSpeedControl.style.pointerEvents = 'none';
  } else {
    DOM.groupSpeedControl.style.opacity = '1';
    DOM.groupSpeedControl.style.pointerEvents = 'auto';
  }
}

function setupTooltips() {
  document.querySelectorAll('.tooltip-help').forEach(help => {
    const showTooltip = () => help.classList.add('is-visible');
    const hideTooltip = () => help.classList.remove('is-visible');

    help.addEventListener('mouseenter', showTooltip);
    help.addEventListener('focus', showTooltip);
    help.addEventListener('click', (event) => {
      event.stopPropagation();
      showTooltip();
    });
    help.addEventListener('mouseleave', hideTooltip);
    help.addEventListener('blur', hideTooltip);
    help.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        hideTooltip();
        help.blur();
      }
    });
  });
}

/* ==========================================================================
   Statistics Calculations
   ========================================================================== */

function calculateReadingTime(wordsCount, wpm) {
  const speed = parseInt(wpm) || 130;
  const totalSeconds = Math.ceil((wordsCount / speed) * 60);
  const min = Math.floor(totalSeconds / 60);
  const sec = totalSeconds % 60;
  return { min, sec };
}

function updateStats() {
  const text = DOM.scriptEditorBody.value || '';
  const words = text.trim().split(/\s+/).filter(Boolean);
  const wordsCount = words.length;
  const charsCount = text.length;
  
  DOM.statWords.textContent = wordsCount;
  DOM.statChars.textContent = charsCount;
  
  const wpm = DOM.configWpm.value;
  const time = calculateReadingTime(wordsCount, wpm);
  DOM.statTime.textContent = `${time.min}m ${time.sec}s`;
}

function updateLivePreview() {
  if (!DOM.typographyPreview) return;
  
  const fontFamily = DOM.configFontFamily.value;
  const fontSize = parseInt(DOM.configFontSize.value) || 42;
  const lineHeight = parseFloat(DOM.configLineHeight.value) || 1.6;
  const marginWidth = parseInt(DOM.configMarginWidth.value) || 700;
  const mirrorMode = DOM.configMirrorMode.checked;
  const layoutMetrics = getPrompterLayoutMetrics({
    fontSize,
    marginWidth
  });
  
  DOM.typographyPreview.className = 'typography-preview-box';
  DOM.typographyPreview.classList.add(`prompter-font-${fontFamily}`);
  
  DOM.typographyPreview.style.fontSize = `${layoutMetrics.fontSize}px`;
  DOM.typographyPreview.style.lineHeight = `${lineHeight}`;
  DOM.typographyPreview.style.width = `${layoutMetrics.marginWidth}px`;
  DOM.typographyPreview.style.maxWidth = '100%';
  
  if (mirrorMode) {
    DOM.typographyPreview.style.transform = 'scaleX(-1)';
  } else {
    DOM.typographyPreview.style.transform = 'none';
  }
}

/* ==========================================================================
   Settings Listeners
   ========================================================================== */

function setupEditorListeners() {
  // Sidebar actions
  DOM.btnNewScript.addEventListener('click', createNewScript);
  DOM.btnDuplicateScript.addEventListener('click', duplicateActiveScript);
  DOM.btnExportScripts.addEventListener('click', exportScripts);
  DOM.btnImportScripts.addEventListener('click', () => DOM.scriptImportFile.click());
  DOM.scriptImportFile.addEventListener('change', () => importScriptsFromFile(DOM.scriptImportFile.files[0]));
  
  // Editor changes
  DOM.scriptTitleField.addEventListener('input', () => {
    updateActiveScriptState('title', DOM.scriptTitleField.value);
  });
  
  DOM.scriptEditorBody.addEventListener('input', () => {
    updateActiveScriptState('body', DOM.scriptEditorBody.value);
    updateStats();
  });
  
  // Dynamic Range slider displays
  DOM.configWpm.addEventListener('input', () => {
    const val = DOM.configWpm.value;
    DOM.displayWpm.textContent = `${val} WPM`;
    updateActiveScriptState('wpm', parseInt(val));
    updateStats();
  });
  
  DOM.configFontSize.addEventListener('input', () => {
    const val = DOM.configFontSize.value;
    DOM.displayFontSize.textContent = `${val}px`;
    updateActiveScriptState('fontSize', parseInt(val));
    updateLivePreview();
  });
  
  DOM.configLineHeight.addEventListener('input', () => {
    const val = DOM.configLineHeight.value;
    DOM.displayLineHeight.textContent = `${val}x`;
    updateActiveScriptState('lineHeight', parseFloat(val));
    updateLivePreview();
  });
  
  DOM.configMarginWidth.addEventListener('input', () => {
    const val = DOM.configMarginWidth.value;
    DOM.displayMarginWidth.textContent = `${val}px`;
    updateActiveScriptState('marginWidth', parseInt(val));
    updateLivePreview();
  });

  DOM.configFontFamily.addEventListener('change', () => {
    updateActiveScriptState('fontFamily', DOM.configFontFamily.value);
    updateLivePreview();
  });
  
  // Switches toggles
  DOM.configMirrorMode.addEventListener('change', () => {
    updateActiveScriptState('mirrorMode', DOM.configMirrorMode.checked);
    updateLivePreview();
  });
  
  DOM.configFocusOverlay.addEventListener('change', () => {
    updateActiveScriptState('focusOverlay', DOM.configFocusOverlay.checked);
  });

  DOM.configColorblindMode.addEventListener('change', () => {
    const enabled = DOM.configColorblindMode.checked;
    document.body.classList.toggle('colorblind-mode', enabled);
    localStorage.setItem('aeroprompter_colorblind', enabled);
  });

  DOM.configVoiceLang.addEventListener('change', () => {
    const lang = getVoiceLang();
    localStorage.setItem('aeroprompter_voice_lang', lang);
    if (state.recognition) {
      state.recognition.lang = lang; // takes effect on next recognition start
    }
  });

  DOM.configFocusPosition.addEventListener('input', () => {
    const val = parseInt(DOM.configFocusPosition.value) || 50;
    DOM.displayFocusPosition.textContent = `${val}%`;
    updateActiveScriptState('focusPosition', val);
    applyFocusPosition(val);
  });
  
  // Handle Mutually Exclusive Scroll Modes
  DOM.configVoiceScroll.addEventListener('change', () => {
    const isVoice = DOM.configVoiceScroll.checked;
    DOM.configAutoScroll.checked = !isVoice;
    toggleScrollModeUI(isVoice);
    updateActiveScriptState('voiceScroll', isVoice);
  });
  
  DOM.configAutoScroll.addEventListener('change', () => {
    const isAuto = DOM.configAutoScroll.checked;
    DOM.configVoiceScroll.checked = !isAuto;
    toggleScrollModeUI(!isAuto);
    updateActiveScriptState('voiceScroll', !isAuto);
  });
  
  // LAUNCH TELEPROMPTER
  DOM.btnLaunch.addEventListener('click', launchTeleprompter);
}

function setupFeedbackListeners() {
  DOM.btnFeedback.addEventListener('click', openFeedbackModal);
  DOM.feedbackClose.addEventListener('click', closeFeedbackModal);
  DOM.feedbackCancel.addEventListener('click', closeFeedbackModal);
  DOM.feedbackBackdrop.addEventListener('click', closeFeedbackModal);
  DOM.feedbackForm.addEventListener('submit', submitFeedbackForm);

  window.addEventListener('keydown', (event) => {
    if (event.code !== 'Escape' || DOM.feedbackModal.hidden) return;
    event.preventDefault();
    closeFeedbackModal();
  });
}

function openFeedbackModal() {
  DOM.feedbackModal.hidden = false;
  document.body.classList.add('feedback-modal-open');
  setTimeout(() => DOM.feedbackName.focus(), 0);
}

function closeFeedbackModal() {
  if (DOM.feedbackModal.hidden || DOM.feedbackSubmit.disabled) return;

  DOM.feedbackModal.hidden = true;
  document.body.classList.remove('feedback-modal-open');
  DOM.btnFeedback.focus();
}

async function submitFeedbackForm(event) {
  event.preventDefault();

  const payload = {
    name: DOM.feedbackName.value.trim(),
    email: DOM.feedbackEmail.value.trim(),
    message: DOM.feedbackMessage.value.trim(),
    company: DOM.feedbackCompany.value.trim()
  };

  setFeedbackSubmitting(true);

  try {
    const response = await fetch('/api/feedback', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error('Feedback submission failed');
    }

    DOM.feedbackForm.reset();
    closeFeedbackModal();
    showToast('Thanks, your feedback was sent.', 'success');
  } catch (error) {
    console.error('Feedback submission failed', error);
    showToast('Could not send feedback right now.', 'error');
  } finally {
    setFeedbackSubmitting(false);
  }
}

function setFeedbackSubmitting(isSubmitting) {
  DOM.feedbackSubmit.disabled = isSubmitting;
  DOM.feedbackCancel.disabled = isSubmitting;
  DOM.feedbackClose.disabled = isSubmitting;
  DOM.feedbackSubmit.textContent = isSubmitting ? 'Sending...' : 'Send feedback';
}

/* ==========================================================================
   HUD Controllers & Events
   ========================================================================== */

function setupPrompterHUDListeners() {
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

function triggerHUDVisibility() {
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

function adjustWpm(delta) {
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

function setupGlobalShortcuts() {
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

/* ==========================================================================
   Teleprompter Launcher & UI Setup
   ========================================================================== */

function launchTeleprompter() {
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

function cancelStartCountdown() {
  state.countdownToken++;
  clearTimeout(state.countdownTimeout);
  DOM.countdownOverlay.hidden = true;
}

function exitTeleprompter() {
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

function restartTeleprompter() {
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

function togglePlayback() {
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

function updateHUDButtonState() {
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

function getPrompterLayoutMetrics(script) {
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

function applyFocusPosition(percent) {
  DOM.prompterView.style.setProperty('--focus-position', `${percent}%`);
}

function getFocusPositionRatio() {
  const script = getActiveScript();
  return (script?.focusPosition || 50) / 100;
}

function applyPromptSizingConfigs(script) {
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

/* ==========================================================================
   Word Tokenization
   ========================================================================== */

function tokenizeScriptText(text) {
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

const NUMBER_ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const NUMBER_TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

// Spell out small numerals so a spoken "two" matches a scripted "2" (and
// vice versa \u2014 recognition engines often transcribe numbers as digits).
function numberToWords(n) {
  if (n < 20) return NUMBER_ONES[n];
  if (n < 100) {
    const tens = NUMBER_TENS[Math.floor(n / 10)];
    const ones = n % 10;
    return ones ? tens + NUMBER_ONES[ones] : tens;
  }
  return String(n);
}

function cleanWordText(word) {
  // Lowercase and strip punctuation, symbols/emoji and variation selectors (unicode-aware)
  const cleaned = word.toLowerCase()
                      .replace(/[\p{P}\p{S}\uFE0E\uFE0F]/gu, '')
                      .trim();

  if (/^\d{1,2}$/.test(cleaned)) {
    return numberToWords(parseInt(cleaned, 10));
  }
  return cleaned;
}

function calculateWordOffsets() {
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

function resetParagraphTopAlignment() {
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

function setupResponsiveLayoutListeners() {
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

/* ==========================================================================
   Smooth Auto-Scroll Physics Ticker (RAF Loop)
   ========================================================================== */

function startAutoScrollLoop() {
  const loopId = ++state.scrollLoopId;
  state.lastTime = performance.now();
  requestAnimationFrame(timestamp => renderAutoScrollTicker(timestamp, loopId));
}

// Derive px/sec from actual reading geometry:
// estimate words per line from column width, then scale to line height in pixels.
// 0.52em avg char width × 5.5 avg chars/word gives avg word width in px.
// Recomputed only when layout can change (launch, resize, WPM adjustments)
// so the RAF loop never touches getComputedStyle.
function computeAutoScrollRate() {
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

function setActiveWordHighlight(index) {
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

function clearWordHighlights() {
  state.wordElements.forEach(el => el.classList.remove('current-word', 'spoken'));
  state.paragraphElements.forEach(p => p.classList.remove('active-paragraph'));
  state.highlightedWordIndex = -1;
  state.activeParagraphEl = null;
}

function highlightActiveWordByScrollPosition() {
  if (!state.wordOffsets || state.wordOffsets.length === 0) return;

  // Highlight the word that lies on the focus line
  const focusLine = DOM.prompterViewport.scrollTop + (DOM.prompterViewport.clientHeight * getFocusPositionRatio());
  setActiveWordHighlight(findWordIndexClosestTo(focusLine));
  maybeAdvanceAutoParagraphTopAlign();
}

/* ==========================================================================
   Voice Scroll Speech Recognition Core
   ========================================================================== */

function initSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  
  if (!SpeechRecognition) {
    console.warn("Speech Recognition API is not supported in this browser.");
    DOM.configVoiceScroll.disabled = true;
    DOM.configVoiceScroll.checked = false;
    DOM.configVoiceLang.disabled = true;
    DOM.configAutoScroll.checked = true;
    if (DOM.containerVoiceScroll) {
      const voiceHelp = DOM.containerVoiceScroll.querySelector('.tooltip-help');
      const unsupportedMessage = 'Microphone speech tracking not supported in this browser. Use Chrome or Safari.';
      DOM.containerVoiceScroll.style.opacity = '0.4';
      voiceHelp?.setAttribute('data-tooltip', unsupportedMessage);
      voiceHelp?.setAttribute('aria-label', unsupportedMessage);
    }
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

function startVoiceEngine() {
  if (!state.recognition) {
    fallbackToAutoScroll('Speech recognition not supported. Auto-scroll started.');
    return;
  }

  DOM.hudVoiceIndicator.style.display = 'flex';
  DOM.hudVoiceText.textContent = 'Activating...';

  // Run background interpolation loop for scrolling to target index Y smoothly
  startVoiceScrollLoop();

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

function stopVoiceEngine() {
  if (state.recognition && state.recognitionActive) {
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

/* ==========================================================================
   Config Panel Resize
   ========================================================================== */

function setupPanelResize() {
  const handle = document.getElementById('config-resize-handle');
  const panel = document.getElementById('config-panel');
  if (!handle || !panel) return;

  const MIN_WIDTH = 260;
  const MAX_WIDTH = 640;

  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = panel.offsetWidth;

    handle.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMove = (e) => {
      // Panel is on the right; dragging left (lower clientX) widens it
      const delta = startX - e.clientX;
      const newWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, startWidth + delta));
      panel.style.width = `${newWidth}px`;
    };

    const onUp = () => {
      handle.classList.remove('dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
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

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(error => {
      console.info('Service worker registration failed', error);
    });
  });
}

/* ==========================================================================
   UI Toast Notification System
   ========================================================================== */

function showToast(message, type = 'success') {
  DOM.appToast.className = 'toast';
  DOM.appToast.classList.add(`toast-${type}`);
  DOM.toastMessage.textContent = message;
  
  DOM.appToast.classList.add('show');
  
  clearTimeout(state.toastTimeout);
  state.toastTimeout = setTimeout(() => {
    DOM.appToast.classList.remove('show');
  }, 2500);
}
