(function(){
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  var mockState = {
    pot: 1350,
    dealerSeat: 1,
    communityCards: [
      { rank: '10', suit: '♦' },
      { rank: 'J', suit: '♣' },
      { rank: 'Q', suit: '♥' },
      { rank: '7', suit: '♠' },
      { rank: '2', suit: '♥' }
    ],
    heroCards: [
      { rank: 'A', suit: '♠' },
      { rank: 'K', suit: '♥' }
    ],
    players: [
      { seat: 0, name: 'Victor', stack: 875, status: 'Waiting', active: false, folded: false, hero: false, cardsFaceDown: true },
      { seat: 1, name: 'Marcus', stack: 950, status: 'Thinking', active: false, folded: false, hero: false, cardsFaceDown: true },
      { seat: 2, name: 'Elena', stack: 1100, status: 'Ready', active: false, folded: false, hero: false, cardsFaceDown: true },
      { seat: 3, name: 'You', stack: 1560, status: 'Active', active: true, folded: false, hero: true, cardsFaceDown: false },
      { seat: 4, name: 'Nico', stack: 780, status: 'Folded', active: false, folded: true, hero: false, cardsFaceDown: true },
      { seat: 5, name: 'Mila', stack: 1250, status: 'Ready', active: false, folded: false, hero: false, cardsFaceDown: true }
    ]
  };

  var seatAnchors = [
    { x: 50, y: 10 },
    { x: 86, y: 28 },
    { x: 84, y: 67 },
    { x: 50, y: 92 },
    { x: 16, y: 67 },
    { x: 14, y: 28 }
  ];

  function klog(kind, data){
    try {
      if (window.KLog && typeof window.KLog.log === 'function') window.KLog.log(kind, data || {});
    } catch (_err) {}
  }

  function init(){
    renderTable(mockState);
    bindMenu();
    bindActions();
  }

  function bindMenu(){
    var toggle = document.getElementById('pokerMenuToggle');
    var panel = document.getElementById('pokerMenuPanel');
    if (!toggle || !panel) return;
    toggle.addEventListener('click', function(){
      var hidden = panel.hasAttribute('hidden');
      if (hidden) panel.removeAttribute('hidden'); else panel.setAttribute('hidden', 'hidden');
      toggle.setAttribute('aria-expanded', hidden ? 'true' : 'false');
    });
  }

  function bindActions(){
    var bar = document.getElementById('pokerActionBar');
    if (!bar) return;
    bar.addEventListener('click', function(event){
      var target = event.target;
      if (!target || !target.getAttribute) return;
      var action = target.getAttribute('data-action');
      if (!action) return;
      setSelectedAction(action);
      cycleActiveSeat(action);
      klog('poker_v2_action', { action: action });
    });
  }

  function setSelectedAction(action){
    var buttons = document.querySelectorAll('.poker-action-btn');
    for (var i = 0; i < buttons.length; i++) buttons[i].classList.remove('is-selected');
    var selected = document.querySelector('.poker-action-btn[data-action="' + action + '"]');
    if (selected) selected.classList.add('is-selected');
  }

  function cycleActiveSeat(action){
    var i;
    var nextSeat = -1;
    for (i = 0; i < mockState.players.length; i++) if (mockState.players[i].active) mockState.players[i].active = false;
    for (i = 0; i < mockState.players.length; i++) if (!mockState.players[i].folded) { nextSeat = i; break; }
    if (nextSeat < 0) return;
    if (action === 'fold') mockState.players[nextSeat].folded = true;
    nextSeat = findNextAvailableSeat(nextSeat + 1);
    if (nextSeat >= 0) {
      mockState.players[nextSeat].active = true;
      mockState.players[nextSeat].status = 'Active';
    }
    refreshStatuses();
    renderSeats(mockState.players);
  }

  function findNextAvailableSeat(start){
    var idx = start;
    var count = 0;
    while (count < mockState.players.length) {
      var test = idx % mockState.players.length;
      if (!mockState.players[test].folded) return test;
      idx++;
      count++;
    }
    return -1;
  }

  function refreshStatuses(){
    var i;
    for (i = 0; i < mockState.players.length; i++) {
      if (mockState.players[i].folded) mockState.players[i].status = 'Folded';
      else if (!mockState.players[i].active && mockState.players[i].status !== 'Waiting') mockState.players[i].status = 'Ready';
    }
  }

  function renderTable(state){
    setPot(state.pot);
    renderCommunityCards(state.communityCards);
    renderHeroCards(state.heroCards);
    renderSeats(state.players);
    positionDealerChip(state.dealerSeat);
  }

  function setPot(amount){
    var pot = document.getElementById('pokerPotPill');
    if (pot) pot.textContent = 'Pot ' + formatNumber(amount);
  }

  function renderCommunityCards(cards){
    var layer = document.getElementById('pokerCommunityCards');
    if (!layer) return;
    layer.innerHTML = '';
    for (var i = 0; i < cards.length; i++) layer.appendChild(createCard(cards[i]));
  }

  function renderHeroCards(cards){
    var layer = document.getElementById('pokerHeroCards');
    if (!layer) return;
    layer.innerHTML = '';
    for (var i = 0; i < cards.length; i++) layer.appendChild(createCard(cards[i]));
  }

  function renderSeats(players){
    var layer = document.getElementById('pokerSeatLayer');
    if (!layer) return;
    layer.innerHTML = '';
    for (var i = 0; i < players.length; i++) layer.appendChild(createSeat(players[i]));
  }

  function createSeat(player){
    var anchor = seatAnchors[player.seat] || { x: 50, y: 50 };
    var seat = document.createElement('article');
    seat.className = getSeatClass(player);
    seat.style.left = anchor.x + '%';
    seat.style.top = anchor.y + '%';

    var avatar = document.createElement('div');
    avatar.className = 'poker-seat-avatar';
    avatar.textContent = initials(player.name);

    var stack = document.createElement('div');
    stack.className = 'poker-seat-stack';
    stack.textContent = formatNumber(player.stack);

    var cards = document.createElement('div');
    cards.className = 'poker-seat-cards';
    cards.appendChild(player.cardsFaceDown ? createBackCard() : createCard(mockState.heroCards[0]));
    cards.appendChild(player.cardsFaceDown ? createBackCard() : createCard(mockState.heroCards[1]));

    var name = document.createElement('div');
    name.className = 'poker-seat-name';
    name.textContent = player.name;

    var status = document.createElement('div');
    status.className = 'poker-seat-status';
    status.textContent = player.status;

    seat.appendChild(avatar);
    seat.appendChild(stack);
    seat.appendChild(cards);
    seat.appendChild(name);
    seat.appendChild(status);
    return seat;
  }

  function createCard(cardData){
    var card = document.createElement('div');
    var isRed = cardData.suit === '♥' || cardData.suit === '♦';
    card.className = isRed ? 'poker-card poker-card--red' : 'poker-card';
    var rank = document.createElement('span');
    rank.textContent = cardData.rank;
    var suit = document.createElement('small');
    suit.textContent = cardData.suit;
    card.appendChild(rank);
    card.appendChild(suit);
    return card;
  }

  function createBackCard(){
    var card = document.createElement('div');
    card.className = 'poker-card poker-card--back';
    return card;
  }

  function getSeatClass(player){
    var cls = 'poker-seat';
    if (player.hero) cls += ' poker-seat--hero';
    if (player.active) cls += ' poker-seat--active';
    if (player.folded) cls += ' poker-seat--folded';
    return cls;
  }

  function positionDealerChip(seatIndex){
    var dealer = document.getElementById('pokerDealerChip');
    if (!dealer || !seatAnchors[seatIndex]) return;
    dealer.style.left = seatAnchors[seatIndex].x + '%';
    dealer.style.top = seatAnchors[seatIndex].y + '%';
  }

  function initials(name){
    if (!name) return 'P';
    var parts = String(name).split(' ');
    var first = parts[0] ? parts[0].charAt(0) : '';
    var second = parts[1] ? parts[1].charAt(0) : '';
    return (first + second || first || 'P').toUpperCase();
  }

  function formatNumber(value){
    var num = Number(value || 0);
    if (!isFinite(num)) return '0';
    return Math.round(num).toLocaleString();
  }

  init();
})();
