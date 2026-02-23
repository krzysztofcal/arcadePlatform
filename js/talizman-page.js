(function(){
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
  var skillStones = {
    focus: 'Fluoryt',
    confidence: 'Kamień słoneczny',
    money: 'Piryt',
    love: 'Różowy kwarc',
    creativity: 'Karneol'
  };
  var chineseSigns = ['Szczur','Bawół','Tygrys','Królik','Smok','Wąż','Koń','Koza','Małpa','Kogut','Pies','Świnia'];
  var zodiacSigns = [
    { id: 'baran', label: 'Baran' },
    { id: 'byk', label: 'Byk' },
    { id: 'bliznieta', label: 'Bliźnięta' },
    { id: 'rak', label: 'Rak' },
    { id: 'lew', label: 'Lew' },
    { id: 'panna', label: 'Panna' },
    { id: 'waga', label: 'Waga' },
    { id: 'skorpion', label: 'Skorpion' },
    { id: 'strzelec', label: 'Strzelec' },
    { id: 'koziorozec', label: 'Koziorożec' },
    { id: 'wodnik', label: 'Wodnik' },
    { id: 'ryby', label: 'Ryby' }
  ];

  function populateSelect(select, values, keyName){
    if (!select) return;
    var html = values.map(function(item){
      if (typeof item === 'string') return '<option value="'+item+'">'+item+'</option>';
      return '<option value="'+item[keyName]+'">'+item.label+'</option>';
    }).join('');
    select.innerHTML = html;
  }

  function getSelectedSkills(form){
    return Array.prototype.slice.call(form.querySelectorAll('input[name="skill"]:checked')).map(function(el){ return el.value; });
  }

  function renderResult(form, resultNode){
    var zodiac = form.zodiacSign.value;
    var chinese = form.chineseSign.value;
    var gender = (form.querySelector('input[name="gender"]:checked') || {}).value;
    var skills = getSelectedSkills(form);
    var zodiacData = zodiacStones[zodiac] || { power: 'Ametyst', protective: 'Czarny turmalin' };
    var skillStoneList = skills.length ? skills.map(function(skill){ return skillStones[skill]; }).filter(Boolean) : ['Kryształ górski'];
    var uniquePowerStone = zodiacData.power + ' + ' + skillStoneList[0];

    resultNode.hidden = false;
    resultNode.innerHTML = [
      '<h2>Twój talizman jest gotowy ✨</h2>',
      '<p><strong>Moc główna:</strong> '+uniquePowerStone+'</p>',
      '<p><strong>Kamień ochronny:</strong> '+zodiacData.protective+'</p>',
      '<p><strong>Profil:</strong> '+zodiac.toUpperCase()+', '+chinese+', '+gender+'</p>',
      '<div class="talisman-tags">',
      skillStoneList.map(function(stone){ return '<span class="talisman-tag">'+stone+'</span>'; }).join(''),
      '</div>'
    ].join('');
  }

  function detectZodiacFromDate(dateValue){
    if (!dateValue) return null;
    var date = new Date(dateValue + 'T00:00:00');
    if (Number.isNaN(date.getTime())) return null;
    var m = date.getMonth() + 1;
    var d = date.getDate();
    if ((m === 3 && d >= 21) || (m === 4 && d <= 19)) return 'baran';
    if ((m === 4 && d >= 20) || (m === 5 && d <= 20)) return 'byk';
    if ((m === 5 && d >= 21) || (m === 6 && d <= 20)) return 'bliznieta';
    if ((m === 6 && d >= 21) || (m === 7 && d <= 22)) return 'rak';
    if ((m === 7 && d >= 23) || (m === 8 && d <= 22)) return 'lew';
    if ((m === 8 && d >= 23) || (m === 9 && d <= 22)) return 'panna';
    if ((m === 9 && d >= 23) || (m === 10 && d <= 22)) return 'waga';
    if ((m === 10 && d >= 23) || (m === 11 && d <= 21)) return 'skorpion';
    if ((m === 11 && d >= 22) || (m === 12 && d <= 21)) return 'strzelec';
    if ((m === 12 && d >= 22) || (m === 1 && d <= 19)) return 'koziorozec';
    if ((m === 1 && d >= 20) || (m === 2 && d <= 18)) return 'wodnik';
    return 'ryby';
  }

  function detectChineseFromYear(year){
    var y = Number(year);
    if (!y || y < 1900) return null;
    var idx = ((y - 4) % 12 + 12) % 12;
    return chineseSigns[idx];
  }

  function init(){
    var form = document.getElementById('talismanForm');
    var resultNode = document.getElementById('talismanResult');
    if (!form || !resultNode) return;
    populateSelect(form.zodiacSign, zodiacSigns, 'id');
    populateSelect(form.chineseSign, chineseSigns);

    form.birthDate.addEventListener('change', function(){
      var zodiac = detectZodiacFromDate(form.birthDate.value);
      if (zodiac) form.zodiacSign.value = zodiac;
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

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
