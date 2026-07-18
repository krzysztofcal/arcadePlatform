import crypto from "node:crypto";

const MIN_SECRET_LENGTH = 32;

const normalizeHeader = (value, { lower = false } = {}) => {
  const normalized = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  return lower ? normalized.toLowerCase() : normalized;
};

const readHeader = (headers, name) => {
  if (!headers || typeof headers !== "object") return "";
  const direct = headers[name];
  if (direct != null) return direct;
  const target = name.toLowerCase();
  const match = Object.keys(headers).find((key) => key.toLowerCase() === target);
  return match ? headers[match] : "";
};

const signPayload = (payload, secret) =>
  crypto.createHmac("sha256", secret).update(payload).digest("base64url");

const safeEquals = (leftValue, rightValue) => {
  if (typeof leftValue !== "string" || typeof rightValue !== "string") return false;
  const left = Buffer.from(leftValue, "utf8");
  const right = Buffer.from(rightValue, "utf8");
  return left.length === right.length && crypto.timingSafeEqual(left, right);
};

export function resolveXpSessionSecret(env = process.env) {
  const preferred = typeof env.XP_SESSION_SECRET === "string" ? env.XP_SESSION_SECRET : "";
  const fallback = typeof env.XP_DAILY_SECRET === "string" ? env.XP_DAILY_SECRET : "";
  const secret = preferred || fallback;
  if (!secret) return { valid: false, reason: "missing", secret: "", source: null };
  if (secret.length < MIN_SECRET_LENGTH) {
    return { valid: false, reason: "too_short", secret: "", source: preferred ? "XP_SESSION_SECRET" : "XP_DAILY_SECRET" };
  }
  return {
    valid: true,
    reason: null,
    secret,
    source: preferred ? "XP_SESSION_SECRET" : "XP_DAILY_SECRET",
  };
}

export function createXpSessionFingerprint(headers) {
  const userAgent = normalizeHeader(readHeader(headers, "user-agent"));
  const acceptLanguage = normalizeHeader(readHeader(headers, "accept-language"), { lower: true });
  return crypto.createHash("sha256").update(`${userAgent}|${acceptLanguage}`).digest("hex").slice(0, 16);
}

export function createSignedXpSessionToken({ sessionId, userId, createdAt, fingerprint, secret }) {
  const payload = JSON.stringify({ sid: sessionId, uid: userId, ts: createdAt, fp: fingerprint });
  const encoded = Buffer.from(payload, "utf8").toString("base64url");
  return `${encoded}.${signPayload(payload, secret)}`;
}

export function verifySignedXpSessionToken(token, secret) {
  if (!token || typeof token !== "string") return { valid: false, reason: "missing_token" };
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { valid: false, reason: "malformed_token" };

  let payloadJson;
  try {
    payloadJson = Buffer.from(parts[0], "base64url").toString("utf8");
  } catch {
    return { valid: false, reason: "invalid_encoding" };
  }
  if (!safeEquals(parts[1], signPayload(payloadJson, secret))) {
    return { valid: false, reason: "invalid_signature" };
  }

  try {
    const parsed = JSON.parse(payloadJson);
    if (!parsed || typeof parsed.sid !== "string" || typeof parsed.uid !== "string" || typeof parsed.fp !== "string") {
      return { valid: false, reason: "invalid_payload" };
    }
    return {
      valid: true,
      sessionId: parsed.sid,
      userId: parsed.uid,
      createdAt: parsed.ts,
      fingerprint: parsed.fp,
    };
  } catch {
    return { valid: false, reason: "invalid_payload" };
  }
}
