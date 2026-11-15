(function(){
  const icons = {
    home: '<svg class="sb-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 10.8 12 3.8l9 7V20a1 1 0 0 1-1 1h-5.2v-6.2H9.2V21H4a1 1 0 0 1-1-1v-9.2Z"/></svg>',
    recent: '<svg class="sb-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a9 9 0 1 0 8.5 6h-2.2A7 7 0 1 1 12 5a6.9 6.9 0 0 1 4.9 2H14v2h6V3h-2v2.4A8.9 8.9 0 0 0 12 3Zm-1 4h2v5.1l4 2.4-1 1.7-5-3V7Z"/></svg>',
    favorites: '<svg class="sb-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8-6.2-3.2L5.8 21 7 14.2 2 9.3l6.9-1L12 2Z"/></svg>',
    poker: '<svg class="sb-svg" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="11" height="15" rx="2"/><path d="M15 7l4 1.2a2 2 0 0 1 1.4 2.5l-2.3 8"/></svg>',
    leaderboard: '<svg class="sb-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4h10v5a5 5 0 0 1-10 0zM7 6H4c0 3 1 4 3 4M17 6h3c0 3-1 4-3 4M12 14v4M8 20h8"/></svg>',
    profile: '<svg class="sb-svg" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c1-5 15-5 16 0"/></svg>',
    xp: '<svg class="sb-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M13 3 5 14h6l-1 7 8-11h-6Z"/></svg>',
    about: '<svg class="sb-svg" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.01"/></svg>',
    settings: '<svg class="sb-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="m19.4 13.5.1-1.5-.1-1.5 2-1.5-2-3.5-2.4 1a7.8 7.8 0 0 0-2.6-1.5L14 2h-4l-.4 2.5A7.8 7.8 0 0 0 7 6L4.6 5 2.6 8.5l2 1.5-.1 1.5.1 1.5-2 1.5 2 3.5 2.4-1a7.8 7.8 0 0 0 2.6 1.5L10 22h4l.4-2.5A7.8 7.8 0 0 0 17 18l2.4 1 2-3.5-2-1.5ZM12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7Z"/></svg>',
    random: '<svg class="sb-svg" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="4"/><path d="M9 9h.01M15 15h.01M15 9h.01M9 15h.01M12 12h.01"/></svg>'
  };

  const menuItems = [
    { id: 'home', labelKey: 'home', fallbackLabel: 'Home', href: '/index.html', className: 'sb-home', iconSvg: icons.home },
    { id: 'poker', labelKey: 'navPoker', fallbackLabel: 'Poker', href: '/poker/', iconSvg: icons.poker },
    { id: 'leaderboard', labelKey: 'leaderboard', fallbackLabel: 'Ranking', href: '/leaderboard.html', iconSvg: icons.leaderboard },
    { id: 'favorites', labelKey: 'favorites', fallbackLabel: 'Favorites', href: '/favorites.html', iconSvg: icons.favorites },
    { id: 'recentlyPlayed', labelKey: 'recentlyPlayed', fallbackLabel: 'Recently Played', href: '/recently-played.html', iconSvg: icons.recent },
    { id: 'xp', labelKey: 'navXp', fallbackLabel: 'XP', href: '/xp.html', iconSvg: icons.xp },
    { id: 'random', labelKey: 'playRandomGame', fallbackLabel: 'Random game', href: '/index.html', className: 'sb-random', iconSvg: icons.random },
    { id: 'profile', labelKey: 'account', fallbackLabel: 'Account', href: '/account.html', section: 'account', iconSvg: icons.profile },
    { id: 'about', labelKey: 'about', fallbackLabel: 'About', href: '/about.en.html', hrefEn: '/about.en.html', hrefPl: '/about.pl.html', section: 'account', iconSvg: icons.about },
    { id: 'admin', labelKey: 'admin', fallbackLabel: 'Admin', href: '/admin.html', requiresAdmin: true, iconSvg: icons.settings }
  ];

  const bottomItems = [
    { id: 'home', labelKey: 'home', fallbackLabel: 'Home', href: '/index.html', iconSvg: icons.home },
    { id: 'poker', labelKey: 'navPoker', fallbackLabel: 'Poker', href: '/poker/', iconSvg: icons.poker },
    { id: 'leaderboard', labelKey: 'leaderboard', fallbackLabel: 'Ranking', href: '/leaderboard.html', iconSvg: icons.leaderboard },
    { id: 'favorites', labelKey: 'favorites', fallbackLabel: 'Favorites', href: '/favorites.html', iconSvg: icons.favorites },
    { id: 'profile', labelKey: 'account', fallbackLabel: 'Account', href: '/account.html', iconSvg: icons.profile }
  ];

  function mobileItems(){
    return [
      { id: 'poker', labelKey: 'navPoker', fallbackLabel: 'Poker', href: '/poker/index.html', iconSvg: icons.poker },
      { id: 'profile', labelKey: 'profile', fallbackLabel: 'Profile', href: '/account.html', iconSvg: icons.profile }
    ];
  }

  function getItems(options){
    if (window.MOBILE_POKER_CONFIG) return mobileItems();
    var opts = options || {};
    return menuItems.filter(function(item){
      return !(item && item.requiresAdmin && !opts.isAdmin);
    }).slice();
  }

  function getBottomNavItems(){
    if (window.MOBILE_POKER_CONFIG) return mobileItems();
    return bottomItems.slice();
  }

  window.SidebarModel = {
    getItems,
    getBottomNavItems,
    items: menuItems,
    bottomItems
  };
})();
