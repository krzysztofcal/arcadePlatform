# Original lobby artwork — design review #1069

Created 2026-10-10 using the built-in `image_gen` tool (imagegen skill). Five independent original images; no supplied/commercial screenshot, character or third-party art used as input. Each source was generated at 1024×1536; exported via existing sharp to 768×1152 WebP, quality 86, versioned filenames. Sources remain in the session generated_images directory; the five project assets are committed here. Six Cosmetics themes are existing repository art from merged #1076/#792, referenced without duplication.

## Shared prompt
Use case: game concept illustration. Create one finished premium cinematic poker lobby tile artwork, portrait 2:3 composition, high end detailed 3D painterly game key art, beautifully controlled lighting, rich saturated navy/purple shadows, restrained gold accents, realistic luxurious materials. Main subject occupies central upper 70 percent; lower 25 percent transitions to clean dark navy shadow for HTML title overlay. Edge-to-edge artwork only, no border, no UI, absolutely no text, no logos, no watermark, no currency symbols. Original art, no commercial game copied.

## Individual scene prompts
- `art/online-v1.webp`: A lavish midnight poker salon, foreground dramatically foreshortened emerald velvet poker table, exquisite gold and purple chip stacks, two elegant playing cards, background arched Art Deco windows and purple chandelier glow. No humans. Gold and emerald main lighting.
- `art/single-v1.webp`: An original sophisticated humanoid robot poker opponent, brushed obsidian and gold face, violet luminous eyes, tailored midnight tuxedo, seated at a purple felt poker table with two cards and chips. Stylish charming face not sinister, no resemblance to known characters. Violet and pink lighting.
- `art/world-v1.webp`: A cinematic globe-like composition of original miniature world travel architecture above a poker table: Paris iron tower, Asian pavilion, Venetian palazzo, distant tropical coast, glowing golden orbital arc, blue twilight and teal atmospheric haze. Elegant travel adventure with poker chips in foreground.
- `art/seasons-v1.webp`: An enchanted poker garden with a central luminous crystal tree transitioning naturally between four seasons: snow and blue frost on left, pink spring blossoms, lush summer greenery, amber autumn leaves on right. Emerald poker table and elegant chips foreground, rich jewel toned atmospheric depth.
- `art/sitgo-v1.webp`: A magnificent original Art Deco gold trophy with sculptural spade motif in a midnight purple tournament salon, red velvet poker table foreground, elegant gold and crimson chips, spotlights and blurred empty tournament tables receding into distance. Crimson, violet and warm gold lighting.

HTML supplies labels/status/action copy separately; artwork is decorative, not a source for readable game cards or ranks. No illustration claims prizes, existing tournament availability or ownership. No third-party attribution/license claim is invented. Owner visual acceptance remains pending.

## Revision v2 — mobile arcade direction (active assets)

Owner rejected the editorial/stately v1 visual direction in PR #1078 review. Active pages now use five new `art/*-v2.webp` illustrations plus `art/bonus-v2.webp`; v1 source exports remain as historical review assets and are not loaded. Generated using built-in `image_gen`, no third-party/reference-image input. Source images remain under the session generated_images path; committed optimized WebP assets are the project deliverables. Five tiles exported at 768×1152, quality 87; bonus icon at 384×384, preserving generated alpha transparency. No image library/dependency added.

Shared v2 prompt: Original premium mobile arcade poker game key art, portrait 2:3, glossy 3D subjects with convincing materials, saturated electric blue/violet/hot magenta/bright gold, strong rim lights, luminous bokeh and dramatic depth; large centered subject in upper two-thirds, darker saturated lower quarter for separate HTML text. No numbers, letters, currency, logos, watermark or UI frame; no commercial-game art/characters copied.

- `online-v2.webp`: Floating fan of elegant poker cards with decorative spade symbols, towering glossy emerald/gold chips on a sapphire table, purple casino arches, cyan/gold light trails. No chip numbers or monetary markings.
- `single-v2.webp`: Original friendly humanoid poker robot, violet suit, chrome face/cyan eyes, leaning over cards and magenta chips; rich purple/pink casino bokeh and full head visible, no known franchise.
- `world-v2.webp`: Glossy blue globe/gold orbit and original miniature travel landmarks: Asian pavilion, Venetian palazzo, Paris iron tower, tropical palms; violet/teal poker chips, sapphire casino background, orange/cyan lighting. No flags/text.
- `seasons-v2.webp`: Luminous 3D tree merging icy cyan snow, bright pink spring flowers, emerald summer foliage/sunshine and orange autumn leaves, polished blue/gold poker chips and violet environment.
- `sitgo-v2.webp`: Large glossy gold spade-crown trophy and blank sculptural ribbons, ruby/purple poker chips, violet/red stage, gold/cyan lights and pink bokeh. No prize amount.
- `bonus-v2.webp`: Original glossy 3D decorative violet gift box with chunky gold ribbon, emerald inner glow, slightly open floating lid, cyan/magenta rim lights and small sparkles; transparent background. No coins/chips/diamonds/currency/reward numbers/text/logos. This icon is decorative, not a configured reward.

Actual Cosmetics sources are referenced directly from `poker/assets/themes/<id>/` (room, dealer, rail, felt, face/back/frame); Classic uses existing scene/default styles. No theme screenshots or generic gold/green substitutions; preview composition is intentionally simple and not a second table renderer. Six packages are FREE per amended #800/#1070/#1072. Illustrative Auto state uses a labeled Neon Vegas sample without shipping gameplay randomness.
