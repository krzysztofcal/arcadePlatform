# Reviewer checklist — finanse i runtime #1018

Checkboxy należą do niezależnego reviewera; nie są stanem wykonania implementacji.

- [ ] CHK001 Czy lazy threshold/sticky state i brak USER są jednoznaczne? [FR-001/002]
- [ ] CHK002 Czy odmowa JOIN może zatwierdzić restriction bez buy-in? [FR-003/006]
- [ ] CHK003 Czy klasy empty/mixed/Resume i concurrent admissions są jednoznaczne? [FR-003]
- [ ] CHK004 Czy seed,managed seed,replacement,topup mają wspólny gate wszystkich seated humans? [FR-004]
- [ ] CHK005 Czy odmowa nie utrwala funded candidate i nie przerywa payout? [FR-005/006/009]
- [ ] CHK006 Czy lifetime cap i brak resetu/source bypass oraz disabled activation są jawne? [FR-007]
- [ ] CHK007 Czy ledger/counter/receipt i retention dają exactly-once? [FR-008]
- [ ] CHK008 Czy refill jest poza FIFO i bounded, bez gwarancji przy DB outage? [FR-009]
- [ ] CHK009 Czy CONTINUOUS_BOT i minimalne matchmaking zachowane? [FR-010/011]
- [ ] CHK010 Czy finite cap dotyczy nowej emisji refillera, nie innych przychodów TREASURY? [research R4]
- [ ] CHK011 Czy tylko fundamentalne testy i zasady JSP/klog/CSP/CSS? [FR-012]
- [ ] CHK012 Czy Stage apply,forward-only,exact-SHA preview i osobny GO są jawne? [FR-013]
- [ ] CHK013 Czy #869 porównano bez dziedziczenia EXPOSURE/90:10/drain? [FR-014]
