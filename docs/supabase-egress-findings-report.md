# Supabase Egress Investigation — Raport z ustaleń (Task 1–3)

Issue: [#735](https://github.com/krzysztofcal/arcadePlatform/issues/735)
Data analizy: 2026-07-21

---

## Status wykonania

| Task | Status | Uzasadnienie |
|------|--------|-------------|
| **Task 1** — Ustalenie źródła egressu | 🔶 Nieukończony | Przeanalizowano Netlify i GitHub Actions. Brak kluczowych danych: nie wiadomo, który projekt (prod vs stage) i która kategoria (Database / Shared Pooler / Auth) wygenerowały większość 5,72 GB. |
| **Task 2** — Bezpieczeństwo i dostęp | 🔶 Częściowo | Audyt kodu źródłowego (RLS, sekrety, migracje) zakończony. Faktyczna konfiguracja 4 środowisk (Netlify prod/preview, WS prod/preview) niepotwierdzona — brak dostępu do zmiennych. |
| **Task 3** — Inwentaryzacja zapytań | ✅ Zakończony (audyt statyczny) | Pełny audyt statyczny wszystkich 7 podejrzanych ścieżek, call graph, analiza RLS. Częstotliwości runtime i request count pozostają nieznane — wymagają pomiaru. |

---

## Potwierdzone fakty

### F1. `loadPersistedTableSnapshots()` ładuje pełny `state` JSONB

- **Plik**: `netlify/functions/_shared/admin-ops.mjs:227-273`
- **Call graph**:
  - `admin-tables-list.mjs:139` — lista stołów (domyślnie 20 na stronę), używa do klasyfikacji janitora
  - `admin-ops-summary.mjs:154` — dashboard Ops, używa do klasyfikacji janitora
  - `admin-table-details.mjs:19` — szczegóły pojedynczego stołu (może potrzebować pełnego state)
  - `admin-table-evaluate.mjs:6` — ewaluacja pojedynczego stołu (może potrzebować pełnego state)
- **Dla list/summary**: Klasyfikacja janitora (`evaluateTableHealth` w `table-janitor.mjs`) używa tylko 4 pól z `state`: `phase`, `turnUserId`, `turnDeadlineAt`, `leftTableByUserId`. Reszta (stacks, board, hand history, deck, hole cards) jest transferowana niepotrzebnie.
- **Dla details/evaluate**: Pełny `state` może być uzasadniony — te endpointy wyświetlają szczegóły stołu.
- **Nieznane**: Rzeczywisty rozmiar `state` JSONB, request count admin dashboardu, udział w całkowitym egressie.

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

---

## Hipotezy wymagające danych

### H1. Kategoria egressu — Database vs Shared Pooler vs Auth vs Storage

Bez tego podziału nie wiadomo, czy egress pochodzi z:
- **Database Egress**: Data API/PostgREST — zapytania tabel przez supabase-js z przeglądarki
- **Shared Pooler Egress**: backendowy Postgres przez `SUPABASE_DB_URL` z Netlify Functions i WS servera
- **Auth Egress**: sesje, JWT verification, login/logout
- **Storage Egress**: avatary i obiekty

### H2. Podział prod vs stage
Nie wiadomo, czy `arcade-portal` czy `arcade-portal-stage` generuje większość egressu. Możliwe scenariusze:
- Stage ze starymi idle stołami + janitor sweepy
- Production z ruchem użytkowników + admin dashboard
- Stage z WS Preview

### H3. Udział `loadPersistedTableSnapshots` w całkowitym egressie
Potwierdzona nieefektywność kodowa, ale bez pomiarów nie wiadomo, czy jest istotna.

**Wymagane obliczenie (per endpoint)**:
```
admin-tables-list:   listRequests × avgTableCount × avgStateSize
admin-ops-summary:   summaryRequests × avgTableCount × avgStateSize
admin-table-details: detailRequests × 1 × avgStateSize (pełny state może być uzasadniony)
admin-table-evaluate: evaluateRequests × 1 × avgStateSize (pełny state może być uzasadniony)
```
Gdzie `avgTableCount` zależy od liczby aktywnych stołów (nie zawsze 20). Jeśli suma jest rzędu dziesiątek MB dziennie — istotne. Jeśli poniżej 1 MB — pomijalne.

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

### Podejrzane ścieżki kodowe (po audycie statycznym)

| # | Ścieżka | Status dowodów | Co wiadomo | Czego brakuje |
|---|---------|---------------|------------|---------------|
| 1 | `loadPersistedTableSnapshots` | Potwierdzona nieefektywność | Pełny state zamiast 4 pól janitora (dla list/summary) | `octet_length`, request count |
| 2 | XP `fetchStatus` | Potwierdzony call graph | Każda strona z badge, dedup równoległy | Liczba wywołań dziennie, payload size |
| 3 | Conflict reads | Potwierdzony mechanizm | Full state przy CAS fail | Częstotliwość konfliktów |
| 4 | Stage activity (idle stoły, janitor sweepy) | Brak danych | — | Liczba stołów na stage, częstotliwość janitora |
| 5 | WS bootstrap | Potwierdzony call graph (F8) | Bootstrap przy create/join i recovery; nie przy resync | Jak często linie 1269/1800 faktycznie docierają do DB |
| 6 | chips-ledger `returning *` | Potwierdzone, niski priorytet | Wąskie tabele | — |
| 7 | Playwright cron | Niska pewność (H6) | Cron codziennie 2am, lokalny Vite | Czy realnie łączy się z Supabase |

### Krytyczne luki w danych (poza kodem)

| # | Luka | Priorytet | Wpływ na decyzję |
|---|------|-----------|-----------------|
| 1 | Kategoria egressu (Database / Shared Pooler / Auth) | 🔴 Krytyczny | Bez tego nie wiadomo, która warstwa dominuje |
| 2 | Podział prod vs stage | 🔴 Krytyczny | Bez tego nie wiadomo, które środowisko naprawiać |
| 3 | Rozmiar `state` JSONB | 🟡 Wysoki | Warunek do oszacowania Opcji A |
| 4 | Request count per endpoint | 🟡 Wysoki | Mnożnik we wzorze H3 |

---

## Opcja A jako kandydat na quick win

**Najbardziej oczywista potwierdzona nieefektywność w kodzie.** Jej udział w całkowitym egressie pozostaje nieznany do czasu uzupełnienia pomiarów.

**Zmiana**: `stateProjection: "janitor"` w `loadPersistedTableSnapshots()`:
- SQL pobiera tylko `state->>'phase'`, `state->>'turnUserId'`, `state->>'turnDeadlineAt'`, `state->'leftTableByUserId'` zamiast pełnego `state`
- Domyślnie (bez parametru) — pełny `state` dla `admin-table-details` i `admin-table-evaluate`

**Pliki**: `admin-ops.mjs`, `admin-tables-list.mjs`, `admin-ops-summary.mjs`

**Warunek wstępny do rozważenia implementacji**: Patrz wzór H3 — potrzebny `avgStateSize` (octet_length) i request count per endpoint.

Bez tego nie wiadomo, czy zmiana przyniesie istotną redukcję egressu.

**Nie jest to rekomendowana naprawa issue #735** przed uzyskaniem danych prod/stage i kategorii egressu. Jest to jedynie najlepszy kandydat na minimalny quick win spośród przeanalizowanych ścieżek.

---

## Minimalna lista danych właściciela (w kolejności priorytetu)

| # | Potrzebne | Priorytet | Gdzie / jak |
|---|----------|-----------|-------------|
| 1 | Dzienny egress prod vs stage za okres 26 cze – 26 lip 2026 | 🔴 Krytyczny | Supabase Dashboard → Organization → Usage → Total Egress → wybierz `arcade-portal` i `arcade-portal-stage` osobno |
| 2 | Podział na kategorie (Database / Shared Pooler / Auth / Storage) dla kilku reprezentatywnych dni | 🔴 Krytyczny | Najedź na dzień w Total Egress — pokazuje podział per usługa |
| 3 | Rozmiar `state` JSONB | 🟡 Wysoki | Supabase SQL Editor (stage lub prod): `SELECT table_id, pg_column_size(state) AS stored_bytes, octet_length(state::text) AS approx_bytes FROM public.poker_state ORDER BY octet_length(state::text) DESC LIMIT 20;` |
| 4 | Liczba otwartych stołów na stage i prod | 🟡 Wysoki | Admin panel → Tables (dla obu środowisk) |
| 5 | Konfiguracja WS servera — project ref/hostname dla prod i preview (bez haseł) | 🟡 Wysoki | SSH na VPS. **Uwaga**: nie kopiować pełnych connection stringów. Najpierw sprawdzić źródła konfiguracji: `systemctl cat ws-server.service ws-server-preview.service \| grep -E 'EnvironmentFile\|SUPABASE_DB_URL'`. Jeśli connection string jest w `EnvironmentFile`, sprawdzić wskazany plik. Bezpieczne wyodrębnienie hosta: `grep -o 'db\.[a-z0-9-]*\.supabase\.co' <plik>`. Jeśli żadna z komend nie znajduje hosta, connection string może być w drop-in override, pliku `.env` lub systemd credentials. |
| 6 | Netlify env vars: `SUPABASE_DB_URL` dla production i deploy-preview | 🟡 Wysoki | `netlify env:list` (wymaga uprawnień właściciela). **Uwaga**: nie kopiować pełnych wartości do raportu. Wystarczy informacja, czy production i deploy-preview mają różne URL-e. |

---

## Następne kroki

1. Uzupełnić dane #1 i #2 (dashboard Supabase) — to **warunek konieczny** do wyboru Task 4.
2. Uzupełnić dane #3 (rozmiar state) — do oszacowania wpływu Opcji A.
3. Uzupełnić dane #4–6 (konfiguracja) — do weryfikacji Task 2.
4. Na podstawie danych wybrać jedną minimalną poprawkę (Task 4).
5. Nie implementować niczego przed pomiarem baseline.
