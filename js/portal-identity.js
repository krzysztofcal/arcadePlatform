(function(){
  if (typeof document === 'undefined') return;

  const win = window;
  const doc = document;
  let identity = null;
  let isMenuOpen = false;
  let userState = null;
  let identityReady = false;

  function selectTopbar(){
    const nodes = Array.from(doc.querySelectorAll('.topbar-right'));
    if (!nodes.length) return null;
    const preferred = nodes.find(el => {
      try {
        return !!(el && el.querySelector && el.querySelector('#xpBadge'));
      } catch (_){ return false; }
    });
    return preferred || nodes[0];
  }

  function displayName(user){
    if (!user) return 'Sign in';
    const meta = user.user_metadata || {};
    return user.full_name || meta.full_name || user.email || 'Account';
  }

  function visibleItems(list){
    return list.filter(el => el && el.style.display !== 'none');
  }

  function buildMenuItem(text, action){
    const btn = doc.createElement('button');
    btn.type = 'button';
    btn.className = 'id-menu__item';
    btn.setAttribute('role', 'menuitem');
    btn.dataset.action = action;
    btn.textContent = text;
    return btn;
  }

  function attach(topbar){
    const wrap = doc.createElement('div');
    wrap.className = 'id-control';

    const avatarBtn = doc.createElement('button');
    avatarBtn.type = 'button';
    avatarBtn.className = 'id-avatar';
    avatarBtn.setAttribute('aria-haspopup', 'true');
    avatarBtn.setAttribute('aria-expanded', 'false');
    avatarBtn.setAttribute('aria-label', 'Account menu');

    const avatarImg = doc.createElement('span');
    avatarImg.className = 'id-avatar__img';
    avatarImg.setAttribute('aria-hidden', 'true');

    const avatarLabel = doc.createElement('span');
    avatarLabel.className = 'id-avatar__label';
    avatarLabel.textContent = 'Sign in';

    avatarBtn.appendChild(avatarImg);
    avatarBtn.appendChild(avatarLabel);

    const menu = doc.createElement('div');
    menu.className = 'id-menu';
    menu.setAttribute('role', 'menu');
    menu.hidden = true;

    const signInItem = buildMenuItem('Sign in', 'signin');
    const accountItem = buildMenuItem('My account', 'account');
    const logoutItem = buildMenuItem('Log out', 'logout');

    const status = doc.createElement('span');
    status.className = 'visually-hidden id-status';
    status.setAttribute('aria-live', 'polite');

    menu.appendChild(signInItem);
    menu.appendChild(accountItem);
    menu.appendChild(logoutItem);

    wrap.appendChild(avatarBtn);
    wrap.appendChild(menu);
    wrap.appendChild(status);

    const items = [signInItem, accountItem, logoutItem];

    function announce(text){
      status.textContent = text || '';
    }

    function closeMenu(focusButton){
      if (!isMenuOpen) return;
      isMenuOpen = false;
      menu.hidden = true;
      avatarBtn.setAttribute('aria-expanded', 'false');
      doc.removeEventListener('mousedown', onDocMouse);
      doc.removeEventListener('focusin', onFocusIn);
      if (focusButton) avatarBtn.focus();
    }

    function openMenu(focusFirst){
      if (isMenuOpen) return;
      isMenuOpen = true;
      menu.hidden = false;
      avatarBtn.setAttribute('aria-expanded', 'true');
      doc.addEventListener('mousedown', onDocMouse);
      doc.addEventListener('focusin', onFocusIn);
      if (focusFirst){
        const vis = visibleItems(items);
        if (vis[0]) vis[0].focus();
      }
    }

    function onDocMouse(e){
      if (!wrap.contains(e.target)){
        closeMenu(false);
      }
    }

    function onFocusIn(e){
      if (!wrap.contains(e.target)){
        closeMenu(false);
      }
    }

    function focusSibling(step){
      const vis = visibleItems(items);
      if (!vis.length) return;
      const active = doc.activeElement;
      const idx = vis.indexOf(active);
      const target = idx === -1 ? vis[0] : vis[(idx + step + vis.length) % vis.length];
      if (target && typeof target.focus === 'function') target.focus();
    }

    function setUser(newUser, silent){
      userState = newUser || null;
      const loggedIn = !!userState;
      const labelText = displayName(userState);
      avatarLabel.textContent = labelText;
      avatarBtn.setAttribute('data-state', loggedIn ? 'auth' : 'anon');
      avatarBtn.setAttribute('aria-label', loggedIn ? 'Account menu for ' + labelText : 'Account menu, signed out');
      signInItem.style.display = loggedIn ? 'none' : 'block';
      accountItem.style.display = loggedIn ? 'block' : 'none';
      logoutItem.style.display = loggedIn ? 'block' : 'none';
      if (!silent){
        announce(loggedIn ? 'Signed in as ' + labelText : 'Signed out');
      }
    }

    function handleAction(action){
      if (!identity || !identityReady){
        announce('Sign-in unavailable.');
        closeMenu(true);
        return;
      }
      if (action === 'logout'){
        try { identity.logout(); } catch (_){ }
        announce('Signing out…');
      } else {
        try { identity.open(); } catch (_){ }
        announce('Opening account…');
      }
      closeMenu(true);
    }

    avatarBtn.addEventListener('click', function(){
      if (isMenuOpen){
        closeMenu(false);
      } else {
        openMenu(false);
      }
    });

    avatarBtn.addEventListener('keydown', function(e){
      const key = e.key;
      if (key === 'Enter' || key === ' '){
        e.preventDefault();
        if (isMenuOpen){
          closeMenu(false);
        } else {
          openMenu(true);
        }
      }
      if (key === 'ArrowDown' || key === 'ArrowUp'){
        e.preventDefault();
        openMenu(true);
        if (key === 'ArrowUp') focusSibling(-1);
      }
      if (key === 'Escape'){
        closeMenu(true);
      }
    });

    menu.addEventListener('keydown', function(e){
      const key = e.key;
      if (key === 'ArrowDown'){ e.preventDefault(); focusSibling(1); }
      if (key === 'ArrowUp'){ e.preventDefault(); focusSibling(-1); }
      if (key === 'Home'){ e.preventDefault(); const vis = visibleItems(items); if (vis[0]) vis[0].focus(); }
      if (key === 'End'){ e.preventDefault(); const vis = visibleItems(items); if (vis.length) vis[vis.length - 1].focus(); }
      if (key === 'Escape'){ e.preventDefault(); closeMenu(true); }
    });

    items.forEach(btn => {
      btn.addEventListener('click', function(ev){
        ev.preventDefault();
        handleAction(btn.dataset.action);
      });
    });

    topbar.appendChild(wrap);
    setUser(null, true);
    return { setUser, announce, closeMenu };
  }

  function start(){
    const host = selectTopbar();
    if (!host) return;
    const ui = attach(host);

    identity = win.netlifyIdentity && typeof win.netlifyIdentity.on === 'function' ? win.netlifyIdentity : null;
    if (!identity){
      ui.announce('Identity not loaded.');
      return;
    }

    identity.on('init', function(user){
      identityReady = true;
      ui.setUser(user || null);
      try { if (identity.close) identity.close(); } catch (_){ }
    });

    identity.on('login', function(user){
      identityReady = true;
      ui.setUser(user || null);
      ui.announce('Signed in as ' + displayName(user));
      ui.closeMenu(true);
    });

    identity.on('logout', function(){
      identityReady = true;
      ui.setUser(null);
      ui.announce('Signed out');
      ui.closeMenu(true);
    });

    identity.on('error', function(){
      identityReady = false;
      ui.setUser(null);
      ui.announce('Sign-in unavailable. Enable Netlify Identity.');
      try { if (identity.close) identity.close(); } catch (_){ }
    });

    try {
      identity.init();
    } catch (_){
      ui.announce('Identity unavailable.');
    }
  }

  if (doc.readyState === 'loading'){
    doc.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
