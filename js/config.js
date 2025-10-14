// Centralized configuration constants for the arcade platform
window.CONFIG = {
  ASPECT_RATIO: 460/320,
  FULLSCREEN_RESERVED: 200,
  STORAGE_KEY: "arcade_cats_smooth_state_page_fs_fix",
  DEFAULT_STATE: { tokens: 10, lastScore: 0, highScore: 0 },
  PADDLE: { width: 110, height: 14, speed: 6, baselineOffset: 24 },
  CAT: { radius: 11 },
  LEVEL: {
    baseFall: 2.2,
    fallPerLevel: 0.6,
    spawnEveryBase: 40,
    spawnEveryMin: 14,
    // increases max simultaneous cats as level rises
    maxCatsAt: [
      { level: 6, cats: 3 },
      { level: 3, cats: 2 },
      { level: 0, cats: 1 }
    ]
  }
};

