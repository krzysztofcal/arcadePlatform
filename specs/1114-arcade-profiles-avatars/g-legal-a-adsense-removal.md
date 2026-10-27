# G-LEGAL-A — usunięcie własnego AdSense: lokalny odbiór

2026-10-27. OWNER: Arcade pozostaje darmowym, niekomercyjnym projektem hobbystycznym; usuwamy własny mechanizm AdSense. Google Analytics pozostaje opcjonalny i zależny od zgody. LEGAL nadal OPEN.

## Izolacja i źródło

Aktualny GitHub main potwierdzony `git ls-remote origin refs/heads/main` i `git fetch --no-tags origin main`: **a63e44b0d9a1d3625956ed98b75c1242989efdd3**. Niezależna lokalna gałąź `fix/remove-web-adsense`, worktree `/tmp/arcade-remove-adsense`, nie historyczny snapshot ani runtime diff PR1155. Przeczytano aktualne agents.md/skills.md. Bez push/PR creation, buildów, deploy, merge i konfiguracji środowisk. PR1155 nadal Draft; jego kod/SQL/APK nie jest przenoszony do tej poprawki.

## Dokładny zakres

- `index.html`, `landing/index.html`: usunięte meta publishera, po jednym slocie ins/section i src adsense-init; pozostałe skrypty/treść bez zmian.
- `js/adsense-init.js`, `landing/js/adsense-init.js`: usunięte po sprawdzeniu wszystkich referencji runtime; test już nie oczekuje ich istnienia.
- `js/consent-services.js` i kopia landing: usunięte ADS_CLIENT, initAds/scheduleAds/ensureAds i wszystkie wywołania googleAds. ensureAnalytics/syncFromKlaro, event arcadeConsentChanged i ArcadeConsent.showManager pozostają. Kopie obu deployów identyczne.
- `js/klaro-config.js` i kopia landing: usunięta usługa googleAds, cookies, cel advertising i opisy PL/EN; notice mówi tylko o opcjonalnej analityce. Nazwa cookie180dni/version1 oraz dotychczasowa usługa Analytics bez zmiany. Nie kasujemy ani nie migrujemy zgód użytkownika: stare googleAds=true jest ignorowane, bo nie ma usługi ani loadera, także przy bezpośrednim wywołaniu handleConsent.
- `css/portal.css`, `landing/css/landing.css`: tylko usunięcie zbędnych reguł ad-slot. Brak nowych selektorów i reformatowania istniejącego CSS; nie zmieniamy gameplay/layoutu innych elementów.
- `_headers`: z **każdej z5 polityk CSP** usunięto wyłącznie pagead2.googlesyndication.com, googleads.g.doubleclick.net, tpc.googlesyndication.com i *.adtrafficquality.google. Automatyczne porównanie z HEAD potwierdziło, że po odjęciu tych hostów całe pliki są identyczne; wszystkie hashe i inne dyrektywy zachowane. Googletagmanager, Google Analytics/region1, Supabase/Auth, WS, CDN i pozostałe domeny bez zmian. Brak nowych inline scripts.
- `tests/static-html.behavior.test.mjs`: zastąpione oczekiwania AdSense. Istniejący VM test sprawdza prawdziwy consent helper/config: denied GA+stare adstrue nie wstrzykuje niczego, udzielenie zgody GA uruchamia tylko jeden skrypt i polecenia js/config, ponowne sync nie dubluje, showManager działa. Skan wszystkich tracked HTML wykrywa slot/meta/publisher/loader/AdSense URL; kontrola CSP odrzuca hosty reklamowe. Nie dodano frameworka ani testów layoutu.

Pełne przeszukanie własnych HTML/JS/CSS nie wykazało innych aktywnych ścieżek AdSense w Account, Poker ani legal. Istniejące tekstowe wzmianki o reklamach w opublikowanych dokumentach cookies pozostają zgodnie z zakazem zmiany legal HTML; nie są loaderami. Testy mogą zachować negatywne/stare-cookie fixtures i obronne mockowanie domen, nie oczekują już reklam. Zewnętrzne gry/iframy i decyzje innych dostawców nie są kontrolowane przez usunięcie własnego AdSense; nie deklarować globalnego braku reklam u osób trzecich.

## Fundamentalne wyniki

- RED przed implementacją: istniejący static-html test po zmianie oczekiwań odrzucał obecność adsense-init (true!==false). Log `/tmp/arcade-adsense-red.log`.
- GREEN: `node tests/static-html.behavior.test.mjs`, exit0; wszystkie dotychczasowe asercje poza zastąpionymi wymaganiami reklam zachowane. Log `/tmp/arcade-adsense-green.log`.
- `node scripts/syntax-check.mjs`: PASS230files. Osobne node --check dla obu consent-services/klaro-config oraz testu: PASS.
- `node scripts/check-csp-inline-hashes.mjs`: PASS56served documents. Nowych/zmienionych inline skryptów brak, więc hashe nie wymagały regeneracji. Zmodyfikowane external JS nie mają przypiętych SRI w HTML; istniejące SRI innych zasobów bez zmian.
- `git diff --check`: PASS. Runtime source scan: zero AdSense publisher/loader/slot/domain w własnych HTML/JS/CSS (z wyłączeniem testów/dokumentacji/vendorów). Nie wykonywano szerokiego zestawu UI, finansów, Auth ani CI hosted.

## Krótki rzeczywisty smoke sieciowy

Uruchomiono istniejący Chromium/Playwright bez instalacji zależności, lokalnie na loopback z aktualną CSP. Skrypt pomocniczy `/tmp/arcade-remove-adsense-smoke.mjs`, log `/tmp/arcade-adsense-network.log`; po teście zamknięto przeglądarkę i serwery.

- Portal: `/`, `/account.html`, `/poker/`, `/legal/privacy.en.html`; landing oddzielnie z własnym publish root.
- Prawdziwe Klaro z zapisanym cookie `googleAds=true, googleAnalytics=false`: brak żądań GA/AdSense; bezpośrednie wywołanie starej usługi nadal bez skutku.
- Potem zgoda GA przez rzeczywistego managera Klaro: prawdziwy gtag/js z Google HTTP200 i żądanie collect. Żądanie collect przechwycono lokalnie204, **nie dostarczono zdarzenia do Analytics**. Potwierdza działanie inicjalizacji i transportu, nie raportowanie danych w panelu GA.
- Oba publish roots: **0 żądań reklamowych**, usługa AdSense niewidoczna, showManager PASS. Brak logowania; inne zewnętrzne API/CDN/fonty/WS blokowane w tym ograniczonym smoke. Nie wykonywano JOIN, operacji wirtualnych sald ani żądań do Production.

## Breaking impacts / dalsza bramka

Zamierzona zmiana: usunięcie slotów/odstępu reklamowego i opcji reklam w managerze oraz brak możliwości emisji własnego AdSense po przyszłym rollout (bez twierdzenia, że wcześniej osiągano przychody). Bez funkcjonalnych zmian GA/Auth/WS/APK, bez zmiany schematu zgód. Cookie starej zgody może pozostać, lecz nie daje ścieżki wykonania reklam. Klient z już otwartą starą wersją może nadal mieć dawny skrypt w pamięci do przeładowania; nie obiecywać natychmiastowego globalnego wyłączenia istniejących kart.

Brak runtime WS/protocol/dependency zmian, więc ta poprawka nie wymaga WS Preview Deploy. Nie przebudowano APK; jego packager już wyłącza consent-services/Klaro z aplikacji. Po ewentualnym zatwierdzeniu osobnego PR: standardowe checki/Preview i osobne GO na publikację WWW obu witryn, potem odczyt rzeczywistych odpowiedzi/CSP oraz krótki test nowej/starej zgody na opublikowanych witrynach. **Nie wykonano deploymentu ani nie potwierdzono braku reklam w Production.** Nie zmieniono TermsON ani opublikowanych Terms/Privacy/cookies.

Robocze Privacy PL/EN w lokalnym SpecKit PR1155 zaktualizowano wyłącznie o docelowy brak własnych reklam po rollout; to nie część runtime diffu ani publikacja dokumentów. Rzeczywisty aktualny stan Production i dalszy odbiór LEGAL pozostają oddzielne.

Zasoby: przed checkout5.8GB, po checkout5.7GB; brak npm install, cache download lub cleanup. Wykorzystano istniejące node_modules i Chromium.

## Osobny Draft PR / Hosted Preview — 2026-10-27

OWNER zatwierdził publikację tej niezależnej poprawki. Utworzono od początku Draft **#1156**: https://github.com/krzysztofcal/arcadePlatform/pull/1156 . Pierwszy code SHA **4fdb599b333c2aabaede4d997e0856aebba59d60**, base maina63e44b0…; dokładnie13 zatwierdzonych plików. Wcześniejszy opis „bez push/PR creation” jest historycznym stanem lokalnego odbioru, nie aktualnym stanem tego PR. PR1155 pozostaje nietknięty/Draft63186718… . Nie wniesiono jego Terms SQL, retencji, aplikacji ani schemy do #1156.

### Checki pierwszego code SHA

- Wymagane według efektywnego ruleset: `actionlint` i `netlify/playkcswh/deploy-preview`: **SUCCESS**; strict up-to-date zachowane. Nie zmieniono reguł ani nie użyto bypassu.
- CI40595341541, Tests40595341417, WS PR Checks40595341420, WS Server Deploy40595341447, Infra VPS40595341476, Validate games40595341491 i CodeQL40595336818: SUCCESS. `deploy_ws=false`, WS deploy job SKIPPED, infra apply SKIPPED; brak DB Stage Apply triggera i brak finansowego live chips-integration (SKIPPED).
- Istniejący opcjonalny Android workflow ma szeroki trigger js/** i wystartował automatycznie. Anulowany świadomie40595341443 w celu zachowania zakresu bez APK; upload SKIPPED i artifacts0. Nie jest required checkiem i nie anulowano go z powodu porażki testów. Nie dispatchowano żadnego workflow.
- Netlify playkcswh deploy **6ae126067f0f41d0646e300d**, ready/deploy-preview, exactcodeSHA4fdb599b… . URL https://deploy-preview-1156--playkcswh.netlify.app .

### Rzeczywisty Hosted smoke

Skrypt `/tmp/arcade-adsense-hosted-smoke.mjs`, wynik `/tmp/arcade-adsense-hosted-results.json`. Headless Chromium, bez konta/loginu. Wszystkie endpointy Functions/API, WebSocket i pozostałe mutujące żądania zablokowano w harnessie: nie dostarczono Auth/XP/finansowych smoke do backendu. To **UI/static compatibility**, nie potwierdzenie zalogowanego profilu, listy stołów lub rozgrywki WS.

- Portal `/`, wariant `/landing/`, Account, Poker Lobby i Privacy: HTTP200, rzeczywiście serwowana CSP bez hostów AdSense i z zachowanymi domenami GA; stare cookie googleAds=true/GA=false nie uruchamia reklam ani GA. Brak slotów/meta publishera i widocznej usługi AdSense.
- Portal i `/landing/`: udzielenie zgody prawdziwym Klaro ładuje Google gtag HTTP200 i uruchamia config/collect; kolekcja została przechwycona204 bez dostarczenia do GA. showManager PASS. **0 reklamowych żądań sieciowych.**
- Freedoom: właściwa scoped CSP, załadowany runtime Dwasm, ukryty loading overlay/pokazany restart, canvas i API gry; zero naruszeń CSP. Snake: canvas, reset/start i kierunek z klawiatury PASS, zero naruszeń CSP; wszystkie próby sieci XP zablokowane. Bez nowych finansowanych scenariuszy.
- `/landing/` zgłasza istniejące naruszenie script-src-attr dla onload font-preload. Dokładnie ten handler jest już w bazowym main(landing/index.html14), a zasady inline pozostają identyczne — CSP diff usuwa tylko domeny reklam. Nie dodano handlera ani nie osłabiono CSP. Jest to pre-existing landing issue, nie regresja AdSense; nie rozszerzamy tej poprawki o zmianę ładowania fontów.

### Dedykowana witryna landing — BLOCKED, nie ukrywać ograniczenia

Read-only oficjalne Netlify API potwierdza dla **landing-kcswh** idd40103ad-1fd9-4896-9e65-584e34f9833b `build_settings.stop_builds=true`, base/landing. Brak deploya#1156; https://deploy-preview-1156--landing-kcswh.netlify.app/ zwraca404. Ostatnie istniejące Preview są historyczne/failed, nie mają kodu tego PR. Nie odblokowano witryny ani nie zmieniono konfiguracji/stop_builds — mogłoby to uruchomić nieautoryzowany Production build.

Hosted `/landing/` na play Preview potwierdza kod wariantu i faktycznie serwowaną tam CSP, **ale NIE dowodzi CSP ani deploya osobnej witryny landing-kcswh**. Pełny odbiór obu osobnych publikacji pozostaje BLOCKED tym stanem środowiska. Rozwiązanie wymaga oddzielnego ustalenia bezpiecznego Preview-only sposobu dla landing, bez globalnego odblokowania buildów Production; nie zmieniamy workflowów/konfiguracji w tej poprawce i nie zastępujemy tego wyniku lokalnym PASS.

Weryfikacja statusów i aktualnego dokładnego HEAD po docs-only uzupełnieniu będzie w opisie PR. Aktualizacja raportu nie zmienia zweryfikowanego kodu runtime; przy nowym SHA należy potwierdzić ready deploy/required checks i identyczność statycznych plików. Production site metadata przed publikacją PR: play6adf43aa3debf6e93a3fa53a, landing6acfd5effa83daccd5de95d4; brak autoryzacji do Production i brak merge.
