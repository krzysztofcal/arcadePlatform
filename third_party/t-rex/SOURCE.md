# T-Rex Runner Source Record

Selected upstream: https://github.com/wayou/t-rex-runner

Pinned revision: `5455bfa408ec6b707c7300ff194b7390733a766d`

Upstream license URL:

https://github.com/wayou/t-rex-runner/blob/5455bfa408ec6b707c7300ff194b7390733a766d/LICENSE

Upstream source notes:

- The upstream README describes the game as extracted from Chrome's offline error page.
- The vendored `index.js` carries a Chromium Authors BSD-style header.
- The upstream repository includes a BSD-3-Clause `LICENSE` file at the pinned revision.

Source file mapping:

| Upstream path | Local path | Notes |
|---|---|---|
| `index.js` | `games/t-rex/vendor/wayou-t-rex-runner/index.js` | Imported unchanged from the pinned revision. |
| `assets/default_100_percent/100-offline-sprite.png` | `games/t-rex/vendor/wayou-t-rex-runner/assets/default_100_percent/100-offline-sprite.png` | Active 1x sprite sheet. |
| `assets/default_200_percent/200-offline-sprite.png` | `games/t-rex/vendor/wayou-t-rex-runner/assets/default_200_percent/200-offline-sprite.png` | Active 2x sprite sheet. |
| `LICENSE` | `third_party/t-rex/LICENSE`; `public/games/t-rex/LICENSE` | Copied verbatim from upstream. |

Local integration files:

- `games/t-rex/main.js` wraps the upstream runner for Arcade Hub controls,
  fullscreen sizing, mute/pause UI and XP score bridge events.
- `game_trex.html` and `games/t-rex/index.html` provide the upstream-required
  `.interstitial-wrapper` container and local sprite image tags.
- `play.html` provides the generic game shell credit entry for T-Rex Runner.
- `games/t-rex/style.css` styles the upstream canvas in the standalone page.

Local modifications:

- The upstream `index.js` file itself is not edited.
- The previous unresolved local canvas implementation was replaced by an
  Arcade Hub adapter that invokes the vendored upstream runner.
- Upstream audio data from the demo HTML is not copied; the adapter disables
  sound loading.
- Upstream arcade-mode viewport scaling is disabled by the adapter so the game
  remains inside the Arcade Hub shell and fullscreen service.
- XP integration emits local score/activity events from the adapter.

No remote runtime dependency:

The active T-Rex runtime uses local JavaScript and local PNG assets only. No
remote scripts, remote images, remote audio, or CDN code are introduced by this
component.

Checksums:

| Local path | SHA-256 |
|---|---|
| `games/t-rex/vendor/wayou-t-rex-runner/index.js` | `e7a50d337bdbe4299068de034e4564cfe5fd45ca9257ded37b6ada9330cedf0f` |
| `games/t-rex/vendor/wayou-t-rex-runner/assets/default_100_percent/100-offline-sprite.png` | `e306705c996676db01f4072ed3d6f33d89089a848ab0b2a0ba07a2d866ec309f` |
| `games/t-rex/vendor/wayou-t-rex-runner/assets/default_200_percent/200-offline-sprite.png` | `b3011fd16e43cd860b9782c4eafe77c1cc40da2e0f6e2e5ea547d98d6efac879` |
| `third_party/t-rex/LICENSE` | `c6ba363b8d8d89eab0a8f4775e4fc5dc2dc1c3b649cbf2a0af4049699ee29533` |
