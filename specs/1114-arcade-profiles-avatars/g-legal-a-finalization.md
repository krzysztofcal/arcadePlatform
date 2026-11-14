# G-LEGAL-A — finalizacja według arcade-legal-docs, 2026-10-28

## Wynik

**EDITORIAL READY / OWNER REVIEW READY; LEGAL DESIGN RISK i ograniczona FACTUAL OPEN.** Cztery kompletne teksty a2 w legal-drafts mają wyłącznie treść dla użytkowników, bez placeholderów/TODO/komentarzy technicznych. Administrator zawsze **Krzysztof Cal**, także w polskich zdaniach (bez odmiany). Nie publikowano HTML ani nowej wersji; a1, backend policy i APK pozostają bez zmian. Skill z załącznika dodany dokładnie do `.agents/skills/arcade-legal-docs/` wraz z3 references. Nie wymagamy prawnika, planu Pro ani kontaktu z dostawcami. Produkt: hobby, default public ON, katalog16, rank opt-out, bez własnego AdSense/JDG, Google photo poza A — bez zmian.

## Macierz dowodów (odczyt 2026-10-28)

| Typ | Ścieżka/źródło | Co dowodzi / czego nie dowodzi |
|---|---|---|
| OWNER | Ostatnia decyzja i istniejący diff #1155 | Krzysztof Cal/contact, hobby bez JDG, jawny default-public, brak kontaktu z dostawcami; nie jest orzeczeniem zgodności |
| Kod | shared/profile-terms.mjs; migration20261026120000 | Account FK/Auth cascade, brak TTL account, guest ważność1h, obecny opportunistic cleanup; nowy maintenance helper w diffie nie jest wdrożony |
| Kod | ws-server/server.mjs; account-deletion.mjs; account-deletion-storage.mjs | Planowany bounded cleanup25s/100, niezależny od flags; deletion/Auth-last/safety, trwałe manifesty/capabilities, brak podstaw do obietnicy natychmiastowego purge |
| Kod | store-upstash.mjs::atomicRateLimitIncr; poker retention modules | Limit ma domyślny TTL60s; inne dane mają inne TTL lub brak. Cutoffy gry zależą od flag; closed-table cleanup wymaga rozliczenia i braków zależności. Nie utożsamiać tego z retencją ledger/backupów lub gwarantowanym7dni |
| Konfiguracja lokalna read-only | journald.conf | Brak jawnego MaxRetentionSec; retencja pojemnościowa nie jest stałym limitem dni. Nie zmieniano journald/logów |
| Kod | js/klaro-config.js; consent-services.js; Account/auth; mobile/package-web.mjs | Cookie wyboru zgód180dni, GA opt-in, shared Account, wydany APK bez nowego copy/a2, bez Ads/Analytics w pakiecie |
| Konfiguracja read-only | Netlify API playkcswh | functions_region us-east-1, published6ae19488f50eb5ff7e60f7e6; to region wykonania Functions, NIE region wszystkich CDN/logów/kopii |
| Poprzedni odczyt metadata tego samego dnia | Supabase get_project Stage i Production | eu-west-3/Paris; bez SQL/profili. Nie dowodzi EOG-only |
| Oficjalna polityka | https://www.netlify.com/gdpr-ccpa/ i https://www.netlify.com/pdf/netlify-dpa.pdf (DPA20260609, §§12/14) | DPA incorporated; warunkowy DPF/SCC, zakończenie usługi i deletion wg polityk, bez wymyślonego terminu |
| Oficjalna dokumentacja | https://docs.netlify.com/build/functions/logs/ (aktualizacja10.09.2026) | Minimum24h i zależne od planu okno niektórych logów; nie dowodzi planu/całkowitego hard-delete24h konkretnego konta |
| Oficjalna dokumentacja | https://supabase.com/legal/privacy-resources/data-residency-and-transfers-faq (v1,06.10.2026); https://supabase.com/legal/customer-resources/data-processing-addendum | Wybrany region bazy i wyjątki, SCC dla Singapore/USA; nie wszystkie operacje w wybranym regionie |
| Oficjalna dokumentacja | https://supabase.com/docs/guides/platform/backups | Zależność od planu; nie utożsamiać metadata DB z fizycznymi Storage objects |
| Oficjalne warunki | https://upstash.com/static/trust/dpa.pdf (§§3/11); https://upstash.com/docs/common/help/compliance | Transfery i zasady zakończenia/backupów; nie dowodzi regionu ani konkretnego TTL tej bazy. Privacy własnego konta Upstash nie jest retencją gracza Arcade |

## UŚUDE — konkretna kwalifikacja, bez automatycznego żądania adresu

Art.2 pkt6 [tekstu2024/1513](https://eli.gov.pl/api/acts/DU/2024/1513/text.html) wiąże usługodawcę z co najmniej uboczną działalnością zarobkową lub zawodową. OWNER potwierdził brak obu w Arcade; na tych faktach nie ma podstaw automatycznie przypisać temu hobby obowiązków identyfikacyjnych usługodawcy z art.5. Samo posiadanie niezwiązanej zawieszonej JDG nie zmienia tych faktów. Nie żądamy adresu domu/NIP/REGON i nie wpisujemy ich. Darmowość sama w sobie nie wyklucza zawodowości — przy zmianie sposobu prowadzenia projektu trzeba ponownie ocenić zakres. Gdy art.5 miałby zastosowanie, nazwisko+email nie zastępują automatycznie wymaganych danych adresowych osoby fizycznej; nie ukrywamy warunku, lecz nie stwierdzamy go obecnie na zapas.

Regulamin dobrowolnie zawiera praktyczny zakres art.8: dostępne usługi, wymagania techniczne, tworzenie konta i późniejszą akceptację, rezygnację oraz zgłoszenia/reklamacje. To nie deklaracja pełnego wyłączenia wszelkich innych regulacji.

[Nowelizacja2026/1296](https://api.sejm.gov.pl/eli/acts/DU/2026/1296/text.pdf): ogłoszona06.10.2026, art.8 wejście po30dniach =06.11.2026. Metadata ELI także wskazują06.11; ogólna etykieta „obowiązujący” nie zastępuje tej daty. Na28.10 nie stosować jej jako już działającej. Sprawdzony art.1 dodaje DSA definicje/procedury; nie zmienia art.2 pkt6/5/8 będących podstawą powyższej kwalifikacji. Nie otwieramy w tej pracy faz B/C/D ani deklaracji Google Play compliance.

## LIA i retencja — niezamknięte istotne kwestie

LIA w g-legal-a-lia.md pozostaje aktualna: wąska tożsamość przy stole i publiczny WWW mają odrębny cel/krąg. Informacja przed rejestracją jest środkiem przejrzystości, nie dowodem art.25(2). Nazwa katalogowa nie oznacza anonimowości. Brak nowego opt-in/age gate lub domyślnego ukrywania. Kryteria ochrony dzieci i faktyczna możliwość sprzeciwu nie znikają przez wybór f. Ocena ryzyka nie ma być przedstawiona użytkownikowi jako wewnętrzny TODO.

Privacy opisuje istniejące sprawdzalne kryteria: konto do usunięcia, account receipts z Auth, ważność guest1h/opportunistic usuwanie partiami, expiry wpisów Redis, rotacja/capacity/plan logów i backupów, korespondencja związana ze sprawą. Nie obiecuje regularnego WS cleanup, dopóki kod nie jest wdrożony. Jawnie mówi też, że część historycznych zapisów nie ma automatycznego wygaśnięcia. To uczciwa informacja, ale **brak automatycznego TTL nie stanowi sam w sobie odpowiedniego kryterium niezbędności z art.5/13**. Nie dopisano nieistniejącej rutyny okresowych przeglądów, kasowania ledger lub reaplikacji deletion po restore. Nieznany region Upstash ani dokładna retencja usług nie są zastąpione fikcyjnym EOG/30dni.

## Maksymalnie trzy decyzje przed publikacją

1. **Treść:** zatwierdzić cztery pełne teksty a2/ich manifest; tożsamość już rozstrzygnięta, nie pytać o nią ponownie. Aktywne HTML/wersja/APK dopiero w osobnym GO wdrożenia.
2. **Ryzyko publiczności:** świadomie zdecydować o publikacji przy opisanym ryzyku art.25(2)/dzieci; najmniejsze dodatkowe zabezpieczenie bez zmiany defaultu to doprecyzowanie istniejącego komunikatu do „także osoby niezalogowane” i realna obsługa sprzeciwu istniejącym kontaktem. Nie wdrażamy teraz copy ani nowego przełącznika. Akceptacja ryzyka przez OWNER nie oznacza prawnej legalizacji lub LEGAL PASS.
3. **Retencja bez TTL:** przyjąć minimalną praktykę wyznaczania końca niezbędności dla korespondencji/zamkniętych incydentów i ograniczonych zapisów powiązanych z kontem; wykorzystać istniejącą obsługę deletion, bez masowego kasowania ledger/Storage. Jeżeli wymaga kodu/ustawień, osobne wąskie GO. Kryteria capacity/plan są faktem dla logów/backups, ale nie uzasadniają samodzielnie bezterminowego przetrzymywania wszystkich danych. Nie wymagać maili do dostawców lub prawnika.

## Release gates i odbiór

Cztery pliki Markdown są propozycjami w formie użytkowej, nie opublikowaną wersją. W README pozostają statusy/ryzyka; kandydat a2 nie nadpisuje zaakceptowanego a1. Po decyzjach: zatwierdzone versioned HTML/aliasy, zgodne WWW/API/policy/receipts, nowa lista legalPages i hosted APK; ten przebieg nie wykonuje tych działań. Nie wypychać internal decision logów jako treści prawnej. Stage acceptance i protected exact-SHA WS dla wcześniejszego zmienionego runtime nadal konieczne; Production/merge niezależnie. T001/T033 i końcowy odbiór A OPEN.

Dokumentacyjna walidacja: exact skill ZIP bytes/references,4teksty PL/EN, dokładne nazwisko, brak placeholderów/wewnętrznych markerów, zgodność wersji i kryteriów retencji, manifestSHA oraz diff-check. Bez nowych testów UI/runtime lub powtarzania zakończonych audytów. Istniejące wyniki lokalnego kodu zachowane, włącznie z wcześniejszym nierozstrzygniętym startup timeout WS — nie ukrywać go jako PASS.


## Końcowa korekta po REVIEW OWNER — 2026-10-28

Pełna redakcja czterech PL/EN, bez anglicyzmu „gamingowa nazwa”, nienaturalnego „wejście kontem” i niepotrzebnych skrótów. KCSWH wyłącznie marka projektu; Arcade Hub/Poker jego usługi; Krzysztof Cal bez odmiany. Komunikat w account.html/js/i18n.js obejmuje wszystkich, w tym niezalogowanych, w obu istniejących miejscach signup/Google. Bez zmiany domyślności, nowych kontrolek, OAuth lub provisioning.

Privacy rozróżnia aktualne opportunistic guest cleanup i lokalnie przygotowany niezależny WS maintenance, który nie jest wdrożony. Ważność1h nie oznacza physical hard-delete1h. PL/EN mają te same informacje i wyjątki.

**Konkretna luka przed publikacją:** kryteria potrzeby danych w nowych tekstach (konkretny spór/incydent/zakwestionowane rozliczenie/obowiązek) są proponowaną zasadą, a nie dowodem wdrożonego procesu. Aktualny Account Deletion usuwa profil/Auth i zachowuje część rekordów z old_user_id/capabilities oraz historię integralności; brak udokumentowanej procedury kwalifikowania tych pozostałości do usunięcia/ograniczenia oraz bezpiecznej realizacji częściowego żądania. Sam email kontaktowy/rozpatrzenie wniosku nie dowodzi, że można wykonać pełny zakres żądania. Nie skasowano ledger/Storage i nie obiecano automatycznej rutyny. Właściciel musi zapewnić wykonawczą procedurę obsługi tych żądań przed publikacją takiej deklaracji; sama akceptacja zdania nie wystarczy. Bez nowego frameworka, arbitralnego terminu lub masowego purge.

Drugi pozostający istotny problem: domyślny publiczny WWW przed Terms, art.25(2)/małoletni; doprecyzowany komunikat wspiera przejrzystość, lecz nie jest LEGAL PASS. Nie ponawiano audytów dostawców; ich zaakceptowane oficjalne dokumenty pozostają źródłem. Skill/diff/manifest zaktualizowane lokalnie, a1/activeHTML/SQL/APK bez zmian.


### OWNER review — minimalna obsługa praw, 2026-10-28
Privacy PL/EN opisują wyłącznie obecne oportunistyczne czyszczenie guest receipts; usunięto wzmiankę o niewdrożonym cyklu WS. Terms bez zmian. [Minimalna procedura i propozycja indywidualnego ukrycia profilu](g-legal-a-rights-minimal-procedure.md): TECH OPEN (brak indywidualnej blokady WWW, ograniczenia częściowej minimalizacji historii), LEGAL OPEN (art.25(2)/małoletni oraz konkretne uzasadnienie retencji). Default public ON zachowany; bez implementacji, mutacji i publikacji. T001/T033/finalny odbiór OPEN.
