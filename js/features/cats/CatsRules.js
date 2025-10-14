(function(){
  const CatsRules = {
    currentLevel(score){ return 1 + Math.floor(score / 5); },
    levelParams(lv, cfg){
      const base = cfg.baseFall;
      const per = cfg.fallPerLevel;
      const spawnEvery = Math.max(cfg.spawnEveryMin, cfg.spawnEveryBase - lv*4);
      let maxCats = 1;
      for (const rule of cfg.maxCatsAt){ if (lv >= rule.level) { maxCats = rule.cats; break; } }
      return { fallBase: base + lv*per, maxCats, spawnEvery };
    }
  };
  window.CatsRules = CatsRules;
})();

