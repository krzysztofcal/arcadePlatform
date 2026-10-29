# Końcowa korekta legal / schema precondition

2026-10-26. Niezależny review właściciela dla `7840ad2351638b229be5a5986e527dc6d76aff26`: warunkowy PASS. Ta korekta dotyczy wyłącznie dokumentów prawnych, testu istniejącego warunku schemy i raportu. Bez nowych funkcji, zmian runtime JS/SQL, push/PR, Stage Apply, WS Preview, cleanupu lub deploymentu.

## Aktualny odczyt Production

- Netlify `playkcswh`: aktualna konfiguracja `ACCOUNT_DELETION_ENABLED=1` w kontekście Production, scopes builds/functions/post_processing/runtime. Nie jest OFF. Odczyt ograniczono w raporcie do tej niesekretnej flagi aktywacji; nie publikowano innych wartości środowiska.
- Aktywny Production deploy `6adf43aa3debf6e93a3fa53a`, ready/main, commit `a63e44b0d9a1d3625956ed98b75c1242989efdd3`.
- Publiczny read-only GET `https://play.kcswh.pl/.netlify/functions/account-delete` z prawidłowym Origin zwraca401 `unauthorized`. Według wdrożonego kodu kontrola flagi następuje przed Auth i przy OFF zwróciłaby503 `account_deletion_unavailable`; obserwacja potwierdza włączoną bramkę funkcji Netlify, nie wykonanie całego procesu usunięcia.
- WS Production: active, PID386175, start2026-10-26 12:10:53 UTC; `/healthz` odpowiada `ok`; istniejący chroniony read-only preflight: `PASS LIVE Redis V3 prod`.
- Środowisko procesu WS jest chronione; nie odczytano jego flagi ani nie obchodzono uprawnień. Nie sprawdzano tu DB deletion release, dostawcy Auth-last ani pełnego deletion lifecycle i nie oznacza się ich jako PASS. Nie logowano konta Production, nie wysyłano POST deletion, nie restartowano usług. To celowo ograniczona weryfikacja dostępności, nie nowy destrukcyjny smoke.

Legal PL/EN zachowuje prawdziwy wniosek w Account **gdy funkcja jest dostępna** oraz niezależną, dostępną również przy OFF ścieżkę zgłoszenia/usunięcia/pomocy przez `contact@kcswh.pl`. Usunięto bezwarunkową obietnicę pełnej dostępności i wykonania. Nie zastąpiono włączonego V2 fałszywym stwierdzeniem, że funkcja dopiero jest planowana. Retencja pozostaje jawną legal gate.

## Wersja i treść Terms

Canonical i wersjonowane Terms PL/EN mają datę26-10-2026/2026-10-26, wersję `2026-10-26-a1` zgodną z `shared/profile-terms.mjs`, addytywnym SQL, operacją aktywacji i listą dokumentów APK. Privacy PL/EN ma również aktualną datę26-10-2026. Wersja a1 nie była publikowana ani aktywowana w tej lokalnej fazie; nie zmieniono wersji historycznie zaakceptowanego dokumentu.

Porównano treść `<main>` canonical i wersjonowanego dokumentu osobno dla PL i EN: identyczna. Wszystkie lokalne linki w wersjonowanych dokumentach istnieją, `mailto` wskazuje `contact@kcswh.pl`. Usunięto tylko zdublowany main-only link zarządzania cookies, który w statycznym snapshot bez JS był nieaktywny; działający manager pozostaje w stopce canonical WWW. Brak nowego skryptu lub systemu dokumentów. Dotychczasowe ograniczenia prawne aktywacji pozostają otwarte.

## Bezwzględny warunek przed uruchomieniem nowego kodu

**Terms OFF nie jest obejściem odczytu bazy. `readTermsStatus()` zawsze czyta `private.profile_terms_policy` i receipts. Kompatybilna addytywna schema (łącznie z nowymi polami profilu) MUSI istnieć i być zweryfikowana PRZED uruchomieniem nowych readerów HTTP/WS/APK przeciwko temu środowisku. Nie wolno wdrożyć runtime na starej schemie licząc, że `active=false` go zabezpieczy.**

Istniejący test wykazywał działanie OFF na istniejącej schemie, ale nie brak tabeli/wiersza. Dodano minimalne asercje do tego samego fundamentalnego testu: po potwierdzonym OFF usunięcie widoczności tabeli w PGlite powoduje42P01, a brak wiersza polityki powoduje503 `terms_unavailable`. Nie dodano fallbacku ani nowej logiki runtime; test zabezpiecza prawdziwą zależność wdrożeniową.

## Wyniki i self-review

- Fundamentalne profile/Terms:10 PASS,0 FAIL,0 skipped; w tym nowe asercje schemy przy OFF.
- Canonical/version/date/local links/mailto PL/EN: PASS.
- CSP inline:58 dokumentów PASS; kontrola119 migracji i11 odpowiedników Production PASS, bez DB Apply.
- Runtime JS, SQL migracji, Auth, finanse, betting/settlement, Account Deletion i Storage bez zmian względem niezależnie sprawdzonego SHA. Nie powtarzano gameplay lub szerokich kampanii.
- Treść prawna nadal wymaga końcowej akceptacji właściciela/LEGAL przed aktywacją; odczyt flagi nie stanowi opinii prawnej ani dowodu wykonania deletion.

## Bezpieczna propozycja następnej operacji — Draft PR, osobne GO

1. Zatwierdzić końcowy lokalny SHA i osobno autoryzować publikację gałęzi oraz utworzenie PR **od początku jako Draft**, base main. Nie tworzyć najpierw Ready i dopiero potem zmieniać na Draft.
2. Przed publikacją ponownie sprawdzić live definicję `.github/workflows/db-stage-apply-pr.yml`. Zweryfikowany obecnie blob main: `f4184f5406d6111907ca3930f7c853c090d345b7`; main nadal `a63e44b0d9a1d3625956ed98b75c1242989efdd3`. Job `apply-stage` ma warunek `github.event.pull_request.draft == false`; nie ma `pull_request_target`. PR nie modyfikuje tego workflow.
3. Po otwarciu Draft oczekiwany run `DB Stage Apply PR` może powstać, ale **mutujący job musi być SKIPPED przed przydzieleniem self-hosted runnera**. Potwierdzić to rzeczywiście w GitHub. Nie uruchamiać ręcznego `DB Stage Prepare` (tylko workflow_dispatch) ani joba apply inną drogą. Nie wyłączać i nie obchodzić zabezpieczeń.
4. Zostawić Draft; bez przełączenia na Ready i bez kolejnych zdarzeń non-Draft ze zmianami migracji przed osobnym Stage GO. Sam Draft nie jest zezwoleniem na apply. Nie polegać na anulowaniu już uruchomionej migracji ani na tekście skip w tytule.
5. Jawny skutek uboczny publikacji: standardowe CI/Netlify Deploy Previews mogą się uruchomić, a istniejący `Android Poker M0 APK` ma job dla same-repo Draft i może utworzyć debug APK w CI. To nie Google Play/Production. Właściciel powinien uwzględnić te artefakty w GO na PR; jeśli ich nie akceptuje, odłożyć publikację zamiast samodzielnie zmieniać workflow. Nie używać nowego Preview do Auth/gameplay przed zgodną schemą Stage i nie traktować builda jako dowodu działającego WS.
6. Dopiero osobne Stage GO: schema-first i weryfikacja, zgodne readery, potem osobno autoryzowany exact-SHA WS Preview zgodnie z planem. Żadnego cleanup/drop/Storage purge ani Production w ramach samego Draft PR.

**Teraz nie wykonano publikacji PR ani żadnej z powyższych kolejnych operacji.**
