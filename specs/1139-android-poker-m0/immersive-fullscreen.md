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
