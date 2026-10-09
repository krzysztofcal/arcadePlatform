# BrowserStack real-device browser validation

BrowserStack is an optional, targeted diagnostic and verification tool. It adds
physical Android/iOS devices and real mobile Firefox, Chrome and Safari where
the selected product/device supports them. It is not a universal PR or CI gate.

## Live, Automate and the proven local setup

- **Live** is for interactive manual validation on a real device.
- **Automate + Selenium/WebDriver** provides repeatable page control,
  `executeScript()` page-context measurements, screenshots and session logs.
- In the setup recorded in [issue #1065](https://github.com/krzysztofcal/arcadePlatform/issues/1065),
  MCP `runBrowserLiveSession` returned an interactive launch URL, but did not
  expose the page-context JavaScript execution or screenshot/session APIs needed
  for automated comparisons. Use Automate + Selenium for those diagnostics;
  this is a limitation of the exposed MCP tool, not of manual Live itself.

The working VPS setup recorded on 2026-10-08 used `@browserstack/mcp-server`,
the `~/bin/browserstack-mcp` wrapper, credentials outside the repository under
`~/.config/browserstack/`, and the Codex entry `mcp_servers.browserstack`.
MCP startup needed `startup_timeout_sec = 60` in the local Codex configuration.
These are setup references, not instructions to reinstall or change VPS services.

Automate was exercised on **real Samsung Galaxy S24 / Android 16.0** devices
with Firefox Android and Chrome Android; desktop Automate was not used.
Live mobile was tried first through MCP, then diagnostics moved to Selenium.
The issue is the source for this historical evidence; documenting it does not
require opening new sessions or reading credentials.

## When to use it

Use it for a concrete browser/device-specific UI regression, Deploy Preview vs
Production parity investigation, viewport/`100dvh`/safe-area/browser-chrome issue,
targeted real-device smoke for a UI-heavy change, a bug desktop
Chromium/Playwright cannot reproduce, or post-deploy diagnostics needing physical
browser evidence.

Do not add broad CSS/layout/UI suites, make BrowserStack mandatory for every PR,
or replace fundamental deterministic tests. Existing **exact-SHA WS Preview
Deploy and relevant smoke requirements remain authoritative** when browser/WS
protocol or WS runtime changes. BrowserStack cannot substitute for that gate.
Do not add BrowserStack/Selenium dependencies to this repository for ad-hoc work.

## Preferred ad-hoc workflow

1. Define the symptom, target URLs/revisions and smallest useful comparison.
   Use MCP for capability discovery if available. Choose Live for manual
   inspection; choose Automate + Selenium for measurements and repeatable control.
2. Keep temporary Selenium scripts, any isolated tooling and outputs under
   `/tmp`, outside the repository. Use the existing secure local credential
   mechanism without printing, embedding or copying secrets into scripts.
   Select a supported real-mobile device/OS/browser configuration.
3. Compare Preview and Production with the **same device, OS and browser**,
   orientation, navigation steps and page state. Record the target URL/revision
   and configuration with each result. Keep cross-browser controls separate.
   Use a read-only scenario; do not change application data or deploy anything
   merely to collect evidence.
4. After the page reaches the same stable state, collect the metrics below with
   Selenium `executeScript()`. Capture screenshots and relevant logs, plus
   session IDs and dashboard URLs when safe to share. Record browser chrome,
   scrolling or keyboard state where these affect the viewport.
5. Always end the WebDriver session with `quit()` in a `finally` block, including
   on failure. End manual Live sessions explicitly; do not leave devices idle.
6. Compare measurements and screenshots before proposing a fix. Stop after
   diagnosis unless evidence justifies an implementation change in its own scope.

Useful page-context measurements:

- `navigator.userAgent` and viewport meta content.
- `innerWidth/innerHeight`, `outerWidth/outerHeight` and
  `document.documentElement.clientWidth/clientHeight`.
- `visualViewport.width/height/scale/offsetLeft/offsetTop`, if available.
- `devicePixelRatio`, `screen.width/height/availWidth/availHeight` and orientation.
- Measured `100dvh` (a temporary probe can be removed immediately after measuring).
- Relevant elements' bounding rectangles and client sizes; safe-area insets
  where relevant to the symptom.
- Computed root/body `zoom`, `transform`, `width` and `font-size`.

## Android Firefox/Chrome diagnosis

The initial proven comparison covered Firefox Preview #1062, Firefox Production,
and Chrome Production as a control. Clean Firefox Android reported matching
Preview/Production layout metrics and did not reproduce the owner's discrepancy.
That evidence helped isolate the owner's Firefox **“Powiększenie”** extension,
which applied site-specific zoom to `play.kcswh.pl`.

If clean-device results agree but a user's Firefox differs, compare their
site-specific zoom, extensions, browser settings and viewport state before
changing CSS. A clean BrowserStack session does not reproduce the user's local
extensions or settings automatically. Keep Chrome as a control, rather than
assuming identical layout behavior across browsers.

A follow-up read-only audit compared accepted #1049, the state after #1061 and
the state after #1062 in both mobile browsers. The issue records that #1061 and
#1062 changed the physically accepted composition and supported recommending
their full reversion. Preserve revision-specific evidence instead of treating
the historical result as proof about future `main`.

## Security and quota

Never print or commit a BrowserStack username, access key, token, credential
value or generated session secret. Keep credentials outside the repo; avoid
credential-bearing command lines, URLs, debug output and artifact metadata.
Temporary diagnostics must not copy credentials into artifacts. Inspect and
redact screenshots/logs before sharing: they can contain authenticated user
data. Treat session links as potentially sensitive. Prefer Stage/Preview for
authenticated scenarios where practical, using approved test accounts and
read-only steps; Production actions require explicit authorization.

Live and Automate have separate product/quota pools. Trial/plan Automate minutes
are finite: budget the smallest matrix, reuse each session for related readings,
close promptly, and avoid repeated runs without a new hypothesis. Do not add
recurring BrowserStack CI consumption without an explicit product/cost decision.

Check current minute allowance and consumption in the account's Automate
dashboard. An authorized read of the [Automate plan API](https://www.browserstack.com/docs/automate/api-reference/selenium/plan)
(`GET https://api.browserstack.com/automate/plan.json`) can inspect plan details
using secure local authentication with no verbose credential output. Its
documented fields describe parallel/queued sessions; do not assume every plan
exposes remaining trial minutes there. Use the dashboard if minute fields are
absent. Read only the needed fields; do not save or publish raw account responses.
The issue's 2026-10-08 snapshot was 60 trial minutes, 4.0 consumed and about 56.0
remaining. This is historical, not a repository constant; the current account
usage is authoritative. Do not query it when the task prohibits credential reads.
