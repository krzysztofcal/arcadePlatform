// Data-driven games list for the portal (legacy fallback for clients without fetch)
window.GAMES = [
  {
    id: 'cats-arcade',
    slug: 'catch-cats',
    title: { pl: 'Łap koty — Arcade', en: 'Catch Cats — Arcade' },
    subtitle: { pl: 'Łap koty i zdobywaj punkty!', en: 'Catch cats and score points!' },
    href: 'game_cats.html',
    thumb: 'img/games/placeholder.svg',
    category: ['Arcade'],
    tags: ['arcade', 'casual', 'skill'],
    orientation: 'portrait'
  },
  {
    id: 'trex-runner',
    slug: 'trex-runner',
    title: { pl: 'Chrome Dino Run', en: 'Chrome Dino Run' },
    subtitle: { pl: 'Skacz nad kaktusami w klasycznym endless runnerze.', en: 'Jump over cacti in the classic endless runner.' },
    href: 'game_trex.html',
    thumb: 'img/games/trex-runner.svg',
    category: ['Arcade'],
    tags: ['arcade', 'endless', 'runner'],
    orientation: 'landscape'
  },
  {
    id: 'placeholder-2',
    slug: 'coming-soon-2',
    title: { pl: 'Gra 2', en: 'Game 2' },
    subtitle: { pl: 'W przygotowaniu', en: 'Under construction' },
    href: null,
    thumb: 'img/games/placeholder.svg',
    category: ['Arcade'],
    tags: ['coming-soon'],
    orientation: 'any'
  },
  {
    id: 'gd-bubble-shooter',
    slug: 'bubble-shooter',
    title: { pl: 'Bubble Shooter', en: 'Bubble Shooter' },
    subtitle: { pl: 'Match and pop bubbles to clear the board.', en: 'Match and pop bubbles to clear the board.' },
    href: null,
    thumb: 'img/games/placeholder.svg',
    category: ['Puzzle', 'Shooter'],
    tags: ['arcade', 'match3', 'casual'],
    orientation: 'portrait'
  },
  {
    id: 'gd-2048-classic',
    slug: '2048-classic',
    title: { pl: '2048 Classic', en: '2048 Classic' },
    subtitle: { pl: 'Swipe tiles to reach 2048.', en: 'Swipe tiles to reach 2048.' },
    href: null,
    thumb: 'img/games/placeholder.svg',
    category: ['Puzzle'],
    tags: ['puzzle', 'logic', 'casual'],
    orientation: 'portrait'
  },
  {
    id: 'gd-solitaire-klondike',
    slug: 'solitaire-klondike',
    title: { pl: 'Solitaire Klondike', en: 'Solitaire Klondike' },
    subtitle: { pl: 'Classic Klondike patience.', en: 'Classic Klondike patience.' },
    href: null,
    thumb: 'img/games/placeholder.svg',
    category: ['Puzzle'],
    tags: ['cards', 'casual'],
    orientation: 'portrait'
  },
  {
    id: 'gd-sudoku',
    slug: 'sudoku',
    title: { pl: 'Sudoku', en: 'Sudoku' },
    subtitle: { pl: 'Solve number puzzles.', en: 'Solve number puzzles.' },
    href: null,
    thumb: 'img/games/placeholder.svg',
    category: ['Puzzle'],
    tags: ['logic', 'numbers'],
    orientation: 'portrait'
  },
  {
    id: 'gd-mahjong',
    slug: 'mahjong',
    title: { pl: 'Mahjong', en: 'Mahjong' },
    subtitle: { pl: 'Clear the board by matching tiles.', en: 'Clear the board by matching tiles.' },
    href: null,
    thumb: 'img/games/placeholder.svg',
    category: ['Puzzle'],
    tags: ['board', 'matching'],
    orientation: 'landscape'
  },
  {
    id: 'gd-parkour-run',
    slug: 'parkour-run',
    title: { pl: 'Parkour Run', en: 'Parkour Run' },
    subtitle: { pl: 'Sprint, slide, and vault over obstacles.', en: 'Sprint, slide, and vault over obstacles.' },
    href: null,
    thumb: 'img/games/placeholder.svg',
    category: ['Arcade'],
    tags: ['endless', 'runner'],
    orientation: 'landscape'
  },
  {
    id: 'gd-street-basketball',
    slug: 'street-basketball',
    title: { pl: 'Street Basketball', en: 'Street Basketball' },
    subtitle: { pl: 'Swipe to shoot hoops and beat the timer.', en: 'Swipe to shoot hoops and beat the timer.' },
    href: null,
    thumb: 'img/games/placeholder.svg',
    category: ['Arcade'],
    tags: ['sports'],
    orientation: 'portrait'
  },
  {
    id: 'gd-penalty-kicks',
    slug: 'penalty-kicks',
    title: { pl: 'Penalty Kicks', en: 'Penalty Kicks' },
    subtitle: { pl: 'Aim and score from the spot.', en: 'Aim and score from the spot.' },
    href: null,
    thumb: 'img/games/placeholder.svg',
    category: ['Arcade'],
    tags: ['sports'],
    orientation: 'portrait'
  },
  {
    id: 'gd-parking-challenge',
    slug: 'parking-challenge',
    title: { pl: 'Parking Challenge', en: 'Parking Challenge' },
    subtitle: { pl: 'Park without crashing in tricky levels.', en: 'Park without crashing in tricky levels.' },
    href: null,
    thumb: 'img/games/placeholder.svg',
    category: ['Racing'],
    tags: ['cars', 'skill'],
    orientation: 'portrait'
  },
  {
    id: 'gd-word-search',
    slug: 'word-search',
    title: { pl: 'Word Search', en: 'Word Search' },
    subtitle: { pl: 'Find hidden words in the grid.', en: 'Find hidden words in the grid.' },
    href: null,
    thumb: 'img/games/placeholder.svg',
    category: ['Puzzle'],
    tags: ['words', 'casual'],
    orientation: 'portrait'
  },
  {
    id: 'gd-match-3-jewels',
    slug: 'match-3-jewels',
    title: { pl: 'Match‑3 Jewels', en: 'Match‑3 Jewels' },
    subtitle: { pl: 'Swap gems to create lines and combos.', en: 'Swap gems to create lines and combos.' },
    href: null,
    thumb: 'img/games/placeholder.svg',
    category: ['Puzzle'],
    tags: ['match3', 'casual'],
    orientation: 'portrait'
  },
  {
    id: 'gd-dart-challenge',
    slug: 'dart-challenge',
    title: { pl: 'Dart Challenge', en: 'Dart Challenge' },
    subtitle: { pl: 'Aim carefully and hit the target.', en: 'Aim carefully and hit the target.' },
    href: null,
    thumb: 'img/games/placeholder.svg',
    category: ['Shooter'],
    tags: ['arcade', 'skill'],
    orientation: 'portrait'
  }
];
