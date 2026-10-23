# Google Play Store Listing Package — Arcade Poker

**Dokumentacja pakietu publikacyjnego dla Google Play Store**  
**Powiązane zgłoszenie:** [#1140](https://github.com/krzysztofcal/arcadePlatform/issues/1140) / P05  
**Nadrzędna roadmapa strategiczna:** [#1138](https://github.com/krzysztofcal/arcadePlatform/issues/1138) (Milestone M1)  
**Równoległa gałąź:** niezależna od prac nad [#1139](https://github.com/krzysztofcal/arcadePlatform/issues/1139) (Capacitor M0 PoC)  

---

## 📁 Zawartość pakietu (Package Directory Structure)

```
docs/play-store-listing/
├── README.md                                # Niniejszy przegląd pakietu i instrukcja
├── policy-compliance-verification.md         # Weryfikacja wymogów i zasad Google Play (Social Casino, deletion, limits)
├── store-listing-pl.md                      # Tytuł, krótki i pełny opis w języku polskim
├── store-listing-en.md                      # Title, short and full description in English
└── assets/
    ├── feature-graphic-proposal-1.png       # 1024×500 px (Sapphire VIP Velvet) — bez kanału alfa
    ├── feature-graphic-proposal-2.png       # 1024×500 px (Emerald Palace & Canonical Chips) — bez kanału alfa
    └── feature-graphic-comparison.md        # Opis koncepcji graficznych i porównanie estetyczne
```

---

## 🔍 Kluczowe założenia i ograniczenia pakietu

1. **Rzeczywiste, potwierdzone funkcje:**
   - Opisy obejmują wyłącznie funkcje obecne w repozytorium: No-Limit Texas Hold'em, tryb wieloosobowy w czasie rzeczywistym (2–6 graczy, WebSocket), tryb Single Player z botami pokerowymi, poziomy stawek (Tiers), ekonomia wirtualnych żetonów CH, bonus powitalny, daily UTC streak, reakcje przy stole, Gift Shop oraz poradnik układów kart.
   - **Brak obietnic M2/M3:** W materiałach celowo pominięto nieopublikowane tryby (World Tour, Seasons, Sit & Go tournaments) oraz płatny sklep mikropłatności.
2. **Wyraźne zastrzeżenia prawne (Simulated Gambling):**
   - Gra jest całkowicie darmowa i oparta w 100% na wirtualnych żetonach Arcade Chips (CH).
   - Brak możliwości wypłaty gotówki, wymiany żetonów na nagrody rzeczowe ani jakichkolwiek elementów hazardu na prawdziwe pieniądze.
   - Wyraźna klauzula 18+ oraz ostrzeżenie, że sukces w grze społecznościowej nie gwarantuje sukcesu w grach na prawdziwe pieniądze.
3. **Prawo do usunięcia konta (User Data & Deletion):**
   - Zgodnie z wytycznymi Google Play uwzględniono ścieżkę usuwania konta wewnątrz aplikacji (#1117 / #1135) oraz publiczny zewnętrzny adres URL: `https://arcade.kcswh.pl/account.html`.
4. **Brak kolizji technicznych:**
   - Zmiany obejmują wyłącznie pliki dokumentacji i materiałów graficznych w dedykowanym katalogu `docs/play-store-listing/`.
   - Żadne pliki HTML/CSS/JS, konfiguracja Capacitor, aplikacja Android ani backend nie zostały zmodyfikowane.
