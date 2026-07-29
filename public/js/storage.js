/* ==========================================================================
   AeroPrompter - Script persistence & preferences (localStorage)
   ========================================================================== */

import {
  state,
  DOM,
  DEFAULT_SCRIPTS,
  VOICE_SCROLL_DEFAULT_VERSION,
  DEFAULT_VOICE_LANG,
  clampNumber,
  showToast
} from './core.js';
import {
  renderScriptsSidebar,
  loadActiveScriptIntoEditor
} from './editor.js';

export function loadFromLocalStorage() {
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

export function loadGlobalPreferences() {
  const colorblind = localStorage.getItem('aeroprompter_colorblind') === 'true';
  DOM.configColorblindMode.checked = colorblind;
  document.body.classList.toggle('colorblind-mode', colorblind);

  const savedLang = localStorage.getItem('aeroprompter_voice_lang');
  if (savedLang && [...DOM.configVoiceLang.options].some(opt => opt.value === savedLang)) {
    DOM.configVoiceLang.value = savedLang;
  }
}

export function getVoiceLang() {
  return DOM.configVoiceLang.value || DEFAULT_VOICE_LANG;
}

export function saveToLocalStorage() {
  try {
    localStorage.setItem('aeroprompter_scripts', JSON.stringify(state.scripts));
    if (state.activeScriptId) {
      localStorage.setItem('aeroprompter_active_id', state.activeScriptId);
    }
  } catch (e) {
    console.error('Failed to save to local storage', e);
  }
}

export function normalizeScript(rawScript, fallbackIndex = 0) {
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
    mobileFocusPosition: clampNumber(rawScript.mobileFocusPosition, 20, 70, 40),
    fontFamily: ['sans', 'serif', 'mono'].includes(rawScript.fontFamily) ? rawScript.fontFamily : 'sans',
    updatedAt: Number.isFinite(rawScript.updatedAt) ? rawScript.updatedAt : now
  };
}

export function getActiveScript() {
  return state.scripts.find(s => s.id === state.activeScriptId);
}

export function isVoiceScrollEnabled(script) {
  return script?.voiceScroll !== false;
}

export function updateActiveScriptState(field, value) {
  const script = getActiveScript();
  if (!script) return;

  script[field] = value;
  script.updatedAt = Date.now();

  schedulePersist(field === 'title' || field === 'body' || field === 'wpm');
}

// Batch localStorage writes and sidebar rebuilds instead of doing both on
// every keystroke. Flushed on a short timer and on lifecycle boundaries.
export function schedulePersist(refreshSidebar) {
  if (refreshSidebar) state.sidebarRefreshPending = true;
  clearTimeout(state.persistTimeout);
  state.persistTimeout = setTimeout(flushPersist, 300);
}

export function flushPersist() {
  clearTimeout(state.persistTimeout);
  state.persistTimeout = null;
  if (state.sidebarRefreshPending) {
    state.sidebarRefreshPending = false;
    renderScriptsSidebar();
  }
  saveToLocalStorage();
}
