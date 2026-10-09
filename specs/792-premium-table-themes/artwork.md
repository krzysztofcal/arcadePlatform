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
| dealer.webp | 546×640 | 79894 | `48373c618583ef00ad102da90a28b24a8e1d01ac742eb4ff58de3389d7f1f8ba` | High-quality OpenAI imagegen lower-torso repair of the restored dealer; Sharp export |
| felt.svg | 512×512 | 480 | `1229631247d5cb926ca41d4bb9eff2c3ecdf6c4c332c0ceeaab847506cd7d0ff` | Original project vector |
| rail.svg | 512×128 | 598 | `df0ccdd18821fa137ddc0ca1eb3ebc3b55c1f644224baee75075330eb075a8b3` | Original project vector |
| room.webp | 1536×1024 | 172924 | `e8744b52964028d08fae14645638f3dab00e39b5d8f52fbc3b836563f96eb047` | OpenAI generated; Sharp export |

Package total: **255229 bytes** (ceiling 962,560). Room 172,924 bytes ≤614,400; transparent dealer 79,894 bytes ≤225,280; surface and decorative vectors each below their group ceilings. Dealer export canvas 546×640 matches the original canvas and aspect ratio. Existing box dimensions, background positioning and normalized card-flight origin (0.5, 0.84) are unchanged; Royal Gold foreground clipping is corrected for the full lower torso; visually compared head/hands/deck registration at native scene size. Final owner acceptance remains pending.

Generation prompts (built-in tool):
- Room: empty black-marble and gold Art Deco private casino salon, warm crystal chandeliers, cinematic realistic illustration, dark unobstructed foreground for the existing table; no people/table/cards/chips/UI/text.
- Dealer: imagegen edit of the restored high-quality sprite: preserve face, hair, expression, high gathered neckline, thin straps, arms/hands/deck and normalized framing; extend only the lower central gold satin garment naturally to the bottom edge on a genuinely transparent canvas. No table/background or reframe. Built-in imagegen; Sharp export 546×640, WebP quality 90/alpha quality 100.

No remaining dealer variants are generated before owner acceptance of this checkpoint.

## Rejected deterministic extraction — historical record

Historical attempt, now reverted: owner requested extraction and deterministic upscale, then rejected its quality. The extraction script and alpha mask described below have been removed; the exact high-quality imagegen export above is current. Reused Royal Gold pixels directly from `design/premium-collection.png` (source SHA-256 above). Source region `(1250,40,135,140)` includes approximately 114×123 useful character pixels. Authored `design/royal-gold-dealer-mask.svg` isolates hair, torso, hands and card stack, excluding the table and room. `design/extract-royal-gold-dealer.cjs` reproduces the export using existing Sharp 0.34.5: Lanczos3 sampling, alpha matte, normalized crop, mild sharpening (sigma 0.5), 546×640 canvas and WebP quality 92/alpha quality 100. Same input/version produced the same encoded SHA on two runs. No API key, generative edit or invented fine detail.

The concept table occludes the lower waist. A 269×33 crop of the source gown at intermediate (310,594) is resampled vertically to 269×100 and masked into only the lower garment before the existing live rail occludes it; no generative reconstruction. The source composition maps to the existing dealer canvas; CSS dimensions/position/flight origin/clipping stay unchanged. This preserves the approved garment cut but the small source limits native detail, especially on enlarged desktop scenes. Output resolution must not be interpreted as recovered high-resolution detail. Inspect the exported dress/hands on the actual Preview before owner acceptance.

## Owner-requested restoration before torso repair

Restored dealer.webp byte-for-byte from original blob e0902cdd7bf3b42a1563c4e16e79dc9063f934eb (runtime checkpoint 78d591a / pre-extraction 9df2500). SHA-256 and bytes match the original export; no regeneration, resizing or sharpening. Owner explicitly rejected the soft extracted version and requested this imagegen version.

## Current full-torso imagegen repair

Owner accepted the restored generated direction but identified the horizontal lower-torso cutoff before rail occlusion. New high-resolution imagegen edit extends continuous gold satin to the bottom without moving the reference head/hands. Export dimensions 546×640; decoded center column alpha remains at least 252/255 across rows 576–639 (last 10%). Pose, dress cut and identity visually inspected against the restored sprite. Original generated repair remains outside the public repo; the optimized final WebP is local in poker/assets/themes/royal-gold. The scoped CSS foreground clip now follows arms/hands/deck and excludes the lower torso, which the existing rail covers; no scene box, origin or z-order changes. All budgets remain met.
