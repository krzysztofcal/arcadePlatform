# Google Play Store Listing Package — Arcade Poker

**Dokumentacja pakietu publikacyjnego dla Google Play Store**  
**Powiązane zgłoszenie:** [#1140](https://github.com/krzysztofcal/arcadePlatform/issues/1140) / P05  
**Nadrzędna roadmapa strategiczna:** [#1138](https://github.com/krzysztofcal/arcadePlatform/issues/1138) (Milestone M1)  
**Status prac:** Status roboczy (Working Draft) — wersja zaktualizowana po review  

---

## 📁 Zawartość pakietu (Package Directory Structure)

```
docs/play-store-listing/
├── README.md                                # Niniejszy przegląd pakietu i otwartych zadań
├── policy-compliance-verification.md         # Raport zgodności z wymogami Google Play (Social Casino, deletion, limits, CI)
├── store-listing-pl.md                      # Tytuł, krótki i pełny opis w języku polskim (dokładna liczba znaków)
├── store-listing-en.md                      # Title, short and full description in English (exact character count)
└── assets/
    ├── feature-graphic-proposal-1.png       # 1024×500 px (Sapphire VIP Velvet) — 24-bit Truecolor RGB (Color Type 2)
    ├── feature-graphic-proposal-2.png       # 1024×500 px (Emerald Palace) — uproszczony, 24-bit Truecolor RGB (Color Type 2)
    └── feature-graphic-comparison.md        # Opis koncepcji graficznych, nagłówków PNG i wprowadzonych uproszczeń
```

---

## 🔄 Podsumowanie poprawek po review

1. **Rzeczywisty format 24-bit RGB PNG:**  
   Oba pliki graficzne (`feature-graphic-proposal-1.png` i `proposal-2.png`) zostały przekonwertowane z formatu 8-bit indexed na prawdziwy **24-bit Truecolor RGB PNG** (`bitDepth: 8`, `colorType: 2`, 3 kanały, brak kanału alfa i brak palety PLTE).
2. **Właściwy adres produkcyjny usuwania konta:**  
   Zastąpiono niezweryfikowany adres roboczy właściwym punktem końcowym w środowisku produkcyjnym: **`https://play.kcswh.pl/account.html`**. Wskazano, że adres ten jest przeznaczony do podania w konsoli Google Play, ale nie deklaruje się jego wcześniejszej rejestracji bez faktycznego przeprowadzenia wdrożenia konta deweloperskiego.
3. **Korekta opisu funkcji gry (Brak błędnych obietnic):**  
   - Wskazano, że tryb Single Player zachowuje timer rundy (brak nielimitowanego czasu).
   - Usunięto wzmianki o historii rozdań (funkcja #1115 nie jest częścią wydania v1, zaplanowana na M2).
   - Usunięto nieprawdziwe twierdzenia o botach offline – boty są hostowane na serwerze i wymagają połączenia z Internetem.
   - Doprecyzowano zasady odbioru Welcome Bonusu (jednorazowy bonus w lobby dla zarejestrowanych graczy).
4. **Status roboczy:**  
   Zmieniono status audytu na roboczy (Draft), wskazując, że deklaracja IARC, formalny audyt prawny, Google Play Data Safety oraz retencja danych podlegają ostatecznemu audytowi przed publikacją.
5. **Uproszczenie Propozycji 2 (Emerald Palace):**  
   Pozostawiono wyłącznie duży, kontrastowy napis `ARCADE POKER`, dwa asy (Pocket Aces: A♠ A♥) oraz oficjalne żetony. Usunięto drobne slogany i plakietki, zwiększając czytelność na ekranach telefonów.
6. **Zadania otwarte zależne od builda #1139:**  
   Zdefiniowano zależność od stabilnego builda Capacitor Android z zadania #1139 dla screenshotów rzeczywistej aplikacji, ikony sklepu (512 × 512 px) oraz materiałów recenzenckich.
7. **Weryfikacja liczby znaków i układu kart:**  
   - Zweryfikowano programowo dokładną długość znaków w metadanych PL i EN (wszystkie mieszczą się w limitach Google Play).
   - Skorygowano opis kart w Propozycji 1 z "Royal Flush" na "Ace-King suited (A♠ K♠)".
8. **Analiza środowiska CI i Netlify Deploy Preview:**  
   Udokumentowano, że niepowodzenie podglądu Netlify dla witryny `playkcswh` wynika z braku konfiguracji zmiennych środowiskowych migracji Redis V3 (`XP_REDIS_VERSION=3`) w automatycznym hooku podglądu gałęzi (błąd `xp_redis_build_context_required` w `scripts/generate-build-info.js`), a nie ze zmian w kodzie (który w tym PR nie był modyfikowany).

---

## ⏳ Zadania otwarte przed publikacją w Google Play Console

- [ ] Zatwierdzenie estetyczne uproszczonej Propozycji 2 baneru promocyjnego (Feature Graphic).
- [ ] Wykonanie autentycznych screenshotów z działającego builda Android (#1139) na fizycznym telefonie.
- [ ] Przygotowanie ikony Google Play (512 × 512 px, 32-bit PNG z przezroczystością).
- [ ] Formalne wypełnienie kwestionariusza IARC (kategoria Simulated Gambling, 18+).
- [ ] Zgłoszenie adresu usuwania konta `https://play.kcswh.pl/account.html` w konsoli Google Play.
- [ ] Wypełnienie deklaracji Data Safety i przygotowanie konta testowego dla recenzentów Google.
