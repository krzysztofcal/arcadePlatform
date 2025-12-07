# Codebase Analysis

## Overview
The portal is a static HTML site enhanced with standalone JavaScript services. Runtime behaviour is orchestrated with globals such as `window.ArcadeCatalog`, `window.I18N`, and bespoke scripts per page. The existing approach makes it easy to ship without a bundler but increases the risk of duplicated logic and dead assets.

## Issues Identified
- **Dead legacy bundle** – `js/game.js.bak` duplicated fullscreen handling logic that is already superseded by `js/game.js`. The file was not referenced anywhere and risked re-introduction during maintenance. The backup has been removed.
- **Portal rendering tightly coupled to script scope** – The original `js/portal.js` embedded all rendering helpers and state in an IIFE, which made it difficult to reuse logic, inject dependencies for testing, or extend the UI. It also scattered DOM generation code across free functions, encouraging duplication for future widgets.
- **Legacy data normalisation gaps** – The fallback branch mapping `window.GAMES` converted `subtitle` strings directly into the data model, but left the translated shape inconsistent with the catalogue helpers from `js/core/catalog.js`. This could yield empty subtitles in non-default languages.
- **Template duplication** – Static pages (`index.html`, `about.*.html`, `legal/*`) repeat metadata, analytics, and font includes. Without a templating layer, it is easy for a future edit to miss one copy, leading to inconsistent SEO tags or tracking configuration.

## Refactor Highlights
- Introduced a `PortalApp` class (`js/core/PortalApp.js`) that encapsulates state, DOM rendering, analytics hooks, and data loading. The bootstrap script simply wires DOM nodes into the class, encouraging dependency injection and making the behaviour testable in isolation.
- Normalised legacy game data inside the new class by funnelling strings through `asLocaleBlock`, ensuring both locales are populated before delegating to the catalogue normaliser.
- Retained analytics and CMP behaviour while isolating DOM creation in dedicated helper methods (`createPlayableCard`, `createPlaceholderCard`, `createPromoCard`), reducing duplication and clarifying responsibilities.
- Documented the outstanding duplication across HTML templates to guide future migration to a shared layout (e.g. static site generator or server-side include).

## Opportunities
- Adopt a lightweight build step (Eleventy, Astro, or Vite + templating) to consolidate `<head>` metadata and shared footer structures.
- Create unit tests for `PortalApp` by instantiating it with a mocked `document` and `fetchImpl`, improving confidence when adding filters or pagination.

## Game Controls Service

A standardized `GameControlsService` (`js/core/GameControlsService.js`) has been introduced to provide consistent game control buttons (mute, pause, fullscreen) across all game pages. This service:

- Provides unified mute/pause/fullscreen controls for all games
- Supports keyboard shortcuts (M for mute, Space for pause, F for fullscreen)
- Integrates with the klog logging system for debugging and analytics
- Handles state persistence in localStorage
- Supports both native canvas games and iframe-embedded distributor games

All game pages (game_cats.html, game_trex.html, game.html) now include the same control buttons in their `.titleBar` section, ensuring a consistent user experience across the portal.

For detailed implementation documentation, see [docs/game-controls.md](./game-controls.md).
