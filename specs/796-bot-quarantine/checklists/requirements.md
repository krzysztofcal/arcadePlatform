# Specification Quality Checklist — #1018

Status: własna kontrola dokumentów; niezależne review nadal wymagane.

- [x] Osobna alternatywa, bez zmian #869/#1017.
- [x] User stories i mierzalne scenariusze pokrywają próg, segregation, wszystkie funding paths i refill.
- [x] Wskazano konkretne istniejące metody, nowe elementy nazwano planowanymi.
- [x] Trwałość, retry/unknown commit i payout oddzielone od admission.
- [x] Brak niepotrzebnego lobby/fraud engine i testów UI.
- [x] Autorefill NORMAL bez lifetime cap jest zatwierdzony; aktywacja nadal osobno.
- [x] Stage mutation/forward-only i Production GO jawne.
- [x] Spec/plan/tasks/model/contract zgodne; STOP przed implementacją.

## Analyze coverage

| Requirements | Tasks |
|---|---|
| FR-001–003,SC-001 | T002–006,T017 |
| FR-004–006,SC-002 | T005–012,T017 |
| FR-007–009,SC-003 | T002–003,T013–017 |
| FR-010–012 | T007–012,T015,T017–018 |
| FR-013–014,SC-004 | T001–002,T018–019 |

18 wymagań (14FR+4SC),19 zadań,100% mapowania,bez nieprzypisanych zadań. Ponowny speckit-analyze po korekcie authoritative Create/shared threshold:0 CRITICAL,0 HIGH; brak naruszeń konstytucji i luk pokrycia. Exact-deficit composite flow podlega niezależnemu review; dokumentacja nie jest zgodą emisji. Nie oznacza wykonania testów ani implementacji.

Sprawdzono4 fundamentalne scenariusze table hopping w T008/T012/T017; zmiany schema/create/final JOIN/funding/projection w T002/T006–010. Brak nowego testu UI i brak nowej klasy lifecycle.

Live #1018 pozostaje niesynchronizowane z farmer-only: jawna zewnętrzna bramka przed T001,nie decyzja do ponownego wyboru. Usunięto nową receipt table; T016 obowiązkowo obejmuje typed MINT archive/binding/cleanup.
