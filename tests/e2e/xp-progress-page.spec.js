const { test, expect } = require('@playwright/test');

const GAME_PAGE = '/games-open/2048/index.html';
const XP_PAGE = '/xp.html';

function buildXpClientStub(config = {}) {
  const options = {
    cap: config.cap ?? 3000,
    award: config.award ?? 60,
    storageKey: config.storageKey ?? '__xpTestProgress',
    baseTotal: config.baseTotal ?? 0,
    dayKey: config.dayKey ?? 'xp-test-day',
  };
  return `(${function initXpClientStub(opts) {
    (function(){
      const config = opts || {};
      const CAP = Number(config.cap);
      const AWARD = Number(config.award) || 30;
      const STORAGE_KEY = config.storageKey || '__xpTestProgress';
      const calls = [];
      function record(method, payload) {
        calls.push({ method, payload });
      }
      Object.defineProperty(window, '__xpCalls', {
        configurable: true,
        enumerable: false,
        get() { return calls; },
      });
      function loadState() {
        try {
          const raw = window.localStorage.getItem(STORAGE_KEY);
          if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object') {
              return {
                totalToday: Math.max(0, Number(parsed.totalToday) || 0),
                totalLifetime: Math.max(0, Number(parsed.totalLifetime) || 0),
                nextReset: Number(parsed.nextReset) || (Date.now() + 60 * 60 * 1000),
              };
            }
          }
        } catch (_) {}
        return {
          totalToday: 0,
          totalLifetime: Math.max(0, Number(config.baseTotal) || 0),
          nextReset: Date.now() + 60 * 60 * 1000,
        };
      }
      const state = loadState();
      function persist() {
        try {
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
            totalToday: state.totalToday,
            totalLifetime: state.totalLifetime,
            nextReset: state.nextReset,
          }));
        } catch (_) {}
      }
      function remainingCap() {
        if (!Number.isFinite(CAP) || CAP < 0) return Infinity;
        return Math.max(0, Math.floor(CAP) - state.totalToday);
      }
      function snapshot() {
        const capValue = Number.isFinite(CAP) && CAP >= 0 ? Math.floor(CAP) : null;
        const remaining = remainingCap();
        const payload = {
          totalToday: state.totalToday,
          totalLifetime: state.totalLifetime,
          cap: capValue,
          dayKey: config.dayKey || 'xp-test-day',
          nextReset: state.nextReset,
        };
        if (Number.isFinite(remaining)) {
          payload.remaining = remaining;
        }
        return payload;
      }
      Object.defineProperty(window, '__xpTestTotals', {
        configurable: true,
        enumerable: false,
        get() {
          const snap = snapshot();
          const remaining = remainingCap();
          return {
            totalToday: snap.totalToday,
            totalLifetime: snap.totalLifetime,
            cap: snap.cap,
            remaining,
          };
        },
      });
      const stub = {
        postWindow(payload) {
          record('postWindow', payload || null);
          const base = payload && typeof payload.scoreDelta === 'number'
            ? Math.max(0, Math.floor(payload.scoreDelta))
            : AWARD;
          const remaining = remainingCap();
          const awarded = Number.isFinite(remaining) ? Math.min(base, remaining) : base;
          state.totalToday += awarded;
          state.totalLifetime += awarded;
          persist();
          const snap = snapshot();
          snap.ok = true;
          snap.awarded = awarded;
          if (snap.cap != null) {
            snap.remaining = remainingCap();
          }
          return Promise.resolve(snap);
        },
        fetchStatus(payload) {
          record('fetchStatus', payload || null);
          const snap = snapshot();
          snap.ok = true;
          return Promise.resolve(snap);
        },
      };
      Object.defineProperty(window, 'XPClient', {
        configurable: true,
        enumerable: false,
        get() { return stub; },
        set() { /* ignore overrides */ },
      });
    })();
  }})(${JSON.stringify(options)});`;
}

async function clearStorage(page) {
  await page.goto(XP_PAGE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    try {
      if (window.localStorage) {
        window.localStorage.clear();
      }
    } catch (err) {
      if (!(err && err.name === 'SecurityError')) {
        throw err;
      }
    }
  });
}

async function waitForXpReady(page) {
  await page.waitForFunction(() => {
    return !!(window.XP && typeof window.XP.startSession === 'function' && typeof window.XP.nudge === 'function');
  }, null, { timeout: 15_000 });
}

async function simulatePlayWindow(page, iterations = 14) {
  await waitForXpReady(page);
  await page.evaluate(() => {
    if (window.XP && typeof window.XP.startSession === 'function') {
      window.XP.startSession('xp-progress-test');
    }
  });
  await page.click('#board', { position: { x: 50, y: 50 } }).catch(() => {});
  const sequence = ['ArrowRight', 'ArrowUp', 'ArrowLeft', 'ArrowDown'];
  for (let i = 0; i < iterations; i += 1) {
    await page.keyboard.press(sequence[i % sequence.length]);
    await page.evaluate(() => {
      if (window.XP && typeof window.XP.nudge === 'function') {
        window.XP.nudge();
      }
    });
    await page.waitForTimeout(750);
  }
  await page.waitForTimeout(1_500);
}

async function waitForAward(page, count = 1) {
  await page.waitForFunction((min) => {
    const calls = (window.__xpCalls || []).filter((entry) => entry && entry.method === 'postWindow');
    return calls.length >= min;
  }, count, { timeout: 25_000 });
}

function extractNumber(text) {
  if (!text) return 0;
  const normalized = text.replace(/[^0-9-]/g, '');
  const value = Number(normalized);
  return Number.isFinite(value) ? value : 0;
}

async function openXpPage(page) {
  await page.goto(XP_PAGE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => {
    const value = document.getElementById('xpRemaining');
    const hint = document.getElementById('xpRemainingHint');
    return !!(value && value.textContent && hint && hint.textContent);
  }, null, { timeout: 10_000 });
}

test.describe('XP Progress page', () => {
  test('shows earned XP and remaining allowance', async ({ page }) => {
    await clearStorage(page);
    await page.evaluate(() => {
      if (window.localStorage) {
        window.localStorage.setItem('__xpProgressProbe', '1');
        window.localStorage.removeItem('__xpProgressProbe');
      }
    });
    await page.addInitScript({ content: buildXpClientStub({ cap: 3000, award: 120, storageKey: '__xpProgressDefault' }) });

    await page.goto(GAME_PAGE, { waitUntil: 'domcontentloaded' });
    await simulatePlayWindow(page);
    await waitForAward(page, 1);
    const totals = await page.evaluate(() => window.__xpTestTotals);
    expect(totals.totalToday).toBeGreaterThan(0);

    await openXpPage(page);

    const resetHint = await page.textContent('#xpResetHint');
    if (resetHint && resetHint.trim()) {
      expect(resetHint).toMatch(/Europe\/Warsaw|Europa\/Warszawa/);
    }

    const levelText = await page.textContent('#xpLevel');
    expect(extractNumber(levelText)).toBeGreaterThanOrEqual(1);

    const totalXp = extractNumber(await page.textContent('#xpTotal'));
    expect(totalXp).toBeGreaterThanOrEqual(totals.totalToday);

    const capText = await page.textContent('#xpDailyCap');
    const capValue = extractNumber(capText);
    expect(capValue).toBe(3000);

    const earnedToday = extractNumber(await page.textContent('#xpTodayLine'));
    expect(earnedToday).toBeGreaterThan(0);

    const remainingValue = extractNumber(await page.textContent('#xpRemaining'));
    const expectedRemaining = Math.max(0, (totals.cap ?? 0) - totals.totalToday);
    expect(Math.abs(remainingValue - expectedRemaining)).toBeLessThanOrEqual(1);

    const todayRemainingText = extractNumber(await page.textContent('#xpRemainingLine'));
    expect(Math.abs(todayRemainingText - expectedRemaining)).toBeLessThanOrEqual(1);

    const dailyCopy = await page.textContent('#xpTodayLine');
    expect((dailyCopy || '').length).toBeGreaterThan(0);
  });

  test('indicates when the daily cap is reached', async ({ page }) => {
    await clearStorage(page);
    await page.addInitScript({ content: buildXpClientStub({ cap: 60, award: 60, storageKey: '__xpProgressLowCap' }) });

    await page.goto(GAME_PAGE, { waitUntil: 'domcontentloaded' });
    await simulatePlayWindow(page, 15);
    await waitForAward(page, 1);
    const totals = await page.evaluate(() => window.__xpTestTotals);
    expect(totals.totalToday).toBeGreaterThanOrEqual(60);

    await openXpPage(page);

    const remainingValue = extractNumber(await page.textContent('#xpRemaining'));
    expect(remainingValue).toBeLessThanOrEqual(1);

    const todayEarned = extractNumber(await page.textContent('#xpTodayLine'));
    expect(todayEarned).toBeGreaterThanOrEqual(totals.cap || 0);

    const hintText = await page.textContent('#xpRemainingHint');
    expect((hintText || '').length).toBeGreaterThan(0);
  });
});
