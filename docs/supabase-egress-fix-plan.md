# Supabase Egress Fix Plan — Disconnect Cleanup Loop

Issue: [#735](https://github.com/krzysztofcal/arcadePlatform/issues/735)
Data: 2026-07-22

## Root cause

Guest table z nie-UUID ID (`guest_table_<uuid>`) utknął w nieskończonej pętli disconnect cleanup na stage WS Preview. PostgreSQL zwraca `22P02 invalid input syntax for type uuid`, ale `isRetryableCleanupFailure()` nie klasyfikuje tego błędu jako non-retryable. Kandydat nigdy nie jest usuwany z mapy, generując ~172 800 failed DB queries dziennie.

**Call graph**:
1. `disconnect-cleanup.mjs:36` — `sweep()` iteruje kandydatów
2. `disconnect-cleanup.mjs:52` — `executeCleanup({ tableId: "guest_table_<uuid>", ... })`
3. `inactive-cleanup-adapter.mjs:43` — `executeInactiveCleanup()`
4. `inactive-cleanup.mjs:182` — `select ... from poker_seats where table_id = $1` → `22P02`
5. `inactive-cleanup-adapter.mjs:62-65` — catch → `isRetryableCleanupFailure()` → `true`
6. `disconnect-cleanup.mjs:87` — `retryable !== false` → kandydat zostaje

## Minimalna naprawa

Trzy zmiany w dwóch plikach. Każda jest samodzielnie wystarczająca, razem dają defense-in-depth.

### Zmiana 1 (główna): Klasyfikuj `22P02` jako non-retryable

**Plik**: `ws-server/poker/persistence/inactive-cleanup-adapter.mjs:15-22`

Funkcja `isRetryableCleanupFailure()` obecnie nie obsługuje błędów Postgres wire protocol (klas 22, 23, 42 itp.). Dodać klasyfikację dla deterministycznych błędów typu:

```js
function isRetryableCleanupFailure(error) {
  const status = Number(error?.status ?? error?.statusCode);
  const code = typeof error?.code === "string" ? error.code : "";
  if (status === 408 || status === 425 || status === 429) return true;
  if (Number.isInteger(status) && status >= 400 && status < 500) return false;
  if (code === "terminal_accounting_invariant_failed") return false;
  // Postgres Class 22 — Data Exception (invalid_text_representation, etc.)
  // These are deterministic: the same input will always fail.
  if (code === "22P02" || code.startsWith("22")) return false;
  return true;
}
```

### Zmiana 2 (druga linia obrony): Waliduj tableId przed DB query

**Plik**: `ws-server/poker/runtime/disconnect-cleanup.mjs:16`

Funkcja `enqueue()` obecnie akceptuje każdy niepusty string jako `tableId`. Dodać walidację UUID dla persisted cleanup path:

```js
function enqueue({ tableId, userId }) {
  if (typeof tableId !== 'string' || !tableId) return false;
  if (typeof userId !== 'string' || !userId) return false;
  // Guest/non-persisted tables have non-UUID IDs — they should never
  // reach DB-backed cleanup. Reject them at enqueue time.
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!UUID_RE.test(tableId)) return false;
  // ...
```

Alternatywnie (mniej inwazyjnie): dodać tę samą walidację w `sweep()` przed wywołaniem `executeCleanup()`, usuwając nie-UUID kandydatów:

```js
async function sweep() {
  for (const candidate of [...candidates.values()]) {
    // ...
    // Drop non-UUID candidates before they reach DB
    if (!UUID_RE.test(candidate.tableId)) {
      candidates.delete(key(candidate.tableId, candidate.userId));
      continue;
    }
    const result = await executeCleanup({...});
    // ...
```

### Zmiana 3 (opcjonalna): Limit retry / backoff

Jeśli zmiany 1 i 2 są wdrożone, ta zmiana nie jest konieczna. Jako dodatkowe zabezpieczenie: dodać licznik retry w kandydacie i usuwać po N próbach.

## Pliki do zmiany

| Plik | Zmiana | Ryzyko |
|------|--------|--------|
| `ws-server/poker/persistence/inactive-cleanup-adapter.mjs:22` | Dodaj `22P02` do non-retryable | Minimalne — błędy typu 22 są zawsze deterministyczne |
| `ws-server/poker/runtime/disconnect-cleanup.mjs:16` | Waliduj UUID w `enqueue()` | Średnie — zmienia kontrakt dla guest tables; alternatywnie waliduj w `sweep()` |

## Czego NIE zmieniać

- Nie zmieniać kontraktu `executeInactiveCleanup()` dla prawidłowych UUID tables
- Nie zmieniać logiki cleanupu dla persisted tables
- Nie wyłączać WS Preview ani janitora
- Nie dodawać migracji DB

## Deployment

1. Zastosować zmiany w branchu
2. WS Preview Deploy (manualny, przez `ws-preview-deploy.yml`)
3. Zweryfikować logi — `ws_disconnect_cleanup_retry` powinno zniknąć
4. Zweryfikować egress w Supabase Dashboard po 24h
5. Merge do main
6. WS Production Deploy (jeśli zmiana dotyczy shared kodu)

## Weryfikacja

- **Przed**: ~172 800 failed queries/dobę, ~2/s pętla
- **Po**: 0 failed queries dla guest_table, cleanup kończy się natychmiast
- **Dashboard**: egress stage powinien spaść z ~1 GB/dzień do poziomu production (~0,02 GB/dzień)
- **Projekcja miesięczna**: z 5,82 GB do <1 GB (stage + production razem)
