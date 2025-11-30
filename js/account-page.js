(function(){
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  var doc = document;
  var auth = null;
  var nodes = {};

  function selectNodes(){
    nodes.status = doc.getElementById('accountStatus');
    nodes.forms = doc.getElementById('authForms');
    nodes.account = doc.getElementById('accountPanel');
    nodes.userEmail = doc.getElementById('accountEmail');
    nodes.userName = doc.getElementById('accountName');
    nodes.signOut = doc.getElementById('signOutButton');
    nodes.deleteBtn = doc.getElementById('deleteAccountButton');
    nodes.deleteNote = doc.getElementById('deleteAccountNote');
    nodes.signInForm = doc.getElementById('signinForm');
    nodes.signUpForm = doc.getElementById('signupForm');
    nodes.signInEmail = doc.getElementById('signinEmail');
    nodes.signInPass = doc.getElementById('signinPassword');
    nodes.signUpEmail = doc.getElementById('signupEmail');
    nodes.signUpPass = doc.getElementById('signupPassword');
  }

  function setStatus(message, tone){
    if (!nodes.status) return;
    nodes.status.textContent = message || '';
    nodes.status.dataset.tone = tone || '';
    nodes.status.hidden = !message;
  }

  function renderUser(user){
    var hasUser = !!user;
    if (nodes.forms){ nodes.forms.hidden = hasUser; }
    if (nodes.account){ nodes.account.hidden = !hasUser; }

    if (!hasUser){ return; }

    var meta = user.user_metadata || {};
    var displayName = meta.full_name || meta.name || user.email || 'Player';
    if (nodes.userEmail){ nodes.userEmail.textContent = user.email || 'Unknown email'; }
    if (nodes.userName){ nodes.userName.textContent = displayName; }
  }

  function handleSignIn(e){
    e.preventDefault();
    var email = nodes.signInEmail && nodes.signInEmail.value ? nodes.signInEmail.value.trim() : '';
    var password = nodes.signInPass && nodes.signInPass.value ? nodes.signInPass.value : '';
    if (!email || !password){
      setStatus('Enter both email and password to sign in.', 'error');
      return;
    }

    if (!auth || !auth.signIn){
      setStatus('Authentication is not ready. Refresh and try again.', 'error');
      return;
    }

    setStatus('Signing in…', 'info');
    auth.signIn(email, password).then(function(res){
      var user = res && res.data && res.data.user ? res.data.user : null;
      if (user){
        setStatus('Signed in successfully.', 'success');
        renderUser(user);
      } else {
        setStatus('Signed in. Redirecting…', 'success');
      }
    }).catch(function(err){
      var msg = err && err.message ? String(err.message) : 'Could not sign in. Please try again.';
      setStatus(msg, 'error');
    });
  }

  function handleSignUp(e){
    e.preventDefault();
    var email = nodes.signUpEmail && nodes.signUpEmail.value ? nodes.signUpEmail.value.trim() : '';
    var password = nodes.signUpPass && nodes.signUpPass.value ? nodes.signUpPass.value : '';
    if (!email || !password){
      setStatus('Enter both email and password to sign up.', 'error');
      return;
    }

    if (!auth || !auth.signUp){
      setStatus('Authentication is not ready. Refresh and try again.', 'error');
      return;
    }

    setStatus('Creating your account…', 'info');
    auth.signUp(email, password).then(function(res){
      var needsVerify = res && res.data && res.data.user && res.data.user.confirmation_sent_at;
      if (needsVerify){
        setStatus('Check your inbox to confirm your email.', 'success');
      } else {
        setStatus('Account created. You are signed in.', 'success');
      }
    }).catch(function(err){
      var msg = err && err.message ? String(err.message) : 'Could not sign up. Please try again.';
      setStatus(msg, 'error');
    });
  }

  function handleSignOut(){
    setStatus('Signing out…', 'info');
    if (!auth || !auth.signOut){
      setStatus('Authentication is not ready. Refresh and try again.', 'error');
      return;
    }

    auth.signOut().then(function(){
      setStatus('Signed out.', 'success');
      renderUser(null);
    }).catch(function(err){
      var msg = err && err.message ? String(err.message) : 'Could not sign out right now.';
      setStatus(msg, 'error');
    });
  }

  function wireEvents(){
    if (nodes.signInForm){ nodes.signInForm.addEventListener('submit', handleSignIn); }
    if (nodes.signUpForm){ nodes.signUpForm.addEventListener('submit', handleSignUp); }
    if (nodes.signOut){ nodes.signOut.addEventListener('click', handleSignOut); }
    if (nodes.deleteBtn && nodes.deleteNote){
      nodes.deleteBtn.addEventListener('click', function(e){
        e.preventDefault();
        setStatus('Account deletion is coming soon. Contact support to remove data.', 'info');
        nodes.deleteNote.focus();
      });
    }

    doc.addEventListener('auth:signin-request', function(){
      if (nodes.forms){ nodes.forms.hidden = false; }
      if (nodes.account){ nodes.account.hidden = true; }
      if (nodes.signInEmail){ nodes.signInEmail.focus(); }
    });
  }

  function hydrateUser(){
    if (!auth || !auth.getCurrentUser){
      setStatus('Authentication is not configured yet.', 'error');
      return;
    }

    setStatus('Checking session…', 'info');
    auth.getCurrentUser().then(function(user){
      renderUser(user);
      setStatus(user ? 'Signed in.' : '', user ? 'success' : '');
    }).catch(function(err){
      var msg = err && err.message ? String(err.message) : 'Could not load your session. Please try again.';
      setStatus(msg, 'error');
    });

    if (auth.onAuthChange){
      auth.onAuthChange(function(_event, user){
        renderUser(user);
        if (user){
          setStatus('Signed in.', 'success');
        } else {
          setStatus('You have been signed out.', 'info');
        }
      });
    }
  }

  function init(){
    auth = (typeof window !== 'undefined' && window.SupabaseAuth) ? window.SupabaseAuth : null;
    selectNodes();
    wireEvents();
    hydrateUser();
  }

  if (doc.readyState === 'loading'){
    doc.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
