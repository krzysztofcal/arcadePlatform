// Minimal footer i18n + language toggle (PL/EN)
(function(){
  const dict = {
    about: { en: 'About', pl: 'O serwisie' },
    licenses: { en: 'Licenses', pl: 'Licencje' },
    terms: { en: 'Terms', pl: 'Regulamin' },
    privacy: { en: 'Privacy', pl: 'Prywatność' },
    contact: { en: 'Contact', pl: 'Kontakt' },
    manageCookies: { en: 'Manage cookies', pl: 'Zarządzaj cookies' },
    menuArcadeHub: { en: 'Arcade Hub', pl: 'Arcade Hub' },
    menuLanguage: { en: 'Language', pl: 'Język' },
    home: { en: 'Home', pl: 'Start' },
    leaderboard: { en: 'Leaderboard', pl: 'Ranking' },
    leaderboardPageTitle: { en: 'XP Leaderboard', pl: 'Ranking XP' },
    leaderboardPageSubtitle: { en: 'See who is earning the most XP across Arcade Hub.', pl: 'Zobacz, kto zdobywa najwięcej XP w Arcade Hub.' },
    leaderboardToday: { en: 'Today', pl: 'Dzisiaj' },
    leaderboardWeek: { en: 'This week', pl: 'Ten tydzień' },
    leaderboardAllTime: { en: 'All time', pl: 'Cały okres' },
    leaderboardPeriodsAria: { en: 'Leaderboard period', pl: 'Okres rankingu' },
    leaderboardLoading: { en: 'Loading leaderboard...', pl: 'Wczytywanie rankingu...' },
    leaderboardLoaded: { en: 'Leaderboard loaded.', pl: 'Ranking został wczytany.' },
    leaderboardWarmupTitle: { en: 'The ranking is warming up', pl: 'Ranking dopiero się rozkręca' },
    leaderboardWarmupText: { en: 'No confirmed XP has been recorded for this period yet. Play a game and check back soon.', pl: 'W tym okresie nie zapisano jeszcze potwierdzonego XP. Zagraj i wróć za chwilę.' },
    leaderboardPageEmptyTitle: { en: 'No results on this page', pl: 'Brak wyników na tej stronie' },
    leaderboardPageEmptyText: { en: 'No public profiles are available in this part of the ranking. Use the page controls to continue.', pl: 'W tej części rankingu nie ma dostępnych profili publicznych. Użyj przycisków stron, aby przejść dalej.' },
    leaderboardUnavailableTitle: { en: 'Leaderboard unavailable', pl: 'Ranking jest niedostępny' },
    leaderboardUnavailableText: { en: 'We could not load the ranking right now. Please try again.', pl: 'Nie udało się teraz wczytać rankingu. Spróbuj ponownie.' },
    leaderboardRateLimitTitle: { en: 'Please wait a moment', pl: 'Poczekaj chwilę' },
    leaderboardRateLimitText: { en: 'The leaderboard was refreshed too often. Try again in one minute.', pl: 'Ranking był odświeżany zbyt często. Spróbuj ponownie za minutę.' },
    leaderboardNotEnabledText: { en: 'The leaderboard is not available in this environment yet.', pl: 'Ranking nie jest jeszcze dostępny w tym środowisku.' },
    leaderboardRetry: { en: 'Try again', pl: 'Spróbuj ponownie' },
    leaderboardRank: { en: 'Rank', pl: 'Miejsce' },
    leaderboardPlayer: { en: 'Player', pl: 'Gracz' },
    leaderboardPeriodXp: { en: 'Period XP', pl: 'XP w okresie' },
    leaderboardLevel: { en: 'Level', pl: 'Poziom' },
    leaderboardYourPosition: { en: 'Your position', pl: 'Twoja pozycja' },
    leaderboardYou: { en: 'You', pl: 'Ty' },
    leaderboardPageStatus: { en: 'Page {page}', pl: 'Strona {page}' },
    leaderboardPrevious: { en: 'Previous page', pl: 'Poprzednia strona' },
    leaderboardNext: { en: 'Next page', pl: 'Następna strona' },
    leaderboardTodayReset: { en: 'Today resets at 03:00 Warsaw time. Next reset: {time}.', pl: 'Dzisiejszy ranking resetuje się o 03:00 czasu warszawskiego. Następny reset: {time}.' },
    leaderboardWeekReset: { en: 'The week resets Monday at 03:00 Warsaw time. Next reset: {time}.', pl: 'Tydzień resetuje się w poniedziałek o 03:00 czasu warszawskiego. Następny reset: {time}.' },
    leaderboardAllTimeHint: { en: 'All confirmed XP earned by authenticated players.', pl: 'Całe potwierdzone XP zdobyte przez zalogowanych graczy.' },
    leaderboardProfileAria: { en: 'Open public profile for {name}', pl: 'Otwórz profil publiczny gracza {name}' },
    leaderboardAvatarAria: { en: 'Avatar of {name}', pl: 'Awatar gracza {name}' },
    profile: { en: 'Profile', pl: 'Profil' },
    settings: { en: 'Settings', pl: 'Ustawienia' },
    playRandomGame: { en: 'Play Random Game', pl: 'Losowa gra' },
    search: { en: 'Search', pl: 'Szukaj' },
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
    licensesSupabaseTitle: { en: 'Supabase JavaScript client', pl: 'Klient JavaScript Supabase' },
    licensesSupabaseDesc: {
      en: 'JavaScript client used for authentication and data access.',
      pl: 'Klient JavaScript używany do uwierzytelniania i dostępu do danych.'
    },
    licensesSupabaseLicense: {
      en: 'Licensed under the MIT License.',
      pl: 'Licencjonowane na podstawie licencji MIT.'
    },
    licensesSupabaseSource: { en: 'Source:', pl: 'Źródło:' },
    licensesOriginalBy: { en: 'Original project by', pl: 'Oryginalny projekt:' },
    licensesLicenseMIT: { en: 'Licensed under the MIT License.', pl: 'Na licencji MIT.' },
    licensesSource: { en: 'Source:', pl: 'Źródło:' },
    playChip: { en: 'PLAY', pl: 'GRAJ' },
    searchPlaceholder: { en: 'Search games', pl: 'Szukaj gier' },
    searchAria: { en: 'Search games', pl: 'Szukaj gier' },
    backToGames: { en: 'Back to games', pl: 'Wróć do gier' },
    gameLoading: { en: 'Loading...', pl: 'Ładowanie...' },
    gameDetailsLoading: { en: 'Loading game details...', pl: 'Wczytywanie szczegółów gry...' },
    waitingForConsent: { en: 'Waiting for consent...', pl: 'Oczekiwanie na zgodę...' },
    rotateDevice: { en: 'Please rotate your device', pl: 'Obróć urządzenie' },
    similarGames: { en: 'Similar games', pl: 'Podobne gry' },
    gameNotFound: { en: 'Game not found.', pl: 'Nie znaleziono gry.' },
    playableUrlMissing: { en: 'Playable URL missing.', pl: 'Brak adresu uruchamianej gry.' },
    catsFullscreenHint: {
      en: 'Make the game feel bigger — use the top bar icon or the yellow corner button to go full screen, and press Esc to return.',
      pl: 'Zanurz się w grze w trybie pełnoekranowym — użyj ikony w pasku u góry lub żółtego przycisku w rogu. Naciśnij Esc, aby wrócić.'
    },
    trexFullscreenHint: {
      en: 'Make the game feel bigger - use the top bar icon or the yellow corner button to go full screen, and press Esc to return.',
      pl: 'Powiększ grę - użyj ikony w pasku u góry lub żółtego przycisku w rogu, aby przejść na pełny ekran. Naciśnij Esc, aby wrócić.'
    },
    accountTitle: { en: 'Your account', pl: 'Twoje konto' },
    accountSubtitle: { en: 'Sign in to sync XP and manage your Arcade Hub profile.', pl: 'Zaloguj się, aby synchronizować XP i zarządzać profilem Arcade Hub.' },
    authentication: { en: 'Authentication', pl: 'Uwierzytelnianie' },
    email: { en: 'Email', pl: 'E-mail' },
    password: { en: 'Password', pl: 'Hasło' },
    createAccount: { en: 'Create account', pl: 'Załóż konto' },
    signUp: { en: 'Sign up', pl: 'Zarejestruj się' },
    choosePassword: { en: 'Choose a password', pl: 'Wybierz hasło' },
    confirmPassword: { en: 'Confirm password', pl: 'Powtórz hasło' },
    newPassword: { en: 'New password', pl: 'Nowe hasło' },
    passwordRequirements: { en: 'Use at least 8 characters.', pl: 'Użyj co najmniej 8 znaków.' },
    passwordsDoNotMatch: { en: 'Passwords do not match.', pl: 'Hasła nie są takie same.' },
    passwordTooShort: { en: 'Password must contain at least 8 characters.', pl: 'Hasło musi zawierać co najmniej 8 znaków.' },
    invalidEmail: { en: 'Enter a valid email address.', pl: 'Podaj prawidłowy adres e-mail.' },
    forgotPassword: { en: 'Forgot password?', pl: 'Nie pamiętasz hasła?' },
    sendResetLink: { en: 'Send reset link', pl: 'Wyślij link resetujący' },
    backToSignIn: { en: 'Back to sign in', pl: 'Wróć do logowania' },
    resetLinkSent: { en: 'Check your inbox for the password reset link.', pl: 'Sprawdź skrzynkę i użyj linku do resetowania hasła.' },
    saveNewPassword: { en: 'Save new password', pl: 'Zapisz nowe hasło' },
    passwordUpdated: { en: 'Password updated. You can continue to your profile.', pl: 'Hasło zostało zmienione. Możesz przejść do profilu.' },
    accountVerification: { en: 'We may ask you to verify your email before unlocking cloud sync.', pl: 'Możemy poprosić o potwierdzenie adresu e-mail przed odblokowaniem synchronizacji w chmurze.' },
    account: { en: 'Account', pl: 'Konto' },
    signedInAs: { en: 'Signed in as', pl: 'Zalogowano jako' },
    signOut: { en: 'Sign out', pl: 'Wyloguj się' },
    deleteAccount: { en: 'Delete account', pl: 'Usuń konto' },
    deleteAccountNote: { en: 'To request account deletion, contact support and include the email address linked to your Arcade Hub profile.', pl: 'Aby poprosić o usunięcie konta, skontaktuj się z pomocą i podaj adres e-mail powiązany z profilem Arcade Hub.' },
    availableChipBonuses: { en: 'Available chip bonuses', pl: 'Dostępne bonusy żetonów' },
    claimBonus: { en: 'Claim bonus', pl: 'Odbierz bonus' },
claimBonusAmount: { en: 'Claim +{amount} CH', pl: 'Odbierz +{amount} CH' },
homeBonusesTitle: { en: 'Bonuses ready to claim', pl: 'Bonusy gotowe do odebrania' },
homeBonusClaiming: { en: 'Claiming bonus...', pl: 'Odbieranie bonusu...' },
homeBonusClaimed: { en: 'Bonus added to your account.', pl: 'Bonus został dodany do konta.' },
homeBonusLoadError: { en: 'Could not load available bonuses.', pl: 'Nie udało się pobrać dostępnych bonusów.' },
    previousPage: { en: 'Previous', pl: 'Wstecz' },
    nextPage: { en: 'Next', pl: 'Dalej' },
    firstPage: { en: 'First', pl: 'Pierwsza' },
    lastPage: { en: 'Last', pl: 'Ostatnia' },
    recordsPerPage: { en: 'Records per page', pl: 'Rekordów na stronie' },
    chipHistoryPage: { en: 'Page {page} of {totalPages}', pl: 'Strona {page} z {totalPages}' },
    chipBonus: { en: 'Chip bonus', pl: 'Bonus żetonów' },
    arcadeChips: { en: 'Arcade chips', pl: 'Żetony Arcade' },
    balance: { en: 'Balance', pl: 'Saldo' },
    noChipActivity: { en: 'No chip activity yet.', pl: 'Brak aktywności żetonów.' },
    syncingChips: { en: 'Syncing chips...', pl: 'Synchronizowanie żetonów...' },
    chipHistoryLoadError: { en: 'Could not load chip history right now.', pl: 'Nie udało się teraz wczytać historii żetonów.' },
    chipsLoadError: { en: 'Could not load chips right now.', pl: 'Nie udało się teraz wczytać żetonów.' },
    chipsUnavailable: { en: 'Chips are not available right now.', pl: 'Żetony są obecnie niedostępne.' },
    loadingMoreActivity: { en: 'Loading more activity...', pl: 'Wczytywanie dalszej aktywności...' },
    chipHistoryLoadMoreError: { en: 'Could not load more activity. Scroll to retry.', pl: 'Nie udało się wczytać dalszej aktywności. Przewiń, aby spróbować ponownie.' },
    chipHistoryEnd: { en: 'End of history', pl: 'Koniec historii' },
    claimingBonus: { en: 'Claiming bonus...', pl: 'Odbieranie bonusu...' },
    bonusAdded: { en: 'Bonus added to your account.', pl: 'Bonus został dodany do Twojego konta.' },
    bonusClaimError: { en: 'Could not claim your bonus right now.', pl: 'Nie udało się teraz odebrać bonusu.' },
    authFieldsRequired: { en: 'Enter both email and password to sign in.', pl: 'Podaj e-mail i hasło, aby się zalogować.' },
    signUpFieldsRequired: { en: 'Enter both email and password to sign up.', pl: 'Podaj e-mail i hasło, aby się zarejestrować.' },
    authenticationNotReady: { en: 'Authentication is not ready. Refresh and try again.', pl: 'Uwierzytelnianie nie jest jeszcze gotowe. Odśwież stronę i spróbuj ponownie.' },
    signingIn: { en: 'Signing in...', pl: 'Logowanie...' },
    signedInSuccessfully: { en: 'Signed in successfully.', pl: 'Zalogowano pomyślnie.' },
    signedInRedirecting: { en: 'Signed in. Redirecting...', pl: 'Zalogowano. Przekierowywanie...' },
    signInError: { en: 'Could not sign in. Please try again.', pl: 'Nie udało się zalogować. Spróbuj ponownie.' },
    creatingAccount: { en: 'Creating your account...', pl: 'Tworzenie konta...' },
    verifyEmail: { en: 'Check your inbox to confirm your email.', pl: 'Sprawdź skrzynkę, aby potwierdzić e-mail.' },
    confirmationEmailSentTitle: { en: 'Confirmation email sent', pl: 'E-mail potwierdzający został wysłany' },
    confirmationEmailSent: { en: 'We sent a confirmation link to {email}.', pl: 'Wysłaliśmy link potwierdzający na adres {email}.' },
    confirmationEmailHint: { en: 'Open the link within 24 hours. You can sign in after your email is confirmed.', pl: 'Otwórz link w ciągu 24 godzin. Po potwierdzeniu adresu e-mail możesz się zalogować.' },
    accountCreated: { en: 'Account created. You are signed in.', pl: 'Konto zostało utworzone. Jesteś zalogowany.' },
    signUpError: { en: 'Could not sign up. Please try again.', pl: 'Nie udało się zarejestrować. Spróbuj ponownie.' },
    signingOut: { en: 'Signing out...', pl: 'Wylogowywanie...' },
    signedOut: { en: 'Signed out.', pl: 'Wylogowano.' },
    signOutError: { en: 'Could not sign out right now.', pl: 'Nie udało się teraz wylogować.' },
    deleteAccountSupport: { en: 'Contact support to request account deletion for this profile.', pl: 'Skontaktuj się z pomocą, aby poprosić o usunięcie tego konta.' },
    authNotConfigured: { en: 'Authentication is not configured yet.', pl: 'Uwierzytelnianie nie jest jeszcze skonfigurowane.' },
    checkingSession: { en: 'Checking session...', pl: 'Sprawdzanie sesji...' },
    signedIn: { en: 'Signed in.', pl: 'Zalogowano.' },
    signedOutNotice: { en: 'You have been signed out.', pl: 'Zostałeś wylogowany.' },
    guest: { en: 'Guest', pl: 'Gość' },
    signInToSyncProgress: { en: 'Sign in to sync progress', pl: 'Zaloguj się, aby synchronizować postęp' },
    player: { en: 'Player', pl: 'Gracz' },
    profileAccountSynced: { en: 'Account synced', pl: 'Konto zsynchronizowane' },
    xpServerMigrationNotice: { en: 'Your account XP is now synchronized with the server. Some XP previously shown only on this device was not saved to your account and could not be transferred.', pl: 'XP konta jest teraz synchronizowane z serwerem. Część punktów wcześniej widocznych tylko na tym urządzeniu nie była zapisana na koncie i nie mogła zostać przeniesiona.' },
    xpServerMigrationDismiss: { en: 'Dismiss XP synchronization notice', pl: 'Zamknij komunikat synchronizacji XP' },
    accountMenu: { en: 'Account menu', pl: 'Menu konta' },
    publicProfileTitle: { en: 'Public profile', pl: 'Profil publiczny' },
    publicDisplayName: { en: 'Display name', pl: 'Nazwa wyświetlana' },
    publicHandle: { en: 'Handle', pl: 'Identyfikator' },
    publicBio: { en: 'Bio', pl: 'Opis' },
    publicProfileNotice: { en: 'Your handle, display name, bio, and avatar are public. Email and account details are never shown.', pl: 'Twój identyfikator, nazwa wyświetlana, opis i awatar są publiczne. E-mail i dane konta nigdy nie są pokazywane.' },
    leaderboardSettingsTitle: { en: 'Leaderboard settings', pl: 'Ustawienia rankingu' },
    hideFromLeaderboard: { en: 'Hide my profile from the leaderboard', pl: 'Ukryj mój profil w rankingu' },
    hideFromLeaderboardHint: { en: 'Your public profile remains available by handle. This setting removes you from XP rankings.', pl: 'Twój profil publiczny nadal będzie dostępny pod identyfikatorem. To ustawienie usuwa Cię z rankingów XP.' },
    leaderboardVisibilityInvalid: { en: 'Choose a valid leaderboard visibility setting.', pl: 'Wybierz prawidłowe ustawienie widoczności w rankingu.' },
    publicHandleHint: { en: 'You can change your generated handle once. It then becomes permanent.', pl: 'Możesz raz zmienić wygenerowany identyfikator. Potem stanie się stały.' },
    publicHandleLockedHint: { en: 'This handle is permanent.', pl: 'Ten identyfikator jest stały.' },
    savePublicProfile: { en: 'Save public profile', pl: 'Zapisz profil publiczny' },
    savingPublicProfile: { en: 'Saving...', pl: 'Zapisywanie...' },
    publicProfileSavedShort: { en: 'Saved', pl: 'Zapisano' },
    publicProfileInvalidHandle: { en: 'Use 3-24 lowercase letters, digits, hyphens, or underscores.', pl: 'Użyj 3-24 małych liter, cyfr, myślników lub podkreśleń.' },
    publicProfileHandleTaken: { en: 'This handle is already taken.', pl: 'Ten identyfikator jest już zajęty.' },
    publicProfileReservedHandle: { en: 'This handle is reserved.', pl: 'Ten identyfikator jest zarezerwowany.' },
    publicProfileHandleLocked: { en: 'Your handle is permanent and cannot be changed again.', pl: 'Twój identyfikator jest stały i nie można go ponownie zmienić.' },
    publicProfileInvalidDisplayName: { en: 'Use 2-40 characters for your display name.', pl: 'Nazwa wyświetlana musi mieć 2-40 znaków.' },
    publicProfileBioTooLong: { en: 'Your bio can contain up to 160 characters.', pl: 'Opis może mieć maksymalnie 160 znaków.' },
    publicProfileSaveError: { en: 'Could not save your public profile.', pl: 'Nie udało się zapisać profilu publicznego.' },
    publicHandleConfirm: { en: 'Changing your handle is permanent. Continue?', pl: 'Zmiana identyfikatora jest trwała. Kontynuować?' },
    publicProfileNoChanges: { en: 'No profile changes to save.', pl: 'Brak zmian profilu do zapisania.' },
    publicProfileSaved: { en: 'Public profile saved.', pl: 'Profil publiczny zapisany.' },
    publicProfilePageTitle: { en: 'Public profile', pl: 'Profil publiczny' },
    publicProfileAvatar: { en: 'Avatar', pl: 'Awatar' },
    publicProfileXpLabel: { en: 'XP', pl: 'XP' },
    publicProfileLevelLabel: { en: 'Level', pl: 'Poziom' },
    publicProfileLoading: { en: 'Loading profile...', pl: 'Wczytywanie profilu...' },
    publicProfileNotFound: { en: 'This profile is not available.', pl: 'Ten profil nie jest dostępny.' },
    publicProfileLoadError: { en: 'Could not load this profile. Please try again.', pl: 'Nie udało się wczytać tego profilu. Spróbuj ponownie.' },
    choosePublicAvatar: { en: 'Choose avatar', pl: 'Wybierz awatar' },
    removePublicAvatar: { en: 'Restore default', pl: 'Przywróć domyślny' },
    publicAvatarRequirements: { en: 'JPEG, PNG or WebP, up to 1 MB.', pl: 'JPEG, PNG lub WebP, maksymalnie 1 MB.' },
    publicAvatarValidating: { en: 'Checking image...', pl: 'Sprawdzanie obrazu...' },
    publicAvatarUploading: { en: 'Uploading avatar...', pl: 'Przesyłanie awatara...' },
    publicAvatarProcessing: { en: 'Processing avatar...', pl: 'Przetwarzanie awatara...' },
    publicAvatarRemoving: { en: 'Restoring default avatar...', pl: 'Przywracanie domyślnego awatara...' },
    publicAvatarRemoveConfirm: { en: 'Remove your uploaded avatar and restore the default avatar?', pl: 'Usunąć wgrany awatar i przywrócić awatar domyślny?' },
    publicAvatarUpdated: { en: 'Avatar updated and visible on your profile.', pl: 'Awatar został zaktualizowany i jest widoczny na profilu.' },
    publicAvatarRemoved: { en: 'Default avatar restored.', pl: 'Przywrócono domyślny awatar.' },
    publicAvatarInvalidType: { en: 'Choose a valid JPEG, PNG or WebP image.', pl: 'Wybierz prawidłowy obraz JPEG, PNG lub WebP.' },
    publicAvatarTooLarge: { en: 'Use an image up to 1 MB and 1024 x 1024 pixels.', pl: 'Użyj obrazu do 1 MB i maksymalnie 1024 x 1024 pikseli.' },
    publicAvatarUploadError: { en: 'Could not update your avatar. Please try again.', pl: 'Nie udało się zaktualizować awatara. Spróbuj ponownie.' },
    xpProgressTitle: { en: 'XP Progress', pl: 'Postęp XP' },
    xpProgressSubtitle: { en: 'Track your overall XP, daily gains, and level progress.', pl: 'Śledź łączne XP, dzienne zdobycie i postęp poziomu.' },
    level: { en: 'Level', pl: 'Poziom' },
    totalXp: { en: 'Total XP', pl: 'Łączne XP' },
    dailyLimit: { en: 'Daily limit', pl: 'Dzienny limit' },
    progressToNextLevel: { en: 'Progress to next level', pl: 'Postęp do następnego poziomu' },
    dailyProgress: { en: 'Daily progress', pl: 'Dzienny postęp' },
    xpToday: { en: 'You have earned', pl: 'Dzisiaj zdobyto' },
    xpTodaySuffix: { en: 'XP today.', pl: 'XP.' },
    xpCapPrefix: { en: 'The daily XP cap is', pl: 'Dzienny limit XP wynosi' },
    xpLevelHint: { en: 'Each new level requires 10% more XP than the previous one. Play a little every day to keep leveling up!', pl: 'Każdy kolejny poziom wymaga o 10% więcej XP niż poprzedni. Graj każdego dnia, aby dalej zdobywać poziomy!' },
    xpProgressDetails: { en: '{current} / {total} XP to next level', pl: '{current} / {total} XP do następnego poziomu' },
    xpMaximumLevel: { en: 'Maximum level achieved', pl: 'Osiągnięto maksymalny poziom' },
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
    admin: { en: 'Admin', pl: 'Admin' },
    adminTitle: { en: 'Admin panel', pl: 'Panel administracyjny' },
    adminSubtitle: { en: 'Search users and manage chip ledger adjustments.', pl: 'Szukaj użytkowników i zarządzaj korektami w ledgerze żetonów.' },
    adminChecking: { en: 'Checking admin access...', pl: 'Sprawdzanie dostępu administratora...' },
    adminUnauthorizedTitle: { en: 'Admin access required', pl: 'Wymagany dostęp administratora' },
    adminUnauthorized: { en: 'This page is available only for allowlisted admin accounts.', pl: 'Ta strona jest dostępna tylko dla kont administratorów z allowlisty.' },
    adminUnauthorizedSignin: { en: 'Sign in with an allowlisted admin account to continue.', pl: 'Zaloguj się na konto administratora z allowlisty, aby kontynuować.' },
    adminSearchLabel: { en: 'Find user', pl: 'Znajdź użytkownika' },
    adminSearchPlaceholder: { en: 'Search by email or userId', pl: 'Szukaj po emailu lub userId' },
    adminSearchButton: { en: 'Search', pl: 'Szukaj' },
    adminSearchEmpty: { en: 'No users found.', pl: 'Nie znaleziono użytkowników.' },
    adminSelectedUser: { en: 'Selected user', pl: 'Wybrany użytkownik' },
    adminSelectedEmpty: { en: 'Select a user to view balance, ledger, and adjustments.', pl: 'Wybierz użytkownika, aby zobaczyć saldo, ledger i korekty.' },
    adminBalance: { en: 'Balance', pl: 'Saldo' },
    adminAdjustTitle: { en: 'Adjust chips', pl: 'Korekta żetonów' },
    adminAmountLabel: { en: 'Amount', pl: 'Kwota' },
    adminReasonLabel: { en: 'Reason', pl: 'Powód' },
    adminReasonPlaceholder: { en: 'Required audit reason', pl: 'Wymagany powód do audytu' },
    adminSubmit: { en: 'Apply adjustment', pl: 'Zastosuj korektę' },
    adminCopyUserId: { en: 'Copy userId', pl: 'Kopiuj userId' },
    adminCopyOk: { en: 'userId copied.', pl: 'Skopiowano userId.' },
    adminCopyFail: { en: 'Could not copy userId.', pl: 'Nie udało się skopiować userId.' },
    adminLedgerTitle: { en: 'Recent ledger entries', pl: 'Ostatnie wpisy ledgera' },
    adminNoLedger: { en: 'No ledger activity yet.', pl: 'Brak aktywności w ledgerze.' },
    adminWhen: { en: 'When', pl: 'Kiedy' },
    adminAction: { en: 'Action', pl: 'Akcja' },
    adminDetails: { en: 'Details', pl: 'Szczegóły' },
    adminSearchError: { en: 'Could not search users right now.', pl: 'Nie udało się teraz wyszukać użytkowników.' },
    adminAdjustSuccess: { en: 'Adjustment saved.', pl: 'Korekta została zapisana.' },
    adminAdjustError: { en: 'Could not save the adjustment.', pl: 'Nie udało się zapisać korekty.' },
    adminInvalidAmount: { en: 'Enter a non-zero whole amount.', pl: 'Podaj niezerową liczbę całkowitą.' },
    adminReasonRequired: { en: 'Reason is required.', pl: 'Powód jest wymagany.' },
    adminConfirmRemove: { en: 'Remove chips from this user?', pl: 'Usunąć żetony temu użytkownikowi?' },
    navPoker: { en: 'Poker', pl: 'Poker' },
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
    pokerSeatPrefix: { en: 'Seat', pl: 'Miejsce' },
    pokerSeatEmpty: { en: 'Empty', pl: 'Wolne' },
    pokerAuthLobby: { en: 'Please log in to access the poker lobby.', pl: 'Zaloguj się, aby uzyskać dostęp do lobby pokera.' },
    pokerAuthTable: { en: 'Please log in to view this table.', pl: 'Zaloguj się, aby zobaczyć ten stół.' },
    pokerAuthExpired: { en: 'Session expired. Please sign in again.', pl: 'Sesja wygasła. Zaloguj się ponownie.' },
    pokerLobbyReconnecting: { en: 'Live connection lost. Reconnecting...', pl: 'Połączenie na żywo zostało utracone. Ponawiam połączenie...' },
    backToLobby: { en: 'Back to lobby', pl: 'Powrót do lobby' },
    pokerErrLoadTables: { en: 'Failed to load tables', pl: 'Nie udało się załadować stołów' },
    pokerErrCreateTable: { en: 'Failed to create table', pl: 'Nie udało się utworzyć stołu' },
    pokerErrNoTableId: { en: 'Table created but no ID returned', pl: 'Stół utworzony, ale nie zwrócono ID' },
    pokerErrMissingTableId: { en: 'No tableId provided', pl: 'Nie podano ID stołu' },
    pokerErrLoadTable: { en: 'Failed to load table', pl: 'Nie udało się załadować stołu' },
    pokerErrJoin: { en: 'Failed to join', pl: 'Nie udało się dołączyć' },
    pokerErrLeave: { en: 'Failed to leave', pl: 'Nie udało się opuścić stołu' },
    pokerErrActionNotAllowed: { en: 'Action not allowed right now', pl: 'Akcja jest teraz niedozwolona' },
    pokerErrStateChanged: { en: 'State changed. Refreshing...', pl: 'Stan gry się zmienił. Odświeżam...' },
    pokerErrJoinPending: { en: 'Join still pending. Please try again.', pl: 'Dołączanie wciąż trwa. Spróbuj ponownie.' },
    pokerErrLeavePending: { en: 'Leave still pending. Please try again.', pl: 'Opuszczanie wciąż trwa. Spróbuj ponownie.' },
    pokerJoinPending: { en: 'Joining...', pl: 'Dołączanie...' },
    pokerLeavePending: { en: 'Leaving...', pl: 'Opuszczanie...' },
    pokerCopyLog: { en: 'Copy hand log', pl: 'Kopiuj log rozdania' },
    pokerCopyLogPending: { en: 'Copying...', pl: 'Kopiowanie...' },
    pokerCopyLogOk: { en: 'Log copied', pl: 'Log skopiowany' },
    pokerCopyLogFail: { en: 'Failed to export log', pl: 'Nie udało się wyeksportować logu' },
    pokerDumpLogs: { en: 'Dump logs', pl: 'Zrzut logów' },
    pokerDumpLogsPending: { en: 'Dumping...', pl: 'Zrzucanie...' },
    pokerDumpLogsOk: { en: 'Poker logs copied', pl: 'Logi pokera skopiowane' },
    pokerDumpLogsFail: { en: 'Failed to copy logs', pl: 'Nie udało się skopiować logów' },
    pokerDumpLogsEmpty: { en: 'No poker client logs to copy', pl: 'Brak logów klienta pokera do skopiowania' },
    pokerShowdownFlyoutTitle: { en: 'Winning hand', pl: 'Wygrane rozdanie' },
    pokerShowdownFlyoutTitleYouWon: { en: 'Congratulations, you won!', pl: 'Gratulacje, wygrałeś!' },
    pokerShowdownWinnerSingleSuffix: { en: 'won', pl: 'wygrał' },
    pokerShowdownWinnerMultiPrefix: { en: 'Winners', pl: 'Wygrali' },
    pokerShowdownFlyoutPayouts: { en: 'Payouts', pl: 'Wygrane' },
    pokerShowdownFlyoutCards: { en: 'Winner cards', pl: 'Karty zwycięzcy' },
    pokerSettlementMainPot: { en: 'Main pot', pl: 'Pula główna' },
    pokerSettlementSidePot: { en: 'Side pot {number}', pl: 'Pula boczna {number}' },
    pokerSettlementReturned: { en: 'Returned', pl: 'Zwrot' },
    pokerSettlementComplete: { en: 'Settlement complete', pl: 'Rozliczenie zakończone' },
    pokerSettlementSummaryAria: { en: 'Hand settlement', pl: 'Rozliczenie rozdania' },
    pokerSettlementPlayer: { en: 'Player', pl: 'Gracz' }
  };

  let currentLang = 'en';
  let initialized = false;
  const analytics = window.Analytics;

  function detectLang(){
    const pageLocale = /\.(en|pl)\.html$/i.exec(location.pathname || '');
    if (pageLocale) return pageLocale[1].toLowerCase();
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
    const update = ()=>{
      const elements = document.querySelectorAll('[data-i18n], [data-href-en], [data-href-pl], [data-i18n-placeholder], [data-i18n-aria], .lang-btn');
      if (document.documentElement) document.documentElement.lang = lang;
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
        setLang(l, 'button');
      });
    });
  }

  function setLang(lang, source){
    if (lang !== 'pl' && lang !== 'en') return;
    persistLang(lang);
    const localizedPath = location.pathname && location.pathname.replace(/\.(en|pl)\.html$/i, '.' + lang + '.html');
    if (localizedPath && localizedPath !== location.pathname){
      location.assign(localizedPath + location.search + location.hash);
      return;
    }
    applyLang(lang, source || 'api');
  }

  function format(key, values){
    const replacements = values || {};
    const value = (dict[key] && dict[key][currentLang]) || '';
    return value.replace(/\{([a-zA-Z0-9_]+)\}/g, function(match, name){
      return Object.prototype.hasOwnProperty.call(replacements, name) ? String(replacements[name]) : match;
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

  window.I18N = {
    t: (key)=> (dict[key] && dict[key][currentLang]) || '',
    format: format,
    getLang: ()=> currentLang,
    setLang: (l)=>{ setLang(l, 'api'); },
    apply: applyLang
  };
})();
