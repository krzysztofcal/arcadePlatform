import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

function loadHooks(){
  const source = fs.readFileSync(path.join(process.cwd(), 'poker', 'poker-v2.js'), 'utf8');
  const sandbox = {
    window: {
      __RUNNING_POKER_UI_TESTS__: true,
      location: { search: '' }
    },
    document: {
      readyState: 'loading',
      addEventListener(){},
      getElementById(){ return null; },
      querySelector(){ return null; }
    },
    URLSearchParams,
    Date,
    console
  };
  sandbox.window.document = sandbox.document;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'poker/poker-v2.js' });
  return sandbox.window.__POKER_V2_TEST_HOOKS__;
}

test('preview target remains bound to the selected user and seat', () => {
  const hooks = loadHooks();
  const selected = { userId: 'bot-2', seatNo: 3 };
  const targetValue = hooks.celebrationPreviewTargetValue(selected);

  assert.equal(hooks.resolveCelebrationPreviewTarget(targetValue, [selected], 'viewer'), selected);
  assert.equal(hooks.resolveCelebrationPreviewTarget(targetValue, [
    { userId: 'bot-2', seatNo: 4 },
    { userId: 'replacement', seatNo: 3 }
  ], 'viewer'), null, 'moving the selected player must not select a replacement at the old seat');
});

test('preview seat label matches the seat number shown beside the avatar', () => {
  const hooks = loadHooks();

  assert.equal(hooks.celebrationPreviewOptionLabel({
    userId: 'bot-2', displayName: 'Mila', isBot: true, seatNo: 3
  }), 'Mila · Bot · seat 3');
});
