# Tasks #1054

- [x] T001 Cross-hand inactivity regression
- [ ] T002 Settled fresh-JOIN rollover regression
- [ ] T003 Trace existing scheduling and persistence ownership
- [x] T004 Preserve missed-turn evidence across hand boundaries
- [ ] T005 Fix only the proven rollover ownership defect
- [ ] T006 Remove false rebuy presentation for ordinary fresh JOIN waiting
- [ ] T007 Focused verification
- [ ] T008 Exact-SHA runtime verification
- [ ] T009 Final review

T002 can follow T003 investigation if the existing fixture cannot reproduce the real stall. T006 is separate #1049 browser work; runtime changes remain here.

T004 currently proves the two requested reducer mirrors only. Canonical WS engine-path reconciliation and T002/T003/T005 remain unresolved; this is not runtime-ready.
