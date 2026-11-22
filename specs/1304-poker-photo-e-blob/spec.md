# Feature Specification: Poker Google photos

**Branch**: feat/1282-table-google-photo | **Source**: #1304 SpecKit v3 and OWNER GO

## User scenarios and acceptance

- An authenticated Arcade Hub user, including a spectator before Join, sees the selected Google photo for eligible participants who explicitly confirmed g4. Guests and anonymous Auth sessions see catalog avatars.
- An existing g2 or Stage g3 owner can explicitly confirm g4 for their own stored copy with revision protection and without reimport. Existing WWW access and withdrawal are preserved. Neither a flag change nor login changes an existing consent.
- A normal render, reconnect or foreground return with unchanged authorization and revision does not download the image again or flash the fallback.
- Client removes known-denied, changed or locally blocked images and releases images on sign-out, identity or table change, Leave and table closure. Obsolete responses cannot repopulate the presentation.

## Requirements

- **FR-001** One bounded authorized batch for at most nine human IDs. Poker enforces g4, current selection, moderation, bilateral block and deletion guards before signing and again after signing changed entries.
- **FR-002** Render only locally created Object URLs from immediate bounded CORS WebP downloads. No periodic polling, shared cache or persistent browser storage.
- **FR-003** Transient failures grant no new access and preserve the last authorized current presentation. Confirmed denial clears it. Remote withdrawal stops new issuance when recorded, while previously signed links may still work and already downloaded images may remain until reconciliation.
- **FR-004** g4 describes the full signed-in audience, transferable short-lived links, limits of withdrawing already delivered data and Poker-specific blocking. Cross-surface block parity is #1305.
- **FR-005** Preserve public WebSocket protocol and gameplay authority, Android native configuration and financial behavior.

## Success criteria

Under normal operation one image GET per needed viewer/target/version, zero renewals at signature expiry and zero image GET on unchanged revalidation. Actual CORS, device behavior and counters require T007 and separate OWNER GO.
