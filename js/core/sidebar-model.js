(function(){
  const icons = {
    home: '<svg class="sb-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 10.8 12 3.8l9 7V20a1 1 0 0 1-1 1h-5.2v-6.2H9.2V21H4a1 1 0 0 1-1-1v-9.2Z"/></svg>',
    recent: '<svg class="sb-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a9 9 0 1 0 8.5 6h-2.2A7 7 0 1 1 12 5a6.9 6.9 0 0 1 4.9 2H14v2h6V3h-2v2.4A8.9 8.9 0 0 0 12 3Zm-1 4h2v5.1l4 2.4-1 1.7-5-3V7Z"/></svg>',
    favorites: '<svg class="sb-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8-6.2-3.2L5.8 21 7 14.2 2 9.3l6.9-1L12 2Z"/></svg>',
    poker: '<svg class="sb-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm5 3c-2.1 1.9-3.2 3.5-3.2 4.9 0 1.3 1 2.2 2.3 2.2.4 0 .7-.1.9-.2-.2.9-.6 1.6-1.2 2.1h2.4c-.6-.5-1-1.2-1.2-2.1.2.1.5.2.9.2 1.3 0 2.3-.9 2.3-2.2 0-1.4-1.1-3-3.2-4.9Z"/></svg>',
    leaderboard: '<svg class="sb-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 11h4v10H5V11Zm5-8h4v18h-4V3Zm5 5h4v13h-4V8ZM4 21h16v1H4v-1Z"/></svg>',
    profile: '<svg class="sb-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9Zm0 2c-4.4 0-8 2.2-8 5v1h16v-1c0-2.8-3.6-5-8-5Z"/></svg>',
    about: '<svg class="sb-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M11 10h2v8h-2v-8Zm0-4h2v2h-2V6Zm1-4a10 10 0 1 0 0 20 10 10 0 0 0 0-20Z"/></svg>',
    settings: '<svg class="sb-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="m19.4 13.5.1-1.5-.1-1.5 2-1.5-2-3.5-2.4 1a7.8 7.8 0 0 0-2.6-1.5L14 2h-4l-.4 2.5A7.8 7.8 0 0 0 7 6L4.6 5 2.6 8.5l2 1.5-.1 1.5.1 1.5-2 1.5 2 3.5 2.4-1a7.8 7.8 0 0 0 2.6 1.5L10 22h4l.4-2.5A7.8 7.8 0 0 0 17 18l2.4 1 2-3.5-2-1.5ZM12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7Z"/></svg>',
    random: '<svg class="sb-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M17 3h5v5h-2V6.4l-4.6 4.6-1.4-1.4L18.6 5H17V3ZM4 7h3.2c1.7 0 3.2.9 4 2.3l.5.8-1.4 1.4-.8-1.2A2.8 2.8 0 0 0 7.2 9H4V7Zm10 7.4 1.4-1.4 4.6 4.6V16h2v5h-5v-2h1.6L14 14.4ZM4 15h3.2c1 0 1.8-.5 2.3-1.3l4.6-7A4.8 4.8 0 0 1 18.2 4H20v2h-1.8c-1 0-1.8.5-2.3 1.3l-4.6 7A4.8 4.8 0 0 1 7.2 17H4v-2Z"/></svg>'
  };

  const items = [
    { id: 'home', labelKey: 'home', fallbackLabel: 'Home', href: '/index.html', className: 'sb-home', iconSvg: icons.home },
    { id: 'recentlyPlayed', labelKey: 'recentlyPlayed', fallbackLabel: 'Recently Played', href: '/recently-played.html', iconSvg: icons.recent },
    { id: 'favorites', labelKey: 'favorites', fallbackLabel: 'Favorites', href: '/favorites.html', iconSvg: icons.favorites },
    { id: 'poker', labelKey: 'navPoker', fallbackLabel: 'Poker', href: '/poker/', iconSvg: icons.poker },
    { id: 'leaderboard', labelKey: 'leaderboard', fallbackLabel: 'Leaderboard', href: '/xp.html', iconSvg: icons.leaderboard },
    { id: 'profile', labelKey: 'profile', fallbackLabel: 'Profile', href: '/account.html', iconSvg: icons.profile },
    { id: 'about', labelKey: 'about', fallbackLabel: 'About', href: '/about.en.html', hrefEn: '/about.en.html', hrefPl: '/about.pl.html', iconSvg: icons.about },
    { id: 'settings', labelKey: 'settings', fallbackLabel: 'Settings', href: '/account.html#settings', iconSvg: icons.settings },
    { id: 'random', labelKey: 'playRandomGame', fallbackLabel: 'Play Random Game', href: '/index.html', className: 'sb-random', iconSvg: icons.random },
    { id: 'admin', labelKey: 'admin', fallbackLabel: 'Admin', href: '/admin.html', requiresAdmin: true, iconSvg: icons.settings }
  ];

  function getItems(options){
    var opts = options || {};
    return items.filter(function(item){
      return !(item && item.requiresAdmin && !opts.isAdmin);
    }).slice();
  }

  window.SidebarModel = {
    getItems,
    items
  };
})();
