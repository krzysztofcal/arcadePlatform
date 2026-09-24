# Browser-local data

- Celebration selection: `{kind: royal|pot|streak, userId, cards?, amount?, count?}` from a valid newly observed same-hand settlement. Royal cards are the exact verified best five from legally visible cards. Pot amount is that user's safe-integer main/side award sum, never total pot or net profit. A streak count is local to the uninterrupted browser session.
- Celebration transition cursor: last table/hand, highest accepted version and consumed result flag, transient per page; initial/recovery result never plays.
- Win Streak cursor: page-memory `tableId`, viewer/seat identity, per-user count, last result/version and seen hand IDs. Invalid or out-of-order results clear counts. No history reconstruction, localStorage/sessionStorage or server counter.
- Active FX: demo flag, table/hand, end timestamp, exit/deemphasis state and optional compact anchor identity (`userId + seatNo`); one overlay, one timer at a time, no queue. Hero 1600 ms plus a 400 ms decorative exit; unsafe compact placement may end sooner through a short fade, never later.
- Preview target: transient selected `userId` from currently visible nonlocal seats. Preserve only while that same seat remains available; stale selection becomes empty and never falls through to another opponent.
- Preferences: existing authenticated `kcswh:poker-social-preferences:v1:<userId>` adds default-true `celebrationsEnabled`. Guest-only `kcswh:poker-celebrations:guest:v1` stores the Boolean without persisting unrelated guest social preferences.
