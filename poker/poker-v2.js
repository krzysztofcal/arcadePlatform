(function(){
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  var SUIT_SYMBOLS = { S: '♠', H: '♥', D: '♦', C: '♣' };
  var HAND_CATEGORY = {
    HIGH_CARD: 1,
    PAIR: 2,
    TWO_PAIR: 3,
    TRIPS: 4,
    STRAIGHT: 5,
    FLUSH: 6,
    FULL_HOUSE: 7,
    QUADS: 8,
    STRAIGHT_FLUSH: 9
  };
  var POKER_AVATAR_VARIANTS = {
    'default': true,
    'comet-blue': true,
    'falcon-orange': true,
    'fox-blue': true,
    'nova-purple': true,
    'orbit-green': true,
    'panda-pink': true
  };
  var BOT_AVATAR_BASE_PATH = '/poker/assets/avatars/bots/';
  var BOT_PRESENTATION_ENTRIES = [
    { key: 'viktor', displayName: 'Viktor', gender: 'male', file: 'bot-male-01-v1.webp' },
    { key: 'sofia', displayName: 'Sofia', gender: 'female', file: 'bot-female-01-v1.webp' },
    { key: 'marco', displayName: 'Marco', gender: 'male', file: 'bot-male-02-v1.webp' },
    { key: 'carmen', displayName: 'Carmen', gender: 'female', file: 'bot-female-02-v1.webp' },
    { key: 'luca', displayName: 'Luca', gender: 'male', file: 'bot-male-03-v1.webp' },
    { key: 'elena', displayName: 'Elena', gender: 'female', file: 'bot-female-03-v1.webp' },
    { key: 'dante', displayName: 'Dante', gender: 'male', file: 'bot-male-04-v1.webp' },
    { key: 'freya', displayName: 'Freya', gender: 'female', file: 'bot-female-04-v1.webp' },
    { key: 'ragnar', displayName: 'Ragnar', gender: 'male', file: 'bot-male-05-v1.webp' },
    { key: 'astrid', displayName: 'Astrid', gender: 'female', file: 'bot-female-05-v1.webp' },
    { key: 'leon', displayName: 'Leon', gender: 'male', file: 'bot-male-06-v1.webp' },
    { key: 'maya', displayName: 'Maya', gender: 'female', file: 'bot-female-06-v1.webp' },
    { key: 'malik', displayName: 'Malik', gender: 'male', file: 'bot-male-07-v1.webp' },
    { key: 'helena', displayName: 'Helena', gender: 'female', file: 'bot-female-07-v1.webp' },
    { key: 'nico', displayName: 'Nico', gender: 'male', file: 'bot-male-08-v1.webp' },
    { key: 'nadia', displayName: 'Nadia', gender: 'female', file: 'bot-female-08-v1.webp' },
    { key: 'adrian', displayName: 'Adrian', gender: 'male', file: 'bot-male-09-v1.webp' },
    { key: 'zara', displayName: 'Zara', gender: 'female', file: 'bot-female-09-v1.webp' }
  ];
  var BOT_PRESENTATIONS = normalizeBotPresentationCatalog(BOT_PRESENTATION_ENTRIES);
  var LIVE_STATUS_COPY = {
    demo: 'Demo mode',
    connecting: 'Connecting…',
    auth: 'Sign in to join this table',
    live: 'Live table connected',
    disconnected: 'Live connection closed',
    error: 'Live table unavailable'
  };
  var CLOSED_TABLE_REDIRECT_SECONDS = 5;
  var WINNER_REVEAL_MS = 4_000;
  var CHIP_FLY_MS = 420;
  var SETTLEMENT_CHIP_FLY_MS = 780;
  var AUTO_JOIN_RETRY_DELAYS_MS = [250, 750, 1500, 3000];
  var CHIP_DENOMINATIONS = [
    { value: 1000, color: 'yellow' },
    { value: 500, color: 'purple' },
    { value: 100, color: 'black' },
    { value: 25, color: 'green' },
    { value: 10, color: 'blue' },
    { value: 5, color: 'red' },
    { value: 1, color: 'white' }
  ];
  var CHIP_ASSET_COLORS = {
    white: true,
    red: true,
    blue: true,
    green: true,
    black: true,
    purple: true,
    yellow: true
  };
  var CHIP_STACK_MAX_HEIGHT = 5;
  var HERO_SEAT_STACK_VISUAL = { width: 112, height: 82, scale: 0.62 };
  var LAST_ACTION_LABEL = {
    fold: 'Fold',
    check: 'Check',
    call: 'Call',
    raise: 'Raise',
    all_in: 'All in'
  };
  var seatAnchors = [
    { x: 50, y: 10 },
    { x: 86, y: 28 },
    { x: 84, y: 67 },
    { x: 50, y: 92 },
    { x: 16, y: 67 },
    { x: 14, y: 28 }
  ];
  var demoState = {
    mode: 'demo',
    tableId: null,
    tableStatus: 'OPEN',
    maxSeats: 6,
    seats: [
      { seatNo: 0, userId: 'victor', displayName: 'Victor', status: 'WAITING' },
      { seatNo: 1, userId: 'marcus', displayName: 'Marcus', status: 'THINKING' },
      { seatNo: 2, userId: 'elena', displayName: 'Elena', status: 'READY' },
      { seatNo: 3, userId: 'hero', displayName: 'You', status: 'ACTIVE' },
      { seatNo: 4, userId: 'nico', displayName: 'Nico', status: 'FOLDED' },
      { seatNo: 5, userId: 'mila', displayName: 'Mila', status: 'READY' }
    ],
    stacks: { victor: 875, marcus: 950, elena: 1100, hero: 1560, nico: 780, mila: 1250 },
    potTotal: 1350,
    dealerSeat: 1,
    communityCards: [
      { r: '10', s: 'D' },
      { r: 'J', s: 'C' },
      { r: 'Q', s: 'H' },
      { r: '7', s: 'S' },
      { r: '2', s: 'H' }
    ],
    heroCards: [
      { r: 'A', s: 'S' },
      { r: 'K', s: 'H' }
    ],
    turnUserId: 'hero',
    phase: 'TURN',
    handId: 'demo-hand',
    lastBettingRoundActionByUserId: { victor: 'call', marcus: 'raise', nico: 'fold' },
    legalActions: ['FOLD', 'CHECK', 'BET'],
    actionConstraints: { toCall: 0, maxBetAmount: 240, minRaiseTo: null, maxRaiseTo: null },
    currentUserId: 'hero',
    youSeat: 3,
    statusText: LIVE_STATUS_COPY.demo,
    errorText: ''
  };

  var state = cloneState(demoState);
  var searchParams = null;
  var tableId = readTableId();
  var wsClient = null;
  var currentAccessToken = null;
  var currentGuestSession = null;
  var isGuestMode = false;
  var authWatchTimer = null;
  var turnClockTimer = null;
  var revealDismissTimer = null;
  var closedTableRedirectTimer = null;
  var closedTableRedirectRemaining = 0;
  var closedTableRedirectReason = null;
  var authUnsubscribe = null;
  var pendingLeaveRetryAfterReconnect = false;
  var pendingLeaveNavigation = false;
  var leaveConfirmOpen = false;
  var renderedSeatAnchors = {};
  var renderedSeatSlots = {};
  var renderedSeatAvatars = {};
  var renderedSeatBetAnchors = {};
  var renderedSeatStackAnchors = {};
  var loadedSeatAvatarUrls = Object.create(null);
  var seatCommittedByUserId = {};
  var suggestedSeatNoParam = null;
  var shouldAutoJoin = false;
  var autoJoinAttempted = false;
  var autoJoinRetryTimer = null;
  var autoJoinRetryCount = 0;
  var autoJoinErrorActive = false;
  var reconnectSeatNo = null;
  var lastKnownCurrentSeatNo = null;
  var bootReady = false;
  var queuedPreaction = null;
  var queuedPreactionInFlight = false;
  var rebuyInFlight = false;
  var rebuyPanelDismissed = false;
  var rebuyBalanceLoading = false;
  var stickyWinnerReveal = {
    handId: null,
    visibleUntilMs: 0,
    settlementPresentation: null,
    showdownWinnerUserIds: [],
    revealedShowdownCardsByUserId: {},
    communityCards: []
  };
  var pendingPostRevealSnapshot = null;
  var lastPresentedSettlementHandId = null;
  var lastAnimatedSettlementHandId = null;
  var lastSettlementFailureKey = null;
  var settlementAnimationGeneration = 0;
  var settlementAnimationTimers = [];
  var settlementAnimationNodes = [];
  var suppressSettlementAnimationUntilAuthoritativeSnapshot = false;
  var els = {};

  function cloneState(source){
    return JSON.parse(JSON.stringify(source));
  }

  function normalizeSignalCode(value){
    if (typeof value !== 'string') return '';
    return value.trim().toLowerCase();
  }

  function isClosedTableStatus(value){
    return typeof value === 'string' && value.trim().toUpperCase() === 'CLOSED';
  }

  function isClosedTableSignal(value){
    var normalized = normalizeSignalCode(value);
    if (!normalized) return false;
    return normalized === 'table_closed'
      || normalized === 'table_not_open'
      || normalized === 'table_not_found'
      || normalized === 'temporarily_unavailable';
  }

  function clearClosedTableRedirectTimer(){
    if (!closedTableRedirectTimer) return;
    window.clearTimeout(closedTableRedirectTimer);
    closedTableRedirectTimer = null;
  }

  function renderClosedTableNotice(){
    if (!els.closedTableModal || !els.closedTableCountdown || !els.closedTableTitle) return;
    var active = closedTableRedirectRemaining > 0;
    els.closedTableModal.hidden = !active;
    if (!active) return;
    els.closedTableTitle.textContent = 'This table has ended. Returning to lobby in 5 seconds…';
    els.closedTableCountdown.textContent = closedTableRedirectRemaining === CLOSED_TABLE_REDIRECT_SECONDS
      ? 'Returning to lobby in 5 seconds…'
      : ('Returning to lobby in ' + closedTableRedirectRemaining + '…');
  }

  function cancelClosedTableRedirect(){
    clearClosedTableRedirectTimer();
    closedTableRedirectRemaining = 0;
    closedTableRedirectReason = null;
    renderClosedTableNotice();
  }

  function tickClosedTableRedirect(){
    clearClosedTableRedirectTimer();
    if (closedTableRedirectRemaining <= 1) {
      closedTableRedirectRemaining = 0;
      renderClosedTableNotice();
      navigateToLobby();
      return;
    }
    closedTableRedirectRemaining -= 1;
    renderClosedTableNotice();
    closedTableRedirectTimer = window.setTimeout(tickClosedTableRedirect, 1000);
  }

  function startClosedTableRedirect(reason){
    if (closedTableRedirectRemaining === CLOSED_TABLE_REDIRECT_SECONDS && closedTableRedirectReason === reason && closedTableRedirectTimer) {
      renderClosedTableNotice();
      return;
    }
    closedTableRedirectReason = reason || null;
    closedTableRedirectRemaining = CLOSED_TABLE_REDIRECT_SECONDS;
    clearClosedTableRedirectTimer();
    renderClosedTableNotice();
    klog('poker_closed_table_redirect_started', {
      tableId: state.tableId || null,
      reason: closedTableRedirectReason
    });
    closedTableRedirectTimer = window.setTimeout(tickClosedTableRedirect, 1000);
  }

  function syncClosedTableRedirectFromSnapshot(payload){
    if (!isObject(payload)) return;
    var tableObj = isObject(payload.table) ? payload.table : {};
    var nextStatus = null;
    if (typeof payload.status === 'string' && payload.status) nextStatus = payload.status;
    else if (typeof tableObj.status === 'string' && tableObj.status) nextStatus = tableObj.status;
    if (isClosedTableStatus(nextStatus)) {
      startClosedTableRedirect('table_closed');
      return;
    }
    var publicObj = isObject(payload.public) ? payload.public : {};
    var handObj = isObject(publicObj.hand) ? publicObj.hand : (isObject(payload.hand) ? payload.hand : {});
    var handStatus = typeof handObj.status === 'string' ? handObj.status.trim().toUpperCase() : '';
    var hasMembers = Array.isArray(tableObj.members) && tableObj.members.some(function(member){
      return member && typeof member.userId === 'string' && member.userId;
    });
    var hasSeats = Array.isArray(publicObj.seats) && publicObj.seats.some(function(seat){
      return seat && typeof seat.userId === 'string' && seat.userId;
    });
    var hasUsableState = handStatus === 'LOBBY'
      || handStatus === 'PREFLOP'
      || handStatus === 'FLOP'
      || handStatus === 'TURN'
      || handStatus === 'RIVER'
      || handStatus === 'SETTLED'
      || hasMembers
      || hasSeats;
    if (hasUsableState) cancelClosedTableRedirect();
  }

  function syncClosedTableRedirectFromSignal(reason){
    if (!isClosedTableSignal(reason)) return false;
    startClosedTableRedirect(normalizeSignalCode(reason));
    return true;
  }

  function createEmptyLiveState(nextTableId, nextUserId){
    return {
      mode: 'live',
      tableId: nextTableId || null,
      tableStatus: 'OPEN',
      maxSeats: 6,
      seats: [],
      stacks: {},
      potTotal: 0,
      dealerSeat: null,
      communityCards: [],
      heroCards: [],
      turnUserId: null,
      turnStartedAt: null,
      turnDeadlineAt: null,
      phase: 'LOBBY',
      handId: null,
      lastBettingRoundActionByUserId: {},
      legalActions: [],
      actionConstraints: {},
      currentUserId: nextUserId || null,
      youSeat: null,
      statusText: LIVE_STATUS_COPY.connecting,
      errorText: '',
      wsReady: false,
      showdown: null,
      handSettlement: null,
      settlementPresentation: null,
      revealedShowdownCardsByUserId: {},
      playerState: null
    };
  }

  function readTableId(){
    try {
      searchParams = new URLSearchParams(window.location.search || '');
      return searchParams.get('tableId');
    } catch (_err){
      searchParams = null;
      return null;
    }
  }


  function readGuestMode(){
    try {
      if (!searchParams) searchParams = new URLSearchParams(window.location.search || "");
      return searchParams.get("guest") === "1";
    } catch (_err){
      return false;
    }
  }

  function clearGuestSession(){
    try {
      if (window.sessionStorage) window.sessionStorage.removeItem("poker:guestSession");
    } catch (_err){}
  }

  function readGuestSession(){
    try {
      var raw = window.sessionStorage ? window.sessionStorage.getItem("poker:guestSession") : null;
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || !parsed.token || !parsed.tableId){
        clearGuestSession();
        return null;
      }
      if (tableId && parsed.tableId !== tableId){
        clearGuestSession();
        return null;
      }
      if (Number(parsed.expiresAt) && Number(parsed.expiresAt) <= Date.now()){
        clearGuestSession();
        return null;
      }
      return parsed;
    } catch (_err){
      clearGuestSession();
      return null;
    }
  }

  function klog(kind, data){
    try {
      if (window.KLog && typeof window.KLog.log === 'function') window.KLog.log(kind, data || {});
    } catch (_err){}
  }

  function t(key, fallback){
    try {
      if (window.I18N && typeof window.I18N.t === 'function'){
        var translated = window.I18N.t(key);
        if (translated) return translated;
      }
    } catch (_err){}
    return fallback || key;
  }

  function tf(key, values, fallback){
    try {
      if (window.I18N && typeof window.I18N.format === 'function'){
        var translated = window.I18N.format(key, values || {});
        if (translated) return translated;
      }
    } catch (_err){}
    var output = t(key, fallback || key);
    Object.keys(values || {}).forEach(function(name){
      output = output.replace(new RegExp('\\{' + name + '\\}', 'g'), String(values[name]));
    });
    return output;
  }

  function getAccessToken(){
    var bridge = window.SupabaseAuthBridge;
    if (!bridge || typeof bridge.getAccessToken !== 'function') return Promise.resolve(null);
    return Promise.resolve().then(function(){ return bridge.getAccessToken(); }).catch(function(){ return null; });
  }

  function getAuthApi(){
    if (window.SupabaseAuth && typeof window.SupabaseAuth.onAuthChange === 'function'){
      return window.SupabaseAuth;
    }
    return null;
  }

  function getCurrentUser(){
    var authApi = getAuthApi();
    if (!authApi || typeof authApi.getCurrentUser !== 'function') return Promise.resolve(null);
    return Promise.resolve().then(function(){ return authApi.getCurrentUser(); }).catch(function(){ return null; });
  }

  function resolveInitialIdentity(attempt){
    var retry = Number.isInteger(attempt) ? attempt : 0;
    return Promise.all([getAccessToken(), getCurrentUser()]).then(function(values){
      var identity = { token: values[0] || null, user: values[1] || null };
      if (identity.token || identity.user || !getAuthApi() || retry >= 4) return identity;
      return new Promise(function(resolve){
        window.setTimeout(function(){ resolve(resolveInitialIdentity(retry + 1)); }, 150);
      });
    });
  }

  function decodeBase64Url(str){
    var base64 = String(str || '').replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4) base64 += '=';
    return atob(base64);
  }

  function getUserIdFromToken(token){
    if (!token || typeof token !== 'string') return null;
    var parts = token.split('.');
    if (parts.length < 2) return null;
    try {
      var payload = JSON.parse(decodeBase64Url(parts[1]));
      return payload && payload.sub ? payload.sub : null;
    } catch (_err){
      return null;
    }
  }

  function openSignIn(){
    var bridge = window.SupabaseAuthBridge;
    var methods = ['signIn', 'openSignIn', 'showAuth', 'startLogin'];
    if (bridge){
      for (var i = 0; i < methods.length; i++){
        if (typeof bridge[methods[i]] === 'function'){
          try {
            bridge[methods[i]]();
            return;
          } catch (_err){}
        }
      }
    }
    window.location.href = '/account.html';
  }

  function isObject(value){
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function normalizeCard(card){
    if (!card) return null;
    var rank = '';
    var suit = '';
    if (typeof card === 'string'){
      var trimmed = card.trim();
      if (trimmed.length < 2) return null;
      rank = trimmed.slice(0, -1).toUpperCase();
      suit = trimmed.slice(-1).toUpperCase();
    } else if (isObject(card)){
      rank = String(card.r != null ? card.r : card.rank != null ? card.rank : '').trim().toUpperCase();
      suit = String(card.s != null ? card.s : card.suit != null ? card.suit : '').trim().toUpperCase();
    }
    if (rank === 'T') rank = '10';
    if (!SUIT_SYMBOLS[suit]) return null;
    if (!/^(A|K|Q|J|10|9|8|7|6|5|4|3|2)$/.test(rank)) return null;
    return { r: rank, s: suit };
  }

  function normalizeCards(cards){
    if (!Array.isArray(cards)) return [];
    var out = [];
    for (var i = 0; i < cards.length; i++){
      var normalized = normalizeCard(cards[i]);
      if (normalized) out.push(normalized);
    }
    return out;
  }

  function normalizeEvalRank(rank){
    if (typeof rank === 'number' && Number.isInteger(rank) && rank >= 2 && rank <= 14) return rank;
    if (typeof rank !== 'string') return null;
    var value = rank.trim().toUpperCase();
    if (value === 'A') return 14;
    if (value === 'K') return 13;
    if (value === 'Q') return 12;
    if (value === 'J') return 11;
    if (value === 'T') return 10;
    if (/^\d+$/.test(value)) {
      var numeric = Number(value);
      if (Number.isInteger(numeric) && numeric >= 2 && numeric <= 10) return numeric;
    }
    return null;
  }

  function normalizeEvalSuit(suit){
    if (typeof suit !== 'string') return null;
    var value = suit.trim().toUpperCase();
    if (!SUIT_SYMBOLS[value]) return null;
    return value;
  }

  function normalizeEvalCards(cards){
    if (!Array.isArray(cards) || cards.length < 5) return null;
    var out = [];
    var seen = {};
    for (var i = 0; i < cards.length; i++){
      var card = cards[i];
      if (!card || typeof card !== 'object') return null;
      var rank = normalizeEvalRank(card.r);
      var suit = normalizeEvalSuit(card.s);
      if (!rank || !suit) return null;
      var key = String(rank) + '-' + suit;
      if (seen[key]) return null;
      seen[key] = true;
      out.push({ rank: rank, suit: suit, raw: { r: card.r, s: suit } });
    }
    return out;
  }

  function compareRankVectors(left, right){
    var a = Array.isArray(left) ? left : [];
    var b = Array.isArray(right) ? right : [];
    var maxLen = Math.max(a.length, b.length);
    for (var i = 0; i < maxLen; i++){
      var diff = (a[i] || 0) - (b[i] || 0);
      if (diff !== 0) return diff > 0 ? 1 : -1;
    }
    return 0;
  }

  function sortByRankDescThenSuit(left, right){
    if (left.rank !== right.rank) return right.rank - left.rank;
    return left.suit.localeCompare(right.suit);
  }

  function findStraightRanks(ranksDesc){
    var rankMap = {};
    (Array.isArray(ranksDesc) ? ranksDesc : []).forEach(function(rank){ rankMap[rank] = true; });
    if (rankMap[14]) rankMap[1] = true;
    for (var high = 14; high >= 5; high--){
      var ok = true;
      for (var i = 0; i < 5; i++){
        if (!rankMap[high - i]) {
          ok = false;
          break;
        }
      }
      if (ok){
        var ranks = [];
        for (var j = 0; j < 5; j++) ranks.push(high - j);
        return { high: high, ranks: ranks };
      }
    }
    return null;
  }

  function pickStraightCards(ranks, cardsByRank){
    var result = [];
    for (var i = 0; i < ranks.length; i++){
      var actual = ranks[i] === 1 ? 14 : ranks[i];
      var list = cardsByRank[actual] || [];
      result.push(list[0]);
    }
    return result;
  }

  function evaluateViewerBestHand(cards){
    var normalized = normalizeEvalCards(cards);
    if (!normalized) return null;
    var allSorted = normalized.slice().sort(sortByRankDescThenSuit);
    var cardsByRank = {};
    var cardsBySuit = {};
    normalized.forEach(function(card){
      if (!cardsByRank[card.rank]) cardsByRank[card.rank] = [];
      cardsByRank[card.rank].push(card);
      if (!cardsBySuit[card.suit]) cardsBySuit[card.suit] = [];
      cardsBySuit[card.suit].push(card);
    });
    Object.keys(cardsByRank).forEach(function(rank){
      cardsByRank[rank].sort(function(a, b){ return a.suit.localeCompare(b.suit); });
    });
    Object.keys(cardsBySuit).forEach(function(suit){
      cardsBySuit[suit].sort(sortByRankDescThenSuit);
    });

    var uniqueRanksDesc = Object.keys(cardsByRank).map(Number).sort(function(a, b){ return b - a; });
    var ranksByCount = { 1: [], 2: [], 3: [], 4: [] };
    uniqueRanksDesc.forEach(function(rank){
      ranksByCount[cardsByRank[rank].length].push(rank);
    });

    var bestStraightFlush = null;
    Object.keys(cardsBySuit).sort().forEach(function(suit){
      var suitedCards = cardsBySuit[suit];
      if (suitedCards.length < 5) return;
      var suitRanks = suitedCards.map(function(entry){ return entry.rank; }).filter(function(rank, index, list){
        return list.indexOf(rank) === index;
      }).sort(function(a, b){ return b - a; });
      var straightInSuit = findStraightRanks(suitRanks);
      if (!straightInSuit) return;
      var cardsByRankSuit = {};
      suitedCards.forEach(function(entry){
        if (!cardsByRankSuit[entry.rank]) cardsByRankSuit[entry.rank] = [];
        cardsByRankSuit[entry.rank].push(entry);
      });
      var candidate = {
        high: straightInSuit.high === 1 ? 5 : straightInSuit.high,
        cards: pickStraightCards(straightInSuit.ranks, cardsByRankSuit)
      };
      if (!bestStraightFlush || candidate.high > bestStraightFlush.high) bestStraightFlush = candidate;
    });
    if (bestStraightFlush) return { category: HAND_CATEGORY.STRAIGHT_FLUSH, cards: bestStraightFlush.cards.map(function(entry){ return entry.raw; }) };

    if (ranksByCount[4].length){
      var quadRank = ranksByCount[4][0];
      var quadCards = cardsByRank[quadRank].slice(0, 4);
      var quadKicker = allSorted.find(function(entry){ return entry.rank !== quadRank; });
      return { category: HAND_CATEGORY.QUADS, cards: quadCards.concat([quadKicker]).map(function(entry){ return entry.raw; }) };
    }

    if (ranksByCount[3].length){
      var tripRank = ranksByCount[3][0];
      var pairRank = ranksByCount[2].find(function(rank){ return rank !== tripRank; }) || ranksByCount[3][1];
      if (pairRank){
        return { category: HAND_CATEGORY.FULL_HOUSE, cards: cardsByRank[tripRank].slice(0, 3).concat(cardsByRank[pairRank].slice(0, 2)).map(function(entry){ return entry.raw; }) };
      }
    }

    var bestFlush = null;
    Object.keys(cardsBySuit).sort().forEach(function(suit){
      var flushCards = cardsBySuit[suit];
      if (flushCards.length < 5) return;
      var topFlush = flushCards.slice(0, 5);
      var ranks = topFlush.map(function(entry){ return entry.rank; });
      if (!bestFlush || compareRankVectors(ranks, bestFlush.ranks) > 0) bestFlush = { ranks: ranks, cards: topFlush };
    });
    if (bestFlush) return { category: HAND_CATEGORY.FLUSH, cards: bestFlush.cards.map(function(entry){ return entry.raw; }) };

    var straight = findStraightRanks(uniqueRanksDesc);
    if (straight) return { category: HAND_CATEGORY.STRAIGHT, cards: pickStraightCards(straight.ranks, cardsByRank).map(function(entry){ return entry.raw; }) };

    if (ranksByCount[3].length){
      var tripsRank = ranksByCount[3][0];
      return {
        category: HAND_CATEGORY.TRIPS,
        cards: cardsByRank[tripsRank].slice(0, 3).concat(allSorted.filter(function(entry){ return entry.rank !== tripsRank; }).slice(0, 2)).map(function(entry){ return entry.raw; })
      };
    }

    if (ranksByCount[2].length >= 2){
      var highPair = ranksByCount[2][0];
      var lowPair = ranksByCount[2][1];
      var twoPairKicker = allSorted.find(function(entry){ return entry.rank !== highPair && entry.rank !== lowPair; });
      return {
        category: HAND_CATEGORY.TWO_PAIR,
        cards: cardsByRank[highPair].slice(0, 2).concat(cardsByRank[lowPair].slice(0, 2)).concat([twoPairKicker]).map(function(entry){ return entry.raw; })
      };
    }

    if (ranksByCount[2].length){
      var pairRankOnly = ranksByCount[2][0];
      return {
        category: HAND_CATEGORY.PAIR,
        cards: cardsByRank[pairRankOnly].slice(0, 2).concat(allSorted.filter(function(entry){ return entry.rank !== pairRankOnly; }).slice(0, 3)).map(function(entry){ return entry.raw; })
      };
    }

    return { category: HAND_CATEGORY.HIGH_CARD, cards: allSorted.slice(0, 5).map(function(entry){ return entry.raw; }) };
  }

  function formatViewerHandCategory(category){
    if (category === HAND_CATEGORY.STRAIGHT_FLUSH) return 'Straight Flush';
    if (category === HAND_CATEGORY.QUADS) return 'Four of a Kind';
    if (category === HAND_CATEGORY.FULL_HOUSE) return 'Full House';
    if (category === HAND_CATEGORY.FLUSH) return 'Flush';
    if (category === HAND_CATEGORY.STRAIGHT) return 'Straight';
    if (category === HAND_CATEGORY.TRIPS) return 'Three of a Kind';
    if (category === HAND_CATEGORY.TWO_PAIR) return 'Two Pair';
    if (category === HAND_CATEGORY.PAIR) return 'Pair';
    return 'High Card';
  }

  function normalizeSeatNumber(rawSeatNo){
    var seatNo = Number(rawSeatNo);
    if (!Number.isInteger(seatNo) || seatNo < 0) return null;
    return seatNo;
  }

  function getTrustedAvatarOrigin(){
    var config = isObject(window.SUPABASE_CONFIG) ? window.SUPABASE_CONFIG : {};
    var rawUrl = config.SUPABASE_URL || config.supabaseUrl || config.url || '';
    try {
      var parsed = new URL(rawUrl);
      if (parsed.protocol !== 'https:' || !/^[a-z0-9-]+\.supabase\.co$/i.test(parsed.hostname)) return '';
      if (parsed.href !== parsed.origin + '/') return '';
      return parsed.origin;
    } catch (_error) {
      return '';
    }
  }

  function normalizePokerAvatar(rawAvatar){
    if (!isObject(rawAvatar)) return null;
    if (rawAvatar.type === 'default' && POKER_AVATAR_VARIANTS[rawAvatar.variant] === true){
      return { type: 'default', variant: rawAvatar.variant };
    }
    if (rawAvatar.type !== 'uploaded' || typeof rawAvatar.url !== 'string') return null;
    try {
      var parsed = new URL(rawAvatar.url);
      var trustedOrigin = getTrustedAvatarOrigin();
      if (!trustedOrigin || parsed.origin !== trustedOrigin) return null;
      if (!/^\/storage\/v1\/object\/public\/profile-avatars\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$/i.test(parsed.pathname)) return null;
      if (parsed.username || parsed.password || parsed.search || parsed.hash || parsed.port) return null;
      return { type: 'uploaded', url: parsed.href };
    } catch (_error) {
      return null;
    }
  }

  function normalizePokerProfile(rawProfile){
    if (!isObject(rawProfile)) return null;
    var handle = typeof rawProfile.handle === 'string' ? rawProfile.handle.trim().toLowerCase() : '';
    var displayName = typeof rawProfile.displayName === 'string' ? rawProfile.displayName.trim().replace(/\s+/g, ' ') : '';
    var avatar = normalizePokerAvatar(rawProfile.avatar);
    if (!/^[a-z0-9][a-z0-9_-]{2,23}$/.test(handle)) return null;
    if (displayName.length < 2 || displayName.length > 40 || /[\u0000-\u001f\u007f]/.test(displayName)) return null;
    if (!avatar) return null;
    return { handle: handle, displayName: displayName, avatar: avatar };
  }

  function hashBotPresentationKey(value){
    var hash = 2166136261;
    for (var i = 0; i < value.length; i++){
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function normalizeBotPresentation(entry){
    if (!isObject(entry)) return null;
    var key = typeof entry.key === 'string' ? entry.key.trim().toLowerCase() : '';
    var displayName = typeof entry.displayName === 'string' ? entry.displayName.trim() : '';
    var gender = entry.gender === 'male' || entry.gender === 'female' ? entry.gender : '';
    var file = typeof entry.file === 'string' ? entry.file.trim().toLowerCase() : '';
    if (!/^[a-z][a-z0-9-]{1,23}$/.test(key)) return null;
    if (displayName.length < 2 || displayName.length > 24 || /[\u0000-\u001f\u007f]/.test(displayName)) return null;
    if (!gender || !/^bot-(male|female)-\d{2}-v\d+\.webp$/.test(file)) return null;
    if (file.indexOf('bot-' + gender + '-') !== 0) return null;
    return {
      key: key,
      displayName: displayName,
      gender: gender,
      avatarPath: BOT_AVATAR_BASE_PATH + file
    };
  }

  function normalizeBotPresentationCatalog(entries){
    var seenKeys = {};
    var seenNames = {};
    return (Array.isArray(entries) ? entries : []).map(normalizeBotPresentation).filter(function(entry){
      if (!entry) return false;
      var nameKey = entry.displayName.toLowerCase();
      if (seenKeys[entry.key] || seenNames[nameKey]) return false;
      seenKeys[entry.key] = true;
      seenNames[nameKey] = true;
      return true;
    });
  }

  function resolveBotPresentation(tableId, seatNo, usedKeys){
    if (!BOT_PRESENTATIONS.length || !Number.isInteger(seatNo) || seatNo < 0) return null;
    var normalizedTableId = typeof tableId === 'string' && tableId.trim() ? tableId.trim() : 'poker-table';
    var baseIndex = (hashBotPresentationKey(normalizedTableId) + seatNo) % BOT_PRESENTATIONS.length;
    for (var offset = 0; offset < BOT_PRESENTATIONS.length; offset++){
      var entry = BOT_PRESENTATIONS[(baseIndex + offset) % BOT_PRESENTATIONS.length];
      if (entry && (!usedKeys || usedKeys[entry.key] !== true)) return entry;
    }
    return null;
  }

  function assignBotPresentations(seats, tableId){
    var usedKeys = {};
    (Array.isArray(seats) ? seats : []).filter(function(seat){
      return seat && seat.isBot === true && typeof seat.userId === 'string' && seat.userId;
    }).sort(function(left, right){
      return left.seatNo - right.seatNo || left.userId.localeCompare(right.userId);
    }).forEach(function(seat){
      var presentation = resolveBotPresentation(tableId, seat.seatNo, usedKeys);
      seat.botPresentation = presentation;
      seat.displayName = presentation ? presentation.displayName : 'Bot';
      if (presentation) usedKeys[presentation.key] = true;
    });
    return seats;
  }

  function normalizeSeatRows(payload, previousSeats, currentTableId){
    var seatMap = {};
    var previousMap = {};
    var sourceSeats = [];
    if (Array.isArray(previousSeats)){
      previousSeats.forEach(function(seat){
        if (!seat || !Number.isInteger(seat.seatNo)) return;
        previousMap[seat.seatNo] = seat;
      });
    }

    var tableObj = isObject(payload.table) ? payload.table : {};
    var publicObj = isObject(payload.public) ? payload.public : {};
    var snapshotTableId = typeof payload.tableId === 'string' && payload.tableId
      ? payload.tableId
      : (typeof payload.roomId === 'string' && payload.roomId
        ? payload.roomId
        : (typeof tableObj.tableId === 'string' && tableObj.tableId
          ? tableObj.tableId
          : (typeof publicObj.roomId === 'string' && publicObj.roomId
            ? publicObj.roomId
            : (typeof currentTableId === 'string' ? currentTableId : ''))));
    if (Array.isArray(tableObj.members)) sourceSeats = sourceSeats.concat(tableObj.members);
    if (Array.isArray(payload.authoritativeMembers)) sourceSeats = sourceSeats.concat(payload.authoritativeMembers);
    if (Array.isArray(payload.seats)) sourceSeats = sourceSeats.concat(payload.seats);
    if (Array.isArray(publicObj.seats)) sourceSeats = sourceSeats.concat(publicObj.seats);

    sourceSeats.forEach(function(rawSeat){
      if (!rawSeat) return;
      var seatNo = normalizeSeatNumber(
        rawSeat.seatNo != null ? rawSeat.seatNo : rawSeat.seat != null ? rawSeat.seat : rawSeat.position
      );
      if (seatNo == null) return;
      var previous = previousMap[seatNo] || {};
      var userId = typeof rawSeat.userId === 'string' && rawSeat.userId ? rawSeat.userId : (typeof previous.userId === 'string' ? previous.userId : null);
      var samePreviousUser = !!(userId && previous.userId === userId);
      var isBot = rawSeat.isBot === true || (samePreviousUser && previous.isBot === true) || /^bot[-_:]/i.test(userId || '');
      var profile = isBot ? null : (normalizePokerProfile(rawSeat.profile) || (samePreviousUser ? normalizePokerProfile(previous.profile) : null));
      var displayName = isBot
        ? 'Bot'
        : ((profile && profile.displayName) || rawSeat.displayName || rawSeat.name || rawSeat.username || rawSeat.userName || rawSeat.handle || (samePreviousUser ? previous.displayName : null) || null);
      var status = typeof rawSeat.status === 'string' && rawSeat.status ? rawSeat.status.toUpperCase() : (previous.status || 'ACTIVE');
      seatMap[seatNo] = {
        seatNo: seatNo,
        userId: userId,
        displayName: displayName,
        status: status,
        isBot: isBot,
        profile: profile,
        botPresentation: null
      };
    });

    var normalizedSeats = Object.keys(seatMap)
      .map(function(key){ return seatMap[key]; })
      .sort(function(left, right){ return left.seatNo - right.seatNo; });
    return assignBotPresentations(normalizedSeats, snapshotTableId);
  }

  function normalizeStacks(payload){
    if (isObject(payload.stacks)) return Object.assign({}, payload.stacks);
    var publicObj = isObject(payload.public) ? payload.public : {};
    if (isObject(publicObj.stacks)) return Object.assign({}, publicObj.stacks);
    return null;
  }

  function normalizeNumericUserMap(source){
    if (!isObject(source)) return null;
    var next = {};
    Object.keys(source).forEach(function(userId){
      if (!userId) return;
      var value = Number(source[userId]);
      if (!Number.isFinite(value) || value < 0) return;
      next[userId] = value;
    });
    return Object.keys(next).length ? next : null;
  }

  function extractSeatCommittedByUserId(payload){
    var publicObj = isObject(payload && payload.public) ? payload.public : {};
    var next = normalizeNumericUserMap(payload && payload.committedByUserId)
      || normalizeNumericUserMap(publicObj.committedByUserId)
      || normalizeNumericUserMap(payload && payload.betThisRoundByUserId)
      || normalizeNumericUserMap(publicObj.betThisRoundByUserId)
      || {};
    return next;
  }

  function captureVisualSnapshot(){
    return {
      potTotal: Number(state.potTotal) || 0,
      phase: state.phase || null,
      handId: state.handId || null,
      committedByUserId: Object.assign({}, seatCommittedByUserId),
      lastActionByUserId: Object.assign({}, state.lastBettingRoundActionByUserId || {}),
      settlementPresentation: cloneSettlementPresentation(getDisplaySettlementPresentation())
    };
  }

  function normalizeLegalActions(source){
    var list = [];
    var raw = source;
    if (Array.isArray(raw)) list = raw;
    else if (isObject(raw) && Array.isArray(raw.actions)) list = raw.actions;
    return list
      .map(function(entry){
        if (typeof entry === 'string') return entry.trim().toUpperCase();
        if (isObject(entry) && typeof entry.type === 'string') return entry.type.trim().toUpperCase();
        return '';
      })
      .filter(Boolean);
  }

  function normalizeConstraints(primary, secondary){
    var raw = isObject(primary) ? primary : isObject(secondary) ? secondary : {};
    return {
      toCall: raw.toCall != null ? Number(raw.toCall) : null,
      minRaiseTo: raw.minRaiseTo != null ? Number(raw.minRaiseTo) : null,
      maxRaiseTo: raw.maxRaiseTo != null ? Number(raw.maxRaiseTo) : null,
      maxBetAmount: raw.maxBetAmount != null ? Number(raw.maxBetAmount) : null
    };
  }

  function normalizeLastBettingRoundActionByUserId(source){
    var raw = isObject(source) ? source : {};
    var allowed = { fold: true, check: true, call: true, raise: true, all_in: true };
    var next = {};
    Object.keys(raw).forEach(function(userId){
      var action = typeof raw[userId] === 'string' ? raw[userId].trim().toLowerCase() : '';
      if (userId && allowed[action]) next[userId] = action;
    });
    return next;
  }

  function normalizeShowdown(source){
    if (!isObject(source)) return null;
    var showdown = {
      winners: Array.isArray(source.winners) ? source.winners.slice() : [],
      reason: typeof source.reason === 'string' ? source.reason : null,
      handId: typeof source.handId === 'string' ? source.handId : null,
      potAwardedTotal: source.potAwardedTotal,
      potsAwarded: Array.isArray(source.potsAwarded) ? source.potsAwarded.map(function(pot){
        return isObject(pot) ? {
          amount: pot.amount,
          winners: Array.isArray(pot.winners) ? pot.winners.slice() : pot.winners,
          eligibleUserIds: Array.isArray(pot.eligibleUserIds) ? pot.eligibleUserIds.slice() : pot.eligibleUserIds
        } : pot;
      }) : source.potsAwarded
    };
    if (Array.isArray(source.revealedShowdownParticipants)){
      showdown.revealedShowdownParticipants = source.revealedShowdownParticipants
        .filter(function(entry){
          return entry && typeof entry.userId === 'string';
        })
        .map(function(entry){
          return {
            userId: entry.userId,
            holeCards: normalizeCards(entry.holeCards)
          };
        })
        .filter(function(entry){
          return entry.holeCards.length === 2;
        });
    }
    return showdown;
  }

  function normalizeHandSettlement(source){
    if (!isObject(source)) return null;
    return {
      handId: typeof source.handId === 'string' ? source.handId : null,
      settledAt: typeof source.settledAt === 'string' ? source.settledAt : null,
      payouts: isObject(source.payouts) ? Object.assign({}, source.payouts) : source.payouts
    };
  }

  function invalidSettlementPresentation(reason, handId, settledAt){
    return {
      valid: false,
      failureReason: reason || 'invalid_settlement',
      handId: handId || null,
      settledAt: settledAt || null,
      totalAmount: 0,
      pots: [],
      byUserId: {}
    };
  }

  function normalizeSettlementUserId(value){
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }

  function normalizeSettlementChipAmount(value){
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
  }

  function normalizeSettlementUserIds(source){
    if (!Array.isArray(source) || !source.length) return null;
    var result = [];
    var seen = Object.create(null);
    for (var i = 0; i < source.length; i++){
      var userId = normalizeSettlementUserId(source[i]);
      if (!userId || seen[userId]) return null;
      seen[userId] = true;
      result.push(userId);
    }
    return result;
  }

  function normalizeSettlementPayouts(source){
    if (!isObject(source)) return null;
    var result = Object.create(null);
    var keys = Object.keys(source);
    for (var i = 0; i < keys.length; i++){
      var userId = normalizeSettlementUserId(keys[i]);
      var amount = normalizeSettlementChipAmount(source[keys[i]]);
      if (!userId || amount == null || hasOwn(result, userId)) return null;
      if (amount > 0) result[userId] = amount;
    }
    return result;
  }

  function allocatePotRecipients(amount, orderedWinnerIds){
    var safeAmount = normalizeSettlementChipAmount(amount);
    var winners = normalizeSettlementUserIds(orderedWinnerIds);
    if (safeAmount == null || !winners || (safeAmount > 0 && !winners.length)) return null;
    var baseShare = Math.floor(safeAmount / winners.length);
    var remainder = safeAmount - (baseShare * winners.length);
    return winners.map(function(userId, index){
      return { userId: userId, amount: baseShare + (index < remainder ? 1 : 0) };
    });
  }

  function classifySettlementPot(reason, potIndex, eligibleUserIds, winners, sidePotNumber){
    if (reason === 'all_folded'){
      if (potIndex !== 0 || eligibleUserIds.length !== 1 || winners.length !== 1 || eligibleUserIds[0] !== winners[0]) return null;
      return { kind: 'main', sidePotNumber: null };
    }
    if (reason !== 'computed') return null;
    if (potIndex === 0){
      if (eligibleUserIds.length < 2) return null;
      return { kind: 'main', sidePotNumber: null };
    }
    if (eligibleUserIds.length >= 2) return { kind: 'side', sidePotNumber: sidePotNumber };
    if (eligibleUserIds.length === 1 && winners.length === 1 && eligibleUserIds[0] === winners[0]) return { kind: 'return', sidePotNumber: null };
    return null;
  }

  function buildSettlementPresentation(input){
    var showdown = input && input.showdown;
    var settlement = input && input.handSettlement;
    var handId = showdown && normalizeSettlementUserId(showdown.handId);
    var settlementHandId = settlement && normalizeSettlementUserId(settlement.handId);
    var settledAt = settlement && typeof settlement.settledAt === 'string' ? settlement.settledAt : null;
    if (!isObject(showdown) || !isObject(settlement)) return invalidSettlementPresentation('missing_settlement_pair', handId || settlementHandId, settledAt);
    if (!handId || !settlementHandId || handId !== settlementHandId) return invalidSettlementPresentation('hand_id_mismatch', handId || settlementHandId, settledAt);
    var reason = typeof showdown.reason === 'string' ? showdown.reason.trim().toLowerCase() : '';
    var totalAmount = normalizeSettlementChipAmount(showdown.potAwardedTotal);
    var payouts = normalizeSettlementPayouts(settlement.payouts);
    var sourcePots = showdown.potsAwarded;
    if (totalAmount == null || !payouts || !Array.isArray(sourcePots) || !sourcePots.length) return invalidSettlementPresentation('malformed_totals', handId, settledAt);
    if (reason === 'all_folded' && sourcePots.length !== 1) return invalidSettlementPresentation('malformed_all_folded', handId, settledAt);

    var pots = [];
    var byUserId = Object.create(null);
    var calculatedPayouts = Object.create(null);
    var calculatedTotal = 0;
    var sidePotNumber = 0;
    for (var potIndex = 0; potIndex < sourcePots.length; potIndex++){
      var sourcePot = sourcePots[potIndex];
      if (!isObject(sourcePot)) return invalidSettlementPresentation('malformed_pot', handId, settledAt);
      var amount = normalizeSettlementChipAmount(sourcePot.amount);
      var winners = normalizeSettlementUserIds(sourcePot.winners);
      var eligibleUserIds = normalizeSettlementUserIds(sourcePot.eligibleUserIds);
      if (amount == null || !winners || !eligibleUserIds) return invalidSettlementPresentation('malformed_pot', handId, settledAt);
      for (var winnerIndex = 0; winnerIndex < winners.length; winnerIndex++){
        if (eligibleUserIds.indexOf(winners[winnerIndex]) === -1) return invalidSettlementPresentation('ineligible_winner', handId, settledAt);
      }
      var nextSidePotNumber = sidePotNumber + 1;
      var classification = classifySettlementPot(reason, potIndex, eligibleUserIds, winners, nextSidePotNumber);
      if (!classification) return invalidSettlementPresentation('invalid_pot_classification', handId, settledAt);
      if (classification.kind === 'side') sidePotNumber = nextSidePotNumber;
      var recipients = allocatePotRecipients(amount, winners);
      if (!recipients) return invalidSettlementPresentation('invalid_split', handId, settledAt);
      var recipientTotal = 0;
      var awardId = handId + ':pot:' + potIndex;
      recipients.forEach(function(recipient){
        recipientTotal += recipient.amount;
        calculatedPayouts[recipient.userId] = (calculatedPayouts[recipient.userId] || 0) + recipient.amount;
        if (!byUserId[recipient.userId]) byUserId[recipient.userId] = [];
        byUserId[recipient.userId].push({
          awardId: awardId,
          potIndex: potIndex,
          kind: classification.kind,
          sidePotNumber: classification.sidePotNumber,
          amount: recipient.amount
        });
      });
      if (recipientTotal !== amount) return invalidSettlementPresentation('split_total_mismatch', handId, settledAt);
      pots.push({
        awardId: awardId,
        potIndex: potIndex,
        kind: classification.kind,
        sidePotNumber: classification.sidePotNumber,
        amount: amount,
        recipients: recipients,
        eligibleUserIds: eligibleUserIds
      });
      calculatedTotal += amount;
    }
    if (calculatedTotal !== totalAmount) return invalidSettlementPresentation('pot_total_mismatch', handId, settledAt);
    var payoutKeys = Object.keys(payouts).sort();
    var calculatedKeys = Object.keys(calculatedPayouts).filter(function(userId){ return calculatedPayouts[userId] > 0; }).sort();
    if (payoutKeys.join('|') !== calculatedKeys.join('|')) return invalidSettlementPresentation('payout_users_mismatch', handId, settledAt);
    for (var payoutIndex = 0; payoutIndex < payoutKeys.length; payoutIndex++){
      if (payouts[payoutKeys[payoutIndex]] !== calculatedPayouts[payoutKeys[payoutIndex]]) return invalidSettlementPresentation('payout_amount_mismatch', handId, settledAt);
    }
    return {
      valid: true,
      failureReason: null,
      handId: handId,
      settledAt: settledAt,
      totalAmount: totalAmount,
      pots: pots,
      byUserId: byUserId
    };
  }

  function mapRevealedShowdownCards(showdown){
    var revealed = {};
    if (!showdown || !Array.isArray(showdown.revealedShowdownParticipants)) return revealed;
    showdown.revealedShowdownParticipants.forEach(function(entry){
      if (!entry || typeof entry.userId !== 'string') return;
      if (!Array.isArray(entry.holeCards) || entry.holeCards.length !== 2) return;
      revealed[entry.userId] = entry.holeCards.slice(0, 2);
    });
    return revealed;
  }

  function cloneRevealedShowdownCards(source){
    var next = {};
    if (!isObject(source)) return next;
    Object.keys(source).forEach(function(userId){
      if (!Array.isArray(source[userId])) return;
      next[userId] = source[userId].slice(0, 2);
    });
    return next;
  }

  function cloneSettlementPresentation(source){
    return source ? cloneState(source) : null;
  }

  function resolveSettlementRevealDueAt(presentation){
    var settledAtMs = presentation && presentation.settledAt ? Date.parse(presentation.settledAt) : NaN;
    return Number.isFinite(settledAtMs) && settledAtMs <= Date.now() + 1000 ? settledAtMs + WINNER_REVEAL_MS : Date.now() + WINNER_REVEAL_MS;
  }

  function syncStickyWinnerReveal(minimumVisibleUntilMs){
    var handId = state.handId || (state.handSettlement && state.handSettlement.handId) || (state.showdown && state.showdown.handId) || null;
    if (!handId || state.phase !== 'SETTLED' || (!state.showdown && !state.settlementPresentation)) return;
    if (stickyWinnerReveal.handId !== handId && lastPresentedSettlementHandId !== handId){
      var visibleUntilMs = resolveSettlementRevealDueAt(state.settlementPresentation || state.handSettlement);
      if (Number.isFinite(minimumVisibleUntilMs)) visibleUntilMs = Math.max(visibleUntilMs, minimumVisibleUntilMs);
      stickyWinnerReveal = {
        handId: handId,
        visibleUntilMs: visibleUntilMs,
        settlementPresentation: cloneSettlementPresentation(state.settlementPresentation),
        showdownWinnerUserIds: state.showdown && Array.isArray(state.showdown.winners) ? state.showdown.winners.filter(function(userId){ return typeof userId === 'string' && !!userId; }) : [],
        revealedShowdownCardsByUserId: cloneRevealedShowdownCards(state.revealedShowdownCardsByUserId),
        communityCards: Array.isArray(state.communityCards) ? state.communityCards.slice(0, 5) : []
      };
      lastPresentedSettlementHandId = handId;
    } else if (stickyWinnerReveal.handId === handId){
      stickyWinnerReveal.settlementPresentation = cloneSettlementPresentation(state.settlementPresentation);
      stickyWinnerReveal.showdownWinnerUserIds = state.showdown && Array.isArray(state.showdown.winners) ? state.showdown.winners.filter(function(userId){ return typeof userId === 'string' && !!userId; }) : [];
      stickyWinnerReveal.revealedShowdownCardsByUserId = cloneRevealedShowdownCards(state.revealedShowdownCardsByUserId);
      stickyWinnerReveal.communityCards = Array.isArray(state.communityCards) ? state.communityCards.slice(0, 5) : [];
    }
  }

  function getActiveWinnerReveal(){
    if (!stickyWinnerReveal.handId) return null;
    if (stickyWinnerReveal.visibleUntilMs <= Date.now()) return null;
    return stickyWinnerReveal;
  }

  function clearWinnerRevealTimer(){
    if (!revealDismissTimer) return;
    try { window.clearTimeout(revealDismissTimer); } catch (_err){}
    revealDismissTimer = null;
  }

  function extractSnapshotHandId(payload){
    if (!isObject(payload)) return null;
    if (typeof payload.handId === 'string' && payload.handId) return payload.handId;
    if (isObject(payload.hand) && typeof payload.hand.handId === 'string' && payload.hand.handId) return payload.hand.handId;
    if (isObject(payload.public) && isObject(payload.public.hand) && typeof payload.public.hand.handId === 'string' && payload.public.hand.handId) return payload.public.hand.handId;
    return null;
  }

  function scheduleRevealDismiss(){
    var sticky = getActiveWinnerReveal();
    clearWinnerRevealTimer();
    if (!sticky) return;
    var remainingMs = Math.max(0, sticky.visibleUntilMs - Date.now());
    revealDismissTimer = window.setTimeout(function(){
      revealDismissTimer = null;
      stickyWinnerReveal.visibleUntilMs = 0;
      if (pendingPostRevealSnapshot){
        var nextFrame = pendingPostRevealSnapshot;
        pendingPostRevealSnapshot = null;
        mergeSnapshot(nextFrame.payload, nextFrame);
      }
      render();
      autoJoinSeat();
    }, remainingMs);
  }

  function shouldDeferSnapshotUntilRevealEnds(payload){
    var sticky = getActiveWinnerReveal();
    if (!sticky) return false;
    var nextHandId = extractSnapshotHandId(payload);
    return !!(nextHandId && sticky.handId && nextHandId !== sticky.handId);
  }

  function getDisplaySettlementPresentation(){
    if (state.phase === 'SETTLED' && state.settlementPresentation) return state.settlementPresentation;
    var sticky = getActiveWinnerReveal();
    return sticky ? sticky.settlementPresentation : null;
  }

  function getSeatSettlementAwards(userId){
    var presentation = getDisplaySettlementPresentation();
    if (!presentation || !presentation.valid || !presentation.byUserId || !Array.isArray(presentation.byUserId[userId])) return [];
    return presentation.byUserId[userId].slice();
  }

  function hasOwn(source, key){
    return !!source && Object.prototype.hasOwnProperty.call(source, key);
  }

  function readSnapshotField(payload, publicObj, key){
    if (hasOwn(payload, key)) return { present: true, value: payload[key] };
    if (hasOwn(publicObj, key)) return { present: true, value: publicObj[key] };
    return { present: false, value: undefined };
  }

  function normalizePlayerState(value){
    if (!isObject(value)) return null;
    var status = typeof value.status === 'string' ? value.status.trim().toUpperCase() : '';
    if (status !== 'ACTIVE' && status !== 'OUT_OF_CHIPS' && status !== 'WAITING_NEXT_HAND') return null;
    var stack = Number(value.stack);
    if (!Number.isInteger(stack) || stack < 0) return null;
    return { status: status, stack: stack, canRebuy: value.canRebuy === true };
  }

  function mergeSnapshot(payload, frame){
    if (!isObject(payload)) return;
    var frameKind = frame && typeof frame.kind === 'string' ? frame.kind : 'stateSnapshot';
    var frameInitial = !!(frame && frame.initial);
    var authoritativeFull = frameKind === 'stateSnapshot' || (frameKind === 'table_state' && frameInitial);
    var snapshotTableId = typeof payload.tableId === 'string' && payload.tableId ? payload.tableId : null;
    var publicObj = isObject(payload.public) ? payload.public : {};
    var privateObj = isObject(payload.private) ? payload.private : {};
    var youObj = isObject(payload.you) ? payload.you : {};
    var tableObj = isObject(payload.table) ? payload.table : {};
    var handObj = isObject(payload.hand) ? payload.hand : isObject(publicObj.hand) ? publicObj.hand : {};
    var turnObj = isObject(payload.turn) ? payload.turn : isObject(publicObj.turn) ? publicObj.turn : {};
    var potObj = isObject(payload.pot) ? payload.pot : isObject(publicObj.pot) ? publicObj.pot : {};
    var showdownField = readSnapshotField(payload, publicObj, 'showdown');
    var handSettlementField = readSnapshotField(payload, publicObj, 'handSettlement');
    var playerStateField = hasOwn(payload, 'private') && isObject(payload.private) && hasOwn(payload.private, 'playerState')
      ? { present: true, value: payload.private.playerState }
      : { present: false, value: undefined };
    var legalSource = payload.legalActions != null ? payload.legalActions : publicObj.legalActions;
    var constraintsPrimary = payload.actionConstraints != null ? payload.actionConstraints : publicObj.actionConstraints;
    var lastActionMapSource = payload.lastBettingRoundActionByUserId != null ? payload.lastBettingRoundActionByUserId : publicObj.lastBettingRoundActionByUserId;

    if (snapshotTableId && state.tableId && snapshotTableId !== state.tableId) return;
    if (snapshotTableId) state.tableId = snapshotTableId;
    else if (tableObj.tableId) state.tableId = tableObj.tableId;

    if (typeof tableObj.status === 'string' && tableObj.status) state.tableStatus = tableObj.status.toUpperCase();
    if (typeof payload.status === 'string' && payload.status) state.tableStatus = payload.status.toUpperCase();
    syncClosedTableRedirectFromSnapshot(payload);

    var resolvedMaxSeats = null;
    if (Number.isInteger(tableObj.maxSeats) && tableObj.maxSeats > 1) resolvedMaxSeats = tableObj.maxSeats;
    else if (Number.isInteger(tableObj.maxPlayers) && tableObj.maxPlayers > 1) resolvedMaxSeats = tableObj.maxPlayers;
    else if (Number.isInteger(payload.maxSeats) && payload.maxSeats > 1) resolvedMaxSeats = payload.maxSeats;
    if (resolvedMaxSeats) state.maxSeats = resolvedMaxSeats;

    var nextSeats = normalizeSeatRows(payload, state.seats, state.tableId);
    if (nextSeats.length || Array.isArray(payload.seats) || Array.isArray(tableObj.members) || Array.isArray(payload.authoritativeMembers) || Array.isArray(publicObj.seats)) {
      state.seats = nextSeats;
      var currentSeatAfterMerge = deriveCurrentSeat();
      if (currentSeatAfterMerge && Number.isInteger(currentSeatAfterMerge.seatNo)) {
        lastKnownCurrentSeatNo = currentSeatAfterMerge.seatNo;
      }
    }
    seatCommittedByUserId = extractSeatCommittedByUserId(payload);

    var nextStacks = normalizeStacks(payload);
    if (nextStacks) state.stacks = nextStacks;

    var previousHandId = state.handId;
    var previousPhase = state.phase;
    if (typeof handObj.status === 'string' && handObj.status) state.phase = handObj.status.toUpperCase();
    if (typeof handObj.handId === 'string' && handObj.handId) state.handId = handObj.handId;
    if (Number.isInteger(payload.dealerSeat)) state.dealerSeat = payload.dealerSeat;
    else if (Number.isInteger(payload.dealerSeatNo)) state.dealerSeat = payload.dealerSeatNo;
    else if (Number.isInteger(handObj.dealerSeat)) state.dealerSeat = handObj.dealerSeat;
    else if (Number.isInteger(handObj.dealerSeatNo)) state.dealerSeat = handObj.dealerSeatNo;

    if (typeof turnObj.userId === 'string' && turnObj.userId) state.turnUserId = turnObj.userId;
    else if (turnObj.userId == null) state.turnUserId = null;
    if (turnObj.startedAt != null) state.turnStartedAt = Number(turnObj.startedAt);
    else if (turnObj.startedAt == null) state.turnStartedAt = null;
    if (turnObj.deadlineAt != null) state.turnDeadlineAt = Number(turnObj.deadlineAt);
    else if (turnObj.deadlineAt == null) state.turnDeadlineAt = null;

    if (Number.isFinite(Number(potObj.total))) state.potTotal = Number(potObj.total);

    var boardSource = null;
    if (Array.isArray(payload.board)) boardSource = payload.board;
    else if (isObject(payload.board) && Array.isArray(payload.board.cards)) boardSource = payload.board.cards;
    else if (Array.isArray(publicObj.board)) boardSource = publicObj.board;
    else if (isObject(publicObj.board) && Array.isArray(publicObj.board.cards)) boardSource = publicObj.board.cards;
    if (boardSource) state.communityCards = normalizeCards(boardSource);
    else if (state.handId && previousHandId && state.handId !== previousHandId) state.communityCards = [];

    var nextHeroCards = null;
    if (Array.isArray(payload.myHoleCards)) nextHeroCards = normalizeCards(payload.myHoleCards);
    else if (Array.isArray(privateObj.holeCards)) nextHeroCards = normalizeCards(privateObj.holeCards);
    if (nextHeroCards) state.heroCards = nextHeroCards;

    if (Number.isInteger(payload.youSeat)) state.youSeat = payload.youSeat;
    else if (Number.isInteger(youObj.seat)) state.youSeat = youObj.seat;
    else if (payload.youSeat == null && youObj.seat == null) state.youSeat = null;

    if (playerStateField.present) state.playerState = normalizePlayerState(playerStateField.value);
    else if (authoritativeFull) state.playerState = null;
    if (!state.playerState || (state.playerState.status !== 'OUT_OF_CHIPS' && state.playerState.status !== 'WAITING_NEXT_HAND')) {
      rebuyPanelDismissed = false;
    }
    if (state.playerState && (state.playerState.status === 'OUT_OF_CHIPS' || state.playerState.status === 'WAITING_NEXT_HAND')) clearQueuedPreaction();

    var legalActions = normalizeLegalActions(legalSource);
    if (legalActions.length || Array.isArray(legalSource) || (isObject(legalSource) && Array.isArray(legalSource.actions))){
      state.legalActions = legalActions;
    }
    if (authoritativeFull || showdownField.present){
      state.showdown = normalizeShowdown(showdownField.value);
      state.revealedShowdownCardsByUserId = mapRevealedShowdownCards(state.showdown);
    }
    if (authoritativeFull || handSettlementField.present) state.handSettlement = normalizeHandSettlement(handSettlementField.value);
    var handChanged = !!(state.handId && previousHandId && state.handId !== previousHandId);
    var explicitSettlementClear = (showdownField.present && showdownField.value == null) || (handSettlementField.present && handSettlementField.value == null);
    var completeSettlementPair = showdownField.present && handSettlementField.present && state.showdown && state.handSettlement;
    if (state.phase !== 'SETTLED' || handChanged || explicitSettlementClear){
      state.settlementPresentation = null;
      if (explicitSettlementClear && stickyWinnerReveal.handId === (state.handId || previousHandId)){
        clearWinnerRevealTimer();
        stickyWinnerReveal.visibleUntilMs = 0;
      }
      cancelSettlementAnimations();
    } else if ((authoritativeFull && state.showdown && state.handSettlement) || completeSettlementPair){
      state.settlementPresentation = buildSettlementPresentation({ showdown: state.showdown, handSettlement: state.handSettlement });
      if (!state.settlementPresentation.valid){
        var failureKey = String(state.settlementPresentation.handId || state.handId || 'unknown') + ':' + state.settlementPresentation.failureReason;
        if (failureKey !== lastSettlementFailureKey){
          lastSettlementFailureKey = failureKey;
          klog('poker_settlement_presentation_invalid', { reason: state.settlementPresentation.failureReason });
        }
      }
    } else if (authoritativeFull && (showdownField.present || handSettlementField.present)){
      state.settlementPresentation = invalidSettlementPresentation('missing_settlement_pair', state.handId, state.handSettlement && state.handSettlement.settledAt);
    } else if (authoritativeFull){
      state.settlementPresentation = null;
    }
    state.lastBettingRoundActionByUserId = normalizeLastBettingRoundActionByUserId(lastActionMapSource);
    if (handChanged && (previousPhase === 'SETTLED' || stickyWinnerReveal.handId === previousHandId)){
      clearWinnerRevealTimer();
      stickyWinnerReveal.visibleUntilMs = 0;
    }
    var liveSettlementTransition = !frameInitial
      && !(frame && frame.suppressSettlementAnimation)
      && !!previousHandId
      && previousHandId === state.handId
      && previousPhase !== 'SETTLED'
      && state.phase === 'SETTLED';
    syncStickyWinnerReveal(liveSettlementTransition ? Date.now() + WINNER_REVEAL_MS : null);
    state.actionConstraints = normalizeConstraints(constraintsPrimary, legalSource && legalSource.actionConstraints);
    state.statusText = LIVE_STATUS_COPY.live;
    if (!autoJoinErrorActive) state.errorText = '';
    if (pendingLeaveNavigation && !hasRenderableCurrentSeat()){
      pendingLeaveRetryAfterReconnect = false;
      pendingLeaveNavigation = false;
      navigateToLobby();
      return;
    }
    if (pendingLeaveNavigation && pendingLeaveRetryAfterReconnect && hasRenderableCurrentSeat() && isWsReady()){
      pendingLeaveRetryAfterReconnect = false;
      leaveAndReturnToLobby();
    }
  }

  function isSignedIn(){
    return !!state.currentUserId;
  }

  function isCurrentUserSeat(seat){
    if (!seat) return false;
    if (seat.userId && state.currentUserId && seat.userId === state.currentUserId) return true;
    return !!(Number.isInteger(state.youSeat) && Number.isInteger(seat.seatNo) && seat.seatNo === state.youSeat);
  }

  function deriveCurrentSeat(){
    var currentUserId = state.currentUserId;
    if (!currentUserId) return null;
    for (var i = 0; i < state.seats.length; i++){
      if (isCurrentUserSeat(state.seats[i])) return state.seats[i];
    }
    if (Number.isInteger(state.youSeat)){
      return { seatNo: state.youSeat, userId: currentUserId, status: 'ACTIVE', displayName: 'You' };
    }
    return null;
  }

  function hasRenderableCurrentSeat(){
    var currentUserId = state.currentUserId;
    if (!currentUserId) return false;
    for (var i = 0; i < state.seats.length; i++){
      if (isCurrentUserSeat(state.seats[i])) return true;
    }
    return false;
  }

  function getHeroVisualIndex(){
    var offset = getSeatNumberingOffset();
    var currentSeat = deriveCurrentSeat();
    if (!currentSeat || !Number.isInteger(currentSeat.seatNo)) return null;
    return Math.max(0, currentSeat.seatNo - offset);
  }

  function isCurrentUserFolded(){
    var currentSeat = deriveCurrentSeat();
    return !!(currentSeat && /FOLD/i.test(currentSeat.status || ''));
  }

  function rotateSeatIndex(index, total){
    var heroIndex = getHeroVisualIndex();
    var safeTotal = Math.max(1, total || 1);
    if (heroIndex == null) return index % safeTotal;
    var heroAnchorIndex = safeTotal >= 4 ? Math.floor(safeTotal / 2) : safeTotal - 1;
    return (index - heroIndex + heroAnchorIndex + safeTotal) % safeTotal;
  }

  function getHeroBestHand(){
    var mergedCards = (Array.isArray(state.heroCards) ? state.heroCards.slice(0, 2) : []).concat(Array.isArray(state.communityCards) ? state.communityCards.slice(0, 5) : []);
    var best = evaluateViewerBestHand(mergedCards);
    if (!best || !Array.isArray(best.cards) || best.cards.length !== 5) return null;
    return best;
  }

  function getDisplayCommunityCards(){
    if (Array.isArray(state.communityCards) && state.communityCards.length) return state.communityCards.slice(0, 5);
    var sticky = getActiveWinnerReveal();
    return sticky && Array.isArray(sticky.communityCards) ? sticky.communityCards.slice(0, 5) : [];
  }

  function resolveStack(userId){
    if (!userId || !isObject(state.stacks)) return null;
    var value = state.stacks[userId];
    if (!Number.isFinite(Number(value))) return null;
    return Math.max(0, Math.trunc(Number(value)));
  }

  function getAllowedActions(){
    return Array.isArray(state.legalActions) ? state.legalActions.slice() : [];
  }

  function isUsersTurn(){
    return !!(state.currentUserId && state.turnUserId && state.currentUserId === state.turnUserId);
  }

  function hasActiveHand(){
    return !!(state.handId && state.phase !== 'LOBBY' && state.phase !== 'SETTLED');
  }

  function isFoldAvailable(){
    return !!(isWsReady() && deriveCurrentSeat() && hasActiveHand() && !isCurrentUserFolded());
  }

  function resolveProjectedAllowedActions(){
    if (!isFoldAvailable()) return [];
    var allowed = ['FOLD'];
    var constraints = state.actionConstraints || {};
    var stackAmount = resolveStack(state.currentUserId);
    var toCall = Number.isFinite(constraints.toCall) ? Math.max(0, Math.trunc(constraints.toCall)) : 0;
    if (toCall > 0) allowed.push('CALL');
    else allowed.push('CHECK');
    if (toCall > 0){
      if (Number.isFinite(constraints.maxRaiseTo) || Number.isFinite(constraints.minRaiseTo) || (Number.isFinite(stackAmount) && stackAmount > toCall)){
        allowed.push('RAISE');
      }
    } else if ((Number.isFinite(constraints.maxBetAmount) && Math.max(0, Math.trunc(constraints.maxBetAmount)) > 0) || (Number.isFinite(stackAmount) && stackAmount > 0)){
      allowed.push('BET');
    }
    return allowed;
  }

  function createCard(cardData, opts){
    var card = document.createElement('div');
    var normalized = normalizeCard(cardData);
    if (!normalized){
      card.className = 'poker-card poker-card--back';
      return card;
    }
    var suit = SUIT_SYMBOLS[normalized.s];
    var isRed = normalized.s === 'H' || normalized.s === 'D';
    card.className = isRed ? 'poker-card poker-card--red' : 'poker-card';
    var rank = document.createElement('span');
    rank.textContent = normalized.r;
    var suitEl = document.createElement('small');
    suitEl.textContent = suit;
    card.appendChild(rank);
    card.appendChild(suitEl);
    if (opts && opts.faceDown){
      card.className = 'poker-card poker-card--back';
      card.innerHTML = '';
    }
    return card;
  }

  function initials(name){
    var text = typeof name === 'string' ? name.trim() : '';
    if (!text) return 'P';
    var parts = text.split(/\s+/).filter(Boolean);
    if (parts.length > 1) return (parts[0][0] + parts[1][0]).toUpperCase();
    return text.slice(0, 2).toUpperCase();
  }

  function formatNumber(value){
    var num = Number(value || 0);
    if (!Number.isFinite(num)) return '0';
    return Math.round(num).toLocaleString();
  }

  function formatCompactAmount(value){
    var num = Number(value || 0);
    if (!Number.isFinite(num) || num <= 0) return '0';
    if (num < 1000) return String(Math.round(num));
    if (num < 1000000) return String(Math.round(num / 1000)) + 'k';
    return String(Math.round(num / 1000000)) + 'M';
  }

  function readSeatParam(){
    var raw = searchParams && typeof searchParams.get === 'function' ? parseInt(searchParams.get('seatNo'), 10) : NaN;
    return Number.isInteger(raw) && raw > 0 ? raw : null;
  }

  function readAutoJoinParam(){
    return !!(searchParams && typeof searchParams.get === 'function' && searchParams.get('autoJoin') === '1');
  }

  function getSeatNumberingOffset(){
    for (var i = 0; i < state.seats.length; i++){
      if (state.seats[i] && state.seats[i].seatNo === 0) return 0;
    }
    return 1;
  }

  function getSeatAnchor(index, total){
    if (total === 6 && seatAnchors[index]) return seatAnchors[index];
    var angle = (-90 + (360 / total) * index) * (Math.PI / 180);
    var rx = 36;
    var ry = 41;
    return {
      x: 50 + Math.cos(angle) * rx,
      y: 51 + Math.sin(angle) * ry
    };
  }

  function getDisplayName(seat){
    if (!seat) return 'Open seat';
    if (isCurrentUserSeat(seat)) return 'You';
    return seat.displayName || (seat.isBot ? 'Bot' : shortId(seat.userId)) || 'Player';
  }

  function renderSeatAvatar(avatar, seat){
    avatar.textContent = '';
    if (!seat){
      avatar.textContent = '+';
      return;
    }

    var fallback = document.createElement('span');
    fallback.className = 'poker-seat-avatar__initials';
    fallback.textContent = initials(getDisplayName(seat));
    avatar.appendChild(fallback);

    var imageUrl = seat.isBot && seat.botPresentation ? seat.botPresentation.avatarPath : '';
    var profileAvatar = !seat.isBot && seat.profile && seat.profile.avatar;
    if (!imageUrl && !profileAvatar) return;
    if (!imageUrl && profileAvatar.type === 'default'){
      avatar.dataset.avatarVariant = profileAvatar.variant;
      return;
    }
    if (!imageUrl && profileAvatar.type === 'uploaded') imageUrl = profileAvatar.url;
    if (!imageUrl) return;

    if (loadedSeatAvatarUrls[imageUrl] === true){
      fallback.hidden = true;
      avatar.classList.add('poker-seat-avatar--image');
    }

    var image = document.createElement('img');
    image.className = 'poker-seat-avatar__image';
    image.alt = '';
    image.decoding = 'async';
    image.addEventListener('load', function(){
      loadedSeatAvatarUrls[imageUrl] = true;
      fallback.hidden = true;
      avatar.classList.add('poker-seat-avatar--image');
    }, { once: true });
    image.addEventListener('error', function(){
      delete loadedSeatAvatarUrls[imageUrl];
      if (image.parentNode === avatar) avatar.removeChild(image);
      fallback.hidden = false;
      avatar.classList.remove('poker-seat-avatar--image');
    }, { once: true });
    image.src = imageUrl;
    avatar.appendChild(image);
  }

  function findSeatTurnClock(avatar){
    if (!avatar || !avatar.children) return null;
    for (var i = 0; i < avatar.children.length; i++){
      var child = avatar.children[i];
      if (child && child.classList && child.classList.contains('poker-seat-turn-clock')) return child;
    }
    return null;
  }

  function updateSeatTurnClock(avatar, turnClock){
    if (!avatar) return;
    var clock = findSeatTurnClock(avatar);
    if (!turnClock){
      if (clock && clock.parentNode === avatar) avatar.removeChild(clock);
      return;
    }
    if (!clock){
      clock = document.createElement('div');
      clock.setAttribute('aria-hidden', 'true');
      avatar.appendChild(clock);
    }
    clock.className = 'poker-seat-turn-clock' + (turnClock.remainingSeconds <= 5 ? ' poker-seat-turn-clock--warning' : '');
    clock.style.setProperty('--turn-progress', String(turnClock.ratio));
    clock.style.setProperty('--turn-hue', String(Math.max(0, Math.min(120, Math.round(turnClock.ratio * 120)))));
  }

  function refreshSeatTurnClock(){
    var activeSeatNo = null;
    for (var i = 0; i < state.seats.length; i++){
      var seat = state.seats[i];
      if (seat && seat.userId && seat.userId === state.turnUserId){
        activeSeatNo = seat.seatNo;
        break;
      }
    }
    var turnClock = activeSeatNo == null ? null : getTurnClockState();
    Object.keys(renderedSeatAvatars).forEach(function(seatNo){
      updateSeatTurnClock(renderedSeatAvatars[seatNo], Number(seatNo) === activeSeatNo ? turnClock : null);
    });
  }

  function getSeatLastBettingRoundAction(seat){
    if (!seat || !state.lastBettingRoundActionByUserId) return null;
    if (typeof seat.userId === 'string' && state.lastBettingRoundActionByUserId[seat.userId]){
      return state.lastBettingRoundActionByUserId[seat.userId];
    }
    if (isCurrentUserSeat(seat) && state.currentUserId && state.lastBettingRoundActionByUserId[state.currentUserId]){
      return state.lastBettingRoundActionByUserId[state.currentUserId];
    }
    return null;
  }

  function getSeatActionBadgePosition(slotIndex, hero){
    var radius = hero ? 48 : 38;
    var centerX = 50;
    var centerY = hero ? 48 : 38;
    var distance = radius + 8;
    var x = centerX;
    var y = centerY;
    if (hero) return { left: '38px', top: '-28px' };
    if (slotIndex === 0) y -= distance;
    else if (slotIndex === 1) { x += distance; y -= 4; }
    else if (slotIndex === 2) { x += distance; y += 4; }
    else if (slotIndex === 3) y += distance;
    else if (slotIndex === 4) { x -= distance; y += 4; }
    else if (slotIndex === 5) { x -= distance; y -= 4; }
    return { left: x + 'px', top: y + 'px' };
  }

  function getSeatStatusBadgePosition(slotIndex, hero){
    var actionPosition = getSeatActionBadgePosition(slotIndex, hero);
    return {
      left: actionPosition.left,
      top: (parseFloat(actionPosition.top) + 24) + 'px'
    };
  }

  function shortId(value){
    var text = typeof value === 'string' ? value.trim() : '';
    if (!text) return '';
    return text.length <= 8 ? text : text.slice(0, 8);
  }

  function normalizeTimerMs(value){
    var numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? Math.trunc(numeric) : null;
  }

  function getTurnClockState(){
    var deadlineAt = normalizeTimerMs(state.turnDeadlineAt);
    if (!deadlineAt || !state.turnUserId) return null;
    var startedAt = normalizeTimerMs(state.turnStartedAt);
    var totalMs = startedAt && deadlineAt > startedAt ? (deadlineAt - startedAt) : 20_000;
    var remainingMs = Math.max(0, deadlineAt - Date.now());
    return {
      remainingMs: remainingMs,
      remainingSeconds: Math.ceil(remainingMs / 1000),
      ratio: totalMs > 0 ? Math.max(0, Math.min(1, remainingMs / totalMs)) : 0
    };
  }

  function getSettlementAwardLabel(award){
    if (!award) return '';
    if (award.kind === 'main') return t('pokerSettlementMainPot', 'Main pot');
    if (award.kind === 'side') return tf('pokerSettlementSidePot', { number: award.sidePotNumber }, 'Side pot {number}');
    if (award.kind === 'return') return t('pokerSettlementReturned', 'Returned');
    return '';
  }

  function hasWonContestedPot(seat){
    if (!seat || typeof seat.userId !== 'string') return false;
    return getSeatSettlementAwards(seat.userId).some(function(award){ return award.kind === 'main' || award.kind === 'side'; });
  }

  function hasReturnedChips(seat){
    if (!seat || typeof seat.userId !== 'string') return false;
    return getSeatSettlementAwards(seat.userId).some(function(award){ return award.kind === 'return'; });
  }

  function shouldShowShowdownHandSummary(seat){
    if (!seat || typeof seat.userId !== 'string') return false;
    if (getSeatSettlementAwards(seat.userId).length) return true;
    if (state.showdown && Array.isArray(state.showdown.winners) && state.showdown.winners.indexOf(seat.userId) !== -1) return true;
    var sticky = getActiveWinnerReveal();
    return !!(sticky && Array.isArray(sticky.showdownWinnerUserIds) && sticky.showdownWinnerUserIds.indexOf(seat.userId) !== -1);
  }

  function getSeatRevealCards(seat){
    if (!seat || typeof seat.userId !== 'string') return null;
    var revealed = state.revealedShowdownCardsByUserId && state.revealedShowdownCardsByUserId[seat.userId];
    if ((!Array.isArray(revealed) || revealed.length !== 2) && getActiveWinnerReveal()){
      revealed = stickyWinnerReveal.revealedShowdownCardsByUserId[seat.userId];
    }
    return Array.isArray(revealed) && revealed.length === 2 ? revealed : null;
  }

  function getWinnerHandSummary(seat){
    if (!seat || typeof seat.userId !== 'string') return null;
    var revealCards = getSeatRevealCards(seat);
    if (!Array.isArray(revealCards) || revealCards.length !== 2) return null;
    var boardCards = getDisplayCommunityCards();
    if (!Array.isArray(boardCards) || boardCards.length < 3) return null;
    var best = evaluateViewerBestHand(revealCards.concat(boardCards));
    if (!best || !Array.isArray(best.cards) || best.cards.length !== 5) return null;
    return {
      label: formatViewerHandCategory(best.category),
      cards: best.cards.slice(0, 5)
    };
  }

  function buildChipBreakdown(amount){
    var safeAmount = Math.max(0, Math.floor(Number(amount) || 0));
    var out = [];
    for (var i = 0; i < CHIP_DENOMINATIONS.length; i++){
      var denom = CHIP_DENOMINATIONS[i];
      var count = Math.floor(safeAmount / denom.value);
      safeAmount = safeAmount % denom.value;
      if (count > 0) out.push({ value: denom.value, color: denom.color, count: count });
    }
    return out;
  }

  function compressChipBreakdown(breakdown, maxVisible){
    var max = Math.max(1, Math.floor(Number(maxVisible) || 1));
    var total = 0;
    (breakdown || []).forEach(function(entry){ total += entry.count; });
    if (!total || total <= max) return breakdown || [];
    var visible = [];
    var allocated = 0;
    (breakdown || []).forEach(function(entry){
      var exact = (entry.count / total) * max;
      var scaled = Math.floor(exact);
      if (scaled < 1) scaled = 1;
      visible.push({ value: entry.value, color: entry.color, count: scaled, remainder: exact - scaled });
      allocated += scaled;
    });
    while (allocated > max){
      var reduced = false;
      for (var i = 0; i < visible.length && allocated > max; i++){
        if (visible[i].count > 1){
          visible[i].count -= 1;
          allocated -= 1;
          reduced = true;
        }
      }
      if (!reduced) break;
    }
    while (allocated < max && visible.length){
      visible.sort(function(left, right){ return right.remainder - left.remainder; });
      visible[0].count += 1;
      allocated += 1;
    }
    visible.sort(function(left, right){ return right.value - left.value; });
    visible.forEach(function(entry){ delete entry.remainder; });
    return visible;
  }

  function resolveFlyChipColorFromAmount(amount){
    var breakdown = buildChipBreakdown(amount);
    if (breakdown.length) return breakdown[0].color;
    return 'white';
  }

  function splitChipBreakdownIntoStacks(breakdown){
    var stacks = [];
    (breakdown || []).slice().reverse().forEach(function(entry){
      var remaining = Math.max(0, Math.floor(entry.count || 0));
      while (remaining > 0){
        var chipCount = Math.min(CHIP_STACK_MAX_HEIGHT, remaining);
        stacks.push({ value: entry.value, color: entry.color, count: chipCount });
        remaining -= chipCount;
      }
    });
    return stacks;
  }

  function buildVisibleChipModels(amount, maxVisibleStacks){
    var maxVisibleChips = Math.max(1, Math.floor(Number(maxVisibleStacks) || 1)) * CHIP_STACK_MAX_HEIGHT;
    return splitChipBreakdownIntoStacks(compressChipBreakdown(buildChipBreakdown(amount), maxVisibleChips));
  }

  function resolveStackMaxVisible(variant){
    if (variant === 'pot') return 9;
    if (variant === 'seat-stack' || variant === 'hero-seat-stack') return 7;
    return 5;
  }

  function resolveTotalVisibleChipCount(stacks){
    var total = 0;
    (stacks || []).forEach(function(stack){ total += stack.count; });
    return total;
  }

  function resolveStackSizeClass(stacks){
    var stackCount = (stacks || []).length;
    var chipCount = resolveTotalVisibleChipCount(stacks);
    if (chipCount <= 1) return 'tiny';
    if (chipCount <= 5 && stackCount <= 1) return 'small';
    if (chipCount <= 15 && stackCount <= 4) return 'medium';
    if (chipCount <= 30) return 'large';
    return 'huge';
  }

  function resolveStackColumnCount(stackCount){
    if (stackCount > 6) return 3;
    if (stackCount > 2) return 2;
    return 1;
  }

  function resolveChipStackAsset(color, chipCount){
    var safeColor = CHIP_ASSET_COLORS[color] ? color : 'white';
    var safeCount = Math.max(1, Math.min(CHIP_STACK_MAX_HEIGHT, Math.floor(Number(chipCount) || 1)));
    return 'assets/chips/chip-' + safeColor + '-' + safeCount + '.png';
  }

  function createChipFlyAsset(color){
    var wrap = document.createElement('span');
    wrap.className = 'poker-chip-fly';
    var img = document.createElement('img');
    img.className = 'poker-chip-fly-img';
    img.alt = '';
    img.setAttribute('aria-hidden', 'true');
    img.decoding = 'async';
    img.src = resolveChipStackAsset(color, 1);
    wrap.appendChild(img);
    return wrap;
  }

  function createChipStackVisual(amount, variant){
    var wrap = document.createElement('div');
    var chips = buildVisibleChipModels(amount, resolveStackMaxVisible(variant));
    var sizeClass = resolveStackSizeClass(chips);
    wrap.className = 'poker-chip-visual-stack poker-chip-visual-stack--' + sizeClass + (variant ? (' poker-chip-visual-stack--' + variant) : '');
    wrap.setAttribute('data-chip-count', String(resolveTotalVisibleChipCount(chips)));
    wrap.setAttribute('data-stack-count', String(chips.length));
    wrap.setAttribute('data-amount', String(Math.max(0, Math.floor(Number(amount) || 0))));
    if (!chips.length) return wrap;
    var columns = resolveStackColumnCount(chips.length);
    for (var i = 0; i < chips.length; i++){
      var chip = chips[i];
      var column = columns === 1 ? 0 : i % columns;
      var row = columns === 1 ? i : Math.floor(i / columns);
      var columnOffset = (column - ((columns - 1) / 2)) * (columns === 3 ? 33 : 39);
      var stagger = columns > 1 && row % 2 ? 3 : 0;
      var verticalOffset = row * 12 + (columns > 1 ? column * 3 : 0);
      var img = document.createElement('img');
      img.className = 'poker-chip-stack-chip poker-chip-stack-chip--' + chip.color;
      img.alt = '';
      img.setAttribute('aria-hidden', 'true');
      img.setAttribute('data-value', String(chip.value));
      img.setAttribute('data-chip-count', String(chip.count));
      img.decoding = 'async';
      img.src = resolveChipStackAsset(chip.color, chip.count);
      img.style.setProperty('--chip-x', Math.round(columnOffset + stagger) + 'px');
      img.style.setProperty('--chip-y', '-' + Math.round(verticalOffset) + 'px');
      img.style.setProperty('--chip-z', String(10 + i));
      wrap.appendChild(img);
    }
    return wrap;
  }

  function appendSeatStackAmountLabel(stackEl, amount){
    if (!stackEl) return;
    var label = document.createElement('span');
    label.className = 'poker-chip-stack-label';
    label.textContent = formatNumber(amount);
    stackEl.appendChild(label);
  }

  function clampNumber(value, min, max){
    return Math.max(min, Math.min(max, value));
  }

  function formatScenePercent(value){
    return (Math.round(value * 10) / 10) + '%';
  }

  function getSeatAvatarAnchorFromRect(seatNo){
    if (!els.scene || !renderedSeatAvatars[seatNo]) return null;
    if (typeof els.scene.getBoundingClientRect !== 'function' || typeof renderedSeatAvatars[seatNo].getBoundingClientRect !== 'function') return null;
    var sceneRect = els.scene.getBoundingClientRect();
    var avatarRect = renderedSeatAvatars[seatNo].getBoundingClientRect();
    if (!sceneRect || !avatarRect || sceneRect.width <= 0 || sceneRect.height <= 0 || avatarRect.width <= 0 || avatarRect.height <= 0) return null;
    var centerX = ((avatarRect.left + avatarRect.width / 2) - sceneRect.left) / sceneRect.width * 100;
    var centerY = ((avatarRect.top + avatarRect.height / 2) - sceneRect.top) / sceneRect.height * 100;
    var radiusX = (avatarRect.width / 2) / sceneRect.width * 100;
    var radiusY = (avatarRect.height / 2) / sceneRect.height * 100;
    return {
      x: centerX,
      y: centerY,
      radiusX: radiusX,
      radiusY: radiusY,
      sceneWidth: sceneRect.width,
      sceneHeight: sceneRect.height
    };
  }

  function resolveSeatChipDirections(anchor){
    var dx = anchor.x - 50;
    var dy = anchor.y - 50;
    var horizontal = Math.abs(dx) >= Math.abs(dy);
    if (horizontal){
      var sideX = dx >= 0 ? -1 : 1;
      return {
        bet: { x: sideX, y: -0.42 },
        stack: { x: sideX, y: 0.42 }
      };
    }
    var sideY = dy >= 0 ? -1 : 1;
    return {
      bet: { x: -0.42, y: sideY },
      stack: { x: 0.42, y: sideY }
    };
  }

  function normalizeDirection(vector){
    var length = Math.sqrt(vector.x * vector.x + vector.y * vector.y) || 1;
    return {
      x: vector.x / length,
      y: vector.y / length
    };
  }

  function keepSeatChipOutOfCenterLane(point, source){
    var centerLane = { left: 33, right: 67, top: 31, bottom: 57 };
    if (point.x < centerLane.left || point.x > centerLane.right || point.y < centerLane.top || point.y > centerLane.bottom) return point;
    var dx = source.x - 50;
    var dy = source.y - 50;
    if (Math.abs(dx) >= Math.abs(dy)){
      point.x = dx >= 0 ? centerLane.right + 3 : centerLane.left - 3;
    } else {
      point.y = dy >= 0 ? centerLane.bottom + 3 : centerLane.top - 3;
    }
    return point;
  }

  function resolveVisualHalfPercent(source, axis, fallback){
    if (!source) return fallback;
    var sceneSize = axis === 'x' ? source.sceneWidth : source.sceneHeight;
    var visualSize = axis === 'x' ? HERO_SEAT_STACK_VISUAL.width : HERO_SEAT_STACK_VISUAL.height;
    if (!Number.isFinite(sceneSize) || sceneSize <= 0) return fallback;
    return ((visualSize * HERO_SEAT_STACK_VISUAL.scale) / 2) / sceneSize * 100;
  }

  function resolveHeroSeatStackPoint(source){
    var halfX = resolveVisualHalfPercent(source, 'x', 8);
    var halfY = resolveVisualHalfPercent(source, 'y', 4);
    var gapX = source.sceneWidth ? Math.max(2, 8 / source.sceneWidth * 100) : 3;
    var point = {
      x: source.x + source.radiusX + halfX + gapX,
      y: source.y + Math.min(1.6, source.radiusY * 0.15)
    };
    point.x = clampNumber(point.x, 10, 90);
    point.y = clampNumber(point.y, 12 + halfY, 86);
    return point;
  }

  function resolveSeatChipPoint(source, direction){
    var unit = normalizeDirection(direction);
    var edgeDistance = Math.sqrt(Math.pow(unit.x * source.radiusX, 2) + Math.pow(unit.y * source.radiusY, 2));
    var gap = 7;
    var point = {
      x: source.x + unit.x * (edgeDistance + gap),
      y: source.y + unit.y * (edgeDistance + gap)
    };
    point = keepSeatChipOutOfCenterLane(point, source);
    point.x = clampNumber(point.x, 10, 90);
    point.y = clampNumber(point.y, 12, 88);
    return point;
  }

  function getSeatChipAnchor(anchor, seat){
    var seatNo = seat && Number.isInteger(seat.seatNo) ? seat.seatNo : null;
    var source = getSeatAvatarAnchorFromRect(seatNo) || { x: anchor.x, y: anchor.y, radiusX: 8, radiusY: 5 };
    var directions = resolveSeatChipDirections(source);
    return {
      bet: resolveSeatChipPoint(source, directions.bet),
      stack: isCurrentUserSeat(seat) ? resolveHeroSeatStackPoint(source) : resolveSeatChipPoint(source, directions.stack)
    };
  }

  function renderSeatChips(){
    if (!els.seatChipLayer) return;
    els.seatChipLayer.innerHTML = '';
    renderedSeatBetAnchors = {};
    renderedSeatStackAnchors = {};
    state.seats.forEach(function(seat){
      if (!seat || !Number.isInteger(seat.seatNo) || !seat.userId) return;
      var anchor = renderedSeatAnchors[seat.seatNo];
      var slot = renderedSeatSlots[seat.seatNo];
      if (!anchor || !Number.isInteger(slot)) return;
      var chipAnchor = getSeatChipAnchor(anchor, seat);
      renderedSeatBetAnchors[seat.seatNo] = chipAnchor.bet;
      renderedSeatStackAnchors[seat.seatNo] = chipAnchor.stack;
      var committed = Math.max(0, Number(seatCommittedByUserId[seat.userId]) || 0);
      if (committed > 0){
        var betStack = createChipStackVisual(committed, 'seat-bet');
        betStack.style.left = chipAnchor.bet.x + '%';
        betStack.style.top = chipAnchor.bet.y + '%';
        els.seatChipLayer.appendChild(betStack);
      }
      var stackAmount = Math.max(0, Number(resolveStack(seat.userId)) || 0);
      if (stackAmount > 0){
        var seatStack = createChipStackVisual(stackAmount, isCurrentUserSeat(seat) ? 'hero-seat-stack' : 'seat-stack');
        appendSeatStackAmountLabel(seatStack, stackAmount);
        seatStack.style.left = chipAnchor.stack.x + '%';
        seatStack.style.top = chipAnchor.stack.y + '%';
        els.seatChipLayer.appendChild(seatStack);
      }
    });
  }

  function renderPotChips(){
    if (!els.potChipStack) return;
    els.potChipStack.innerHTML = '';
    if ((Number(state.potTotal) || 0) <= 0) return;
    els.potChipStack.appendChild(createChipStackVisual(state.potTotal, 'pot'));
  }

  function resolvePointFromPercent(anchor, rect){
    if (!anchor || !rect || rect.width <= 0 || rect.height <= 0) return null;
    return {
      x: rect.width * (anchor.x / 100),
      y: rect.height * (anchor.y / 100)
    };
  }

  function spawnChipFly(fromPoint, toPoint, color, delayMs, durationMs){
    if (!els.chipFxLayer || !fromPoint || !toPoint) return null;
    var tone = color || 'white';
    var fly = createChipFlyAsset(tone);
    fly.style.left = Math.round(fromPoint.x) + 'px';
    fly.style.top = Math.round(fromPoint.y) + 'px';
    var resolvedDurationMs = Number.isFinite(durationMs) && durationMs > 0 ? durationMs : CHIP_FLY_MS;
    fly.style.animationDuration = resolvedDurationMs + 'ms';
    fly.style.animationDelay = Math.max(0, delayMs || 0) + 'ms';
    fly.style.setProperty('--chip-dx', Math.round(toPoint.x - fromPoint.x) + 'px');
    fly.style.setProperty('--chip-dy', Math.round(toPoint.y - fromPoint.y) + 'px');
    els.chipFxLayer.appendChild(fly);
    window.setTimeout(function(){ if (fly && fly.parentNode) fly.parentNode.removeChild(fly); }, resolvedDurationMs + Math.max(0, delayMs || 0) + 40);
    return fly;
  }

  function resolveBetAnimationUserIds(previousVisual, nextVisual){
    var ids = [];
    var seen = {};
    state.seats.forEach(function(seat){
      if (!seat || !seat.userId) return;
      var beforeCommit = Number(previousVisual.committedByUserId[seat.userId]) || 0;
      var afterCommit = Number(nextVisual.committedByUserId[seat.userId]) || 0;
      var delta = Math.max(0, Math.round(afterCommit - beforeCommit));
      if (!delta) return;
      seen[seat.userId] = true;
      ids.push(seat.userId);
    });
    if (ids.length) return ids;
    state.seats.forEach(function(seat){
      if (!seat || !seat.userId || seen[seat.userId]) return;
      var beforeAction = previousVisual.lastActionByUserId[seat.userId] || null;
      var afterAction = nextVisual.lastActionByUserId[seat.userId] || null;
      if (beforeAction === afterAction) return;
      if (afterAction === 'call' || afterAction === 'raise' || afterAction === 'all_in'){
        seen[seat.userId] = true;
        ids.push(seat.userId);
      }
    });
    return ids;
  }

  function prefersReducedMotion(){
    try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (_err){ return false; }
  }

  function cancelSettlementAnimations(){
    settlementAnimationGeneration += 1;
    settlementAnimationTimers.forEach(function(timerId){
      try { window.clearTimeout(timerId); } catch (_err){}
    });
    settlementAnimationTimers = [];
    settlementAnimationNodes.forEach(function(node){
      if (node && node.parentNode) node.parentNode.removeChild(node);
    });
    settlementAnimationNodes = [];
  }

  function animateSettlementAwards(previousVisual, nextVisual, sceneRect, potFrom, frame){
    var presentation = nextVisual && nextVisual.settlementPresentation;
    if (!presentation || !presentation.valid || !Array.isArray(presentation.pots) || !presentation.pots.length) return;
    if (!frame || frame.initial || frame.suppressSettlementAnimation) return;
    if (frame.kind !== 'statePatch' && frame.kind !== 'stateSnapshot') return;
    if (!previousVisual || previousVisual.phase === 'SETTLED' || nextVisual.phase !== 'SETTLED') return;
    if (!nextVisual.handId || previousVisual.handId !== nextVisual.handId || presentation.handId !== nextVisual.handId) return;
    if (lastAnimatedSettlementHandId === presentation.handId || prefersReducedMotion()) return;
    lastAnimatedSettlementHandId = presentation.handId;
    cancelSettlementAnimations();
    var generation = settlementAnimationGeneration;
    var seatByUserId = {};
    state.seats.forEach(function(seat){ if (seat && seat.userId) seatByUserId[seat.userId] = seat; });
    var availableMs = Math.max(200, WINNER_REVEAL_MS - SETTLEMENT_CHIP_FLY_MS - 240);
    var stepGapMs = Math.min(480, Math.max(150, Math.floor(availableMs / Math.max(1, presentation.pots.length))));
    presentation.pots.forEach(function(pot, potIndex){
      var timerId = window.setTimeout(function(){
        if (generation !== settlementAnimationGeneration || state.handId !== presentation.handId) return;
        pot.recipients.forEach(function(recipient, recipientIndex){
          var seat = seatByUserId[recipient.userId];
          if (!seat || !Number.isInteger(seat.seatNo)) return;
          var target = resolvePointFromPercent(renderedSeatStackAnchors[seat.seatNo] || renderedSeatBetAnchors[seat.seatNo], sceneRect);
          if (!target) return;
          var color = resolveFlyChipColorFromAmount(recipient.amount);
          for (var chipIndex = 0; chipIndex < 3; chipIndex++){
            var fly = spawnChipFly(potFrom, target, color, recipientIndex * 34 + chipIndex * 42, SETTLEMENT_CHIP_FLY_MS);
            if (!fly) continue;
            fly.classList.add('poker-chip-fly--settlement');
            fly.dataset.settlementAnimation = presentation.handId;
            settlementAnimationNodes.push(fly);
          }
        });
      }, potIndex * stepGapMs);
      settlementAnimationTimers.push(timerId);
    });
  }

  function animateChipDiff(previousVisual, nextVisual, frame){
    if (!previousVisual || !nextVisual || !els.scene || !els.chipFxLayer) return;
    if (prefersReducedMotion()) return;
    if (typeof els.scene.getBoundingClientRect !== 'function') return;
    var sceneRect = els.scene.getBoundingClientRect();
    if (sceneRect.width <= 0 || sceneRect.height <= 0) return;
    var potFrom = resolvePointFromPercent({ x: 50, y: 44 }, sceneRect);
    var potTo = resolvePointFromPercent({ x: 50, y: 44 }, sceneRect);
    if (!potFrom || !potTo) return;
    var potIncrease = Math.max(0, Math.round((nextVisual.potTotal || 0) - (previousVisual.potTotal || 0)));
    if (potIncrease > 0){
      var candidateUsers = resolveBetAnimationUserIds(previousVisual, nextVisual);
      var sent = 0;
      state.seats.forEach(function(seat){
        if (!seat || !seat.userId || !Number.isInteger(seat.seatNo)) return;
        if (candidateUsers.indexOf(seat.userId) === -1) return;
        var from = resolvePointFromPercent(renderedSeatBetAnchors[seat.seatNo] || renderedSeatStackAnchors[seat.seatNo], sceneRect);
        if (!from) return;
        var chips = 2;
        var committedDelta = Math.max(0, (Number(nextVisual.committedByUserId[seat.userId]) || 0) - (Number(previousVisual.committedByUserId[seat.userId]) || 0));
        var chipColor = resolveFlyChipColorFromAmount(committedDelta || Math.max(1, Math.round(potIncrease / Math.max(1, candidateUsers.length))));
        for (var i = 0; i < chips; i++){
          spawnChipFly(from, potTo, chipColor, sent * 28 + i * 44);
        }
        sent += chips;
      });
    }
    animateSettlementAwards(previousVisual, nextVisual, sceneRect, potFrom, frame);
  }

  function appendShowdownHandSummary(container, seat){
    if (!container || !shouldShowShowdownHandSummary(seat)) return;
    var summary = getWinnerHandSummary(seat);
    if (!summary) return;
    var label = document.createElement('div');
    label.className = 'poker-seat-settlement-hand-label';
    label.textContent = summary.label;
    container.appendChild(label);
    var cards = document.createElement('div');
    cards.className = 'poker-seat-settlement-hand-cards';
    summary.cards.forEach(function(card){
      var normalizedCard = normalizeCard(card);
      var chip = document.createElement('span');
      chip.className = 'poker-seat-settlement-hand-card' + (normalizedCard && (normalizedCard.s === 'H' || normalizedCard.s === 'D') ? ' poker-seat-settlement-hand-card--red' : '');
      chip.textContent = normalizedCard ? (normalizedCard.r + SUIT_SYMBOLS[normalizedCard.s]) : '?';
      cards.appendChild(chip);
    });
    container.appendChild(cards);
  }

  function renderSeats(){
    if (!els.seatLayer) return;
    els.seatLayer.innerHTML = '';
    renderedSeatAnchors = {};
    renderedSeatSlots = {};
    renderedSeatAvatars = {};
    renderedSeatBetAnchors = {};
    renderedSeatStackAnchors = {};
    var offset = getSeatNumberingOffset();
    var seatsByIndex = {};
    state.seats.forEach(function(seat){
      if (!seat || !Number.isInteger(seat.seatNo)) return;
      var index = Math.max(0, seat.seatNo - offset);
      seatsByIndex[index] = seat;
    });
    var heroBestHand = getHeroBestHand();
    for (var i = 0; i < state.maxSeats; i++){
      var seat = seatsByIndex[i] || null;
      var article = document.createElement('article');
      var active = !!(seat && seat.userId && state.turnUserId && seat.userId === state.turnUserId);
      var hero = isCurrentUserSeat(seat);
      var lastAction = getSeatLastBettingRoundAction(seat);
      var folded = !!(seat && /FOLD/i.test(seat.status || ''));
      var rotatedIndex = rotateSeatIndex(i, state.maxSeats);
      var anchor = getSeatAnchor(rotatedIndex, state.maxSeats);
      if (hero && state.maxSeats >= 4) anchor = { x: 34, y: 91 };
      else if (rotatedIndex === 1 && state.maxSeats >= 6) anchor = { x: 80, y: 29 };
      else if (rotatedIndex === 2 && state.maxSeats >= 6) anchor = { x: 80, y: 58 };
      else if (rotatedIndex === 3 && state.maxSeats >= 4) anchor = { x: 52, y: 82 };
      article.className = 'poker-seat'
        + (active ? ' poker-seat--active' : '')
        + (folded ? ' poker-seat--folded' : '')
        + (seat && hasWonContestedPot(seat) ? ' poker-seat--pot-winner' : '')
        + (seat && hasReturnedChips(seat) ? ' poker-seat--returned' : '')
        + (hero ? ' poker-seat--hero' : '')
        + (!seat ? ' poker-seat--empty' : '');
      article.style.left = anchor.x + '%';
      article.style.top = anchor.y + '%';
      if (seat && Number.isInteger(seat.seatNo)) {
        renderedSeatAnchors[seat.seatNo] = anchor;
        renderedSeatSlots[seat.seatNo] = rotatedIndex;
      }

      var avatar = document.createElement('div');
      avatar.className = 'poker-seat-avatar';
      renderSeatAvatar(avatar, seat);
      if (seat && Number.isInteger(seat.seatNo)) renderedSeatAvatars[seat.seatNo] = avatar;
      if (active) updateSeatTurnClock(avatar, getTurnClockState());

      var cards = document.createElement('div');
      cards.className = 'poker-seat-cards';
      if (!hero && seat && seat.userId){
        var revealCards = getSeatRevealCards(seat);
        if (revealCards){
          revealCards.forEach(function(card){
            cards.appendChild(createCard(card));
          });
        } else {
          cards.appendChild(createCard(null, { faceDown: true }));
          cards.appendChild(createCard(null, { faceDown: true }));
        }
      }

      var name = document.createElement('div');
      name.className = 'poker-seat-name';
      name.textContent = seat ? getDisplayName(seat) : 'Seat ' + String(i + offset);

      var status = document.createElement('div');
      var statusPosition = getSeatStatusBadgePosition(rotatedIndex, hero);
      status.className = 'poker-seat-status';
      status.textContent = seat ? String(seat.status || 'ACTIVE').replace(/_/g, ' ') : 'OPEN';
      status.style.left = statusPosition.left;
      status.style.top = statusPosition.top;

      article.appendChild(avatar);
      if (seat && lastAction){
        var actionBadge = document.createElement('div');
        var badgePosition = getSeatActionBadgePosition(rotatedIndex, hero);
        actionBadge.className = 'poker-seat-action-badge poker-seat-action-badge--' + lastAction.replace(/_/g, '-');
        actionBadge.textContent = LAST_ACTION_LABEL[lastAction] || lastAction;
        actionBadge.style.left = badgePosition.left;
        actionBadge.style.top = badgePosition.top;
        article.appendChild(actionBadge);
      }
      var seatSettlementAwards = seat ? getSeatSettlementAwards(seat.userId) : [];
      var seatHasShowdownSummary = !!(seat && shouldShowShowdownHandSummary(seat) && getWinnerHandSummary(seat));
      if (seat && (seatSettlementAwards.length || seatHasShowdownSummary)){
        var settlementBadge = document.createElement('div');
        settlementBadge.className = 'poker-seat-settlement-badge';
        seatSettlementAwards.forEach(function(award){
          var awardRow = document.createElement('div');
          awardRow.className = 'poker-seat-settlement-award poker-seat-settlement-award--' + award.kind;
          awardRow.dataset.awardId = award.awardId;
          awardRow.textContent = '+' + formatNumber(award.amount) + ' ' + getSettlementAwardLabel(award);
          settlementBadge.appendChild(awardRow);
        });
        appendShowdownHandSummary(settlementBadge, seat);
        article.appendChild(settlementBadge);
      }
      if (cards.children.length) article.appendChild(cards);
      article.appendChild(name);
      article.appendChild(status);
      if (hero && heroBestHand){
        var bestHand = document.createElement('div');
        bestHand.className = 'poker-seat-best-hand';
        var bestHandName = document.createElement('span');
        bestHandName.className = 'poker-seat-best-hand-label';
        bestHandName.textContent = formatViewerHandCategory(heroBestHand.category);
        bestHand.appendChild(bestHandName);
        heroBestHand.cards.forEach(function(card){
          var chip = document.createElement('span');
          var normalized = normalizeCard(card);
          chip.className = 'poker-seat-best-hand-card' + (normalized && (normalized.s === 'H' || normalized.s === 'D') ? ' poker-seat-best-hand-card--red' : '');
          chip.textContent = normalized ? (normalized.r + SUIT_SYMBOLS[normalized.s]) : '?';
          bestHand.appendChild(chip);
        });
        article.appendChild(bestHand);
      }
      els.seatLayer.appendChild(article);
    }
  }

  function renderCommunityCards(){
    if (!els.communityCards) return;
    els.communityCards.innerHTML = '';
    var cards = getDisplayCommunityCards();
    cards.forEach(function(card){
      els.communityCards.appendChild(createCard(card));
    });
  }

  function renderHeroCards(){
    if (!els.heroCards) return;
    els.heroCards.innerHTML = '';
    if (isCurrentUserFolded()) els.heroCards.className = 'poker-hero-cards poker-hero-cards--folded';
    else els.heroCards.className = 'poker-hero-cards';
    var cards = Array.isArray(state.heroCards) ? state.heroCards : [];
    if (!cards.length){
      els.heroCards.appendChild(createCard(null, { faceDown: true }));
      els.heroCards.appendChild(createCard(null, { faceDown: true }));
      return;
    }
    cards.slice(0, 2).forEach(function(card){
      els.heroCards.appendChild(createCard(card));
    });
  }

  function positionHeroCards(){
    if (!els.heroCards) return;
    if (els.heroCards.classList && typeof els.heroCards.classList.remove === 'function') els.heroCards.classList.remove('poker-hero-cards--docked');
    els.heroCards.style.removeProperty('left');
    els.heroCards.style.removeProperty('top');
    els.heroCards.style.removeProperty('bottom');
    var heroSeat = deriveCurrentSeat();
    if (!heroSeat || !Number.isInteger(heroSeat.seatNo)){
      return;
    }
    var anchor = getSeatAvatarAnchorFromRect(heroSeat.seatNo);
    if (!anchor || anchor.sceneWidth <= 0 || anchor.sceneHeight <= 0){
      return;
    }
    var cardWidthPx = anchor.sceneWidth >= 470 ? 50 : 46;
    var cardHeightPx = anchor.sceneWidth >= 470 ? 68 : 63;
    var cardsWidth = ((cardWidthPx * 2) + 9) / anchor.sceneWidth * 100;
    var cardsHalfHeight = (cardHeightPx / anchor.sceneHeight * 100) / 2;
    var cardHalfHeightOffsetX = (cardHeightPx / 2) / anchor.sceneWidth * 100;
    var cardHalfHeightOffsetY = (cardHeightPx / 2) / anchor.sceneHeight * 100;
    var gapX = Math.max(10, Math.round(anchor.sceneWidth * 0.02)) / anchor.sceneWidth * 100;
    var gapY = Math.max(6, Math.round(anchor.sceneHeight * 0.01)) / anchor.sceneHeight * 100;
    var left = clampNumber(anchor.x + anchor.radiusX + gapX - cardHalfHeightOffsetX, 1.5, 98.5 - cardsWidth);
    var centerY = clampNumber(anchor.y + (anchor.radiusY * 0.42) + gapY + cardHalfHeightOffsetY, cardsHalfHeight + 1.5, 100);
    if (els.heroCards.classList && typeof els.heroCards.classList.add === 'function') els.heroCards.classList.add('poker-hero-cards--docked');
    els.heroCards.style.left = formatScenePercent(left);
    els.heroCards.style.top = formatScenePercent(centerY);
    els.heroCards.style.bottom = 'auto';
  }

  function renderDealerChip(){
    if (!els.dealerChip) return;
    var targetSeatNo = Number.isInteger(state.dealerSeat) ? state.dealerSeat : null;
    if (!Number.isInteger(targetSeatNo)){
      els.dealerChip.hidden = true;
      return;
    }
    var heroSeat = deriveCurrentSeat();
    var heroHasDealerChip = !!(heroSeat && Number.isInteger(heroSeat.seatNo) && heroSeat.seatNo === targetSeatNo);
    var scene = els.dealerChip.parentElement || null;
    var avatarEl = renderedSeatAvatars[targetSeatNo] || null;
    if (scene && avatarEl && typeof scene.getBoundingClientRect === 'function' && typeof avatarEl.getBoundingClientRect === 'function'){
      var sceneRect = scene.getBoundingClientRect();
      var avatarRect = avatarEl.getBoundingClientRect();
      var chipRect = els.dealerChip.getBoundingClientRect();
      if (sceneRect.width > 0 && sceneRect.height > 0 && avatarRect.width > 0 && avatarRect.height > 0){
        var avatarCenterX = (avatarRect.left - sceneRect.left) + avatarRect.width / 2;
        var avatarCenterY = (avatarRect.top - sceneRect.top) + avatarRect.height / 2;
        var sceneCenterX = sceneRect.width / 2;
        var sceneCenterY = sceneRect.height / 2;
        var avatarRadius = Math.min(avatarRect.width, avatarRect.height) / 2;
        var chipRadius = Math.min(chipRect.width || 34, chipRect.height || 34) / 2;
        if (heroHasDealerChip){
          els.dealerChip.hidden = false;
          els.dealerChip.style.left = Math.round(avatarCenterX + avatarRadius + chipRadius - 2) + 'px';
          els.dealerChip.style.top = Math.round(avatarCenterY) + 'px';
          return;
        }
        var deltaX = sceneCenterX - avatarCenterX;
        var deltaY = sceneCenterY - avatarCenterY;
        var magnitude = Math.sqrt((deltaX * deltaX) + (deltaY * deltaY));
        if (magnitude > 0){
          var unitX = deltaX / magnitude;
          var unitY = deltaY / magnitude;
          var contactDistance = avatarRadius + chipRadius - 2;
          var chipLeftPx = avatarCenterX + (unitX * contactDistance);
          var chipTopPx = avatarCenterY + (unitY * contactDistance);
          els.dealerChip.hidden = false;
          els.dealerChip.style.left = Math.round(chipLeftPx) + 'px';
          els.dealerChip.style.top = Math.round(chipTopPx) + 'px';
          return;
        }
      }
    }
    var anchor = renderedSeatAnchors[targetSeatNo] || null;
    var slotIndex = Number.isInteger(renderedSeatSlots[targetSeatNo]) ? renderedSeatSlots[targetSeatNo] : null;
    if (!anchor || slotIndex == null){
      var offset = getSeatNumberingOffset();
      var index = Math.max(0, targetSeatNo - offset);
      slotIndex = rotateSeatIndex(index, Math.max(state.maxSeats, 1));
      anchor = getSeatAnchor(slotIndex, Math.max(state.maxSeats, 1));
      if (slotIndex === 1 && state.maxSeats >= 6) anchor = { x: 80, y: 29 };
      else if (slotIndex === 2 && state.maxSeats >= 6) anchor = { x: 80, y: 58 };
      else if (slotIndex === 3 && state.maxSeats >= 4) anchor = { x: 52, y: 82 };
      var heroSeat = deriveCurrentSeat();
      if (heroSeat && Number.isInteger(heroSeat.seatNo) && heroSeat.seatNo === targetSeatNo && state.maxSeats >= 4){
        anchor = { x: 34, y: 91 };
        slotIndex = 3;
      }
    }
    var chipOffset = { x: 0, y: 7 };
    if (heroHasDealerChip) chipOffset = { x: 20, y: 0 };
    else if (slotIndex === 0) chipOffset = { x: 8, y: 7 };
    else if (slotIndex === 1) chipOffset = { x: -8, y: 8 };
    else if (slotIndex === 2) chipOffset = { x: -8, y: 7 };
    else if (slotIndex === 3) chipOffset = { x: -32, y: 3 };
    else if (slotIndex === 4) chipOffset = { x: 8, y: 7 };
    else if (slotIndex === 5) chipOffset = { x: 8, y: 8 };
    els.dealerChip.hidden = false;
    els.dealerChip.style.left = (anchor.x + chipOffset.x) + '%';
    els.dealerChip.style.top = (anchor.y + chipOffset.y) + '%';
  }

  function isWsReady(){
    return !!(state.wsReady && wsClient && typeof wsClient.isReady === 'function' && wsClient.isReady());
  }

  function currentPlayerStatus(){
    return state.playerState && typeof state.playerState.status === 'string' ? state.playerState.status : 'ACTIVE';
  }

  function isPlayerSittingOut(){
    var status = currentPlayerStatus();
    return status === 'OUT_OF_CHIPS' || status === 'WAITING_NEXT_HAND';
  }

  function refreshRebuyBalance(){
    if (rebuyBalanceLoading || !els.rebuyBalance || !window.ChipsClient || typeof window.ChipsClient.fetchBalance !== 'function') return;
    rebuyBalanceLoading = true;
    Promise.resolve(window.ChipsClient.fetchBalance()).then(function(balance){
      var amount = balance && Number.isFinite(Number(balance.balance)) ? Number(balance.balance) : Number(balance);
      if (Number.isFinite(amount)) els.rebuyBalance.textContent = 'Balance: ' + formatNumber(amount) + ' CH · Buy-in: 100 CH';
    }).catch(function(){
      els.rebuyBalance.textContent = 'Buy-in: 100 CH';
    }).then(function(){
      rebuyBalanceLoading = false;
    });
  }

  function renderRebuyPanel(){
    if (!els.rebuyPanel) return;
    var playerState = state.playerState || null;
    var outOfChips = !!playerState && playerState.status === 'OUT_OF_CHIPS';
    var waiting = !!playerState && playerState.status === 'WAITING_NEXT_HAND';
    var show = ((outOfChips && playerState.canRebuy === true) || waiting) && !rebuyPanelDismissed;
    els.rebuyPanel.hidden = !show;
    if (!show) return;
    if (els.rebuyTitle) els.rebuyTitle.textContent = waiting ? 'Buy-in confirmed' : 'Out of chips';
    if (els.rebuyCopy) els.rebuyCopy.textContent = waiting ? 'Funded · Joining next hand' : 'The table will keep playing. Buy in to join the next hand.';
    if (els.rebuyBtn) {
      els.rebuyBtn.hidden = waiting;
      els.rebuyBtn.disabled = rebuyInFlight || !isWsReady() || playerState.canRebuy !== true;
      els.rebuyBtn.textContent = rebuyInFlight ? 'Buying in…' : 'Buy in 100 CH';
    }
    if (els.rebuyLobbyBtn) els.rebuyLobbyBtn.disabled = rebuyInFlight || !isWsReady();
    if (outOfChips) refreshRebuyBalance();
  }

  function renderInfoPanel(){
    if (els.liveStatus) els.liveStatus.textContent = state.statusText || '';
    if (els.tableMeta) {
      var parts = [];
      if (state.tableId) parts.push('Table ' + shortId(state.tableId));
      parts.push(state.phase || state.tableStatus || 'LOBBY');
      parts.push('Pot ' + formatNumber(state.potTotal || 0));
      els.tableMeta.textContent = parts.join(' • ');
    }
    if (els.errorText){
      els.errorText.textContent = state.errorText || '';
      els.errorText.hidden = !state.errorText;
    }
    if (els.turnText){
      if (currentPlayerStatus() === 'OUT_OF_CHIPS'){
        els.turnText.textContent = 'Out of chips · Sitting out';
      } else if (currentPlayerStatus() === 'WAITING_NEXT_HAND'){
        els.turnText.textContent = 'Funded · Joining next hand';
      } else if (isUsersTurn()){
        els.turnText.textContent = 'Your turn.';
      } else if (state.turnUserId){
        els.turnText.textContent = 'Acting: ' + shortId(state.turnUserId);
      } else {
        els.turnText.textContent = 'Waiting for action';
      }
    }
    if (els.xpBadge) els.xpBadge.hidden = !!isGuestMode;
    if (els.guestPanel) els.guestPanel.hidden = !isGuestMode;
    renderRebuyPanel();
  }

  function resolvePrimaryAction(allowed){
    if (allowed.indexOf('CHECK') !== -1) return 'CHECK';
    if (allowed.indexOf('CALL') !== -1) return 'CALL';
    return null;
  }

  function resolveAmountAction(allowed){
    if (allowed.indexOf('RAISE') !== -1) return 'RAISE';
    if (allowed.indexOf('BET') !== -1) return 'BET';
    return null;
  }

  function resolveAllInPlan(allowed){
    var stackAmount = resolveStack(state.currentUserId);
    if (!stackAmount || stackAmount < 1) return null;
    var constraints = state.actionConstraints || {};
    var toCall = Number.isFinite(constraints.toCall) ? Math.max(0, Math.trunc(constraints.toCall)) : null;
    if (allowed.indexOf('CALL') !== -1 && toCall != null && toCall > 0 && stackAmount <= toCall){
      return { type: 'CALL', amount: null };
    }
    if (allowed.indexOf('RAISE') !== -1 && Number.isFinite(constraints.maxRaiseTo)){
      var maxRaiseTo = Math.max(1, Math.trunc(constraints.maxRaiseTo));
      return { type: 'RAISE', amount: maxRaiseTo };
    }
    if (allowed.indexOf('BET') !== -1){
      var maxBet = Number.isFinite(constraints.maxBetAmount) ? Math.max(1, Math.trunc(constraints.maxBetAmount)) : stackAmount;
      return { type: 'BET', amount: maxBet };
    }
    return null;
  }

  function canQueueAllInPreaction(){
    var stackAmount = resolveStack(state.currentUserId);
    return stackAmount == null || stackAmount > 0;
  }

  function resolveAmountBounds(amountAction, stackAmount){
    if (!amountAction) return null;
    var constraints = state.actionConstraints || {};
    var min = amountAction === 'RAISE' && Number.isFinite(constraints.minRaiseTo) ? Math.max(1, Math.trunc(constraints.minRaiseTo)) : 1;
    var max = amountAction === 'RAISE'
      ? (Number.isFinite(constraints.maxRaiseTo) ? Math.max(min, Math.trunc(constraints.maxRaiseTo)) : null)
      : (Number.isFinite(constraints.maxBetAmount) ? Math.max(1, Math.trunc(constraints.maxBetAmount)) : stackAmount);
    var defaultAmount = Math.min(max != null ? max : 20, Math.max(min, 20));
    return {
      min: min,
      max: max != null ? max : null,
      defaultAmount: defaultAmount
    };
  }

  function syncAmountInput(bounds){
    if (!els.amountInput) return null;
    if (!bounds) return parseInt(els.amountInput.value, 10) || 20;
    els.amountInput.min = String(bounds.min);
    if (bounds.max != null) els.amountInput.max = String(bounds.max);
    else els.amountInput.removeAttribute('max');
    var value = parseInt(els.amountInput.value, 10);
    if (!Number.isFinite(value) || value < bounds.min || (bounds.max != null && value > bounds.max)){
      value = bounds.defaultAmount;
      els.amountInput.value = String(value);
    }
    return value;
  }

  function clearQueuedPreaction(){
    queuedPreaction = null;
  }

  function resetQueuedPreactionState(){
    queuedPreaction = null;
    queuedPreactionInFlight = false;
  }

  function getPreactionInput(slot){
    if (slot === 'fold') return els.foldPreaction;
    if (slot === 'primary') return els.primaryPreaction;
    if (slot === 'amount') return els.amountPreaction;
    if (slot === 'allIn') return els.allInPreaction;
    return null;
  }

  function readQueuedAmount(){
    var value = els.amountInput ? parseInt(els.amountInput.value, 10) : NaN;
    return Number.isFinite(value) ? Math.trunc(value) : null;
  }

  function buildQueuedPreaction(slot){
    if (slot === 'fold') return { slot: 'fold', action: 'FOLD', amount: null };
    if (slot === 'primary'){
      var primaryAction = els.primaryPreaction ? (els.primaryPreaction.dataset.action || '') : '';
      return primaryAction ? { slot: 'primary', action: primaryAction, amount: null } : null;
    }
    if (slot === 'amount'){
      var amountAction = els.amountPreaction ? (els.amountPreaction.dataset.action || '') : '';
      var amount = readQueuedAmount();
      return amountAction && Number.isFinite(amount) ? { slot: 'amount', action: amountAction, amount: amount } : null;
    }
    if (slot === 'allIn') return { slot: 'allIn', action: null, amount: null };
    return null;
  }

  function syncQueuedPreactionWithPreactionState(preactionState){
    if (!queuedPreaction || !preactionState) return;
    if (queuedPreaction.slot === 'fold'){
      if (!preactionState.foldVisible) clearQueuedPreaction();
      return;
    }
    if (queuedPreaction.slot === 'primary'){
      if (!preactionState.primaryAction || queuedPreaction.action !== preactionState.primaryAction) clearQueuedPreaction();
      return;
    }
    if (queuedPreaction.slot === 'amount'){
      if (!preactionState.amountAction || queuedPreaction.action !== preactionState.amountAction || !preactionState.amountBounds){
        clearQueuedPreaction();
        return;
      }
      var queuedAmount = readQueuedAmount();
      if (!Number.isFinite(queuedAmount) || queuedAmount < preactionState.amountBounds.min || (preactionState.amountBounds.max != null && queuedAmount > preactionState.amountBounds.max)){
        clearQueuedPreaction();
        return;
      }
      queuedPreaction.amount = queuedAmount;
      return;
    }
    if (queuedPreaction.slot === 'allIn' && !preactionState.allInAvailable) clearQueuedPreaction();
  }

  function resolveQueuedPreactionExecution(liveState){
    if (!queuedPreaction || !liveState) return null;
    if (queuedPreaction.slot === 'fold') return liveState.foldVisible ? { action: 'FOLD', amount: null } : null;
    if (queuedPreaction.slot === 'primary'){
      return queuedPreaction.action && queuedPreaction.action === liveState.primaryAction
        ? { action: queuedPreaction.action, amount: null }
        : null;
    }
    if (queuedPreaction.slot === 'amount'){
      if (!queuedPreaction.action || queuedPreaction.action !== liveState.amountAction || !liveState.amountBounds) return null;
      if (!Number.isFinite(queuedPreaction.amount) || queuedPreaction.amount < liveState.amountBounds.min || (liveState.amountBounds.max != null && queuedPreaction.amount > liveState.amountBounds.max)) return null;
      return { action: queuedPreaction.action, amount: queuedPreaction.amount };
    }
    if (queuedPreaction.slot === 'allIn'){
      return liveState.allInPlan
        ? { action: liveState.allInPlan.type, amount: liveState.allInPlan.amount == null ? null : liveState.allInPlan.amount }
        : null;
    }
    return null;
  }

  function renderControls(){
    var signedIn = isSignedIn();
    var seated = !!deriveCurrentSeat();
    var liveReady = isWsReady();
    var activeHand = hasActiveHand();
    var usersTurn = isUsersTurn();
    var controlsLocked = queuedPreactionInFlight;
    var allowed = liveReady && usersTurn ? getAllowedActions() : [];
    var primary = resolvePrimaryAction(allowed);
    var amountAction = resolveAmountAction(allowed);
    var allInPlan = resolveAllInPlan(allowed);
    var stackAmount = resolveStack(state.currentUserId);
    var amountBounds = resolveAmountBounds(amountAction, stackAmount);
    var playerSittingOut = isPlayerSittingOut();
    var preactionMode = !!(signedIn && seated && liveReady && activeHand && !usersTurn && !isCurrentUserFolded() && !playerSittingOut);
    var projectedAllowed = preactionMode ? resolveProjectedAllowedActions() : [];
    var preactionPrimary = resolvePrimaryAction(projectedAllowed);
    var preactionAmountAction = resolveAmountAction(projectedAllowed);
    var preactionAllInAvailable = preactionMode && canQueueAllInPreaction();
    var preactionAmountBounds = resolveAmountBounds(preactionAmountAction, stackAmount);
    var displayPrimary = primary || preactionPrimary || 'CHECK';
    var displayAmountAction = amountAction || preactionAmountAction || 'BET';
    var showActionButtons = signedIn && seated;
    var showLiveActionButtons = showActionButtons && !preactionMode;
    var actionControlsLocked = !liveReady || !usersTurn || controlsLocked || playerSittingOut;
    var joinDisabled = !signedIn || seated || !state.tableId || !liveReady;
    if (!seated || !activeHand || isCurrentUserFolded() || playerSittingOut) clearQueuedPreaction();
    if (preactionMode) {
      syncQueuedPreactionWithPreactionState({
        foldVisible: isFoldAvailable(),
        primaryAction: preactionPrimary,
        amountAction: preactionAmountAction,
        allInAvailable: preactionAllInAvailable,
        amountBounds: preactionAmountBounds
      });
    }

    if (els.signInBtn) {
      els.signInBtn.hidden = signedIn && !isGuestMode;
      els.signInBtn.textContent = isGuestMode ? 'Create account and get 500 CH Welcome Bonus' : 'Sign in';
    }
    if (els.guestBadge) els.guestBadge.hidden = !isGuestMode;
    if (els.joinBtn) els.joinBtn.hidden = false;
    if (els.joinBtn) els.joinBtn.disabled = joinDisabled;
    if (els.joinBtn) {
      if (seated) els.joinBtn.textContent = 'Joined';
      else if (!signedIn) els.joinBtn.textContent = 'Join';
      else if (!liveReady) els.joinBtn.textContent = 'Connecting…';
      else els.joinBtn.textContent = 'Join';
    }
    if (els.joinSeat) els.joinSeat.disabled = !signedIn || seated || !liveReady;
    if (els.joinBuyIn) els.joinBuyIn.disabled = !signedIn || seated || !liveReady;
    if (els.joinSeat && suggestedSeatNoParam && !seated && !els.joinSeat.dataset.userEdited) {
      els.joinSeat.value = String(suggestedSeatNoParam);
    }
    if (els.startBtn) els.startBtn.hidden = !signedIn || !seated;
    if (els.leaveBtn) els.leaveBtn.hidden = !signedIn || !seated;
    if (els.startBtn) els.startBtn.disabled = !liveReady;
    if (els.leaveBtn) els.leaveBtn.disabled = !liveReady;
    if ((!signedIn || !seated) && leaveConfirmOpen) closeLeaveConfirm();
    if (els.stackText) els.stackText.textContent = stackAmount == null ? '—' : formatNumber(stackAmount);

    if (els.foldBtn){
      els.foldBtn.hidden = !showLiveActionButtons;
      els.foldBtn.dataset.action = 'FOLD';
      els.foldBtn.disabled = actionControlsLocked || !isFoldAvailable();
    }
    if (els.primaryBtn){
      els.primaryBtn.hidden = !showLiveActionButtons;
      var toCall = Number.isFinite(state.actionConstraints && state.actionConstraints.toCall)
        ? Math.max(0, Math.trunc(state.actionConstraints.toCall))
        : null;
      els.primaryBtn.textContent = displayPrimary === 'CHECK'
        ? 'Check'
        : ('Call (' + formatCompactAmount(toCall) + ')');
      els.primaryBtn.dataset.action = primary || '';
      els.primaryBtn.disabled = actionControlsLocked || !primary;
    }
    if (els.amountBtn){
      els.amountBtn.hidden = !showLiveActionButtons;
      els.amountBtn.textContent = displayAmountAction === 'RAISE' ? 'Raise' : 'Bet';
      els.amountBtn.dataset.action = amountAction || '';
      els.amountBtn.disabled = actionControlsLocked || !amountAction;
    }
    if (els.allInBtn){
      els.allInBtn.hidden = !showLiveActionButtons;
      els.allInBtn.dataset.action = allInPlan ? allInPlan.type : '';
      els.allInBtn.disabled = actionControlsLocked || !allInPlan;
    }
    if (els.foldPreactionWrap) els.foldPreactionWrap.hidden = !preactionMode;
    if (els.foldPreaction) {
      els.foldPreaction.checked = !!(queuedPreaction && queuedPreaction.slot === 'fold');
      els.foldPreaction.disabled = !liveReady || controlsLocked || !isFoldAvailable();
      els.foldPreaction.dataset.slot = 'fold';
    }
    if (els.primaryPreactionWrap) els.primaryPreactionWrap.hidden = !preactionMode;
    if (els.primaryPreaction) {
      els.primaryPreaction.checked = !!(queuedPreaction && queuedPreaction.slot === 'primary');
      els.primaryPreaction.disabled = !liveReady || controlsLocked || !preactionPrimary;
      els.primaryPreaction.dataset.slot = 'primary';
      els.primaryPreaction.dataset.action = preactionPrimary || '';
    }
    if (els.primaryPreactionText) {
      var projectedToCall = Number.isFinite(state.actionConstraints && state.actionConstraints.toCall)
        ? Math.max(0, Math.trunc(state.actionConstraints.toCall))
        : null;
      els.primaryPreactionText.textContent = preactionPrimary === 'CALL'
        ? ('Call (' + formatCompactAmount(projectedToCall) + ')')
        : 'Check';
    }
    if (els.amountPreactionWrap) els.amountPreactionWrap.hidden = !preactionMode;
    if (els.amountPreaction) {
      els.amountPreaction.checked = !!(queuedPreaction && queuedPreaction.slot === 'amount');
      els.amountPreaction.disabled = !liveReady || controlsLocked || !preactionAmountAction;
      els.amountPreaction.dataset.slot = 'amount';
      els.amountPreaction.dataset.action = preactionAmountAction || '';
    }
    if (els.amountPreactionText) els.amountPreactionText.textContent = preactionAmountAction === 'RAISE' ? 'Raise' : 'Bet';
    if (els.allInPreactionWrap) els.allInPreactionWrap.hidden = !preactionMode;
    if (els.allInPreaction) {
      els.allInPreaction.checked = !!(queuedPreaction && queuedPreaction.slot === 'allIn');
      els.allInPreaction.disabled = !liveReady || controlsLocked || !preactionAllInAvailable;
      els.allInPreaction.dataset.slot = 'allIn';
    }
    if (els.amountInputWrap){
      els.amountInputWrap.hidden = false;
      var activeAmountBounds = usersTurn ? amountBounds : preactionMode ? preactionAmountBounds : null;
      if (activeAmountBounds){
        var syncedAmount = syncAmountInput(activeAmountBounds);
        if (els.amountValue) els.amountValue.textContent = formatCompactAmount(Number.isFinite(syncedAmount) ? syncedAmount : activeAmountBounds.min);
        if (els.amountInputWrap.classList && typeof els.amountInputWrap.classList.remove === 'function') els.amountInputWrap.classList.remove('is-disabled');
      } else if (els.amountInputWrap.classList && typeof els.amountInputWrap.classList.add === 'function') {
        els.amountInputWrap.classList.add('is-disabled');
      }
    }
    if (els.amountInput) els.amountInput.disabled = !liveReady || controlsLocked || !(usersTurn ? amountAction : preactionMode ? preactionAmountAction : null);
    if (els.amountValue && !(usersTurn ? amountAction : preactionMode ? preactionAmountAction : null)) {
      els.amountValue.textContent = formatCompactAmount(parseInt(els.amountInput && els.amountInput.value ? els.amountInput.value : '20', 10) || 20);
    }
  }

  function resolveSettlementRecipientName(userId){
    for (var i = 0; i < state.seats.length; i++){
      if (state.seats[i] && state.seats[i].userId === userId) return getDisplayName(state.seats[i]);
    }
    return shortId(userId) || t('pokerSettlementPlayer', 'Player');
  }

  function renderSettlementSummary(){
    if (!els.centerLayer) return;
    if (!els.settlementSummary){
      els.settlementSummary = document.createElement('div');
      els.settlementSummary.className = 'poker-settlement-summary';
      els.settlementSummary.setAttribute('role', 'status');
      els.settlementSummary.setAttribute('aria-live', 'polite');
      els.settlementSummary.setAttribute('aria-atomic', 'true');
      els.settlementSummary.setAttribute('aria-label', t('pokerSettlementSummaryAria', 'Hand settlement'));
      els.centerLayer.appendChild(els.settlementSummary);
    }
    els.settlementSummary.setAttribute('aria-label', t('pokerSettlementSummaryAria', 'Hand settlement'));
    els.settlementSummary.innerHTML = '';
    var presentation = getDisplaySettlementPresentation();
    if (!presentation){
      els.settlementSummary.hidden = true;
      return;
    }
    els.settlementSummary.hidden = false;
    if (!presentation.valid){
      var fallback = document.createElement('div');
      fallback.className = 'poker-settlement-summary__fallback';
      fallback.textContent = t('pokerSettlementComplete', 'Settlement complete');
      els.settlementSummary.appendChild(fallback);
      return;
    }
    presentation.pots.forEach(function(pot){
      var row = document.createElement('div');
      row.className = 'poker-settlement-summary__row poker-settlement-summary__row--' + pot.kind;
      row.dataset.awardId = pot.awardId;
      var label = document.createElement('span');
      label.className = 'poker-settlement-summary__label';
      label.textContent = getSettlementAwardLabel(pot) + ' ' + formatNumber(pot.amount);
      var recipients = document.createElement('span');
      recipients.className = 'poker-settlement-summary__recipients';
      recipients.textContent = pot.recipients.map(function(recipient){
        var name = resolveSettlementRecipientName(recipient.userId);
        return pot.recipients.length > 1 ? name + ' +' + formatNumber(recipient.amount) : name;
      }).join(', ');
      row.appendChild(label);
      row.appendChild(recipients);
      els.settlementSummary.appendChild(row);
    });
  }

  function render(){
    if (els.potPill) els.potPill.textContent = 'Pot ' + formatNumber(state.potTotal || 0);
    renderCommunityCards();
    renderSeats();
    renderHeroCards();
    positionHeroCards();
    renderSeatChips();
    renderPotChips();
    renderSettlementSummary();
    renderDealerChip();
    renderInfoPanel();
    renderControls();
    renderClosedTableNotice();
  }

  function setError(message){
    state.errorText = message || '';
    renderInfoPanel();
  }

  function markBootReady(){
    if (bootReady) return;
    bootReady = true;
    if (els.screen) els.screen.setAttribute('data-boot-ready', '1');
    if (els.bootSplash) els.bootSplash.hidden = true;
  }

  function buildJoinPayload(){
    return buildJoinPayloadWithOptions();
  }

  function resolvePreferredSeatNo(){
    var rawSeatNo = els.joinSeat ? parseInt(els.joinSeat.value, 10) : NaN;
    var maxSeats = Number.isInteger(state.maxSeats) && state.maxSeats >= 1 ? state.maxSeats : 1;
    var preferredSeatNo = Number.isFinite(rawSeatNo) ? Math.trunc(rawSeatNo) : 1;
    if (preferredSeatNo < 1) preferredSeatNo = 1;
    if (preferredSeatNo > maxSeats) preferredSeatNo = maxSeats;
    if (els.joinSeat) els.joinSeat.value = String(preferredSeatNo);
    return preferredSeatNo;
  }

  function buildJoinPayloadWithOptions(options){
    var opts = options || {};
    var payload = { tableId: state.tableId };
    var buyIn = els.joinBuyIn ? parseInt(els.joinBuyIn.value, 10) : 100;
    if (Number.isFinite(buyIn) && buyIn > 0) payload.buyIn = buyIn;
    var preferredSeatNo = resolvePreferredSeatNo();
    if (opts.autoSeat === true) {
      payload.autoSeat = true;
      payload.preferredSeatNo = preferredSeatNo;
    } else {
      payload.seatNo = preferredSeatNo;
    }
    return payload;
  }

  function sendCommand(methodName, payload){
    if (!wsClient || typeof wsClient[methodName] !== 'function' || !isWsReady()){
      setError('Live table connection is still starting');
      return Promise.reject(new Error('ws_unavailable'));
    }
    return wsClient[methodName](payload || {});
  }

  function queueLeaveAndNavigateImmediately(){
    if (!wsClient || typeof wsClient.sendLeaveQueued !== 'function' || !isWsReady()) return false;
    wsClient.sendLeaveQueued({ tableId: state.tableId });
    pendingLeaveRetryAfterReconnect = false;
    pendingLeaveNavigation = false;
    state.statusText = 'Leaving...';
    renderInfoPanel();
    navigateToLobby();
    return true;
  }

  function closeLeaveConfirm(){
    leaveConfirmOpen = false;
    if (els.leaveConfirmModal) els.leaveConfirmModal.hidden = true;
  }

  function openLeaveConfirm(){
    if (!els.leaveConfirmModal) return;
    leaveConfirmOpen = true;
    els.leaveConfirmModal.hidden = false;
  }

  function handleAction(actionType, amount){
    if (!actionType) return Promise.resolve();
    var payload = { handId: state.handId || null, action: actionType };
    if (Number.isFinite(amount)) payload.amount = Math.trunc(amount);
    setError('');
    return sendCommand('sendAct', payload).then(function(){
      state.statusText = 'Action sent';
      renderInfoPanel();
    }).catch(function(err){
      setError(err && err.message ? err.message : 'Failed to send action');
    });
  }

  function maybeExecuteQueuedPreaction(){
    if (!queuedPreaction || queuedPreactionInFlight || !isUsersTurn()) return;
    var allowed = getAllowedActions();
    var liveState = {
      foldVisible: isFoldAvailable(),
      primaryAction: resolvePrimaryAction(allowed),
      amountAction: resolveAmountAction(allowed),
      allInPlan: resolveAllInPlan(allowed),
      amountBounds: resolveAmountBounds(resolveAmountAction(allowed), resolveStack(state.currentUserId))
    };
    var nextAction = resolveQueuedPreactionExecution(liveState);
    clearQueuedPreaction();
    if (!nextAction || !nextAction.action) return;
    queuedPreactionInFlight = true;
    handleAction(nextAction.action, nextAction.amount == null ? undefined : nextAction.amount).then(function(){
      queuedPreactionInFlight = false;
      renderControls();
    });
  }

  function autoJoinErrorCode(error){
    var value = error && (error.code || error.message) ? String(error.code || error.message) : '';
    return value.trim().toLowerCase();
  }

  function isRetryableAutoJoinError(error){
    var code = autoJoinErrorCode(error);
    if (!code) return false;
    return /^(timeout|ws_unavailable|temporarily_unavailable|authoritative_join_failed|authoritative_state_invalid|state_missing|poker_state_missing|state_conflict|conflict|persist_failed|seat_taken|table_load_failed|table_bootstrap_failed)$/.test(code);
  }

  function clearAutoJoinRetry(){
    if (autoJoinRetryTimer){
      window.clearTimeout(autoJoinRetryTimer);
      autoJoinRetryTimer = null;
    }
  }

  function resetAutoJoinRetryState(){
    clearAutoJoinRetry();
    autoJoinRetryCount = 0;
    autoJoinErrorActive = false;
  }

  function scheduleAutoJoinRetry(error){
    if (!shouldAutoJoin || !isRetryableAutoJoinError(error) || autoJoinRetryTimer) return false;
    if (autoJoinRetryCount >= AUTO_JOIN_RETRY_DELAYS_MS.length) return false;
    var delayMs = AUTO_JOIN_RETRY_DELAYS_MS[autoJoinRetryCount];
    autoJoinRetryCount += 1;
    autoJoinRetryTimer = window.setTimeout(function(){
      autoJoinRetryTimer = null;
      autoJoinAttempted = false;
      if (deriveCurrentSeat()){
        resetAutoJoinRetryState();
        return;
      }
      autoJoinSeat();
    }, delayMs);
    return true;
  }

  function autoJoinSeat(){
    if (!shouldAutoJoin) return;
    if (deriveCurrentSeat()){
      autoJoinAttempted = false;
      resetAutoJoinRetryState();
      return;
    }
    if (autoJoinAttempted || autoJoinRetryTimer) return;
    if (!isSignedIn() || !isWsReady()) return;
    autoJoinAttempted = true;
    if (suggestedSeatNoParam && els.joinSeat) els.joinSeat.value = String(suggestedSeatNoParam);
    autoJoinErrorActive = false;
    setError('');
    sendCommand('sendJoin', buildJoinPayloadWithOptions({ autoSeat: true })).then(function(result){
      resetAutoJoinRetryState();
      state.statusText = result && result.seatNo != null ? ('Joined seat ' + result.seatNo) : 'Join accepted';
      renderInfoPanel();
    }).catch(function(err){
      autoJoinAttempted = false;
      autoJoinErrorActive = true;
      var retryScheduled = scheduleAutoJoinRetry(err);
      klog('poker_auto_join_failed', {
        reason: autoJoinErrorCode(err) || 'unknown',
        retryScheduled: retryScheduled,
        retryCount: autoJoinRetryCount
      });
      setError(err && err.message ? err.message : 'Failed to auto-join');
    });
  }

  function rememberSeatForReconnect(){
    var currentSeat = deriveCurrentSeat();
    var seatNo = currentSeat && Number.isInteger(currentSeat.seatNo)
      ? currentSeat.seatNo
      : lastKnownCurrentSeatNo;
    reconnectSeatNo = Number.isInteger(seatNo) && seatNo > 0 ? seatNo : null;
    autoJoinAttempted = false;
  }

  function rejoinSeatAfterReconnect(){
    if (!Number.isInteger(reconnectSeatNo) || reconnectSeatNo < 1) return false;
    if (autoJoinAttempted) return true;
    var preferredSeatNo = reconnectSeatNo;
    autoJoinAttempted = true;
    setError('');
    sendCommand('sendJoin', {
      tableId: state.tableId,
      autoSeat: true,
      preferredSeatNo: preferredSeatNo
    }).then(function(result){
      var resolvedSeatNo = result && Number.isInteger(Number(result.seatNo))
        ? Number(result.seatNo)
        : preferredSeatNo;
      reconnectSeatNo = null;
      lastKnownCurrentSeatNo = resolvedSeatNo;
      state.statusText = 'Reconnected to seat ' + resolvedSeatNo;
      renderInfoPanel();
    }).catch(function(err){
      autoJoinAttempted = false;
      reconnectSeatNo = preferredSeatNo;
      setError(err && err.message ? err.message : 'Failed to reconnect seat');
    });
    return true;
  }

  function closeMenu(){
    if (!els.menuToggle || !els.menuPanel) return;
    els.menuPanel.setAttribute('hidden', 'hidden');
    els.menuToggle.setAttribute('aria-expanded', 'false');
  }

  function navigateToLobby(){
    cancelClosedTableRedirect();
    if (!window || !window.location) return;
    window.location.href = '/poker/';
  }

  function isStaleSessionError(error){
    var code = error && (error.code || error.message) ? String(error.code || error.message) : '';
    return code === 'STALE_SESSION' || code === 'session_rebound';
  }

  function isRetryableLeaveError(error){
    var code = error && (error.code || error.message) ? String(error.code || error.message) : '';
    return code === 'STALE_SESSION' || code === 'session_rebound' || code === 'ws_closed' || code === 'timeout' || code === 'ws_unavailable';
  }

  function leaveAndReturnToLobby(){
    pendingLeaveNavigation = true;
    try {
      if (queueLeaveAndNavigateImmediately()) return Promise.resolve({ ok: true, queued: true });
    } catch (_err){}
    return sendCommand('sendLeave', { tableId: state.tableId }).then(function(){
      pendingLeaveRetryAfterReconnect = false;
      pendingLeaveNavigation = false;
      state.statusText = 'Leave accepted';
      renderInfoPanel();
      navigateToLobby();
    }).catch(function(err){
      if (isRetryableLeaveError(err) && currentAccessToken && !pendingLeaveRetryAfterReconnect){
        pendingLeaveRetryAfterReconnect = true;
        state.statusText = LIVE_STATUS_COPY.connecting;
        renderInfoPanel();
        restartLiveMode(currentAccessToken);
        return;
      }
      pendingLeaveRetryAfterReconnect = false;
      pendingLeaveNavigation = false;
      setError(err && err.message ? err.message : 'Failed to leave');
    });
  }

  function requestManualRebuy(){
    if (rebuyInFlight || !state.playerState || state.playerState.canRebuy !== true) return Promise.resolve();
    rebuyInFlight = true;
    setError('');
    renderRebuyPanel();
    return sendCommand('sendRebuy', { tableId: state.tableId, amount: 100 }).then(function(){
      state.statusText = 'Buy-in accepted';
    }).catch(function(error){
      var reason = error && (error.code || error.message) ? String(error.code || error.message) : 'rebuy_failed';
      if (els.rebuyAccountLink) els.rebuyAccountLink.hidden = reason !== 'insufficient_chips';
      setError(reason === 'insufficient_chips' ? 'Not enough CH for a 100 CH buy-in' : reason);
    }).then(function(){
      rebuyInFlight = false;
      render();
    });
  }

  function bindMenu(){
    if (!els.menuToggle || !els.menuPanel) return;
    els.menuToggle.addEventListener('click', function(){
      var hidden = els.menuPanel.hasAttribute('hidden');
      if (hidden) els.menuPanel.removeAttribute('hidden');
      else els.menuPanel.setAttribute('hidden', 'hidden');
      els.menuToggle.setAttribute('aria-expanded', hidden ? 'true' : 'false');
    });
    ['lobbyLink'].forEach(function(key){
      if (!els[key]) return;
      els[key].addEventListener('click', function(){
        closeMenu();
      });
    });
    document.addEventListener('click', function(event){
      var target = event && event.target;
      if (!target) return;
      if (target === els.menuToggle || target === els.menuPanel) return;
      if (typeof els.menuToggle.contains === 'function' && els.menuToggle.contains(target)) return;
      if (typeof els.menuPanel.contains === 'function' && els.menuPanel.contains(target)) return;
      closeMenu();
    });
    document.addEventListener('keydown', function(event){
      if (event && event.key === 'Escape') closeMenu();
    });
  }

  function bindControls(){
    function bindPreaction(slot){
      var input = getPreactionInput(slot);
      if (!input) return;
      input.addEventListener('change', function(){
        if (!input.checked){
          if (queuedPreaction && queuedPreaction.slot === slot) clearQueuedPreaction();
          renderControls();
          return;
        }
        queuedPreaction = buildQueuedPreaction(slot);
        if (!queuedPreaction) {
          input.checked = false;
          renderControls();
          return;
        }
        ['fold', 'primary', 'amount', 'allIn'].forEach(function(otherSlot){
          if (otherSlot === slot) return;
          var otherInput = getPreactionInput(otherSlot);
          if (otherInput) otherInput.checked = false;
        });
        renderControls();
      });
    }
    if (els.signInBtn) els.signInBtn.addEventListener('click', openSignIn);
    if (els.foldBtn) els.foldBtn.addEventListener('click', function(){
      handleAction('FOLD');
    });
    if (els.joinBtn) els.joinBtn.addEventListener('click', function(){
      setError('');
      sendCommand('sendJoin', buildJoinPayloadWithOptions({ autoSeat: true })).then(function(result){
        state.statusText = result && result.seatNo != null ? ('Joined seat ' + result.seatNo) : 'Join accepted';
        renderInfoPanel();
      }).catch(function(err){
        setError(err && err.message ? err.message : 'Failed to join');
      });
    });
    if (els.leaveBtn) els.leaveBtn.addEventListener('click', function(){
      setError('');
      openLeaveConfirm();
    });
    if (els.leaveConfirmYes) els.leaveConfirmYes.addEventListener('click', function(){
      closeLeaveConfirm();
      setError('');
      leaveAndReturnToLobby();
    });
    if (els.leaveConfirmCancel) els.leaveConfirmCancel.addEventListener('click', function(){
      closeLeaveConfirm();
    });
    if (els.rebuyBtn) els.rebuyBtn.addEventListener('click', requestManualRebuy);
    if (els.rebuyLobbyBtn) els.rebuyLobbyBtn.addEventListener('click', leaveAndReturnToLobby);
    if (els.rebuyWatchBtn) els.rebuyWatchBtn.addEventListener('click', function(){
      rebuyPanelDismissed = true;
      renderRebuyPanel();
    });
    if (els.startBtn) els.startBtn.addEventListener('click', function(){
      setError('');
      sendCommand('sendStartHand', { tableId: state.tableId }).then(function(){
        state.statusText = 'Start hand accepted';
        renderInfoPanel();
      }).catch(function(err){
        setError(err && err.message ? err.message : 'Failed to start hand');
      });
    });
    if (els.primaryBtn) els.primaryBtn.addEventListener('click', function(){
      handleAction(els.primaryBtn.dataset.action || '');
    });
    if (els.amountBtn) els.amountBtn.addEventListener('click', function(){
      var value = els.amountInput ? parseInt(els.amountInput.value, 10) : NaN;
      handleAction(els.amountBtn.dataset.action || '', Number.isFinite(value) ? value : undefined);
    });
    if (els.amountInput) els.amountInput.addEventListener('input', function(){
      if (els.amountValue) els.amountValue.textContent = formatCompactAmount(parseInt(els.amountInput.value, 10) || 0);
      if (queuedPreaction && queuedPreaction.slot === 'amount'){
        var queuedAmount = readQueuedAmount();
        if (Number.isFinite(queuedAmount)) queuedPreaction.amount = queuedAmount;
      }
    });
    if (els.joinSeat) els.joinSeat.addEventListener('input', function(){
      els.joinSeat.dataset.userEdited = '1';
    });
    if (els.allInBtn) els.allInBtn.addEventListener('click', function(){
      var plan = resolveAllInPlan(getAllowedActions());
      if (!plan) return;
      handleAction(plan.type, plan.amount == null ? undefined : plan.amount);
    });
    bindPreaction('fold');
    bindPreaction('primary');
    bindPreaction('amount');
    bindPreaction('allIn');
  }

  function selectElements(){
    els.screen = document.getElementById('pokerTableScreen');
    if (typeof document.querySelector === 'function') els.scene = document.querySelector('.poker-scene');
    if (typeof document.querySelector === 'function') els.centerLayer = document.querySelector('.poker-center-layer');
    if (!els.scene) els.scene = els.screen;
    els.xpBadge = document.getElementById('xpBadge');
    els.bootSplash = document.getElementById('pokerBootSplash');
    els.menuToggle = document.getElementById('pokerMenuToggle');
    els.menuPanel = document.getElementById('pokerMenuPanel');
    els.lobbyLink = document.getElementById('pokerLobbyLink');
    els.seatLayer = document.getElementById('pokerSeatLayer');
    els.seatChipLayer = document.getElementById('pokerSeatChipLayer');
    els.chipFxLayer = document.getElementById('pokerChipFxLayer');
    els.potPill = document.getElementById('pokerPotPill');
    els.potChipStack = document.getElementById('pokerPotChipStack');
    els.communityCards = document.getElementById('pokerCommunityCards');
    els.dealerChip = document.getElementById('pokerDealerChip');
    els.heroCards = document.getElementById('pokerHeroCards');
    els.liveStatus = document.getElementById('pokerV2LiveStatus');
    els.tableMeta = document.getElementById('pokerV2TableMeta');
    els.turnText = document.getElementById('pokerV2TurnText');
    els.stackText = document.getElementById('pokerV2StackText');
    els.errorText = document.getElementById('pokerV2ErrorText');
    els.guestPanel = document.getElementById('pokerV2GuestPanel');
    els.signInBtn = document.getElementById('pokerV2SignInBtn');
    els.guestBadge = document.getElementById('pokerV2GuestBadge');
    els.joinBtn = document.getElementById('pokerV2JoinBtn');
    els.joinSeat = document.getElementById('pokerV2SeatNo');
    els.joinBuyIn = document.getElementById('pokerV2BuyIn');
    els.leaveBtn = document.getElementById('pokerV2LeaveBtn');
    els.leaveConfirmModal = document.getElementById('pokerV2LeaveConfirmModal');
    els.leaveConfirmYes = document.getElementById('pokerV2LeaveConfirmYes');
    els.leaveConfirmCancel = document.getElementById('pokerV2LeaveConfirmCancel');
    els.rebuyPanel = document.getElementById('pokerV2RebuyPanel');
    els.rebuyTitle = document.getElementById('pokerV2RebuyTitle');
    els.rebuyCopy = document.getElementById('pokerV2RebuyCopy');
    els.rebuyBalance = document.getElementById('pokerV2RebuyBalance');
    els.rebuyBtn = document.getElementById('pokerV2RebuyBtn');
    els.rebuyLobbyBtn = document.getElementById('pokerV2RebuyLobbyBtn');
    els.rebuyWatchBtn = document.getElementById('pokerV2RebuyWatchBtn');
    els.rebuyAccountLink = document.getElementById('pokerV2RebuyAccountLink');
    els.closedTableModal = document.getElementById('pokerV2ClosedTableModal');
    els.closedTableTitle = document.getElementById('pokerV2ClosedTableTitle');
    els.closedTableCountdown = document.getElementById('pokerV2ClosedTableCountdown');
    els.startBtn = document.getElementById('pokerV2StartBtn');
    els.foldBtn = document.getElementById('pokerV2FoldBtn');
    els.foldPreactionWrap = document.getElementById('pokerV2FoldPreactionWrap');
    els.foldPreaction = document.getElementById('pokerV2FoldPreaction');
    els.foldPreactionText = document.getElementById('pokerV2FoldPreactionText');
    els.primaryBtn = document.getElementById('pokerV2PrimaryBtn');
    els.primaryPreactionWrap = document.getElementById('pokerV2PrimaryPreactionWrap');
    els.primaryPreaction = document.getElementById('pokerV2PrimaryPreaction');
    els.primaryPreactionText = document.getElementById('pokerV2PrimaryPreactionText');
    els.amountBtn = document.getElementById('pokerV2AmountBtn');
    els.amountPreactionWrap = document.getElementById('pokerV2AmountPreactionWrap');
    els.amountPreaction = document.getElementById('pokerV2AmountPreaction');
    els.amountPreactionText = document.getElementById('pokerV2AmountPreactionText');
    els.allInBtn = document.getElementById('pokerV2AllInBtn');
    els.allInPreactionWrap = document.getElementById('pokerV2AllInPreactionWrap');
    els.allInPreaction = document.getElementById('pokerV2AllInPreaction');
    els.allInPreactionText = document.getElementById('pokerV2AllInPreactionText');
    els.amountInput = document.getElementById('pokerV2AmountInput');
    els.amountValue = document.getElementById('pokerV2AmountValue');
    els.amountInputWrap = document.getElementById('pokerV2AmountInputWrap');
  }

  function startDemoMode(){
    startTurnClock();
    resetQueuedPreactionState();
    state = cloneState(demoState);
    state.wsReady = false;
    render();
    markBootReady();
  }

  function stopLiveMode(){
    stopTurnClock();
    clearWinnerRevealTimer();
    cancelSettlementAnimations();
    cancelClosedTableRedirect();
    resetAutoJoinRetryState();
    autoJoinAttempted = false;
    pendingPostRevealSnapshot = null;
    state.wsReady = false;
    if (wsClient && typeof wsClient.destroy === 'function'){
      try { wsClient.destroy(); } catch (_err){}
    }
    wsClient = null;
  }

  function applySignedOutState(){
    stopLiveMode();
    resetQueuedPreactionState();
    state = createEmptyLiveState(tableId, null);
    state.statusText = LIVE_STATUS_COPY.auth;
    render();
  }

  function applyAuthenticatedPendingState(user){
    stopLiveMode();
    resetQueuedPreactionState();
    isGuestMode = false;
    currentGuestSession = null;
    state = createEmptyLiveState(tableId, user && user.id ? String(user.id) : null);
    state.statusText = LIVE_STATUS_COPY.connecting;
    render();
    markBootReady();
  }

  function restartLiveMode(token){
    if (!tableId || !token) return;
    currentAccessToken = token;
    startLiveMode(token);
  }

  function restartAuthenticatedLiveMode(token){
    if (!tableId || !token) return;
    isGuestMode = false;
    currentGuestSession = null;
    clearGuestSession();
    restartLiveMode(token);
  }

  function startLiveMode(token){
    if (!window.PokerWsClient || typeof window.PokerWsClient.create !== 'function'){
      state.statusText = LIVE_STATUS_COPY.error;
      setError('Poker WS client is unavailable');
      render();
      return;
    }
    stopLiveMode();
    startTurnClock();
    state = createEmptyLiveState(tableId, getUserIdFromToken(token));
    render();
    markBootReady();
    wsClient = window.PokerWsClient.create({
      tableId: tableId,
      guestToken: isGuestMode && currentGuestSession ? currentGuestSession.token : null,
      getAccessToken: function(){ return Promise.resolve(currentAccessToken); },
      klog: klog,
      onStatus: function(status, info){
        if (status === 'hello_ack' || status === 'minting_token' || status === 'authenticating'){
          state.wsReady = false;
          state.statusText = LIVE_STATUS_COPY.connecting;
          renderInfoPanel();
          renderControls();
        } else if (status === 'auth_ok'){
          state.wsReady = true;
          state.statusText = LIVE_STATUS_COPY.live;
          state.errorText = '';
          render();
          if (pendingLeaveRetryAfterReconnect){
            leaveAndReturnToLobby();
            return;
          }
          if (!rejoinSeatAfterReconnect()) autoJoinSeat();
        } else if (status === 'reconnecting'){
          cancelSettlementAnimations();
          suppressSettlementAnimationUntilAuthoritativeSnapshot = true;
          rememberSeatForReconnect();
          state.wsReady = false;
          state.statusText = LIVE_STATUS_COPY.connecting;
          renderInfoPanel();
          renderControls();
        } else if (status === 'command_result') {
          syncClosedTableRedirectFromSignal(info && info.reason ? info.reason : null);
        } else if (status === 'resync'){
          cancelSettlementAnimations();
          suppressSettlementAnimationUntilAuthoritativeSnapshot = true;
        } else if (status === 'failed'){
          cancelSettlementAnimations();
          state.wsReady = false;
          state.statusText = LIVE_STATUS_COPY.error;
          setError(info && info.code ? info.code : 'Live connection failed');
        } else if (status === 'error'){
          cancelSettlementAnimations();
          state.wsReady = false;
          state.statusText = LIVE_STATUS_COPY.error;
          syncClosedTableRedirectFromSignal(info && info.code ? info.code : null);
          setError(info && info.code ? info.code : 'Live table unavailable');
        } else if (status === 'closed'){
          cancelSettlementAnimations();
          state.wsReady = false;
          state.statusText = LIVE_STATUS_COPY.disconnected;
          renderInfoPanel();
          renderControls();
        }
      },
      onSnapshot: function(snapshot){
        var payload = snapshot && snapshot.payload ? snapshot.payload : null;
        var frame = {
          kind: snapshot && typeof snapshot.kind === 'string' ? snapshot.kind : 'stateSnapshot',
          initial: !!(snapshot && snapshot.initial),
          suppressSettlementAnimation: suppressSettlementAnimationUntilAuthoritativeSnapshot,
          payload: payload
        };
        var authoritativeSnapshot = frame.kind === 'stateSnapshot' || (frame.kind === 'table_state' && frame.initial);
        if (authoritativeSnapshot) suppressSettlementAnimationUntilAuthoritativeSnapshot = false;
        if (shouldDeferSnapshotUntilRevealEnds(payload)){
          pendingPostRevealSnapshot = frame;
          scheduleRevealDismiss();
          return;
        }
        var previousVisual = captureVisualSnapshot();
        mergeSnapshot(payload, frame);
        maybeExecuteQueuedPreaction();
        render();
        var nextVisual = captureVisualSnapshot();
        animateChipDiff(previousVisual, nextVisual, frame);
        autoJoinSeat();
      },
      onProtocolError: function(info){
        state.wsReady = false;
        state.statusText = LIVE_STATUS_COPY.error;
        if (info && info.code === 'missing_access_token'){
          applySignedOutState();
          return;
        }
        if (info && info.code === 'STALE_SESSION' && currentAccessToken && pendingLeaveRetryAfterReconnect){
          restartLiveMode(currentAccessToken);
          return;
        }
        syncClosedTableRedirectFromSignal(info && info.code ? info.code : null);
        setError(info && info.code ? info.code : 'Protocol error');
      }
    });
    wsClient.start();
  }

  function startAuthWatch(){
    if (authWatchTimer || !tableId) return;
    authWatchTimer = window.setInterval(function(){
      getAccessToken().then(function(token){
        if (!token || token === currentAccessToken) return;
        restartAuthenticatedLiveMode(token);
      }).catch(function(){});
    }, 3000);
  }

  function stopAuthWatch(){
    if (!authWatchTimer) return;
    window.clearInterval(authWatchTimer);
    authWatchTimer = null;
  }

  function startTurnClock(){
    if (turnClockTimer) return;
    turnClockTimer = window.setInterval(function(){
      if (!state.turnUserId || !state.turnDeadlineAt) return;
      refreshSeatTurnClock();
    }, 200);
  }

  function stopTurnClock(){
    if (!turnClockTimer) return;
    window.clearInterval(turnClockTimer);
    turnClockTimer = null;
  }

  function bindAuthLifecycle(){
    var authApi = getAuthApi();
    if (!authApi || typeof authApi.onAuthChange !== 'function') return;
    authUnsubscribe = authApi.onAuthChange(function(_event, user){
      getAccessToken().then(function(token){
        if (user && !token){
          currentAccessToken = null;
          applyAuthenticatedPendingState(user);
          startAuthWatch();
          return;
        }
        if (!user || !token){
          currentAccessToken = null;
          applySignedOutState();
          startAuthWatch();
          return;
        }
        stopAuthWatch();
        if (isGuestMode || token !== currentAccessToken || !isWsReady()) restartAuthenticatedLiveMode(token);
      }).catch(function(){
        currentAccessToken = null;
        applySignedOutState();
        startAuthWatch();
      });
    });
  }

  function applyInitialIdentity(identity, guestSessionCandidate){
    if (identity.token){
      stopAuthWatch();
      restartAuthenticatedLiveMode(identity.token);
      return;
    }
    if (identity.user){
      currentAccessToken = null;
      applyAuthenticatedPendingState(identity.user);
      startAuthWatch();
      return;
    }
    currentGuestSession = guestSessionCandidate;
    isGuestMode = !!(currentGuestSession && currentGuestSession.token);
    if (isGuestMode){
      currentAccessToken = null;
      startLiveMode(currentGuestSession.token);
      startAuthWatch();
      return;
    }
    if (readGuestMode()){
      applySignedOutState();
      setError('Guest session expired. Start again from the lobby.');
      return;
    }
    currentAccessToken = null;
    applySignedOutState();
    startAuthWatch();
  }

  function init(){
    selectElements();
    suggestedSeatNoParam = readSeatParam();
    shouldAutoJoin = readAutoJoinParam();
    bindMenu();
    bindControls();
    document.addEventListener('langchange', function(){ render(); });
    var guestSessionCandidate = readGuestMode() ? readGuestSession() : null;
    if (!tableId){
      startDemoMode();
      return;
    }
    bindAuthLifecycle();
    var identityPromise = getAuthApi() ? resolveInitialIdentity() : getAccessToken();
    identityPromise.then(function(identity){
      applyInitialIdentity(getAuthApi() ? identity : { token: identity || null, user: null }, guestSessionCandidate);
    }).catch(function(){
      applySignedOutState();
      startAuthWatch();
    });
  }

  window.__PokerV2 = {
    _mergeSnapshot: mergeSnapshot,
    _resolveAllInPlan: resolveAllInPlan
  };

  if (window.__RUNNING_POKER_UI_TESTS__ === true){
    window.__POKER_V2_TEST_HOOKS__ = {
      allocatePotRecipients: allocatePotRecipients,
      classifySettlementPot: classifySettlementPot,
      buildSettlementPresentation: buildSettlementPresentation
    };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
