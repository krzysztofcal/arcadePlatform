import assert from "node:assert/strict";
import { parseStakes } from "../netlify/functions/_shared/poker-stakes.mjs";

const expectOk = (input, expected) => {
  const result = parseStakes(input);
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, expected);
};

const expectFail = (input) => {
  const result = parseStakes(input);
  assert.equal(result.ok, false);
  assert.equal(result.error, "stakes_invalid");
};

expectOk({ sb: 1, bb: 2 }, { sb: 1, bb: 2 });
expectOk('{"sb":1,"bb":2}', { sb: 1, bb: 2 });
expectOk("1/2", { sb: 1, bb: 2 });

expectFail({});
expectFail({ sb: 1 });
expectFail({ sb: 2, bb: 2 });
expectFail({ sb: 2, bb: 1 });
expectFail({ sb: -1, bb: 2 });
expectFail({ sb: 1, bb: 0 });
expectFail({ sb: 0.5, bb: 2 });
expectFail({ sb: 1, bb: 1_000_001 });
expectFail("nope");
expectFail('{"sb":1.2,"bb":2}');
expectFail("");
