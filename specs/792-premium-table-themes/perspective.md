# Five room floor-plane corrections — 2026-10-10

Owner requested background-only correction on Draft PR#1076. Runtime scope is exactly five existing room.webp files; no CSS, JS, dealer, table surface, card, frame, Classic or geometry change. Baseline commit92c554e65cc0bf0788e1a7a5fd9cb7c3a96ac491.

## Measurements and selected composition

Classic source1600×900; alternatives formerly1536×1024. Floor-wall junctions were estimated visually at the central rear plane (±20sourcepx before, ±10px after); this junction is **not the optical horizon**. Rendering bounds/center-cover mapping are measured exactly. No source camera/lens/physical dimensions exist, so this is art registration and composite review rather than recovered physical camera calibration or a mathematically unique optimum.

Center-cover projection: scale=max(viewWidth/imageWidth,viewHeight/imageHeight); offsetY=(viewHeight-imageHeight×scale)/2; renderedFloorY=sourceFloorY×scale+offsetY.

Classic rear-floor row350/900≈38.9% projects to≈328px portrait,142px landscape,350px desktop. Royal old centralrow was already close toClassic (338/139/354px), so its remaining visual issue involves architectural scale/depth and exaggerated near columns/reflections, not a row/aspect-ratio explanation alone. Neon/Sapphire rear boundaries were lower, Crimson/Emerald much lower, and foreground oval rings/steps further competed with the overlaid table.

Royal first edit was inspected at390×844,844×390,1440×900 before generating other variants. Selected final16:9 composition uses≈34–36% rear-floor position, restrained distant furniture/columns/reflections and a continuous receding foreground floor. Floor covers≈64–66% of artwork. Near oval rugs/rings and raised platforms removed; Emerald distant fountain steps remain in the far architectural feature, outside the playing foreground. Hand-height suggestion was treated as a visual guide, not imposed as one pixel row across different responsive crops.

| Theme | Before source floor row | After source floor row | Portrait before→after | Landscape before→after | Desktop before→after |
|---|---:|---:|---:|---:|---:|
| royal-gold | ~410/1024 | ~315/900 | ~338→295px | ~139→124px | ~354→315px |
| neon-vegas | ~465/1024 | ~310/900 | ~383→291px | ~169→121px | ~406→310px |
| midnight-sapphire | ~475/1024 | ~320/900 | ~392→300px | ~175→126px | ~415→320px |
| crimson-velvet | ~600/1024 | ~320/900 | ~495→300px | ~243→126px | ~533→320px |
| emerald-palace | ~565/1024 | ~315/900 | ~466→295px | ~224→124px | ~500→315px |

## Validation

Local before/after Chromium:18scenes (six choices×three viewports),18protected bounds exactly equal, card text unchanged, no page errors/overflow; background-position and background-size remain identical. SHA audit: only five rooms changed;33inventoried non-room files byte-identical (JS/CSS/Classic/dealers/vectors included). Existing syntax exits0; CSP guard52documents passes. No maintained UI/glue suite added. Native composite inspection checks furniture-floor contact cues, dealer/table grounding, style, readability and unobstructed foreground. Independent/exact Preview evidence in review.md. Earlier authenticated dealing/showdown/reconnect limitations remain; this correction does not change those paths.

## Current corrected room inventory

This supersedes earlier room.webp entries and package totals in artwork.md; all other layers retain their earlier recorded hashes. Every room1600×900 WebP, built-in imagegen edit of its prior room with Classic used only as composition reference. No API key/third-party pack/remote runtime art. Existing Sharp WebPquality90; Royal generated1672×941 exported with aspect-preserving cover resize; other four generated1672×941 have a small final artwork registration crop(left36,top41,width1600,height900), encoded directly, with no stretch or runtime position change. OpenAI terms source remains artwork.md.

| Path | Dimensions | Bytes | SHA-256 | Current complete package bytes |
|---|---|---:|---|---:|
| poker/assets/themes/royal-gold/room.webp |1600×900|240382|`6d93b0be1a16e930d11f39f67e65adcae62bdbb47332f1e36cf3c2715a951835`|322687|
| poker/assets/themes/neon-vegas/room.webp |1600×900|259638|`c2bd1066ad93c36ab8c40dcb3f1d9ef6eb4bddc63c06f016907d732af3346afc`|345918|
| poker/assets/themes/midnight-sapphire/room.webp |1600×900|227082|`4cd9b4155595ec0a01ca909691a312b2f9d020669da3697a8f27fb7db67f1fb3`|311225|
| poker/assets/themes/crimson-velvet/room.webp |1600×900|202268|`b5c6292c87b782843b6f837a3e9fb163f62ce5412cd48e2793b7cf20769ed084`|284613|
| poker/assets/themes/emerald-palace/room.webp |1600×900|325826|`609424ba73b33f025a338156ccb66e2a5a63a7f3d7f1beb90e27830e439dc523`|411508|

## Exact built-in imagegen edit prompts

### royal-gold

Generated original SHA-256 `e8b6a7ca0340e08697e1b5bba72f50207b2355abd8f47700a882ae77aca31c5a`; optimized local path is in the inventory above. Inputs: Classic composition reference and that theme’s pre-correction room edit target.

> Use case: precise-object-edit. High-quality production room background perspective correction for a poker game. Input image 1 is Classic Casino, ONLY the composition/camera/floor-plane reference. Input image 2 is the existing themed room to EDIT, preserve its distinctive architecture, palette, materials and lighting. Output a wide 16:9 1600x900 background. Correct the camera/composition so a seated player slightly looking down at an overlaid poker table sees a broad, continuous near floor. Match Classic's grounded camera and architectural scale; move the distant architecture higher in the artwork, reduce towering wall height, shorten exaggerated reflection lengths. Rear wall/window bottoms meet floor around y=315 of900 (35% from top; acceptable33–36%). Bottom65% is an uninterrupted receding dark floor plane. Floor lines converge coherently toward the centered upper-third distance. Distant furniture/pillars must sit firmly on the same floor. Do not add nearby raised platforms, steps, giant circular/oval rugs or ring outlines; they misregister against the overlaid table. Preserve premium crisp realistic detail, restrained reflections, visual quiet foreground. No people, dealer, poker table, cards, chips, UI, letters or logos. Change the room perspective, not its theme identity. Theme to preserve: Royal Gold, warm black-marble/gold Art Deco salon, chandeliers, gold columns and arched nighttime city windows.

### neon-vegas

Generated original SHA-256 `61e8ccd2d7e0d189b47b847ef9bf08763611e2d1d80aed5f2db32643907e1559`; optimized local path is in the inventory above. Inputs: Classic composition reference and that theme’s pre-correction room edit target.

> Use case: precise-object-edit. High-quality production room background perspective correction for a poker game. Input image 1 is Classic Casino, ONLY the composition/camera/floor-plane reference. Input image 2 is the existing themed room to EDIT, preserve its distinctive architecture, palette, materials and lighting. Output a wide 16:9 1600x900 background. Correct the camera/composition so a seated player slightly looking down at an overlaid poker table sees a broad, continuous near floor. Match Classic's grounded camera and architectural scale; move the distant architecture higher in the artwork, reduce towering wall height, shorten exaggerated reflection lengths. Rear wall/window bottoms meet floor around y=315 of900 (35% from top; acceptable33–36%). Bottom65% is an uninterrupted receding dark floor plane. Floor lines converge coherently toward the centered upper-third distance. Distant furniture/pillars must sit firmly on the same floor. Do not add nearby raised platforms, steps, giant circular/oval rugs or ring outlines; they misregister against the overlaid table. Preserve premium crisp realistic detail, restrained reflections, visual quiet foreground. No people, dealer, poker table, cards, chips, UI, letters or logos. Change the room perspective, not its theme identity. Theme to preserve: Neon Vegas: modern violet/cyan/magenta neon penthouse casino, nighttime Vegas skyline/palm silhouettes, chrome/dark marble. Retain neon identity and architectural lighting; no warm-gold Classic style transfer.

### midnight-sapphire

Generated original SHA-256 `f10b76af83eef4ec52e4f91484b0fa166929b6508b1aa114b6e56bdda8f05171`; optimized local path is in the inventory above. Inputs: Classic composition reference and that theme’s pre-correction room edit target.

> Use case: precise-object-edit. High-quality production room background perspective correction for a poker game. Input image 1 is Classic Casino, ONLY the composition/camera/floor-plane reference. Input image 2 is the existing themed room to EDIT, preserve its distinctive architecture, palette, materials and lighting. Output a wide 16:9 1600x900 background. Correct the camera/composition so a seated player slightly looking down at an overlaid poker table sees a broad, continuous near floor. Match Classic's grounded camera and architectural scale; move the distant architecture higher in the artwork, reduce towering wall height, shorten exaggerated reflection lengths. Rear wall/window bottoms meet floor around y=315 of900 (35% from top; acceptable33–36%). Bottom65% is an uninterrupted receding dark floor plane. Floor lines converge coherently toward the centered upper-third distance. Distant furniture/pillars must sit firmly on the same floor. Do not add nearby raised platforms, steps, giant circular/oval rugs or ring outlines; they misregister against the overlaid table. Preserve premium crisp realistic detail, restrained reflections, visual quiet foreground. No people, dealer, poker table, cards, chips, UI, letters or logos. Change the room perspective, not its theme identity. Theme to preserve: Midnight Sapphire: refined navy/sapphire salon, cool silver diamond geometry, moonlit skyline/water view. Retain cool blue/silver identity; no warm-gold Classic style transfer.

### crimson-velvet

Generated original SHA-256 `9ac89d6e1f3fd71d7e191ac14f47d4d8d435250a5032c3ea74fb73e193e689cb`; optimized local path is in the inventory above. Inputs: Classic composition reference and that theme’s pre-correction room edit target.

> Use case: precise-object-edit. High-quality production room background perspective correction for a poker game. Input image 1 is Classic Casino, ONLY the composition/camera/floor-plane reference. Input image 2 is the existing themed room to EDIT, preserve its distinctive architecture, palette, materials and lighting. Output a wide 16:9 1600x900 background. Correct the camera/composition so a seated player slightly looking down at an overlaid poker table sees a broad, continuous near floor. Match Classic's grounded camera and architectural scale; move the distant architecture higher in the artwork, reduce towering wall height, shorten exaggerated reflection lengths. Rear wall/window bottoms meet floor around y=315 of900 (35% from top; acceptable33–36%). Bottom65% is an uninterrupted receding dark floor plane. Floor lines converge coherently toward the centered upper-third distance. Distant furniture/pillars must sit firmly on the same floor. Do not add nearby raised platforms, steps, giant circular/oval rugs or ring outlines; they misregister against the overlaid table. Preserve premium crisp realistic detail, restrained reflections, visual quiet foreground. No people, dealer, poker table, cards, chips, UI, letters or logos. Change the room perspective, not its theme identity. Theme to preserve: Crimson Velvet: burgundy velvet curtains, mahogany/antique gold private salon, warm lamps and the elegant sculpture niche. Reduce wall/niche scale to distant furnishings, all floor level, no platform.

### emerald-palace

Generated original SHA-256 `fe4209dfc22031e6221e547f2c24cc4a2996257248764019d95ea6eb138d7106`; optimized local path is in the inventory above. Inputs: Classic composition reference and that theme’s pre-correction room edit target.

> Use case: precise-object-edit. High-quality production room background perspective correction for a poker game. Input image 1 is Classic Casino, ONLY the composition/camera/floor-plane reference. Input image 2 is the existing themed room to EDIT, preserve its distinctive architecture, palette, materials and lighting. Output a wide 16:9 1600x900 background. Correct the camera/composition so a seated player slightly looking down at an overlaid poker table sees a broad, continuous near floor. Match Classic's grounded camera and architectural scale; move the distant architecture higher in the artwork, reduce towering wall height, shorten exaggerated reflection lengths. Rear wall/window bottoms meet floor around y=315 of900 (35% from top; acceptable33–36%). Bottom65% is an uninterrupted receding dark floor plane. Floor lines converge coherently toward the centered upper-third distance. Distant furniture/pillars must sit firmly on the same floor. Do not add nearby raised platforms, steps, giant circular/oval rugs or ring outlines; they misregister against the overlaid table. Preserve premium crisp realistic detail, restrained reflections, visual quiet foreground. No people, dealer, poker table, cards, chips, UI, letters or logos. Change the room perspective, not its theme identity. Theme to preserve: Emerald Palace: green marble/gold arches, greenery, elegant distant fountain and warm daylight. Retain jade green palace identity. Far fountain sits beyond continuous floor; no steps/stairs/raised thresholds in foreground.


## Exact published Preview

Runtime revision223c28f81fa95b70f315f9458fd1995bce0e792c verified by BUILD_INFO at all three targets. Deploy6aca08a2088aa40008a37866; stable URL https://6aca08a2088aa40008a37866--playkcswh.netlify.app/poker/table-v2.html . All18scenes/18protected bounds match original before correction; cards, cover sizing/position unchanged, no page errors/overflow. Five served room SHA-256/bytes match current inventory. Commit file listing proves runtime changes are limited to five room images; all other changed paths are feature docs. Final review found no critical/important issue. Netlify’s external collaboration drawer can overlay screenshot bottom; it is separate from the unchanged application controls/geometry.

Temporary evidence: /tmp/1076-perspective-before.json, /tmp/1076-perspective-local-before.json, /tmp/1076-perspective-local-after.json, /tmp/1076-perspective-remote-after.json, /tmp/1076-floor-preview-hashes.json, native before/after screenshots. Follow-up documentation commit does not alter deployable artifacts. Draft stays; prior manual authenticated live checks remain pending.

CI note: unchanged ws-harness initially failed one cleanup assertion; retry workflow38042366627 attempt2 succeeded without source changes. See review.md for exact failure/rerun record.
