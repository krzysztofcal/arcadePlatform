# Browser-local data

- Celebration selection: `{kind: royal|pot, userId, cards?}` from valid same-hand settlement; pot amount is gross contested award, never profit.
- Transition cursor: last table/hand, highest accepted version and consumed result flag, transient per page; initial/recovery result consumes without playing. No persisted history or streak.
- Active FX: demo flag, table/hand, end timestamp and exiting flag; one timer, no queue.
- Preferences: existing authenticated `kcswh:poker-social-preferences:v1:<userId>` adds default-true `celebrationsEnabled`. Guest-only `kcswh:poker-celebrations:guest:v1` stores the Boolean without persisting unrelated guest social preferences.
