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
    licensesOriginalBy: { en: 'Original project by', pl: 'Oryginalny projekt:' },
    licensesLicenseMIT: { en: 'Licensed under the MIT License.', pl: 'Na licencji MIT.' },
    licensesSource: { en: 'Source:', pl: 'Źródło:' },
    playChip: { en: 'PLAY', pl: 'GRAJ' },
    searchPlaceholder: { en: 'Search games', pl: 'Szukaj gier' },
    searchAria: { en: 'Search games', pl: 'Szukaj gier' },
    catsFullscreenHint: {
      en: 'Make the game feel bigger — use the top bar icon or the yellow corner button to go full screen, and press Esc to return.',
      pl: 'Zanurz się w grze w trybie pełnoekranowym — użyj ikony w pasku u góry lub żółtego przycisku w rogu. Naciśnij Esc, aby wrócić.'
    }
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
