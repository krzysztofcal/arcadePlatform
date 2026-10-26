import { readFile, writeFile, readdir } from 'node:fs/promises';
import { build } from 'esbuild';
import { parse } from 'acorn';
import { createHash } from 'node:crypto';

// Generated artifacts are checked in so normal Netlify builds need no extra setup.
// Replace only explicit function bodies; fail closed if renderer seams drift.
let renderer = await readFile('poker/poker-v2.js', 'utf8');
const replacements = {
  init: `
    selectElements();
    try {
    var offline = window.PokerOffline;
    var session = offline.read().session;
    if (!session) { window.location.replace('/poker/index.html'); return; }
    tableId = session.tableId;
    state = createEmptyLiveState(tableId, offline.human);
    state.wsReady = true; state.reconnectGate = false;
    socialPreferencesIdentity = 'offline-human';
    applyTableTheme(resolveTableThemeId(tableId));
    bindControls();
    bindMenu();
    startTurnClock();
    [els.menuLeave, els.rebuyLobbyBtn].forEach(function(el){ if (el) el.addEventListener('click', function(){ resetQueuedPreactionState(); renderControls(); }); });
    if (els.sceneViewport && window.ResizeObserver) new ResizeObserver(scheduleLayoutPresentationRefresh).observe(els.sceneViewport);
    window.addEventListener('resize', scheduleLayoutPresentationRefresh);
    markBootReady();
    offline.start(function(payload){
      var frame = {kind:'stateSnapshot', initial:!state.hasAppliedAuthoritativeSnapshot, cardFxEligible:!!state.hasAppliedAuthoritativeSnapshot};
      var previousVisual = captureVisualSnapshot(), previousHandId = state.handId;
      observeCelebrationSnapshot(payload, frame);
      mergeSnapshot(payload, frame);
      if (previousHandId && previousHandId !== state.handId) resetQueuedPreactionState();
      state.hasAppliedAuthoritativeSnapshot = true;
      if (offline.isActive()) maybeExecuteQueuedPreaction();
      state.statusText = 'OFFLINE · Offline Chips';
      render();
      var nextVisual = captureVisualSnapshot();
      animateChipDiff(previousVisual, nextVisual, frame);
      animateCardDiff(previousVisual, nextVisual, frame);
      [els.menuSignIn, els.joinBtn].forEach(function(el){ if(el) el.hidden = true; });
    }, handleTableReaction, function(){ resetQueuedPreactionState(); renderControls(); });
    } catch(error) { document.getElementById('offlineError').textContent = error.message; }
  `,
  bindDestinationLink: `if (link) link.addEventListener('click', function(event){ event.preventDefault(); closeMenu(); window.PokerOffline.backToLobby().catch(function(error){ setError(error.message); }); });`,
  isWsReady: 'return window.PokerOffline.isActive();',
  sendCommand: `if (methodName !== 'sendAct') return Promise.reject(new Error('Unavailable offline')); return window.PokerOffline.act({type:payload.action, amount:payload.amount, handId:payload.handId});`,
  leaveAndReturnToLobby: `return window.PokerOffline.leave().then(function(){ window.location.assign('/poker/index.html'); }).catch(function(error){setError(error.message);});`,
  requestManualRebuy: `return window.PokerOffline.rebuy().catch(function(error){setError(error.message);});`,
  sendReaction: `if (Date.now() < reactionControlUntilMs || !deriveCurrentSeat()) return Promise.resolve(); closeReactionMenu(); window.PokerOffline.reaction(reactionKey); startReactionCooldown(); return Promise.resolve({ok:true});`,
  sendTargetedReaction: `if (Date.now() < reactionControlUntilMs || !deriveCurrentSeat() || targetSeatNo === 1) return Promise.resolve(); window.PokerOffline.reaction('nice_hand', targetSeatNo); startReactionCooldown(); return Promise.resolve({ok:true});`,
  syncAccountHud: `if (els.accountHud) { var data = window.PokerOffline.read(); els.accountHud.hidden = false; els.accountHud.textContent = 'OFFLINE · ' + formatNumber(data.wallet) + ' Offline Chips'; els.accountHud.title = 'Device-local Offline Chips'; }`,
  refreshAccountHud: 'syncAccountHud();',
  renderRebuyPanel: `
    if (!els.rebuyPanel) return;
    var data = window.PokerOffline.read(), session = data.session;
    var show = !!session && session.state.phase === 'SETTLED' && session.state.stacks['offline-human'] < 2;
    els.rebuyPanel.hidden = !show;
    if (!show) return;
    if (els.rebuyTitle) els.rebuyTitle.textContent = 'Out of Offline Chips';
    if (els.rebuyCopy) els.rebuyCopy.textContent = 'Rebuy uses your Offline Chips. No automatic rebuy.';
    if (els.rebuyBalance) els.rebuyBalance.textContent = data.wallet + ' Offline Chips · Buy-in ' + session.buyIn;
    if (els.rebuyBtn) { els.rebuyBtn.disabled = data.wallet < session.buyIn - session.state.stacks['offline-human']; els.rebuyBtn.textContent = 'Rebuy'; }
    if (els.rebuyWatchBtn) els.rebuyWatchBtn.hidden = true;
    if (els.rebuyAccountLink) els.rebuyAccountLink.hidden = true;
  `,
  refreshRebuyBalance: 'return;',
  persistSocialPreferences: 'return;',
  klog: 'return;'
};
renderer = renderer.replace('Create account and get 500 CH Welcome Bonus', 'Poker Offline').replace(/ CH\b/g, ' Offline Chips');
const rebuyBack = "if (els.rebuyLobbyBtn) els.rebuyLobbyBtn.addEventListener('click', leaveAndReturnToLobby);";
if (!renderer.includes(rebuyBack)) throw new Error('Offline rebuy Back seam changed');
renderer = renderer.replace(rebuyBack, "if (els.rebuyLobbyBtn) els.rebuyLobbyBtn.addEventListener('click', function(){ openLeaveConfirm('/poker/index.html'); });");
const ast = parse(renderer, { ecmaVersion: 'latest' });
const edits = [];
function visit(node) {
  if (!node || typeof node !== 'object') return;
  if (node.type === 'FunctionDeclaration' && Object.hasOwn(replacements, node.id?.name)) {
    edits.push({ start: node.body.start + 1, end: node.body.end - 1, value: replacements[node.id.name], name: node.id.name });
  }
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') visit(value);
  }
}
visit(ast);
if (edits.length !== Object.keys(replacements).length) throw new Error('Offline renderer seams changed');
for (const edit of edits.sort((a,b) => b.start-a.start)) renderer = renderer.slice(0,edit.start) + edit.value + renderer.slice(edit.end);
await writeFile('poker/offline/renderer.generated.js', '// GENERATED from poker/poker-v2.js by scripts/build-poker-offline-poc.mjs; do not edit.\n' + renderer);
await build({ entryPoints: ['poker/offline/browser-entry.mjs'], outfile: 'poker/offline/game.generated.js', bundle: true, format: 'iife', platform: 'browser', target: 'es2020', define: { 'process.env.WS_POKER_TURN_MS': 'undefined' }, alias: { 'node:crypto': './poker/offline/browser-crypto.mjs' }, banner: { js: '// GENERATED from shared accepted WS rules and strategy. Do not edit.' } });

let html = await readFile('poker/table-v2.html','utf8');
html = html.replace('id="pokerLobbyLink" href="/poker/"', 'id="pokerLobbyLink" href="/poker/index.html"');
// This is a transformation of a checked-in source format, not an HTML sanitizer.
// Only single-line script elements are supported; reject any source-format drift.
html = html.split('\n').filter(line => !line.trimStart().startsWith('<script ')).join('\n');
if (/<script/i.test(html)) throw new Error('Unsupported script markup in V2 source');
html = html.split('\n').filter(line => !(line.trimStart().startsWith('<link ') && line.includes('https://'))).join('\n');
const scriptPaths = ['game.generated.js', 'renderer.generated.js'];
const scriptHashes = await Promise.all(scriptPaths.map(async name => 'sha256-' + createHash('sha256').update(await readFile('poker/offline/' + name)).digest('base64')));
// Scoped to this isolated page: also excludes Netlify's injected Preview toolbar.
const policy = "default-src 'none'; script-src " + scriptHashes.map(hash => "'" + hash + "'").join(' ') + "; style-src 'self' 'unsafe-inline'; img-src 'self' data:; base-uri 'self'; connect-src 'none'; frame-src 'none'; form-action 'none'";
html = html.replace('<head>', '<head><meta http-equiv="Content-Security-Policy" content="' + policy + '"><base href="/poker/">');
const chips = await readdir('poker/assets/chips');
html = html.replace('</head>', chips.filter(name => /\.(png|webp|svg)$/.test(name)).map(name => '<link rel="preload" as="image" href="/poker/assets/chips/' + name + '">').join('') + '</head>');
html = html.replace('</head>', '<link rel="stylesheet" href="/poker/offline/offline.css"></head>');
// Local controls live inside the shared menu, never before the 100dvh table.
html = html.replace('<nav class="poker-menu-panel" id="pokerMenuPanel" hidden>', '<nav class="poker-menu-panel" id="pokerMenuPanel" hidden><section id="offlineSessionControls" class="offline-session" aria-label="Local offline session"><strong data-offline-balance></strong><button id="offlineRebuy" class="poker-menu-action" type="button">Rebuy</button><p id="offlineError" role="alert"></p></section>');
html = html.replace('id="pokerV2RebuyLobbyBtn">Return to lobby', 'id="pokerV2RebuyLobbyBtn">Leave');
const lobbyHtml = await readFile('poker/index.html','utf8');
const confirmation = lobbyHtml.split('<!-- offline-confirm:start -->')[1]?.split('<!-- offline-confirm:end -->')[0];
if (!confirmation) throw new Error('Offline confirmation source missing');
html = html.replace('</body>', confirmation + '</body>');
html = html.replace('</head>', scriptPaths.map((name, i) => '<script src="/poker/offline/' + name + '" integrity="' + scriptHashes[i] + '" defer></script>').join('\n') + '</head>');
html = html.replace('Practice poker', 'Poker Offline').replace('Create an account to unlock 500 CH, multiplayer, XP and persistent chips.', 'Offline Chips stay on this device.').replace(/ CH\b/g, ' Offline Chips');
html = html.replace('Poker Table v2 - Arcade Hub', 'Poker Offline — Offline Chips');
html = html.replace('aria-label="Close table settings">×</button></div>', 'aria-label="Close table settings">×</button></div><p class="poker-social-settings__hint">Offline Chips and your game are saved on this device, independently of online CH. Clearing app data removes Offline progress.</p><button id="offlineReset" class="poker-menu-action" type="button">Reset Offline Progress</button>');
await writeFile('poker/offline/play.html', '<!-- GENERATED from poker/table-v2.html; isolated local session -->\n' + html.replace(/[ \t]+$/gm, ''));
