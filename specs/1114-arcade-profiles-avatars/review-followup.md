# Follow-up do niezależnego review kodu fazy A

2026-10-26. Lokalnie, bez push/PR, Stage Apply, WS Preview, danych Stage/Production, Storage cleanup i deploymentu. Baseline: `a63e44b0d9a1d3625956ed98b75c1242989efdd3`. Poprzedni lokalny commit: `d9c25e7fade01231441e7f4750af94e15f63cbcd`. Końcowy SHA znajduje się w materiale przekazania diffu.

## Wyjaśnienie galerii412px

Kompletna poprawka była już w poprzednim commicie: **`account.html` dodaje link do istniejącego `/css/xp.css`, nie zmienia tego pliku**. Nowe reguły `width/min-width/grid-template-columns` i ograniczenia formularza znajdują się w `css/profile-account.css`. Dlatego `css/xp.css` prawidłowo nie figuruje na liście zmienionych plików. Raport doprecyzowano. Screenshot PL pokazuje wszystkie16 pozycji w4 kolumnach przy412px; nie ma dodatkowej kopii CSS lub renderera.

## Tłumaczenia

Nowe statyczne treści Account/signup/prywatności i nazwy dostępności galerii używają istniejącego `js/i18n.js` oraz `data-i18n/data-i18n-aria`. Dynamiczne statusy wyboru avatara, aktywacji katalogu, braku Terms, błędu zapisu i widoczności mają PL/EN. Zmiana języka aktualizuje również istniejący komunikat i etykiety avatara; identyfikatory16 wariantów pozostają niezmienne.

Onboarding lokalizuje tytuł, kopię, przyciski, oba linki, kontakt/nawigację i błąd akceptacji. Otwarte okno odświeża etykiety i URL języka przy `langchange`, bez samoczynnego POST. Kody błędów API pozostają stabilnymi identyfikatorami, nie są tłumaczone na serwerze. Nie dodano zależności ani nowego frameworka UI.

[Galeria PL](evidence/account-gallery-pl-local.png), [Terms PL](evidence/terms-pl-local.png), [smoke tłumaczeń](evidence/localization-smoke.json).

## Targeted review rzeczywistych granic Terms

To przegląd implementera i fundamentalne lokalne dowody; właściciel przeprowadzi niezależny review na pełnym diffie. Nie przedstawiać go jako nowego niezależnego zatwierdzenia ani live smoke WS.

| Ścieżka | Faktyczny punkt kontroli | Wniosek / dowód |
|---|---|---|
| Nowy JOIN | `shared/poker-domain/join.mjs::executePokerJoinAuthoritative()`, po serwerowych return dla istniejącego miejsca, przed nową rezerwacją/buy-in | Brak Terms odmawia przed postTransaction,0 nowych debitów. Dedicated Online/SP test porównuje pełny stan i0 prób finansowania. Funded reconnect nie sprawdza nowej akceptacji. |
| Online quick-seat | `poker-quick-seat.mjs::handler()`: `already_seated` przed nowym gate; `requireCurrentTerms()` przed nową rekomendacją/create | Quick-seat sam nie obciąża CH; właściwy nowy debit jest jeszcze chroniony w authoritative JOIN. Resume istniejącego miejsca nie dostaje dodatkowej bramki. |
| SP quick-seat / replay | Najpierw `requestedTableId` z aktywnym miejscem oraz zapisany requestId; Terms dopiero po ich rozpoznaniu, przed nowym create | Test: nowy start wymaga Terms; funded Resume i replay nadal działają z pending Terms, bez nowego buy-in. CLOSED/left/owner/restriction pozostają dotychczasowymi ograniczeniami, nie błędem UI. |
| Create table | `poker-create-table.mjs::handler()` bierze lifecycle, potem Terms policy, następnie tier/create helper | Odmowa przed utworzeniem nowego stołu; helper nie wykonuje ludzkiego buy-in. Zachowana kolejność lifecycle→policy; systemowy supervisor nie przechodzi przez ten ludzki endpoint. |
| Gift | `server.mjs gift_send` → `handleGiftSendCommand()` → `giftAdapter.purchase()` → **`executePokerGiftPurchase()` w transakcji płatności** | Review wykazał, że poprzedni check serwera był w osobnym tx i blokował też paid replay. Przeniesiono do canonical purchase: istniejący zgodny receipt wraca wcześniej; nowe Terms są sprawdzane po dotychczasowych walidacjach/lifecycle, **przed `postTransaction(BURN)` w tym samym tx**. Guest nie kupuje prezentu. Adapter zachowuje bezpieczny reason `terms_required/terms_unavailable`; serwer nie emituje ponownie `table_gift` dla replay. |
| Reaction | `server.mjs reaction_send`: Terms przed `evaluateHumanReactionCommand()` i broadcast; tx z lifecycle przekazany do helpera | Brak drugiego połączenia z puli. Test odrzucenia Terms nie dopuszcza ewaluacji/publikacji; zwykła reakcja używa jednego tx. Brak operacji CH. |

**Gift RED→GREEN:** przy aktywnej polityce bez receipt początkowo nie było odmowy w canonical purchase. Po poprawce:0 BURN,0 gift receipt, saldo10000; po świadomej akceptacji jeden prezent, saldo9975; po zmianie wersji Terms paid replay nadal zwraca ten sam event, nowy zakup odrzucony, nadal jeden BURN i9975. Test używa wyłącznie PGlite i lokalnego ledger fixture. Kwoty/kierunki wpisów oraz istniejąca atomic rollback logika są niezmienione.

Wszystkie istniejące produkcyjne wywołania canonical gift purchase przechodzą przez wskazany adapter WS; brak alternatywnego endpointu Netlify zakupu. Sam helper w pliku serwera nie był wystarczającym dowodem i został zastąpiony transakcyjną granicą zakupu.

## Brak niezamierzonych zmian

- Auth: względem baseline `js/auth/supabaseClient.js` zmienia jedynie projekcję avatara. Sign-in, OAuth, token refresh i callbacki bez zmian; Terms ma własną kontrolę spójnego subject i jawnego potwierdzenia. Follow-up nie zmienia Auth klienta.
- CH/XP: silnik ledgera, ceny prezentów, entries, buy-in, cashout i naliczanie XP bez diffu. Nowy gate celowo ogranicza dopuszczenie nowej operacji, nie zmienia księgowania. Gift test sprawdza niezmienione zbilansowane entries i brak dodatkowego BURN przy retry.
- Poker: brak zmian settlement, autoplay/strategii, Leave, rebuy, startu następnej ręki lub zegarów. Terms nie jest sprawdzane na każdej akcji/rozdaniu; aktualna ręka pozostaje autorytatywna. JOIN/reakcje/gift i ich adaptery to jawnie zmienione ścieżki WS, nadal wymagające osobnego exact-SHA Preview GO.
- Account Deletion: istniejące moduły V2/recovery/purge/Auth-last bez zmian. Catalog/Terms zachowują lifecycle guards i manifesty; testy deletion/storage ponownie PASS. Retencja/cleanup SQL tylko przygotowane, bez wykonania na środowiskach.
- Schema w tym follow-up bez zmian. Terms i nowe warianty nadal domyślnie OFF. Nie ma funkcji faz B–D.

## Powtórzone odpowiednie testy

**212 PASS /0 FAIL /0 skipped** w13 plikach/suitach: profile/Terms, public-profile/avatar, V2 deletion/storage, create/quick-seat, i18n, authoritative JOIN, canonical gift purchase + adapter/handler gift i reaction. Nie powtarzano szerokiej kampanii gameplay ani WS Preview. Historyczny pełniejszy wynik379 pozostaje poprzednim dowodem, nie liczbą tego przebiegu.

CSP58 dokumentów PASS; kontrola119 migracji/11 odpowiedników Production PASS (bez I/O DB); syntax235 plików PASS. Lokalny smoke zapakowanego Account PL:16 avatarów, Terms i błąd zapisu akceptacji, signup/prywatność, błędy avatara i widoczności oraz sukces zapisu — PASS,0 zewnętrznych żądań,0 błędów JS. Natywny Android i prawdziwe Auth/WS nie były ponownie testowane.

## Przekazanie do niezależnego review

Eksport poza repo obejmuje pełny tekstowy unified diff od wskazanego baseline, logiczne części, kompletny patch z binariami, osobne grafiki/screenshoty, listę zmian, wyniki i SHA256. Nowe pliki są dołączone w całości, w tym SQL i testy. Kompletność pełnego patcha jest sprawdzana przez odtworzenie końcowego drzewa w izolowanym indeksie; bez nowej gałęzi, PR lub zmiany main. To nie jest GO operacyjne.

Następny krok nadal należy do właściciela: niezależne review diffu, potem ewentualne osobne GO na PR/DB Stage Apply i exact-SHA WS Preview. Ocena prawna aktywacji Terms i osobne bramki cleanup/Storage/Production pozostają otwarte.
