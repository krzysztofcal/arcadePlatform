import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";

const run = async () => {
  const handler = loadPokerHandler("netlify/functions/poker-act.mjs", {
    baseHeaders: () => ({}),
    corsHeaders: () => ({ "access-control-allow-origin": "https://example.test" }),
    extractBearerToken: () => "token",
    verifySupabaseJwt: async () => ({ valid: false, code: "invalid_token" }),
    klog: () => {},
  });

  assert.equal(typeof handler, "function");
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
