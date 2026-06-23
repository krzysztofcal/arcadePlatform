# T-Rex Runner Attribution

Component: T-Rex Runner browser game

Upstream: https://github.com/wayou/t-rex-runner

Pinned revision: `5455bfa408ec6b707c7300ff194b7390733a766d`

License: BSD-3-Clause

Author / copyright:

- Upstream repository owner: wayou / 牛さん
- Upstream `LICENSE`: Copyright (c) 2022, 牛さん
- Upstream `index.js` header: Copyright (c) 2014 The Chromium Authors

Active runtime paths in this repository:

- `games/t-rex/vendor/wayou-t-rex-runner/index.js`
- `games/t-rex/vendor/wayou-t-rex-runner/assets/default_100_percent/100-offline-sprite.png`
- `games/t-rex/vendor/wayou-t-rex-runner/assets/default_200_percent/200-offline-sprite.png`
- `games/t-rex/main.js` as the Arcade Hub adapter around the vendored runner
- `game_trex.html`
- `games/t-rex/index.html`
- `play.html` generic game shell credit entry

Required attribution / notice:

The BSD-3-Clause copyright notice, conditions and disclaimer must be retained.
The names of the copyright holder or contributors may not be used to endorse or
promote derived products without prior written permission.

Modification summary:

Arcade Hub vendors the upstream runner and local sprite assets, then integrates
them through a local adapter for Arcade Hub controls, fullscreen sizing, XP score
events, and local mute/pause buttons. Upstream audio data is not copied into the
page; the adapter disables runner sound loading so no remote or binary audio
runtime dependency is introduced.
