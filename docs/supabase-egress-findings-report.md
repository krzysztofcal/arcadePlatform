# Supabase Egress Investigation — Raport z ustaleń (Task 1–3)

Issue: [#735](https://github.com/krzysztofcal/arcadePlatform/issues/735)
Data analizy: 2026-07-21 (aktualizacja: 2026-07-22 — pomiar `state` JSONB)

---

## Status wykonania

| Task | Status | Uzasadnienie |
|------|--------|-------------|
| **Task 1** — Ustalenie źródła egressu | 🔶 Nieukończony | Przeanalizowano Netlify i GitHub Actions. Brak kluczowych danych: nie wiadomo, który projekt (prod vs stage) i która kategoria (Database / Shared Pooler / Auth) wygenerowały większość 5,72 GB. |
| **Task 2** — Bezpieczeństwo i dostęp | 🔶 Częściowo | Audyt kodu źródłowego (RLS, sekrety, migracje) zakończony. Faktyczna konfiguracja 4 środowisk (Netlify prod/preview, WS prod/preview) niepotwierdzona — brak dostępu do zmiennych. |
| **Task 3** — Inwentaryzacja zapytań | ✅ Zakończony (audyt statyczny) | Pełny audyt statyczny wszystkich 7 podejrzanych ścieżek, call graph, analiza RLS. Częstotliwości runtime i request count pozostają nieznane — wymagają pomiaru. |

---

## Potwierdzone fakty

### F1. `loadPersistedTableSnapshots()` ładuje pełny `state` JSONB — **niski wpływ potwierdzony pomiarem**

- **Plik**: `netlify/functions/_shared/admin-ops.mjs:227-273`
- **Call graph**: `admin-tables-list.mjs` (lista), `admin-ops-summary.mjs` (dashboard), `admin-table-details.mjs`, `admin-table-evaluate.mjs`
- **Dla list/summary**: Klasyfikacja janitora używa tylko 4 pól z `state`, reszta niepotrzebna.
- **Pomiar — 2026-07-22**: `octet_length(state::text)` na 6 stołach: **średnia ~1,7 KB, max 2,1 KB** (pełne dane w F9).
- **Skala**: Przy 6 stołach i ~1,7 KB każdy, pojedynczy refresh admin dashboard to ~10 KB. Nawet 1000 refreshów dziennie to tylko **~10 MB/dzień ≈ 300 MB/miesiąc** — **nie może wyjaśnić 5,72 GB**.
- **Wniosek**: Potwierdzona nieefektywność, ale **nieistotna dla rozwiązania #735**. Opcja A pozostaje poprawnym mikro-uproszczeniem kodu, ale nie jako naprawa egressu.

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

## Przełomowe ustalenie

**`poker_state` JSONB ma średnio 1,7 KB.** Żadna ścieżka odczytująca ten stan (admin dashboard, conflict reads, bootstrap) nie może wyjaśnić 5,72 GB egressu. Problem leży w **kategorii i wolumenie requestów**, nie w rozmiarze pojedynczych payloadów.

**Od tego momentu śledztwo skupia się na:**
1. Kategorii egressu (Database / Shared Pooler / Auth / Storage)
2. Podziale prod vs stage
3. Request volume — co generuje najwięcej zapytań, nie największe payloady

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

### Podejrzane ścieżki kodowe (po audycie statycznym i pomiarze)

| # | Ścieżka | Status dowodów | Priorytet dla #735 | Uzasadnienie |
|---|---------|---------------|-------------------|-------------|
| 1 | XP `fetchStatus` | Potwierdzony call graph | 🟡 | Każda strona, każda nawigacja; duży potencjalny volume |
| 2 | Conflict reads | Potwierdzony mechanizm | 🟡 | Full state przy CAS fail; nieznana częstotliwość |
| 3 | Stage activity (idle stoły, janitor sweepy) | Brak danych | 🟡 | Nieznana liczba stołów i częstotliwość sweepów |
| 4 | WS bootstrap | Potwierdzony call graph (F8) | 🟢 | Przy create/join i recovery; ograniczona częstotliwość |
| 5 | chips-ledger `returning *` | Potwierdzone | 🟢 | Wąskie tabele |
| 6 | Playwright cron | Niska pewność (H6) | 🟢 | Lokalny Vite, niepotwierdzone łączenie z Supabase |
| ~~7~~ | ~~`loadPersistedTableSnapshots`~~ | ~~Pomiar (F9)~~ | ~~Wykluczone~~ | ~~Max ~5% egressu przy agresywnych założeniach (F9)~~ |

### Krytyczne luki w danych (poza kodem)

| # | Luka | Priorytet | Wpływ na decyzję |
|---|------|-----------|-----------------|
| 1 | Kategoria egressu (Database / Shared Pooler / Auth / Storage) | 🔴 Krytyczny | **Najważniejszy brakujący element** — bez tego nie wiadomo, która warstwa generuje 5,72 GB |
| 2 | Podział prod vs stage | 🔴 Krytyczny | Bez tego nie wiadomo, które środowisko naprawiać |
| 3 | Request volume per endpoint | 🔴 Krytyczny | ~~Rozmiar state~~ — już znany (1,7 KB). Wolumen teraz kluczowy |

---

## Opcja A — mikro-uproszczenie (NIE rozwiązanie #735)

**Pomiar wykluczył Opcję A jako rozwiązanie issue #735.** Przy ~1,7 KB na state nawet 1000 refreshów admina dziennie to tylko ~300 MB/miesiąc — mniej niż 5% całkowitego egressu.

`stateProjection: "janitor"` pozostaje poprawnym mikro-uproszczeniem kodu, które można zaimplementować przy okazji, ale **nie wpłynie istotnie na przekroczenie limitu Supabase**.

---

## Następny krok — kluczowe dane

Bez podziału na kategorie egressu i request volume dalsza analiza kodu nie przybliży rozwiązania. **Potrzebne z Supabase Dashboard:**

| # | Potrzebne | Priorytet | Gdzie |
|---|----------|-----------|-------|
| 1 | Kategoria egressu dla kilku dni | 🔴 | Dashboard → Usage → Total Egress → najedź na dzień |
| 2 | Podział prod vs stage | 🔴 | Wybierz każdy projekt osobno |
| 3 | Request count (jeśli dostępny w metrykach) | 🔴 | Log Explorer lub API metrics |

| 3 | Request volume per endpoint (jeśli dostępny w metrykach) | 🔴 Krytyczny | Log Explorer lub API metrics |
| 4 | Liczba otwartych stołów na stage i prod | 🟡 Wysoki | Admin panel → Tables (dla obu środowisk) |
| 5 | Konfiguracja WS servera — project ref/hostname (bez haseł) | 🟡 Wysoki | SSH: `systemctl cat ws-server.service ws-server-preview.service \| grep EnvironmentFile`; potem bezpiecznie `grep -o 'db\.[a-z0-9-]*\.supabase\.co' <plik>` |
| 6 | Netlify env vars: różne `SUPABASE_DB_URL` dla prod i stage? | 🟡 Wysoki | `netlify env:list` (bez kopiowania wartości) |

---

## Następne kroki

1. **Uzyskać podział na kategorie egressu** (Dashboard → Usage → najedź na dzień) — to jedyny sposób, by zrozumieć, skąd pochodzi 5,72 GB.
2. **Uzyskać podział prod vs stage** — zawęzić środowisko.
3. Na podstawie kategorii **zawęzić śledztwo** do konkretnej warstwy (np. jeśli Shared Pooler dominuje → audyt Netlify Functions i WS servera pod kątem request volume; jeśli Database API → audyt przeglądarkowego supabase-js).
4. Nie implementować niczego przed danymi.
