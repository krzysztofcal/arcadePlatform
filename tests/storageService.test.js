(function(){
  test('StorageService merges defaults and persists', function(){
    // Override key to avoid polluting real game state
    const key = "arcade_test_" + Date.now();
    const cfg = { ...window.CONFIG, STORAGE_KEY: key };
    const svc = window.StorageService(cfg);
    const defaultState = cfg.DEFAULT_STATE;
    // Start fresh
    localStorage.removeItem(key);
    const loaded = svc.load();
    expect(loaded).toEqual(defaultState);

    // Persist some values
    const modified = { ...loaded, tokens: loaded.tokens + 3, lastScore: 7 };
    svc.save(modified);
    const loaded2 = svc.load();
    expect(loaded2).toEqual(modified);
  });
})();

