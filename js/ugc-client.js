(function(){
  // #1140 UGC phase B client (WWW and Android): Report / Block / Unblock against ugc-report and user-blocks.
  // A block is a filter on this device's screens only (avatar, reactions, gifts); poker state is never changed.
  // Every name is written with textContent. The UI stays hidden for guests and while the endpoints are off (404).
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  var REPORT_URL = '/.netlify/functions/ugc-report';
  var BLOCKS_URL = '/.netlify/functions/user-blocks';
  var REASONS = [
    ['inappropriate_avatar', 'ugcReasonInappropriateAvatar', 'Inappropriate avatar'],
    ['inappropriate_name', 'ugcReasonInappropriateName', 'Inappropriate name'],
    ['harassment', 'ugcReasonHarassment', 'Harassment or abuse'],
    ['cheating', 'ugcReasonCheating', 'Cheating or collusion'],
    ['spam', 'ugcReasonSpam', 'Spam'],
    ['other', 'ugcReasonOther', 'Other']
  ];
  // session counts sign-ins/outs and account switches; nothing started under an older session is applied or sent.
  var state = { userId: null, blocks: [], ids: {}, loaded: false, available: false, inFlight: null, listeners: [], tableKey: '', session: 0, dialogs: [] };

  function klog(kind, data){
    try { if (window.KLog && typeof window.KLog.log === 'function') window.KLog.log(kind, data || {}); } catch (_err){}
  }

  function t(key, fallback, name){
    var text = fallback;
    try { if (window.I18N && window.I18N.t) text = window.I18N.t(key) || fallback; } catch (_err){}
    return name == null ? text : String(text).split('{name}').join(String(name));
  }

  async function currentUserId(){
    var auth = window.SupabaseAuth;
    if (!auth || typeof auth.getCurrentUser !== 'function') return null;
    var user = await auth.getCurrentUser();
    return user && user.id ? String(user.id).toLowerCase() : null;
  }

  function failure(code, status){
    var error = new Error(code);
    error.code = code;
    error.status = status || 0;
    return error;
  }

  async function request(url, options){
    var bridge = window.SupabaseAuthBridge;
    var accessToken = bridge && typeof bridge.getAccessToken === 'function' ? await bridge.getAccessToken() : null;
    if (!accessToken) throw failure('not_authenticated', 401);
    var opts = options || {};
    var headers = { Authorization: 'Bearer ' + accessToken, Accept: 'application/json' };
    if (opts.body) headers['Content-Type'] = 'application/json';
    var response = await fetch(window.ArcadeApi ? window.ArcadeApi.url(url) : url, { method: opts.method || 'GET', body: opts.body, headers: headers, cache: 'no-store', credentials: 'omit' });
    var body = {};
    try { body = await response.json(); } catch (_err){}
    if (response.ok) return body;
    var code = body && body.error ? body.error : 'request_failed';
    if (response.status === 404 && code === 'not_found') setAvailable(false);
    throw failure(code, response.status);
  }

  function notify(){
    state.listeners.slice().forEach(function(listener){ try { listener(); } catch (_err){ klog('ugc:listener_failed', {}); } });
  }

  function setAvailable(value){
    if (state.available === value) return;
    state.available = value;
    notify();
  }

  function setBlocks(userId, list){
    state.userId = userId;
    state.blocks = Array.isArray(list) ? list : [];
    state.ids = {};
    state.blocks.forEach(function(entry){ if (entry && entry.userId) state.ids[String(entry.userId).toLowerCase()] = true; });
    state.loaded = !!userId;
    notify();
  }

  // Loads the caller's block list once per signed-in user; the answer also tells whether the feature is on.
  async function loadBlocks(force){
    var session = state.session;
    var userId = await currentUserId();
    if (session !== state.session) return [];
    if (!userId){ state.available = false; setBlocks(null, []); return []; }
    if (!force && state.loaded && state.userId === userId) return state.blocks;
    if (state.inFlight && state.inFlight.userId === userId && state.inFlight.session === session) return state.inFlight.promise;
    var promise = request(BLOCKS_URL).then(async function(body){
      // A sign-out or account switch during the request must not apply the previous user's list.
      if (session !== state.session || await currentUserId() !== userId) return [];
      state.available = true;
      setBlocks(userId, body && body.blocks);
      return state.blocks;
    }).catch(function(error){
      klog('ugc:blocks_load_failed', { code: error && error.code ? error.code : 'request_failed' });
      if (session !== state.session) return [];
      // Off (404) or unreachable: hide every control explicitly, not only through the markup's initial state.
      state.available = false;
      notify();
      return [];
    }).finally(function(){ if (state.inFlight && state.inFlight.promise === promise) state.inFlight = null; });
    state.inFlight = { userId: userId, session: session, promise: promise };
    return promise;
  }

  function isBlocked(userId){
    return !!(userId && state.ids[String(userId).toLowerCase()]);
  }

  function blockedByHandle(handle){
    var value = String(handle || '').toLowerCase();
    for (var i = 0; i < state.blocks.length; i++) if (state.blocks[i] && state.blocks[i].handle === value) return state.blocks[i];
    return null;
  }

  function targetFields(target){
    return target.userId ? { targetUserId: target.userId } : { targetHandle: target.handle };
  }

  async function report(target, reason){
    var body = targetFields(target);
    body.reason = reason;
    body.context = target.context === 'table' ? 'table' : 'profile';
    if (body.context === 'table') body.tableId = target.tableId;
    var result = await request(REPORT_URL, { method: 'POST', body: JSON.stringify(body) });
    klog('ugc:report_sent', { status: result && result.status, context: body.context });
    return result;
  }

  async function block(target){
    var result = await request(BLOCKS_URL, { method: 'POST', body: JSON.stringify(targetFields(target)) });
    await loadBlocks(true);
    return result;
  }

  async function unblock(userId){
    var result = await request(BLOCKS_URL + '?userId=' + encodeURIComponent(String(userId || '')), { method: 'DELETE' });
    await loadBlocks(true);
    return result;
  }

  function messageFor(error){
    var code = error && error.code;
    if (code === 'rate_limit_exceeded') return t('ugcRateLimited', 'Too many requests. Please try again later.');
    if (code === 'not_authenticated' || code === 'unauthorized') return t('ugcSignInRequired', 'Sign in to report or block players.');
    return t('ugcError', 'Something went wrong. Please try again.');
  }

  function element(tag, className, text){
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  // One shared modal: either the reason choice for a report or a plain confirmation for a block.
  function openDialog(options){
    return new Promise(function(resolve){
      var dialog = element('dialog', 'ugc-dialog');
      var form = element('form', 'ugc-dialog__form');
      form.method = 'dialog';
      form.appendChild(element('h2', 'ugc-dialog__title', options.title));
      form.appendChild(element('p', 'ugc-dialog__text', options.text));
      if (options.reasons){
        REASONS.forEach(function(reason, index){
          var label = element('label', 'ugc-dialog__reason');
          var input = element('input');
          input.type = 'radio'; input.name = 'ugcReason'; input.value = reason[0]; input.required = true;
          if (index === 0) input.checked = true;
          label.appendChild(input);
          label.appendChild(document.createTextNode(' ' + t(reason[1], reason[2])));
          form.appendChild(label);
        });
      }
      var actions = element('div', 'ugc-dialog__actions');
      var cancel = element('button', 'ugc-dialog__cancel', t('ugcCancel', 'Cancel'));
      cancel.type = 'button';
      var confirm = element('button', 'ugc-dialog__confirm', options.confirm);
      confirm.type = 'submit';
      actions.appendChild(cancel);
      actions.appendChild(confirm);
      form.appendChild(actions);
      dialog.appendChild(form);
      var done = false;
      function finish(value){
        if (done) return;
        done = true;
        state.dialogs = state.dialogs.filter(function(close){ return close !== finish; });
        try { if (dialog.open) dialog.close(); } catch (_err){}
        dialog.remove();
        resolve(value);
      }
      cancel.addEventListener('click', function(){ finish(null); });
      dialog.addEventListener('cancel', function(){ finish(null); });
      form.addEventListener('submit', function(event){
        event.preventDefault();
        var picked = form.querySelector('input[name="ugcReason"]:checked');
        finish(options.reasons ? (picked ? picked.value : null) : true);
      });
      state.dialogs.push(finish);
      document.body.appendChild(dialog);
      if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', '');
      confirm.focus();
    });
  }

  // Report and Block/Unblock buttons for one target ({displayName, handle | userId, context, tableId}).
  // The buttons belong to the account and session that rendered them; after a switch they do nothing.
  async function sameOwner(owner, session){
    return session === state.session && !!owner && await currentUserId() === owner;
  }

  function renderActions(container, target){
    var owner = state.userId;
    var session = state.session;
    container.textContent = '';
    var status = element('p', 'ugc-actions__status');
    status.setAttribute('aria-live', 'polite');
    var reportButton = element('button', 'ugc-actions__report', t('ugcReport', 'Report'));
    reportButton.type = 'button';
    var blocked = target.userId ? (isBlocked(target.userId) ? { userId: target.userId } : null) : blockedByHandle(target.handle);
    var blockButton = element('button', 'ugc-actions__block', blocked ? t('ugcUnblock', 'Unblock') : t('ugcBlock', 'Block'));
    blockButton.type = 'button';
    function busy(value){ reportButton.disabled = value; blockButton.disabled = value; }
    reportButton.addEventListener('click', async function(){
      var reason = await openDialog({ title: t('ugcReportTitle', 'Report player'), text: t('ugcReportIntro', 'Why are you reporting {name}? A moderator reviews every report. The player is not told who reported them.', target.displayName), confirm: t('ugcReportSend', 'Send report'), reasons: true });
      if (!reason || !await sameOwner(owner, session)) return;
      busy(true);
      try {
        var result = await report(target, reason);
        status.textContent = result && result.status === 'already_reported' ? t('ugcReportAlready', 'You have already reported this player. A moderator will review it.') : t('ugcReportSent', 'Thank you. Your report has been sent.');
      } catch (error){ status.textContent = messageFor(error); }
      busy(false);
    });
    blockButton.addEventListener('click', async function(){
      busy(true);
      try {
        if (!await sameOwner(owner, session)){ busy(false); return; }
        if (blocked){
          await unblock(blocked.userId);
          status.textContent = t('ugcUnblocked', 'Player unblocked.');
        } else {
          var ok = await openDialog({ title: t('ugcBlock', 'Block'), text: t('ugcBlockConfirm', 'Block {name}? You will no longer see their avatar, reactions or gifts. The game itself is not affected.', target.displayName), confirm: t('ugcBlock', 'Block') });
          if (ok && await sameOwner(owner, session)){
            await block(target);
            status.textContent = t('ugcBlocked', 'Player blocked. You will no longer see their avatar, reactions or gifts.');
          }
        }
      } catch (error){ status.textContent = messageFor(error); }
      busy(false);
      var message = status.textContent;
      renderActions(container, target);
      container.querySelector('.ugc-actions__status').textContent = message;
    });
    container.appendChild(reportButton);
    container.appendChild(blockButton);
    container.appendChild(status);
  }

  // Public profile page (profile.html): actions for another player's profile.
  var profileGeneration = 0;
  var lastProfile = null;
  async function profileRendered(profile){
    var container = document.getElementById('publicProfileSafety');
    if (!container) return;
    lastProfile = profile || null;
    var generation = ++profileGeneration;
    container.hidden = true;
    if (!profile || !profile.handle) return;
    await loadBlocks(false);
    var own = null;
    try { own = window.ProfileClient && await window.ProfileClient.getMe(false); } catch (_err){}
    // A newer profile render (navigation, sign-out) supersedes this one.
    if (generation !== profileGeneration || !state.available || (own && own.handle === profile.handle)) return;
    renderActions(container, { handle: profile.handle, displayName: profile.displayName || profile.handle, context: 'profile' });
    container.hidden = false;
  }

  // Poker table: one row per human opponent in the table settings panel.
  function tablePlayers(tableId, players){
    var container = document.getElementById('pokerSafetyPlayers');
    if (!container) return;
    var list = (Array.isArray(players) ? players : []).filter(function(player){ return player && player.userId && !player.isBot; });
    var key = JSON.stringify([state.available, state.loaded, tableId, list.map(function(player){ return [player.userId, player.displayName, isBlocked(player.userId)]; })]);
    if (key === state.tableKey) return;
    state.tableKey = key;
    container.textContent = '';
    container.hidden = !state.available || !tableId || !list.length;
    if (container.hidden) return;
    container.appendChild(element('h3', 'ugc-table__title', t('ugcTablePlayersTitle', 'Players at this table')));
    list.forEach(function(player){
      var row = element('div', 'ugc-table__player');
      row.appendChild(element('span', 'ugc-table__name', player.displayName));
      var actions = element('div', 'ugc-actions');
      renderActions(actions, { userId: player.userId, displayName: player.displayName, context: 'table', tableId: tableId });
      row.appendChild(actions);
      container.appendChild(row);
    });
  }

  // Account page (account.html): the caller's blocked players with Unblock.
  function renderBlockedList(){
    var container = document.getElementById('ugcBlockedList');
    if (!container) return;
    var section = container.closest('[data-ugc-section]') || container;
    section.hidden = !state.available || !state.loaded;
    container.textContent = '';
    if (section.hidden) return;
    if (!state.blocks.length){ container.appendChild(element('p', 'ugc-blocked__empty', t('ugcBlockedListEmpty', 'You have not blocked anyone.'))); return; }
    state.blocks.forEach(function(entry){
      var row = element('div', 'ugc-blocked__row');
      var name = entry.displayName || entry.handle || '';
      row.appendChild(element('span', 'ugc-blocked__name', name));
      var button = element('button', 'ugc-actions__block', t('ugcUnblock', 'Unblock'));
      button.type = 'button';
      var owner = state.userId;
      var session = state.session;
      button.addEventListener('click', async function(){
        if (!await sameOwner(owner, session)) return;
        button.disabled = true;
        try { await unblock(entry.userId); } catch (error){ button.disabled = false; button.title = messageFor(error); }
      });
      row.appendChild(button);
      container.appendChild(row);
    });
  }

  function onChange(listener){ if (typeof listener === 'function') state.listeners.push(listener); }

  // On every sign-in, sign-out or account switch: forget the previous user's list, close its dialogs, reload.
  function resetSession(){
    state.session += 1;
    state.inFlight = null;
    state.available = false;
    state.tableKey = '';
    state.dialogs.slice().forEach(function(close){ close(null); });
    setBlocks(null, []);
    loadBlocks(true);
  }

  // Profile controls follow availability: hidden while off, rendered again for the current profile when on.
  function syncProfileControls(){
    var container = document.getElementById('publicProfileSafety');
    if (!container) return;
    if (!state.available || !state.loaded){ container.hidden = true; return; }
    if (lastProfile && container.hidden) profileRendered(lastProfile);
  }

  function boot(){
    onChange(renderBlockedList);
    onChange(syncProfileControls);
    if (window.SupabaseAuth && typeof window.SupabaseAuth.onAuthChange === 'function') window.SupabaseAuth.onAuthChange(resetSession);
    loadBlocks(false);
  }

  window.ArcadeUgc = { loadBlocks: loadBlocks, isBlocked: isBlocked, report: report, block: block, unblock: unblock, onChange: onChange, profileRendered: profileRendered, tablePlayers: tablePlayers, REASONS: REASONS.map(function(reason){ return reason[0]; }) };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true }); else boot();
})();
