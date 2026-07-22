# Supabase Egress Investigation — Raport z ustaleń (Task 1–3)

Issue: [#735](https://github.com/krzysztofcal/arcadePlatform/issues/735)
Data analizy: 2026-07-21 (aktualizacja: 2026-07-22 — pomiar `state` JSONB, dane Supabase Dashboard)

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

**Średnia ~1,7 KB, maksimum 2,1 KB.** To wyklucza `loadPersistedTableSnapshots` jako istotne źródło 5,72 GB — nawet 1000 refreshów admina dziennie to tylko ~300 MB/miesiąc. Problem leży gdzie indziej — kluczowe jest poznanie kategorii egressu i request volume.

---

## Przełomowe ustalenia (zaktualizowane 2026-07-22)

1. **~89% egressu ze stage** (F10). Production generuje tylko 0,71 GB — samodzielnie mieści się w limicie 5 GB/miesiąc.
2. **~99,9% to Shared Pooler** (F11) — backend przez `SUPABASE_DB_URL`. Auth, Storage i przeglądarkowy supabase-js są praktycznie wykluczone.
3. **`poker_state` JSONB ~1,7 KB** (F9) — wyklucza duże payloady jako przyczynę.

**Śledztwo zawęża się do**: backendowych procesów na **stage** korzystających z `SUPABASE_DB_URL`. Kluczowe pytanie: który konkretnie proces (WS Preview, Netlify Functions deploy preview, cykliczne odczyty) generuje ~1 GB dziennie?

Potrzebne dane: request count lub logi z backendu stage, aby rozdzielić ruch między WS Preview i Netlify Functions.

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


### Podejrzane ścieżki kodowe (po audycie statycznym, pomiarze i danych Dashboard)

**Uwaga**: ~99,9% egressu to Shared Pooler ze stage (F10, F11). Ranking skupia się na backendowych procesach stage.

| # | Ścieżka | Status | Priorytet | Uzasadnienie |
|---|---------|--------|-----------|-------------|
| 1 | **Stage WS Preview / backend processes** | 🟡 Brak danych | 🔴 | Stage generuje 5,82 GB przez Shared Pooler. WS Preview + Netlify deploy preview — nie wiadomo, który proces dominuje. |
| 2 | Stage janitor / inactive cleanup sweepy | 🟡 Brak danych | 🔴 | Idle stoły + cykliczne odczyty DB przez janitora — potencjalnie stały ruch. |
| 3 | Conflict reads (na stage) | Potwierdzony mechanizm | 🟡 | Mały payload, ale jeśli stage ma wiele aktywnych stołów z botami — częste zapisy = częste konflikty. |
| 4 | WS bootstrap (na stage) | Potwierdzony call graph (F8) | 🟢 | Tylko create/join i recovery. |
| 5 | XP `fetchStatus` (na stage) | Potwierdzony call graph | 🟢 | Stage ma minimalny ruch użytkowników; mały volume. |
| 6 | ~~Auth / Storage / Database API~~ | ~~Wykluczone (F11)~~ | ~~Wykluczone~~ | ~~<0,1% egressu~~ |
| 7 | ~~`loadPersistedTableSnapshots`~~ | ~~Pomiar (F9)~~ | ~~Wykluczone~~ | ~~Payload za mały~~ |
| 8 | ~~Production~~ | ~~Wykluczone (F10)~~ | ~~Wykluczone~~ | ~~Tylko 0,71 GB, poniżej limitu~~ |

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

1. **Potwierdzono**: ~89% egressu ze stage, ~99,9% Shared Pooler. Production i Auth wykluczone. ✅
2. **Sprawdzić stan stage**: ile stołów, czy są idle, czy boty grają. (Admin panel stage → Tables)
3. **Rozdzielić WS Preview vs Netlify Functions**: który backendowy proces dominuje. (Potrzebne logi lub request count)
4. Na podstawie danych wybrać jedną minimalną poprawkę (Task 4).
5. Nie implementować niczego przed danymi.
