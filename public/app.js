/* ==========================================================================
   AeroPrompter - Application entry point
   ========================================================================== */

import { loadFromLocalStorage, loadGlobalPreferences, flushPersist } from './js/storage.js';
import {
  setupEditorListeners,
  setupTooltips,
  setupFeedbackListeners,
  setupPanelResize,
  updateStats
} from './js/editor.js';
import {
  setupPrompterHUDListeners,
  setupGlobalShortcuts,
  setupResponsiveLayoutListeners
} from './js/prompter.js';
import { initSpeechRecognition } from './js/voice.js';

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(error => {
      console.info('Service worker registration failed', error);
    });
  });
}

function init() {
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
}

// Module scripts are deferred, so the DOM is ready by the time this runs
init();
