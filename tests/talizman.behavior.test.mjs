import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import test from 'node:test';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.join(__dirname, '..');
const source = await readFile(path.join(repoRoot, 'js', 'talizman-page.js'), 'utf8');

function loadEngine(){
  const windowObj = {};
  const documentObj = { readyState: 'loading', addEventListener() {} };
  const context = vm.createContext({ window: windowObj, document: documentObj });
  vm.runInContext(source, context);
  return windowObj.__TalizmanEngine;
}

test('cusp weights: 1991-05-20 is byk primary with bliznieta blend', () => {
  const engine = loadEngine();
  const influence = engine.computeZodiacInfluence('1991-05-20');
  assert.equal(influence.primarySign, 'byk');
  assert.equal(influence.adjacentSign, 'bliznieta');
  assert.equal(influence.adjacentWeight > 0, true);
  assert.equal(influence.primaryWeight < 1, true);
});

test('non-cusp weights: 1991-05-10 is full byk', () => {
  const engine = loadEngine();
  const influence = engine.computeZodiacInfluence('1991-05-10');
  assert.equal(influence.primarySign, 'byk');
  assert.equal(influence.adjacentWeight, 0);
  assert.equal(influence.primaryWeight, 1);
});

test('moon phase is deterministic for same date', () => {
  const engine = loadEngine();
  const first = engine.detectMoonPhase('1991-05-20');
  const second = engine.detectMoonPhase('1991-05-20');
  assert.equal(first, second);
});

test('stone selection: byk cusp + money favors cytryn or awenturyn', () => {
  const engine = loadEngine();
  const rec = engine.calculateRecommendation({
    birthDate: '1991-05-20',
    zodiacSign: 'byk',
    chineseSign: 'Koza',
    gender: 'obie',
    skills: ['money']
  });
  assert.match(rec.powerStone, /^Szmaragd \+ (Cytryn|Awenturyn)$/);
});

test('output text should not include script from user-controlled fields', () => {
  const engine = loadEngine();
  const rec = engine.calculateRecommendation({
    birthDate: '1991-05-20',
    zodiacSign: 'byk',
    chineseSign: '<script>alert(1)</script>',
    gender: '<script>alert(2)</script>',
    skills: ['money']
  });
  assert.equal(typeof rec.powerStone, 'string');
  assert.equal(rec.powerStone.includes('<script>'), false);
  assert.equal(rec.why.includes('<script>'), false);
});
