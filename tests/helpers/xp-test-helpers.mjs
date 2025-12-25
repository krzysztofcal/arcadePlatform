import crypto from "node:crypto";

export async function withEnv(overrides, fn) {
  const original = { ...process.env };
  Object.assign(process.env, overrides);
  try {
    return await fn();
  } finally {
    process.env = original;
  }
}

export function createSupabaseJwt({ sub, secret, alg = "HS256", expOffsetSec = 3600, payload: extraPayload }) {
  const header = { alg, typ: "JWT" };
  const payload = {
    sub,
    exp: Math.floor(Date.now() / 1000) + expOffsetSec,
  };
  if (extraPayload && typeof extraPayload === "object") {
    Object.assign(payload, extraPayload);
  }
  const headerSegment = Buffer.from(JSON.stringify(header)).toString("base64url");
  const payloadSegment = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const hmacAlg = alg === "HS512" ? "sha512" : "sha256";
  const signature = crypto
    .createHmac(hmacAlg, secret)
    .update(`${headerSegment}.${payloadSegment}`)
    .digest("base64url");
  return `${headerSegment}.${payloadSegment}.${signature}`;
}

export async function mockStoreEvalReturn(array) {
  const { store } = await import("../../netlify/functions/_shared/store-upstash.mjs");
  store.eval.mockResolvedValue(array);
  return store;
}

export function parseJsonBody(response) {
  return JSON.parse(response.body);
}
