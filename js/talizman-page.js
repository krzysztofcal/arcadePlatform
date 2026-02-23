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
  var skillCandidates = {
    focus: [{ stone: 'Fluoryt', base: 10 }, { stone: 'Sodalit', base: 9 }, { stone: 'Ametyst', base: 8 }],
    confidence: [{ stone: 'Kamień słoneczny', base: 10 }, { stone: 'Tygrysie oko', base: 9 }, { stone: 'Karneol', base: 8 }],
    money: [{ stone: 'Piryt', base: 10 }, { stone: 'Cytryn', base: 9 }, { stone: 'Awenturyn', base: 8 }, { stone: 'Jadeit', base: 7 }],
    love: [{ stone: 'Różowy kwarc', base: 10 }, { stone: 'Rodonit', base: 9 }, { stone: 'Kamień księżycowy', base: 8 }],
    creativity: [{ stone: 'Karneol', base: 10 }, { stone: 'Cytryn', base: 9 }, { stone: 'Lapis lazuli', base: 8 }]
  };
  var signSkillBonuses = {
    byk: { money: { Piryt: 3, Cytryn: 2, Awenturyn: 2 } },
    bliznieta: { money: { Cytryn: 8, Awenturyn: 6, Piryt: 0 } },
    lew: { confidence: { 'Kamień słoneczny': 3, 'Tygrysie oko': 2 } },
    rak: { love: { 'Kamień księżycowy': 3, 'Różowy kwarc': 2 } },
    wodnik: { creativity: { 'Lapis lazuli': 3, Cytryn: 2 } }
  };
  var moonSkillStoneBonuses = {
    Full: { love: { 'Różowy kwarc': 2, 'Kamień księżycowy': 2 }, focus: { Ametyst: 1 } },
    New: { money: { Cytryn: 1, Awenturyn: 1 }, confidence: { Karneol: 1 } },
    FirstQuarter: { confidence: { 'Tygrysie oko': 1 }, money: { Piryt: 1 } },
    LastQuarter: { focus: { Fluoryt: 1 }, love: { Rodonit: 1 } },
    WaxingCrescent: { creativity: { Karneol: 1 } },
    WaxingGibbous: { money: { Cytryn: 1 } },
    WaningGibbous: { focus: { Sodalit: 1 } },
    WaningCrescent: { love: { 'Kamień księżycowy': 1 } }
  };
  var moonPhaseLabels = {
    New: 'Nów',
    WaxingCrescent: 'Przybywający sierp',
    FirstQuarter: 'Pierwsza kwadra',
    WaxingGibbous: 'Przybywający garb',
    Full: 'Pełnia',
    WaningGibbous: 'Ubywający garb',
    LastQuarter: 'Ostatnia kwadra',
    WaningCrescent: 'Ubywający sierp'
  };

  function parseDate(dateValue){
    if (!dateValue) return null;
    var date = new Date(dateValue + 'T00:00:00Z');
    if (Number.isNaN(date.getTime())) return null;
    return date;
  }

  function getSignBoundsForYear(sign, year){
    var startYear = year;
    var endYear = year;
    if (sign.start[0] > sign.end[0]) {
      if (sign.start[0] === 12) {
        if (sign.start[0] <= 3) startYear = year - 1;
        if (sign.end[0] <= 3) endYear = year;
      }
    }
    var startDate = new Date(Date.UTC(startYear, sign.start[0] - 1, sign.start[1]));
    var endDate = new Date(Date.UTC(endYear, sign.end[0] - 1, sign.end[1]));
    if (endDate.getTime() < startDate.getTime()) endDate = new Date(Date.UTC(startYear + 1, sign.end[0] - 1, sign.end[1]));
    return { startDate: startDate, endDate: endDate };
  }

  function findZodiacIndex(date){
    var year = date.getUTCFullYear();
    for (var i = 0; i < zodiacSigns.length; i++) {
      var sign = zodiacSigns[i];
      var bounds = getSignBoundsForYear(sign, year);
      if (date.getTime() >= bounds.startDate.getTime() && date.getTime() <= bounds.endDate.getTime()) return i;
      var prevBounds = getSignBoundsForYear(sign, year - 1);
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
    if (distanceToStart >= 0 && distanceToStart <= CUSP_DAYS) {
      adjacent = prev;
      blend = MAX_CUSP_BLEND * ((CUSP_DAYS + 1 - distanceToStart) / (CUSP_DAYS + 1));
    }
    if (distanceToEnd >= 0 && distanceToEnd <= CUSP_DAYS) {
      var endBlend = MAX_CUSP_BLEND * ((CUSP_DAYS + 1 - distanceToEnd) / (CUSP_DAYS + 1));
      if (endBlend > blend) {
        adjacent = next;
        blend = endBlend;
      }
    }
    var primaryWeight = Number((1 - blend).toFixed(2));
    var adjacentWeight = Number(blend.toFixed(2));
    var weights = {};
    weights[sign.id] = primaryWeight;
    if (adjacent) weights[adjacent.id] = adjacentWeight;
    return {
      primarySign: sign.id,
      adjacentSign: adjacent ? adjacent.id : null,
      weights: weights,
      primaryWeight: primaryWeight,
      adjacentWeight: adjacentWeight,
      primaryLabel: sign.label,
      adjacentLabel: adjacent ? adjacent.label : null
    };
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
    var idx = ((y - 4) % 12 + 12) % 12;
    return chineseSigns[idx];
  }

  function getSelectedSkills(form){
    return Array.prototype.slice.call(form.querySelectorAll('input[name="skill"]:checked')).map(function(el){ return el.value; });
  }

  function getSignBonus(signId, skill, stone){
    var bySign = signSkillBonuses[signId] || {};
    var bySkill = bySign[skill] || {};
    return Number(bySkill[stone] || 0);
  }

  function getMoonBonus(moonPhase, skill, stone){
    var byMoon = moonSkillStoneBonuses[moonPhase] || {};
    var bySkill = byMoon[skill] || {};
    return Number(bySkill[stone] || 0);
  }

  function scoreSkillStones(skills, influence, moonPhase){
    var map = {};
    for (var i = 0; i < skills.length; i++) {
      var skill = skills[i];
      var candidates = skillCandidates[skill] || [];
      for (var j = 0; j < candidates.length; j++) {
        var candidate = candidates[j];
        var score = candidate.base;
        score += influence.primaryWeight * getSignBonus(influence.primarySign, skill, candidate.stone);
        score += influence.adjacentWeight * getSignBonus(influence.adjacentSign, skill, candidate.stone);
        score += getMoonBonus(moonPhase, skill, candidate.stone);
        if (!map[candidate.stone] || map[candidate.stone].score < score) {
          map[candidate.stone] = { stone: candidate.stone, score: Number(score.toFixed(2)), skill: skill };
        }
      }
    }
    return Object.keys(map).map(function(key){ return map[key]; }).sort(function(a, b){ return b.score - a.score; });
  }

  function createNode(tag, text){
    var node = document.createElement(tag);
    if (typeof text === 'string') node.textContent = text;
    return node;
  }

  function clearNode(node){
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function buildLabelRow(label, value){
    var p = createNode('p');
    var strong = createNode('strong', label + ': ');
    p.appendChild(strong);
    p.appendChild(document.createTextNode(value));
    return p;
  }

  function calculateRecommendation(formValues){
    var influence = computeZodiacInfluence(formValues.birthDate) || {
      primarySign: formValues.zodiacSign,
      adjacentSign: null,
      primaryWeight: 1,
      adjacentWeight: 0,
      primaryLabel: (zodiacSigns.find(function(s){ return s.id === formValues.zodiacSign; }) || {}).label || formValues.zodiacSign,
      adjacentLabel: null
    };
    var zodiacId = influence.primarySign || formValues.zodiacSign;
    var zodiacData = zodiacStones[zodiacId] || { power: 'Ametyst', protective: 'Czarny turmalin' };
    var moonPhase = detectMoonPhase(formValues.birthDate) || 'New';
    var ranked = formValues.skills.length ? scoreSkillStones(formValues.skills, influence, moonPhase) : [];
    var topStone = ranked.length ? ranked[0].stone : 'Kryształ górski';
    var tags = ranked.slice(0, 3).map(function(item){ return item.stone; });
    if (!tags.length) tags.push('Kryształ górski');
    return {
      influence: influence,
      moonPhase: moonPhase,
      moonLabel: moonPhaseLabels[moonPhase] || moonPhase,
      powerStone: zodiacData.power + ' + ' + topStone,
      protectiveStone: zodiacData.protective,
      tags: tags,
      why: influence.adjacentWeight > 0 ? ('Cusp zwiększa wpływ ' + influence.adjacentLabel + ', więc kamienie tego znaku dostały premię.') : 'Dominujący znak prowadzi dobór kamieni bez domieszki cusp.'
    };
  }

  function renderResult(form, resultNode){
    var zodiacLabel = (zodiacSigns.find(function(item){ return item.id === form.zodiacSign.value; }) || {}).label || form.zodiacSign.value;
    var values = {
      birthDate: form.birthDate.value,
      zodiacSign: form.zodiacSign.value,
      chineseSign: form.chineseSign.value,
      gender: (form.querySelector('input[name="gender"]:checked') || {}).value || '',
      skills: getSelectedSkills(form)
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
    if (adjPct > 0 && rec.influence.adjacentLabel) {
      resultNode.appendChild(buildLabelRow('Wpływy znaków', rec.influence.primaryLabel + ' ' + primaryPct + '% + ' + rec.influence.adjacentLabel + ' ' + adjPct + '%'));
    } else {
      resultNode.appendChild(buildLabelRow('Wpływy znaków', rec.influence.primaryLabel + ' 100%'));
    }
    resultNode.appendChild(buildLabelRow('Faza Księżyca', rec.moonLabel));
    resultNode.appendChild(buildLabelRow('Dlaczego', rec.why));

    var tags = createNode('div');
    tags.className = 'talisman-tags';
    for (var i = 0; i < rec.tags.length; i++) {
      var chip = createNode('span', rec.tags[i]);
      chip.className = 'talisman-tag';
      tags.appendChild(chip);
    }
    resultNode.appendChild(tags);
  }

  function populateSelect(select, values, keyName){
    if (!select) return;
    while (select.firstChild) select.removeChild(select.firstChild);
    for (var i = 0; i < values.length; i++) {
      var item = values[i];
      var option = document.createElement('option');
      if (typeof item === 'string') {
        option.value = item;
        option.textContent = item;
      } else {
        option.value = item[keyName];
        option.textContent = item.label;
      }
      select.appendChild(option);
    }
  }

  function init(){
    var form = document.getElementById('talismanForm');
    var resultNode = document.getElementById('talismanResult');
    if (!form || !resultNode) return;
    populateSelect(form.zodiacSign, zodiacSigns, 'id');
    populateSelect(form.chineseSign, chineseSigns);

    form.birthDate.addEventListener('change', function(){
      var influence = computeZodiacInfluence(form.birthDate.value);
      if (influence && influence.primarySign) form.zodiacSign.value = influence.primarySign;
    });
    form.birthYear.addEventListener('change', function(){
      var chinese = detectChineseFromYear(form.birthYear.value);
      if (chinese) form.chineseSign.value = chinese;
    });
    form.addEventListener('submit', function(event){
      event.preventDefault();
      if (!form.checkValidity()) return;
      renderResult(form, resultNode);
    });
  }

  if (typeof window !== 'undefined') {
    window.__TalizmanEngine = {
      computeZodiacInfluence: computeZodiacInfluence,
      detectMoonPhase: detectMoonPhase,
      calculateRecommendation: calculateRecommendation,
      detectChineseFromYear: detectChineseFromYear
    };
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  }
})();
