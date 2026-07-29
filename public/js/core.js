/* ==========================================================================
   AeroPrompter - Shared state, DOM cache, and small utilities
   ========================================================================== */


export const VOICE_SCROLL_DEFAULT_VERSION = '2';

export const EXPORT_FORMAT_VERSION = 1;

export const DEFAULT_VOICE_LANG = 'en-US';

// --- Global Application State ---
export const state = {
  scripts: [],
  activeScriptId: null,
  isPlaying: false,
  scrollMode: 'voice', // 'auto' or 'voice'
  
  // High-precision scrolling physics
  currentScrollY: 0,
  targetScrollY: 0,
  lastTime: 0,
  scrollLoopId: 0,       // Generation counter so stale RAF loops self-terminate
  lastProgrammaticScrollTop: -1, // Lets the scroll listener ignore our own writes

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

  // Cached reading-band geometry (recomputed alongside the word offsets)
  readingFloorY: 0,      // Deepest on-screen Y the active word may occupy
  maxScrollY: 0,         // scrollHeight - clientHeight

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

// --- Default Welcome Scripts for Onboarding ---
export const DEFAULT_SCRIPTS = [
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
export const DOM = {
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
  configMobileFocusPosition: document.getElementById('config-mobile-focus-position'),
  displayMobileFocusPosition: document.getElementById('display-mobile-focus-position'),
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

export function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, numeric));
}

export function calculateReadingTime(wordsCount, wpm) {
  const speed = parseInt(wpm) || 130;
  const totalSeconds = Math.ceil((wordsCount / speed) * 60);
  const min = Math.floor(totalSeconds / 60);
  const sec = totalSeconds % 60;
  return { min, sec };
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

export function cleanWordText(word) {
  // Lowercase and strip punctuation, symbols/emoji and variation selectors (unicode-aware)
  const cleaned = word.toLowerCase()
                      .replace(/[\p{P}\p{S}\uFE0E\uFE0F]/gu, '')
                      .trim();

  if (/^\d{1,2}$/.test(cleaned)) {
    return numberToWords(parseInt(cleaned, 10));
  }
  return cleaned;
}

export function showToast(message, type = 'success') {
  DOM.appToast.className = 'toast';
  DOM.appToast.classList.add(`toast-${type}`);
  DOM.toastMessage.textContent = message;
  
  DOM.appToast.classList.add('show');
  
  clearTimeout(state.toastTimeout);
  state.toastTimeout = setTimeout(() => {
    DOM.appToast.classList.remove('show');
  }, 2500);
}
