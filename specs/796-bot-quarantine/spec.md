# Feature Specification: Trwała kwarantanna i skończony refill botów

**Feature Branch**: `docs/issue-1018-bot-quarantine`
**Created**: 2026-09-26
**Status**: Draft — wyłącznie plan, niezależne review przed implementacją
**Input**: [issue #1018](issue-source.md), alternatywa dla #869.

## User Scenarios & Testing

### US1 — Trwała klasyfikacja i zgodne wejście (Priority: P1)

Zwykły gracz zachowuje istniejący poker bez liczników ekspozycji. Wykryty RESTRICTED nie może nowo mieszać się z NORMAL. Dlaczego P1: oddzielenie wykrytego farmera przy finalnej autoryzacji. Independent Test: próg, trwałość i wyścig pierwszego wejścia.

1. Saldo USER próg−1 pozostaje NORMAL; saldo równe progowi lub większe przy następnej decyzji pokerowej daje trwałe RESTRICTED. Późniejszy spadek i restart nie usuwają stanu.
2. Dwa przeciwne konta równocześnie wchodzą na pusty/bot-only stół: wygrywa jedna klasa; drugie nie otrzymuje miejsca ani debitu buy-in. Dwóch RESTRICTED może wejść razem.
3. Odmowa wejścia po wykryciu nie cofa klasyfikacji. Retry i utracona odpowiedź odzyskują trwały stan.
4. Resume już finansowanego miejsca nie jest nowym admission; istniejący mixed table nie odcina gracza od akcji i wypłat.

### US2 — Zero nowego finansowania przy RESTRICTED (Priority: P1)

Dlaczego P1: zamknięcie wszystkich dopływów SYSTEM do botów. Independent Test: seed, replacement, managed top-up i active mixed hand.

1. Dowolny seated human RESTRICTED: zero nowych CH dla botów, bez usuwania istniejących stacków. Gate obejmuje seed zwykły i managed oraz replacement/top-up.
2. Wykrycie podczas ręki: ręka i payout kończą się poprawnie; mixed table odmawia wszystkim nowym ludziom, dopóki nie stanie się jednorodny lub pusty. Bez kick, TTL i fanout.
3. Brak pewnej klasyfikacji/membership: zero nowego fundingu/admission; legalna już zaakceptowana gra i cash-out nie wywołują nowego gate.
4. CONTINUOUS_BOT zachowuje lifecycle/rotację. Bez ludzi gate kwarantanny jest pusty, ale obowiązują źródło i cap; po odejściu ostatniego restricted finansowanie może wrócić na kolejnym poprawnym sprawdzeniu.

### US3 — Skończona emisja (Priority: P1)

Dlaczego P1: kwarantanna nie eliminuje farmerów poniżej progu. Independent Test: dwie transakcje, restart i replay ostatniej dostępnej emisji.

1. Dwa refille konkurujące o ostatni limit nie przekraczają trwałego cap. Ten sam klucz nie emituje ponownie.
2. Brak płynności i niewystarczający pozostały cap: zero nowych CH i nowych botów; brak debitu USER na potrzeby botów.
3. Settlement/cash-out nie czekają na refill; awaria DB wymaga recovery, nie fałszywego potwierdzenia wypłaty.

### Edge Cases

Nieznane konto/klasa, niepoprawny threshold, disconnected seated human, pending leave i roszczenie w ręce, równoczesny JOIN/leave/funding, limit równy kwocie, unknown COMMIT, źródło100 różne od TREASURY, brak miejsca i zablokowany tier po wykryciu.

## Requirements

- **FR-001**: Trwałe NORMAL/RESTRICTED; monotoniczne wykrycie przy authoritative USER balance>=server threshold (domyślnie1 000 000 000 CH); brak automatycznego unban.
- **FR-002**: Leniwe wykrycie przy nowym poker JOIN i przed dodatnim funding wszystkich aktualnych seated humans; brak skanera platformy i pomiaru historycznych peak balances. Odczyt przed debitem buy-in.
- **FR-003**: Final JOIN atomowo porównuje klasy aktualnych ludzi i kandydata. Pusty/bot-only stół przyjmuje pierwszą klasę; mixed stół odmawia każdego nowego admission. Resume własnego aktywnego miejsca zachowany.
- **FR-004**: Każdy rzeczywisty nowy transfer bot SYSTEM→ESCROW wymaga wspólnego gate bez RESTRICTED humans, także seed/replacement/managed top-up/managed initial seed. Klient, createdBy ani metadata nie stanowią dowodu.
- **FR-005**: Aktualny mixed table zachowuje ręce, stacki, legalne akcje/leave/cash-out. Brak wymuszonego drain/kick; nowych bot CH nie ma do naturalnego rozdzielenia.
- **FR-006**: Brak/nieznana klasyfikacja lub niespójne membership daje odmowę nowych admissions/fundingu; denial nie może wycofać już utrwalonego RESTRICTED. Payout nie zależy od dostępności nowego gate/refillu.
- **FR-007**: Automatyczny refill ma trwały transakcyjny limit dla tierów100/500 i jawnie przypisanych istniejących source accounts. Wybrany limit jest lifetime bez automatycznego resetu; brak innych tierów i obejścia zmianą env/source.
- **FR-008**: Refill używa jednego istniejącego ledger, atomowego licznika i trwałego klucza replay; brak podwójnej emisji po retry/restart/unknown commit/retention. Nie finansować botów kosztem salda człowieka.
- **FR-009**: Brak płynności/cap na wymagane dofinansowanie degraduje do braku nowych bot CH; istniejące legalne wypłaty zachowane. Refiller poza FIFO komend gry i transakcją settlement.
- **FR-010**: Zachować CONTINUOUS_BOT, istniejące źródła100/500 i terminal return attribution. Nie dodawać klas stołów ani nowego silnika lobby. Direct/Quick Seat podlega temu samemu final JOIN.
- **FR-011**: Neutralna odmowa niezgodnego Quick Seat jest dopuszczona; nie obiecywać automatycznego wyszukania zgodnego celu. Obecne progression tiers/Create UI pozostają.
- **FR-012**: Wymagane tylko fundamentalne deterministic backend/runtime/transaction tests; JSP/global JS, klog, CSS jeden selektor na linię, CSP SHA dla nowego inline script. Nowy skrypt nie jest planowany.
- **FR-013**: Przyszły same-repo PR z supabase/migrations może automatycznie mutować shared Stage przez DB Stage Apply PR; zamiar musi być jawny przed publikacją, applied migrations immutable/forward-only. Production osobny GO. Teraz tylko dokumentacja.
- **FR-014**: Nie wdrażać FAST7d, SLOW12h, EXPOSURE, SLOW_SHARED, FAST_EXHAUSTED fanout/drain,90/10 ani stratowych CLOSE_PROOF z #869. Zachować dotychczasowe dowody ledger/terminal close i idempotencję.

### Key Entities

USER account z trwałą klasą; istniejące table/state/seat/ledger; mały rekord polityki refillu oraz receipt emisji. Szczegóły w data-model.md są potrzebne do opisania atomowości i retention.

## Success Criteria

- **SC-001**: Wszystkie próby nowego mieszania klas, w tym równoczesne pierwsze JOIN, kończą się bez mixed admission i bez nielegalnego buy-in.
- **SC-002**: Każda z czterech znalezionych ścieżek fundingu daje zero nowych CH przy restricted; active mixed hand i cash-out kończą się bez podwójnego transferu.
- **SC-003**: Suma nowych emisji nigdy nie przekracza trwałego lifetime cap; replay/restart/unknown commit nie zmieniają sumy.
- **SC-004**: Przed aktywacją dostępne są fundamentalne wyniki oraz exact-runtime-SHA WS Preview i manual smoke; docs/review nie są zgodą na implementację/deploy.

## Assumptions / decyzje do review

Próg1mld wykrywa anomalię, nie dowodzi oszustwa; farmer może rozdzielać środki lub nigdy nie osiągnąć progu. To zaakceptowany zakres. Sticky restriction bez UI unban w V1; ewentualny reset wyłącznie odrębne audytowane zadanie operatora.

Projekt cap: lifetime100 000 CH dla100 i500 000 CH dla500 (po1000 nominalnych buy-in); bez automatycznego okna/resetu. Są to jawne propozycje Spec Kit do niezależnego review, nie wartości wynikające z pomiarów ani zgoda emisji. Wdrożenie początkowo z refillem wyłączonym; aktywacja wymaga zatwierdzenia wartości. Nie trzeba dodatkowego algorytmu, jeśli właściciel wybierze mniejsze cap. Istniejący kapitał źródeł i historyczna alokacja nie są nową emisją #1018.
