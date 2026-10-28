# Feature Specification: profile i avatary Arcade Hub

> **Aktualny stan 2026-10-28 (zastępuje historyczne GO/statusy poniżej):** main0f77574d z #1156 zsynchronizowany lokalnie, bez przywrócenia AdSense. T012 owner PASS/COMMITTED; T010 G1/G2 PASS120/120/BIO absent, lokalny cleanup przygotowany; T001 i końcowy T010/T033 OPEN. Katalog16 i dotychczasowe avatary WWW/APK/WS owner PASS. Nowy bounded guest-retention runtime i kandydat legal2026-10-28-a2 wymagają przyszłego exact-SHA Stage odbioru. Terms nadal OFF; nowe dokumenty tylko szkice z placeholderem. Brak push/deploy/SQL/nowych receipts lub faz B/C/D.
>
> [Jeden kompletny diff, wyniki i następne GO](g-legal-a-consolidated.md), [cztery teksty/decyzje](legal-drafts/README.md), [LIA](g-legal-a-lia.md). Żadnego checklist OPEN nie oznaczać jako PASS samym CI.


**Data**: 2026-10-26  
**Status**: v3.3 — skonsolidowana lokalna faza A — architektura i16 grafik zaakceptowane; lokalny kod A do review, bez aktywacji
**Baseline odczytu kodu**: main `a63e44b0d9a1d3625956ed98b75c1242989efdd3`  
**Issues**: #1114, #1140, #1138; częściowo nieaktualne discovery #1116.

## Cel i zakres

Wspólny WWW i APK: automatyczna tożsamość Arcade, katalog16 pixel-art avatarów, prosty Terms onboarding, report/block/admin, warunkowy import Google photo i tygodniowy digest. Zachować istniejące sześć `avatar_variant` oraz ich przypisania. Brak BIO, ręcznej nazwy/handle i uploadu własnych plików.

Nowa decyzja zastępuje poprzedni plan ochrony historycznych URL i rozbudowanego backfillu. Stary link do zmienionego handle może przestać działać. Jednorazowe uporządkowanie profili nie zmienia UUID, CH, XP, wariantów ani danych gry. Nie powstaje system śledzenia zmian handle lub drugi system profili.

Obecne GO obejmuje końcowe korekty tych trzech dokumentów i przygotowanie16 projektów do wizualnej akceptacji. Bez kodu, podłączania produkcyjnej grafiki, migracji, konfiguracji, zmian issue, PR, Stage/Production i publikacji. Pozostała implementacja wymaga osobnego GO.

## Fazy i niezależny odbiór

| Faza | Dostarczany zakres | Zależność | Warunek odbioru |
|---|---|---|---|
| A | Katalog16, wybór, automatyczne profile, jeden Terms krok, jednorazowe uporządkowanie | Akceptacja planu, grafik i prawna ocena A | Samodzielnie działa na WWW/APK; bez schemy/importera/digestu C/D i bez udawanej gotowości B |
| B | Report/block dla account/guest/visitor, admin i obsługa operatora | A | Działające zgłoszenia i moderacja, bez wpływu na poker/finanse |
| C | Dobrowolne publiczne Google photo przez istniejący Sharp/Storage | A + gotowe B + osobna zgoda prawna i techniczna C | Bezpieczny import/fallback/withdrawal; nie wymaga D |
| D | Cotygodniowy digest i ograniczone pilne e-mail alerty | B; może powstać niezależnie od C | Tylko nowe lub nierozpatrzone sprawy, bez maili o samym blokowaniu |

Każda faza ma własny Stage odbiór i osobne Production GO. Odbiór A nie oznacza pełnego UGC/Google Play PASS ani zgody na publikację aplikacji. Całość wymaga A–D, lecz brak C/D nie blokuje wdrożenia A. Audio #1146 i pełny redesign M1 są osobnymi zadaniami.

## User Scenarios & Testing

### US1 — katalog i trwały wybór (A, P1)

1. Właściciel zatwierdza jeden podgląd wszystkich16 projektów przed wdrożeniem grafik. Sześć kluczy: `comet-blue`, `falcon-orange`, `fox-blue`, `nova-purple`, `orbit-green`, `panda-pink` pozostaje bez zmian; dodać10.
2. Nowe konto otrzymuje trwały wariant przez istniejące provisioning. Nie losować podczas renderu/logowania, nie tworzyć Storage obiektu dla katalogu.
3. Wybór grafiki działa spójnie w headerze, Account, publicznym profilu, leaderboard i przy stole; retry/równoczesne żądania nie nadpisują nowszej decyzji.
4. Katalog jest lokalnie w APK i Offline, z bezpiecznym fallbackiem. Nie synchronizuje lokalnej sesji/PC ani Google photo z Offline. Boty i guest zachowują swoje mechanizmy.

**Odbiór**: spójność sześciu istniejących i dziesięciu nowych wariantów, idempotencja/revision, krótki podgląd WWW/APK, lokalne zasoby bez sieci. Bez powtórki zaakceptowanej kampanii Offline.

### US2 — jeden świadomy Terms krok (A, P1)

1. Proponowany uproszczony UX: po pierwszym uwierzytelnieniu email/Google albo przy następnym wejściu istniejącej sesji pokazać aktualny Terms, dostęp do Privacy i wyraźny przycisk „Akceptuję regulamin”. Jeden krok, bez obowiązkowego checkboxa obok tego samego przycisku. Email signup ma linki do dokumentów i zapowiada ten krok; po email confirmation także na innym urządzeniu serwer określa, czy akceptacja jest jeszcze potrzebna.
2. Serwer zapisuje właściciela, wersję, własny czas i requestId. Aktualny receipt oznacza brak powtórnego monitu przy reload/reconnect/relogin. Nie dopisywać zgód za istniejących użytkowników. Przy nowej wymaganej wersji krok powtarza się raz.
3. Potwierdzenie Terms jest obowiązkowym krokiem przed **nowym korzystaniem z konta**, nie tylko przed UGC, z zastrzeżeniem legal gate. Nowe wejście do usług konta/nowy start gry wymaga serwerowego current receipt; UI, stary APK i bezpośrednie API nie mogą tego obchodzić. Kontrolować rzeczywiste granice rozpoczęcia użycia (w tym pozyskanie nowego miejsca przez JOIN, jeśli nie ma innej skutecznej serwerowej granicy) oraz publikację UGC. Nie sprawdzać Terms przy każdym zakładzie/rozdaniu/rebuy/settlement ani bez potrzeby przy mint tokenu. Resume/reconnect istniejącej gry nie jest nowym JOIN/buy-in.
4. Uwierzytelnienie/OAuth może się zakończyć przed akceptacją, ale nie odblokowuje nowego użycia konta. Trwająca gra, reconnect/Resume, Leave/cashout, dokumenty, logout, deletion/status, support, report/block, privacy opt-out i wycofanie zdjęcia pozostają dostępne. Existing session przy kolejnym nowym wejściu do usług konta przechodzi jeden krok Terms; current receipt eliminuje ponowny monit. Nie zasłaniać timera ani przerywać istniejącej sesji stołu, nie wymuszać fold/Leave/sit-out i nie ingerować w rollover. Dalsza publikacja UGC czeka na receipt.
5. Guest/anonymous mają Terms/Privacy bez loginu i bez Google consent. Przed publikacją reakcji uznanej za UGC guest potwierdza aktualne Terms w tym samym prostym wzorcu, z serwerowo weryfikowanym guest subject. Oglądanie/report/local block nie wymaga tego potwierdzenia ani konta.
6. Offline odczytuje dokumenty z pakietu i działa bez konta. Brak sieci nie tworzy server receipt ani ukrytej przyszłej zgody. Pending oznacza brak prawa do nowego korzystania z konta/publikacji, z opisanym wyjątkiem kontynuacji istniejącej gry i safety; nie blokuje lokalnego Offline.

**Odbiór**: email/Google/existing active session/direct API/guest, jedna akceptacja per version, server timestamp/idempotency, brak obejścia UGC i brak ingerencji w gry. LEGAL musi zatwierdzić, że moment i zakres potwierdzenia wystarczają dla wybranych usług/rynków. Jeśli wymagane jest wcześniejsze zawarcie umowy, STOP i review minimalnej korekty; nie przywracać automatycznie poprzedniego globalnego WS gate.

### US3 — proste uporządkowanie profili (A, P1)

1. Minimalna inwentaryzacja: liczby profili z własnym handle/nazwą/zdjęciem/BIO, istniejących wariantów, ograniczeń i obiektów Storage; bez publicznego zrzutu danych osobowych i bez tworzenia systemu checkpointów.
2. Jeden zatwierdzony przebieg normalizuje publiczną tożsamość przez istniejący generator, wycofuje własne zdjęcia i usuwa BIO. Zachować potwierdzone automatyczne handle; dla własnych/niepewnych nadać automatyczne. Nie odtwarzać proweniencji nazw po samym ich wyglądzie; niepewna display name dostaje wygenerowany odpowiednik.
3. UUID, CH, XP, zapisany wariant, status konta, leaderboard privacy i wszystkie dane gry pozostają bez zmian. Nie usuwać profilu w celu ponownego signup/provisioning. Konta w deletion pozostawić istniejącemu V2, bez odtworzenia.
4. Nie utrzymywać historycznych URL do zmienionego handle. Nieistniejący stary handle pokazuje normalny not-found; nie ma gwarancji zachowania dawnych linków. Retencja dawnych nazw/BIO nie jest potrzebna do nawigacji.
5. Wycofane zdjęcia usuwa istniejący śledzony cleanup, po ustalonej retencji i kontroli manifestów. Brak historycznego archiwum treści. Jednorazowość i wynik rozlicza istniejąca historia migracji/operacji, nie nowy backfill framework. Przy awarii STOP, a nie ręczny reset kont.

**Odbiór**: before/after counts i fundamentalny fixture wykazują wyłącznie zatwierdzone zmiany profilu; stare URL mogą nie działać, brak finansowych/game writes. Stage przed Production, osobne GO na porządkowanie i usuwanie Storage.

### US4 — report/block/admin (B, P1)

1. Account ma trwały prywatny block i autoryzowany report. Visitor publicznego profilu i guest przy stole mogą zgłosić bez zakładania konta oraz lokalnie block/unblock, z jawnym zakresem tej sesji/urządzenia. Brak fikcyjnej synchronizacji anonimowych list między Browser i WebView.
2. Identyfikację celu rozwiązuje serwer; report retry ma ten sam receipt. Limity i ochrona IDOR/spam nie opierają się na samej deklaracji client userId. Sama liczba zgłoszeń nie tworzy sankcji.
3. Block neutralizuje publiczne treści i reakcje/historię/efekty społeczne. Stack, bety, miejsca, timery, liczba graczy i wynik pozostają widoczne i niezmienione. Nie blokować kolejnego właściciela miejsca po seat reuse.
4. Jeden panel Reports w istniejącym adminie: otwarte sprawy, decyzja resolved/dismissed, powód i ślad operatora. Działanie moderatora ma oczekiwaną rewizję treści; nie usuwa nowego avatara, jeśli zgłoszony został zmieniony/usunięty. Wtedy oznacza odrębne `contentState=changed/unavailable`; nie pobiera starego zdjęcia ponownie i nie archiwizuje domyślnie obrazów.
5. Obsadzona moderacja, bezpieczny kontakt/odwołanie, retencja i Account Deletion dla nowych danych są warunkiem B PASS, nie przyszłym skutkiem digestu.

**Odbiór**: account/guest/visitor proof, idempotency/rate limit/admin auth, lokalne filtrowanie bez zmiany autorytatywnej gry, stale content CAS. Zgodność Play dla tych powierzchni do oceny; sam formularz nie jest certyfikacją.

### US5 — Google photo (C, P1)

1. Po legal gate i gotowym B opcja „Użyj zdjęcia Google jako publicznego avatara” jest oddzielna, dobrowolna i domyślnie niezaznaczona. Decyzja/wersja/czas są niezależne od Terms. Brak zgody/zdjęcia/proof lub błąd importu daje katalog i nie blokuje OAuth/konta/gry.
2. Po zgodzie import odbywa się automatycznie z potwierdzonej powiązanej tożsamości, nie klientowskiego dowolnego URL. Istniejące Sharp/Storage, bez hotlinku, z ograniczeniem rozmiaru/wymiarów/czasu i śledzeniem lifecycle.
3. Wybór katalogu lub odmowa/cofnięcie zatrzymują automatyczny import; relogin i nowe Terms nie resetują decyzji. Użytkownik może później jawnie wybrać „Użyj zdjęcia Google”, udzielić nowej odrębnej zgody i rozpocząć nową operację z aktualnym provider proof. To świadomy wybór, nie auto-restore. Osobna blokada moderatora ma pierwszeństwo: użytkownik ani nowa zgoda jej nie wyłączają. Zdjęcie po zdjęciu blokady nie wraca samo. Cleanup legacy nie odbiera prawa do późniejszego jawnego wyboru. Google name/email nie są publicznym gaming name.
4. Import vs selection/withdrawal/moderation/deletion ma revision guard i śledzony cleanup przegranego wyniku. Nie tworzyć nowego silnika zadań ani magazynu provider tokenów.

**Odbiór**: wybór katalogu→nowy jawny Google wybór, withdrawal→reconsent, legacy→jawny wybór, brak auto-restore na loginie, moderator-block denial, osobna zgoda, verified provider/sub, SSRF/size guards, retry/race i istniejące deletion manifesty. Google nie jest moderatorem zdjęć. G-import wymaga A+B i C legal/security/Stage dowodów, nigdy D.

### US6 — tygodniowy digest (D, P1)

Mail tylko gdy są nowe od ostatniego potwierdzonego raportu lub otwarte sprawy. Brak maili o block/unblock. Liczby i admin link, bez zdjęć/danych wrażliwych. Pilne alerty ograniczone i deduplikowane. Niepewny wynik wysyłki wymaga reconcile zamiast ślepego retry. Provider/odbiorca wymagają osobnego GO; Auth SMTP nie jest domniemanym transportem.

**Odbiór**: fake sender, empty/new/unresolved/retry unknown/urgent limits. D zależy od B, nie od C. Bez D operator nadal monitoruje kolejkę i pilne przypadki; brak D blokuje odbiór całej funkcji, ale nie faz A–C.

## Functional Requirements

- **FR-001**: Katalog dokładnie16, stare6 stabilne, owner art approval przed implementacją grafik; proponowane 256×256 WebP ≤25 KiB/szt./≤400 KiB całość, do zatwierdzenia na art gate.
- **FR-002**: Istniejący provisioning i allowlista; nowe warianty przypisywane dopiero gdy aktywne readers/WS je rozpoznają. Brak per-user Storage dla katalogu.
- **FR-003**: Wspólny renderer i lokalne pakowanie16; Offline bez Auth/WS/API i synchronizacji PC, bez zmiany zapisów/zasad.
- **FR-004**: Brak manual name/handle/BIO/upload także w write API; prosty jednorazowy cleanup, bez resetu konta, gry, CH/XP lub sześciu wariantów.
- **FR-005**: Jeden świadomy Terms krok per required version, serwerowy receipt przed nowym korzystaniem z konta oraz publikacją UGC; bez obowiązkowego checkboxa i globalnego gate każdej operacji WS. Legal gate dla uproszczenia.
- **FR-006**: Oddzielna opt-in photo decyzja, domyślnie brak zgody; withdrawal/suppression nie narusza Terms/Auth. Brak publikacji Google photo przed B/C gates.
- **FR-007**: Bezpieczny nieblokujący import przez istniejący pipeline, bez hotlinków i niezweryfikowanego metadata URL; revision/lifecycle oraz trwałe zatrzymanie auto-importu, które nowy jawny wybór może zastąpić, lecz nie omija osobnej blokady moderatora.
- **FR-008**: Report/block account/guest/visitor, idempotency/rate limits i prywatność; block nie zmienia autorytatywnego pokera.
- **FR-009**: Istniejący admin z prostą decyzją/audit, stale-avatar CAS i minimalizacją dowodów, bez finansowych sankcji i default archiwum obrazów.
- **FR-010**: Digest nowe OR otwarte, zero maili o samym block, ograniczone urgent alerts, bez sensitive data; niezależny od importu.
- **FR-011**: Privacy/Terms/UGC i Play aktualizowane per faza; nowe records mają retencję i istniejący V2 purge/Auth-last. Nie obiecywać cofnięcia kopii zdjęcia z cudzego cache.
- **FR-012**: A samodzielna, B po A, C po A+B, D po B; osobne Stage/WS Preview/Production i brak deploy/merge z tego planowania.

## Key Entities i uproszczenia

Istniejący `user_profiles` i `avatar_variant/avatar_key`, jedna revision i flaga zatrzymania auto-importu, Terms receipt; w B reports/blocks/actions i osobna serwerowa blokada zdjęcia moderatora; w C niezależna photo decision i istniejący manifest Storage; w D delivery receipt. Bez dodatkowej maszyny siedmiu stanów importu, historii zmienianych handle lub schedulera ogólnych zadań. Proponowane pola/interfejsy opisane w plan.md nie są obecnym kodem.

## Success Criteria

- **SC-001**: Właściciel zatwierdził16 projektów; sześć kluczy/przypisań i stan gry zachowane; katalog lokalny w APK.
- **SC-002**: Bez current Terms nie można rozpocząć nowego korzystania z konta ani publikacji UGC; receipt jednokrotny per version, tylko niezbędne granice WS, bez przerywania istniejącej gry i bez kontroli każdego zakładu/rozdania/rebuy/settlement.
- **SC-003**: Jednorazowe uporządkowanie zmienia tylko określone profile/Storage, nie UUID/CH/XP/gry; stary zmieniony URL może zwrócić not-found.
- **SC-004**: Report/block/moderation skuteczne w trzech kontekstach; zero nieuprawnionych sankcji/revision overwrite i wpływu na grę.
- **SC-005**: Google failure nie blokuje Auth, login nie resetuje odmowy, jawna nowa zgoda pozwala wrócić do Google photo bez obejścia moderatora, żaden publiczny hotlink/name/email nie wycieka; D nie jest prerequisite C.
- **SC-006**: Graf faz/zadań bez cykli i wstecznych zależności A→B/C/D; każda faza ma własny dowód i GO, a Console pozostaje UNKNOWN do weryfikacji.

## Decyzje i bramki właściciela

Zatwierdzić uproszczony Terms wzorzec z LEGAL (moment zawarcia umowy/UGC), grafikę16, krótki plan jednorazowego cleanup i retencję zdjęć, operatora B oraz photo disclosure C i transport D. Zgoda na plan nie jest zgodą na migrację lub Stage. Brak nowych providerów, IAP, audio, World Tour/Seasons/Sit & Go i nowych funkcji gameplay. Nie zmieniać już zaakceptowanego Offline.

## Aktualizacja operacyjna — 2026-10-27

Owner zaakceptował fizycznie zapis avatara i Account/Online/Single Player/Offline oraz UX galerii. Aktualny stan zastępuje historyczny lokalny zakres opisany wyżej: schema119/119, Preview1155, WS ea178bb3 i zaakceptowany APK e370e461 wdrożone; Terms i katalog nadal OFF. Wyłącznie read-only przygotowanie katalogu16 i inventory T012: [stage-catalog-preflight.md](stage-catalog-preflight.md). Aktywacja/normalizacja/cleanup/contract i Production wymagają odrębnego GO.

## T012 selective normalization review — 2026-10-27

Owner physical PASS for catalog16 and save/render across Account/Online/Single Player/Offline. Catalog is ON on Stage; Terms remains OFF. Normalization is prepared only: affect dirty rows, preserve historical handle_customized_at, increment revision/set suppression only for withdrawal of a non-NULL photo key. Stage dry-run2 affected/49 unchanged, no operation executed. Exact criteria, tests, breaking impacts and separate GO: [t012-normalization-review.md](t012-normalization-review.md).

## T012 Stage executed — 2026-10-27

COMMITTED at2026-10-27T16:27:07.558528Z, independent verification PASS:2 changed/49 untouched, all51 variants/UUID/privacy/history markers retained, one avatar revision increment only. TermsOFF/catalogON and migration119/119 unchanged; Auth/financial/Poker/Storage/tracker writes0 except approved profile/policy updates. No contract/drop/purge/Production/WS/APK/Ready/merge. Exact fingerprints and remaining A gates: [t012-normalization-review.md](t012-normalization-review.md). This supersedes earlier preparation-only status.

## T010 scope clarification for owner review — 2026-10-27

Read-only/source audit complete; no contract executed. Minimal proposal is BIO-only drop after compatible readers and a post-contract fundamental fixture, retaining the historical customization marker and deletion/capability records. This is a recommendation for a separate GO, not an approved SQL change. T012 owner independently confirmed PASS; T010 final acceptance and legal/Terms gates remain OPEN. [Contract review and gates](t010-contract-reference-review.md).

## G1 BIO-only preparation — 2026-10-27

Owner GO authorizes SQL/test/docs preparation only. New forward-only version20261027173627 and sealed Production-equivalent are prepared;119 historical files unchanged. Mandatory intended future Stage effect is BIO-only DDL after separate G2; no current automatic Stage Apply is authorized. Keep Draft so apply-stage stays SKIPPED; explicit SQL identity/confirmation/preconditions also fail closed. Existing avatar pipeline/helpers, JS/CSS/i18n, APK and WS unchanged by owner decision. Isolated PostgreSQL contract and existing38 tests PASS; live Stage remains119/BIO-present, TermsOFF/catalogON. [Exact hashes, fixtures and G2 gate](t010-contract-reference-review.md).

## G2 Stage BIO-only contract executed — 2026-10-27

COMMITTED version20261027173627 and exact SHA6d98db78… atomically; independent120/120 source/history/hash verification PASS. BIO absent, historical marker and all51 retained profiles unchanged; current WWW/API/Account GET smoke PASS. TermsOFF/catalogON, V2/V3/Storage untouched. Production-equivalent not executed. This supersedes historical119/BIO-present preparation status. Full fingerprints, timestamp, HTTP IDs and remaining independent legal/Terms/final-A gates: [t010-contract-reference-review.md](t010-contract-reference-review.md). No further mutation authorized.

### G-LEGAL-A scope clarification (2026-10-27, not legal approval)

Current signup may provision public gaming identity before a Terms receipt; private guest bot-game creation is distinct from account authoritative new JOIN and has no current Terms gate. Contract timing/scope and permitted pre-acceptance activity require explicit OWNER/LEGAL approval or a separately authorized targeted fix. See [PL/EN proposals](g-legal-a-pl-en-proposals.md). Do not claim universal pre-acceptance blocking, Play compliance or updated APK content. Version a1/accepted package unchanged; new guarded activation remains intentionally fail-closed pending approved legal/version/reader pins and unexecuted isolated regression.


**G-LEGAL-A owner facts / hobby update:** Arcade is a free noncommercial personal hobby project; KCSWH is a project name, not a legal entity; unrelated suspended JDG must not be attributed. Updated conditional UŚUDE scope, independent GDPR/Play review and minimal bilingual proposals/owner decision table: [g-legal-a-hobby-proposal.md](g-legal-a-hobby-proposal.md). Legal identity/contact, lawful pre-Terms provisioning/publication, retention and final content/version remain OPEN. No legal HTML/version/SQL/test/runtime/APK/environment change; validated guarded SQL351de467… and local PostgreSQL PASS preserved.


**G-LEGAL-A final owner-identity draft preparation:** owner approves KCSWH brand plus natural-person real name/contact only in legal documents, never game UI/JDG/home by default. Four complete PL/EN drafts and four remaining decisions are in [legal-drafts/README.md](legal-drafts/README.md). Name placeholder and unverified provider/retention fields are explicit publication STOP. Guest purge plan reuses bounded SQL and existing WS maintenance, not implemented. WWW Ads loader discrepancy noted without assuming actual revenue. Active documents/version/SQL/test/runtime/APK unchanged; no activation or new phase. LEGAL/T033 remain OPEN.


**OWNER decision 2026-10-28:** zachować domyślnie publiczny profil (gaming name/handle, katalog, XP/poziom), istniejący ranking opt-out. Bez nowego opt-in/przełącznika. Google photo poza A/odrębna zgoda. Produkt zatwierdzony, LEGAL nadal OPEN: art.25(2), przedrejestracyjna informacja/interwencja i małoletni ocenione oddzielnie od widoczności przy stole w [LIA](g-legal-a-lia.md). Propozycja wyłącznie minimalnego copy istniejącego signup, bez implementacji. Pozostałe przygotowane prace/testy A bez zmian.


**OWNER signup disclosure GO, lokalnie wykonane:** account.html + js/i18n.js + js/account-page.js; dokładny zatwierdzony tekst przy signup i przed Google, językowe Terms/Privacy, bez nowego ekranu/przełącznika lub zmiany OAuth.51/51 istniejących fundamentalnych auth/Account/mobile PASS, syntax/CSP PASS. WWW i przyszły APK współdzielą Account; obecnego APK nie przebudowano. Produkt zatwierdzony, T001/LEGAL i końcowy T010/T033 nadal OPEN. Szczegóły w g-legal-a-consolidated.md.


**arcade-legal-docs finalization:** skill z załącznika w .agents/skills/arcade-legal-docs wraz z references; cztery kompletne teksty a2 z Krzysztof Cal, bez placeholderów/komentarzy technicznych. Kryteria retencji i źródła Netlify/Supabase/Upstash oraz warunkowe UŚUDE/nowelizacja06.11.2026 opisane w [raporcie finalizacji](g-legal-a-finalization.md). T001/T033/końcowy T010 nadal OPEN dla treści, ryzyka publiczności i nieograniczonej retencji. Brak push/publikacji/TermsON/SQL/APK.


**Final OWNER review correction:** cztery teksty a2 po pełnej redakcji PL/EN; KCSWH=marka, Hub/Poker=usługi, Krzysztof Cal. Disclosure obejmuje niezalogowanych. Guest cleanup opisany jako obecny opportunistic + przygotowany niewdrożony niezależny WS. Manifest odświeżony. T001/T033/final T010 OPEN: prawne ryzyko publiczności oraz konkretna procedura żądań wobec historycznych danych bez TTL nie są zastąpione ogólną deklaracją. Brak mutacji/publikacji.


### OWNER review — minimalna obsługa praw, 2026-10-28
Privacy PL/EN opisują wyłącznie obecne oportunistyczne czyszczenie guest receipts; usunięto wzmiankę o niewdrożonym cyklu WS. Terms bez zmian. [Minimalna procedura i propozycja indywidualnego ukrycia profilu](g-legal-a-rights-minimal-procedure.md): TECH OPEN (brak indywidualnej blokady WWW, ograniczenia częściowej minimalizacji historii), LEGAL OPEN (art.25(2)/małoletni oraz konkretne uzasadnienie retencji). Default public ON zachowany; bez implementacji, mutacji i publikacji. T001/T033/finalny odbiór OPEN.


### Indywidualna blokada profilu — lokalna implementacja 2026-10-28
Zobacz [raport i bramki](g-legal-a-public-profile-block.md). Nowa migracja default false, operator-only flag, publiczne readery HTTP/rankingu/WS i cache fail-closed; testy lokalne PASS, pełny kontrakt schematu/hosted CI/rollout OPEN. Bez push i mutacji Stage. Terms i Privacy bez zmian. Retencja selektywna oraz LEGAL/finalny odbiór nadal OPEN. Nowa migracja może uruchomić DB Stage Apply: wymagany świadomie zatwierdzony schema-first rollout, nie przypadkowy push.
