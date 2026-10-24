import { readFile, writeFile, readdir } from 'node:fs/promises';
import { build } from 'esbuild';
import { parse } from 'acorn';

// Generated artifacts are checked in so normal Netlify builds need no extra setup.
// Replace only explicit function bodies; fail closed if renderer seams drift.
let renderer = await readFile('poker/poker-v2.js', 'utf8');
const replacements = {
  init: `
    selectElements();
    tableId = window.PokerOfflinePoc.tableId;
    state = createEmptyLiveState(tableId, window.PokerOfflinePoc.human);
    state.wsReady = true; state.reconnectGate = false;
    applyTableTheme(resolveTableThemeId(tableId));
    bindControls();
    if (els.sceneViewport && window.ResizeObserver) new ResizeObserver(scheduleLayoutPresentationRefresh).observe(els.sceneViewport);
    window.addEventListener('resize', scheduleLayoutPresentationRefresh);
    markBootReady();
    window.PokerOfflinePoc.start(function(payload){
      mergeSnapshot(payload, {kind:'stateSnapshot', initial:false});
      state.hasAppliedAuthoritativeSnapshot = true;
      state.statusText = 'OFFLINE PoC · Practice Chips · one hand';
      render();
      [els.menuToggle, els.reactionBtn, els.accountHud, els.rebuyPanel, els.menuSignIn, els.joinBtn].forEach(function(el){ if(el) el.hidden = true; });
    }).catch(function(error){ setError(error.message); render(); });
  `,
  isWsReady: 'return true;',
  sendCommand: `if (methodName !== 'sendAct') return Promise.reject(new Error('Unavailable in one-hand Offline PoC')); return window.PokerOfflinePoc.act({type:payload.action, amount:payload.amount});`,
  refreshAccountHud: 'return;',
  klog: 'return;'
};
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
let html = await readFile('poker/table-v2.html','utf8');
html = html.replace(/\s*<script\b[^>]*>[\s\S]*?<\/script>/g, '').replace(/\s*<link\b[^>]*https:\/\/[^>]*>/g,'');
html = html.replace('<head>', '<head><base href="/poker/">');
const chips = await readdir('poker/assets/chips');
html = html.replace('</head>', chips.filter(name => /\.(png|webp|svg)$/.test(name)).map(name => '<link rel="preload" as="image" href="/poker/assets/chips/' + name + '">').join('') + '</head>');
html = html.replace('</head>', '<style>#pokerMenuToggle,#pokerGiftShopButton,#pokerV2ReactionBtn,#pokerReactionHistoryToggle,.poker-quick-gift-button,.poker-quick-gift-picker,.poker-seat-gift-button,.poker-seat-gift-trigger,[data-gift-target-seat]{display:none!important}#offlinePocLabel{position:fixed;top:10px;left:60px;z-index:90;background:#121c2a;color:#fff;padding:8px;border-radius:8px}</style></head>');
html = html.replace('<body>', '<body><div id="offlinePocLabel">OFFLINE PoC · Practice Chips · one hand</div>');
html = html.replace('</head>', '  <script src="/poker/offline/game.generated.js" defer></script>\n  <script src="/poker/offline/renderer.generated.js" defer></script>\n</head>');
html = html.replace('Poker Table v2 - Arcade Hub', 'OFFLINE PoC — Practice Chips');
await writeFile('poker/offline/poc.html', '<!-- GENERATED from poker/table-v2.html; T002 only -->\n' + html);
await build({ entryPoints: ['poker/offline/offline-game.mjs'], outfile: 'poker/offline/game.generated.js', bundle: true, format: 'iife', platform: 'browser', target: 'es2020', define: { 'process.env.WS_POKER_TURN_MS': 'undefined' }, alias: { 'node:crypto': './poker/offline/browser-crypto.mjs' }, banner: { js: '// GENERATED from shared accepted WS rules and strategy. Do not edit.' } });
