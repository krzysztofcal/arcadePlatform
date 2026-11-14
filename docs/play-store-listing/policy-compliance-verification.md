# Google Play Store Listing — Policy & Requirements Working Audit

**Reference Issue:** [#1140](https://github.com/krzysztofcal/arcadePlatform/issues/1140) / P05  
**Strategic Roadmap:** [#1138](https://github.com/krzysztofcal/arcadePlatform/issues/1138) (Milestone M1)  
**Verification Date:** 2026-10-23 · **Refreshed:** 2026-11-14 (audit of 2026-11-11)  
**Status:** **Status roboczy — wersja do weryfikacji właściciela (Draft / Pending Owner & Legal Audit)**  
*(Uwaga: Oficjalna klasyfikacja IARC, decyzje o wieku i terytoriach, ocena prawna PL/UE, formularz Google Play Data Safety, prawdziwe screenshoty, ikona sklepu, konto dla recenzentów i publikacja pozostają otwartymi bramkami. Nic w tym dokumencie nie oznacza ich zaliczenia).*

---

## 1. Google Play Store Metadata & Asset Requirements

### 1.1. Feature Graphic (Baner z grafiką promującą)
| Attribute | Google Play Specification | Arcade Poker Implementation | Audit Status |
| :--- | :--- | :--- | :--- |
| **Dimensions** | Exactly **1024 × 500 px** (horizontal aspect ratio 2.048:1) | 1024 × 500 px (exact pixels) | PASS |
| **Format** | **JPEG** or **24-bit PNG** | 24-bit PNG (`image/png`, RGB 8-bit per channel, Color Type 2) | PASS (Zweryfikowano nagłówek IHDR) |
| **Alpha / Transparency** | **Strictly prohibited** (must be 100% opaque) | Opaque solid canvas, no alpha channel (`channels: 3`, no PLTE) | PASS (Brak kanału alfa) |
| **Maximum File Size** | 15 MB | Proposal 1: ~270 KB, Proposal 2: ~617 KB | PASS |
| **Safe Zone / Composition** | Google guidance (not a numeric hard limit): keep the focal point and branding centered, away from edges that may be cut off, and leave the center clear for a possible video play button | Centered focal artwork and simplified typography; Emerald Palace accepted by the OWNER | Owner-accepted (guidance, no numeric threshold) |
| **Prohibited Marketing Copy** | No ranking claims (e.g. *“#1”*, *“Best”*), no pricing/discount claims (*“Free”*, *“Sale”*), no calls to action (*“Download now”*, *“Play free”*) | Only original game branding ("ARCADE POKER") and card/chip visual assets; zero prohibited marketing slogans | PASS |

---

### 1.2. Store Listing Text Limits
| Field | Limit | Arcade Poker (PL) | Arcade Poker (EN) | Status |
| :--- | :--- | :--- | :--- | :--- |
| **App Title** | Max **30 characters** | `Arcade Poker: Texas Hold'em` (**27 zn.**) | `Arcade Poker: Texas Hold'em` (**27 chars**) | PASS |
| **Short Description** | Max **80 characters** | `Poker Texas Hold'em online i offline. Graj z ludźmi i botami o wirtualne żetony.` (**80 zn.**) | `Texas Hold'em poker online and offline. Play people or bots for virtual chips.` (**78 chars**) | PASS |
| **Full Description** | Max **4,000 characters** | **3707 zn.** (ze spacjami) | **3612 chars** (with spaces) | PASS |
| **Metadata Restrictions** | No emojis in Title or Short Description; no repetitive keyword stuffing; no misleading claims | Clean text without unicode emojis in Title/Short Description; factual feature description | PASS |

---

## 2. Google Play Simulated Gambling & Social Casino Policy

Google Play strictly regulates applications featuring poker, casino games, and simulated gambling under its **Simulated Gambling / Social Casino** guidelines ([Policy Reference: Google Play Gambling & Real-Money Games](https://support.google.com/googleplay/android-developer/answer/9877032)).

### 2.1. Key Invariants & Reality Checks
1. **Brak wartości materialnej (No Real-World Monetary Value):**
   - Arcade Poker operates exclusively with virtual currencies: **CH (Arcade Chips)** online and separate local **Offline Chips** in Poker Offline.
   - Neither CH nor Offline Chips **can** be redeemed, exchanged, transferred, or cashed out for real fiat currency, cryptocurrencies, physical goods, gift cards, or any prizes of real-world value.
   - There are no sweepstakes mechanics or secondary cash-out loops.
2. **Obowiązkowe klauzule prawne w opisie:**
   - Both Polish and English descriptions feature a bold, prominent simulated gambling disclaimer.
   - Text explicitly notes:
     - The game is intended for an adult audience (18+).
     - The game does not offer real-money gambling or an opportunity to win real money or real prizes.
     - Practice or success at social poker does not imply future success at real-money gambling.
3. **Prawdziwy stan funkcji (Brak błędnych obietnic):**
   - **Single Player:** Zachowuje aktywny timer rundy (nie oferuje nielimitowanego czasu namysłu). Zapewnia natychmiastową grę bez oczekiwania na innych graczy.
   - **Boty online (Single Player):** działają na serwerze czasu rzeczywistego (WebSocket) i wymagają połączenia sieciowego.
   - **Poker Offline (#1145/#1147):** boty działają na urządzeniu bez Internetu; osobne Offline Chips zapisane lokalnie, bez synchronizacji z kontem, CH i XP, bez logowania.
   - **Hand History:** Nie jest obietnicą v1 (zadanie #1115 zaplanowane na M2, brak historii rozdań w obecnym buildzie).
   - **Welcome Bonus:** Jednorazowy bonus wirtualnych CH przyznawany zarejestrowanym graczom do odbioru bezpośrednio w lobby gry.
4. **Klasyfikacja wiekowa IARC (OTWARTE):**
   - Kwestionariusz IARC (z symulowanym hazardem) nie został wypełniony; oficjalny wynik jest nieznany. „18+” w opisie to deklarowana grupa docelowa, a nie zweryfikowana klasyfikacja.

---

## 3. Account Deletion and User Data Transparency

According to Google Play's User Data & Account Deletion Policy ([Reference: Understanding Google Play Account Deletion](https://support.google.com/googleplay/android-developer/answer/10144311) & [answer/13327111](https://support.google.com/googleplay/android-developer/answer/13327111)):

1. **In-App Deletion Pathway:**
   - Implemented in [#1117](https://github.com/krzysztofcal/arcadePlatform/issues/1117), reachable from Account ([#1135](https://github.com/krzysztofcal/arcadePlatform/issues/1135)).
   - The user requests deletion; the process removes the profile and sign-in identity after safely finishing game participation and handling the virtual balance. It is not an unconditional deletion of all data.
2. **External web deletion path:**
   - **`https://play.kcswh.pl/account.html#account-deletion`** — checked 2026-11-14: the page responds and its `account-deletion` section explains deletion in a browser (sign in → Delete account), works after uninstalling the app and gives a contact address.
   - *Status:* to be entered in Google Play Console; **not registered yet**.
3. **Retention disclosure:**
   - Privacy Policy 2026-11-12-a3 (active on WWW) describes the 12-month settled-history cap and the exceptions kept longer: settlement history of a deleted account as a financial record without the profile, the deleted account's identifier, records needed to finish an ongoing game, and backups until rotation.
4. **Data Safety Form (OPEN):**
   - Must match Privacy a3, including deletion/retention and Poker Offline data kept only on the device. Not prepared or submitted.

---

## 4. Zadania otwarte zależne od stabilnego builda #1139

Zgodnie z zasadami projektu, repozytorium **nie może zawierać syntetycznych ani fikcyjnych screenshotów**. Następujące elementy sklepu Google Play stanowią otwarte zadania zależne od dostarczenia stabilnego builda Androida z zadania [#1139](https://github.com/krzysztofcal/arcadePlatform/issues/1139):

1. **Zrzuty ekranu prawdziwej aplikacji (Screenshots):**
   - Wykonanie 4–8 autentycznych screenshotów z działającego builda Android na fizycznym urządzeniu (lub przez zweryfikowany BrowserStack).
   - Wymagania techniczne platformy Google Play: format JPEG lub 24-bit PNG bez kanału alfa, min. 320 px, max. 3840 px, proporcje boków od 1:2 do 2:1 (typowo 16:9 lub 9:16).
   - Wewnętrzny cel jakościowy dla Arcade Poker: min. 1080 px krótszy bok (np. 1080 × 1920 / 1080 × 2400 FHD) — uwaga: 1080 px to zalecany cel jakościowy (quality target) dla zachowania ostrości detali stołu, a **nie** bezwzględny wymóg techniczny Google Play.
2. **Ikona aplikacji w Google Play (App Icon):**
   - Dokładny wymiar: **512 × 512 px**, 32-bit PNG z kanałem alfa, max 1024 KB.
   - Do wygenerowania po ostatecznym zatwierdzeniu stylistyki marki Arcade Poker.
3. **Materiały i instrukcje dla testerów / Google Review:**
   - Przygotowanie dedykowanego konta testowego (login/hasło) dla zespołu recenzenckiego Google Play oraz instrukcji dostępu do stołów pokerowych.

---

## 5. CI i Netlify Deploy Preview

Analiza nieudanego Deploy Preview z 2026-10-23 była historyczna i została usunięta jako nieaktualna. Aktualny wynik checków i Deploy Preview jest widoczny w PR #1142. Zmiany dotyczą wyłącznie dokumentacji w `docs/play-store-listing/`; pliki PNG nie są zmieniane.
