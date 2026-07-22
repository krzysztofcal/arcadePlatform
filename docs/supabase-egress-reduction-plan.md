# Supabase Egress Reduction Plan

Issue: [#735](https://github.com/krzysztofcal/arcadePlatform/issues/735)

## Task 1 — Ustalenie źródła egressu

### 1.1 Rozdzielenie prod/stage

Ustalić, który projekt (`arcade-portal` vs `arcade-portal-stage`) generuje większość egressu.

- Odczytać dane z Supabase Dashboard → Organization → Usage → Total Egress. Wybrać okres 26 cze–26 lip 2026. Osobno wybrać `arcade-portal` i `arcade-portal-stage` z project dropdown. Po najechaniu na dzień widoczny jest podział według usług.
- Wynik: dokument z dziennym rozkładem egressu per projekt.

### 1.2 Korelacja pików egressu z aktywnością

Dopasować skoki egressu do konkretnych zdarzeń.

- Porównać dzienne wartości egressu z:
  - datami deployów (Netlify deploy log);
  - godzinami lokalnego developmentu (harmonogram pracy);
  - historią WS Preview Deploy;
  - sesjami testowymi/manual smoke test;
  - dostępem do admin dashboard.
- Sprawdzić, czy piki pokrywają się z dniami roboczymi czy są stałe również w weekendy (co sugerowałoby automatyczny polling/crony).
- Wynik: mapa korelacji dziennej.

### 1.3 Kategoryzacja ruchu

Ustalić, która warstwa Supabase generuje ruch.

- Z dashboardu Supabase (Organization → Usage → Total Egress, po najechaniu na dzień) odczytać podział na kategorie pokazane w UI:
  - Database Egress — PostgREST/Data API, w tym zapytania przez supabase-js z przeglądarki;
  - Shared Pooler Egress — połączenia backendowe przez Supavisor/connection pooler (w tym zapytania przez `SUPABASE_DB_URL` z Netlify Functions i WS servera);
  - Auth;
  - Storage;
  - Realtime;
  - Edge Functions;
  - inne kategorie pokazane w dashboardzie.
- Wynik: procentowy lub bezwzględny podział ruchu per kategoria.

### 1.4 Szczegółowa analiza top konsumentów

Zawęzić do konkretnych endpointów i wzorców. Kolejność źródeł danych (od najbardziej wiarygodnego):

1. **Supabase dashboard** — jedyne pewne źródło historycznego egressu. Free plan może nie pokazywać podziału na endpointy, source IP ani top queries.
2. **Supabase Log Explorer / Postgres Logs** — mogą wymagać wyższego planu. Jeśli dostępne: request count, ścieżki, statusy, source IP. **Nie** zawierają response size.
3. **Advisors Query Performance** (jeśli dostępne) — częste zapytania i średnia liczba zwróconych wierszy.
4. **Netlify Function logs** — request count i trwanie dla każdej funkcji. Dostępne w Netlify dashboard.
5. **Logi WS servera** — `klog` z `ws-server/server.mjs` (jeśli logi są zbierane).
6. **Kontrolowany scenariusz reprodukcyjny** — odtworzyć typową sesję i obserwować przyrost egressu w dashboardzie.
7. **Tymczasowa telemetria punktowa** — tylko jeśli powyższe nie wystarczą (patrz sekcja Telemetria po Task 3).

Nie obiecywać historycznego podziału per endpoint, jeśli retencja logów już wygasła.
Wynik: posortowana lista konsumentów egressu z dowodami (lub z udokumentowanymi lukami w danych).

---

## Task 2 — Bezpieczeństwo i dostęp

### 2.1 Audyt RLS i uprawnień

Wykluczyć nieautoryzowany dostęp.

Dla każdej tabeli dostępnej przez publiczny Supabase API:

- Sprawdzić, czy RLS jest włączone (`ALTER TABLE ... ENABLE ROW LEVEL SECURITY`).
- Przejrzeć wszystkie policy pod kątem nadmiernych uprawnień dla `anon` i `authenticated`.
- Zweryfikować, które tabele są w ogóle dostępne przez REST API (supabase-js z przeglądarki).

**Pliki do sprawdzenia**: Migracje w `supabase/migrations/` — szczególnie `CREATE POLICY` i `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`.

### 2.2 Weryfikacja sekretów

Wykluczyć wyciek kluczy.

- `SUPABASE_SERVICE_ROLE_KEY` — czy występuje w kodzie przeglądarkowym (`js/`), wygenerowanych assetach, `_headers`, `netlify.toml`?
- `SUPABASE_DB_URL`, `SUPABASE_JWT_SECRET` — czy są w historii repo (nawet usunięte)?
- Sprawdzić konfigurację obu środowisk (każde ma własne zmienne):
  - **Netlify production env** — `SUPABASE_DB_URL`, `SUPABASE_URL`, `SUPABASE_JWT_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`.
  - **Netlify deploy preview / branch deploy env** — osobne zmienne dla stage.
  - **WS production** (`ws-server.service` na VPS) — własne `SUPABASE_DB_URL`, `POKER_WS_INTERNAL_TOKEN`.
  - **WS preview** (`ws-server-preview.service` na VPS) — własne zmienne, powinny wskazywać stage.
- `admin-stage-identity.mjs:68-70, 89-90` może potwierdzić konfigurację widzianą przez Netlify Function, ale nie zastępuje przeglądu wszystkich czterech środowisk powyżej.
- Potwierdzić, że production i stage nigdy nie współdzielą `SUPABASE_DB_URL`.

---

## Task 3 — Inwentaryzacja podejrzanych zapytań

### 3.A `loadPersistedTableSnapshots()` — pełny state JSONB w admin dashboard

- **Plik**: `netlify/functions/_shared/admin-ops.mjs:227-273`
- **Wywoływane przez**: `admin-tables-list.mjs:139`, `admin-ops-summary.mjs:154`
- **Co robi**: Dla batcha `tableIds` (wszystkie stoły na stronie admina) wykonuje 3 osobne zapytania:
  1. `poker_tables` — metadata (id, stakes, status, max_players, timestamps)
  2. `poker_state` — `select table_id, version, state, updated_at` — ładuje CAŁY JSONB `state` (zawiera stacks, board, hand history, deck, hole cards, ...)
  3. `poker_seats` — wszystkie seaty
- **Do czego potrzebny jest `state`**: Tylko do klasyfikacji janitora (`evaluatePersistedTableSnapshot` → `evaluateTableHealth`). Janitor używa ze state tylko:
  - `state.phase` (`table-janitor.mjs:94, 195`)
  - `state.turnUserId` (`table-janitor.mjs:197`)
  - `state.turnDeadlineAt` (`table-janitor.mjs:201`)
  - `state.leftTableByUserId` (`table-janitor.mjs:99-100`)
- **Podejrzenie ilości**: Przy 20 stołach na stronę admina, każdy refresh ładuje 20× pełny JSONB state.
- **Do pomiaru**: Na stage/prod wykonać:
  ```sql
  SELECT table_id, pg_column_size(state) AS stored_bytes, octet_length(state::text) AS approximate_response_bytes
  FROM public.poker_state
  ORDER BY octet_length(state::text) DESC
  LIMIT 20;
  ```
  - `stored_bytes` — rozmiar reprezentacji przechowywanej przez PostgreSQL (może być skompresowany przez TOAST);
  - `approximate_response_bytes` — przybliżony rozmiar danych zwracanych klientowi (lepsze przybliżenie egressu);
  - żadna z wartości nie uwzględnia narzutu protokołu wire.

### 3.B Wojna zapisów poker state — conflict reads

- **Plik (Netlify)**: `netlify/functions/_shared/poker-state-write.mjs:27-49`
- **Plik (WS)**: `ws-server/poker/persistence/persisted-state-writer.mjs:630` (analogiczne)
- **Co robi**: Przy zapisie używa `RETURNING version` (tylko integer — OK). Ale przy konflikcie (CAS fail) robi:
  ```sql
  select version, state from public.poker_state where table_id = $1 limit 1;
  ```
  co zwraca CAŁY `state` JSONB tylko po to, żeby porównać przez `stableStringify`.
- **Pytanie do pomiaru**: Jak często występuje konflikt? Jeśli rzadko — znikomy wpływ. Jeśli często (dużo bot action + human action w tym samym czasie) — może być istotne.
- **Uwaga**: Zapis (`RETURNING version`) to głównie ingress. Konfliktowy odczyt to egress.

### 3.C Bootstrap i odczyty DB WS servera

**Uwaga**: Należy rozdzielić trzy różne ścieżki — tylko pierwsze dwie generują Supabase egress:

**3.C.1 DB bootstrap (Supabase egress) — call graph potwierdzony**

- **Plik**: `ws-server/poker/bootstrap/persisted-bootstrap-repository.mjs:47-49`
- **Co robi**: Ładuje `select version, state from public.poker_state` — pełny JSONB.
- **Callery** (w `ws-server/server.mjs`):
  - Linia 1269: flow `createTable` / join stołu
  - Linia 1800: flow table recovery
- **Nie występuje przy**: Zwykłym reconnect — linia 2906 używa pamięci procesu.
- **Do pomiaru**: Jak często wywołania w liniach 1269 i 1800 faktycznie docierają do DB? Ile razy dziennie?

**3.C.2 DB recovery po konflikcie (Supabase egress)**

- **Plik**: `ws-server/poker/persistence/persisted-state-writer.mjs:706`
- **Co robi**: `select version, state from public.poker_state` przy nieudanym CAS — pełny JSONB.
- **Kwestia**: Pokrywa się z 3.B — mierzone razem z conflict reads.

**3.C.3 Resync z pamięci (NIE jest Supabase egress)**

- **Plik**: `ws-server/server.mjs:2906-2918` — `tableManager.persistedPokerState(tableId)`
- **Co robi**: Odczytuje stan z pamięci procesu WS (nie z DB) i wysyła go klientowi przez WebSocket.
- **Transfer**: WS server → przeglądarka (VPS bandwidth, nie Supabase egress).
- **Nie jest objęty metryką issue #735** — chyba że `persistedPokerState()` wykonuje dodatkowe zapytanie DB (do zweryfikowania w kodzie `table-manager`).

Do pomiaru: oddzielić częstotliwość bootstrapu (DB) od reconnectów użytkownika (pamięć).

### 3.D Leaderboardy i statusy XP

- **Plik**: `js/xpClient.js:794-816` (`fetchStatus`)
- **Wywoływane przez**: `refreshBadgeFromServer` (linia 818-841), `scheduleInitialStatusRefresh` (linia 574-579)
- **Ruch**: Każda strona z badge XP robi `POST calculate-xp {operation:"status"}` → odczyt `xp-ledger` i `xp-leaderboard` w Supabase.
- **Pytanie**: Ile razy dziennie? Czy `status` odczytuje duże payloady?

### 3.E Retry w XP client

- **Plik**: `js/xpClient.js:893` — pętla 3 prób z 500ms backoffem
- **Pytania do pomiaru**:
  - Jakie błędy wyzwalają retry (network error? 401? invalid_session? 429?)
  - Ile retry występuje dziennie?
  - Czy ponowienie próby wykonuje ponowny odczyt z Supabase?

### 3.F `returning *` w chips-ledger

- **Plik**: `netlify/functions/_shared/chips-ledger.mjs:131, 843, 939`
- **Plik**: `ws-server/poker/persistence/chips-ledger.mjs:100, 203, 287`
- **Co zwraca**: Wszystkie kolumny z `chips_accounts`, `chips_transactions`, `chips_ledger` — te tabele są wąskie (głównie integer, uuid, timestamp), więc `returning *` to prawdopodobnie małe payloady.
- **Priorytet**: Niski — do potwierdzenia przez pomiar.

### 3.G Niepotrzebna aktywność stage

Sprawdzić, czy stage generuje ruch bez potrzeby, bez wyłączania całej usługi:

- Przejrzeć `.github/workflows/` — czy są cron scheduled jobs.
- Sprawdzić, czy stage ma aktywne stoły pokerowe — `admin-tables-list` na stage deploy preview.
- Sprawdzić, czy idle WS Preview server wykonuje cykliczne odczyty DB (janitor sweep, inactive cleanup).
- Sprawdzić częstotliwość cyklu janitora na stage (parametry w `resolveJanitorConfig`).
- Sprawdzić, czy bootstrap/recovery wykonuje się bez ruchu użytkownika.
- Jeśli zostaną znalezione nieużywane stoły — zamknąć je przez admin panel.
- Nie wyłączać całego WS Preview — jest wymagane do testowania zmian w runtime WS.
- Nie ustawiać `CHIPS_ENABLED=0` globalnie na stage — zmienia zachowanie testowego środowiska.

---

### Tymczasowa telemetria punktowa (ostateczność — tylko dla ścieżek nierozstrzygniętych po Task 1 i 3)

Użyć tylko jeśli dane z dashboardu, logów i audytu statycznego nie wystarczą do identyfikacji źródła.

**Nie** dodawać globalnego logowania w `executeSql()` — zmiana sygnatury, logowanie każdego query i analiza tekstu SQL to zbyt szeroka ingerencja.

Zamiast tego dodać tymczasowe `klog` tylko w potwierdzonych podejrzanych ścieżkach:
- `loadPersistedTableSnapshots()` w `admin-ops.mjs` — logować `tableCount`, `rowCount`, `durationMs`;
- conflict branch w `poker-state-write.mjs` — logować `conflictOccurred` (licznik, nie rozmiar). Rozmiar stanu zmierzyć reprezentatywnie przy pierwszym konflikcie, a nie przy każdym zdarzeniu — conflict branch już wykonuje `stableStringify` (dwie serializacje), trzecia serializacja tylko do pomiaru byłaby dodatkowym kosztem.
- WS bootstrap repository (`persisted-bootstrap-repository.mjs`) — logować `approxStateJsonBytes` przy odczycie;
- XP status handler w `calculate-xp.mjs` — logować `durationMs`, `approxResultJsonBytes`.

Każdy `klog` logować: nazwę operacji, liczbę wierszy, przybliżony czas trwania. Nie logować SQL, parametrów ani danych użytkownika.

Po zakończeniu śledztwa usunąć lub ograniczyć logi.

---

## Task 4 — Minimalna poprawka (po zebraniu dowodów)

Dopiero po ustaleniu źródła egressu (Task 1 + 3) zaproponować najmniejszą możliwą zmianę.

### Opcja A: `loadPersistedTableSnapshots()` — projekcja pól janitora

**Jeśli głównym źródłem jest admin dashboard ładujący pełny `state` JSONB.**

Obecnie `loadPersistedTableSnapshots()` (admin-ops.mjs:227-273) zawsze ładuje:
```sql
select table_id, version, state, updated_at from public.poker_state where table_id in (...);
```
Klasyfikacja janitora (`evaluateTableHealth` w table-janitor.mjs) używa ze `state` tylko:
- `state.phase` (linia 94, 195)
- `state.turnUserId` (linia 197)
- `state.turnDeadlineAt` (linia 201)
- `state.leftTableByUserId` (linia 99-100)

**Proponowana zmiana**: Dodać opcjonalny parametr `stateProjection` do `loadPersistedTableSnapshots()`:
- `stateProjection: "janitor"` — SQL pobiera tylko:
  ```sql
  select table_id, version,
    state->>'phase' as phase,
    state->>'turnUserId' as turn_user_id,
    state->>'turnDeadlineAt' as turn_deadline_at,
    state->'leftTableByUserId' as left_table_by_user_id,
    updated_at
  from public.poker_state where table_id in (...);
  ```
  i buduje minimalny obiekt `{ phase, turnUserId, turnDeadlineAt, leftTableByUserId }` kompatybilny z `evaluateTableHealth`.
- Domyślnie (bez parametru) — nadal pobiera pełny `state` dla `loadPersistedTableSnapshot()` (używanej przez `admin-table-details`, `admin-table-evaluate`), które mogą potrzebować pełnego stanu.

**Pliki**: `admin-ops.mjs`, `admin-tables-list.mjs`, `admin-ops-summary.mjs`.
**Przed deklaracją "Breaking: brak"**: Zweryfikować, czy `evaluatePersistedTableSnapshot()` i wszystkie funkcje poniżej nie używają innych pól `state` pośrednio (np. przez destrukturyzację lub przekazanie do dalszych funkcji).
**Ryzyko**: Jeśli w przyszłości janitor będzie potrzebował więcej pól — rozszerzyć projekcję.

### Opcja B: Redukcja payloadu conflict reads

**Jeśli głównym źródłem są conflict read-y przy zapisach poker state.**

Aktualny zapis zwraca tylko `RETURNING version` (integer — OK). Pełny `state` jest czytany dopiero przy nieudanym CAS, do porównania `stableStringify` i obsługi `alreadyApplied`.

Przed wyborem rozwiązania sprawdzić:
- czy konflikty faktycznie występują (częstotliwość);
- czy ścieżka `alreadyApplied` jest kiedykolwiek wykorzystywana;
- czy można rozpoznać rodzaj konfliktu bez pobierania pełnego `state`;
- czy istniejący writer nie ma już lokalnego fingerprintu stanu;
- czy częste konflikty nie oznaczają błędu architektonicznego (np. dwóch writerów na ten sam stół).

**Jeśli conflict reads okażą się istotne**, zaprojektować minimalny wariant redukcji payloadu, który zachowuje `alreadyApplied`, bez przesądzania z góry konkretnego rozwiązania (np. kolumna `state_hash`, porównanie version-only, lokalny fingerprint). Rozwiązanie musi być zsynchronizowane między Netlify i WS serverem.

**Pliki do pomiaru**: `poker-state-write.mjs:33` (Netlify) i `persisted-state-writer.mjs:706` (WS).

### Opcja C: Kliencka redukcja duplikatów XP status

**Jeśli głównym źródłem jest częste odpytywanie `fetchStatus` XP.**

**Nie** stosować `cache-control: public` dla tego endpointu:
- `calculate-xp` to POST zależny od konkretnego użytkownika/anonimowej tożsamości;
- CDN może nie cache'ować POST w standardowy sposób;
- nawet z `Vary: Authorization`, anon ID jest w body, nie w nagłówku;
- odpowiedź może zawierać prywatny stan użytkownika.

Zamiast tego:
1. Zmierzyć częstotliwość wywołań `fetchStatus`. Użyć istniejącego mechanizmu diagnostycznego i `klog`, jeżeli jest dostępny w kontekście `xpClient.js`. W przeciwnym razie mierzyć po stronie handlera `calculate-xp`, bez dodawania nowej globalnej zależności browserowej. Nie logować każdego wywołania w produkcji.
2. Sprawdzić, czy nie ma duplikatów po stronie klienta — np. `refreshBadgeFromServer` + `scheduleInitialStatusRefresh` wywołane w tej samej ramce.
3. Jeśli duplikaty występują — dodać krótki cache w pamięci klienta (np. 5s throttle, `state.statusPromise` już istnieje — sprawdzić, czy jest poprawnie użyty).
4. Nie wprowadzać publicznego CDN cache dla tego endpointu.

### Opcja D: Ograniczenie aktywności stage (po pomiarze)

**Jeśli głównym źródłem jest stage.**

Na podstawie pomiarów z 3.G:
- Jeśli znaleziono nieużywane stoły — zamknąć je przez admin panel.
- Jeśli janitor wykonuje częste sweepy na idle stołach — rozważyć zwiększenie interwałów tylko na stage.
- Jeśli WS Preview jest całkowicie nieużywany przez dłuższy czas — można rozważyć zatrzymanie `ws-server-preview.service`, ale tylko jeśli nie blokuje to aktywnego developmentu.
- Nie wyłączać profilaktycznie — każda zmiana musi być poprzedzona pomiarem potwierdzającym, że stage jest głównym źródłem.
- Nie ustawiać `CHIPS_ENABLED=0` globalnie na stage — zmienia zachowanie testowego środowiska.

### Opcja E: Rate limiting dla potwierdzonego abuse

**Jeśli potwierdzono crawler/bot.**

- Sprawdzić istniejące konfiguracje routingu i eksporty `config` w funkcjach Netlify. Jeśli abuse zostanie potwierdzone, użyć natywnego `config.rateLimit` dla konkretnej funkcji lub ścieżki (code-based rate limiting dostępny również na Free planie, limit dwóch reguł na projekt, agregacja per domena i IP).
- Nie konfiguruje się function rate limiting w `netlify.toml`.
- **Nie** implementować in-memory rate limitera — niespójny w serverless.

---

## Task 5 — Weryfikacja

Dla wybranej poprawki:

1. **Baseline**: Zmierzyć request count i transfer (z Supabase dashboard lub logów) dla konkretnego endpointu przed zmianą.
2. **Wdrożenie**: Deploy na stage deploy preview.
3. **Powtórzenie**: Odtworzyć ten sam scenariusz (np. otworzyć admin dashboard, zagrać sesję pokerową).
4. **Porównanie**: Request count i transfer przed/po.
5. **Projekcja**: Na podstawie redukcji oszacować miesięczny egress.
6. **Dokumentacja**: Zapisać pozostałe ryzyko przed deadline 19 sierpnia 2026.

---

## Czego NIE robić

- Nie zmieniać `baseHeaders()` globalnie — `"cache-control": "no-store"` jest poprawnym defaultem dla API mutacyjnych.
- Nie wprowadzać `PG-TOAST` compression — PostgreSQL używa TOAST automatycznie.
- Nie implementować delta resync dla WS bez dowodu, że full-state resync jest głównym źródłem.
- Nie używać `navigator.sendBeacon()` dla XP — komplikuje semantykę sesji, autoryzację i idempotencję.
- Nie zmniejszać retry z 3 do 2 bez danych o częstotliwości retry.
- Nie pisać in-memory rate limitera — niespójny w serverless Netlify Functions.
- Nie podawać procentów redukcji bez pomiarów baseline.
- Nie dodawać testów ani nowych plików, chyba że jawnie potrzebne.
- Nie używać `console.log` — tylko `klog`.
- Zachować JSP compatibility przy zmianach w kodzie przeglądarkowym.
- Przy nowym inline script uwzględnić CSP SHA w `_headers`.
- CSS — jeden selektor na linię, bez złamań wewnątrz deklaracji.

---

## Granica czasowa

Supabase grace period kończy się **19 sierpnia 2026**. Po tej dacie projekty mogą zwracać HTTP 402.
