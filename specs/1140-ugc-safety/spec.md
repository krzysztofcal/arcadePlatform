# #1140 UGC safety — Report, Block, Moderation, Google avatar consent (WWW + Android)

Owner decision 2026-10-26 (#1140) and owner GO 2026-11-06. Scope is the whole Arcade Hub: the same pages and
functions serve WWW and the Android app. Phase A (#1155/#1160: curated avatars, generated names, no bio,
login-required profiles, operator profile block) is the input; this spec adds phases B, C and D.

## Requirements

- **R-REPORT (B).** A signed-in user reports another user from the public profile or from a poker seat with one
  fixed reason (`inappropriate_avatar`, `inappropriate_name`, `harassment`, `cheating`, `spam`, `other`). No free
  text, so a report adds no new user content. The server resolves the target (handle or seat user id), refuses
  self-reports and unknown users, stores its own snapshot of the target's public identity as evidence and answers
  a repeated open report as already reported. At most 10 reports per user and hour; the limiter fails closed.
- **R-BLOCK (B).** A signed-in user blocks and unblocks another user. A block is the blocker's private filter: on
  the blocker's screens it masks the blocked user's avatar and hides their reactions and gifts; the profile page
  offers Unblock. It never changes seats, turns, cards, chips, escrow, settlement or reconnect, and the blocked
  user is not told. At most 500 blocks; 60 changes per user and hour.
- **R-MODERATE (C).** Admins see a queue of reports in the existing `admin.html` (status filter, oldest first),
  resolve or dismiss them with an audited decision, hide a user's avatar (Arcade fallback) or restrict the public
  profile (the phase A operator profile block), with the existing admin authorization. The "Reports" tab shows a
  simple counter of pending reports, read when the admin panel opens, the tab is shown or Refresh is pressed.
  Owner decision 2026-11-07: no e-mail, mail provider, digest, scheduled job, automatic alert or any other
  notification; moderation is checked manually in the admin panel.
- **R-RETAIN (C).** A report never disappears without review: it leaves "pending" only through an audited admin
  decision in one transaction (a failed action rolls the decision back), nothing expires or deletes pending
  reports, and the queue is oldest first so new reports do not push old ones out of view. The only removal is the
  account-deletion cascade of the reported user (R-SAFE). A manual review procedure (who checks the panel and how
  often) must be set by the owner before public activation.
- **R-CONSENT (D).** Google sign-in offers a separate, unticked, optional consent to import and publicly show the
  Google photo. With consent the photo is imported once through the existing avatar processing and Storage path;
  refusal, withdrawal or a moderator hide falls back to the Arcade avatar; withdrawal never re-imports
  automatically. Consent and withdrawal are recorded with time and version. No free upload, name edit or bio returns.
- **R-SAFE (all).** Signed-in, active accounts only (account deletion lifecycle respected); private tables, no
  client role access; deletion of an account cascades its blocks and reports about it and forgets it as reporter.
  Dark until enabled: only `UGC_SAFETY_ENABLED=1`, set explicitly per Netlify context (previews included). No WS, poker engine, ledger or settlement change.

## Out of scope

Free-text reports or chat, appeals UI, automated content scanning, notifications to reported users or to admins
(e-mail, digest, scheduler, alerts: owner decision 2026-11-07), WS-side
enforcement of blocks (a block is a client filter in v1; enforcing it in WS needs a separate decision).

## Breaking impact

None for existing users until enabled. New functions `ugc-report`, `user-blocks` (phase B), admin endpoints
(phase C) and consent fields (phase D). Privacy/Terms and Play Data Safety must describe reports, blocks,
moderation and photo consent before activation (legal gate, owner).
