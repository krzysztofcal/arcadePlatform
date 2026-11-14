# #1154 — prepared OWNER decision update

GitHub write attempt: HTTP403 Resource not accessible by personal access token. Not posted; issue remains OPEN. No permission bypass or alternate credential attempt.

Decyzja OWNER dla #1158 (lokalna implementacja, 2026-10-28): wybieramy minimalny wariant **istniejący adres HTTPS → zewnętrzna przeglądarka → jawne logowanie w tej przeglądarce**, jeżeli nie ma ona własnej sesji. Sesja Capacitor WebView nie jest automatycznie sesją przeglądarki. Po zalogowaniu użytkownik wraca do profilu przez Back lub ponowne otwarcie linku.

Bez SSO, tokenów JWT/refresh w URL, dodatkowego systemu przekazywania sesji i duplikowania profilu w APK. Działający OAuth powracający do APK pozostaje bez zmian. Docelowe profile/ranking z #1158 wymagają JWT również po stronie API; operatorowa blokada nadal obowiązuje.

Implementacja jest obecnie wyłącznie lokalna na stosie nad zatwierdzonym #1155 (`810a77b1…`). Nie została wypchnięta ani wdrożona. Fizyczny test APK → przeglądarka i zgodność docelowego API pozostają do osobnego odbioru; nie zamykamy tego issue jako seamless SSO PASS. Dalsze SSO nie jest zatwierdzone. Brak zmiany Production/Auth settings lub publikacji APK. LEGAL OPEN.
