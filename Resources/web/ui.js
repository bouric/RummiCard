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
  /* Réglages du joueur (persistés par l'hôte natif, sinon localStorage).
       tri        : 'suit' = par couleur puis valeur
                    'rank' = par valeur puis couleur
       keepPlaces : garder les combinaisons à leur place sur la table */
  var prefs = { tri: 'suit', keepPlaces: true, hints: false, autoArrange: false, felt: 0 };

  /* Couleurs de tapis, du plus classique au plus sombre. */
  var FELTS = [
    { nom: 'vert', a: '#186354', b: '#0e3e34' },
    { nom: 'bleu nuit', a: '#1b4a6e', b: '#0c2a42' },
    { nom: 'bordeaux', a: '#6b2b39', b: '#3b1520' },
    { nom: 'ardoise', a: '#3b4450', b: '#1f252e' },
    { nom: 'prune', a: '#4b3568', b: '#281a3c' },
    { nom: 'tabac', a: '#6a4a26', b: '#3a2714' }
  ];

  function applyFelt() {
    var f = FELTS[prefs.felt % FELTS.length];
    document.documentElement.style.setProperty('--felt1', f.a);
    document.documentElement.style.setProperty('--felt2', f.b);
  }

  function nextFelt() {
    prefs.felt = (prefs.felt + 1) % FELTS.length;
    applyFelt();
    savePrefs();
    toast('Tapis ' + FELTS[prefs.felt].nom);
  }

  function loadPrefs() {
    var p = window.APP_PREFS || null;
    if (!p) {
      try { p = JSON.parse(window.localStorage.getItem('rummicard.prefs') || 'null'); }
      catch (e) { p = null; }
    }
    if (p) {
      if (p.tri === 'suit' || p.tri === 'rank') prefs.tri = p.tri;
      if (typeof p.keepPlaces === 'boolean') prefs.keepPlaces = p.keepPlaces;
      if (typeof p.hints === 'boolean') prefs.hints = p.hints;
      if (typeof p.autoArrange === 'boolean') prefs.autoArrange = p.autoArrange;
      if (typeof p.felt === 'number' && p.felt >= 0) prefs.felt = p.felt % FELTS.length;
    }
    E.options.keepPlaces = prefs.keepPlaces;
  }

  function savePrefs() {
    E.options.keepPlaces = prefs.keepPlaces;
    try { window.localStorage.setItem('rummicard.prefs', JSON.stringify(prefs)); } catch (e) { /* file:// */ }
    try { window.webkit.messageHandlers.prefs.postMessage(prefs); } catch (e) { /* hors app */ }
  }
  var soundOn = true;
  var busy = false;
  var drag = null;
  var history = [];          // état au début de chacun de vos tours
  var turnStack = [];        // états successifs pendant le tour en cours

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
    turnStack = [];
    $('#menu').classList.add('hidden');
    $('#game').classList.remove('hidden');
    $('#overlay').classList.add('hidden');
    render();
    updateBar();
    toast('À vous de jouer');
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

  /* Emplacement laissé libre par la carte soulevée. */
  function holeEl() {
    var d = document.createElement('div');
    d.className = 'hole';
    return d;
  }

  /* Combinaisons de référence, sans la carte en cours de déplacement.
     Celle-ci laisse un « trou » de la taille d'une carte : la table ne se
     resserre pas pendant le glissement, donc l'endroit visé ne bouge pas
     sous le curseur. */
  function baseSets() {
    var out = [];
    for (var i = 0; i < game.board.length; i++) {
      var src = game.board[i].cards, cards = [], hole = -1;
      for (var k = 0; k < src.length; k++) {
        if (drag && src[k].id === drag.card.id) hole = cards.length;
        else cards.push(src[k]);
      }
      if (cards.length || hole >= 0) {
        out.push({ id: game.board[i].id, cards: cards, slot: -1, hole: hole,
                   zone: game.board[i].zone });
      }
    }
    return out;
  }

  function currentView() {
    if (drag && drag.view) return drag.view;
    return { sets: baseSets() };
  }

  /* Zone d'affichage d'une combinaison : suites à gauche, groupes à droite.
     Tant qu'une combinaison n'a qu'une carte, son type est indécidable : on
     garde alors la zone où le joueur l'a déposée. */
  function zoneOf(set, cards) {
    if (cards.length >= 2) return isRunLayout(cards) ? 'runs' : 'groups';
    return set.zone === 'runs' ? 'runs' : 'groups';
  }

  /* Clé de rangement : les suites d'abord, par couleur puis par valeur de
     départ — donc les suites d'une même couleur côte à côte — puis les
     groupes par valeur. */
  function setKey(s) {
    var cards = s.cards, i;
    if (!cards.length) return [2, 0, 0];
    if (zoneOf(s, cards) === 'runs') {
      return [0, cards[0].suit, bounds(cards).lo];
    }
    return [1, cards[0].rank, cards.length];
  }

  /* Bornes d'une combinaison en valeurs d'affichage : dans une suite As haut,
     l'As compte 14 et se place sous le Roi. */
  function bounds(cards) {
    if (!cards.length) return { lo: 1, hi: 1 };
    var seq = E.runSeq(cards);
    if (seq) return { lo: seq[0], hi: seq[seq.length - 1] };
    var lo = cards[0].rank, hi = cards[0].rank;
    for (var i = 1; i < cards.length; i++) {
      if (cards[i].rank < lo) lo = cards[i].rank;
      if (cards[i].rank > hi) hi = cards[i].rank;
    }
    return { lo: lo, hi: hi };
  }
  function minRank(cards) { return bounds(cards).lo; }
  function maxRank(cards) { return bounds(cards).hi; }

  /* Deux suites de même couleur qui se suivent (…5♠ et 6♠…) n'ont pas de
     raison de rester séparées : on les réunit. Le joueur peut toujours les
     recouper en déposant une carte au milieu. */
  function mergeRuns() {
    var changed = true;
    while (changed) {
      changed = false;
      for (var i = 0; i < game.board.length && !changed; i++) {
        var A = game.board[i];
        if (!E.isRun(A.cards)) continue;
        for (var j = 0; j < game.board.length; j++) {
          if (i === j) continue;
          var B = game.board[j];
          if (!E.isRun(B.cards)) continue;
          if (A.cards[0].suit !== B.cards[0].suit) continue;
          if (maxRank(A.cards) + 1 !== minRank(B.cards)) continue;
          A.cards = E.orderSet(A.cards.concat(B.cards));
          game.board.splice(j, 1);
          changed = true;
          break;
        }
      }
    }
  }

  /* Pendant du regroupement : une combinaison d'une même couleur dont les
     valeurs ne se suivent plus — parce qu'on en a retiré une carte — n'est pas
     une suite trouée, ce sont deux suites. On les sépare, sinon le trou reste
     invisible et le tour semble bloqué sans raison. */
  function splitGaps() {
    var out = [], i, k;
    for (i = 0; i < game.board.length; i++) {
      var set = game.board[i], cards = set.cards;
      if (cards.length < 2 || !E.sameSuit(cards) || E.sameRank(cards)) { out.push(set); continue; }
      var hasAce = false, hasHigh = false;
      for (k = 0; k < cards.length; k++) {
        if (cards[k].rank === 1) hasAce = true;
        if (cards[k].rank >= 11) hasHigh = true;
      }
      var high = hasAce && hasHigh;
      var sorted = E.orderSet(cards), segs = [[sorted[0]]];
      for (k = 1; k < sorted.length; k++) {
        if (E.effRank(sorted[k], high) === E.effRank(sorted[k - 1], high) + 1) {
          segs[segs.length - 1].push(sorted[k]);
        } else {
          segs.push([sorted[k]]);
        }
      }
      if (segs.length === 1) { out.push(set); continue; }
      set.cards = segs[0];
      out.push(set);
      for (k = 1; k < segs.length; k++) {
        var piece = game.newSet(segs[k]);
        piece.zone = set.zone;
        out.push(piece);
      }
    }
    game.board = out;
  }

  /* Range la table (uniquement si le joueur a choisi de la garder ordonnée).
     Jamais pendant un glissement : les repères mesurés resteraient faux. */
  function tidyBoard() {
    if (!E.options.keepPlaces) return;
    game.board.sort(function (a, b) {
      var ka = setKey(a), kb = setKey(b);
      return (ka[0] - kb[0]) || (ka[1] - kb[1]) || (ka[2] - kb[2]);
    });
  }

  function makeZone(kind, title) {
    var d = document.createElement('div');
    d.className = 'zone ' + kind;
    d.dataset.zonekind = kind;
    if (title) {
      var h = document.createElement('div');
      h.className = 'zonehead';
      h.textContent = title;
      d.appendChild(h);
    }
    return d;
  }

  /* Dimensions des cartes selon la densité (doivent suivre style.css). */
  var METRICS = {
    '': { cw: 62, ch: 88 },
    'dense': { cw: 48, ch: 68 },
    'denser': { cw: 40, ch: 57 }
  };
  var GRID_TOP = 34;     // sous l'intitulé de la zone et les repères de couleur
  var RULER_W = 22;      // colonne des valeurs, côté suites
  var GROUP_X = 6;       // marge gauche côté brelans et carrés
  var SUIT_GAP = 16;     // écart entre deux couleurs
  var RUN_GAP = 8;       // écart entre les deux colonnes d'une couleur

  /* Deux colonnes fixes par couleur : chaque valeur n'existant qu'en deux
     exemplaires, jamais plus de deux suites d'une même couleur ne se
     superposent, donc deux colonnes suffisent toujours. */
  function runColX(suit, k, m) {
    return RULER_W + suit * (2 * (m.cw + RUN_GAP) + SUIT_GAP) + k * (m.cw + RUN_GAP);
  }
  /* Colonnes d'appoint, au-delà des deux colonnes fixes d'une couleur : rares,
     mais nécessaires pour ne jamais superposer deux suites. */
  function extraColX(e, m) {
    return runColX(3, 1, m) + m.cw + SUIT_GAP + e * (m.cw + RUN_GAP);
  }
  function runsWidth(m) {
    return runColX(3, 1, m) + m.cw + 10;
  }

  function setEl(s) {
    var full = s.slot >= 0 ? s.cards.concat([drag.card]) : s.cards;
    var el = document.createElement('div');
    el.className = 'set' + (isRunLayout(full) ? ' run' : '') +
      (E.isValidSet(full) ? '' : ' bad') + (s.slot >= 0 ? ' target' : '');
    el.dataset.set = s.id;
    for (var k = 0; k <= s.cards.length; k++) {
      if (k === s.slot) el.appendChild(slotEl());
      if (k === s.hole) el.appendChild(holeEl());
      if (k < s.cards.length) {
        el.appendChild(cardEl(s.cards[k], {
          staged: isStaged(s.cards[k]),
          pickable: isHumanTurn()
        }));
      }
    }
    return el;
  }

  /* Valeur la plus haute d'une combinaison. */
  function highRank(s) {
    var cards = s.slot >= 0 ? s.cards.concat([drag.card]) : s.cards;
    return cards.length ? bounds(cards).hi : 1;
  }

  /* Valeur la plus basse d'une combinaison : elle fixe sa hauteur. */
  function lowRank(s) {
    var cards = s.slot >= 0 ? s.cards.concat([drag.card]) : s.cards;
    return cards.length ? bounds(cards).lo : 1;
  }

  /* ---- Table rangée : la hauteur d'une carte = sa valeur -------------
     Chaque valeur a sa ligne, de l'As en haut au Roi en bas, dans les deux
     zones. Une suite occupe donc toujours les lignes de ses valeurs, et un
     brelan la ligne de sa valeur : on sait d'avance où regarder. */
  function paintGrid(view, board, dens) {
    var m = METRICS[dens] || METRICS[''];
    var avail = board.clientHeight || 520;
    var step = Math.round(m.ch * 0.28);
    board.style.setProperty('--step', step + 'px');
    var gridH = 13 * step + m.ch;

    // Le type de zone sert aussi de repère au glisser-déposer : il doit rester
    // « runs » / « groups », la classe d'affichage s'ajoute à part.
    var zRuns = makeZone('runs', 'Suites');
    var zGroups = makeZone('groups', 'Brelans et carrés');
    zRuns.classList.add('grid');
    zGroups.classList.add('grid');
    board.appendChild(zRuns);
    board.appendChild(zGroups);
    addRuler(zRuns, step, gridH);

    var runs = [], groups = [], i;
    for (i = 0; i < view.sets.length; i++) {
      var s = view.sets[i];
      var full = s.slot >= 0 ? s.cards.concat([drag.card]) : s.cards;
      var item = { s: s, el: setEl(s), low: lowRank(s), high: highRank(s),
                   suit: full.length ? full[0].suit : 0 };
      (zoneOf(s, full) === 'runs' ? runs : groups).push(item);
    }
    if (view.newSlot) {
      var ghost = { s: { id: '__new', cards: [], slot: 0, hole: -1 }, low: drag.card.rank,
                    high: drag.card.rank, suit: drag.card.suit };
      ghost.el = document.createElement('div');
      ghost.el.className = 'set target' + (view.newZone === 'runs' ? ' run' : '');
      ghost.el.appendChild(slotEl());
      (view.newZone === 'runs' ? runs : groups).push(ghost);
    }

    // Suites : deux colonnes fixes par couleur. Une suite prend la première
    // colonne libre à sa hauteur ; si les deux sont occupées, elle part dans
    // une colonne d'appoint plutôt que de recouvrir une autre suite.
    runs.sort(function (a, b) { return (a.suit - b.suit) || (a.low - b.low); });
    var pad = Math.ceil(m.ch / step) - 1;      // rangées couvertes par la dernière carte
    var busy = [[-99, -99], [-99, -99], [-99, -99], [-99, -99]];
    var extra = [];
    for (i = 0; i < runs.length; i++) {
      var r = runs[i], ends = busy[r.suit], k = -1;
      if (ends[0] < r.low) k = 0;
      else if (ends[1] < r.low) k = 1;
      if (k >= 0) {
        ends[k] = r.high + pad;
        place(zRuns, r.el, runColX(r.suit, k, m), GRID_TOP + (r.low - 1) * step);
      } else {
        var e = 0;
        while (e < extra.length && extra[e] >= r.low) e++;
        if (e === extra.length) extra.push(-99);
        extra[e] = r.high + pad;
        place(zRuns, r.el, extraColX(e, m), GRID_TOP + (r.low - 1) * step);
      }
    }
    addSuitMarks(zRuns, m);
    var newRunsX = extra.length ? extraColX(extra.length, m) : runsWidth(m);

    // Groupes : une case fixe par valeur, As à Roi — 7 lignes puis la colonne
    // suivante. Une valeur est donc toujours au même endroit, qu'elle soit
    // posée ou non. Un éventuel second groupe de même valeur se range dans une
    // colonne d'appoint, sur la ligne de sa valeur.
    var rowH = m.ch + 6;
    var groupW = 4 * (m.cw + 3) + 18;
    addValueCells(zGroups, rowH, groupW, m);
    var occ = {}, maxX = GROUP_X + 2 * groupW;
    for (i = 0; i < groups.length; i++) {
      var v = groups[i].low;
      var n = occ[v] || 0;
      occ[v] = n + 1;
      var gx = GROUP_X + (n ? 1 + n : valueCol(v)) * groupW;
      place(zGroups, groups[i].el, gx, GRID_TOP + valueRow(v) * rowH);
      if (gx + groupW > maxX) maxX = gx + groupW;
    }
    var groupsH = VALUE_ROWS * rowH;

    var needRuns = newRunsX, needGroups = maxX;
    if (isHumanTurn() && !view.newSlot) {
      placeNewZone(zRuns, newRunsX, GRID_TOP, m.cw, gridH, 'runs', 'Nouvelle suite');
      placeNewZone(zGroups, maxX, GRID_TOP, m.cw, groupsH - 10, 'groups', 'Nouveau groupe');
      needRuns += m.cw + 10;
      needGroups += m.cw + 10;
    }
    // La zone des suites garde une largeur fixe : ses colonnes ne bougent pas.
    zRuns.style.flex = '0 0 ' + (needRuns + 12) + 'px';
    zGroups.style.flex = '1 1 ' + Math.max(160, needGroups + 16) + 'px';
    spacer(zRuns, gridH + GRID_TOP + 12);
    spacer(zGroups, groupsH + GRID_TOP + 12);
  }

  function place(zone, el, x, y) {
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    zone.appendChild(el);
  }

  function placeNewZone(zone, x, y, w, h, kind, label) {
    var d = newZone(kind, label);
    d.classList.add('tall');
    d.style.left = x + 'px';
    d.style.top = y + 'px';
    d.style.width = w + 'px';
    d.style.height = h + 'px';
    zone.appendChild(d);
  }

  var VALUE_ROWS = 7;    // 7 valeurs par colonne : A..7 puis 8..R
  function valueCol(v) { return v <= VALUE_ROWS ? 0 : 1; }
  function valueRow(v) { return (v - 1) % VALUE_ROWS; }

  /* Trame des valeurs côté groupes : chaque valeur garde sa case, occupée ou
     non, pour qu'on sache toujours où regarder. */
  function addValueCells(zone, rowH, groupW, m) {
    for (var v = 1; v <= 13; v++) {
      var cell = document.createElement('div');
      cell.className = 'valuecell';
      cell.style.left = (GROUP_X + valueCol(v) * groupW) + 'px';
      cell.style.top = (GRID_TOP + valueRow(v) * rowH) + 'px';
      cell.style.width = (groupW - 10) + 'px';
      cell.style.height = m.ch + 'px';
      cell.innerHTML = '<i>' + E.RANK_LABEL[v] + '</i>';
      zone.appendChild(cell);
    }
  }

  /* Repère de couleur au-dessus de chaque paire de colonnes. */
  function addSuitMarks(zone, m) {
    for (var s = 0; s < 4; s++) {
      var d = document.createElement('div');
      d.className = 'suitmark s' + s;
      d.textContent = E.SUIT_GLYPH[s];
      d.style.left = runColX(s, 0, m) + 'px';
      d.style.width = (2 * m.cw + RUN_GAP) + 'px';
      zone.appendChild(d);
    }
  }

  function addRuler(zone, step, gridH) {
    var r = document.createElement('div');
    r.className = 'ruler';
    // 14 lignes : As, 2 … Roi, puis l'As haut sous le Roi.
    for (var v = 1; v <= 14; v++) {
      var line = document.createElement('div');
      line.className = 'gridline';
      line.style.top = (GRID_TOP + (v - 1) * step) + 'px';
      r.appendChild(line);
      var lab = document.createElement('i');
      lab.textContent = v === 14 ? 'A' : E.RANK_LABEL[v];
      if (v === 14) lab.className = 'acehigh';
      lab.style.top = (GRID_TOP + (v - 1) * step) + 'px';
      r.appendChild(lab);
    }
    zone.appendChild(r);
  }

  function spacer(zone, h) {
    var d = document.createElement('div');
    d.className = 'spacer';
    d.style.height = h + 'px';
    zone.appendChild(d);
  }

  /* ---- Table libre : les combinaisons se suivent simplement ---------- */
  function paintFlow(view, board) {
    var zone = makeZone('full', '');
    board.appendChild(zone);
    if (!view.sets.length && !view.newSlot) {
      var empty = document.createElement('div');
      empty.className = 'empty';
      empty.innerHTML = '<b>La table est vide</b>Glissez vos cartes ici : elles se placeront toutes seules';
      zone.appendChild(empty);
      if (isHumanTurn()) zone.appendChild(newZone('any', 'Nouvelle<br>combinaison'));
      return;
    }
    for (var i = 0; i < view.sets.length; i++) zone.appendChild(setEl(view.sets[i]));
    if (view.newSlot) {
      var ns = document.createElement('div');
      ns.className = 'set target';
      ns.appendChild(slotEl());
      zone.appendChild(ns);
    } else if (isHumanTurn()) {
      zone.appendChild(newZone('any', 'Nouvelle<br>combinaison'));
    }
  }

  var DENSITIES = ['', 'dense', 'denser'];

  /* Taille des cartes : assez petite pour que toutes les colonnes tiennent. */
  function pickDensity(view, width, height) {
    var ranks = {}, nCols = 1, nRows = 0, i;
    for (i = 0; i < view.sets.length; i++) {
      var s = view.sets[i];
      var cards = s.slot >= 0 ? s.cards.concat([drag.card]) : s.cards;
      if (zoneOf(s, cards) === 'runs') continue;
      var r = cards.length ? cards[0].rank : 0;
      if (!ranks[r]) nRows++;
      ranks[r] = (ranks[r] || 0) + 1;
      if (ranks[r] > nCols) nCols = ranks[r];
    }
    for (var d = 0; d < DENSITIES.length; d++) {
      var m = METRICS[DENSITIES[d]];
      var need = runsWidth(m) + 2 * (m.cw + RUN_GAP) + GROUP_X +
                 (2 + (nCols > 1 ? 1 : 0)) * (4 * (m.cw + 3) + 18) + (m.cw + 10) + 24;
      var high = GRID_TOP + Math.max(13 * Math.round(m.ch * 0.28) + m.ch,
                                     VALUE_ROWS * (m.ch + 6));
      if (need <= width && high <= height) return DENSITIES[d];
    }
    return 'denser';
  }

  function paintBoard() {
    if (!drag) { splitGaps(); mergeRuns(); tidyBoard(); }
    var view = currentView();
    var board = $('#board');
    var total = game.boardCards().length;
    var split = !!E.options.keepPlaces;
    var dens = total > 70 ? 'denser' : (total > 42 ? 'dense' : '');
    if (split) {
      var fit = pickDensity(view, board.clientWidth || 1200, board.clientHeight || 520);
      if (DENSITIES.indexOf(fit) > DENSITIES.indexOf(dens)) dens = fit;
    }
    board.className = dens + (split ? ' split' : '');
    board.style.setProperty('--step',
      Math.round((METRICS[dens] || METRICS['']).ch * 0.28) + 'px');
    board.innerHTML = '';
    if (split) paintGrid(view, board, dens);
    else paintFlow(view, board);
  }

  /* Suite (même couleur, valeurs qui se suivent) -> affichage vertical.
     Groupe (même valeur, couleurs différentes) -> affichage horizontal. */
  function isRunLayout(cards) {
    return cards.length >= 2 && E.sameSuit(cards) && !E.sameRank(cards);
  }

  function newZone(kind, label) {
    var d = document.createElement('div');
    d.className = 'newzone';
    d.dataset.zone = kind || 'any';
    d.innerHTML = label;
    return d;
  }

  function paintRack() {
    var rack = $('#rack');
    rack.innerHTML = '';
    var hand = game.human().hand.filter(function (c) {
      return !(drag && drag.card.id === c.id);
    });
    var hints = drag ? hintCache.ids : playableIds();
    for (var i = 0; i < hand.length; i++) {
      var el = cardEl(hand[i], { pickable: isHumanTurn() });
      if (hints) el.classList.add(hints[hand[i].id] ? 'playable' : 'idle');
      rack.appendChild(el);
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
    var pts = game.stagedPoints();
    $('#meldpill').innerHTML = pts
      ? 'Pos\u00e9 ce tour&nbsp;<b>' + pts + ' pts</b>'
      : 'Votre main&nbsp;<b>' + game.handScore(hm) + ' pts</b>';
    flip(prev, opts);
  }

  function updateBar() {
    var human = isHumanTurn();
    var staged = game.stagedCards().length;
    var check = human ? game.checkCommit() : { ok: false, reason: '' };
    $('#commit').disabled = !human || !check.ok;
    $('#undo').disabled = !human || !turnStack.length;
    $('#draw').disabled = !human;
    $('#auto').disabled = !human;
    $('#sort').disabled = !human;
    $('#rewind').disabled = !canRewind();
    $('#hints').classList.toggle('on', !!prefs.hints);

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
    } else if (prefs.hints) {
      playableIds();
      var n = hintCache.total;
      msg.className = n ? 'good' : 'warn';
      msg.innerHTML = n
        ? '\ud83d\udca1 Meilleur coup : ' + n + ' carte' + (n > 1 ? 's' : '') +
          ' de votre main, mise' + (n > 1 ? 's' : '') + ' en avant.'
        : '\ud83d\udca1 Aucune carte posable pour l\u2019instant — piochez.';
    } else {
      msg.innerHTML = 'Glissez une carte sur la table — elle trouvera sa place toute seule.';
    }
  }

  /* ================= Aide : cartes posables ======================= */

  var hintCache = { key: '', ids: null, total: 0 };

  /* Les cartes mises en avant sont celles du MEILLEUR coup du tour — celui
     que « Jouer au mieux » jouerait. Signaler toutes les cartes jouables une
     à une n'aurait pas de sens : leurs placements s'excluent souvent, et on
     ne pourrait pas les poser ensemble. */
  function playableIds() {
    if (!prefs.hints || !game || !isHumanTurn()) return null;
    var hand = game.human().hand, i;
    var key = game.boardCards().map(function (c) { return c.id; }).sort().join(',') +
      '|' + hand.map(function (c) { return c.id; }).sort().join(',');
    if (hintCache.key === key) return hintCache.ids;

    // On repart de la table du début de tour : une combinaison en cours de
    // construction ne doit pas fausser le calcul.
    var sets = game.snapshot ? game.snapshot.board : game.board;
    var board = [];
    for (i = 0; i < sets.length; i++) board = board.concat(sets[i].cards);
    var pool = hand.concat(game.stagedCards());

    var best = Solver.solve(board, pool, { objective: 'count' });
    var ids = {}, n = 0;
    if (best) {
      // Les deux exemplaires d'une carte sont interchangeables : le solveur
      // peut retenir celui de la main alors que l'autre est déjà sur la
      // table. On raisonne donc sur les cartes à poser (couleur + valeur),
      // en défalquant celles déjà posées pendant ce tour.
      var need = {}, key2;
      for (i = 0; i < best.played.length; i++) {
        key2 = best.played[i].suit + '-' + best.played[i].rank;
        need[key2] = (need[key2] || 0) + 1;
      }
      var staged = game.stagedCards();
      for (i = 0; i < staged.length; i++) {
        key2 = staged[i].suit + '-' + staged[i].rank;
        if (need[key2]) need[key2]--;
      }
      for (i = 0; i < hand.length; i++) {
        key2 = hand[i].suit + '-' + hand[i].rank;
        if (need[key2] > 0) { ids[hand[i].id] = true; need[key2]--; n++; }
      }
    }
    hintCache = { key: key, ids: ids, total: n };
    return ids;
  }

  function toggleHints() {
    prefs.hints = !prefs.hints;
    savePrefs();
    hintCache = { key: '', ids: null };
    render();
    updateBar();
    toast(prefs.hints
      ? '\ud83d\udca1 Les cartes posables sont mises en avant'
      : 'Aide d\u00e9sactiv\u00e9e');
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
  /* « Hmm » pensif : un fredonnement bouche fermée, le même pour tous les
     joueurs. Fondamentale grave, léger vibrato, la hauteur monte puis retombe
     comme une hésitation, et un passe-bas étouffe les aigus. */
  function sndHmm(resigned) {
    if (!soundOn) return;
    try {
      if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === 'suspended') actx.resume();
      var t0 = actx.currentTime;
      var base = 110;
      var dur = resigned ? 0.55 : 0.46;
      var peak = resigned ? base * 0.97 : base * 1.12;
      var end = resigned ? base * 0.74 : base * 0.88;

      var osc = actx.createOscillator();
      osc.type = 'triangle';
      var harm = actx.createOscillator();
      harm.type = 'sine';
      var ratio = 2;
      [[osc, 1], [harm, ratio]].forEach(function (pair) {
        var o = pair[0], k = pair[1];
        o.frequency.setValueAtTime(base * k, t0);
        o.frequency.linearRampToValueAtTime(peak * k, t0 + dur * 0.38);
        o.frequency.linearRampToValueAtTime(end * k, t0 + dur);
      });
      var harmGain = actx.createGain();
      harmGain.gain.value = 0.22;

      var lfo = actx.createOscillator();      // vibrato
      lfo.frequency.value = 5.4;
      var lfoGain = actx.createGain();
      lfoGain.gain.value = base * 0.022;
      lfo.connect(lfoGain);
      lfoGain.connect(osc.frequency);
      lfoGain.connect(harm.frequency);

      var filt = actx.createBiquadFilter();   // bouche fermée
      filt.type = 'lowpass';
      filt.frequency.value = 460;
      filt.Q.value = 0.7;
      var nasal = actx.createBiquadFilter();  // résonance nasale
      nasal.type = 'peaking';
      nasal.frequency.value = 215;
      nasal.Q.value = 2.5;
      nasal.gain.value = 7;

      var g = actx.createGain();
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(0.075, t0 + 0.08);
      g.gain.setValueAtTime(0.075, t0 + dur * 0.62);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

      osc.connect(filt);
      harm.connect(harmGain);
      harmGain.connect(filt);
      filt.connect(nasal);
      nasal.connect(g);
      g.connect(actx.destination);

      osc.start(t0); harm.start(t0); lfo.start(t0);
      osc.stop(t0 + dur + 0.05); harm.stop(t0 + dur + 0.05); lfo.stop(t0 + dur + 0.05);
    } catch (e) { /* audio indisponible */ }
  }

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
    // iOS interrompt le geste s'il croit reconnaître un geste système :
    // sans cela la carte resterait collée au doigt.
    window.addEventListener('pointercancel', onCancel, true);
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
    var zones = document.querySelectorAll('#board .zone');
    for (var z = 0; z < zones.length; z++) {
      drag.rects['__zone_' + zones[z].dataset.zonekind] = zones[z].getBoundingClientRect();
    }
    var nzs = document.querySelectorAll('#board .newzone');
    for (var n = 0; n < nzs.length; n++) {
      drag.rects['__new_' + nzs[n].dataset.zone] = nzs[n].getBoundingClientRect();
    }
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
      (t.index === undefined ? '' : t.index) + ':' + (t.zone || '');
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
    var t = drag && drag.target;
    $('#rackwrap').classList.toggle('target', !!t && t.kind === 'hand');
    var nzs = document.querySelectorAll('#board .newzone');
    for (var i = 0; i < nzs.length; i++) {
      nzs[i].classList.toggle('target',
        !!t && t.kind === 'new' && (nzs[i].dataset.zone === 'any' || nzs[i].dataset.zone === t.zone));
    }
  }

  function computeTarget(x, y) {
    var card = drag.card;
    if (inRect(drag.rects.__rack, x, y, 6)) return { kind: 'hand' };
    if (!inRect(drag.rects.__board, x, y, 4)) return { kind: 'none' };
    if (inRect(drag.rects.__new_any, x, y, 4)) return { kind: 'new' };
    if (inRect(drag.rects.__new_runs, x, y, 4)) return { kind: 'new', zone: 'runs' };
    if (inRect(drag.rects.__new_groups, x, y, 4)) return { kind: 'new', zone: 'groups' };

    var sets = baseSets(), i;

    // 1) la combinaison directement sous le curseur
    var hover = null;
    for (i = 0; i < sets.length; i++) {
      if (inRect(drag.rects[sets[i].id], x, y, 6)) hover = sets[i];
    }
    if (hover) {
      var hi = E.acceptIndex(hover.cards, card);
      if (hi >= 0) return { kind: 'insert', setId: hover.id, index: hi };
      // Carte déposée au milieu d'une suite : on la coupe là.
      if (splitParts(hover.cards, card)) return { kind: 'split', setId: hover.id };
    }

    // 2) sinon, la meilleure combinaison du plateau
    var best = null, bestScore = -1e9;
    for (i = 0; i < sets.length; i++) {
      var s = sets[i];
      var idx = E.acceptIndex(s.cards, card);
      if (idx < 0) continue;
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
    // Réorganisation de la table : seulement si le joueur l'a demandée.
    if (prefs.autoArrange && rearrangement()) return { kind: 'rearrange' };
    // Pas de place trouvée : nouvelle combinaison, dans la zone survolée.
    return { kind: 'new', zone: inRect(drag.rects.__zone_runs, x, y, 0) ? 'runs' : 'groups' };
  }

  /* Déposer une carte au milieu d'une suite la coupe en deux : …a→r et r→b.
     Les deux morceaux doivent garder au moins trois cartes. */
  function splitParts(cards, card) {
    if (!E.isRun(cards) || cards[0].suit !== card.suit) return null;
    var high = E.aceHighRun(cards);
    var b0 = bounds(cards), a = b0.lo, b = b0.hi, r = E.effRank(card, high);
    if (r < a + 2 || r > b - 2) return null;
    var sorted = E.orderSet(cards), first = [], second = [];
    for (var i = 0; i < sorted.length; i++) {
      if (E.effRank(sorted[i], high) <= r) first.push(sorted[i]); else second.push(sorted[i]);
    }
    if (first.length < 3 || second.length + 1 < 3) return null;
    return { first: first, second: second };
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
      for (i = 0; i < sets.length; i++) {
        if (sets[i].id === t.setId) { sets[i].slot = t.index; sets[i].hole = -1; }
      }
      return { sets: sets };
    }
    if (t.kind === 'split') {
      for (i = 0; i < sets.length; i++) {
        if (sets[i].id !== t.setId) continue;
        var parts = splitParts(sets[i].cards, drag.card);
        if (!parts) break;
        sets.splice(i, 1,
          { id: sets[i].id, cards: parts.first, slot: -1, hole: -1 },
          { id: sets[i].id + '~b', cards: parts.second, slot: 0, hole: -1 });
        break;
      }
      return { sets: sets };
    }
    if (t.kind === 'new') return { sets: sets, newSlot: true, newZone: t.zone };
    if (t.kind === 'rearrange') {
      var src = rearrangement(), out = [];
      for (i = 0; i < src.length; i++) {
        var ordered = E.orderSet(src[i]);
        var slot = -1, rest = [];
        for (var k = 0; k < ordered.length; k++) {
          if (ordered[k].id === drag.card.id) slot = rest.length;
          else rest.push(ordered[k]);
        }
        out.push({ id: 'p' + i, cards: rest, slot: slot, hole: -1 });
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
    } else if (t.kind === 'split') txt = '<b>✂\ufe0f coupe la suite ici</b>';
    else if (t.kind === 'rearrange') txt = '<b>✨ la table se réorganise</b>';
    else if (t.kind === 'new') txt = 'nouvelle combinaison';
    else if (t.kind === 'hand') txt = 'reprendre en main';
    else txt = 'relâchez sur la table';
    h.innerHTML = txt;
    h.style.left = (x + 16) + 'px';
    h.style.top = (y + 18) + 'px';
  }

  /* Geste avorté : la carte retourne d'où elle vient. */
  function onCancel() {
    if (!drag) return;
    detachDrag();
    var d = drag;
    drag = null;
    if (d.ghost) d.ghost.remove();
    $('#rackwrap').classList.remove('target');
    render();
  }

  function detachDrag() {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp, true);
    window.removeEventListener('pointercancel', onCancel, true);
    clearHint();
  }

  function onUp(e) {
    if (!drag) return;
    detachDrag();

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
      pushTurnState();
      removeFromBoard(card);
      game.human().hand.push(card);
      game.sortHand(game.human(), prefs.tri);
      game.compact();
      render(); updateBar(); sndSnap();
      return;
    }

    pushTurnState();
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
    } else if (t.kind === 'split') {
      var cut = game.setById(t.setId);
      var parts = cut ? splitParts(cut.cards, card) : null;
      if (parts) {
        cut.cards = parts.first;
        var piece = game.newSet(E.orderSet([card].concat(parts.second)));
        piece.zone = 'runs';
        game.board.push(piece);
        sndSnap();
        toast('\u2702\ufe0f Suite coup\u00e9e en deux');
      } else {
        game.board.push(game.newSet([card]));
        sndSnap();
      }
    } else if (t.kind === 'rearrange') {
      var src = t.sets || (d.cache && d.cache.re);
      game.board = E.alignBoard(game.board, src);
      sndMagic();
      toast('✨ La table s’est réorganisée pour accueillir ' + E.label(card));
    } else {
      var fresh = game.newSet([card]);
      fresh.zone = t.zone;
      game.board.push(fresh);
      sndSnap();
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
    turnStack = [];
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
    turnStack = [];
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

  /* Mémorise l'état avant chaque mouvement, pour les défaire un par un. */
  function pushTurnState() {
    turnStack.push(cloneState());
    if (turnStack.length > 200) turnStack.shift();
  }

  function doUndo() {
    if (!isHumanTurn() || !turnStack.length) return;
    restoreState(turnStack.pop());
    render(); updateBar(); sndLift();
    toast(turnStack.length
      ? 'Mouvement annulé'
      : 'Mouvement annulé — vous êtes revenu au début du tour');
  }

  function doDraw() {
    if (!isHumanTurn()) return;
    var had = game.stagedCards().length;
    var card = game.draw();
    render(); updateBar();
    sndHmm(!card);
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
    pushTurnState();
    game.restoreTurn();
    var p = game.human();
    var play = AI.findBestPlay(game, p, null);
    if (!play) {
      restoreState(before);
      turnStack.pop();
      render();
      toast('Aucun coup possible avec cette main — piochez.');
      return;
    }
    AI.applyPlay(game, p, play);
    render(); sndMagic(); updateBar();
    toast('✨ ' + play.played.length + ' carte' + (play.played.length > 1 ? 's' : '') +
      ' posée' + (play.played.length > 1 ? 's' : '') + ' (' + play.points + ' pts)');
  }

  function doSort() {
    if (!isHumanTurn()) return;
    game.sortHand(game.human(), prefs.tri);
    render();
    toast(prefs.tri === 'suit'
      ? 'Main triée par couleur, puis par valeur'
      : 'Main triée par valeur, puis par couleur');
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
        sndHmm(false);
      } else {
        toast('<span class="who">' + p.name + '</span> passe');
        sndHmm(true);
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

  /* ================= Options ====================================== */

  function optionRow(name, value, selected, title, desc) {
    return '<button class="optrow' + (selected ? ' on' : '') + '" data-pref="' + name +
      '" data-value="' + value + '"><span class="dot"></span>' +
      '<span class="lbl"><b>' + title + '</b><em>' + desc + '</em></span></button>';
  }

  function showOptions() {
    var ov = $('#overlay');
    ov.innerHTML = '<div class="panel"><h2>Options</h2>' +
      '<h3>Tri de votre main</h3>' +
      optionRow('tri', 'rank', prefs.tri === 'rank', 'Par valeur, puis couleur',
        'A A 2 2 3 3\u2026 les cartes de m\u00eame valeur voisines') +
      optionRow('tri', 'suit', prefs.tri === 'suit', 'Par valeur dans les couleurs',
        'toute une couleur dans l\u2019ordre, puis la suivante') +
      '<h3>Aide au placement</h3>' +
      optionRow('autoArrange', '0', !prefs.autoArrange, 'Me laisser chercher',
        'une carte qui ne rentre nulle part ouvre une nouvelle combinaison') +
      optionRow('autoArrange', '1', prefs.autoArrange, 'R\u00e9organiser la table pour moi',
        'la table se refait toute seule pour accueillir la carte') +
      '<h3>Combinaisons sur la table</h3>' +
      optionRow('keepPlaces', '1', prefs.keepPlaces, 'Table rang\u00e9e',
        'suites \u00e0 gauche, groupes \u00e0 droite, chaque carte \u00e0 la hauteur de sa valeur') +
      optionRow('keepPlaces', '0', !prefs.keepPlaces, 'Table libre',
        'les combinaisons se placent au fil des coups, sans zones') +
      '<div class="row"><button class="cta" id="closeopts" style="flex:1">Fermer</button></div></div>';
    ov.classList.remove('hidden');
    $('#closeopts').onclick = function () { ov.classList.add('hidden'); };
    var rows = ov.querySelectorAll('.optrow');
    for (var i = 0; i < rows.length; i++) {
      rows[i].onclick = function () {
        var name = this.dataset.pref, value = this.dataset.value;
        if (name === 'tri') {
          prefs.tri = value;
          E.options.sort = value;
          if (game) { game.sortHand(game.human(), value); render(); }
        } else if (name === 'autoArrange') {
          prefs.autoArrange = (value === '1');
        } else {
          prefs.keepPlaces = (value === '1');
        }
        savePrefs();
        showOptions();
      };
    }
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
      'L\u2019As se place <b>avant le 2 ou après le Roi</b> : A-2-3 et D-R-A sont ' +
      'deux suites valides. En revanche la boucle est interdite : R-A-2 n\u2019en ' +
      'est pas une.</li></ul>' +
      '<h3>Déroulement</h3><ul>' +
      '<li>14 cartes chacun. À chaque tour, posez au moins une carte de votre ' +
      'main — où vous voulez, y compris sur les combinaisons déjà sur la table. ' +
      'Pas de minimum de points à la première pose.</li>' +
      '<li>À tout moment vous pouvez compléter et <b>réorganiser librement</b> la table, ' +
      'à condition que toutes les combinaisons soient valides à la fin du tour.</li>' +
      '<li>Rien à poser ? Vous piochez et le tour passe.</li>' +
      '<li>Le premier à vider sa main gagne. Si la pioche s’épuise, ' +
      'c’est le joueur avec le moins de points en main.</li></ul>' +
      '<h3>Placement automatique</h3><ul>' +
      '<li><b>Glissez</b> une carte vers la table : l’emplacement exact apparaît ' +
      'et la carte s’y pose toute seule.</li>' +
      '<li>Si la carte ne rentre nulle part, elle ouvre une <b>nouvelle ' +
      'combinaison</b> : à vous de réarranger la table. Les options permettent ' +
      'de confier cette réorganisation au jeu (✨), mais il décide alors à votre ' +
      'place quelles combinaisons casser.</li>' +
      '<li>Table rangée (option par défaut) : les <b>suites à gauche</b>, par couleur, ' +
      'les <b>brelans et carrés à droite</b>, et chaque carte à la <b>hauteur de sa ' +
      'valeur</b> — un 7 est toujours sur la ligne des 7. Vous savez d’avance où regarder.</li>' +
      '<li>Un simple <b>clic</b> sur une carte la place au meilleur endroit.</li>' +
      '<li>Deux suites de m\u00eame couleur qui se suivent (\u20265\u2660 et 6\u2660\u2026) ' +
      'sont <b>r\u00e9unies automatiquement</b>. Pour les s\u00e9parer de nouveau, d\u00e9posez ' +
      'une carte au milieu de la colonne : la suite est <b>coup\u00e9e \u00e0 cet endroit</b>.</li>' +
      '<li><b>\ud83d\udca1 Indices</b> met en avant les cartes du <b>meilleur coup</b> ' +
      'du tour, sans vous dire o\u00f9 les poser : une aide interm\u00e9diaire entre ' +
      'chercher seul et laisser jouer la machine. Ces cartes se posent toutes ' +
      'ensemble ; \u00e0 mesure que vous en placez, l\u2019indication se met \u00e0 jour.</li>' +
      '<li><b>Jouer au mieux</b> calcule et joue le coup maximal du tour.</li>' +
      '<li><b>Annuler</b> d\u00e9fait vos mouvements un par un, dans l\u2019ordre inverse.</li>' +
      '<li>La palette de l\u2019en-t\u00eate change la <b>couleur du tapis</b> ' +
      '(six teintes, conserv\u00e9es d\u2019une partie \u00e0 l\u2019autre).</li>' +
      '<li><b>Revenir avant l\u2019IA</b> annule le dernier coup des joueurs ' +
      'virtuels : la partie repart du début de votre tour précédent. ' +
      'Appuyez plusieurs fois pour remonter plus loin.</li>' +
      '<li>Glissez une carte posée ce tour-ci vers votre main pour la récupérer.</li>' +
      '<li>Vous pouvez prendre une carte d\u2019une combinaison de la table ' +
      '(le 4<sup>e</sup> d\u2019un carré par exemple) et la glisser sur une autre.</li>' +
      '</ul>' +
      '<h3>Raccourcis</h3><p>Entrée : valider · ⌫ : annuler · P : piocher · ' +
      'A : jouer au mieux · T : trier · I : indices · R : revenir avant l\u2019IA</p>' +
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
  $('#hints').onclick = toggleHints;
  function confirmQuit() {
    return window.confirm('Abandonner la partie en cours ?');
  }

  $('#restart').onclick = function () {
    if (game && !game.finished && !confirmQuit()) return;
    $('#overlay').classList.add('hidden');
    $('#game').classList.add('hidden');
    $('#menu').classList.remove('hidden');
  };
  $('#felt').onclick = nextFelt;
  $('#options').onclick = showOptions;
  $('#menu-options').onclick = showOptions;
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
    else if (e.key === 'i' || e.key === 'I') { toggleHints(); }
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

  /* Hors ligne : une fois la page ouverte, le jeu se relance sans réseau.
     Sans objet dans l'app macOS, qui charge ses fichiers en local. */
  if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () { /* tant pis */ });
    });
  }

  loadPrefs();
  E.options.sort = prefs.tri;
  applyFelt();
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
    showOptions: showOptions,
    rewind: doRewind,
    showMenu: function () {
      if (game && !game.finished && !confirmQuit()) return;
      $('#overlay').classList.add('hidden');
      $('#game').classList.add('hidden');
      $('#menu').classList.remove('hidden');
    }
  };
})();
