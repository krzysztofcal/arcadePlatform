(function(global){
  'use strict';

  const STORAGE_KEY = 'portal.points.v1';
  const DEFAULTS = {
    tickSeconds: 15,
    showToasts: true,
    endpoint: '/.netlify/functions/xp-session'
  };

  function now(){ return Date.now ? Date.now() : new Date().getTime(); }

  function generateId(){
    if (typeof crypto !== 'undefined' && crypto.randomUUID){
      try { return crypto.randomUUID(); } catch (_){ /* noop */ }
    }
    const template = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx';
    return template.replace(/[xy]/g, function(c){
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  function safeParse(json){
    if (!json) return null;
    try { return JSON.parse(json); } catch (_){ return null; }
  }

  class PointsApiAdapter{
    constructor(options){
      const opts = options || {};
      this.storageKey = opts.storageKey || STORAGE_KEY;
      const globalEndpoint = (typeof global !== 'undefined' && global.NETLIFY_XP_ENDPOINT)
        || (typeof window !== 'undefined' && window.NETLIFY_XP_ENDPOINT)
        || null;
      this.endpoint = opts.endpoint || globalEndpoint || DEFAULTS.endpoint;
      this.fetchImpl = opts.fetch || null;
    }

    loadState(){
      if (typeof global.localStorage === 'undefined') return null;
      try {
        const raw = global.localStorage.getItem(this.storageKey);
        return safeParse(raw);
      } catch (_){
        return null;
      }
    }

    saveState(state){
      if (typeof global.localStorage === 'undefined') return Promise.resolve(false);
      try {
        global.localStorage.setItem(this.storageKey, JSON.stringify(state));
        return Promise.resolve(true);
      } catch (_){
        return Promise.resolve(false);
      }
    }

    syncToServer(payload){
      if (!payload || typeof payload !== 'object'){
        return Promise.resolve(null);
      }
      const target = this.endpoint || DEFAULTS.endpoint;
      if (!target){
        return Promise.resolve(null);
      }

      const fetchFn = this.fetchImpl
        || (typeof global.fetch === 'function' ? global.fetch.bind(global)
          : (typeof window !== 'undefined' && typeof window.fetch === 'function' ? window.fetch.bind(window) : null));

      if (!fetchFn){
        if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function'){
          try {
            const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
            navigator.sendBeacon(target, blob);
          } catch (_){ /* noop */ }
        }
        return Promise.resolve(null);
      }

      const requestInit = {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        credentials: 'include'
      };

      return fetchFn(target, requestInit)
        .then((response) => {
          if (!response) return null;
          if (typeof response.json === 'function'){
            return response.json().catch(() => null);
          }
          return null;
        })
        .catch(() => null);
    }
  }

  function personalBestBonus(oldScore, newScore){
    if (!Number.isFinite(newScore) || !Number.isFinite(oldScore)){
      if (!Number.isFinite(newScore)) return 0;
      oldScore = 0;
    }
    if (newScore <= oldScore) return 0;
    return Math.max(0, Math.min(100, newScore - oldScore));
  }


  class PointsService{
    constructor(options){
      const opts = Object.assign({}, DEFAULTS, options || {});
      this.options = opts;
      this.storageKey = opts.storageKey || STORAGE_KEY;
      this.adapter = opts.adapter || new PointsApiAdapter({
        storageKey: this.storageKey,
        endpoint: opts.endpoint || DEFAULTS.endpoint,
        fetch: opts.fetch
      });
      this.state = this._loadState();
      this.currentSession = null;
      this.listeners = { update: new Set(), levelup: new Set(), award: new Set() };
      this._boundStorageListener = null;
      this._syncQueue = Promise.resolve();

      this._emitUpdate();
      this._bindStorageListener();

      try {
        const pending = this.refreshFromServer();
        if (pending && typeof pending.catch === 'function'){
          pending.catch(() => {});
        }
      } catch (_){ /* noop */ }
    }

    on(event, handler){
      if (!event || typeof handler !== 'function') return () => {};
      const bucket = this.listeners[event];
      if (!bucket) return () => {};
      bucket.add(handler);
      return () => this.off(event, handler);
    }

    off(event, handler){
      const bucket = this.listeners[event];
      if (!bucket || !bucket.has(handler)) return;
      bucket.delete(handler);
    }

    getSnapshot(){
      const totalXp = Number.isFinite(this.state.totalXp) ? this.state.totalXp : 0;
      const level = Number.isFinite(this.state.level) && this.state.level > 0
        ? this.state.level
        : this._computeLevel(totalXp);
      const currentLevelFloor = Math.max(0, (level - 1));
      const currentLevelXp = 100 * currentLevelFloor * currentLevelFloor;
      const nextLevelXp = 100 * level * level;
      const xpIntoLevel = Math.max(0, totalXp - currentLevelXp);
      const xpToNext = Math.max(0, nextLevelXp - totalXp);
      const progress = nextLevelXp === currentLevelXp
        ? 1
        : Math.min(1, xpIntoLevel / (nextLevelXp - currentLevelXp));
      return {
        userId: this.state.userId,
        totalXp,
        xpToday: Number.isFinite(this.state.xpToday) ? this.state.xpToday : 0,
        level,
        nextLevelXp,
        xpToNext,
        xpIntoLevel,
        progress,
        streak: Object.assign({ count: 0, lastKey: null }, this.state.streak || {})
      };
    }

    getBadgeLabel(){
      const snap = this.getSnapshot();
      return 'Lv ' + snap.level + ' • ' + snap.totalXp + ' XP';
    }

    startSession(slug){
      const startedAt = new Date().toISOString();
      this.currentSession = {
        slug: slug || null,
        startedAt
      };
      if (slug){
        if (!this.state.games || typeof this.state.games !== 'object'){
          this.state.games = {};
        }
        const info = Object.assign({}, this.state.games[slug] || {});
        info.lastPlayedAt = startedAt;
        this.state.games[slug] = info;
      }
      this._persist();
      this._emitUpdate();
      this._queueSync('session_start', { slug: slug || null, startedAt }, { reason: 'session_start', silent: true });
    }

    tick(multiplier){
      const ticks = Number.isFinite(multiplier) && multiplier > 0 ? Math.floor(multiplier) : 1;
      if (!ticks) return;
      const payload = {
        ticks,
        slug: this.currentSession && this.currentSession.slug ? this.currentSession.slug : null,
        startedAt: this.currentSession && this.currentSession.startedAt ? this.currentSession.startedAt : null,
        timestamp: new Date().toISOString()
      };
      this._queueSync('activity', payload, { reason: 'activity' });
    }

    endSession(){
      const session = this.currentSession;
      this.currentSession = null;
      this._persist();
      if (!session) return;
      this._queueSync('session_end', {
        slug: session.slug || null,
        startedAt: session.startedAt || null,
        endedAt: new Date().toISOString()
      }, { reason: 'session_end', silent: true });
    }

    awardBonus(amount, metadata){
      const value = Number(amount);
      if (!Number.isFinite(value) || value <= 0){
        return Promise.resolve(0);
      }
      const payload = {
        amount: value,
        metadata: metadata || null
      };
      return this._queueSync('bonus', payload, { reason: 'bonus' })
        .then(result => this._extractAwardAmount(result))
        .catch(() => 0);
    }

    awardPersonalBest(slug, details){
      if (!slug) return Promise.resolve(0);
      const info = Object.assign({}, details || {});
      const rawScore = Number(info.score);
      if (!Number.isFinite(rawScore) || rawScore <= 0){
        return Promise.resolve(0);
      }
      const previousBest = Number(info.previousBest);
      const baseline = Number.isFinite(previousBest) ? previousBest : null;

      if (!this.state.games || typeof this.state.games !== 'object'){
        this.state.games = {};
      }
      const record = Object.assign({}, this.state.games[slug] || {});
      record.bestScore = Math.max(Number(record.bestScore) || 0, rawScore);
      this.state.games[slug] = record;

      if (!this.state.bestByGame || typeof this.state.bestByGame !== 'object'){
        this.state.bestByGame = {};
      }
      const storedBest = Number(this.state.bestByGame[slug]);
      if (!Number.isFinite(storedBest) || rawScore > storedBest){
        this.state.bestByGame[slug] = rawScore;
      }
      this._persist();

      let suggested = Number(info.amount);
      if (!Number.isFinite(suggested) || suggested <= 0){
        suggested = personalBestBonus(baseline || 0, rawScore);
      }

      const payload = {
        slug,
        score: rawScore,
        previousBest: baseline,
        suggestedAward: Number.isFinite(suggested) ? suggested : null
      };
      return this._queueSync('personal_best', payload, { reason: 'personal_best' })
        .then(result => this._extractAwardAmount(result))
        .catch(() => 0);
    }

    recordScore(gameId, score){
      if (!Number.isFinite(score)) return;
      const slug = String(gameId || 'game');
      if (!this.state.bestByGame || typeof this.state.bestByGame !== 'object'){
        this.state.bestByGame = {};
      }
      const currentBest = Number(this.state.bestByGame[slug]);
      if (!Number.isFinite(currentBest) || score > currentBest){
        this.state.bestByGame[slug] = score;
        this._persist();
      }
      this._queueSync('score', { slug, score }, { reason: 'score', silent: true });
    }

    refreshFromServer(){
      return this._queueSync('sync', {}, { reason: 'sync', allowEmpty: true });
    }

    _createEmptyState(){
      return {
        version: 2,
        userId: generateId(),
        totalXp: 0,
        xpToday: 0,
        level: 1,
        lastDayKey: null,
        lastLoginBonusKey: null,
        streak: { count: 0, lastKey: null },
        games: {},
        bestByGame: {},
        updatedAt: null
      };
    }

    _normalizeState(stored){
      const empty = this._createEmptyState();
      if (!stored || typeof stored !== 'object') return empty;
      const merged = Object.assign({}, empty, stored);
      if (!merged.userId) merged.userId = generateId();
      if (!merged.streak || typeof merged.streak !== 'object'){
        merged.streak = { count: 0, lastKey: null };
      } else {
        const count = Number(merged.streak.count);
        merged.streak = {
          count: Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0,
          lastKey: typeof merged.streak.lastKey === 'string' ? merged.streak.lastKey : null
        };
      }
      merged.totalXp = Number.isFinite(Number(merged.totalXp)) ? Number(merged.totalXp) : 0;
      merged.xpToday = Number.isFinite(Number(merged.xpToday)) ? Number(merged.xpToday) : 0;
      merged.level = Number.isFinite(Number(merged.level)) && Number(merged.level) > 0
        ? Number(merged.level)
        : this._computeLevel(merged.totalXp || 0);
      if (!merged.games || typeof merged.games !== 'object') merged.games = {};
      if (!merged.bestByGame || typeof merged.bestByGame !== 'object') merged.bestByGame = {};
      merged.version = 2;
      return merged;
    }

    _loadState(){
      const stored = this.adapter && typeof this.adapter.loadState === 'function'
        ? this.adapter.loadState()
        : null;
      return this._normalizeState(stored);
    }

    _queueSync(eventType, payload, meta){
      const request = this._buildRequest(eventType, payload);
      if (!request){
        return Promise.resolve(null);
      }
      const task = () => this._sendRequest(request, meta || {});
      this._syncQueue = this._syncQueue.then(task, task);
      return this._syncQueue;
    }

    _buildRequest(eventType, payload){
      const type = eventType || 'activity';
      return {
        version: 1,
        event: type,
        type,
        userId: this.state.userId,
        timestamp: new Date().toISOString(),
        payload: payload || {},
        snapshot: this._buildClientSnapshot()
      };
    }

    _buildClientSnapshot(){
      const snap = this.getSnapshot();
      return {
        totalXp: snap.totalXp,
        xpToday: snap.xpToday,
        level: snap.level,
        streak: snap.streak,
        updatedAt: this.state.updatedAt || null
      };
    }

    _sendRequest(request, meta){
      if (!this.adapter || typeof this.adapter.syncToServer !== 'function'){
        return Promise.resolve(null);
      }
      return Promise.resolve(this.adapter.syncToServer(request))
        .then((response) => this._applyServerResponse(response, meta || {}))
        .catch(() => null);
    }

    _extractSnapshot(response){
      if (!response || typeof response !== 'object') return null;
      const pick = (candidate) => (candidate && typeof candidate === 'object') ? candidate : null;
      const direct = pick(response.snapshot)
        || pick(response.state)
        || pick(response.data)
        || pick(response.result);
      if (direct) return direct;
      if ('totalXp' in response || 'level' in response || 'xpToday' in response || 'streak' in response || 'games' in response || 'bestByGame' in response){
        return response;
      }
      return null;
    }

    _applyServerResponse(response, meta){
      if (response && typeof response === 'object'){
        const serverUserId = response.userId || (response.user && response.user.userId) || (response.user && response.user.id);
        if (serverUserId && typeof serverUserId === 'string' && serverUserId !== this.state.userId){
          this.state.userId = serverUserId;
        }
      }
      const prevSnapshot = this.getSnapshot();
      const snapshot = this._extractSnapshot(response);
      let changed = false;
      if (snapshot){
        changed = this._applySnapshot(snapshot) || changed;
      }
      if (changed){
        this._persist();
        this._emitUpdate();
      } else if (snapshot){
        this._persist();
        this._emitUpdate();
      }
      const nextSnapshot = this.getSnapshot();
      const xpDelta = (nextSnapshot.totalXp || 0) - (prevSnapshot.totalXp || 0);
      const awards = this._extractAwards(response, meta || {}, xpDelta, nextSnapshot);
      awards.forEach(detail => { if (detail) this._emit('award', detail); });
      if (nextSnapshot.level > prevSnapshot.level){
        this._handleLevelUp(nextSnapshot.level, xpDelta);
      }
      return { response, snapshot: nextSnapshot, xpDelta };
    }

    _applySnapshot(snapshot){
      if (!snapshot || typeof snapshot !== 'object') return false;
      let changed = false;

      if (snapshot.userId && typeof snapshot.userId === 'string' && snapshot.userId !== this.state.userId){
        this.state.userId = snapshot.userId;
        changed = true;
      }

      if ('totalXp' in snapshot){
        const value = Number(snapshot.totalXp);
        const normalized = Number.isFinite(value) ? value : 0;
        if (normalized !== this.state.totalXp){
          this.state.totalXp = normalized;
          changed = true;
        }
      }

      if ('xpToday' in snapshot){
        const value = Number(snapshot.xpToday);
        const normalized = Number.isFinite(value) ? value : 0;
        if (normalized !== this.state.xpToday){
          this.state.xpToday = normalized;
          changed = true;
        }
      }

      if ('level' in snapshot){
        const value = Number(snapshot.level);
        if (Number.isFinite(value) && value > 0 && value !== this.state.level){
          this.state.level = value;
          changed = true;
        }
      }

      if ('streak' in snapshot && snapshot.streak && typeof snapshot.streak === 'object'){
        const current = this.state.streak || { count: 0, lastKey: null };
        const count = Number(snapshot.streak.count);
        const normalizedCount = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
        const lastKey = typeof snapshot.streak.lastKey === 'string' ? snapshot.streak.lastKey : (current.lastKey || null);
        if (current.count !== normalizedCount || current.lastKey !== lastKey){
          this.state.streak = { count: normalizedCount, lastKey };
          changed = true;
        }
      }

      if ('lastDayKey' in snapshot){
        const nextKey = typeof snapshot.lastDayKey === 'string' ? snapshot.lastDayKey : null;
        if (nextKey !== this.state.lastDayKey){
          this.state.lastDayKey = nextKey;
          changed = true;
        }
      }

      if ('updatedAt' in snapshot && snapshot.updatedAt !== this.state.updatedAt){
        this.state.updatedAt = snapshot.updatedAt;
        changed = true;
      }

      if ('games' in snapshot && snapshot.games && typeof snapshot.games === 'object'){
        if (!this.state.games || typeof this.state.games !== 'object'){
          this.state.games = {};
        }
        let mutated = false;
        const nextGames = Object.assign({}, this.state.games);
        Object.keys(snapshot.games).forEach((key) => {
          const value = snapshot.games[key];
          if (nextGames[key] !== value){
            nextGames[key] = value;
            mutated = true;
          }
        });
        if (mutated){
          this.state.games = nextGames;
          changed = true;
        }
      }

      if ('bestByGame' in snapshot && snapshot.bestByGame && typeof snapshot.bestByGame === 'object'){
        if (!this.state.bestByGame || typeof this.state.bestByGame !== 'object'){
          this.state.bestByGame = {};
        }
        let mutated = false;
        const nextBest = Object.assign({}, this.state.bestByGame);
        Object.keys(snapshot.bestByGame).forEach((key) => {
          const value = snapshot.bestByGame[key];
          if (nextBest[key] !== value){
            nextBest[key] = value;
            mutated = true;
          }
        });
        if (mutated){
          this.state.bestByGame = nextBest;
          changed = true;
        }
      }

      const computedLevel = this._computeLevel(this.state.totalXp || 0);
      if (computedLevel !== this.state.level){
        this.state.level = computedLevel;
        changed = true;
      }

      return changed;
    }

    _normalizeAwardDetail(detail, snapshot, fallbackReason){
      if (!detail || typeof detail !== 'object') return null;
      const amount = Number(detail.amount);
      if (!Number.isFinite(amount) || amount <= 0) return null;
      const snap = snapshot || this.getSnapshot();
      return {
        amount,
        reason: detail.reason || fallbackReason || 'server_update',
        metadata: detail.metadata || null,
        totalXp: snap.totalXp,
        level: snap.level,
        xpToday: snap.xpToday
      };
    }

    _extractAwards(response, meta, xpDelta, snapshot){
      const awards = [];
      const push = (detail) => {
        const normalized = this._normalizeAwardDetail(detail, snapshot, meta && meta.reason);
        if (normalized) awards.push(normalized);
      };
      if (response && typeof response === 'object'){
        if (Array.isArray(response.awards)){
          response.awards.forEach(push);
        }
        if (response.award && typeof response.award === 'object'){
          push(response.award);
        }
        if (response.detail && typeof response.detail === 'object'){
          push(response.detail);
        }
      }
      if (!awards.length && xpDelta > 0){
        push({ amount: xpDelta, reason: meta && meta.reason ? meta.reason : 'server_update' });
      }
      return awards;
    }

    _extractAwardAmount(result){
      if (!result) return 0;
      if (result && typeof result === 'object' && result.response && result !== result.response){
        const nested = this._extractAwardAmount(result.response);
        if (nested > 0) return nested;
      }
      const amounts = [];
      const collect = (candidate) => {
        if (!candidate || typeof candidate !== 'object') return;
        const amount = Number(candidate.amount);
        if (Number.isFinite(amount) && amount > 0){
          amounts.push(amount);
        }
      };
      if (result && typeof result === 'object'){
        if (Array.isArray(result.awards)){
          result.awards.forEach(collect);
        }
        if (result.award && typeof result.award === 'object'){
          collect(result.award);
        }
        if (result.detail && typeof result.detail === 'object'){
          collect(result.detail);
        }
      }
      const directAmount = Number(result && result.amount);
      if (Number.isFinite(directAmount) && directAmount > 0){
        amounts.push(directAmount);
      }
      const delta = Number(result && result.xpDelta);
      if (Number.isFinite(delta) && delta > 0){
        amounts.push(delta);
      }
      return amounts.length ? amounts.reduce((sum, value) => sum + value, 0) : 0;
    }

    _emit(event, detail){
      const bucket = this.listeners[event];
      if (!bucket) return;
      bucket.forEach(handler => {
        try { handler(detail); } catch (_){ /* noop */ }
      });
    }

    _emitUpdate(){
      this._emit('update', this.getSnapshot());
    }

    _persist(){
      if (!this.adapter || typeof this.adapter.saveState !== 'function') return;
      try {
        const result = this.adapter.saveState(this.state);
        if (result && typeof result.then === 'function'){
          result.catch(() => {});
        }
      } catch (_){ /* ignore */ }
    }

    _computeLevel(totalXp){
      const xp = totalXp < 0 ? 0 : totalXp;
      return Math.floor(Math.sqrt(xp / 100)) + 1;
    }

    _handleLevelUp(level, gained){
      const detail = {
        level,
        totalXp: this.state.totalXp,
        gainedXp: gained
      };
      this._emit('levelup', detail);
      if (this.options.showToasts !== false){
        this._showLevelToast(detail);
      }
    }

    reloadFromStorage(){
      const stored = this.adapter && typeof this.adapter.loadState === 'function'
        ? this.adapter.loadState()
        : null;
      if (!stored) return false;
      const normalized = this._normalizeState(stored);
      const prev = this.getSnapshot();
      this.state = normalized;
      this._emitUpdate();
      const snap = this.getSnapshot();
      return snap.totalXp !== prev.totalXp || snap.xpToday !== prev.xpToday || snap.level !== prev.level;
    }

    _bindStorageListener(){
      const win = typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null);
      if (!win || typeof win.addEventListener !== 'function' || typeof win.removeEventListener !== 'function'){
        return;
      }
      if (this._boundStorageListener){
        try { win.removeEventListener('storage', this._boundStorageListener); } catch (_){ /* noop */ }
      }
      this._boundStorageListener = (event) => {
        if (!event) return;
        if (event.key && event.key !== this.storageKey) return;
        if (event.storageArea && typeof global.localStorage !== 'undefined' && event.storageArea !== global.localStorage) return;
        this.reloadFromStorage();
      };
      try {
        win.addEventListener('storage', this._boundStorageListener);
      } catch (_){ /* noop */ }
    }

    _showLevelToast(detail){
      if (typeof document === 'undefined') return;
      const doc = document;
      let container = doc.querySelector('.xp-toast-container');
      if (!container){
        container = doc.createElement('div');
        container.className = 'xp-toast-container';
        doc.body.appendChild(container);
      }
      const toast = doc.createElement('div');
      toast.className = 'xp-toast';
      const strong = doc.createElement('strong');
      strong.textContent = 'Level up!';
      const span = doc.createElement('span');
      span.textContent = 'You reached level ' + detail.level + '!';
      toast.appendChild(strong);
      toast.appendChild(span);
      container.appendChild(toast);
      setTimeout(() => toast.classList.add('is-visible'));
      setTimeout(() => toast.classList.add('is-hiding'), 3400);
      setTimeout(() => {
        toast.remove();
        if (!container.childElementCount){
          container.remove();
        }
      }, 4200);
    }
  }
  function createActivityTracker(targetDocument, onTick, options){
    const doc = targetDocument || (typeof document !== 'undefined' ? document : null);
    if (!doc || typeof onTick !== 'function'){
      return { stop() {}, nudge() {}, setPaused() {} };
    }

    const DEFAULTS = { tickSeconds: 10, idleTimeout: 30000, sampleMs: 1000, messageType: 'kcswh:activity' };
    const opts = Object.assign({}, DEFAULTS, options || {});

    const win = doc.defaultView || (typeof window !== 'undefined' ? window : null);
    const defaultOrigin = win && win.location && win.location.origin ? [win.location.origin] : null;
    const allowedOrigins = Array.isArray(opts.allowedOrigins) && opts.allowedOrigins.length
      ? opts.allowedOrigins.filter(Boolean)
      : defaultOrigin;
    const legacyTypes = Array.isArray(opts.legacyMessageTypes)
      ? opts.legacyMessageTypes.filter(Boolean)
      : ['game-active', 'gameActivity'];

    let destroyed = false;
    let paused = false;
    let lastActivity = now();
    let accumSeconds = 0;

    const markActive = () => { lastActivity = now(); };

    const sampleEvents = [
      'pointerdown','pointermove','pointerup',
      'touchstart','touchmove',
      'keydown'
    ];

    sampleEvents.forEach(evt => {
      try { doc.addEventListener(evt, markActive, { passive: true }); }
      catch (_){ doc.addEventListener(evt, markActive); }
    });

    const onVisibility = () => { paused = !!doc.hidden; };
    doc.addEventListener('visibilitychange', onVisibility, { passive: true });

    const msgHandler = (e) => {
      if (!e) return;
      if (allowedOrigins && allowedOrigins.length && !(allowedOrigins.includes('*') || allowedOrigins.includes(e.origin))) return;
      const data = e.data;
      if (!data || typeof data !== 'object') return;
      const type = data.type;
      if (type === opts.messageType || type === 'kcswh/activity' || (legacyTypes && legacyTypes.indexOf(type) !== -1)){
        markActive();
      }
    };
    if (win && typeof win.addEventListener === 'function'){
      try { win.addEventListener('message', msgHandler, { passive: true }); }
      catch (_){ win.addEventListener('message', msgHandler); }
    }

    const tickTimer = setInterval(() => {
      if (destroyed || paused) return;

      const idleFor = now() - lastActivity;
      if (idleFor > opts.idleTimeout){
        accumSeconds = 0;
        return;
      }

      accumSeconds += opts.sampleMs / 1000;
      if (accumSeconds >= opts.tickSeconds){
        accumSeconds = 0;
        try { onTick(opts.tickSeconds); } catch (_){ }
      }
    }, opts.sampleMs);

    const tracker = {
      nudge(){ markActive(); },
      setPaused(p){ paused = !!p; },
      ping(){ markActive(); },
      stop(){
        if (destroyed) return;
        destroyed = true;
        clearInterval(tickTimer);
        doc.removeEventListener('visibilitychange', onVisibility);
        sampleEvents.forEach(evt => doc.removeEventListener(evt, markActive));
        if (win && typeof win.removeEventListener === 'function'){
          try { win.removeEventListener('message', msgHandler); } catch (_){ /* noop */ }
        }
      },
      destroy(){
        this.stop();
      }
    };

    try {
      Object.defineProperty(tracker, 'lastActivity', {
        get(){ return lastActivity; },
        set(value){
          if (Number.isFinite(value)){
            lastActivity = Number(value);
          } else {
            markActive();
          }
        }
      });
    } catch (_){
      tracker.lastActivity = lastActivity;
    }

    return tracker;
  }

  function getDefaultService(){
    if (global.__portalPointsService && global.__portalPointsService instanceof PointsService){
      return global.__portalPointsService;
    }
    const service = new PointsService();
    global.__portalPointsService = service;
    try {
      if (typeof window !== 'undefined'){ window.pointsService = service; }
    } catch (_){ /* noop */ }
    return service;
  }

  const xpRenderSubscribers = new Set();
  let __xpRenderScheduled = false;
  let __xpRenderLastState = null;

  function scheduleRenderXp(state){
    __xpRenderLastState = state;
    if (__xpRenderScheduled) return;
    __xpRenderScheduled = true;
    const raf = typeof global.requestAnimationFrame === 'function'
      ? global.requestAnimationFrame.bind(global)
      : function(cb){ return global.setTimeout(cb, 16); };
    raf(() => {
      __xpRenderScheduled = false;
      const snapshot = __xpRenderLastState;
      xpRenderSubscribers.forEach(fn => {
        try { fn(snapshot); } catch (_){ /* noop */ }
      });
    });
  }

  function bindPointsBadge(element){
    if (!element) return null;
    const service = getDefaultService();
    const doc = element.ownerDocument || (typeof document !== 'undefined' ? document : null);
    const win = doc ? (doc.defaultView || (typeof window !== 'undefined' ? window : null)) : (typeof window !== 'undefined' ? window : null);
    const animationClass = 'xp-badge--bump';
    const reduceMotion = win && typeof win.matchMedia === 'function' && win.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let lastTotal = null;
    let firstUpdate = true;
    let labelSpan = element.querySelector('.xp-badge__label');
    if (!labelSpan && doc){
      labelSpan = doc.createElement('span');
      labelSpan.className = 'xp-badge__label';
      labelSpan.textContent = element.textContent || '';
      element.textContent = '';
      element.appendChild(labelSpan);
    }
    element.setAttribute('aria-busy', 'true');
    const floatsEnabled = !reduceMotion;

    const ensureAnimationClassRemoved = () => {
      try { element.classList.remove(animationClass); } catch (_){ /* noop */ }
    };
    const bump = () => {
      if (!element || typeof element.classList === 'undefined') return;
      ensureAnimationClassRemoved();
      void element.offsetWidth;
      element.classList.add(animationClass);
    };
    const spawnFloat = (text, variant) => {
      if (!floatsEnabled || !doc) return;
      const float = doc.createElement('span');
      float.className = 'xp-float' + (variant ? ' ' + variant : '');
      float.textContent = text;
      element.appendChild(float);
      requestAnimationFrame(() => {
        try { float.classList.add('xp-float--visible'); } catch (_){ }
      });
      setTimeout(() => {
        try { float.classList.add('xp-float--fading'); } catch (_){ }
      }, 900);
      setTimeout(() => {
        try { float.remove(); } catch (_){ }
      }, 1500);
    };
    const render = (snap) => {
      if (!snap){
        try { snap = service.getSnapshot(); }
        catch (_){ snap = null; }
      }
      if (!snap) return;
      const label = 'Lv ' + snap.level + ' • ' + snap.totalXp + ' XP';
      if (labelSpan){
        if (labelSpan.textContent !== label){
          labelSpan.textContent = label;
        }
      } else {
        element.textContent = label;
      }
      if (lastTotal !== null && snap.totalXp > lastTotal && !reduceMotion){
        bump();
      }
      if (firstUpdate){
        firstUpdate = false;
        element.classList.remove('xp-badge--loading');
        element.setAttribute('aria-busy', 'false');
      }
      lastTotal = snap.totalXp;
    };
    xpRenderSubscribers.add(render);

    const refreshFromStorage = () => {
      if (service && typeof service.reloadFromStorage === 'function'){
        const changed = service.reloadFromStorage();
        if (!changed){
          scheduleRenderXp(service.getSnapshot());
        }
      } else {
        scheduleRenderXp(service.getSnapshot());
      }
    };
    const handleVisibility = () => {
      if (!doc || doc.visibilityState !== 'visible') return;
      refreshFromStorage();
    };
    const handlePageShow = () => { refreshFromStorage(); };
    const handleAnimationEnd = () => { ensureAnimationClassRemoved(); };

    scheduleRenderXp(service.getSnapshot());
    const offUpdate = service.on('update', (snap) => {
      scheduleRenderXp(snap || service.getSnapshot());
    });
    const handleLevel = (detail) => {
      scheduleRenderXp(service.getSnapshot());
      spawnFloat('+1', 'xp-float--level');
    };
    const offLevel = service.on('levelup', handleLevel);
    const handleAward = (detail) => {
      if (!detail || !detail.amount) return;
      if (detail.reason !== 'personal_best') return;
      scheduleRenderXp(service.getSnapshot());
      spawnFloat('+' + detail.amount + ' XP', 'xp-float--bonus');
    };
    const offAward = service.on('award', handleAward);
    if (doc && typeof doc.addEventListener === 'function'){
      doc.addEventListener('visibilitychange', handleVisibility);
    }
    if (win && typeof win.addEventListener === 'function'){
      win.addEventListener('pageshow', handlePageShow);
    }
    if (typeof element.addEventListener === 'function'){
      element.addEventListener('animationend', handleAnimationEnd);
    }
    element.__pointsDetach = function(){
      offUpdate();
      offLevel();
      offAward();
      if (doc && typeof doc.removeEventListener === 'function'){
        doc.removeEventListener('visibilitychange', handleVisibility);
      }
      if (win && typeof win.removeEventListener === 'function'){
        win.removeEventListener('pageshow', handlePageShow);
      }
      if (typeof element.removeEventListener === 'function'){
        element.removeEventListener('animationend', handleAnimationEnd);
      }
      ensureAnimationClassRemoved();
      xpRenderSubscribers.delete(render);
    };
    return service;
  }

  function setupBadge(){
    if (typeof document === 'undefined') return;
    const el = document.getElementById('xpBadge');
    if (!el) return;
    bindPointsBadge(el);
  }

  if (typeof document !== 'undefined'){
    if (document.readyState === 'loading'){
      document.addEventListener('DOMContentLoaded', setupBadge, { once: true });
    } else {
      setupBadge();
    }
    document.addEventListener('visibilitychange', () => {
      if (typeof window === 'undefined') return;
      const tracker = window.activityTracker;
      if (tracker && typeof tracker.setPaused === 'function'){
        try { tracker.setPaused(document.hidden); } catch (_){ }
      }
    });
  }

  if (typeof window !== 'undefined'){
    try {
      window.addEventListener('beforeunload', () => {
        try {
          const tracker = window.activityTracker;
          if (tracker && typeof tracker.stop === 'function'){
            tracker.stop();
          }
        } catch (_){ }
      }, { once: true });
    } catch (_){ }
  }

  global.Points = Object.assign({}, global.Points, {
    PointsService,
    PointsApiAdapter,
    createActivityTracker,
    getDefaultService,
    bindPointsBadge,
    grantPersonalBest(slug, details){
      const service = getDefaultService();
      if (!service || typeof service.awardPersonalBest !== 'function'){
        return Promise.resolve(0);
      }
      try {
        const result = service.awardPersonalBest(slug, details);
        if (result && typeof result.then === 'function'){
          return result.then((value) => (Number.isFinite(value) ? value : 0)).catch(() => 0);
        }
        return Promise.resolve(Number.isFinite(result) ? result : 0);
      } catch (_){
        return Promise.resolve(0);
      }
    }
  });

  // --- Game -> Portal bridge: receive activity + score updates from games in iframe ---
  (function initGameMessageBridge(){
    if (typeof window === 'undefined') return;
    const allowedOrigin = window.location && window.location.origin ? window.location.origin : null;
    window.addEventListener('message', (e) => {
      if (!e || !e.data || typeof e.data !== 'object') return;
      if (allowedOrigin && e.origin !== allowedOrigin) return;
      const { type } = e.data;

      if (type === 'kcswh:activity' || type === 'game-active'){
        const tracker = window.activityTracker;
        if (tracker && typeof tracker.nudge === 'function'){
          try { tracker.nudge(); } catch (_){ }
        }
        return;
      }

      if (type === 'game-score'){
        const { gameId, score } = e.data;
        if (typeof score === 'number'){
          let svc = window.pointsService;
          if (!svc && global.Points && typeof global.Points.getDefaultService === 'function'){
            try { svc = global.Points.getDefaultService(); } catch (_){ svc = null; }
            if (svc){
              try { window.pointsService = svc; } catch (_){ }
            }
          }
          if (svc && typeof svc.recordScore === 'function'){
            try { svc.recordScore(gameId || 'game', score); } catch (_){ }
          }
        }
        const tracker = window.activityTracker;
        if (tracker && typeof tracker.nudge === 'function'){
          try { tracker.nudge(); } catch (_){ }
        }
        return;
      }
    }, { passive: true });
  })();

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));

