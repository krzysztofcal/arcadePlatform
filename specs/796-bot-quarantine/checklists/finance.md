# Reviewer checklist — finanse i runtime #1018

Checkboxy należą do niezależnego reviewera; nie są stanem wykonania implementacji.

- [ ] CHK001 Czy lazy threshold/sticky state i brak USER są jednoznaczne? [FR-001/002]
- [ ] CHK002 Czy odmowa JOIN może zatwierdzić restriction bez seat/buy-in i bez fałszywego has_human_participant? [FR-003/006]
- [ ] CHK003 Czy klasy empty/mixed/Resume i concurrent admissions są jednoznaczne? [FR-003]
- [ ] CHK004 Czy seed,managed seed,replacement,topup mają wspólny gate wszystkich seated humans? [FR-004]
- [ ] CHK005 Czy odmowa nie utrwala funded candidate i nie przerywa payout? [FR-005/006/009]
- [ ] CHK006 Czy NORMAL-only nadal otrzymuje autorefill mimo RESTRICTED gdzie indziej, bez lifetime cap? [FR-007]
- [ ] CHK007 Czy mint+funding+receipt i retention dają exactly-once oraz rollback całej operacji? [FR-008]
- [ ] CHK008 Czy refill jest krótką bounded częścią wyłącznie nowego funding, bez logicznej zależności payout i bez obietnicy FIFO preemption? [FR-009]
- [ ] CHK009 Czy CONTINUOUS_BOT i minimalne matchmaking zachowane? [FR-010/011]
- [ ] CHK010 Czy wspólne TREASURY jest blokowane od fresh deficit do atomic debit, a RESTRICTED nie powoduje ani nie otrzymuje nowych bot CH? [research R4]
- [ ] CHK011 Czy tylko fundamentalne testy i zasady JSP/klog/CSP/CSS? [FR-012]
- [ ] CHK012 Czy Stage apply,forward-only,exact-SHA preview i osobny GO są jawne? [FR-013]
- [ ] CHK013 Czy #869 porównano bez dziedziczenia EXPOSURE/90:10/drain? [FR-014]
