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
  var LIVE_STATUS_COPY = {
    demo: 'Demo mode',
    connecting: 'Connecting…',
    auth: 'Sign in to join this table',
    live: 'Live table connected',
    disconnected: 'Live connection closed',
    error: 'Live table unavailable'
  };
  var WINNER_REVEAL_MS = 4_000;
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
  var authWatchTimer = null;
  var turnClockTimer = null;
  var authUnsubscribe = null;
  var renderedSeatAnchors = {};
  var renderedSeatSlots = {};
  var renderedSeatAvatars = {};
  var suggestedSeatNoParam = null;
  var shouldAutoJoin = false;
  var autoJoinAttempted = false;
  var bootReady = false;
  var stickyWinnerReveal = {
    handId: null,
    visibleUntilMs: 0,
    winners: [],
    revealedWinnerCardsByUserId: {},
    communityCards: []
  };
  var els = {};

  function cloneState(source){
    return JSON.parse(JSON.stringify(source));
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
      legalActions: [],
      actionConstraints: {},
      currentUserId: nextUserId || null,
      youSeat: null,
      statusText: LIVE_STATUS_COPY.connecting,
      errorText: '',
      wsReady: false,
      showdown: null,
      handSettlement: null,
      revealedWinnerCardsByUserId: {}
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

  function normalizeSeatRows(payload, previousSeats){
    var seatMap = {};
    var previousMap = {};
    var sourceSeats = [];
    if (Array.isArray(previousSeats)){
      previousSeats.forEach(function(seat){
        if (!seat || !Number.isInteger(seat.seatNo)) return;
        previousMap[seat.seatNo] = seat;
      });
    }

    if (Array.isArray(payload.seats)) sourceSeats = sourceSeats.concat(payload.seats);
    var tableObj = isObject(payload.table) ? payload.table : {};
    if (Array.isArray(tableObj.members)) sourceSeats = sourceSeats.concat(tableObj.members);
    if (Array.isArray(payload.authoritativeMembers)) sourceSeats = sourceSeats.concat(payload.authoritativeMembers);

    sourceSeats.forEach(function(rawSeat){
      if (!rawSeat) return;
      var seatNo = normalizeSeatNumber(
        rawSeat.seatNo != null ? rawSeat.seatNo : rawSeat.seat != null ? rawSeat.seat : rawSeat.position
      );
      if (seatNo == null) return;
      var previous = previousMap[seatNo] || {};
      var userId = typeof rawSeat.userId === 'string' && rawSeat.userId ? rawSeat.userId : (typeof previous.userId === 'string' ? previous.userId : null);
      var displayName = rawSeat.displayName || rawSeat.name || rawSeat.username || rawSeat.userName || rawSeat.handle || previous.displayName || null;
      var status = typeof rawSeat.status === 'string' && rawSeat.status ? rawSeat.status.toUpperCase() : (previous.status || 'ACTIVE');
      seatMap[seatNo] = {
        seatNo: seatNo,
        userId: userId,
        displayName: displayName,
        status: status,
        isBot: rawSeat.isBot === true || /^bot[-_:]/i.test(userId || '')
      };
    });

    return Object.keys(seatMap)
      .map(function(key){ return seatMap[key]; })
      .sort(function(left, right){ return left.seatNo - right.seatNo; });
  }

  function normalizeStacks(payload){
    if (isObject(payload.stacks)) return Object.assign({}, payload.stacks);
    var publicObj = isObject(payload.public) ? payload.public : {};
    if (isObject(publicObj.stacks)) return Object.assign({}, publicObj.stacks);
    return null;
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

  function normalizeShowdown(source){
    if (!isObject(source)) return null;
    var showdown = {
      winners: Array.isArray(source.winners) ? source.winners.filter(function(userId){
        return typeof userId === 'string' && !!userId;
      }) : [],
      reason: typeof source.reason === 'string' ? source.reason : null,
      handId: typeof source.handId === 'string' ? source.handId : null
    };
    if (Array.isArray(source.revealedWinners)){
      showdown.revealedWinners = source.revealedWinners
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
      settledAt: typeof source.settledAt === 'string' ? source.settledAt : null
    };
  }

  function mapRevealedWinnerCards(showdown){
    var revealed = {};
    if (!showdown || !Array.isArray(showdown.revealedWinners)) return revealed;
    showdown.revealedWinners.forEach(function(entry){
      if (!entry || typeof entry.userId !== 'string') return;
      if (!Array.isArray(entry.holeCards) || entry.holeCards.length !== 2) return;
      revealed[entry.userId] = entry.holeCards.slice(0, 2);
    });
    return revealed;
  }

  function cloneRevealedWinnerCards(source){
    var next = {};
    if (!isObject(source)) return next;
    Object.keys(source).forEach(function(userId){
      if (!Array.isArray(source[userId])) return;
      next[userId] = source[userId].slice(0, 2);
    });
    return next;
  }

  function syncStickyWinnerReveal(){
    var handId = state.handId || (state.handSettlement && state.handSettlement.handId) || (state.showdown && state.showdown.handId) || null;
    var winners = state.showdown && Array.isArray(state.showdown.winners) ? state.showdown.winners.filter(Boolean) : [];
    if (!handId || !winners.length || state.phase !== 'SETTLED'){
      return;
    }
    if (stickyWinnerReveal.handId !== handId || stickyWinnerReveal.visibleUntilMs <= Date.now()){
      stickyWinnerReveal = {
        handId: handId,
        visibleUntilMs: Date.now() + WINNER_REVEAL_MS,
        winners: winners.slice(),
        revealedWinnerCardsByUserId: cloneRevealedWinnerCards(state.revealedWinnerCardsByUserId),
        communityCards: Array.isArray(state.communityCards) ? state.communityCards.slice(0, 5) : []
      };
    }
  }

  function getActiveWinnerReveal(){
    if (!stickyWinnerReveal.handId) return null;
    if (stickyWinnerReveal.visibleUntilMs <= Date.now()) return null;
    return stickyWinnerReveal;
  }

  function getDisplayWinnerUserIds(){
    if (state.showdown && Array.isArray(state.showdown.winners) && state.showdown.winners.length){
      return state.showdown.winners;
    }
    var sticky = getActiveWinnerReveal();
    return sticky ? sticky.winners.slice() : [];
  }

  function mergeSnapshot(payload){
    if (!isObject(payload)) return;
    var snapshotTableId = typeof payload.tableId === 'string' && payload.tableId ? payload.tableId : null;
    var publicObj = isObject(payload.public) ? payload.public : {};
    var privateObj = isObject(payload.private) ? payload.private : {};
    var youObj = isObject(payload.you) ? payload.you : {};
    var tableObj = isObject(payload.table) ? payload.table : {};
    var handObj = isObject(payload.hand) ? payload.hand : isObject(publicObj.hand) ? publicObj.hand : {};
    var turnObj = isObject(payload.turn) ? payload.turn : isObject(publicObj.turn) ? publicObj.turn : {};
    var potObj = isObject(payload.pot) ? payload.pot : isObject(publicObj.pot) ? publicObj.pot : {};
    var showdownObj = isObject(payload.showdown) ? payload.showdown : isObject(publicObj.showdown) ? publicObj.showdown : null;
    var handSettlementObj = isObject(payload.handSettlement) ? payload.handSettlement : isObject(publicObj.handSettlement) ? publicObj.handSettlement : null;
    var legalSource = payload.legalActions != null ? payload.legalActions : publicObj.legalActions;
    var constraintsPrimary = payload.actionConstraints != null ? payload.actionConstraints : publicObj.actionConstraints;

    if (snapshotTableId && state.tableId && snapshotTableId !== state.tableId) return;
    if (snapshotTableId) state.tableId = snapshotTableId;
    else if (tableObj.tableId) state.tableId = tableObj.tableId;

    if (typeof tableObj.status === 'string' && tableObj.status) state.tableStatus = tableObj.status.toUpperCase();
    if (typeof payload.status === 'string' && payload.status) state.tableStatus = payload.status.toUpperCase();

    var resolvedMaxSeats = null;
    if (Number.isInteger(tableObj.maxSeats) && tableObj.maxSeats > 1) resolvedMaxSeats = tableObj.maxSeats;
    else if (Number.isInteger(tableObj.maxPlayers) && tableObj.maxPlayers > 1) resolvedMaxSeats = tableObj.maxPlayers;
    else if (Number.isInteger(payload.maxSeats) && payload.maxSeats > 1) resolvedMaxSeats = payload.maxSeats;
    if (resolvedMaxSeats) state.maxSeats = resolvedMaxSeats;

    var nextSeats = normalizeSeatRows(payload, state.seats);
    if (nextSeats.length) state.seats = nextSeats;

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

    var legalActions = normalizeLegalActions(legalSource);
    if (legalActions.length || Array.isArray(legalSource) || (isObject(legalSource) && Array.isArray(legalSource.actions))){
      state.legalActions = legalActions;
    }
    state.showdown = normalizeShowdown(showdownObj);
    state.handSettlement = normalizeHandSettlement(handSettlementObj);
    state.revealedWinnerCardsByUserId = mapRevealedWinnerCards(state.showdown);
    if (state.handId && previousHandId && state.handId !== previousHandId && (previousPhase === 'SETTLED' || stickyWinnerReveal.handId === previousHandId)){
      stickyWinnerReveal.visibleUntilMs = 0;
    }
    syncStickyWinnerReveal();
    state.actionConstraints = normalizeConstraints(constraintsPrimary, legalSource && legalSource.actionConstraints);
    state.statusText = LIVE_STATUS_COPY.live;
    state.errorText = '';
  }

  function isSignedIn(){
    return !!state.currentUserId;
  }

  function deriveCurrentSeat(){
    var currentUserId = state.currentUserId;
    if (!currentUserId) return null;
    for (var i = 0; i < state.seats.length; i++){
      if (state.seats[i] && state.seats[i].userId === currentUserId) return state.seats[i];
    }
    if (Number.isInteger(state.youSeat)){
      return { seatNo: state.youSeat, userId: currentUserId, status: 'ACTIVE', displayName: 'You' };
    }
    return null;
  }

  function getHeroVisualIndex(){
    var offset = getSeatNumberingOffset();
    var currentSeat = deriveCurrentSeat();
    if (!currentSeat || !Number.isInteger(currentSeat.seatNo)) return null;
    return Math.max(0, currentSeat.seatNo - offset);
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
    if (seat.userId && state.currentUserId && seat.userId === state.currentUserId) return 'You';
    return seat.displayName || (seat.isBot ? 'Bot' : shortId(seat.userId)) || 'Player';
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

  function isWinnerSeat(seat){
    if (!seat || typeof seat.userId !== 'string') return false;
    return getDisplayWinnerUserIds().indexOf(seat.userId) !== -1;
  }

  function getSeatRevealCards(seat){
    if (!seat || typeof seat.userId !== 'string') return null;
    var revealed = state.revealedWinnerCardsByUserId && state.revealedWinnerCardsByUserId[seat.userId];
    if ((!Array.isArray(revealed) || revealed.length !== 2) && getActiveWinnerReveal()){
      revealed = stickyWinnerReveal.revealedWinnerCardsByUserId[seat.userId];
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

  function renderSeats(){
    if (!els.seatLayer) return;
    els.seatLayer.innerHTML = '';
    renderedSeatAnchors = {};
    renderedSeatSlots = {};
    renderedSeatAvatars = {};
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
      var hero = !!(seat && seat.userId && state.currentUserId && seat.userId === state.currentUserId);
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
        + (seat && isWinnerSeat(seat) ? ' poker-seat--winner' : '')
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
      avatar.textContent = seat ? initials(getDisplayName(seat)) : '+';
      if (seat && Number.isInteger(seat.seatNo)) renderedSeatAvatars[seat.seatNo] = avatar;
      if (active){
        var turnClock = getTurnClockState();
        if (turnClock){
          var clock = document.createElement('div');
          clock.className = 'poker-seat-turn-clock' + (turnClock.remainingSeconds <= 5 ? ' poker-seat-turn-clock--warning' : '');
          clock.style.setProperty('--turn-progress', String(turnClock.ratio));
          clock.setAttribute('aria-hidden', 'true');
          avatar.appendChild(clock);
        }
      }

      var stack = document.createElement('div');
      stack.className = 'poker-seat-stack';
      stack.textContent = seat && seat.userId ? formatNumber(resolveStack(seat.userId)) : 'Open';

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
      status.className = 'poker-seat-status';
      status.textContent = seat ? String(seat.status || 'ACTIVE').replace(/_/g, ' ') : 'OPEN';

      article.appendChild(avatar);
      if (seat && isWinnerSeat(seat)){
        var winnerBadge = document.createElement('div');
        winnerBadge.className = 'poker-seat-winner-badge';
        var winnerTitle = document.createElement('div');
        winnerTitle.className = 'poker-seat-winner-title';
        winnerTitle.textContent = 'Winner';
        winnerBadge.appendChild(winnerTitle);
        var winnerSummary = getWinnerHandSummary(seat);
        if (winnerSummary){
          var winnerLabel = document.createElement('div');
          winnerLabel.className = 'poker-seat-winner-label';
          winnerLabel.textContent = winnerSummary.label;
          winnerBadge.appendChild(winnerLabel);
          var winnerCards = document.createElement('div');
          winnerCards.className = 'poker-seat-winner-cards';
          winnerSummary.cards.forEach(function(card){
            var normalizedWinnerCard = normalizeCard(card);
            var chip = document.createElement('span');
            chip.className = 'poker-seat-winner-card' + (normalizedWinnerCard && (normalizedWinnerCard.s === 'H' || normalizedWinnerCard.s === 'D') ? ' poker-seat-winner-card--red' : '');
            chip.textContent = normalizedWinnerCard ? (normalizedWinnerCard.r + SUIT_SYMBOLS[normalizedWinnerCard.s]) : '?';
            winnerCards.appendChild(chip);
          });
          winnerBadge.appendChild(winnerCards);
        }
        article.appendChild(winnerBadge);
      }
      article.appendChild(stack);
      if (cards.children.length) article.appendChild(cards);
      article.appendChild(name);
      if (!(hero && seat)) article.appendChild(status);
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
        var deltaX = sceneCenterX - avatarCenterX;
        var deltaY = sceneCenterY - avatarCenterY;
        var magnitude = Math.sqrt((deltaX * deltaX) + (deltaY * deltaY));
        if (magnitude > 0){
          var unitX = deltaX / magnitude;
          var unitY = deltaY / magnitude;
          var avatarRadius = Math.min(avatarRect.width, avatarRect.height) / 2;
          var chipRadius = Math.min(chipRect.width || 38, chipRect.height || 38) / 2;
          var contactDistance = avatarRadius + chipRadius - 2;
          var chipLeftPx = avatarCenterX + (unitX * contactDistance);
          var chipTopPx = avatarCenterY + (unitY * contactDistance);
          if (heroHasDealerChip) chipLeftPx -= chipRadius;
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
    if (slotIndex === 0) chipOffset = { x: 8, y: 7 };
    else if (slotIndex === 1) chipOffset = { x: -8, y: 8 };
    else if (slotIndex === 2) chipOffset = { x: -8, y: 7 };
    else if (slotIndex === 3) chipOffset = { x: -32, y: 3 };
    else if (slotIndex === 4) chipOffset = { x: 8, y: 7 };
    else if (slotIndex === 5) chipOffset = { x: 8, y: 8 };
    els.dealerChip.hidden = false;
    els.dealerChip.style.left = (anchor.x + chipOffset.x) + '%';
    els.dealerChip.style.top = (anchor.y + chipOffset.y) + '%';
  }

  function updateMenuLinks(){
    if (!els.classicLink || !els.v2Link) return;
    var suffix = state.tableId ? ('?tableId=' + encodeURIComponent(state.tableId)) : '';
    els.classicLink.href = '/poker/table.html' + suffix;
    els.v2Link.href = '/poker/table-v2.html' + suffix;
  }

  function isWsReady(){
    return !!(state.wsReady && wsClient && typeof wsClient.isReady === 'function' && wsClient.isReady());
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
      if (isUsersTurn()){
        els.turnText.textContent = 'Your turn';
      } else if (state.turnUserId){
        els.turnText.textContent = 'Acting: ' + shortId(state.turnUserId);
      } else {
        els.turnText.textContent = 'Waiting for action';
      }
    }
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
      return { type: 'RAISE', amount: Math.max(1, Math.trunc(constraints.maxRaiseTo)) };
    }
    if (allowed.indexOf('BET') !== -1){
      var maxBet = Number.isFinite(constraints.maxBetAmount) ? Math.max(1, Math.trunc(constraints.maxBetAmount)) : stackAmount;
      return { type: 'BET', amount: maxBet };
    }
    return null;
  }

  function renderControls(){
    var signedIn = isSignedIn();
    var seated = !!deriveCurrentSeat();
    var liveReady = isWsReady();
    var allowed = liveReady && isUsersTurn() ? getAllowedActions() : [];
    var primary = resolvePrimaryAction(allowed);
    var amountAction = resolveAmountAction(allowed);
    var allInPlan = resolveAllInPlan(allowed);
    var stackAmount = resolveStack(state.currentUserId);
    var joinDisabled = !signedIn || seated || !state.tableId || !liveReady;

    if (els.signInBtn) els.signInBtn.hidden = signedIn;
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
    if (els.stackText) els.stackText.textContent = stackAmount == null ? '—' : formatNumber(stackAmount);

    if (els.foldBtn){
      els.foldBtn.hidden = allowed.indexOf('FOLD') === -1;
      els.foldBtn.dataset.action = 'FOLD';
      els.foldBtn.disabled = !liveReady;
    }
    if (els.primaryBtn){
      els.primaryBtn.hidden = !primary;
      var toCall = Number.isFinite(state.actionConstraints && state.actionConstraints.toCall)
        ? Math.max(0, Math.trunc(state.actionConstraints.toCall))
        : null;
      els.primaryBtn.textContent = primary === 'CHECK'
        ? 'Check'
        : ('Call (' + formatCompactAmount(toCall) + ')');
      els.primaryBtn.dataset.action = primary || '';
      els.primaryBtn.disabled = !liveReady;
    }
    if (els.amountBtn){
      els.amountBtn.hidden = !amountAction;
      els.amountBtn.textContent = amountAction === 'RAISE' ? 'Raise' : 'Bet';
      els.amountBtn.dataset.action = amountAction || '';
      els.amountBtn.disabled = !liveReady;
    }
    if (els.allInBtn){
      els.allInBtn.hidden = !allInPlan;
      els.allInBtn.dataset.action = allInPlan ? allInPlan.type : '';
      els.allInBtn.disabled = !liveReady;
    }
    if (els.amountInputWrap){
      els.amountInputWrap.hidden = false;
      if (amountAction){
        var constraints = state.actionConstraints || {};
        var min = amountAction === 'RAISE' && Number.isFinite(constraints.minRaiseTo) ? Math.max(1, Math.trunc(constraints.minRaiseTo)) : 1;
        var max = amountAction === 'RAISE'
          ? (Number.isFinite(constraints.maxRaiseTo) ? Math.max(min, Math.trunc(constraints.maxRaiseTo)) : null)
          : (Number.isFinite(constraints.maxBetAmount) ? Math.max(1, Math.trunc(constraints.maxBetAmount)) : stackAmount);
        if (els.amountInput){
          els.amountInput.min = String(min);
          if (max != null) els.amountInput.max = String(max);
          else els.amountInput.removeAttribute('max');
          var defaultAmount = Math.min(max != null ? max : 20, Math.max(min, 20));
          if (!els.amountInput.value || Number(els.amountInput.value) < min || (max != null && Number(els.amountInput.value) > max)){
            els.amountInput.value = String(defaultAmount);
          }
        }
        if (els.amountValue) els.amountValue.textContent = formatCompactAmount(Number(els.amountInput && els.amountInput.value ? els.amountInput.value : min));
        if (els.amountInputWrap.classList && typeof els.amountInputWrap.classList.remove === 'function') els.amountInputWrap.classList.remove('is-disabled');
      } else if (els.amountInputWrap.classList && typeof els.amountInputWrap.classList.add === 'function') {
        els.amountInputWrap.classList.add('is-disabled');
      }
    }
    if (els.amountInput) els.amountInput.disabled = !liveReady || !amountAction;
    if (els.amountValue && !amountAction) {
      els.amountValue.textContent = formatCompactAmount(parseInt(els.amountInput && els.amountInput.value ? els.amountInput.value : '20', 10) || 20);
    }
  }

  function render(){
    if (els.potPill) els.potPill.textContent = 'Pot ' + formatNumber(state.potTotal || 0);
    renderCommunityCards();
    renderHeroCards();
    renderSeats();
    renderDealerChip();
    updateMenuLinks();
    renderInfoPanel();
    renderControls();
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
    var payload = { tableId: state.tableId };
    var buyIn = els.joinBuyIn ? parseInt(els.joinBuyIn.value, 10) : 100;
    if (Number.isFinite(buyIn) && buyIn > 0) payload.buyIn = buyIn;
    var seatNo = els.joinSeat ? parseInt(els.joinSeat.value, 10) : NaN;
    if (Number.isFinite(seatNo)) payload.seatNo = seatNo;
    return payload;
  }

  function sendCommand(methodName, payload){
    if (!wsClient || typeof wsClient[methodName] !== 'function' || !isWsReady()){
      setError('Live table connection is still starting');
      return Promise.reject(new Error('ws_unavailable'));
    }
    return wsClient[methodName](payload || {});
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

  function isSeatTakenError(error){
    var message = error && error.message ? String(error.message) : '';
    return /seat_taken/i.test(message);
  }

  function autoJoinSeat(){
    if (!shouldAutoJoin || autoJoinAttempted) return;
    if (!isSignedIn() || !isWsReady() || deriveCurrentSeat()) return;
    autoJoinAttempted = true;
    if (suggestedSeatNoParam && els.joinSeat) els.joinSeat.value = String(suggestedSeatNoParam);
    setError('');
    sendCommand('sendJoin', buildJoinPayload()).then(function(result){
      state.statusText = result && result.seatNo != null ? ('Joined seat ' + result.seatNo) : 'Join accepted';
      renderInfoPanel();
    }).catch(function(err){
      if (isSeatTakenError(err)) autoJoinAttempted = false;
      setError(err && err.message ? err.message : 'Failed to auto-join');
    });
  }

  function closeMenu(){
    if (!els.menuToggle || !els.menuPanel) return;
    els.menuPanel.setAttribute('hidden', 'hidden');
    els.menuToggle.setAttribute('aria-expanded', 'false');
  }

  function bindMenu(){
    if (!els.menuToggle || !els.menuPanel) return;
    els.menuToggle.addEventListener('click', function(){
      var hidden = els.menuPanel.hasAttribute('hidden');
      if (hidden) els.menuPanel.removeAttribute('hidden');
      else els.menuPanel.setAttribute('hidden', 'hidden');
      els.menuToggle.setAttribute('aria-expanded', hidden ? 'true' : 'false');
    });
    ['lobbyLink', 'classicLink', 'v2Link'].forEach(function(key){
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
    if (els.signInBtn) els.signInBtn.addEventListener('click', openSignIn);
    if (els.foldBtn) els.foldBtn.addEventListener('click', function(){
      handleAction('FOLD');
    });
    if (els.joinBtn) els.joinBtn.addEventListener('click', function(){
      setError('');
      sendCommand('sendJoin', buildJoinPayload()).then(function(result){
        state.statusText = result && result.seatNo != null ? ('Joined seat ' + result.seatNo) : 'Join accepted';
        renderInfoPanel();
      }).catch(function(err){
        setError(err && err.message ? err.message : 'Failed to join');
      });
    });
    if (els.leaveBtn) els.leaveBtn.addEventListener('click', function(){
      setError('');
      sendCommand('sendLeave', { tableId: state.tableId }).then(function(){
        state.statusText = 'Leave accepted';
        renderInfoPanel();
      }).catch(function(err){
        setError(err && err.message ? err.message : 'Failed to leave');
      });
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
    });
    if (els.joinSeat) els.joinSeat.addEventListener('input', function(){
      els.joinSeat.dataset.userEdited = '1';
    });
    if (els.allInBtn) els.allInBtn.addEventListener('click', function(){
      var plan = resolveAllInPlan(getAllowedActions());
      if (!plan) return;
      handleAction(plan.type, plan.amount == null ? undefined : plan.amount);
    });
  }

  function selectElements(){
    els.screen = document.getElementById('pokerTableScreen');
    els.bootSplash = document.getElementById('pokerBootSplash');
    els.menuToggle = document.getElementById('pokerMenuToggle');
    els.menuPanel = document.getElementById('pokerMenuPanel');
    els.lobbyLink = document.getElementById('pokerLobbyLink');
    els.classicLink = document.getElementById('pokerClassicLink');
    els.v2Link = document.getElementById('pokerV2Link');
    els.seatLayer = document.getElementById('pokerSeatLayer');
    els.potPill = document.getElementById('pokerPotPill');
    els.communityCards = document.getElementById('pokerCommunityCards');
    els.dealerChip = document.getElementById('pokerDealerChip');
    els.heroCards = document.getElementById('pokerHeroCards');
    els.liveStatus = document.getElementById('pokerV2LiveStatus');
    els.tableMeta = document.getElementById('pokerV2TableMeta');
    els.turnText = document.getElementById('pokerV2TurnText');
    els.stackText = document.getElementById('pokerV2StackText');
    els.errorText = document.getElementById('pokerV2ErrorText');
    els.signInBtn = document.getElementById('pokerV2SignInBtn');
    els.joinBtn = document.getElementById('pokerV2JoinBtn');
    els.joinSeat = document.getElementById('pokerV2SeatNo');
    els.joinBuyIn = document.getElementById('pokerV2BuyIn');
    els.leaveBtn = document.getElementById('pokerV2LeaveBtn');
    els.startBtn = document.getElementById('pokerV2StartBtn');
    els.foldBtn = document.getElementById('pokerV2FoldBtn');
    els.primaryBtn = document.getElementById('pokerV2PrimaryBtn');
    els.amountBtn = document.getElementById('pokerV2AmountBtn');
    els.allInBtn = document.getElementById('pokerV2AllInBtn');
    els.amountInput = document.getElementById('pokerV2AmountInput');
    els.amountValue = document.getElementById('pokerV2AmountValue');
    els.amountInputWrap = document.getElementById('pokerV2AmountInputWrap');
  }

  function startDemoMode(){
    startTurnClock();
    state = cloneState(demoState);
    state.wsReady = false;
    render();
    markBootReady();
  }

  function stopLiveMode(){
    stopTurnClock();
    state.wsReady = false;
    if (wsClient && typeof wsClient.destroy === 'function'){
      try { wsClient.destroy(); } catch (_err){}
    }
    wsClient = null;
  }

  function applySignedOutState(){
    stopLiveMode();
    state = createEmptyLiveState(tableId, null);
    state.statusText = LIVE_STATUS_COPY.auth;
    render();
  }

  function restartLiveMode(token){
    if (!tableId || !token) return;
    currentAccessToken = token;
    startLiveMode(token);
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
          autoJoinSeat();
        } else if (status === 'failed'){
          state.wsReady = false;
          state.statusText = LIVE_STATUS_COPY.error;
          setError(info && info.code ? info.code : 'Live connection failed');
        } else if (status === 'error'){
          state.wsReady = false;
          state.statusText = LIVE_STATUS_COPY.error;
          setError(info && info.code ? info.code : 'Live table unavailable');
        } else if (status === 'closed'){
          state.wsReady = false;
          state.statusText = LIVE_STATUS_COPY.disconnected;
          renderInfoPanel();
          renderControls();
        }
      },
      onSnapshot: function(snapshot){
        mergeSnapshot(snapshot && snapshot.payload ? snapshot.payload : null);
        render();
        autoJoinSeat();
      },
      onProtocolError: function(info){
        state.wsReady = false;
        state.statusText = LIVE_STATUS_COPY.error;
        if (info && info.code === 'missing_access_token'){
          applySignedOutState();
          return;
        }
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
        restartLiveMode(token);
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
      renderSeats();
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
        if (!user || !token){
          currentAccessToken = null;
          applySignedOutState();
          startAuthWatch();
          return;
        }
        stopAuthWatch();
        if (token !== currentAccessToken || !isWsReady()) restartLiveMode(token);
      }).catch(function(){
        currentAccessToken = null;
        applySignedOutState();
        startAuthWatch();
      });
    });
  }

  function init(){
    selectElements();
    suggestedSeatNoParam = readSeatParam();
    shouldAutoJoin = readAutoJoinParam();
    bindMenu();
    bindControls();
    bindAuthLifecycle();
    if (!tableId){
      startDemoMode();
      return;
    }
    getAccessToken().then(function(token){
      currentAccessToken = token;
      if (!token){
        applySignedOutState();
        startAuthWatch();
        return;
      }
      stopAuthWatch();
      startLiveMode(token);
    }).catch(function(){
      applySignedOutState();
      startAuthWatch();
    });
  }

  window.__PokerV2 = {
    _mergeSnapshot: mergeSnapshot,
    _resolveAllInPlan: resolveAllInPlan
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
