# Google Play Store Listing — Policy & Requirements Verification

**Reference Issue:** [#1140](https://github.com/krzysztofcal/arcadePlatform/issues/1140) / P05  
**Strategic Roadmap:** [#1138](https://github.com/krzysztofcal/arcadePlatform/issues/1138) (Milestone M1)  
**Verification Date:** 2026-10-23  
**Status:** Verification Complete — Compliant with Google Play Store Policies

---

## 1. Google Play Store Metadata & Asset Requirements

### 1.1. Feature Graphic (Baner z grafiką promującą)
| Attribute | Google Play Specification | Arcade Poker Implementation | Status |
| :--- | :--- | :--- | :--- |
| **Dimensions** | Exactly **1024 × 500 px** (horizontal aspect ratio 2.048:1) | 1024 × 500 px (exact pixels) | PASS |
| **Format** | **JPEG** or **24-bit PNG** | 24-bit PNG (`image/png`, RGB 8-bit per channel) | PASS |
| **Alpha / Transparency** | **Strictly prohibited** (must be 100% opaque) | Opaque solid canvas, no alpha channel | PASS |
| **Maximum File Size** | 15 MB | < 1.5 MB (optimized) | PASS |
| **Safe Zone / Composition** | Core visual elements & branding centered; margins ≥ 15% from top/bottom/edges; center area unobstructed for potential video play-button overlay | Centered focal artwork, safe margins (>15%) on all sides, balanced typography | PASS |
| **Prohibited Marketing Copy** | No ranking claims (e.g. *“#1”*, *“Best”*), no pricing/discount claims (*“Free”*, *“Sale”*), no calls to action (*“Download now”*, *“Play free”*) | Only original game branding ("ARCADE POKER: TEXAS HOLD'EM") and genre identifiers; no prohibited marketing text | PASS |

---

### 1.2. Store Listing Text Limits
| Field | Limit | Arcade Poker (PL) | Arcade Poker (EN) | Status |
| :--- | :--- | :--- | :--- | :--- |
| **App Title** | Max **30 characters** | `Arcade Poker: Texas Hold'em` (27 zn.) | `Arcade Poker: Texas Hold'em` (27 chars) | PASS |
| **Short Description** | Max **80 characters** | `Elegancki poker Texas Hold'em online i z botami. Graj za wirtualne żetony CH.` (77 zn.) | `Online & solo Texas Hold'em poker. Pure social play with virtual CH chips.` (74 chars) | PASS |
| **Full Description** | Max **4,000 characters** | ~2,650 zn. (zawiera obowiązkowe klauzule prawne i opis funkcji) | ~2,500 chars (includes mandatory simulated gambling disclaimer) | PASS |
| **Metadata Restrictions** | No emojis in Title or Short Description; no repetitive keyword stuffing; no misleading claims | Clean text without unicode emojis in Title/Short Description; factual feature description | PASS |

---

## 2. Google Play Simulated Gambling & Social Casino Policy

Google Play strictly regulates applications featuring poker, casino games, and simulated gambling under its **Simulated Gambling / Social Casino** guidelines ([Policy Reference: Google Play Gambling & Real-Money Games](https://support.google.com/googleplay/android-developer/answer/9877032)).

### 2.1. Key Compliance Invariants
1. **No Real-World Monetary Value (Brak wartości materialnej):**
   - Arcade Poker operates exclusively with virtual currency called **CH (Arcade Chips)**.
   - CH chips **cannot** be redeemed, exchanged, transferred, or cashed out for real fiat currency, cryptocurrencies, physical goods, gift cards, or any prizes of real-world value.
   - There are no sweepstakes mechanics or secondary cash-out loops.
2. **Mandatory Store Listing Disclaimer:**
   - Both Polish and English descriptions feature a bold, prominent simulated gambling disclaimer at the beginning and end of the store listing.
   - Text explicitly notes:
     - The game is intended for an adult audience (18+).
     - The game does not offer real-money gambling or an opportunity to win real money or real prizes.
     - Practice or success at social poker does not imply future success at real-money gambling.
3. **Age & Content Rating (IARC):**
   - In the International Age Rating Coalition (IARC) questionnaire, Arcade Poker must be classified under **Games > Casino / Card** with simulated gambling disclosed.
   - Expected IARC rating: **PEGI 18** / **USK 18** / **ESRB Teen or Mature** / **Google Play Teen or Adults Only (18+)**, depending on territorial regulations regarding simulated casino table games.

---

## 3. Account Deletion and User Data Transparency

According to Google Play's User Data & Account Deletion Policy ([Reference: Understanding Google Play Account Deletion](https://support.google.com/googleplay/android-developer/answer/10144311) & [answer/13327111](https://support.google.com/googleplay/android-developer/answer/13327111)):

1. **In-App Deletion:**
   - Completed in [#1117](https://github.com/krzysztofcal/arcadePlatform/issues/1117) and accessible via the user profile modal completed in [#1135](https://github.com/krzysztofcal/arcadePlatform/issues/1135).
   - Allows users to delete their account and associated profile data directly from within the app interface.
2. **Public External Deletion URL:**
   - Google Play Console requires a public web URL where users can request account and data deletion without opening the app.
   - Registered endpoint: `https://arcade.kcswh.pl/account.html` (with dedicated account deletion flow and legal contact information).
3. **Data Safety Form Disclosures:**
   - Minimal data collection: Supabase user authentication (email, user ID), gameplay statistics (XP, CH ledger balances).
   - Data is encrypted in transit via HTTPS/WSS.
   - No selling of user personal data to third parties.

---

## 4. Scope Boundary Verification (Anti-Promise Audit)

As required by [#1138](https://github.com/krzysztofcal/arcadePlatform/issues/1138) and [#1140](https://github.com/krzysztofcal/arcadePlatform/issues/1140), store listing materials describe **only confirmed, active features in the codebase**:

| Feature | In Store Listing? | Verification in Codebase |
| :--- | :---: | :--- |
| **No-Limit Texas Hold'em Rules** | YES | Supported by authoritative poker engine (`_shared/poker-engine.mjs`) |
| **Real-time Multiplayer Tables (2–6 seats)** | YES | Handled by WebSocket server (`ws-server/poker/runtime`) |
| **Single Player vs AI Bots** | YES | Verified in `poker/index.html` (Single Player mode, bot seating) |
| **Multiple Table Buy-in Tiers** | YES | Verified in `poker/poker-stakes-ui.js` (Novice, Casual, Semi-Pro, etc.) |
| **Virtual CH Economy** | YES | Authoritative CH ledger (`_shared/xp-ledger.mjs` / `poker_state`) |
| **Welcome Bonus & Daily UTC Streak Bonus** | YES | Verified in `poker/index.html` lines 78–86 and lines 157–158 (`dailyDialog`) |
| **Table Social Reactions & Gift Shop** | YES | Verified in `poker/table-v2.html` (`pokerGiftShop`, `pokerV2ReactionControl`) |
| **In-Game Texas Hold'em Hand Guide** | YES | Verified in `poker/table-v2.html` (`pokerHandInfoPanel`) |
| **Guest Mode & Account Sign-in** | YES | Guest mode with temporary CH; Supabase account for persistent bankroll |
| **World Tour / Country-Themed Tables** | **NO** | Excluded (strictly M2/M3; marked "Coming Soon" in lobby) |
| **Seasons / Rotating Table Themes** | **NO** | Excluded (strictly M2/M3; marked "Coming Soon" in lobby) |
| **Sit & Go Tournaments** | **NO** | Excluded (strictly M2/M3; marked "Coming Soon" in lobby) |
| **In-App Purchases (IAP) / Real-Money Chip Packs** | **NO** | Excluded (strictly M3; v1 is 100% free with no paid shop) |
| **Real Money Cash-out / Real Prizes** | **STRICTLY NO** | Disclaimed in all public copy; prohibited by game design |
