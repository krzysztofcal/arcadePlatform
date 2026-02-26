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

test('Chinese element derivation is deterministic', () => {
  const engine = loadEngine();
  assert.equal(engine.getChineseElement(1991), 'Metal');
  assert.equal(engine.getChineseElement(1991), 'Metal');
});

test('wealth area uses SE direction and Wood element', () => {
  const engine = loadEngine();
  assert.equal(engine.baguaAreas.wealth.direction, 'SE');
  assert.equal(engine.baguaAreas.wealth.element, 'Wood');
});

test('element compatibility score: Wood user with Wood area is positive', () => {
  const engine = loadEngine();
  assert.equal(engine.getElementCompatibilityScore('Wood', 'Wood') > 0, true);
});

test('Byk cusp is still detected for 1991-05-20', () => {
  const engine = loadEngine();
  const influence = engine.computeZodiacInfluence('1991-05-20');
  assert.equal(influence.primarySign, 'byk');
  assert.equal(influence.adjacentSign, 'bliznieta');
  assert.equal(influence.adjacentWeight > 0, true);
});

test('calculateRecommendation returns direction and element data', () => {
  const engine = loadEngine();
  const rec = engine.calculateRecommendation({
    birthDate: '1991-05-20',
    birthYear: '1991',
    zodiacSign: 'byk',
    chineseSign: 'Koza',
    gender: 'obie',
    areas: ['wealth']
  });
  assert.equal(rec.area.direction, 'SE');
  assert.equal(rec.area.element, 'Wood');
  assert.equal(typeof rec.powerStone, 'string');
});

test('deterministic recommendation and XSS-safe strings', () => {
  const engine = loadEngine();
  const a = engine.calculateRecommendation({
    birthDate: '1991-05-20',
    birthYear: '1991',
    zodiacSign: 'byk',
    chineseSign: '<script>alert(1)</script>',
    gender: '<script>alert(2)</script>',
    areas: ['wealth', 'career']
  });
  const b = engine.calculateRecommendation({
    birthDate: '1991-05-20',
    birthYear: '1991',
    zodiacSign: 'byk',
    chineseSign: '<script>alert(1)</script>',
    gender: '<script>alert(2)</script>',
    areas: ['wealth', 'career']
  });
  assert.deepEqual(a, b);
  assert.equal(a.powerStone.includes('<script>'), false);
  assert.equal(a.why.includes('<script>'), false);
  assert.equal(a.area.label.includes('<script>'), false);
});
