# Supabase Egress Fix Plan — Disconnect Cleanup Loop

Issue: [#735](https://github.com/krzysztofcal/arcadePlatform/issues/735)
Data: 2026-07-22 (zaktualizowany 2026-07-23)

## Root cause

Guest table z nie-UUID ID (`guest_table_<uuid>`) utknął w nieskończonej pętli disconnect cleanup na stage WS Preview. PostgreSQL zwraca `22P02 invalid input syntax for type uuid`, ale `isRetryableCleanupFailure()` nie klasyfikuje tego błędu jako non-retryable. Kandydat nigdy nie jest usuwany z mapy, generując ~172 800 cleanup attempts dziennie.

**Call graph**:
1. `server.mjs:3367/3387` — disconnect handler → `enqueueDisconnectCleanupCandidate({ tableId, userId })`
2. `server.mjs:1874` — `enqueueDisconnectCleanupCandidate()` → `disconnectCleanupRuntime.enqueue()`
3. `disconnect-cleanup.mjs:36` — `sweep()` iteruje kandydatów
4. `disconnect-cleanup.mjs:52` — `executeCleanup({ tableId: "guest_table_<uuid>", ... })`
5. `inactive-cleanup-adapter.mjs:43` — `executeInactiveCleanup()`
6. `inactive-cleanup.mjs:182` — `select ... from poker_seats where table_id = $1` → PostgreSQL rzuca `22P02`
7. `inactive-cleanup-adapter.mjs:62-65` — catch → `isRetryableCleanupFailure()` → `true` (default)
8. `disconnect-cleanup.mjs:91` — `ws_disconnect_cleanup_retry` → kandydat zostaje w mapie

## Zaimplementowana naprawa

Trzy zmiany w trzech plikach, defense-in-depth.

### Zmiana 1: Klasyfikuj `22P02` jako non-retryable

**Plik**: `ws-server/poker/persistence/inactive-cleanup-adapter.mjs:20`

```js
// 22P02 = invalid_text_representation (e.g. non-UUID where UUID expected).
// Deterministic: the same input will always fail — do not retry.
if (code === "22P02") return false;
```

Po pierwszym nieudanym cleanupie z `22P02`, adapter zwraca `retryable: false`. `disconnect-cleanup.mjs:87-89` usuwa kandydata z mapy. Pętla się urywa.

### Zmiana 2: Source-level guard — nie enqueue'uj non-UUID table IDs

**Plik**: `ws-server/server.mjs:1874` — `enqueueDisconnectCleanupCandidate()`

```js
function enqueueDisconnectCleanupCandidate({ tableId, userId }) {
  // Persisted tables always have UUID IDs. Guest and other non-persisted
  // tables use prefixed string IDs that cannot target DB-backed cleanup.
  // Drop them here to prevent deterministic 22P02 failures.
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (typeof tableId !== "string" || !UUID_RE.test(tableId)) return;
  if (typeof userId !== "string" || !userId) return;
  disconnectCleanupRuntime.enqueue({ tableId, userId });
}
```

Guest/non-persisted table IDs (`guest_table_<uuid>`) nie przechodzą walidacji UUID i nie trafiają do DB-backed cleanupu. `userId` również jest walidowany — oba pola w logach mają prefix `guest_`.

**Dlaczego tutaj, a nie w `disconnect-cleanup.mjs`**: `disconnect-cleanup` to moduł generyczny — testy używają dowolnych string-IDs. Walidacja na poziomie entry pointu WS servera (`enqueueDisconnectCleanupCandidate`) jest najprostsza i nie zmienia kontraktu generycznego modułu. UUID_RE używane tutaj jest identyczne z istniejącymi w repo (`table-manager.mjs:25`, `admin-ops.mjs:10`).

### Zmiana 3: Retry backoff i limit jako defense-in-depth

**Plik**: `ws-server/poker/runtime/disconnect-cleanup.mjs:12,36,91`

- `MAX_CLEANUP_FAILURES = 8` — maksymalna liczba retry przed wymuszeniem usunięcia
- `CLEANUP_RETRY_BACKOFF_BASE_MS = 1000` — wykładniczy backoff (1s, 2s, 4s, ..., max 120s)
- `retryCount` — dodany do obiektu kandydata, inkrementowany przy każdym retry
- Po przekroczeniu `MAX_CLEANUP_FAILURES = 8` (czyli po 9 nieudanych próbach) kandydat jest usuwany

Backoff zapobiega ponownej eskalacji ~2 retry/sekundę, gdyby inny typ błędu zachowywał się podobnie do `22P02`.

## Pliki zmienione

| Plik | Zmiana |
|------|--------|
| `ws-server/poker/persistence/inactive-cleanup-adapter.mjs` | `22P02` → `retryable: false` |
| `ws-server/server.mjs` | `enqueueDisconnectCleanupCandidate()` — UUID guard dla tableId i userId |
| `ws-server/poker/runtime/disconnect-cleanup.mjs` | Retry count, backoff, max retries |

## Breaking impact

- **Persisted UUID tables**: bez zmian — cleanup działa identycznie.
- **Guest tables na stage**: przestają być enqueue'owane do DB-backed cleanupu (były enqueue'owane błędnie). Guest table cleanup nadal działa przez inne ścieżki (in-memory).
- **WS Production**: UUID guard jest bezpieczny — production ma tylko persisted UUID tables. Backoff/limit nie zmienia poprawnego flow.
- **WS Preview Deploy**: wymagany do wdrożenia na stage.

## Deployment

1. Zmiany już w branchu `docs/supabase-egress-plan`
2. WS Preview Deploy (manualny, przez `ws-preview-deploy.yml`)
3. Zweryfikować logi — `ws_disconnect_cleanup_retry` powinno zniknąć
4. Zweryfikować egress w Supabase Dashboard po 24h
5. Merge do main
6. WS Production Deploy

## Weryfikacja

- **Przed**: ~172 800 cleanup attempts/dobę, ~2/s pętla
- **Po**: 0 failed attempts dla guest_table; cleanup dla persisted tables bez zmian
- **Dashboard**: egress stage powinien znacząco spaść — dokładna wartość do pomiaru po wdrożeniu
