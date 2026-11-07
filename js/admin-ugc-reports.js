(function(){
  if (typeof window === "undefined" || typeof document === "undefined") return;

  // #1140 UGC phase C: the "Reports" tab of admin.html. The pending counter and the queue are read only when the
  // admin panel opens, the tab is shown or the admin presses Refresh; there is no polling, notification or job.
  // Everything is rendered as text nodes: report data comes from players.
  var doc = document;
  var ENDPOINT = "/.netlify/functions/admin-ugc-reports";
  var REASONS = {
    inappropriate_avatar: "Inappropriate avatar",
    inappropriate_name: "Inappropriate name",
    harassment: "Harassment",
    cheating: "Cheating",
    spam: "Spam",
    other: "Other"
  };
  var RESOLUTIONS = {
    no_action: "Resolved without action",
    avatar_hidden: "Avatar hidden",
    profile_restricted: "Profile restricted"
  };
  var ERRORS = {
    report_already_decided: "This report was already decided by another admin. The list was refreshed.",
    report_not_found: "This report no longer exists (the reported account was deleted). The list was refreshed.",
    profile_restriction_unavailable: "Profile restriction is not available yet (needs the public profile block migration). Nothing was changed.",
    profile_not_found: "The reported profile no longer exists. Nothing was changed.",
    not_found: "Report moderation is not enabled on this environment."
  };
  var deps = null;
  var nodes = {};
  var state = { status: "pending", reports: [], next: null, generation: 0, busy: false };

  function node(id){
    if (!nodes[id]) nodes[id] = doc.getElementById(id);
    return nodes[id];
  }

  function el(tag, className, text){
    var item = doc.createElement(tag);
    if (className) item.className = className;
    if (text != null) item.textContent = String(text);
    return item;
  }

  function setMessage(text){
    var message = node("adminUgcReportsMessage");
    if (message) message.textContent = text || "";
  }

  function setCounter(count){
    var counter = node("adminUgcPendingCount");
    if (!counter) return;
    var value = Number(count);
    if (!Number.isFinite(value) || value <= 0){
      counter.textContent = "";
      counter.hidden = true;
      return;
    }
    counter.textContent = value > 99 ? "99+" : String(value);
    counter.hidden = false;
  }

  function formatTime(value){
    var date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : date.toLocaleString();
  }

  function errorText(err){
    var code = err && err.code;
    if (code && ERRORS[code]) return ERRORS[code];
    return "Reports could not be loaded or changed. Try again.";
  }

  function identity(name, handle){
    var label = name || "(no name)";
    return handle ? label + " (@" + handle + ")" : label;
  }

  function actionButton(label, className, onClick){
    var button = el("button", className, label);
    button.type = "button";
    button.addEventListener("click", function(){ onClick(button); });
    return button;
  }

  async function submit(button, body, question){
    if (state.busy) return;
    if (!window.confirm(question)) return;
    state.busy = true;
    button.disabled = true;
    try {
      await deps.apiFetch(ENDPOINT, { method: "POST", body: JSON.stringify(body) });
      setMessage("Saved.");
    } catch (err){
      setMessage(errorText(err));
    } finally {
      state.busy = false;
    }
    await load({ keepMessage: true });
  }

  function renderReport(report){
    var target = report.target || {};
    var evidence = report.evidence || {};
    var item = el("article", "admin-list__item");
    var title = el("div", "admin-list__title");
    title.appendChild(el("span", "", REASONS[report.reason] || report.reason));
    title.appendChild(el("span", "admin-pill" + (report.status === "pending" ? " admin-pill--danger" : " admin-pill--success"), report.status === "pending" ? "Pending" : (RESOLUTIONS[report.resolution] || "Dismissed")));
    item.appendChild(title);
    item.appendChild(el("p", "admin-list__meta", "Reported " + formatTime(report.createdAt) + (report.context === "table" ? " at a poker table" + (report.tableId ? " " + report.tableId : "") : " on the public profile")));
    item.appendChild(el("p", "admin-list__meta", "At report time: " + identity(evidence.displayName, evidence.handle) + (evidence.avatarKey ? ", uploaded avatar" : ", Arcade avatar")));
    item.appendChild(el("p", "admin-list__meta", "Now: " + identity(target.displayName, target.handle) + (target.hasUploadedAvatar ? ", uploaded avatar" : ", Arcade avatar") + (target.avatarHeld ? ", avatar hidden by a moderator" : "") + " · open reports: " + (target.openReports || 0)));
    item.appendChild(el("p", "admin-list__meta", "User ID: " + (target.userId || "")));
    if (report.resolvedAt) item.appendChild(el("p", "admin-list__meta", "Decided " + formatTime(report.resolvedAt)));
    var actions = el("div", "admin-table__actions");
    if (report.status === "pending"){
      actions.appendChild(actionButton("Resolve, no action", "admin-btn admin-btn--ghost", function(button){
        submit(button, { reportId: report.id, decision: "resolved", action: "none" }, "Resolve this report without changing the profile?");
      }));
      actions.appendChild(actionButton("Hide avatar", "admin-btn admin-btn--danger", function(button){
        submit(button, { reportId: report.id, decision: "resolved", action: "hide_avatar" }, "Hide this player's uploaded avatar and show the Arcade avatar instead?");
      }));
      actions.appendChild(actionButton("Restrict profile", "admin-btn admin-btn--danger", function(button){
        submit(button, { reportId: report.id, decision: "resolved", action: "restrict_profile" }, "Hide this player's public profile?");
      }));
      actions.appendChild(actionButton("Dismiss", "admin-btn admin-btn--ghost", function(button){
        submit(button, { reportId: report.id, decision: "dismissed" }, "Dismiss this report as not breaking the rules?");
      }));
    } else if (report.resolution === "profile_restricted" && target.userId){
      actions.appendChild(actionButton("Restore profile", "admin-btn admin-btn--ghost", function(button){
        submit(button, { action: "unrestrict_profile", userId: target.userId }, "Make this player's public profile visible again?");
      }));
    }
    if (actions.childNodes.length) item.appendChild(actions);
    return item;
  }

  function render(){
    var list = node("adminUgcReportsList");
    if (!list) return;
    while (list.firstChild) list.removeChild(list.firstChild);
    state.reports.forEach(function(report){ list.appendChild(renderReport(report)); });
    var more = node("adminUgcReportsMore");
    if (more) more.hidden = !state.next;
  }

  // Reads the queue for the selected status; the response also carries the pending counter.
  async function load(options){
    if (!deps) return;
    var opts = options || {};
    var generation = ++state.generation;
    var query = "?status=" + encodeURIComponent(state.status) + (opts.append && state.next ? "&after=" + encodeURIComponent(state.next) : "");
    if (!opts.keepMessage) setMessage("Loading...");
    try {
      var data = await deps.apiFetch(ENDPOINT + query, { method: "GET" });
      if (generation !== state.generation) return;
      setCounter(data.pendingCount);
      var reports = Array.isArray(data.reports) ? data.reports : [];
      state.reports = opts.append ? state.reports.concat(reports) : reports;
      state.next = data.next || null;
      render();
      if (!opts.keepMessage) setMessage(state.reports.length ? "" : "No reports with this status.");
    } catch (err){
      if (generation !== state.generation) return;
      if (err && err.code === "not_found") setCounter(0);
      state.reports = [];
      state.next = null;
      render();
      setMessage(errorText(err));
    }
  }

  // Called by admin-page.js after admin access is confirmed: one read for the tab counter.
  async function refreshCount(){
    if (!deps) return;
    try {
      var data = await deps.apiFetch(ENDPOINT + "?status=pending&limit=1", { method: "GET" });
      setCounter(data.pendingCount);
    } catch (_err){
      setCounter(0);
    }
  }

  function attach(options){
    if (deps || !options || typeof options.apiFetch !== "function") return;
    deps = { apiFetch: options.apiFetch };
    var status = node("adminUgcReportsStatus");
    if (status) status.addEventListener("change", function(){ state.status = status.value; state.next = null; load(); });
    var refresh = node("adminUgcReportsRefresh");
    if (refresh) refresh.addEventListener("click", function(){ state.next = null; load(); });
    var more = node("adminUgcReportsMore");
    if (more) more.addEventListener("click", function(){ load({ append: true }); });
  }

  function reset(){
    state.generation += 1;
    state.reports = [];
    state.next = null;
    render();
    setCounter(0);
    setMessage("");
  }

  window.AdminUgcReports = { attach: attach, load: load, refreshCount: refreshCount, reset: reset };
})();
