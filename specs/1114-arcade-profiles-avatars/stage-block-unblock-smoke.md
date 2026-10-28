# PR #1155 — finalny niefinansowy Stage block/unblock smoke

2026-10-28T14:07:16.183Z. Wynik autoryzowanego zakresu: **PASS**. LEGAL pozostaje OPEN; WS seated snapshot jawnie NOT TESTED.

## Tożsamość / zakres

Supabase Stage `krydukthwdvccggbyjfw`, system`7656985631720456337`. Netlify i WS Preview SHA `a87e06c4335e7c8170d523b4f8d9497c4372c3cc`. 121/121 zgodnych migracji/file/hash, pending0; LIVE Redis V3 Stage PASS. Read-only preflight: brak ludzkich miejsc/resume, nierozliczonych żądań ludzi lub wykrytych niebezpiecznych stanów finansowych; bot-only stoły zbilansowane.

Dokładnie jedno wcześniej przypięte, kontrolowane konto Stage, zweryfikowane UUID + email z konfiguracji OWNER. Żaden przypadkowy profil. UUID/email/handle, pełne snapshoty, fingerprinty i czasy operacji wyłącznie w chronionym prywatnym protokole poza repozytorium, nie w tym raporcie lub PR. Przed blokadą bez deletion, blokadafalse i chronione pola zgodne z przygotowaniem.

Istniejący niezmieniony `operations/set-public-profile-block.sql`, SHA256 `4e895c1fce8b22777bd58926e8ae93a7a7c7cfe20bedee62c8608e39854f8660`. Wykonano operacyjną treść skryptu przez istniejący uprawniony Supabase management executor, z dokładnym podstawieniem jego zmiennych psql (bez zmiany źródła/SQL lub zagnieżdżania transakcji). Dokładnie dwa przejścia: false→true→false. Przed każdym potwierdzono Stage system i ten sam UUID. Bez dodatkowych prób i zmian innego konta.

## Wyniki osobno

| Scenariusz | Wynik | Dowód |
|---|---|---|
| Owner GET przed blokadą | OWNER-CONFIRMED PASS | Ręczne logowanie OWNER, profile-me HTTP200 i kompletny profil; potwierdzenie gotowości przed true |
| WS helloAck/authOk | OWNER-CONFIRMED PASS | Odebrane komunikaty w Lobby przed blokadą; bez JOIN |
| HTTP block | PASS | Publiczny200 przed; po true404 z dokładnym not_found, no-store, bez ujawnienia powodu |
| Ranking | PASS | Faktycznie widoczny przed; nieobecny podczas blokady; widoczny po false, ten sam okres/strona/limit, bez nadawaniaXP |
| Owner GET podczas true | OWNER-CONFIRMED PASS | OWNER odświeżył Account i potwierdził profile-me200 oraz kompletny profil właściciela |
| HTTP unblock | PASS | Po przywróceniu false publiczny200, poprawna nazwa/katalogowy avatar i no-store |
| Przywrócenie danych | PASS | Niezależny read-only: ten samUUID, false, wszystkie pierwotne pola identyczne poza updated_at |
| WS seated snapshot/replay ukrywający tę tożsamość | NOT TESTED | Konto nie ma miejsca; nie tworzono stołu ani fundedJOIN; brak tożsamości w tabeli botów nie został nazwany PASS |

Po true odczekano 96 sekund przed końcowym publicznym sprawdzeniem (konserwatywnie ponad domyślne60s WS i wcześniejsze30s HTTP). Endpoint obecnie no-store. Okno czasowe nie zastępuje brakującego testu seated WS i nie cofa danych już dostarczonych klientowi.

Chronione pola porównano jako pełny JSON profilu po wyłączeniu public_profile_blocked oraz updated_at. Na końcu dodatkowo porównano wszystkie oryginalne pola łącznie z przywróconą flagą, z wyłączeniem wyłącznie updated_at. Zmiana updated_at jest oczekiwanym skutkiem istniejącego triggera, a nie zmianą avatar_revision, wariantu lub privacy. Fingerprint końcowy równy baseline. Nie nadpisywano oryginalnego updated_at, by sztucznie uzyskać identyczność.

## Stan końcowy i granice

51 profili, **0 aktywnych blokad**, historia/hash121/121, Terms OFF/a1, katalog16 ON. Wynik przywrócenia jest potwierdzonym stanem, nie tylko wysłanym żądaniem SQL. Nie pozyskano ani nie zapisano JWT/refresh tokenów; brak HAR. Ręczne logowanie wykonał OWNER. Publiczne GET mogą aktualizować istniejące krótkie liczniki rate-limit; nie wywoływano operacji finansowych lub czyszczenia cache.

Bez nowych kont/stołów, JOIN, buy-in, gift, celowych awariiDB, CH/XP/ledger writes przez test, zmian Terms/Privacy, push, deploy, APK, Ready lub merge. Nie zmieniano konfiguracji Production ani runtime. PR pozostaje Draft. Odbiór tego ograniczonego smoke nie jest LEGAL PASS ani pełną regresją finansową/rozgrywki.
