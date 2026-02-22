const NETLIFY_DOMAIN_REGEX = /^https:\/\/[a-z0-9-]+\.netlify\.app$/i;

export const buildCorsAllowlist = ({ xpCorsAllow, siteUrl } = {}) => {
  const fromEnv = String(xpCorsAllow || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (siteUrl && !fromEnv.includes(siteUrl)) fromEnv.push(siteUrl);
  return fromEnv;
};

export const isOriginAllowed = ({ origin, allowlist }) => {
  if (!origin) return true;
  if (NETLIFY_DOMAIN_REGEX.test(origin)) return true;
  const list = Array.isArray(allowlist) ? allowlist : [];
  if (list.length === 0) return true;
  return list.includes(origin);
};

export const buildCorsHeaders = ({ origin, allowlist, methods = "POST,OPTIONS", headers = "content-type,authorization,x-api-key" } = {}) => {
  const baseHeaders = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  };
  if (!origin) return baseHeaders;
  if (!isOriginAllowed({ origin, allowlist })) return null;
  return {
    ...baseHeaders,
    "access-control-allow-origin": origin,
    "access-control-allow-headers": headers,
    "access-control-allow-methods": methods,
    Vary: "Origin",
  };
};
