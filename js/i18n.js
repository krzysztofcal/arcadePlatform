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
    searchPlaceholder: { en: 'Search games (inactive in MVP)', pl: 'Szukaj gier (nieaktywne w MVP)' },
    searchAria: { en: 'Search games', pl: 'Szukaj gier' }
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
    // Update footer texts
    document.querySelectorAll('[data-i18n]').forEach(el=>{
      const key = el.getAttribute('data-i18n');
      const val = (dict[key] && dict[key][lang]) || el.textContent;
      if (val) el.textContent = val;
    });
    // Update localized hrefs
    document.querySelectorAll('[data-href-en]').forEach(el=>{
      const href = el.getAttribute(lang === 'pl' ? 'data-href-pl' : 'data-href-en');
      if (href) el.setAttribute('href', href + location.search);
    });
    // Inputs: placeholder and aria-label
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el=>{
      const k = el.getAttribute('data-i18n-placeholder');
      const v = dict[k] && dict[k][lang];
      if (v) el.setAttribute('placeholder', v);
    });
    document.querySelectorAll('[data-i18n-aria]').forEach(el=>{
      const k = el.getAttribute('data-i18n-aria');
      const v = dict[k] && dict[k][lang];
      if (v) el.setAttribute('aria-label', v);
    });
    // Toggle pressed state
    document.querySelectorAll('.lang-btn').forEach(btn=>{
      btn.setAttribute('aria-pressed', btn.getAttribute('data-lang') === lang ? 'true' : 'false');
    });
    if (initialized && analytics && analytics.langChange){
      analytics.langChange({ lang, source: source || 'ui' });
    }
    try { document.dispatchEvent(new CustomEvent('langchange', { detail: { lang } })); } catch {}
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
    setLang: (l)=>{ persistLang(l); applyLang(l, 'api'); }
  };
})();
