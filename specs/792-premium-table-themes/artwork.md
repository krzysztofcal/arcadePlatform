# Artwork provenance and export policy — #792

Current artifact set: review-only original concept boards and captures of this repository's unchanged Poker V2 baseline. Baseline includes existing project artwork; it is a reference to preserve geometry, not newly licensed art.

Concept generation: OpenAI image generation, 2026-10-09, directed by the #792 brief and existing repository reference captures. No borrowed casino screenshots, brands, celebrity references or third-party asset packs are requested. Generated output is subject to provider usage terms; this record does not assert exclusivity or legal clearance. Original decorative vectors will be authored for the project after approved directions are selected.

Final local export inventory is required in T007, before implementation can be called complete. For every room/dealer/surface/card/frame export record path, dimensions, byte count, SHA-256, generation/source attribution and terms source. Asset budgets and dealer registration requirements are in plan.md. Concepts are not drop-in runtime assets: final separate layers require native-size inspection and exact hand/head registration.

## Design artifact inventory

- `baseline-landscape.png`: 1293182 bytes; SHA-256 `bf66690ea3b4947a56375c9b775010f20f57186f7e5b32cc2626b1bfc2bb3278`.
- `baseline-portrait.png`: 388865 bytes; SHA-256 `267b816a0ecec4862ca6082ed5b41eb369e3cc50cb1197cb13167e732072826d`.
- `premium-collection.png`: 2716986 bytes; SHA-256 `e282be11628c8a52d2b28a0195c795c42e8abcee43d4bca1c2c2a9ade932d36f`.

Generated board is 1536×1024 concept artwork. Baseline captures are 1440×900 and 390×844. Concepts illustrate visual direction; exact proportions, hand registration and final crisp ranks are verified against the live DOM after approved per-layer export. Classic detail illustrations are references only; shipped default cards and dealer stay unchanged. Terms reference: https://openai.com/policies/terms-of-use/ (ownership/usage subject to applicable account terms).

## Original vector detail studies

Six `<theme-id>-details.svg` files were authored for this review as deterministic vectors, without third-party templates. Royal has Art Deco corner geometry; Neon has circuit motifs; Sapphire faceted diamonds; Crimson woven damask; Emerald jade lattice. Plain Classic faces and striped back remain the current direction. Large and native-size reference samples show values/suits; final runtime keeps existing live text and dimensions.

- `classic-casino-details.svg`: 1200×410, 5434 bytes, SHA-256 `a223c01f5b78d5324e845c8fc9d3eef2a1b8252d52f82da03ddbdc77e52b433d`.
- `crimson-velvet-details.svg`: 1200×410, 7763 bytes, SHA-256 `d52ab0f15b586e419c9330281a9e5ae1c51d9ba1cde4d41b0a56e9d1c91309e7`.
- `emerald-palace-details.svg`: 1200×410, 7503 bytes, SHA-256 `9275690d89b8b0295bc21d65888630a6d71bb52a547703d62fc21d6c92cc8640`.
- `midnight-sapphire-details.svg`: 1200×410, 7576 bytes, SHA-256 `bbf7b5ec8029216b3395474be0bacfba23039f40a1a84f06d77d0ad13009db14`.
- `neon-vegas-details.svg`: 1200×410, 7909 bytes, SHA-256 `93dbbc5be1891b2bd35b87c1edb5b1b4046917584c0e648588ccd59a0782a89e`.
- `royal-gold-details.svg`: 1200×410, 7439 bytes, SHA-256 `8f33bd64f587fff764453ccf6fc1d0f8c88e4149fb7f29cadfc2f9e88cb473c9`.

## Royal Gold runtime checkpoint

Seven local exports; Classic reuses the shipped assets unchanged. Raster exports use built-in OpenAI image generation, with the existing dealer as the identity/pose reference. Generated originals remain outside the published repository. Resized and encoded with the existing Sharp dependency; transparency preserved. Vectors authored originally for this project. Terms source remains the OpenAI terms link above; no third-party art pack is used.

| Path under `poker/assets/themes/royal-gold/` | Dimensions | Bytes | SHA-256 | Source |
|---|---|---:|---|---|
| avatar-frame.svg | 100×100 | 487 | `813bdf37332bf495bce11755a8fa103f63adcddae171f072d0cf3f37e72cbc9c` | Original project vector |
| card-back.svg | 100×140 | 515 | `4b70c3d3eb3b57c3211ed85864831a43701a9daeb9ae94e094fc000deb78912c` | Original project vector |
| card-face.svg | 100×140 | 331 | `2ec38ff92fc784ce5d85022c1955b2c0793077a9f7cb3414f05aa7919b17534a` | Original project vector |
| dealer.webp | 546×640 | 72014 | `3eaf2a6f46d8145a6b8dd1d85751c3a06dc2d9e734c265110caa3b8120c9622d` | OpenAI generated; Sharp export |
| felt.svg | 512×512 | 480 | `1229631247d5cb926ca41d4bb9eff2c3ecdf6c4c332c0ceeaab847506cd7d0ff` | Original project vector |
| rail.svg | 512×128 | 598 | `df0ccdd18821fa137ddc0ca1eb3ebc3b55c1f644224baee75075330eb075a8b3` | Original project vector |
| room.webp | 1536×1024 | 172924 | `e8744b52964028d08fae14645638f3dab00e39b5d8f52fbc3b836563f96eb047` | OpenAI generated; Sharp export |

Package total: **247349 bytes** (ceiling 962,560). Room 172,924 bytes ≤614,400; transparent dealer 72,014 bytes ≤225,280; surface and decorative vectors each below their group ceilings. Dealer export canvas 546×640 matches the original canvas and aspect ratio. Existing box dimensions, background positioning, clipping and normalized card-flight origin (0.5, 0.84) are unchanged; visually compared head/hands/deck registration at native scene size. Final owner acceptance remains pending.

Generation prompts (built-in tool):
- Room: empty black-marble and gold Art Deco private casino salon, warm crystal chandeliers, cinematic realistic illustration, dark unobstructed foreground for the existing table; no people/table/cards/chips/UI/text.
- Dealer: costume-only edit of the existing adult dealer; preserve identity, face, hair, pose, hands and deck; modest champagne gold satin formal dress with thin straps, transparent canvas, identical registration.

No remaining dealer variants are generated before owner acceptance of this checkpoint.
