/**
 * Favorites API - Manages user favorite games
 *
 * Endpoints:
 * - GET /api/favorites - Get all favorites for the authenticated user
 * - POST /api/favorites - Add a game to favorites (body: { gameId: string })
 * - DELETE /api/favorites - Remove a game from favorites (body: { gameId: string })
 *
 * All operations require authentication via Bearer token.
 */

import {
  baseHeaders,
  corsHeaders,
  executeSql,
  extractBearerToken,
  klog,
  verifySupabaseJwt,
} from "./_shared/supabase-admin.mjs";

function json(statusCode, obj, origin) {
  const headers = corsHeaders(origin);
  if (!headers) {
    return {
      statusCode: 403,
      headers: baseHeaders(),
      body: JSON.stringify({ error: "forbidden", message: "origin_not_allowed" }),
    };
  }
  return {
    statusCode,
    headers,
    body: JSON.stringify(obj),
  };
}

async function getFavorites(userId, origin) {
  try {
    const rows = await executeSql(
      `SELECT game_id, created_at
       FROM public.favorites
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [userId]
    );

    const favorites = rows.map(row => ({
      gameId: row.game_id,
      createdAt: row.created_at,
    }));

    klog("favorites_get", { userId, count: favorites.length });

    return json(200, { ok: true, favorites }, origin);
  } catch (error) {
    klog("favorites_get_error", { userId, error: error?.message });
    return json(500, { error: "database_error", message: "Failed to get favorites" }, origin);
  }
}

async function addFavorite(userId, gameId, origin) {
  if (!gameId || typeof gameId !== "string") {
    return json(400, { error: "invalid_game_id", message: "gameId is required" }, origin);
  }

  const sanitizedGameId = gameId.trim();
  if (sanitizedGameId.length === 0 || sanitizedGameId.length > 100) {
    return json(400, { error: "invalid_game_id", message: "Invalid gameId" }, origin);
  }

  try {
    // Use INSERT ... ON CONFLICT to handle duplicates gracefully
    await executeSql(
      `INSERT INTO public.favorites (user_id, game_id)
       VALUES ($1, $2)
       ON CONFLICT (user_id, game_id) DO NOTHING`,
      [userId, sanitizedGameId]
    );

    klog("favorites_add", { userId, gameId: sanitizedGameId });

    return json(200, { ok: true, gameId: sanitizedGameId, action: "added" }, origin);
  } catch (error) {
    klog("favorites_add_error", { userId, gameId: sanitizedGameId, error: error?.message });
    return json(500, { error: "database_error", message: "Failed to add favorite" }, origin);
  }
}

async function removeFavorite(userId, gameId, origin) {
  if (!gameId || typeof gameId !== "string") {
    return json(400, { error: "invalid_game_id", message: "gameId is required" }, origin);
  }

  const sanitizedGameId = gameId.trim();
  if (sanitizedGameId.length === 0 || sanitizedGameId.length > 100) {
    return json(400, { error: "invalid_game_id", message: "Invalid gameId" }, origin);
  }

  try {
    await executeSql(
      `DELETE FROM public.favorites
       WHERE user_id = $1 AND game_id = $2`,
      [userId, sanitizedGameId]
    );

    klog("favorites_remove", { userId, gameId: sanitizedGameId });

    return json(200, { ok: true, gameId: sanitizedGameId, action: "removed" }, origin);
  } catch (error) {
    klog("favorites_remove_error", { userId, gameId: sanitizedGameId, error: error?.message });
    return json(500, { error: "database_error", message: "Failed to remove favorite" }, origin);
  }
}

async function checkFavorite(userId, gameId, origin) {
  if (!gameId || typeof gameId !== "string") {
    return json(400, { error: "invalid_game_id", message: "gameId is required" }, origin);
  }

  const sanitizedGameId = gameId.trim();

  try {
    const rows = await executeSql(
      `SELECT 1 FROM public.favorites
       WHERE user_id = $1 AND game_id = $2
       LIMIT 1`,
      [userId, sanitizedGameId]
    );

    const isFavorite = rows.length > 0;

    return json(200, { ok: true, gameId: sanitizedGameId, isFavorite }, origin);
  } catch (error) {
    klog("favorites_check_error", { userId, gameId: sanitizedGameId, error: error?.message });
    return json(500, { error: "database_error", message: "Failed to check favorite" }, origin);
  }
}

export async function handler(event) {
  const origin = event.headers?.origin;
  const method = event.httpMethod;

  // Handle CORS preflight
  if (method === "OPTIONS") {
    const headers = corsHeaders(origin);
    if (!headers) {
      return {
        statusCode: 403,
        headers: baseHeaders(),
        body: JSON.stringify({ error: "forbidden", message: "origin_not_allowed" }),
      };
    }
    return { statusCode: 204, headers };
  }

  // Verify authentication
  const token = extractBearerToken(event.headers);
  const auth = await verifySupabaseJwt(token);

  if (!auth.valid || !auth.userId) {
    klog("favorites_auth_failed", { reason: auth.reason });
    return json(401, {
      error: "unauthorized",
      message: "Authentication required",
      reason: auth.reason
    }, origin);
  }

  const userId = auth.userId;

  // Parse body for POST/DELETE
  let body = {};
  if (event.body) {
    try {
      body = JSON.parse(event.body);
    } catch {
      return json(400, { error: "invalid_json", message: "Invalid request body" }, origin);
    }
  }

  // Handle query parameters for GET with specific game check
  const params = event.queryStringParameters || {};

  switch (method) {
    case "GET":
      // If gameId is provided, check if it's a favorite
      if (params.gameId) {
        return checkFavorite(userId, params.gameId, origin);
      }
      // Otherwise, get all favorites
      return getFavorites(userId, origin);

    case "POST":
      return addFavorite(userId, body.gameId, origin);

    case "DELETE":
      return removeFavorite(userId, body.gameId, origin);

    default:
      return json(405, { error: "method_not_allowed" }, origin);
  }
}
