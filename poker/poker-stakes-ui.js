(function(){
  var DASH = '—';
  var MAX_STAKES = 1000000;

  function toInt(value){
    if (value == null) return null;
    if (typeof value === 'string' && !value.trim()) return null;
    var num = Number(value);
    if (!isFinite(num) || Math.floor(num) !== num) return null;
    return num;
  }

  function parseFromObject(value){
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    var sb = toInt(value.sb);
    var bb = toInt(value.bb);
    if (sb == null || bb == null) return null;
    if (sb < 0 || bb <= 0 || sb >= bb) return null;
    if (sb > MAX_STAKES || bb > MAX_STAKES) return null;
    return { sb: sb, bb: bb };
  }

  function parseFromString(value){
    if (typeof value !== 'string') return null;
    var trimmed = value.trim();
    if (!trimmed) return null;
    var slashMatch = trimmed.match(/^(\d+)\s*\/\s*(\d+)$/);
    if (slashMatch){
      return parseFromObject({ sb: slashMatch[1], bb: slashMatch[2] });
    }
    if (trimmed.charAt(0) !== '{' && trimmed.charAt(0) !== '"') return null;
    try {
      var parsed = JSON.parse(trimmed);
      if (typeof parsed === 'string'){
        return parseFromString(parsed);
      }
      return parseFromObject(parsed);
    } catch (_err){
      return null;
    }
  }

  function parseStakesUi(stakes){
    return parseFromObject(stakes) || parseFromString(stakes);
  }

  function formatStakesUi(stakes){
    var parsed = parseStakesUi(stakes);
    if (!parsed) return DASH;
    return parsed.sb + '/' + parsed.bb;
  }

  var api = { parse: parseStakesUi, format: formatStakesUi };
  if (typeof window !== 'undefined') window.PokerStakesUi = api;
  if (typeof globalThis !== 'undefined') globalThis.PokerStakesUi = api;
})();
