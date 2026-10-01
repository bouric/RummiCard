/* RummiCard — © 2026 Richard Boulais & Claude */
/* =====================================================================
   ui.js — Interface : rendu, glisser-deposer avec placement automatique,
   animations FLIP, tours des joueurs virtuels.
   ===================================================================== */
(function () {
  'use strict';

  var E = window.Engine, AI = window.AI, Solver = window.Solver;
  function $(s) { return document.querySelector(s); }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  var game = null;
  var nVirtual = 2;
  var sortMode = 'suit';
  var soundOn = true;
  var busy = false;
  var drag = null;
  var history = [];          // état au début de chacun de vos tours

  /* ================= Accueil ====================================== */

  function buildMenu() {
    var box = $('#choices');
    box.innerHTML = '';
    for (var i = 1; i <= 5; i++) {
      (function (n) {
        var b = document.createElement('button');
        b.className = 'choice' + (n === nVirtual ? ' on' : '');
        b.innerHTML = n + '<small>' + (n > 1 ? 'adversaires' : 'adversaire') + '</small>';
        b.onclick = function () { nVirtual = n; buildMenu(); };
        box.appendChild(b);
      })(i);
    }
  }

  /* ================= Cycle de partie ============================== */

  function newGame() {
    game = new E.Game(nVirtual);
    history = [game.captureState()];
    $('#menu').classList.add('hidden');
    $('#game').classList.remove('hidden');
    $('#overlay').classList.add('hidden');
    render();
    updateBar();
    toast('À vous de jouer — première pose : 30 points');
  }

  function isHumanTurn() { return game && !game.finished && game.player().human && !busy; }

  function findCard(id) {
    var bc = game.boardCards(), i;
    for (i = 0; i < bc.length; i++) if (bc[i].id === id) return bc[i];
    var h = game.human().hand;
    for (i = 0; i < h.length; i++) if (h[i].id === id) return h[i];
    return null;
  }

  function cardOrigin(id) {
    for (var i = 0; i < game.board.length; i++) {
      for (var k = 0; k < game.board[i].cards.length; k++) {
        if (game.board[i].cards[k].id === id) return { type: 'set', setId: game.board[i].id };
      }
    }
    var h = game.human().hand;
    for (var j = 0; j < h.length; j++) if (h[j].id === id) return { type: 'hand' };
    return null;
  }

  function isStaged(card) {
    return !!(game.snapshot && !game.snapshot.boardIds[card.id]);
  }

  /* ================= Rendu ======================================== */

  function cardEl(card, opts) {
    opts = opts || {};
    var d = document.createElement('div');
    d.className = 'card s' + card.suit +
      (opts.staged ? ' staged' : '') +
      (opts.pickable ? ' pickable' : '');
    d.dataset.id = card.id;
    d.innerHTML =
      '<div class="corner"><span class="rank">' + E.RANK_LABEL[card.rank] +
      '</span><span class="cs">' + E.SUIT_GLYPH[card.suit] + '</span></div>' +
      '<div class="mid">' + E.SUIT_GLYPH[card.suit] + '</div>' +
      '<div class="suit">' + E.SUIT_GLYPH[card.suit] + '</div>';
    return d;
  }

  function slotEl() {
    var d = document.createElement('div');
    d.className = 'slot';
    return d;
  }

  /* Combinaisons de reference, sans la carte en cours de deplacement. */
  function baseSets() {
    var out = [];
    for (var i = 0; i < game.board.length; i++) {
      var cards = game.board[i].cards;
      if (drag) cards = cards.filter(function (c) { return c.id !== drag.card.id; });
      else cards = cards.slice();
      if (cards.length) out.push({ id: game.board[i].id, cards: cards, slot: -1 });
    }
    return out;
  }

  function currentView() {
    if (drag && drag.view) return drag.view;
    return { sets: baseSets() };
  }

  function paintBoard() {
    var view = currentView();
    var board = $('#board');
    var total = game.boardCards().length;
    board.className = total > 70 ? 'denser' : (total > 42 ? 'dense' : '');
    board.innerHTML = '';

    if (!view.sets.length && !view.newSlot) {
      var empty = document.createElement('div');
      empty.className = 'empty';
      empty.innerHTML = '<b>La table est vide</b>Glissez vos cartes ici : elles se placeront toutes seules';
      board.appendChild(empty);
      if (isHumanTurn()) board.appendChild(newZone());
      return;
    }

    var target = drag && drag.target ? drag.target : null;
    for (var i = 0; i < view.sets.length; i++) {
      var s = view.sets[i];
      var full = s.slot >= 0 ? s.cards.concat([drag.card]) : s.cards;
      var el = document.createElement('div');
      el.className = 'set' + (isRunLayout(full) ? ' run' : '') +
        (E.isValidSet(full) ? '' : ' bad') + (s.slot >= 0 ? ' target' : '');
      el.dataset.set = s.id;
      for (var k = 0; k <= s.cards.length; k++) {
        if (k === s.slot) el.appendChild(slotEl());
        if (k < s.cards.length) {
          el.appendChild(cardEl(s.cards[k], {
            staged: isStaged(s.cards[k]),
            pickable: isHumanTurn()
          }));
        }
      }
      board.appendChild(el);
    }
    if (view.newSlot) {
      var ns = document.createElement('div');
      ns.className = 'set target';
      ns.appendChild(slotEl());
      board.appendChild(ns);
    } else if (isHumanTurn()) {
      board.appendChild(newZone());
    }
  }

  /* Suite (même couleur, valeurs qui se suivent) -> affichage vertical.
     Groupe (même valeur, couleurs différentes) -> affichage horizontal. */
  function isRunLayout(cards) {
    return cards.length >= 2 && E.sameSuit(cards) && !E.sameRank(cards);
  }

  function newZone() {
    var d = document.createElement('div');
    d.className = 'newzone';
    d.dataset.zone = 'new';
    d.innerHTML = 'Nouvelle<br>combinaison';
    return d;
  }

  function paintRack() {
    var rack = $('#rack');
    rack.innerHTML = '';
    var hand = game.human().hand.filter(function (c) {
      return !(drag && drag.card.id === c.id);
    });
    for (var i = 0; i < hand.length; i++) {
      rack.appendChild(cardEl(hand[i], { pickable: isHumanTurn() }));
    }
    $('#handcount').textContent = game.human().hand.length;
  }

  function paintOpponents(thinking) {
    var box = $('#opponents');
    box.innerHTML = '';
    for (var i = 0; i < game.players.length; i++) {
      var p = game.players[i];
      var d = document.createElement('div');
      var active = (i === game.current) && !game.finished;
      d.className = 'opp' + (active ? ' active' : '') + (active && !p.human && thinking ? ' thinking' : '');
      var fan = '';
      var shown = Math.min(p.hand.length, 6);
      for (var k = 0; k < shown; k++) fan += '<i></i>';
      d.innerHTML =
        '<div class="av">' + (p.human ? '★' : p.name.charAt(0)) + '</div>' +
        '<div class="who"><div class="nm">' + p.name + '</div><div class="sub">' +
        p.hand.length + ' cartes · ' + (p.melded ? 'en jeu' : 'à poser') +
        '</div></div><div class="fan">' + fan + '</div>';
      box.appendChild(d);
    }
  }

  function capture() {
    var m = {};
    var els = document.querySelectorAll('.card[data-id]');
    for (var i = 0; i < els.length; i++) m[els[i].dataset.id] = els[i].getBoundingClientRect();
    return m;
  }

  function flip(prev, opts) {
    var els = document.querySelectorAll('.card[data-id]');
    for (var i = 0; i < els.length; i++) {
      var el = els[i], r0 = prev[el.dataset.id];
      if (!r0) {
        el.animate(
          [{ opacity: 0, transform: 'scale(.82) translateY(-12px)' }, { opacity: 1, transform: 'none' }],
          { duration: 260, easing: 'cubic-bezier(.2,.8,.3,1)' });
        continue;
      }
      var r1 = el.getBoundingClientRect();
      var dx = r0.left - r1.left, dy = r0.top - r1.top;
      if (Math.abs(dx) < .6 && Math.abs(dy) < .6) continue;
      el.animate(
        [{ transform: 'translate(' + dx + 'px,' + dy + 'px)' }, { transform: 'none' }],
        { duration: 320, easing: 'cubic-bezier(.22,.78,.26,1)' });
    }
    if (opts && opts.land) {
      var t = document.querySelector('.card[data-id="' + opts.land + '"]');
      if (t) { t.classList.add('landed'); setTimeout(function () { t.classList.remove('landed'); }, 420); }
    }
  }

  function render(opts) {
    opts = opts || {};
    var prev = capture();
    paintBoard();
    paintRack();
    paintOpponents(opts.thinking);
    $('#deckcount').textContent = game.deck.length;
    var p = game.player();
    $('#turnpill').innerHTML = 'Tour&nbsp;<b>' + (game.finished ? 'terminé' : p.name) + '</b>';
    var hm = game.human();
    $('#meldpill').innerHTML = hm.melded
      ? 'Vous&nbsp;<b>en jeu</b>'
      : 'Première pose&nbsp;<b>' + game.stagedPoints() + '/30 pts</b>';
    flip(prev, opts);
  }

  function updateBar() {
    var human = isHumanTurn();
    var staged = game.stagedCards().length;
    var check = human ? game.checkCommit() : { ok: false, reason: '' };
    $('#commit').disabled = !human || !check.ok;
    $('#undo').disabled = !human || !staged;
    $('#draw').disabled = !human;
    $('#auto').disabled = !human;
    $('#sort').disabled = !human;
    $('#rewind').disabled = !canRewind();

    var msg = $('#msg');
    msg.className = '';
    if (!human) { msg.textContent = game.finished ? '' : 'Les autres joueurs réfléchissent…'; return; }
    if (check.ok) {
      msg.className = 'good';
      msg.innerHTML = '✓ ' + staged + ' carte' + (staged > 1 ? 's' : '') + ' posée' +
        (staged > 1 ? 's' : '') + ' (' + game.stagedPoints() + ' pts) — validez votre tour.';
    } else if (staged) {
      msg.className = 'warn';
      msg.textContent = check.reason;
    } else if (!game.human().melded) {
      msg.innerHTML = 'Première pose : posez au moins <b>30 points</b> avec vos propres cartes.';
    } else {
      msg.innerHTML = 'Glissez une carte sur la table — elle trouvera sa place toute seule.';
    }
  }

  /* ================= Sons ========================================= */

  var actx = null;
  function tone(freq, dur, type, vol, delay) {
    if (!soundOn) return;
    try {
      if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
      var t0 = actx.currentTime + (delay || 0);
      var o = actx.createOscillator(), g = actx.createGain();
      o.type = type || 'triangle';
      o.frequency.setValueAtTime(freq, t0);
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(vol || .06, t0 + .008);
      g.gain.exponentialRampToValueAtTime(.0001, t0 + dur);
      o.connect(g); g.connect(actx.destination);
      o.start(t0); o.stop(t0 + dur + .02);
    } catch (e) { /* audio indisponible */ }
  }
  function sndSnap() { tone(760, .07, 'triangle', .05); tone(1180, .05, 'triangle', .035, .02); }
  function sndLift() { tone(420, .05, 'sine', .035); }
  function sndMagic() { tone(620, .08, 'sine', .05); tone(880, .08, 'sine', .045, .06); tone(1240, .1, 'sine', .04, .12); }
  function sndWin() { [523, 659, 784, 1046].forEach(function (f, i) { tone(f, .22, 'triangle', .07, i * .11); }); }

  /* ================= Bulles / toasts ============================== */

  var toastTimer = null;
  function toast(html) {
    var t = $('#toast');
    t.innerHTML = html;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2100);
  }

  function hintBubble() {
    var h = document.getElementById('hint');
    if (!h) { h = document.createElement('div'); h.id = 'hint'; document.body.appendChild(h); }
    return h;
  }
  function clearHint() {
    var h = document.getElementById('hint');
    if (h) h.remove();
  }

  /* ================= Glisser-deposer ============================== */

  function inRect(r, x, y, pad) {
    if (!r) return false;
    pad = pad || 0;
    return x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad;
  }

  document.addEventListener('pointerdown', function (e) {
    if (!game || !isHumanTurn()) return;
    var el = e.target.closest ? e.target.closest('.card[data-id]') : null;
    if (!el || !el.closest('#game')) return;
    var card = findCard(el.dataset.id);
    if (!card) return;
    var origin = cardOrigin(card.id);
    if (!origin) return;
    if (origin.type === 'set' && !game.human().melded && !isStaged(card)) {
      toast('Première pose : les cartes de la table sont intouchables.');
      return;
    }
    e.preventDefault();

    var r = el.getBoundingClientRect();
    drag = {
      card: card, origin: origin, moved: false,
      offx: e.clientX - r.left, offy: e.clientY - r.top,
      w: r.width, h: r.height,
      target: null, targetKey: '', view: null, cache: {}, rects: {}
    };
    var g = cardEl(card, {});
    g.removeAttribute('data-id');
    g.classList.add('ghost');
    g.style.width = r.width + 'px';
    g.style.height = r.height + 'px';
    document.body.appendChild(g);
    drag.ghost = g;
    moveGhost(e.clientX, e.clientY);
    sndLift();

    // La carte quitte sa place : les autres se resserrent.
    render();
    measure();
    setTarget(e.clientX, e.clientY, true);

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, true);
  });

  /* Geometrie figee au debut du glissement : evite tout clignotement. */
  function measure() {
    drag.rects = {};
    drag.rects.__board = $('#boardwrap').getBoundingClientRect();
    drag.rects.__rack = $('#rackwrap').getBoundingClientRect();
    var sets = document.querySelectorAll('#board .set[data-set]');
    for (var i = 0; i < sets.length; i++) {
      drag.rects[sets[i].dataset.set] = sets[i].getBoundingClientRect();
    }
    var nz = document.querySelector('#board .newzone');
    drag.rects.__new = nz ? nz.getBoundingClientRect() : null;
  }

  function moveGhost(x, y) {
    drag.ghost.style.left = (x - drag.offx) + 'px';
    drag.ghost.style.top = (y - drag.offy) + 'px';
  }

  function onMove(e) {
    if (!drag) return;
    if (!drag.moved) {
      var dd = Math.abs(e.clientX - (drag.ghost.offsetLeft + drag.offx)) +
        Math.abs(e.clientY - (drag.ghost.offsetTop + drag.offy));
      if (dd > 3) drag.moved = true;
    }
    moveGhost(e.clientX, e.clientY);
    setTarget(e.clientX, e.clientY, false);
    placeHint(e.clientX, e.clientY);
  }

  function setTarget(x, y, force) {
    var t = computeTarget(x, y);
    var key = t.kind + ':' + (t.setId || '') + ':' +
      (t.index === undefined ? '' : t.index) + ':' + (t.blocked ? 'x' : '');
    if (!force && key === drag.targetKey) return;
    drag.targetKey = key;
    drag.target = t;
    drag.view = buildView(t);
    var prev = capture();
    paintBoard();
    paintRack();
    flip(prev, {});
    markTargets();
  }

  function markTargets() {
    $('#rackwrap').classList.toggle('target', !!drag && drag.target && drag.target.kind === 'hand');
    var nz = document.querySelector('#board .newzone');
    if (nz) nz.classList.toggle('target', !!drag && drag.target && drag.target.kind === 'new');
  }

  function computeTarget(x, y) {
    var card = drag.card;
    if (inRect(drag.rects.__rack, x, y, 6)) return { kind: 'hand' };
    if (!inRect(drag.rects.__board, x, y, 4)) return { kind: 'none' };
    if (inRect(drag.rects.__new, x, y, 4)) return { kind: 'new' };

    var sets = baseSets(), i;
    var melded = game.human().melded;
    // Vrai si une combinaison aurait accueilli la carte mais que la règle de
    // la première pose l'interdit : on le dira au joueur au lieu de l'ignorer.
    var blocked = false;

    // 1) la combinaison directement sous le curseur
    var hover = null;
    for (i = 0; i < sets.length; i++) {
      if (inRect(drag.rects[sets[i].id], x, y, 6)) hover = sets[i];
    }
    if (hover) {
      var hi = E.acceptIndex(hover.cards, card);
      if (hi >= 0) {
        if (allowed(hover, melded)) return { kind: 'insert', setId: hover.id, index: hi };
        blocked = true;
      }
    }

    // 2) sinon, la meilleure combinaison du plateau
    var best = null, bestScore = -1e9;
    for (i = 0; i < sets.length; i++) {
      var s = sets[i];
      var idx = E.acceptIndex(s.cards, card);
      if (idx < 0) continue;
      if (!allowed(s, melded)) { blocked = true; continue; }
      var score = 0;
      if (E.isValidSet(s.cards.concat([card]))) score += 5000;
      score += s.cards.length * 120;
      // Une carte sortie d'une combinaison ne doit pas y retourner d'elle-même :
      // sinon impossible de déplacer une carte d'un carré vers un autre groupe
      // sans viser au pixel près. On y revient en relâchant dessus.
      if (drag.origin.type === 'set' && s.id === drag.origin.setId) score -= 4000;
      var r = drag.rects[s.id];
      if (r) {
        var dx = x - (r.left + r.width / 2), dy = y - (r.top + r.height / 2);
        score -= Math.sqrt(dx * dx + dy * dy) / 5;
      }
      if (score > bestScore) { bestScore = score; best = { kind: 'insert', setId: s.id, index: idx }; }
    }
    if (best) return best;

    // 3) sinon, reorganisation complete de la table
    if (melded) {
      var re = rearrangement();
      if (re) return { kind: 'rearrange' };
    }
    return { kind: 'new', blocked: blocked };
  }

  /* Pendant la premiere pose, seules les combinaisons entierement
     composees des cartes du tour sont manipulables. */
  function allowed(set, melded) {
    if (melded) return true;
    for (var i = 0; i < set.cards.length; i++) if (!isStaged(set.cards[i])) return false;
    return true;
  }

  function rearrangement() {
    if (drag.cache.re !== undefined) return drag.cache.re;
    var sets = baseSets(), cards = [];
    for (var i = 0; i < sets.length; i++) cards = cards.concat(sets[i].cards);
    var res = cards.length
      ? Solver.solve(cards, [drag.card], { objective: 'count', mustUse: [drag.card] })
      : null;
    drag.cache.re = (res && res.count) ? res.sets : null;
    return drag.cache.re;
  }

  function buildView(t) {
    var sets = baseSets(), i;
    if (t.kind === 'insert') {
      for (i = 0; i < sets.length; i++) if (sets[i].id === t.setId) sets[i].slot = t.index;
      return { sets: sets };
    }
    if (t.kind === 'new') return { sets: sets, newSlot: true };
    if (t.kind === 'rearrange') {
      var src = rearrangement(), out = [];
      for (i = 0; i < src.length; i++) {
        var ordered = E.orderSet(src[i]);
        var slot = -1, rest = [];
        for (var k = 0; k < ordered.length; k++) {
          if (ordered[k].id === drag.card.id) slot = rest.length;
          else rest.push(ordered[k]);
        }
        out.push({ id: 'p' + i, cards: rest, slot: slot });
      }
      return { sets: out, rearranged: true };
    }
    return { sets: sets };
  }

  function placeHint(x, y) {
    if (!drag || !drag.target) return;
    var h = hintBubble(), t = drag.target, txt = '';
    if (t.kind === 'insert') {
      var s = null, sets = baseSets();
      for (var i = 0; i < sets.length; i++) if (sets[i].id === t.setId) s = sets[i];
      var full = s ? s.cards.concat([drag.card]) : [];
      txt = E.isValidSet(full)
        ? '✓ s’insère ici'
        : 'en construction…';
    } else if (t.kind === 'rearrange') txt = '<b>✨ la table se réorganise</b>';
    else if (t.kind === 'new') {
      txt = t.blocked
        ? '<b>⚠ première pose</b> : 30 points avec vos cartes d’abord'
        : 'nouvelle combinaison';
    }
    else if (t.kind === 'hand') txt = 'reprendre en main';
    else txt = 'relâchez sur la table';
    h.innerHTML = txt;
    h.style.left = (x + 16) + 'px';
    h.style.top = (y + 18) + 'px';
  }

  function onUp(e) {
    if (!drag) return;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp, true);
    clearHint();

    // Simple clic sans deplacement : placement automatique.
    if (!drag.moved && drag.origin.type === 'hand') {
      var b = drag.rects.__board;
      setTarget(b.left + b.width / 2, b.top + b.height * .45, true);
    }
    var d = drag, t = d.target || { kind: 'none' };
    drag = null;
    if (d.ghost) d.ghost.remove();
    $('#rackwrap').classList.remove('target');
    applyDrop(d, t);
  }

  function applyDrop(d, t) {
    var card = d.card;

    if (t.kind === 'none') { render(); return; }

    if (t.kind === 'hand') {
      if (d.origin.type === 'hand') { render(); return; }
      if (!isStaged(card)) { toast('Cette carte appartient déjà à la table.'); render(); return; }
      removeFromBoard(card);
      game.human().hand.push(card);
      game.sortHand(game.human(), sortMode);
      game.compact();
      render(); updateBar(); sndSnap();
      return;
    }

    // retire la carte de son origine
    if (d.origin.type === 'hand') {
      game.human().hand = game.human().hand.filter(function (c) { return c.id !== card.id; });
    } else {
      removeFromBoard(card);
    }

    if (t.kind === 'insert') {
      var s = game.setById(t.setId);
      if (s) {
        s.cards.splice(Math.min(t.index, s.cards.length), 0, card);
        s.cards = E.orderSet(s.cards);
      } else {
        game.board.push(game.newSet([card]));
      }
      sndSnap();
    } else if (t.kind === 'rearrange') {
      var src = t.sets || (d.cache && d.cache.re);
      game.board = src.map(function (cards) { return game.newSet(E.orderSet(cards)); });
      sndMagic();
      toast('✨ La table s’est réorganisée pour accueillir ' + E.label(card));
    } else {
      game.board.push(game.newSet([card]));
      sndSnap();
      if (t.blocked) {
        toast('Première pose : impossible de compléter une combinaison de la table. ' +
              'Posez d’abord 30 points avec vos seules cartes.');
      }
    }
    game.compact();
    render({ land: card.id });
    updateBar();
  }

  function removeFromBoard(card) {
    for (var i = 0; i < game.board.length; i++) {
      game.board[i].cards = game.board[i].cards.filter(function (c) { return c.id !== card.id; });
    }
  }

  /* ================= Actions ====================================== */

  function cloneState() {
    return {
      board: game.board.map(function (s) { return { id: s.id, cards: s.cards.slice() }; }),
      hand: game.human().hand.slice()
    };
  }
  function restoreState(st) {
    game.board = st.board.map(function (s) { return { id: s.id, cards: s.cards.slice() }; });
    game.human().hand = st.hand.slice();
  }

  /* Mémorise l'état au début de chaque tour du joueur réel. */
  function pushHistory() {
    if (!game || game.finished || !game.player().human) return;
    history.push(game.captureState());
    if (history.length > 50) history.shift();
  }

  function canRewind() {
    return history.length >= 2 && game && !game.finished && game.player().human && !busy;
  }

  /* Annule le dernier coup des joueurs virtuels : on revient au début de
     votre tour précédent, donc avant leurs réponses. */
  function doRewind() {
    if (!canRewind()) return;
    history.pop();
    game.applyState(history[history.length - 1]);
    render();
    updateBar();
    sndLift();
    toast('\u27f2 Retour avant le coup des joueurs virtuels');
  }

  function doCommit() {
    if (!isHumanTurn()) return;
    var res = game.commit();
    if (!res.ok) { toast(res.reason); return; }
    var n = game.stagedCards().length;
    render(); sndSnap();
    if (game.finished) { gameOver(); return; }
    game.nextPlayer();
    render(); updateBar();
    aiPhase();
  }

  function doUndo() {
    if (!isHumanTurn()) return;
    game.restoreTurn();
    render(); updateBar();
    toast('Tour remis à zéro');
  }

  function doDraw() {
    if (!isHumanTurn()) return;
    var had = game.stagedCards().length;
    var card = game.draw();
    render(); updateBar();
    if (card) toast('Vous piochez ' + E.label(card) + (had ? ' — vos cartes sont revenues en main' : ''));
    else toast('La pioche est vide — vous passez');
    if (game.finished) { gameOver(); return; }
    game.nextPlayer();
    render(); updateBar();
    aiPhase();
  }

  function doAuto() {
    if (!isHumanTurn()) return;
    var before = cloneState();
    game.restoreTurn();
    var p = game.human();
    var play = AI.findBestPlay(game, p, null);
    if (!play) {
      restoreState(before);
      render();
      toast(p.melded
        ? 'Aucun coup possible avec cette main — piochez.'
        : 'Impossible d’atteindre 30 points pour l’instant — piochez.');
      return;
    }
    AI.applyPlay(game, p, play);
    render(); sndMagic(); updateBar();
    toast('✨ ' + play.played.length + ' carte' + (play.played.length > 1 ? 's' : '') +
      ' posée' + (play.played.length > 1 ? 's' : '') + ' (' + play.points + ' pts)');
  }

  function doSort() {
    if (!isHumanTurn()) return;
    sortMode = sortMode === 'suit' ? 'rank' : 'suit';
    game.sortHand(game.human(), sortMode);
    render();
    toast(sortMode === 'suit' ? 'Main triée par couleur' : 'Main triée par valeur');
  }

  /* ================= Tours des joueurs virtuels =================== */

  async function aiPhase() {
    busy = true;
    updateBar();
    while (!game.finished && !game.player().human) {
      var p = game.player();
      render({ thinking: true });
      await sleep(480 + Math.random() * 320);
      var r = AI.playAITurn(game);
      if (r.kind === 'play') {
        toast('<span class="who">' + p.name + '</span> pose ' + r.played +
          ' carte' + (r.played > 1 ? 's' : ''));
        sndSnap();
      } else if (r.kind === 'draw') {
        toast('<span class="who">' + p.name + '</span> pioche');
      } else {
        toast('<span class="who">' + p.name + '</span> passe');
      }
      render();
      await sleep(620);
      if (game.finished) break;
      game.nextPlayer();
    }
    busy = false;
    pushHistory();
    render();
    updateBar();
    if (game.finished) gameOver();
    else if (game.player().human) toast('À vous !');
  }

  /* ================= Fin de partie ================================ */

  function gameOver() {
    sndWin();
    var w = game.winner;
    var rows = game.players.map(function (p) {
      return { p: p, score: game.handScore(p) };
    }).sort(function (a, b) { return a.score - b.score; });
    var html = '<div class="panel"><div class="trophy">' +
      (w && w.human ? '🏆' : '🃏') + '</div>' +
      '<h2 style="text-align:center">' +
      (w ? (w.human ? 'Vous gagnez !' : w.name + ' gagne') : 'Partie terminée') + '</h2>' +
      '<p style="text-align:center">' +
      (w && !w.hand.length ? 'Main vidée la première.' : 'Pioche épuisée : le moins de points gagne.') +
      '</p><table class="scores">';
    for (var i = 0; i < rows.length; i++) {
      html += '<tr class="' + (rows[i].p === w ? 'win' : '') + '"><td>' +
        (i + 1) + '. ' + rows[i].p.name + '</td><td class="n">' +
        rows[i].p.hand.length + ' cartes</td><td class="n">' +
        rows[i].score + ' pts</td></tr>';
    }
    html += '</table><div class="row"><button class="cta" id="again" style="flex:1">Nouvelle partie</button>' +
      '<button class="btn" id="tomenu">Menu</button></div></div>';
    var ov = $('#overlay');
    ov.innerHTML = html;
    ov.classList.remove('hidden');
    $('#again').onclick = newGame;
    $('#tomenu').onclick = function () {
      ov.classList.add('hidden');
      $('#game').classList.add('hidden');
      $('#menu').classList.remove('hidden');
    };
  }

  /* ================= Regles ======================================= */

  function showRules() {
    var ov = $('#overlay');
    ov.innerHTML = '<div class="panel">' +
      '<h2>Règles</h2><p>Le Rummikub avec 2 jeux de 52 cartes (104 cartes). ' +
      'As = 1, Valet = 11, Dame = 12, Roi = 13. Les 4 couleurs ♠ ♥ ♦ ♣ ' +
      'remplacent les couleurs des tuiles.</p>' +
      '<h3>Combinaisons</h3><ul>' +
      '<li><b>Groupe</b> : 3 ou 4 cartes de même valeur, toutes de couleurs différentes.</li>' +
      '<li><b>Suite</b> : 3 cartes ou plus de même couleur, valeurs consécutives. ' +
      'L\u2019As vaut <b>1</b> et se place avant le 2 : A-2-3 est une suite, ' +
      'mais D-R-A n\u2019en est pas une.</li></ul>' +
      '<h3>Déroulement</h3><ul>' +
      '<li>14 cartes chacun. Votre <b>première pose</b> doit totaliser <b>30 points</b> ' +
      'et n’utiliser que vos propres cartes.</li>' +
      '<li>Ensuite vous pouvez compléter et <b>réorganiser librement</b> la table, ' +
      'à condition que toutes les combinaisons soient valides à la fin du tour.</li>' +
      '<li>Rien à poser ? Vous piochez et le tour passe.</li>' +
      '<li>Le premier à vider sa main gagne. Si la pioche s’épuise, ' +
      'c’est le joueur avec le moins de points en main.</li></ul>' +
      '<h3>Placement automatique</h3><ul>' +
      '<li><b>Glissez</b> une carte vers la table : l’emplacement exact apparaît ' +
      'et la carte s’y pose toute seule.</li>' +
      '<li>Si la carte ne rentre nulle part, la table <b>se réorganise</b> ' +
      'automatiquement pour l’accueillir (✨).</li>' +
      '<li>Un simple <b>clic</b> sur une carte la place au meilleur endroit.</li>' +
      '<li><b>Jouer au mieux</b> calcule et joue le coup maximal du tour.</li>' +
      '<li><b>Revenir avant l\u2019IA</b> annule le dernier coup des joueurs ' +
      'virtuels : la partie repart du début de votre tour précédent. ' +
      'Appuyez plusieurs fois pour remonter plus loin.</li>' +
      '<li>Glissez une carte posée ce tour-ci vers votre main pour la récupérer.</li>' +
      '<li>Une fois votre première pose faite, vous pouvez prendre une carte ' +
      'd\u2019une combinaison de la table (le 4<sup>e</sup> d\u2019un carré par exemple) ' +
      'et la glisser sur une autre combinaison.</li>' +
      '</ul>' +
      '<h3>Raccourcis</h3><p>Entrée : valider · ⌫ : annuler · P : piocher · ' +
      'A : jouer au mieux · T : trier · R : revenir avant l\u2019IA</p>' +
      '<div class="row"><button class="cta" id="closerules" style="flex:1">Fermer</button></div></div>';
    ov.classList.remove('hidden');
    $('#closerules').onclick = function () { ov.classList.add('hidden'); };
  }

  /* ================= Branchements ================================= */

  $('#start').onclick = newGame;
  $('#rules-link').onclick = showRules;
  $('#help').onclick = showRules;
  $('#commit').onclick = doCommit;
  $('#undo').onclick = doUndo;
  $('#draw').onclick = doDraw;
  $('#auto').onclick = doAuto;
  $('#sort').onclick = doSort;
  $('#rewind').onclick = doRewind;
  function confirmQuit() {
    return window.confirm('Abandonner la partie en cours ?');
  }

  $('#restart').onclick = function () {
    if (game && !game.finished && !confirmQuit()) return;
    $('#overlay').classList.add('hidden');
    $('#game').classList.add('hidden');
    $('#menu').classList.remove('hidden');
  };
  $('#sound').onclick = function () {
    soundOn = !soundOn;
    $('#sound').innerHTML = soundOn ? '🔊' : '🔇';
    if (soundOn) sndSnap();
  };

  document.addEventListener('keydown', function (e) {
    if ($('#game').classList.contains('hidden')) return;
    if (!$('#overlay').classList.contains('hidden')) return;
    if (e.key === 'Enter') { doCommit(); }
    else if (e.key === 'Backspace') { e.preventDefault(); doUndo(); }
    else if (e.key === 'p' || e.key === 'P') { doDraw(); }
    else if (e.key === 'a' || e.key === 'A') { doAuto(); }
    else if (e.key === 't' || e.key === 'T') { doSort(); }
    else if (e.key === 'r' || e.key === 'R') { doRewind(); }
  });

  window.addEventListener('resize', function () { if (game) render({ animate: false }); });

  /* Version et copyright : fournis par l'hôte natif, sinon mode navigateur. */
  function stampFooter() {
    var v = $('#version');
    if (!v) return;
    v.textContent = window.APP_BUILD
      ? 'Version du ' + window.APP_BUILD
      : 'Version de développement';
  }

  stampFooter();
  buildMenu();

  /* Point d'acces utilise par les tests automatises. */
  window.RC = {
    get game() { return game; },
    set game(g) { game = g; },
    render: render,
    updateBar: updateBar,
    newGame: newGame,
    setVirtual: function (n) { nVirtual = n; },
    showRules: showRules,
    rewind: doRewind,
    showMenu: function () {
      if (game && !game.finished && !confirmQuit()) return;
      $('#overlay').classList.add('hidden');
      $('#game').classList.add('hidden');
      $('#menu').classList.remove('hidden');
    }
  };
})();
