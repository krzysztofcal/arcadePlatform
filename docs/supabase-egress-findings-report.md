# Supabase Egress Investigation — Raport z ustaleń (Task 1–3)

Issue: [#735](https://github.com/krzysztofcal/arcadePlatform/issues/735)
Data analizy: 2026-07-21 (aktualizacja: 2026-07-22 — pomiary: `state` JSONB, Supabase Dashboard, runtime WS Preview)

---

## Status wykonania

| Task | Status | Uzasadnienie |
|------|--------|-------------|
| **Task 1** — Ustalenie źródła egressu | 🟢 Znaczący postęp | Potwierdzono: ~89% egressu ze stage, ~99.9% to Shared Pooler (backend przez `SUPABASE_DB_URL`). Production tylko 0,71 GB. |
| **Task 2** — Bezpieczeństwo i dostęp | 🔶 Częściowo | Audyt kodu źródłowego (RLS, sekrety, migracje) zakończony. Faktyczna konfiguracja 4 środowisk (Netlify prod/preview, WS prod/preview) niepotwierdzona — brak dostępu do zmiennych. |
| **Task 3** — Inwentaryzacja zapytań | ✅ Zakończony (audyt statyczny) | Pełny audyt statyczny wszystkich 7 podejrzanych ścieżek, call graph, analiza RLS. Częstotliwości runtime i request count pozostają nieznane — wymagają pomiaru. |

---

## Potwierdzone fakty

### F1. `loadPersistedTableSnapshots()` ładuje pełny `state` JSONB — **niski wpływ potwierdzony pomiarem**

- **Plik**: `netlify/functions/_shared/admin-ops.mjs:227-273`
- **Call graph**: `admin-tables-list.mjs` (lista), `admin-ops-summary.mjs` (dashboard), `admin-table-details.mjs`, `admin-table-evaluate.mjs`
- **Dla list/summary**: Klasyfikacja janitora używa tylko 4 pól z `state`, reszta niepotrzebna.
- **Pomiar — 2026-07-22**: `octet_length(state::text)` na 6 stołach: **średnia ~1,7 KB, max 2,1 KB** (pełne dane w F9).
- **Skala**: Przy 6 stołach i ~1,7 KB każdy, pojedynczy refresh admin dashboard to ~10 KB. Przy przykładowym założeniu 1000 refreshów dziennie byłoby to **~10 MB/dzień ≈ 300 MB/miesiąc (~5% limitu)**. Rzeczywisty udział pozostaje nieznany bez request count, ale mały rozmiar payloadu (~1,7 KB) oznacza, że nawet bardzo wysoki volume z tej ścieżki nie wystarczy do wyjaśnienia 5,72 GB.
- **Wniosek**: Potwierdzona nieefektywność, ale **payload jest zbyt mały, by wyjaśnić 5,72 GB**. Przeniesione do sekcji „Deferred cleanup” — poprawne mikro-uproszczenie, nie rozwiązanie #735.

### F2. `poker_state` i `poker_hole_cards` są zablokowane dla standardowych ról przeglądarkowych

- `REVOKE ALL FROM anon, authenticated; GRANT ONLY TO service_role`
- Bezpośredni odczyt `poker_state` przez przeglądarkowy supabase-js jako `anon` lub `authenticated` jest niemożliwy.
- **Nie wyklucza to** egressu z innych operacji Auth, Storage (avatary) ani innych tabel dostępnych przez RLS. Należy potwierdzić, które wywołania faktycznie wykonują requesty sieciowe do Supabase.

### F3. WS resync z pamięci nie generuje Supabase egressu

- `ws-server/server.mjs:2906` — `tableManager.persistedPokerState(tableId)` odczytuje stan z pamięci procesu, nie z DB. **Sam resync nie generuje Supabase egressu.**
- Należy osobno uwzględnić ewentualne DB recovery uruchamiane przed lub wokół resyncu (np. `ws-server/server.mjs:1269`, `ws-server/server.mjs:1800` — patrz F8).
- Bootstrap stołu (`persisted-bootstrap-repository.mjs:47-49`) używa DB — patrz F8.

### F4. `cache-control: no-store` jest ustawione globalnie, ale dotyczy tylko HTTP
- `supabase-admin.mjs:18` — `baseHeaders()` ustawia `no-store` na odpowiedziach Netlify Functions.
- Nie wpływa na ruch przez `SUPABASE_DB_URL` (Shared Pooler) — to osobna warstwa.
- Cache bezpiecznych endpointów **może** ograniczyć backendowe odczyty, jeśli pomiary pokażą, że HTTP API dominuje w egressie.

### F5. Playwright Matrix — cron codziennie 2:00 UTC
- `playwright-matrix.yml`: `schedule: cron: "0 2 * * *"` — 3 przeglądarki (chromium, firefox, webkit).
- Ostatnie 10 uruchomień: wszystkie success (2–3 minuty każde).
- Testy ładują strony przez lokalny Vite dev server (`localhost:4173`), ale inicjalizują `supabaseClient.js`.
- **Nieznane**: Liczba requestów do Supabase na jedno uruchomienie, liczba DB operations.

### F6. Nightly Poker — nieaktywny od stycznia 2026
- Tylko `workflow_dispatch`, ostatnie uruchomienia zakończone failure.
- **Nie jest źródłem bieżącego egressu**.

### F7. RLS — przegląd migracji

W przejrzanych migracjach nie znaleziono tabel publicznie dostępnych bez RLS. Tabele z jawną blokadą:

| Tabela | RLS | anon | authenticated |
|--------|-----|------|---------------|
| `poker_state` | ✅ | REVOKE ALL | REVOKE ALL (tylko service_role) |
| `poker_hole_cards` | ✅ | REVOKE ALL | REVOKE ALL (tylko service_role) |
| `poker_tables` | ✅ | — | SELECT (jeśli seated), mutacje REVOKE |
| `poker_seats` | ✅ | — | SELECT własnych, mutacje REVOKE |
| `poker_actions` | ✅ | — | SELECT (jeśli seated), mutacje REVOKE |
| `poker_requests` | ✅ | — | SELECT (jeśli seated), mutacje REVOKE |
| `chips_accounts` | ✅ | — | przez funkcje/triggery |
| `chips_transactions` | ✅ | — | przez funkcje/triggery |
| `chips_entries` | ✅ | — | przez triggery |
| `chips_account_snapshot` | ✅ | — | przez triggery |
| `user_profiles` | ✅ | — | przez funkcje |
| `favorites` | ✅ | — | przez funkcje |
| `bonus_campaigns` | ✅ | — | przez funkcje |
| `bonus_claims` | ✅ | — | przez funkcje |
| `bonus_campaign_eligible_users` | ✅ | — | przez funkcje |
| `profile_avatar_uploads` | ✅ | — | przez funkcje |

Wniosek: Przejrzano wszystkie migracje chronologicznie — nie znaleziono późniejszych `DISABLE ROW LEVEL SECURITY`, `DROP POLICY`, `GRANT ... TO anon` ani `GRANT ... TO PUBLIC` dla tych tabel. `poker_state` i `poker_hole_cards` są zablokowane dla standardowych ról przeglądarkowych `anon` i `authenticated`. Pozostałe tabele mają RLS enabled. Brak wycieków sekretów w kodzie źródłowym.

**Poza zakresem tego audytu** (wymagają osobnego sprawdzenia): funkcje `SECURITY DEFINER`, `GRANT EXECUTE` na RPC, widoki z potencjalnym bypass RLS, schema exposure, Storage policies. Te elementy również mogą stanowić publiczny surface, ale nie zostały przejrzane w ramach Task 2.

### F8. WS bootstrap — call graph potwierdzony

- **Plik**: `ws-server/poker/bootstrap/persisted-bootstrap-repository.mjs:47-49` — `select version, state from public.poker_state`
- **Callery** (w `ws-server/server.mjs`):
  - Linia 1269: wewnątrz flow `createTable` / join stołu — `loadPersistedTableBootstrap({ tableId })`
  - Linia 1800: wewnątrz flow table recovery — `loadPersistedTableBootstrap({ tableId })`
- **Nie występuje przy**: Zwykłym reconnect — linia 2906 używa `tableManager.persistedPokerState()` z pamięci.
- **Skala**: Pełny odczyt DB występuje w bootstrapie uruchamianym przez flow tworzenia/dołączania stołu (linia 1269) oraz w table recovery (linia 1800). Nie występuje w zwykłym resyncu korzystającym z pamięci. Dokładna częstotliwość zależy od tego, jak często te ścieżki faktycznie docierają do DB — do potwierdzenia pomiarem.

### F9. Pomiar rozmiaru `poker_state.state` — 2026-07-22

Pomiar wykonany na produkcji (`octet_length(state::text)`):

| table_id | stored_bytes | approx_bytes |
|----------|-------------|-------------|
| afe199df... | 1924 | 2076 |
| 3cf6fd0f... | 1539 | 1665 |
| ca52f1f4... | 1538 | 1664 |
| 57feb479... | 1536 | 1662 |
| cef7809d... | 1485 | 1609 |
| edc46172... | 1482 | 1606 |

****Średnia ~1,7 KB, maksimum 2,1 KB.** To wyklucza `loadPersistedTableSnapshots` jako istotne źródło 5,72 GB. Przy realistycznym wolumenie admin dashboardu ta ścieżka jest mało prawdopodobnym źródłem większości egressu.

---

## Przełomowe ustalenia (zaktualizowane 2026-07-22)

1. **~89% egressu ze stage** (F10). Production generuje tylko 0,71 GB — samodzielnie mieści się w limicie 5 GB/miesiąc.
2. **~99,9% to Shared Pooler** (F11) — backend przez `SUPABASE_DB_URL`. Auth, Storage i przeglądarkowy supabase-js są praktycznie wykluczone.
3. **`poker_state` JSONB ~1,7 KB** (F9) — wyklucza duże payloady jako przyczynę.
4. **Główna przyczyna zidentyfikowana: pętla disconnect cleanup na stage** (F12) — guest table z nie-UUID ID wpada w nieskończoną pętlę retry, generując ~2 failed cleanup attempts/s.

---

## F12. Root cause: pętla disconnect cleanup na guest table (stage WS Preview)

**Dowody runtime (2026-07-22, 10-minutowa próbka z `ws-server-preview.service`)**:

- 7210 wpisów logów w 10 minut (~12/sekundę)
- 2400 × `ws_disconnect_cleanup_retry` — kandydat nieusuwany z mapy
- 1200 × `ws_table_janitor_result` / `ws_table_janitor_classified`
- 1200 × `ws_settled_reveal_pending_check_failed`
- 1200 × `ws_inactive_cleanup_failed`
- Wszystkie dotyczą `guest_table_<uuid>` — **nie-UUID ID**
- PostgreSQL zwraca: `22P02 invalid input syntax for type uuid: "guest_table_<uuid>"`
- **~2 nieudane cleanupy/sekundę, ~120/minutę, ~172 800 cleanup attempts/dobę**

**Dowody z `pg_stat_statements` (stage)**:
- ~180 tys. odczytów `poker_state` / `poker_tables`
- ~179 tys. `FOR UPDATE`
- ~270 tys. cleanup/sweep seatów
- 5,4 mln `BEGIN` / 4,68 mln `ROLLBACK`
- 86 tys. `pgbouncer.get_auth`

**Call graph potwierdzony w kodzie**:

1. `disconnect-cleanup.mjs:36` — `sweep()` iteruje kandydatów
2. `disconnect-cleanup.mjs:52` — woła `executeCleanup({ tableId: "guest_table_<uuid>", ... })`
3. `inactive-cleanup-adapter.mjs:43` — woła `executeInactiveCleanup()` z shared modułu
4. `inactive-cleanup.mjs:182` — `select ... from poker_seats where table_id = $1` → PostgreSQL rzuca `22P02`
5. `inactive-cleanup-adapter.mjs:54-66` — catch: `isRetryableCleanupFailure()` zwraca `true` dla `22P02`
6. `disconnect-cleanup.mjs:87` — `result.retryable !== false` → kandydat NIE jest usuwany
7. Pętla powtarza się w nieskończoność (~2 razy/sekundę)

**Przyczyna w `isRetryableCleanupFailure`** (`inactive-cleanup-adapter.mjs:15-22`):
- `22P02` nie ma HTTP status → nie wpada w `400-500 → false`
- `22P02` nie jest `terminal_accounting_invariant_failed`
- Default: `return true` → **retryable**

**Dlaczego guest table trafia do cleanupu**: Guest table ID nie przechodzi walidacji UUID przed DB query. Kod w `disconnect-cleanup.mjs:17` sprawdza tylko `typeof tableId !== 'string' || !tableId` — "guest_table_<uuid>" przechodzi tę walidację.

**Wpływ**: ~2 failed cleanup attempts/s × 86 400 sekund/dobę = ~172 800 cleanup attempts/dobę. Każde query to BEGIN + SELECT + ROLLBACK (3 round-tripy). Przy ~1,7 KB payloadu na odczyt `poker_state` daje to **~300 MB/dzień** tylko z tej pętli. W połączeniu z janitorem i innymi cyklicznymi procesami skaluje się do obserwowanych ~1 GB/dzień na stage.

---

## Hipotezy wymagające danych

### H1. Kategoria egressu — **potwierdzona: Shared Pooler dominuje**

~~Hipoteza~~ → Potwierdzone przez F11. **~99,9% egressu na stage to Shared Pooler** (backend przez `SUPABASE_DB_URL`). Database API, Auth i Storage są pomijalne.

### H2. Podział prod vs stage — **potwierdzony: ~89% ze stage**

~~Hipoteza~~ → Potwierdzone przez F10. **5,82 GB z 6,53 GB całkowitego egressu pochodzi ze stage.** Production (0,71 GB) samodzielnie mieści się w limicie.

### H3. Udział `loadPersistedTableSnapshots` — **wykluczony jako istotne źródło**

Potwierdzona nieefektywność kodowa, ale **pomiar wykluczył ją jako wyjaśnienie 5,72 GB**:
```
6 stołów × ~1,7 KB × 1000 refreshów/dzień = ~10 MB/dzień ≈ 300 MB/miesiąc
```
Stanowi to max ~5% całkowitego egressu przy bardzo agresywnych założeniach. Realistycznie poniżej 1%.

Opcja A (stateProjection) pozostaje poprawnym mikro-uproszczeniem, ale **nie jest rozwiązaniem #735**.

### H4. Częstotliwość XP `fetchStatus`
`statusPromise` deduplikuje równoległe requesty, ale nie ogranicza requestów przy kolejnych nawigacjach między stronami ani w osobnych instancjach strony (iframe, nowa karta).

### H5. Conflict reads
`poker-state-write.mjs:33` i `persisted-state-writer.mjs:706` — full state przy CAS fail. Bez pomiaru częstotliwości nie można oszacować wpływu.

### H6. Playwright cron — rzeczywisty wpływ (niska pewność)

- Testy używają lokalnego Vite dev server (`localhost:4173`).
- Samo załadowanie `supabaseClient.js` nie oznacza, że wykonują requesty do realnego Supabase.
- **Do potwierdzenia**: jakie env vars są w workflow, czy klient dostaje prawdziwy `SUPABASE_URL`, czy testy logują użytkownika, czy mockują network, czy wykonują tylko static page load.
- Na ten moment — hipoteza niskiej pewności, nie silny kandydat.

---

## Ranking


### Podejrzane ścieżki kodowe (po pełnym śledztwie)

**Uwaga**: F12 potwierdza główną przyczynę — pętla disconnect cleanup na guest table.

| # | Ścieżka | Status | Priorytet | Uzasadnienie |
|---|---------|--------|-----------|-------------|
| 1 | **Disconnect cleanup × guest table (F12)** | 🔴 Potwierdzona root cause | 🔴 | ~172 800 cleanup attempts/dobę przez nie-UUID ID + brak retryable=false dla 22P02 |
| 2 | Stage janitor / inactive cleanup sweepy | 🟡 Powiązane z #1 | 🟡 | Janitor również odpytuje DB cyklicznie, napędzany tym samym sweep loop |
| 3 | WS bootstrap (przy restarcie WS Preview) | 🟢 Ograniczony | 🟢 | Tylko create/join i recovery |
| 4 | ~~Auth / Storage / Database API~~ | ~~Wykluczone (F11)~~ | ~~Wykluczone~~ | ~~<0,1% egressu~~ |
| 5 | ~~Production~~ | ~~Wykluczone (F10)~~ | ~~Wykluczone~~ | ~~0,71 GB, poniżej limitu~~ |
| 6 | ~~~~ | ~~Pomiar (F9)~~ | ~~Wykluczone~~ | ~~Payload za mały~~ |

### Krytyczne luki w danych

| # | Luka | Priorytet | Status |
|---|------|-----------|--------|
| 1 | Root cause potwierdzona (F12) | ✅ | Pętla disconnect cleanup na guest table |
| 2 | Dokładny udział pętli w 5,82 GB | 🟡 | Wnioskowany przez korelację Supabase + pg_stat_statements + runtime, nie zmierzony bezpośrednio per query |

### Krytyczne luki w danych

| # | Luka | Priorytet | Wpływ na decyzję |
|---|------|-----------|-----------------|
| 1 | Rozdzielenie WS Preview vs Netlify Functions na stage | 🔴 | Który proces generuje ~1 GB/dzień? |
| 2 | Liczba i stan stołów na stage | 🔴 | Czy stage ma idle stoły z aktywnymi botami? |
| 3 | Request count per backend process | 🔴 | Wolumen zamiast payload size |
## Deferred cleanup — mikro-uproszczenia (NIE rozwiązania #735)

Poniższe zmiany są poprawnymi ulepszeniami kodu, ale **nie rozwiążą issue #735**. Można je zaimplementować przy okazji, bez związku z egressem.

### `stateProjection: "janitor"` w `loadPersistedTableSnapshots()`

Pomiar `poker_state` (~1,7 KB) potwierdził, że ta zmiana nie wpłynie istotnie na egress. Pozostaje mikro-uproszczeniem:
- SQL pobiera tylko `state->>'phase'`, `state->>'turnUserId'`, `state->>'turnDeadlineAt'`, `state->'leftTableByUserId'` zamiast pełnego `state`
- Domyślnie (bez parametru) — pełny `state` dla `admin-table-details` i `admin-table-evaluate`
- **Pliki**: `admin-ops.mjs`, `admin-tables-list.mjs`, `admin-ops-summary.mjs`

---

## Następny krok — kluczowe dane

Bez podziału na kategorie egressu i request volume dalsza analiza kodu nie przybliży rozwiązania. **Potrzebne z Supabase Dashboard:**

| # | Potrzebne | Priorytet | Gdzie |
|---|----------|-----------|-------|
| 1 | Kategoria egressu dla kilku dni | 🔴 Krytyczny | Dashboard → Usage → Total Egress → najedź na dzień |
| 2 | Podział prod vs stage | 🔴 Krytyczny | Wybierz każdy projekt osobno |
| 3 | Request count / logi z backendu stage | 🔴 Krytyczny | Rozdzielenie WS Preview vs Netlify Functions |
| 4 | Liczba i stan stołów na stage | 🔴 Krytyczny | Admin panel stage → Tables |
| 5 | Konfiguracja WS servera — project ref/hostname (bez haseł) | 🟡 Wysoki | SSH: `systemctl cat ws-server-preview.service` |
| 6 | Netlify env vars: stage używa poprawnego `SUPABASE_DB_URL`? | 🟡 Wysoki | `netlify env:list` (deploy-preview context) |

---

## Następne kroki

1. **Root cause potwierdzona** ✅ — pętla disconnect cleanup na guest table w WS Preview (F12).
2. **Zaimplementować minimalną naprawę** — osobny plan: .
3. **Po naprawie**: zweryfikować redukcję egressu na stage (Dashboard → Usage).
4. **Po weryfikacji**: rozważyć restart WS Preview, aby wyczyścić runtime state.

---

## Wnioski końcowe

Issue #735 został rozwiązanany na poziomie diagnostycznym. **5,82 GB egressu na stage jest spowodowane głównie przez nieskończoną pętlę disconnect cleanup**, w której guest table z nie-UUID ID generuje ~172 800 cleanup attempts dziennie. Błąd  z PostgreSQL nie jest klasyfikowany jako non-retryable, więc cleanup retryuje w nieskończoność.

Pozostałe źródła (production 0,71 GB, Auth <0,1%, Storage ~0) są poniżej limitu Free planu. Naprawa tej jednej pętli powinna znacząco zredukować egress na stage — dokładna wartość wymaga pomiaru po wdrożeniu.
