# G-LEGAL-A — LIA po decyzji OWNER: profil publiczny domyślnie

2026-10-28. **Decyzja produktowa zatwierdzona; LEGAL OPEN.** Odrzucono domyślne ukrywanie/opt-in. Nie implementować nowego przełącznika ani warunku publikacji bez osobnego GO. Marka KCSWH, automatyczna gamingowa nazwa/handle, katalogowy avatar, XP i poziom pozostają publiczne; ranking ma istniejący opt-out. Email, prawdziwe nazwisko i credentials nie są publiczne. Google photo wymaga osobnej świadomej zgody poza fazą A. To ocena warunkowa, nie opinia prawna zatwierdzająca model.

## Cel i dwie różne powierzchnie

| Powierzchnia | Cel / konieczność | Równowaga i wniosek |
|---|---|---|
| Tożsamość przy stole | Rozpoznawanie uczestników żądanej gry; pseudonim/avatar są proporcjonalne do tego celu. Rozważyć art.6(1)(b) tylko w niezbędnym zakresie, bezpieczeństwo osobno f. | Wejście do wspólnego stołu daje kontekst i działanie użytkownika. Dostęp uczestników jest bardziej ograniczony niż publiczny WWW; dotyczy to faktycznej widowni, nie samej nazwy „stół”. Jeśli snapshot jest dostępny anonimowo poza stołem, wymaga osobnej oceny. Nie wynika stąd konieczność pokazywania wszystkim XP/poziomu. |
| Publiczny profil WWW i ranking | Społeczna tożsamość i porównanie osiągnięć są rzeczywistym interesem; f wymaga wykazania konieczności i przewagi nad prawami osoby. | Signup może utworzyć profil przed Terms; dowolny odwiedzający może poznać pseudonim/avatar/XP/poziom. To szerszy cel i grono niż gra. Nie wolno przenieść uzasadnienia stołu automatycznie na WWW. Ranking opt-out nie ukrywa profilu. Obecnego modelu nie oznaczamy jako LIA PASS. |

Minimalizacja jest istotna: brak BIO, własnego zdjęcia, emaila, nazwiska, UUID i danych logowania; katalogowe pseudonimy nie są jednak automatycznie anonimowe. Publiczne XP/poziom i stały handle umożliwiają rozpoznawanie aktywności. Brak własnego AdSense zmniejsza jeden rodzaj ryzyka, nie stanowi podstawy publikacji.

## Art.25(2), interwencja i przejrzystość

RODO wymaga ograniczenia domyślnej dostępności i ochrony przed udostępnieniem nieokreślonemu gronu bez interwencji osoby. To obowiązek niezależny od wyboru art.6(1)(f). [RODO, art.25(2)](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32016R0679); [ostateczne EDPB4/2019 v2, pkt55–57](https://www.edpb.europa.eu/sites/default/files/files/file1/edpb_guidelines_201904_dataprotection_by_design_and_by_default_v2.0_en.pdf) wymagają możliwości interwencji przed publikacją. Sam wybór właściciela, pseudonim lub informacja pokazana dopiero w późniejszym Terms nie usuwają tego problemu.

**Konkretny brak:** nie wykazano obecnie, że przed operacją tworzącą publiczny profil użytkownik otrzymuje wyraźną informację o tej publikacji i świadomie wykonuje działanie odnoszące się do konta z publicznym profilem. Ogólny przycisk signup/Google i późniejszy receipt nie dowodzą takiej interwencji. Nie stwierdzamy kategorycznie, że każdy publiczny domyślnie profil jest zakazany; ocena zależy od rzeczywistej usługi, działania osoby i zabezpieczeń, a nie od deklaracji Terms.

**OWNER GO — lokalnie zaimplementowane zabezpieczenie:** zatwierdzony komunikat PL/EN przy istniejącym `signupForm`, przed submit, oraz przed `googleSignInButton`, z językowymi linkami Terms/Privacy. Przycisk Google nadal „Kontynuuj z Google / Continue with Google”, ponieważ obsługuje logowanie i potencjalną rejestrację. Wycofano wcześniejszą propozycję zmiany nazwy akcji signup jako wymaganie; nie dodano checkboxa, modalnego potwierdzenia, opt-in ani przełącznika. Informacja pojawia się przed pierwszym redirect, nie dopiero po callback lub email confirmation. Nie jest zbiorczą zgodą RODO/Google photo i nie zmienia daty ani mechanizmu utworzenia profilu.

PL: „Tworząc konto, otrzymasz publiczny profil gracza z automatyczną nazwą i avatarem. Inni gracze mogą zobaczyć Twój profil, poziom i osiągnięcia. Twój e-mail i dane logowania pozostają prywatne.”

EN: “Creating an account gives you a public player profile with an automatically generated name and avatar. Other players can view your profile, level and achievements. Your email and sign-in credentials remain private.”

Kopia jest zgodna z decyzją OWNER; określenie „inni gracze” nie ustanawia technicznej blokady dostępu osób niezalogowanych. Ocena prawna musi nadal uwzględniać faktyczną publiczną widownię, dzieci i prawo sprzeciwu. Istniejące profile nie otrzymują retroaktywnej zgody przez dodanie komunikatu.

Sama zmiana tekstu nie gwarantuje spełnienia art.25(2), konieczności f lub obsługi sprzeciwu. OWNER/LEGAL musi ocenić, czy tak opisana i faktycznie wykonana rejestracja jest wystarczającą interwencją dla konkretnego celu. Nie zmienia to wstecz okoliczności utworzenia istniejących kont. Kontakt contact@kcswh.pl musi umożliwiać rzeczywistą obsługę sprzeciwu z art.21; ranking opt-out lub nakaz usunięcia całego konta nie zastępują automatycznie oceny takiego sprzeciwu. Nie obiecujemy niewdrożonego samoobsługowego ukrycia profilu.

## Osoby niepełnoletnie

Nie wykazano ograniczenia wieku ani jego egzekwowania. Nie dopisujemy fikcyjnego18+, weryfikacji rodzica lub zgody przez login. Małoletni mogą nie rozumieć trwałości pseudonimu, porównań XP, kopiowania lub zewnętrznego indeksowania. Krótki komunikat powinien być zrozumiały także dla nich. Art.8 dotyczy określonych usług opartych na zgodzie; wybór f nie usuwa szczególnej ochrony dzieci. Zbadanie oczekiwań i wpływu na dzieci nadal jest częścią bilansu, nie zadaniem moderacji B. [EDPB1/2024, wersja konsultacyjna, pkt93–96](https://www.edpb.europa.eu/system/files/2024-10/edpb_guidelines_202401_legitimateinterest_en.pdf).

## Wynik / granica

**Produkt: decyzja zamknięta — zachować publiczny model. LEGAL: OPEN** dla szerokiej publikacji WWW, interwencji przed signup i ochrony dzieci. Jawna informacja przed istniejącymi akcjami to wdrożone lokalnie minimalne zabezpieczenie bez zmiany domyślności, ale nie certyfikat zgodności. Jeśli po tej ocenie brak uzasadnienia pozostanie, obowiązkowe Terms nie naprawi publikacji; zgłosić konkretny nierozwiązany problem przed aktywacją, bez samowolnej implementacji opt-in. Pozostałe prace A oraz wcześniejsze testy retencji/SQL zachowują ważność. Zmiana tylko istniejących HTML/JS i testu auth; bez nowych flags/wersji, push, aktywacji lub mutacji środowisk.


## Finalizacja arcade-legal-docs — 2026-10-28

Tożsamość administratora zatwierdzona: Krzysztof Cal. Cztery teksty a2 kompletne użytkowo; oddzielny rejestr ryzyk i źródeł w g-legal-a-finalization.md. Korzyści ograniczonej katalogowej tożsamości i notice przed signup uwzględniono, ale globalna publiczność przed Terms nie jest przez to LIA PASS. Ostateczne EDPB4/2019 art.25(2) pozostaje właściwą podstawą oceny; konsultacyjny1/2024 jest pomocniczy. OWNER zachowuje model ON i nie zgadza się na opt-in; nie wprowadzono zmiany produktu. Najmniejsze dodatkowe zabezpieczenie do decyzji: doprecyzowanie już istniejącej informacji o niezalogowanych odbiorcach oraz realna obsługa sprzeciwu przez kontakt, bez nowego przełącznika/age gate. Nie jest to gwarancja usunięcia ryzyka art.25(2), szczególnie wobec dzieci. Brak prawnika nie jest technicznym blockerem, a decyzja właściciela nie zastępuje wymagań prawa.


**REVIEW disclosure:** account.html/js/i18n.js mówią teraz wyraźnie „Każdy, również osoba niezalogowana…” / „Anyone, including people who are not signed in…”. Zastępuje to poprzednią lokalną kopię „inni gracze”; nie zmienia audience ani defaultu. Prawna ocena art.25(2)/dzieci pozostaje OPEN.


### OWNER review — minimalna obsługa praw, 2026-10-28
Privacy PL/EN opisują wyłącznie obecne oportunistyczne czyszczenie guest receipts; usunięto wzmiankę o niewdrożonym cyklu WS. Terms bez zmian. [Minimalna procedura i propozycja indywidualnego ukrycia profilu](g-legal-a-rights-minimal-procedure.md): TECH OPEN (brak indywidualnej blokady WWW, ograniczenia częściowej minimalizacji historii), LEGAL OPEN (art.25(2)/małoletni oraz konkretne uzasadnienie retencji). Default public ON zachowany; bez implementacji, mutacji i publikacji. T001/T033/finalny odbiór OPEN.
