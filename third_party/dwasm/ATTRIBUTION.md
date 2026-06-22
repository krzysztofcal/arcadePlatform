# Dwasm / PrBoomX attribution

- Component: Dwasm WebAssembly runtime vendored for the Freedoom browser game
- Runtime files: `games-open/freedoom/vendor/dwasm/index.js`, `index.data`, `index.wasm`
- Upstream: https://github.com/GMH-Code/Dwasm
- Exact source revision: https://github.com/GMH-Code/Dwasm/tree/ddf0347a4fc115b11ffb1c5710768b7c47c46698
- Upstream README lineage: PrBoom+ (`https://github.com/coelckers/prboom-plus`) and PrBoomX (`https://github.com/JadingTsunami/prboomX`)
- Copyright: Gregory Maynard-Hoare and contributors; see vendored `games-open/freedoom/vendor/dwasm/AUTHORS`
- License: GPL-2.0-or-later; see [LICENSE](LICENSE)
- Corresponding-source/build record: [SOURCE.md](SOURCE.md)

The current Freedoom integration uses a verified source-built Dwasm preload. The old libarchive extraction layer was removed from the shipped runtime, and `games-open/freedoom/script.js` now boots the preloaded IWAD from `index.data`.
