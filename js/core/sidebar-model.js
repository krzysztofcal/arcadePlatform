(function(){
  const items = [
    {
      id: 'home',
      labelKey: 'home',
      fallbackLabel: 'Home',
      href: '/index.html',
      className: 'sb-home',
      iconSvg: '<svg class="sb-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 10.5 12 4l9 6.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1v-9.5Z"/></svg>'
    },
    {
      id: 'recentlyPlayed',
      labelKey: 'recentlyPlayed',
      fallbackLabel: 'Recently played',
      href: '/recently-played.html'
    },
    {
      id: 'favorites',
      labelKey: 'favorites',
      fallbackLabel: 'Favorites',
      href: '/favorites.html',
      iconSvg: '<svg class="sb-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>'
    },
    {
      id: 'about',
      labelKey: 'about',
      fallbackLabel: 'About',
      href: '/about.en.html',
      hrefEn: '/about.en.html',
      hrefPl: '/about.pl.html'
    },
    {
      id: 'poker',
      labelKey: 'navPoker',
      fallbackLabel: 'Poker',
      href: '/poker/',
      iconSvg: '<svg class="sb-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-13h2v6h-2zm0 8h2v2h-2z"/></svg>'
    },
    {
      id: 'admin',
      labelKey: 'admin',
      fallbackLabel: 'Admin',
      href: '/admin.html',
      requiresAdmin: true,
      iconSvg: '<svg class="sb-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M10.3 2.6a1 1 0 0 1 1.4 0l1 1a7.8 7.8 0 0 1 1.9.8l1.4-.4a1 1 0 0 1 1.2.5l1 1.7a1 1 0 0 1-.2 1.2l-1 .9a7.2 7.2 0 0 1 0 2.1l1 .9a1 1 0 0 1 .2 1.2l-1 1.7a1 1 0 0 1-1.2.5l-1.4-.4a7.8 7.8 0 0 1-1.9.8l-1 1a1 1 0 0 1-1.4 0l-1-1a7.8 7.8 0 0 1-1.9-.8l-1.4.4a1 1 0 0 1-1.2-.5l-1-1.7a1 1 0 0 1 .2-1.2l1-.9a7.2 7.2 0 0 1 0-2.1l-1-.9a1 1 0 0 1-.2-1.2l1-1.7a1 1 0 0 1 1.2-.5l1.4.4a7.8 7.8 0 0 1 1.9-.8l1-1ZM11 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z"/></svg>'
    }
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
