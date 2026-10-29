# Phase A — skonsolidowany lokalny diff, 2026-10-28

> **Aktualizacja legal-docs:** kompletne teksty z Krzysztof Cal i oficjalne potwierdzenie Netlify DPA; wcześniejsze placeholdery/żądania dodatkowego audytu dostawców są historyczne. Aktualne3decyzje i ryzyka: [finalizacja](g-legal-a-finalization.md). Brak publikacji/LEGAL PASS.

## Granica i źródło

PR #1155 nadal Draft, remote HEAD `631867186ff5efed7f62bdb10b5e439fc6842915`. Lokalny merge commit `04bcad1d` zawiera aktualny main `0f77574d74945aa3b64b4e5e81494e621d7b2794`; pozostałe przygotowane zmiany są niecommitowanym diffem. Bez push, Stage/Production SQL, aktywacji, receipts, deploy, APK/WS restartu, Ready lub merge PR. Nie rozpoczęto B/C/D. Zachowano wcześniejsze lokalne prace G-LEGAL-A zamiast je odtwarzać.

## Gotowe lokalnie

1. Synchronizacja main; AdSense/CSP z #1156 zachowane. Active legal HTML i `mobile/**` bez zmian. Brak nowych plików migracji; historyczne120 plików nietknięte.
2. `shared/profile-terms.mjs::cleanupExpiredGuestReceipts(tx)` wyodrębnia dawny opportunistic delete. Do100 kandydatów guest/expired; tylko delete receipts. Próby canonical guest advisory lock i osobnej blokady przebiegu unikają oczekiwania na acceptance/inny worker. Nie używa SELECT FOR UPDATE, które wymagałoby dodatkowego UPDATE grant na receipts; działanie potwierdzone na rzeczywistych ograniczonych SELECT/INSERT/DELETE ACL. Dodatkowy predykat expired przy DELETE, brak usuwania account/live receipts.
3. `ws-server/server.mjs::runGuestReceiptCleanupTick()` używa istniejącego maintenance25s, niezależnie od obu flag i nowych akceptacji, z single-flight/finally, osobną transakcją i lock250ms/statement2s. Błąd logowany tylko stałym kodem przez klogSafe, bez danych lub blokowania gry. Zachowany cleanup przy accept. Nie ma gwarancji ściennego TTL podczas postoju/backlogu/awarii.
4. T010: usunięto martwy `normalizeHandle()` i jego eksport/test oraz nieosiągalne stare kody ręcznej edycji w `profile-me`. Wyszukanie rzeczywistych referencji wykazało brak użycia normalizera w bieżącym writerze, natomiast `findPublicProfile` nadal waliduje linki przez regex/reserved set. BIO nie występuje w aktualnych SELECT/UPDATE/projekcjach; historical migrations/normalization fixtures zachowane. `updateUserAvatarKey` nadal wywołuje historyczny pipeline i testy Deletion/Storage, więc jego usunięcie byłoby szerszą zmianą. Zachowano `_shared/profile-avatar.mjs`, V2/V3, capabilities, revision/suppression i endpointy410; brak purge.
5. Cztery propozycje a2, manifest, mapa podstaw, LIA i konkretne braki dostawców/retencji w `legal-drafts/` i `g-legal-a-lia.md`. Nie opublikowano placeholderów ani nowej wersji. Brak AdSense jest faktem Production, nie przyszłym warunkiem.
6. `operations/enable-terms.sql`: Stage/system pin, potwierdzenie operatora, manifest120/120, post-normalization/BIO-contract/catalogON/TermsOFF, poprzednia wersjaa1, poprawne aktualne reader/document pins i fingerprinty. Jedna przyszła atomowa aktualizacja policy `version=approved_version,active=true`, bez konwersji starych receipts. Exact approved version/readers nadal mają sentinele, więc rzeczywisty skrypt odmawia wykonania. Wersjaa2 jest kandydatem, nie approval.

## Status zadań — nie mylić z odbiorem

| Zadanie | Stan rzeczywisty |
|---|---|
| T001 | OPEN: decyzje prawne/tożsamość/publikacja/retencja; plan i techniczny zakres A przyjęte |
| T010 | G1/G2 Stage BIO-only contract PASS120/120; lokalny referencyjny cleanup przygotowany i testowany; końcowy odbiór A OPEN |
| T012 | COMMITTED/PASS owner, bez powtarzania operacji |
| T033 | Schema/API/WS rollout/recovery i dotychczasowy APK/avatar16 owner PASS; nowy cleanup WS i przyszłe dokumentya2/APK/TermsON acceptance OPEN |

G2 historycznie zachował51 kont, handle_customized_at i chronione dane; ten przebieg nie czytał ponownie danych ani nie nazywa nowego kodu wdrożonym. Obecny WS Preview ea178bb3 i zaakceptowany APK e370e461 są historycznie sprawne, lecz nie zawierają tego nowego WS cleanup ani dokumentówa2. Nie potrzeba ponownego telefonu dla już przyjętych avatarów; przyszły nowy APK służy tylko nowej legal wersji.

## Self-review i breaking impacts

- Aktualny SQL schema/CAS/lifecycle→policy→profile, finanse, guest gameplay i paid replay bez zmian. Cleanup nie blokuje lifecycle/profile/policy; bierze tylko nieblokujące retention/guest advisory locks i usuwa wygasłe dowody. Nie zwiększa wymaganego ACL ani liczby profili. Retencja guest zmienia fizyczny czas przechowywania po wdrożeniu i wymaga exact-SHA WS Preview.
- Nowy Terms version wymaga nowego świadomego receipt, nie nadpisania a1 ani autozgody. Resume/reconnect istniejącej gry, rozliczenie, Leave, logout/deletion/support/privacy opt-out pozostają dostępne. Nie zmieniać bet/hand settlement ani żądać nowego buy-in dla odbioru.
- Przy push diff shared/server klasyfikuje deploy_ws=true. Zwykłe późniejsze merge/push main może uruchomić WS Production i Netlify; bieżące GO tego nie dopuszcza. Nie wysyłać szkiców z placeholderem do publikowanego root. Wydany APK pakuje tylko a1; sam server version switch nie dowodzi prezentacji a2 w APK.
- LIA obecnego publicznego profilu przed Terms nie jest PASS; OWNER odrzucił opt-in/ukrywanie; model publiczny pozostaje. Zaktualizowana LIA proponuje wyłącznie jasną informację i nazwę istniejącej akcji przed signup; brak implementacji i brak LEGAL PASS.
- Production nadal wymaga osobnego schema-first kompatybilnego runtime i osobnego GO. Nie stosować odpowiednika Production SQL w tym przebiegu.


## Wyniki fundamentalne — rzeczywiste lokalne wykonanie

- RED: test nowego helpera odrzucił brak eksportu przed implementacją. GREEN: profile-phase-a/public-profiles/account-deletion-storage **57/57 PASS, 0 skipped**, standardowe XP_TEST_MODE i jawny testowy CORS, bez realnych API. Log `/tmp/pr1155-final-fundamental.log`.
- PostgreSQL **17.11**, disposable system `7701225723289707303`, loopback55465: bounded retention **1/1 PASS, 0 skipped**.102 wygasłe syntetyczne guests, account/live/invalid-no-expiry zachowane, jedna równoległa blokada sweep i jedna rzeczywista guest acceptance/renewal z drugiego połączenia pomijane, powtórny sweep0, chronione markery profilu/Auth/CH/XP/Poker/Storage i policyOFF identyczne. Ograniczona rola SELECT/INSERT/DELETE potwierdza brak wymagania UPDATE grants. To fundamentalny syntetyczny kontrakt, nie nowa live regresja finansowa.
- Ten sam izolowany PostgreSQL: activation **1/1 PASS, 0 skipped**. Rzeczywisty Stage SQL z sentinelami odmawia; tylko pamięciowy fixture aprobujea2/pins/system/manifest. Błędna tożsamość, każdy niezatwierdzony pin API/WS/APK/documents osobno (także przy dopasowaniu sentinel do attestation), reader drift,120-manifest/policy/receipt drift, konkurencyjna aktywacja i2s lock-timeout odmawiają; późny wyjątek/niepożądany trigger write robią pełny rollback. Sukces: jedna UPDATE policy a1OFF→a2ON, stare receipts i profile/chronione markery identyczne; ponowne ON odmówione. Brak połączeń Stage/Production. Skrypt SHA256 **6872f0f79f15fa655635b165d146981e9fa3d24ac3336624b520d9943b285a7a**.
- `syntax-check` **234 files PASS**; CSP **58 served +4 standalone PASS**; istniejący CSP behavior i static-html **PASS**. Brak nowych inline scripts, zmian CSS lub SRI/active legal HTML. Mobile security **3/3 PASS**, bez builda. Poprawiono trailing whitespace w nowych nagłówkach dokumentacji; końcowy diff check0.
- Izolowany PG uruchomiono tylko dla tych testów, następnie zatrzymano. Nie usunięto danych/katalogów; dysk5.7GB przed/5.6GB po. Żadnych ciężkich testów równolegle, instalacji SDK/pakietów lub globalnego Node.
- Main jest przodkiem lokalnej gałęzi; CSP/consent/klaro z #1156 byte-identical z main. `git diff HEAD -- legal mobile supabase/migrations` pusty: brak nowego APK lub DDL w tej pracy. CI impact rzeczywistego nowego runtime wymaga `deploy_ws=true`; nie uruchomiono żadnego workflow/push. Remote #1155 nadal63186718/Draft, więc **nie ma nowego CI/Hosted PASS dla lokalnego diffu**.

### Istniejący WS JOIN test — lokalny FAIL, bez ukrywania wyniku

`ws-tests/ws-join-runtime.behavior.test.mjs`:11 testów,1 PASS/10 FAIL; wszystkie uruchomienia serwera nie zgłosiły gotowości w5s, przed asercjami JOIN. Tak samo na istniejących Node22.23.1 i systemowym Node20.20.0 (workflow używa20), bez zmiany globalnego Node. Pojedynczy kontrolowany start z czystym syntetycznym env i bez credentials nie loguje gotowości. Oryginalne `HEAD:ws-server/server.mjs` **oraz** `HEAD:shared/profile-terms.mjs` podstawione wyłącznie pamięciowym loaderem wykazują ten sam timeout. Zmiana cleanup nie jest dowiedzioną przyczyną; dokładnej przyczyny blokady importu/startu nie ustalono. Nie zmieniono kodu startup, timeoutu ani oczekiwań testu, nie wykonywano JOIN na Stage. Zakończono tylko własne testowe dzieci, nie usługi WS. Logi `/tmp/pr1155-final-ws-join*.log`, kontrola `/tmp/pr1155-ws-startup/`. Ten wynik ogranicza lokalny runtime odbiór, nie unieważnia wcześniejszego owner Stage PASS; standardowe hosted WS PR Checks muszą być zielone przed następnym deploymentem. Nie deklarować wszystkich testów/CI PASS.

## Jedno następne skonsolidowane GO — po trzech decyzjach w README

Zakres jednego GO może autoryzować cały warunkowy odbiór Stage, bez mikro-zgód:

1. Uzupełnienie zatwierdzonej tożsamości/treści/retencji i prawnego uzasadnienia zachowanego domyślnie publicznego modelu (bez opt-in/nowego przełącznika); zamrożenie a2/manifestu. Nowe versioned Terms/Privacy, aktualne aliasy i istniejący APK legalPages, CSP/SRI. Zachowaća1 i stare receipts. Nie publikować żadnych roboczych placeholderów.
2. Targeted fundamental checks, push tylko #1155/Draft i standardowe CI/Netlify Preview. Przed push potwierdzić DB Stage Apply SKIPPED:120/120 bez pending DDL, bez label/dispatch zbiorczego apply. Żadnego nowego DDL z tej propozycji.
3. Wspólny WS Preview preflight: aktualne Stage/RedisV3, brak człowieka/reconnect seat/niezamkniętych finansów; boty nie blokują. Świeży backup5katalogów + hash/restore próba i istniejąca sprawdzona ochrona stop→sync→restart→health/recovery przy błędzie, a nie niechroniony rsync do żywego procesu. Definicja workflow main, dokładny nowy runtime SHA, xpRedisVersion3. Bez Production, nowych finansowanych komend lub zmiany WS architektury.
4. Hosted Android debug APK z dokładnie zgodnymi a2, API1155/StageSupabase/WSPreview. Sprawdzić receipt/hash/podpis; bez wymagania ponowienia przyjętych scenariuszy avatarów.
5. Niezależnie od SQL odczytać deploy metadata WWW/API, release WS i manifest APK/documents. Dopiero rzeczywiste zgodne tuple pozwalają wypełnić reader pins i approved version w operacyjnym SQL; obecnych sentineli nie zastępować danymi „na oko”. Zweryfikować ostateczny SHA256 i120/120/history/system, TermsOFF/catalogON, stan receipts/profili i brak konkurencyjnego DDL. Finalny pinowany plik jest częścią wykonania tego samego GO.
6. Jedna transakcja activation version+active, z rollback przy błędzie i bez retry. Po COMMIT niezależny readback/fingerprinty. GO powinno jawnie obejmować kontrolowane wyłączenie active=false przy błędnej opublikowanej aktywacji, bez cofania wersji lub kasowania receipts; jeśli to nie zostało zatwierdzone — STOP i raport, bez samowolnej naprawy.
7. Ograniczone acceptance na dedykowanym koncie i osobnej testowej tożsamości guest: current-version server receipt oraz identyczny replay, brak zgody blokuje nowe chronione API/UGC bez skutków ubocznych; kontynuacja/safety zachowana. Bez tworzenia stołu, finansowanego JOIN/buy-in/gift/CH/XP/deletion. Live denial nowego JOIN tylko jeżeli fixture/preflight gwarantuje brak zapisu; w przeciwnym razie istniejący syntetyczny test jest dowodem odmowy. Manualny telefon: wyświetlenie a2/Privacy i jeden accept, brak ponownego monitu; nie potrzeba nowej gry.

Po odbiorze utrzymać Draft i zatrzymać się przed Production/merge. Jeżeli jedna z trzech decyzji nie jest rozstrzygnięta, wolno odebrać sam kod retencji na Stage, ale nie wolno nazywać całej fazy A zakończoną ani aktywować Terms pod niezaakceptowanym tekstem.


## OWNER GO — informacja przed signup i Google (lokalnie, 2026-10-28)

Zatwierdzony tekst PL/EN w account.html przy signupForm oraz przed googleSignInButton; pod nim istniejące językowe Terms/Privacy (signup reuse istniejącej pary). Jedna fraza publicProfileSignupNotice w js/i18n.js, standardowe data-i18n/data-href PL/EN; account-note bez CSS. js/account-page.js pokazuje googleProfileNotice z tą samą flagą googleEnabled co Google, bez duplikacji przycisku lub zmiany OAuth. Dodano aria-describedby; brak nowych handlerów inline/CSP hashów i SRI do zmiany. Sign up i Continue with Google zachowują dotychczasowe etykiety/flow. Google photo poza A, komunikat nie zapisuje zgody/receipt.

Source entry scan: signUp/signInWithGoogle w auth adapterze wywoływane przez ten Account; brak drugiego signup w mobile. Istniejący mobile/poker/package-web.mjs pakuje account.html i te same JS/i18n, zachowuje formularze oraz językowe legal links. Nie zmieniono packagera ani nie wykonano builda: już zainstalowany APK nie dostaje nowej informacji bez przyszłego osobno zatwierdzonego builda. Signup/email confirmation/OAuth callback/PKCE i backend provisioning bez zmian.

Fundamentalne istniejące account-auth/account-page/mobile-security:51/51 PASS; syntax234, CSP58+4 i diff-check PASS. Brak nowych testów layoutu, realnego signup/OAuth, receipts lub mutacji środowisk. Self-review: tekst przed akcjami, poprawne linki i język, Google nadal login/signup, existing privacy/default/public profile/CH/XP bez zmian. Produkt OWNER zamknięty; art.25(2), dzieci i prawne uzasadnienie publikacji WWW pozostają OPEN. Wcześniejsza propozycja ukrywania/opt-in nie jest zadaniem ani prerequisite implementacji. Nie powtarzano wcześniejszych audytów ani WS testu; wcześniejszy lokalny timeout startup pozostaje odnotowany, nie jest nowym wynikiem tego patcha.
