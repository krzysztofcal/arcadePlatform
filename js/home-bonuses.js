(function(){
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  var panel = document.getElementById('homeBonuses');
  var list = document.getElementById('homeBonusesList');
  var status = document.getElementById('homeBonusesStatus');
  var loading = false;

  function t(key, fallback){ try { return window.I18N && window.I18N.t ? (window.I18N.t(key) || fallback) : fallback; } catch (_err){ return fallback; } }
  function tf(key, values, fallback){ try { return window.I18N && window.I18N.format ? (window.I18N.format(key, values) || fallback.replace('{amount}', values.amount)) : fallback.replace('{amount}', values.amount); } catch (_err){ return fallback.replace('{amount}', values.amount); } }
  function setStatus(message, tone){ if (!status) return; status.textContent = message || ''; status.dataset.tone = tone || ''; }
  function amount(value){ var parsed = Number(value); return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed).toLocaleString() : '0'; }
  function claimable(items){ return Array.isArray(items) ? items.filter(function(item){ return item && item.code && item.eligible && !item.alreadyClaimed; }) : []; }

  function render(items){
    var campaigns = claimable(items);
    list.textContent = '';
    panel.hidden = campaigns.length === 0;
    campaigns.forEach(function(item){
      var row = document.createElement('article'); row.className = 'home-bonuses__item';
      var copy = document.createElement('div'); copy.className = 'home-bonuses__copy';
      var name = document.createElement('div'); name.className = 'home-bonuses__name'; name.textContent = item.title || item.code;
      copy.appendChild(name);
      if (item.description){ var description = document.createElement('p'); description.className = 'home-bonuses__description'; description.textContent = item.description; copy.appendChild(description); }
      var button = document.createElement('button'); button.type = 'button'; button.className = 'home-bonuses__claim'; button.dataset.code = item.code; button.textContent = tf('claimBonusAmount', { amount: amount(item.amount) }, 'Claim +{amount} CH');
      row.appendChild(copy); row.appendChild(button); list.appendChild(row);
    });
  }

  function load(){
    if (loading || !window.ChipsClient || typeof window.ChipsClient.fetchBonusCampaigns !== 'function') return;
    loading = true;
    window.ChipsClient.fetchBonusCampaigns().then(function(payload){ render(payload && Array.isArray(payload.items) ? payload.items : payload); setStatus('', ''); }).catch(function(error){
      if (error && (error.code === 'not_authenticated' || error.status === 401)){ render([]); return; }
      setStatus(t('homeBonusLoadError', 'Could not load available bonuses.'), 'error');
    }).finally(function(){ loading = false; });
  }

  list.addEventListener('click', function(event){
    var button = event.target && event.target.closest ? event.target.closest('button[data-code]') : null;
    if (!button || button.disabled) return;
    button.disabled = true; setStatus(t('homeBonusClaiming', 'Claiming bonus...'), '');
    window.ChipsClient.claimBonusCampaign(button.dataset.code).then(function(){ setStatus(t('homeBonusClaimed', 'Bonus added to your account.'), ''); return load(); }).catch(function(){ button.disabled = false; setStatus(t('homeBonusLoadError', 'Could not load available bonuses.'), 'error'); });
  });
  document.addEventListener('chips:tx-complete', load);
  document.addEventListener('langchange', load);
  function boot(){ load(); if (window.SupabaseAuth && typeof window.SupabaseAuth.onAuthChange === 'function') window.SupabaseAuth.onAuthChange(load); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once:true }); else boot();
})();
