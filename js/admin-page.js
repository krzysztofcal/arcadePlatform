(function(){
  if (typeof window === "undefined" || typeof document === "undefined") return;

  var doc = document;
  var nodes = {};
  var state = {
    adminUserId: null,
    activeTab: "users",
    users: {
      page: 1,
      filters: { sort: "last_activity_desc" },
      items: [],
      pagination: null,
      selectedUserId: null,
      detail: null,
      loaded: false,
    },
    tables: {
      page: 1,
      filters: { status: "OPEN", sort: "last_activity_desc" },
      items: [],
      pagination: null,
      selectedTableId: null,
      detail: null,
      loaded: false,
    },
    ledger: {
      page: 1,
      filters: {},
      items: [],
      pagination: null,
      contextLabel: "",
      loaded: false,
    },
    bonusCampaigns: {
      page: 1,
      filters: {},
      items: [],
      pagination: null,
      selectedCampaignId: null,
      loaded: false,
    },
    ops: {
      summary: null,
      identity: null,
      identityError: null,
      loaded: false,
    },
    pokerAudit: {
      filters: { limit: "20" },
      items: [],
      selectedHand: null,
      loaded: false,
    },
    draftIdempotencyKeys: {},
  };

  function klog(kind, data){
    try {
      if (window.KLog && typeof window.KLog.log === "function"){
        window.KLog.log(kind, data || {});
      }
    } catch (_err){}
  }

  function t(key, fallback){
    try {
      if (window.I18N && typeof window.I18N.t === "function"){
        var value = window.I18N.t(key);
        if (value) return value;
      }
    } catch (_err){}
    return fallback || key;
  }

  function selectNodes(){
    nodes.status = doc.getElementById("adminStatus");
    nodes.unauthorized = doc.getElementById("adminUnauthorized");
    nodes.unauthorizedText = doc.getElementById("adminUnauthorizedText");
    nodes.app = doc.getElementById("adminApp");
    nodes.tabs = Array.prototype.slice.call(doc.querySelectorAll("[data-admin-tab]"));
    nodes.panels = Array.prototype.slice.call(doc.querySelectorAll("[data-admin-panel]"));
    nodes.usersFilters = doc.getElementById("adminUsersFilters");
    nodes.usersBody = doc.getElementById("adminUsersBody");
    nodes.usersEmpty = doc.getElementById("adminUsersEmpty");
    nodes.usersPagination = doc.getElementById("adminUsersPagination");
    nodes.userDetail = doc.getElementById("adminUserDetail");
    nodes.usersRefresh = doc.getElementById("adminUsersRefresh");
    nodes.usersReset = doc.getElementById("adminUsersReset");
    nodes.tablesFilters = doc.getElementById("adminTablesFilters");
    nodes.tablesBody = doc.getElementById("adminTablesBody");
    nodes.tablesEmpty = doc.getElementById("adminTablesEmpty");
    nodes.tablesPagination = doc.getElementById("adminTablesPagination");
    nodes.tableDetail = doc.getElementById("adminTableDetail");
    nodes.tablesRefresh = doc.getElementById("adminTablesRefresh");
    nodes.tablesReset = doc.getElementById("adminTablesReset");
    nodes.ledgerFilters = doc.getElementById("adminLedgerFilters");
    nodes.ledgerBody = doc.getElementById("adminLedgerBody");
    nodes.ledgerEmpty = doc.getElementById("adminLedgerEmpty");
    nodes.ledgerPagination = doc.getElementById("adminLedgerPagination");
    nodes.ledgerDetail = doc.getElementById("adminLedgerDetail");
    nodes.ledgerReset = doc.getElementById("adminLedgerReset");
    nodes.ledgerRecentAdmin = doc.getElementById("adminLedgerRecentAdmin");
    nodes.ledgerQuickButtons = Array.prototype.slice.call(doc.querySelectorAll("[data-ledger-quick]"));
    nodes.bonusCampaignsFilters = doc.getElementById("adminBonusCampaignsFilters");
    nodes.bonusCampaignsBody = doc.getElementById("adminBonusCampaignsBody");
    nodes.bonusCampaignsEmpty = doc.getElementById("adminBonusCampaignsEmpty");
    nodes.bonusCampaignsPagination = doc.getElementById("adminBonusCampaignsPagination");
    nodes.bonusCampaignsRefresh = doc.getElementById("adminBonusCampaignsRefresh");
    nodes.bonusCampaignsReset = doc.getElementById("adminBonusCampaignsReset");
    nodes.bonusCampaignForm = doc.getElementById("adminBonusCampaignForm");
    nodes.bonusCampaignClear = doc.getElementById("adminBonusCampaignClear");
    nodes.pokerAuditFilters = doc.getElementById("adminPokerAuditFilters");
    nodes.pokerAuditBody = doc.getElementById("adminPokerAuditBody");
    nodes.pokerAuditEmpty = doc.getElementById("adminPokerAuditEmpty");
    nodes.pokerAuditDetail = doc.getElementById("adminPokerAuditDetail");
    nodes.pokerAuditRefresh = doc.getElementById("adminPokerAuditRefresh");
    nodes.pokerAuditReset = doc.getElementById("adminPokerAuditReset");
    nodes.opsStats = doc.getElementById("adminOpsStats");
    nodes.opsIdentity = doc.getElementById("adminOpsIdentity");
    nodes.opsRuntime = doc.getElementById("adminOpsRuntime");
    nodes.opsRefresh = doc.getElementById("adminOpsRefresh");
    nodes.opsRunReconciler = doc.getElementById("adminOpsRunReconciler");
    nodes.opsRunStaleSweep = doc.getElementById("adminOpsRunStaleSweep");
    nodes.opsActionResult = doc.getElementById("adminOpsActionResult");
    nodes.opsRecentActions = doc.getElementById("adminOpsRecentActions");
    nodes.opsRecentCleanup = doc.getElementById("adminOpsRecentCleanup");
  }

  function setVisible(node, visible){
    if (!node) return;
    node.hidden = !visible;
  }

  function setStatus(message, tone){
    if (!nodes.status) return;
    nodes.status.textContent = message || "";
    nodes.status.dataset.tone = tone || "";
    nodes.status.hidden = !message;
  }

  function escapeHtml(value){
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatAmount(value){
    var amount = Number(value);
    if (!Number.isFinite(amount)) return "—";
    return amount.toLocaleString();
  }

  function formatSignedAmount(value){
    var amount = Number(value);
    if (!Number.isFinite(amount)) return "—";
    return (amount > 0 ? "+" : "") + amount.toLocaleString();
  }

  function formatTimestamp(value){
    if (!value) return "—";
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    var year = String(date.getFullYear());
    var month = String(date.getMonth() + 1).padStart(2, "0");
    var day = String(date.getDate()).padStart(2, "0");
    var hour = String(date.getHours()).padStart(2, "0");
    var minute = String(date.getMinutes()).padStart(2, "0");
    return year + "-" + month + "-" + day + " " + hour + ":" + minute;
  }

  function formatDateTimeLocalValue(value){
    if (!value) return "";
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    var year = String(date.getFullYear());
    var month = String(date.getMonth() + 1).padStart(2, "0");
    var day = String(date.getDate()).padStart(2, "0");
    var hour = String(date.getHours()).padStart(2, "0");
    var minute = String(date.getMinutes()).padStart(2, "0");
    return year + "-" + month + "-" + day + "T" + hour + ":" + minute;
  }

  function pill(label, tone){
    var className = "admin-pill";
    if (tone){ className += " admin-pill--" + tone; }
    return '<span class="' + className + '">' + escapeHtml(label) + "</span>";
  }

  function getDraftIdempotencyKey(kind){
    var key = String(kind || "admin");
    if (!state.draftIdempotencyKeys[key]){
      state.draftIdempotencyKeys[key] = key + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
    }
    return state.draftIdempotencyKeys[key];
  }

  function resetDraftIdempotencyKey(kind){
    delete state.draftIdempotencyKeys[String(kind || "admin")];
  }

  function getAuthBridge(){
    if (window.SupabaseAuthBridge && typeof window.SupabaseAuthBridge.getAccessToken === "function"){
      return window.SupabaseAuthBridge;
    }
    return null;
  }

  async function getAccessToken(){
    try {
      var bridge = getAuthBridge();
      if (bridge){
        return await bridge.getAccessToken();
      }
      if (window.supabaseClient && window.supabaseClient.auth && typeof window.supabaseClient.auth.getSession === "function"){
        var res = await window.supabaseClient.auth.getSession();
        var session = res && res.data ? res.data.session : null;
        return session && session.access_token ? session.access_token : null;
      }
    } catch (_err){}
    return null;
  }

  async function apiFetch(path, options){
    var token = await getAccessToken();
    if (!token){
      var authErr = new Error("unauthorized");
      authErr.status = 401;
      authErr.code = "unauthorized";
      throw authErr;
    }
    var opts = options || {};
    var headers = Object.assign({}, opts.headers || {}, { Authorization: "Bearer " + token });
    if (opts.body && !headers["Content-Type"] && !headers["content-type"]){
      headers["Content-Type"] = "application/json";
    }
    var res = await fetch(path, Object.assign({}, opts, { headers: headers }));
    var data = {};
    try {
      data = await res.json();
    } catch (_err){}
    if (!res.ok){
      var err = new Error(data && data.error ? String(data.error) : "request_failed");
      err.status = res.status;
      err.code = data && data.error ? data.error : "request_failed";
      err.payload = data || {};
      throw err;
    }
    return data || {};
  }

  function getUnauthorizedMessage(err){
    if (err && err.status === 401){
      return t("adminUnauthorizedSignin", "Sign in with an allowlisted admin account to continue.");
    }
    return t("adminUnauthorized", "This page is available only for allowlisted admin accounts.");
  }

  function showUnauthorized(message){
    setVisible(nodes.app, false);
    setVisible(nodes.unauthorized, true);
    if (nodes.unauthorizedText){
      nodes.unauthorizedText.textContent = message || t("adminUnauthorized", "This page is available only for allowlisted admin accounts.");
    }
  }

  function showApp(){
    setVisible(nodes.unauthorized, false);
    setVisible(nodes.app, true);
  }

  function buildQuery(params){
    var pairs = [];
    Object.keys(params || {}).forEach(function(key){
      var value = params[key];
      if (value == null || value === "" || value === false) return;
      pairs.push(encodeURIComponent(key) + "=" + encodeURIComponent(String(value)));
    });
    return pairs.length ? "?" + pairs.join("&") : "";
  }

  function formToObject(form){
    var output = {};
    if (!form) return output;
    Array.prototype.forEach.call(form.elements || [], function(field){
      if (!field || !field.name || field.disabled) return;
      if ((field.type === "checkbox" || field.type === "radio") && !field.checked) return;
      output[field.name] = field.value;
    });
    return output;
  }

  function applyFiltersToForm(form, values){
    if (!form) return;
    Array.prototype.forEach.call(form.elements || [], function(field){
      if (!field || !field.name) return;
      if (field.type === "checkbox"){
        field.checked = String(values && values[field.name] || "") === "1";
        return;
      }
      field.value = values && values[field.name] != null ? values[field.name] : "";
    });
  }

  function renderPagination(container, scope, pagination){
    if (!container) return;
    if (!pagination || !pagination.total){
      container.innerHTML = "";
      return;
    }
    var parts = [];
    parts.push('<span class="admin-pagination__label">Page ' + escapeHtml(pagination.page) + " / " + escapeHtml(pagination.totalPages || 1) + " · " + escapeHtml(pagination.total) + " total</span>");
    parts.push('<button class="admin-btn admin-btn--ghost" type="button" data-page-scope="' + escapeHtml(scope) + '" data-page="' + escapeHtml(Math.max(1, pagination.page - 1)) + '"' + (pagination.hasPrevPage ? "" : " disabled") + ">Prev</button>");
    parts.push('<button class="admin-btn admin-btn--ghost" type="button" data-page-scope="' + escapeHtml(scope) + '" data-page="' + escapeHtml(pagination.page + 1) + '"' + (pagination.hasNextPage ? "" : " disabled") + ">Next</button>");
    container.innerHTML = parts.join("");
  }

  function campaignStatusTone(status){
    if (status === "active") return "success";
    if (status === "paused" || status === "scheduled") return "info";
    if (status === "ended") return "danger";
    return "";
  }

  function campaignStatusActions(item){
    var status = item && item.status;
    var actions = [];
    actions.push('<button class="admin-btn admin-btn--ghost" type="button" data-campaign-action="edit" data-campaign-id="' + escapeHtml(item.id) + '">Edit draft</button>');
    if (status === "draft" || status === "scheduled" || status === "paused"){
      actions.push('<button class="admin-btn admin-btn--primary" type="button" data-campaign-action="set_status" data-campaign-status="active" data-campaign-id="' + escapeHtml(item.id) + '">Activate</button>');
    }
    if (status === "active"){
      actions.push('<button class="admin-btn admin-btn--ghost" type="button" data-campaign-action="set_status" data-campaign-status="paused" data-campaign-id="' + escapeHtml(item.id) + '">Pause</button>');
    }
    if (status !== "ended"){
      actions.push('<button class="admin-btn admin-btn--ghost" type="button" data-campaign-action="set_status" data-campaign-status="ended" data-campaign-id="' + escapeHtml(item.id) + '">End</button>');
    }
    return actions.join("");
  }

  function renderBonusCampaigns(){
    var items = state.bonusCampaigns.items || [];
    if (nodes.bonusCampaignsBody){
      nodes.bonusCampaignsBody.innerHTML = items.map(function(item){
        var max = item.maxTotalClaims == null ? "∞" : String(item.maxTotalClaims);
        var windowText = formatTimestamp(item.startsAt) + " → " + (item.endsAt ? formatTimestamp(item.endsAt) : "open");
        return [
          "<tr>",
          '<td><div class="admin-list__title"><span>' + escapeHtml(item.code || "—") + '</span></div><div class="admin-list__meta">' + escapeHtml(item.title || "—") + "</div></td>",
          "<td>" + pill(item.status || "—", campaignStatusTone(item.status)) + "</td>",
          "<td>" + escapeHtml(formatAmount(item.amount)) + "</td>",
          "<td>" + escapeHtml(item.claimPolicy || "once") + "</td>",
          "<td>" + escapeHtml(item.eligibilityType || "—") + "</td>",
          "<td>" + escapeHtml(windowText) + "</td>",
          "<td>" + escapeHtml(String(item.claimCount || 0)) + " / " + escapeHtml(max) + "</td>",
          '<td><div class="admin-table__actions">' + campaignStatusActions(item) + "</div></td>",
          "</tr>"
        ].join("");
      }).join("");
    }
    setVisible(nodes.bonusCampaignsEmpty, items.length === 0);
    renderPagination(nodes.bonusCampaignsPagination, "bonusCampaigns", state.bonusCampaigns.pagination);
  }

  function findBonusCampaign(campaignId){
    return (state.bonusCampaigns.items || []).find(function(item){ return item.id === campaignId; }) || null;
  }

  function fillBonusCampaignForm(item){
    var form = nodes.bonusCampaignForm;
    if (!form) return;
    var campaign = item || {};
    Array.prototype.forEach.call(form.elements || [], function(field){
      if (!field || !field.name) return;
      if (field.name === "campaignId") field.value = campaign.id || "";
      if (field.name === "code") {
        field.value = campaign.code || "";
        field.disabled = !!campaign.id;
      }
      if (field.name === "title") field.value = campaign.title || "";
      if (field.name === "description") field.value = campaign.description || "";
      if (field.name === "campaignType") field.value = campaign.campaignType || "";
      if (field.name === "amount") field.value = campaign.amount == null ? "" : String(campaign.amount);
      if (field.name === "startsAt") field.value = formatDateTimeLocalValue(campaign.startsAt);
      if (field.name === "endsAt") field.value = formatDateTimeLocalValue(campaign.endsAt);
      if (field.name === "eligibilityType") field.value = campaign.eligibilityType || "all_accounts";
      if (field.name === "claimPolicy") field.value = campaign.claimPolicy || "once";
      if (field.name === "maxTotalClaims") field.value = campaign.maxTotalClaims == null ? "" : String(campaign.maxTotalClaims);
      if (field.name === "eligibilityConfig") {
        try {
          field.value = JSON.stringify(campaign.eligibilityConfig || {}, null, 2);
        } catch (_err){
          field.value = "{}";
        }
      }
      if (campaign.id && campaign.status !== "draft" && field.name !== "campaignId"){
        field.disabled = true;
      } else if (field.name !== "code" || !campaign.id) {
        field.disabled = false;
      }
    });
    state.bonusCampaigns.selectedCampaignId = campaign.id || null;
  }

  function readBonusCampaignForm(){
    var raw = formToObject(nodes.bonusCampaignForm);
    var config = {};
    try {
      config = raw.eligibilityConfig ? JSON.parse(raw.eligibilityConfig) : {};
    } catch (_err){
      var error = new Error("invalid_eligibility_config");
      error.code = "invalid_eligibility_config";
      throw error;
    }
    return {
      campaignId: raw.campaignId || "",
      code: raw.code || "",
      title: raw.title || "",
      description: raw.description || "",
      campaignType: raw.campaignType || "",
      amount: raw.amount ? Number(raw.amount) : null,
      startsAt: raw.startsAt || "",
      endsAt: raw.endsAt || "",
      eligibilityType: raw.eligibilityType || "all_accounts",
      eligibilityConfig: config,
      claimPolicy: raw.claimPolicy || "once",
      maxTotalClaims: raw.maxTotalClaims ? Number(raw.maxTotalClaims) : null,
    };
  }

  function renderUsers(){
    var items = state.users.items || [];
    if (nodes.usersBody){
      nodes.usersBody.innerHTML = items.map(function(item){
        var actions = [
          '<button class="admin-btn admin-btn--ghost" type="button" data-user-action="details" data-user-id="' + escapeHtml(item.userId) + '">Open details</button>',
          '<button class="admin-btn admin-btn--ghost" type="button" data-user-action="add" data-user-id="' + escapeHtml(item.userId) + '">Add chips</button>',
          '<button class="admin-btn admin-btn--ghost" type="button" data-user-action="remove" data-user-id="' + escapeHtml(item.userId) + '">Remove chips</button>',
          '<button class="admin-btn admin-btn--ghost" type="button" data-user-action="ledger" data-user-id="' + escapeHtml(item.userId) + '">View ledger</button>',
          '<button class="admin-btn admin-btn--ghost" type="button" data-user-action="poker" data-user-id="' + escapeHtml(item.userId) + '">View poker state</button>'
        ].join("");
        return [
          "<tr>",
          "<td>" + escapeHtml(item.email || "—") + "</td>",
          '<td class="admin-mono">' + escapeHtml(item.userId || "—") + "</td>",
          "<td>" + escapeHtml(item.displayName || "—") + "</td>",
          "<td>" + escapeHtml(formatTimestamp(item.createdAt)) + "</td>",
          "<td>" + escapeHtml(formatTimestamp(item.lastSignInAt)) + "</td>",
          "<td>" + escapeHtml(formatAmount(item.balance)) + "</td>",
          "<td>" + escapeHtml(item.activeSeatCount) + "</td>",
          "<td>" + escapeHtml(item.activeTableCount) + "</td>",
          '<td><div class="admin-table__actions">' + actions + "</div></td>",
          "</tr>"
        ].join("");
      }).join("");
    }
    setVisible(nodes.usersEmpty, items.length === 0);
    renderPagination(nodes.usersPagination, "users", state.users.pagination);
  }

  function renderUserDetail(){
    if (!nodes.userDetail) return;
    var detail = state.users.detail;
    if (!detail || !detail.user){
      nodes.userDetail.innerHTML = '<h2 class="xp-card__title">User details</h2><p class="admin-empty">Select a user to inspect balance, ledger, active poker state, and quick actions.</p>';
      return;
    }
    var user = detail.user;
    var recentLedger = (detail.recentLedger && detail.recentLedger.items ? detail.recentLedger.items : []).slice(0, 6);
    var activeTables = detail.activeTables || [];
    var recentPokerActivity = detail.recentPokerActivity || [];
    var activeSeats = detail.activeSeats || [];
    var html = [];
    html.push('<h2 class="xp-card__title">User details</h2>');
    html.push('<div class="admin-surface">');
    html.push('<div class="admin-list__title"><span>' + escapeHtml(user.displayName || user.email || user.userId || "User") + "</span>" + pill(user.activeTableCount > 0 ? "Poker active" : "No active poker", user.activeTableCount > 0 ? "info" : "") + "</div>");
    html.push('<div class="admin-list__meta">' + escapeHtml(user.email || "—") + "</div>");
    html.push('<div class="admin-list__meta admin-mono">' + escapeHtml(user.userId || "—") + "</div>");
    html.push("</div>");
    html.push('<div class="admin-balance"><span class="admin-balance__label">Balance</span><span class="admin-balance__value">' + escapeHtml(formatAmount(detail.balance && detail.balance.balance)) + "</span></div>");
    html.push('<div class="admin-inline-actions">');
    html.push('<button class="admin-btn admin-btn--ghost" type="button" data-copy-text="' + escapeHtml(user.userId || "") + '">Copy userId</button>');
    html.push('<button class="admin-btn admin-btn--ghost" type="button" data-user-action="ledger" data-user-id="' + escapeHtml(user.userId || "") + '">Open ledger mode</button>');
    html.push("</div>");
    html.push('<form class="admin-adjust" id="adminAdjustForm">');
    html.push('<h3 class="admin-section-title">Adjust chips</h3>');
    html.push('<div class="admin-quick">');
    html.push('<button class="admin-btn admin-btn--ghost" type="button" data-adjust-amount="100">+100</button>');
    html.push('<button class="admin-btn admin-btn--ghost" type="button" data-adjust-amount="500">+500</button>');
    html.push('<button class="admin-btn admin-btn--ghost" type="button" data-adjust-amount="1000">+1000</button>');
    html.push('<button class="admin-btn admin-btn--ghost" type="button" data-adjust-amount="-100">-100</button>');
    html.push('<button class="admin-btn admin-btn--ghost" type="button" data-adjust-amount="-500">-500</button>');
    html.push("</div>");
    html.push('<label class="admin-field"><span class="admin-field__label">Amount</span><input class="admin-input" id="adminAdjustAmount" name="amount" type="number" step="1" required></label>');
    html.push('<label class="admin-field"><span class="admin-field__label">Reason</span><textarea class="admin-input" id="adminAdjustReason" name="reason" rows="4" placeholder="Audit reason required" required></textarea></label>');
    html.push('<p class="admin-note" id="adminAdjustPreview">Preview: enter amount and reason to generate a ledger adjustment.</p>');
    html.push('<div class="admin-inline-actions"><button class="admin-btn admin-btn--primary" type="submit">Apply adjustment</button></div>');
    html.push("</form>");
    html.push('<div class="admin-stack">');
    html.push('<div><h3 class="admin-section-title">Recent ledger</h3>' + renderMiniList(recentLedger.map(function(entry){
      var desc = entry.description || (entry.metadata && entry.metadata.reason) || entry.reference || "Ledger entry";
      return {
        title: escapeHtml((entry.tx_type || "ENTRY") + " · " + formatSignedAmount(entry.amount)),
        meta: escapeHtml(formatTimestamp(entry.display_created_at || entry.tx_created_at || entry.created_at) + " · " + desc),
      };
    })) + "</div>");
    html.push('<div><h3 class="admin-section-title">Active tables</h3>' + renderMiniList(activeTables.map(function(table){
      return {
        title: escapeHtml((table.tableId || "table") + " · " + (table.stakesLabel || "—")),
        meta: escapeHtml((table.phase || "HAND_DONE") + " · " + formatTimestamp(table.lastActivityAt)),
      };
    })) + "</div>");
    html.push('<div><h3 class="admin-section-title">Active seats</h3>' + renderMiniList(activeSeats.map(function(seat){
      return {
        title: escapeHtml((seat.tableId || "table") + " · seat " + (seat.seatNo || "—") + " · stack " + formatAmount(seat.stack)),
        meta: escapeHtml((seat.phase || "HAND_DONE") + " · last seen " + formatTimestamp(seat.lastSeenAt)),
      };
    })) + "</div>");
    html.push('<div><h3 class="admin-section-title">Recent poker activity</h3>' + renderMiniList(recentPokerActivity.map(function(action){
      return {
        title: escapeHtml((action.actionType || "ACTION") + (action.tableId ? " · " + action.tableId : "")),
        meta: escapeHtml(formatTimestamp(action.createdAt) + (action.handId ? " · " + action.handId : "")),
      };
    })) + "</div>");
    html.push("</div>");
    nodes.userDetail.innerHTML = html.join("");
  }

  function renderTables(){
    var items = state.tables.items || [];
    if (nodes.tablesBody){
      nodes.tablesBody.innerHTML = items.map(function(item){
        var janitor = item.janitor || {};
        var janitorLabel = janitor.healthy === false ? (janitor.reasonCode || janitor.classification || "attention") : (janitor.reasonCode || "healthy");
        var actions = [
          '<button class="admin-btn admin-btn--ghost" type="button" data-table-action="details" data-table-id="' + escapeHtml(item.tableId) + '">Open details</button>',
          '<button class="admin-btn admin-btn--ghost" type="button" data-table-action="evaluate" data-table-id="' + escapeHtml(item.tableId) + '">Evaluate janitor</button>',
          '<button class="admin-btn admin-btn--ghost" type="button" data-table-action="stale_seat_cleanup" data-table-id="' + escapeHtml(item.tableId) + '">Stale-seat cleanup</button>',
          '<button class="admin-btn admin-btn--ghost" type="button" data-table-action="reconcile" data-table-id="' + escapeHtml(item.tableId) + '">Reconcile</button>',
          '<button class="admin-btn admin-btn--danger" type="button" data-table-action="force_close" data-table-id="' + escapeHtml(item.tableId) + '">Force close</button>'
        ].join("");
        return [
          "<tr>",
          '<td class="admin-mono">' + escapeHtml(item.tableId || "—") + "</td>",
          "<td>" + escapeHtml(item.status || "—") + "</td>",
          "<td>" + escapeHtml(item.stakesLabel || "—") + "</td>",
          "<td>" + escapeHtml(item.playerCount) + "</td>",
          "<td>" + escapeHtml(item.humanCount) + "</td>",
          "<td>" + escapeHtml(item.botCount) + "</td>",
          "<td>" + escapeHtml(item.phase || "HAND_DONE") + "</td>",
          "<td>" + escapeHtml(formatTimestamp(item.lastActivityAt)) + "</td>",
          "<td>" + (janitor.healthy === false ? pill(janitorLabel, "danger") : pill(janitorLabel, "success")) + "</td>",
          '<td><div class="admin-table__actions">' + actions + "</div></td>",
          "</tr>"
        ].join("");
      }).join("");
    }
    setVisible(nodes.tablesEmpty, items.length === 0);
    renderPagination(nodes.tablesPagination, "tables", state.tables.pagination);
  }

  function renderTableDetail(){
    if (!nodes.tableDetail) return;
    var detail = state.tables.detail;
    if (!detail || !detail.table){
      nodes.tableDetail.innerHTML = '<h2 class="xp-card__title">Table details</h2><p class="admin-empty">Select a table to inspect seats, runtime hints, janitor evaluation, and cleanup history.</p>';
      return;
    }
    var table = detail.table;
    var janitor = detail.janitor || {};
    var html = [];
    html.push('<h2 class="xp-card__title">Table details</h2>');
    html.push('<div class="admin-surface">');
    html.push('<div class="admin-list__title"><span class="admin-mono">' + escapeHtml(table.tableId || "—") + "</span>" + (table.persistedStatus === "CLOSED" ? pill("Closed", "danger") : pill("Open", "success")) + "</div>");
    html.push('<div class="admin-list__meta">Runtime: ' + escapeHtml(table.runtimeStatus || "unknown") + " · Last activity: " + escapeHtml(formatTimestamp(table.lastActivityAt)) + "</div>");
    html.push("</div>");
    html.push('<div class="admin-kv">');
    html.push(renderKvRow("Stakes", table.stakesLabel || "—"));
    html.push(renderKvRow("Players", String(table.playerCount || 0)));
    html.push(renderKvRow("Humans", String(table.humanCount || 0)));
    html.push(renderKvRow("Bots", String(table.botCount || 0)));
    html.push(renderKvRow("Phase", table.phase || "HAND_DONE"));
    html.push(renderKvRow("Turn user", table.turnUserId || "—"));
    html.push(renderKvRow("State version", table.stateVersion == null ? "—" : String(table.stateVersion)));
    html.push(renderKvRow("Janitor", (janitor.classification || "healthy") + (janitor.reasonCode ? " · " + janitor.reasonCode : "")));
    html.push("</div>");
    html.push('<label class="admin-field"><span class="admin-field__label">Custom reason (optional)</span><textarea class="admin-input" id="adminTableReason" rows="3" placeholder="Optional note for cleanup / force close audit"></textarea></label>');
    html.push('<div class="admin-inline-actions">');
    html.push('<button class="admin-btn admin-btn--ghost" type="button" data-table-action="evaluate" data-table-id="' + escapeHtml(table.tableId || "") + '">Evaluate janitor</button>');
    html.push('<button class="admin-btn admin-btn--ghost" type="button" data-table-action="stale_seat_cleanup" data-table-id="' + escapeHtml(table.tableId || "") + '">Stale-seat cleanup</button>');
    html.push('<button class="admin-btn admin-btn--ghost" type="button" data-table-action="reconcile" data-table-id="' + escapeHtml(table.tableId || "") + '">Reconcile</button>');
    html.push('<button class="admin-btn admin-btn--danger" type="button" data-table-action="force_close" data-table-id="' + escapeHtml(table.tableId || "") + '">Force close</button>');
    html.push("</div>");
    html.push('<p class="admin-note' + (janitor.healthy === false ? " admin-note--danger" : "") + '">Recommended action: ' + escapeHtml(janitor.action || "noop") + (janitor.reasonCode ? " · " + escapeHtml(janitor.reasonCode) : "") + "</p>");
    html.push('<div><h3 class="admin-section-title">Seats</h3>' + renderMiniList((detail.seats || []).map(function(seat){
      var label = (seat.userId || "user") + " · seat " + (seat.seatNo || "—") + " · " + (seat.isBot ? "bot" : "human");
      return {
        title: escapeHtml(label),
        meta: escapeHtml((seat.status || "—") + " · stack " + formatAmount(seat.stack) + " · last seen " + formatTimestamp(seat.lastSeenAt)),
      };
    })) + "</div>");
    html.push('<div><h3 class="admin-section-title">Recent admin actions</h3>' + renderMiniList((detail.recentAdminActions || []).map(function(item){
      return {
        title: escapeHtml((item.actionType || "ACTION") + " · " + formatTimestamp(item.createdAt)),
        meta: escapeHtml((item.requestId || "no-request-id") + (item.meta && item.meta.result && item.meta.result.status ? " · " + item.meta.result.status : "")),
      };
    })) + "</div>");
    html.push('<div><h3 class="admin-section-title">Cleanup transactions</h3>' + renderMiniList((detail.recentCleanupTransactions || []).map(function(item){
      var reason = item.metadata && item.metadata.reason ? item.metadata.reason : item.description || "TABLE_CASH_OUT";
      return {
        title: escapeHtml((item.txType || "TABLE_CASH_OUT") + " · " + (item.userId || "—")),
        meta: escapeHtml(formatTimestamp(item.createdAt) + " · " + reason),
      };
    })) + "</div>");
    nodes.tableDetail.innerHTML = html.join("");
  }

  function renderLedger(){
    var items = state.ledger.items || [];
    if (nodes.ledgerBody){
      nodes.ledgerBody.innerHTML = items.map(function(item){
        var detail = item.description || (item.metadata && item.metadata.reason) || item.reference || "—";
        var copyButtons = [];
        copyButtons.push('<button class="admin-btn admin-btn--ghost" type="button" data-copy-text="' + escapeHtml(item.transactionId || "") + '">Copy tx id</button>');
        if (item.idempotencyKey){
          copyButtons.push('<button class="admin-btn admin-btn--ghost" type="button" data-copy-text="' + escapeHtml(item.idempotencyKey) + '">Copy key</button>');
        }
        if (item.reference){
          copyButtons.push('<button class="admin-btn admin-btn--ghost" type="button" data-copy-text="' + escapeHtml(item.reference) + '">Copy ref</button>');
        }
        return [
          "<tr>",
          "<td>" + escapeHtml(formatTimestamp(item.displayCreatedAt)) + "</td>",
          "<td>" + escapeHtml(item.txType || "—") + "</td>",
          "<td>" + escapeHtml(item.email || item.displayName || item.userId || "—") + '<div class="admin-note admin-mono">' + escapeHtml(item.userId || "—") + "</div></td>",
          "<td>" + escapeHtml(detail) + "</td>",
          '<td><div class="admin-inline-actions">' + copyButtons.join("") + "</div><div class=\"admin-note admin-mono\">" + escapeHtml(item.idempotencyKey || item.reference || "—") + "</div></td>",
          "<td>" + escapeHtml(item.source || "—") + "</td>",
          '<td class="' + (Number(item.amount) > 0 ? "admin-amount--positive" : Number(item.amount) < 0 ? "admin-amount--negative" : "") + '">' + escapeHtml(formatSignedAmount(item.amount)) + "</td>",
          "</tr>"
        ].join("");
      }).join("");
    }
    setVisible(nodes.ledgerEmpty, items.length === 0);
    renderPagination(nodes.ledgerPagination, "ledger", state.ledger.pagination);
    renderLedgerDetail();
  }

  function renderLedgerDetail(){
    if (!nodes.ledgerDetail) return;
    var filters = state.ledger.filters || {};
    var html = [];
    html.push('<h2 class="xp-card__title">Ledger context</h2>');
    if (state.ledger.contextLabel){
      html.push('<div class="admin-surface"><div class="admin-list__title"><span>' + escapeHtml(state.ledger.contextLabel) + '</span>' + pill("Selected-user mode", "info") + '<div class="admin-list__meta">Filters are currently narrowed to one user.</div></div></div>');
    } else {
      html.push('<p class="admin-empty">Global mode is active. Use quick filters or jump from Users to narrow the audit trail.</p>');
    }
    html.push('<div class="admin-kv">');
    html.push(renderKvRow("txType", filters.txType || "—"));
    html.push(renderKvRow("userId", filters.userId || "—"));
    html.push(renderKvRow("source", filters.source || "—"));
    html.push(renderKvRow("positiveOnly", filters.positiveOnly === "1" ? "yes" : "no"));
    html.push(renderKvRow("negativeOnly", filters.negativeOnly === "1" ? "yes" : "no"));
    html.push(renderKvRow("adminOnly", filters.adminOnly === "1" ? "yes" : "no"));
    html.push("</div>");
    nodes.ledgerDetail.innerHTML = html.join("");
  }

  function joinList(values){
    if (!Array.isArray(values) || !values.length) return "—";
    return values.map(function(value){ return String(value == null ? "" : value); }).filter(Boolean).join(", ") || "—";
  }

  function normalizeCardCode(value){
    return String(value == null ? "" : value).trim().toUpperCase();
  }

  function cardSymbolParts(value){
    var code = normalizeCardCode(value);
    if (!code) return null;
    var suit = code.slice(-1);
    var rank = code.slice(0, -1);
    var suits = { S: "♠", H: "♥", D: "♦", C: "♣" };
    if (!suits[suit] || !rank) return { label: code, red: false };
    return { label: rank + suits[suit], red: suit === "H" || suit === "D" };
  }

  function renderCardPill(card){
    var parts = cardSymbolParts(card);
    var label = parts ? parts.label : normalizeCardCode(card);
    var className = "admin-pill admin-mono admin-card-symbol" + (parts && parts.red ? " admin-card-symbol--red" : "");
    return '<span class="' + className + '" title="' + escapeHtml(normalizeCardCode(card)) + '">' + escapeHtml(label) + "</span>";
  }

  function renderCardCodes(cards){
    if (!Array.isArray(cards) || !cards.length) return '<p class="admin-empty">No board recorded.</p>';
    return '<div class="admin-inline-actions">' + cards.map(renderCardPill).join("") + "</div>";
  }

  function renderSourcePill(source){
    var normalized = String(source || "").toLowerCase();
    if (normalized === "bot") normalized = "bot_autoplay";
    if (normalized === "audit") normalized = "system";
    var label = normalized || "—";
    var tone = normalized === "human" ? "info" : normalized === "bot_autoplay" ? "success" : normalized === "timeout" ? "danger" : "";
    return pill(label, tone);
  }

  function formatEvaluatedHandLabel(item){
    if (!item) return "evaluated";
    var name = item.name || "category";
    if (item.category != null) return name + " (category " + item.category + ")";
    return name;
  }

  function formatAuditRange(before, after){
    return formatAmount(before) + " → " + formatAmount(after);
  }

  function isSettlementLinkedAction(action){
    return action && action.actionType !== "HAND_SETTLED" && action.phaseTo === "SETTLED";
  }

  function renderPokerAudit(){
    var items = state.pokerAudit.items || [];
    if (nodes.pokerAuditBody){
      nodes.pokerAuditBody.innerHTML = items.map(function(item){
        return [
          "<tr>",
          "<td>" + escapeHtml(formatTimestamp(item.settledAt || item.startedAt)) + "</td>",
          '<td class="admin-mono">' + escapeHtml(item.tableId || "—") + "</td>",
          '<td class="admin-mono">' + escapeHtml(item.handId || "—") + "</td>",
          "<td>" + escapeHtml(formatAmount(item.actionCount)) + "</td>",
          "<td>" + escapeHtml(joinList(item.winnerUserIds || [])) + "</td>",
          "<td>" + escapeHtml(formatAmount(item.potTotal)) + "</td>",
          "<td>" + (item.hasSettlement ? pill("Settled", "success") : pill("Settlement missing", "danger")) + "</td>",
          '<td><button class="admin-btn admin-btn--primary" type="button" aria-label="View poker audit details for hand ' + escapeHtml(item.handId || "") + '" data-audit-action="details" data-audit-table-id="' + escapeHtml(item.tableId || "") + '" data-audit-hand-id="' + escapeHtml(item.handId || "") + '">View details</button></td>',
          "</tr>"
        ].join("");
      }).join("");
    }
    if (nodes.pokerAuditEmpty){
      nodes.pokerAuditEmpty.textContent = state.pokerAudit.loaded ? "No poker audit hands matched the current filters." : "Enter a tableId or handId to search poker audit rows.";
    }
    setVisible(nodes.pokerAuditEmpty, items.length === 0);
    renderPokerAuditDetail();
  }

  function renderPokerAuditDetail(){
    if (!nodes.pokerAuditDetail) return;
    var hand = state.pokerAudit.selectedHand;
    if (!hand){
      nodes.pokerAuditDetail.innerHTML = '<h2 class="xp-card__title">Hand audit</h2><p class="admin-empty">Select a hand to inspect actions, board, payouts, pots, and evaluated hands.</p>';
      return;
    }
    var settlement = hand.settlement || null;
    var payouts = settlement && settlement.payoutByUserId ? settlement.payoutByUserId : {};
    var payoutRows = Object.keys(payouts).sort().map(function(userId){
      return { title: escapeHtml(userId), meta: escapeHtml("payout " + formatAmount(payouts[userId])) };
    });
    var potRows = settlement && Array.isArray(settlement.potsAwarded) ? settlement.potsAwarded.map(function(pot){
      return {
        title: escapeHtml("pot " + formatAmount(pot && pot.amount)),
        meta: escapeHtml("eligible " + joinList(pot && pot.eligibleUserIds || []) + " · winners " + joinList(pot && pot.winners || [])),
      };
    }) : [];
    var evaluatedRows = settlement && Array.isArray(settlement.evaluatedHands) ? settlement.evaluatedHands.map(function(item){
      return {
        title: escapeHtml((item && item.userId || "user") + " · " + formatEvaluatedHandLabel(item)),
        meta: escapeHtml("ranks " + joinList(item && item.ranks || []) + " · best " + joinList(item && item.bestFiveCards || [])),
      };
    }) : [];
    var timelineRows = Array.isArray(hand.timeline) ? hand.timeline : (Array.isArray(hand.actions) ? hand.actions : []);
    var privateCards = hand.privateCardsByUserId && typeof hand.privateCardsByUserId === "object" ? hand.privateCardsByUserId : null;
    var privateCardRows = privateCards ? Object.keys(privateCards).sort().map(function(userId){
      return { title: escapeHtml(userId), meta: renderCardCodes(privateCards[userId]) };
    }) : [];
    var html = [];
    html.push('<h2 class="xp-card__title">Hand audit</h2>');
    html.push('<div class="admin-surface">');
    html.push('<div class="admin-list__title"><span class="admin-mono">' + escapeHtml(hand.handId || "—") + "</span>" + (hand.hasSettlement ? pill("Settled", "success") : pill("Settlement missing", "danger")) + "</div>");
    html.push('<div class="admin-list__meta admin-mono">' + escapeHtml(hand.tableId || "—") + "</div>");
    html.push("</div>");
    html.push('<div class="admin-kv">');
    html.push(renderKvRow("tableId", hand.tableId || "—"));
    html.push(renderKvRow("handId", hand.handId || "—"));
    html.push(renderKvRow("Started", formatTimestamp(hand.startedAt)));
    html.push(renderKvRow("Settled", settlement ? formatTimestamp(settlement.settledAt || hand.settledAt) : "Settlement missing"));
    html.push(renderKvRow("Reason", settlement && settlement.reason ? settlement.reason : "—"));
    html.push(renderKvRow("Total payout", settlement ? formatAmount(settlement.payoutTotal) : "—"));
    html.push("</div>");
    html.push('<div><h3 class="admin-section-title">Board</h3>' + renderCardCodes(settlement && settlement.communityCards || []) + "</div>");
    html.push('<div><h3 class="admin-section-title">Winners / payouts</h3>' + renderMiniList(payoutRows) + "</div>");
    html.push('<div><h3 class="admin-section-title">Pots</h3>' + renderMiniList(potRows) + "</div>");
    html.push('<div><h3 class="admin-section-title">Evaluated hands</h3>' + renderMiniList(evaluatedRows) + "</div>");
    html.push('<div><h3 class="admin-section-title">Private cards</h3>');
    html.push('<p class="admin-note admin-note--danger">Private cards are sensitive. Reveal only for audit/debugging.</p>');
    if (privateCards){
      html.push(renderMiniList(privateCardRows.length ? privateCardRows : [{ title: escapeHtml("Private cards unavailable"), meta: escapeHtml("No stored cards were found for this hand.") }]));
    } else {
      html.push('<p class="admin-empty">Hidden by default.</p>');
      html.push('<div class="admin-inline-actions"><button class="admin-btn admin-btn--danger" type="button" data-audit-action="reveal-private" data-audit-table-id="' + escapeHtml(hand.tableId || "") + '" data-audit-hand-id="' + escapeHtml(hand.handId || "") + '">Reveal private cards</button></div>');
    }
    html.push("</div>");
    html.push('<div><h3 class="admin-section-title">Action timeline</h3>');
    if (!timelineRows.length){
      html.push('<p class="admin-empty">No actions found.</p>');
    } else {
      if (Array.isArray(hand.actions) && hand.actions.length === 0){
        html.push('<p class="admin-empty">No accepted action rows found.</p>');
      }
      html.push('<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th scope="col">Version</th><th scope="col">Phase</th><th scope="col">Source</th><th scope="col">User</th><th scope="col">Action</th><th scope="col">Amount</th><th scope="col">Pot / payout</th><th scope="col">Stack / winners</th></tr></thead><tbody>');
      html.push(timelineRows.map(function(action){
        var settlementRow = action.actionType === "HAND_SETTLED";
        var linkedSettlement = isSettlementLinkedAction(action);
        var potText = settlementRow
          ? ("payout " + formatAmount(action.payoutTotal))
          : linkedSettlement
            ? "see HAND_SETTLED"
            : formatAuditRange(action.potTotalBefore, action.potTotalAfter);
        var stackText = settlementRow
          ? ("winners " + joinList(action.winnerUserIds || []))
          : linkedSettlement
            ? "settled separately"
            : formatAuditRange(action.actorStackBefore, action.actorStackAfter);
        return [
          "<tr>",
          "<td>" + escapeHtml(action.version == null ? "—" : action.version) + "</td>",
          "<td>" + escapeHtml((action.phaseFrom || "—") + " → " + (action.phaseTo || "—")) + "</td>",
          "<td>" + renderSourcePill(action.source || (settlementRow ? "system" : "")) + "</td>",
          '<td class="admin-mono">' + escapeHtml(action.userId || "—") + "</td>",
          "<td>" + escapeHtml(action.actionType || "—") + (settlementRow && action.reason ? '<div class="admin-note">' + escapeHtml(action.reason) + "</div>" : "") + "</td>",
          "<td>" + escapeHtml(formatAmount(action.amount)) + "</td>",
          "<td>" + escapeHtml(potText) + "</td>",
          "<td>" + escapeHtml(stackText) + "</td>",
          "</tr>"
        ].join("");
      }).join(""));
      html.push("</tbody></table></div>");
    }
    html.push("</div>");
    nodes.pokerAuditDetail.innerHTML = html.join("");
  }

  function renderOps(){
    var summary = state.ops.summary;
    var identity = state.ops.identity;
    if (!summary && !identity){
      if (nodes.opsStats) nodes.opsStats.innerHTML = "";
      if (nodes.opsIdentity) nodes.opsIdentity.innerHTML = "";
      if (nodes.opsRuntime) nodes.opsRuntime.innerHTML = "";
      if (nodes.opsRecentActions) nodes.opsRecentActions.innerHTML = "";
      if (nodes.opsRecentCleanup) nodes.opsRecentCleanup.innerHTML = "";
      return;
    }
    if (nodes.opsIdentity){
      if (!identity){
        var message = state.ops.identityError ? "Stage identity unavailable: " + state.ops.identityError : "Stage identity not loaded.";
        nodes.opsIdentity.innerHTML = '<p class="admin-empty">' + escapeHtml(message) + "</p>";
      } else {
        var target = identity.databaseTarget || "unknown";
        var targetTone = target === "stage" ? "success" : target === "production" ? "danger" : "info";
        nodes.opsIdentity.innerHTML = [
          '<div class="admin-surface">',
          '<div class="admin-list__title"><span>Database target</span>' + pill(target, targetTone) + "</div>",
          '<div class="admin-kv">',
          renderKvRow("Environment context", identity.environmentContext || "unknown"),
          renderKvRow("Supabase project ref", identity.supabaseProjectRef || "unknown"),
          renderKvRow("Expected stage ref", identity.expectedStageProjectRef || "not configured"),
          renderKvRow("Stage ref match", identity.stageProjectRefMatches ? "yes" : "no"),
          renderKvRow("Service role project ref", identity.serviceRoleProjectRef || "unknown"),
          renderKvRow("Service role stage match", identity.serviceRoleStageProjectRefMatches ? "yes" : "no"),
          renderKvRow("CHIPS_ENABLED", identity.chipsEnabled ? "on" : "off"),
          "</div>",
          "</div>"
        ].join("");
      }
    }
    if (nodes.opsStats){
      if (!summary){
        nodes.opsStats.innerHTML = "";
      } else {
      nodes.opsStats.innerHTML = [
        renderStat("OPEN tables", summary.janitor && summary.janitor.openTableCount),
        renderStat("Stale human seats", summary.janitor && summary.janitor.staleHumanSeatCount),
        renderStat("Idle OPEN tables", summary.janitor && summary.janitor.staleOpenTableCount),
        renderStat("Flagged tables", summary.janitor && summary.janitor.flaggedTableCount)
      ].join("");
      }
    }
    if (nodes.opsRuntime){
      if (!summary){
        nodes.opsRuntime.innerHTML = "";
      } else {
      var runtime = summary.runtime || {};
      nodes.opsRuntime.innerHTML = [
        '<div class="admin-kv">',
        renderKvRow("Build", runtime.buildId || "—"),
        renderKvRow("CHIPS_ENABLED", runtime.chipsEnabled ? "on" : "off"),
        renderKvRow("ADMIN_USER_IDS", runtime.adminUserIdsConfigured ? "configured" : "missing"),
        renderKvRow("WS health", runtime.wsHealth && runtime.wsHealth.ok === true ? "healthy" : runtime.wsHealth && runtime.wsHealth.available ? "degraded" : "unknown"),
        renderKvRow("Runtime health", runtime.healthy ? "healthy" : "attention"),
        renderKvRow("Active seat freshness", runtime.janitorConfig ? String(runtime.janitorConfig.activeSeatFreshMs) + "ms" : "—"),
        renderKvRow("Reconnect grace", runtime.janitorConfig ? String(runtime.janitorConfig.seatedReconnectGraceMs) + "ms" : "—"),
        renderKvRow("Close grace", runtime.janitorConfig ? String(runtime.janitorConfig.tableCloseGraceMs) + "ms" : "—"),
        renderKvRow("Live-hand stale", runtime.janitorConfig ? String(runtime.janitorConfig.liveHandStaleMs) + "ms" : "—"),
        "</div>"
      ].join("");
      }
    }
    if (nodes.opsRecentActions){
      nodes.opsRecentActions.innerHTML = summary ? renderMiniList((summary.recentJanitorActivity && summary.recentJanitorActivity.adminActions || []).map(function(item){
        var result = item.meta && item.meta.result ? item.meta.result.status : "—";
        return {
          title: escapeHtml((item.actionType || "ACTION") + " · " + formatTimestamp(item.createdAt)),
          meta: escapeHtml((item.tableId || "—") + " · " + result),
        };
      })) : "";
    }
    if (nodes.opsRecentCleanup){
      nodes.opsRecentCleanup.innerHTML = summary ? renderMiniList((summary.recentJanitorActivity && summary.recentJanitorActivity.cleanupTransactions || []).map(function(item){
        var reason = item.metadata && item.metadata.reason ? item.metadata.reason : item.description || "TABLE_CASH_OUT";
        return {
          title: escapeHtml((item.txType || "TABLE_CASH_OUT") + " · " + formatTimestamp(item.createdAt)),
          meta: escapeHtml((item.userId || "—") + " · " + reason),
        };
      })) : "";
    }
  }

  function renderStat(label, value){
    return '<div class="admin-stat"><span class="admin-stat__label">' + escapeHtml(label) + '</span><span class="admin-stat__value">' + escapeHtml(value == null ? "—" : String(value)) + "</span></div>";
  }

  function renderKvRow(label, value){
    return '<div class="admin-kv__row"><span class="admin-kv__label">' + escapeHtml(label) + '</span><span class="admin-kv__value">' + escapeHtml(value == null ? "—" : String(value)) + "</span></div>";
  }

  function renderMiniList(items){
    if (!items || !items.length){
      return '<p class="admin-empty">No data.</p>';
    }
    return '<div class="admin-list">' + items.map(function(item){
      return '<div class="admin-list__item"><div class="admin-list__title"><span>' + item.title + '</span></div><div class="admin-list__meta">' + item.meta + "</div></div>";
    }).join("") + "</div>";
  }

  function closestEventTarget(target, selector){
    var node = target;
    if (!node) return null;
    if (node.nodeType && node.nodeType !== 1){
      node = node.parentElement || node.parentNode || null;
    }
    if (!node || typeof node.closest !== "function") return null;
    return node.closest(selector);
  }

  function findTabButton(tab){
    return (nodes.tabs || []).find(function(button){
      return button.getAttribute("data-admin-tab") === tab;
    }) || null;
  }

  function focusTab(tab){
    var button = typeof tab === "string" ? findTabButton(tab) : tab;
    if (button && typeof button.focus === "function"){
      button.focus();
    }
  }

  function moveTabFocus(currentTab, direction){
    var tabs = nodes.tabs || [];
    var currentIndex = tabs.findIndex(function(button){
      return button.getAttribute("data-admin-tab") === currentTab;
    });
    if (currentIndex < 0 || !tabs.length) return;
    var nextIndex = currentIndex + direction;
    if (nextIndex < 0){
      nextIndex = tabs.length - 1;
    } else if (nextIndex >= tabs.length){
      nextIndex = 0;
    }
    focusTab(tabs[nextIndex]);
  }

  function renderTabs(){
    (nodes.tabs || []).forEach(function(button){
      var isActive = button.getAttribute("data-admin-tab") === state.activeTab;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-selected", isActive ? "true" : "false");
      button.setAttribute("tabindex", isActive ? "0" : "-1");
    });
    (nodes.panels || []).forEach(function(panel){
      var isActive = panel.getAttribute("data-admin-panel") === state.activeTab;
      setVisible(panel, isActive);
      panel.setAttribute("aria-hidden", isActive ? "false" : "true");
    });
  }

  function setActiveTab(tab){
    if (!tab || state.activeTab === tab && tab !== "ops") {
      renderTabs();
      return;
    }
    state.activeTab = tab;
    renderTabs();
    if (tab === "users" && !state.users.loaded) loadUsers();
    if (tab === "tables" && !state.tables.loaded) loadTables();
    if (tab === "ledger" && !state.ledger.loaded) loadLedger();
    if (tab === "bonusCampaigns" && !state.bonusCampaigns.loaded) loadBonusCampaigns();
    if (tab === "pokerAudit") renderPokerAudit();
    if (tab === "ops") loadOps();
  }

  async function checkAccess(){
    setStatus(t("adminChecking", "Checking admin access..."), "info");
    try {
      var me = await apiFetch("/.netlify/functions/admin-me", { method: "GET" });
      state.adminUserId = me.userId || null;
      showApp();
      setStatus("", "");
      loadUsers();
    } catch (err){
      state.adminUserId = null;
      showUnauthorized(getUnauthorizedMessage(err));
      setStatus("", "");
    }
  }

  async function loadUsers(page){
    if (page) state.users.page = page;
    setStatus(t("loading", "Loading..."), "info");
    try {
      var params = Object.assign({}, state.users.filters, {
        page: state.users.page,
        limit: 20,
      });
      var payload = await apiFetch("/.netlify/functions/admin-users-list" + buildQuery(params), { method: "GET" });
      state.users.items = payload.items || [];
      state.users.pagination = payload.pagination || null;
      state.users.loaded = true;
      renderUsers();
      setStatus("", "");
      if (state.users.selectedUserId && !state.users.detail){
        loadUserDetail(state.users.selectedUserId, true);
      }
    } catch (err){
      handleApiError(err, "Could not load users.");
    }
  }

  async function loadBonusCampaigns(page){
    if (page) state.bonusCampaigns.page = page;
    setStatus(t("loading", "Loading..."), "info");
    try {
      var params = Object.assign({}, state.bonusCampaigns.filters, {
        page: state.bonusCampaigns.page,
        limit: 25,
      });
      var payload = await apiFetch("/.netlify/functions/admin-bonus-campaigns" + buildQuery(params), { method: "GET" });
      state.bonusCampaigns.items = payload.items || [];
      state.bonusCampaigns.pagination = payload.pagination || null;
      state.bonusCampaigns.loaded = true;
      renderBonusCampaigns();
      setStatus("", "");
    } catch (err){
      handleApiError(err, "Could not load bonus campaigns.");
    }
  }

  async function saveBonusCampaignDraft(event){
    if (event && typeof event.preventDefault === "function") event.preventDefault();
    try {
      var data = readBonusCampaignForm();
      var isUpdate = !!data.campaignId;
      var campaign = {
        title: data.title,
        description: data.description,
        campaignType: data.campaignType,
        amount: data.amount,
        startsAt: data.startsAt,
        endsAt: data.endsAt,
        eligibilityType: data.eligibilityType,
        eligibilityConfig: data.eligibilityConfig,
        claimPolicy: data.claimPolicy,
        maxTotalClaims: data.maxTotalClaims,
      };
      if (!isUpdate) campaign.code = data.code;
      await apiFetch("/.netlify/functions/admin-bonus-campaigns", {
        method: "POST",
        body: JSON.stringify({
          action: isUpdate ? "update" : "create",
          campaignId: data.campaignId || undefined,
          campaign: campaign,
        }),
      });
      setStatus(isUpdate ? "Bonus campaign draft updated." : "Bonus campaign draft created.", "success");
      fillBonusCampaignForm(null);
      state.bonusCampaigns.page = 1;
      await loadBonusCampaigns(1);
    } catch (err){
      handleApiError(err, err && err.code === "invalid_eligibility_config" ? "Eligibility config must be valid JSON object." : "Could not save bonus campaign.");
    }
  }

  async function setBonusCampaignStatus(campaignId, status){
    var campaign = findBonusCampaign(campaignId);
    var label = campaign ? (campaign.code || campaign.title || campaignId) : campaignId;
    if (typeof window.confirm === "function" && !window.confirm("Set bonus campaign " + label + " to " + status + "?")){
      return;
    }
    setStatus("Updating bonus campaign...", "info");
    try {
      await apiFetch("/.netlify/functions/admin-bonus-campaigns", {
        method: "POST",
        body: JSON.stringify({
          action: "set_status",
          campaignId: campaignId,
          status: status,
        }),
      });
      setStatus("Bonus campaign status updated.", "success");
      await loadBonusCampaigns();
    } catch (err){
      handleApiError(err, "Could not update bonus campaign status.");
    }
  }

  function findUserListItem(userId){
    return (state.users.items || []).find(function(item){ return item.userId === userId; }) || null;
  }

  async function loadUserDetail(userId, silent){
    if (!userId) return;
    state.users.selectedUserId = userId;
    if (!silent){
      setStatus(t("loading", "Loading..."), "info");
    }
    try {
      var payload = await apiFetch("/.netlify/functions/admin-user-details?userId=" + encodeURIComponent(userId), { method: "GET" });
      state.users.detail = payload;
      renderUserDetail();
      setStatus("", "");
    } catch (err){
      handleApiError(err, "Could not load user details.");
    }
  }

  async function loadTables(page){
    if (page) state.tables.page = page;
    setStatus(t("loading", "Loading..."), "info");
    try {
      var params = Object.assign({}, state.tables.filters, {
        page: state.tables.page,
        limit: 20,
      });
      var payload = await apiFetch("/.netlify/functions/admin-tables-list" + buildQuery(params), { method: "GET" });
      state.tables.items = payload.items || [];
      state.tables.pagination = payload.pagination || null;
      state.tables.loaded = true;
      renderTables();
      setStatus("", "");
    } catch (err){
      handleApiError(err, "Could not load tables.");
    }
  }

  async function loadTableDetail(tableId, silent){
    if (!tableId) return;
    state.tables.selectedTableId = tableId;
    if (!silent){
      setStatus(t("loading", "Loading..."), "info");
    }
    try {
      var payload = await apiFetch("/.netlify/functions/admin-table-details?tableId=" + encodeURIComponent(tableId), { method: "GET" });
      state.tables.detail = payload;
      renderTableDetail();
      setStatus("", "");
    } catch (err){
      handleApiError(err, "Could not load table details.");
    }
  }

  async function evaluateTable(tableId){
    setStatus(t("loading", "Loading..."), "info");
    try {
      var payload = await apiFetch("/.netlify/functions/admin-table-evaluate?tableId=" + encodeURIComponent(tableId), { method: "GET" });
      setStatus("Janitor: " + (payload.janitor && payload.janitor.reasonCode ? payload.janitor.reasonCode : payload.janitor && payload.janitor.classification ? payload.janitor.classification : "ok"), payload.janitor && payload.janitor.healthy === false ? "error" : "success");
      loadTableDetail(tableId, true);
      loadTables();
    } catch (err){
      handleApiError(err, "Could not evaluate table.");
    }
  }

  async function runTableAction(tableId, action){
    var reasonNode = doc.getElementById("adminTableReason");
    var customReason = reasonNode && typeof reasonNode.value === "string" ? reasonNode.value.trim() : "";
    var reason = customReason || "manual " + action;
    if (action === "force_close"){
      var confirmText = "Force close table " + tableId + "?\n\nThis bypasses normal janitor safety routing.";
      if (window.confirm && !window.confirm(confirmText)){
        return;
      }
      if (window.prompt){
        var entered = window.prompt("Type FORCE CLOSE to confirm closing " + tableId, "");
        if (String(entered || "").trim().toUpperCase() !== "FORCE CLOSE"){
          setStatus("Force close cancelled.", "info");
          return;
        }
      }
      if (!customReason){
        reason = "manual force close";
      }
    }
    setStatus(t("loading", "Loading..."), "info");
    try {
      if (action === "force_close"){
        await apiFetch("/.netlify/functions/admin-table-force-close", {
          method: "POST",
          body: JSON.stringify({
            tableId: tableId,
            reason: reason,
            idempotencyKey: getDraftIdempotencyKey("table-force-" + tableId),
            confirmAction: "force_close",
            confirmationToken: "force-close:" + tableId
          }),
        });
        resetDraftIdempotencyKey("table-force-" + tableId);
      } else {
        await apiFetch("/.netlify/functions/admin-table-cleanup", {
          method: "POST",
          body: JSON.stringify({
            tableId: tableId,
            action: action,
            reason: reason,
            idempotencyKey: getDraftIdempotencyKey("table-" + action + "-" + tableId),
          }),
        });
        resetDraftIdempotencyKey("table-" + action + "-" + tableId);
      }
      setStatus("Table action completed.", "success");
      loadTables();
      loadTableDetail(tableId, true);
      loadOps();
    } catch (err){
      handleApiError(err, "Could not run table action.");
    }
  }

  async function loadLedger(page){
    if (page) state.ledger.page = page;
    setStatus(t("loading", "Loading..."), "info");
    try {
      var params = Object.assign({}, state.ledger.filters, {
        page: state.ledger.page,
        limit: 25,
      });
      var payload = await apiFetch("/.netlify/functions/admin-ledger-list" + buildQuery(params), { method: "GET" });
      state.ledger.items = payload.items || [];
      state.ledger.pagination = payload.pagination || null;
      state.ledger.loaded = true;
      renderLedger();
      setStatus("", "");
    } catch (err){
      handleApiError(err, "Could not load ledger.");
    }
  }

  async function loadPokerAudit(options){
    var opts = options || {};
    if (opts.filters){
      state.pokerAudit.filters = opts.filters;
    }
    var filters = state.pokerAudit.filters || {};
    if (!filters.tableId && !filters.handId){
      state.pokerAudit.items = [];
      state.pokerAudit.selectedHand = null;
      state.pokerAudit.loaded = false;
      renderPokerAudit();
      setStatus("Enter a tableId or handId.", "error");
      return;
    }
    setStatus(t("loading", "Loading..."), "info");
    try {
      var query = Object.assign({}, filters);
      if (opts.revealPrivateCards) query.revealPrivateCards = "1";
      var payload = await apiFetch("/.netlify/functions/admin-poker-audit" + buildQuery(query), { method: "GET" });
      state.pokerAudit.items = payload.hands || [];
      state.pokerAudit.selectedHand = payload.selectedHand || opts.selectedHand || null;
      state.pokerAudit.loaded = true;
      renderPokerAudit();
      setStatus("", "");
    } catch (err){
      handleApiError(err, "Could not load poker audit.");
    }
  }

  async function loadPokerAuditHand(tableId, handId, revealPrivateCards){
    if (!handId) return;
    var filters = {
      tableId: tableId || "",
      handId: handId,
      limit: state.pokerAudit.filters && state.pokerAudit.filters.limit ? state.pokerAudit.filters.limit : "20"
    };
    await loadPokerAudit({ filters: filters, revealPrivateCards: revealPrivateCards === true });
  }

  async function revealPokerAuditPrivateCards(tableId, handId){
    if (!handId) return;
    if (window.confirm && !window.confirm("Reveal private cards for this hand?\n\nPrivate cards are sensitive. Reveal only for audit/debugging.")){
      return;
    }
    await loadPokerAuditHand(tableId, handId, true);
  }

  async function submitAdjustForm(event){
    event.preventDefault();
    if (!state.users.detail || !state.users.detail.user){
      setStatus("Select a user first.", "error");
      return;
    }
    var form = event.target;
    var amountInput = form.querySelector('[name="amount"]');
    var reasonInput = form.querySelector('[name="reason"]');
    var amount = Number(amountInput && amountInput.value);
    var reason = reasonInput && reasonInput.value ? reasonInput.value.trim() : "";
    if (!Number.isInteger(amount) || amount === 0){
      setStatus("Enter a non-zero whole amount.", "error");
      return;
    }
    if (!reason){
      setStatus("Reason is required.", "error");
      return;
    }
    var preview = "Apply " + formatSignedAmount(amount) + " to " + (state.users.detail.user.email || state.users.detail.user.userId) + "?\nReason: " + reason;
    if (amount < 0 && window.confirm && !window.confirm(preview)){
      return;
    }
    setStatus(t("loading", "Loading..."), "info");
    try {
      await apiFetch("/.netlify/functions/admin-ledger-adjust", {
        method: "POST",
        body: JSON.stringify({
          userId: state.users.detail.user.userId,
          amount: amount,
          reason: reason,
          idempotencyKey: getDraftIdempotencyKey("adjust-" + state.users.detail.user.userId),
        }),
      });
      resetDraftIdempotencyKey("adjust-" + state.users.detail.user.userId);
      if (amountInput) amountInput.value = "";
      if (reasonInput) reasonInput.value = "";
      setStatus("Adjustment saved.", "success");
      loadUserDetail(state.users.detail.user.userId, true);
      if (state.ledger.loaded){
        loadLedger();
      }
    } catch (err){
      handleApiError(err, "Could not save the adjustment.");
    }
  }

  async function loadOps(){
    setStatus(t("loading", "Loading..."), "info");
    try {
      var results = await Promise.allSettled([
        apiFetch("/.netlify/functions/admin-stage-identity", { method: "GET" }),
        apiFetch("/.netlify/functions/admin-ops-summary", { method: "GET" })
      ]);
      if (results[0].status === "fulfilled"){
        state.ops.identity = results[0].value || null;
        state.ops.identityError = null;
      } else {
        state.ops.identity = null;
        state.ops.identityError = results[0].reason && results[0].reason.code ? results[0].reason.code : "request_failed";
        klog("admin_stage_identity_load_failed", { code: state.ops.identityError });
      }
      if (results[1].status !== "fulfilled"){
        throw results[1].reason || new Error("request_failed");
      }
      var payload = results[1].value || {};
      state.ops.summary = payload;
      state.ops.loaded = true;
      renderOps();
      setStatus("", "");
    } catch (err){
      handleApiError(err, "Could not load ops summary.");
    }
  }

  async function runOpsAction(action){
    setStatus(t("loading", "Loading..."), "info");
    try {
      var payload = await apiFetch("/.netlify/functions/admin-ops-actions", {
        method: "POST",
        body: JSON.stringify({
          action: action,
          idempotencyKey: getDraftIdempotencyKey("ops-" + action),
          reason: "manual " + action,
        }),
      });
      resetDraftIdempotencyKey("ops-" + action);
      if (nodes.opsActionResult){
        nodes.opsActionResult.innerHTML = '<div class="admin-surface"><div class="admin-list__title"><span>' + escapeHtml(action) + '</span>' + pill(payload.changedCount > 0 ? "changed" : "noop", payload.changedCount > 0 ? "success" : "info") + '</div><div class="admin-list__meta">Processed ' + escapeHtml(payload.processed) + " tables, changed " + escapeHtml(payload.changedCount) + ".</div></div>";
      }
      setStatus("Ops action completed.", "success");
      loadOps();
      loadTables();
    } catch (err){
      handleApiError(err, "Could not run ops action.");
    }
  }

  function handleApiError(err, fallback){
    if (err && (err.status === 401 || err.status === 403)){
      showUnauthorized(getUnauthorizedMessage(err));
      setStatus("", "");
      return;
    }
    klog("admin_page_error", { message: err && err.message ? String(err.message) : "error", code: err && err.code ? err.code : null });
    setStatus((err && err.code ? err.code + ": " : "") + (fallback || "Request failed."), "error");
  }

  function handleUsersSubmit(event){
    event.preventDefault();
    state.users.filters = formToObject(nodes.usersFilters);
    state.users.page = 1;
    loadUsers();
  }

  function handleTablesSubmit(event){
    event.preventDefault();
    state.tables.filters = formToObject(nodes.tablesFilters);
    state.tables.page = 1;
    loadTables();
  }

  function handleLedgerSubmit(event){
    event.preventDefault();
    state.ledger.filters = formToObject(nodes.ledgerFilters);
    state.ledger.page = 1;
    state.ledger.contextLabel = state.ledger.filters.userId ? "Filtered to user " + state.ledger.filters.userId : "";
    loadLedger();
  }

  function handlePokerAuditSubmit(event){
    event.preventDefault();
    state.pokerAudit.filters = formToObject(nodes.pokerAuditFilters);
    if (!state.pokerAudit.filters.limit) state.pokerAudit.filters.limit = "20";
    loadPokerAudit();
  }

  function resetForm(form, defaults){
    if (!form) return;
    form.reset();
    applyFiltersToForm(form, defaults || {});
  }

  async function copyText(text){
    if (!text || !navigator || !navigator.clipboard || typeof navigator.clipboard.writeText !== "function"){
      setStatus("Clipboard is not available.", "error");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setStatus("Copied.", "success");
    } catch (_err){
      setStatus("Copy failed.", "error");
    }
  }

  function handleUserAction(action, userId){
    var user = findUserListItem(userId);
    if (!user && state.users.detail && state.users.detail.user && state.users.detail.user.userId === userId){
      user = state.users.detail.user;
    }
    if (action === "details" || action === "poker"){
      setActiveTab("users");
      loadUserDetail(userId);
      return;
    }
    if (action === "add" || action === "remove"){
      setActiveTab("users");
      loadUserDetail(userId).then(function(){
        var amountInput = doc.getElementById("adminAdjustAmount");
        var reasonInput = doc.getElementById("adminAdjustReason");
        if (amountInput){
          amountInput.value = action === "add" ? "100" : "-100";
          amountInput.focus();
        }
        if (reasonInput && !reasonInput.value){
          reasonInput.value = action === "add" ? "manual top-up" : "manual correction";
        }
      });
      return;
    }
    if (action === "ledger"){
      setActiveTab("ledger");
      state.ledger.filters = { userId: userId };
      state.ledger.page = 1;
      state.ledger.contextLabel = user && (user.email || user.displayName) ? "Ledger for " + (user.email || user.displayName) : "Ledger for " + userId;
      applyFiltersToForm(nodes.ledgerFilters, state.ledger.filters);
      loadLedger();
    }
  }

  function handleTableAction(action, tableId){
    if (action === "details"){
      setActiveTab("tables");
      loadTableDetail(tableId);
      return;
    }
    if (action === "evaluate"){
      setActiveTab("tables");
      evaluateTable(tableId);
      return;
    }
    setActiveTab("tables");
    runTableAction(tableId, action);
  }

  function handleAuditAction(action, tableId, handId){
    if (action === "details"){
      setActiveTab("pokerAudit");
      loadPokerAuditHand(tableId, handId);
      return;
    }
    if (action === "reveal-private"){
      setActiveTab("pokerAudit");
      revealPokerAuditPrivateCards(tableId, handId);
    }
  }

  function handleTabClick(event){
    if (event && typeof event.preventDefault === "function"){
      event.preventDefault();
    }
    var tabButton = closestEventTarget(event && event.target ? event.target : event && event.currentTarget ? event.currentTarget : null, "[data-admin-tab]");
    if (!tabButton) return;
    setActiveTab(tabButton.getAttribute("data-admin-tab"));
  }

  function handleTabKeydown(event){
    var tabButton = closestEventTarget(event && event.target ? event.target : null, "[data-admin-tab]");
    if (!tabButton) return;
    var tab = tabButton.getAttribute("data-admin-tab");
    if (event.key === "ArrowRight" || event.key === "ArrowDown"){
      event.preventDefault();
      moveTabFocus(tab, 1);
      return;
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowUp"){
      event.preventDefault();
      moveTabFocus(tab, -1);
      return;
    }
    if (event.key === "Home"){
      event.preventDefault();
      focusTab((nodes.tabs || [])[0]);
      return;
    }
    if (event.key === "End"){
      event.preventDefault();
      focusTab((nodes.tabs || [])[Math.max(0, (nodes.tabs || []).length - 1)]);
      return;
    }
    if (event.key === "Enter" || event.key === " "){
      event.preventDefault();
      setActiveTab(tab);
    }
  }

  function handleBonusCampaignsSubmit(event){
    if (event && typeof event.preventDefault === "function") event.preventDefault();
    state.bonusCampaigns.filters = formToObject(nodes.bonusCampaignsFilters);
    state.bonusCampaigns.page = 1;
    loadBonusCampaigns();
  }

  function handleCampaignAction(action, campaignId, status){
    if (action === "edit"){
      var campaign = findBonusCampaign(campaignId);
      fillBonusCampaignForm(campaign);
      if (campaign && campaign.status !== "draft"){
        setStatus("Only draft campaigns can be edited. Use status controls for active campaigns.", "info");
      }
      return;
    }
    if (action === "set_status"){
      setBonusCampaignStatus(campaignId, status);
    }
  }

  function wireStaticEvents(){
    (nodes.tabs || []).forEach(function(button){
      button.addEventListener("click", handleTabClick);
      button.addEventListener("keydown", handleTabKeydown);
    });
    if (nodes.usersFilters) nodes.usersFilters.addEventListener("submit", handleUsersSubmit);
    if (nodes.tablesFilters) nodes.tablesFilters.addEventListener("submit", handleTablesSubmit);
    if (nodes.ledgerFilters) nodes.ledgerFilters.addEventListener("submit", handleLedgerSubmit);
    if (nodes.bonusCampaignsFilters) nodes.bonusCampaignsFilters.addEventListener("submit", handleBonusCampaignsSubmit);
    if (nodes.bonusCampaignForm) nodes.bonusCampaignForm.addEventListener("submit", saveBonusCampaignDraft);
    if (nodes.pokerAuditFilters) nodes.pokerAuditFilters.addEventListener("submit", handlePokerAuditSubmit);
    if (nodes.usersRefresh) nodes.usersRefresh.addEventListener("click", function(){ loadUsers(); });
    if (nodes.tablesRefresh) nodes.tablesRefresh.addEventListener("click", function(){ loadTables(); });
    if (nodes.bonusCampaignsRefresh) nodes.bonusCampaignsRefresh.addEventListener("click", function(){ loadBonusCampaigns(); });
    if (nodes.pokerAuditRefresh) nodes.pokerAuditRefresh.addEventListener("click", function(){ loadPokerAudit(); });
    if (nodes.opsRefresh) nodes.opsRefresh.addEventListener("click", function(){ loadOps(); });
    if (nodes.usersReset) nodes.usersReset.addEventListener("click", function(){
      resetForm(nodes.usersFilters, { sort: "last_activity_desc" });
      state.users.filters = { sort: "last_activity_desc" };
      state.users.page = 1;
      loadUsers();
    });
    if (nodes.tablesReset) nodes.tablesReset.addEventListener("click", function(){
      resetForm(nodes.tablesFilters, { status: "OPEN", sort: "last_activity_desc" });
      state.tables.filters = { status: "OPEN", sort: "last_activity_desc" };
      state.tables.page = 1;
      loadTables();
    });
    if (nodes.ledgerReset) nodes.ledgerReset.addEventListener("click", function(){
      resetForm(nodes.ledgerFilters, {});
      state.ledger.filters = {};
      state.ledger.page = 1;
      state.ledger.contextLabel = "";
      loadLedger();
    });
    if (nodes.bonusCampaignsReset) nodes.bonusCampaignsReset.addEventListener("click", function(){
      resetForm(nodes.bonusCampaignsFilters, {});
      state.bonusCampaigns.filters = {};
      state.bonusCampaigns.page = 1;
      loadBonusCampaigns();
    });
    if (nodes.bonusCampaignClear) nodes.bonusCampaignClear.addEventListener("click", function(){
      fillBonusCampaignForm(null);
      setStatus("", "");
    });
    if (nodes.pokerAuditReset) nodes.pokerAuditReset.addEventListener("click", function(){
      resetForm(nodes.pokerAuditFilters, { limit: "20" });
      state.pokerAudit.filters = { limit: "20" };
      state.pokerAudit.items = [];
      state.pokerAudit.selectedHand = null;
      state.pokerAudit.loaded = false;
      renderPokerAudit();
      setStatus("", "");
    });
    if (nodes.ledgerRecentAdmin) nodes.ledgerRecentAdmin.addEventListener("click", function(){
      state.ledger.filters = { adminOnly: "1" };
      state.ledger.page = 1;
      state.ledger.contextLabel = "Recent admin actions";
      applyFiltersToForm(nodes.ledgerFilters, state.ledger.filters);
      loadLedger();
    });
    (nodes.ledgerQuickButtons || []).forEach(function(button){
      button.addEventListener("click", function(){
        var txType = button.getAttribute("data-ledger-quick") || "";
        state.ledger.filters = { txType: txType };
        state.ledger.page = 1;
        state.ledger.contextLabel = "Quick filter: " + txType;
        applyFiltersToForm(nodes.ledgerFilters, state.ledger.filters);
        loadLedger();
      });
    });
    if (nodes.opsRunReconciler) nodes.opsRunReconciler.addEventListener("click", function(){ runOpsAction("open_table_reconciler"); });
    if (nodes.opsRunStaleSweep) nodes.opsRunStaleSweep.addEventListener("click", function(){ runOpsAction("stale_seat_sweep"); });
    doc.addEventListener("click", function(event){
      var pageButton = closestEventTarget(event.target, "[data-page-scope]");
      if (pageButton){
        var scope = pageButton.getAttribute("data-page-scope");
        var page = Number(pageButton.getAttribute("data-page"));
        if (scope === "users") loadUsers(page);
        if (scope === "tables") loadTables(page);
        if (scope === "ledger") loadLedger(page);
        if (scope === "bonusCampaigns") loadBonusCampaigns(page);
        return;
      }
      var userButton = closestEventTarget(event.target, "[data-user-action]");
      if (userButton){
        handleUserAction(userButton.getAttribute("data-user-action"), userButton.getAttribute("data-user-id"));
        return;
      }
      var tableButton = closestEventTarget(event.target, "[data-table-action]");
      if (tableButton){
        handleTableAction(tableButton.getAttribute("data-table-action"), tableButton.getAttribute("data-table-id"));
        return;
      }
      var auditButton = closestEventTarget(event.target, "[data-audit-action]");
      if (auditButton){
        handleAuditAction(auditButton.getAttribute("data-audit-action"), auditButton.getAttribute("data-audit-table-id"), auditButton.getAttribute("data-audit-hand-id"));
        return;
      }
      var campaignButton = closestEventTarget(event.target, "[data-campaign-action]");
      if (campaignButton){
        handleCampaignAction(
          campaignButton.getAttribute("data-campaign-action"),
          campaignButton.getAttribute("data-campaign-id"),
          campaignButton.getAttribute("data-campaign-status")
        );
        return;
      }
      var adjustButton = closestEventTarget(event.target, "[data-adjust-amount]");
      if (adjustButton){
        var input = doc.getElementById("adminAdjustAmount");
        if (input){
          input.value = adjustButton.getAttribute("data-adjust-amount") || "";
          resetDraftIdempotencyKey("adjust-" + (state.users.detail && state.users.detail.user ? state.users.detail.user.userId : "current"));
        }
        return;
      }
      var copyButton = closestEventTarget(event.target, "[data-copy-text]");
      if (copyButton){
        copyText(copyButton.getAttribute("data-copy-text"));
      }
    });
    doc.addEventListener("submit", function(event){
      var form = event.target;
      if (form && form.id === "adminAdjustForm"){
        submitAdjustForm(event);
      }
    });
    doc.addEventListener("input", function(event){
      var target = event.target;
      if (target && (target.id === "adminAdjustAmount" || target.id === "adminAdjustReason") && state.users.detail && state.users.detail.user){
        resetDraftIdempotencyKey("adjust-" + state.users.detail.user.userId);
        var amount = Number(doc.getElementById("adminAdjustAmount") && doc.getElementById("adminAdjustAmount").value);
        var reason = doc.getElementById("adminAdjustReason") && doc.getElementById("adminAdjustReason").value ? doc.getElementById("adminAdjustReason").value.trim() : "";
        var preview = doc.getElementById("adminAdjustPreview");
        if (preview){
          if (Number.isInteger(amount) && amount !== 0){
            preview.textContent = "Preview: " + formatSignedAmount(amount) + " for " + (state.users.detail.user.email || state.users.detail.user.userId) + (reason ? " · " + reason : "");
          } else {
            preview.textContent = "Preview: enter amount and reason to generate a ledger adjustment.";
          }
        }
      }
    });
  }

  function wireAuthChanges(){
    if (!window.SupabaseAuth || typeof window.SupabaseAuth.onAuthChange !== "function") return;
    window.SupabaseAuth.onAuthChange(function(){
      state.users.detail = null;
      state.tables.detail = null;
      state.ledger.contextLabel = "";
      state.pokerAudit.selectedHand = null;
      checkAccess();
    });
  }

  function init(){
    selectNodes();
    renderTabs();
    applyFiltersToForm(nodes.usersFilters, state.users.filters);
    applyFiltersToForm(nodes.tablesFilters, state.tables.filters);
    applyFiltersToForm(nodes.pokerAuditFilters, state.pokerAudit.filters);
    wireStaticEvents();
    wireAuthChanges();
    checkAccess();
  }

  if (doc.readyState === "loading"){
    doc.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
