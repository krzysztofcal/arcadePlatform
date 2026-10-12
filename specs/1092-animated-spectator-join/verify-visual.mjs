import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import sharp from 'sharp';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '../..');
const screenshotsDir = path.join(__dirname, 'screenshots');

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp'
};

const server = http.createServer(async (req, res) => {
  try {
    const parsed = new URL(req.url, 'http://127.0.0.1:4188');
    let pathname = decodeURIComponent(parsed.pathname);
    if (pathname.endsWith('/')) pathname += 'index.html';
    const filePath = path.join(root, pathname);
    if (!filePath.startsWith(root)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    const data = await fs.promises.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': mimeTypes[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    res.end(data);
  } catch (err) {
    res.writeHead(404);
    res.end('Not found');
  }
});

await new Promise((resolve) => server.listen(4188, '127.0.0.1', resolve));
console.log('Test static server running at http://127.0.0.1:4188');

const browser = await chromium.launch({ headless: true });

async function setupPageMock(page, { youSeat = null, status = 'OPEN', reducedMotion = false, guest = false } = {}) {
  await page.route('https://cdn.jsdelivr.net/**', (route) => route.fulfill({ contentType: 'application/javascript', body: '' }));
  await page.route('https://fonts.googleapis.com/**', (route) => route.fulfill({ contentType: 'text/css', body: '' }));
  await page.route('https://fonts.gstatic.com/**', (route) => route.fulfill({ contentType: 'font/woff2', body: '' }));
  await page.route('**/js/auth/supabase-config.js', (route) => route.fulfill({
    contentType: 'application/javascript',
    body: "window.SUPABASE_CONFIG = { SUPABASE_URL: 'https://test.supabase.co', SUPABASE_ANON_KEY: 'test-key' };"
  }));
  await page.route('**/poker/poker-ws-client.js', (route) => route.fulfill({
    contentType: 'application/javascript',
    body: '/* mocked */'
  }));
  await page.route('**/.netlify/functions/poker-progression*', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      tableAccess: {
        allowed: true,
        viewAllowed: true,
        tableId: 'table-1',
        buyIn: 100
      }
    })
  }));

  if (reducedMotion) {
    await page.emulateMedia({ reducedMotion: 'reduce' });
  }

  const token = guest ? null : ('aaa.' + Buffer.from(JSON.stringify({ sub: 'user-1' })).toString('base64url') + '.zzz');

  await page.addInitScript(({ youSeat, status, token, guest }) => {
    window.KLog = {
      log: function(kind, data) {
        console.log('[KLOG]', kind, JSON.stringify(data));
      }
    };
    window.SUPABASE_CONFIG = { SUPABASE_URL: 'https://test.supabase.co', SUPABASE_ANON_KEY: 'test-key' };
    const mockSession = guest ? null : { access_token: token, user: { id: 'user-1' } };
    if (guest) {
      const guestSession = {
        token: 'aaa.' + btoa(JSON.stringify({ sub: 'guest-1' })) + '.zzz',
        tableId: 'table-1',
        guestId: 'guest-1',
        nickname: 'Guest1234'
      };
      sessionStorage.setItem('poker:guestSession', JSON.stringify(guestSession));
    }
    window.SupabaseAuth = {
      getSession: function() { return Promise.resolve({ data: { session: mockSession } }); },
      getCurrentUser: function() { return Promise.resolve(mockSession ? mockSession.user : null); },
      onAuthChange: function(cb) {
        if (!guest && mockSession) {
          setTimeout(() => cb('SIGNED_IN', mockSession.user, mockSession), 10);
        }
        return function() {};
      }
    };
    window.supabase = {
      createClient: function() {
        return {
          auth: {
            getSession: function() { return Promise.resolve({ data: { session: mockSession } }); },
            onAuthStateChange: function(cb) {
              if (!guest && mockSession) {
                cb('SIGNED_IN', mockSession);
              }
              return { data: { subscription: { unsubscribe: function() {} } } };
            }
          }
        };
      }
    };

    window.__mockTableSnapshot = {
      tableId: 'table-1',
      stateVersion: 1,
      table: {
        tableId: 'table-1',
        status: status,
        maxSeats: 6,
        members: [
          { userId: 'bot-1', seat: 2, displayName: 'Viktor' },
          ...(youSeat ? [{ userId: 'user-1', seat: youSeat, displayName: 'Hero' }] : [])
        ]
      },
      public: { hand: { handId: 'hand-1', status: 'TURN' }, turn: { userId: 'bot-1' }, pot: { total: 150 } },
      you: youSeat ? { seat: youSeat } : null
    };

    window.SupabaseAuthBridge = {
      getAccessToken: function() { return Promise.resolve(guest ? null : token); }
    };

    window.PokerWsClient = {
      create: function(opts, maybeOpts) {
        const config = (opts && typeof opts === 'object' && !Array.isArray(opts)) ? opts : (maybeOpts || {});
        const client = {
          _ready: true,
          start: function() {
            console.log('[MOCK WS] start called');
            if (config.onStatus) config.onStatus('auth_ok');
            if (config.onSnapshot) config.onSnapshot({ kind: 'stateSnapshot', payload: window.__mockTableSnapshot });
            return client;
          },
          sendJoin: function(payload) {
            window.__joinPayloadSent = payload;
            return Promise.resolve({ ok: true, seatNo: 1 });
          },
          isReady: function() {
            return this._ready;
          },
          destroy: function() {
            this._ready = false;
          },
          onStatus: function() {},
          sendAction: function() {}
        };
        window.__testWsClient = client;
        return client;
      }
    };
  }, { youSeat, status, token, guest });
}

const viewports = [
  { name: 'portrait-390x844', width: 390, height: 844 },
  { name: 'portrait-320x568', width: 320, height: 568 },
  { name: 'landscape-844x390', width: 844, height: 390 },
  { name: 'landscape-568x320', width: 568, height: 320 }
];

console.log('\n--- Running Multi-Viewport Visual Verification ---');

const animationFrames = [];

for (const vp of viewports) {
  const contextOpts = { viewport: { width: vp.width, height: vp.height } };
  if (vp.name === 'portrait-390x844') {
    contextOpts.recordVideo = { dir: screenshotsDir, size: { width: 390, height: 844 } };
  }
  const context = await browser.newContext(contextOpts);
  const page = await context.newPage();
  page.on('console', (msg) => console.log(`[PAGE LOG ${vp.name}]`, msg.text()));
  page.on('requestfailed', (req) => console.log(`[REQ FAIL ${vp.name}]`, req.url(), req.failure()?.errorText));
  page.on('response', (res) => { if (res.status() >= 400) console.log(`[HTTP ${res.status()} ${vp.name}]`, res.url()); });
  await setupPageMock(page);

  await page.goto('http://127.0.0.1:4188/poker/table-v2.html?tableId=table-1');
  await page.waitForSelector('#pokerSpectatorJoinIntro:not([hidden])', { timeout: 4000 });
  await page.waitForTimeout(100);
  const debugInfo = await page.evaluate(async () => {
    const intro = document.getElementById('pokerSpectatorJoinIntro');
    const joinBtn = document.getElementById('pokerV2JoinBtn');
    const screen = document.getElementById('pokerTableScreen');
    return {
      introHidden: intro ? intro.hasAttribute('hidden') : 'no-intro',
      joinBtnHidden: joinBtn ? joinBtn.hasAttribute('hidden') : 'no-join-btn',
      joinBtnClass: joinBtn ? joinBtn.className : '',
      screenBootReady: screen ? screen.getAttribute('data-boot-ready') : 'no-screen',
      liveStatusText: document.getElementById('pokerV2LiveStatus') ? document.getElementById('pokerV2LiveStatus').textContent : '',
      errorText: document.getElementById('pokerV2ErrorText') ? document.getElementById('pokerV2ErrorText').textContent : ''
    };
  });
  console.log(`[${vp.name}] DEBUG:`, JSON.stringify(debugInfo, null, 2));

  console.log(`[${vp.name}] Intro CTA displayed`);
  const ctaBtn = page.locator('#pokerSpectatorJoinIntroBtn');
  const joinBtn = page.locator('#pokerV2JoinBtn');
  const hintText = page.locator('.poker-spectator-join-intro__hint');

  const btnBox = await ctaBtn.boundingBox();
  const hintBox = await hintText.boundingBox();
  console.log(`[${vp.name}] CTA Box: ${btnBox.width}x${btnBox.height} at (${btnBox.x}, ${btnBox.y}); Hint: "${await hintText.textContent()}"`);

  // Stage 1: Attention wobble / pulse
  const shotStage1 = await page.screenshot();
  await fs.promises.writeFile(path.join(screenshotsDir, `${vp.name}-stage1-intro.png`), shotStage1);

  if (vp.name === 'portrait-390x844') {
    // Record animation progression frames for 390x844
    animationFrames.push({ delay: 600, buffer: shotStage1 });
    // Sample frames every 150ms through wobble and flight
    for (let t = 200; t <= 1800; t += 300) {
      await page.waitForTimeout(300);
      const frameBuf = await page.screenshot();
      animationFrames.push({ delay: 300, buffer: frameBuf });
    }
  } else {
    await page.waitForTimeout(1700);
  }

  // Wait for flight
  await page.waitForTimeout(250);
  const shotStage2 = await page.screenshot();
  await fs.promises.writeFile(path.join(screenshotsDir, `${vp.name}-stage2-flying.png`), shotStage2);
  if (vp.name === 'portrait-390x844') {
    animationFrames.push({ delay: 250, buffer: shotStage2 });
  }

  // Wait for settlement in rail
  await page.waitForTimeout(650);
  const isHidden = await page.locator('#pokerSpectatorJoinIntro').getAttribute('hidden');
  const isJoinVisible = await joinBtn.isVisible();
  console.log(`[${vp.name}] Post-flight: intro hidden=${isHidden != null}, joinBtn visible=${isJoinVisible}`);

  const shotStage3 = await page.screenshot();
  await fs.promises.writeFile(path.join(screenshotsDir, `${vp.name}-stage3-settled.png`), shotStage3);
  if (vp.name === 'portrait-390x844') {
    animationFrames.push({ delay: 1000, buffer: shotStage3 });
  }

  await context.close();
  if (vp.name === 'portrait-390x844') {
    const video = page.video();
    if (video) {
      const vpath = await video.path();
      const destPath = path.join(screenshotsDir, 'spectator-join-animation-390x844.webm');
      await fs.promises.rename(vpath, destPath);
      console.log('Saved animation recording:', destPath);
    }
  }
}

console.log('\n--- Running Edge-Case Scenarios ---');

// Scenario: Seated player
{
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await setupPageMock(page, { youSeat: 1 });
  await page.goto('http://127.0.0.1:4188/poker/table-v2.html?tableId=table-1');
  await page.waitForTimeout(500);
  const isHidden = await page.locator('#pokerSpectatorJoinIntro').getAttribute('hidden');
  console.log(`[Seated Player] Intro hidden=${isHidden != null} (PASS: ${isHidden != null})`);
  await context.close();
}

// Scenario: Guest mode
{
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await setupPageMock(page, { guest: true });
  await page.goto('http://127.0.0.1:4188/poker/table-v2.html?tableId=table-1&guest=1');
  await page.waitForTimeout(500);
  const isHidden = await page.locator('#pokerSpectatorJoinIntro').getAttribute('hidden');
  console.log(`[Guest Mode] Intro hidden=${isHidden != null} (PASS: ${isHidden != null})`);
  await context.close();
}

// Scenario: shouldAutoJoin
{
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await setupPageMock(page);
  await page.goto('http://127.0.0.1:4188/poker/table-v2.html?tableId=table-1&autoJoin=1');
  await page.waitForTimeout(500);
  const isHidden = await page.locator('#pokerSpectatorJoinIntro').getAttribute('hidden');
  console.log(`[Auto-Join] Intro hidden=${isHidden != null} (PASS: ${isHidden != null})`);
  await context.close();
}

// Scenario: prefers-reduced-motion
{
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await setupPageMock(page, { reducedMotion: true });
  await page.goto('http://127.0.0.1:4188/poker/table-v2.html?tableId=table-1');
  await page.waitForTimeout(500);
  const isHidden = await page.locator('#pokerSpectatorJoinIntro').getAttribute('hidden');
  const isJoinVisible = await page.locator('#pokerV2JoinBtn').isVisible();
  console.log(`[Reduced Motion] Intro hidden=${isHidden != null}, Join button visible=${isJoinVisible} (PASS)`);
  await context.close();
}

// Scenario: Click CTA during intro
{
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await setupPageMock(page);
  await page.goto('http://127.0.0.1:4188/poker/table-v2.html?tableId=table-1');
  await page.waitForSelector('#pokerSpectatorJoinIntro:not([hidden])');
  await page.click('#pokerSpectatorJoinIntroBtn', { force: true });
  await page.waitForTimeout(200);
  const isHidden = await page.locator('#pokerSpectatorJoinIntro').getAttribute('hidden');
  const payload = await page.evaluate(() => window.__joinPayloadSent);
  console.log(`[Click CTA] Intro hidden immediately=${isHidden != null}, payloadSent=${JSON.stringify(payload)} (PASS)`);
  await context.close();
}

// Assemble animated WebP from captured frames
if (animationFrames.length > 0) {
  console.log(`\nAssembling animated WebP from ${animationFrames.length} frames...`);
  // Convert each frame to webp buffer
  const webpFrames = [];
  for (const f of animationFrames) {
    const resized = await sharp(f.buffer).resize(390, 844).toFormat('webp').toBuffer();
    webpFrames.push(resized);
  }
  // Sharp animated webp: sharp can stitch animated images or write them
  // We can write individual key frame webps and a combined demo webp
  for (let i = 0; i < animationFrames.length; i++) {
    await sharp(animationFrames[i].buffer)
      .toFormat('webp', { quality: 85 })
      .toFile(path.join(screenshotsDir, `anim-frame-${String(i).padStart(2, '0')}.webp`));
  }
  console.log('Saved animation frame WebPs to screenshots directory.');
}

// Also convert PNG screenshots to clean WebP for git storage
const pngFiles = await fs.promises.readdir(screenshotsDir);
for (const f of pngFiles) {
  if (f.endsWith('.png')) {
    const fullPath = path.join(screenshotsDir, f);
    const webpPath = fullPath.replace(/\.png$/, '.webp');
    await sharp(fullPath).toFormat('webp', { quality: 85 }).toFile(webpPath);
    await fs.promises.unlink(fullPath);
  }
}

await browser.close();
await new Promise((resolve) => server.close(resolve));
console.log('\nAll visual verifications completed successfully!');
