(function(){
  if (typeof window === 'undefined') return;

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
  var SHOWDOWN_FLYOUT_EXIT_MS = 280;
  var POKER_DUMP_PATTERNS = [/\bpoker_[a-z0-9_]+\b/i, /\bpoker_rt_[a-z0-9_]+\b/i, /\bpoker_ws_[a-z0-9_]+\b/i, /\bws_[a-z0-9_]+\b/i, /\"\/.netlify\/functions\/poker-[^\"\s]+/i, /\/poker\//i];

  var state = { token: null };
  var showdownFlyoutHideTimer = null;
  var showdownFlyoutExitTimer = null;
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
    window.location.href = '/account.html';
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

  function isContestableOpponentSeat(seat, currentUserId){
    if (!seat || typeof seat.userId !== 'string' || !seat.userId) return false;
    if (seat.userId === currentUserId) return false;
    if (typeof seat.status === 'string' && /FOLD/i.test(seat.status)) return false;
    return true;
  }

  function resolveMaxContestableOpponentBehindAmount(data, currentUserId){
    if (!data || !currentUserId) return null;
    var seats = Array.isArray(data.seats) ? data.seats : [];
    var stateObj = data && data.state ? data.state : null;
    var gameState = stateObj && stateObj.state ? stateObj.state : null;
    var stacks = gameState && typeof gameState.stacks === 'object' && !Array.isArray(gameState.stacks) ? gameState.stacks : null;
    if (!stacks) return null;
    var max = null;
    seats.forEach(function(seat){
      if (!isContestableOpponentSeat(seat, currentUserId)) return;
      var raw = stacks[seat.userId];
      var amount = parseInt(raw, 10);
      if (!isFinite(amount)) return;
      amount = Math.trunc(amount);
      if (amount <= 0) return;
      max = max == null ? amount : Math.max(max, amount);
    });
    return max;
  }

  function resolveAllInPlan(allowedInfo, data, userId){
    var info = allowedInfo || {};
    var allowed = info.allowed;
    if (!allowed || typeof allowed.has !== 'function') return null;
    var stackAmount = resolveCurrentUserStackAmount(data, userId);
    if (stackAmount == null || stackAmount < 1) return null;
    var constraints = normalizeActionConstraints(info.constraints);
    var toCall = constraints.toCall != null ? Math.max(0, Math.trunc(constraints.toCall)) : null;
    var contestableOpponentBehind = resolveMaxContestableOpponentBehindAmount(data, userId);
    var cappedTotalContribution = contestableOpponentBehind == null
      ? stackAmount
      : Math.max(0, Math.min(stackAmount, (toCall || 0) + Math.trunc(contestableOpponentBehind)));
    if (allowed.has('CALL') && toCall != null && toCall > 0 && stackAmount <= toCall){
      return { type: 'CALL', amount: null };
    }
    if (allowed.has('RAISE')){
      var raiseTo = constraints.maxRaiseTo != null ? Math.trunc(constraints.maxRaiseTo) : null;
      if (raiseTo != null && raiseTo >= 1){
        var minRaiseTo = constraints.minRaiseTo != null ? Math.max(1, Math.trunc(constraints.minRaiseTo)) : 1;
        var currentUserBet = Math.max(0, raiseTo - stackAmount);
        var cappedRaiseTo = Math.min(raiseTo, Math.max(currentUserBet + cappedTotalContribution, minRaiseTo));
        if (toCall != null && toCall > 0 && cappedRaiseTo <= currentUserBet + toCall){
          return { type: 'CALL', amount: null };
        }
        return { type: 'RAISE', amount: cappedRaiseTo };
      }
    }
    if (allowed.has('BET')){
      var betAmount = constraints.maxBetAmount != null ? Math.trunc(constraints.maxBetAmount) : stackAmount;
      if (betAmount >= 1){
        return { type: 'BET', amount: Math.max(1, Math.min(betAmount, cappedTotalContribution || betAmount)) };
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

  function navigateToPokerLobby(){
    if (!window || !window.location) return;
    window.location.href = '/poker/';
  }

  function shouldShowTurnActions(params){
    var phaseValue = params && params.phase;
    var phase = typeof phaseValue === 'string' ? phaseValue.trim().toUpperCase() : '';
    var isActionPhase = phase === 'PREFLOP' || phase === 'FLOP' || phase === 'TURN' || phase === 'RIVER';
    if (!isActionPhase) return false;
    var legalActions = Array.isArray(params && params.legalActions) ? params.legalActions : [];
    for (var i = 0; i < legalActions.length; i++){
      if (typeof legalActions[i] === 'string' && legalActions[i].trim().toUpperCase() === 'FOLD') return true;
    }
    var turnUserId = params && typeof params.turnUserId === 'string' ? params.turnUserId.trim() : '';
    var currentUserId = params && typeof params.currentUserId === 'string' ? params.currentUserId.trim() : '';
    if (!turnUserId || !currentUserId || turnUserId !== currentUserId) return false;
    return legalActions.length > 0;
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

  function buildPokerTableUrl(tableId, options){
    var opts = options || {};
    var path = '/poker/table-v2.html';
    var query = [];
    if (tableId){
      query.push('tableId=' + encodeURIComponent(tableId));
    }
    if (opts.seatNo != null){
      query.push('seatNo=' + encodeURIComponent(opts.seatNo));
    }
    if (opts.autoJoin === true){
      query.push('autoJoin=1');
    }
    if (opts.autoStart === true){
      query.push('autoStart=1');
    }
    return path + (query.length ? ('?' + query.join('&')) : '');
  }

  function navigateToPokerTable(tableId, options){
    window.location.href = buildPokerTableUrl(tableId, options);
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
      resolveDevLogActionAvailability: resolveDevLogActionAvailability,
      buildPokerTableUrl: buildPokerTableUrl
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

  function formatWinnerHeadline(winners, playersById){
    var labels = Array.isArray(winners)
      ? winners.map(function(winner){ return resolveUserLabel(winner, playersById); }).filter(function(label){ return !!label; })
      : [];
    if (!labels.length) return t('pokerShowdownFlyoutTitle', 'Hand settled');
    if (labels.length === 1) return labels[0] + ' ' + t('pokerShowdownWinnerSingleSuffix', 'won');
    return t('pokerShowdownWinnerMultiPrefix', 'Winners') + ': ' + labels.join(', ');
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
    if (showdownFlyoutExitTimer){
      clearTimeout(showdownFlyoutExitTimer);
      showdownFlyoutExitTimer = null;
    }
    flyoutEl.classList.remove('poker-showdown-flyout--visible');
    flyoutEl.classList.add('poker-showdown-flyout--exiting');
    showdownFlyoutExitTimer = setTimeout(function(){
      flyoutEl.classList.remove('poker-showdown-flyout--exiting');
      flyoutEl.hidden = true;
      showdownFlyoutExitTimer = null;
    }, SHOWDOWN_FLYOUT_EXIT_MS);
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
      : formatWinnerHeadline(winners, playersById);
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
    if (showdownFlyoutExitTimer){
      clearTimeout(showdownFlyoutExitTimer);
      showdownFlyoutExitTimer = null;
    }
    flyoutEl.hidden = false;
    flyoutEl.classList.remove('poker-showdown-flyout--exiting');
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
      flyoutEl.classList.add('poker-showdown-flyout--exiting');
      klog('poker_showdown_flyout_hide', {
        tableId: tableIdValue || null,
        handId: handId || null
      });
      if (showdownFlyoutExitTimer){
        clearTimeout(showdownFlyoutExitTimer);
      }
      showdownFlyoutExitTimer = setTimeout(function(){
        flyoutEl.classList.remove('poker-showdown-flyout--exiting');
        flyoutEl.hidden = true;
        showdownFlyoutExitTimer = null;
      }, SHOWDOWN_FLYOUT_EXIT_MS);
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

  function isStaleSessionError(err){
    var code = err && (err.code || err.message) ? String(err.code || err.message) : '';
    return code === 'STALE_SESSION' || code === 'session_rebound';
  }

  function isRetryableLeaveError(err){
    var code = err && (err.code || err.message) ? String(err.code || err.message) : '';
    return code === 'STALE_SESSION' || code === 'session_rebound' || code === 'ws_closed' || code === 'timeout' || code === 'ws_unavailable';
  }

  function getGameplayWsSender(client, methodName, action, fallbackMessage){
    if (!client || typeof client.isReady !== 'function' || !client.isReady()) return null;
    if (typeof client[methodName] !== 'function') return null;
    return function(payload, requestId){
      return client[methodName](payload, requestId);
    };
  }

  function getGameplayWsQueuedSender(client, methodName){
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

    var LOBBY_RECONNECT_DELAYS_MS = [1000, 2000, 5000, 10000];
    var authTimer = null;
    var lobbyWsClient = null;
    var lobbyReconnectTimer = null;
    var lobbyReconnectAttempt = 0;
    var lobbyWsGeneration = 0;

    function stopAuthWatch(){
      if (authTimer){
        clearInterval(authTimer);
        authTimer = null;
      }
    }

    function clearLobbyReconnectTimer(){
      if (lobbyReconnectTimer){
        clearTimeout(lobbyReconnectTimer);
        lobbyReconnectTimer = null;
      }
    }

    function currentLobbyReconnectDelay(){
      var index = Math.min(lobbyReconnectAttempt, LOBBY_RECONNECT_DELAYS_MS.length - 1);
      return LOBBY_RECONNECT_DELAYS_MS[index];
    }

    function isLobbyPageVisible(){
      if (typeof document === 'undefined') return true;
      if (typeof document.visibilityState !== 'string') return true;
      return document.visibilityState === 'visible';
    }

    function isLobbyPageActive(){
      var pathname = window && window.location && typeof window.location.pathname === 'string' ? window.location.pathname : '';
      if (!pathname) return true;
      return pathname === '/poker/' || pathname === '/poker';
    }

    function canMaintainLobbyConnection(){
      return isLobbyPageActive() && isLobbyPageVisible();
    }

    function ensureLobbyLoadingVisible(){
      if (!tableList) return;
      if ((tableList.children && tableList.children.length > 0) || (typeof tableList.innerHTML === 'string' && tableList.innerHTML.trim())) {
        return;
      }
      setLobbyLoading();
    }

    function setLobbyConnectingState(message){
      setError(errorEl, message || null);
    }

    function stopLobbyWs(){
      clearLobbyReconnectTimer();
      lobbyReconnectAttempt = 0;
      var client = lobbyWsClient;
      lobbyWsClient = null;
      lobbyWsGeneration += 1;
      if (!client) return;
      try {
        client.destroy();
      } catch (_err){}
    }

    function requestLiveLobbySnapshot(reason){
      setError(errorEl, null);
      ensureLobbyLoadingVisible();
      if (lobbyWsClient && lobbyWsClient.isReady()) {
        if (lobbyWsClient.requestLobbySnapshot()) {
          klog('poker_lobby_ws_snapshot_request', { reason: reason || 'refresh' });
          return true;
        }
      }
      ensureLobbyWs({ reason: reason || 'refresh' });
      return false;
    }

    function scheduleLobbyReconnect(data){
      if (!canMaintainLobbyConnection()) return;
      clearLobbyReconnectTimer();
      var delayMs = currentLobbyReconnectDelay();
      var attempt = lobbyReconnectAttempt + 1;
      lobbyReconnectAttempt = attempt;
      setLobbyConnectingState(t('pokerLobbyReconnecting', 'Live connection lost. Reconnecting...'));
      klog('poker_lobby_ws_reconnect_scheduled', {
        attempt: attempt,
        delayMs: delayMs,
        code: data && data.code != null ? data.code : null
      });
      lobbyReconnectTimer = setTimeout(function(){
        lobbyReconnectTimer = null;
        checkAuth().then(function(authed){
          if (!authed || !canMaintainLobbyConnection()) return;
          requestLiveLobbySnapshot('reconnect');
        });
      }, delayMs);
    }

    function setLobbyLoading(){
      if (!tableList) return;
      tableList.innerHTML = '<div class="poker-loading">' + t('loading', 'Loading...') + '</div>';
    }

    function startAuthWatch(){
      if (authTimer) return;
      authTimer = setInterval(function(){
        checkAuth().then(function(authed){
          if (authed){
            stopAuthWatch();
            requestLiveLobbySnapshot('auth_watch');
          }
        });
      }, 3000);
    }

    function isLobbyAuthProtocolError(code){
      var normalized = typeof code === 'string' ? code.trim().toLowerCase() : '';
      return normalized === 'missing_access_token'
        || normalized === 'missing_token'
        || normalized === 'expired'
        || normalized === 'invalid_signature'
        || normalized === 'unsupported_alg'
        || normalized === 'missing_sub'
        || normalized === 'missing_jwt_secret'
        || normalized === 'unauthorized'
        || normalized === 'auth_failed';
    }

    async function checkAuth(){
      var token = await getAccessToken();
      if (!token){
        stopLobbyWs();
        if (authMsg) authMsg.hidden = false;
        if (lobbyContent) lobbyContent.hidden = true;
        if (tableList) tableList.innerHTML = '';
        startAuthWatch();
        return false;
      }
      if (authMsg) authMsg.hidden = true;
      if (lobbyContent) lobbyContent.hidden = false;
      stopAuthWatch();
      return true;
    }

    function ensureLobbyWs(options){
      var opts = options || {};
      if (lobbyWsClient) {
        return;
      }
      clearLobbyReconnectTimer();
      if (!window.PokerWsClient || typeof window.PokerWsClient.create !== 'function'){
        setError(errorEl, t('pokerErrLoadTables', 'Failed to load tables'));
        if (tableList) tableList.innerHTML = '';
        return;
      }
      var generation = lobbyWsGeneration + 1;
      var reason = typeof opts.reason === 'string' && opts.reason ? opts.reason : 'connect';
      lobbyWsGeneration = generation;
      setLobbyConnectingState(null);
      ensureLobbyLoadingVisible();
      lobbyWsClient = window.PokerWsClient.create({
        mode: 'lobby',
        getAccessToken: getAccessToken,
        onLobbySnapshot: function(snapshot){
          if (generation !== lobbyWsGeneration) return;
          lobbyReconnectAttempt = 0;
          setError(errorEl, null);
          renderTables(snapshot && snapshot.payload ? snapshot.payload.tables : []);
        },
        onStatus: function(status, data){
          if (generation !== lobbyWsGeneration) return;
          if (status === 'hello_ack' || status === 'minting_token' || status === 'authenticating'){
            setLobbyConnectingState(null);
            return;
          }
          if (status === 'auth_ok'){
            lobbyReconnectAttempt = 0;
            setLobbyConnectingState(null);
            klog('poker_lobby_ws_connected', { reason: reason });
            return;
          }
          if (status === 'closed'){
            klog('poker_lobby_ws_closed', { code: data && data.code != null ? data.code : null });
            lobbyWsClient = null;
            scheduleLobbyReconnect(data);
            return;
          }
          if (status === 'failed'){
            klog('poker_lobby_ws_failed', { stage: data && data.stage ? data.stage : null, code: data && data.code ? data.code : null });
          }
        },
        onProtocolError: function(info){
          if (generation !== lobbyWsGeneration) return;
          var code = info && info.code ? info.code : 'ws_error';
          if (isLobbyAuthProtocolError(code)){
            handleAuthExpired({
              authMsg: authMsg,
              content: lobbyContent,
              errorEl: errorEl,
              stopPolling: stopLobbyWs,
              onAuthExpired: startAuthWatch
            });
            if (tableList) tableList.innerHTML = '';
            return;
          }
          klog('poker_lobby_ws_error', { code: code, detail: info && info.detail ? info.detail : null });
          setError(errorEl, t('pokerErrLoadTables', 'Failed to load tables'));
          if (tableList) tableList.innerHTML = '';
        }
      });
      klog('poker_lobby_ws_connect_start', { reason: reason });
      lobbyWsClient.start();
    }

    function refreshLobby(reason){
      checkAuth().then(function(authed){
        if (!authed) return;
        requestLiveLobbySnapshot(reason || 'refresh');
      });
    }

    function handleLobbyVisibilityChange(){
      if (!isLobbyPageVisible()){
        clearLobbyReconnectTimer();
        return;
      }
      refreshLobby('visibility');
    }

    function renderTables(tables){
      if (!tableList) return;
      if (!tables || tables.length === 0){
        tableList.innerHTML = '<div class="poker-loading">' + t('noOpenTables', 'No open tables') + '</div>';
        return;
      }
      tableList.innerHTML = '';
      tables.forEach(function(tbl){
        var tableId = tbl && typeof tbl.tableId === 'string' ? tbl.tableId : tbl.id;
        var row = document.createElement('div');
        row.className = 'poker-table-row';
        var stakes = tbl.stakes;
        var maxPlayers = tbl.maxPlayers != null ? tbl.maxPlayers : 6;
        var seatCount = tbl.seatCount != null ? tbl.seatCount : 0;
        var tid = document.createElement('span');
        tid.className = 'tid';
        tid.textContent = shortId(tableId);
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
        openBtn.dataset.open = tableId;
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
          navigateToPokerTable(data.tableId, {
            seatNo: data.seatNo != null ? data.seatNo : null,
            autoJoin: true
          });
          return;
        }
        setError(errorEl, t('pokerErrNoTableId', 'Table created but no ID returned'));
      } catch (err){
        if (isAuthError(err)){
          handleAuthExpired({
            authMsg: authMsg,
            content: lobbyContent,
            errorEl: errorEl,
            stopPolling: stopLobbyWs,
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
          navigateToPokerTable(data.tableId);
        } else {
          setError(errorEl, t('pokerErrNoTableId', 'Table created but no ID returned'));
        }
      } catch (err){
        if (isAuthError(err)){
          handleAuthExpired({
            authMsg: authMsg,
            content: lobbyContent,
            errorEl: errorEl,
            stopPolling: stopLobbyWs,
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
        navigateToPokerTable(target.dataset.open);
      }
    }

    if (refreshBtn){
      refreshBtn.addEventListener('click', function(){
        refreshLobby('manual_refresh');
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
    window.addEventListener('beforeunload', stopLobbyWs); // xp-lifecycle-allow:poker-lobby-ws(2026-01-01)
    document.addEventListener('visibilitychange', handleLobbyVisibilityChange); // xp-lifecycle-allow:poker-lobby-visibility(2027-01-01)

    checkAuth().then(function(authed){
      if (authed) requestLiveLobbySnapshot('initial');
    });
  }

  // ========== INIT ==========
  function init(){
    klog('poker_ui_loaded', { version: UI_VERSION, page: 'lobby' });
    initLobby();
  }

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
