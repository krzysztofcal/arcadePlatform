(function(){
  const levelEl = document.getElementById("xpLevel");
  const totalEl = document.getElementById("xpTotal");
  const capEl = document.getElementById("xpDailyCap");
  const dailyRemainingEl = document.getElementById("xpDailyRemaining");
  const todayEl = document.getElementById("xpToday");
  const todayCapEl = document.getElementById("xpTodayCap");
  const progressBar = document.querySelector(".xp-progress__bar");
  const progressFill = document.getElementById("xpProgressFill");
  const progressDetails = document.getElementById("xpProgressDetails");

  function formatNumber(value){
    const num = Number(value) || 0;
    return num.toLocaleString();
  }

  function applySnapshot(){
    if (!window.XP || typeof window.XP.getSnapshot !== "function") return;
    const snapshot = window.XP.getSnapshot();
    if (levelEl) levelEl.textContent = snapshot.level;
    if (totalEl) totalEl.textContent = formatNumber(snapshot.totalXp);
    const capText = snapshot.cap == null ? "—" : `${formatNumber(snapshot.cap)} XP`;
    if (capEl) capEl.textContent = capText;
    const remainingText = snapshot.dailyRemaining === Infinity ? "—" : `${formatNumber(snapshot.dailyRemaining)} XP`;
    if (dailyRemainingEl) dailyRemainingEl.textContent = remainingText;
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
        progressDetails.textContent = `${formatNumber(snapshot.xpIntoLevel)} / ${formatNumber(snapshot.xpForNextLevel)} XP to next level`;
      } else {
        progressDetails.textContent = "Maximum level achieved";
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
})();
