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

Package total: **255229 bytes** (ceiling 962,560). Room 172,924 bytes ≤614,400; transparent dealer 79,894 bytes ≤225,280; surface and decorative vectors each below their group ceilings. Dealer export canvas 546×640 matches the original canvas and aspect ratio. Existing box dimensions, background positioning and normalized card-flight origin (0.5, 0.84) are unchanged; Royal Gold foreground clipping is corrected for the full lower torso; visually compared head/hands/deck registration at native scene size. Royal Gold full-torso checkpoint is accepted; see approval.md.

Generation prompts (built-in tool):
- Room: empty black-marble and gold Art Deco private casino salon, warm crystal chandeliers, cinematic realistic illustration, dark unobstructed foreground for the existing table; no people/table/cards/chips/UI/text.
- Dealer: imagegen edit of the restored high-quality sprite: preserve face, hair, expression, high gathered neckline, thin straps, arms/hands/deck and normalized framing; extend only the lower central gold satin garment naturally to the bottom edge on a genuinely transparent canvas. No table/background or reframe. Built-in imagegen; Sharp export 546×640, WebP quality 90/alpha quality 100.

The remaining dealer variants were generated after explicit owner acceptance of this checkpoint.

## Rejected deterministic extraction — historical record

Historical attempt, now reverted: owner requested extraction and deterministic upscale, then rejected its quality. The extraction script and alpha mask described below have been removed; the exact high-quality imagegen export above is current. Reused Royal Gold pixels directly from `design/premium-collection.png` (source SHA-256 above). Source region `(1250,40,135,140)` includes approximately 114×123 useful character pixels. Authored `design/royal-gold-dealer-mask.svg` isolates hair, torso, hands and card stack, excluding the table and room. `design/extract-royal-gold-dealer.cjs` reproduces the export using existing Sharp 0.34.5: Lanczos3 sampling, alpha matte, normalized crop, mild sharpening (sigma 0.5), 546×640 canvas and WebP quality 92/alpha quality 100. Same input/version produced the same encoded SHA on two runs. No API key, generative edit or invented fine detail.

The concept table occludes the lower waist. A 269×33 crop of the source gown at intermediate (310,594) is resampled vertically to 269×100 and masked into only the lower garment before the existing live rail occludes it; no generative reconstruction. The source composition maps to the existing dealer canvas; CSS dimensions/position/flight origin/clipping stay unchanged. This preserves the approved garment cut but the small source limits native detail, especially on enlarged desktop scenes. Output resolution must not be interpreted as recovered high-resolution detail. Inspect the exported dress/hands on the actual Preview before owner acceptance.

## Owner-requested restoration before torso repair

Restored dealer.webp byte-for-byte from original blob e0902cdd7bf3b42a1563c4e16e79dc9063f934eb (runtime checkpoint 78d591a / pre-extraction 9df2500). SHA-256 and bytes match the original export; no regeneration, resizing or sharpening. Owner explicitly rejected the soft extracted version and requested this imagegen version.

## Current full-torso imagegen repair

Owner accepted the restored generated direction but identified the horizontal lower-torso cutoff before rail occlusion. New high-resolution imagegen edit extends continuous gold satin to the bottom without moving the reference head/hands. Export dimensions 546×640; decoded center column alpha remains at least 252/255 across rows 576–639 (last 10%). Pose, dress cut and identity visually inspected against the restored sprite. Original generated repair remains outside the public repo; the optimized final WebP is local in poker/assets/themes/royal-gold. The scoped CSS foreground clip now follows arms/hands/deck and excludes the lower torso, which the existing rail covers; no scene box, origin or z-order changes. All budgets remain met.

## Complete remaining packages — owner-authorized 2026-10-09

Royal Gold full-torso checkpoint is accepted (approval.md/RG06). Classic Casino reuses all shipped assets unchanged. Four new complete alternative packages follow the approved collection and detail motifs. Built-in imagegen generated each empty room and edited the accepted Royal Gold dealer separately; no API key, remote runtime image or third-party pack. Dealer edits change gown/jewelry colors only, preserving identity, pose, high gathered neckline, thin straps, hand/deck placement and continuous lower torso. Existing Sharp export: 1536×1024 room, 546×640 RGBA dealer, WebP quality 90/alpha quality 100. Five SVG layers per package are original project vectors; surface SVGs explicitly stretch to the existing table box. Provider terms source is recorded above.

### neon-vegas

| Path under `poker/assets/themes/neon-vegas/` | Dimensions | Bytes | SHA-256 | Source |
|---|---|---:|---|---|
| avatar-frame.svg | 100×100 | 487 | `15bb524301592c2d93d7bc8f8877d57e3569f6b31c62cadd527ed7bb91635c5f` | Original project vector |
| card-back.svg | 100×140 | 417 | `6917367c5d2d95243f3a4f26d20f98904b8e27125e439c9c634612b029e42851` | Original project vector |
| card-face.svg | 100×140 | 331 | `e368783916af84d8b9c69e428195d0e4040b17b77a2f0612c8a82b1c330eb411` | Original project vector |
| dealer.webp | 546×640 | 83966 | `21ab6e8435ac3aea0824b0e499464bdf08b7e90908fdd4f802427941a4dc3db1` | Built-in imagegen; Sharp export |
| felt.svg | 512×512 | 591 | `ca53622c2030b944af43db93f773d0c0ebc1dd8cb9454533663651b70cb5eff3` | Original project vector |
| rail.svg | 512×128 | 488 | `efdc06891dfe8b99b8aed12bccd18b28ee1654ba1a3446a11458a671ae2c62e8` | Original project vector |
| room.webp | 1536×1024 | 385492 | `682ed13d10fd8aa72f4b1a885a0143bf78c1063a792599e3ca14f3a0eb65f822` | Built-in imagegen; Sharp export |

Package total: **471772 bytes**, within all room/dealer/surface/card/frame ceilings.

### midnight-sapphire

| Path under `poker/assets/themes/midnight-sapphire/` | Dimensions | Bytes | SHA-256 | Source |
|---|---|---:|---|---|
| avatar-frame.svg | 100×100 | 487 | `32f1475bad264eec104b9b05bdf443827b7135621ecd1623098ad9e24403e48b` | Original project vector |
| card-back.svg | 100×140 | 412 | `07d45604e6551af6c100f04628cef5c4f560a3bc10ec10e603d2a25a9a85ddec` | Original project vector |
| card-face.svg | 100×140 | 331 | `a3e43484225b8aaba18b53ef12140f7dca900d70bc6e111318c966c1dc23db7b` | Original project vector |
| dealer.webp | 546×640 | 81886 | `e6f5a52c219a77248c3a7992ed543ba48ea2fe582860cdec216632bad458867e` | Built-in imagegen; Sharp export |
| felt.svg | 512×512 | 539 | `607779185421145e4b6471bf4268bfd4539b6e10cd5b330638322aefa274570d` | Original project vector |
| rail.svg | 512×128 | 488 | `e15788c69400f2c29029838e8282c064b0788b26d46ef7b995f4c427510e311d` | Original project vector |
| room.webp | 1536×1024 | 311298 | `6d0b3253196f499f2e4911da47aa03f44c4b027daf52c2677d9c60cc30d76295` | Built-in imagegen; Sharp export |

Package total: **395441 bytes**, within all room/dealer/surface/card/frame ceilings.

### crimson-velvet

| Path under `poker/assets/themes/crimson-velvet/` | Dimensions | Bytes | SHA-256 | Source |
|---|---|---:|---|---|
| avatar-frame.svg | 100×100 | 487 | `0acf3accb6649177293fb7e386d0f79f504eb5daadbca80681517b9a994a7e0f` | Original project vector |
| card-back.svg | 100×140 | 438 | `e1508e7012938242f27bf656c1ed8ab74774139c41df3ed414ac63c1a08d7eef` | Original project vector |
| card-face.svg | 100×140 | 331 | `3c659b18f0d445b712af1b3057e34905eb8c5ae7deb0c137c924781d290ff2f2` | Original project vector |
| dealer.webp | 546×640 | 80002 | `8ec5d4dd62c971fe8c0f4dccec8d6034d9c357b7d8a794bd81098d8b4f2904bc` | Built-in imagegen; Sharp export |
| felt.svg | 512×512 | 599 | `902f30bf0f65d385d5462e273dab421016716da13cd89cd067ebe2a61b367f3a` | Original project vector |
| rail.svg | 512×128 | 488 | `6b0cc895153189bdf06752590543c2a08b70b92e536c6b35ea52727eddac9725` | Original project vector |
| room.webp | 1536×1024 | 293008 | `d45502f47e5948b4a6a8a60389410347ecaf4f94160f6f25ab774599f921a6db` | Built-in imagegen; Sharp export |

Package total: **375353 bytes**, within all room/dealer/surface/card/frame ceilings.

### emerald-palace

| Path under `poker/assets/themes/emerald-palace/` | Dimensions | Bytes | SHA-256 | Source |
|---|---|---:|---|---|
| avatar-frame.svg | 100×100 | 487 | `f6e1fe849523fe088496b43d41000cd1613614fed9681a8630bf1979560e1187` | Original project vector |
| card-back.svg | 100×140 | 452 | `17cf9c8e66006c11e48398d75ddbad41d2714280706af9fc456bbaa329271130` | Original project vector |
| card-face.svg | 100×140 | 331 | `d38a3a866d672f139f46374eee187c9a2e5712f68320b963ad6b368641da4794` | Original project vector |
| dealer.webp | 546×640 | 83360 | `628f4ae0514c03dddec9b96f18dfccbce51dd2ced2d3b19ac17ad97deb2c9112` | Built-in imagegen; Sharp export |
| felt.svg | 512×512 | 564 | `76706c773f9f8b10f14d36b978870720b5aaf61596b3e11d8cec8698a268df45` | Original project vector |
| rail.svg | 512×128 | 488 | `ed82dbd2e0dde8e7c2633519184a8a251e59193ff6e7db8d8861c58d11d26703` | Original project vector |
| room.webp | 1536×1024 | 430246 | `ae80e0e4dbe5d050e7690e19d581044f14c9a6a22ceca675352d7f0b75393149` | Built-in imagegen; Sharp export |

Package total: **515928 bytes**, within all room/dealer/surface/card/frame ceilings.


## Exact remaining-theme generation prompt set

### neon-vegas

Dealer edit:

> Use case: identity-preserve. Production high-quality transparent casino dealer sprite. Edit the supplied accepted dealer. Change ONLY garment and jewelry colors to violet satin gown, silver earrings with violet gems. Preserve exact adult woman face, brunette bob, expression, pose, silhouette, hands and card deck positions, canvas composition and proportions. Keep the same gathered high neckline and thin straps. Full continuous lower torso and gown must extend all the way to bottom edge, without horizontal cutoffs or transparent holes. No table, no room, no text. Genuine transparent background. Photoreal premium rendering, crisp natural detail.

Room generation:

> Use case: stylized-concept. Production high-quality photoreal casino room background, wide landscape 3:2 composition. modern luxurious Las Vegas penthouse casino lounge at night, violet cyan and magenta architectural neon, panoramic skyline, palm silhouettes, dark chrome furnishings. Match a premium poker game's sophisticated realistic cinematic art direction. Symmetrical centered view with quiet dark central lower space for an overlaid poker table and dealer. Rich material texture, restrained atmospheric lighting, coherent perspective. Empty room: NO people, NO dealer, NO poker table in foreground, NO cards, NO chips, NO UI, NO text or logos. Architecture and lighting only.

### midnight-sapphire

Dealer edit:

> Use case: identity-preserve. Production high-quality transparent casino dealer sprite. Edit the supplied accepted dealer. Change ONLY garment and jewelry colors to deep sapphire blue satin gown, silver earrings with sapphire gems. Preserve exact adult woman face, brunette bob, expression, pose, silhouette, hands and card deck positions, canvas composition and proportions. Keep the same gathered high neckline and thin straps. Full continuous lower torso and gown must extend all the way to bottom edge, without horizontal cutoffs or transparent holes. No table, no room, no text. Genuine transparent background. Photoreal premium rendering, crisp natural detail.

Room generation:

> Use case: stylized-concept. Production high-quality photoreal casino room background, wide landscape 3:2 composition. refined midnight blue casino salon, cool silver architecture, panoramic moonlit city windows, subtle diamond decorative geometry. Match a premium poker game's sophisticated realistic cinematic art direction. Symmetrical centered view with quiet dark central lower space for an overlaid poker table and dealer. Rich material texture, restrained atmospheric lighting, coherent perspective. Empty room: NO people, NO dealer, NO poker table in foreground, NO cards, NO chips, NO UI, NO text or logos. Architecture and lighting only.

### crimson-velvet

Dealer edit:

> Use case: identity-preserve. Production high-quality transparent casino dealer sprite. Edit the supplied accepted dealer. Change ONLY garment and jewelry colors to rich burgundy red satin gown, gold earrings with ruby gems. Preserve exact adult woman face, brunette bob, expression, pose, silhouette, hands and card deck positions, canvas composition and proportions. Keep the same gathered high neckline and thin straps. Full continuous lower torso and gown must extend all the way to bottom edge, without horizontal cutoffs or transparent holes. No table, no room, no text. Genuine transparent background. Photoreal premium rendering, crisp natural detail.

Room generation:

> Use case: stylized-concept. Production high-quality photoreal casino room background, wide landscape 3:2 composition. warm luxurious private casino salon, crimson velvet curtains, mahogany and antique gold architecture, warm lamps, elegant sculpture, understated damask. Match a premium poker game's sophisticated realistic cinematic art direction. Symmetrical centered view with quiet dark central lower space for an overlaid poker table and dealer. Rich material texture, restrained atmospheric lighting, coherent perspective. Empty room: NO people, NO dealer, NO poker table in foreground, NO cards, NO chips, NO UI, NO text or logos. Architecture and lighting only.

### emerald-palace

Dealer edit:

> Use case: identity-preserve. Production high-quality transparent casino dealer sprite. Edit the supplied accepted dealer. Change ONLY garment and jewelry colors to deep emerald green satin gown, gold earrings with emerald gems. Preserve exact adult woman face, brunette bob, expression, pose, silhouette, hands and card deck positions, canvas composition and proportions. Keep the same gathered high neckline and thin straps. Full continuous lower torso and gown must extend all the way to bottom edge, without horizontal cutoffs or transparent holes. No table, no room, no text. Genuine transparent background. Photoreal premium rendering, crisp natural detail.

Room generation:

> Use case: stylized-concept. Production high-quality photoreal casino room background, wide landscape 3:2 composition. opulent emerald palace casino salon, green marble and gold architecture, lush greenery, elegant arches and small distant fountain, warm daylight. Match a premium poker game's sophisticated realistic cinematic art direction. Symmetrical centered view with quiet dark central lower space for an overlaid poker table and dealer. Rich material texture, restrained atmospheric lighting, coherent perspective. Empty room: NO people, NO dealer, NO poker table in foreground, NO cards, NO chips, NO UI, NO text or logos. Architecture and lighting only.


## Current five-room perspective replacement — 2026-10-10

The room entries/package totals earlier in this historical record are superseded by [perspective.md](perspective.md), which records current1600×900 room hashes/bytes/budgets, reference measurements, output crop registration and exact built-in imagegen prompts. All non-room layers, Classic, JS and CSS stay byte-identical.

## Current corrected room inventory

This supersedes earlier room.webp entries and package totals in artwork.md; all other layers retain their earlier recorded hashes. Every room1600×900 WebP, built-in imagegen edit of its prior room with Classic used only as composition reference. No API key/third-party pack/remote runtime art. Existing Sharp WebPquality90; Royal generated1672×941 exported with aspect-preserving cover resize; other four generated1672×941 have a small final artwork registration crop(left36,top41,width1600,height900), encoded directly, with no stretch or runtime position change. OpenAI terms source remains artwork.md.

| Path | Dimensions | Bytes | SHA-256 | Current complete package bytes |
|---|---|---:|---|---:|
| poker/assets/themes/royal-gold/room.webp |1600×900|240382|`6d93b0be1a16e930d11f39f67e65adcae62bdbb47332f1e36cf3c2715a951835`|322687|
| poker/assets/themes/neon-vegas/room.webp |1600×900|259638|`c2bd1066ad93c36ab8c40dcb3f1d9ef6eb4bddc63c06f016907d732af3346afc`|345918|
| poker/assets/themes/midnight-sapphire/room.webp |1600×900|227082|`4cd9b4155595ec0a01ca909691a312b2f9d020669da3697a8f27fb7db67f1fb3`|311225|
| poker/assets/themes/crimson-velvet/room.webp |1600×900|202268|`b5c6292c87b782843b6f837a3e9fb163f62ce5412cd48e2793b7cf20769ed084`|284613|
| poker/assets/themes/emerald-palace/room.webp |1600×900|325826|`609424ba73b33f025a338156ccb66e2a5a63a7f3d7f1beb90e27830e439dc523`|411508|
