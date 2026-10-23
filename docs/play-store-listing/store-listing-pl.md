# Google Play Store Listing — Polish (pl-PL)

**Pakiet wydawniczy Google Play dla Arcade Poker**  
**Dokumentacja powiązana z:** [#1140](https://github.com/krzysztofcal/arcadePlatform/issues/1140) / P05  
**Nadrzędna roadmapa:** [#1138](https://github.com/krzysztofcal/arcadePlatform/issues/1138) (Milestone M1)  
**Data przygotowania:** 2026-10-23  
**Status dokumentu:** Status roboczy — wersja do weryfikacji właściciela (Draft)  

---

## 1. Metadane podstawowe (Store Metadata)

### Nazwa aplikacji (App Title)
> **Maksymalny limit Google Play:** 30 znaków  
> **Dokładna długość:** **27 znaków**  
> **Status:** ZGODNE (PASS)

```text
Arcade Poker: Texas Hold'em
```

*Alternatywna propozycja (28 znaków):*
```text
Arcade Poker - Texas Hold'em
```

---

### Krótki opis (Short Description)
> **Maksymalny limit Google Play:** 80 znaków  
> **Dokładna długość:** **77 znaków**  
> **Status:** ZGODNE (PASS)

```text
Elegancki poker Texas Hold'em online i z botami. Graj za wirtualne żetony CH.
```

---

### Pełny opis (Full Description)
> **Maksymalny limit Google Play:** 4000 znaków  
> **Dokładna długość tekstu:** **3419 znaków** (ze spacjami)  
> **Status:** ZGODNE (PASS)

```text
Witamy w Arcade Poker – eleganckim wirtualnym pokoju karcianym stworzonym z myślą o pasjonatach klasycznego No-Limit Texas Hold'em. Usiądź przy stole, sprawdź swoje umiejętności taktyczne i ciesz się czystą dynamiką pokera bez ryzyka finansowego!

Arcade Poker to gra społecznościowa (social casino) oparta w 100% na wirtualnych żetonach Arcade Chips (CH). Poczuj atmosferę luksusowego kasyna, blefuj, podbijaj i buduj swój wirtualny bankroll w grze z graczami z całego świata lub trenuj w trybie solo z botami. Gra wymaga aktywnego połączenia z Internetem.

KLUCZOWE CECHY GRY:

• KLASYCZNY NO-LIMIT TEXAS HOLD'EM
Prawdziwe zasady najpopularniejszej odmiany pokera. Pre-flop, flop, turn, river, licytacja bez limitu oraz czytelny interfejs podejmowania decyzji (Fold, Check, Call, Bet, Raise, All-in) z obsługą przydatnego kolejkowania akcji.

• POKER ONLINE W CZASIE RZECZYWISTYM
Zasiądź przy stołach wieloosobowych (od 2 do 6 miejsc). Autorytatywny silnik czasu rzeczywistego (WebSocket) zapewnia natychmiastową synchronizację stanu stołu, płynne rozdania i stabilne wznawianie sesji po chwilowej utracie łączności.

• TRYB SINGLE PLAYER – TRENING Z BOTAMI POKEROWYMI
Chcesz zagrać od razu bez oczekiwania na wolne miejsce przy stole? Wybierz Single Player i zmierz się z autonomicznymi botami pokerowymi na serwerze. Gra zachowuje dynamiczny timer rundy, oferując doskonały trening kalkulacji pozycji i pot odds.

• ZRÓŻNICOWANE POZIOMY STAWEK (TIERS)
Dobierz stół do wielkości swojego wirtualnego bankrolla. Od niskich stawek rekreacyjnych po wysokie progi dla wirtualnych high-rollerów.

• INTERAKCJA PRZY STOLE I GIFT SHOP
Poker to gra relacji! Korzystaj z dymków reakcji i emotikonów przy stole, a także wysyłaj wirtualne upominki i napoje innym graczom za pośrednictwem wbudowanego Gift Shopu.

• WBUDOWANY PRZEWODNIK UKŁADÓW KART
Nie jesteś pewien, czy strit bije kolor? W każdej chwili możesz otworzyć podręczny, czytelny przewodnik starszeństwa układów pokerowych – idealny dla graczy chcących odświeżyć zasady.

• BONUS POWITALNY I CODZIENNE NAGRODY UTC
Zarejestrowani gracze mogą odebrać jednorazowy bonus powitalny wirtualnych żetonów CH bezpośrednio w lobby gry. Loguj się codziennie, aby utrzymywać passę (daily streak) i odbierać odnawialne pakiety żetonów.

• GRAJ JAKO GOŚĆ LUB ZAPISZ POSTĘPY
Możesz rozpocząć grę od razu w trybie gościa z pulą tymczasowych żetonów lub zalogować się kontem Arcade, aby zachować stały stan konta CH i osiągnięcia XP.

• PEŁNA KONTROLA NAD KONTEM I PRYWATNOŚĆ
Szanujemy Twoją prywatność. Masz pełną możliwość trwałego usunięcia swojego konta i danych bezpośrednio w menu profilu aplikacji lub poprzez formularz na stronie WWW.

────────────────────────────────────────
WAŻNA INFORMACJA DLA GRACZY (INFORMACJA PRAWNA):

• Gra Arcade Poker jest przeznaczona wyłącznie dla osób dorosłych (18+) w celach rozrywkowych.
• Gra jest symulatorem pokera społecznościowego (social poker) i NIE oferuje gier hazardowych na prawdziwe pieniądze ani możliwości wygrania prawdziwych pieniędzy, nagród rzeczowych czy ekwiwalentów finansowych.
• Wirtualne żetony (Arcade Chips / CH) są walutą wyłącznie fikcyjną. Nie posiadają wartości materialnej i w żadnym wypadku nie mogą być wymieniane na gotówkę, wypłacane, sprzedawane ani przenoszone poza grę.
• Praktyka lub sukces w społecznościowych grach kasynowych nie oznacza przyszłego sukcesu w grach hazardowych na prawdziwe pieniądze.
```

---

## 2. Kategoryzacja i tagi Google Play

- **Typ aplikacji:** Gra (Game)
- **Kategoria podstawowa:** Gry karciane (Card) / Kasyno społecznościowe (Casino)
- **Tagi:** Poker, Texas Hold'em, Karciane, Gra wieloosobowa, Symulator kasyna, Boty pokerowe
- **Uwaga dotycząca tagów:** Usunięto tagi sugerujące grę offline – boty są hostowane na serwerze i wymagają połączenia sieciowego.
- **Klasyfikacja wiekowa IARC:** Wypełnienie oficjalnego kwestionariusza IARC z zaznaczeniem symulowanego hazardu (Simulated Gambling) – kategoria 18+ (Dorośli) do formalnego zatwierdzenia.

---

## 3. Bezpieczeństwo danych (Google Play Data Safety)

- **Szyfrowanie w transporcie:** Tak (HTTPS / Secure WebSockets TLS).
- **Konto użytkownika:** Opcjonalne (możliwa gra w trybie gościa z tymczasowymi żetonami bez rejestracji).
- **Zewnętrzny adres usuwania konta (Production):** `https://play.kcswh.pl/account.html` (funkcja wdrożona w aplikacji webowej; adres przewidziany do zgłoszenia w konsoli Google Play podczas submission, status zgłoszenia w Play Console: Oczekuje na wdrożenie konta wydawcy).
