# Android table immersive fullscreen

## Confirmed viewport constraint

The previous Activity applies systemBars|displayCutout|systemGestures as MarginLayoutParams to the entire WebView. This intentionally shrinks all pages, including table background/100dvh/fixed controls. fitTableScene uses sceneViewport client dimensions, so scene also shrinks. Runtime never invoked SystemBars.hide. This explains reserved strips/visible bars; no engine or WS change needed.

## One geometry owner, existing UI

The same native inset listener now owns both modes. Exact local https://localhost/poker/table-v2.html uses zero external margins except IME; full table background extends behind cutout/system edges. Content keeps dynamic native-safe left/right/top/bottom through density-corrected CSS variables. Existing generated table CSS and JS panel-style safe-area rules read those variables instead of WebView env insets; original poker-v2.css and fitTableScene are unchanged. Existing table padding keeps scene-bound seat touch targets safe while background fills viewport; existing fixed actions/menu/panels use the same inset source. A mobile-only max-width guard prevents action bar width exceeding safe viewport. No hardcoded cutout/gesture offsets or second inset listener.

Native route changes request insets and reset per-document CSS values; changes dispatch existing resize handler after native CSS update. Android cutout ALWAYS (API30+) or SHORT_EDGES (API28+) supports both landscape orientations. Existing SystemBars plugin inset handling stays disabled, style retained; stale auto viewport hint removed. Table uses viewport-fit=cover; Lobby/Profile retain auto and prior native margins. Physical Android pixels are divided by density before CSS injection. IME alone temporarily reduces table viewport; its bottom inset is not added again in CSS. Hide once on IME-close transition, not on every inset event, preserving transient swipe bars.

Runtime uses existing SystemBars.hide/show only: exact table at each local document ready/active; show on background and any non-table page. Runs before Auth-client earlyreturn so missing session/client cannot leave bars stuck. No new bridge/plugin/dependency, browser imports, web source, input action or system gesture exclusion.

## Risks and physical acceptance

Full available viewport changes existing fitTableScene scale; seats/cards/action dock may move relative to safe header/dock. Insets/rotation/transient system bars can change safe content sizing and trigger rescale. Narrow viewports may compress action area; test all buttons/slider/menu/seat/social controls against cutout on both sides. IME resize/close and rotate with keyboard need device confirmation. User gestures can temporarily reveal bars; not a fullscreen failure. Desktop/freeform caption or accessibility settings may retain system UI per Android policy. No physical PASS is claimed until owner retest. Shared web breaking impact none: only packaged CSS transformation/mobile files changed; source web CSS/JS unchanged.

## M1 Verified App Links proposal only

- Reserve a stable owned HTTPS Stage domain/path for Android auth return; do not use disposable Deploy Preview hosts. Serve /.well-known/assetlinks.json from that host without redirects.
- Use stable APK signing identity and package id, and publish that signing certificate SHA256 in Digital Asset Links; current ephemeral debug certificates cannot support durable verification. Production Play App Signing and Stage identities require separate entries/ownership decisions.
- Future M1: exact autoVerify HTTPS intent filter, verified link handling/callback validation and exact Stage Auth redirect entry, preserving PKCE and Supabase's normal Google provider callback. Verify domain association on physical Android.
- No domain, key, intent, OAuth/provider/Supabase or allowlist changes now; existing custom scheme remains the physically proven M0 flow.

Sources: pinned Capacitor8.5.3 SystemBars API/source and https://developer.android.com/develop/ui/views/layout/immersive . Artifact/verification evidence will be posted in Draft PR after hosted build.

Review correction: Social Settings sets inline env(safe-area-inset-*) bounds from poker-v2.js, which would override transformed stylesheet values. Apply the same safe-area expression substitution to the packaged JS copy only; shared source remains unchanged. Native safe-area owner is therefore used for inline panel styles as well.

Lifecycle guard correction: repository pre-commit forbids independent pageshow/pagehide owners outside XP core. Removed those proposed listeners instead of adding waivers/allowlist exceptions. Local package navigation uses full document loads (ready applies bar mode each time); existing App appStateChange owns background/resume. No new browser lifecycle owner or guard bypass.

## Hosted immersive APK verification

APK source857159ca8157166e46929726eda45309842973cb; hosted workflow https://github.com/krzysztofcal/arcadePlatform/actions/runs/40035549837 SUCCESS. Artifact https://github.com/krzysztofcal/arcadePlatform/actions/runs/40035549837/artifacts/12537340661 ; APK arcade-poker-stage-857159ca8157166e46929726eda45309842973cb.apk,10179471bytes. SHA2569f9cd14ecf0ba72dbc753f9476df06f2f58a7d03476c54519b48d78d68904f32 matches SHA256SUMS. Exported/embedded receipt match exactsource/API1141/StageSupabase/WSPreview. In-memory nested APK inspection confirms tableviewportcover/otherpagesauto, native inset listener plugin disabled, native safe-variable code present, SystemBars hide/show exact-route runtime, all generated table CSS and inline JS safe-area expressions remapped, packaged JS syntax PASS, original custom-scheme callback present. No file saved to VPS.

Existing fundamental regressions76/76 PASS, focused final lifecycle/PKCE3/3 PASS, syntax228/CSP55/lifecycle guard/whitespace PASS. Review corrected generated Social Settings JS inset expressions. Repository lifecycle guard initially rejected added pagehide/pageshow listeners; they were removed and precommit passed, no exception/bypass. Hosted CI40035549691, WS PR Checks40035549874, Tests40035550112 and Android build all SUCCESS for APK source. No new layout tests or dependency. Shared web folders diff empty against241e871a.

Physical fullscreen/rotation/IME/gesture result NOT TESTED; owner checklist above applies. APK v2 signer differs from prior deliveredfe4220ed (new certd2d855ed7040a88463d33e7eb1254ccabec230967f38a7cf875e47030b7cb11a): existing ephemeral-debug signing limitation persists. adb install -r cannot upgrade across different signers; owner may choose manual Stage-app reinstall, losing local session/cache, then re-login (server account unaffected). No signing infrastructure change. New owner PASS for Google/native session and avatar upload/finalize recorded; no Auth/DB/Storage/WS/Redis/Production setting or financial operation changed by this task. VPS6.5GB before/after, no SDK/install/checkout/cleanup. A following evidence-only commit does not change APK payload source.

M1 official references: https://developer.android.com/training/app-links/configure-assetlinks and https://developer.android.com/training/app-links/verify-applinks . No M1 domain/signature/redirect configuration applied.
