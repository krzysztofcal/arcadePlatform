// Minimal footer i18n + language toggle (PL/EN)
(function(){
  const dict = {
    about: { en: 'About', pl: 'O serwisie' },
    licenses: { en: 'Licenses', pl: 'Licencje' },
    terms: { en: 'Terms', pl: 'Regulamin' },
    privacy: { en: 'Privacy', pl: 'Prywatność' },
    contact: { en: 'Contact', pl: 'Kontakt' },
    manageCookies: { en: 'Manage cookies', pl: 'Zarządzaj cookies' },
    licensesTitle: { en: 'Game Licenses & Credits', pl: 'Licencje i podziękowania' },
    licensesIntro1: {
      en: 'Some games on this website are open-source and used under their respective licenses.',
      pl: 'Niektóre gry w tym serwisie są open source i udostępniane na swoich licencjach.'
    },
    licensesIntro2: {
      en: 'All rights belong to their original authors.',
      pl: 'Wszystkie prawa należą do ich pierwotnych autorów.'
    },
    licensesIntro3: {
      en: 'Below are details for included projects.',
      pl: 'Poniżej znajdziesz szczegóły wykorzystanych projektów.'
    },
    licensesSupabaseTitle: { en: 'Supabase', pl: 'Supabase' },
    licensesSupabaseDesc: {
      en: 'Authentication & database platform used for user accounts and XP sync.',
      pl: 'Platforma uwierzytelniania i bazy danych używana dla kont użytkowników i synchronizacji XP.'
    },
    licensesSupabaseLicense: {
      en: 'Licensed under the Apache License 2.0.',
      pl: 'Licencjonowane na podstawie Apache License 2.0.'
    },
    licensesSupabaseSource: { en: 'Source:', pl: 'Źródło:' },
    licensesOriginalBy: { en: 'Original project by', pl: 'Oryginalny projekt:' },
    licensesLicenseMIT: { en: 'Licensed under the MIT License.', pl: 'Na licencji MIT.' },
    licensesSource: { en: 'Source:', pl: 'Źródło:' },
    playChip: { en: 'PLAY', pl: 'GRAJ' },
    searchPlaceholder: { en: 'Search games', pl: 'Szukaj gier' },
    searchAria: { en: 'Search games', pl: 'Szukaj gier' },
    catsFullscreenHint: {
      en: 'Make the game feel bigger — use the top bar icon or the yellow corner button to go full screen, and press Esc to return.',
      pl: 'Zanurz się w grze w trybie pełnoekranowym — użyj ikony w pasku u góry lub żółtego przycisku w rogu. Naciśnij Esc, aby wrócić.'
    },
    recentlyPlayed: { en: 'Recently played', pl: 'Ostatnio grane' },
    recentlyPlayedTitle: { en: 'Recently Played', pl: 'Ostatnio grane' },
    recentlyPlayedDesc: { en: 'Pick up where you left off', pl: 'Kontynuuj tam, gdzie skończyłeś' },
    noRecentGames: { en: 'No recent games', pl: 'Brak ostatnio granych' },
    noRecentGamesDesc: {
      en: 'You haven\'t played any games yet. Start playing to see your history here!',
      pl: 'Nie grałeś jeszcze w żadne gry. Zacznij grać, aby zobaczyć swoją historię tutaj!'
    },
    browseGames: { en: 'Browse Games', pl: 'Przeglądaj gry' },
    favorites: { en: 'Favorites', pl: 'Ulubione' },
    favoritesTitle: { en: 'Favorites', pl: 'Ulubione' },
    favoritesDesc: { en: 'Your favorite games in one place', pl: 'Twoje ulubione gry w jednym miejscu' },
    noFavorites: { en: 'No favorites yet', pl: 'Brak ulubionych' },
    noFavoritesDesc: {
      en: 'Add games to your favorites by clicking the star icon while playing!',
      pl: 'Dodawaj gry do ulubionych klikając ikonę gwiazdki podczas grania!'
    },
    signInForFavorites: { en: 'Sign in to use Favorites', pl: 'Zaloguj się, aby korzystać z Ulubionych' },
    signInForFavoritesDesc: {
      en: 'Create an account to save your favorite games across all your devices.',
      pl: 'Załóż konto, aby zapisać ulubione gry na wszystkich swoich urządzeniach.'
    },
    signIn: { en: 'Sign In', pl: 'Zaloguj się' },
    addToFavorites: { en: 'Add to favorites', pl: 'Dodaj do ulubionych' },
    removeFromFavorites: { en: 'Remove from favorites', pl: 'Usuń z ulubionych' },
    poker: { en: 'Poker', pl: 'Poker' },
    pokerTables: { en: 'Poker Tables', pl: 'Stoły pokerowe' },
    refresh: { en: 'Refresh', pl: 'Odśwież' },
    createTable: { en: 'Create Table', pl: 'Utwórz stół' },
    openTables: { en: 'Open Tables', pl: 'Otwarte stoły' },
    sb: { en: 'SB', pl: 'SB' },
    bb: { en: 'BB', pl: 'BB' },
    maxPlayers: { en: 'Max Players', pl: 'Maks. graczy' },
    open: { en: 'Open', pl: 'Otwórz' },
    table: { en: 'Table', pl: 'Stół' },
    stakes: { en: 'Stakes', pl: 'Stawki' },
    status: { en: 'Status', pl: 'Status' },
    seats: { en: 'Seats', pl: 'Miejsca' },
    joinTable: { en: 'Join Table', pl: 'Dołącz do stołu' },
    seat: { en: 'Seat', pl: 'Miejsce' },
    buyIn: { en: 'Buy-in', pl: 'Wpisowe' },
    join: { en: 'Join', pl: 'Dołącz' },
    leaveTable: { en: 'Leave Table', pl: 'Opuść stół' },
    leaveAndCashOut: { en: 'Leave & Cash Out', pl: 'Wyjdź i wypłać' },
    gameState: { en: 'Game State', pl: 'Stan gry' },
    yourStack: { en: 'Your Stack', pl: 'Twój stack' },
    pot: { en: 'Pot', pl: 'Pula' },
    phase: { en: 'Phase', pl: 'Faza' },
    version: { en: 'Version', pl: 'Wersja' },
    showRawJson: { en: 'Show raw JSON', pl: 'Pokaż JSON' },
    noOpenTables: { en: 'No open tables', pl: 'Brak otwartych stołów' },
    loading: { en: 'Loading...', pl: 'Ładowanie...' },
    pokerAuthLobby: { en: 'Please log in to access the poker lobby.', pl: 'Zaloguj się, aby uzyskać dostęp do lobby pokera.' },
    pokerAuthTable: { en: 'Please log in to view this table.', pl: 'Zaloguj się, aby zobaczyć ten stół.' },
    backToLobby: { en: 'Back to lobby', pl: 'Powrót do lobby' },
    pokerErrLoadTables: { en: 'Failed to load tables', pl: 'Nie udało się załadować stołów' },
    pokerErrCreateTable: { en: 'Failed to create table', pl: 'Nie udało się utworzyć stołu' },
    pokerErrNoTableId: { en: 'Table created but no ID returned', pl: 'Stół utworzony, ale nie zwrócono ID' },
    pokerErrMissingTableId: { en: 'No tableId provided', pl: 'Nie podano ID stołu' },
    pokerErrLoadTable: { en: 'Failed to load table', pl: 'Nie udało się załadować stołu' },
    pokerErrJoin: { en: 'Failed to join', pl: 'Nie udało się dołączyć' },
    pokerErrLeave: { en: 'Failed to leave', pl: 'Nie udało się opuścić stołu' }
  };

  let currentLang = 'en';
  let initialized = false;
  const analytics = window.Analytics;

  function detectLang(){
    const params = new URLSearchParams(location.search);
    const p = params.get('lang');
    if (p === 'pl' || p === 'en') return p;
    const ls = localStorage.getItem('lang');
    if (ls === 'pl' || ls === 'en') return ls;
    const nav = (navigator.language || 'en').toLowerCase();
    return nav.startsWith('pl') ? 'pl' : 'en';
  }
  function persistLang(lang){
    try {
      const url = new URL(location.href);
      url.searchParams.set('lang', lang);
      history.replaceState(null, '', url.toString());
      localStorage.setItem('lang', lang);
    } catch {}
  }
  function applyLang(lang, source){
    currentLang = lang;
    const elements = document.querySelectorAll('[data-i18n], [data-href-en], [data-href-pl], [data-i18n-placeholder], [data-i18n-aria], .lang-btn');
    const update = ()=>{
      elements.forEach(el=>{
        const data = el.dataset || {};
        const key = data.i18n;
        if (key){
          const val = (dict[key] && dict[key][lang]) || el.textContent;
          if (val) el.textContent = val;
        }
        const href = lang === 'pl' ? data.hrefPl : data.hrefEn;
        if (href) el.setAttribute('href', href + location.search);
        const placeholderKey = data.i18nPlaceholder;
        if (placeholderKey){
          const v = dict[placeholderKey] && dict[placeholderKey][lang];
          if (v) el.setAttribute('placeholder', v);
        }
        const ariaKey = data.i18nAria;
        if (ariaKey){
          const v = dict[ariaKey] && dict[ariaKey][lang];
          if (v) el.setAttribute('aria-label', v);
        }
        if (el.classList && el.classList.contains('lang-btn')){
          el.setAttribute('aria-pressed', data.lang === lang ? 'true' : 'false');
        }
      });
      if (initialized && analytics && analytics.langChange){
        analytics.langChange({ lang, source: source || 'ui' });
      }
      try { document.dispatchEvent(new CustomEvent('langchange', { detail: { lang } })); } catch {}
    };

    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(update); else update();
  }

  function init(){
    const lang = detectLang();
    applyLang(lang, 'auto');
    initialized = true;
    // Wire buttons
    document.querySelectorAll('.lang-btn').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const l = btn.getAttribute('data-lang');
        persistLang(l); applyLang(l, 'button');
      });
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

  window.I18N = {
    t: (key)=> (dict[key] && dict[key][currentLang]) || '',
    getLang: ()=> currentLang,
    setLang: (l)=>{ persistLang(l); applyLang(l, 'api'); },
    apply: applyLang
  };
})();
