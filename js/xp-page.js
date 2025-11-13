(function(){
  const pageEl = document.querySelector(".xp-page");
  const levelEl = document.getElementById("xpLevel");
  const totalEl = document.getElementById("xpTotal");
  const capEl = document.getElementById("xpDailyCap");
  const remainingEl = document.getElementById("xpRemaining");
  const remainingHintEl = document.getElementById("xpRemainingHint");
  const todayEl = document.getElementById("xpToday");
  const todayCapEl = document.getElementById("xpTodayCap");
  const todayRemainingEl = document.getElementById("xpTodayRemaining");
  const resetHintEl = document.getElementById("xpResetHint");
  const progressBar = document.querySelector(".xp-progress__bar");
  const progressFill = document.getElementById("xpProgressFill");
  const progressDetails = document.getElementById("xpProgressDetails");
  const boostStatusEl = document.getElementById("xpBoostStatus");
  const boostHintEl = document.getElementById("xpBoostHint");
  const comboStatusEl = document.getElementById("xpComboStatus");
  const comboHintEl = document.getElementById("xpComboHint");

  function formatNumber(value){
    const num = Number(value);
    if (!Number.isFinite(num)) return "0";
    return Math.max(0, Math.floor(num)).toLocaleString();
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
    if (!Number.isFinite(value)) return "Remaining allowance unavailable.";
    if (value <= 0) return "Daily cap reached. Come back after reset.";
    return `You can still earn ${formatNumber(value)} XP before the reset.`;
  }

  function formatResetHint(epoch){
    if (!Number.isFinite(epoch) || epoch <= Date.now()) return "";
    try {
      const date = new Date(epoch);
      const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      return `Daily cap resets at ${time}.`;
    } catch (_error) {
      return "";
    }
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
        progressDetails.textContent = `${formatNumber(intoLevel)} / ${formatNumber(forNext)} XP to next level`;
      } else {
        progressDetails.textContent = "Maximum level achieved";
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
      boostStatusEl.textContent = active ? `Active boost: ${formatMultiplier(multiplier)}` : "No active boost.";
    }
    if (boostHintEl) {
      if (active) {
        boostHintEl.textContent = timeLeft < 10_000 ? "Boost ends soon." : `Ends in ${formatDuration(timeLeft)}.`;
      } else {
        boostHintEl.textContent = "Boosts give temporary XP multipliers when unlocked.";
      }
    }
  }

  function renderCombo(snapshot){
    const data = snapshot && typeof snapshot === "object" ? snapshot : {};
    const multiplier = Number.isFinite(Number(data.multiplier)) ? Number(data.multiplier) : 1;
    const mode = typeof data.mode === "string" ? data.mode : "build";
    if (comboStatusEl) {
      comboStatusEl.textContent = `Combo: ${formatMultiplier(multiplier)} (${mode})`;
    }
    if (comboHintEl) {
      let hint = "Keep playing to build your combo.";
      if (mode === "sustain") hint = "Stay active to keep your combo.";
      else if (mode === "cooldown") hint = "Combo cooling down.";
      comboHintEl.textContent = hint;
    }
  }

  function applySnapshot(){
    if (!window.XP || typeof window.XP.getSnapshot !== "function") {
      setFallbackVisible(true);
      return;
    }
    const snapshot = window.XP.getSnapshot();
    const capValue = resolveCap(snapshot);
    const totalToday = safeInt(snapshot && snapshot.totalToday) || 0;
    const totalXp = safeInt(snapshot && snapshot.totalXp) || 0;
    const level = safeInt(snapshot && snapshot.level) || 1;
    const remainingRaw = typeof window.XP.getRemainingDaily === "function" ? window.XP.getRemainingDaily() : null;
    let remainingValue = safeInt(remainingRaw);
    if (remainingValue == null && capValue != null) {
      remainingValue = Math.max(0, capValue - totalToday);
    }
    const nextReset = typeof window.XP.getNextResetEpoch === "function" ? window.XP.getNextResetEpoch() : 0;
    const boost = typeof window.XP.getBoostSnapshot === "function" ? window.XP.getBoostSnapshot() : null;
    const combo = typeof window.XP.getComboSnapshot === "function" ? window.XP.getComboSnapshot() : null;

    setFallbackVisible(false);
    if (levelEl) levelEl.textContent = formatNumber(level);
    if (totalEl) totalEl.textContent = formatNumber(totalXp);
    const capText = capValue != null ? `${formatNumber(capValue)} XP` : "—";
    if (capEl) capEl.textContent = capText;
    if (todayEl) todayEl.textContent = formatNumber(totalToday);
    if (todayCapEl) todayCapEl.textContent = capText;
    const remainingText = remainingValue != null ? `${formatNumber(remainingValue)} XP` : "—";
    if (remainingEl) remainingEl.textContent = remainingText;
    if (remainingHintEl) remainingHintEl.textContent = formatRemainingHint(remainingValue);
    if (todayRemainingEl) todayRemainingEl.textContent = remainingText;
    if (resetHintEl) {
      const hint = formatResetHint(nextReset);
      if (hint) {
        resetHintEl.textContent = hint;
        resetHintEl.hidden = false;
      } else {
        resetHintEl.hidden = true;
      }
    }

    renderProgress(snapshot);
    renderBoost(boost);
    renderCombo(combo);
  }

  function refresh(){
    if (!window.XP || typeof window.XP.refreshStatus !== "function") {
      applySnapshot();
      return Promise.resolve();
    }
    return window.XP.refreshStatus()
      .catch(() => null)
      .then(() => { applySnapshot(); });
  }

  function init(){
    if (!window.XP) {
      setFallbackVisible(true);
      return;
    }
    applySnapshot();
    refresh();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
