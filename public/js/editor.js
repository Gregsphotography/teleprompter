/* ==========================================================================
   AeroPrompter - Dashboard editor: sidebar, config panel, feedback modal
   ========================================================================== */

import {
  state,
  DOM,
  EXPORT_FORMAT_VERSION,
  calculateReadingTime,
  showToast
} from './core.js';
import {
  getActiveScript,
  isVoiceScrollEnabled,
  normalizeScript,
  saveToLocalStorage,
  updateActiveScriptState,
  flushPersist,
  getVoiceLang
} from './storage.js';
import { API_BASE } from './platform.js';
import {
  launchTeleprompter,
  getPrompterLayoutMetrics,
  applyFocusPosition
} from './prompter.js';

export function renderScriptsSidebar() {
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

export function loadActiveScriptIntoEditor() {
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

export function selectScript(id) {
  flushPersist();
  state.activeScriptId = id;
  renderScriptsSidebar();
  loadActiveScriptIntoEditor();
  saveToLocalStorage();
}

export function createNewScript() {
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

export function duplicateActiveScript() {
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

export function exportScripts() {
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

export function importScriptsFromFile(file) {
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

export function deleteScript(id) {
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

export function toggleScrollModeUI(isVoiceActive) {
  if (isVoiceActive) {
    DOM.groupSpeedControl.style.opacity = '0.35';
    DOM.groupSpeedControl.style.pointerEvents = 'none';
  } else {
    DOM.groupSpeedControl.style.opacity = '1';
    DOM.groupSpeedControl.style.pointerEvents = 'auto';
  }
}

export function setupTooltips() {
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

export function updateStats() {
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

export function updateLivePreview() {
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

export function setupEditorListeners() {
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

export function setupFeedbackListeners() {
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
    const response = await fetch(`${API_BASE}/api/feedback`, {
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

export function setupPanelResize() {
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
