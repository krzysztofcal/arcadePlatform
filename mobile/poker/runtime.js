(function(){
  'use strict';
  var bound = window.MobilePokerSecurity.bind(window.MOBILE_POKER_CONFIG);
  var config = bound.config;
  var cap = window.Capacitor;
  function klog(kind){
    if (window.KLog && window.KLog.log) window.KLog.log(kind, {});
  }
  function notice(message){
    var node = document.getElementById('accountStatus') || document.getElementById('mobileError');
    if (!node){
      node = document.createElement('div');
      node.id = 'mobileError';
      node.setAttribute('role', 'alert');
      // Only actionable failures create a notice; normal startup stays silent.
      (document.getElementById('pokerMenuPanel') || document.querySelector('.intro') || document.body).appendChild(node);
    }
    node.textContent = message;
    node.hidden = false;
  }
  function plugin(name){
    if (!cap || !cap.Plugins || !cap.Plugins[name]) throw new Error('Native plugin bridge unavailable');
    return cap.Plugins[name];
  }
  var browser;
  var app;
  var systemBars;
  function syncSystemBars(active){
    if (!systemBars) return;
    var table = window.location.pathname === '/poker/table-v2.html';
    var operation = active && table ? systemBars.hide() : systemBars.show();
    Promise.resolve(operation).catch(function(){ klog('mobile:system_bars_failed'); });
  }
  window.MobilePoker = {
    authOptions: { auth: { flowType: 'pkce', detectSessionInUrl: false, persistSession: true, autoRefreshToken: true } },
    redirectTo: bound.redirectTo,
    publicProfileUrl: function(handle){ return window.MobilePokerSecurity.publicProfileUrl(config, handle); },
    openOAuth: function(value){
      var url = new URL(value);
      if (url.searchParams.getAll('redirect_to').length !== 1 ||
          url.searchParams.getAll('provider').length !== 1 ||
          url.origin !== config.supabaseUrl ||
          url.pathname !== '/auth/v1/authorize' ||
          url.searchParams.get('provider') !== 'google' ||
          url.searchParams.get('redirect_to') !== bound.redirectTo) {
        return Promise.reject(new Error('google_failed'));
      }
      return browser.open({ url: url.href });
    },
    // #1300: Production APK signs in with Google natively (Credential Manager ID token), never via a browser callback.
    nativeGoogle: bound.channel === 'production',
    signInWithGoogle: signInWithGoogle,
    // Explicit sign-out: invalidate any in-flight native sign-in and forget the account choice. The next native
    // sign-in waits until this clear has finished.
    clearGoogleCredential: function(){
      googleGeneration++;
      var cap2 = window.Capacitor;
      var native = cap2 && cap2.Plugins && cap2.Plugins.PokerGoogleSignIn;
      if (bound.channel !== 'production' || !native) return Promise.resolve(false);
      pendingClear = Promise.resolve().then(function(){ return native.clearCredential(); })
        .then(function(){ return true; }, function(){ klog('mobile:google_clear_failed'); return false; });
      return pendingClear;
    }
  };
  var googleSigningIn = false;
  var googleGeneration = 0;
  var pendingClear = Promise.resolve(true);
  function nonceHex(bytes){
    return Array.prototype.map.call(new Uint8Array(bytes), function(b){ return (b < 16 ? '0' : '') + b.toString(16); }).join('');
  }
  // Raw nonce goes to Supabase; Google receives only its SHA-256 hex digest (bound into the ID token).
  async function signInWithGoogle(client){
    if (bound.channel !== 'production') throw new Error('google_unavailable');
    if (googleSigningIn) throw new Error('google_in_progress');
    if (!client || !client.auth || typeof client.auth.signInWithIdToken !== 'function') throw new Error('google_unavailable');
    googleSigningIn = true;
    var generation = googleGeneration;
    try {
      await pendingClear;
      if (generation !== googleGeneration) throw new Error('google_canceled');
      var native = plugin('PokerGoogleSignIn');
      var raw = nonceHex(window.crypto.getRandomValues(new Uint8Array(32)));
      var hashed = nonceHex(await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw)));
      var credential;
      try { credential = await native.signIn({ nonce: hashed }); }
      catch (err){
        var code = err && err.code;
        if (code === 'canceled') throw new Error('google_canceled');
        if (code === 'no_credential' || code === 'unavailable') throw new Error('google_unavailable');
        throw new Error('google_failed');
      }
      if (!credential || typeof credential.idToken !== 'string' || !credential.idToken) throw new Error('google_failed');
      // A sign-out while the picker was open discards its result.
      if (generation !== googleGeneration) throw new Error('google_canceled');
      var result = await client.auth.signInWithIdToken({ provider: 'google', token: credential.idToken, nonce: raw });
      if (generation !== googleGeneration){
        // Sign-out happened during the token exchange: do not leave a session behind.
        await Promise.resolve().then(function(){ return client.auth.signOut(); }).catch(function(){});
        throw new Error('google_canceled');
      }
      if (!result || result.error || !result.data || !result.data.session) throw new Error('google_failed');
      return result;
    } catch (err){
      var known = err && /^google_(canceled|unavailable|failed|in_progress)$/.test(err.message);
      klog(known ? 'mobile:' + err.message : 'mobile:google_failed');
      throw known ? err : new Error('google_failed');
    } finally {
      googleSigningIn = false;
    }
  }
  var exchanging = false;
  async function callback(value){
    if (exchanging) return;
    try {
      var code = window.MobilePokerSecurity.callbackCode(value, bound.channel);
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
      notice('Signed in. Account is ready.');
    } catch (_err){
      notice('Sign-in return failed or expired. Please retry from Account.');
      klog('mobile:auth_callback_failed');
    } finally {
      exchanging = false;
    }
  }
  document.addEventListener('DOMContentLoaded', function(){
    try {
      browser = plugin('Browser');
      app = plugin('App');
      systemBars = plugin('SystemBars');
      syncSystemBars(true);
      var pendingCode = sessionStorage.getItem('mobilePokerAuthCode');
      sessionStorage.removeItem('mobilePokerAuthCode');
      // The shared Supabase client is created after this listener, so callbacks start on a later task.
      // A code handed over from another page wins: it holds the existing guard until its exchange starts.
      if (pendingCode) exchanging = true;
      var urlOpened = false;
      app.addListener('appUrlOpen', function(event){ urlOpened = true; setTimeout(function(){ callback(event.url); }, 0); });
      if (pendingCode) setTimeout(function(){ exchanging = false; callback(bound.redirectTo + '?code=' + encodeURIComponent(pendingCode)); }, 0);
      else app.getLaunchUrl().then(function(result){ if (result && result.url) setTimeout(function(){ if (!urlOpened) callback(result.url); }, 0); }).catch(function(){ klog('mobile:launch_url_failed'); });
      app.addListener('backButton', function(){
        if (window.PokerOffline && window.PokerOffline.cancelDialog && window.PokerOffline.cancelDialog()) return;
        var dialog = document.querySelector('dialog[open]');
        if (dialog){
          if (dialog.dispatchEvent(new Event('cancel', { cancelable: true }))) dialog.close();
          return;
        }
        // Avoid a blind history back into a stale table or out of the local package.
        if (window.location.pathname.indexOf('/poker/table-v2.html') === 0) {
          var lobby = document.getElementById('pokerLobbyLink');
          if (lobby) lobby.click();
        } else if (window.location.pathname !== '/poker/' && window.location.pathname !== '/poker/index.html') {
          window.location.assign('/poker/index.html');
        } else app.minimizeApp();
      });
      app.addListener('appStateChange', function(event){
        syncSystemBars(event.isActive);
        var client = window.supabaseClient;
        if (!client || !client.auth) return;
        if (event.isActive) {
          client.auth.startAutoRefresh();
          // Preserve the existing Poker WS reconnect/resync owner; no duplicate socket.
          if (navigator.onLine) window.dispatchEvent(new Event('online'));
        } else client.auth.stopAutoRefresh();
      });
    } catch (_err){ klog('mobile:bridge_unavailable'); notice('Mobile sign-in is unavailable. Please reopen the app.'); }
    document.addEventListener('click', function(event){
      var anchor = event.target.closest && event.target.closest('a[href]');
      if (!anchor) return;
      var url = new URL(anchor.href, window.location.href);
      if (url.origin === window.location.origin || url.protocol === 'mailto:') return;
      event.preventDefault();
      if (url.protocol === 'https:' && browser) browser.open({ url: url.href }).catch(function(){ klog('mobile:external_link_failed'); });
    }, true);
  });
})();
