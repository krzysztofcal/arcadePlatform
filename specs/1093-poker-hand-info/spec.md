# #1093 — Poker V2 UI: Luxury Casino Poker Hands quick-reference panel

**Source**: GitHub Issue [#1093](https://github.com/krzysztofcal/arcadePlatform/issues/1093)  
**Baseline**: main (`8f691d65`)  
**Status**: Implementation ready

---

## 🎯 Goal

Provide an accessible, permanent, elegant Luxury Casino quick-reference panel displaying all 10 Texas Hold'em poker hand rankings with exact example cards and descriptions, accessible in Poker Table V2 for all visitors (guests, signed-in users, spectators, and seated players), without obscuring the Join button or interfering with table actions across all device viewports and orientations.

---

## 📋 Requirements & Acceptance Criteria

### Functional Requirements
- **FR-001 (Toggle Placement)**: A permanent trigger button `#pokerHandInfoToggle` is placed inside `.poker-top-right-rail > .poker-top-right-reactions` adjacent to existing table utility controls (`#pokerGiftShopButton`, `#pokerV2ReactionBtn`, `#pokerReactionHistoryToggle`). It is never placed in Table settings.
- **FR-002 (Availability)**: The trigger is visible for spectators, authenticated users, and unauthenticated guests.
- **FR-003 (Panel Presentation)**: `#pokerHandInfoPanel` is a non-modal panel outside the flex button row within the table screen. It displays an accessible header with title and sticky Close control (`#pokerHandInfoClose`), all 10 standard poker hands ordered from strongest to weakest with 5 example cards each, concise explanations, and a Texas Hold'em evaluation rule note.
- **FR-004 (Static Hand Content)**: Contains exactly the 10 canonical hand rankings with specified static card samples:
  1. Royal Flush — A♠ K♠ Q♠ J♠ 10♠ (distinct teaching row, Ace-high straight flush)
  2. Straight Flush — 9♦ 8♦ 7♦ 6♦ 5♦
  3. Four of a Kind — A♣ A♦ A♥ A♠ 9♠
  4. Full House — Q♠ Q♥ Q♦ J♣ J♥
  5. Flush — A♦ J♦ 9♦ 7♦ 2♦
  6. Straight — 9♠ 8♦ 7♥ 6♣ 5♠
  7. Three of a Kind — 9♠ 9♥ 9♦ K♣ 2♦
  8. Two Pair — A♠ A♦ Q♣ Q♥ 4♠
  9. One Pair — 9♦ 9♠ J♥ 7♣ 2♦
  10. High Card — A♠ K♦ 9♥ 6♣ 2♠
- **FR-005 (Evaluation Rule Note)**: Notes that best 5 cards are made from 2 hole + 5 community cards (0, 1, or 2 hole cards may be used). Does not claim live evaluation.
- **FR-006 (Interaction & Accessibility)**:
  - Toggle opens and closes the panel via `aria-expanded` and `hidden`.
  - Close button and Escape key dismiss the panel and return focus to `#pokerHandInfoToggle`.
  - Outside pointer/click closes the panel without capturing or stealing target focus.
  - No backdrop overlay blocking interaction; panel never auto-opens.
- **FR-007 (Non-interference with Join)**: The trigger and open panel must not obscure, clip, or displace `#pokerV2JoinBtn` across 390×844, 320×568 portrait and 844×390, 568×320 landscape.
- **FR-008 (Viewport Sizing & Scroll)**: Panel fits viewport bounds (`max-height` bounded by `100dvh` and safe areas) with internal scrolling and sticky header.

---

## 🚫 Operational Boundaries

- **Zero backend/WS/DB changes**: No modifications to WebSocket runtime, database, migrations, game protocol, or economy.
- **Preserve #1077 and #1092**: No touching of Single Player mode or animated Join button behavior.
- **No external assets or heavy libraries**: All icons and cards rendered via semantic HTML and scoped CSS.
- **No production deployment or merge**: Confined to feature branch Draft PR for owner visual review.
