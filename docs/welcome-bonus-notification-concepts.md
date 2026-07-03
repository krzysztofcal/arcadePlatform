# Welcome Bonus Notification Concepts

## Goal

Notify eligible users that a `500 CH` Welcome Bonus is waiting for them without creating spam, dark patterns, or misleading account messaging.

The bonus should feel like a clear account benefit, not a forced promotion. The current backend-driven eligibility model is a good base: the product can ask the backend whether a signed-in account can claim the bonus, then show the notification only when the account is actually eligible.

## Recommended Approach

Use in-product notifications first. Email should be optional and conservative.

Best initial stack:

1. Account page bonus card.
2. Topbar chip/bell indicator.
3. Poker lobby/table lightweight banner.
4. Optional notification center entry.
5. Email only if the user has marketing consent or if legal review confirms it can be sent as a service/account message in the target jurisdiction.

This keeps the highest-value notification inside the product, where the user can claim immediately and where the eligibility check is fresh.

## Pattern 1: Account Page Bonus Card

Where:

- `/account.html`
- Near chip balance/account details.

Copy:

```text
500 CH Welcome Bonus is waiting for you
Claim your bonus and start playing with persistent chips.
```

CTA:

```text
Claim 500 CH
```

Pros:

- Clear and low-risk.
- Already close to account/chip context.
- Good place for a persistent reward state.

Cons:

- User must visit account page.

Recommendation:

- Keep this as the canonical claim location.
- Hide after claimed, ineligible, or failed closed.

## Pattern 2: Topbar Chip/Bell Indicator

Where:

- Topbar near chip balance/avatar.

Behavior:

- Show a small badge or dot only for eligible users.
- Click opens account page or a compact popover with claim CTA.

Copy:

```text
500 CH bonus available
```

Pros:

- Visible across the app.
- Common SaaS/game pattern for pending rewards.
- Does not interrupt gameplay.

Cons:

- Needs careful rate limiting so it does not feel noisy.

Recommendation:

- Use a subtle badge, not a modal.
- Badge disappears immediately after successful claim.
- If dismissed, keep a small non-intrusive indicator for the session or day.

## Pattern 3: Poker Lobby Banner

Where:

- Poker lobby.
- Above table list or near Guest/Account panel.

Copy:

```text
Your 500 CH Welcome Bonus is ready.
Claim it to use persistent chips across Arcade Hub.
```

CTA:

```text
Claim bonus
```

Pros:

- Strong context: user is already thinking about poker/chips.
- Good conversion point after Guest Mode.

Cons:

- Should not block table entry.

Recommendation:

- Use a lightweight inline banner.
- Never modal.
- Show only if backend status says `eligible`.

## Pattern 4: Poker Table Toast/Banner

Where:

- Poker table, after hand end or on first table load for authenticated eligible users.

Copy:

```text
500 CH Welcome Bonus available
Claim after this hand.
```

Pros:

- Timely and game-like.
- Good fit after a hand or win.

Cons:

- Risk of distracting the player during gameplay.

Recommendation:

- Do not show during an active decision.
- Show only after hand completion or in a passive table header area.
- Limit to once per session.

## Pattern 5: Notification Center / Messages

Where:

- A small topbar bell or account dropdown.

Message:

```text
Welcome Bonus
500 CH is waiting for your account.
```

CTA:

```text
Claim
```

Pros:

- Scales beyond welcome bonus: daily rewards, achievements, maintenance, tournaments.
- Lets users revisit dismissed messages.
- Cleaner than scattering banners everywhere.

Cons:

- Requires a small notification model and UI.
- Overkill if only used for one bonus.

Recommendation:

- Good PR4/PR5 candidate, not required for the bonus itself.
- Start with local/backend-derived virtual notifications before adding a persisted messages table.

Minimal first version:

- Build notifications client-side from existing API state.
- Example: if `welcome-bonus` status is eligible, add one virtual notification.
- No new DB table yet.

Future persisted version:

- `notifications` table with `user_id`, `type`, `status`, `created_at`, `read_at`, `dismissed_at`, `metadata`.
- Useful for multi-device read/dismiss sync.

## Pattern 6: Email Reminder

Email can work, but it is the riskiest channel from a compliance and trust perspective.

Potential subject:

```text
Your 500 CH Welcome Bonus is waiting
```

Potential body:

```text
You have a 500 CH Welcome Bonus available in Arcade Hub.
Sign in to claim it from your account page.
```

Important:

- Do not say the bonus was added unless the user already claimed it.
- Do not imply urgency unless there is a real expiration date.
- Include unsubscribe/marketing preferences if the email is commercial/marketing.

Legal/compliance note:

- In the US, the FTC explains that CAN-SPAM covers commercial email and requires accurate headers, non-deceptive subjects, clear ad identification where applicable, a physical postal address, and an opt-out mechanism. Transactional or relationship messages are treated differently, but the FTC warns those categories are narrow.
- In the EU/UK-style ePrivacy model, unsolicited marketing email generally requires prior consent, with limited existing-customer or similar-product exceptions depending on local law and how consent was collected.

Practical recommendation:

- Do not send a newsletter-style bonus email to users who did not opt into marketing.
- If using email, prefer one of these safer variants:
  - Send only to users with explicit marketing consent.
  - Include the bonus mention inside a legitimate account/service email only after legal review confirms the primary purpose is transactional/relationship.
  - Add a user setting for product/reward emails and use that consent going forward.

For the current PR3/PR4 path, in-product notification is the better first move.

## Good Product Pattern

The strongest pattern for Arcade Hub:

1. User logs in.
2. Backend returns `eligible: true`.
3. Topbar shows a small chip badge: `+500`.
4. Account page and poker lobby show a clear claim card.
5. User clicks `Claim 500 CH`.
6. Success toast confirms: `Welcome! 500 CH have been added to your account.`
7. Badge/card disappear everywhere after the next status refresh.

This matches common free-to-play and SaaS reward patterns:

- Reward is visible but not blocking.
- Claim is explicit.
- No fake urgency.
- No success copy before the ledger transaction exists.
- State is driven by backend eligibility, not local storage.

## Anti-Patterns To Avoid

- Modal on login.
- Full-screen interstitial before gameplay.
- Repeated banners every page load.
- “You received 500 CH” before successful claim.
- “Sign in and get 500 CH” for users who may be ineligible.
- Email blast to all users without consent review.
- Countdown timers unless the bonus really expires.
- Persisting a notification after `alreadyClaimed`.

## Proposed Rollout

### PR4A: In-Product Bonus Notification

Scope:

- Account page claim card polish.
- Topbar badge for eligible users.
- Poker lobby inline banner.
- Dismiss once per session/day.

No new DB table required.

### PR4B: Notification Center Foundation

Scope:

- Bell/dropdown UI.
- Virtual notification for welcome bonus.
- Optional persisted read/dismiss state later.

### PR4C: Email Consent Strategy

Scope:

- Add marketing/reward email preference.
- Update privacy/cookie/consent copy if needed.
- Send bonus reminder only to consented users or after legal approval.

## Open Decisions

- Should the bonus notification be dismissible permanently or only for the current session?
- Should the bonus ever expire?
- Should topbar show a numeric `+500` badge or a neutral dot?
- Should reward notifications become a generic system for daily rewards and achievements?
- Is Arcade Hub targeting EU/UK users, US users, or both for email compliance?

## Sources

- FTC, CAN-SPAM Act: A Compliance Guide for Business: https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business
- EU ePrivacy Directive: https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A32002L0058
- UK ICO direct marketing and PECR guidance entry points:
  - https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/
  - https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/direct-marketing-and-pecr/
