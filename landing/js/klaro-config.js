(function(){
  var sharedDomain = /\.kcswh\.pl$/i.test(window.location.hostname) ? '.kcswh.pl' : window.location.hostname;

  function notify(consent, service){
    if (window.ArcadeConsent && typeof window.ArcadeConsent.handleConsent === 'function') {
      window.ArcadeConsent.handleConsent(service.name, consent);
    }
  }

  window.klaroConfig = {
    version: 1,
    elementID: 'klaro',
    storageMethod: 'cookie',
    storageName: 'arcade_consent',
    cookieDomain: sharedDomain,
    cookieExpiresAfterDays: 180,
    default: false,
    mustConsent: false,
    acceptAll: true,
    hideDeclineAll: false,
    hideLearnMore: false,
    htmlTexts: false,
    translations: {
      zz: {
        privacyPolicyUrl: '/legal/privacy.en',
      },
      en: {
        privacyPolicyUrl: '/legal/privacy.en',
        consentNotice: {
          description: 'We use optional analytics and advertising services only with your consent.',
        },
        consentModal: {
          title: 'Cookie preferences',
          description: 'Choose which optional services Arcade Hub may use. Necessary cookies keep the site, login, and XP features working.',
        },
        purposes: {
          necessary: { title: 'Necessary' },
          analytics: { title: 'Analytics' },
          advertising: { title: 'Advertising' },
        },
        googleAnalytics: {
          title: 'Google Analytics',
          description: 'Helps us understand aggregate site usage and improve games and navigation.',
        },
        googleAds: {
          title: 'Google AdSense',
          description: 'Allows advertising slots and ad measurement on pages that include ads.',
        },
      },
      pl: {
        privacyPolicyUrl: '/legal/privacy.pl',
        consentNotice: {
          description: 'Opcjonalne narzedzia analityczne i reklamowe uruchamiamy tylko za Twoja zgoda.',
        },
        consentModal: {
          title: 'Preferencje cookies',
          description: 'Wybierz, z ktorych opcjonalnych uslug Arcade Hub moze korzystac. Niezbedne cookies utrzymuja dzialanie strony, logowania i funkcji XP.',
        },
        purposes: {
          necessary: { title: 'Niezbedne' },
          analytics: { title: 'Analityka' },
          advertising: { title: 'Reklamy' },
        },
        googleAnalytics: {
          title: 'Google Analytics',
          description: 'Pomaga nam mierzyc zbiorcze uzycie serwisu i ulepszac gry oraz nawigacje.',
        },
        googleAds: {
          title: 'Google AdSense',
          description: 'Umozliwia wyswietlanie slotow reklamowych i pomiar reklam na stronach z reklamami.',
        },
      },
    },
    services: [
      {
        name: 'googleAnalytics',
        purposes: ['analytics'],
        cookies: [
          [/^_ga.*$/, '/', sharedDomain],
          ['_gid', '/', sharedDomain],
          ['_gat', '/', sharedDomain],
        ],
        callback: notify,
        required: false,
        optOut: false,
        onlyOnce: true,
      },
      {
        name: 'googleAds',
        purposes: ['advertising'],
        cookies: [
          [/^_gcl_.*$/, '/', sharedDomain],
          [/^__gads.*$/, '/', sharedDomain],
          [/^__gpi.*$/, '/', sharedDomain],
          [/^FCNEC$/, '/', sharedDomain],
        ],
        callback: notify,
        required: false,
        optOut: false,
        onlyOnce: true,
      },
    ],
  };
})();
