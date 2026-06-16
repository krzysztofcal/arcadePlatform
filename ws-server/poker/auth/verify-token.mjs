import { createHmac, timingSafeEqual } from "node:crypto";

function base64UrlToBuffer(input) {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padLen = (4 - (normalized.length % 4)) % 4;
  return Buffer.from(normalized + "=".repeat(padLen), "base64");
}

function base64UrlDecode(input) {
  return base64UrlToBuffer(input).toString("utf8");
}

function verifyHs256({ token, secret }) {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return { ok: false, code: "auth_invalid", message: "Token format is invalid" };
  }

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  let header;
  let payload;
  let actualBuf;

  try {
    header = JSON.parse(base64UrlDecode(encodedHeader));
    payload = JSON.parse(base64UrlDecode(encodedPayload));
    actualBuf = base64UrlToBuffer(encodedSignature);
  } catch {
    return { ok: false, code: "auth_invalid", message: "Token payload is invalid" };
  }

  if (header.alg !== "HS256") {
    return { ok: false, code: "auth_invalid", message: "Unsupported token algorithm" };
  }

  const data = `${encodedHeader}.${encodedPayload}`;
  const expectedBuf = createHmac("sha256", secret).update(data).digest();

  if (actualBuf.length !== expectedBuf.length || !timingSafeEqual(actualBuf, expectedBuf)) {
    return { ok: false, code: "auth_invalid", message: "Token signature mismatch" };
  }

  if (typeof payload.sub !== "string" || payload.sub.trim().length === 0) {
    return { ok: false, code: "auth_invalid", message: "Token subject is required" };
  }

  return { ok: true, userId: payload.sub };
}

export function verifyToken({ token, env = process.env }) {
  if (typeof token !== "string" || token.trim().length === 0) {
    return { ok: false, code: "auth_invalid", message: "Token is required" };
  }

  const testSecret = env.WS_AUTH_TEST_SECRET;
  if (typeof testSecret === "string" && testSecret.length > 0) {
    return verifyHs256({ token, secret: testSecret });
  }

  const prodSecret = env.WS_AUTH_HS256_SECRET;
  if (typeof prodSecret === "string" && prodSecret.length > 0) {
    return verifyHs256({ token, secret: prodSecret });
  }

  return {
    ok: false,
    code: env.WS_AUTH_REQUIRED === "1" ? "auth_unconfigured" : "auth_invalid",
    message: env.WS_AUTH_REQUIRED === "1" ? "Auth verifier is not configured" : "Token verifier unavailable"
  };
}
