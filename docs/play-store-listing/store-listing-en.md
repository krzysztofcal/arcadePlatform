# Google Play Store Listing — English (en-US / en-GB)

**Google Play Store Listing Package for Arcade Poker**  
**Linked Issue:** [#1140](https://github.com/krzysztofcal/arcadePlatform/issues/1140) / P05  
**Strategic Roadmap:** [#1138](https://github.com/krzysztofcal/arcadePlatform/issues/1138) (Milestone M1)  
**Creation Date:** 2026-10-23 · **Updated:** 2026-11-14 (Poker Offline, account deletion, open gates)  
**Document Status:** Working Draft — Pending Owner & Legal Review (Draft), not published  

---

## 1. Store Metadata

### App Title
> **Google Play Maximum Limit:** 30 characters  
> **Exact Character Count:** **27 characters**  
> **Status:** COMPLIANT (PASS)

```text
Arcade Poker: Texas Hold'em
```

*Alternative Suggestion (28 characters):*
```text
Arcade Poker - Texas Hold'em
```

---

### Short Description
> **Google Play Maximum Limit:** 80 characters  
> **Exact Character Count:** **78 characters**  
> **Status:** COMPLIANT (PASS)

```text
Texas Hold'em poker online and offline. Play people or bots for virtual chips.
```

*Alternative Suggestion (71 characters):*
```text
Online and offline Texas Hold'em. Social poker with virtual chips only.
```

---

### Full Description
> **Google Play Maximum Limit:** 4,000 characters  
> **Exact Character Count:** **3612 characters** (with spaces)  
> **Status:** COMPLIANT (PASS)

```text
Welcome to Arcade Poker – an elegant, modern card room designed for poker fans and tactical thinkers who love classic No-Limit Texas Hold'em. Take your seat at the virtual table, read your opponents, and experience the pure thrill of poker with zero financial risk!

Arcade Poker is a free-to-play social card game played only with virtual chips. Immerse yourself in a luxury casino ambiance, bluff, bet and build your virtual bankroll against other players or practise against bots. Choose from three modes: Poker Online and Single Player need an internet connection, while Poker Offline runs on your device without one.

CORE GAME FEATURES:

• AUTHENTIC NO-LIMIT TEXAS HOLD'EM
Pre-flop, flop, turn, river and no-limit betting with clear controls (Fold, Check, Call, Bet, Raise, All-in) and pre-action queues.

• REAL-TIME MULTIPLAYER TABLES
Join 2 to 6-seat tables powered by a real-time game engine, with smooth hands and recovery if your connection drops briefly.

• SINGLE PLAYER MODE — TRAIN VS AI BOTS
Play server-hosted poker bots right away, without waiting for open seats. This mode needs an internet connection and uses your account's CH; decision timers stay active.

• POKER OFFLINE — PLAY WITHOUT INTERNET
Play bots with no network connection, even in airplane mode. The game runs entirely on your device and needs no sign-in. Poker Offline uses separate practice chips, Offline Chips (5,000 to start, free refill), that never sync with your account, CH or XP. Clearing app or browser data removes the local offline save.

• PROGRESSIVE BUY-IN TIERS
Choose a table that matches your bankroll and playing style. Progress from friendly low-stakes tables to high-roller action as your virtual CH stack grows.

• TABLE REACTIONS & IN-GAME GIFT SHOP
Express yourself with reaction bubbles and emojis, and send virtual gifts to tablemates from the Gift Shop.

• BUILT-IN POKER HANDS REFERENCE
Not sure whether a flush beats a straight? The hand ranking guide is always one tap away in the table menu.

• WELCOME BONUS & DAILY UTC STREAKS
Registered players can claim a one-time welcome bonus of virtual CH directly in the poker lobby. Return every day to claim streak rewards and keep your virtual bankroll topped up.

• GUEST PLAY OR PERSISTENT ACCOUNT
Jump in right away as a Guest with temporary chips, or sign in to sync your CH balance and XP across sessions.

• ACCOUNT & PRIVACY
You can request account deletion in the app (Account) or in a browser, even after uninstalling the app: https://play.kcswh.pl/account.html#account-deletion. The process removes your profile and sign-in identity after safely finishing game participation and handling your virtual balance. Some records are kept longer as described in the Privacy Policy, such as settlement history as a financial record without the profile, the identifier of the deleted account, and backups until they rotate.

────────────────────────────────────────
IMPORTANT DISCLAIMER (SIMULATED GAMBLING / SOCIAL CASINO):

• Arcade Poker is intended solely for adult audiences (18+) for amusement and entertainment purposes only.
• The game does NOT offer real-money gambling, sports wagering, or any opportunity to win real money, physical prizes, or monetary payouts.
• Virtual chips (Arcade Chips / CH and Offline Chips) are strictly fictional in-game tokens. They possess NO real-world monetary value and cannot be redeemed, withdrawn, transferred, or exchanged for cash, real goods, or prizes under any circumstances.
• Practice or success at social casino poker does not imply or guarantee future success at real-money gambling or wagering.
```

---

## 2. Store Categorization & Tags

- **Application Type:** Game
- **Primary Category:** Card / Casino (Kasyno społecznościowe)
- **Store Tags:** Poker, Texas Hold'em, Card, Multiplayer, Casino Simulator, Poker Bots, Offline
- **Tag Notice:** The offline tag refers only to Poker Offline; Poker Online and Single Player (server-hosted bots) need a network connection.
- **Target audience:** adults (18+) — the intended audience, not a rating.
- **IARC Content Rating:** OPEN — the IARC questionnaire (including simulated gambling) has not been submitted; the official rating is unknown.

---

## 3. Data Safety & Privacy Disclosures (Status: Pending Audit)

> [!NOTE]
> Formal Google Play Data Safety declarations and data sharing disclosures are **Pending Audit** prior to Play Console submission. Do not declare final data flows, collection categories, or third-party sharing status until the privacy and security audit is formally completed.

- **Data Encryption in transit:** TLS/HTTPS and authenticated WSS in transit.
- **Data Safety Form & Sharing Status:** Pending Audit (final disclosures subject to formal compliance review).
- **Production account deletion URL:** `https://play.kcswh.pl/account.html#account-deletion` — checked 2026-11-14: the page responds and its `account-deletion` section explains browser deletion (sign in → Delete account) and gives a contact address. Entry in Play Console: OPEN (developer account not registered).
- **Retention after deletion:** as in Privacy Policy 2026-11-12-a3 (exceptions: settlement records as a financial record without the profile, the deleted account's identifier, backups until rotation). Data Safety answers must match it — OPEN.
- **Poker Offline:** offline game data stays on the device and is not sent to the server.
