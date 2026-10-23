(function(){
  'use strict';
  var config = window.MobilePokerSecurity.validate(window.MOBILE_POKER_CONFIG);
  var cap = window.Capacitor;
  function klog(kind){
    if (window.KLog && window.KLog.log) window.KLog.log(kind, {});
  }
  function notice(message){
    var node = document.getElementById('mobileStatus');
    if (!node){
      node = document.createElement('div');
      node.id = 'mobileStatus';
      node.setAttribute('role', 'status');
      document.body.appendChild(node);
    }
    node.textContent = message;
  }
  function plugin(name){
    if (!cap || !cap.Plugins || !cap.Plugins[name]) throw new Error('Native plugin bridge unavailable');
    return cap.Plugins[name];
  }
  var browser;
  var app;
  window.MobilePoker = {
    authOptions: { auth: { flowType: 'pkce', detectSessionInUrl: false, persistSession: true, autoRefreshToken: true } },
    redirectTo: window.MobilePokerSecurity.redirectTo,
    publicProfileUrl: function(handle){ return window.MobilePokerSecurity.publicProfileUrl(config, handle); },
    openOAuth: function(value){
      var url = new URL(value);
      if (url.origin !== config.supabaseUrl || url.pathname !== '/auth/v1/authorize' || url.searchParams.get('provider') !== 'google' || url.searchParams.get('redirect_to') !== window.MobilePokerSecurity.redirectTo) {
        return Promise.reject(new Error('google_failed'));
      }
      return browser.open({ url: url.href });
    }
  };
  var exchanging = false;
  async function callback(value){
    if (exchanging) return;
    try {
      var code = window.MobilePokerSecurity.callbackCode(value);
      if (sessionStorage.getItem('mobilePokerConsumedAuthCode') === code) return;
      exchanging = true;
      if (window.location.pathname !== '/account.html') {
        sessionStorage.setItem('mobilePokerAuthCode', code);
        window.location.replace('/account.html');
        return;
      }
      // The verifier is stored by the shared Supabase client in app-local storage.
      var client = window.supabaseClient;
      if (!client || !client.auth) throw new Error('Auth client unavailable');
      var result = await client.auth.exchangeCodeForSession(code);
      if (result.error || !result.data || !result.data.session) throw new Error('Auth callback failed');
      sessionStorage.setItem('mobilePokerConsumedAuthCode', code);
      await browser.close().catch(function(){});
      notice('Signed in to Stage. Account is ready.');
    } catch (_err){
      notice('Sign-in return failed or expired. Please retry from Account.');
      klog('mobile:auth_callback_failed');
    } finally {
      exchanging = false;
    }
  }
  document.addEventListener('DOMContentLoaded', function(){
    notice(navigator.onLine ? 'Stage PoC · ' + config.sha.slice(0, 8) : 'Offline · reconnect to use Poker');
    try {
      browser = plugin('Browser');
      app = plugin('App');
      app.addListener('appUrlOpen', function(event){ callback(event.url); });
      var pendingCode = sessionStorage.getItem('mobilePokerAuthCode');
      sessionStorage.removeItem('mobilePokerAuthCode');
      if (pendingCode) setTimeout(function(){ callback(window.MobilePokerSecurity.redirectTo + '?code=' + encodeURIComponent(pendingCode)); }, 0);
      app.getLaunchUrl().then(function(result){ if (result && result.url) callback(result.url); }).catch(function(){ klog('mobile:launch_url_failed'); });
      app.addListener('backButton', function(){
        // Avoid a blind history back into a stale table or out of the local package.
        if (window.location.pathname.indexOf('/poker/table-v2.html') === 0) {
          var lobby = document.getElementById('pokerLobbyLink');
          if (lobby) lobby.click();
        } else if (window.location.pathname !== '/poker/' && window.location.pathname !== '/poker/index.html') {
          window.location.assign('/poker/index.html');
        } else app.minimizeApp();
      });
      app.addListener('appStateChange', function(event){
        var client = window.supabaseClient;
        if (!client || !client.auth) return;
        if (event.isActive) {
          client.auth.startAutoRefresh();
          // Preserve the existing Poker WS reconnect/resync owner; no duplicate socket.
          if (navigator.onLine) window.dispatchEvent(new Event('online'));
        } else client.auth.stopAutoRefresh();
      });
    } catch (_err){ notice('Native bridge unavailable. Install the APK to test mobile sign-in.'); }
    document.addEventListener('click', function(event){
      var anchor = event.target.closest && event.target.closest('a[href]');
      if (!anchor) return;
      var url = new URL(anchor.href, window.location.href);
      if (url.origin === window.location.origin) return;
      event.preventDefault();
      if (url.protocol === 'https:' && browser) browser.open({ url: url.href }).catch(function(){ klog('mobile:external_link_failed'); });
    }, true);
  });
  window.addEventListener('offline', function(){ notice('Offline · reconnect to use Poker'); });
  window.addEventListener('online', function(){ notice('Stage PoC · ' + config.sha.slice(0, 8)); });
})();
