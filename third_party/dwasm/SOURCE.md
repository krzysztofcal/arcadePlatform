# Dwasm source and build record

This repository ships the Freedoom browser runtime from a source-built Dwasm preload. The vendored runtime files are:

- `games-open/freedoom/vendor/dwasm/index.js`
- `games-open/freedoom/vendor/dwasm/index.data`
- `games-open/freedoom/vendor/dwasm/index.wasm`

## Pinned upstream source

- Upstream repository: https://github.com/GMH-Code/Dwasm
- Exact commit: `ddf0347a4fc115b11ffb1c5710768b7c47c46698`
- Commit URL: https://github.com/GMH-Code/Dwasm/tree/ddf0347a4fc115b11ffb1c5710768b7c47c46698
- Upstream README lineage: PrBoom+ (`https://github.com/coelckers/prboom-plus`) and PrBoomX (`https://github.com/JadingTsunami/prboomX`)
- Local modification record for the shipped binaries: no local Dwasm source patch is retained in this repository; the repo change is limited to vendoring the built outputs and documenting their provenance

## Verified non-code inputs

| Input | Source | SHA-256 |
|---|---|---|
| Freedoom source zip | https://github.com/freedoom/freedoom/releases/download/v0.13.0/freedoom-0.13.0.zip | `3f9b264f3e3ce503b4fb7f6bdcb1f419d93c7b546f4df3e874dd878db9688f59` |
| Extracted `freedoom2.wad` | from the Freedoom 0.13.0 source zip above | `a8772e088847032510d97ba2312406a6998f21cbab44d4ff10696faa9c0ecd4b` |
| Generated `prboomx.wad` | produced by the native Dwasm build used for this vendored runtime | `506fe7159eaf0a6cb479f866131ec7653638bb08928029cb8dabe1b3b1c9474d` |

`games-open/freedoom/assets/freedoom2.bin` remains tracked in the repository as a legacy archive, but `games-open/freedoom/script.js` no longer loads or extracts it. The active runtime preloads `freedoom2.wad` from `vendor/dwasm/index.data`.

## Tool bootstrap used for the verified build

The build that produced the vendored runtime was prepared in `/home/copilot/work/dwasm-scratch` with the following toolchain:

| Tool | Observed version / path |
|---|---|
| Emscripten SDK | `emcc 6.0.1` (`25e4e8d6550d392ba9e0c2936bce7cf41ee47cc0`) under `/home/copilot/work/dwasm-scratch/emsdk` |
| Node runtime used by emsdk | `/home/copilot/work/dwasm-scratch/emsdk/node/22.16.0_64bit/bin/node` |
| CMake | `/home/copilot/work/dwasm-scratch/tools/cmake-3.31.6-linux-x86_64/bin/cmake` |
| Ninja | `/home/copilot/work/dwasm-scratch/tools/ninja` |
| Native compilers for `prboomx.wad` generation | `/home/copilot/work/dwasm-scratch/tools/bin/zig-cc` and `/home/copilot/work/dwasm-scratch/tools/bin/zig-c++` from Zig `0.17.0-dev.947+36069a2a7` |
| SDL2 native dependency | static SDL2 `2.32.10` installed under `/home/copilot/work/dwasm-scratch/local` |

## Build steps used for the shipped preload

1. Obtain the exact Dwasm source tree at commit `ddf0347a4fc115b11ffb1c5710768b7c47c46698`.
2. Download the Freedoom 0.13.0 source zip from the URL above and verify SHA-256 `3f9b264f3e3ce503b4fb7f6bdcb1f419d93c7b546f4df3e874dd878db9688f59`.
3. Extract `freedoom2.wad` from the zip, verify SHA-256 `a8772e088847032510d97ba2312406a6998f21cbab44d4ff10696faa9c0ecd4b`, and place it at `Dwasm/wasm/fs/freedoom2.wad`.
4. Generate `prboomx.wad` with a native Dwasm build:

   ```sh
   cmake -S /home/copilot/work/dwasm-scratch/Dwasm \
     -B /home/copilot/work/dwasm-scratch/build-native \
     -G Ninja \
     -DCMAKE_BUILD_TYPE=Release \
     -DCMAKE_MAKE_PROGRAM=/home/copilot/work/dwasm-scratch/tools/ninja \
     -DCMAKE_C_COMPILER=/home/copilot/work/dwasm-scratch/tools/bin/zig-cc \
     -DCMAKE_CXX_COMPILER=/home/copilot/work/dwasm-scratch/tools/bin/zig-c++ \
     -DCMAKE_PREFIX_PATH=/home/copilot/work/dwasm-scratch/local
   cmake --build /home/copilot/work/dwasm-scratch/build-native
   ```

   The resulting `build-native/prboomx.wad` matched SHA-256 `506fe7159eaf0a6cb479f866131ec7653638bb08928029cb8dabe1b3b1c9474d` and was copied to `Dwasm/wasm/fs/prboomx.wad`.

5. Build the web runtime with the same source tree and preload directory:

   ```sh
   emcmake /home/copilot/work/dwasm-scratch/tools/cmake-3.31.6-linux-x86_64/bin/cmake \
     -S /home/copilot/work/dwasm-scratch/Dwasm \
     -B /home/copilot/work/dwasm-scratch/Dwasm/build \
     -G Ninja \
     -DCMAKE_BUILD_TYPE=Release \
     -DCMAKE_MAKE_PROGRAM=/home/copilot/work/dwasm-scratch/tools/ninja \
     -DIMPORT_EXECUTABLES=/home/copilot/work/dwasm-scratch/build-native/ImportExecutables.cmake \
     -DBUILD_GL=OFF \
     -DBUILD_SERVER=OFF
   cmake --build /home/copilot/work/dwasm-scratch/Dwasm/build
   ```

   Upstream `CMakeLists.txt` applies `--preload-file=../../wasm/fs/@/`, so the build embeds `freedoom2.wad` and `prboomx.wad` into `index.data`.

6. Vendor the resulting `index.js`, `index.data` and `index.wasm` into `games-open/freedoom/vendor/dwasm/`.

## Produced artifact checksums

| Artifact | Size (bytes) | SHA-256 |
|---|---:|---|
| `index.html` | 4585 | `4c9810d31cea803a74a61d43b6549be268ddfe7481e60b15160b54517d0ef48d` |
| `index.js` | 203375 | `e59ba08aec568bc9c9caaad82c4be2de9accee0ec3d091290ad71899704ec69b` |
| `index.data` | 29259403 | `44d49bcb0be4e5483c4daadb85ecfee2100daedc8f6f61f892ef725220abde95` |
| `index.wasm` | 1958254 | `12a5483405a68207d0252b0f3a334d899112f8075458ac9e3a106f8b49cc8f55` |

Only `index.js`, `index.data` and `index.wasm` are vendored into the Freedoom runtime path. `index.html` is recorded here as part of the verified build output set, but is not shipped from `games-open/freedoom/vendor/dwasm/`.

## GPL and source-availability obligations

- Keep the GPL text in [LICENSE](LICENSE) and the upstream `games-open/freedoom/vendor/dwasm/{COPYING,AUTHORS,README.md}` notices with redistributed binaries.
- Provide recipients the complete corresponding source for the exact shipped build: the pinned Dwasm commit above, any local source modifications (none retained here), the build steps in this file, and the non-code preload inputs (`freedoom2.wad` from Freedoom 0.13.0 and the generated `prboomx.wad`).
- If the binaries are redistributed separately from source, accompany them with a GPL-compliant durable source URL or written offer.
- Do not reintroduce undocumented binaries into `games-open/freedoom/vendor/dwasm/`; every shipped binary in that path must stay tied to this source record or an updated replacement record.
