# Owner approval — #792

Status: **Approved for implementation** on 2026-10-10. Owner accepted the six visual directions and SpecKit presented in Draft PR #1076 (reviewed gallery revision `447eafbd1de24e4b8fd9935bad6019289a6762a4`, SpecKit HEAD `bc1ed09aeee984b7d801c080970c57f4c4adbf3f`). T006 is complete; T007–T017 are authorized.

Approved directions: Classic Casino, Royal Gold, Neon Vegas, Midnight Sapphire, Crimson Velvet, Emerald Palace. Preserve shipped Classic as default, including its existing dealer and cards. The five alternatives use one consistent dealer character with theme-specific dress, optional hair styling and lighting; do not change the existing pose, face/hand registration, card-flight origin, seats or layout.

**Implementation checkpoint:** First produce a complete Royal Gold package, including the final dealer illustration, on the real Poker V2 table in Deploy Preview for owner visual inspection. Do not generate all remaining dealer variants before this checkpoint is accepted. Then finish all six theme packages and local switching through the existing Preview FX according to `spec.md`, `plan.md` and `tasks.md`.

This is visual/technical approval to proceed, **not** acceptance of final artwork or runtime feature verification, merge approval or Production authorization. Keep the PR Draft until final validation and review.

Owner checkpoint feedback: overall Royal Gold direction liked; replace the high-neck dealer outfit with the exact V-neck gold strappy dress already approved in the design. Owner explicitly authorized direct extraction from the design and deterministic upscaling. Corrected checkpoint acceptance remains pending; other dealer variants remain gated.

**Latest owner instruction (supersedes the extraction correction):** Owner rejected the extracted/upscaled dealer as unacceptable and explicitly requested restoring the earlier high-quality imagegen dealer. Restore that exact export, including its high gathered neckline; do not retain the extracted sprite or generate another wardrobe variant in this correction. Full Royal Gold checkpoint acceptance remains pending.

**Latest owner feedback:** Restored high-quality dealer direction is acceptable; user screenshot shows the torso ending before the rail hides it. Owner requests a new high-quality imagegen sprite with a fuller lower torso/dress so the existing rail can occlude it. Preserve current identity, outfit, hand/deck registration and layout; fix the garment continuation and necessary foreground masking. This supersedes retaining the truncated asset unchanged; final repaired checkpoint inspection remains pending.

## Remaining themes authorized — 2026-10-09

Owner accepted the fuller generated Royal Gold dealer and its rail occlusion: “Super, to teraz implementuj pozostale motywy na tym samym pr.” RG06 is satisfied. Complete Neon Vegas, Midnight Sapphire, Crimson Velvet and Emerald Palace on Draft PR #1076 using the accepted full-torso Royal Gold identity/pose as the dealer reference.

## Background perspective correction authorized — 2026-10-10

Owner reported a floating table/dealer impression in all five alternatives, contrasted with Classic, and explicitly requested measuring perspective and modifying only room graphics. No table/dealer/other element movement authorized. This authorizes background edits on the same PR; no new layout/design scope or Production action. Result and chosen image proportions are documented in perspective.md.
