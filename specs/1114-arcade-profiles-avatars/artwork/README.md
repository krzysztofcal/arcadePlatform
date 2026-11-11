# Avatar concepts — owner visual review

2026-10-26. Status: OWNER ACCEPTED. Local phase A exports prepared; no deployment.

File: [avatars-contact-sheet-v1.png](avatars-contact-sheet-v1.png). One contact sheet with16 numbered concepts, reading left-to-right and top-to-bottom. Items01–06 preserve existing variant IDs;07–16 are accepted additions, not yet deployed values.

| No. | Variant | Concept |
|---|---|---|
|01|comet-blue|Cyan comet astronaut|
|02|falcon-orange|Orange falcon|
|03|fox-blue|Blue fox|
|04|nova-purple|Purple cosmic creature|
|05|orbit-green|Green orbital robot|
|06|panda-pink|Panda with pink headphones|
|07|raven-violet|Violet raven|
|08|tiger-gold|Golden tiger|
|09|wave-cyan|Cyan axolotl|
|10|wizard-indigo|Indigo wizard|
|11|bolt-yellow|Yellow lightning robot|
|12|rocket-red|Red space pilot|
|13|ace-silver|Silver knight|
|14|ember-coral|Coral flame sprite|
|15|pixel-teal|Teal arcade-console robot|
|16|zen-lime|Lime seedling sprite|

Generated with built-in image_gen, followed by one targeted correction of concept16. No external stock images or franchise references were supplied. This is provenance information, not legal/IP clearance or owner acceptance.

Owner accepted01–15 unchanged and16 `zen-lime` as the original green leaf creature. The purple-bandana turtle is rejected and is not exported.

Sixteen separate native256×256 WebP files are in `assets/avatars/arcade/`. Native crops preserve the approved faces without redraw or upscaling and exclude board labels; the contact sheet itself is never shipped as an avatar. WebP quality90: **240002 bytes total**, largest17752 bytes. `export-receipt.json` records each stable ID, source rectangle, dimensions, byte count and SHA256. `size-review.png` shows final exported files at24/48/256px (nearest-neighbor review). All16 were visually inspected together; fine badge decoration is naturally reduced at24px, faces remain distinguishable. Source provenance does not replace final IP/legal review.

## Generation prompt

Use case: stylized-concept. Asset type: ONE owner-review contact sheet, not production sprites. Create a polished 4 by 4 contact sheet containing exactly SIXTEEN distinct static pixel-art gaming avatar concepts for Arcade Hub / Arcade Poker, numbered 01–16 in reading order. This is a coherent avatar FAMILY for a shared web and Android app, not a poker-only casino theme. Dark midnight navy presentation background, subtle cyan and violet Arcade accents, perfectly regular spacious grid. Each avatar is a bold centered head-and-shoulders or head-only portrait on its own simple dark circular badge, identical framing, scale and pixel density, crisp deliberate square pixels as if a 48x48 or 64x64 game sprite enlarged with nearest-neighbor. Limited 4–6 shade palettes per character, strong readable silhouettes and large expressive eyes readable at 24px. Premium friendly retro arcade feel, not glossy vector, not 3D, not photorealistic. No chips, playing cards, money, casino symbols, copyrighted characters, gore or adult content. Minimize tiny decorative details. Backgrounds inside badges stay simple so the characters read clearly.

Six legacy variant IDs must retain these exact labels and color identities. Subjects are new design proposals:
01 comet-blue: blue/cyan astronaut with a simple comet-shaped helmet crest and friendly dark visor;
02 falcon-orange: confident orange falcon head with cream face, dark beak, simple aviator silhouette;
03 fox-blue: distinctive blue fox with tall ears, white muzzle and bright cyan eyes;
04 nova-purple: small purple cosmic alien with a star-like forehead marking, broad friendly face;
05 orbit-green: round green robot with an orbital antenna and warm single large eye;
06 panda-pink: black-and-white panda wearing simple pink headphones.

Ten additional proposed designs:
07 raven-violet: violet raven with a pale beak and sharp but friendly silhouette;
08 tiger-gold: gold tiger with simple dark stripes and cream muzzle;
09 wave-cyan: cyan axolotl with three bold gills on each side, simple face;
10 wizard-indigo: indigo hooded wizard, silver eyebrows and tiny teal gem;
11 bolt-yellow: yellow angular lightning robot with two clear dark square eyes;
12 rocket-red: red retro space pilot helmet, white central stripe and warm face;
13 ace-silver: silver armored knight with a clean T-shaped dark visor and blue accent;
14 ember-coral: coral/red small flame spirit, broad smiling face and three flame tufts;
15 pixel-teal: teal handheld arcade-console robot face with simple screen eyes;
16 zen-lime: lime green turtle with a calm face and small purple bandana.

Typography: small clean readable neutral text below EACH badge, separate from artwork; show its 2-digit number and EXACT lowercase variant ID. Do not add a big title or marketing copy. Do not repeat characters. Exactly four rows and four columns, all sixteen fully visible, no cropped badges. Allow a generous margin and label spacing. Large square presentation board suitable for carefully reviewing all designs side by side. The existing six variants are the first six only; all others are proposals. No implementation UI or buttons.

## Targeted final correction prompt

Edit this owner-review contact sheet. Change ONLY avatar 16 zen-lime, in the bottom-right cell. Replace the green turtle wearing purple bandana with an original lime-green peaceful forest seedling sprite: rounded friendly moss/leaf face, three broad simple leaves forming a little crown, two large dark eyes, tiny calm smile, minimal teal shaded shoulders. No turtle shell, no bandana, no martial arts or recognizable franchise design. Keep the exact same pixel-art style, size, framing and circular dark badge. Preserve the exact label '16 zen-lime', its position and color. All other fifteen avatars, all fifteen labels, layout, typography, spacing, colors and board background must remain unchanged. This is a single-cell correction, not a redesign.

