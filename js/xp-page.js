(function(){
  const pageEl = document.querySelector(".xp-page");
  const levelEl = document.getElementById("xpLevel");
  const totalEl = document.getElementById("xpTotal");
  const capEl = document.getElementById("xpDailyCap");
  const remainingEl = document.getElementById("xpRemaining");
  const remainingHintEl = document.getElementById("xpRemainingHint");
  const todayLineEl = document.getElementById("xpTodayLine");
  const capLineEl = document.getElementById("xpCapLine");
  const remainingLineEl = document.getElementById("xpRemainingLine");
  const resetHintEl = document.getElementById("xpResetHint");
  const progressBar = document.querySelector(".xp-progress__bar");
  const progressFill = document.getElementById("xpProgressFill");
  const progressDetails = document.getElementById("xpProgressDetails");
  const boostStatusEl = document.getElementById("xpBoostStatus");
  const boostHintEl = document.getElementById("xpBoostHint");
  const comboStatusEl = document.getElementById("xpComboStatus");
  const comboHintEl = document.getElementById("xpComboHint");

  function t(key, fallback){
    if (window.I18N && typeof window.I18N.t === "function") {
      const translated = window.I18N.t(key);
      if (translated) return translated;
    }
    return fallback;
  }

  function formatTemplate(template, values){
    if (!template || typeof template !== "string") return "";
    const map = values || {};
    return template.replace(/\{(\w+)\}/g, (match, token)=> {
      if (Object.prototype.hasOwnProperty.call(map, token)) {
        return map[token];
      }
      return match;
    });
  }

  function formatNumber(value){
    const num = Number(value);
    if (!Number.isFinite(num)) return "0";
    return Math.max(0, Math.floor(num)).toLocaleString();
  }

  function translateComboMode(mode){
    if (mode === "build") return t("xp_combo_mode_build", "build");
    if (mode === "sustain") return t("xp_combo_mode_sustain", "sustain");
    if (mode === "cooldown") return t("xp_combo_mode_cooldown", "cooldown");
    return mode;
  }

  function formatMultiplier(value){
    const num = Number(value);
    if (!Number.isFinite(num) || num <= 0) return "x1";
    if (Math.abs(num - Math.round(num)) < 0.01) return `x${Math.round(num)}`;
    return `x${num.toFixed(1)}`;
  }

  function formatDuration(ms){
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  function formatRemainingHint(value){
    if (!Number.isFinite(value)) {
      return t("xp_summary_remaining_hint_unavailable", "Remaining allowance unavailable.");
    }
    if (value <= 0) {
      return t("xp_summary_remaining_hint_cap", "Daily cap reached. Come back after reset.");
    }
    const template = t("xp_summary_remaining_hint", "You can still earn {amount} XP before the reset.");
    return formatTemplate(template, { amount: formatNumber(value) });
  }

  function formatResetHint(epoch){
    if (!Number.isFinite(epoch) || epoch <= Date.now()) return "";
    const template = t("xp_daily_reset_hint", "Daily XP resets at {time} (Europe/Warsaw).");
    try {
      if (typeof Intl !== "undefined" && typeof Intl.DateTimeFormat === "function") {
        const formatter = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Warsaw" });
        const time = formatter.format(new Date(epoch));
        return formatTemplate(template, { time });
      }
    } catch (_error) {
      return formatTemplate(template, { time: "03:00" });
    }
    return formatTemplate(template, { time: "03:00" });
  }

  function safeInt(value){
    const num = Number(value);
    if (!Number.isFinite(num)) return null;
    return Math.max(0, Math.floor(num));
  }

  function resolveCap(snapshot){
    if (snapshot && snapshot.cap != null) {
      const capValue = safeInt(snapshot.cap);
      if (capValue != null) return capValue;
    }
    const envCap = Number(window && window.XP_DAILY_CAP);
    if (Number.isFinite(envCap) && envCap > 0) {
      return Math.max(0, Math.floor(envCap));
    }
    return null;
  }

  function setFallbackVisible(active){
    if (!pageEl) return;
    if (active) {
      pageEl.classList.add("xp-page--fallback");
    } else {
      pageEl.classList.remove("xp-page--fallback");
    }
  }

  function setTestTotals(totals){
    if (typeof window === "undefined") return;
    const payload = Object.assign({ cap: null, totalToday: 0, remaining: 0 }, totals || {});
    try {
      Object.defineProperty(window, "__xpTestTotals", {
        configurable: true,
        enumerable: false,
        value: payload,
        writable: true,
      });
    } catch (_) {
      window.__xpTestTotals = payload;
    }
  }

  function renderProgress(snapshot){
    const intoLevel = safeInt(snapshot && snapshot.xpIntoLevel) || 0;
    const forNext = safeInt(snapshot && snapshot.xpForNextLevel) || 0;
    const progressValue = typeof snapshot?.progress === "number" ? snapshot.progress : 0;
    const progressPercent = Math.max(0, Math.min(100, Math.round(progressValue * 100)));
    if (progressBar) {
      progressBar.setAttribute("aria-valuenow", String(progressPercent));
    }
    if (progressFill) {
      progressFill.style.width = `${progressPercent}%`;
    }
    if (progressDetails) {
      if (forNext > 0) {
        const template = t("xp_progress_details", "{current} / {total} XP to next level");
        progressDetails.textContent = formatTemplate(template, {
          current: formatNumber(intoLevel),
          total: formatNumber(forNext)
        });
      } else {
        progressDetails.textContent = t("xp_progress_details_max", "Maximum level achieved");
      }
    }
  }

  function renderBoost(snapshot){
    const data = snapshot && typeof snapshot === "object" ? snapshot : {};
    const multiplier = Number.isFinite(Number(data.multiplier)) ? Number(data.multiplier) : 1;
    const expiresAt = Number(data.expiresAt) || 0;
    const now = Date.now();
    const timeLeft = expiresAt > now ? expiresAt - now : 0;
    const active = !!(data.active && multiplier > 1 && timeLeft > 0);
    if (boostStatusEl) {
      if (active) {
        const template = t("xp_boost_status_active", "Active boost: {multiplier}");
        boostStatusEl.textContent = formatTemplate(template, { multiplier: formatMultiplier(multiplier) });
      } else {
        boostStatusEl.textContent = t("xp_boost_status_default", "No active boost.");
      }
    }
    if (boostHintEl) {
      if (active) {
        if (timeLeft < 10_000) {
          boostHintEl.textContent = t("xp_boost_hint_ending", "Boost ends soon.");
        } else {
          const template = t("xp_boost_hint_timer", "Ends in {time}.");
          boostHintEl.textContent = formatTemplate(template, { time: formatDuration(timeLeft) });
        }
      } else {
        boostHintEl.textContent = t("xp_boost_hint_default", "Boosts give temporary XP multipliers when unlocked.");
      }
    }
  }

  function renderCombo(snapshot){
    const data = snapshot && typeof snapshot === "object" ? snapshot : {};
    const multiplier = Number.isFinite(Number(data.multiplier)) ? Number(data.multiplier) : 1;
    const mode = typeof data.mode === "string" ? data.mode : "build";
    if (comboStatusEl) {
      const template = t("xp_combo_status", "Combo: {multiplier} ({mode})");
      comboStatusEl.textContent = formatTemplate(template, {
        multiplier: formatMultiplier(multiplier),
        mode: translateComboMode(mode)
      });
    }
    if (comboHintEl) {
      let key = "xp_combo_hint_build";
      if (mode === "sustain") key = "xp_combo_hint_sustain";
      else if (mode === "cooldown") key = "xp_combo_hint_cooldown";
      const fallback = mode === "sustain"
        ? "Stay active to keep your combo."
        : (mode === "cooldown" ? "Combo cooling down." : "Keep playing to build your combo.");
      comboHintEl.textContent = t(key, fallback);
    }
  }

  function logDashboardDebug(stage){
    if (!window || !window.XP_DEBUG_DAILY_TOTALS) return;
    try {
      const xpApi = window.XP;
      if (!xpApi || typeof xpApi.getSnapshot !== "function") return;
      const snapshot = xpApi.getSnapshot();
      const payload = {
        snapshot,
        remaining: typeof xpApi.getRemainingDaily === "function" ? xpApi.getRemainingDaily() : null,
        state: xpApi && xpApi.__stateInternal__ != null ? xpApi.__stateInternal__ : null,
      };
      if (typeof console !== "undefined" && console && typeof console.log === "function") {
        console.log(`[XP-PAGE][${stage || "dashboard"}]`, payload);
      }
      if (typeof xpApi.log === "function") {
        xpApi.log(stage || "dashboard", payload);
      }
    } catch (_) { /* ignore */ }
  }

  function applySnapshot() {
  try {
    const xp = (typeof window !== "undefined" && window.XP) || {};
    const snapshot = (xp && typeof xp.getSnapshot === "function") ? xp.getSnapshot() : (xp && xp.snapshot) || {};
    const summary  = (xp && typeof xp.getSummary  === "function") ? xp.getSummary()  : (xp && xp.summary)  || {};

    function pickNumber() {
      for (let i = 0; i < arguments.length; i++) {
        const v = arguments[i];
        if (v == null) continue;
        const n = safeInt(v);
        if (n != null) return n;
      }
      return null;
    }

    // --- CAP (prefer server, then env) ---
    let capValue = pickNumber(
      snapshot && snapshot.cap,
      snapshot && snapshot.dailyCap,
      snapshot && snapshot.limit,
      summary  && summary.cap,
      summary  && summary.dailyCap,
      summary  && summary.limit,
      summary  && summary.totals && summary.totals.cap,
      summary  && summary.totals && summary.totals.dailyCap,
      summary  && summary.totals && summary.totals.limit
    );
    if (capValue == null) {
      const envCap = Number(window && window.XP_DAILY_CAP);
      if (Number.isFinite(envCap) && envCap > 0) capValue = Math.floor(envCap);
    }

    // --- LOOSE REMAINING (what server gave us directly) ---
    const remainingLoose = pickNumber(
      snapshot && snapshot.remaining,
      snapshot && snapshot.remainingToday,
      summary  && summary.remaining,
      summary  && summary.remainingToday,
      summary  && summary.totals && summary.totals.remaining,
      summary  && summary.totals && summary.totals.remainingToday
    );

    // --- RAW TODAY (if provided) ---
    let totalTodayRaw = pickNumber(
      snapshot && snapshot.totalToday,
      snapshot && snapshot.todayTotal,
      snapshot && snapshot.today,
      summary  && summary.totalToday,
      summary  && summary.today   && summary.today.total,
      summary  && summary.today   && summary.today.earned,
      summary  && summary.totals  && summary.totals.totalToday,
      summary  && summary.totals  && summary.totals.today,
      summary  && summary.totals  && summary.totals.earned
    );

    // --- DERIVE TODAY/REMAINING CONSISTENTLY ---
    let totalToday = null;
    let remainingValue = null;

    // Prefer server-provided remaining first
    if (remainingLoose != null) remainingValue = Math.max(0, remainingLoose);
    if (totalTodayRaw != null) totalToday = Math.max(0, totalTodayRaw);

    // If totalToday missing but cap + remaining known, derive it
    if (totalToday == null && capValue != null && remainingValue != null) {
      totalToday = Math.max(0, capValue - remainingValue);
    }

    // If remaining missing but cap + today known, derive it
    if (remainingValue == null && capValue != null && totalToday != null) {
      remainingValue = Math.max(0, capValue - totalToday);
    }

    // Final fallbacks — MUST be before setTestTotals and rendering
    totalToday = totalToday ?? 0;
    remainingValue = remainingValue ?? (capValue != null ? capValue : 400);

    // UI-friendly cap rounding
    let displayToday = totalToday;
    if (capValue != null && remainingValue <= 1 && displayToday < capValue) {
      displayToday = capValue;
    }

    // This is what E2E tests read — now always defined
    setTestTotals({
      cap: capValue,
      totalToday: displayToday,
      remaining: remainingValue
    });

    // --- BASIC INFO ---
    const totalXp = safeInt(snapshot && snapshot.totalXp) || 0;
    const level   = safeInt(snapshot && snapshot.level)   || 1;

    setFallbackVisible(false);

    if (levelEl) levelEl.textContent = formatNumber(level);
    if (totalEl) totalEl.textContent = formatNumber(totalXp);

    // --- CAP LINE ---
    if (capEl) capEl.textContent = capValue != null ? `${formatNumber(capValue)} XP` : "—";

    if (capLineEl) {
      const template = t("xp_daily_cap_line", "The daily XP cap is {cap} XP.");
      capLineEl.textContent = formatTemplate(template, {
        cap: capValue != null ? formatNumber(capValue) : "—",
      });
    }

    // --- TODAY LINE ---
    if (todayLineEl) {
      const template = t("xp_daily_line", "You have earned {amount} XP today.");
      todayLineEl.textContent = formatTemplate(template, {
        amount: formatNumber(displayToday),
      });
    }

    // --- REMAINING (text value; if unknown, will render "0" but hint clarifies) ---
    const remainingText = `${formatNumber(remainingValue)} XP`;
    if (remainingEl) remainingEl.textContent = remainingText;

    if (remainingLineEl) {
      const template = t("xp_daily_remaining_line", "Remaining today: {remaining} XP.");
      remainingLineEl.textContent = formatTemplate(template, {
        remaining: formatNumber(remainingValue),
      });
    }

    // --- REMAINING HINT (never empty) ---
    if (remainingHintEl) {
      const txt = formatRemainingHint(remainingValue);
      remainingHintEl.textContent =
        (txt && txt.trim().length)
          ? txt
          : (Number.isFinite(remainingValue) && remainingValue <= 0
              ? t("xp_remaining_capped", "You’ve reached today’s XP cap. Come back after the daily reset.")
              : t("xp_remaining_left", "Keep going—XP is still available today."));
    }

    // --- RESET HINT ---
    const nextReset = typeof xp.getNextResetEpoch === "function" ? xp.getNextResetEpoch() : 0;
    if (resetHintEl) {
      const hint = formatResetHint(nextReset);
      if (hint) {
        resetHintEl.textContent = hint;
        resetHintEl.hidden = false;
      } else {
        resetHintEl.hidden = true;
      }
    }

    // --- RENDER SECTIONS ---
    renderProgress(snapshot);

    const boost = typeof xp.getBoostSnapshot === "function" ? xp.getBoostSnapshot() : null;
    renderBoost(boost);

    const combo = typeof xp.getComboSnapshot === "function" ? xp.getComboSnapshot() : null;
    renderCombo(combo);

  } catch (err) {
    try { console.error("applySnapshot error:", err); } catch (_) {}
  }
}


function refresh(){
    if (!window.XP || typeof window.XP.refreshStatus !== "function") {
      return Promise.resolve();
    }
    return window.XP.refreshStatus().then(()=>{ try{ applySnapshot(); }catch(_){ } }).catch(()=>null);}

  async function hydrateBeforeRender(){
    if (!window.XP) return;
    window.XP.isHydrated = false;
    try {
      if (typeof window.XP.loadFromCache === "function") {
        await window.XP.loadFromCache();
      }
    } catch (_) {}
    try {
      if (typeof window.XP.hydrateFromCache === "function") {
        await window.XP.hydrateFromCache();
      }
    } catch (_) {}
    window.XP.isHydrated = true;
    logDashboardDebug("dashboard_initial");
    applySnapshot();
  }

  async function init(){
    if (!window.XP) {
      setFallbackVisible(true);
      return;
    }
    await hydrateBeforeRender();
    logDashboardDebug("dashboard_before_totals");
    refresh()
      .then(() => {
        logDashboardDebug("dashboard_after_totals");
        applySnapshot();
      })
      .catch(() => {});
    document.addEventListener("langchange", applySnapshot);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }

  window.addEventListener("xp:updated", () => {
    applySnapshot();
  });
})();

/* XP_PAGE_AUTO_INIT */
try {
  if (typeof window !== "undefined") {
    setTimeout(() => { try { typeof applySnapshot==="function" && applySnapshot(); typeof refresh==="function" && refresh(); } catch(_) {} }, 50);
  }
} catch(_) {}
