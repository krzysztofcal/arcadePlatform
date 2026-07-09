(function(){
  const levelEl = document.getElementById("xpLevel");
  const totalEl = document.getElementById("xpTotal");
  const capEl = document.getElementById("xpDailyCap");
  const todayEl = document.getElementById("xpToday");
  const todayCapEl = document.getElementById("xpTodayCap");
  const progressBar = document.querySelector(".xp-progress__bar");
  const progressFill = document.getElementById("xpProgressFill");
  const progressDetails = document.getElementById("xpProgressDetails");

  function formatNumber(value){
    const num = Number(value) || 0;
    const lang = window.I18N && typeof window.I18N.getLang === "function" ? window.I18N.getLang() : "en";
    return num.toLocaleString(lang === "pl" ? "pl-PL" : "en-US");
  }

  function t(key, fallback){
    return window.I18N && typeof window.I18N.t === "function"
      ? (window.I18N.t(key) || fallback)
      : fallback;
  }

  function tf(key, values, fallback){
    if (window.I18N && typeof window.I18N.format === "function"){
      return window.I18N.format(key, values);
    }
    return fallback.replace(/\{([a-zA-Z0-9_]+)\}/g, function(match, name){
      return values[name] == null ? match : String(values[name]);
    });
  }

  function applySnapshot(){
    if (!window.XP || typeof window.XP.getSnapshot !== "function") return;
    const snapshot = window.XP.getSnapshot();
    if (levelEl) levelEl.textContent = snapshot.level;
    if (totalEl) totalEl.textContent = formatNumber(snapshot.totalXp);
    const capText = snapshot.cap == null ? "—" : `${formatNumber(snapshot.cap)} XP`;
    if (capEl) capEl.textContent = capText;
    if (todayEl) todayEl.textContent = formatNumber(snapshot.totalToday);
    if (todayCapEl) todayCapEl.textContent = snapshot.cap == null ? "—" : `${formatNumber(snapshot.cap)} XP`;

    const progressPercent = Math.max(0, Math.min(100, Math.round((snapshot.progress || 0) * 100)));
    if (progressBar) {
      progressBar.setAttribute("aria-valuenow", String(progressPercent));
    }
    if (progressFill) {
      progressFill.style.width = `${progressPercent}%`;
    }
    if (progressDetails) {
      if (snapshot.xpForNextLevel > 0) {
        progressDetails.textContent = tf("xpProgressDetails", {
          current: formatNumber(snapshot.xpIntoLevel),
          total: formatNumber(snapshot.xpForNextLevel),
        }, "{current} / {total} XP to next level");
      } else {
        progressDetails.textContent = t("xpMaximumLevel", "Maximum level achieved");
      }
    }
  }

  function refresh(){
    if (!window.XP || typeof window.XP.refreshStatus !== "function") {
      applySnapshot();
      return;
    }
    window.XP.refreshStatus()
      .then(() => applySnapshot())
      .catch(() => applySnapshot());
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      applySnapshot();
      refresh();
    });
  } else {
    applySnapshot();
    refresh();
  }

  document.addEventListener("langchange", applySnapshot);
})();
