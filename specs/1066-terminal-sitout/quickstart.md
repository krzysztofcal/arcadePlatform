# Validation
Run the focused node tests listed in plan.md, then existing repo checks. No DB credentials are required for the regression harness.
Expected fixture: human receives 940, proven bot source receives 710+1350, escrow becomes zero, table CLOSED once. Existing financial invariant failure cases remain green.
After Draft PR, use WS Preview Deploy with workflow ref main and exact runtime SHA; verify its result/release. No automatic Production deploy; leave incident table untouched. Physical/authenticated runtime acceptance may be owner-run and remains pending.
