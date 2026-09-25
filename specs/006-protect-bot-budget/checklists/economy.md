# Economy Checklist: Chroniony budżet botów

**Purpose**: Szczegółowe niezależne review jakości wymagań #869: ekspozycja, matchmaking, lifecycle, rezerwa i emisja.
**Created**: 2026-09-24
**Feature**: [spec.md](../spec.md)

**Note**: Wygenerowano przez `$speckit-checklist`.
**Review Ownership**: Właścicielem checkboxów jest reviewer (niezależne review ChatGPT przed implementacją).
**Marker Semantics**: `[x]` oznacza potwierdzoną jakość wymagań, nie wykonaną implementację. Wszystkie nowe pozycje pozostają `[ ]`.

## Requirement Completeness

- [ ] CHK001 Czy limit dostępu, płynność SYSTEM i emisja są rozdzielone bez drugiego obciążenia gracza? [Completeness, Spec FR-001]
- [ ] CHK002 Czy jeden wspólny fast obejmuje jednostki, CH cap, cadence oraz wszystkie tiery/sesje? [Completeness, Spec FR-002–003]
- [ ] CHK003 Czy pierwsza jednostka natychmiast i kroczące 12 h każdego ułamka odpowiadają zatwierdzonemu D1? [Clarity, Spec FR-004, D1]
- [ ] CHK004 Czy zdefiniowano koszt admission do pre-funded botów i brak user charge przed pierwszym człowiekiem? [Completeness, Spec FR-005–007]
- [ ] CHK005 Czy rezerwa 90/10 obejmuje zarówno dostępne środki, jak i dozwoloną emisję? [Completeness, Spec FR-019–020]

## Requirement Clarity

- [ ] CHK006 Czy ułamkowe ekspozycje i zachowany residual mają jednoznaczny koszt? [Clarity, Spec FR-002, FR-007]
- [ ] CHK007 Czy tożsamość ponowienia i nowej ekspozycji rozróżnia powracającego oraz nowego człowieka? [Clarity, Spec FR-006, contracts/bot-budget.md §1]
- [ ] CHK008 Czy STANDARD/SLOW_SHARED/HUMAN_ONLY są odróżnione od lifecycle i stanu wygaszania? [Clarity, Spec FR-009–016]
- [ ] CHK009 Czy wspólne kroczące (t−168 h,t] i granice emisji są jednoznaczne? [Clarity, Spec FR-020, D2]
- [ ] CHK010 Czy jednorazowy MINT miliona GENESIS → POKER_BOT_BANKROLL_100, 900000/100000, jest oddzielony od REFILL i Production GO? [Clarity, Spec FR-018, D3]

## Requirement Consistency

- [ ] CHK011 Czy zachowanie slow po odnowieniu fast pozostaje zgodne z zakazem mieszania klas? [Consistency, Spec FR-003–004, FR-010, FR-019]
- [ ] CHK012 Czy prawo do wznowienia istniejącego seat jest odróżnione od nowego admission do DRAINING? [Consistency, Spec FR-011, FR-013–015]
- [ ] CHK013 Czy wymóg czasu 30 min wszędzie oznacza zakaz następnej ręki, bez przerwania żywej? [Consistency, Spec FR-013–016]
- [ ] CHK014 Czy cele wyższych tierów pozostają poza aktywacją #869 i wymagają osobnych limitów? [Consistency, Spec FR-026]

## Acceptance Criteria Quality

- [ ] CHK015 Czy sukces ma mierzalne granice jednostek, CH, czasu i emisji? [Measurability, Spec SC-001–005]
- [ ] CHK016 Czy wymagania rozróżniają dowód dokumentacyjny, test logiczny i dowód runtime? [Clarity, Spec SC-006, FR-030–031]
- [ ] CHK017 Czy ograniczona dostępność przy pustej puli jest jawna bez obietnicy nieskończonych miejsc? [Measurability, Spec FR-012, FR-025]

## Scenario Coverage

- [ ] CHK018 Czy wszystkie ścieżki dopuszczenia mają wspólną politykę serwerową? [Coverage, Spec FR-011]
- [ ] CHK019 Czy wieloosobowy standard ma niezależną autoryzację każdej nowej ekspozycji? [Coverage, Spec FR-007, US1]
- [ ] CHK020 Czy wymagania obsługi błędu obejmują częściowy zapis, utratę odpowiedzi i restart? [Coverage, Spec FR-008, FR-016, FR-023]
- [ ] CHK021 Czy zasady cutover i zachowania historycznych źródeł są jawne? [Coverage, Spec FR-017, FR-024, FR-032]

## Edge Case Coverage

- [ ] CHK022 Czy moment pierwszego wyczerpania i niemożność przesunięcia deadline są jednoznaczne? [Clarity, Spec FR-013–016]
- [ ] CHK023 Czy brak finansowania 100 i 500 ma wymaganie postępu poprawnego settlement/exit? [Coverage, Spec FR-016, FR-025]
- [ ] CHK024 Czy signed strata netto, zyski, już wypłacona kompensacja i live capital są rozróżnione? [Coverage, Spec FR-021–022, plan.md §5]
- [ ] CHK025 Czy brak dowodu po retencji ma jednoznaczny skutek bez resetowania limitów? [Coverage, Spec FR-024]

## Non-Functional Requirements

- [ ] CHK026 Czy wymagania wykluczają obejście przez klienta oraz ujawnianie cudzych limitów? [Completeness, Spec FR-011, contracts/bot-budget.md §3]
- [ ] CHK027 Czy zasady JSP/CSS/CSP/klog i zakaz szerokich testów są wyraźne? [Completeness, Spec FR-029–030]

## Dependencies & Assumptions

- [ ] CHK028 Czy wpływ przyszłego PR migracyjnego na shared Stage jest opisany jako mutacja? [Clarity, Spec FR-030]
- [ ] CHK029 Czy exact-SHA WS Preview, smoke i osobny Production GO mają jawne kryteria? [Completeness, Spec FR-027, FR-030, SC-006]
- [ ] CHK030 Czy niezależne review i osobne zlecenie implementacji stanowią warunek dalszej pracy? [Clarity, Spec FR-031]

## Ambiguities & Conflicts

- [ ] CHK031 Czy wszystkie dokumenty odzwierciedlają zatwierdzone D1–D3 i usuwają stare warianty? [Ambiguity, Spec Assumptions]
- [ ] CHK032 Czy plan zachowuje wszystkie zatwierdzone liczby i brak fallbacku między klasami/tierami? [Consistency, Spec FR-002–004, FR-017–023]

## Pokrycie zatwierdzonych P1 i granic

- [ ] CHK033 Czy A i pre-funded B otrzymują deadline pierwotnego zdarzenia konta +30 min mimo późnego wykrycia, restartu i resetu fast? [Coverage, FR-013–016, T020–024, T040–041]
- [ ] CHK034 Czy admission, każdy nowy funding i start/prepare/commit bez funding sprawdzają trwałe powiązania wszystkich zajętych STANDARD, z wyłączeniem HUMAN_ONLY i istniejących SLOW_SHARED? [Coverage, FR-011, FR-016]
- [ ] CHK035 Czy zmiany członkostwa/leave i fanout mają kompletny snapshot bez odwrócenia blokad między stołami? [Consistency, plan globalne wyczerpanie, T040–041]
- [ ] CHK036 Czy 0,4+0,6 godzinę później uwalnia tylko 0,4 po pierwszych 12 h, także przy race i zmianie tieru/trybu? [Measurability, FR-004, T009, T033]
- [ ] CHK037 Czy trwałe receipts i guard serializują 168 h klas/tierów/global z poprawnymi granicami i bez starego snapshotu? [Coverage, FR-020, FR-023, T030, T033]
- [ ] CHK038 Czy idempotentny seed, retencja i fundamentalne testy pozostają wyłącznie planem bez operacji środowiskowych? [Scope, FR-018, FR-030–031]

## Notes

Poziom: szczegółowy, finanse i authoritative access/lifecycle. Odbiorca: niezależny reviewer przed implementacją. Nie są to testy aplikacji. `$speckit-implement` może czytać stan, nie zmienia markerów. `requirements.md` ma osobny cykl specify/clarify. D1–D3 są zatwierdzone; kryteria nie są automatycznie zaliczone.

## D.1 — jakość wymagań matchmakingu

- [ ] CHK039 Czy kryteria projekcji gracza definiują JOIN/RESUME i całkowite pominięcie niedostępnych wierszy, wraz z odświeżaniem i prywatnością? [Completeness, Spec FR-011, US2/5]
- [ ] CHK040 Czy Graj teraz bez formularza używa pierwszego eligible celu z jego parametrami, a bez oferty najwyższego rzeczywiście grywalnego tieru/canonical parameters bez silent mode switch? [FR-012]
- [ ] CHK041 Czy zwykły MATCH i przypięty DIRECT mają rozłączne zasady stale odmowy i alternatyw? [Consistency, Spec FR-012, US2/7–8]
- [ ] CHK042 Czy limit 2 prób/1 create, retry po nieznanym wyniku i deduplikacja pustych stołów są mierzalne i spójne z atomowym admission? [Measurability, Spec FR-008, FR-012, contracts D.1]
- [ ] CHK043 Czy brak allowance/pool/proof/capability wyklucza pozorne funded create, a ograniczenia awarii i ręczna weryfikacja UI są jawne? [Coverage, Spec FR-012, FR-025, FR-030, quickstart D.1]

## Korekta kosztu seed, reuse i admin inspection

- [ ] CHK044 Czy preflight i finalny seed mają wspólną bezpieczną granicę, actual-only debit i scenariusz puli wystarczającej tylko na mniejszy target? [Consistency, Spec FR-012, US2/9]
- [ ] CHK045 Czy reuse obejmuje maxPlayers/stakes i nie tworzy owner-only/unique owner reguły SLOW_SHARED? [FR-012, P2]
- [ ] CHK046 Czy D.2 jasno oddziela pełną administracyjną inspekcję od player filtering, admission, prywatnych danych i przyszłego spectatora #789? [Clarity, Spec FR-011, US2/11]
- [ ] CHK047 Czy class/legacy/unknown i active/history drain mają mierzalną prezentację bez zmiany OPEN/CLOSED, mutacji GET i rozszerzenia testów UI? [Coverage, contracts D.2, quickstart D.2]

## D.3 i autorytatywna konfiguracja

- [ ] CHK048 Czy źródło cfg WS, wersja, freshness i zmiana przed join mają jednoznaczny kontrakt bez lokalnego env/per-candidate fetch? [Clarity, Spec FR-033]
- [ ] CHK049 Czy model kosztu obejmuje częstotliwość, RT/rows/bytes, concurrency, locks i bounded retry wszystkich ścieżek, bez viewer×table/admin N+1? [Completeness, Spec FR-034, plan D.3]
- [ ] CHK050 Czy nieukończony/błędny odczyt, niepełny proof i overload oznaczają jawny unavailable/zero create/mint (odmiennie od ukończonego zakresu bez oferty) z zachowaniem priorytetu rozliczeń i granic DB outage? [Consistency, Spec FR-034, SC-007]
- [ ] CHK051 Czy exact refill i trwały backlog pozostają zgodne z 168h, kapitalizacją i brakiem częściowych dowodów przy granicach pracy? [Coverage, Spec FR-020–024, FR-034]
- [ ] CHK052 Czy pomiar baseline/Stage oddziela egress od CPU/I/O/WAL/locks, ogranicza obciążenie i nie ogłasza niezmierzonych SLO? [Measurability, quickstart D.3, SC-007]

## Kontynuacja i błędy transakcyjne — review

- [ ] CHK053 Czy pasywne lobby nie tworzy/finansuje stołu, a stałe Graj teraz wybiera pierwszy nadal zgodny JOIN i obsługuje stale race bez click? [FR-011/012, T015–T019]
- [ ] CHK054 Czy FIFO nie jest opisywane jako priorytetowe, ciężka praca pozostaje poza nim, a timeout kończy tx przed zwolnieniem komendy? [Correctness, FR-034, T022]
- [ ] CHK055 Czy błąd pełnego proof/pending/counter cofa cały close, a unknown COMMIT i późniejszy proof nie dublują zwrotu? [Coverage, SC-005/007, T028/T033]
- [ ] CHK056 Czy oba rodzaje proof i kompensacja używają tej samej to_state_version oraz jawnej unikalności i relacji pending/final? [Clarity, data-model, T006]

- [ ] CHK057 Czy tylko dwa rodzaje MATCH receipt mają jawne kolumny/unique/replay, a kilka kart odzyskuje in-flight wynik przed drugim create? [data-model §3, T006/T033]
- [ ] CHK058 Czy zakres K i inventory>K mają bounded create bez manual continuation, a K/L/B/C/D wynikają z query plans/pomiarów Q1, nie dawnego100? [FR-012/034, T002/T015/T017]

- [ ] CHK059 Czy shared SLOW autoryzuje każdego człowieka i zachowuje jeden FUNDING, a dodatnia wymagana odmowa/zero bez kosztu/rolling fractions/sticky drain mają rozłączne scenariusze? [FR-004/007/010/013, S1]
- [ ] CHK060 Czy S1-A jest zamknięte, Q1 nadal otwarte bez preferowania nowego endpointu, a wybór i warunkowe Caddy mają plan dowodów? [plan Q1, T002/T018/T038]
