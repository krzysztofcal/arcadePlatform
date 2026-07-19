import { canonicalizeXpGameId, isSupportedXpGameId } from "./xp-identity.mjs";

export const XP_AWARD_MAX_BODY_BYTES = 16 * 1024;
export const XP_AWARD_MAX_GAME_EVENTS = 50;
export const XP_AWARD_MAX_WINDOW_MS = 30_000;

const invalid = (field) => ({ ok: false, error: "invalid_award_payload", field });
const isNonNegativeSafeInteger = (value) => Number.isSafeInteger(value) && value >= 0;

export function normalizeXpAwardInput(body, { maxWindowMs = XP_AWARD_MAX_WINDOW_MS } = {}) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return invalid("body");
  if (typeof body.gameId !== "string" || !body.gameId.trim()) return invalid("gameId");

  const gameId = canonicalizeXpGameId(body.gameId);
  if (!isSupportedXpGameId(gameId)) return { ok: false, error: "unsupported_game" };

  if (!isNonNegativeSafeInteger(body.windowStart)) return invalid("windowStart");
  if (!isNonNegativeSafeInteger(body.windowEnd)) return invalid("windowEnd");
  if (body.windowEnd < body.windowStart || body.windowEnd - body.windowStart > maxWindowMs) return invalid("window");
  if (!isNonNegativeSafeInteger(body.inputEvents)) return invalid("inputEvents");
  if (!Number.isFinite(body.visibilitySeconds) || body.visibilitySeconds < 0) return invalid("visibilitySeconds");

  const scoreDelta = body.scoreDelta === undefined ? 0 : body.scoreDelta;
  if (!isNonNegativeSafeInteger(scoreDelta)) return invalid("scoreDelta");
  const gameplayActions = body.gameplayActions === undefined ? 0 : body.gameplayActions;
  if (!isNonNegativeSafeInteger(gameplayActions)) return invalid("gameplayActions");

  const gameEvents = body.gameEvents === undefined ? [] : body.gameEvents;
  if (!Array.isArray(gameEvents) || gameEvents.length > XP_AWARD_MAX_GAME_EVENTS) return invalid("gameEvents");

  return {
    ok: true,
    value: {
      gameId,
      windowStart: body.windowStart,
      windowEnd: body.windowEnd,
      windowMs: body.windowEnd - body.windowStart,
      inputEvents: body.inputEvents,
      visibilitySeconds: body.visibilitySeconds,
      scoreDelta,
      gameplayActions,
      gameEvents,
    },
  };
}
