# Presentation data — browser only

## TABLE_THEME_CATALOG (planned)

Exactly six entries. `id` is one of `classic-casino`, `royal-gold`, `neon-vegas`, `midnight-sapphire`, `crimson-velvet`, `emerald-palace`; `label` is the matching owner-facing name. A non-default entry lists required room/dealer/rail/felt/card-face/card-back/avatar-frame local asset paths under `/poker/assets/themes/<id>/`. Classic explicitly references current assets/treatment and clears alternative overrides. Entries contain no price, country, season schedule, account, entitlement, tier or WS fields.

## Page-lifetime selection (planned)

`previewThemeId`: defaults to `classic-casino`; changes only after requested art is ready. Pending request token: increasing page-local value; older asynchronous requests cannot commit. Theme chooser status communicates loading, applied or failed. No durable storage. Reload restores Classic.

## Artwork manifest

`artwork.md` records file path, purpose, origin/reference, commercial usage terms source, dimensions, encoded bytes, hash and registration notes. Generated concepts are approval material, not a licensed third-party art catalog or final export atlas.

## Approval record

`approval.md` records the owner's decision and reviewed artifacts/revision. Pending is the initial state; only an explicit owner acceptance permits T007 onward.
