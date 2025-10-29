(function(global){
  'use strict';

  const STORAGE_KEY = 'portal.points.v1';
  const MAX_STREAK = 7;
  const DEFAULTS = {
    tickSeconds: 15,
    tickXp: 5,
    sessionCap: 200,
    dailyCap: 600,
    dailyBonusBase: 10,
    firstPlayBonus: 15,
    autoDailyBonus: true,
    showToasts: true
  };

  function now(){ return Date.now ? Date.now() : new Date().getTime(); }

  function dayKey(ts){
    const d = new Date(ts);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function daysBetween(prevKey, nextKey){
    if (!prevKey || !nextKey) return 0;
    try {
      const prev = new Date(prevKey + 'T00:00:00Z');
      const next = new Date(nextKey + 'T00:00:00Z');
      const diff = Math.round((next.getTime() - prev.getTime()) / 86400000);
      return diff;
    } catch (_){
      return 0;
    }
  }

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

    syncToServer(userId, sessionData){
      // Placeholder for future API integration.
      return Promise.resolve({ ok: true, userId, sessionData });
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
      this.adapter = opts.adapter || new PointsApiAdapter({ storageKey: opts.storageKey || STORAGE_KEY });
      this.storageKey = opts.storageKey || STORAGE_KEY;
      this.state = this._loadState();
      this.currentSession = null;
      this.listeners = { update: new Set(), levelup: new Set(), award: new Set() };
      this._boundStorageListener = null;

      this._ensureDayState(now());
      if (opts.autoDailyBonus !== false){
        this._maybeAwardDailyBonus();
      } else {
        this._emitUpdate();
      }

      this._bindStorageListener();
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
      const totalXp = this.state.totalXp || 0;
      const level = this.state.level || this._computeLevel(totalXp);
      const currentLevelFloor = Math.max(0, (level - 1));
      const currentLevelXp = 100 * currentLevelFloor * currentLevelFloor;
      const nextLevelXp = 100 * level * level;
      const xpIntoLevel = Math.max(0, totalXp - currentLevelXp);
      const xpToNext = Math.max(0, nextLevelXp - totalXp);
      const progress = nextLevelXp === currentLevelXp ? 1 : Math.min(1, xpIntoLevel / (nextLevelXp - currentLevelXp));
      return {
        userId: this.state.userId,
        totalXp,
        xpToday: this.state.xpToday || 0,
        level,
        nextLevelXp,
        xpToNext,
        xpIntoLevel,
        progress,
        streak: Object.assign({ count: 0, lastKey: null }, this.state.streak)
      };
    }

    getBadgeLabel(){
      const snap = this.getSnapshot();
      return 'Lv ' + snap.level + ' • ' + snap.totalXp + ' XP';
    }

    startSession(slug){
      const ts = now();
      this._ensureDayState(ts);
      this.currentSession = {
        slug: slug || null,
        startedAt: new Date(ts).toISOString(),
        earned: 0
      };
      const today = this.state.lastDayKey;

      if (slug){
        if (!this.state.games) this.state.games = {};
        const info = this.state.games[slug] || {};
        if (info.lastFirstBonusKey !== today){
          info.lastFirstBonusKey = today;
          this._awardXp(this.options.firstPlayBonus, {
            reason: 'first_play',
            metadata: { slug }
          });
        }
        info.lastPlayedAt = new Date(ts).toISOString();
        this.state.games[slug] = info;
      }

      this._maybeAwardDailyBonus();
      this._persist();
      this._emitUpdate();
    }

    tick(multiplier){
      const ticks = Number.isFinite(multiplier) && multiplier > 0 ? Math.floor(multiplier) : 1;
      if (!ticks) return 0;
      this._ensureDayState(now());
      return this._awardXp(ticks * this.options.tickXp, {
        reason: 'activity',
        metadata: { ticks }
      });
    }

    endSession(){
      const session = this.currentSession;
      this.currentSession = null;
      this._persist();
      if (!session) return;
      if (this.adapter && typeof this.adapter.syncToServer === 'function'){
        try {
          Promise.resolve(this.adapter.syncToServer(this.state.userId, {
            slug: session.slug,
            earnedXp: session.earned || 0,
            endedAt: new Date().toISOString()
          })).catch(() => {});
        } catch (_){ /* ignore */ }
      }
    }

    _createEmptyState(){
      return {
        version: 1,
        userId: generateId(),
        totalXp: 0,
        xpToday: 0,
        level: 1,
        lastDayKey: null,
        lastLoginBonusKey: null,
        streak: { count: 0, lastKey: null },
        games: {},
        bestByGame: {}
      };
    }

    _normalizeState(stored){
      const empty = this._createEmptyState();
      if (!stored) return empty;
      const merged = Object.assign({}, empty, stored);
      if (!merged.userId) merged.userId = generateId();
      merged.level = this._computeLevel(merged.totalXp || 0);
      if (!merged.streak) merged.streak = { count: 0, lastKey: null };
      if (!merged.games) merged.games = {};
      if (!merged.bestByGame || typeof merged.bestByGame !== 'object') merged.bestByGame = {};
      return merged;
    }

    _loadState(){
      const stored = this.adapter && typeof this.adapter.loadState === 'function'
        ? this.adapter.loadState()
        : null;
      return this._normalizeState(stored);
    }

    _ensureDayState(ts){
      const today = dayKey(ts);
      if (this.state.lastDayKey === today){
        return;
      }
      const prevKey = this.state.lastDayKey;
      const diff = daysBetween(prevKey, today);
      if (!this.state.streak) this.state.streak = { count: 0, lastKey: null };
      if (diff === 1){
        this.state.streak.count = Math.min(MAX_STREAK, (this.state.streak.count || 0) + 1);
      } else {
        this.state.streak.count = 1;
      }
      this.state.streak.lastKey = today;
      this.state.lastDayKey = today;
      this.state.xpToday = 0;
      if (this.currentSession) this.currentSession.earned = 0;
      this._persist();
      this._emitUpdate();
    }

    _maybeAwardDailyBonus(){
      const today = this.state.lastDayKey || dayKey(now());
      if (this.state.lastLoginBonusKey === today){
        this._emitUpdate();
        return 0;
      }
      this.state.lastLoginBonusKey = today;
      const streakCount = Math.max(1, Math.min(MAX_STREAK, (this.state.streak && this.state.streak.count) || 1));
      const amount = this.options.dailyBonusBase * streakCount;
      const granted = this._awardXp(amount, {
        reason: 'daily_bonus',
        bypassSession: true,
        metadata: { streakCount }
      });
      this._persist();
      this._emitUpdate();
      return granted;
    }

    _awardXp(amount, options){
      const opts = options || {};
      if (!amount || amount <= 0) return 0;
      if (!this.state) return 0;

      const dayRemaining = Math.max(0, this.options.dailyCap - (this.state.xpToday || 0));
      let sessionRemaining = dayRemaining;
      if (!opts.bypassSession && this.currentSession){
        sessionRemaining = Math.min(sessionRemaining, Math.max(0, this.options.sessionCap - (this.currentSession.earned || 0)));
      }
      const allowed = Math.max(0, Math.min(amount, dayRemaining, sessionRemaining));
      if (!allowed){
        this._emitUpdate();
        return 0;
      }
      const prevLevel = this.state.level || this._computeLevel(this.state.totalXp || 0);
      this.state.totalXp = (this.state.totalXp || 0) + allowed;
      this.state.xpToday = (this.state.xpToday || 0) + allowed;
      this.state.level = this._computeLevel(this.state.totalXp);
      this.state.updatedAt = new Date().toISOString();
      if (!opts.bypassSession && this.currentSession){
        this.currentSession.earned = (this.currentSession.earned || 0) + allowed;
      }
      const detail = {
        amount: allowed,
        reason: opts.reason || 'bonus',
        metadata: opts.metadata || null,
        totalXp: this.state.totalXp,
        level: this.state.level,
        xpToday: this.state.xpToday
      };
      this._persist();
      this._emitUpdate();
      this._emit('award', detail);
      if (this.state.level > prevLevel){
        this._handleLevelUp(this.state.level, allowed);
      }
      return allowed;
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
      const prevTotal = (this.state && this.state.totalXp) || 0;
      const prevToday = (this.state && this.state.xpToday) || 0;
      const prevLevel = (this.state && this.state.level) || 1;
      this.state = normalized;
      this._ensureDayState(now());
      if (this.options.autoDailyBonus !== false){
        this._maybeAwardDailyBonus();
      } else {
        this._emitUpdate();
      }
      const snap = this.getSnapshot();
      return snap.totalXp !== prevTotal || snap.xpToday !== prevToday || snap.level !== prevLevel;
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

    awardBonus(amount, metadata){
      return this._awardXp(amount, {
        reason: metadata && metadata.reason ? metadata.reason : 'bonus',
        metadata
      });
    }

    awardPersonalBest(slug, details){
      if (!slug) return 0;
      const info = details || {};
      const rawScore = Number(info.score);
      if (!Number.isFinite(rawScore) || rawScore <= 0){
        return 0;
      }
      const previous = Number(info.previousBest);
      if (!this.state.games) this.state.games = {};
      const record = this.state.games[slug] || {};
      const lastAwarded = Number(record.bestAwardedScore);
      const baseline = Math.max(0,
        Number.isFinite(previous) ? previous : 0,
        Number.isFinite(lastAwarded) ? lastAwarded : 0
      );
      if (rawScore <= baseline){
        record.bestScore = Math.max(Number(record.bestScore) || 0, rawScore);
        this.state.games[slug] = record;
        if (!this.state.bestByGame) this.state.bestByGame = {};
        this.state.bestByGame[slug] = Math.max(Number(this.state.bestByGame[slug]) || 0, rawScore);
        this._persist();
        return 0;
      }
      const delta = rawScore - baseline;
      let amount = Number(info.amount);
      if (!Number.isFinite(amount) || amount <= 0){
        const base = Math.max(18, Math.min(90, Math.round(Math.sqrt(rawScore)) + 12));
        const deltaBonus = Math.min(80, Math.floor(delta / 8));
        amount = Math.max(25, Math.min(150, base + deltaBonus));
      }
      record.bestScore = Math.max(Number(record.bestScore) || 0, rawScore);
      record.bestAwardedScore = rawScore;
      record.bestAwardedAt = new Date().toISOString();
      record.lastPersonalBestDelta = delta;
      record.lastPersonalBestAward = amount;
      this.state.games[slug] = record;
      if (!this.state.bestByGame) this.state.bestByGame = {};
      this.state.bestByGame[slug] = Math.max(Number(this.state.bestByGame[slug]) || 0, rawScore);
      return this._awardXp(amount, {
        reason: 'personal_best',
        bypassSession: true,
        metadata: {
          slug,
          score: rawScore,
          previousBest: baseline,
          delta,
          amount
        }
      });
    }

    recordScore(gameId, score){
      if (!Number.isFinite(score)) return 0;
      const slug = String(gameId || 'game');
      if (!this.state.bestByGame || typeof this.state.bestByGame !== 'object'){
        this.state.bestByGame = {};
      }
      if (!this.state.games || typeof this.state.games !== 'object'){
        this.state.games = {};
      }
      const mapBest = this.state.bestByGame;
      const record = this.state.games[slug] || {};
      const knownBestCandidates = [
        Number(mapBest[slug]),
        Number(record.bestScore),
        Number(record.bestAwardedScore)
      ].filter(value => Number.isFinite(value) && value >= 0);
      const previousBest = knownBestCandidates.length ? Math.max.apply(null, knownBestCandidates) : 0;
      if (score <= previousBest){
        record.bestScore = Math.max(Number(record.bestScore) || 0, score);
        mapBest[slug] = Math.max(previousBest, score);
        this.state.games[slug] = record;
        this._persist();
        this._emitUpdate();
        return 0;
      }

      const suggested = personalBestBonus(previousBest, score);
      const awarded = this.awardPersonalBest(slug, {
        score,
        previousBest,
        amount: suggested
      });
      mapBest[slug] = Math.max(previousBest, score);
      this.state.games[slug] = this.state.games[slug] || {};
      this.state.games[slug].bestScore = Math.max(Number(this.state.games[slug].bestScore) || 0, score);
      if (!awarded){
        this._persist();
        this._emitUpdate();
      }
      return awarded;
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
      if (!service || typeof service.awardPersonalBest !== 'function') return 0;
      return service.awardPersonalBest(slug, details);
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

