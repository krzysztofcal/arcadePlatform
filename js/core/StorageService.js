(function(){
  function StorageService(config){
    const KEY = config.STORAGE_KEY;
    const DEFAULT_STATE = config.DEFAULT_STATE;
    function load(){
      try { return { ...DEFAULT_STATE, ...JSON.parse(localStorage.getItem(KEY) || "{}") }; }
      catch { return { ...DEFAULT_STATE }; }
    }
    function save(state){ localStorage.setItem(KEY, JSON.stringify(state)); }
    return { load, save };
  }
  window.StorageService = StorageService;
})();

