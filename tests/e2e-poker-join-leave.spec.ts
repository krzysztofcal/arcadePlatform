import { test, expect } from '@playwright/test';

const makeBase64Url = (value: string) =>
  Buffer.from(value)
    .toString('base64')
    .replace(/=+$/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

const buildJwt = (userId: string) => {
  const header = makeBase64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = makeBase64Url(
    JSON.stringify({ sub: userId, exp: Math.floor(Date.now() / 1000) + 3600 })
  );
  return `${header}.${payload}.signature`;
};

test('poker: can join and leave table (no pointerevent requestId)', async ({ page }) => {
  const userId = 'user-12345678-90ab-cdef-1234-567890abcdef';
  const shortUserId = userId.substring(0, 8);
  const tableId = '11111111-1111-4111-8111-111111111111';
  const token = buildJwt(userId);

  const tableState = {
    joined: false,
    seatNo: 0,
    buyIn: 100,
    version: 1,
  };

  const buildTablePayload = () => ({
    table: {
      id: tableId,
      stakes: { sb: 1, bb: 2 },
      status: 'OPEN',
      maxPlayers: 6,
    },
    seats: tableState.joined
      ? [{ seatNo: tableState.seatNo, userId, status: 'ACTIVE' }]
      : [],
    state: {
      version: tableState.version,
      state: {
        stacks: tableState.joined ? { [userId]: tableState.buyIn } : {},
        pot: 0,
        phase: 'PREFLOP',
      },
    },
  });

  const buildListPayload = () => ({
    tables: [
      {
        id: tableId,
        stakes: { sb: 1, bb: 2 },
        maxPlayers: 6,
        seatCount: tableState.joined ? 1 : 0,
        status: 'OPEN',
      },
    ],
  });

  await page.addInitScript((tokenValue) => {
    window.SupabaseAuthBridge = window.SupabaseAuthBridge || {};
    try {
      Object.defineProperty(window.SupabaseAuthBridge, 'getAccessToken', {
        value: () => Promise.resolve(tokenValue),
        configurable: false,
        writable: false,
      });
    } catch (_err) {
      window.SupabaseAuthBridge.getAccessToken = () => Promise.resolve(tokenValue);
    }
  }, token);

  await page.route('**/.netlify/functions/poker-*', async (route, request) => {
    const url = new URL(request.url());
    const pathname = url.pathname;

    if (pathname.endsWith('/poker-list-tables') && request.method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(buildListPayload()),
      });
      return;
    }

    if (pathname.endsWith('/poker-create-table') && request.method() === 'POST') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ tableId }),
      });
      return;
    }

    if (pathname.endsWith('/poker-get-table') && request.method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(buildTablePayload()),
      });
      return;
    }

    if (pathname.endsWith('/poker-join') && request.method() === 'POST') {
      const payload = request.postData() ? JSON.parse(request.postData() as string) : {};
      tableState.joined = true;
      tableState.seatNo = Number.isFinite(payload?.seatNo) ? payload.seatNo : 0;
      tableState.buyIn = Number.isFinite(payload?.buyIn) ? payload.buyIn : 100;
      tableState.version += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      });
      return;
    }

    if (pathname.endsWith('/poker-leave') && request.method() === 'POST') {
      tableState.joined = false;
      tableState.version += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      });
      return;
    }

    if (pathname.endsWith('/poker-heartbeat') && request.method() === 'POST') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      });
      return;
    }

    await route.fallback();
  });

  await page.goto('/poker/');
  await expect(page.locator('#pokerLobbyContent')).toBeVisible();

  await Promise.all([
    page.waitForURL('**/poker/table.html?tableId=*'),
    page.locator('#pokerCreate').click(),
  ]);

  await expect(page.locator('#pokerTableContent')).toBeVisible();

  await page.locator('#pokerSeatNo').fill('0');
  await page.locator('#pokerBuyIn').fill('100');

  const joinRequestPromise = page.waitForRequest(
    (req) => req.url().includes('/.netlify/functions/poker-join') && req.method() === 'POST',
    { timeout: 20000 }
  );
  const joinResponsePromise = page.waitForResponse(
    (res) => res.url().includes('/.netlify/functions/poker-join') && res.request().method() === 'POST',
    { timeout: 20000 }
  );

  await page.locator('#pokerJoin').click();

  const joinRequest = await joinRequestPromise;
  const joinResponse = await joinResponsePromise;
  expect(joinResponse.status()).toBe(200);

  const joinPayload = joinRequest.postData() ? JSON.parse(joinRequest.postData() as string) : {};
  const joinRequestId = joinPayload.requestId;
  expect(typeof joinRequestId, 'join requestId should be a string').toBe('string');
  expect(joinRequestId, 'join requestId should be non-empty').toBeTruthy();
  expect(joinRequestId, 'join requestId should not be a pointer event').not.toBe('[object PointerEvent]');
  expect(joinRequestId.length, 'join requestId should be <= 200 chars').toBeLessThanOrEqual(200);

  const seat = page.locator('#pokerSeatsGrid .poker-seat').first();
  const seatUser = page.locator('#pokerSeatsGrid .poker-seat-user').first();

  await expect(seatUser).toContainText(shortUserId, { timeout: 20000 });
  await expect
    .poll(async () => (await seat.getAttribute('class')) || '', { timeout: 20000 })
    .not.toContain('poker-seat--empty');

  await expect(page.locator('#pokerYourStack')).toHaveText('100', { timeout: 20000 });

  await expect(async () => {
    const jsonText = await page.locator('#pokerJsonBox').textContent();
    const state = JSON.parse(jsonText || '{}');
    expect(state?.stacks?.[userId]).toBe(100);
  }).toPass({ timeout: 20000 });

  const leaveRequestPromise = page.waitForRequest(
    (req) => req.url().includes('/.netlify/functions/poker-leave') && req.method() === 'POST',
    { timeout: 20000 }
  );
  const leaveResponsePromise = page.waitForResponse(
    (res) => res.url().includes('/.netlify/functions/poker-leave') && res.request().method() === 'POST',
    { timeout: 20000 }
  );

  await page.locator('#pokerLeave').click();

  const leaveRequest = await leaveRequestPromise;
  const leaveResponse = await leaveResponsePromise;
  expect(leaveResponse.status()).toBe(200);

  const leavePayload = leaveRequest.postData() ? JSON.parse(leaveRequest.postData() as string) : {};
  const leaveRequestId = leavePayload.requestId;
  expect(typeof leaveRequestId, 'leave requestId should be a string').toBe('string');
  expect(leaveRequestId, 'leave requestId should be non-empty').toBeTruthy();
  expect(leaveRequestId, 'leave requestId should not be a pointer event').not.toBe('[object PointerEvent]');
  expect(leaveRequestId.length, 'leave requestId should be <= 200 chars').toBeLessThanOrEqual(200);

  await expect
    .poll(async () => (await seat.getAttribute('class')) || '', { timeout: 20000 })
    .toContain('poker-seat--empty');

  await expect(page.locator('#pokerYourStack')).toHaveText('-', { timeout: 20000 });

  await expect(async () => {
    const jsonText = await page.locator('#pokerJsonBox').textContent();
    const state = JSON.parse(jsonText || '{}');
    expect(state?.stacks?.[userId]).toBeUndefined();
  }).toPass({ timeout: 20000 });
});
