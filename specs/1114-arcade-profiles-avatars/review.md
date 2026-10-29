# Faza A — lokalna implementacja do review

2026-10-26. Baseline GitHub main ponownie potwierdzony: `a63e44b0d9a1d3625956ed98b75c1242989efdd3`. Lokalna gałąź `feat/1114-profiles-phase-a`; końcowy lokalny SHA w raporcie przekazania. **Bez push/PR, aplikowania DB, cleanupu danych/Storage, Stage/WS/Production deploy lub publikacji APK. B–D niewdrożone.**

## Zakres i dowody

- 16 oddzielnych WebP256×256,240002 bajty razem, największy17752 bajty. Zachowane sześć pierwszych kluczy i wszystkie16 identyfikatorów. `zen-lime` to zaakceptowany zielony stworek z listkami; żółw nie jest użyty. Natywne wycinki bez przerysowania/upscalingu i podpisów planszy; docelowy runtime używa pojedynczych plików. [24/48/256px](artwork/size-review.png), [ID/rect/SHA256](artwork/export-receipt.json), [proweniencja i akceptacja](artwork/README.md).
- `shared/profile-avatar-projection.mjs` jest allowlistą; mały generator dostarcza identyczny katalog IIFE WWW/Offline. Topbar, Account, leaderboard, public profile i Poker korzystają z lokalnych grafik. APK pakuje16 i dokumenty prawne; Offline dostaje lokalny avatar Hero bez Auth/sieci/synchronizacji konta. Nie zmieniono formatu sesji lub portfela Offline.
- Account: galeria/CAS revision i trwały wariant, automatyczna nazwa/handle tylko do odczytu, niezależna prywatność rankingu. BIO nie występuje w read/write kontrakcie. Stare manual writes odrzucane; upload/finalize/remove publiczne zwracają410, bez wydania capability. Historyczne wewnętrzne przetwarzanie/manifesty zachowane dla istniejącego V2 cleanup i fundamentalnych testów; żaden nowy importer nie jest podłączony.
- `shared/profile-terms.mjs`: receipt podmiot+wersja, serwerowy czas, requestId, idempotencja, zweryfikowane JWT konta/gościa, expiry gościa. Zmiana konta lub wersji nie może zaakceptować niewyświetlonego regulaminu. Jeden świadomy przycisk; bez dodatkowego checkboxa i zgody foto. Dokumenty PL/EN i wersjonowane Terms są lokalnie dostępne przed logowaniem.
- Serwerowy gate tylko dla nowego create/quick-seat/authoritative JOIN, wyboru avatara i społecznych publikacji reaction/gift. Po follow-up gate gift znajduje się w canonical purchase, w tym samym tx przed BURN i po paid replay; patrz [review-followup.md](review-followup.md). Funded Resume/replay/reconnect, Leave, trwająca gra i safety pozostają dostępne. Nie dodano kontroli zakładów, rozdania, rebuy, rollover/settlement lub mintu OAuth/WS.
- Schema addytywna i operacyjne SQL tylko przygotowane; `active=false`, `variants_enabled=false`. Stare6 provisioning zachowane do osobnej aktywacji zgodnych readerów. `normalize-profiles.sql` to jeden kontrolowany przebieg z markerem, ustaloną listą max1000 UUID i lockami lifecycle→policy→profile; zachowuje UUID/CH/XP/warianty/dane gry. Brak aliasów/redirectów. `contract.sql` później usuwa nieużywane kolumny. Żaden z tych plików nie został wykonany na Stage/Production.

[Zestaw wyników testów](evidence/tests-local.json). Pełna [lista zmienionych plików](changed-files.md). [Galeria APK — zasoby lokalne](evidence/account-gallery-local.png), [Terms](evidence/terms-local.png), [Offline](evidence/offline-avatar-local.png), [wynik smoke](evidence/local-smoke.json), [zgodność plików pakietu/CSP/SRI](evidence/asset-verification.json).

## Weryfikacja

| Zakres | Wynik |
|---|---|
| Lokalny zestaw fundamentalny —17 wskazanych plików/suit | **379 PASS /0 FAIL /0 skipped** |
| Profile/Terms po dodaniu manifestu dawnego zdjęcia | **10 PASS** — odrębny końcowy przebieg |
| CSP inline | **PASS**,58 dokumentów |
| Kontrola migracji/manifestu (bez DB I/O) | **PASS**,119 plików i11 odpowiedników Production |
| Syntax | **PASS**,230 śledzonych plików + kontrola nowych/zmienionych JS/MJS |
| Generator katalogu i Offline, lokalny Stage web bundle | **PASS**, bez budowania/publikacji APK |
| Lokalny smoke rzeczywiście spakowanych zasobów | **PASS**:16 pozycji, chooser, Terms, lokalne PL/EN, avatar Offline,0 żądań zewnętrznych w Offline,0 błędów JS |
| GitHub CI / prawdziwe Auth Stage / WS Preview / Android fizyczny | **NIE URUCHOMIONO**, brak operacyjnego GO |

Smoke użył wyłącznie lokalnego HTTP oraz mocków Auth/API; nie dowodzi działania wdrożonego WS, prawdziwego Google OAuth lub serwera Stage. Nie uruchomiono finansowanego gameplay. Istniejący `tests/auth-identity.test.mjs` wymaga nieobecnego Vitest; nie instalowano nowego frameworka. Dotyczące tego zakresu scenariusze tożsamości/zmiany konta są pokryte nowymi fundamentalnymi testami Node.

Testy obejmują: zachowanie sześciu kluczy, brak BIO/Storage URL w projekcji, odrzucenie starych writes, CAS/retry/suppression, manifest dawnego zdjęcia, usuwane konto, wersję/czas Terms i expiry gościa, autoryzację/IDOR, zmianę konta/wersji podczas potwierdzania, nowe JOIN vs funded reconnect, SP Resume/request replay vs nowy start, jedną transakcję reakcji, lock order create oraz powtarzalność/inwarianty lokalnego cleanup. Istniejące testy Offline i V2 Storage/deletion również przeszły.

## Końcowy review i uproszczenia

Świeży niezależny review znalazł5 Important,0 Critical. Wszystkie Important poprawiono i odtworzono fundamentalnymi testami RED→GREEN:
1. Reakcja używa istniejącego lifecycle tx zamiast pobierać drugie połączenie z puli.
2. SP quick-seat rozpoznaje funded Resume/request replay przed nowym Terms gate.
3. Akceptacja jest przypisana do wyświetlonej wersji; po zmianie wersji dialog i link są aktualizowane przed nowym kliknięciem.
4. Potwierdzenie jest przypisane do wyświetlonego subject/generation; spójność token sub/tożsamości sprawdzana przed POST.
5. Create/quick-seat biorą lifecycle przed Terms policy; przygotowany cleanup stosuje tę samą kolejność przed profile rows.

Końcowy odczyt screenshotu znalazł przyciętą galerię w412px (prawa krawędź562px). Naprawiono lokalnie przez dołączenie istniejącego, **niezmienionego** `css/xp.css` w `account.html` oraz nowe zawężone reguły w `css/profile-account.css`. Plik `css/xp.css` nie ma diffu i prawidłowo nie figuruje na liście zmian. Tymczasowy smoke potwierdził wszystkie16 dostępne w szerokości ekranu; nie dodano utrzymywanego UI suite.

**Historyczna drobna uwaga, domknięta w follow-up**: nowe etykiety Account/signup/prywatności oraz komunikaty i błędy mają teraz PL/EN; także linki i aktualizacja języka otwartego dialogu Terms. Dowód i targeted review: [review-followup.md](review-followup.md).

Decyzje implementacyjne: jeden helper Terms w `shared/` dla HTTP/WS zamiast duplikacji Netlify; brak cache receipt i dodatkowego schedulera (dwa krótkie SELECT na nowym wejściu/publikacji, bez sprawdzania bettingu). Wymaga pomiaru Stage, bez deklaracji poprawy wydajności. Zamknięta lista entrypoints zgodna z planem; inne reguły świadczenia usługi podlegają legal gate zamiast zmian CH/XP engine. Syntetyczne istniejące JOIN fixtures reprezentują nieaktywną politykę; dedykowane cases sprawdzają aktywną odmowę i wyjątek reconnect. Błędna ocena tych granic wymaga zmiany przed aktywacją, nie cichego rozszerzania runtime. Niezależny reviewer pozostawił ocenę prawa, aktywnej konfiguracji/providerów, rzeczywistej współbieżności Postgresa i pikselowej jakości grafik poza swoją oceną: pierwsze trzy są obowiązkowymi bramkami przed aktywacją, a grafikę sprawdzono wizualnie lokalnie względem zaakceptowanej planszy. Brak dowodu środowiskowego nie jest PASS.

## Breaking impacts i kwestie prawne

- Stare klienty nie zapiszą name/handle/BIO i nie prześlą zdjęć (400/410). Publiczny JSON nie zawiera BIO. Katalog zmienia wizualizację sześciu kluczy, ale nie ich przypisanie.
- Nowy runtime wymaga addytywnej schemy **przed** publikacją nowych readerów; samo OFF nie czyni brakującej tabeli bezpieczną. Warianty7–16 dopiero po kompatybilnym WS/WWW/APK. Rollback czytników przed aktywacją wariantów prostszy; po aktywacji stary WS może nie znać10 kluczy.
- Po świadomie zatwierdzonym cleanup stare zmienione URL mogą dać not-found. Brak archiwum tożsamości/aliasów. Cleanup nie jest odwracany backupem publicznych danych użytkownika; przed wykonaniem inwentaryzacja i standardowa zabezpieczona gotowość odtworzenia.
- Historyczne Storage URL mogą pozostać dostępne aż do osobno autoryzowanego, istniejącego purge; nowa projekcja ich nie publikuje. Nie wykonywać purge/HTTP w transakcji cleanup. Znane capability/manifesty i Auth-last V2 zachowane.
- Po aktywacji Terms nowy klient otrzyma409 `terms_required`; starszy może pokazać ogólny błąd. Aktualny frontend musi być dostępny razem z aktywacją. Nie przerywać istniejących rozdań.
- LEGAL/OWNER: moment zawarcia umowy po email confirmation/OAuth, obowiązkowy pojedynczy krok i wyjątek kontynuacji gry; wystarczalność zamkniętych entrypoints, dostępność bez zgody safety/deletion/support; podstawa i czas retencji receipt/dawnych zdjęć/ograniczonych dowodów księgowych; oba języki i wersjonowane Terms do ostatecznego zatwierdzenia **przed** `enable-terms.sql`. Teksty są przygotowaną propozycją, nie opinią prawną ani zapewnieniem zgodności Play.
- Brak Google photo import w A. Faza C wymaga B i osobnej dobrowolnej zgody; suppression po cleanup/wyborze katalogu nie może blokować późniejszego świadomego reconsent ani obchodzić moderatora. Brak nowych decyzji foto w Terms receipt.

## Następna bramka — wymagane osobne GO

1. Owner review lokalnego kodu/SQL/dokumentów; zgoda na utworzenie/aktualizację PR dopiero po zaakceptowaniu poniższych skutków automatyki. Nie ma obecnie nowego PR.
2. `.github/workflows/db-stage-apply-pr.yml`: dotknięcie `supabase/migrations/**` w same-repo non-Draft PR do main uruchamia **mutujący** `DB Stage Apply PR` na zdarzeniach PR `opened/synchronize/reopened`. `draft==false` jest warunkiem joba; Draft skip przed runnerem. Sam `ready_for_review` nie jest dodanym typem zdarzenia — nie zakładać, że samo zdjęcie Draft wykona apply. Po osobnym GO potrzebne kontrolowane zdarzenie obsługiwane przez istniejący workflow, bez zmiany jego zabezpieczeń. `db-stage` serializuje, ale nie nadaje zgody. Pinned Stage musi być potwierdzony, bez kolizji/running migrations i bez automatycznego cleanup/activation.
3. Osobno autoryzowany wczesny Stage A: zastosować tylko addytywną schema przez istniejący workflow i sprawdzić role/RLS/granty/FK/deletion, policy OFF, stare6 provisioning i brak zmian finansowych. Przygotować zgodne Netlify/APK readers. Produkcyjny manifest zawiera wyłącznie forward-only inventory z hashem, nie zezwolenie apply; odpowiednik/ścieżka Production wymaga osobnego review.
4. Wspólny WS Preview: read-only occupancy/ludzkie miejsca/pending operations/escrow/Redis/Supabase/kolizje, następnie **osobne GO exact-SHA WS Preview Deploy** (definicja main, aplikacja z aktualnego runtime SHA), releaseSha/PID/hash/health. Krótko: nowy JOIN pending Terms odrzucony przed debit; akceptacja→nowe wejście; istniejący Resume/reconnect/Leave bez przerwania gry; reakcja/gift Terms i publiczna projekcja. Finansowane testy wymagają jawnego GO, bez rzeczywistego Account Deletion/fault injection i bez szerokiej kampanii.
5. Dopiero dowód zgodnych aktywnych readerów pozwala na osobno autoryzowane `enable-catalog.sql` i kontrolę trwałych nowych przypisań. Następnie read-only `inventory.sql`, akceptacja liczb/proweniencji, osobne GO jednorazowego `normalize-profiles.sql`, porównanie UUID/CH/XP/wariantów i kont w deletion. Contract/drop i Storage purge mają własne bramki; żaden alias nie powstaje.
6. Legal/owner akceptuje wersjonowany tekst przed osobnym `enable-terms.sql`; końcowy mały Stage/Android smoke. W razie realnej zmiany runtime po WS dowodzie ponownie ocenić exact-SHA gate, nie uznawać samego Netlify za dowód WS.
7. Production/deploy/merge/publikacja APK oraz B–D nadal wymagają osobnego GO. Merge zmian WS/Netlify może automatycznie wdrożyć/restartować Production; nie traktować zatwierdzenia lokalnego kodu jako zgody na taki skutek.

**Werdykt: lokalna faza A przygotowana do review; Stage/WS/legal/Production pozostają OPEN. Nie MERGE READY i nie Google Play release-ready.**

**Schema-first również przy Terms OFF:** nowy runtime zawsze odczytuje `private.profile_terms_policy` i receipts. Addytywna schema i nowe pola profilu muszą istnieć przed uruchomieniem nowych readerów; OFF nie zabezpiecza starej schemy. Końcowa korekta legal, odczyt Production i bezpieczna propozycja Draft: [review-final-legal.md](review-final-legal.md). Bez wykonania kolejnej bramki.
