# Feature Specification: Trwała kwarantanna i autorefill dla NORMAL

**Feature Branch**: `docs/issue-1018-bot-quarantine`
**Created**: 2026-09-26
**Status**: Draft — wyłącznie plan, niezależne review przed implementacją
**Input**: [issue #1018](issue-source.md), alternatywa dla #869.

## User Scenarios & Testing

### US1 — Trwała klasyfikacja i zgodne wejście (Priority: P1)

Zwykły gracz zachowuje istniejący poker bez liczników ekspozycji. Wykryty RESTRICTED nie może nowo mieszać się z NORMAL. Dlaczego P1: oddzielenie wykrytego farmera przy finalnej autoryzacji. Independent Test: próg, trwałość i wyścig pierwszego wejścia.

1. Saldo USER próg−1 pozostaje NORMAL; saldo równe progowi lub większe przy następnej decyzji pokerowej daje trwałe RESTRICTED. Późniejszy spadek i restart nie usuwają stanu.
2. Dwa przeciwne konta równocześnie wchodzą na pusty/bot-only stół: wygrywa jedna klasa; drugie nie otrzymuje miejsca ani debitu buy-in. Dwóch RESTRICTED może wejść razem.
3. Odmowa wejścia po wykryciu nie cofa klasyfikacji. Retry i utracona odpowiedź odzyskują trwały stan. Denied JOIN do bot-only table nie ustawia has_human_participant; marker dopiero przy rzeczywiście zaakceptowanym human admission/rejoin.
4. Resume już finansowanego miejsca nie jest nowym admission; istniejący mixed table nie odcina gracza od akcji i wypłat.

### US2 — Zero nowego finansowania przy RESTRICTED (Priority: P1)

Dlaczego P1: zamknięcie wszystkich dopływów SYSTEM do botów. Independent Test: seed, replacement, managed top-up i active mixed hand.

1. Dowolny seated human RESTRICTED: zero nowych CH dla botów, bez usuwania istniejących stacków. Gate obejmuje seed zwykły i managed oraz replacement/top-up.
2. Wykrycie podczas ręki: ręka i payout kończą się poprawnie; mixed table odmawia wszystkim nowym ludziom, dopóki nie stanie się jednorodny lub pusty. Bez kick, TTL i fanout.
3. Brak pewnej klasyfikacji/membership: zero nowego fundingu/admission; legalna już zaakceptowana gra i cash-out nie wywołują nowego gate.
4. CONTINUOUS_BOT zachowuje lifecycle/rotację. Bez ludzi gate kwarantanny jest pusty, ale obowiązują źródło i rzeczywisty autoryzowany managed plan; po odejściu ostatniego restricted finansowanie może wrócić na kolejnym poprawnym sprawdzeniu.

### US3 — Autorefill dla uprawnionej gry (Priority: P1)

Dlaczego P1: NORMAL-only gra zachowuje dostęp do botów, także gdy inne stoły są RESTRICTED. Independent Test: dodatnie zapotrzebowanie, dokładny niedobór, dwie transakcje i replay.

1. Funding NORMAL-only na pustym źródle emituje dokładny niedobór i finansuje bota atomowo. Ten sam klucz po retry/restart/unknown COMMIT nie emituje ponownie.
2. RESTRICTED stół nie powoduje emisji ani transferu, nawet gdy źródło dostało refill dla NORMAL gdzie indziej. NORMAL-only stół pozostaje uprawniony niezależnie od wcześniejszej łącznej emisji; brak debitu USER na potrzeby botów.
3. Błąd/timeout refillu cofa tylko próbę nowego fundingu; już zaakceptowane settlement/cash-out nie zależą od jego sukcesu. Awaria DB wymaga recovery, nie fałszywego potwierdzenia wypłaty.

### Edge Cases

Nieznane konto/klasa, niepoprawny threshold, disconnected seated human, pending leave i roszczenie w ręce, równoczesny JOIN/leave/funding, niedobór źródła równy wymaganej kwocie, unknown COMMIT, źródło100 różne od TREASURY, brak miejsca i zablokowany tier po wykryciu.

## Requirements

- **FR-001**: Trwałe NORMAL/RESTRICTED; monotoniczne wykrycie przy authoritative USER balance>=server threshold (domyślnie1 000 000 000 CH); brak automatycznego unban.
- **FR-002**: Leniwe wykrycie przy nowym poker JOIN i przed dodatnim funding wszystkich aktualnych seated humans; brak skanera platformy i pomiaru historycznych peak balances. Odczyt przed debitem buy-in.
- **FR-003**: Final JOIN atomowo porównuje klasy aktualnych ludzi i kandydata. Pusty/bot-only stół przyjmuje pierwszą klasę; mixed stół odmawia każdego nowego admission. Resume własnego aktywnego miejsca zachowany. Denied JOIN może commitować restriction, lecz nie seat/buy-in ani has_human_participant; marker tylko przy zaakceptowanym admission/rejoin.
- **FR-004**: Każdy rzeczywisty nowy transfer bot SYSTEM→ESCROW wymaga wspólnego gate bez RESTRICTED humans, także seed/replacement/managed top-up/managed initial seed. Klient, createdBy ani metadata nie stanowią dowodu.
- **FR-005**: Aktualny mixed table zachowuje ręce, stacki, legalne akcje/leave/cash-out. Brak wymuszonego drain/kick; nowych bot CH nie ma do naturalnego rozdzielenia.
- **FR-006**: Brak/nieznana klasyfikacja lub niespójne membership daje odmowę nowych admissions/fundingu; denial nie może wycofać już utrwalonego RESTRICTED. Payout nie zależy od dostępności nowego gate/refillu.
- **FR-007**: Automatyczny refill utrzymuje uprawnioną NORMAL-only grę tierów100/500 przy istniejących źródłach. Brak globalnego lifetime cap. Emisja wyłącznie na dokładny niedobór autoryzowanego dodatniego funding; RESTRICTED stół nie może wywołać ani otrzymać nowego funding/refillu, także z płynności uzupełnionej przez inny stół.
- **FR-008**: Refill używa jednego istniejącego ledger, atomowego powiązania z fundingiem i trwałego klucza replay; brak podwójnej emisji po retry/restart/unknown commit/retention. Nie finansować botów kosztem salda człowieka.
- **FR-009**: Nieudany refill degraduje tylko dotkniętą próbę nowego funding do braku nowych bot CH; istniejące legalne wypłaty zachowane. Praca ograniczona faktycznym planem/pojemnością stołu i skończonym retry, bez skanów i pętli mint. Nie dodawać zależności już zaakceptowanego settlement/cash-out od refill.
- **FR-010**: Zachować CONTINUOUS_BOT, istniejące źródła100/500 i terminal return attribution. Nie dodawać klas stołów ani nowego silnika lobby. Direct/Quick Seat podlega temu samemu final JOIN.
- **FR-011**: Neutralna odmowa niezgodnego Quick Seat jest dopuszczona; nie obiecywać automatycznego wyszukania zgodnego celu. Obecne progression tiers/Create UI pozostają.
- **FR-012**: Wymagane tylko fundamentalne deterministic backend/runtime/transaction tests; JSP/global JS, klog, CSS jeden selektor na linię, CSP SHA dla nowego inline script. Nowy skrypt nie jest planowany.
- **FR-013**: Przyszły same-repo PR z supabase/migrations może automatycznie mutować shared Stage przez DB Stage Apply PR; zamiar musi być jawny przed publikacją, applied migrations immutable/forward-only. Production osobny GO. Teraz tylko dokumentacja.
- **FR-014**: Nie wdrażać FAST7d, SLOW12h, EXPOSURE, SLOW_SHARED, FAST_EXHAUSTED fanout/drain,90/10 ani stratowych CLOSE_PROOF z #869. Zachować dotychczasowe dowody ledger/terminal close i idempotencję.

### Key Entities

USER account z trwałą klasą; istniejące table/state/seat/ledger; receipt łączący emisję z konkretnym fundingiem. Szczegóły w data-model.md są potrzebne do opisania atomowości i retention.

## Success Criteria

- **SC-001**: Wszystkie próby nowego mieszania klas, w tym równoczesne pierwsze JOIN, kończą się bez mixed admission i bez nielegalnego buy-in.
- **SC-002**: Każda z czterech znalezionych ścieżek fundingu daje zero nowych CH przy restricted; active mixed hand i cash-out kończą się bez podwójnego transferu.
- **SC-003**: Emisja dla każdej operacji równa jest jej niedoborowi źródła i następuje najwyżej raz; RESTRICTED wywołuje zero emisji/fundingu, NORMAL-only gdzie indziej nadal może otrzymać refill.
- **SC-004**: Przed aktywacją dostępne są fundamentalne wyniki oraz exact-runtime-SHA WS Preview i manual smoke; docs/review nie są zgodą na implementację/deploy.

## Assumptions / decyzje do review

Próg1mld wykrywa anomalię, nie dowodzi oszustwa; farmer może rozdzielać środki lub nigdy nie osiągnąć progu. To zaakceptowany zakres. Sticky restriction bez UI unban w V1; ewentualny reset wyłącznie odrębne audytowane zadanie operatora.

Poprzednia propozycja lifetime100k/500k jest zastąpiona decyzją właściciela z2026-09-26. NORMAL może farmić; łączna emisja w czasie nie ma limitu lifetime. Ochrona techniczna wiąże każdą emisję z uprawnionym dodatnim fundingiem, dokładnym niedoborem i trwałym replay. Aktywacja nadal wymaga osobnego zlecenia; to nie zgoda na mint teraz.
