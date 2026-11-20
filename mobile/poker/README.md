# Arcade Poker Android M0

Locally bundled Stage-only Capacitor PoC for #1139. Source: existing `poker/index.html`, `poker/table-v2.html`, `account.html`; no second account/Poker UI. `package-web.mjs` stages only referenced JS/CSS and Poker assets, composes navigation and supplies a local pinned Supabase UMD. Web files retain existing behavior when `MOBILE_POKER_CONFIG` is absent. No server.url, OTA, payments, engine, database or WS deployment.

## Build and provenance

Build only on GitHub-hosted ubuntu-24.04 using **Android Poker M0 APK**, from a same-repo Draft PR or manual dispatch after the workflow exists on main. Workflow checks exact source HEAD, disk, hosted identity, uses locked Capacitor 8.5.3 dependencies, Node 22.23.1 and JDK 21.0.10+7.0.LTS, generates Android from the pinned template, uses its Gradle Wrapper and runs assembleDebug. SDK/build-tools/Gradle versions are controlled by the pinned template and recorded in toolchain.txt. No emulator, release key or environment secrets. Debug signing is ephemeral; APK bytes/signature can differ between builds; reproduction means the same locked sources/toolchain and behavior, not byte-identical debug signatures. Installed builds signed by a different ephemeral key require uninstall first (loses app-local session).

Actions artifact `arcade-poker-stage-pr-<PR>-<full SHA>` expires after seven days and contains APK, SHA256SUMS, build-receipt.json and toolchain.txt. The receipt pins Stage API/Supabase/WS and source SHA. The APK workflow itself never deploys anything. Existing repository PR checks/Netlify Preview automation are separate; they do not deploy the packaged app or WS.

Hosted build steps (single-line commands, run in mobile/poker):

`npm ci --ignore-scripts --no-audit --no-fund`

`node package-web.mjs`

`./node_modules/.bin/cap add android`

`node configure-android.mjs`

`./node_modules/.bin/cap sync android`

`cd android && ./gradlew --no-daemon --max-workers=2 assembleDebug`

Do not run these build/install commands on the VPS. Existing generated www/android directories cause packaging to stop rather than deleting files.

## Stage integration GO — prepared, NOT applied

Public settings were read from approved Preview 1095; project is pinned to `krydukthwdvccggbyjfw`, WS to `wss://ws-preview.kcswh.pl/ws`. `stage-public.json` contains a public anon key, never a privileged key. It is not a runtime-secret channel. Change the preview origin deliberately when a newer authorized Preview is needed.

Read-only OPTIONS on 2026-10-23 to Preview 1095 ws-mint-token with Origin https://localhost and Authorization/Content-Type preflight returned **403 without Access-Control-Allow-Origin**. Thus API/token mint/gameplay is blocked until Stage configuration GO. No authenticated requests, JOIN or ledger writes were performed.

Required separate **GO Stage mobile CORS/OAuth**:

1. Add exact `https://localhost` to existing **Stage-only** `XP_CORS_ALLOW`, preserving other origins. Review every used function's OPTIONS/Bearer CORS. Do not change Production or use wildcard/native HTTP bypass. Applying Netlify config/redeploy is separate authorization.
2. Add exact `arcadepoker-stage://auth/callback` to **pinned Stage** Supabase Auth redirect allowlist; enable Google only if approved/configured there. Keep Google's provider redirect at Supabase's normal auth callback. App launches external Custom Tab through Browser, never Google in WebView; local Supabase PKCE verifier is used to exchange the callback code. Custom scheme is PoC-only and can be claimed by other installed apps; PKCE prevents code redemption without verifier. Verified Android App Links are an M1 release gate.
3. Check Stage WS accepts the actual app origin and minted Stage token; if WS configuration/deployment is required, prepare and obtain separate GO. This PR changes no WS protocol or server runtime. Do not dispatch WS Preview Deploy implicitly.

Callback expiry/cancel/error is retryable from Account; no provider tokens/URLs are logged. Email verification/recovery redirects use the mobile callback but need real-device verification. Android Back on table follows existing lobby link (does not silently cash out); from Account goes to lobby; from lobby minimizes. Resume restarts Supabase refresh; existing WS heartbeat/reconnect/resync remains authoritative. Android process death may require reopening a table. No offline game mode.

## Samsung Galaxy S24+ test

1. Open the successful Actions run, download the exact-SHA artifact; extract ZIP in My Files. Compare SHA256 on a trusted computer if available: `sha256sum -c SHA256SUMS`.
2. Tap APK, temporarily allow installation from that browser/My Files when Android asks. If Samsung Auto Blocker blocks sideloading, use device-owner settings to permit this controlled installation, then restore protection. No Play upload required. Launch **Arcade Poker Stage**. A build signed by another debug key may need uninstall/reinstall.
3. Confirm Stage/SHA banner, Poker-only lobby, account/login/profile and existing deletion navigation (do not confirm deletion). Check portrait/landscape, keyboard/avatar picker, Back, cold start, offline message and resume.
4. After Stage configuration GO, use only approved Stage identity: email/password login, Google external-browser cancel/success, email links/recovery, expired session. Verify returning to app keeps session and no token appears in UI/logs.
5. **Separate funded gameplay GO required** before JOIN/New Game/buy-in/action/Leave/bonus claims. Then verify lobby/table action, loss of network, heartbeat reconnect/resync, screen lock/background and return. Record Android/WebView version, APK SHA, scenario/result and sanitized failures.

A phone is not attached to this VPS. APK build/syntax/unit results do not prove OAuth/session/gameplay/device behavior. Keep PR Draft pending runtime evidence.

## Compatibility / decision matrix

| Client | UI revision | API / WS |
| --- | --- | --- |
| Web | current Netlify deploy | existing relative APIs, existing deployment WS config |
| Android 0.0.1 Stage | artifact's exact SHA | Preview in receipt + pinned Stage WS, existing protocol |
| Older installed APK | stays bundled at old SHA | backend must retain compatible token mint, snapshots/actions and idempotency |

A web deploy never updates installed UI. UI changes need a new APK; backend changes must preserve older app contracts or coordinate a new release first. Roll back by reinstalling a known artifact (debug signature caveat); no OTA. M1 owns stable signing, verified links, release AAB, legal/Play gates and compatibility version enforcement.

| Approach | M0 decision / fallback threshold |
| --- | --- |
| Capacitor | approved; keeps shared UI; prove external OAuth/local-origin CORS/WS on device |
| TWA/PWA | documentation only; verified hosted origin simplifies origin but weakens local bundle/iOS sharing requirement |
| Flutter / React Native | documentation only; a UI rewrite and bridge maintenance, only after demonstrated material blocker |
| .NET MAUI / Kotlin Multiplatform | documentation only; new toolchain and UI/platform integration cost; no M0 prototype |

Future iOS can share packaged assets/adapters but needs separate GO, macOS/Xcode, signing and Apple policy work. No iOS implementation.

References: [Capacitor config](https://capacitorjs.com/docs/config), [App events](https://capacitorjs.com/docs/apis/app), [Supabase native deep links](https://supabase.com/docs/guides/auth/native-mobile-deep-linking). Current Supabase changelog inspected; TLS cipher retirement does not require changing modern Android WebView configuration.

## PR review follow-up

Public-profile links use the unchanged Stage origin through the external Browser; offline resume no longer emits an online event. [Detailed environment/API/CORS audit](../../specs/1139-android-poker-m0/review-followup.md) identifies the Netlify XP Redis v3 context mismatch and stale Preview 1095 contract. No environment/origin change applied; native and authenticated integration remain pending.

## Galaxy S24+ visual retest

The owner confirmed installation/Lobby/Account/basic navigation on bebbdc6a, but found system-bar overlap and unwanted Search. [Device evidence and focused no-gameplay retest](../../specs/1139-android-poker-m0/device-smoke-s24.md) separate these presentation defects from blocked API1095/CORS. The next APK uses built-in native insets with generated viewport-fit=auto, explicit AndroidX EdgeToEdge, Poker/Profile-only bottom navigation and a status footer/table-menu message rather than a fixed banner. Physical visual PASS remains pending. Redis repair is still stopped at the earlier credential mismatch; this changes no backend setting.

## Approved API integration (2026-10-23)

The current APK pins API Preview1141, superseding the historical1095 diagnostics above; Supabase Stage and WS Preview are unchanged. Exact-branch XP_CORS_ALLOW adds only https://localhost. Actual19 OPTIONS combinations passed on deploy6adbc543278f8840161bc416/source2c6f23daf5f47f4e0b59f6c4489f36dc6fc1532d. Stage password login, progression GET and token mint200; WS helloAck/authOk without JOIN PASS. OAuth provider/redirect configuration untouched and phone callback NOT TESTED. Redis shared Preview repair PASS is recorded in SpecKit; the old stopped-Redis notes are historical. See android-api-integration.md in SpecKit for current evidence and safe phone checklist.

## #1159 PR3: own-PR debug APK

Automatic same-repository Draft PR builds wait at most 10 minutes for their own native Deploy Preview at the exact current source SHA. They validate Netlify site, review ID, deploy context and Stage receipt before dependency/Gradle costs, then recheck before packaging and upload. CI never falls back to the static API origin in stage-public.json (local packaging only). Manual dispatch now requires an open Draft PR number and its exact current HEAD SHA; branch-only dispatch is unsupported. No new secret or environment setting is required.

The artifact includes build-receipt.json (PR/source/deploy/origins/app version/CSP/SRI), SHA256SUMS and verified debug signature evidence. Synchronize skips compilation only after read-only Actions evidence confirms a completed successful, nonexpired APK for the same PR whose source is an ancestor with unchanged application inputs. In-progress/cancelled/missing/uncertain artifacts require a new build at the current HEAD, even for docs-only changes. Existing artifacts keep their original source receipts. Installed static APKs retain their bundled endpoint and do not update automatically. Physical installation remains separate from CI acceptance.

## #1146 PR1: Android audio foundation

`PokerAudioPlugin.java` is a local Capacitor plugin copied into the generated project and registered in `MainActivity` by `configure-android.mjs`. Its single instance belongs to the Activity/Bridge, so one looping `MediaPlayer` and its playhead outlive every WebView document navigation; pages never own audio. It decides the music scene itself from the committed document URL (Lobby views and Profile play; table, Offline table, legal and unknown documents fade out and pause), so Offline keeps its isolated CSP/SRI and needs no script. No Service, permission, dependency or network use; audio never plays in the background.

| State | Set by | Effect |
| --- | --- | --- |
| `enabled` | SharedPreferences `poker_audio/sound_on`, default ON | OFF stops music and cues at once and survives relaunch |
| `resumed` | Activity resume/pause (background, lock, external browser) | immediate pause and focus release; fade-in on return |
| `musicScene` | URL allowlist: on when a Lobby/Profile document finished loading, off when another document shows | starts by itself after the launch screen (no tap); ~600 ms fade then pause; resume at the kept position |
| `hold` | headset/Bluetooth unplug, permanent focus loss | silent until the next foreground or Sound ON |
| `focusPaused` / duck | transient Audio Focus loss (call) / can-duck | pause until focus returns / 30% volume |

Audio Focus is held only while lobby music is wanted and is released when it pauses or the page is not a music page (also during a call-interrupted request), so a silent table never interrupts another app's audio. A refused request is retried every 3 s while music is still wanted. Cues share the music focus on the music pages; elsewhere they take a brief `GAIN_TRANSIENT_MAY_DUCK` focus (other audio dips instead of stopping) and do not play if it is refused. Focus is never released under a playing cue: cues are stopped first. **Every SFX and dealer line must be at most 3 s** (`CUE_MAX_MS`): the cue focus ends 3 s after the last cue started and cuts anything still playing. A cue requested during the ~600 ms Lobby-to-table fade-out is not started, and one still playing when that fade ends is cut.

`/mobile/audio.js` exposes `window.MobilePokerAudio`: `available()`, `isEnabled()`, `setEnabled(on)`, `play(cue)`, `voice(cue)`, `preload(cues)`, `stop()`. Every method resolves a boolean and never throws; without the Android plugin (WWW, Deploy Preview, any browser) it is a silent no-op with no listeners. Cues are `SoundPool` samples named by the files in `mobile/poker/audio/` (`[a-z0-9_]`), share the same mute/lifecycle gate, drop when stale and allow one voice line at a time. The lobby track is described in the section “#1146 Lobby music (licensed, encrypted)” below.

Phone test, follow-up build (OWNER, Galaxy S24+): 1) fresh install, launch, do not touch: music fades in by itself once the Lobby appears; 2) Lobby → Tables/Progression/Bonus → Profile → Lobby: no restart or gap; 3) Online table and Offline table: fades out, returning continues from the same place; 4) `Sound: Off` is immediate, survives force-close, and a relaunch stays silent with no tap and after taps; 5) Home and screen lock silence at once, return fades in; 6) unplug headphones/Bluetooth: stops, stays silent until the app is left and reopened or Sound is toggled; 7) call: silent, resumes after; 8) airplane mode: same as 1–3 with Poker Offline; 9) Spotify playing, open the app: Spotify pauses on the Lobby (music takes over); 10) at a table restart Spotify from the notification shade: it keeps playing for the whole table stay, and returning to the Lobby pauses it again. The temporary PR1 `Sound: On/Off` demo button is replaced by the integrated setting in PR2 (see section below). CI proves compilation and packaging only; the first build passed the original 8-step phone checklist, this follow-up build is unverified until retested.

## #1146 PR2: Sound setting and bonus cue

Sound toggle lives in `#avatarMenu` (Lobby and Profile) and `#pokerSocialSettingsPanel` (Online and Offline tables), controlling the single native preference (`sound_on`, default ON). Packaged Offline includes `/mobile/audio.js` with exact SRI and page CSP hash; WWW Offline never loads it. The bonus cue (`bonus_coins` → `bonus_coins.mp3`: “Cash Register Fake.wav” by CapsLok, Freesound 184438, CC0 1.0, bundled unchanged from Freesound’s public HQ MP3 preview; third-party, not project MIT work; see `mobile/poker/audio/manifest.json` and `docs/provenance-audit.md`) triggers only on confirmed new Welcome or Daily Bonus claims; already-claimed/failed claims and WWW stay silent. On the Lobby document the adapter starts preloading `bonus_coins` early. Preloading does not guarantee that decoding has finished: if a claim is confirmed while the sample is still decoding, the existing native pending window of 400 ms applies and the cue may be dropped. This residual first-play risk is accepted as a known Android M1 limitation.
Phone checklist (OWNER, Galaxy S24+): 1) Sound toggle on all 4 screens (Lobby, Profile, Online table, Offline table) stays in sync and survives relaunch; 2) toggling to OFF silences music and cues immediately; 3) claiming Daily Bonus and Welcome Bonus plays the cash-register cue once; repeated/failed claims stay silent; 4) Offline table in airplane mode shows and obeys the Sound toggle; 5) WWW remains completely silent.
Device behaviour is unverified until the OWNER phone test.

## #1146 Lobby music (licensed, encrypted)

The lobby cue `lobby` plays “Card Games (Lo-fi Chill)” by snoozybeats from Pixabay (https://pixabay.com/music/beats-card-games-lofi-chill-315489/), under the Pixabay Content License: third-party, not CC0, not MIT. The listing is marked Content ID Registered and AI-generated. Use inside the APK is permitted, but the recording must not be redistributed on its own, so the repository holds only `audio/lobby.mp3.enc` (AES-256-GCM, file name authenticated). The plaintext `audio/lobby.mp3` is git-ignored.

In the Android APK workflow, the step “Decrypt licensed lobby music (fails closed)” is the only one that receives the repository secret `MOBILE_LOBBY_MUSIC_KEY`. It runs `node licensed-audio.mjs decrypt`, which checks the authentication tag and the manifest sha256 `277f149f…5556`. `package-web.mjs` refuses to package in CI without that exact file. A missing key, a wrong key, an altered file or a checksum mismatch therefore fails the job and publishes no APK artifact. Local packaging and tests run without the key and produce a package without lobby music. The native player, Sound setting, Audio Focus, fades and WWW silence are unchanged.

Re-encrypting (only with the OWNER's original file and key): `MOBILE_LOBBY_MUSIC_KEY=<key> node licensed-audio.mjs encrypt <file.mp3>` in `mobile/poker`. Rotating the key requires re-encrypting and updating the secret together. The track is mastered loud (peak −0.9 dBFS); the native music gain of 0.35 applies. Device behaviour is unverified until the OWNER phone test.

## #1146 PR3: table sound cues

`poker/poker-v2.js` plays 13 short cues through the existing adapter (`window.MobilePokerAudio`, Android APK only, so WWW stays silent): shuffle and hole-card deal at hand start, a card per flop/turn/river card and showdown reveal, fold, bet/call/raise and all-in chips, chips reaching the pot, pot payout and a discreet hero win. Cues hang off the same claims as the visuals (`claimCardTransitions()`, the bet pot delta, one claimed settlement per hand), so initial snapshots, reconnect, resync, rerenders and duplicate frames are silent. Reduced motion suppresses only the visuals, not the sound. The player's own Fold, Call/Bet/Raise and All-in follow the same rule as opponents: they sound with the presentation of the authoritative state (chips flying to the pot, the muck), never on the button press or the command acknowledgement, so high latency delays the sound together with the animation and a rejected command stays silent. A player counts as having put chips in when the pot grows and their stack dropped in the same hand, which also covers a repeated call and a call that closes the betting round (the server resets the last action then). All-in sounds only on authoritative evidence: the server's `all_in` action or a stack emptied in that frame. Each kind has a minimum gap (repeats are dropped), variants alternate, and a cue whose hand or table has changed by its scheduled time stays silent. All cues are preloaded at table init (the native 400 ms pending window still applies to a cue that is not yet decoded).

The sounds are Kenney “Casino Audio” 1.1 (CC0, https://kenney.nl/assets/casino-audio; pack licence in `audio/KENNEY-CASINO-AUDIO-LICENSE.txt`), rebuilt to quiet mono WAVs by `audio/build-table-cues.mjs`; per-cue provenance is in `audio/manifest.json`. Poker Offline uses the generated renderer (`poker/offline/renderer.generated.js`), which this PR leaves unchanged: Offline table cues arrive with its regeneration in PR4. Phone checklist (OWNER): hand start, each street, fold, bet/raise/all-in, payout and win sound in step with the visuals and stay quiet next to the music; nothing replays after leaving and returning, backgrounding, reconnecting or rotating; Sound OFF silences cues at once; WWW silent. Device behaviour is unverified until the OWNER test.

## #1146 PR4: English dealer voice and Poker Offline

Six short English lines in one consistent synthetic female voice (Kokoro-82M, voice `af_heart`, Apache-2.0 model, generated offline by `audio/build-dealer-voice.mjs`; provenance and checksums in `audio/manifest.json`) follow the same presentation claims as the table cues: “Dealing cards” when a new hand is dealt live, “The flop/turn/river” as each street is dealt, “All in” with live all-in chips (at most once every 4 s) and “Next hand” about 2 s after a claimed payout (the next hand's snapshot is held until the 3.5 s winner reveal ends). Lines play on the native voice channel: one at a time, a newer line replaces an older one, and a line still decoding after 400 ms is dropped; they never play on initial, reconnect, resync or duplicate frames, follow Sound ON/OFF and are independent of reduced motion. Voice is mastered at −3 dBFS peak (≈ −17 dB RMS), well above the quiet table cues (≈ −35 dB RMS) and the music at its 0.35 gain; while a line plays the native owner dips music and other cues by about 6 dB (`VOICE_DUCK`, music fades over ~300 ms) and restores them 1.1 s later (longer than any line), or at once on mute, background or stop.

Poker Offline now uses the same presentation code: `scripts/build-poker-offline-poc.mjs` preloads the cues in the Offline init and the regenerated `poker/offline/renderer.generated.js` / `play.html` carry the new SRI and CSP hashes. Offline still loads only its bundled scripts plus the local audio adapter (`connect-src 'none'`), so table cues and the dealer voice work in airplane mode. Phone checklist (OWNER): Offline in airplane mode plays hands with cues and voice; each line matches its moment, is clearly audible over the music and never talks over itself; Online unchanged apart from the voice; Sound OFF silences everything; WWW silent. Device behaviour is unverified until the OWNER test.

## #1291 T3: Production AAB (unsigned)

**Android Production AAB (unsigned)** (`.github/workflows/android-release-aab.yml`) builds `pl.kcswh.arcadepoker` ("Arcade Poker") as an **unsigned** release App Bundle on GitHub-hosted ubuntu-24.04.

- **How it runs:**
  - Release builds use manual `workflow_dispatch` from `main` with `sourceSha` (must equal current main HEAD), `versionName` (`x.y.z`) and `versionCode` (integer, higher than any earlier upload).
  - There is no pull_request trigger: PR code never receives the music key in this workflow. The first real run is possible only after merge.
  - GitHub Actions keeps the artifact (AAB plus receipts) for 7 days. Nothing is signed, uploaded to Google Play or deployed.
- **Checks:**
  - bundletool 1.18.3 (SHA-256 pinned) confirms package and version, targetSdk ≥ 36, not debuggable, the `play.kcswh.pl/app/auth/callback` App Link and no Stage scheme.
  - Permissions are only `INTERNET` and the app-scoped AndroidX receiver permission.
  - The bundled `config.js` must equal the pinned Production endpoints exactly.
  - `jarsigner -verify` must report `jar is unsigned`.
  - The licensed lobby music decrypt stays fail-closed.
- **Signing:** a future OWNER step (separate GO), done locally with the Play upload key; Google signs the delivered app through Play App Signing. Never sign with the debug key. No key or password goes to git, PRs, logs or artifacts.
- **Status:** online play and sign-in in the Production app need T2a (channel-aware runtime/OAuth), the WWW Production release of T2b, the Supabase redirect allowlist and T2d (`assetlinks.json` with the Play app signing fingerprint). Until then only Poker Offline is expected to work.
- **Details:** procedure, blockers and the Galaxy S24+ plan are in `specs/1140-ugc-safety/t3-production-aab.md`.
