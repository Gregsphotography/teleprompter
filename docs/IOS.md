# Building the AeroPrompter iOS App

The repository contains a complete Capacitor iOS project (`ios/`). The web app
in `public/` is the single source of truth — the iOS app bundles a copy of it
and swaps in native implementations for the two things WKWebView cannot do:

| Capability | Web | iOS app |
| --- | --- | --- |
| Voice recognition | Web Speech API | Apple `SFSpeechRecognizer` via `@capacitor-community/speech-recognition` |
| Keep screen on | Screen Wake Lock API | `@capacitor-community/keep-awake` |
| Offline assets | Service worker | Bundled in the app (service worker skipped) |
| Feedback API | Relative `/api/feedback` | `https://aeroprompter.app/api/feedback` |

Native code paths are selected at runtime in `public/js/platform.js`
(`window.Capacitor` only exists inside the app shell), so the website is
unaffected by any of this. `tests/native-shell.spec.js` exercises the native
paths in CI with a simulated Capacitor bridge.

## Prerequisites (on your Mac)

- Xcode 16 or newer (App Store)
- CocoaPods: `brew install cocoapods` (the project uses CocoaPods because the
  speech-recognition plugin does not support Swift Package Manager)
- Node 20+ and an [Apple Developer account](https://developer.apple.com)
  ($99/year, required for device testing and the App Store)

## First build

```bash
git clone <repo> && cd teleprompter
npm ci
npx cap sync ios        # copies public/ into the app + runs pod install
npx cap open ios        # opens App.xcworkspace in Xcode
```

In Xcode:

1. Select the **App** target → **Signing & Capabilities** → choose your Team.
   Xcode will provision the `app.aeroprompter` bundle ID automatically (change
   it here and in `capacitor.config.json` if it's taken).
2. Pick a simulator or your connected iPhone and press **Run**.

> Simulator note: speech recognition needs a microphone; test voice scroll on
> a real device. Everything else works in the simulator.

## After changing the web app

```bash
npm run cap:sync   # re-copies public/ into ios/App/App/public
```

Then build again in Xcode. No other steps — the Xcode project itself rarely
changes.

## Device smoke test checklist

- Launch a script in **voice mode**: mic + speech permission prompts appear
  (texts are in `ios/App/App/Info.plist`), the HUD shows "Listening...", and
  reading aloud scrolls the prompter. Keep reading past one minute — iOS ends
  recognition sessions at ~60s and the app must restart them seamlessly.
- Screen stays awake during a session and sleeps normally after exiting.
- Notch/Dynamic Island and home indicator: dashboard and HUD are not obscured
  (safe-area insets in `public/styles.css`).
- Feedback form sends (goes to the production API).
- Denying the mic permission falls back to auto-scroll with a toast, and the
  saved script settings are not modified.

## App Store submission

1. In Xcode: **Product → Archive**, then **Distribute App → App Store Connect**.
2. In [App Store Connect](https://appstoreconnect.apple.com): create the app
   (bundle ID `app.aeroprompter`), fill in the privacy questionnaire —
   microphone/audio used for **App Functionality** only, not linked to
   identity, no tracking (this matches `ios/App/App/PrivacyInfo.xcprivacy`).
3. Screenshots: 6.7" iPhone and 13" iPad are required. The editor and the
   prompter with the focus guides make good shots.
4. TestFlight first: upload a build, test on your own devices, then submit
   for review.

### Review guideline 4.2 (minimum functionality)

Apple sometimes rejects apps that are thin website wrappers. If a reviewer
raises 4.2, the response is that the app provides native functionality beyond
the website: on-device Apple speech recognition driving the teleprompter
(WKWebView has no Web Speech API — this is native code, not a web feature),
native keep-awake during reading sessions, and fully offline operation with
locally bundled assets. Emphasizing the voice-scroll feature in the App Store
description helps preempt this.

## Project layout notes

- `capacitor.config.json` — app ID, name, `webDir: public`, dark shell colors.
- `ios/App/App/Info.plist` — permission usage strings.
- `ios/App/App/PrivacyInfo.xcprivacy` — privacy manifest (registered in the
  Xcode project; required by App Review).
- `resources/` — icon/splash sources; regenerate the asset catalog with
  `npx @capacitor/assets generate --ios` after changing them.
- `ios/App/Podfile` — plugin pods; `npx cap sync ios` keeps it in sync with
  `package.json`.
