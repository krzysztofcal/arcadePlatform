(function(){
  if (typeof window === 'undefined') return;

  var LIST_URL = '/.netlify/functions/poker-list-tables';
  var CREATE_URL = '/.netlify/functions/poker-create-table';
  var QUICK_SEAT_URL = '/.netlify/functions/poker-quick-seat';
  var WS_JOIN_ENDPOINT = 'ws:join';
  var WS_LEAVE_ENDPOINT = 'ws:leave';
  var WS_START_HAND_ENDPOINT = 'ws:start_hand';
  var WS_ACT_ENDPOINT = 'ws:act';
  var EXPORT_LOG_URL = '/.netlify/functions/poker-export-log';
  var PENDING_RETRY_DELAYS = [150, 300, 600, 900];
  var PENDING_RETRY_BUDGET_MS = 2000;
  var UI_VERSION = '2025-02-19';
  var SHOWDOWN_FLYOUT_VISIBLE_MS = 4500;
  var POKER_DUMP_PATTERNS = [/\bpoker_[a-z0-9_]+\b/i, /\bpoker_rt_[a-z0-9_]+\b/i, /\bpoker_ws_[a-z0-9_]+\b/i, /\bws_[a-z0-9_]+\b/i, /\"\/.netlify\/functions\/poker-[^\"\s]+/i, /\/poker\//i];

  var state = { token: null };
  var showdownFlyoutHideTimer = null;
  var lastShowdownFlyoutKey = '';

  function klog(kind, data){
    try {
      if (window.KLog && typeof window.KLog.log === 'function'){
        window.KLog.log(kind, data || {});
      }
    } catch (_err){}
  }

  function ensurePokerRecorder(){
    try {
      if (!window.KLog || typeof window.KLog !== 'object') return false;
      if (typeof window.KLog.start !== 'function') return false;
      var info = null;
      if (typeof window.KLog.status === 'function'){
        try {
          info = window.KLog.status();
        } catch (_statusErr){
          info = null;
        }
      }
      if (info && typeof info.startedAt === 'number' && info.startedAt > 0){
        return true;
      }
      window.KLog.start(1);
      return true;
    } catch (_err){
      return false;
    }
  }

  function isPokerLogLine(line){
    if (typeof line !== 'string') return false;
    var text = line.trim();
    if (!text) return false;
    for (var i = 0; i < POKER_DUMP_PATTERNS.length; i++){
      if (POKER_DUMP_PATTERNS[i].test(text)) return true;
    }
    return false;
  }

  function getPokerDumpText(){
    try {
      if (!window.KLog || typeof window.KLog.getText !== 'function') return '';
      var raw = String(window.KLog.getText() || '');
      if (!raw) return '';
      var lines = raw.split(/\r?\n/);
      var filtered = [];
      for (var i = 0; i < lines.length; i++){
        if (isPokerLogLine(lines[i])) filtered.push(lines[i]);
      }
      return filtered.join('\n');
    } catch (_err){
      return '';
    }
  }

  async function copyTextToClipboard(text){
    var value = typeof text === 'string' ? text : String(text || '');
    if (!value) return false;
    var nav = typeof navigator !== 'undefined' ? navigator : null;
    if (nav && nav.clipboard && typeof nav.clipboard.writeText === 'function'){
      try {
        await nav.clipboard.writeText(value);
        return true;
      } catch (_clipErr){}
    }
    var doc = typeof document !== 'undefined' ? document : null;
    if (!doc || !doc.body || typeof doc.createElement !== 'function') return false;
    var area = doc.createElement('textarea');
    area.value = value;
    area.setAttribute('readonly', 'readonly');
    area.setAttribute('aria-hidden', 'true');
    area.style.position = 'fixed';
    area.style.top = '-9999px';
    area.style.left = '-9999px';
    area.style.opacity = '0';
    doc.body.appendChild(area);
    var ok = false;
    try {
      area.focus();
      area.select();
      area.setSelectionRange(0, area.value.length);
      ok = typeof doc.execCommand === 'function' ? doc.execCommand('copy') : false;
    } catch (_err){
      ok = false;
    }
    try { area.remove(); } catch (_removeErr){ if (area.parentNode) area.parentNode.removeChild(area); }
    return !!ok;
  }

  function getAuthBridge(){
    if (window.SupabaseAuthBridge && typeof window.SupabaseAuthBridge.getAccessToken === 'function'){
      return window.SupabaseAuthBridge;
    }
    try {
      if (window.parent && window.parent !== window && window.parent.SupabaseAuthBridge && typeof window.parent.SupabaseAuthBridge.getAccessToken === 'function'){
        return window.parent.SupabaseAuthBridge;
      }
    } catch (_err){}
    try {
      if (window.opener && window.opener.SupabaseAuthBridge && typeof window.opener.SupabaseAuthBridge.getAccessToken === 'function'){
        return window.opener.SupabaseAuthBridge;
      }
    } catch (_err2){}
    return null;
  }

  async function getAccessToken(){
    var bridge = getAuthBridge();
    if (!bridge) return null;
    try {
      return await bridge.getAccessToken();
    } catch (_err){
      return null;
    }
  }

  function getSignInBridge(){
    if (window.SupabaseAuthBridge) return window.SupabaseAuthBridge;
    try {
      if (window.parent && window.parent !== window && window.parent.SupabaseAuthBridge){
        return window.parent.SupabaseAuthBridge;
      }
    } catch (_err){}
    try {
      if (window.opener && window.opener.SupabaseAuthBridge){
        return window.opener.SupabaseAuthBridge;
      }
    } catch (_err2){}
    return null;
  }

  function openSignIn(){
    var bridge = getSignInBridge();
    if (bridge){
      var methods = ['signIn', 'openSignIn', 'showAuth', 'startLogin'];
      for (var i = 0; i < methods.length; i++){
        var name = methods[i];
        if (typeof bridge[name] === 'function'){
          try {
            bridge[name]();
            return;
          } catch (_err){
            break;
          }
        }
      }
    }
    window.location.href = '/index.html';
  }

  async function authedFetch(url, options){
    var token = await getAccessToken();
    if (!token){
      var err = new Error('not_authenticated');
      err.code = 'not_authenticated';
      throw err;
    }
    state.token = token;
    var opts = options || {};
    var headers = Object.assign({}, opts.headers || {});
    headers.Authorization = 'Bearer ' + token;
    if (opts.body && !headers['Content-Type']){
      headers['Content-Type'] = 'application/json';
    }
    return fetch(url, Object.assign({}, opts, { headers: headers }));
  }

  async function parseResponse(res){
    var body = {};
    try { body = await res.json(); } catch (_err){}
    if (res.ok) return body;
    var err = new Error(body.error || 'request_failed');
    err.status = res.status;
    err.code = body.error || 'request_failed';
    throw err;
  }

  function isAuthError(err){
    return !!(err && (err.code === 'not_authenticated' || err.status === 401));
  }

  function handleAuthExpired(opts){
    if (!opts) return;
    if (typeof opts.stopPolling === 'function'){
      opts.stopPolling();
    }
    if (typeof opts.stopHeartbeat === 'function'){
      opts.stopHeartbeat();
    }
    if (opts.authMsg) opts.authMsg.hidden = false;
    if (opts.content) opts.content.hidden = true;
    if (opts.errorEl){
      setError(opts.errorEl, t('pokerAuthExpired', 'Session expired. Please sign in again.'));
    }
    if (typeof opts.onAuthExpired === 'function'){
      opts.onAuthExpired();
    }
  }

  async function apiGet(url){
    var res = await authedFetch(url, { method: 'GET' });
    return await parseResponse(res);
  }

  async function apiPost(url, data){
    var res = await authedFetch(url, { method: 'POST', body: JSON.stringify(data || {}) });
    return await parseResponse(res);
  }

  function shortId(id){
    if (!id || typeof id !== 'string') return '';
    return id.substring(0, 8);
  }

  function isPlainObject(value){
    return !!(value && typeof value === 'object' && !Array.isArray(value));
  }

  function formatChips(amount){
    if (amount == null) return '—';
    var num = typeof amount === 'number' ? amount : parseInt(amount, 10);
    if (!isFinite(num)) return '—';
    num = Math.trunc(num);
    if (num < 0) return '—';
    return String(num);
  }

  function getStakesUiHelper(){
    if (window.PokerStakesUi && typeof window.PokerStakesUi.format === 'function'){
      return window.PokerStakesUi;
    }
    return null;
  }

  function parseStakesUi(stakes){
    var helper = getStakesUiHelper();
    if (helper && typeof helper.parse === 'function') return helper.parse(stakes);
    if (!stakes || typeof stakes !== 'object' || Array.isArray(stakes)) return null;
    var sb = parseInt(stakes.sb, 10);
    var bb = parseInt(stakes.bb, 10);
    if (!isFinite(sb) || !isFinite(bb)) return null;
    if (Math.floor(sb) !== sb || Math.floor(bb) !== bb) return null;
    if (sb < 0 || bb <= 0 || sb >= bb) return null;
    return { sb: sb, bb: bb };
  }

  function formatStakesUi(stakes){
    var helper = getStakesUiHelper();
    if (helper && typeof helper.format === 'function') return helper.format(stakes);
    var parsed = parseStakesUi(stakes);
    if (!parsed) return '—';
    return parsed.sb + '/' + parsed.bb;
  }

  function toFiniteOrNull(value){
    if (value == null) return null;
    if (typeof value === 'string' && !value.trim()) return null;
    var n = Number(value);
    if (!Number.isFinite(n)) return null;
    if (Math.floor(n) !== n) return null;
    if (n < 0) return null;
    return n;
  }

  function normalizeActionTypeValue(value){
    if (typeof value !== 'string') return '';
    return value.trim().toUpperCase();
  }

  function normalizeDeadlineMs(deadline){
    if (deadline == null) return null;
    var num = Number(deadline);
    if (!isFinite(num) || num <= 0) return null;
    if (num < 5e10){
      return num * 1000;
    }
    return num;
  }

  function computeRemainingTurnSeconds(deadline, nowMs){
    var deadlineMs = normalizeDeadlineMs(deadline);
    if (!deadlineMs) return 0;
    var now = Number(nowMs);
    if (!isFinite(now)) now = Date.now();
    return Math.max(0, Math.ceil((deadlineMs - now) / 1000));
  }

  function getConstraintsFromResponse(data){
    if (data && isPlainObject(data.actionConstraints)) return data.actionConstraints;
    var gameState = data && data.state && data.state.state;
    if (gameState && isPlainObject(gameState.actionConstraints)) return gameState.actionConstraints;
    return null;
  }

  function getLegalActionsFromResponse(data){
    if (data && Array.isArray(data.legalActions)) return data.legalActions;
    var gameState = data && data.state && data.state.state;
    if (gameState && Array.isArray(gameState.legalActions)) return gameState.legalActions;
    return [];
  }

  function getSafeConstraints(data){
    var constraints = getConstraintsFromResponse(data);
    return {
      toCall: toFiniteOrNull(constraints ? constraints.toCall : null),
      minRaiseTo: toFiniteOrNull(constraints ? constraints.minRaiseTo : null),
      maxRaiseTo: toFiniteOrNull(constraints ? constraints.maxRaiseTo : null),
      maxBetAmount: toFiniteOrNull(constraints ? constraints.maxBetAmount : null)
    };
  }

  function normalizeActionConstraints(constraints){
    var source = isPlainObject(constraints) ? constraints : null;
    return {
      toCall: toFiniteOrNull(source ? source.toCall : null),
      minRaiseTo: toFiniteOrNull(source ? source.minRaiseTo : null),
      maxRaiseTo: toFiniteOrNull(source ? source.maxRaiseTo : null),
      maxBetAmount: toFiniteOrNull(source ? source.maxBetAmount : null)
    };
  }

  function sanitizeAllowedActions(allowedSet, constraints){
    var sanitized = new Set();
    if (allowedSet && typeof allowedSet.forEach === 'function'){
      allowedSet.forEach(function(type){
        var normalizedType = normalizeActionTypeValue(type);
        if (normalizedType) sanitized.add(normalizedType);
      });
    }
    var safeConstraints = normalizeActionConstraints(constraints);
    if (safeConstraints.toCall != null){
      if (safeConstraints.toCall > 0){
        sanitized.delete('CHECK');
        sanitized.delete('BET');
      } else {
        sanitized.delete('CALL');
        sanitized.delete('RAISE');
      }
    }
    if (safeConstraints.maxBetAmount != null && safeConstraints.maxBetAmount < 1){
      sanitized.delete('BET');
    }
    if (safeConstraints.maxRaiseTo != null && safeConstraints.maxRaiseTo < 1){
      sanitized.delete('RAISE');
    }
    return {
      allowed: sanitized,
      needsAmount: sanitized.has('BET') || sanitized.has('RAISE'),
      constraints: safeConstraints
    };
  }

  function buildNormalizedAllowedActions(actions){
    var normalized = new Set();
    if (!Array.isArray(actions)) return normalized;
    for (var i = 0; i < actions.length; i++){
      var type = normalizeActionTypeValue(actions[i]);
      if (type) normalized.add(type);
    }
    return normalized;
  }

  function validateAmountActionPayload(actionType, amountValue, allowedInfo){
    var normalizedType = normalizeActionTypeValue(actionType);
    if (normalizedType !== 'BET' && normalizedType !== 'RAISE'){
      return { ok: true, amount: null };
    }
    if (!allowedInfo || !allowedInfo.allowed || !allowedInfo.allowed.has(normalizedType)){
      return { error: t('pokerErrActionNotAllowed', 'Action not allowed right now') };
    }
    var amount = parseInt(amountValue, 10);
    if (!isFinite(amount) || amount <= 0){
      return { error: t('pokerActAmountRequired', 'Enter an amount for bet/raise') };
    }
    var constraints = normalizeActionConstraints(allowedInfo.constraints);
    if (normalizedType === 'BET'){
      if (constraints.maxBetAmount != null && constraints.maxBetAmount >= 1 && amount > constraints.maxBetAmount){
        return { error: t('pokerErrActAmount', 'Invalid amount') };
      }
    } else if (normalizedType === 'RAISE'){
      var raiseMin = constraints.minRaiseTo;
      var raiseMax = constraints.maxRaiseTo;
      var hasValidRaiseRange = raiseMin != null && raiseMax != null && raiseMax >= raiseMin && raiseMax >= 1;
      if (hasValidRaiseRange && (amount < raiseMin || amount > raiseMax)){
        return { error: t('pokerErrActAmount', 'Invalid amount') };
      }
    }
    return { ok: true, amount: Math.trunc(amount) };
  }

  function clampAmountValue(value, min, max){
    var num = parseInt(value, 10);
    if (!isFinite(num)) num = min;
    num = Math.trunc(num);
    if (num < min) num = min;
    if (max != null && num > max) num = max;
    return num;
  }

  function resolveAmountActionModel(allowedInfo, preferredAmount, selectedActionType){
    var info = allowedInfo || {};
    var allowed = info.allowed;
    var constraints = normalizeActionConstraints(info.constraints);
    var hasBet = !!(allowed && allowed.has('BET'));
    var hasRaise = !!(allowed && allowed.has('RAISE'));
    var selected = normalizeActionTypeValue(selectedActionType);
    var actionType = null;
    var min = 1;
    var max = null;
    if (hasRaise && !hasBet){
      actionType = 'RAISE';
      min = constraints.minRaiseTo != null && constraints.minRaiseTo >= 1 ? constraints.minRaiseTo : 1;
      max = constraints.maxRaiseTo != null && constraints.maxRaiseTo >= min ? constraints.maxRaiseTo : null;
    } else if (hasBet && !hasRaise){
      actionType = 'BET';
      max = constraints.maxBetAmount != null && constraints.maxBetAmount >= 1 ? constraints.maxBetAmount : null;
    } else if (hasBet && hasRaise){
      if (selected === 'BET'){
        actionType = 'BET';
        max = constraints.maxBetAmount != null && constraints.maxBetAmount >= 1 ? constraints.maxBetAmount : null;
      } else if (selected === 'RAISE'){
        actionType = 'RAISE';
        min = constraints.minRaiseTo != null && constraints.minRaiseTo >= 1 ? constraints.minRaiseTo : 1;
        max = constraints.maxRaiseTo != null && constraints.maxRaiseTo >= min ? constraints.maxRaiseTo : null;
      } else {
        min = 1;
        max = null;
      }
    }
    if (!hasBet && !hasRaise) return { visible: false, actionType: null, hasBet: false, hasRaise: false, min: null, max: null, defaultValue: null, hintLabel: '' };
    var preferred = parseInt(preferredAmount, 10);
    if (!isFinite(preferred)) preferred = 20;
    preferred = Math.trunc(preferred);
    var defaultValue = clampAmountValue(preferred, min, max);
    var hint = '';
    if (actionType === 'RAISE'){
      var raiseRangeLabel = max == null ? String(min) + '+' : String(min) + '-' + String(max);
      hint = t('pokerRaiseRangeCompact', 'RAISE: {range}').replace('{range}', raiseRangeLabel);
    } else if (actionType === 'BET'){
      var betRangeLabel = max == null ? '1+' : '1-' + String(max);
      hint = t('pokerBetRangeCompact', 'BET: {range}').replace('{range}', betRangeLabel);
    } else {
      var betMax = constraints.maxBetAmount != null && constraints.maxBetAmount >= 1 ? constraints.maxBetAmount : null;
      var betLabel = betMax == null ? '1+' : '1-' + String(betMax);
      var raiseMin = constraints.minRaiseTo != null && constraints.minRaiseTo >= 1 ? constraints.minRaiseTo : 1;
      var raiseMax = constraints.maxRaiseTo != null && constraints.maxRaiseTo >= raiseMin ? constraints.maxRaiseTo : null;
      var raiseLabel = raiseMax == null ? String(raiseMin) + '+' : String(raiseMin) + '-' + String(raiseMax);
      hint = t('pokerAmountActionPickHint', 'BET: {bet} • RAISE: {raise} • Click BET or RAISE').replace('{bet}', betLabel).replace('{raise}', raiseLabel);
    }
    return { visible: true, actionType: actionType, hasBet: hasBet, hasRaise: hasRaise, min: min, max: max, defaultValue: defaultValue, hintLabel: hint };
  }

  function resolveCurrentUserStackAmount(data, userId){
    if (!data || !userId) return null;
    var stateObj = data && data.state ? data.state : null;
    var gameState = stateObj && stateObj.state ? stateObj.state : null;
    var stacks = gameState && typeof gameState.stacks === 'object' && !Array.isArray(gameState.stacks) ? gameState.stacks : null;
    if (!stacks || stacks[userId] == null) return null;
    var stackAmount = parseInt(stacks[userId], 10);
    if (!isFinite(stackAmount)) return null;
    stackAmount = Math.trunc(stackAmount);
    if (stackAmount < 0) return 0;
    return stackAmount;
  }

  function resolveAllInPlan(allowedInfo, data, userId){
    var info = allowedInfo || {};
    var allowed = info.allowed;
    if (!allowed || typeof allowed.has !== 'function') return null;
    var stackAmount = resolveCurrentUserStackAmount(data, userId);
    if (stackAmount == null || stackAmount < 1) return null;
    var constraints = normalizeActionConstraints(info.constraints);
    var toCall = constraints.toCall != null ? Math.max(0, Math.trunc(constraints.toCall)) : null;
    if (allowed.has('CALL') && toCall != null && toCall > 0 && stackAmount <= toCall){
      return { type: 'CALL', amount: null };
    }
    if (allowed.has('RAISE')){
      var raiseTo = constraints.maxRaiseTo != null ? Math.trunc(constraints.maxRaiseTo) : null;
      if (raiseTo != null && raiseTo >= 1){
        return { type: 'RAISE', amount: raiseTo };
      }
    }
    if (allowed.has('BET')){
      var betAmount = constraints.maxBetAmount != null ? Math.trunc(constraints.maxBetAmount) : stackAmount;
      if (betAmount >= 1){
        return { type: 'BET', amount: betAmount };
      }
    }
    return null;
  }

  function getSeatDisplayName(seat){
    if (!seat) return '';
    return seat.displayName || seat.name || seat.username || seat.userName || seat.handle || '';
  }

  function buildPlayersById(seats){
    var map = {};
    if (!Array.isArray(seats)) return map;
    seats.forEach(function(seat){
      if (!seat || !seat.userId) return;
      var uid = typeof seat.userId === 'string' ? seat.userId.trim() : '';
      if (!uid) return;
      var name = getSeatDisplayName(seat);
      if (name) map[uid] = name;
    });
    return map;
  }

  function shouldShowTurnActions(params){
    var phaseValue = params && params.phase;
    var phase = typeof phaseValue === 'string' ? phaseValue.trim().toUpperCase() : '';
    var isActionPhase = phase === 'PREFLOP' || phase === 'FLOP' || phase === 'TURN' || phase === 'RIVER';
    if (!isActionPhase) return false;
    var turnUserId = params && typeof params.turnUserId === 'string' ? params.turnUserId.trim() : '';
    var currentUserId = params && typeof params.currentUserId === 'string' ? params.currentUserId.trim() : '';
    if (!turnUserId || !currentUserId || turnUserId !== currentUserId) return false;
    return Array.isArray(params.legalActions) && params.legalActions.length > 0;
  }
  function resolveDevLogActionAvailability(flags){
    var info = flags || {};
    var baseEnabled = !!(info.devActionsEnabled && info.tableId && !info.joinPending && !info.leavePending && !info.startHandPending && !info.actPending);
    return {
      baseEnabled: baseEnabled,
      canDumpLogs: baseEnabled && !info.dumpLogsPending,
      canCopyLog: baseEnabled && !info.copyLogPending
    };
  }

  function resolveTurnActionUiState(params){
    var info = params || {};
    var availableActions = Array.isArray(info.availableActions) ? info.availableActions : [];
    var rawLegalActions = Array.isArray(info.rawLegalActions) ? info.rawLegalActions : [];
    var showActions = shouldShowTurnActions({
      phase: info.phase,
      turnUserId: info.turnUserId,
      currentUserId: info.currentUserId,
      legalActions: availableActions
    });
    var isUsersTurn = !!info.isUsersTurn;
    var status = null;
    if (isUsersTurn && availableActions.length === 0){
      status = rawLegalActions.length > 0 ? 'no_actionable_moves' : 'contract_mismatch';
    }
    return { showActions: showActions, status: status };
  }

  if (window.__RUNNING_POKER_UI_TESTS__ === true){
    window.__POKER_UI_TEST_HOOKS__ = {
      normalizeDeadlineMs: normalizeDeadlineMs,
      computeRemainingTurnSeconds: computeRemainingTurnSeconds,
      shouldShowTurnActions: shouldShowTurnActions,
      getConstraintsFromResponse: getConstraintsFromResponse,
      getLegalActionsFromResponse: getLegalActionsFromResponse,
      sanitizeAllowedActions: sanitizeAllowedActions,
      validateAmountActionPayload: validateAmountActionPayload,
      resolveAmountActionModel: resolveAmountActionModel,
      resolveTurnActionUiState: resolveTurnActionUiState,
      resolveAllInPlan: resolveAllInPlan,
      evaluateViewerBestHand: evaluateViewerBestHand,
      formatViewerHandCategory: formatViewerHandCategory,
      ensurePokerRecorder: ensurePokerRecorder,
      getPokerDumpText: getPokerDumpText,
      copyTextToClipboard: copyTextToClipboard,
      isPokerLogLine: isPokerLogLine,
      resolveDevLogActionAvailability: resolveDevLogActionAvailability
    };
  }

  function resolveUserLabel(entry, playersById){
    var userId = null;
    if (typeof entry === 'string'){
      userId = entry.trim();
    } else if (entry && typeof entry === 'object'){
      userId = entry.userId || entry.id || entry.uid;
    }
    if (typeof userId !== 'string'){
      userId = null;
    } else {
      userId = userId.trim();
    }
    if (!userId) return t('pokerUnknownUser', 'Unknown');
    if (playersById && playersById[userId]) return playersById[userId];
    var short = shortId(userId);
    return short || t('pokerUnknownUser', 'Unknown');
  }

  function formatWinnerList(winners, playersById){
    if (!Array.isArray(winners) || winners.length === 0) return '—';
    var labels = winners.map(function(winner){
      return resolveUserLabel(winner, playersById);
    }).filter(function(label){ return !!label; });
    return labels.length ? labels.join(', ') : '—';
  }

  function resolveWinnerUserId(entry){
    var userId = null;
    if (typeof entry === 'string'){
      userId = entry.trim();
    } else if (entry && typeof entry === 'object'){
      userId = entry.userId || entry.id || entry.uid || '';
      if (typeof userId === 'string') userId = userId.trim();
    }
    return userId || '';
  }

  function buildShowdownWinnerPayoutMap(showdown, handSettlement){
    var payouts = {};
    var winnerSet = new Set();
    var winners = showdown && Array.isArray(showdown.winners) ? showdown.winners : [];
    winners.forEach(function(winner){
      var winnerUserId = resolveWinnerUserId(winner);
      if (winnerUserId) winnerSet.add(winnerUserId);
    });

    if (handSettlement && isPlainObject(handSettlement.payouts)){
      Object.keys(handSettlement.payouts).forEach(function(userId){
        var normalizedUserId = typeof userId === 'string' ? userId.trim() : '';
        if (!normalizedUserId || (winnerSet.size > 0 && !winnerSet.has(normalizedUserId))) return;
        var amount = toFiniteOrNull(handSettlement.payouts[userId]);
        if (amount == null || amount <= 0) return;
        payouts[normalizedUserId] = (payouts[normalizedUserId] || 0) + amount;
      });
      if (Object.keys(payouts).length > 0){
        return payouts;
      }
    }

    var pots = showdown && Array.isArray(showdown.potsAwarded) ? showdown.potsAwarded : [];
    pots.forEach(function(pot){
      var amount = toFiniteOrNull(pot && pot.amount);
      if (amount == null || amount <= 0) return;
      var potWinnersRaw = pot && Array.isArray(pot.winners) ? pot.winners : [];
      var potWinners = [];
      var seenWinnerIds = new Set();
      potWinnersRaw.forEach(function(entry){
        var winnerUserId = resolveWinnerUserId(entry);
        if (!winnerUserId || seenWinnerIds.has(winnerUserId)) return;
        seenWinnerIds.add(winnerUserId);
        potWinners.push(winnerUserId);
      });
      if (!potWinners.length) return;
      var baseShare = Math.floor(amount / potWinners.length);
      var remainder = amount - (baseShare * potWinners.length);
      potWinners.forEach(function(userId, idx){
        var share = baseShare + (idx < remainder ? 1 : 0);
        if (share <= 0) return;
        payouts[userId] = (payouts[userId] || 0) + share;
      });
    });
    return payouts;
  }

  function hideShowdownFlyout(){
    var flyoutEl = document.getElementById('pokerShowdownFlyout');
    if (!flyoutEl) return;
    if (showdownFlyoutHideTimer){
      clearTimeout(showdownFlyoutHideTimer);
      showdownFlyoutHideTimer = null;
    }
    flyoutEl.classList.remove('poker-showdown-flyout--visible');
    flyoutEl.hidden = true;
  }

  function renderShowdownFlyout(opts){
    var flyoutEl = document.getElementById('pokerShowdownFlyout');
    if (!flyoutEl) return;
    var viewState = opts && opts.state ? opts.state : {};
    var showdown = viewState && isPlainObject(viewState.showdown) ? viewState.showdown : null;
    if (!showdown){
      hideShowdownFlyout();
      return;
    }

    var winners = Array.isArray(showdown.winners) ? showdown.winners : [];
    var winnersSignature = winners.map(function(entry){ return resolveWinnerUserId(entry) || '?'; }).join(',');
    var handId = typeof showdown.handId === 'string' ? showdown.handId.trim() : '';
    var awardedAt = typeof showdown.awardedAt === 'string' ? showdown.awardedAt.trim() : '';
    var tableIdValue = opts && typeof opts.tableId === 'string' ? opts.tableId.trim() : '';
    var dedupeCore = handId || (awardedAt + '|' + winnersSignature + '|' + String(showdown.reason || ''));
    var dedupeKey = (tableIdValue || '-') + '|' + dedupeCore;
    if (!dedupeCore) return;
    if (lastShowdownFlyoutKey && lastShowdownFlyoutKey === dedupeKey) return;
    lastShowdownFlyoutKey = dedupeKey;

    var playersById = opts && opts.playersById ? opts.playersById : {};
    var winnerPayouts = buildShowdownWinnerPayoutMap(showdown, viewState && isPlainObject(viewState.handSettlement) ? viewState.handSettlement : null);
    var viewerHoleCards = opts && Array.isArray(opts.viewerHoleCards) ? opts.viewerHoleCards.slice(0, 2) : [];
    var viewerId = opts && typeof opts.currentUserId === 'string' ? opts.currentUserId.trim() : '';
    var viewerWon = !!(viewerId && winners.some(function(entry){ return resolveWinnerUserId(entry) === viewerId; }));
    flyoutEl.textContent = '';
    flyoutEl.classList.toggle('poker-showdown-flyout--won', viewerWon);

    var titleEl = document.createElement('div');
    titleEl.className = 'poker-showdown-flyout__title';
    titleEl.textContent = viewerWon
      ? t('pokerShowdownFlyoutTitleYouWon', 'Congratulations, you won!')
      : t('pokerShowdownFlyoutTitle', 'Hand settled');
    flyoutEl.appendChild(titleEl);

    var winnersLabelEl = document.createElement('div');
    winnersLabelEl.className = 'poker-showdown-flyout__label';
    winnersLabelEl.textContent = t('pokerShowdownWinnersLabel', 'Winners');
    flyoutEl.appendChild(winnersLabelEl);

    var winnersValueEl = document.createElement('div');
    winnersValueEl.className = 'poker-showdown-flyout__value';
    winnersValueEl.textContent = formatWinnerList(winners, playersById);
    flyoutEl.appendChild(winnersValueEl);

    var payoutsLabelEl = document.createElement('div');
    payoutsLabelEl.className = 'poker-showdown-flyout__label';
    payoutsLabelEl.textContent = t('pokerShowdownFlyoutPayouts', 'Payouts');
    flyoutEl.appendChild(payoutsLabelEl);

    var payoutsListEl = document.createElement('div');
    payoutsListEl.className = 'poker-showdown-flyout__list';
    var payoutUserIds = Object.keys(winnerPayouts);
    if (!payoutUserIds.length){
      var emptyPayoutEl = document.createElement('div');
      emptyPayoutEl.className = 'poker-showdown-flyout__row';
      emptyPayoutEl.textContent = t('pokerShowdownNoPots', 'No pot award data');
      payoutsListEl.appendChild(emptyPayoutEl);
    } else {
      payoutUserIds.forEach(function(userId){
        var payoutRow = document.createElement('div');
        payoutRow.className = 'poker-showdown-flyout__row';
        payoutRow.textContent = '+' + formatChips(winnerPayouts[userId]);
        payoutsListEl.appendChild(payoutRow);
      });
    }
    flyoutEl.appendChild(payoutsListEl);

    var reason = typeof showdown.reason === 'string' ? showdown.reason.trim().toLowerCase() : '';
    var canShowCards = reason !== 'all_folded';
    if (canShowCards && viewerWon && viewerHoleCards.length === 2){
      var cardsLabelEl = document.createElement('div');
      cardsLabelEl.className = 'poker-showdown-flyout__label';
      cardsLabelEl.textContent = t('pokerShowdownFlyoutCards', 'Winner cards');
      flyoutEl.appendChild(cardsLabelEl);

      var cardsWrapEl = document.createElement('div');
      cardsWrapEl.className = 'poker-showdown-flyout__cards';
      cardsWrapEl.appendChild(buildCardElement(viewerHoleCards[0] || {}));
      cardsWrapEl.appendChild(buildCardElement(viewerHoleCards[1] || {}));
      flyoutEl.appendChild(cardsWrapEl);
    }

    if (showdownFlyoutHideTimer){
      clearTimeout(showdownFlyoutHideTimer);
      showdownFlyoutHideTimer = null;
    }
    flyoutEl.hidden = false;
    void flyoutEl.offsetWidth;
    flyoutEl.classList.add('poker-showdown-flyout--visible');
    klog('poker_showdown_flyout_show', {
      tableId: tableIdValue || null,
      handId: handId || null,
      reason: reason || null,
      winnersCount: winners.length,
      payoutCount: payoutUserIds.length,
      viewerWon: viewerWon,
      cardsVisible: canShowCards && viewerWon && viewerHoleCards.length === 2
    });
    showdownFlyoutHideTimer = setTimeout(function(){
      flyoutEl.classList.remove('poker-showdown-flyout--visible');
      flyoutEl.hidden = true;
      klog('poker_showdown_flyout_hide', {
        tableId: tableIdValue || null,
        handId: handId || null
      });
      showdownFlyoutHideTimer = null;
    }, SHOWDOWN_FLYOUT_VISIBLE_MS);
  }

  function generateRequestId(){
    return 'ui-' + Date.now() + '-' + Math.random().toString(36).substring(2, 8);
  }

  function getValidRequestId(value){
    if (typeof value !== 'string') return null;
    var trimmed = value.trim();
    if (!trimmed) return null;
    if (trimmed === '[object PointerEvent]') return null;
    if (trimmed.length > 200) return null;
    return trimmed;
  }

  function normalizeRequestId(value){
    var trimmed = getValidRequestId(value);
    return trimmed || String(generateRequestId());
  }

  function buildWsUnavailableError(action, fallbackMessage){
    var message = fallbackMessage || t('pokerErrWsUnavailable', 'Live table connection unavailable. Please wait for WebSocket reconnect and try again.');
    var err = new Error(message);
    err.code = 'ws_unavailable';
    err.action = action || null;
    return err;
  }

  function getGameplayWsSender(client, methodName, action, fallbackMessage){
    if (!client || typeof client.isReady !== 'function' || !client.isReady()) return null;
    if (typeof client[methodName] !== 'function') return null;
    return function(payload, requestId){
      return client[methodName](payload, requestId);
    };
  }

  function resolveGameplayWsSender(client, methodName, action, fallbackMessage){
    var sender = getGameplayWsSender(client, methodName, action, fallbackMessage);
    if (sender) return sender;
    throw buildWsUnavailableError(action, fallbackMessage);
  }

  function resolveRequestId(pendingValue, overrideValue){
    var override = getValidRequestId(overrideValue);
    if (override) return { requestId: override, nextPending: null };
    var pending = getValidRequestId(pendingValue);
    if (pending) return { requestId: pending, nextPending: pending };
    var generated = normalizeRequestId(generateRequestId());
    return { requestId: generated, nextPending: generated };
  }

  function t(key, fallback){
    if (window.I18N && typeof window.I18N.t === 'function'){
      var val = window.I18N.t(key);
      if (val) return val;
    }
    return fallback || key;
  }

  function decodeBase64Url(str){
    var base64 = str.replace(/-/g, '+').replace(/_/g, '/');
    var pad = base64.length % 4;
    if (pad){ base64 += '===='.substring(pad); }
    return atob(base64);
  }

  function decodeJwtPayload(token){
    if (!token || typeof token !== 'string') return null;
    var parts = token.split('.');
    if (parts.length < 2) return null;
    try {
      var decoded = decodeBase64Url(parts[1]);
      return JSON.parse(decoded);
    } catch (_err){
      return null;
    }
  }

  function getUserIdFromToken(token){
    var payload = decodeJwtPayload(token);
    return payload && payload.sub ? payload.sub : null;
  }

  function setError(el, msg){
    if (!el) return;
    if (msg){
      el.textContent = msg;
      el.hidden = false;
    } else {
      el.hidden = true;
    }
  }

  function setInlineStatus(el, msg, tone){
    if (!el) return;
    if (msg){
      el.textContent = msg;
      el.hidden = false;
      el.classList.remove('poker-inline-status--error', 'poker-inline-status--success');
      if (tone === 'error') el.classList.add('poker-inline-status--error');
      if (tone === 'success') el.classList.add('poker-inline-status--success');
    } else {
      el.textContent = '';
      el.hidden = true;
      el.classList.remove('poker-inline-status--error', 'poker-inline-status--success');
    }
  }

  function setLoading(el, loading){
    if (!el) return;
    el.disabled = loading;
  }

  function setDisabled(el, disabled){
    if (!el) return;
    el.disabled = !!disabled;
  }

  function renderPhaseLabel(state){
    var phaseLabelEl = document.getElementById('pokerPhaseLabel');
    if (!phaseLabelEl) return;
    var phase = state && typeof state.phase === 'string' && state.phase ? state.phase : 'UNKNOWN';
    phaseLabelEl.textContent = 'Phase: ' + phase;
  }

  function getSuitSymbol(suit){
    var key = typeof suit === 'string' ? suit.toUpperCase() : '';
    if (key === 'S') return '♠';
    if (key === 'H') return '♥';
    if (key === 'D') return '♦';
    if (key === 'C') return '♣';
    return '?';
  }

  function formatRank(r){
    if (r == null) return '?';
    if (typeof r === 'string'){
      var upper = r.toUpperCase();
      if (upper === 'A' || upper === 'K' || upper === 'Q' || upper === 'J') return upper;
    }
    var n = Number(r);
    if (!Number.isFinite(n)) return String(r) || '?';
    n = Math.trunc(n);
    if (n === 14) return 'A';
    if (n === 13) return 'K';
    if (n === 12) return 'Q';
    if (n === 11) return 'J';
    if (n >= 2 && n <= 10) return String(n);
    return '?';
  }

  function isRedSuit(suit){
    var key = typeof suit === 'string' ? suit.toUpperCase() : '';
    return key === 'H' || key === 'D';
  }

  function buildCardElement(card){
    var rank = formatRank(card && card.r != null ? card.r : null);
    var suitKey = card && card.s != null ? String(card.s).toUpperCase() : '';
    var suit = getSuitSymbol(suitKey);
    var cardEl = document.createElement('div');
    cardEl.className = 'poker-card' + (isRedSuit(suitKey) ? ' poker-card--red' : '');
    var rankEl = document.createElement('span');
    rankEl.className = 'poker-card__rank';
    rankEl.textContent = rank;
    var suitEl = document.createElement('span');
    suitEl.className = 'poker-card__suit';
    suitEl.textContent = suit;
    cardEl.appendChild(rankEl);
    cardEl.appendChild(suitEl);
    return cardEl;
  }

  var VIEWER_HAND_CATEGORY = {
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
    if (!value) return null;
    if (value !== 'S' && value !== 'H' && value !== 'D' && value !== 'C') return null;
    return value;
  }

  function normalizeEvalCards(cards){
    if (!Array.isArray(cards)) return null;
    if (cards.length < 5) return null;
    var out = [];
    var seen = new Set();
    for (var i = 0; i < cards.length; i++){
      var card = cards[i];
      if (!card || typeof card !== 'object') return null;
      var rank = normalizeEvalRank(card.r);
      var suit = normalizeEvalSuit(card.s);
      if (!rank || !suit) return null;
      var key = String(rank) + '-' + suit;
      if (seen.has(key)) return null;
      seen.add(key);
      out.push({ rank: rank, suit: suit, raw: card });
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
    var rankSet = new Set(Array.isArray(ranksDesc) ? ranksDesc : []);
    if (rankSet.has(14)) rankSet.add(1);
    for (var high = 14; high >= 5; high--){
      var ok = true;
      for (var i = 0; i < 5; i++){
        if (!rankSet.has(high - i)){
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
      var current = ranks[i];
      var actual = current === 1 ? 14 : current;
      var list = cardsByRank.get(actual) || [];
      result.push(list[0]);
    }
    return result;
  }

  function evaluateViewerBestHand(cards){
    var normalized = normalizeEvalCards(cards);
    if (!normalized) return null;
    var allSorted = normalized.slice().sort(sortByRankDescThenSuit);
    var cardsByRank = new Map();
    var cardsBySuit = new Map();
    for (var i = 0; i < normalized.length; i++){
      var card = normalized[i];
      if (!cardsByRank.has(card.rank)) cardsByRank.set(card.rank, []);
      cardsByRank.get(card.rank).push(card);
      if (!cardsBySuit.has(card.suit)) cardsBySuit.set(card.suit, []);
      cardsBySuit.get(card.suit).push(card);
    }
    cardsByRank.forEach(function(list){ list.sort(function(a, b){ return a.suit.localeCompare(b.suit); }); });
    cardsBySuit.forEach(function(list){ list.sort(sortByRankDescThenSuit); });

    var uniqueRanksDesc = Array.from(cardsByRank.keys()).sort(function(a, b){ return b - a; });
    var ranksByCount = { 1: [], 2: [], 3: [], 4: [] };
    uniqueRanksDesc.forEach(function(rank){
      var count = (cardsByRank.get(rank) || []).length;
      if (!ranksByCount[count]) ranksByCount[count] = [];
      ranksByCount[count].push(rank);
    });

    var bestStraightFlush = null;
    var suitNames = Array.from(cardsBySuit.keys()).sort();
    for (var suitIndex = 0; suitIndex < suitNames.length; suitIndex++){
      var suitName = suitNames[suitIndex];
      var suitedCards = cardsBySuit.get(suitName) || [];
      if (suitedCards.length < 5) continue;
      var suitRanks = Array.from(new Set(suitedCards.map(function(entry){ return entry.rank; }))).sort(function(a, b){ return b - a; });
      var straightInSuit = findStraightRanks(suitRanks);
      if (!straightInSuit) continue;
      var cardsByRankSuit = new Map();
      suitedCards.forEach(function(entry){
        if (!cardsByRankSuit.has(entry.rank)) cardsByRankSuit.set(entry.rank, []);
        cardsByRankSuit.get(entry.rank).push(entry);
      });
      cardsByRankSuit.forEach(function(list){ list.sort(function(a, b){ return a.suit.localeCompare(b.suit); }); });
      var candidate = {
        high: straightInSuit.high === 1 ? 5 : straightInSuit.high,
        cards: pickStraightCards(straightInSuit.ranks, cardsByRankSuit)
      };
      if (!bestStraightFlush || candidate.high > bestStraightFlush.high){
        bestStraightFlush = candidate;
      }
    }
    if (bestStraightFlush){
      return { category: VIEWER_HAND_CATEGORY.STRAIGHT_FLUSH, cards: bestStraightFlush.cards.map(function(entry){ return entry.raw; }) };
    }

    if (ranksByCount[4].length){
      var quadRank = ranksByCount[4][0];
      var quadCards = (cardsByRank.get(quadRank) || []).slice(0, 4);
      var quadKicker = allSorted.find(function(entry){ return entry.rank !== quadRank; });
      return { category: VIEWER_HAND_CATEGORY.QUADS, cards: quadCards.concat([quadKicker]).map(function(entry){ return entry.raw; }) };
    }

    if (ranksByCount[3].length){
      var tripRank = ranksByCount[3][0];
      var pairRank = ranksByCount[2].find(function(rank){ return rank !== tripRank; }) || ranksByCount[3][1];
      if (pairRank){
        var tripCards = (cardsByRank.get(tripRank) || []).slice(0, 3);
        var pairCards = (cardsByRank.get(pairRank) || []).slice(0, 2);
        return { category: VIEWER_HAND_CATEGORY.FULL_HOUSE, cards: tripCards.concat(pairCards).map(function(entry){ return entry.raw; }) };
      }
    }

    var bestFlush = null;
    for (var flushSuitIndex = 0; flushSuitIndex < suitNames.length; flushSuitIndex++){
      var flushSuitName = suitNames[flushSuitIndex];
      var flushCards = cardsBySuit.get(flushSuitName) || [];
      if (flushCards.length < 5) continue;
      var topFlush = flushCards.slice(0, 5);
      var topFlushRanks = topFlush.map(function(entry){ return entry.rank; });
      if (!bestFlush || compareRankVectors(topFlushRanks, bestFlush.ranks) > 0){
        bestFlush = { ranks: topFlushRanks, cards: topFlush };
      }
    }
    if (bestFlush){
      return { category: VIEWER_HAND_CATEGORY.FLUSH, cards: bestFlush.cards.map(function(entry){ return entry.raw; }) };
    }

    var straight = findStraightRanks(uniqueRanksDesc);
    if (straight){
      return { category: VIEWER_HAND_CATEGORY.STRAIGHT, cards: pickStraightCards(straight.ranks, cardsByRank).map(function(entry){ return entry.raw; }) };
    }

    if (ranksByCount[3].length){
      var tripsRank = ranksByCount[3][0];
      var tripsCards = (cardsByRank.get(tripsRank) || []).slice(0, 3);
      var tripsKickers = allSorted.filter(function(entry){ return entry.rank !== tripsRank; }).slice(0, 2);
      return { category: VIEWER_HAND_CATEGORY.TRIPS, cards: tripsCards.concat(tripsKickers).map(function(entry){ return entry.raw; }) };
    }

    if (ranksByCount[2].length >= 2){
      var highPair = ranksByCount[2][0];
      var lowPair = ranksByCount[2][1];
      var highPairCards = (cardsByRank.get(highPair) || []).slice(0, 2);
      var lowPairCards = (cardsByRank.get(lowPair) || []).slice(0, 2);
      var twoPairKicker = allSorted.find(function(entry){ return entry.rank !== highPair && entry.rank !== lowPair; });
      return { category: VIEWER_HAND_CATEGORY.TWO_PAIR, cards: highPairCards.concat(lowPairCards).concat([twoPairKicker]).map(function(entry){ return entry.raw; }) };
    }

    if (ranksByCount[2].length){
      var pairRankOnly = ranksByCount[2][0];
      var pairOnlyCards = (cardsByRank.get(pairRankOnly) || []).slice(0, 2);
      var pairOnlyKickers = allSorted.filter(function(entry){ return entry.rank !== pairRankOnly; }).slice(0, 3);
      return { category: VIEWER_HAND_CATEGORY.PAIR, cards: pairOnlyCards.concat(pairOnlyKickers).map(function(entry){ return entry.raw; }) };
    }

    return { category: VIEWER_HAND_CATEGORY.HIGH_CARD, cards: allSorted.slice(0, 5).map(function(entry){ return entry.raw; }) };
  }

  function formatViewerHandCategory(category){
    var key = Number(category);
    if (key === VIEWER_HAND_CATEGORY.STRAIGHT_FLUSH) return t('pokerBestHandStraightFlush', 'Straight Flush');
    if (key === VIEWER_HAND_CATEGORY.QUADS) return t('pokerBestHandQuads', 'Four of a Kind');
    if (key === VIEWER_HAND_CATEGORY.FULL_HOUSE) return t('pokerBestHandFullHouse', 'Full House');
    if (key === VIEWER_HAND_CATEGORY.FLUSH) return t('pokerBestHandFlush', 'Flush');
    if (key === VIEWER_HAND_CATEGORY.STRAIGHT) return t('pokerBestHandStraight', 'Straight');
    if (key === VIEWER_HAND_CATEGORY.TRIPS) return t('pokerBestHandTrips', 'Three of a Kind');
    if (key === VIEWER_HAND_CATEGORY.TWO_PAIR) return t('pokerBestHandTwoPair', 'Two Pair');
    if (key === VIEWER_HAND_CATEGORY.PAIR) return t('pokerBestHandPair', 'Pair');
    return t('pokerBestHandHighCard', 'High Card');
  }

  function renderCommunityBoard(state){
    var boardEl = document.getElementById('pokerBoard');
    if (!boardEl) return;
    var cards = state && Array.isArray(state.community) ? state.community.slice(0, 5) : [];
    boardEl.innerHTML = '';
    for (var i = 0; i < cards.length; i++){
      var card = cards[i] || {};
      boardEl.appendChild(buildCardElement(card));
    }
  }

  function renderShowdownPanel(opts){
    var panel = document.getElementById('showdownPanel');
    if (!panel) return;
    var winnersEl = document.getElementById('showdownWinners');
    var potsEl = document.getElementById('showdownPots');
    var totalEl = document.getElementById('showdownTotal');
    var totalRowEl = document.getElementById('showdownTotalRow');
    var metaEl = document.getElementById('showdownMeta');
    var viewState = opts && opts.state ? opts.state : {};
    var playersById = opts && opts.playersById ? opts.playersById : {};
    var showdown = viewState && isPlainObject(viewState.showdown) ? viewState.showdown : null;
    var shouldShow = !!showdown;
    if (!shouldShow){
      panel.hidden = true;
      if (winnersEl) winnersEl.textContent = '';
      if (potsEl) potsEl.textContent = '';
      if (totalEl) totalEl.textContent = '';
      if (totalRowEl) totalRowEl.hidden = true;
      if (metaEl) metaEl.hidden = true;
      if (metaEl) metaEl.textContent = '';
      return;
    }
    renderShowdownFlyout(opts || {});
    panel.hidden = false;

    if (winnersEl){
      winnersEl.textContent = '';
      var winners = showdown && Array.isArray(showdown.winners) ? showdown.winners : [];
      if (!winners.length){
        winnersEl.textContent = t('pokerShowdownNoWinners', 'No winners');
      } else {
        var winnersList = document.createElement('div');
        winnersList.className = 'poker-showdown-list';
        winners.forEach(function(winner){
          var row = document.createElement('div');
          row.className = 'poker-showdown-row';
          row.textContent = resolveUserLabel(winner, playersById);
          winnersList.appendChild(row);
        });
        winnersEl.appendChild(winnersList);
      }
    }

    if (potsEl){
      potsEl.textContent = '';
      var pots = showdown && Array.isArray(showdown.potsAwarded) ? showdown.potsAwarded : [];
      if (!pots.length){
        potsEl.textContent = t('pokerShowdownNoPots', 'No pot award data');
      } else {
        var potList = document.createElement('div');
        potList.className = 'poker-showdown-list';
        pots.forEach(function(pot, idx){
          var row = document.createElement('div');
          row.className = 'poker-showdown-row';
          var amount = formatChips(pot && pot.amount != null ? pot.amount : null);
          var winnersLabel = formatWinnerList(pot && pot.winners ? pot.winners : [], playersById);
          row.textContent = t('pokerShowdownPotPrefix', 'Pot #') + (idx + 1) + ': ' + amount + ' \u2192 ' + winnersLabel;
          potList.appendChild(row);
        });
        potsEl.appendChild(potList);
      }
    }

    var totalAmount = showdown && showdown.potAwardedTotal != null ? showdown.potAwardedTotal : (showdown && showdown.potAwarded != null ? showdown.potAwarded : null);
    if (totalRowEl){
      if (totalAmount == null){
        totalRowEl.hidden = true;
      } else {
        totalRowEl.hidden = false;
      }
    }
    if (totalEl){
      totalEl.textContent = totalAmount == null ? '—' : formatChips(totalAmount);
    }

    if (metaEl){
      metaEl.textContent = '';
      var metaLines = [];
      if (showdown && showdown.handId) metaLines.push(t('pokerShowdownHandId', 'Hand ID') + ': ' + showdown.handId);
      if (showdown && showdown.awardedAt) metaLines.push(t('pokerShowdownAwardedAt', 'Awarded') + ': ' + showdown.awardedAt);
      if (showdown && showdown.reason) metaLines.push(t('pokerShowdownReason', 'Reason') + ': ' + showdown.reason);
      if (metaLines.length){
        metaLines.forEach(function(line){
          var row = document.createElement('div');
          row.textContent = line;
          metaEl.appendChild(row);
        });
        metaEl.hidden = false;
      } else {
        metaEl.hidden = true;
      }
    }
  }

  function isPendingResponse(data){
    return !!(data && data.pending);
  }

  function isAbortError(err){
    return !!(err && (err.name === 'AbortError' || err.code === 'abort' || err.code === 'aborted'));
  }

  function isPageActive(){
    return document.visibilityState !== 'hidden';
  }

  function scheduleRetry(fn, delayMs){
    if (typeof fn !== 'function') return;
    var delay = typeof delayMs === 'number' ? delayMs : 600;
    return setTimeout(function(){
      fn();
    }, delay);
  }

  function getPendingDelay(retries){
    var idx = Math.max(0, retries - 1);
    if (idx >= PENDING_RETRY_DELAYS.length) return PENDING_RETRY_DELAYS[PENDING_RETRY_DELAYS.length - 1];
    return PENDING_RETRY_DELAYS[idx];
  }

  function shouldRetryPending(startedAt, delayMs){
    if (!startedAt) return true;
    var elapsed = Date.now() - startedAt;
    return elapsed + delayMs <= PENDING_RETRY_BUDGET_MS;
  }

  function persistLastError(payload){
    if (!payload) return;
    try {
      localStorage.setItem('poker:lastError', JSON.stringify(payload));
    } catch (_err){}
  }

  // ========== LOBBY PAGE ==========
  function initLobby(){
    ensurePokerRecorder();

    var errorEl = document.getElementById('pokerError');
    var authMsg = document.getElementById('pokerAuthMsg');
    var lobbyContent = document.getElementById('pokerLobbyContent');
    var tableList = document.getElementById('pokerTableList');
    var refreshBtn = document.getElementById('pokerRefresh');
    var quickSeatBtn = document.getElementById('pokerQuickSeat');
    var createBtn = document.getElementById('pokerCreate');
    var sbInput = document.getElementById('pokerSb');
    var bbInput = document.getElementById('pokerBb');
    var maxPlayersInput = document.getElementById('pokerMaxPlayers');
    var signInBtn = document.getElementById('pokerSignIn');

    var authTimer = null;

    function stopAuthWatch(){
      if (authTimer){
        clearInterval(authTimer);
        authTimer = null;
      }
    }

    function startAuthWatch(){
      if (authTimer) return;
      authTimer = setInterval(function(){
        checkAuth().then(function(authed){
          if (authed){
            stopAuthWatch();
            loadTables();
          }
        });
      }, 3000);
    }

    async function checkAuth(){
      var token = await getAccessToken();
      if (!token){
        if (authMsg) authMsg.hidden = false;
        if (lobbyContent) lobbyContent.hidden = true;
        startAuthWatch();
        return false;
      }
      if (authMsg) authMsg.hidden = true;
      if (lobbyContent) lobbyContent.hidden = false;
      stopAuthWatch();
      return true;
    }

    async function loadTables(){
      setError(errorEl, null);
      if (tableList) tableList.innerHTML = '<div class="poker-loading">' + t('loading', 'Loading...') + '</div>';
      try {
        var data = await apiGet(LIST_URL + '?status=OPEN&limit=20');
        renderTables(data.tables || []);
      } catch (err){
        if (isAuthError(err)){
          handleAuthExpired({
            authMsg: authMsg,
            content: lobbyContent,
            errorEl: errorEl,
            onAuthExpired: startAuthWatch
          });
          if (tableList) tableList.innerHTML = '';
          return;
        }
        klog('poker_lobby_load_error', { error: err.message || err.code });
        setError(errorEl, err.message || t('pokerErrLoadTables', 'Failed to load tables'));
        if (tableList) tableList.innerHTML = '';
      }
    }

    function renderTables(tables){
      if (!tableList) return;
      if (!tables || tables.length === 0){
        tableList.innerHTML = '<div class="poker-loading">' + t('noOpenTables', 'No open tables') + '</div>';
        return;
      }
      tableList.innerHTML = '';
      tables.forEach(function(tbl){
        var row = document.createElement('div');
        row.className = 'poker-table-row';
        var stakes = tbl.stakes;
        var maxPlayers = tbl.maxPlayers != null ? tbl.maxPlayers : 6;
        var seatCount = tbl.seatCount != null ? tbl.seatCount : 0;
        var tid = document.createElement('span');
        tid.className = 'tid';
        tid.textContent = shortId(tbl.id);
        var stakesEl = document.createElement('span');
        stakesEl.className = 'stakes';
        stakesEl.textContent = formatStakesUi(stakes);
        var seatsEl = document.createElement('span');
        seatsEl.className = 'seats';
        seatsEl.textContent = seatCount + '/' + maxPlayers;
        var statusEl = document.createElement('span');
        statusEl.className = 'status';
        statusEl.textContent = tbl.status || 'OPEN';
        var openBtn = document.createElement('button');
        openBtn.className = 'poker-btn';
        openBtn.dataset.open = tbl.id;
        openBtn.textContent = t('open', 'Open');
        row.appendChild(tid);
        row.appendChild(stakesEl);
        row.appendChild(seatsEl);
        row.appendChild(statusEl);
        row.appendChild(openBtn);
        tableList.appendChild(row);
      });
    }


    async function quickSeat(){
      setError(errorEl, null);
      var sb = parseInt(sbInput ? sbInput.value : 1, 10);
      var bb = parseInt(bbInput ? bbInput.value : 2, 10);
      var maxPlayers = parseInt(maxPlayersInput ? maxPlayersInput.value : 6, 10) || 6;
      var payload = { maxPlayers: maxPlayers };
      if (isFinite(sb) && isFinite(bb) && Math.floor(sb) === sb && Math.floor(bb) === bb && sb >= 0 && bb > 0 && sb < bb){
        payload.stakes = { sb: sb, bb: bb };
      }
      setLoading(quickSeatBtn, true);
      try {
        var data = await apiPost(QUICK_SEAT_URL, payload);
        if (data && data.ok === true && data.tableId){
          var nextUrl = '/poker/table.html?tableId=' + encodeURIComponent(data.tableId);
          if (data.seatNo != null){
            nextUrl += '&seatNo=' + encodeURIComponent(data.seatNo);
          }
          nextUrl += '&autoJoin=1';
          window.location.href = nextUrl;
          return;
        }
        setError(errorEl, t('pokerErrNoTableId', 'Table created but no ID returned'));
      } catch (err){
        if (isAuthError(err)){
          handleAuthExpired({
            authMsg: authMsg,
            content: lobbyContent,
            errorEl: errorEl,
            onAuthExpired: startAuthWatch
          });
          return;
        }
        klog('poker_quick_seat_error', { error: err.message || err.code });
        setError(errorEl, err.message || t('pokerErrJoin', 'Failed to join table'));
      } finally {
        setLoading(quickSeatBtn, false);
      }
    }
    async function createTable(){
      setError(errorEl, null);
      var sbRaw = sbInput ? sbInput.value : 1;
      var bbRaw = bbInput ? bbInput.value : 2;
      var sb = parseInt(sbRaw, 10);
      var bb = parseInt(bbRaw, 10);
      if (!isFinite(sb) || !isFinite(bb) || Math.floor(sb) !== sb || Math.floor(bb) !== bb || sb < 0 || bb <= 0 || sb >= bb){
        setError(errorEl, t('pokerErrInvalidStakes', 'Invalid stakes'));
        return;
      }
      var maxPlayers = parseInt(maxPlayersInput ? maxPlayersInput.value : 6, 10) || 6;
      setLoading(createBtn, true);
      try {
        var data = await apiPost(CREATE_URL, { stakes: { sb: sb, bb: bb }, maxPlayers: maxPlayers });
        if (data.tableId){
          window.location.href = '/poker/table.html?tableId=' + encodeURIComponent(data.tableId);
        } else {
          setError(errorEl, t('pokerErrNoTableId', 'Table created but no ID returned'));
        }
      } catch (err){
        if (isAuthError(err)){
          handleAuthExpired({
            authMsg: authMsg,
            content: lobbyContent,
            errorEl: errorEl,
            onAuthExpired: startAuthWatch
          });
          return;
        }
        klog('poker_create_error', { error: err.message || err.code });
        setError(errorEl, err.message || t('pokerErrCreateTable', 'Failed to create table'));
      } finally {
        setLoading(createBtn, false);
      }
    }

    function handleClick(e){
      var target = e.target;
      if (target.dataset && target.dataset.open){
        window.location.href = '/poker/table.html?tableId=' + encodeURIComponent(target.dataset.open);
      }
    }

    if (refreshBtn){
      refreshBtn.addEventListener('click', function(){
        checkAuth().then(function(authed){
          if (authed){
            loadTables();
          }
        });
      });
    }
    if (quickSeatBtn){
      quickSeatBtn.addEventListener('click', quickSeat);
    }
    if (createBtn){
      createBtn.addEventListener('click', createTable);
    }
    if (tableList){
      tableList.addEventListener('click', handleClick);
    }
    if (signInBtn){
      signInBtn.addEventListener('click', openSignIn);
    }

    window.addEventListener('beforeunload', stopAuthWatch); // xp-lifecycle-allow:poker-lobby(2026-01-01)

    checkAuth().then(function(authed){
      if (authed) loadTables();
    });
  }

  // ========== TABLE PAGE ==========
  function initTable(){
    var params = new URLSearchParams(window.location.search);
    var tableId = params.get('tableId');
    if (!tableId){
      document.body.innerHTML = '<div class="poker-page"><p class="poker-error">' + t('pokerErrMissingTableId', 'No tableId provided') + '</p><a href="/poker/" class="poker-back">&larr; ' + t('backToLobby', 'Back to lobby') + '</a></div>';
      return;
    }

    ensurePokerRecorder();

    var errorEl = document.getElementById('pokerError');
    var authMsg = document.getElementById('pokerAuthMsg');
    var tableContent = document.getElementById('pokerTableContent');
    var tableIdEl = document.getElementById('pokerTableId');
    var stakesEl = document.getElementById('pokerStakes');
    var statusEl = document.getElementById('pokerStatus');
    var seatsGrid = document.getElementById('pokerSeatsGrid');
    var turnTimerEl = document.getElementById('pokerTurnTimer');
    var joinBtn = document.getElementById('pokerJoin');
    var leaveBtn = document.getElementById('pokerLeave');
    var joinStatusEl = document.getElementById('pokerJoinStatus');
    var leaveStatusEl = document.getElementById('pokerLeaveStatus');
    var seatNoInput = document.getElementById('pokerSeatNo');
    var buyInInput = document.getElementById('pokerBuyIn');
    var yourStackEl = document.getElementById('pokerYourStack');
    var potEl = document.getElementById('pokerPot');
    var phaseEl = document.getElementById('pokerPhase');
    var versionEl = document.getElementById('pokerVersion');
    var myCardsEl = document.getElementById('pokerMyCards');
    var myCardsStatusEl = document.getElementById('pokerMyCardsStatus');
    var bestHandWrapEl = document.getElementById('pokerBestHandWrap');
    var bestHandNameEl = document.getElementById('pokerBestHandName');
    var bestHandCardsEl = document.getElementById('pokerBestHandCards');
    var jsonToggle = document.getElementById('pokerJsonToggle');
    var jsonBox = document.getElementById('pokerJsonBox');
    var signInBtn = document.getElementById('pokerSignIn');
    var startHandBtn = document.getElementById('pokerStartHandBtn');
    var startHandStatusEl = document.getElementById('pokerStartHandStatus');
    var actRow = document.getElementById('pokerActionsRow');
    var actAmountWrap = document.getElementById('pokerActAmountWrap');
    var actAmountInput = document.getElementById('pokerActAmount');
    var actAmountHintEl = null;
    var actCheckBtn = document.getElementById('pokerActCheckBtn');
    var actCallBtn = document.getElementById('pokerActCallBtn');
    var actFoldBtn = document.getElementById('pokerActFoldBtn');
    var actAllInBtn = document.getElementById('pokerActAllInBtn');
    var actBetBtn = document.getElementById('pokerActBetBtn');
    var actRaiseBtn = document.getElementById('pokerActRaiseBtn');
    var actStatusEl = document.getElementById('pokerActStatus');
    var dumpLogsBtn = document.getElementById('pokerDumpLogsBtn');
    var dumpLogsStatusEl = document.getElementById('pokerDumpLogsStatus');
    var copyLogBtn = document.getElementById('pokerCopyLogBtn');
    var copyLogStatusEl = document.getElementById('pokerCopyLogStatus');
    var leaveSelector = '#pokerLeave';
    var joinSelector = '#pokerJoin';

    if (actAmountWrap && actAmountWrap.parentNode){
      actAmountHintEl = document.getElementById('pokerActAmountHint');
      if (!actAmountHintEl){
        actAmountHintEl = document.createElement('div');
        actAmountHintEl.id = 'pokerActAmountHint';
        actAmountHintEl.className = 'poker-act-hint';
        actAmountHintEl.hidden = true;
        actAmountWrap.parentNode.insertBefore(actAmountHintEl, actAmountWrap.nextSibling);
      }
    }

    var currentUserId = null;
    var tableData = null;
    var tableMaxPlayers = 6;
    var stakesValid = true;
    var devActionsEnabled = false;
    var authTimer = null;
    var pendingJoinRequestId = null;
    var pendingJoinAutoSeat = false;
    var pendingLeaveRequestId = null;
    var pendingStartHandRequestId = null;
    var pendingActRequestId = null;
    var pendingActActionType = null;
    var selectedAmountActionType = null;
    var amountDecisionSignature = '';
    var pendingJoinRetries = 0;
    var pendingLeaveRetries = 0;
    var pendingStartHandRetries = 0;
    var pendingActRetries = 0;
    var pendingJoinStartedAt = null;
    var pendingLeaveStartedAt = null;
    var pendingStartHandStartedAt = null;
    var pendingActStartedAt = null;
    var pendingJoinTimer = null;
    var pendingLeaveTimer = null;
    var pendingStartHandTimer = null;
    var pendingActTimer = null;
    var postActSnapshotTimer = null;
    var joinPending = false;
    var leavePending = false;
    var startHandPending = false;
    var actPending = false;
    var copyLogPending = false;
    var dumpLogsPending = false;
    var pendingHiddenAt = null;
    var isSeated = false;
    var suggestedSeatNoParam = parseInt(params.get('seatNo'), 10);
    var shouldAutoJoin = params.get('autoJoin') === '1';
    var shouldAutoStart = params.get('autoStart') === '1';
    var autoJoinAttempted = false;
    var autoStartLastAttemptAt = 0;
    var autoStartCooldownMs = 4000;
    var autoStartStopForHand = false;
    var lastAutoStartSeatCount = null;
    var turnTimerInterval = null;
    var deadlineNudgeTimer = null;
    var deadlineNudgeTargetMs = null;
    var realtimeSub = null;
    var realtimeDisabled = false;
    var realtimeUnavailableLogged = false;
    var wsClient = null;
    var wsStarted = false;
    var httpFallbackActive = false;
    var wsSnapshotSeen = false;
    var wsAppliedSnapshotSeq = 0;
    var pendingWsSnapshot = null;
    var amountRowWasVisible = false;
    var lastRenderedHandForFlyout = null;

    if (joinBtn){
      klog('poker_join_bind', { found: true, selector: joinSelector, page: 'table' });
    } else {
      klog('poker_join_bind', { found: false, selector: joinSelector, page: 'table' });
      klog('poker_join_bind_missing', { path: window.location.pathname });
    }

    if (leaveBtn){
      klog('poker_leave_bind', { found: true, selector: leaveSelector, page: 'table' });
    } else {
      klog('poker_leave_bind', { found: false, selector: leaveSelector, page: 'table' });
      klog('poker_leave_bind_missing', { path: window.location.pathname });
    }

    function stopAuthWatch(){
      if (authTimer){
        clearInterval(authTimer);
        authTimer = null;
      }
    }

    function stopWsClient(){
      wsStarted = false;
      wsSnapshotSeen = false;
      wsAppliedSnapshotSeq = 0;
      pendingWsSnapshot = null;
      if (wsClient && typeof wsClient.destroy === 'function'){
        wsClient.destroy();
      }
      wsClient = null;
    }

    function isRichGameplaySnapshot(snapshotPayload, snapshotKind){
      var payload = snapshotPayload && typeof snapshotPayload === 'object' ? snapshotPayload : {};
      if (snapshotKind === 'stateSnapshot') return true;
      if (snapshotKind === 'table_state'){
        return !!(
          isPlainObject(payload.stacks)
          || Array.isArray(payload.authoritativeMembers)
          || Array.isArray(payload.seats)
          || isPlainObject(payload.hand)
          || isPlainObject(payload.turn)
          || isPlainObject(payload.pot)
          || isPlainObject(payload.board)
          || Array.isArray(payload.board)
        );
      }
      if (isPlainObject(payload.public) || isPlainObject(payload.private) || isPlainObject(payload.you)) return true;
      return isPlainObject(payload.table);
    }

    function normalizeCardForRender(card){
      if (!card) return null;
      var rank = null;
      var suit = null;
      if (typeof card === 'string'){
        var text = card.trim();
        if (!text || text.length < 2) return null;
        suit = text.slice(-1).toUpperCase();
        rank = text.slice(0, -1).toUpperCase();
      } else if (isPlainObject(card)){
        rank = card.r != null ? String(card.r).trim().toUpperCase() : '';
        suit = card.s != null ? String(card.s).trim().toUpperCase() : '';
      } else {
        return null;
      }
      if (rank === 'T') rank = '10';
      if (!(suit === 'S' || suit === 'H' || suit === 'D' || suit === 'C')) return null;
      if (!(rank === 'A' || rank === 'K' || rank === 'Q' || rank === 'J' || rank === '10' || rank === '9' || rank === '8' || rank === '7' || rank === '6' || rank === '5' || rank === '4' || rank === '3' || rank === '2')) return null;
      return {
        r: rank === '10' ? 10 : rank,
        s: suit
      };
    }

    function normalizeCardsForRender(cards){
      if (!Array.isArray(cards)) return [];
      var out = [];
      for (var i = 0; i < cards.length; i++){
        var normalized = normalizeCardForRender(cards[i]);
        if (normalized) out.push(normalized);
      }
      return out;
    }

    function normalizeWsSnapshotPayload(snapshot){
      var input = snapshot && typeof snapshot === 'object' ? snapshot : {};
      var payload = input.payload && typeof input.payload === 'object' ? input.payload : {};
      var kind = typeof input.kind === 'string' && input.kind ? input.kind : (typeof input.rawType === 'string' ? input.rawType : null);
      var normalized = Object.assign({}, payload);
      var rich = isRichGameplaySnapshot(payload, kind);
      if (!rich) return { kind: kind, payload: normalized };

      var table = isPlainObject(payload.table) ? payload.table : {};
      var pub = isPlainObject(payload.public) ? payload.public : {};
      var priv = isPlainObject(payload.private) ? payload.private : {};
      var you = isPlainObject(payload.you) ? payload.you : {};

      if (!normalized.tableId && typeof table.tableId === 'string' && table.tableId) normalized.tableId = table.tableId;
      if (!Array.isArray(normalized.authoritativeMembers) && Array.isArray(table.members)) normalized.authoritativeMembers = table.members.slice();
      if (!Array.isArray(normalized.members) && Array.isArray(table.members)) normalized.members = table.members.slice();
      if (!Number.isInteger(normalized.youSeat) && Number.isInteger(you.seat)) normalized.youSeat = you.seat;
      if (!Number.isInteger(normalized.stateVersion) && Number.isInteger(payload.version)) normalized.stateVersion = payload.version;
      if (normalized.myHoleCards == null && Array.isArray(priv.holeCards)) normalized.myHoleCards = normalizeCardsForRender(priv.holeCards);
      if (!normalized.hand && isPlainObject(pub.hand)) normalized.hand = pub.hand;
      if (!normalized.pot && isPlainObject(pub.pot)) normalized.pot = pub.pot;
      if (!normalized.turn && isPlainObject(pub.turn)) normalized.turn = pub.turn;
      if (!normalized.stacks || typeof normalized.stacks !== 'object' || Array.isArray(normalized.stacks)){
        var normalizedStacks = normalizeSnapshotStacks(payload);
        if (normalizedStacks) normalized.stacks = normalizedStacks;
      }
      if (!normalized.legalActions && pub.legalActions != null) normalized.legalActions = pub.legalActions;
      if (!normalized.actionConstraints && isPlainObject(pub.actionConstraints)) normalized.actionConstraints = pub.actionConstraints;
      if (!Object.prototype.hasOwnProperty.call(normalized, 'showdown') && Object.prototype.hasOwnProperty.call(pub, 'showdown')){
        normalized.showdown = isPlainObject(pub.showdown) ? pub.showdown : null;
      }
      if (!Object.prototype.hasOwnProperty.call(normalized, 'handSettlement') && Object.prototype.hasOwnProperty.call(pub, 'handSettlement')){
        normalized.handSettlement = isPlainObject(pub.handSettlement) ? pub.handSettlement : null;
      }
      if (!normalized.board && pub.board != null){
        if (Array.isArray(pub.board)){
          var normalizedPublicBoard = normalizeCardsForRender(pub.board);
          if (normalizedPublicBoard.length || pub.board.length === 0){
            normalized.board = { cards: normalizedPublicBoard };
          }
        } else if (isPlainObject(pub.board) && Array.isArray(pub.board.cards)){
          var normalizedPublicBoardCards = normalizeCardsForRender(pub.board.cards);
          if (normalizedPublicBoardCards.length || pub.board.cards.length === 0){
            normalized.board = { cards: normalizedPublicBoardCards };
          }
        } else {
          normalized.board = pub.board;
        }
      }
      return { kind: kind, payload: normalized };
    }

    function normalizeSnapshotStacks(payload){
      var safePayload = payload && typeof payload === 'object' ? payload : {};
      if (isPlainObject(safePayload.stacks)) return Object.assign({}, safePayload.stacks);
      var publicPayload = isPlainObject(safePayload.public) ? safePayload.public : {};
      if (isPlainObject(publicPayload.stacks)) return Object.assign({}, publicPayload.stacks);
      if (isPlainObject(safePayload.state) && isPlainObject(safePayload.state.stacks)) return Object.assign({}, safePayload.state.stacks);
      return null;
    }

    function mapTableStateToSeatUpdates(snapshotPayload){
      var payload = snapshotPayload && typeof snapshotPayload === 'object' ? snapshotPayload : {};
      var seatMap = {};
      var members = Array.isArray(payload.authoritativeMembers) ? payload.authoritativeMembers : [];
      var hasSeatSource = Array.isArray(payload.authoritativeMembers) || Array.isArray(payload.seats);
      members.forEach(function(member){
        var seatNo = member && member.seat != null ? member.seat : null;
        var userId = member && member.userId ? member.userId : null;
        if (!Number.isInteger(seatNo) || seatNo < 0) return;
        if (typeof userId !== 'string' || !userId) return;
        seatMap[seatNo] = {
          userId: userId,
          seatNo: seatNo,
          status: 'ACTIVE'
        };
      });
      if (Array.isArray(payload.seats)){
        payload.seats.forEach(function(seat){
          var seatNo = seat && Number.isInteger(seat.seatNo) ? seat.seatNo : null;
          var userId = seat && typeof seat.userId === 'string' ? seat.userId : null;
          if (!Number.isInteger(seatNo) || seatNo < 0) return;
          if (typeof userId !== 'string' || !userId) return;
          if (seatMap[seatNo]) return;
          seatMap[seatNo] = {
            userId: userId,
            seatNo: seatNo,
            status: typeof seat.status === 'string' ? seat.status : 'ACTIVE'
          };
        });
      }
      var currentSeatUserId = typeof currentUserId === 'string' && currentUserId ? currentUserId : null;
      if (currentSeatUserId && Number.isInteger(payload.youSeat) && payload.youSeat >= 0 && !seatMap[payload.youSeat]){
        seatMap[payload.youSeat] = {
          userId: currentSeatUserId,
          seatNo: payload.youSeat,
          status: 'ACTIVE'
        };
      }
      var seats = Object.keys(seatMap).map(function(key){
        return seatMap[key];
      });
      return {
        tableId: payload.tableId || null,
        seats: seats,
        hasSeatSource: hasSeatSource
      };
    }

    function mergePresenceIntoSeats(existingSeats, seatUpdates, hasSeatSource){
      if (!hasSeatSource){
        return Array.isArray(existingSeats) ? existingSeats.slice() : null;
      }
      if (!Array.isArray(seatUpdates) || seatUpdates.length === 0){
        return [];
      }
      var bySeatNo = {};
      seatUpdates.forEach(function(updateSeat){
        if (!updateSeat || !Number.isInteger(updateSeat.seatNo) || updateSeat.seatNo < 0) return;
        if (typeof updateSeat.userId !== 'string' || !updateSeat.userId) return;
        bySeatNo[updateSeat.seatNo] = updateSeat;
      });
      return Object.keys(bySeatNo)
        .map(function(key){ return bySeatNo[key]; })
        .sort(function(left, right){ return left.seatNo - right.seatNo; });
    }


    function createWsBaselineTableData(snapshotPayload){
      var payload = snapshotPayload && typeof snapshotPayload === 'object' ? snapshotPayload : {};
      var tablePayload = isPlainObject(payload.table) ? payload.table : {};
      var handPayload = isPlainObject(payload.hand) ? payload.hand : {};
      var turnPayload = isPlainObject(payload.turn) ? payload.turn : {};
      var potPayload = isPlainObject(payload.pot) ? payload.pot : {};
      var boardPayload = isPlainObject(payload.board) ? payload.board : null;
      var seatUpdates = mapTableStateToSeatUpdates(payload);
      var stateVersion = Number.isInteger(payload.stateVersion) ? payload.stateVersion : 0;
      var communityCards = [];
      if (boardPayload && Array.isArray(boardPayload.cards)){
        communityCards = normalizeCardsForRender(boardPayload.cards);
      } else if (Array.isArray(payload.board)) {
        communityCards = normalizeCardsForRender(payload.board);
      }
      var legalActions = [];
      var actionConstraints = null;
      if (Array.isArray(payload.legalActions)){
        legalActions = payload.legalActions.slice();
      } else if (isPlainObject(payload.legalActions)){
        if (Array.isArray(payload.legalActions.actions)) legalActions = payload.legalActions.actions.slice();
        if (isPlainObject(payload.legalActions.actionConstraints)) actionConstraints = getSafeConstraints({ actionConstraints: payload.legalActions.actionConstraints });
      }
      if (!actionConstraints && isPlainObject(payload.actionConstraints)){
        actionConstraints = getSafeConstraints({ actionConstraints: payload.actionConstraints });
      }
      if (!actionConstraints) actionConstraints = {};
      var stateObj = {
        phase: typeof handPayload.status === 'string' ? handPayload.status : null,
        handId: typeof handPayload.handId === 'string' ? handPayload.handId : null,
        turnUserId: typeof turnPayload.userId === 'string' ? turnPayload.userId : null,
        turnDeadlineAt: turnPayload.deadlineAt != null ? turnPayload.deadlineAt : null,
        turnStartedAt: turnPayload.startedAt != null ? turnPayload.startedAt : null,
        pot: Number.isFinite(Number(potPayload.total)) ? Number(potPayload.total) : 0,
        potTotal: Number.isFinite(Number(potPayload.total)) ? Number(potPayload.total) : 0,
        sidePots: Array.isArray(potPayload.sidePots) ? potPayload.sidePots.slice() : [],
        community: communityCards,
        stacks: normalizeSnapshotStacks(payload) || {},
        showdown: isPlainObject(payload.showdown) ? payload.showdown : null,
        handSettlement: isPlainObject(payload.handSettlement) ? payload.handSettlement : null
      };
      var resolvedMaxPlayers = null;
      if (Number.isInteger(tablePayload.maxPlayers) && tablePayload.maxPlayers > 1){
        resolvedMaxPlayers = tablePayload.maxPlayers;
      } else if (Number.isInteger(tablePayload.maxSeats) && tablePayload.maxSeats > 1){
        resolvedMaxPlayers = tablePayload.maxSeats;
      } else {
        var snakeMaxPlayers = parseInt(tablePayload.max_players, 10);
        if (Number.isInteger(snakeMaxPlayers) && snakeMaxPlayers > 1){
          resolvedMaxPlayers = snakeMaxPlayers;
        }
      }
      var baseline = {
        tableId: payload.tableId || tableId,
        table: {
          id: payload.tableId || tableId,
          status: typeof tablePayload.status === 'string' ? tablePayload.status : 'OPEN',
          maxPlayers: resolvedMaxPlayers || 6,
          stakes: tablePayload.stakes || null
        },
        seats: Array.isArray(seatUpdates.seats) ? seatUpdates.seats.slice() : [],
        legalActions: legalActions,
        actionConstraints: actionConstraints,
        _actionConstraints: actionConstraints,
        state: {
          version: stateVersion,
          state: stateObj
        },
        myHoleCards: Array.isArray(payload.myHoleCards) ? normalizeCardsForRender(payload.myHoleCards) : []
      };
      return baseline;
    }

    function mergeWsStateIntoTableData(existingData, snapshotPayload){
      if (!existingData || typeof existingData !== 'object') return null;
      var payload = snapshotPayload && typeof snapshotPayload === 'object' ? snapshotPayload : {};
      var update = mapTableStateToSeatUpdates(payload);
      var merged = Object.assign({}, existingData);
      var tablePayload = isPlainObject(payload.table) ? payload.table : null;
      if (tablePayload || (typeof payload.status === 'string' && payload.status)){
        merged.table = Object.assign({}, isPlainObject(merged.table) ? merged.table : {});
        if (tablePayload && typeof tablePayload.status === 'string' && tablePayload.status){
          merged.table.status = tablePayload.status;
        } else if (typeof payload.status === 'string' && payload.status){
          merged.table.status = payload.status;
        }
      }
      var baselineState = isPlainObject(merged.state) ? merged.state : {};
      var baselineInner = isPlainObject(baselineState.state) ? baselineState.state : {};
      var nextState = Object.assign({}, baselineInner);
      if (Number.isInteger(payload.stateVersion)) baselineState.version = payload.stateVersion;
      if (payload.hand && typeof payload.hand === 'object'){
        nextState.handId = payload.hand.handId || nextState.handId || null;
        nextState.phase = payload.hand.status || nextState.phase || null;
      }
      if (payload.turn && typeof payload.turn === 'object'){
        nextState.turnUserId = payload.turn.userId ? payload.turn.userId : nextState.turnUserId;
        nextState.turnDeadlineAt = payload.turn.deadlineAt != null ? payload.turn.deadlineAt : nextState.turnDeadlineAt;
        nextState.turnStartedAt = payload.turn.startedAt != null ? payload.turn.startedAt : nextState.turnStartedAt;
      }
      if (payload.board && Array.isArray(payload.board.cards)){
        var normalizedBoardCards = normalizeCardsForRender(payload.board.cards);
        if (normalizedBoardCards.length || payload.board.cards.length === 0) nextState.community = normalizedBoardCards;
      }
      if (!Array.isArray(nextState.community) && Array.isArray(payload.board)){
        var normalizedBoardList = normalizeCardsForRender(payload.board);
        if (normalizedBoardList.length || payload.board.length === 0) nextState.community = normalizedBoardList;
      }
      if (payload.pot && typeof payload.pot === 'object'){
        if (Number.isFinite(Number(payload.pot.total))) {
          nextState.pot = Number(payload.pot.total);
          nextState.potTotal = Number(payload.pot.total);
        }
        if (Array.isArray(payload.pot.sidePots)) nextState.sidePots = payload.pot.sidePots.slice();
      }
      if (Object.prototype.hasOwnProperty.call(payload, 'showdown')){
        nextState.showdown = isPlainObject(payload.showdown) ? payload.showdown : null;
      }
      if (Object.prototype.hasOwnProperty.call(payload, 'handSettlement')){
        nextState.handSettlement = isPlainObject(payload.handSettlement) ? payload.handSettlement : null;
      }
      var normalizedStacks = normalizeSnapshotStacks(payload);
      if (normalizedStacks){
        var incomingStackKeys = Object.keys(normalizedStacks);
        if (incomingStackKeys.length > 0){
          nextState.stacks = Object.assign({}, normalizedStacks);
        } else {
          nextState.stacks = Object.assign({}, baselineInner.stacks && typeof baselineInner.stacks === 'object' ? baselineInner.stacks : {});
        }
      }
      baselineState.state = nextState;
      merged.state = baselineState;
      var wsActions = null;
      var wsConstraints = null;
      if (Array.isArray(payload.legalActions)){
        wsActions = payload.legalActions.slice();
      } else if (payload.legalActions && typeof payload.legalActions === 'object'){
        if (Array.isArray(payload.legalActions.actions)) wsActions = payload.legalActions.actions.slice();
        if (isPlainObject(payload.legalActions.actionConstraints)) wsConstraints = payload.legalActions.actionConstraints;
      }
      if (wsActions){
        merged.legalActions = wsActions;
      }
      if (isPlainObject(payload.actionConstraints)) wsConstraints = payload.actionConstraints;
      if (wsConstraints){
        var safeConstraints = getSafeConstraints({ actionConstraints: wsConstraints });
        merged.actionConstraints = safeConstraints;
        merged._actionConstraints = safeConstraints;
      }
      if (Array.isArray(payload.myHoleCards)) merged.myHoleCards = normalizeCardsForRender(payload.myHoleCards);
      var mergedSeats = mergePresenceIntoSeats(merged.seats, update.seats, update.hasSeatSource);
      if (mergedSeats) merged.seats = mergedSeats;
      return merged;
    }

    function resolveSnapshotVersion(snapshotPayload){
      if (!snapshotPayload || typeof snapshotPayload !== 'object') return null;
      return Number.isInteger(snapshotPayload.stateVersion) ? snapshotPayload.stateVersion : null;
    }

    function resolveTableDataVersion(data){
      if (!data || typeof data !== 'object') return null;
      var state = data.state && typeof data.state === 'object' ? data.state : null;
      return state && Number.isInteger(state.version) ? state.version : null;
    }

    function findCurrentUserSeatFacts(data){
      var facts = {
        hasCurrentUserSeat: false,
        seatNo: null,
        status: null,
        hasRenderableSeatRow: false,
        hasCurrentUserStack: false
      };
      var activeCurrentUserId = typeof currentUserId === 'string' && currentUserId ? currentUserId : null;
      var stateObj = data && typeof data.state === 'object' ? data.state : null;
      var gameState = stateObj && typeof stateObj.state === 'object' ? stateObj.state : null;
      var stacks = gameState && typeof gameState.stacks === 'object' && !Array.isArray(gameState.stacks) ? gameState.stacks : null;
      if (activeCurrentUserId && stacks && stacks[activeCurrentUserId] != null){
        facts.hasCurrentUserStack = true;
      }
      if (!activeCurrentUserId || !data || !Array.isArray(data.seats)) return facts;
      for (var i = 0; i < data.seats.length; i++){
        var seat = data.seats[i];
        if (!seat || typeof seat.userId !== 'string') continue;
        if (seat.userId.trim() !== activeCurrentUserId) continue;
        facts.hasCurrentUserSeat = true;
        facts.seatNo = Number.isInteger(seat.seatNo) ? seat.seatNo : null;
        facts.status = typeof seat.status === 'string' ? seat.status : null;
        facts.hasRenderableSeatRow = true;
        return facts;
      }
      return facts;
    }

    function buildSeatUserSeatMap(seats){
      var map = {};
      if (!Array.isArray(seats)) return map;
      for (var i = 0; i < seats.length; i++){
        var seat = seats[i];
        if (!seat || typeof seat.userId !== 'string') continue;
        var userId = seat.userId.trim();
        if (!userId) continue;
        map[userId] = Number.isInteger(seat.seatNo) ? seat.seatNo : null;
      }
      return map;
    }

    function buildWsPayloadSeatSnapshot(payload){
      var seatMap = {};
      var seatRows = [];
      if (Array.isArray(payload.authoritativeMembers)){
        for (var i = 0; i < payload.authoritativeMembers.length; i++){
          var member = payload.authoritativeMembers[i];
          if (!member || typeof member.userId !== 'string') continue;
          var memberUserId = member.userId.trim();
          if (!memberUserId) continue;
          var memberSeatNo = Number.isInteger(member.seat) ? member.seat : null;
          seatMap[memberUserId] = memberSeatNo;
          seatRows.push(memberUserId + ':' + (memberSeatNo != null ? memberSeatNo : 'null'));
        }
      }
      if (Array.isArray(payload.seats)){
        for (var j = 0; j < payload.seats.length; j++){
          var seat = payload.seats[j];
          if (!seat || typeof seat.userId !== 'string') continue;
          var seatUserId = seat.userId.trim();
          if (!seatUserId) continue;
          if (seatMap[seatUserId] != null) continue;
          var seatNo = Number.isInteger(seat.seatNo) ? seat.seatNo : null;
          seatMap[seatUserId] = seatNo;
          seatRows.push(seatUserId + ':' + (seatNo != null ? seatNo : 'null'));
        }
      }
      return {
        seatMap: seatMap,
        seatRows: seatRows
      };
    }

    function hasTurnMetadata(state){
      if (!state || typeof state !== 'object') return false;
      return !!(state.turnUserId || state.turnDeadlineAt != null || state.turnStartedAt != null);
    }

    function hasConstraintsData(constraints){
      if (!constraints || typeof constraints !== 'object') return false;
      return constraints.toCall != null || constraints.minRaiseTo != null || constraints.maxRaiseTo != null || constraints.maxBetAmount != null;
    }

    function hasStackEntries(stacks){
      return !!(stacks && typeof stacks === 'object' && !Array.isArray(stacks) && Object.keys(stacks).length > 0);
    }

    function normalizeActionListForCompare(actions){
      if (!Array.isArray(actions)) return [];
      var seen = {};
      var out = [];
      for (var i = 0; i < actions.length; i++){
        var type = normalizeActionTypeValue(actions[i]);
        if (!type || seen[type]) continue;
        seen[type] = true;
        out.push(type);
      }
      out.sort();
      return out;
    }

    function haveActionListsChanged(left, right){
      var a = normalizeActionListForCompare(left);
      var b = normalizeActionListForCompare(right);
      if (a.length !== b.length) return true;
      for (var i = 0; i < a.length; i++){
        if (a[i] !== b[i]) return true;
      }
      return false;
    }

    function haveActionConstraintsChanged(left, right){
      var a = normalizeActionConstraints(left);
      var b = normalizeActionConstraints(right);
      return a.toCall !== b.toCall
        || a.minRaiseTo !== b.minRaiseTo
        || a.maxRaiseTo !== b.maxRaiseTo
        || a.maxBetAmount !== b.maxBetAmount;
    }

    function hasTurnMetadataChanged(left, right){
      var leftState = left && typeof left === 'object' ? left : {};
      var rightState = right && typeof right === 'object' ? right : {};
      return leftState.phase !== rightState.phase
        || leftState.turnUserId !== rightState.turnUserId
        || normalizeDeadlineMs(leftState.turnStartedAt) !== normalizeDeadlineMs(rightState.turnStartedAt)
        || normalizeDeadlineMs(leftState.turnDeadlineAt) !== normalizeDeadlineMs(rightState.turnDeadlineAt);
    }

    function resolveCurrentUserStackStatus(data){
      var status = {
        currentUserId: null,
        seated: false,
        hasStack: false,
        stackValue: null
      };
      var activeCurrentUserId = typeof currentUserId === 'string' && currentUserId ? currentUserId : null;
      if (!activeCurrentUserId) return status;
      status.currentUserId = activeCurrentUserId;
      var seatFacts = findCurrentUserSeatFacts(data);
      status.seated = seatFacts.hasCurrentUserSeat === true;
      status.hasStack = seatFacts.hasCurrentUserStack === true;
      var stateObj = data && typeof data.state === 'object' ? data.state : null;
      var gameState = stateObj && typeof stateObj.state === 'object' ? stateObj.state : null;
      var stacks = gameState && typeof gameState.stacks === 'object' && !Array.isArray(gameState.stacks) ? gameState.stacks : null;
      if (status.currentUserId && stacks && stacks[status.currentUserId] != null) status.stackValue = stacks[status.currentUserId];
      return status;
    }

    function materiallyImprovesRichSnapshot(currentData, snapshotPayload){
      if (!currentData || typeof currentData !== 'object') return false;
      if (!snapshotPayload || typeof snapshotPayload !== 'object') return false;
      var currentStateBeforeMerge = currentData.state && currentData.state.state && typeof currentData.state.state === 'object' ? currentData.state.state : {};
      var hadHoleCards = Array.isArray(currentData.myHoleCards) && currentData.myHoleCards.length > 0;
      var hadCommunity = Array.isArray(currentStateBeforeMerge.community) && currentStateBeforeMerge.community.length > 0;
      var hadLegalActions = Array.isArray(currentData.legalActions) && currentData.legalActions.length > 0;
      var hadConstraints = hasConstraintsData(currentData.actionConstraints);
      var hadTurnMetadata = hasTurnMetadata(currentStateBeforeMerge);
      var hadStacks = hasStackEntries(currentStateBeforeMerge.stacks);
      var currentStackKeys = hadStacks ? Object.keys(currentStateBeforeMerge.stacks) : [];
      var currentUserStackStatusBefore = resolveCurrentUserStackStatus(currentData);
      var mergedData = mergeWsStateIntoTableData(currentData, snapshotPayload);
      if (!mergedData) return false;
      var mergedState = mergedData.state && mergedData.state.state && typeof mergedData.state.state === 'object' ? mergedData.state.state : {};
      var currentSeats = Array.isArray(currentData.seats) ? currentData.seats : [];
      var mergedSeats = Array.isArray(mergedData.seats) ? mergedData.seats : [];
      if (currentSeats.length !== mergedSeats.length) return true;
      var currentSeatSignature = currentSeats
        .map(function(seat){
          var seatNo = seat && Number.isInteger(seat.seatNo) ? seat.seatNo : -1;
          var userId = seat && typeof seat.userId === 'string' ? seat.userId : '';
          var status = seat && typeof seat.status === 'string' ? seat.status.toUpperCase() : '';
          return String(seatNo) + ':' + userId + ':' + status;
        })
        .sort()
        .join('|');
      var mergedSeatSignature = mergedSeats
        .map(function(seat){
          var seatNo = seat && Number.isInteger(seat.seatNo) ? seat.seatNo : -1;
          var userId = seat && typeof seat.userId === 'string' ? seat.userId : '';
          var status = seat && typeof seat.status === 'string' ? seat.status.toUpperCase() : '';
          return String(seatNo) + ':' + userId + ':' + status;
        })
        .sort()
        .join('|');
      if (currentSeatSignature !== mergedSeatSignature) return true;

      var currentTableStatus = currentData && currentData.table && typeof currentData.table.status === 'string' ? currentData.table.status : null;
      var mergedTableStatus = mergedData && mergedData.table && typeof mergedData.table.status === 'string' ? mergedData.table.status : null;
      if (currentTableStatus !== mergedTableStatus) return true;

      var currentStacks = currentStateBeforeMerge && typeof currentStateBeforeMerge.stacks === 'object' && !Array.isArray(currentStateBeforeMerge.stacks)
        ? currentStateBeforeMerge.stacks
        : {};
      var mergedStacks = mergedState && typeof mergedState.stacks === 'object' && !Array.isArray(mergedState.stacks)
        ? mergedState.stacks
        : {};
      var currentStackKeysExact = Object.keys(currentStacks).sort();
      var mergedStackKeysExact = Object.keys(mergedStacks).sort();
      if (currentStackKeysExact.length !== mergedStackKeysExact.length) return true;
      for (var stackKeyIndex = 0; stackKeyIndex < currentStackKeysExact.length; stackKeyIndex++){
        var stackKey = currentStackKeysExact[stackKeyIndex];
        if (stackKey !== mergedStackKeysExact[stackKeyIndex]) return true;
        if (Number(currentStacks[stackKey]) !== Number(mergedStacks[stackKey])) return true;
      }

      var hasHoleCards = Array.isArray(mergedData.myHoleCards) && mergedData.myHoleCards.length > 0;
      if (!hadHoleCards && hasHoleCards) return true;
      var hasCommunity = Array.isArray(mergedState.community) && mergedState.community.length > 0;
      if (!hadCommunity && hasCommunity) return true;
      var hasLegalActions = Array.isArray(mergedData.legalActions) && mergedData.legalActions.length > 0;
      if (!hadLegalActions && hasLegalActions) return true;
      if (haveActionListsChanged(currentData.legalActions, mergedData.legalActions)) return true;
      var hasConstraints = hasConstraintsData(mergedData.actionConstraints);
      if (!hadConstraints && hasConstraints) return true;
      if (haveActionConstraintsChanged(currentData.actionConstraints, mergedData.actionConstraints)) return true;
      if (!hadTurnMetadata && hasTurnMetadata(mergedState)) return true;
      if (hasTurnMetadataChanged(currentStateBeforeMerge, mergedState)) return true;
      var hasStacks = hasStackEntries(mergedState.stacks);
      if (!hadStacks && hasStacks) return true;
      var mergedStackKeys = hasStackEntries(mergedState.stacks) ? Object.keys(mergedState.stacks) : [];
      if (mergedStackKeys.length > currentStackKeys.length) return true;
      var currentUserStackStatusAfter = resolveCurrentUserStackStatus(mergedData);
      if (currentUserStackStatusBefore.seated && !currentUserStackStatusBefore.hasStack && currentUserStackStatusAfter.hasStack) return true;
      if (currentUserStackStatusBefore.seated && currentUserStackStatusBefore.hasStack && currentUserStackStatusAfter.hasStack && currentUserStackStatusBefore.stackValue !== currentUserStackStatusAfter.stackValue) return true;
      return false;
    }

    function shouldApplyWsSnapshot(snapshotPayload, options){
      var opts = options && typeof options === 'object' ? options : {};
      if (!snapshotPayload || typeof snapshotPayload !== 'object') return false;
      if (snapshotPayload.tableId && snapshotPayload.tableId !== tableId) return false;
      if (!tableData || typeof tableData !== 'object'){
        return opts.allowWhenNoBaseline === true && isRichGameplaySnapshot(snapshotPayload, opts.snapshotKind);
      }
      var incomingVersion = resolveSnapshotVersion(snapshotPayload);
      var currentVersion = resolveTableDataVersion(tableData);
      if (incomingVersion == null){
        if (currentVersion != null) return false;
        return opts.allowUnversionedUpgrade === true;
      }
      if (currentVersion == null) return true;
      if (incomingVersion > currentVersion) return true;
      if (incomingVersion < currentVersion) return false;
      if (!isRichGameplaySnapshot(snapshotPayload, opts.snapshotKind)) return false;
      return materiallyImprovesRichSnapshot(tableData, snapshotPayload);
    }

    function clearPostActSnapshotRefresh(){
      if (typeof postActSnapshotTimer === 'undefined' || !postActSnapshotTimer) return;
      clearTimeout(postActSnapshotTimer);
      postActSnapshotTimer = null;
    }

    function applyOptimisticLeaveCleanup(){
      var activeCurrentUserId = typeof currentUserId === 'string' && currentUserId ? currentUserId : '';
      if (!activeCurrentUserId) return;
      if (!tableData || typeof tableData !== 'object') return;

      var nextData = Object.assign({}, tableData);
      if (Array.isArray(nextData.seats)){
        nextData.seats = nextData.seats.filter(function(seat){
          return !(seat && typeof seat.userId === 'string' && seat.userId.trim() === activeCurrentUserId);
        });
      }
      nextData.youSeat = null;
      nextData.legalActions = [];
      nextData.actionConstraints = {};
      nextData._actionConstraints = {};
      nextData.myHoleCards = [];

      var stateObj = nextData.state && typeof nextData.state === 'object' ? Object.assign({}, nextData.state) : {};
      var gameState = stateObj.state && typeof stateObj.state === 'object' ? Object.assign({}, stateObj.state) : {};
      var nextStacks = gameState.stacks && typeof gameState.stacks === 'object' && !Array.isArray(gameState.stacks)
        ? Object.assign({}, gameState.stacks)
        : {};
      delete nextStacks[activeCurrentUserId];
      gameState.stacks = nextStacks;

      var nextLeftTableByUserId = gameState.leftTableByUserId && typeof gameState.leftTableByUserId === 'object' && !Array.isArray(gameState.leftTableByUserId)
        ? Object.assign({}, gameState.leftTableByUserId)
        : {};
      nextLeftTableByUserId[activeCurrentUserId] = true;
      gameState.leftTableByUserId = nextLeftTableByUserId;

      if (gameState.turnUserId === activeCurrentUserId){
        gameState.turnUserId = null;
        gameState.turnStartedAt = null;
        gameState.turnDeadlineAt = null;
      }

      stateObj.state = gameState;
      nextData.state = stateObj;
      tableData = nextData;
      isSeated = false;
      clearDeadlineNudge();
      renderTable(tableData);
    }

    function schedulePostActSnapshotRefresh(options){
      var opts = options && typeof options === 'object' ? options : {};
      var baselineApplySeq = Number.isInteger(opts.baselineApplySeq) ? opts.baselineApplySeq : null;
      var baselineVersion = Number.isInteger(opts.baselineVersion) ? opts.baselineVersion : null;
      if (baselineApplySeq != null && wsAppliedSnapshotSeq > baselineApplySeq) return;
      if (baselineVersion != null){
        var currentVersion = resolveTableDataVersion(tableData);
        if (currentVersion != null && currentVersion > baselineVersion) return;
      }
      clearPostActSnapshotRefresh();
      postActSnapshotTimer = setTimeout(function(){
        postActSnapshotTimer = null;
        if (!isPageActive()) return;
        if (joinPending || leavePending || startHandPending || actPending) return;
        if (baselineApplySeq != null && wsAppliedSnapshotSeq > baselineApplySeq) return;
        if (baselineVersion != null){
          var currentVersion = resolveTableDataVersion(tableData);
          if (currentVersion != null && currentVersion > baselineVersion) return;
        }
        if (!wsClient || typeof wsClient.requestGameplaySnapshot !== 'function') return;
        klog('poker_post_act_snapshot_refresh', { tableId: tableId });
        wsClient.requestGameplaySnapshot();
      }, 250);
    }

    function applyWsSnapshotNow(snapshotPayload, options){
      if (!snapshotPayload || typeof snapshotPayload !== 'object') return false;
      var opts = options && typeof options === 'object' ? options : {};
      var activeCurrentUserId = typeof currentUserId === 'string' && currentUserId ? currentUserId : '';
      if (!shouldApplyWsSnapshot(snapshotPayload, opts)) return false;
      clearPostActSnapshotRefresh();
      var wasSeatedBefore = isSeated === true;
      if (!tableData || typeof tableData !== 'object'){
        if (!opts.allowWhenNoBaseline) return false;
        tableData = createWsBaselineTableData(snapshotPayload);
      } else {
        var mergedData = mergeWsStateIntoTableData(tableData, snapshotPayload);
        if (!mergedData) return false;
        mergedData._actionConstraints = getSafeConstraints(mergedData);
        tableData = mergedData;
      }
      isSeated = isCurrentUserSeated(tableData);
      var stateObj = tableData && typeof tableData.state === 'object' ? tableData.state : {};
      var gameState = stateObj && typeof stateObj.state === 'object' ? stateObj.state : {};
      var stacks = gameState && typeof gameState.stacks === 'object' && !Array.isArray(gameState.stacks) ? gameState.stacks : {};
      var seatFacts = findCurrentUserSeatFacts(tableData);
      klog('poker_ws_snapshot_runtime_normalized', {
        tableId: tableId,
        snapshotKind: opts.snapshotKind || null,
        stateVersion: resolveTableDataVersion(tableData),
        currentUserId: activeCurrentUserId || null,
        isSeated: isSeated === true,
        youSeat: Number.isInteger(snapshotPayload.youSeat) ? snapshotPayload.youSeat : null,
        currentUserSeatNo: seatFacts.seatNo,
        stacksKeys: Object.keys(stacks),
        currentUserStackValue: activeCurrentUserId ? stacks[activeCurrentUserId] : null,
        seatsCount: Array.isArray(tableData.seats) ? tableData.seats.length : 0,
        seatUserSeatMap: buildSeatUserSeatMap(tableData.seats || [])
      });
      renderTable(tableData);
      if (wasSeatedBefore && isSeated !== true){
        var removalMessage = t('pokerRemovedFromTable', 'You were removed from the table and cashed out.');
        setError(errorEl, removalMessage);
        klog('poker_user_removed_from_table_snapshot', {
          tableId: tableId,
          stateVersion: resolveTableDataVersion(tableData),
          snapshotKind: opts.snapshotKind || null
        });
      }
      var seatedCount = getSeatedCount(tableData);
      if (isSeated && seatedCount !== lastAutoStartSeatCount){
        lastAutoStartSeatCount = seatedCount;
        maybeAutoStartHand();
      }
      stopPolling();
      wsSnapshotSeen = true;
      wsAppliedSnapshotSeq += 1;
      pendingWsSnapshot = null;
      return true;
    }

    function applyWsSnapshot(snapshot){
      if (!snapshot || !snapshot.payload) return;
      var activeCurrentUserId = typeof currentUserId === 'string' && currentUserId ? currentUserId : '';
      var activeIsSeated = typeof isSeated !== 'undefined' && isSeated === true;
      var normalized = normalizeWsSnapshotPayload(snapshot);
      var payload = normalized.payload || {};
      var snapshotKind = normalized.kind || snapshot.kind || snapshot.rawType || null;
      var incomingVersion = resolveSnapshotVersion(payload);
      var currentVersion = resolveTableDataVersion(tableData);
      var rawStacks = normalizeSnapshotStacks(payload) || {};
      var payloadSeatSnapshot = buildWsPayloadSeatSnapshot(payload);
      var currentUserSeatNo = payloadSeatSnapshot.seatMap[activeCurrentUserId];
      var youSeatPresent = Number.isInteger(payload.youSeat);
      klog('poker_ws_snapshot_received', {
        tableId: tableId,
        kind: snapshotKind,
        initial: snapshot.initial === true,
        members: Array.isArray(payload.members) ? payload.members.length : 0,
        stateVersion: incomingVersion
      });
      klog('poker_ws_snapshot_apply_input', {
        tableId: tableId,
        snapshotKind: snapshotKind,
        stateVersion: incomingVersion,
        currentUserId: activeCurrentUserId || null,
        isSeated: activeIsSeated,
        youSeat: Number.isInteger(payload.youSeat) ? payload.youSeat : null,
        currentUserSeatNo: Number.isInteger(currentUserSeatNo) ? currentUserSeatNo : null,
        stacksKeys: Object.keys(rawStacks),
        currentUserStackValue: activeCurrentUserId ? rawStacks[activeCurrentUserId] : null,
        seatsCount: payloadSeatSnapshot.seatRows.length,
        seatUserSeatMap: payloadSeatSnapshot.seatMap,
        seatUserIds: payloadSeatSnapshot.seatRows,
        youSeatPresent: youSeatPresent
      });

      if (applyWsSnapshotNow(payload, {
        allowWhenNoBaseline: true,
        allowUnversionedUpgrade: false,
        snapshotKind: snapshotKind
      })) return;

      if (!tableData || typeof tableData !== 'object'){
        pendingWsSnapshot = payload;
        klog('poker_ws_snapshot_deferred', {
          tableId: tableId,
          hasTableData: false,
          members: Array.isArray(payload.members) ? payload.members.length : 0,
          stateVersion: incomingVersion
        });
        return;
      }

      klog('poker_ws_snapshot_ignored', {
        tableId: tableId,
        members: Array.isArray(payload.members) ? payload.members.length : 0,
        incomingStateVersion: incomingVersion,
        currentStateVersion: currentVersion,
        reason: (payload.tableId && payload.tableId !== tableId) ? 'table_mismatch' : (incomingVersion == null ? 'unversioned_over_versioned_or_disallowed' : 'stale_or_equal_version')
      });
    }


    function startPollingFallback(reason){
      httpFallbackActive = false;
      klog('poker_http_fallback_retired', {
        tableId: tableId,
        reason: reason || null
      });
    }

    function startWsBootstrap(){
      if (wsStarted) return;
      if (!tableId || !currentUserId) return;
      if (!window.PokerWsClient || typeof window.PokerWsClient.create !== 'function'){
        startPollingFallback('ws_client_missing');
        return;
      }
      httpFallbackActive = false;
      wsStarted = true;
      wsClient = window.PokerWsClient.create({
        tableId: tableId,
        getAccessToken: getAccessToken,
        klog: klog,
        onStatus: function(status, data){
          klog('poker_ws_status', {
            tableId: tableId,
            status: status,
            stage: data && data.stage ? data.stage : null,
            code: data && data.code ? data.code : null,
            reason: data && data.reason ? data.reason : null
          });
          if (status === 'auth_ok'){
            maybeAutoJoin();
          }
        },
        onSnapshot: function(snapshot){
          applyWsSnapshot(snapshot);
        },
        onProtocolError: function(info){
          wsStarted = false;
              klog('poker_ws_protocol_error', {
            tableId: tableId,
            code: info && info.code ? info.code : 'unknown_error',
            detail: info && info.detail ? info.detail : null
          });
          startPollingFallback(info && info.code ? info.code : 'protocol_error');
        }
      });
      if (wsClient && typeof wsClient.start === 'function'){
        klog('poker_ws_bootstrap_start', { tableId: tableId });
        wsClient.start();
      } else {
        wsStarted = false;
          startPollingFallback('ws_client_start_missing');
      }
    }

    function logWsBootstrapException(err, phase){
      klog('poker_ws_exception', {
        tableId: tableId,
        phase: phase || 'ws_bootstrap',
        message: err && (err.message || err.code) ? err.message || err.code : 'unknown_error',
        stack: err && err.stack ? String(err.stack).slice(0, 600) : null
      });
    }

    async function bootstrapWsAfterBaseline(phase){
      httpFallbackActive = false;
      try {
        startWsBootstrap();
      } catch (_err){
        logWsBootstrapException(_err, phase || 'ws_bootstrap');
        startPollingFallback('ws_bootstrap_exception');
        return false;
      }
      return true;
    }

    function startAuthWatch(){
      if (authTimer) return;
      authTimer = setInterval(function(){
        checkAuth().then(function(authed){
          if (authed){
            stopAuthWatch();
            bootstrapWsAfterBaseline('auth_watch');
          }
        });
      }, 3000);
    }

    async function checkAuth(){
      var token = await getAccessToken();
      if (!token){
        currentUserId = null;
        isSeated = false;
        clearDeadlineNudge();
        stopRealtime();
        stopWsClient();
        if (authMsg) authMsg.hidden = false;
        if (tableContent) tableContent.hidden = true;
        renderHoleCards(null);
        setDevActionsEnabled(false);
        setDevActionsAuthStatus(false);
        startAuthWatch();
        return false;
      }
      currentUserId = getUserIdFromToken(token);
      if (authMsg) authMsg.hidden = true;
      if (tableContent) tableContent.hidden = false;
      setDevActionsEnabled(true);
      setDevActionsAuthStatus(true);
      stopAuthWatch();
      return true;
    }

    function handleTableAuthExpired(opts){
      currentUserId = null;
      isSeated = false;
      clearDeadlineNudge();
      setDevActionsEnabled(false);
      setDevActionsAuthStatus(false);
      renderHoleCards(null);
      stopWsClient();
      stopRealtime();
      handleAuthExpired(opts);
    }

    function updatePendingUi(){
      var busy = joinPending || leavePending;
      setLoading(joinBtn, busy);
      setLoading(leaveBtn, busy);
      if (seatNoInput) setDisabled(seatNoInput, busy);
      if (buyInInput) setDisabled(buyInInput, busy);
      if (joinStatusEl){
        joinStatusEl.textContent = joinPending ? t('pokerJoinPending', 'Joining...') : '';
        joinStatusEl.hidden = !joinPending;
      }
      if (leaveStatusEl){
        leaveStatusEl.textContent = leavePending ? t('pokerLeavePending', 'Leaving...') : '';
        leaveStatusEl.hidden = !leavePending;
      }
      updateDevActionsUi();
    }

    function shouldEnableDevActions(){
      return resolveDevLogActionAvailability({
        devActionsEnabled: devActionsEnabled,
        tableId: tableId,
        joinPending: joinPending,
        leavePending: leavePending,
        startHandPending: startHandPending,
        actPending: actPending,
        copyLogPending: copyLogPending,
        dumpLogsPending: dumpLogsPending
      }).baseEnabled;
    }

    function shouldEnableDumpLogs(){
      return resolveDevLogActionAvailability({
        devActionsEnabled: devActionsEnabled,
        tableId: tableId,
        joinPending: joinPending,
        leavePending: leavePending,
        startHandPending: startHandPending,
        actPending: actPending,
        copyLogPending: copyLogPending,
        dumpLogsPending: dumpLogsPending
      }).canDumpLogs;
    }

    function shouldEnableCopyLog(){
      return resolveDevLogActionAvailability({
        devActionsEnabled: devActionsEnabled,
        tableId: tableId,
        joinPending: joinPending,
        leavePending: leavePending,
        startHandPending: startHandPending,
        actPending: actPending,
        copyLogPending: copyLogPending,
        dumpLogsPending: dumpLogsPending
      }).canCopyLog;
    }

    function toggleHidden(el, hidden){
      if (!el) return;
      el.hidden = !!hidden;
    }

    function normalizeActionType(value){
      if (typeof value !== 'string') return '';
      return value.trim().toUpperCase();
    }

    function isActionablePhase(phase){
      return phase === 'PREFLOP' || phase === 'FLOP' || phase === 'TURN' || phase === 'RIVER';
    }

    function resolvePhase(data, stateObj, state){
      var sources = [
        state && state.phase,
        stateObj && stateObj.phase,
        data && data.phase
      ];
      for (var i = 0; i < sources.length; i++){
        if (typeof sources[i] === 'string' && sources[i].trim()){
          return normalizeActionType(sources[i]);
        }
      }
      return null;
    }

    function addAllowedFromSource(source, allowed){
      if (!source) return false;
      var list = null;
      if (Array.isArray(source)){
        list = source;
      } else if (Array.isArray(source.actions)){
        list = source.actions;
      } else if (Array.isArray(source.allowedActions)){
        list = source.allowedActions;
      } else if (Array.isArray(source.availableActions)){
        list = source.availableActions;
      } else if (Array.isArray(source.legalActions)){
        list = source.legalActions;
      }
      if (!list) return false;
      for (var i = 0; i < list.length; i++){
        var entry = list[i];
        var type = '';
        if (typeof entry === 'string'){
          type = entry;
        } else if (entry && typeof entry.type === 'string'){
          type = entry.type;
        } else if (entry && typeof entry.actionType === 'string'){
          type = entry.actionType;
        } else if (entry && entry.action && typeof entry.action.type === 'string'){
          type = entry.action.type;
        }
        type = normalizeActionType(type);
        if (type) allowed.add(type);
      }
      return allowed.size > 0;
    }

    function resolveTurnUserId(data, state){
      if (!state) return null;
      var candidate = typeof state.turnUserId === 'string' && state.turnUserId.trim() ? state.turnUserId.trim() : null;
      if (!candidate && typeof state.toActUserId === 'string' && state.toActUserId.trim()){
        candidate = state.toActUserId.trim();
      }
      if (candidate) return candidate;
      var seatFields = ['turnSeatNo', 'toActSeatNo', 'currentSeatNo', 'actingSeatNo'];
      var seatNo = null;
      for (var i = 0; i < seatFields.length; i++){
        var value = state[seatFields[i]];
        if (typeof value === 'number' && isFinite(value)){
          seatNo = value;
          break;
        }
      }
      if (seatNo == null) return null;
      var seats = data && Array.isArray(data.seats) ? data.seats : [];
      for (var s = 0; s < seats.length; s++){
        var seat = seats[s];
        if (seat && seat.seatNo === seatNo && typeof seat.userId === 'string' && seat.userId.trim()){
          return seat.userId.trim();
        }
      }
      return null;
    }

    function getAllowedActionsForUser(data, userId){
      var info = { allowed: new Set(), needsAmount: false, phase: null, turnUserId: null, isUsersTurn: false, legalActions: [], constraints: normalizeActionConstraints(null) };
      if (!data || !userId) return info;
      var stateObj = data && data.state ? data.state : null;
      var gameState = stateObj && stateObj.state ? stateObj.state : {};
      info.phase = resolvePhase(data, stateObj, gameState);
      info.turnUserId = resolveTurnUserId(data, gameState);
      info.isUsersTurn = !!(info.turnUserId && info.turnUserId === userId && isActionablePhase(info.phase));
      var allowed = info.allowed;
      var list = getLegalActionsFromResponse(data);
      info.legalActions = list;
      for (var i = 0; i < list.length; i++){
        var type = normalizeActionType(list[i]);
        if (type) allowed.add(type);
      }
      var sourceConstraints = data && data._actionConstraints ? data._actionConstraints : getConstraintsFromResponse(data);
      var sanitized = sanitizeAllowedActions(allowed, sourceConstraints);
      if (info.isUsersTurn && sanitized.allowed.size === 0 && list.length > 0){
        sanitized.allowed = buildNormalizedAllowedActions(list);
        sanitized.needsAmount = sanitized.allowed.has('BET') || sanitized.allowed.has('RAISE');
      }
      info.allowed = sanitized.allowed;
      info.needsAmount = sanitized.needsAmount;
      info.constraints = sanitized.constraints;
      return info;
    }

    function buildAmountDecisionSignature(allowedInfo){
      var info = allowedInfo || {};
      var actions = info.allowed && typeof info.allowed.forEach === 'function' ? Array.from(info.allowed).sort().join(',') : '';
      var constraints = info.constraints || {};
      var handId = resolveCurrentHandId();
      return [
        handId || '',
        info.turnUserId || '',
        info.phase || '',
        actions,
        constraints.toCall == null ? '' : String(constraints.toCall),
        constraints.minRaiseTo == null ? '' : String(constraints.minRaiseTo),
        constraints.maxRaiseTo == null ? '' : String(constraints.maxRaiseTo),
        constraints.maxBetAmount == null ? '' : String(constraints.maxBetAmount)
      ].join('|');
    }

    function renderAllowedActionButtons(){
      var allowedInfo = getAllowedActionsForUser(tableData, currentUserId);
      var allowed = allowedInfo.allowed;
      var enabled = shouldEnableDevActions();
      var uiState = resolveTurnActionUiState({
        phase: allowedInfo.phase,
        turnUserId: allowedInfo.turnUserId,
        currentUserId: currentUserId,
        isUsersTurn: allowedInfo.isUsersTurn,
        rawLegalActions: allowedInfo.legalActions,
        availableActions: Array.from(allowedInfo.allowed)
      });
      var hasActions = uiState.showActions;
      var nextDecisionSignature = hasActions && allowedInfo.needsAmount ? buildAmountDecisionSignature(allowedInfo) : '';
      if (nextDecisionSignature !== amountDecisionSignature){
        selectedAmountActionType = null;
      }
      amountDecisionSignature = nextDecisionSignature;
      var amountModel = resolveAmountActionModel(allowedInfo, 20, selectedAmountActionType);
      var allInPlan = hasActions ? resolveAllInPlan(allowedInfo, tableData, currentUserId) : null;
      var showAmountRow = hasActions && amountModel.visible;
      var selectedAmountType = normalizeActionType(selectedAmountActionType);
      if (!amountModel.hasBet && selectedAmountType === 'BET') selectedAmountActionType = null;
      if (!amountModel.hasRaise && selectedAmountType === 'RAISE') selectedAmountActionType = null;
      toggleHidden(actRow, !hasActions);
      toggleHidden(actAmountWrap, !showAmountRow);
      var actions = [
        { type: 'CHECK', el: actCheckBtn },
        { type: 'CALL', el: actCallBtn },
        { type: 'FOLD', el: actFoldBtn },
        { type: 'BET', el: actBetBtn },
        { type: 'RAISE', el: actRaiseBtn }
      ];
      for (var i = 0; i < actions.length; i++){
        var item = actions[i];
        var isAllowed = allowed.has(item.type);
        toggleHidden(item.el, !hasActions || !isAllowed);
        setDisabled(item.el, !enabled || actPending || !isAllowed);
      }
      var showAllIn = hasActions && !!allInPlan;
      toggleHidden(actAllInBtn, !showAllIn);
      setDisabled(actAllInBtn, !enabled || actPending || !showAllIn);
      if (actCallBtn){
        if (!actCallBtn.dataset.baseLabel){
          actCallBtn.dataset.baseLabel = actCallBtn.textContent || t('pokerActCall', 'CALL');
        }
        var baseLabel = actCallBtn.dataset.baseLabel || t('pokerActCall', 'CALL');
        var toCall = allowedInfo.constraints ? allowedInfo.constraints.toCall : null;
        var callAllowed = allowed.has('CALL');
        if (callAllowed && toCall != null && toCall > 0){
          var callTemplate = t('pokerCallWithAmount', 'CALL ({amount})');
          actCallBtn.textContent = callTemplate.replace('{amount}', String(toCall));
        } else {
          actCallBtn.textContent = baseLabel;
        }
      }
      if (actAmountInput){
        if (showAmountRow){
          var currentAmount = parseInt(actAmountInput.value, 10);
          var hasCurrentInt = isFinite(currentAmount);
          var isCurrentValid = hasCurrentInt && Math.trunc(currentAmount) >= amountModel.min && (amountModel.max == null || Math.trunc(currentAmount) <= amountModel.max);
          var shouldResetAmount = !amountRowWasVisible || !isCurrentValid;
          if (shouldResetAmount){
            actAmountInput.value = String(amountModel.defaultValue);
          }
        }
        setDisabled(actAmountInput, !enabled || actPending || !showAmountRow);
        updateActAmountConstraints(amountModel);
      }
      amountRowWasVisible = showAmountRow;
      updateActAmountHint(amountModel, showAmountRow);
      if (actStatusEl){
        if (uiState.status === 'contract_mismatch'){
          setInlineStatus(actStatusEl, t('pokerContractMismatch', 'No legal actions computed. Client/server contract mismatch.'), 'error');
        } else if (uiState.status === 'no_actionable_moves'){
          setInlineStatus(actStatusEl, t('pokerNoActionableMoves', 'No actionable moves available right now'), null);
        } else if (!allowedInfo.isUsersTurn && isActionablePhase(allowedInfo.phase) && !!allowedInfo.turnUserId){
          setInlineStatus(actStatusEl, t('pokerWaitingForOpponent', 'Waiting for opponent'), null);
        } else if (actStatusEl.dataset.authRequired !== '1') {
          setInlineStatus(actStatusEl, null, null);
        }
      }
    }

    function updateActAmountConstraints(amountModel){
      if (!actAmountInput) return;
      actAmountInput.removeAttribute('min');
      actAmountInput.removeAttribute('max');
      if (!amountModel || !amountModel.visible) return;
      if (amountModel.min != null && amountModel.min >= 1) actAmountInput.setAttribute('min', String(amountModel.min));
      if (amountModel.max != null && amountModel.max >= amountModel.min) actAmountInput.setAttribute('max', String(amountModel.max));
    }

    function updateActAmountHint(amountModel, showAmountRow){
      if (!actAmountHintEl) return;
      if (!showAmountRow || !amountModel || !amountModel.visible || !shouldEnableDevActions()){
        actAmountHintEl.textContent = '';
        actAmountHintEl.hidden = true;
        return;
      }
      actAmountHintEl.textContent = amountModel.hintLabel || t('pokerActAmountHint', 'Use a positive integer amount');
      actAmountHintEl.hidden = false;
    }

    function updateDevActionsUi(){
      var enabled = shouldEnableDevActions();
      var dumpEnabled = shouldEnableDumpLogs();
      var copyEnabled = shouldEnableCopyLog();
      setLoading(startHandBtn, startHandPending);
      setDisabled(startHandBtn, !enabled || startHandPending);
      setLoading(dumpLogsBtn, dumpLogsPending);
      setDisabled(dumpLogsBtn, !dumpEnabled || dumpLogsPending);
      toggleHidden(dumpLogsBtn, !devActionsEnabled);
      toggleHidden(dumpLogsStatusEl, !devActionsEnabled);
      setLoading(copyLogBtn, copyLogPending);
      setDisabled(copyLogBtn, !copyEnabled || copyLogPending);
      toggleHidden(copyLogBtn, !devActionsEnabled);
      toggleHidden(copyLogStatusEl, !devActionsEnabled);
      renderAllowedActionButtons();
    }

    function setDevActionsEnabled(enabled){
      devActionsEnabled = !!enabled;
      if (!devActionsEnabled){
        clearStartHandPending();
        clearActPending();
        setInlineStatus(startHandStatusEl, null, null);
        setInlineStatus(actStatusEl, null, null);
        setInlineStatus(copyLogStatusEl, null, null);
        setInlineStatus(dumpLogsStatusEl, null, null);
        copyLogPending = false;
        dumpLogsPending = false;
      }
      updateDevActionsUi();
    }

    function setDevActionsAuthStatus(authed){
      var message = authed ? null : t('pokerDevActionsSignIn', 'Sign in to use Dev Actions');
      if (actStatusEl){
        actStatusEl.dataset.authRequired = authed ? '' : '1';
      }
      setInlineStatus(startHandStatusEl, message, null);
      setInlineStatus(actStatusEl, message, null);
      setInlineStatus(copyLogStatusEl, message, null);
      setInlineStatus(dumpLogsStatusEl, message, null);
      renderAllowedActionButtons();
    }

    function setPendingState(action, isPending){
      if (action === 'join'){
        joinPending = isPending;
      } else if (action === 'leave'){
        leavePending = isPending;
      }
      updatePendingUi();
    }

    function setDevPendingState(action, isPending){
      if (action === 'startHand'){
        startHandPending = isPending;
        if (startHandStatusEl){
          setInlineStatus(startHandStatusEl, isPending ? t('pokerStartHandPending', 'Starting...') : null, null);
        }
      } else if (action === 'act'){
        actPending = isPending;
        if (actStatusEl){
          setInlineStatus(actStatusEl, isPending ? t('pokerActPending', 'Sending...') : null, null);
        }
      } else if (action === 'copyLog'){
        copyLogPending = isPending;
        if (copyLogStatusEl){
          setInlineStatus(copyLogStatusEl, isPending ? t('pokerCopyLogPending', 'Copying...') : null, null);
        }
      } else if (action === 'dumpLogs'){
        dumpLogsPending = isPending;
        if (dumpLogsStatusEl){
          setInlineStatus(dumpLogsStatusEl, isPending ? t('pokerDumpLogsPending', 'Dumping...') : null, null);
        }
      }
      updateDevActionsUi();
    }

    function clearJoinPending(){
      pendingJoinRequestId = null;
      pendingJoinRetries = 0;
      pendingJoinStartedAt = null;
      if (pendingJoinTimer){
        clearTimeout(pendingJoinTimer);
        pendingJoinTimer = null;
      }
      setPendingState('join', false);
    }

    function clearLeavePending(){
      pendingLeaveRequestId = null;
      pendingLeaveRetries = 0;
      pendingLeaveStartedAt = null;
      if (pendingLeaveTimer){
        clearTimeout(pendingLeaveTimer);
        pendingLeaveTimer = null;
      }
      setPendingState('leave', false);
    }

    function clearStartHandPending(){
      pendingStartHandRequestId = null;
      pendingStartHandRetries = 0;
      pendingStartHandStartedAt = null;
      if (pendingStartHandTimer){
        clearTimeout(pendingStartHandTimer);
        pendingStartHandTimer = null;
      }
      setDevPendingState('startHand', false);
    }

    function clearActPending(){
      pendingActRequestId = null;
      pendingActActionType = null;
      selectedAmountActionType = null;
      pendingActRetries = 0;
      pendingActStartedAt = null;
      if (pendingActTimer){
        clearTimeout(pendingActTimer);
        pendingActTimer = null;
      }
      setDevPendingState('act', false);
    }

    function clearCopyLogPending(){
      setDevPendingState('copyLog', false);
    }

    function clearDumpLogsPending(){
      setDevPendingState('dumpLogs', false);
    }

    function handlePendingTimeout(action){
      if (action === 'startHand'){
        var startHandRetries = pendingStartHandRetries;
        klog('poker_pending_timeout', { action: action, tableId: tableId, retries: startHandRetries, budgetMs: PENDING_RETRY_BUDGET_MS });
        clearStartHandPending();
        setInlineStatus(startHandStatusEl, t('pokerErrStartHandPending', 'Start hand still pending. Please try again.'), 'error');
        return;
      }
      var message = action === 'join' ? t('pokerErrJoinPending', 'Join still pending. Please try again.') : t('pokerErrLeavePending', 'Leave still pending. Please try again.');
      var endpoint = action === 'join' ? WS_JOIN_ENDPOINT : WS_LEAVE_ENDPOINT;
      var retries = action === 'join' ? pendingJoinRetries : pendingLeaveRetries;
      klog('poker_pending_timeout', { action: action, tableId: tableId, retries: retries, budgetMs: PENDING_RETRY_BUDGET_MS });
      if (action === 'join'){
        clearJoinPending();
      } else {
        clearLeavePending();
      }
      setActionError(action, endpoint, 'pending_timeout', message);
    }

    function schedulePendingRetry(action, retryFn){
      if (!isPageActive()) return;
      if (action === 'startHand'){
        setDevPendingState('startHand', true);
      } else {
        setPendingState(action, true);
      }
      var startedAt = action === 'join' ? pendingJoinStartedAt : action === 'leave' ? pendingLeaveStartedAt : pendingStartHandStartedAt;
      var retries = action === 'join' ? pendingJoinRetries : action === 'leave' ? pendingLeaveRetries : pendingStartHandRetries;
      if (!startedAt) startedAt = Date.now();
      retries += 1;
      var delay = getPendingDelay(retries);
      if (!shouldRetryPending(startedAt, delay)){
        handlePendingTimeout(action);
        return;
      }
      if (action === 'join'){
        pendingJoinStartedAt = startedAt;
        pendingJoinRetries = retries;
        if (pendingJoinTimer) clearTimeout(pendingJoinTimer);
        pendingJoinTimer = scheduleRetry(retryFn, delay);
      } else if (action === 'leave'){
        pendingLeaveStartedAt = startedAt;
        pendingLeaveRetries = retries;
        if (pendingLeaveTimer) clearTimeout(pendingLeaveTimer);
        pendingLeaveTimer = scheduleRetry(retryFn, delay);
      } else if (action === 'startHand'){
        pendingStartHandStartedAt = startedAt;
        pendingStartHandRetries = retries;
        if (pendingStartHandTimer) clearTimeout(pendingStartHandTimer);
        pendingStartHandTimer = scheduleRetry(retryFn, delay);
      }
    }

    function handleDevPendingTimeout(action){
      if (action !== 'act') return;
      clearActPending();
      setInlineStatus(actStatusEl, t('pokerErrActPending', 'Action still pending. Please try again.'), 'error');
    }

    function scheduleDevPendingRetry(action, retryFn){
      if (action !== 'act') return;
      if (!isPageActive()) return;
      setDevPendingState('act', true);
      var startedAt = pendingActStartedAt;
      var retries = pendingActRetries;
      if (!startedAt) startedAt = Date.now();
      retries += 1;
      var delay = getPendingDelay(retries);
      if (!shouldRetryPending(startedAt, delay)){
        handleDevPendingTimeout('act');
        return;
      }
      pendingActStartedAt = startedAt;
      pendingActRetries = retries;
      if (pendingActTimer) clearTimeout(pendingActTimer);
      pendingActTimer = scheduleRetry(retryFn, delay);
    }

    function stopPendingRetries(){
      if (pendingJoinTimer){
        clearTimeout(pendingJoinTimer);
        pendingJoinTimer = null;
      }
      if (pendingLeaveTimer){
        clearTimeout(pendingLeaveTimer);
        pendingLeaveTimer = null;
      }
      if (pendingStartHandTimer){
        clearTimeout(pendingStartHandTimer);
        pendingStartHandTimer = null;
      }
      if (pendingActTimer){
        clearTimeout(pendingActTimer);
        pendingActTimer = null;
      }
    }

    // stopPendingAll cancels pending operations (clears request ids) — used for unload and auth expiry.
    function stopPendingAll(){
      clearJoinPending();
      clearLeavePending();
      clearStartHandPending();
      clearActPending();
      clearPostActSnapshotRefresh();
      clearCopyLogPending();
      clearDumpLogsPending();
    }

    function pauseJoinPending(){
      if (pendingJoinTimer){
        clearTimeout(pendingJoinTimer);
        pendingJoinTimer = null;
      }
      setPendingState('join', false);
    }

    function pauseLeavePending(){
      if (pendingLeaveTimer){
        clearTimeout(pendingLeaveTimer);
        pendingLeaveTimer = null;
      }
      setPendingState('leave', false);
    }

    function pauseStartHandPending(){
      if (pendingStartHandTimer){
        clearTimeout(pendingStartHandTimer);
        pendingStartHandTimer = null;
      }
      setDevPendingState('startHand', false);
    }

    function pauseActPending(){
      if (pendingActTimer){
        clearTimeout(pendingActTimer);
        pendingActTimer = null;
      }
      setDevPendingState('act', false);
    }

    function setActionError(action, endpoint, code, message){
      if (!message) return;
      setError(errorEl, message);
      persistLastError({
        ts: Date.now(),
        action: action,
        endpoint: endpoint,
        code: code || 'unknown_error',
        message: message
      });
    }

    function isSeatTakenError(err){
      var code = err && (err.code || err.error || err.message);
      return code === 'seat_taken' || code === 'duplicate_seat' || code === 'conflict' || code === '23505';
    }

    function isNeutralAutoStartCode(code){
      return code === 'not_enough_players' || code === 'already_in_hand' || code === 'state_conflict';
    }

    function getPreferredSeatNo(preferredSeatNoOverride){
      var maxUi = Number.isInteger(tableMaxPlayers) && tableMaxPlayers >= 2 ? tableMaxPlayers : 1;
      var preferredSeatNo = 1;
      if (Number.isInteger(preferredSeatNoOverride)){
        preferredSeatNo = preferredSeatNoOverride;
      } else if (Number.isInteger(suggestedSeatNoParam)){
        preferredSeatNo = suggestedSeatNoParam;
      } else {
        var inputSeatNo = parseInt(seatNoInput ? seatNoInput.value : 1, 10);
        preferredSeatNo = isNaN(inputSeatNo) ? 1 : inputSeatNo;
      }
      if (preferredSeatNo < 1) preferredSeatNo = 1;
      if (preferredSeatNo > maxUi) preferredSeatNo = maxUi;
      return preferredSeatNo;
    }

    function getSeatedCount(data){
      var seats = data && Array.isArray(data.seats) ? data.seats : [];
      var activeCount = 0;
      for (var i = 0; i < seats.length; i++){
        var seat = seats[i];
        if (!seat || !seat.userId) continue;
        var status = typeof seat.status === 'string' ? seat.status.toUpperCase() : '';
        if (!status || status === 'ACTIVE' || status === 'SEATED') activeCount++;
      }
      return activeCount;
    }

    async function maybeAutoStartHand(){
      if (!shouldAutoStart) return;
      if (!currentUserId || !isSeated || !tableData) return;
      if (startHandPending || joinPending || leavePending || actPending) return;
      if (pendingStartHandRequestId) return;
      if (!getGameplayWsSender(wsClient, 'sendStartHand', 'start_hand')) return;
      var table = tableData.table || {};
      var stateObj = tableData.state || {};
      var gameState = stateObj.state || {};
      var status = typeof table.status === 'string' ? table.status : '';
      var phase = typeof gameState.phase === 'string' ? gameState.phase : '';
      var seatedCount = getSeatedCount(tableData);
      var minPlayers = Number.isInteger(table.minPlayers) && table.minPlayers >= 2 ? table.minPlayers : 2;
      if (status !== 'OPEN' || phase !== 'INIT') {
        autoStartStopForHand = false;
        return;
      }
      if (seatedCount < minPlayers) return;
      if (autoStartStopForHand) return;
      var now = Date.now();
      if (now - autoStartLastAttemptAt < autoStartCooldownMs) return;
      autoStartLastAttemptAt = now;
      klog('poker_auto_start_attempt', { tableId: tableId, seatedCount: seatedCount, phase: phase, status: status });
      var requestId = normalizeRequestId(generateRequestId());
      pendingStartHandRequestId = requestId;
      var startResult = await startHand(requestId, { suppressNeutralErrors: true });
      var code = startResult && startResult.code ? startResult.code : (startResult && startResult.ok ? 'ok' : 'unknown_error');
      klog('poker_auto_start_result', { tableId: tableId, code: code });
      if (code === 'already_in_hand') autoStartStopForHand = true;
      if (isNeutralAutoStartCode(code)) return;
    }

    function applySeatInputBounds(){
      if (!seatNoInput) return;
      var maxUi = Number.isInteger(tableMaxPlayers) && tableMaxPlayers >= 2 ? tableMaxPlayers : 1;
      seatNoInput.min = '1';
      seatNoInput.max = String(maxUi);
      seatNoInput.step = '1';
      var seatNo = parseInt(seatNoInput.value, 10);
      if (isNaN(seatNo)) seatNo = 1;
      if (seatNo < 1) seatNo = 1;
      if (seatNo > maxUi) seatNo = maxUi;
      seatNoInput.value = String(seatNo);
    }

    async function autoJoinWithRetries(){
      var maxUi = Number.isInteger(tableMaxPlayers) && tableMaxPlayers >= 2 ? tableMaxPlayers : 1;
      var startSeat = getPreferredSeatNo();
      if (startSeat < 1) startSeat = 1;
      if (startSeat > maxUi) startSeat = maxUi;
      var attempts = Math.min(3, tableMaxPlayers);
      for (var i = 0; i < attempts; i++){
        var candidateSeat = startSeat + i;
        if (candidateSeat > maxUi) candidateSeat = candidateSeat - maxUi;
        seatNoInput.value = candidateSeat;
        try {
          await joinTable(null, { propagateError: true, autoSeat: true, preferredSeatNoOverride: candidateSeat });
          return;
        } catch (err){
          if (isAbortError(err)){
            pauseJoinPending();
            return;
          }
          if (!isSeatTakenError(err)) throw err;
        }
      }
      var seatErr = new Error(t('pokerErrSeatTaken', 'Seat was taken. Please try again.'));
      seatErr.code = 'seat_taken';
      throw seatErr;
    }

    function maybeAutoJoin(){
      if (!shouldAutoJoin || autoJoinAttempted) return;
      if (joinPending || leavePending || startHandPending || actPending) return;
      if (!seatNoInput) return;
      if (!Number.isInteger(tableMaxPlayers) || tableMaxPlayers < 2) return;
      if (isSeated) return;
      if (!getGameplayWsSender(wsClient, 'sendJoin', 'join')) return;
      autoJoinAttempted = true;
      var preferredSeatNo = getPreferredSeatNo();
      klog('poker_auto_join_attempt', { tableId: tableId, preferredSeatNo: preferredSeatNo, autoSeat: true });
      autoJoinWithRetries().catch(function(err){
        if (isAbortError(err)){
          pauseJoinPending();
          return;
        }
        clearJoinPending();
        var code = err && err.code ? err.code : (err && err.message ? err.message : 'unknown_error');
        klog('poker_auto_join_error', { tableId: tableId, code: code, message: err && err.message ? err.message : code });
        setActionError('join', WS_JOIN_ENDPOINT, err && err.code ? err.code : 'request_failed', err && (err.message || err.code) ? err.message || err.code : t('pokerErrJoin', 'Failed to join'));
      });
    }

    function stopPolling(){
      clearDeadlineNudge();
    }

    function stopHeartbeat(){
      clearDeadlineNudge();
    }

    function clearDeadlineNudge(){
      if (deadlineNudgeTimer){
        clearTimeout(deadlineNudgeTimer);
        deadlineNudgeTimer = null;
      }
      deadlineNudgeTargetMs = null;
    }

    function scheduleDeadlineNudge(turnDeadlineAt){
      var deadlineMs = normalizeDeadlineMs(turnDeadlineAt);
      if (!deadlineMs){
        clearDeadlineNudge();
        return;
      }
      if (deadlineNudgeTimer && deadlineNudgeTargetMs === deadlineMs) return;
      clearDeadlineNudge();
      deadlineNudgeTargetMs = deadlineMs;
      var delayMs = Math.max(0, deadlineMs - Date.now() + 250);
      deadlineNudgeTimer = setTimeout(function(){
        deadlineNudgeTimer = null;
        deadlineNudgeTargetMs = null;
        if (!isPageActive()) return;
        if (joinPending || leavePending || startHandPending || actPending) return;
        klog('poker_deadline_nudge_ws_resync', { tableId: tableId });
        requestWsResync('turn_deadline_nudge');
      }, delayMs);
    }

    function requestWsResync(reason){
      if (!isPageActive()) return;
      if (joinPending || leavePending || startHandPending || actPending) return;
      if (wsClient && typeof wsClient.requestResync === 'function'){
        wsClient.requestResync({ reason: reason || 'resync' });
      }
    }


    function isCurrentUserSeated(data){
      if (!currentUserId || !data || !Array.isArray(data.seats)) return false;
      for (var i = 0; i < data.seats.length; i++){
        var seat = data.seats[i];
        if (!seat || typeof seat.userId !== 'string') continue;
        if (seat.userId.trim() === currentUserId) return true;
      }
      return false;
    }

    function sanitizeStacksForFlyout(stacks){
      var safeStacks = stacks && typeof stacks === 'object' && !Array.isArray(stacks) ? stacks : {};
      var out = {};
      Object.keys(safeStacks).forEach(function(userId){
        var normalizedUserId = typeof userId === 'string' ? userId.trim() : '';
        if (!normalizedUserId) return;
        var amount = toFiniteOrNull(safeStacks[userId]);
        if (amount == null) return;
        out[normalizedUserId] = amount;
      });
      return out;
    }

    function maybeRenderDerivedShowdownFlyout(params){
      var info = params || {};
      var gameState = info.gameState && typeof info.gameState === 'object' ? info.gameState : null;
      if (!gameState) return;
      var currentHandId = typeof gameState.handId === 'string' ? gameState.handId.trim() : '';
      var currentPhase = typeof gameState.phase === 'string' ? gameState.phase.trim().toUpperCase() : '';
      var currentStacks = sanitizeStacksForFlyout(gameState.stacks);
      var currentViewerCards = Array.isArray(info.viewerHoleCards) ? info.viewerHoleCards.slice(0, 2) : [];

      var previous = lastRenderedHandForFlyout;
      var hasShowdownInSnapshot = !!(gameState.showdown && typeof gameState.showdown === 'object');
      if (!hasShowdownInSnapshot && previous && previous.handId && currentHandId && previous.handId !== currentHandId){
        var payouts = {};
        Object.keys(currentStacks).forEach(function(userId){
          var previousAmount = Number.isFinite(previous.stacks[userId]) ? previous.stacks[userId] : 0;
          var delta = currentStacks[userId] - previousAmount;
          if (delta > 0) payouts[userId] = delta;
        });
        var winnerUserIds = Object.keys(payouts);
        if (winnerUserIds.length){
          var derivedReason = previous.phase === 'SHOWDOWN' ? 'derived_showdown' : 'all_folded';
          var syntheticState = {
            showdown: {
              handId: previous.handId,
              winners: winnerUserIds,
              potsAwarded: [],
              potAwardedTotal: null,
              reason: derivedReason
            },
            handSettlement: {
              handId: previous.handId,
              settledAt: null,
              payouts: payouts
            }
          };
          renderShowdownFlyout({
            state: syntheticState,
            playersById: info.playersById || {},
            tableId: tableId,
            currentUserId: currentUserId,
            viewerHoleCards: previous.viewerHoleCards
          });
          klog('poker_showdown_flyout_show_derived', {
            tableId: tableId,
            handId: previous.handId,
            winners: winnerUserIds,
            reason: derivedReason
          });
        }
      }

      lastRenderedHandForFlyout = {
        handId: currentHandId,
        phase: currentPhase,
        stacks: currentStacks,
        viewerHoleCards: currentViewerCards
      };
    }

    function handleRealtimeEvent(_payload){
      requestWsResync('realtime_event');
    }

    function startRealtime(){
      if (realtimeSub || realtimeDisabled) return;
      if (!tableId) return;
      if (!window.PokerRealtime || typeof window.PokerRealtime.subscribeToTableActions !== 'function') return;
      try {
        realtimeSub = window.PokerRealtime.subscribeToTableActions({
          tableId: tableId,
          onEvent: handleRealtimeEvent,
          klog: klog
        });
      } catch (err){
        realtimeSub = null;
        realtimeDisabled = true;
        if (!realtimeUnavailableLogged){
          realtimeUnavailableLogged = true;
          var errMessage = err && (err.message || err.code) ? err.message || err.code : 'unknown_error';
          klog('poker_realtime_unavailable', {
            message: errMessage,
            code: err && err.code ? err.code : null,
            userAgent: window.navigator && window.navigator.userAgent ? window.navigator.userAgent : null,
            hasWebSocket: typeof window.WebSocket === 'function',
            visibility: document.visibilityState,
            tableId: tableId
          });
        }
        startPollingFallback('realtime_unavailable');
      }
    }

    function stopRealtime(){
      clearDeadlineNudge();
      if (realtimeSub && typeof realtimeSub.stop === 'function'){
        realtimeSub.stop();
      }
      realtimeSub = null;
    }

    function renderTable(data){
      var table = data.table || {};
      var seats = data.seats || [];
      var stateObj = data.state || {};
      var gameState = stateObj.state || {};

      if (tableIdEl) tableIdEl.textContent = shortId(table.id || tableId);
      var stakes = table.stakes;
      var parsedStakes = parseStakesUi(stakes);
      stakesValid = !!parsedStakes;
      if (stakesEl) stakesEl.textContent = formatStakesUi(stakes);
      if (startHandBtn) startHandBtn.disabled = !stakesValid;
      if (startHandStatusEl){
        if (!stakesValid){
          startHandStatusEl.dataset.stakesInvalid = '1';
          setInlineStatus(startHandStatusEl, t('pokerErrInvalidStakes', 'Invalid stakes'), 'error');
        } else if (startHandStatusEl.dataset.stakesInvalid === '1') {
          startHandStatusEl.dataset.stakesInvalid = '';
          setInlineStatus(startHandStatusEl, null, null);
        }
      }
      if (statusEl) statusEl.textContent = table.status || '-';

      var maxPlayers = table.maxPlayers != null ? table.maxPlayers : 6;
      tableMaxPlayers = maxPlayers;
      applySeatInputBounds();
      var stacks = gameState.stacks || {};
      if (seatsGrid){
        seatsGrid.innerHTML = '';
        for (var i = 0; i < maxPlayers; i++){
          var seat = seats.find(function(s){ return s.seatNo === i; });
          var div = document.createElement('div');
          var seatClass = 'poker-seat';
          if (!seat){
            seatClass += ' poker-seat--empty';
          } else if (seat.status && seat.status.toUpperCase() === 'INACTIVE'){
            seatClass += ' poker-seat--inactive';
          }
          div.className = seatClass;
          var seatNoEl = document.createElement('div');
          seatNoEl.className = 'poker-seat-no';
          seatNoEl.textContent = t('pokerSeatPrefix', 'Seat') + ' ' + i;
          var seatUserEl = document.createElement('div');
          seatUserEl.className = 'poker-seat-user';
          seatUserEl.textContent = seat ? shortId(seat.userId) : t('pokerSeatEmpty', 'Empty');
          var seatStatusEl = document.createElement('div');
          seatStatusEl.className = 'poker-seat-status';
          var seatStackEl = document.createElement('div');
          seatStackEl.className = 'poker-seat-stack';
          if (!seat){
            seatStatusEl.className += ' poker-seat-status--empty';
            seatStatusEl.textContent = t('pokerSeatOpen', 'Open');
            seatStackEl.textContent = t('pokerSeatStack', 'Stack') + ': -';
          } else if (seat.status && seat.status.toUpperCase() === 'INACTIVE'){
            seatStatusEl.className += ' poker-seat-status--inactive';
            seatStatusEl.textContent = t('pokerSeatInactive', 'Inactive');
            var inactiveStack = seat.userId && stacks[seat.userId] != null ? formatChips(stacks[seat.userId]) : '-';
            seatStackEl.textContent = t('pokerSeatStack', 'Stack') + ': ' + inactiveStack;
          } else {
            seatStatusEl.className += ' poker-seat-status--active';
            seatStatusEl.textContent = t('pokerSeatActive', 'Active');
            var activeStack = seat.userId && stacks[seat.userId] != null ? formatChips(stacks[seat.userId]) : '-';
            seatStackEl.textContent = t('pokerSeatStack', 'Stack') + ': ' + activeStack;
          }
          div.appendChild(seatNoEl);
          div.appendChild(seatUserEl);
          div.appendChild(seatStatusEl);
          div.appendChild(seatStackEl);
          seatsGrid.appendChild(div);
        }
      }

      var hasCurrentUserStack = !!(currentUserId && stacks[currentUserId] != null);
      var yourStack = hasCurrentUserStack ? formatChips(stacks[currentUserId]) : '-';
      var seatFacts = findCurrentUserSeatFacts(data);
      klog('poker_render_your_stack_pre', {
        tableId: tableId,
        stateVersion: Number.isInteger(stateObj.version) ? stateObj.version : null,
        currentUserId: currentUserId || null,
        isSeated: isSeated === true,
        currentUserSeatNo: seatFacts.seatNo,
        hasCurrentUserStack: hasCurrentUserStack,
        rawCurrentUserStack: currentUserId ? stacks[currentUserId] : null,
        stacksKeys: Object.keys(stacks || {})
      });
      if (isSeated && currentUserId && !hasCurrentUserStack){
        klog('poker_stack_missing_for_seated_user', {
          tableId: tableId,
          stateVersion: Number.isInteger(stateObj.version) ? stateObj.version : null,
          snapshotKind: wsSnapshotSeen ? 'ws_runtime' : 'non_ws_or_initial',
          currentUserId: currentUserId,
          isSeated: isSeated === true,
          currentUserSeatNo: seatFacts.seatNo,
          stacksKeys: Object.keys(stacks || {}),
          hasCurrentUserStack: hasCurrentUserStack,
          rawCurrentUserStack: currentUserId ? stacks[currentUserId] : null,
          seatUserIds: Array.isArray(data.seats) ? data.seats.filter(function(seat){ return seat && typeof seat.userId === 'string' && seat.userId; }).map(function(seat){ return seat.userId; }) : [],
          youSeatPresent: Number.isInteger(seatFacts.seatNo)
        });
      }
      if (yourStackEl) yourStackEl.textContent = yourStack;
      if (potEl) potEl.textContent = gameState.pot != null ? gameState.pot : 0;
      if (phaseEl) phaseEl.textContent = gameState.phase || '-';
      renderPhaseLabel(gameState);
      renderCommunityBoard(gameState);
      renderHoleCards(data.myHoleCards);
      renderBestViewerHand(data.myHoleCards, gameState && Array.isArray(gameState.community) ? gameState.community : []);
      var playersById = buildPlayersById(seats);
      maybeRenderDerivedShowdownFlyout({
        gameState: gameState,
        playersById: playersById,
        viewerHoleCards: data.myHoleCards
      });
      renderShowdownPanel({
        state: gameState,
        playersById: playersById,
        tableId: tableId,
        currentUserId: currentUserId,
        viewerHoleCards: data.myHoleCards
      });
      renderTurnTimer(gameState);
      if (versionEl) versionEl.textContent = stateObj.version != null ? stateObj.version : '-';
      if (jsonBox) jsonBox.textContent = JSON.stringify(gameState, null, 2);
      renderAllowedActionButtons();
    }

    function renderHoleCards(cards){
      if (!myCardsEl) return;
      myCardsEl.innerHTML = '';
      var isValid = Array.isArray(cards) && cards.length === 2;
      if (!isValid){
        setInlineStatus(myCardsStatusEl, t('pokerMyCardsHidden', 'Sign in to see your cards.'), null);
        return;
      }
      for (var i = 0; i < cards.length; i++){
        myCardsEl.appendChild(buildCardElement(cards[i] || {}));
      }
      setInlineStatus(myCardsStatusEl, null, null);
    }

    function renderBestViewerHand(holeCards, communityCards){
      if (!bestHandWrapEl || !bestHandNameEl || !bestHandCardsEl){
        return;
      }
      bestHandCardsEl.innerHTML = '';
      var ownCards = Array.isArray(holeCards) ? holeCards.slice(0, 2) : [];
      var boardCards = Array.isArray(communityCards) ? communityCards.slice(0, 5) : [];
      if (ownCards.length !== 2){
        bestHandWrapEl.hidden = true;
        bestHandNameEl.textContent = '-';
        return;
      }
      var mergedCards = ownCards.concat(boardCards);
      var best = evaluateViewerBestHand(mergedCards);
      if (!best || !Array.isArray(best.cards) || best.cards.length !== 5){
        bestHandWrapEl.hidden = true;
        bestHandNameEl.textContent = '-';
        return;
      }
      bestHandNameEl.textContent = formatViewerHandCategory(best.category);
      for (var i = 0; i < best.cards.length; i++){
        bestHandCardsEl.appendChild(buildCardElement(best.cards[i] || {}));
      }
      bestHandWrapEl.hidden = false;
    }

    function renderTurnTimer(gameState){
      if (!turnTimerEl) return;
      var phase = gameState ? gameState.phase : null;
      if (!isActionablePhase(phase)){
        turnTimerEl.hidden = true;
        turnTimerEl.textContent = '';
        if (turnTimerInterval){
          clearInterval(turnTimerInterval);
          turnTimerInterval = null;
        }
        clearDeadlineNudge();
        return;
      }
      var deadlineMs = normalizeDeadlineMs(gameState.turnDeadlineAt);
      if (!deadlineMs){
        turnTimerEl.hidden = true;
        turnTimerEl.textContent = '';
        if (turnTimerInterval){
          clearInterval(turnTimerInterval);
          turnTimerInterval = null;
        }
        clearDeadlineNudge();
        return;
      }
      scheduleDeadlineNudge(gameState.turnDeadlineAt);
      function update(){
        var seconds = computeRemainingTurnSeconds(deadlineMs, Date.now());
        turnTimerEl.textContent = t('pokerTurnTimer', 'Time left') + ': ' + seconds + 's';
        turnTimerEl.hidden = false;
      }
      update();
      if (turnTimerInterval){
        clearInterval(turnTimerInterval);
      }
      turnTimerInterval = setInterval(update, 1000);
    }

    async function retryJoin(){
      if (!isPageActive()) return;
      if (!pendingJoinRequestId) return;
      await joinTable(pendingJoinRequestId);
    }

    async function retryLeave(){
      if (!isPageActive()) return;
      if (!pendingLeaveRequestId) return;
      await leaveTable(pendingLeaveRequestId);
    }

    async function retryStartHand(){
      if (!isPageActive()) return;
      if (!pendingStartHandRequestId) return;
      await startHand(pendingStartHandRequestId);
    }

    async function retryAct(){
      if (!isPageActive()) return;
      if (!pendingActRequestId || !pendingActActionType) return;
      await sendAct(pendingActActionType, pendingActRequestId);
    }

    async function joinTable(requestIdOverride, options){
      var seatNo = parseInt(seatNoInput ? seatNoInput.value : 1, 10);
      var buyIn = parseInt(buyInInput ? buyInInput.value : 100, 10) || 100;
      if (isNaN(seatNo)) seatNo = 1;
      var maxSeatNo = Math.max(1, tableMaxPlayers);
      if (seatNo < 1) seatNo = 1;
      if (seatNo > maxSeatNo) seatNo = maxSeatNo;
      if (seatNoInput) seatNoInput.value = seatNo;
      var preferredSeatNo = getPreferredSeatNo(options && options.preferredSeatNoOverride);
      var hasAutoSeatOption = !!(options && Object.prototype.hasOwnProperty.call(options, 'autoSeat'));
      var wantAutoSeat = hasAutoSeatOption ? !!options.autoSeat : false;
      setPendingState('join', true);
      var propagateError = !!(options && options.propagateError);
      try {
        var resolved = resolveRequestId(pendingJoinRequestId, requestIdOverride);
        var didSetPending = false;
        if (resolved.nextPending){
          pendingJoinRequestId = normalizeRequestId(resolved.nextPending);
          pendingJoinRetries = 0;
          pendingJoinStartedAt = null;
          didSetPending = true;
        } else if (!pendingJoinRequestId) {
          pendingJoinRequestId = normalizeRequestId(resolved.requestId);
          didSetPending = true;
        }
        if (!hasAutoSeatOption && requestIdOverride && pendingJoinRequestId && requestIdOverride === pendingJoinRequestId){
          wantAutoSeat = !!pendingJoinAutoSeat;
        }
        if (didSetPending){
          pendingJoinAutoSeat = !!wantAutoSeat;
        }
        var joinRequestId = normalizeRequestId(resolved.requestId);
        var joinPayload = {
          tableId: tableId,
          buyIn: buyIn,
          requestId: joinRequestId
        };
        if (wantAutoSeat){
          joinPayload.autoSeat = true;
          joinPayload.preferredSeatNo = preferredSeatNo;
        } else {
          joinPayload.seatNo = seatNo;
        }
        var joinSender = resolveGameplayWsSender(wsClient, 'sendJoin', 'join', t('pokerErrJoinWsUnavailable', 'Cannot join while the live table connection is offline.'));
        var joinResult = await joinSender(joinPayload, joinRequestId);
        if (isPendingResponse(joinResult)){
          schedulePendingRetry('join', retryJoin);
          return;
        }
        if (joinResult && joinResult.ok === false){
          clearJoinPending();
          var joinErr = new Error(joinResult.error || 'request_failed');
          joinErr.code = joinResult.error || 'request_failed';
          setActionError('join', WS_JOIN_ENDPOINT, joinErr.code, t('pokerErrJoin', 'Failed to join'));
          if (propagateError) throw joinErr;
          return;
        }
        clearJoinPending();
        setError(errorEl, null);
        if (joinResult && joinResult.ok && joinResult.seatNo != null && seatNoInput){
          seatNoInput.value = String(joinResult.seatNo);
        }
        if (joinResult && joinResult.ok){
          klog('poker_auto_join_success', { tableId: tableId, seatNo: joinResult.seatNo });
        }
        if (!isPageActive()) return;
      } catch (err){
        if (isAbortError(err)){
          pauseJoinPending();
          return;
        }
        if (isAuthError(err)){
          stopPendingAll();
          handleTableAuthExpired({
            authMsg: authMsg,
            content: tableContent,
            errorEl: errorEl,
            stopPolling: stopPolling,
            stopHeartbeat: stopHeartbeat,
            onAuthExpired: startAuthWatch
          });
          return;
        }
        clearJoinPending();
        klog('poker_join_error', { tableId: tableId, error: err.message || err.code });
        setActionError('join', WS_JOIN_ENDPOINT, err.code || 'request_failed', err.message || t('pokerErrJoin', 'Failed to join'));
        if (propagateError) throw err;
      }
    }

    async function startHand(requestIdOverride, options){
      if (!shouldEnableDevActions()) return { ok: false, code: 'dev_actions_disabled' };
      if (!stakesValid){
        setInlineStatus(startHandStatusEl, t('pokerErrInvalidStakes', 'Invalid stakes'), 'error');
        return { ok: false, code: 'invalid_stakes' };
      }
      var opts = options || {};
      var suppressNeutralErrors = !!opts.suppressNeutralErrors;
      setInlineStatus(startHandStatusEl, null, null);
      setDevPendingState('startHand', true);
      try {
        var resolved = resolveRequestId(pendingStartHandRequestId, requestIdOverride);
        if (resolved.nextPending){
          pendingStartHandRequestId = normalizeRequestId(resolved.nextPending);
          pendingStartHandRetries = 0;
          pendingStartHandStartedAt = null;
        } else if (!pendingStartHandRequestId){
          pendingStartHandRequestId = normalizeRequestId(resolved.requestId);
        }
        var startRequestId = normalizeRequestId(resolved.requestId);
        var startHandSender = resolveGameplayWsSender(wsClient, 'sendStartHand', 'start_hand', t('pokerErrStartHandWsUnavailable', 'Cannot start a hand while the live table connection is offline.'));
        var result = await startHandSender({ tableId: tableId }, startRequestId);
        if (isPendingResponse(result)){
          schedulePendingRetry('startHand', retryStartHand);
          return { ok: false, code: 'request_pending', pending: true };
        }
        if (result && result.ok === false){
          var resultCode = result.error || 'request_failed';
          clearStartHandPending();
          if (resultCode === 'state_invalid') {
            setInlineStatus(startHandStatusEl, t('pokerErrStateChanged', 'State changed. Refreshing...'), 'error');
            requestWsResync('state_invalid');
            return { ok: false, code: resultCode };
          }
          if (suppressNeutralErrors && isNeutralAutoStartCode(resultCode)) {
            return { ok: false, code: resultCode };
          }
          setInlineStatus(startHandStatusEl, t('pokerErrStartHand', 'Failed to start hand'), 'error');
          return { ok: false, code: resultCode };
        }
        clearStartHandPending();
        setInlineStatus(startHandStatusEl, t('pokerStartHandOk', 'Hand started'), 'success');
        return { ok: true, code: 'ok' };
      } catch (err){
        if (isAbortError(err)){
          pauseStartHandPending();
          return { ok: false, code: 'aborted' };
        }
        if (isAuthError(err)){
          stopPendingAll();
          handleTableAuthExpired({
            authMsg: authMsg,
            content: tableContent,
            errorEl: errorEl,
            stopPolling: stopPolling,
            stopHeartbeat: stopHeartbeat,
            onAuthExpired: startAuthWatch
          });
          return { ok: false, code: 'unauthorized' };
        }
        var errCode = err && (err.code || err.error || err.message) ? err.code || err.error || err.message : 'request_failed';
        clearStartHandPending();
        klog('poker_start_hand_error', { tableId: tableId, error: err.message || err.code });
        if (!(suppressNeutralErrors && isNeutralAutoStartCode(errCode))){
          setInlineStatus(startHandStatusEl, err.message || t('pokerErrStartHand', 'Failed to start hand'), 'error');
        }
        return { ok: false, code: errCode };
      }
    }

    function getActPayload(actionType){
      var payload = { type: actionType };
      if (actionType === 'BET' || actionType === 'RAISE'){
        var allowedInfo = getAllowedActionsForUser(tableData, currentUserId);
        var validation = validateAmountActionPayload(actionType, actAmountInput ? actAmountInput.value : '', allowedInfo);
        if (validation.error) return { error: validation.error };
        payload.amount = validation.amount;
      }
      return { action: payload };
    }

    function resolveCurrentHandId(){
      var stateObj = tableData && tableData.state ? tableData.state : null;
      var state = stateObj && stateObj.state ? stateObj.state : null;
      var handId = state && typeof state.handId === 'string' ? state.handId.trim() : '';
      return handId || '';
    }

    function buildExportLogUrl(){
      var url = EXPORT_LOG_URL + '?tableId=' + encodeURIComponent(tableId);
      var handId = resolveCurrentHandId();
      if (handId){
        url += '&handId=' + encodeURIComponent(handId);
      }
      return url;
    }

    async function sendAct(actionType, requestIdOverride){
      if (!shouldEnableDevActions()) return { ok: false, code: 'disabled' };
      var normalized = normalizeActionType(actionType);
      if (!normalized) return { ok: false, code: 'invalid_action' };
      var allowedInfo = getAllowedActionsForUser(tableData, currentUserId);
      if (!allowedInfo.allowed.has(normalized)){
        setInlineStatus(actStatusEl, t('pokerErrActionNotAllowed', 'Action not allowed right now'), 'error');
        return { ok: false, code: 'action_not_allowed' };
      }
      var actionResult = getActPayload(normalized);
      if (actionResult.error){
        setInlineStatus(actStatusEl, actionResult.error, 'error');
        return { ok: false, code: 'invalid_amount' };
      }
      setInlineStatus(actStatusEl, null, null);
      setDevPendingState('act', true);
      try {
        var wsApplySeqBeforeAct = wsAppliedSnapshotSeq;
        var stateVersionBeforeAct = resolveTableDataVersion(tableData);
        var resolved = resolveRequestId(pendingActRequestId, requestIdOverride);
        if (resolved.nextPending){
          pendingActRequestId = normalizeRequestId(resolved.nextPending);
          pendingActRetries = 0;
          pendingActStartedAt = null;
        } else if (!pendingActRequestId){
          pendingActRequestId = normalizeRequestId(resolved.requestId);
        }
        pendingActActionType = normalized;
        var actRequestId = normalizeRequestId(resolved.requestId);
        var wsActPayload = { handId: resolveCurrentHandId(), action: normalized };
        if (actionResult.action && Number.isFinite(Number(actionResult.action.amount))) wsActPayload.amount = Number(actionResult.action.amount);
        var actSender = resolveGameplayWsSender(wsClient, 'sendAct', 'act', t('pokerErrActWsUnavailable', 'Cannot send an action while the live table connection is offline.'));
        var result = await actSender(wsActPayload, actRequestId);
        if (isPendingResponse(result)){
          scheduleDevPendingRetry('act', retryAct);
          return { ok: false, code: 'pending' };
        }
        if (result && result.ok === false){
          clearActPending();
          if (result.error === 'not_your_turn'){
            setInlineStatus(actStatusEl, t('pokerErrNotYourTurn', 'Not your turn'), 'error');
          } else if (result.error === 'action_not_allowed'){
            setInlineStatus(actStatusEl, t('pokerErrActionNotAllowed', 'Action not allowed right now'), 'error');
          } else if (result.error === 'invalid_amount'){
            setInlineStatus(actStatusEl, t('pokerErrActAmount', 'Invalid amount'), 'error');
          } else if (result.error === 'state_invalid'){
            setInlineStatus(actStatusEl, t('pokerErrStateChanged', 'State changed. Refreshing...'), 'error');
            requestWsResync('state_invalid');
          } else if (result.error === 'hand_not_live'){
            setInlineStatus(actStatusEl, t('pokerErrHandNotLive', 'Hand is not live'), 'error');
          } else {
            setInlineStatus(actStatusEl, t('pokerErrAct', 'Failed to send action'), 'error');
          }
          return { ok: false, code: result.error || 'failed' };
        }
        clearActPending();
        setInlineStatus(actStatusEl, t('pokerActOk', 'Action sent'), 'success');
        schedulePostActSnapshotRefresh({
          baselineApplySeq: wsApplySeqBeforeAct,
          baselineVersion: stateVersionBeforeAct
        });
        return { ok: true, code: 'ok' };
      } catch (err){
        if (isAbortError(err)){
          pauseActPending();
          return { ok: false, code: 'aborted' };
        }
        if (isAuthError(err)){
          stopPendingAll();
          handleTableAuthExpired({
            authMsg: authMsg,
            content: tableContent,
            errorEl: errorEl,
            stopPolling: stopPolling,
            stopHeartbeat: stopHeartbeat,
            onAuthExpired: startAuthWatch
          });
          return { ok: false, code: 'unauthorized' };
        }
        clearActPending();
        var errMessage = err && (err.message || err.code) ? String(err.message || err.code) : '';
        var loweredMessage = errMessage.toLowerCase();
        if (err && (err.status === 403 || err.code === 'not_your_turn' || loweredMessage.indexOf('not your turn') !== -1)){
          setInlineStatus(actStatusEl, t('pokerErrNotYourTurn', 'Not your turn'), 'error');
          return { ok: false, code: 'not_your_turn' };
        }
        if (err && err.code === 'action_not_allowed'){
          setInlineStatus(actStatusEl, t('pokerErrActionNotAllowed', 'Action not allowed right now'), 'error');
          return { ok: false, code: 'action_not_allowed' };
        }
        if (err && err.code === 'invalid_amount'){
          setInlineStatus(actStatusEl, t('pokerErrActAmount', 'Invalid amount'), 'error');
          return { ok: false, code: 'invalid_amount' };
        }
        if (err && err.code === 'state_invalid'){
          setInlineStatus(actStatusEl, t('pokerErrStateChanged', 'State changed. Refreshing...'), 'error');
          requestWsResync('state_invalid');
          return { ok: false, code: 'state_invalid' };
        }
        if (err && err.code === 'hand_not_live'){
          setInlineStatus(actStatusEl, t('pokerErrHandNotLive', 'Hand is not live'), 'error');
          return { ok: false, code: 'hand_not_live' };
        }
        klog('poker_act_error', { tableId: tableId, error: err.message || err.code });
        setInlineStatus(actStatusEl, err.message || t('pokerErrAct', 'Failed to send action'), 'error');
        return { ok: false, code: err && (err.code || err.message) ? err.code || err.message : 'failed' };
      }
    }

    async function dumpPokerLogs(){
      if (!shouldEnableDumpLogs()) return;
      setInlineStatus(dumpLogsStatusEl, null, null);
      setDevPendingState('dumpLogs', true);
      try {
        ensurePokerRecorder();
        var text = getPokerDumpText();
        if (!text){
          clearDumpLogsPending();
          setInlineStatus(dumpLogsStatusEl, t('pokerDumpLogsEmpty', 'No poker client logs to copy'), 'error');
          return;
        }
        var copied = await copyTextToClipboard(text);
        clearDumpLogsPending();
        if (!copied){
          setInlineStatus(dumpLogsStatusEl, t('pokerDumpLogsFail', 'Failed to copy logs'), 'error');
          return;
        }
        setInlineStatus(dumpLogsStatusEl, t('pokerDumpLogsOk', 'Poker logs copied'), 'success');
      } catch (err){
        clearDumpLogsPending();
        klog('poker_dump_logs_error', { tableId: tableId, error: err && (err.message || err.code) ? err.message || err.code : 'unknown_error' });
        setInlineStatus(dumpLogsStatusEl, t('pokerDumpLogsFail', 'Failed to copy logs'), 'error');
      }
    }

    async function copyHandLog(){
      if (!shouldEnableDevActions()) return;
      setInlineStatus(copyLogStatusEl, null, null);
      setDevPendingState('copyLog', true);
      try {
        var url = buildExportLogUrl();
        var result = await apiGet(url);
        if (!result || !result.schema){
          clearCopyLogPending();
          setInlineStatus(copyLogStatusEl, t('pokerCopyLogFail', 'Failed to export log'), 'error');
          return;
        }
        var text = JSON.stringify(result, null, 2);
        if (navigator && navigator.clipboard && typeof navigator.clipboard.writeText === 'function'){
          await navigator.clipboard.writeText(text);
        } else {
          throw new Error('clipboard_unavailable');
        }
        clearCopyLogPending();
        setInlineStatus(copyLogStatusEl, t('pokerCopyLogOk', 'Log copied'), 'success');
      } catch (err){
        if (isAuthError(err)){
          stopPendingAll();
          handleTableAuthExpired({
            authMsg: authMsg,
            content: tableContent,
            errorEl: errorEl,
            stopPolling: stopPolling,
            stopHeartbeat: stopHeartbeat,
            onAuthExpired: startAuthWatch
          });
          return;
        }
        clearCopyLogPending();
        klog('poker_copy_log_error', { tableId: tableId, error: err.message || err.code });
        var errCode = err && (err.message || err.code) ? String(err.message || err.code) : '';
        var errMsg = errCode === 'clipboard_unavailable' ? '' : errCode;
        setInlineStatus(copyLogStatusEl, errMsg || t('pokerCopyLogFail', 'Failed to export log'), 'error');
      }
    }

    async function leaveTable(requestIdOverride){
      setPendingState('leave', true);
      try {
        var resolved = resolveRequestId(pendingLeaveRequestId, requestIdOverride);
        if (resolved.nextPending){
          pendingLeaveRequestId = normalizeRequestId(resolved.nextPending);
          pendingLeaveRetries = 0;
          pendingLeaveStartedAt = null;
        } else if (!pendingLeaveRequestId) {
          pendingLeaveRequestId = normalizeRequestId(resolved.requestId);
        }
        var leaveRequestId = normalizeRequestId(resolved.requestId);
        klog('poker_leave_request', { tableId: tableId, requestId: leaveRequestId, url: 'ws:leave' });
        var leaveSender = resolveGameplayWsSender(wsClient, 'sendLeave', 'leave', t('pokerErrLeaveWsUnavailable', 'Cannot leave while the live table connection is offline.'));
        var leaveResult = await leaveSender({ tableId: tableId, requestId: leaveRequestId }, leaveRequestId);
        var pendingResponse = isPendingResponse(leaveResult);
        klog('poker_leave_response', {
          ok: !!(leaveResult && leaveResult.ok),
          pending: pendingResponse,
          code: leaveResult && leaveResult.error ? leaveResult.error : null
        });
        if (pendingResponse){
          schedulePendingRetry('leave', retryLeave);
          return;
        }
        if (leaveResult && leaveResult.ok === false){
          clearLeavePending();
          setActionError('leave', WS_LEAVE_ENDPOINT, leaveResult.error || 'request_failed', t('pokerErrLeave', 'Failed to leave'));
          return;
        }
        clearLeavePending();
        setError(errorEl, null);
        if (!isPageActive()) return;
        applyOptimisticLeaveCleanup();
      } catch (err){
        if (isAbortError(err)){
          pauseLeavePending();
          return;
        }
        if (isAuthError(err)){
          stopPendingAll();
          handleTableAuthExpired({
            authMsg: authMsg,
            content: tableContent,
            errorEl: errorEl,
            stopPolling: stopPolling,
            stopHeartbeat: stopHeartbeat,
            onAuthExpired: startAuthWatch
          });
          return;
        }
        clearLeavePending();
        klog('poker_leave_error', { tableId: tableId, error: err.message || err.code });
        setActionError('leave', WS_LEAVE_ENDPOINT, err.code || 'request_failed', err.message || t('pokerErrLeave', 'Failed to leave'));
      }
    }

    function handleVisibility(){
      if (document.visibilityState === 'hidden'){
        stopPolling();
        stopRealtime();
        stopWsClient();
        stopPendingRetries();
        if (!pendingHiddenAt) pendingHiddenAt = Date.now();
      } else {
        if (pendingHiddenAt){
          var hiddenDuration = Date.now() - pendingHiddenAt;
          if (pendingJoinStartedAt) pendingJoinStartedAt += hiddenDuration;
          if (pendingLeaveStartedAt) pendingLeaveStartedAt += hiddenDuration;
          if (pendingStartHandStartedAt) pendingStartHandStartedAt += hiddenDuration;
          if (pendingActStartedAt) pendingActStartedAt += hiddenDuration;
          pendingHiddenAt = null;
        }
                var canRefreshBaseline = !pendingJoinRequestId && !pendingLeaveRequestId;
        if (currentUserId && canRefreshBaseline){
          bootstrapWsAfterBaseline('visibility_resume');
        }
        if (pendingJoinRequestId) schedulePendingRetry('join', retryJoin);
        if (pendingLeaveRequestId) schedulePendingRetry('leave', retryLeave);
        if (pendingStartHandRequestId) schedulePendingRetry('startHand', retryStartHand);
        if (pendingActRequestId) scheduleDevPendingRetry('act', retryAct);
      }
    }

    function handleJoinClick(event){
      if (event){
        event.preventDefault();
        event.stopPropagation();
      }
      if (joinPending || leavePending) return;
      klog('poker_join_click', { tableId: tableId, hasToken: !!state.token });
      setError(errorEl, null);
      joinTable().catch(function(err){
        if (isAbortError(err)){
          pauseJoinPending();
          return;
        }
        clearJoinPending();
        klog('poker_join_click_error', { message: err && (err.message || err.code) ? err.message || err.code : 'unknown_error' });
        setActionError('join', WS_JOIN_ENDPOINT, err && err.code ? err.code : 'request_failed', err && (err.message || err.code) ? err.message || err.code : t('pokerErrJoin', 'Failed to join'));
      });
    }

    function handleLeaveClick(event){
      if (event){
        event.preventDefault();
        event.stopPropagation();
      }
      if (joinPending || leavePending) return;
      klog('poker_leave_click', { tableId: tableId, hasToken: !!state.token });
      setError(errorEl, null);
      leaveTable().catch(function(err){
        if (isAbortError(err)){
          pauseLeavePending();
          return;
        }
        clearLeavePending();
        klog('poker_leave_click_error', { message: err && (err.message || err.code) ? err.message || err.code : 'unknown_error' });
        setActionError('leave', WS_LEAVE_ENDPOINT, err && err.code ? err.code : 'request_failed', err && (err.message || err.code) ? err.message || err.code : t('pokerErrLeave', 'Failed to leave'));
      });
    }

    function handleStartHandClick(event){
      if (event){
        event.preventDefault();
        event.stopPropagation();
      }
      if (startHandPending || !shouldEnableDevActions()) return;
      klog('poker_start_hand_click', { tableId: tableId, hasToken: !!state.token });
      setInlineStatus(startHandStatusEl, null, null);
      startHand().catch(function(err){
        if (isAbortError(err)){
          pauseStartHandPending();
          return;
        }
        clearStartHandPending();
        klog('poker_start_hand_click_error', { message: err && (err.message || err.code) ? err.message || err.code : 'unknown_error' });
        setInlineStatus(startHandStatusEl, err && (err.message || err.code) ? err.message || err.code : t('pokerErrStartHand', 'Failed to start hand'), 'error');
      });
    }

    function handleDumpLogsClick(event){
      if (event){
        event.preventDefault();
        event.stopPropagation();
      }
      if (dumpLogsPending || !shouldEnableDumpLogs()) return;
      klog('poker_dump_logs_click', { tableId: tableId });
      setInlineStatus(dumpLogsStatusEl, null, null);
      dumpPokerLogs().catch(function(err){
        clearDumpLogsPending();
        klog('poker_dump_logs_click_error', { message: err && (err.message || err.code) ? err.message || err.code : 'unknown_error' });
        setInlineStatus(dumpLogsStatusEl, t('pokerDumpLogsFail', 'Failed to copy logs'), 'error');
      });
    }

    function handleCopyLogClick(event){
      if (event){
        event.preventDefault();
        event.stopPropagation();
      }
      if (copyLogPending || !shouldEnableCopyLog()) return;
      klog('poker_copy_log_click', { tableId: tableId, hasToken: !!state.token });
      setInlineStatus(copyLogStatusEl, null, null);
      copyHandLog().catch(function(err){
        clearCopyLogPending();
        klog('poker_copy_log_click_error', { message: err && (err.message || err.code) ? err.message || err.code : 'unknown_error' });
        setInlineStatus(copyLogStatusEl, err && (err.message || err.code) ? err.message || err.code : t('pokerCopyLogFail', 'Failed to export log'), 'error');
      });
    }

    function handleActionClick(actionType, event){
      if (event){
        event.preventDefault();
        event.stopPropagation();
      }
      if (actPending || !shouldEnableDevActions()) return;
      var normalized = normalizeActionType(actionType);
      if (!normalized) return;
      var allowedInfo = getAllowedActionsForUser(tableData, currentUserId);
      if (!allowedInfo.allowed.has(normalized)){
        setInlineStatus(actStatusEl, t('pokerErrActionNotAllowed', 'Action not allowed right now'), 'error');
        return;
      }
      if (normalized !== 'BET' && normalized !== 'RAISE'){
        selectedAmountActionType = null;
      } else {
        renderAllowedActionButtons();
      }
      klog('poker_act_click', { tableId: tableId, hasToken: !!state.token, type: normalized });
      setInlineStatus(actStatusEl, null, null);
      sendAct(normalized).then(function(_result){
      }).catch(function(err){
        klog('poker_act_click_unexpected_error', { message: err && (err.message || err.code) ? err.message || err.code : 'unknown_error' });
        setInlineStatus(actStatusEl, t('pokerErrAct', 'Failed to send action'), 'error');
      });
    }

    function resolveEnterAmountActionType(allowedInfo){
      var amountModel = resolveAmountActionModel(allowedInfo, 20, selectedAmountActionType);
      if (!amountModel || !amountModel.visible) return null;
      if (amountModel.actionType) return amountModel.actionType;
      var selected = normalizeActionType(selectedAmountActionType);
      if (selected === 'BET' && allowedInfo.allowed && allowedInfo.allowed.has('BET')) return 'BET';
      if (selected === 'RAISE' && allowedInfo.allowed && allowedInfo.allowed.has('RAISE')) return 'RAISE';
      return null;
    }

    function handleActAmountKeyDown(event){
      if (!event || event.key !== 'Enter') return;
      if (event.preventDefault) event.preventDefault();
      if (event.stopPropagation) event.stopPropagation();
      if (actPending || !shouldEnableDevActions()) return;
      var allowedInfo = getAllowedActionsForUser(tableData, currentUserId);
      var amountType = resolveEnterAmountActionType(allowedInfo);
      if (!amountType){
        var amountModel = resolveAmountActionModel(allowedInfo, 20, selectedAmountActionType);
        if (amountModel && amountModel.visible && amountModel.hasBet && amountModel.hasRaise){
          setInlineStatus(actStatusEl, t('pokerPickBetOrRaise', 'Choose BET or RAISE, then press Enter again'), 'error');
        }
        return;
      }
      handleActionClick(amountType, event);
    }

    function handleActCheckClick(event){
      handleActionClick('CHECK', event);
    }

    function handleActCallClick(event){
      handleActionClick('CALL', event);
    }

    function handleActFoldClick(event){
      handleActionClick('FOLD', event);
    }

    function handleActBetClick(event){
      selectedAmountActionType = 'BET';
      handleActionClick('BET', event);
    }

    function handleActRaiseClick(event){
      selectedAmountActionType = 'RAISE';
      handleActionClick('RAISE', event);
    }

    function handleActAllInClick(event){
      if (event){
        event.preventDefault();
        event.stopPropagation();
      }
      if (actPending || !shouldEnableDevActions()) return;
      var allowedInfo = getAllowedActionsForUser(tableData, currentUserId);
      var allInPlan = resolveAllInPlan(allowedInfo, tableData, currentUserId);
      if (!allInPlan || !allInPlan.type){
        setInlineStatus(actStatusEl, t('pokerErrActionNotAllowed', 'Action not allowed right now'), 'error');
        return;
      }
      if ((allInPlan.type === 'BET' || allInPlan.type === 'RAISE') && actAmountInput){
        actAmountInput.value = String(allInPlan.amount);
        selectedAmountActionType = allInPlan.type;
      } else {
        selectedAmountActionType = null;
      }
      handleActionClick(allInPlan.type, event);
    }

    if (joinBtn) joinBtn.addEventListener('click', handleJoinClick);
    if (leaveBtn) leaveBtn.addEventListener('click', handleLeaveClick);
    if (startHandBtn) startHandBtn.addEventListener('click', handleStartHandClick);
    if (dumpLogsBtn) dumpLogsBtn.addEventListener('click', handleDumpLogsClick);
    if (copyLogBtn) copyLogBtn.addEventListener('click', handleCopyLogClick);
    if (actCheckBtn) actCheckBtn.addEventListener('click', handleActCheckClick);
    if (actCallBtn) actCallBtn.addEventListener('click', handleActCallClick);
    if (actFoldBtn) actFoldBtn.addEventListener('click', handleActFoldClick);
    if (actAllInBtn) actAllInBtn.addEventListener('click', handleActAllInClick);
    if (actBetBtn) actBetBtn.addEventListener('click', handleActBetClick);
    if (actRaiseBtn) actRaiseBtn.addEventListener('click', handleActRaiseClick);
    if (actAmountInput) actAmountInput.addEventListener('keydown', handleActAmountKeyDown);
    if (jsonToggle){
      jsonToggle.addEventListener('click', function(){
        if (jsonBox) jsonBox.hidden = !jsonBox.hidden;
      });
    }
    if (signInBtn){
      signInBtn.addEventListener('click', openSignIn);
    }

    document.addEventListener('visibilitychange', handleVisibility); // xp-lifecycle-allow:poker-table(2026-01-01)
    window.addEventListener('pagehide', stopRealtime); // xp-lifecycle-allow:poker-table-pagehide(2026-01-01)
    window.addEventListener('pagehide', stopWsClient); // xp-lifecycle-allow:poker-table-pagehide-ws(2026-01-01)
    window.addEventListener('beforeunload', stopPolling); // xp-lifecycle-allow:poker-table(2026-01-01)
    window.addEventListener('beforeunload', clearDeadlineNudge); // xp-lifecycle-allow:poker-table-deadline-nudge(2026-01-01)
    window.addEventListener('beforeunload', stopRealtime); // xp-lifecycle-allow:poker-table-realtime(2026-01-01)
    window.addEventListener('beforeunload', stopWsClient); // xp-lifecycle-allow:poker-table-ws(2026-01-01)
    window.addEventListener('beforeunload', stopPendingAll); // xp-lifecycle-allow:poker-table-pending(2026-01-01)
    window.addEventListener('beforeunload', stopAuthWatch); // xp-lifecycle-allow:poker-table-auth(2026-01-01)

    setDevActionsEnabled(false);
    setDevActionsAuthStatus(false);

    checkAuth().then(function(authed){
      if (authed){
        bootstrapWsAfterBaseline('table_init');
      }
    });
  }

  // ========== INIT ==========
  function init(){
    var isTable = window.location.pathname.indexOf('/poker/table') !== -1;
    klog('poker_ui_loaded', { version: UI_VERSION, page: isTable ? 'table' : 'lobby' });
    if (isTable){
      initTable();
    } else {
      initLobby();
    }
  }

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
