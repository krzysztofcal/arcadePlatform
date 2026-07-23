# Plan naprawy pętli bot autoplay przy `showdown_incomplete_community` (#737)

Status: plan po analizie `origin/main` i logów systemd z 2026-07-23.

## Cel

Najpierw zatrzymać nieskończone ponawianie deterministycznego błędu autoplay dla niezmienionego stanu, następnie odtworzyć i ustalić osobną przyczynę niepełnego boardu, a dopiero na podstawie reprodukcji zaprojektować źródłową korektę logiki gry. Poprawka ma zachować zwykły bot autoplay, runout, showdown, settlement i rollover.

## Potwierdzone fakty

### Issue i logi

- Issue #737 dokumentuje historyczny agregat `ws-server-preview.service` od 2026-07-01:
  - `239 642` zdarzenia `poker_act_bot_autoplay_step_error`;
  - `239 220` zdarzeń `ws_bot_timeout_safety_autoplay`;
  - powtarzająca się akcja `CALL`, `botActionCount: 0`, `stateVersion: 332`;
  - błąd wewnętrzny `showdown_incomplete_community`.
- Prawie równe liczniki oraz niezmieniony `stateVersion` potwierdzają pętlę timeout-safety bez skutecznej mutacji stanu.
- `ws-server.service` i `ws-server-preview.service` były 2026-07-23 aktywne odpowiednio od 09:45:19 UTC i 09:49:45 UTC.
- Od tych restartów do czasu analizy żaden serwis nie zarejestrował `poker_act_bot_autoplay_step_error`, `ws_bot_timeout_safety_autoplay` ani `showdown_incomplete_community`.
- Journal zajmuje 3,8 GB. Próba pełnego wielokrotnego skanu od 2026-07-01 była zbyt kosztowna do użycia jako powtarzalny check; liczby historyczne pochodzą z agregatu zapisanego w issue.

### Wersja kodu

- Analiza została wykonana po `git fetch --prune origin` na commitcie `fd26caf2bd31a44f2300f256e530848b131f9c84`, równym aktualnemu `origin/main` w chwili analizy.
- Produkcyjny symlink `/opt/ws-server/current` wskazywał release tego samego commita.
- Preview działa z `/opt/arcade-ws-preview/ws-server`. Metadane checkoutu wskazują historyczny branch `codex/migrate-gameplay-writes-to-ws-only`, ale uruchomione kopie `ws-server/server.mjs`, `ws-server/poker/handlers/bot-autoplay.mjs` i `shared/poker-domain/poker-autoplay.mjs` były identyczne z `origin/main`.
- Historyczna nazwa brancha katalogu preview nie jest wiarygodnym identyfikatorem artefaktu. Ręczny deploy i log startowy powinny wskazywać konkretny branch oraz SHA.

## Potwierdzona przyczyna nieskończonego retry

```text
sweepTurnTimeoutsAndBroadcast()
  -> ws_bot_timeout_safety_autoplay
  -> handleBotStepCommand()
  -> runBotStep()
  -> acceptedBotAutoplayExecutor()
  -> runBotAutoplayLoop()
  -> applyAction()
```

Potwierdzony kontrakt błędu wygląda następująco:

1. `applyAction()` zwraca konkretny błąd `showdown_incomplete_community`.
2. `runBotAutoplayLoop()` redukuje go do ogólnego `botStopReason: "apply_action_failed"`.
3. `accepted-bot-autoplay-adapter.mjs` zwraca `ok: true`, `changed: false` i `reason: "apply_action_failed"`.
4. `shouldSuppressBotTimeoutSafetyRetry()` wymaga `ok: false`, braku zmiany i konkretnego powodu inwariantu.
5. Suppression nie aktywuje się, a scheduler ponawia autoplay dla tego samego niezmienionego stanu.

To potwierdza przyczynę pętli operacyjnej. Nie potwierdza przyczyny niepełnego boardu. Brakujące dane w reducerze, błędny runout, niepełny restore prywatnego runtime i historyczny niepoprawny stan persisted pozostają hipotezami do sprawdzenia, a nie założonym zakresem naprawy.

## Source of truth i pakowanie

- Source of truth logiki wspólnego autoplay: `shared/poker-domain/poker-autoplay.mjs`.
- Adapter WS: `ws-server/poker/runtime/accepted-bot-autoplay-adapter.mjs`.
- `ws-server/shared/poker-domain/poker-autoplay.mjs` jest wyłącznie statycznym re-exportem source of truth.
- `netlify/functions/_shared/poker-autoplay.mjs` jest wrapperem importującym source of truth.
- Nie istnieje generowany artefakt zawierający kopię implementacji autoplay ani skrypt generujący taką kopię.
- Istniejące workflow `.github/workflows/ws-preview-deploy.yml` i `.github/workflows/ws-server-deploy.yml` pakują pliki repo do artefaktu wdrożeniowego. Nie należy ręcznie kopiować ani synchronizować implementacji między katalogami.

## Strategia realizacji

Zmianę należy podzielić na trzy małe PR-y. PR A jest pilnym ograniczeniem skutków operacyjnych. PR B może powstać dopiero po potwierdzeniu źródłowej przyczyny. PR C pozostaje niezależny od logiki gry.

### PR A — zatrzymanie pętli operacyjnej

Zakres:

- w `shared/poker-domain/poker-autoplay.mjs` zachować strukturalne `botFailureReason` obok ogólnego `botStopReason`;
- w `ws-server/poker/runtime/accepted-bot-autoplay-adapter.mjs` zwrócić dla tego błędu `ok: false`, `changed: false` i konkretny `reason`;
- przed zmianą kontraktu wyszukać i przejrzeć wszystkich konsumentów wyniku `runBotAutoplayLoop()`, `acceptedBotAutoplayExecutor()` i `handleBotStepCommand()`, a dla każdego jawnie potwierdzić obsługę nowego `ok: false` i konkretnego `reason`;
- rozszerzyć istniejącą mapę `suppressedBotTimeoutSafetyFailures` w `ws-server/server.mjs`, bez tworzenia drugiego rejestru suppression;
- zachować klucz mapy `tableId`, ponieważ `listDueTurnTimeouts()` filtruje po tabeli, a w wartości zapisać fingerprint `{ handId, stateVersion, turnUserId, reason }`;
- w `isBotTimeoutSafetyRetrySuppressed()` porównać zapisany fingerprint z bieżącym stanem runtime i zwrócić `true` wyłącznie dla identycznego `tableId + handId + stateVersion + turnUserId`;
- zablokować kolejne autoplay po pierwszym konkretnym deterministycznym błędzie dla tego samego fingerprintu;
- zapisać pojedynczy terminalny `klog` z `tableId`, `handId`, `stateVersion`, `phase`, `turnUserId` i konkretnym `reason`;
- w `isBotTimeoutSafetyRetrySuppressed()` usunąć wpis po zmianie `stateVersion`, `handId` lub `turnUserId`;
- w istniejącym `pruneBotTimeoutSafetySuppressions()` usuwać wpis po wyładowaniu albo zamknięciu stołu;
- przy każdym poprawnie zakończonym autoplay dla tabeli usunąć jej wpis z `suppressedBotTimeoutSafetyFailures`.

Zachowanie po suppression:

- suppression zatrzymuje automatyczne retry, ale nie naprawia stołu;
- PR A nie wykonuje automatycznego settlementu;
- PR A nie modyfikuje stosów ani puli;
- PR A nie zamyka i nie naprawia stołu bez osobnego, bezpiecznego projektu księgowego;
- PR A nie dodaje ani nie wywołuje restore dla tej nowej ścieżki błędu;
- stół może pozostać aktywny bez postępu;
- terminalny log oznacza jawny stan wymagający recovery lub ręcznej analizy.

Termin `quarantine` nie jest używany w PR A, ponieważ nie ma istniejącej semantyki produktu ani lifecycle stołu odpowiadających takiej operacji.

#### Decyzja dotycząca restore

Istniejący call graph recovery obejmuje `recoverFromPersistConflict()` w `ws-server/poker/runtime/persist-conflict-recovery.mjs`, następnie `restoreTableFromPersisted()` w `ws-server/server.mjs`, a na końcu `tableManager.restoreTableFromPersisted()` w `ws-server/poker/table/table-manager.mjs`.

Ta ścieżka jest obecnie przeznaczona dla konfliktów persistence. `restoreTableFromPersisted()` ładuje persisted bootstrap, a metoda table managera podmienia `table.coreState` bez porównania załadowanej wersji z bieżącą wersją runtime. Nie jest więc gotowym, bezpiecznym mechanizmem recovery dla błędu inwariantu autoplay.

W konsekwencji PR A:

- nie może bezpośrednio wywołać `recoverFromPersistConflict()` dla `showdown_incomplete_community`;
- nie może dodać nowego odczytu DB ani nowej ścieżki podmiany runtime;
- nie może zastąpić runtime stanem o niższej lub tej samej wersji tylko dlatego, że autoplay zwróciło błąd;
- ogranicza się do suppression i terminalnego `klog`.

Projekt recovery należy do PR B. Jeżeli reprodukcja potwierdzi potrzebę restore, projekt musi użyć istniejących metod po dodaniu jawnej kontroli wersji przed mutacją: persisted version nie może być niższa od runtime, a zastąpienie stanu o tej samej wersji wymaga dodatkowego, deterministycznego dowodu uszkodzenia runtime oraz testu braku utraty zaakceptowanej akcji. Walidacja ma nastąpić przed wywołaniem mutującego `tableManager.restoreTableFromPersisted()`.

Minimalne testy regresyjne należy dodać przez rozszerzenie istniejących plików, bez nowego frameworka:

- `ws-server/poker/runtime/accepted-bot-autoplay-adapter.behavior.test.mjs`: konkretny `botFailureReason` przechodzi przez cały kontrakt, a adapter zwraca `ok: false`, `changed: false`;
- `ws-server/server.behavior.test.mjs`: drugi sweep tego samego `tableId/handId/stateVersion/turnUserId` nie uruchamia ponownie `applyAction()`, natomiast zmiana `stateVersion` lub `handId` usuwa suppression;
- `ws-server/poker/handlers/bot-autoplay.behavior.test.mjs`: zwykłe `completed`, `turn_not_bot` i `non_action_phase` pozostają poprawnymi wynikami `ok: true`.

PR A ogranicza skutki operacyjne, ale nie zamyka #737.

### PR B — źródłowa naprawa niepełnego boardu

Najpierw odtworzyć reprezentatywny stan na granicy reducer–autoplay. Reprodukcja ma ustalić, w którym miejscu po raz pierwszy łamany jest inwariant pięciokartowego boardu i które dane są wtedy autorytatywne.

Dopiero wynik reprodukcji wybiera miejsce korekty:

- reducer;
- runtime restore;
- runout;
- settlement;
- albo migracja/obsługa historycznego stanu persisted.

Nie należy z góry wdrażać rekonstrukcji z `deck`, `handSeed` ani restore prywatnego runtime. Nie należy łączyć kilku hipotetycznych korekt w jednym PR.

Jeżeli przyczyna wymaga recovery z persisted state, PR B musi zaprojektować kontrolę wersji i walidację przed mutacją w istniejącym call graphie `recoverFromPersistConflict()` → `restoreTableFromPersisted()` → `tableManager.restoreTableFromPersisted()`. Nie należy tworzyć równoległej ścieżki DB→runtime.

Minimalne testy PR B:

- jeden test regresyjny dokładnie dla potwierdzonego scenariusza źródłowego w istniejącym pliku najbliższym naprawianej granicy;
- poprawny all-in/runout kończy się pięcioma kartami community i dokładnie jednym settlementem, jeśli reprodukcja dotyczy tej ścieżki;
- stan nieodtwarzalny nie zmienia żetonów ani puli.

Jeżeli po udokumentowanej analizie stan historyczny pozostanie niereprodukowalny, decyzja o uznaniu go za zdarzenie historyczne musi być jawna i oparta na monitoringu po PR A. Dopiero wtedy można zdecydować, czy #737 można zamknąć bez PR B.

### PR C — obserwowalność

Zakres niezależny od logiki gry:

- logowanie branch/SHA i środowiska przy starcie artefaktu;
- ograniczenie powtarzalnych logów dla tego samego klucza stanu i reason;
- zagregowane liczniki po reason;
- zachowanie pierwszego i terminalnego zdarzenia.

PR C nie zmienia reducerów, autoplay, settlementu, stosów ani puli.

## Weryfikacja PR A

Uruchomić minimalny zestaw istniejących testów:

```bash
node --test ws-server/poker/handlers/bot-autoplay.behavior.test.mjs
node --test ws-server/poker/runtime/accepted-bot-autoplay-adapter.behavior.test.mjs
node --test ws-server/server.behavior.test.mjs
```

Każda komenda powyżej jest niezależna i jednowierszowa. Nie należy dodawać nowego runnera ani szerokiego zestawu spekulacyjnych fixture.

## Rollout i monitoring

1. Uruchomić ręczny workflow `WS Preview Deploy` dla konkretnego brancha lub SHA PR A.
2. Podać jawny SHA jako wejście workflow, a następnie zapisać w wynikach weryfikacji URL/ID GitHub Actions runu, branch, podany SHA i czas zakończenia deployu. Log startowy z SHA nie jest warunkiem rollout PR A.
3. Zweryfikować preview jednowierszową komendą:

```bash
sudo journalctl -u ws-server-preview.service --since "<deploy time>" --no-pager | grep -E "poker_act_bot_autoplay_step_error|ws_bot_timeout_safety_autoplay|ws_bot_timeout_safety_same_state_retry_suppressed|showdown_incomplete_community"
```

4. Potwierdzić brak serii powtórzeń dla tego samego `tableId/handId/stateVersion`, poprawne autoplay zwykłych rozdań oraz widoczny pojedynczy terminalny log dla stanu zablokowanego.
5. Po pozytywnej obserwacji preview uruchomić produkcyjny rollout konkretnego SHA.
6. Zweryfikować produkcję analogiczną jednowierszową komendą:

```bash
sudo journalctl -u ws-server.service --since "<deploy time>" --no-pager | grep -E "poker_act_bot_autoplay_step_error|ws_bot_timeout_safety_autoplay|ws_bot_timeout_safety_same_state_retry_suppressed|showdown_incomplete_community"
```

7. Powtórzyć kontrolę po minimum 30 minutach aktywnego ruchu i po 24 godzinach.

Rollback powinien przywrócić poprzedni znany SHA. Suppression nie jest dowodem naprawy źródłowego problemu i nie może być użyte do ukrycia stołów wymagających ręcznej analizy.

## Notes

- Zadanie dotyczy krytycznej logiki realtime poker: przejść stanu, autoplay, settlementu i ochrony przed nieskończoną pętlą.
- Zmiany mają być proste, małe i ograniczone do potwierdzonego problemu danego PR.
- Należy użyć istniejących funkcji, adapterów i mechanizmu suppression.
- Nie wolno tworzyć duplikującej ścieżki autoplay ani ręcznie synchronizowanej kopii source of truth.
- Zmiana kontraktu wyniku autoplay z `ok: true` na `ok: false` dla błędu aplikacji akcji ma możliwy breaking impact dla callerów i wymaga jawnego audytu wszystkich konsumentów.
- WS pozostaje source of truth dla aktywnego runtime; DB jest wtórnym persisted state i nie może nadpisywać nowszego stanu WS bez istniejącej kontroli wersji.
- Logowanie wyłącznie przez `klog`.
- Nie logować kart prywatnych, pełnego state ani sekretów.
- JSP: not applicable.
- CSS: not applicable.
- CSP: not applicable, o ile plan nie zmienia browser scripts.
- Każdy PR wpływający na WS wymaga ręcznego `WS Preview Deploy` dla konkretnego brancha lub SHA.
- Testy są w tym zadaniu świadomym wyjątkiem od ogólnej zasady niedodawania testów, ponieważ zabezpieczają krytyczne przejścia stanu i regresję nieskończonej pętli.
- Testy mają rozszerzać istniejące pliki, używać istniejącego runnera i obejmować wyłącznie minimalne deterministyczne przypadki.
