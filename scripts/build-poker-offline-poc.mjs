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
    if (!session) { window.location.replace('/poker/'); return; }
    tableId = session.tableId;
    state = createEmptyLiveState(tableId, offline.human);
    state.wsReady = true; state.reconnectGate = false;
    socialPreferencesIdentity = 'offline-human';
    applyTableTheme(resolveTableThemeId(tableId));
    bindControls();
    if (els.sceneViewport && window.ResizeObserver) new ResizeObserver(scheduleLayoutPresentationRefresh).observe(els.sceneViewport);
    window.addEventListener('resize', scheduleLayoutPresentationRefresh);
    markBootReady();
    offline.start(function(payload){
      var frame = {kind:'stateSnapshot', initial:!state.hasAppliedAuthoritativeSnapshot, cardFxEligible:!!state.hasAppliedAuthoritativeSnapshot};
      var previousVisual = captureVisualSnapshot();
      observeCelebrationSnapshot(payload, frame);
      mergeSnapshot(payload, frame);
      state.hasAppliedAuthoritativeSnapshot = true;
      state.statusText = 'OFFLINE · Practice Chips';
      render();
      var nextVisual = captureVisualSnapshot();
      animateChipDiff(previousVisual, nextVisual, frame);
      animateCardDiff(previousVisual, nextVisual, frame);
      [els.accountHud, els.rebuyPanel, els.menuSignIn, els.joinBtn].forEach(function(el){ if(el) el.hidden = true; });
    }, handleTableReaction);
    } catch(error) { document.getElementById('offlineError').textContent = error.message; }
  `,
  isWsReady: 'return true;',
  sendCommand: `if (methodName !== 'sendAct') return Promise.reject(new Error('Unavailable offline')); return window.PokerOffline.act({type:payload.action, amount:payload.amount});`,
  leaveAndReturnToLobby: `return window.PokerOffline.leave().then(function(){ window.location.assign('/poker/'); }).catch(function(error){setError(error.message);});`,
  requestManualRebuy: `return window.PokerOffline.rebuy().catch(function(error){setError(error.message);});`,
  sendReaction: `if (Date.now() < reactionControlUntilMs || !deriveCurrentSeat()) return Promise.resolve(); closeReactionMenu(); window.PokerOffline.reaction(reactionKey); startReactionCooldown(); return Promise.resolve({ok:true});`,
  sendTargetedReaction: `if (Date.now() < reactionControlUntilMs || !deriveCurrentSeat() || targetSeatNo === 1) return Promise.resolve(); window.PokerOffline.reaction('nice_hand', targetSeatNo); startReactionCooldown(); return Promise.resolve({ok:true});`,
  refreshAccountHud: 'return;',
  refreshRebuyBalance: 'return;',
  persistSocialPreferences: 'return;',
  klog: 'return;'
};
renderer = renderer.replace(/ CH\b/g, ' PC').replace('Hand complete · Next hand shortly', 'Hand complete · Next hand when ready');
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
// Keep manual actions; local session serialization does not emulate WS preactions.
html = html.replace(/<label\b[^>]*id="pokerV2(?:Fold|Primary|Amount|AllIn)PreactionWrap"[^>]*>[\s\S]*?<\/label>/g, '');
const chips = await readdir('poker/assets/chips');
html = html.replace('</head>', chips.filter(name => /\.(png|webp|svg)$/.test(name)).map(name => '<link rel="preload" as="image" href="/poker/assets/chips/' + name + '">').join('') + '</head>');
html = html.replace('</head>', '<link rel="stylesheet" href="/poker/offline/offline.css"></head>');
html = html.replace('<body>', '<body><section id="offlineSessionControls" class="offline-session" aria-label="Local practice session"><strong>OFFLINE · <span data-practice-balance></span></strong><button id="offlineNext" type="button">Next hand</button><button id="offlineRebuy" type="button">Rebuy</button><button id="offlineRefill" type="button">Free refill</button><button id="offlineLeave" type="button">Leave</button><p id="offlineError" role="alert"></p></section>');
html = html.replace('</head>', scriptPaths.map((name, i) => '<script src="/poker/offline/' + name + '" integrity="' + scriptHashes[i] + '" defer></script>').join('\n') + '</head>');
html = html.replace(/ CH\b/g, ' PC');
html = html.replace('Poker Table v2 - Arcade Hub', 'Poker Offline — Practice Chips');
await writeFile('poker/offline/play.html', '<!-- GENERATED from poker/table-v2.html; isolated local session -->\n' + html.replace(/[ \t]+$/gm, ''));
