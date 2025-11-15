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
    searchAria: { en: 'Search games', pl: 'Szukaj gier' },
    catsFullscreenHint: {
      en: 'Make the game feel bigger — use the top bar icon or the yellow corner button to go full screen, and press Esc to return.',
      pl: 'Zanurz się w grze w trybie pełnoekranowym — użyj ikony w pasku u góry lub żółtego przycisku w rogu. Naciśnij Esc, aby wrócić.'
    },
    xp_title: { en: 'XP Progress', pl: 'Postęp XP' },
    xp_subtitle: {
      en: 'Track your overall XP, daily gains, and level progress.',
      pl: 'Śledź swój całkowity XP, dzienne przyrosty i postęp poziomu.'
    },
    xp_summary_level: { en: 'LEVEL', pl: 'POZIOM' },
    xp_summary_total_xp: { en: 'TOTAL XP', pl: 'ŁĄCZNY XP' },
    xp_summary_daily_limit: { en: 'DAILY LIMIT', pl: 'DZIENNY LIMIT' },
    xp_summary_remaining_today: { en: 'REMAINING TODAY', pl: 'POZOSTAŁO DZIŚ' },
    xp_summary_remaining_hint: {
      en: 'You can still earn {amount} XP before the reset.',
      pl: 'Możesz nadal zdobyć {amount} XP przed resetem.'
    },
    xp_summary_remaining_hint_cap: {
      en: 'Daily cap reached. Come back after reset.',
      pl: 'Dzisiejszy limit wykorzystany. Wróć po resecie.'
    },
    xp_summary_remaining_hint_unavailable: {
      en: 'Remaining allowance unavailable.',
      pl: 'Pozostały limit jest niedostępny.'
    },
    xp_progress_title: {
      en: 'Progress to next level',
      pl: 'Postęp do następnego poziomu'
    },
    xp_progress_details_fallback: {
      en: '0 / 0 XP to next level',
      pl: '0 / 0 XP do następnego poziomu'
    },
    xp_progress_details: {
      en: '{current} / {total} XP to next level',
      pl: '{current} / {total} XP do następnego poziomu'
    },
    xp_progress_details_max: {
      en: 'Maximum level achieved',
      pl: 'Osiągnięto maksymalny poziom'
    },
    xp_daily_title: { en: 'Daily progress', pl: 'Dzisiejszy postęp' },
    xp_daily_line: {
      en: 'You have earned {amount} XP today.',
      pl: 'Dziś zdobyłeś/zdobyłaś {amount} XP.'
    },
    xp_daily_cap_line: {
      en: 'The daily XP cap is {cap} XP.',
      pl: 'Dzienny limit XP to {cap} XP.'
    },
    xp_daily_remaining_line: {
      en: 'Remaining today: {remaining} XP.',
      pl: 'Pozostało dziś: {remaining} XP.'
    },
    xp_daily_reset_hint: {
      en: 'Daily XP resets at {time} (Europe/Warsaw).',
      pl: 'Dzienny XP resetuje się o {time} (Europa/Warszawa).'
    },
    xp_daily_leveling_hint: {
      en: 'Each new level requires 10% more XP than the previous one. Play a little every day to keep leveling up!',
      pl: 'Każdy nowy poziom wymaga o 10% więcej XP niż poprzedni. Graj codziennie po trochu, aby awansować!'
    },
    xp_boost_card_title: { en: 'Boost & combo', pl: 'Dopalacz i combo' },
    xp_boost_label: { en: 'Boost', pl: 'Dopalacz' },
    xp_combo_label: { en: 'Combo', pl: 'Combo' },
    xp_boost_status_default: { en: 'No active boost.', pl: 'Brak aktywnego dopalacza.' },
    xp_boost_status_active: {
      en: 'Active boost: {multiplier}',
      pl: 'Aktywny dopalacz: {multiplier}'
    },
    xp_boost_hint_default: {
      en: 'Boosts give temporary XP multipliers when unlocked.',
      pl: 'Dopalacze dają tymczasowe mnożniki XP po odblokowaniu.'
    },
    xp_boost_hint_timer: {
      en: 'Ends in {time}.',
      pl: 'Koniec za {time}.'
    },
    xp_boost_hint_ending: {
      en: 'Boost ends soon.',
      pl: 'Dopalacz wkrótce wygaśnie.'
    },
    xp_combo_status_default: { en: 'Combo: x1 (build)', pl: 'Combo: x1 (build)' },
    xp_combo_status: {
      en: 'Combo: {multiplier} ({mode})',
      pl: 'Combo: {multiplier} ({mode})'
    },
    xp_combo_mode_build: { en: 'build', pl: 'budowanie' },
    xp_combo_mode_sustain: { en: 'sustain', pl: 'podtrzymanie' },
    xp_combo_mode_cooldown: { en: 'cooldown', pl: 'wyciszanie' },
    xp_combo_hint_build: {
      en: 'Keep playing to build your combo.',
      pl: 'Graj dalej, aby budować combo.'
    },
    xp_combo_hint_sustain: {
      en: 'Stay active to keep your combo.',
      pl: 'Pozostań aktywny, aby utrzymać combo.'
    },
    xp_combo_hint_cooldown: {
      en: 'Combo cooling down.',
      pl: 'Combo stygnie.'
    },
    xp_fallback_title: { en: 'XP system unavailable', pl: 'System XP niedostępny' },
    xp_fallback_text: {
      en: "We couldn't load your XP data right now. Refresh the page or try again later.",
      pl: 'Nie udało się wczytać Twoich danych XP. Odśwież stronę lub spróbuj ponownie później.'
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
    setLang: (l)=>{ persistLang(l); applyLang(l, 'api'); },
    apply: applyLang
  };
})();
