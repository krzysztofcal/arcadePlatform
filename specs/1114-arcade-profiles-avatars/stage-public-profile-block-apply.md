# Stage schema-only APPLY — BLOCKED / ROLLED BACK

Data: 2026-10-28T12:32:59.760722+00:00. PR #1155 pozostaje Draft. LEGAL OPEN.

- Projekt: `krydukthwdvccggbyjfw` (`arcade-portal-stage`, ACTIVE_HEALTHY).
- PostgreSQL system identifier: `7656985631720456337`; operator query role `postgres`.
- Autoryzowany plik: `supabase/migrations/20261028180000_public_profile_block.sql`.
- SHA-256: `73b4bfefce21b8e59c1d20c21344ee7d182b8c90140d2b6d41a0c57379c30f6d` — bez zmian.

## Preflight PASS

Bezpośredni odczyt: 120 migracji, 120 hashy; wszystkie wersje/file/hash zgodne z repo. Jedyny pending: powyższa migracja. 51 profili, katalog16 ON, Terms OFF/a1, normalizacja zakończona. Kolumna i guard nie istniały; brak konfliktujących blokad DDL. Tożsamość projektu potwierdzona osobno przez project API i system PostgreSQL.

## Rzeczywiste wykonanie

Wykonano jedną próbę kontrolowanej transakcji REPEATABLE READ z timeoutami, blokadami NOWAIT i sprawdzeniem historii. Identyczna część operacyjna zatwierdzonego pliku (bez zagnieżdżania BEGIN/COMMIT) oraz zapisy wersji/hash znajdowały się w tej samej transakcji. Dodatkowa osłona porównywała pełne fingerprinty tabel public/private/auth/storage przed i po DDL.

**COMMIT NIE NASTĄPIŁ.** PostgreSQL `57014` (statement timeout 15 s) podczas pooperacyjnego fingerprintu `public.chips_ledger_archive_batches`, w drugim przebiegu kontroli danych. Osłona pełnego skanowania wszystkich tabel była zbyt kosztowna dla tego limitu. Nie jest to dowód błędu samej migracji. Cała transakcja, w tym DDL i wpisy historii, została wycofana. Bez retry, podnoszenia timeoutów lub DROP.

## Niezależne potwierdzenie rollbacku

Drugi konektor, rola read-only:
- system nadal `7656985631720456337`;
- historia/hash **120/120**, nowa wersja i nowy hash NIE istnieją;
- kolumna, funkcja guard i trigger NIE istnieją;
- nadal **51 profili**;
- katalog16 **true**, Terms **false**, wersja **2026-10-26-a1**, normalizacja zachowana;
- zero pozostawionych AccessExclusiveLock na profilu.

Nie ma częściowo zastosowanej migracji ani danych do odtwarzania. Nie uzyskano kompletu porównań fingerprintów po próbie; nie raportujemy ich jako PASS. Transakcyjny rollback jest podstawą stwierdzenia braku trwałych skutków tej operacji.

## Stan i następna bramka

Schema-only Stage **BLOCKED**, pending nadal dokładnie ta jedna migracja według preflight i potwierdzenia braku nowej wersji. Nie uruchamiano DB Stage Apply PR; workflow pozostaje SKIPPED dla Draft. Nie można raportować gotowości nowych readerów ani oczekiwanych 121/121.

Propozycja kolejnej próby, wymagająca nowego GO: zachować identyczny plik/hash i jedną transakcję z wersją/hash, lecz zastąpić pełny skan dużych archiwów proporcjonalną kontrolą 51 profili i polityki oraz sprawdzeniem dokładnego DDL/triggerów i braku DML poza metadanymi migracji. Nie zwiększać automatycznie limitów ani nie osłabiać zabezpieczeń finansowych. Przed nową próbą ponowić pełny identity/history/hash/pending preflight. Nie przygotowano ani nie wykonano nowego wariantu APPLY w tym zadaniu.

Bez push, Ready, WWW/WS/APK deploy, Terms ON, ustawiania blokad użytkownikom i zmian Production. Dalszy rollout zatrzymany.


## Druga pojedyncza próba — COMMITTED PASS

Czas raportu: 2026-10-28T12:39:02.661510+00:00. Nowe, osobne GO OWNER zezwoliło na proporcjonalną kontrolę danych; poprzedni rollback pozostaje historycznym wynikiem pierwszej próby, a bieżący stan to **121/121 COMMITTED**.

- Projekt `krydukthwdvccggbyjfw`, system `7656985631720456337`, potwierdzone przed APPLY; połączenie wykonawcze postgres, niezależny postflight `supabase_read_only_user`.
- Przed APPLY: ponownie 120/120 wersji/hashów zgodnych bajtowo z repo, jedyny pending `20261028180000_public_profile_block.sql`, brak kolumny/guardów i konfliktujących blokad DDL.
- Zastosowany identyczny plik SHA-256 `73b4bfefce21b8e59c1d20c21344ee7d182b8c90140d2b6d41a0c57379c30f6d`. Jedna transakcja REPEATABLE READ, bez zagnieżdżania BEGIN/COMMIT; niezmieniona część operacyjna pliku oraz INSERT wersji i hasha atomowo. Timeout lock 2s, statement 15s, idle-in-transaction 15s; blokady NOWAIT. Bez retry i bez zwiększania limitów.
- Usunięto wyłącznie nadmiarowy skan wszystkich tabel. Kontrola pełnego JSON 51 profili, porównanie bez nowo dodanej kolumny; cała polityka zachowana. Statyczna kontrola zatwierdzonych bajtów SQL: brak DML ledger/CH/XP/Auth/Storage. Dodatkowo w transakcji sprawdzono `pg_stat_xact_user_tables`: brak DML poza metadanymi migracji. Nie wykonywano fizycznego usuwania ani finansowanych testów.
- **COMMIT potwierdzony** widocznością zmian przez drugi konektor i rolę read-only. Historia i hashe **121/121**, każda wersja/file/SHA zgodna z repo, pending **0**. Żadnych dodatkowych migracji.
- `public_profile_blocked`: boolean NOT NULL DEFAULT false, 51 rekordów, 0 aktywnych blokad.
- Funkcja private.guard_public_profile_block(): owner postgres, SECURITY INVOKER, search_path=pg_catalog, ACL wyłącznie postgres EXECUTE (`postgres=X/postgres`). Trigger BEFORE INSERT OR UPDATE FOR EACH ROW aktywny (`O`), wskazuje właściwą funkcję. Brak pozostawionej blokady wyłącznej.
- Profile przed/po: `3b5c77db58c8a4a624dff2aab8eeb63d` = `3b5c77db58c8a4a624dff2aab8eeb63d` (wszystkie historyczne pola, w tym UUID, avatar_variant/revision, privacy, znaczniki i updated_at).
- Polityka przed/po: `f6cdd4ed707bc4def346ec990d608204` = `f6cdd4ed707bc4def346ec990d608204`. Terms active=false, wersja 2026-10-26-a1, variants_enabled=true, identity_normalized_at zachowane.

Przyszły skrypt DB Stage Apply PR ma obecnie komplet zgodnych wersji/hashów i pusty pending set; zgodnie z poprzednio zweryfikowaną logiką nie ponowi tej migracji. Nadal wymaga ponownego sprawdzenia przed przyszłym uruchomieniem, bo wspólny Stage może zmienić się później. Workflow nie został uruchomiony; Draft niezmieniony.

Brak pushu, WWW/WS/APK deploymentu, blokowania użytkowników, Terms ON i operacji Production. Starsze readery jeszcze nie egzekwują nowej flagi — żadnych blokad nie aktywowano. Kontrolowany rollout readerów wymaga kolejnego GO. LEGAL i odbiór całej fazy A pozostają OPEN. Raport nie stanowi pozwolenia na następny etap.
