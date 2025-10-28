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

  class PointsService{
    constructor(options){
      const opts = Object.assign({}, DEFAULTS, options || {});
      this.options = opts;
      this.adapter = opts.adapter || new PointsApiAdapter({ storageKey: opts.storageKey || STORAGE_KEY });
      this.storageKey = opts.storageKey || STORAGE_KEY;
      this.state = this._loadState();
      this.currentSession = null;
      this.listeners = { update: new Set(), levelup: new Set() };

      this._ensureDayState(now());
      if (opts.autoDailyBonus !== false){
        this._maybeAwardDailyBonus();
      } else {
        this._emitUpdate();
      }
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
          this._awardXp(this.options.firstPlayBonus, { reason: 'first_play' });
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
      return this._awardXp(ticks * this.options.tickXp, { reason: 'activity' });
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

    _loadState(){
      const empty = {
        version: 1,
        userId: generateId(),
        totalXp: 0,
        xpToday: 0,
        level: 1,
        lastDayKey: null,
        lastLoginBonusKey: null,
        streak: { count: 0, lastKey: null },
        games: {}
      };
      const stored = this.adapter && typeof this.adapter.loadState === 'function'
        ? this.adapter.loadState()
        : null;
      if (!stored) return empty;
      const merged = Object.assign({}, empty, stored);
      if (!merged.userId) merged.userId = generateId();
      merged.level = this._computeLevel(merged.totalXp || 0);
      if (!merged.streak) merged.streak = { count: 0, lastKey: null };
      if (!merged.games) merged.games = {};
      return merged;
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
      const granted = this._awardXp(amount, { reason: 'daily', bypassSession: true });
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
      this._persist();
      this._emitUpdate();
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
  }

  function createActivityTracker(targetDocument, onTick, options){
    const doc = targetDocument || (typeof document !== 'undefined' ? document : null);
    if (!doc || typeof onTick !== 'function'){
      return { stop: function(){} };
    }
    const opts = options || {};
    const tickSeconds = opts.tickSeconds || DEFAULTS.tickSeconds;
    const idleTimeout = opts.idleTimeout || 30000;
    const sampleMs = opts.sampleMs || 1000;
    let destroyed = false;
    let elapsed = 0;
    let lastActivity = now();
    const activityHandler = () => { lastActivity = now(); };
    const events = ['pointerdown', 'pointermove', 'pointerup', 'touchstart', 'touchmove', 'keydown'];
    events.forEach(evt => {
      try { doc.addEventListener(evt, activityHandler, { passive: true }); } catch (_){ doc.addEventListener(evt, activityHandler); }
    });
    const timer = setInterval(() => {
      if (destroyed) return;
      const current = now();
      if (current - lastActivity > idleTimeout){
        elapsed = 0;
        return;
      }
      elapsed += sampleMs / 1000;
      if (elapsed >= tickSeconds){
        const ticks = Math.floor(elapsed / tickSeconds);
        elapsed -= ticks * tickSeconds;
        try { onTick(ticks); } catch (_){ /* noop */ }
      }
    }, sampleMs);
    return {
      stop(){
        if (destroyed) return;
        destroyed = true;
        clearInterval(timer);
        events.forEach(evt => {
          try { doc.removeEventListener(evt, activityHandler); } catch (_){ }
        });
      }
    };
  }

  function getDefaultService(){
    if (global.__portalPointsService && global.__portalPointsService instanceof PointsService){
      return global.__portalPointsService;
    }
    const service = new PointsService();
    global.__portalPointsService = service;
    return service;
  }

  function bindPointsBadge(element){
    if (!element) return null;
    const service = getDefaultService();
    const update = () => { element.textContent = service.getBadgeLabel(); };
    update();
    const offUpdate = service.on('update', update);
    const offLevel = service.on('levelup', update);
    element.__pointsDetach = function(){
      offUpdate();
      offLevel();
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
  }

  global.Points = Object.assign({}, global.Points, {
    PointsService,
    PointsApiAdapter,
    createActivityTracker,
    getDefaultService,
    bindPointsBadge
  });

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));

