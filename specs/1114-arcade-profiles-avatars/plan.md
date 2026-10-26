# Implementation Plan: profile i avatary — wersja uproszczona

**Data**: 2026-10-26 • **Status**: v3.2 — lokalna faza A, owner art PASS; lokalna implementacja A  
**Spec**: [spec.md](spec.md) • **Tasks**: [tasks.md](tasks.md)  
**Odczyt źródeł**: main `a63e44b0d9a1d3625956ed98b75c1242989efdd3`. Main ponownie zweryfikowany bez zmiany SHA. Obecny etap: lokalny kod/testy fazy A po zatwierdzeniu wszystkich16 grafik. Bez PR, aplikowania schema/cleanup, publikacji APK i operacji środowiskowych.

## Architektura i Constitution Check

Rozszerzyć istniejący profil, katalog i API. WWW pozostaje JS/IIFE zgodne z JSP, backend Node ESM/Supabase/Sharp, APK pakuje wspólne zasoby. Nie budować drugiego Auth, renderera, panelu admina, backfill frameworka lub ogólnej kolejki. Bez nowych pakietów domyślnie. `klog`, CSS jedna fizyczna linia na selektor, CSP SHA/SRI przy zmianie skryptów, brak sekretów/PII w logach.

Testy wyłącznie fundamentalnej logiki i istniejące pakiety: profile/avatar/Auth, bezpieczeństwo report/moderation, Storage/deletion, dedup mail. Nie dodawać UI/CSS/JSP/simple-glue suite. Krótkie wizualne smoke per zmieniona faza, bez ponownej kampanii zaakceptowanego Offline.

WS jest źródłem prawdy gry. Zmiany allowlisty/projekcji/reakcji mają exact-SHA Preview gate, a **Terms wymaga potwierdzenia przed nowym korzystaniem z konta**, lecz nie kontroli każdego zakładu/rozdania/rebuy/settlement. WS obejmuje tylko konieczną granicę nowego użycia, np. pierwszy JOIN do nowego stołu, oraz społeczną publikację; nie ogólny dispatcher, rollover czy przerywanie gry. Jeśli wykryty realny wymóg prawny wymaga innego zakresu, STOP i review zamiast automatycznej przebudowy lifecycle.

Przyszły PR z `supabase/migrations/**` może automatycznie wykonać DB Stage Apply PR. Jawnie zadeklarować zakres i uzyskać GO przed publikacją takiego PR; to nie read-only CI. Nie zmieniać applied migrations. Production i skutki merge/deploy osobno autoryzowane. Nie zmieniać `.specify` lub innych konfiguracji dla samego planowania.

## Mapa istniejących miejsc

| Obszar | Istniejące źródła i metody | Minimalna zmiana |
|---|---|---|
| Provisioning | `supabase/migrations/20260713090000_user_profile_provisioning_visibility.sql::ensure_user_profile()` i signup trigger | Nowa forward-only definicja istniejącej funkcji: docelowo16, bez nowego triggera i resetu sześciu wariantów |
| Model/projekcja | `shared/profile-avatar-projection.mjs::PUBLIC_AVATAR_VARIANTS/projectPublicAvatar()`, `_shared/user-profile.mjs::publicProfile()/ownerProfile()/updateUserProfile()/updateUserAvatarKey()` | 10 nowych kluczy, brak BIO/manual writes, jeden kontrolowany wybór; zachować wire default/uploaded |
| API profilu | `netlify/functions/profile-me.mjs::validatePatch()`, `profile-public.mjs`, `_shared/xp-leaderboard-read.mjs` | Picker/visibility, bez name/handle/BIO upload; public read po bieżącym handle, zwykły not-found dla starego zmienionego URL |
| Prezentacja | `js/profile-client.js::applyAvatar()/updateMe()`, `js/auth/supabaseClient.js::applyProfileAvatar()/renderUser()`, `account.html`, `js/account-page.js`, `public-profile.html`, `js/public-profile-page.js`, `js/leaderboard-page.js` | Jeden katalog i read-only name/handle; prosty Terms krok; bez BIO/file input |
| Poker identity | `poker/poker-v2.js::renderSeatAvatar()`, `ws-server/poker/read-model/public-poker-identity.mjs`, `poker/profile/public-profile-repository.mjs`, `table/table-manager.mjs` profile cache | Rozpoznawanie nowych wariantów i odświeżenie tożsamości, bez zmiany seat/game state |
| Reakcje | `ws-server/poker/handlers/reaction.mjs`, `poker/poker-v2.js::appendReactionHistory()/renderReactionHistory()` i bubbles | Terms tylko przy nowej społecznościowej publikacji; w B viewer filter/sender-safe block, bez ingerencji w betting |
| Zdjęcia/lifecycle | `_shared/profile-avatar.mjs::finalizeAvatar()/removeAvatar()`, Sharp, `shared/account-deletion-storage.mjs`, `private.account_avatar_objects` i `profile_avatar_uploads` V3 | A zamyka publiczny upload i wycofuje legacy; C reużywa transform/manifestów z intent przed I/O |
| Admin | `admin.html`, `js/admin-page.js`, `_shared/admin-auth.mjs::requireAdminUser()` | B jedna sekcja Reports, prywatne decyzje/audit; bez financial ops |
| APK/Offline | `mobile/poker/package-web.mjs`, `scripts/build-poker-offline-poc.mjs`, istniejący renderer/CSS | Lokalne16 i dokumenty; regeneracja HTML/JS wyłącznie przez generator, bez nowego Auth w Offline |
| Dokumenty/schedule | `legal/privacy.en.html`/PL, `legal/terms.en.html`/PL; `bonus-campaigns-scheduled.mjs` jako wzorzec | Treść per faza; D osobny mały scheduled handler, bez zmiany bonusów |

Nowe nazwy poniżej są propozycją implementacji, nie istniejącym kodem.

## Faza A — profile, avatary i prosty Terms

### Katalog i minimalny model

Assety proponowane `assets/avatars/arcade/<variant>.webp`, jeden contact sheet16 do owner art approval; sprawdzić czytelność24/48/256 px i budżet ≤25 KiB/szt./≤400 KiB. Sześć istniejących kluczy zachowane, dziesięć nowych utrwalić na bramce art. Jedna mapa ze wspólnej allowlisty, browser IIFE generowane obecnym buildem zamiast ręcznych duplikatów.

A zmienia tylko istniejący profil i niezbędne receipts: `avatar_revision` (CAS), trwałe `google_photo_suppressed` (zapamiętuje wybór także przed przyszłą fazą C), Terms receipt. Brak tabel reports/delivery, photo decyzji lub importera wymaganych do A. Istniejące `avatar_variant` pozostaje fallbackiem; wybór katalogu zapisuje wariant, odłącza zdjęcie i ustawia suppression atomowo. Nowy losowy default nie jest świadomym wyborem i sam nie ustawia suppression. Istniejące profile po uporządkowaniu mają auto-import zatrzymany, żeby login nie odtworzył historycznych zdjęć. Nie jest to zakaz przyszłego jawnego wyboru Google: w C nowa świadoma zgoda może zmienić tę flagę. Osobna blokada moderatora powstaje w B i nie jest zapisywana jako ta sama flaga użytkownika; wybór katalogu, cleanup lub reconsent nie mogą jej skasować.

Do włączenia C A publikuje tylko katalogowe avatary. Legacy uploaded nie są nową dopuszczoną publikacją; projekcja A neutralizuje je przed porządkowaniem, a późniejszy cleanup odłącza ich klucze. Nie wykonywać fake Google importu lub samych hotlinków „tymczasowo”.

### Terms — jeden świadomy krok, ograniczony guard

**Obowiązkowy UX do LEGAL gate:** po email confirmation/uwierzytelnieniu Google lub na następnym wejściu istniejącej sesji pokazać wersję Terms, linki Terms/Privacy i jeden przycisk „Akceptuję regulamin”. Nie dodawać wymaganego checkboxa potwierdzającego tę samą czynność. Email signup przed wysłaniem pokazuje dokumenty i informuje o kroku; nie wymuszać nowego signup proxy/auth hook. Przed authenticated receipt konto może istnieć w Auth, ale nie może rozpoczynać nowego korzystania z usług konta ani publikować UGC; trwająca gra i safety mają wyjątek. To jawna, uproszczona definicja, a nie twierdzenie o blokadzie bezpośredniego utworzenia auth.users.

Proponowane `netlify/functions/profile-onboarding.mjs` i `shared/profile-terms.mjs`: `getOnboardingStatus()`, `acceptTerms()`, `requireTermsForPublication()`. Minimalny prywatny receipt: subjectKind account/guest, subjectRef z właściwej zweryfikowanej sesji, termsVersion, server acceptedAt, requestId. Unique subject+version oraz subject+requestId; bez klientowskiego czasu, IP/UA lub user_metadata jako dowodu. Brak akceptacji nie jest błędem OAuth. Nie backfillować Terms za użytkownika.

- GET: required version/document URLs i własny status `pending/current`; prywatny stan private/no-store, publiczna część nie ujawnia cudzych decyzji. GET bez write.
- POST `acceptTerms(version, requestId)`: jedno jawne potwierdzenie, serwerowa wersja i subject, idempotentny wynik + aktualny status. Zły subject odmowa, zła wersja409. Replay starego requestu nie akceptuje nowej wersji.
- Granica nowego użycia: po resolve Auth w WWW/APK przed wejściem do usług konta pokazać obowiązkowy krok; serwer odmawia nowego startu (create/quick-seat/Single Player start oraz nowy registered JOIN, jeśli można ominąć wcześniejsze API) bez current receipt. Istniejący stół/resume ustalać serwerowo, nie z client flag „reconnect”. Nie dodawać sprawdzania do mint tokenu, jeżeli te granice już skutecznie egzekwują warunek. T031 ma zamkniętą listę nowych entrypoints; brak skutecznej granicy = STOP aktywacji. Nie rozszerzać helpera na finansowy silnik lub każdy command.
- UGC boundary: public avatar/profile publication i publikowane reakcje. Picker write można objąć tym samym helperem jako prostą kontrolowaną granicą publicznej zmiany profilu, choć katalog sam nie jest własną treścią użytkownika. Photo import dopiero C. Stary upload jest zamknięty niezależnie od Terms.
- Dla WS sprawdzenie na rzeczywiście koniecznej granicy nowego pozyskania miejsca i w istniejącym handlerze nowej reakcji/treści społecznej, również z już aktywnego socketu; ograniczony cache receipt z unieważnieniem na zmianę wymaganej wersji. Nie wstrzykiwać kontroli do ogólnego `verifySupabaseJwt`, każdego commandu, rebuy, turn clock, startu kolejnego rozdania lub hand completion. Nowy JOIN odróżnić od idempotentnego retry/Resume już istniejącego miejsca bez nowego buy-in. T031 wylicza rzeczywiste publikujące entrypoints i sprawdza brak obejścia przez stary APK/direct API.
- Bez current Terms nowe wejście do usług konta/start gry jest zablokowane, ale kontynuacja istniejącej gry/jej rozliczenie zachowuje dotychczasowe zasady; logout, deletion/status, support, report/block, photo withdrawal i privacy opt-out nie wymagają current Terms. Nie ukrywać odmowy jako awarii logowania. Pending blokuje nowe korzystanie z konta oraz publikację; nie przerywa trwającej gry i nie blokuje Offline.
- Istniejąca sesja: prompt w lobby/Account, niezabierający czasu w aktywnej ręce; przy bezpośrednim wejściu do nowego stołu krok poprzedza nowy start/JOIN; w już trwającej grze jest dostępny bez zasłaniania timera i bez wymuszonego przerwania, a social controls wymagają potwierdzenia. Po current receipt nie pytać ponownie aż do nowej wymaganej wersji. Nie resetować przyszłej odmowy zdjęcia przy zmianie Terms.
- Guest publikujący reakcję: ten sam prosty krok i zweryfikowany guest receipt z krótką retencją sesji, bez nowego konta; anonymous viewer/report/local block bez Terms receipt. Offline tylko lokalne dokumenty i gra, bez wysyłki przyszłej akceptacji po odzyskaniu sieci.

**Ocena prawna blokuje aktywację wzorca:** ustalić, czy moment obowiązkowej akceptacji, granice nowego użycia konta oraz guard publikacji są wystarczające dla wybranej umowy/usługi i kraju. Obowiązkowy krok przed nowym korzystaniem z konta jest aktualnym wymaganiem właściciela; Google UGC dodatkowo wymaga zasad przed tworzeniem/publikacją. Nie wynika z tego wymóg dodatkowego checkboxa ani sprawdzania Terms przy każdym zakładzie. LEGAL zatwierdza wyjątek kontynuacji istniejącej gry i właściwy moment zawarcia umowy. Jeżeli LEGAL wskaże konieczne dodatkowe ograniczenie, wrócić do owner review zakresu, nie zmieniać teraz poker lifecycle.

### Jednorazowe uporządkowanie

1. Odczytać małe zestawienie liczników i constraints: własne pola/zdjęcia/BIO, sześć wariantów, konta w deletion, liczba tracked obiektów. Raport bez PII; zatwierdzić konkretny zakres/czas i before/after invariants.
2. Jedna nowa forward-only operacja porządkująca dla zatwierdzonego niewielkiego zbioru; użyć istniejącego generatora nazw/handle, nie usuwać/reprovision kont. Zachować potwierdzone automatyczne handle, pozostałe normalizować do nowych unikalnych. Niepewny display name ustawić automatycznie. Zachować UUID, avatar_variant, CH, XP, leaderboard privacy, auth i grę.
3. Odłączyć legacy avatar_key, ustawić suppression i usunąć BIO. Najpierw znikają write/read/UI; fizyczny drop BIO dopiero po dowodzie zgodnych SQL readers. Zamknąć upload-url/finalize przed operacją, ale zachować istniejący manifest/purge dla wcześniej wydanych capabilities.
4. Przed odłączeniem zdjęć zapewnić wpis w istniejącym trackerze obiektów. Storage cleanup jest odrębną, śledzoną operacją istniejącego mechanizmu z osobnym GO, bez HTTP w transakcji migracji. Nie wprowadzać nowego archiwum obrazów, źródeł Google URL lub checkpoint service.
5. Dla niewielkiego inventory preferować pojedynczą transakcję SQL z istniejącą kolejnością lifecycle→profile i standardowym zapisem wykonania migracji. Konta w toku deletion pomija normalizacja i raportuje je, pozostawiając ich istniejący purge; żadnego resurrection. Jeśli wielkość/lock time nie pozwala na bezpieczną jednorazową operację, STOP i review zamiast samodzielnej budowy batch frameworka.
6. Awaria transakcji → rollback i odczyt wyniku; nie ślepe ponowne losowanie nazw po zatwierdzonym wykonaniu. Standardowa historia operacji i before/after counts wystarczają. Po usunięciu prywatnych treści rollback nie odtwarza ich publicznie.

Public profile lookup używa wyłącznie bieżącego handle. Zmieniony stary URL może zwrócić not-found; nie utrzymujemy historii dla routingu i nie potrzebujemy jej testów/retencji. To zaakceptowany breaking impact. Nie obiecywać, że dawny handle pozostaje na zawsze zarezerwowany bez dodatkowej struktury; jeśli taka gwarancja okaże się wymagana, wymaga nowej decyzji, nie ukrytego odtworzenia starego mechanizmu.

### Bramki A

- Art approval i G-LEGAL-A przed implementacją/aktywacją odpowiednich części.
- T033: **wcześniejszy osobno zatwierdzony Stage** — addytywna schema i kompatybilne WWW/APK/WS readers, Terms guard publikacji, upload zamknięty, bez cleanup/drop/Google. Preflight i exact runtime SHA/health/hash; ograniczony identity/Terms/reconnect smoke. Provisioning nadal6 i nowe wybory7–16 nieaktywne do potwierdzenia zgodnych readerów.
- T012 po T033: odrębne GO na jednorazowe uporządkowanie i ewentualne istniejące Storage purge; żadnej zależności od końca B/C/D.
- T010: A odbiór po zmianie danych i usunięciu nieużywanych kontraktów, aktywacji16 po kompatybilności, krótkim scoped smoke. Każda zmiana deployable od T033 wymaga właściwej ponownej weryfikacji SHA, nie pełnego powtarzania kampanii.
- Production A osobne GO; nie obejmuje B/C/D. A nie może wymagać photo consent, import schema, mail providera lub moderacji nowych zdjęć, bo tych zdjęć nie włącza. Usuwa historyczne własne treści; nie deklaruje tym samym całego Play M1 jako gotowego.

## Faza B — report/block/admin

Nowe, małe `_shared/profile-moderation.mjs`, `profile-report.mjs`, `profile-blocks.mjs`, `admin-profile-reports.mjs`, `admin-profile-moderate.mjs`; reuse JWT/CORS/store/parserów i `requireAdminUser()`. Schema B powstaje w B, nie prerequisite A.

Minimalne prywatne dane: report (reporter kind/ref, subject, kind/context, reason, requestId, reported revision/key, time), status `open/resolved/dismissed`, oddzielny contentState `current/changed/unavailable`; block pair account→subject; osobna `google_photo_moderation_blocked` na profilu, modyfikowalna tylko przez uprawnionego moderatora; append-only admin action actor/reason/revision/time. Nie dodawać reviewing/claimed/reopen workflow, assignment systemu lub kopiowania pełnych snapshotów. Nowa istotna sprawa może utworzyć nowy report, a korekta decyzji ma jawny audit.

| Widz | Report | Block |
|---|---|---|
| Account, także pending Terms | Zweryfikowana sesja, receipt tylko własnego zgłoszenia | Prywatna serwerowa para, własna lista między WWW/APK |
| Guest przy stole | Istniejący podpisany guest proof sprawdzony jako guest, nie Supabase account | Lokalna lista sesji/instalacji; informacja o ograniczonej trwałości |
| Visitor publicznego profilu | Dostępny formularz bez signup, ograniczona signed visitor capability, expiry i rate limit | Lokalnie hide/unblock; przy braku storage pamięć sesji i jawny komunikat |

Capability/guest subject nie daje prawa odczytu cudzych reportów. Reuse limitów: proponowane5 nowych spraw/10min i20/dobę/konto, dodatkowe global/IP-hash ograniczenie dla visitor, krótka retencja antyspam, bez fingerprintingu. Idempotency subject+requestId: identyczny payload→ten sam receipt, inny→409. Reporter nie wskazuje arbitralnego obiektu Storage do usunięcia. Statusy i dowody serwerowo weryfikowane albo jawnie insufficient evidence, bez automatycznego karania za liczbę zgłoszeń.

Wspólne UI kontekstu w profilu/Account/stole, bez wymuszenia tworzenia konta dla safety. W APK report/block są osiągalne w aplikacji, nie wyłącznie przez mailto lub obcy Browser. Local Browser/WebView lists nie są potajemnie synchronizowane. Anonymous nie otrzymuje prywatnej listy account. Report/block safety nie wymaga current Terms.

Filtrować tylko prezentację: neutralna etykieta/avatar i reakcje/history/social overlays od subject. Powiązanie z trwałym uczestnikiem, nie samym seatNo. Private viewer responses no-store, brak block list w WS broadcast. Auth switch czyści viewer cache, błąd listy nie przywraca świadomie ukrytych treści temu samemu widzowi; authoritative stack/bets/timers/pot/settlement niezmienione.

Admin panel jedna kolejka/detail i decyzja z requestId/revision, powód wymagany, audit prywatny. Hide-photo/suppress używa aktualnej oczekiwanej rewizji; zmienione/usunięte zgłoszone zdjęcie oznacza changed/unavailable. Nie oceniać nowej grafiki jako starej, nie kasować nowszego klucza i nie refetchować z Google. Brak materiału → rozstrzygnięcie insufficient evidence/wycofane zgodnie z procedurą. Ewentualna globalna sankcja content/suppression wymaga osobnego jawnego uzasadnienia, nie dotyka CH/access/game. Odwołanie przez istniejący kontakt, bez nowego ticket systemu.

Retencja do legal review: minimalne metadata/audit180dni po zamknięciu; brak domyślnego dowodu obrazowego. Legal hold tylko konkretnej sprawy, z terminem/dostępem/purge. User deletion usuwa/pseudonimizuje nowe dane zgodnie z zatwierdzoną polityką, nie blokuje V2/Auth-last na zawsze. Operator jest wyznaczony i monitoruje panel/pilne sprawy także bez digestu. B ma własne Stage/WS Preview (dla zmienionych ścieżek) i osobne Production GO.

## Faza C — Google photo po gotowej B

G-import: A PASS, B PASS (działające reporting/blocking/admin i obsada), legal/UGC/photo disclosure, śledzenie deletion i poprawne provider proof. **Bez D w zależnościach.** Publiczne zdjęcia nie są włączane przez samą zmianę klienta lub domyślne pole Terms.

Minimalny model C: oddzielny photo receipt `noticeVersion`, `decision=granted/declined/withdrawn`, server decidedAt/withdrawnAt, consentRevision; brak rekordu=brak zgody. Używać istniejącego `avatar_key`, revision i suppression z A. Nie dodawać `avatar_source` enum ani osobnej wielostanowej maszyny importu. Stan zewnętrznego zapisu i idempotency wynikają z istniejących manifestów/operation reference; reuse zamiast równoległej kolejki.

W Account/Google onboarding oddzielna, dobrowolna opcja domyślnie niezaznaczona; Terms potwierdzane swoim przyciskiem tylko jeśli brak current receipt. Odmowa nie zmienia Auth/Terms. Withdraw dostępne także pending Terms; atomowo suppress/revision/odłączenie klucza i tracked purge. Wybrany katalog lub cofnięcie pozostawiają auto-import zatrzymany po relogin/zmianie Terms. Dodać jawny „Użyj zdjęcia Google”: nowa dobrowolna niezaznaczona zgoda i requestId/consentRevision po bieżącym świadomym działaniu, z nowym provider proof w razie potrzeby. Tylko ten odrębny request może atomowo wyczyścić suppression użytkownika; zwykły login/callback nie może grantować zgody ani wyzerować flagi. `google_photo_moderation_blocked` sprawdzane niezależnie przed zgodą/importem i ponownie przy attach, nigdy czyszczone przez user endpoint. Zmiana/zdjęcie blokady przez moderatora samo niczego nie importuje. Legacy suppression działa identycznie jak zatrzymanie automatu, nie dożywotni zakaz. Brak zdjęcia zawsze daje fallback.

Proponowany `profile-avatar-google-import.mjs` i `fetchGoogleAvatar()` w istniejącym `_shared/profile-avatar.mjs`:

1. Zweryfikować sesję, active account, current Terms i osobną decyzję zdjęcia; sprawdzić brak blokady moderatora, linked Google identity i provider proof. Preferowana do potwierdzenia w Stage droga: aktualny ephemeral `session.provider_token`, fixed Google userinfo endpoint, zgodność sub z server-side powiązaną identity. `user_metadata.avatar_url/picture`, email i client URL nie są dowodem. Jeśli brak proof w APK, STOP C i review; nie zmieniać w zastępstwie Auth linking.
2. Import poza krytycznym callbackiem logowania, bez DB lock podczas HTTP. Jedna próba na rzeczywisty Google sign-in i existing rate limit/idempotency (operacja związana z serwerowo potwierdzonym session_id i revision, nie nowym dowolnym client requestId); bez pętli w rerender/getMe i zachowywania provider tokena do przyszłego joba. Fail nie blokuje OAuth; przyszła dozwolona próba tylko z nowym proof, grant i niesuppressed.
3. HTTPS ścisłej allowlisty Google image hosts/path, sprawdzenie publicznego IP/DNS i redirectów (preferowane bez redirect), limit czasu proponowany5s, stream≤1MiB i pixels≤1024², bez SVG/animacji. Nigdy nie wysyłać własnego auth headera do hosta zdjęcia. Nie zapisywać proof/URL w logu lub DB.
4. Reuse małego normalizatora wydzielonego z `finalizeAvatar()`: Sharp rotate/resize256/WebP/strip metadata, losowy key, `upsert:false`. Tracked intent/output w istniejących manifestach **przed Storage I/O**. Jeśli obecny tracking V3 wymaga małego rozszerzenia dla źródła google, zrobić je wraz z guards/reconciliation w C; A go nie wymaga. Bez fake signed grant i omijania Account Deletion.
5. Attach w krótkiej transakcji lifecycle→profile, revision/consent/suppression oraz niezależny moderation-block/idempotency check; przegrany lub niepewny output pozostaje tracked do purge. Nie nadpisać nowego wyboru/moderacji lub konta w deletion. Zachować dotychczasowy wire uploaded/Storage-origin allowlist i profile refresh.

Source Storage i publiczne key cache mają obecnie długi cache horizon. Zatwierdzić retencję/usunięcie źródła i ewentualną invalidację CDN; przyszłe photos proponowany cache≤1h. Nie obiecywać skasowania już pobranych kopii. Google name/email nie trafiają do publicznej tożsamości.

C ma osobny schema/Stage/WS gate według rzeczywistego diffu, testy i ograniczony smoke Google success/fallback/withdraw/race. Rzeczywiste Account Deletion, funded gameplay i wysyłka maili nie są automatycznie upoważnione przez C smoke. Production C tylko osobne GO.

## Faza D — digest niezależnie od C

Reuse konwencji scheduled function z `bonus-campaigns-scheduled.mjs`, ale bez zmiany bonusów. Proponowany `profile-reports-scheduled.mjs`, helper delivery tylko jeśli potrzebny. Brak znalezionego ogólnego mail transportu: OWNER wybiera transactional provider, odbiorcę/secrets i oddziela Stage/Production; nie zakładać dostępności Auth SMTP dla digestu. Nie potrzeba frameworka powiadomień.

Propozycja pon08:00UTC; nowe od ostatniego potwierdzonego cutoff **lub** nadal open sprawy → jeden digest, zero spraw→zero maila. Counts/severity i admin link wymagający auth, bez names/handles/zdjęć/opisów/UUID. Brak maili o block/unblock.

Minimalny delivery receipt z unique week+environment+recipient, cutoff i provider deliveryId. Wynik pending/sent/unknown wystarczy. Confirmed sent przesuwa checkpoint. Failure before-send może mieć ograniczony retry; lost response→unknown i provider dedup/reconcile, nie ślepy resend ani obietnica exactly-once bez wsparcia providera.

Pilne alerty do zatwierdzenia: poważne groźby/wykorzystanie dziecka/ujawnienie danych wymagają triage; max1/case, zbiorczo≤1/15min i≤4/24h/środowisko. Bez sensitive payload, bez auto-ban/financial action. Ewentualne prawne zgłoszenie organom ma osobną procedurę, nie e-mail z materiałem. Stage fake sender lub osobno zatwierdzony test recipient; żadnych rzeczywistych maili w tym planowaniu. D może wejść po B, nie czeka na import C.

## Prawo, dokumenty i istniejące issue

Aktualne oficjalne źródła do oceny, sprawdzone 2026-10-26:
- [Play UGC](https://support.google.com/googleplay/android-developer/answer/9876937?hl=en): zasady przed publikacją, reporting/blocking i skuteczna moderacja, również publicznych zdjęć provider. Przycisk Terms i wąski server guard są propozycją spełnienia, nie gwarancją Play PASS.
- [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy): czytelny cel i zgoda przy nowym użyciu danych. Zdjęcie nie publikuje się z samego OAuth; Google nie moderuje za nas.
- [GDPR](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32016R0679), [EDPB consent](https://www.edpb.europa.eu/documents/guideline/guidelines-052020-on-consent-under-regulation-2016679_en), [prawo do wizerunku art.81](https://api.sejm.gov.pl/eli/acts/DU/2025/24/text.pdf): LEGAL zatwierdza podstawy/treść/retencję, w C odrębny opt-in i możliwość withdrawal. Nie łączyć zgody zdjęcia z Terms ani akceptacją Privacy.
- [Supabase Google](https://supabase.com/docs/guides/auth/social-sign-in/auth-google), [identity linking](https://supabase.com/docs/guides/auth/auth-identity-linking): reużyć istniejącego UUID/provider, brak ręcznego scalania po email i dodatkowych scopes/refresh-token magazynu na zapas.
- [Play User Data](https://support.google.com/googleplay/android-developer/answer/10144311?hl=en), [deletion](https://support.google.com/googleplay/android-developer/answer/13327111?hl=en): Privacy/deletion V2 live i nowe dane muszą być opisane zgodnie z rzeczywistością. Console pozostaje UNKNOWN bez dowodu.

Treści per faza w `legal/privacy.en.html`/PL, `legal/terms.en.html`/PL i istniejącym wspólnym Help/Account: A katalog/automatyczne profile/Terms i utrata starych zmienionych linków; B report/block/operator/retencja; C publiczne Google photo/zgoda/withdraw/processor; D operatorskie powiadomienia. Nie opisywać C jako działającej w wydaniu A. Dokumenty i kontakt dostępne przed loginem, lokalne minimum w APK; support mailto wymaga sprawdzenia obecnego interceptora w `mobile/poker/runtime.js` przy realizacji właściwego zakresu.

Po akceptacji osobno zaproponować aktualizację #1114 (16+picker, brak uploadu/manual pól i brak ochrony starych URL), #1116 (Google w C, FB/GitHub nadal discovery), #1140 (prosty Terms/UGC per faza i Console OPEN), #1138 (A–D zależności, bez cofania Offline PASS). Teraz nie edytować issues ani #1146.

## Weryfikacja, rollout i breaking impacts

Fundamentalne existing tests: `tests/public-profiles.behavior.test.mjs`, `tests/profile-avatar.behavior.test.mjs`, `tests/auth-identity.test.mjs`, `tests/account-deletion-storage.behavior.test.mjs`, `tests/account-deletion.behavior.test.mjs`, WS identity/reaction tests. Małe nowe tests tylko business rules Terms/report/digest, bez UI snapshotów.

A: allowlista/stabilność, picker CAS, odrzucenie manual writes/upload, Terms version/idempotency/bypass UGC, jednorazowy cleanup i before/after invariants. B: auth/IDOR/dedup/limits, viewer filter nie zmienia gry, stale moderation. C: provider proof/sub, fetch limits, intent/attach race i zatrzymanie automatu/reconsent/moderator-block/deletion. D: empty/new/open/unknown-send/urgent dedup. Wygląd przez krótki smoke, grafika przed kodem.

Każda faza: preflight współdzielonego Stage → jawnie zatwierdzony apply/deploy → właściwe smoke → review. WS gate gdy zmienia `ws-server/**`, runtime `shared/**` lub protocol: workflow definition main, application exact runtime SHA; sukces workflow + aktywne releaseSha/PID/hash/health, potem bounded changed-path verification. Green Netlify/CI nie zastępuje WS dowodu. Późniejsze docs-only nie wymagają ponownego deploy po sprawdzeniu diffu. Production osobny preflight/GO dla konkretnej fazy; WS merge może automatycznie uruchomić deploy/restart, Netlify również. Ten plan niczego nie włącza.

Breaking impacts: stare zmienione handle URL mogą zniknąć; stare APK PATCH name/handle/BIO/upload dostają bezpieczną odmowę; historyczne zdjęcia/BIO/nazwy wycofane; nowe warianty wymagają zgodnych readerów i fallbacku starych klientów; Terms blokuje nowe korzystanie z konta i publikację do receipt, ale nie przerywa już trwającej gry; prywatne viewer filtry oraz nowa retencja B/C; mail transport D. Nie ma zmiany UUID/CH/XP/offline save/gameplay. Zasoby APK aktualizują się nowym APK, nie samym WWW merge.

Rollback: przed aktywacją nowych kluczy zachować zgodność starego readera; po zmianie nie wracać do runtime nieznającego aktywnych wariantów. Schema expand przed contract/drop. Po cleanup nie odtwarzać prywatnych starych treści; korekty forward-only, istniejące manifesty i suppression pozostają. Nie naprawiać ręcznie ledgera/danych.

## Self-review

Ograniczono model do potrzeb danej fazy; usunięto utrzymanie historycznych URL i rozbudowane backfill/import stany; Terms ograniczono do rozpoczęcia nowego korzystania z konta i publikacji, bez globalnego gate każdego ruchu. Końcowe korekty rozdzielają user suppression (odwracalne nowym jawnym wyborem i zgodą) od moderator-block (nieobchodzalne przez użytkownika). A nie ma zależności od B/C/D; C wymaga gotowej B, D wymaga tylko B. T033 nadal poprzedza T012 i ma osobne GO; odbiór A nie czeka na końcowe T029. Sprawdzono 21 unikalnych nieukończonych zadań, wszystkie odwołania i acykliczność grafu; US1–US6/FR-001–FR-012 mają pokrycie. Potwierdzono niezależność A, T033 przed T012, B jako prerequisite C i brak zależności C od D. Brak deklaracji wykonania implementacji, live smoke lub prawnego/Console PASS.

## Art preview — wyłącznie do akceptacji

Przygotowano [planszę16 projektów](artwork/avatars-contact-sheet-v1.png); klucze i pełne prompty/proweniencja w [artwork/README.md](artwork/README.md). Pierwsze6 odpowiada dotychczasowym kluczom, kolejne10 to propozycje. To materiał wizualny, bez podłączenia do aplikacji i bez oceny jako gotowe assety24/48/256px. T005 owner approval nadal OPEN; nie rozpoczęto optymalizacji/implementacji ani innych faz.

Follow-up review lokalny: domknięte PL/EN, gift Terms w canonical transaction po paid replay i przed BURN, bez zmian cen/entries. Wyniki212 PASS i pełne materiały do niezależnego review: [review-followup.md](review-followup.md). Bez operacyjnego GO.

**Schema-first również przy Terms OFF:** nowy runtime zawsze odczytuje `private.profile_terms_policy` i receipts. Addytywna schema i nowe pola profilu muszą istnieć przed uruchomieniem nowych readerów; OFF nie zabezpiecza starej schemy. Końcowa korekta legal, odczyt Production i bezpieczna propozycja Draft: [review-final-legal.md](review-final-legal.md). Bez wykonania kolejnej bramki.
