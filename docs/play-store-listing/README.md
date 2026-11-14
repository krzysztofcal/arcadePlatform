# Google Play Store Listing Package — Arcade Poker

**Dokumentacja pakietu publikacyjnego dla Google Play Store**  
**Powiązane zgłoszenie:** [#1140](https://github.com/krzysztofcal/arcadePlatform/issues/1140) / P05  
**Nadrzędna roadmapa strategiczna:** [#1138](https://github.com/krzysztofcal/arcadePlatform/issues/1138) (Milestone M1)  
**Status prac:** Status roboczy (Working Draft) — zaktualizowano 2026-11-14 po audycie z 2026-11-11; nic nie zostało opublikowane w Google Play  

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
   Adres produkcyjny: **`https://play.kcswh.pl/account.html#account-deletion`** (sekcja z instrukcją usunięcia konta w przeglądarce, sprawdzona 2026-11-14). Adres jest przeznaczony do podania w Google Play Console; jego rejestracja nie została jeszcze wykonana.
3. **Korekta opisu funkcji gry (Brak błędnych obietnic):**  
   - Wskazano, że tryb Single Player zachowuje timer rundy (brak nielimitowanego czasu).
   - Usunięto wzmianki o historii rozdań (funkcja #1115 nie jest częścią wydania v1, zaplanowana na M2).
   - Opisano trzy tryby: Poker Online i Single Player (boty na serwerze) wymagają Internetu; Poker Offline (#1145/#1147) działa na urządzeniu bez sieci, z osobnymi Offline Chips, które nie synchronizują się z kontem, CH ani XP.
   - Doprecyzowano zasady odbioru Welcome Bonusu (jednorazowy bonus w lobby dla zarejestrowanych graczy).
4. **Status roboczy (Draft) i Data Safety:**  
   Zmieniono status audytu na roboczy (Draft). Deklaracja Google Play Data Safety oraz udostępnianie danych podmiotom trzecim oznaczono jako **Pending Audit** (bez deklarowania braku sharingu przed formalnym audytem prawnym).
5. **Uproszczenie Propozycji 2 (Emerald Palace):**  
   Pozostawiono wyłącznie duży, kontrastowy napis `ARCADE POKER`, dwa asy (Pocket Aces: A♠ A♥) oraz oficjalne żetony. Usunięto drobne slogany i plakietki, zwiększając czytelność na ekranach telefonów. Grafika zaakceptowana przez właściciela; plików PNG nie zmieniano.
6. **Zadania otwarte zależne od builda #1139:**  
   Zdefiniowano zależność od stabilnego builda Capacitor Android z zadania #1139 dla autentycznych screenshotów z fizycznego telefonu (gdzie 1080 px to cel jakościowy, a nie bezwzględny wymóg Google Play), ikony sklepu (512 × 512 px) oraz materiałów recenzenckich.
7. **Weryfikacja liczby znaków i układu kart:**  
   - Zweryfikowano programowo dokładną długość znaków w metadanych PL i EN (wszystkie mieszczą się w limitach Google Play).
   - Skorygowano opis kart w Propozycji 1 z "Royal Flush" na "Ace-King suited (A♠ K♠)".
8. **CI i Netlify Deploy Preview:**  
   Analiza nieudanego Deploy Preview z 2026-10-23 jest historyczna i nieaktualna. Aktualny wynik checków i Deploy Preview jest widoczny bezpośrednio w PR; zmiana dotyczy wyłącznie dokumentacji.
9. **Odświeżenie 2026-11-14 (audyt z 2026-11-11):**  
   Dodano Poker Offline i usunięto twierdzenia, że cała gra wymaga Internetu. Opis usuwania konta odpowiada rzeczywistemu procesowi i wyjątkom retencji z Polityki prywatności 2026-11-12-a3. IARC, Data Safety, ocena prawna i publikacja pozostają otwartymi bramkami. Margines 15% nie jest twardym wymogiem Google.

---

## ⏳ Zadania otwarte przed publikacją w Google Play Console

- [x] Akceptacja grafiki promocyjnej (Feature Graphic): Propozycja 2 „Emerald Palace” zaakceptowana przez właściciela.
- [ ] Autentyczne screenshoty z builda Android na fizycznym telefonie, w tym tryb Poker Offline.
- [ ] Ikona Google Play (512 × 512 px, 32-bit PNG z przezroczystością).
- [ ] Oficjalna klasyfikacja IARC (kwestionariusz z symulowanym hazardem); wynik nieznany, „18+” to tylko deklarowana grupa docelowa.
- [ ] Zgłoszenie adresu `https://play.kcswh.pl/account.html#account-deletion` w Google Play Console.
- [ ] Deklaracja Data Safety zgodna z Polityką prywatności 2026-11-12-a3 (w tym retencja po usunięciu konta i lokalne dane Poker Offline).
- [ ] Decyzje dotyczące wieku, terytoriów i oceny prawnej (PL/UE).
- [ ] Konto testowe i instrukcje dla recenzentów Google.
- [ ] Rejestracja konta wydawcy i publikacja w Google Play (osobne GO właściciela).
