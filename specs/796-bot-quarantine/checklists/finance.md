# Reviewer checklist — finanse i runtime #1018

Checkboxy należą do niezależnego reviewera; nie są stanem wykonania implementacji.

- [ ] CHK001 Czy lazy threshold/sticky state i brak USER są jednoznaczne? [FR-001/002]
- [ ] CHK002 Czy odmowa JOIN może zatwierdzić restriction bez seat/buy-in i bez fałszywego has_human_participant? [FR-003/006]
- [ ] CHK003 Czy ordinary/prefunded/CONTINUOUS_BOT odmawia RESTRICTED, farmer-only odmawia NORMAL, istniejący rejoin jest zachowany i first farmer ma existing Create? [FR-003]
- [ ] CHK004 Czy seed,managed seed,replacement,topup/refill mają wspólny gate is_farmer_only=false i wszystkich seated humans,bez resetu po leave/restart? [FR-004]
- [ ] CHK005 Czy odmowa nie utrwala funded candidate i nie przerywa payout? [FR-005/006/009]
- [ ] CHK006 Czy NORMAL-only nadal otrzymuje autorefill mimo RESTRICTED gdzie indziej, bez lifetime cap? [FR-007]
- [ ] CHK007 Czy existing funding key/hash/registry daje exactly-once bez nowej tabeli receipt; typed MINT ma7d/30d/missing-table lifecycle,a closed/deleted/stale plan po cleanup nie mintuje ponownie? [FR-008]
- [ ] CHK008 Czy refill jest krótką bounded częścią wyłącznie nowego funding, bez logicznej zależności payout i bez obietnicy FIFO preemption? [FR-009]
- [ ] CHK009 Czy CONTINUOUS_BOT i minimalne matchmaking zachowane? [FR-010/011]
- [ ] CHK010 Czy wspólne TREASURY jest blokowane od fresh deficit do atomic debit, a RESTRICTED nie powoduje ani nie otrzymuje nowych bot CH? [research R4]
- [ ] CHK011 Czy tylko fundamentalne testy i zasady JSP/klog/CSP/CSS? [FR-012]
- [ ] CHK012 Czy Stage apply,forward-only,exact-SHA preview i osobny GO są jawne? [FR-013]
- [ ] CHK013 Czy #869 porównano bez dziedziczenia EXPOSURE/90:10/drain? [FR-014]

- [ ] CHK014 Czy live issue #1018 zsynchronizowano z farmer-only przed T001,nie tylko issue-source? [Handoff]

- [ ] CHK015 Czy durable NORMAL z balance>=threshold jest klasyfikowany w tej samej Create tx przed marker INSERT,przy wspólnym WS/Netlify config i unknown fail-closed,bez obejścia przez null public user? [FR-001/002/010,T005/T007/T017]

- [ ] CHK016 Czy tylko known durable RESTRICTED ustawia marker,a UNKNOWN/NORMAL legal leave zachowuje marker i payout,bez nowego funding i bez osłabienia przyszłych admission/funding gates? [FR-005/006,T012]
