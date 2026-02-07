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
    }
  ];

  function getItems(){
    return items.slice();
  }

  window.SidebarModel = {
    getItems,
    items
  };
})();
