# G-LEGAL-A — PL/EN proposals and guarded activation preparation

> Historyczny zapis przygotowania. Aktualny stan, SQL i decyzje: [skonsolidowany raport 2026-10-28](g-legal-a-consolidated.md). Nie traktować dawnych flag/hashów/Ads-blocker jako bieżącego wyniku.

**Owner fact update:** current noncommercial hobby proposal and revised UŚUDE/RODO qualification are in [g-legal-a-hobby-proposal.md](g-legal-a-hobby-proposal.md). They supersede the business-provider assumption and company/address templates below; the earlier text is historical review, not approved content. No JDG identity may be used. Guarded SQL/local PostgreSQL evidence below remain unchanged.

2026-10-27. OWNER accepts technical audit only. LEGAL/content approval remains OPEN. PR1155 Draft, published source631867186ff5efed7f62bdb10b5e439fc6842915. Local preparation only; no push, SQL/test execution, receipt, activation, APK or environment change. This supplements g-legal-a-readiness.md and supersedes its blanket description of all new JOIN paths: the guest-only in-memory path is explicitly distinguished below.

## Legal gap review

Reviewed canonical/versioned Terms and Privacy PL/EN, current spec/plan and actual accepted APK e370e461. Existing Terms identify only KCSWH; Privacy says controller KCSWH/contact@kcswh.pl. Targeted repository-wide HTML/Markdown search for operator/controller/address, NIP/KRS/REGON and siedziba did not establish an approved legal identity/address. Names in Git/GitHub, Supabase vendor address and domain ownership are not authorization to publish a person's details. OWNER must supply approved natural-person identity/address or entity name/registered office/address and applicable business identifiers; none are invented here.

[UŚUDE, official ELI consolidated text, art.5 and8](https://eli.gov.pl/api/acts/DU/2024/1513/text.html) requires directly accessible provider details, pre-contract availability including acquiring/reproducing/retaining terms, scope/technical requirements, unlawful-content prohibition, formation/termination and complaint procedure. Existing texts have service scope/prohibited-content clauses and partial account deletion language. They lack full provider identity/address, concrete technical requirements, clear formation/termination rules and complaint handling. Footer/onboarding links and packaged static HTML establish availability, not a legal finding that pre-contract disclosure and retention are sufficient in every signup/OAuth entry point. Article5/8 review is OPEN; no unconditional compliance statement.

The current liability exclusions and Polish-courts clause also require OWNER/LEGAL assessment for consumer protections, applicable mandatory law and user jurisdictions. This review does not approve those clauses or silently rewrite them.

## Exact proposed bilingual insertions (DRAFT, not published)

Bracketed fields are unresolved OWNER/LEGAL input. They must never ship as placeholders. Proposed operational promises (complaint deadlines, scope and contract timing) must be approved and achievable before publication.

### 1. Provider / controller

PL Terms: „Usługodawcą Arcade Hub i aplikacji Arcade Poker jest [ZATWIERDZONA PEŁNA NAZWA LUB IMIĘ I NAZWISKO], [SIEDZIBA/MIEJSCE ZAMIESZKANIA I ADRES], [WŁAŚCIWE DANE REJESTROWE/NIP, JEŻELI DOTYCZĄ]. Kontakt elektroniczny: contact@kcswh.pl.”

EN Terms: “Arcade Hub and the Arcade Poker app are provided by [APPROVED FULL ENTITY NAME OR PERSONAL NAME], [REGISTERED OFFICE/PLACE OF RESIDENCE AND ADDRESS], [APPLICABLE REGISTRATION/TAX DETAILS]. Electronic contact: contact@kcswh.pl.”

PL Privacy: „Administratorem danych jest [TEN SAM ZATWIERDZONY PODMIOT I ADRES]. Pytania dotyczące danych i żądania realizacji praw można przesyłać na contact@kcswh.pl. [DANE IOD WYŁĄCZNIE JEŚLI DOTYCZY].”

EN Privacy: “The data controller is [THE SAME APPROVED IDENTITY AND ADDRESS]. Questions about personal data and requests to exercise your rights may be sent to contact@kcswh.pl. [DPO DETAILS ONLY IF APPLICABLE].”

### 2. Availability and technical requirements

PL: „Regulamin jest dostępny bezpłatnie przed zawarciem umowy pod [STABILNY WERSJONOWANY URL PL/EN] oraz w aplikacji. Jego treść można wyświetlić, pobrać lub zapisać przy użyciu funkcji urządzenia. WWW wymaga aktualnej przeglądarki obsługującej JavaScript i lokalny zapis danych. Logowanie, gra online i zapis profilu wymagają połączenia z Internetem, HTTPS/WSS oraz obsługi sesji Supabase. Weryfikacja e-mail wymaga dostępu do podanej skrzynki; Google jest opcjonalną metodą logowania. Aplikacja wymaga zgodnej wersji Androida wskazanej przy udostępnieniu wydania. Poker Offline po instalacji działa bez Internetu; zapis pozostaje lokalny, a usunięcie danych aplikacji może go utracić.”

EN: “The Terms are available free of charge before the contract is concluded at [STABLE VERSIONED PL/EN URL] and in the app. They can be viewed, downloaded or saved using your device's facilities. The website requires an up-to-date browser supporting JavaScript and local data storage. Sign-in, online play and profile saving require Internet connectivity, HTTPS/WSS and Supabase session support. Email verification requires access to the supplied mailbox; Google is an optional sign-in method. The app requires a compatible Android version specified with the release. Once installed, Poker Offline works without Internet; its save stays on the device and may be lost when app data is removed.”

Do not promise a download/save control proven absent in WebView: approve the requirement and verify an actual retention mechanism before publishing this paragraph. Do not invent an Android minimum; derive it from the approved built manifest when updating the APK. Auth uses SDK local storage, not exclusively browser cookies; correct Privacy's blanket “Supabase authentication cookies” statement accordingly.

### 3. Contract timing / permitted pre-acceptance activity — decision, not resolved fact

Preferred proposal IF LEGAL approves a distinct preparatory authentication stage:

PL: „Utworzenie lub uwierzytelnienie tożsamości przez potwierdzenie e-mail albo Google nie stanowi samo w sobie akceptacji tego regulaminu. Umowa dotycząca [PRECYZYJNIE ZATWIERDZONY ZAKRES USŁUG OBJĘTYCH UMOWĄ] zostaje zawarta po wyświetleniu właściwej wersji i wybraniu »Akceptuję regulamin«. Przed akceptacją można zapoznać się z dokumentami, korzystać z pomocy, wylogować się, złożyć wniosek o usunięcie konta i zmienić ustawienie prywatności rankingu. Wcześniej rozpoczęta gra i jej rozliczenie nie są przerywane. Brak akceptacji uniemożliwia nowe chronione wejście oraz publikowanie nowego avatara, reakcji i prezentów.”

EN: “Creating or authenticating an identity by email confirmation or Google does not by itself accept these Terms. The contract for [PRECISE APPROVED CONTRACTUAL SERVICE SCOPE] is concluded after the applicable version is displayed and you select ‘I accept the Terms’. Before acceptance you can read the documents, contact support, sign out, request account deletion and change leaderboard privacy. Play already started and its settlement are not interrupted. Without acceptance, new protected entry and publication of a new avatar, reactions and gifts are unavailable.”

Important actual behavior: signup creates auth.users and the signup trigger provisions a public gaming profile; profile-me GET may provision missing profiles, Auth UI requests it; leaderboard/public identity can already exist before receipt. Guest private bot-game creation in ws-server/server.mjs guest_join materializes an in-memory table without requireCurrentTerms, unlike account authoritative new JOIN. XP reads/sync and other portal services are not globally gated by Terms. Therefore the proposal CANNOT claim “no services/data processing/publication before acceptance” or universal “all new play blocked”. LEGAL must decide whether these preparatory/public activities and guest play fit the proposed scope. If not, a separately authorized minimal runtime change and tests are needed before ON. No runtime behavior changed here. Guest expiry/receipt is not proof that guest game creation itself is gated.

Alternative if authentication/account provision already concludes the relevant service contract: present required information before signup and Google initiation and obtain legally appropriate assent there; later receipt cannot retroactively establish earlier assent. This requires separately scoped UX/Auth-contract work; do not choose it silently or modify OAuth provider configuration. No claim that one legal model is valid merely because implementation supports it.

### 4. Refusal, termination and complaints

PL: „»Nie teraz« nie zapisuje akceptacji. Możesz przerwać korzystanie i wylogować się w dowolnym momencie; usunięcie konta można zainicjować w Koncie, gdy funkcja jest dostępna, lub przez contact@kcswh.pl. Zakończenie korzystania, wylogowanie i żądanie usunięcia konta są odrębnymi czynnościami; nie anulują już powstałych rozliczeń ani uzasadnionych obowiązków retencji. Reklamację dotyczącą działania usługi można wysłać na contact@kcswh.pl z opisem problemu, datą i informacją pozwalającą odpowiedzieć. Nie przesyłaj hasła, tokenów ani kodów logowania. Odpowiemy [TERMIN ZATWIERDZONY PRZEZ LEGAL/OWNER, Z UWZGLĘDNIENIEM OBOWIĄZUJĄCYCH PRZEPISÓW] na wskazany adres elektroniczny. Skorzystanie z pomocy lub reklamacji nie wymaga akceptacji nowej wersji regulaminu.”

EN: “‘Not now’ records no acceptance. You may stop using the service and sign out at any time; account deletion can be requested in Account when available, or via contact@kcswh.pl. Stopping use, signing out and requesting account deletion are separate actions; they do not cancel settlements already incurred or justified retention obligations. Service complaints can be sent to contact@kcswh.pl with a description, date and reply contact. Do not send passwords, tokens or login codes. We will respond [DEADLINE APPROVED BY LEGAL/OWNER, SUBJECT TO APPLICABLE LAW] to the supplied electronic address. Support and complaints do not require acceptance of a new Terms version.”

This is not a waiver of mandatory consumer rights. OWNER/LEGAL must distinguish closing the account contract from terminating the current session and decide notice/suspension rules. No fictitious response deadline is asserted.

### 5. Receipt retention — replace ambiguous routine-retention promise

PL Privacy: „Dla konta zapisujemy identyfikator konta, wersję regulaminu, czas akceptacji wyznaczony przez serwer i identyfikator żądania. Receipt konta nie ma automatycznego terminu wygaśnięcia i jest usuwany wraz z tożsamością Auth w procedurze usuwania konta. Receipt gościa jest powiązany z tymczasowym identyfikatorem, zachowuje ważność przez godzinę i po wygaśnięciu nie uprawnia do nowych czynności. Wygasłe rekordy są usuwane partiami przy kolejnych akceptacjach; nie gwarantujemy fizycznego usunięcia dokładnie po godzinie. [ZATWIERDZONY OKRES/KRYTERIA RETENCJI KOPII I PODSTAWA PRZETWARZANIA]. Akceptacja regulaminu nie jest zgodą na analitykę ani publikację zdjęcia Google.”

EN Privacy: “For an account we record the account identifier, Terms version, server acceptance timestamp and request identifier. Account receipts have no automatic expiry and are removed with the Auth identity through account deletion. A guest receipt is linked to a temporary identifier, remains valid for one hour and no longer authorizes new actions after expiry. Expired records are deleted in bounded batches during subsequent acceptances; physical deletion exactly one hour later is not guaranteed. [APPROVED BACKUP RETENTION PERIOD/CRITERIA AND PROCESSING BASIS]. Acceptance of the Terms is not consent to analytics or publication of a Google photo.”

Current guest expiry is not a bounded physical-retention guarantee: if acceptance stops, expired rows can remain indefinitely. LEGAL must approve this criterion or request separately scoped retention work; cannot repair that with a false Privacy promise. Account FK deletion removes receipts; do not promise retained legal evidence after deletion unless an actual separately approved mechanism exists. Existing logs30–90days/backups/provider transfer declarations also need verified owner/vendor evidence; this audit does not certify those durations or the Supabase address.

## UGC and account deletion — actual scope

Phase A removes manual handle/name/BIO changes and user image uploads (public endpoints410); catalog16 is fixed local content. Public profiles, player-selected catalog avatars, reactions and targeted gifts remain visible social interactions. Controlled catalog choices reduce arbitrary content, but do not by themselves settle Google Play's UGC classification or harassment obligations. Guest games are private against bots; do not describe them as shared multiplayer. No new free-text chat feature is inferred from generic transport frames.

[Google Play UGC policy](https://support.google.com/googleplay/android-developer/answer/9876937?hl=en) requires acceptance and moderation/report/block safeguards appropriate to the actual UGC experience. Phase B report/block remains unimplemented and separately authorized. Stage Terms activation is a limited technical experiment, not authorization for public release or Play submission; do not declare Play compliance or start B to close this audit.

Account Deletion V2/V3 source: account.html delete control→account-page.js handleDeleteAccount→authenticated account-delete GET/POST; owner/session-bound state, durable-request acknowledgement and local signout. Terms dialog Not now/cancel exposes Account/safety; no Terms gate on deletion endpoint. Same shared Account is packaged in APK and resolves its API through Stage origin. Support mail exists before login. These are source paths, not a destructive end-to-end deletion PASS. [Google Play deletion requirements](https://support.google.com/googleplay/android-developer/answer/13327111?hl=en) additionally require in-app and external request paths and accurate disclosures. Verify actual available service flags, discoverability and external request URL for any future Play submission, without deleting a real account in this task.

## Version, APK and CSP impact

Do not relabel a1/e370e461 as updated. All proposals above remain in this review, not legal/*.html or the accepted APK. Material approved changes should receive a new immutable Terms version (OWNER chooses identifier), matching server policy/version constants, versioned PL/EN pages, canonical links, onboarding and packager list/tests. Keep a1 retrievable; never replace a1 bytes after acceptance. Even if receipt count is still0, this audit does not authorize repurposing published a1. Privacy can have its own updated date/version; retain a mapping of exact accepted Terms/doc hashes.

APK e370e461 currently packages a1. Approved new text requires a newly sourced hosted APK and fresh build receipt/checksum; old APK cannot be called compatible/current just because API still works. No cosmetic/gameplay changes required. The packager embeds local documents and changes branding/link routes: verify both presentations. Run existing syntax/CSP/SRI, legal-content packaging and minimal version/prompt tests; regenerate affected hashes via established pipeline if scripts/styles/HTML change. Text-only edits do not inherently change JS/CSS SRI, but document/content hashes and APK hash necessarily change. No new dependency/framework/OAuth-provider change is implied.

## Guarded SQL preparation / result

operations/enable-terms.sql now pins Stage system7656985631720456337/project, explicit operator confirmation, reviewed120 file/version/hash digest, normalized post-BIO schema, catalogON/TermsOFF, bounded waits and one repeatable-read transaction. Policy row lock then receipt SHARE lock; no profile/lifecycle locks taken in reverse order. Counts/full receipt and profile fingerprints must match read-only preflight. Update exactly one active flag, preserve policy remainder/receipts/profiles, inspect transaction table-DML counters to reject any other write (including triggers). No history insertion or data normalization. External concurrent activity is not “our write”; snapshot consistency plus locks protect this operation, while external reader/deploy confirmation still requires operator evidence.

Intentional unapproved version/API/WS/APK/doc placeholders make it fail closed even with the operator settings. Final legal version and compatible runtime/document tuple must be inserted in a separately reviewed revision; a session claim alone cannot remove the placeholder guard. SQL cannot interrogate Android installations or prove live deployed code, so the external attestation is mandatory and never called autonomous proof.

Prepared tests/chips/profile-terms-activation.test.mjs uses only an explicitly supplied loopback, fresh *_test PostgreSQL17 database; synthetic120 manifest, accounts/receipts and protected financial/Storage sentinel data. Prepared cases: wrong system, absent legal approval/readers, hash mismatch, catalog/normalization mismatch, receipt inventory drift, late error rollback, trigger-write rollback, one successful flag update and replay denial. Test-only substitutions are in-memory and cannot authorize Stage. This is a control-contract fixture, not a repeat of full historical migration integration.

Per instruction SQL and tests are prepared WITHOUT EXECUTION. No PG/Stage SQL, test process, activation or receipt run. Only node --check and git diff --check executed. Therefore transaction tests are NOT TESTED, not PASS; future isolated PostgreSQL17 run is a mandatory technical gate before an execution GO. Earlier12/12 runtime fundamental tests belong to previous audit and do not prove this new SQL.

## Minimal future gates

1. OWNER supplies legal identity/address and decisions above. LEGAL approves exact PL/EN content/formation/pre-acceptance/guest/retention semantics; unresolved incompatibility means STOP, not SQL workaround.
2. Separate code/release GO: implement only approved text/version and any demonstrated contract-boundary fix, package matching APK, publish compatible Stage readers if needed. No automatic funded smoke. Update exact SQL legal/runtime/doc pins and re-review hash; execute prepared isolated control tests under explicit local-test GO.
3. Separate Stage activation GO: read-only identity,120/120 exact hashes, no competing DDL/policy/deploy, approved live readers and APK, flags OFF/catalogON/normalized marker, current receipts/profile baselines. Execute reviewed exact-hash script once with operator settings in one connection and stop-on-error. Before COMMIT any failure→ROLLBACK, no retry. Activation writes no receipts.
4. Independent post-COMMIT flags/history/protected fingerprints. Unexpected result→STOP; no automatic data rollback/deletion/version change. A separate emergency GO may disable active only, retaining genuine receipts; never erase consents as rollback.
5. Explicit limited acceptance GO: dedicated Stage account after displaying exact approved text; one accept and identical replay, one server timestamp/current-version receipt; wrong version denied. Owner checks refusal/safety/mobile return. New-entry/UGC denial and paid reconnect/settlement use existing isolated fixtures, no new live financed JOIN/create/gift. Any additional receipt/guest smoke must be separately included, not inferred.

T010/G1+G2 PASS. LEGAL OPEN. TECH guarded implementation PREPARED / SQL runtime validation OPEN. T033/final phase A OPEN; Production/Ready/merge not authorized.

Prepared SQL SHA-256: `106f0511cc81e7f9f74560487f8e54614d255fbfbab7d05ccac648ea4ba92e48`. Repository migration manifest120 SHA-256 (sorted `version:file:sha256` lines without final LF): `aee0fb222b7040de6b851b258800ecee43aa060db4a6a4a281040777d1f29484`. This SQL hash identifies a deliberately blocked preparation, not an executable legal approval. Any final pin/version change necessarily produces a new SQL hash for review.

## Authorized local PostgreSQL17 execution — 2026-10-27

Owner authorized local validation only, with LEGAL still OPEN. Before execution, original SQL SHA-256 matched `106f0511cc81e7f9f74560487f8e54614d255fbfbab7d05ccac648ea4ba92e48`. Actual server independently identified as PostgreSQL17.11, local loopback127.0.0.1:55465, data directory `/tmp/pr1155-isolated-pg/data`, system identifier `7701225723289707303` (different from Stage7656985631720456337). Used new, empty disposable *_test databases on this existing stopped local cluster; no connection to Stage/Production, no credentials loaded. Existing machine-managed5432 cluster was untouched. Disk before/after5.8GB free, available RAM initially1773MiB, no parallel heavy tests or dependency downloads.

### RED → minimal fix → GREEN

- Original SQL failed actual PL/pgSQL compilation with42601: bare CASE in IF expression caused the parser to treat CASE's THEN as the end of the IF condition. Minimal SQL fix: wrap that CASE expression in parentheses. No legal version/reader/document placeholder changed.
- Next run exposed fixture timestamp restoration via the driver's timestamptz serialization: microseconds were truncated to milliseconds. Fixed only the fixture parameter cast `::text::timestamptz`; retained exact equality assertions.
- Added targeted fundamental assertions in the same test for an incorrect API pin, changed receipt payload (not only count), competing advisory activation and actual policy row-lock timeout. Source substitutions remain in memory only; the committed-intent Stage operation retains deliberately unapproved placeholders.
- Final command: `PROFILE_TERMS_ACTIVATION_TEST_DB_URL=postgres://postgres@127.0.0.1:55465/pr1155_terms_guard_final_test node --test tests/chips/profile-terms-activation.test.mjs`.
- Result: **1 composite fundamental test PASS,0 FAIL,0 skipped**, duration2.98s. Log `/tmp/pr1155-terms-guard-final.log`. Original RED log `/tmp/pr1155-terms-guard-first.log`; fixture RED `/tmp/pr1155-terms-guard-r2.log`. Not a claim of dozens of independent test cases.
- Passed branches: wrong system/operator context; unapproved legal version; unapproved and mismatched reader pins;120 manifest mismatch; receipt count and payload drift; catalogOFF and missing normalization; competing activation; real row-lock wait canceled with55P03 and unchanged state; exception after the DO block rolls back flag; trigger side-effect on protected synthetic CH sentinel detected and rolled back; approved synthetic operation changes exactly one policy update; repeat ON denied. Receipt/profile/full-policy-minus-active and protected sentinels remain exactly equal.
- Independent local post-test read: synthetic active=true/versiona1/catalog=true, original receipt count1, Auth/CH/XP/Poker/Storage sentinel values all unchanged. This is a minimal control fixture, not the complete production Auth/financial schema or a funded smoke. No new receipt was inserted by the activation operation; test setup created only synthetic data.
- `node --check tests/chips/profile-terms-activation.test.mjs` and `git diff --check`: PASS. No runtime/web/legal document or APK source change.

Corrected SQL SHA-256: **`351de4675eb77802a1736c1e217b8a48665dcd3cb76e8921c409de6826948338`**. Original hash above remains historical evidence; future execution GO must use a newly reviewed hash after legal/pin completion, not the old hash.

### Critical self-review / limits

Lock order: migration metadata SHARE→policy FOR UPDATE→receipts SHARE; activation never acquires lifecycle/profile locks after policy. Existing account acceptance uses lifecycle→policy SHARE→receipt write, so activation cannot hold a lifecycle resource required by acceptance; policy contention is bounded and tested. Concurrent DDL or other operators remain an explicit external preflight STOP; this is not a universal lock-order proof for unknown future SQL.

Repeat execution is intentionally rejected, not silently successful: active must befalse, UPDATE rowcount1, then compare exact remainder. Repeatable-read concurrent update can raise40001; no automatic retry. Any lock/statement timeout or SQL exception leaves the transaction uncommittable: operator must ROLLBACK/disconnect on that same connection. A dropped connection before COMMIT rolls back under PostgreSQL semantics; process-kill/network fault injection was not performed. Losing the response around COMMIT is ambiguous: independently read state before any next action, never blindly retry. Transaction_timeout30s may close the connection and must be treated as STOP, not a retry signal.

Reader evidence remains external: before a future activation independently inspect Netlify deployment/function receipt SHA, actual WS release metadata/generated artifact pins and approved APK receipt/document hashes; compare to the exact reviewed tuple and version, then pass the attestation. Do not populate settings based solely on PR HEAD or user-input strings. Today's local task deliberately did not contact either Stage reader or any environment. Placeholder pins and version in the actual file still guarantee fail-closed. LEGAL, final documents/version, compatible release tuple and actual Stage activation remain OPEN.

No push/deployment/Ready/merge. Local test databases/logs retained; no cleanup or data removal authorized. Only the isolated PostgreSQL process started for this test is stopped afterward.
