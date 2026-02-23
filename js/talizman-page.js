(function(){
  var CUSP_DAYS = 2;
  var MAX_CUSP_BLEND = 0.35;
  var MOON_EPOCH_UTC = Date.UTC(2000, 0, 6, 18, 14, 0, 0);
  var SYNODIC_MONTH_DAYS = 29.53058867;
  var chineseSigns = ['Szczur','Bawół','Tygrys','Królik','Smok','Wąż','Koń','Koza','Małpa','Kogut','Pies','Świnia'];
  var zodiacSigns = [
    { id: 'baran', label: 'Baran', start: [3, 21], end: [4, 19] },
    { id: 'byk', label: 'Byk', start: [4, 20], end: [5, 20] },
    { id: 'bliznieta', label: 'Bliźnięta', start: [5, 21], end: [6, 20] },
    { id: 'rak', label: 'Rak', start: [6, 21], end: [7, 22] },
    { id: 'lew', label: 'Lew', start: [7, 23], end: [8, 22] },
    { id: 'panna', label: 'Panna', start: [8, 23], end: [9, 22] },
    { id: 'waga', label: 'Waga', start: [9, 23], end: [10, 22] },
    { id: 'skorpion', label: 'Skorpion', start: [10, 23], end: [11, 21] },
    { id: 'strzelec', label: 'Strzelec', start: [11, 22], end: [12, 21] },
    { id: 'koziorozec', label: 'Koziorożec', start: [12, 22], end: [1, 19] },
    { id: 'wodnik', label: 'Wodnik', start: [1, 20], end: [2, 18] },
    { id: 'ryby', label: 'Ryby', start: [2, 19], end: [3, 20] }
  ];
  var zodiacStones = {
    baran: { power: 'Karneol', protective: 'Hematyt' },
    byk: { power: 'Szmaragd', protective: 'Turmalin czarny' },
    bliznieta: { power: 'Cytryn', protective: 'Agat' },
    rak: { power: 'Kamień księżycowy', protective: 'Selenit' },
    lew: { power: 'Tygrysie oko', protective: 'Bursztyn' },
    panna: { power: 'Perydot', protective: 'Fluoryt' },
    waga: { power: 'Lapis lazuli', protective: 'Różowy kwarc' },
    skorpion: { power: 'Obsydian mahoniowy', protective: 'Czarny onyks' },
    strzelec: { power: 'Ametyst', protective: 'Sodalit' },
    koziorozec: { power: 'Granat', protective: 'Hematyt' },
    wodnik: { power: 'Akwamaryn', protective: 'Howlit' },
    ryby: { power: 'Ametryn', protective: 'Labradoryt' }
  };
  var baguaAreas = {
    wealth: { label: 'Bogactwo', direction: 'SE', element: 'Wood', stones: ['Cytryn','Awenturyn','Jadeit'] },
    career: { label: 'Kariera', direction: 'N', element: 'Water', stones: ['Akwamaryn','Sodalit','Labradoryt'] },
    health: { label: 'Zdrowie', direction: 'C', element: 'Earth', stones: ['Ametyst','Fluoryt','Howlit'] },
    family: { label: 'Rodzina', direction: 'E', element: 'Wood', stones: ['Różowy kwarc','Malachit','Jadeit'] },
    woman: { label: 'Kobieta', direction: 'SW', element: 'Earth', stones: ['Kamień księżycowy','Rodonit','Kwarc dymny'] },
    man: { label: 'Mężczyzna', direction: 'NW', element: 'Metal', stones: ['Hematyt','Onyks','Tygrysie oko'] }
  };
  var moonPhaseLabels = {
    New: 'Nów', WaxingCrescent: 'Przybywający sierp', FirstQuarter: 'Pierwsza kwadra', WaxingGibbous: 'Przybywający garb',
    Full: 'Pełnia', WaningGibbous: 'Ubywający garb', LastQuarter: 'Ostatnia kwadra', WaningCrescent: 'Ubywający sierp'
  };
  var moonAreaBonuses = {
    Full: { family: { 'Różowy kwarc': 2 }, woman: { 'Kamień księżycowy': 2 } },
    New: { wealth: { 'Cytryn': 1 }, career: { 'Akwamaryn': 1 } },
    FirstQuarter: { man: { 'Tygrysie oko': 1 }, wealth: { 'Awenturyn': 1 } },
    LastQuarter: { health: { 'Fluoryt': 1 }, woman: { Rodonit: 1 } },
    WaxingCrescent: { wealth: { Jadeit: 1 } },
    WaxingGibbous: { career: { Sodalit: 1 } },
    WaningGibbous: { health: { Howlit: 1 } },
    WaningCrescent: { family: { Malachit: 1 } }
  };
  var zodiacAreaStoneBonuses = {
    byk: { wealth: { Cytryn: 2, Awenturyn: 2 }, family: { Jadeit: 1 } },
    bliznieta: { wealth: { Cytryn: 3, Awenturyn: 2 }, career: { Sodalit: 1 } },
    rak: { woman: { 'Kamień księżycowy': 2 }, family: { 'Różowy kwarc': 1 } },
    lew: { man: { 'Tygrysie oko': 2 }, wealth: { Cytryn: 1 } },
    wodnik: { career: { Akwamaryn: 2, Labradoryt: 1 } }
  };

  function parseDate(dateValue){
    if (!dateValue) return null;
    var date = new Date(dateValue + 'T00:00:00Z');
    if (Number.isNaN(date.getTime())) return null;
    return date;
  }

  function getSignBoundsForYear(sign, year){
    var startDate = new Date(Date.UTC(year, sign.start[0] - 1, sign.start[1]));
    var endDate = new Date(Date.UTC(year, sign.end[0] - 1, sign.end[1]));
    if (sign.start[0] > sign.end[0]) endDate = new Date(Date.UTC(year + 1, sign.end[0] - 1, sign.end[1]));
    return { startDate: startDate, endDate: endDate };
  }

  function findZodiacIndex(date){
    var year = date.getUTCFullYear();
    for (var i = 0; i < zodiacSigns.length; i++) {
      var sign = zodiacSigns[i];
      var bounds = getSignBoundsForYear(sign, year);
      var prevBounds = getSignBoundsForYear(sign, year - 1);
      if (date.getTime() >= bounds.startDate.getTime() && date.getTime() <= bounds.endDate.getTime()) return i;
      if (date.getTime() >= prevBounds.startDate.getTime() && date.getTime() <= prevBounds.endDate.getTime()) return i;
    }
    return 0;
  }

  function computeZodiacInfluence(dateValue){
    var date = parseDate(dateValue);
    if (!date) return null;
    var idx = findZodiacIndex(date);
    var sign = zodiacSigns[idx];
    var prev = zodiacSigns[(idx + zodiacSigns.length - 1) % zodiacSigns.length];
    var next = zodiacSigns[(idx + 1) % zodiacSigns.length];
    var bounds = getSignBoundsForYear(sign, date.getUTCFullYear());
    if (date.getTime() < bounds.startDate.getTime() || date.getTime() > bounds.endDate.getTime()) bounds = getSignBoundsForYear(sign, date.getUTCFullYear() - 1);
    var dayMs = 86400000;
    var distanceToStart = Math.floor((date.getTime() - bounds.startDate.getTime()) / dayMs);
    var distanceToEnd = Math.floor((bounds.endDate.getTime() - date.getTime()) / dayMs);
    var blend = 0;
    var adjacent = null;
    if (distanceToStart >= 0 && distanceToStart <= CUSP_DAYS) { adjacent = prev; blend = MAX_CUSP_BLEND * ((CUSP_DAYS + 1 - distanceToStart) / (CUSP_DAYS + 1)); }
    if (distanceToEnd >= 0 && distanceToEnd <= CUSP_DAYS) {
      var endBlend = MAX_CUSP_BLEND * ((CUSP_DAYS + 1 - distanceToEnd) / (CUSP_DAYS + 1));
      if (endBlend > blend) { adjacent = next; blend = endBlend; }
    }
    var primaryWeight = Number((1 - blend).toFixed(2));
    var adjacentWeight = Number(blend.toFixed(2));
    return { primarySign: sign.id, adjacentSign: adjacent ? adjacent.id : null, primaryWeight: primaryWeight, adjacentWeight: adjacentWeight, primaryLabel: sign.label, adjacentLabel: adjacent ? adjacent.label : null };
  }

  function detectMoonPhase(dateValue){
    var date = parseDate(dateValue);
    if (!date) return null;
    var days = (date.getTime() - MOON_EPOCH_UTC) / 86400000;
    var age = ((days % SYNODIC_MONTH_DAYS) + SYNODIC_MONTH_DAYS) % SYNODIC_MONTH_DAYS;
    var phaseIndex = Math.floor(((age / SYNODIC_MONTH_DAYS) * 8) + 0.5) % 8;
    var phases = ['New', 'WaxingCrescent', 'FirstQuarter', 'WaxingGibbous', 'Full', 'WaningGibbous', 'LastQuarter', 'WaningCrescent'];
    return phases[phaseIndex];
  }

  function detectChineseFromYear(year){
    var y = Number(year);
    if (!y || y < 1900) return null;
    return chineseSigns[((y - 4) % 12 + 12) % 12];
  }

  function getChineseElement(year){
    var y = Number(year);
    if (!y || y < 1900) return null;
    var mod10 = ((y - 4) % 10 + 10) % 10;
    var idx = Math.floor(mod10 / 2);
    return ['Wood', 'Fire', 'Earth', 'Metal', 'Water'][idx];
  }

  function getElementCompatibilityScore(userElement, areaElement){
    if (!userElement || !areaElement) return 0;
    if (userElement === areaElement) return 2;
    var generates = { Wood: 'Fire', Fire: 'Earth', Earth: 'Metal', Metal: 'Water', Water: 'Wood' };
    var controls = { Wood: 'Earth', Earth: 'Water', Water: 'Fire', Fire: 'Metal', Metal: 'Wood' };
    if (generates[userElement] === areaElement) return 3;
    if (controls[userElement] === areaElement) return -2;
    if (generates[areaElement] === userElement) return 1;
    if (controls[areaElement] === userElement) return -1;
    return 0;
  }

  function getSelectedAreas(form){
    return Array.prototype.slice.call(form.querySelectorAll('input[name="area"]:checked')).map(function(el){ return el.value; });
  }

  function getAreaBonusBySign(signId, areaKey, stone){
    var bySign = zodiacAreaStoneBonuses[signId] || {};
    var byArea = bySign[areaKey] || {};
    return Number(byArea[stone] || 0);
  }

  function getMoonBonus(phase, areaKey, stone){
    var byPhase = moonAreaBonuses[phase] || {};
    var byArea = byPhase[areaKey] || {};
    return Number(byArea[stone] || 0);
  }

  function scoreAreaStones(areas, influence, moonPhase, userElement){
    var map = {};
    var firstArea = null;
    for (var i = 0; i < areas.length; i++) {
      var areaKey = areas[i];
      var area = baguaAreas[areaKey];
      if (!area) continue;
      if (!firstArea) firstArea = area;
      var compatibility = getElementCompatibilityScore(userElement, area.element);
      for (var j = 0; j < area.stones.length; j++) {
        var stone = area.stones[j];
        var base = 10 - j;
        var score = base + compatibility + getMoonBonus(moonPhase, areaKey, stone);
        score += influence.primaryWeight * getAreaBonusBySign(influence.primarySign, areaKey, stone);
        score += influence.adjacentWeight * getAreaBonusBySign(influence.adjacentSign, areaKey, stone);
        if (!map[stone] || map[stone].score < score) map[stone] = { stone: stone, score: Number(score.toFixed(2)), area: areaKey, direction: area.direction, element: area.element, areaLabel: area.label, compatibility: compatibility };
      }
    }
    return { ranked: Object.keys(map).map(function(k){ return map[k]; }).sort(function(a, b){ return b.score - a.score; }), firstArea: firstArea };
  }

  function createNode(tag, text){
    var node = document.createElement(tag);
    if (typeof text === 'string') node.textContent = text;
    return node;
  }

  function clearNode(node){ while (node.firstChild) node.removeChild(node.firstChild); }

  function buildLabelRow(label, value){
    var p = createNode('p');
    var strong = createNode('strong', label + ': ');
    p.appendChild(strong);
    p.appendChild(document.createTextNode(value));
    return p;
  }

  function calculateRecommendation(formValues){
    var influence = computeZodiacInfluence(formValues.birthDate) || { primarySign: formValues.zodiacSign, adjacentSign: null, primaryWeight: 1, adjacentWeight: 0, primaryLabel: formValues.zodiacSign, adjacentLabel: null };
    var zodiacId = influence.primarySign || formValues.zodiacSign;
    var zodiacData = zodiacStones[zodiacId] || { power: 'Ametyst', protective: 'Czarny turmalin' };
    var moonPhase = detectMoonPhase(formValues.birthDate) || 'New';
    var userElement = getChineseElement(formValues.birthYear);
    var score = formValues.areas.length ? scoreAreaStones(formValues.areas, influence, moonPhase, userElement) : { ranked: [], firstArea: null };
    var ranked = score.ranked;
    var topStone = ranked.length ? ranked[0].stone : 'Kryształ górski';
    var area = score.firstArea || { label: 'Brak', direction: '-', element: '-' };
    var topArea = ranked.length ? ranked[0] : { compatibility: 0 };
    return {
      influence: influence,
      moonPhase: moonPhase,
      moonLabel: moonPhaseLabels[moonPhase] || moonPhase,
      chineseElement: userElement || '-',
      area: { label: area.label, direction: area.direction, element: area.element },
      compatibility: Number(topArea.compatibility || 0),
      powerStone: zodiacData.power + ' + ' + topStone,
      protectiveStone: zodiacData.protective,
      tags: ranked.slice(0, 3).map(function(item){ return item.stone; }),
      why: 'Dobór łączy kierunek ' + area.direction + ', żywioł ' + area.element + ' i fazę Księżyca ' + (moonPhaseLabels[moonPhase] || moonPhase) + '.'
    };
  }

  function renderResult(form, resultNode){
    var zodiac = form.zodiacSign.value;
    var zodiacLabel = (zodiacSigns.filter(function(item){ return item.id === zodiac; })[0] || {}).label || zodiac;
    var values = {
      birthDate: form.birthDate.value,
      birthYear: form.birthYear.value,
      zodiacSign: zodiac,
      chineseSign: form.chineseSign.value,
      gender: (form.querySelector('input[name="gender"]:checked') || {}).value || '',
      areas: getSelectedAreas(form)
    };
    var rec = calculateRecommendation(values);
    var primaryPct = Math.round(rec.influence.primaryWeight * 100);
    var adjPct = Math.round(rec.influence.adjacentWeight * 100);

    resultNode.hidden = false;
    clearNode(resultNode);
    resultNode.appendChild(createNode('h2', 'Twój talizman jest gotowy ✨'));
    resultNode.appendChild(buildLabelRow('Moc główna', rec.powerStone));
    resultNode.appendChild(buildLabelRow('Kamień ochronny', rec.protectiveStone));
    resultNode.appendChild(buildLabelRow('Profil', zodiacLabel + ', ' + values.chineseSign + ', ' + values.gender));
    resultNode.appendChild(buildLabelRow('Obszar Feng Shui', rec.area.label));
    resultNode.appendChild(buildLabelRow('Kierunek', rec.area.direction));
    resultNode.appendChild(buildLabelRow('Żywioł', rec.area.element));
    resultNode.appendChild(buildLabelRow('Twój żywioł chiński', rec.chineseElement));
    resultNode.appendChild(buildLabelRow('Kompatybilność żywiołów', String(rec.compatibility)));
    if (adjPct > 0 && rec.influence.adjacentLabel) resultNode.appendChild(buildLabelRow('Wpływy znaków', rec.influence.primaryLabel + ' ' + primaryPct + '% + ' + rec.influence.adjacentLabel + ' ' + adjPct + '%'));
    else resultNode.appendChild(buildLabelRow('Wpływy znaków', rec.influence.primaryLabel + ' 100%'));
    resultNode.appendChild(buildLabelRow('Faza Księżyca', rec.moonLabel));
    resultNode.appendChild(buildLabelRow('Dlaczego', rec.why));

    var tags = createNode('div');
    tags.className = 'talisman-tags';
    var tagList = rec.tags.length ? rec.tags : ['Kryształ górski'];
    for (var i = 0; i < tagList.length; i++) { var chip = createNode('span', tagList[i]); chip.className = 'talisman-tag'; tags.appendChild(chip); }
    resultNode.appendChild(tags);
  }

  function populateSelect(select, values, keyName){
    if (!select) return;
    while (select.firstChild) select.removeChild(select.firstChild);
    for (var i = 0; i < values.length; i++) {
      var item = values[i];
      var option = document.createElement('option');
      if (typeof item === 'string') { option.value = item; option.textContent = item; }
      else { option.value = item[keyName]; option.textContent = item.label; }
      select.appendChild(option);
    }
  }

  function init(){
    var form = document.getElementById('talismanForm');
    var resultNode = document.getElementById('talismanResult');
    if (!form || !resultNode) return;
    populateSelect(form.zodiacSign, zodiacSigns, 'id');
    populateSelect(form.chineseSign, chineseSigns);
    form.birthDate.addEventListener('change', function(){ var influence = computeZodiacInfluence(form.birthDate.value); if (influence && influence.primarySign) form.zodiacSign.value = influence.primarySign; });
    form.birthYear.addEventListener('change', function(){ var chinese = detectChineseFromYear(form.birthYear.value); if (chinese) form.chineseSign.value = chinese; });
    form.addEventListener('submit', function(event){ event.preventDefault(); if (!form.checkValidity()) return; renderResult(form, resultNode); });
  }

  if (typeof window !== 'undefined') {
    window.__TalizmanEngine = { computeZodiacInfluence: computeZodiacInfluence, detectMoonPhase: detectMoonPhase, calculateRecommendation: calculateRecommendation, detectChineseFromYear: detectChineseFromYear, getChineseElement: getChineseElement, getElementCompatibilityScore: getElementCompatibilityScore, baguaAreas: baguaAreas };
  }
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  }
})();
