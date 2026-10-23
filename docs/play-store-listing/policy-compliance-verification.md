# Google Play Store Listing — Policy & Requirements Working Audit

**Reference Issue:** [#1140](https://github.com/krzysztofcal/arcadePlatform/issues/1140) / P05  
**Strategic Roadmap:** [#1138](https://github.com/krzysztofcal/arcadePlatform/issues/1138) (Milestone M1)  
**Verification Date:** 2026-10-23  
**Status:** **Status roboczy — wersja do weryfikacji właściciela (Draft / Pending Owner & Legal Audit)**  
*(Uwaga: Oficjalna deklaracja IARC, formalny audyt prawny dla jurysdykcji PL/EU, formularz Google Play Data Safety oraz harmonogram retencji danych pozostają otwartymi zadaniami przed publikacją).*

---

## 1. Google Play Store Metadata & Asset Requirements

### 1.1. Feature Graphic (Baner z grafiką promującą)
| Attribute | Google Play Specification | Arcade Poker Implementation | Audit Status |
| :--- | :--- | :--- | :--- |
| **Dimensions** | Exactly **1024 × 500 px** (horizontal aspect ratio 2.048:1) | 1024 × 500 px (exact pixels) | PASS |
| **Format** | **JPEG** or **24-bit PNG** | 24-bit PNG (`image/png`, RGB 8-bit per channel, Color Type 2) | PASS (Zweryfikowano nagłówek IHDR) |
| **Alpha / Transparency** | **Strictly prohibited** (must be 100% opaque) | Opaque solid canvas, no alpha channel (`channels: 3`, no PLTE) | PASS (Brak kanału alfa) |
| **Maximum File Size** | 15 MB | Proposal 1: ~270 KB, Proposal 2: ~617 KB | PASS |
| **Safe Zone / Composition** | Core visual elements & branding centered; margins ≥ 15% from top/bottom/edges; center area unobstructed for potential video play-button overlay | Centered focal artwork, safe margins (>15%) on all sides, simplified typography | PASS |
| **Prohibited Marketing Copy** | No ranking claims (e.g. *“#1”*, *“Best”*), no pricing/discount claims (*“Free”*, *“Sale”*), no calls to action (*“Download now”*, *“Play free”*) | Only original game branding ("ARCADE POKER") and card/chip visual assets; zero prohibited marketing slogans | PASS |

---

### 1.2. Store Listing Text Limits
| Field | Limit | Arcade Poker (PL) | Arcade Poker (EN) | Status |
| :--- | :--- | :--- | :--- | :--- |
| **App Title** | Max **30 characters** | `Arcade Poker: Texas Hold'em` (**27 zn.**) | `Arcade Poker: Texas Hold'em` (**27 chars**) | PASS |
| **Short Description** | Max **80 characters** | `Elegancki poker Texas Hold'em online i z botami. Graj za wirtualne żetony CH.` (**77 zn.**) | `Online & solo Texas Hold'em poker. Pure social play with virtual CH chips.` (**74 chars**) | PASS |
| **Full Description** | Max **4,000 characters** | **3419 zn.** (ze spacjami) | **3277 chars** (with spaces) | PASS |
| **Metadata Restrictions** | No emojis in Title or Short Description; no repetitive keyword stuffing; no misleading claims | Clean text without unicode emojis in Title/Short Description; factual feature description | PASS |

---

## 2. Google Play Simulated Gambling & Social Casino Policy

Google Play strictly regulates applications featuring poker, casino games, and simulated gambling under its **Simulated Gambling / Social Casino** guidelines ([Policy Reference: Google Play Gambling & Real-Money Games](https://support.google.com/googleplay/android-developer/answer/9877032)).

### 2.1. Key Invariants & Reality Checks
1. **Brak wartości materialnej (No Real-World Monetary Value):**
   - Arcade Poker operates exclusively with virtual currency called **CH (Arcade Chips)**.
   - CH chips **cannot** be redeemed, exchanged, transferred, or cashed out for real fiat currency, cryptocurrencies, physical goods, gift cards, or any prizes of real-world value.
   - There are no sweepstakes mechanics or secondary cash-out loops.
2. **Obowiązkowe klauzule prawne w opisie:**
   - Both Polish and English descriptions feature a bold, prominent simulated gambling disclaimer.
   - Text explicitly notes:
     - The game is intended for an adult audience (18+).
     - The game does not offer real-money gambling or an opportunity to win real money or real prizes.
     - Practice or success at social poker does not imply future success at real-money gambling.
3. **Prawdziwy stan funkcji (Brak błędnych obietnic):**
   - **Single Player:** Zachowuje aktywny timer rundy (nie oferuje nielimitowanego czasu namysłu). Zapewnia natychmiastową grę bez oczekiwania na innych graczy.
   - **Boty:** Działają wyłącznie na serwerze czasu rzeczywistego (WebSocket) – wymagają połączenia sieciowego i **nie działają offline**.
   - **Hand History:** Nie jest obietnicą v1 (zadanie #1115 zaplanowane na M2, brak historii rozdań w obecnym buildzie).
   - **Welcome Bonus:** Jednorazowy bonus wirtualnych CH przyznawany zarejestrowanym graczom do odbioru bezpośrednio w lobby gry.
4. **Klasyfikacja wiekowa IARC (Zadanie otwarte):**
   - Formalne wypełnienie kwestionariusza IARC w konsoli Google Play z zaznaczeniem symulowanego hazardu pozostaje zadaniem do wykonania przed publikacją (docelowo rating 18+).

---

## 3. Account Deletion and User Data Transparency

According to Google Play's User Data & Account Deletion Policy ([Reference: Understanding Google Play Account Deletion](https://support.google.com/googleplay/android-developer/answer/10144311) & [answer/13327111](https://support.google.com/googleplay/android-developer/answer/13327111)):

1. **In-App Deletion Pathway:**
   - Completed in [#1117](https://github.com/krzysztofcal/arcadePlatform/issues/1117) and accessible via the user profile modal completed in [#1135](https://github.com/krzysztofcal/arcadePlatform/issues/1135).
   - Allows users to initiate permanent deletion of their account and associated profile data directly from within the app interface.
2. **Verified Production Account Deletion URL:**
   - Właściwy punkt końcowy w środowisku produkcyjnym: **`https://play.kcswh.pl/account.html`**.
   - *Status deklaracji:* Adres został zweryfikowany w architekturze produkcyjnej i jest wyznaczony do wprowadzenia w formularzu Google Play Console podczas procesu publikacji. **Nie deklaruje się wcześniejszej rejestracji w konsoli bez jej faktycznego przeprowadzenia.**
3. **Data Safety Form & Data Retention (Zadanie otwarte):**
   - Przygotowanie ostatecznego formularza Data Safety oraz sformalizowanie harmonogramu retencji danych pozostaje otwartym zadaniem do wykonania przed wysłaniem aplikacji do review w Google Play.

---

## 4. Zadania otwarte zależne od stabilnego builda #1139

Zgodnie z zasadami projektu, repozytorium **nie może zawierać syntetycznych ani fikcyjnych screenshotów**. Następujące elementy sklepu Google Play stanowią otwarte zadania zależne od dostarczenia stabilnego builda Androida z zadania [#1139](https://github.com/krzysztofcal/arcadePlatform/issues/1139):

1. **Zrzuty ekranu prawdziwej aplikacji (Screenshots):**
   - Wykonanie 4–8 autentycznych screenshotów z działającego builda Android na fizycznym urządzeniu (lub przez zweryfikowany BrowserStack).
   - Wymagane formaty: zrzuty ekranu telefonu (portrait oraz landscape, min. 1080 px krótszy bok).
2. **Ikona aplikacji w Google Play (App Icon):**
   - Dokładny wymiar: **512 × 512 px**, 32-bit PNG z kanałem alfa, max 1024 KB.
   - Do wygenerowania po ostatecznym zatwierdzeniu stylistyki marki Arcade Poker.
3. **Materiały i instrukcje dla testerów / Google Review:**
   - Przygotowanie dedykowanego konta testowego (login/hasło) dla zespołu recenzenckiego Google Play oraz instrukcji dostępu do stołów pokerowych.

---

## 5. Weryfikacja środowiska CI i Netlify Deploy Preview

### 5.1. Stan CI w GitHub Actions
- `CI/actionlint`: **PASS** (100% poprawności składni workflows).
- `CodeQL` (Python, JavaScript/TypeScript, Actions): **PASS**.
- `Impact checks` (`CI/impact`, `Tests/impact`, `WS PR Checks/impact`, `WS Server Deploy/impact`, `Validate games catalog`): **PASS** / **SKIPPED** (potwierdzony brak wpływu na runtime).

### 5.2. Wynik i przyczyna błędu Netlify Preview (`playkcswh`)
- Wynik w Netlify: **FAILURE** (`Deploy Preview failed`).
- **Udokumentowana przyczyna niepowodzenia:**
  - Jak zweryfikowano bezpośrednio poleceniem `node scripts/generate-build-info.js`, skrypt generujący kontekst wdrożenia Netlify (`generateServerDeployContext`) wymaga zmiennych środowiskowych migracji Redis V3 (`XP_REDIS_VERSION=3`, `XP_REDIS_ENV=stage`, `XP_KEY_NS=kcswh:stage:xp:v3`) dla kontekstów `deploy-preview`.
  - W automatycznych wywołaniach podglądu Netlify dla gałęzi roboczych zmienne te nie są przekazywane przez Netlify, co powoduje zatrzymanie z błędem `Error: xp_redis_build_context_required` (jest to zachowanie identyczne jak na innych gałęziach PR w repozytorium, udokumentowane w `docs/ops/redis-v3-cutover.md`).
  - Zmiany w PR #1142 dotyczą wyłącznie plików dokumentacyjnych i graficznych w `docs/play-store-listing/`, co wyklucza wpływ na kod źródłowy aplikacji.
