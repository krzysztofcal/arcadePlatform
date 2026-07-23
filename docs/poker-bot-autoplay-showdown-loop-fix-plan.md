# Plan naprawy pętli bot autoplay przy `showdown_incomplete_community` (#737)

Status: plan po analizie `origin/main` i logów systemd z 2026-07-23.

## Cel

Usunąć przyczynę niepełnego boardu podczas automatycznej akcji bota, a jednocześnie zagwarantować, że deterministyczny błąd dla niezmienionego stanu nie uruchomi ponownie tej samej operacji bez końca. Poprawka ma zachować zwykły bot autoplay, runout all-in, showdown, settlement i rollover.

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
- Journal zajmuje 3,8 GB. Próba pełnego wielokrotnego skanu od 2026-07-01 była zbyt kosztowna do użycia jako powtarzalny check; liczby historyczne pochodzą z agregatu zapisanego w issue. Krótkie okna kontrolne dla obu usług nie wykazały badanego wzorca.

### Wersja kodu

- Analiza została wykonana po `git fetch --prune origin` na commitcie `fd26caf2bd31a44f2300f256e530848b131f9c84`, równym aktualnemu `origin/main` w chwili analizy.
- Produkcyjny symlink `/opt/ws-server/current` wskazywał release tego samego commita.
- Preview działa z `/opt/arcade-ws-preview/ws-server`. Metadane checkoutu wskazują historyczny branch `codex/migrate-gameplay-writes-to-ws-only`, ale kluczowe uruchomione pliki:
  - `ws-server/server.mjs`;
  - `ws-server/poker/handlers/bot-autoplay.mjs`;
  - `shared/poker-domain/poker-autoplay.mjs`

  są identyczne z `origin/main`. Historyczna nazwa brancha nie może być używana jako identyfikator wdrożonego artefaktu; deploy powinien publikować jawny SHA.

## Call graph i luka w obecnym zabezpieczeniu

```text
sweepTurnTimeoutsAndBroadcast()
  -> ws_bot_timeout_safety_autoplay
  -> handleBotStepCommand()
  -> runBotStep()
  -> acceptedBotAutoplayExecutor()
  -> runBotAutoplayLoop()
  -> applyAction()
  -> settleHandState()
  -> materializeShowdownAndPayout()
  -> showdown_incomplete_community
```

1. `shared/poker-domain/poker-autoplay.mjs` łapie wyjątek z `applyAction()`.
2. Loguje konkretny `error`, ale zapisuje wynik pętli tylko jako `botStopReason: "apply_action_failed"`.
3. `accepted-bot-autoplay-adapter.mjs` zwraca następnie `ok: true`, `changed: false` i `reason: "apply_action_failed"`.
4. `shouldSuppressBotTimeoutSafetyRetry()` blokuje retry wyłącznie dla `ok: false`, `changed !== true` i konkretnego powodu, między innymi `showdown_incomplete_community`.
5. W rezultacie obecne zabezpieczenie nie może zadziałać dla dokładnie tej ścieżki. Scheduler widzi nadal przeterminowaną turę bota na tym samym `stateVersion` i próbuje ponownie.

To wyjaśnia nieograniczone retry, ale nie wyjaśnia jeszcze, dlaczego stan nie potrafił zbudować pięciokartowego boardu. Tę przyczynę trzeba naprawić, a nie tylko wyciszyć scheduler.

## Plan implementacji

### 1. Dodać reprodukcję na granicy reducer–autoplay

Pliki:

- `ws-server/poker/shared/poker-action-reducer.behavior.test.mjs`;
- `ws-server/poker/runtime/accepted-bot-autoplay-adapter.behavior.test.mjs`;
- `ws-server/server.behavior.test.mjs`.

Zbudować fixture odpowiadający obserwacji: tura bota, legalny `CALL`, brak zmiany wersji, przejście w kierunku showdown i niepełna `community`. Warianty fixture powinny rozróżnić:

- prawidłowy runout z kompletnym `deck`;
- odtworzenie boardu z `handSeed`, gdy prywatny `deck` jest niedostępny;
- stan, w którym brakuje zarówno wystarczającego `deck`, jak i poprawnego materiału do deterministycznego odtworzenia;
- stan odtworzony po restarcie z publicznym snapshotem nałożonym na prywatny runtime.

Test integracyjny schedulera ma wykonać dwa sweepy dla tego samego `stateVersion` i potwierdzić, że `applyAction()` zostaje wywołane tylko raz po sklasyfikowaniu deterministycznego błędu.

### 2. Naprawić źródłowe przejście do showdown

Pliki docelowe zależą od wyniku fixture, przede wszystkim:

- `ws-server/poker/shared/poker-action-reducer.mjs`;
- `ws-server/poker/shared/runtime-hand-state.mjs`;
- `ws-server/poker/runtime/accepted-bot-autoplay-adapter.mjs`;
- `ws-server/poker/shared/settlement/poker-materialize-showdown.mjs`.

Wymagana własność: zanim settlement wymagający porównania układów zostanie uruchomiony, runtime musi posiadać dokładnie pięć kart community pochodzących z autorytatywnego prywatnego stanu.

Preferowana kolejność źródeł:

1. istniejąca kompletna `community`;
2. pozostałe karty z autorytatywnego `deck`;
3. deterministyczne odtworzenie z `handSeed` i kolejności graczy bieżącego rozdania.

Nie wolno syntetyzować losowych kart ani rozliczać puli na podstawie niepełnego/publicznego snapshotu. Jeśli stan jest nieodtwarzalny, akcja ma zakończyć się jawnym błędem inwariantu i wejść w kontrolowaną ścieżkę recovery/quarantine, bez mutacji żetonów i bez kolejnego automatycznego `CALL`.

### 3. Zachować konkretną przyczynę błędu w kontrakcie autoplay

Pliki:

- `shared/poker-domain/poker-autoplay.mjs`;
- `ws-server/poker/runtime/accepted-bot-autoplay-adapter.mjs`;
- odpowiednie kopie generowane używane przez artefakt deploy.

Rozszerzyć wynik pętli o strukturalne pole błędu, na przykład:

```js
{
  botStopReason: "apply_action_failed",
  botFailureReason: "showdown_incomplete_community"
}
```

Adapter powinien zwracać `ok: false`, `changed: false` i konkretny `reason` dla błędu aplikacji akcji bez persistu. Nie należy parsować tekstu logu ani zastępować wszystkich błędów ogólnym `apply_action_failed`.

Testy mają potwierdzić, że błędy persistence/conflict zachowują własną klasyfikację i nadal korzystają z istniejącego recovery, a zwykłe powody zatrzymania (`turn_not_bot`, `non_action_phase`, `completed`) pozostają poprawnymi wynikami `ok: true`.

### 4. Wzmocnić blokadę retry dla niezmienionego stanu

Pliki:

- `ws-server/poker/handlers/bot-autoplay.mjs`;
- `ws-server/server.mjs`.

Po naprawie kontraktu istniejący mechanizm suppression zacznie obsługiwać `showdown_incomplete_community`. Należy dodatkowo:

- kluczować blokadę co najmniej przez `tableId + stateVersion + handId + turnUserId`, aby nie przenieść jej na inne rozdanie;
- usuwać blokadę po zmianie wersji, zamknięciu/wyładowaniu stołu lub udanym recovery;
- dla nieodtwarzalnego inwariantu uruchomić jeden kontrolowany restore z persisted state, a dopiero przy identycznym wyniku po restore ustawić suppression/quarantine;
- zalogować pojedyncze zdarzenie terminalne zawierające `tableId`, `handId`, `stateVersion`, `phase`, `turnUserId` i konkretny reason;
- nie dodawać czasowego retry, które po upływie backoffu ponowi ten sam deterministyczny błąd bez zmiany stanu.

### 5. Uzupełnić identyfikację artefaktu i obserwowalność

- Przy starcie obu usług logować deploy SHA i środowisko.
- W procesie deploy preview zapisywać SHA niezależnie od metadanych starego checkoutu.
- Dodać liczniki zagregowane po `reason`, bez logowania pełnego stanu, kart prywatnych lub sekretów.
- Rozważyć rate limiting powtarzalnych logów tego samego `tableId/stateVersion/reason`; pierwsze i terminalne zdarzenie muszą pozostać widoczne.

## Weryfikacja przed merge

Uruchomić co najmniej:

```bash
node --test ws-server/poker/shared/poker-action-reducer.behavior.test.mjs
node --test ws-server/poker/handlers/bot-autoplay.behavior.test.mjs
node --test ws-server/poker/runtime/accepted-bot-autoplay-adapter.behavior.test.mjs
node --test ws-server/server.behavior.test.mjs
npm run test:ws
```

Scenariusze akceptacyjne:

- zwykły bot `CALL` aktualizuje stan i scheduler kontynuuje;
- all-in przed riverem odkrywa pełny board i settlement wykonuje się dokładnie raz;
- board może zostać bezpiecznie odtworzony z `handSeed` po restarcie;
- nieodtwarzalny stan nie zmienia stosów ani puli;
- drugi sweep tego samego uszkodzonego `stateVersion` nie uruchamia ponownie autoplay;
- zmiana wersji lub skuteczny restore odblokowuje poprawne przetwarzanie;
- produkcja i preview korzystają z tego samego kontraktu.

## Rollout i monitoring

1. Wdrożyć najpierw na `ws-server-preview`.
2. Zanotować czas wdrożenia i SHA.
3. Przez minimum 30 minut aktywnego ruchu oraz ponownie po 24 godzinach porównać:

```bash
sudo journalctl -u ws-server-preview --since "<deploy time>" --no-pager \
  | rg "poker_act_bot_autoplay_step_error|ws_bot_timeout_safety_autoplay|ws_bot_timeout_safety_same_state_retry_suppressed|showdown_incomplete_community"
```

4. Kryterium powodzenia:
   - brak serii powtórzeń dla tego samego `tableId/handId/stateVersion`;
   - brak zatrzymanych aktywnych rozdań;
   - normalne autoplay i settlement w testowych stołach;
   - brak wzrostu Shared Pooler egress skorelowanego z timeout-safety.
5. Po pozytywnej obserwacji wdrożyć produkcję i wykonać analogiczny check dla `ws-server.service`.

Rollback powinien cofnąć artefakt do poprzedniego SHA. Jeżeli źródłowa korekta przejścia stanu okaże się ryzykowna, można osobno wdrożyć naprawę kontraktu błędu i suppression jako zabezpieczenie operacyjne, ale nie zamykać #737, dopóki reprodukcja źródłowego niepełnego boardu nie jest naprawiona.

## Zakres proponowanego PR implementacyjnego

Jeden PR może objąć kroki 1–4, jeśli fixture jednoznacznie wskaże pojedynczą przyczynę. Jeżeli reprodukcja ujawni niezależny błąd restore prywatnego stanu, bezpieczniejszy podział to:

1. PR A: propagacja konkretnego błędu, skuteczne same-state suppression i test schedulera;
2. PR B: korekta rehydratacji/runoutu oraz testy settlement;
3. PR C: identyfikacja SHA i ograniczenie log volume.

PR A ogranicza skutki operacyjne, ale sam nie spełnia warunku zamknięcia issue.
