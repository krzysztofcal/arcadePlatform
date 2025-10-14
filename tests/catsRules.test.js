(function(){
  test('currentLevel increases every 5 points', function(){
    expect(window.CatsRules.currentLevel(0)).toBe(1);
    expect(window.CatsRules.currentLevel(4)).toBe(1);
    expect(window.CatsRules.currentLevel(5)).toBe(2);
    expect(window.CatsRules.currentLevel(9)).toBe(2);
    expect(window.CatsRules.currentLevel(10)).toBe(3);
  });

  test('levelParams respects base and per-level fall', function(){
    const cfg = window.CONFIG.LEVEL;
    const p1 = window.CatsRules.levelParams(1, cfg);
    const p4 = window.CatsRules.levelParams(4, cfg);
    expect(p1.fallBase).toBe(cfg.baseFall + 1*cfg.fallPerLevel);
    expect(p4.fallBase).toBe(cfg.baseFall + 4*cfg.fallPerLevel);
  });

  test('levelParams caps spawnEvery at minimum', function(){
    const cfg = window.CONFIG.LEVEL;
    const pHi = window.CatsRules.levelParams(50, cfg);
    expect(pHi.spawnEvery).toBe(cfg.spawnEveryMin);
  });

  test('levelParams maxCats rises with thresholds', function(){
    const cfg = window.CONFIG.LEVEL;
    const p0 = window.CatsRules.levelParams(0, cfg);
    const p3 = window.CatsRules.levelParams(3, cfg);
    const p6 = window.CatsRules.levelParams(6, cfg);
    expect(p0.maxCats).toBeGreaterThan(0);
    expect(p3.maxCats >= p0.maxCats).toBe(true);
    expect(p6.maxCats >= p3.maxCats).toBe(true);
  });
})();

