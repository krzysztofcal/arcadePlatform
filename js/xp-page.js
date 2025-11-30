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

  function showLoading(loading) {
    // Show/hide loading state in the UI
    if (dailyRemainingEl) {
      if (loading) {
        dailyRemainingEl.textContent = "Refreshing...";
        dailyRemainingEl.style.opacity = "0.6";
      } else {
        dailyRemainingEl.style.opacity = "1";
      }
    }
  }

  async function applySnapshot(){
    if (!window.XP) return;

    // Use flushAndFetchSnapshot() if available for fresh server data
    let snapshot;
    if (typeof window.XP.flushAndFetchSnapshot === "function") {
      try {
        showLoading(true);
        // Flush pending XP and get fresh server snapshot
        const serverSnapshot = await window.XP.flushAndFetchSnapshot();
        // Get full snapshot with level progression
        if (typeof window.XP.getSnapshot === "function") {
          snapshot = window.XP.getSnapshot();
          // Override with fresh server values
          snapshot.totalToday = serverSnapshot.totalToday;
          snapshot.dailyRemaining = serverSnapshot.dailyRemaining;
          snapshot.cap = serverSnapshot.cap;
          snapshot.totalXp = serverSnapshot.totalLifetime;
        } else {
          snapshot = serverSnapshot;
        }
      } catch (err) {
        if (window.console && console.debug) {
          console.debug('[xp-page] flushAndFetchSnapshot failed, using getSnapshot', err);
        }
        // Fallback to regular snapshot
        if (typeof window.XP.getSnapshot === "function") {
          snapshot = window.XP.getSnapshot();
        }
      } finally {
        showLoading(false);
      }
    } else if (typeof window.XP.getSnapshot === "function") {
      // Fallback for older versions without flush API
      snapshot = window.XP.getSnapshot();
    }

    if (!snapshot) return;

    if (levelEl) levelEl.textContent = snapshot.level || 0;
    if (totalEl) totalEl.textContent = formatNumber(snapshot.totalXp || snapshot.totalLifetime);
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

  async function refresh(){
    if (!window.XP || typeof window.XP.refreshStatus !== "function") {
      await applySnapshot();
      return;
    }
    try {
      await window.XP.refreshStatus();
      await applySnapshot();
    } catch (err) {
      await applySnapshot();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      refresh();
    });
  } else {
    refresh();
  }
})();
