# Poker Guest Mode PR2 Implementation Plan

## Goal
Make guest poker feel explicit and bounded: guests can play, but they clearly see that the session is temporary and isolated from Arcade economy features.

## Scope for PR2
- Show a persistent guest limitations panel on the poker table.
- Hide the XP badge while guest mode is active.
- Keep the guest badge visible so the session state is obvious.
- Preserve authenticated poker flow unchanged.
- Add focused tests for the guest UI state and guest session flow.

## Implementation Steps
1. Add guest restrictions markup to `poker/table-v2.html`.
2. Style the guest panel in `poker/poker-v2.css`.
3. Toggle guest-specific UI state in `poker/poker-v2.js`.
4. Extend the poker v2 behavior harness to cover guest mode.
5. Add a static HTML/CSS contract check for the new panel.

## Validation
- Guest mode still auto-joins the token-bound guest table.
- XP badge is hidden in guest mode.
- Guest restrictions panel is visible in guest mode.
- Authenticated poker behavior remains unchanged.

## Notes
- This PR does not change the backend guest-session contract.
- This PR does not introduce a new economy path for guest chips.
- Breaking impact expected: none.
