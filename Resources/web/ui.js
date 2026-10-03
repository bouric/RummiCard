/* RummiCard — © 2026 Richard Boulais & Claude */
/* =====================================================================
   ui.js — Interface : rendu, glisser-deposer avec placement automatique,
   animations FLIP, tours des joueurs virtuels.
   ===================================================================== */
(function () {
  'use strict';

  var E = window.Engine, AI = window.AI, Solver = window.Solver;
  var I18N = window.I18N;
  function TR(cle, p) { return I18N.t(cle, p); }
  function NC(n) { return I18N.cartes(n); }
  function $(s) { return document.querySelector(s); }
  var rejeuEnCours = false;
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, rejeuEnCours ? 0 : ms); }); }

  var game = null;
  var nVirtual = 2;
  /* Réglages du joueur (persistés par l'hôte natif, sinon localStorage).
       tri        : 'suit' = par couleur puis valeur
                    'rank' = par valeur puis couleur
       keepPlaces : garder les combinaisons à leur place sur la table */
  var prefs = { langue: null, debug: false,
                tri: 'suit', keepPlaces: true, hints: false, autoArrange: false, felt: 0,
                niveau: 'normal', manches: 3, sensSuites: 'asc',
                lastDeal: null, saved: null };

  /* Couleurs de tapis, du plus classique au plus sombre. */
  var FELTS = [
    { cle: 'felt.vert', a: '#186354', b: '#0e3e34' },
    { cle: 'felt.bleu', a: '#1b4a6e', b: '#0c2a42' },
    { cle: 'felt.bordeaux', a: '#6b2b39', b: '#3b1520' },
    { cle: 'felt.ardoise', a: '#3b4450', b: '#1f252e' },
    { cle: 'felt.prune', a: '#4b3568', b: '#281a3c' },
    { cle: 'felt.tabac', a: '#6a4a26', b: '#3a2714' }
  ];

  function applyFelt() {
    var f = FELTS[prefs.felt % FELTS.length];
    document.documentElement.style.setProperty('--felt1', f.a);
    document.documentElement.style.setProperty('--felt2', f.b);
  }

  function choisirFelt(i) {
    prefs.felt = ((i % FELTS.length) + FELTS.length) % FELTS.length;
    applyFelt();
    savePrefs();
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
      /* Ce qui vient du disque n'a pas forcement ete ecrit par le jeu. */
      prefs.lastDeal = E.donneValide(p.lastDeal);
      prefs.saved = E.sauvegardeValide(p.saved);
      if (p.niveau === 'facile' || p.niveau === 'normal' || p.niveau === 'difficile') {
        prefs.niveau = p.niveau;
      }
      if (p.manches === 1 || p.manches === 3 || p.manches === 5) prefs.manches = p.manches;
      if (p.sensSuites === 'asc' || p.sensSuites === 'desc') prefs.sensSuites = p.sensSuites;
      if (typeof p.langue === 'string') prefs.langue = p.langue;
      if (typeof p.debug === 'boolean') prefs.debug = p.debug;
    }
    E.options.keepPlaces = prefs.keepPlaces;
    E.options.difficulty = prefs.niveau;
  }

  function savePrefs() {
    E.options.keepPlaces = prefs.keepPlaces;
    E.options.difficulty = prefs.niveau;
    try { window.localStorage.setItem('rummicard.prefs', JSON.stringify(prefs)); } catch (e) { /* file:// */ }
    try { window.webkit.messageHandlers.prefs.postMessage(prefs); } catch (e) { /* hors app */ }
  }
  /* L'astuce « Refaire » ne se dit qu'une fois par partie, a la premiere
     pioche. Piocher clot le tour sans retour possible par « Annuler », et le
     seul recours — « Refaire » — ne porte pas son nom sur telephone, ou le
     libelle est masque pour tenir la ligne : il n'y reste que l'icone.
     0 = jamais dite, 1 = a dire des que la main revient, 2 = dite. */
  var astuceRefaire = 0;

  var soundOn = true;
  var busy = false;
  var drag = null;
  /* Taille de carte retenue au dernier rendu : la main l'adopte aussi, pour
     que toutes les cartes de l'ecran aient la meme taille. */
  var densiteCourante = '';

  /* ---- Journal de mise au point ------------------------------------
     Quand il est actif, chaque geste est note avec la donne et les
     reglages : de quoi rejouer une partie a l'identique et retrouver
     d'ou vient une anomalie. Rien n'est envoye nulle part ; le texte est
     affiche pour etre copie a la main. */
  var journal = null;

  function jrnSignature() {
    return game.board.map(function (s) {
      return s.cards.map(function (c) { return c.id; }).join(',');
    }).join(' | ');
  }

  function jrnNouvelle() {
    if (!prefs.debug || !game) { journal = null; return; }
    journal = {
      version: (($('#version') || {}).textContent || '').trim(),
      ecran: window.innerWidth + 'x' + window.innerHeight,
      langue: I18N.get(),
      donne: game.deal,
      reglages: { tri: prefs.tri, keepPlaces: prefs.keepPlaces, autoArrange: prefs.autoArrange,
                  niveau: prefs.niveau, manches: prefs.manches, sensSuites: prefs.sensSuites },
      actes: []
    };
  }

  function jrnEtat() {
    return { table: jrnSignature(),
             main: game.human().hand.map(function (c) { return c.id; }).join(',') };
  }

  /* L'etat note est toujours celui d'AVANT l'acte : au rejeu, c'est le point
     de depart qu'on compare, et le premier ecart designe l'acte fautif. */
  function jrn(nom, details, avant) {
    if (!prefs.debug || !journal || !game) return;
    var a = { a: nom };
    if (details) for (var k in details) a[k] = details[k];
    var e = avant || jrnEtat();
    a.table = e.table;
    a.main = e.main;
    journal.actes.push(a);
    if (journal.actes.length > 600) journal.actes.shift();
  }
  var history = [];          // état au début de chacun de vos tours
  var aiJustPlayed = {};     // cartes ajoutées par les joueurs virtuels depuis votre tour
  var match = null;          // { total, manche, scores, noms } quand on joue en plusieurs manches
  var turnStack = [];        // états successifs pendant le tour en cours
  var piochee = null;        // la dernière carte piochée, signalée en bleu dans la main

  /* ================= Accueil ====================================== */

  function replayDeal() {
    if (prefs.lastDeal) newGame(prefs.lastDeal);
  }

  /* Un nombre de joueurs virtuels, dit comme le titre de la rubrique. */
  function virtuels(n) {
    return TR(n > 1 ? 'accueil.virtuels' : 'accueil.virtuel');
  }

  function buildMenu() {
    var reprise = $('#resume');
    if (reprise) {
      var sv = prefs.saved;
      reprise.classList.toggle('hidden', !sv);
      if (sv) {
        reprise.innerHTML = '\u25b6 ' + TR('accueil.reprendre') + ' ' +
          TR('accueil.reprendreDetail', { n: sv.n, c: sv.hands[0].length,
            cartes: NC(sv.hands[0].length), adv: virtuels(sv.n) });
      }
    }
    var replay = $('#replay');
    if (replay) {
      var d = prefs.lastDeal;
      replay.classList.toggle('hidden', !d);
      if (d) {
        replay.innerHTML = '\u21ba ' + TR('accueil.redonne') + ' ' +
          TR('accueil.redonneDetail', { n: d.n, adv: virtuels(d.n) });
      }
    }
    var lb = $('#langs');
    if (lb) {
      lb.innerHTML = '';
      for (var L = 0; L < I18N.langues.length; L++) {
        (function (lg) {
          var b = document.createElement('button');
          b.className = 'langbtn' + (I18N.get() === lg.code ? ' on' : '');
          b.textContent = lg.nom;
          b.onclick = function () { choisirLangue(lg.code); };
          lb.appendChild(b);
        })(I18N.langues[L]);
      }
    }
    var box = $('#choices');
    box.innerHTML = '';
    for (var i = 1; i <= 5; i++) {
      (function (n) {
        var b = document.createElement('button');
        b.className = 'choice' + (n === nVirtual ? ' on' : '');
        /* Le titre de la rubrique dit deja de quoi il s'agit : le chiffre
           seul suffit, et la rangee y gagne en clarte. */
        b.textContent = n;
        b.onclick = function () { nVirtual = n; buildMenu(); };
        box.appendChild(b);
      })(i);
    }
  }

  /* ================= Cycle de partie ============================== */

  function newGame(deal, suite) {
    game = new E.Game(deal ? deal.n : nVirtual, deal);
    if (deal) nVirtual = deal.n;
    if (!suite) {
      var zero = [];
      for (var z = 0; z <= nVirtual; z++) zero.push(0);
      match = { total: prefs.manches, manche: 1, scores: zero,
                noms: game.players.map(function (p) { return p.name; }) };
    }
    prefs.lastDeal = game.deal;
    savePrefs();
    history = [game.captureState()];
    turnStack = [];
    piochee = null;
    dernierMessage = '';     // la consigne d'ouverture se redit a chaque partie
    astuceRefaire = 0;
    jrnNouvelle();
    $('#game').classList.remove('compact');
    $('#menu').classList.add('hidden');
    $('#game').classList.remove('hidden');
    $('#overlay').classList.add('hidden');
    render();
    updateBar();
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

  /* Projecteur : deux secondes durant, la table ou la main s'eteint sauf ce
     qui vient d'arriver — les cartes qu'un joueur virtuel vient de poser, ou
     celle qu'on vient de piocher. */
  var projecteur = null, projecteurTimer = null;
  /* Sans duree, le projecteur reste allume jusqu'a ce qu'on l'eteigne : c'est
     le cas du tour des joueurs virtuels, ou trois poses de suite feraient
     clignoter la table si chacune rallumait la sienne. Il s'allume a la
     premiere carte posee et ne s'eteint qu'une seconde apres votre retour. */
  function allumerProjecteur(zone, duree) {
    projecteur = zone;
    clearTimeout(projecteurTimer);
    projecteurTimer = duree ? setTimeout(eteindreProjecteur, duree) : null;
  }
  function eteindreProjecteur(sansRedessiner) {
    clearTimeout(projecteurTimer);
    projecteurTimer = null;
    if (!projecteur) return;
    projecteur = null;
    if (game && sansRedessiner !== true) render({ animate: false });
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
      (opts.fromAI ? ' fromai' : '') +
      (opts.pickable ? ' pickable' : '');
    d.dataset.id = card.id;
    d.innerHTML =
      '<div class="corner"><span class="rank">' + E.rankLabel(card.rank) +
      '</span><span class="cs">' + E.SUIT_GLYPH[card.suit] + '</span></div>' +
      '<div class="mid">' + E.SUIT_GLYPH[card.suit] + '</div>' +
      '<div class="suit">' + E.SUIT_GLYPH[card.suit] + '</div>' +
      /* Un voile pose par-dessus, et non une transparence de la carte
         entiere : deux cartes qui se chevauchent laisseraient voir deux
         epaisseurs, et la tranche decouverte paraitrait plus claire que le
         reste. Dernier enfant, donc sous les anneaux de couleur. */
      (opts.voile ? '<div class="voile ' + opts.voile + '"></div>' : '');
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
  /* Découpe une combinaison d'une même couleur en morceaux de valeurs qui
     se suivent, l'As compté 1 ou 14 selon la lecture demandée. */
  function segmenter(cards, high) {
    var tri = cards.slice().sort(function (a, b) {
      return E.effRank(a, high) - E.effRank(b, high);
    });
    var segs = [[tri[0]]];
    for (var k = 1; k < tri.length; k++) {
      if (E.effRank(tri[k], high) === E.effRank(tri[k - 1], high) + 1) {
        segs[segs.length - 1].push(tri[k]);
      } else {
        segs.push([tri[k]]);
      }
    }
    return segs;
  }

  function splitGaps() {
    var out = [], i, k;
    for (i = 0; i < game.board.length; i++) {
      var set = game.board[i], cards = set.cards;
      if (cards.length < 2 || !E.sameSuit(cards) || E.sameRank(cards)) { out.push(set); continue; }
      // L'As peut se lire 1 ou 14 : on retient la lecture qui laisse le moins
      // de morceaux, sans quoi une longue suite A-2-…-V passerait pour trouée.
      var hasAce = false;
      for (k = 0; k < cards.length; k++) if (cards[k].rank === 1) hasAce = true;
      var segs = segmenter(cards, false);
      if (hasAce) {
        var hauts = segmenter(cards, true);
        if (hauts.length < segs.length) segs = hauts;
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
    /* Un barreau de plus a l'echelle : entre 62 et 48, l'ecart etait tel
       qu'un iPad en portrait tombait de l'un a l'autre pour huit pixels. */
    'moyen': { cw: 54, ch: 77 },
    'dense': { cw: 48, ch: 68 },
    'denser': { cw: 40, ch: 57 }
  };
  /* Décalage entre deux cartes d'une suite, en fraction de la hauteur d'une
     carte : c'est aussi le pas de la graduation des valeurs. Au doigt, on
     l'élargit — la bande qui dépasse est la seule prise pour attraper une
     carte au milieu d'une suite. */
  var touchMode = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
  function runStep(ch) { return Math.round(ch * (touchMode ? 0.4 : 0.28)); }
  /* Chevauchement horizontal dans un brelan ou un carre : seule la tranche
     gauche de chaque carte reste visible, celle qui porte sa valeur et sa
     couleur — comme un eventail tenu en main. */
  function groupStep(cw) { return Math.round(cw * (touchMode ? 0.55 : 0.45)); }
  /* Pas minimal de la graduation : en dessous, la valeur d'une carte
     recouverte n'est plus lisible. */
  function minRunStep(ch) { return Math.round(ch * (touchMode ? 0.3 : 0.24)); }
  /* Largeur d'une case de valeur : un carre chevauche, plus la marge entre
     deux cases. Serree, pour qu'une colonne de plus tienne sur un ecran
     etroit — c'est elle qui decide du nombre de lignes. */
  function largeurGroupe(m) { return 3 * groupStep(m.cw) + m.cw + 12; }

  /* Sens de l'axe des valeurs côté suites : petites valeurs en haut (défaut)
     ou grandes valeurs en haut. */
  function rowOfValue(v) {
    return prefs.sensSuites === 'desc' ? (14 - v) : (v - 1);
  }

  /* Marges de la table, serrées au plus juste : chaque pixel rendu ici
     permet au calcul de densité de choisir des cartes plus grandes. */
  var PAD_ZONE = 8;      // rembourrage d'une zone (doit suivre style.css)
  var BAS_ZONE = 6;      // respiration sous la grille
  var GRID_TOP = 20;     // sous l'intitulé de la zone
  var RULER_W = 16;      // colonne des valeurs, côté suites
  var GROUP_X = 4;       // marge gauche côté brelans et carrés
  var SUIT_GAP = 8;      // écart entre deux couleurs
  var RUN_GAP = 5;       // écart entre les deux colonnes d'une couleur
  /* Les zones « nouvelle combinaison » sont de simples bandes : leur
     libellé s'y écrit à la verticale, une largeur de carte serait du
     gaspillage sur un écran étroit. */
  function largeurNeuve(m) { return Math.max(18, Math.round(m.cw * 0.45)); }
  /* Hauteur et largeur perdues en marges, de part et d'autre d'une zone. */
  var MARGE_H = 2 * PAD_ZONE + BAS_ZONE;
  var MARGE_L = 2 * PAD_ZONE;

  /* Colonnes fixes par couleur. Deux en temps normal : chaque valeur
     n'existant qu'en deux exemplaires, jamais plus de deux suites d'une même
     couleur ne se superposent. Sur un écran étroit on se contente d'une
     colonne par couleur — la seconde suite d'une couleur part alors dans une
     colonne d'appoint, ce qui reste rare. */
  /* Ecarts entre colonnes : resserres quand la place manque au point de ne
     garder qu'une colonne par couleur — chaque pixel gagne la y est une
     colonne d'appoint de plus qui tient a l'ecran. */
  function ecarts(nc) {
    return nc === 1 ? { rg: 4, sg: 8 } : { rg: RUN_GAP, sg: SUIT_GAP };
  }
  /* Mode resserre : les colonnes d'une meme couleur se chevauchent, comme les
     cartes d'un brelan. Deux suites de meme couleur ne se disputent la meme
     hauteur qu'une fois sur deux ; le reste du temps la colonne voisine est
     vide et la suite se voit en entier. On y gagne la largeur de quatre
     colonnes — assez, sur un iPad en portrait, pour passer des cartes de
     48 px a celles de 62. */
  function pasColonne(m, nc, serre) {
    return serre ? Math.round(m.cw * 0.45) : m.cw + ecarts(nc).rg;
  }
  function runColX(suit, k, m, nc, serre) {
    var g = ecarts(nc), pas = pasColonne(m, nc, serre);
    if (!serre) return RULER_W + suit * (nc * pas + g.sg) + k * pas;
    return RULER_W + suit * ((nc - 1) * pas + m.cw + 4) + k * pas;
  }
  /* Colonnes d'appoint, au-delà des colonnes fixes d'une couleur : rares,
     mais nécessaires pour ne jamais superposer deux suites. */
  function extraColX(e, m, nc, serre) {
    // Juste apres les colonnes fixes : elles occupent le vide qui separe la
    // derniere couleur de la zone « Nouvelle suite », repoussee a droite.
    return runsWidth(m, nc, serre) + e * pasColonne(m, nc, serre);
  }
  function runsWidth(m, nc, serre) {
    /* Bord droit de la dernière colonne : la marge qui la sépare de la bande
       « Nouvelle suite » est comptée avec celle-ci, pas deux fois. */
    return runColX(3, nc - 1, m, nc, serre) + m.cw + 4;
  }

  function setEl(s) {
    var full = s.slot >= 0 ? s.cards.concat([drag.card]) : s.cards;
    var vertical = isRunLayout(full);
    var el = document.createElement('div');
    el.className = 'set' + (vertical ? ' run' : (full.length >= 2 ? ' group' : '')) +
      (E.isValidSet(full) ? '' : ' bad') + (s.slot >= 0 ? ' target' : '');
    el.dataset.set = s.id;
    var elems = [];
    for (var k = 0; k <= s.cards.length; k++) {
      if (k === s.slot) elems.push(slotEl());
      if (k === s.hole) elems.push(holeEl());
      if (k < s.cards.length) {
        elems.push(cardEl(s.cards[k], {
          staged: isStaged(s.cards[k]),
          fromAI: !!aiJustPlayed[s.cards[k].id],
          pickable: isHumanTurn(),
          voile: (projecteur === 'table' && !aiJustPlayed[s.cards[k].id]) ? 'eteinte' : ''
        }));
      }
    }
    // Grandes valeurs en haut : la colonne se lit à l'envers, la carte la
    // plus basse restant entièrement visible.
    if (vertical && prefs.sensSuites === 'desc') elems.reverse();
    for (k = 0; k < elems.length; k++) el.appendChild(elems[k]);
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
  function paintGrid(view, board, dens, nc, part, serre) {
    var m = METRICS[dens] || METRICS[''];
    var empile = board.classList.contains('stack');
    nc = nc || 2;
    /* Partage de la largeur entre les deux moities. Une demie chacune en
       temps normal ; en portrait, les suites en recoivent davantage, faute
       de quoi les deux grilles ne tiendraient pas cote a cote. */
    var totalL = board.clientWidth || 1200;
    var largeurSuites = empile ? totalL : Math.floor(totalL * (part || 0.5));
    var largeurGroupes = empile ? totalL : totalL - largeurSuites;
    var avail = board.clientHeight || 520;
    // Les deux parties recoivent exactement la meme hauteur : toute la
    // hauteur du plateau cote a cote, la moitie chacune quand elles sont
    // empilees. Et chacune l'occupe : la graduation des suites s'etire ou
    // se resserre, les valeurs des groupes se repartissent sur le nombre
    // de colonnes qu'il faut.
    // 34 px d'intitule et de reperes, 26 px de rembourrage de la zone,
    // 12 px de respiration en bas : ce qui reste est pour la grille.
    var hDispo = empile ? Math.floor(avail / 2) - 1 : avail;
    var hauteur = Math.max(60, hDispo - GRID_TOP - MARGE_H);
    board.dataset.avail = avail;      // pour detecter un plateau redimensionne
    var step = Math.max(minRunStep(m.ch), Math.min(m.ch, Math.floor((hauteur - m.ch) / 13)));
    var gstep = groupStep(m.cw);
    board.style.setProperty('--step', step + 'px');
    board.style.setProperty('--gstep', gstep + 'px');
    var gridH = 13 * step + m.ch;

    // Le type de zone sert aussi de repère au glisser-déposer : il doit rester
    // « runs » / « groups », la classe d'affichage s'ajoute à part.
    var zRuns = makeZone('runs', TR('zone.suites'));
    var zGroups = makeZone('groups', TR('zone.groupes'));
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
      ghost.el.className = 'set target' + (view.newZone === 'runs' ? ' run' : ' group');
      ghost.el.appendChild(slotEl());
      (view.newZone === 'runs' ? runs : groups).push(ghost);
    }

    // Suites : colonnes fixes par couleur. Une suite prend la première
    // colonne libre à sa hauteur. Quand elle commence juste là où la
    // précédente finit — la dernière carte d'une suite descend plus bas que
    // sa valeur, puisqu'elle est entière — on la glisse de quelques pixels
    // sous elle plutôt que de l'exiler dans une colonne d'appoint : mieux
    // vaut un léger décalage qu'une suite reléguée à l'autre bout.
    // Tout se raisonne en pixels, pour valoir dans les deux sens de lecture.
    var COLLE = 3;                              // jointure entre deux suites
    // De quoi dégager la dernière carte de la suite du dessus, qui descend
    // plus bas que sa valeur, et rien de plus : deux suites qui se disputent
    // vraiment la même ligne continuent de se séparer en colonnes.
    var DECALE_MAX = m.ch - step + COLLE;
    for (i = 0; i < runs.length; i++) {
      var a = rowOfValue(runs[i].low), b = rowOfValue(runs[i].high);
      runs[i].haut = Math.min(a, b);
      runs[i].basV = Math.max(a, b);
    }
    runs.sort(function (x, y) { return (x.suit - y.suit) || (x.haut - y.haut); });

    var busy = [], bi, bk;
    for (bi = 0; bi < 4; bi++) { busy.push([]); for (bk = 0; bk < nc; bk++) busy[bi].push(-1e9); }
    var extra = [];
    for (i = 0; i < runs.length; i++) {
      var r = runs[i], ends = busy[r.suit], k = -1, kk;
      var ideal = GRID_TOP + r.haut * step;
      var haut = (r.basV - r.haut) * step + m.ch;
      var y = ideal;
      // 1) une colonne où la suite tient exactement à la hauteur de ses valeurs
      for (kk = 0; kk < nc; kk++) { if (ends[kk] <= ideal) { k = kk; break; } }
      // 2) sinon, une colonne où il suffit de la glisser un peu plus bas
      if (k < 0) {
        for (kk = 0; kk < nc; kk++) {
          if (ends[kk] + COLLE - ideal <= DECALE_MAX) { k = kk; y = ends[kk] + COLLE; break; }
        }
      }
      if (k >= 0) {
        ends[k] = y + haut;
        if (serre) r.el.style.zIndex = k + 1;
        place(zRuns, r.el, runColX(r.suit, k, m, nc, serre), y);
      } else {
        var e = 0;
        while (e < extra.length && extra[e] > ideal) e++;
        if (e === extra.length) extra.push(-1e9);
        extra[e] = ideal + haut;
        place(zRuns, r.el, extraColX(e, m, nc, serre), ideal);
      }
    }
    // Les deux zones « nouvelle combinaison » se rangent contre la
    // frontiere, a la meme distance d'elle. Cette distance est celle que la
    // moitie gauche peut offrir : 6 px quand la place le permet, moins si
    // les colonnes des suites vont presque jusqu'au bord.
    var largeurMoitie = largeurSuites;
    var finColonnes = extra.length ? extraColX(extra.length, m, nc, serre)
      : runsWidth(m, nc, serre);
    var LN = largeurNeuve(m);
    var ecartBord = Math.max(0, Math.min(6, largeurMoitie - MARGE_L - finColonnes - LN));
    /* Les deux bandes se placent dans le meme repere, celui de leur zone :
       celle des groupes a « ecartBord » du bord gauche, celle des suites a
       « ecartBord » du bord droit. On retranchait ici une marge de zone en
       trop, et la bande des suites se retrouvait seize pixels plus loin de
       la frontiere que sa voisine. */
    var newRunsX = Math.max(finColonnes, largeurMoitie - ecartBord - LN);
    var apresSuites = newRunsX + LN + 8;

    // Groupes : une case fixe par valeur, As à Roi — 7 lignes puis la colonne
    // suivante. Une valeur est donc toujours au même endroit, qu'elle soit
    // posée ou non. Un éventuel second groupe de même valeur se range dans une
    // colonne d'appoint, sur la ligne de sa valeur.
    var groupW = largeurGroupe(m);
    // La zone « Nouveau groupe » occupe le bord gauche : elle se retrouve
    // ainsi juste a cote de « Nouvelle suite », qui borde la zone de gauche.
    var NEUVE_W = largeurNeuve(m) + 8;
    /* Cote a cote, « Nouveau groupe » borde la frontiere, donc le bord
       gauche de sa moitie, pour faire face a « Nouvelle suite ». Empilees,
       il n'y a plus de frontiere entre elles : la zone passe a droite, juste
       sous « Nouvelle suite », et la grille des valeurs reprend le bord
       gauche. */
    var GX = empile ? ecartBord : ecartBord + NEUVE_W;
    // Largeur dont dispose reellement la grille des valeurs : tout le plateau
    // si les deux parties sont empilees, ce que les suites laissent sinon.
    // Les deux moities font exactement la meme largeur : la frontiere tombe
    // au milieu du plateau.
    var largeurG = (empile ? totalL - MARGE_L
      : Math.max(160, largeurGroupes - MARGE_L)) - NEUVE_W;
    var lignesMax = Math.max(1, Math.floor(hauteur / (m.ch + 6)));
    var colsVoulues = Math.min(14, Math.ceil(14 / lignesMax));
    // Une colonne de plus, c'est deux lignes de moins : quand il s'en faut
    // de peu, on resserre la case jusqu'a la largeur d'un carre plutot que
    // de renvoyer deux valeurs sous la ligne de flottaison.
    var caseMin = 3 * gstep + m.cw;
    if (ecartBord + colsVoulues * groupW > largeurG &&
        ecartBord + colsVoulues * caseMin <= largeurG) {
      groupW = Math.floor((largeurG - ecartBord) / colsVoulues);
    }
    /* Deux combinaisons de meme valeur ne peuvent pas tenir dans la meme
       case : la seconde part dans une colonne d'appoint. On lui reserve sa
       place dans la grille, sinon elle deborde et la zone se met a defiler. */
    var presentes = {}, distinctes = 0, enTrop = 0;
    for (i = 0; i < groups.length; i++) {
      var vv = groups[i].low;
      if (presentes[vv]) enTrop++; else { presentes[vv] = 1; distinctes++; }
    }
    var tiennent = Math.floor((largeurG - ecartBord) / groupW) || 1;
    var cols = Math.max(1, Math.min(tiennent, colsVoulues, 14));
    var rows = Math.ceil(14 / cols);
    /* Les cases libres accueillent les doublons ; s'il n'y en a pas assez,
       on retranche des colonnes pour menager celles d'appoint, sinon la
       grille deborderait et la zone se mettrait a defiler. */
    var manque = Math.max(0, enTrop - (rows * cols - distinctes));
    if (manque) {
      cols = Math.max(1, Math.min(tiennent - manque, colsVoulues, 14));
      rows = Math.ceil(14 / cols);
    }
    /* Les lignes se resserrent jusqu'a ce que les cartes se touchent avant
       de laisser la grille deborder : mieux vaut 6 pixels d'air en moins
       qu'un ascenseur. */
    var rowH = Math.max(m.ch, Math.floor(hauteur / rows));
    /* La case de la valeur revient a la combinaison la plus avancee : une
       carte esseulee ne doit pas prendre la place d'un brelan constitue. */
    groups.sort(function (a, b) {
      if (a.low !== b.low) return 0;
      var va = E.isValidSet(a.s.cards) ? 1 : 0, vb = E.isValidSet(b.s.cards) ? 1 : 0;
      return (vb - va) || (b.s.cards.length - a.s.cards.length);
    });
    /* Chaque valeur rejoint sa case, toujours la meme. */
    var occ = {}, vus = {}, doublons = [], maxX = GX + cols * groupW, gx;
    for (i = 0; i < groups.length; i++) {
      var v = groups[i].low;
      if (vus[v]) { doublons.push(groups[i]); continue; }
      vus[v] = 1;
      var cv = valueCol(v, rows);
      occ[valueRow(v, rows) + ':' + cv] = 1;
      place(zGroups, groups[i].el, GX + cv * groupW, GRID_TOP + valueRow(v, rows) * rowH);
    }
    /* Une seconde combinaison de meme valeur se range dans la case libre la
       plus proche de sa jumelle : juste a cote de preference — cote a cote,
       on les compare d'un coup d'oeil — a defaut juste au-dessous, et vers
       la droite plutot que vers la gauche. La grille entiere pleine, une
       colonne d'appoint la recueille. */
    var appoint = 0;
    for (i = 0; i < doublons.length; i++) {
      var g = doublons[i], r0 = valueRow(g.low, rows), c0 = valueCol(g.low, rows);
      var pr = -1, pc = -1, mieux = 1e9, rr, cc, dist;
      for (rr = 0; rr < rows; rr++) {
        for (cc = 0; cc < cols; cc++) {
          if (occ[rr + ':' + cc]) continue;
          dist = Math.abs(cc - c0) + 2 * Math.abs(rr - r0) + (cc < c0 ? 0.5 : 0);
          if (dist < mieux) { mieux = dist; pr = rr; pc = cc; }
        }
      }
      if (pc >= 0) { occ[pr + ':' + pc] = 1; gx = GX + pc * groupW; }
      else { gx = GX + (cols + appoint++) * groupW; pr = r0; }
      place(zGroups, g.el, gx, GRID_TOP + pr * rowH);
      if (gx + groupW > maxX) maxX = gx + groupW;
    }
    var groupsH = rows * rowH;

    // Les deux zones « nouvelle combinaison » sont toujours posees, meme
    // pendant le tour des joueurs virtuels : les faire disparaitre changeait
    // la largeur des zones, et toute la table sautait d'un tour a l'autre.
    // Hors de votre tour elles sont seulement estompees.
    // Memes dimensions des deux cotes : elles se font face.
    placeNewZone(zRuns, newRunsX, GRID_TOP, LN, hauteur, 'runs', TR('zone.nouvelleSuite'));
    placeNewZone(zGroups, empile ? newRunsX : ecartBord, GRID_TOP, LN, hauteur,
                 'groups', TR('zone.nouveauGroupe'));
    // Les espaceurs donnent sa hauteur de defilement a chaque grille ; ils
    // doivent etre poses avant qu'une moitie ne soit repliee.
    spacer(zRuns, gridH + GRID_TOP + BAS_ZONE);
    spacer(zGroups, groupsH + GRID_TOP + BAS_ZONE);

    if (empile || largeurSuites === largeurGroupes) {
      // L'une au-dessus de l'autre, ou cote a cote : a parts egales.
      zRuns.style.flex = '1 1 0';
      zGroups.style.flex = '1 1 0';
    } else {
      // Cote a cote sur un ecran etroit : chacune sa part, celle qu'il lui
      // faut. Ni l'une ni l'autre ne s'etire, sinon le partage se perdrait.
      zRuns.style.flex = '0 0 ' + largeurSuites + 'px';
      zGroups.style.flex = '0 0 ' + largeurGroupes + 'px';
    }
  }

  function place(zone, el, x, y) {
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    zone.appendChild(el);
  }

  function placeNewZone(zone, x, y, w, h, kind, label) {
    var d = newZone(kind, label);
    d.classList.add('tall');
    if (!isHumanTurn()) d.classList.add('off');
    d.style.left = x + 'px';
    d.style.top = y + 'px';
    d.style.width = w + 'px';
    d.style.height = h + 'px';
    zone.appendChild(d);
  }

  /* Les valeurs se repartissent en colonnes de `rows` lignes : A en haut de
     la premiere colonne, et ainsi de suite. Le nombre de lignes depend de la
     place, mais ne change pas en cours de partie a taille d'ecran egale. */
  function valueCol(v, rows) { return Math.floor((v - 1) / rows); }
  function valueRow(v, rows) { return (v - 1) % rows; }

  /* Trame des valeurs côté groupes : chaque valeur garde sa case, occupée ou
     non, pour qu'on sache toujours où regarder. */
  function addRuler(zone, step, gridH) {
    var r = document.createElement('div');
    r.className = 'ruler';
    // 14 lignes : As, 2 … Roi, puis l'As haut sous le Roi.
    for (var v = 1; v <= 14; v++) {
      var line = document.createElement('div');
      line.className = 'gridline';
      line.style.top = (GRID_TOP + rowOfValue(v) * step) + 'px';
      r.appendChild(line);
      var lab = document.createElement('i');
      lab.textContent = v === 14 ? 'A' : E.rankLabel(v);
      if (v === 14) lab.className = 'acehigh';
      lab.style.top = (GRID_TOP + rowOfValue(v) * step) + 'px';
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
      /* Table vide : c'est elle qui porte le message du moment, a la place
         d'un texte d'accueil qui ne disait rien de la partie en cours. */
      var m = messageContexte();
      var empty = document.createElement('div');
      empty.className = 'empty' + (m.cls ? ' ' + m.cls : '');
      empty.innerHTML = m.tapis || m.html || TR('board.vide');
      zone.appendChild(empty);
      if (isHumanTurn()) zone.appendChild(newZone('any', TR('zone.nouvelle')));
      return;
    }
    for (var i = 0; i < view.sets.length; i++) zone.appendChild(setEl(view.sets[i]));
    if (view.newSlot) {
      var ns = document.createElement('div');
      ns.className = 'set target';
      ns.appendChild(slotEl());
      zone.appendChild(ns);
    } else if (isHumanTurn()) {
      zone.appendChild(newZone('any', TR('zone.nouvelle')));
    }
  }

  var DENSITIES = ['', 'moyen', 'dense', 'denser'];

  /* Taille des cartes : assez petite pour que toutes les colonnes tiennent. */
  /* Place demandee par chaque zone, separement : c'est ce qui permet de
     decider entre les deux cote a cote et l'une au-dessus de l'autre. */
  /* Hauteurs minimales : les deux grilles se compriment, l'une en resserrant
     sa graduation, l'autre en repartissant ses valeurs sur plus de colonnes. */
  function hautSuites(m) { return GRID_TOP + 13 * minRunStep(m.ch) + m.ch + MARGE_H; }
  /* Hauteur de la grille des valeurs : elle depend de la largeur, puisque
     c'est le nombre de colonnes qui fixe le nombre de lignes. Sans ce
     calcul, on choisissait des cartes trop grandes et la grille debordait. */
  function hautGroupes(m, largeur) {
    var w = Math.max(60, largeur - largeurNeuve(m) - 8);   // moins « Nouveau groupe »
    var colsFit = Math.max(1, Math.min(14, Math.floor((w - GROUP_X) / largeurGroupe(m))));
    return GRID_TOP + Math.ceil(14 / colsFit) * (m.ch + 6) + MARGE_H;
  }


  /* Largeur en-dessous de laquelle une grille cesse d'etre lisible : ses
     colonnes fixes, sans les colonnes d'appoint qui, elles, peuvent
     defiler. C'est ce minimum qui decide de l'empilement, pas la place
     ideale — sinon on empilerait des que la table est chargee. */
  /* Place minimale d'une zone : ses colonnes, la bande « nouvelle
     combinaison », et le rembourrage de la zone elle-meme — ce dernier
     manquait, et la grille se retrouvait avec une colonne de moins que
     prevu, donc deux fois plus de lignes. */
  function minSuites(m, nc, serre) { return runsWidth(m, nc, serre) + largeurNeuve(m) + 8; }
  function minGroupes(m) { return GROUP_X + 2 * largeurGroupe(m) + largeurNeuve(m) + 24; }

  /* Choisit la taille des cartes ET la disposition des deux zones.
     Un debordement vertical se rattrape en faisant defiler, et ne justifie
     pas d'empiler ; un etranglement horizontal, lui, rend la table
     illisible. La hauteur ne tranche donc qu'entre deux dispositions deja
     acceptables en largeur. */
  function pickLayout(view, width, height, densMin) {
    var d, m, d0 = DENSITIES.indexOf(densMin || '');
    if (d0 < 0) d0 = 0;

    // 1) cote a cote : la plus grande taille de carte qui tienne en largeur
    //    comme en hauteur. On ne reserve plus de colonnes d'appoint : elles
    //    sont rares, et les reserver coutait une taille de carte a tout le
    //    monde, tout le temps.
    for (d = d0; d < DENSITIES.length; d++) {
      m = METRICS[DENSITIES[d]];
      if (2 * Math.max(minSuites(m, 2), minGroupes(m)) <= width &&
          Math.max(hautSuites(m), hautGroupes(m, width / 2)) <= height) {
        return { dens: DENSITIES[d], stack: false, nc: 2 };
      }
    }
    // 2) la meme chose, en acceptant de defiler verticalement.
    for (d = d0; d < DENSITIES.length; d++) {
      m = METRICS[DENSITIES[d]];
      if (2 * Math.max(minSuites(m, 2), minGroupes(m)) <= width) {
        return { dens: DENSITIES[d], stack: false, nc: 2 };
      }
    }
    // 3) la largeur ne suffit plus pour deux moities egales. Reste a choisir,
    //    pour chaque taille de carte et dans cet ordre, entre un partage
    //    inegal et l'empilement — jamais de carte rapetissee pour obtenir
    //    l'un ou l'autre, puisque les tailles sont essayees de la plus
    //    grande a la plus petite.
    //    Le partage inegal vaut mieux quand il tient : en portrait, les deux
    //    grilles n'ont pas les memes besoins — les suites se lisent en
    //    hauteur et reclament des colonnes, les valeurs des groupes se
    //    contentent de deux colonnes et de beaucoup de lignes. Empilee, une
    //    suite ne montre qu'un quart de chaque carte ; cote a cote, les
    //    trois quarts.
    for (d = d0; d < DENSITIES.length; d++) {
      m = METRICS[DENSITIES[d]];
      var bg = minGroupes(m);
      if (hautSuites(m) <= height && hautGroupes(m, bg) <= height) {
        /* Le rab va aux suites : c'est la qu'une colonne de plus evite un
           ascenseur, quand deux suites d'une meme couleur se chevauchent. */
        if (minSuites(m, 2) + bg <= width) {
          return { dens: DENSITIES[d], stack: false, nc: 2, part: (width - bg) / width };
        }
        /* Sinon on resserre les colonnes plutot que de rapetisser les cartes :
           mieux vaut deux suites de meme couleur qui se chevauchent a
           l'occasion que toute la table en plus petit. */
        if (minSuites(m, 2, true) + bg <= width) {
          return { dens: DENSITIES[d], stack: false, nc: 2, serre: true,
                   part: (width - bg) / width };
        }
      }
    }
    /* 4) l'empilement en dernier ressort, meme s'il autorise des cartes plus
       grandes : il coupe la hauteur en deux, et une suite n'y montre plus
       qu'un quart de chaque carte contre les trois quarts cote a cote. Le
       calcul tranche — sur un iPad en portrait, 23 px de carte visible
       empile contre 58 px cote a cote, pour des cartes a peine plus petites.
       Et des que la table se garnit, l'empilement rapetisse de toute facon
       ses cartes a la meme taille : son avantage ne tient qu'a table vide. */
    for (d = d0; d < DENSITIES.length; d++) {
      m = METRICS[DENSITIES[d]];
      if (Math.max(minSuites(m, 2), minGroupes(m)) <= width &&
          2 * Math.max(hautSuites(m), hautGroupes(m, width)) <= height) {
        return { dens: DENSITIES[d], stack: true, nc: 2 };
      }
    }
    // 4) ecran de telephone : la table rangee ne tient plus, meme empilee.
    //    On passe a la table libre, d'un seul tenant : une carte peut alors
    //    aller d'un groupe vers une suite sans changer de vue.
    m = METRICS['denser'];
    if (minSuites(m, 2) > width || minGroupes(m) > width) return { flow: true };
    return { dens: 'denser', stack: true, nc: 2 };
  }

  function paintBoard() {
    if (!drag) { splitGaps(); mergeRuns(); tidyBoard(); }
    var view = currentView();
    var board = $('#board');
    var split = !!E.options.keepPlaces;
    var dens = '', stack = false, nc = 2, part = 0.5, serre = false;
    function poser(d) {
      densiteCourante = d;
      board.className = d + (split ? ' split' : '') + (stack ? ' stack' : '');
      // Valeurs par defaut des deux chevauchements ; la table rangee affine
      // ensuite le pas vertical pour occuper exactement la hauteur.
      board.style.setProperty('--step', runStep((METRICS[d] || METRICS['']).ch) + 'px');
      board.style.setProperty('--gstep', groupStep((METRICS[d] || METRICS['']).cw) + 'px');
      board.innerHTML = '';
      if (split) paintGrid(view, board, d, nc, part, serre);
      else paintFlow(view, board);
    }
    /* Dessine la table avec des cartes d'au plus la taille demandee : la
       disposition est choisie pour cette taille-la, puis posee. */
    function dessiner(d) {
      dens = d;
      if (split) {
        var fit = pickLayout(view, board.clientWidth || 1200, board.clientHeight || 520, d);
        if (fit.flow) split = false;    // trop etroit pour la table rangee
        else {
          if (DENSITIES.indexOf(fit.dens) > DENSITIES.indexOf(dens)) dens = fit.dens;
          stack = fit.stack; nc = fit.nc || 2; part = fit.part || 0.5; serre = !!fit.serre;
        }
      }
      poser(dens);
    }
    /* On part des plus grandes cartes et on ne rapetisse que si la table
       deborde vraiment. Le nombre de cartes posees ne dit rien de la place
       qu'elles prennent : vingt cartes en six combinaisons eparpillees
       tiennent moins bien que quarante bien rangees, et un seuil sur le
       compte faisait rapetisser toute la table sans raison visible. Deux
       essais au plus — il n'y a que trois tailles. */
    dessiner('');
    var essais = 0;
    while (tableDeborde() && DENSITIES.indexOf(dens) < DENSITIES.length - 1 && essais++ < 3) {
      dessiner(DENSITIES[DENSITIES.indexOf(dens) + 1]);
    }
    majBoutonsIcones();
    majBarreCompacte();
  }

  /* Ce que la barre resserree rendrait au tapis : la difference de hauteur
     entre ses deux etats. On les mesure l'un apres l'autre sans laisser
     l'ecran se redessiner entre les deux, donc sans clignotement. Sur un
     large ecran le message tient deja sur la rangee des boutons : le gain
     est nul, et il n'y a aucune raison de masquer les libelles. */
  function gainCompact(jeu) {
    var bar = $('#bar'), etait = jeu.classList.contains('compact');
    jeu.classList.add('compact');
    var serree = bar.offsetHeight;
    jeu.classList.remove('compact');
    var large = bar.offsetHeight;
    if (etait) jeu.classList.add('compact');
    return large - serree;
  }

  /* Les boutons doivent tenir sur une seule rangee. S'ils debordent sur une
     seconde, tous perdent leur libelle — « Au suivant ! », « Annuler » et
     « Piocher » compris : sur un telephone, cette rangee de moins est autant
     de tapis gagne. On mesure toujours la barre libelles rendus, jamais
     l'etat courant, sinon le resserrement se jugerait sur son propre effet
     et la barre clignoterait d'un rendu a l'autre. */
  function majBoutonsIcones() {
    var jeu = $('#game'), btns = document.querySelectorAll('#bar .btn');
    if (btns.length < 2) return;
    var compact = jeu.classList.contains('compact'), i;
    jeu.classList.remove('icones');
    jeu.classList.remove('compact');
    var y = btns[0].offsetTop, deborde = false;
    for (i = 1; i < btns.length; i++) {
      if (btns[i].offsetTop > y + 2) { deborde = true; break; }
    }
    if (compact) jeu.classList.add('compact');
    jeu.classList.toggle('icones', deborde);
  }

  /* Une zone de la table a-t-elle besoin d'un ascenseur ? */
  function tableDeborde() {
    var zones = document.querySelectorAll('#board .zone'), i, z;
    for (i = 0; i < zones.length; i++) {
      z = zones[i];
      if (z.classList.contains('folded')) continue;
      if (z.scrollHeight > z.clientHeight + 1 || z.scrollWidth > z.clientWidth + 1) return true;
    }
    return false;
  }

  /* Si la table deborde et doit defiler, les boutons perdent leurs libelles :
     le message rejoint leur rangee et le plateau gagne une rangee entiere.
     Quand l'ascenseur a disparu, on ne se contente pas de rendre les
     libelles : on redessine la table avec la barre large, et on ne garde ce
     retour que si l'ascenseur ne reparait pas. La grille remplit toujours la
     hauteur offerte, aucune mesure ne dit donc a l'avance s'il reste de la
     marge — seul l'essai le dit. Et comme c'est le meme rendu qui tranche,
     la barre ne peut pas se mettre a clignoter d'un tour a l'autre. */
  var essaiLibelles = false;
  function majBarreCompacte() {
    var jeu = $('#game'), gain = gainCompact(jeu);
    /* Sur un large ecran le message tient deja sur la rangee des boutons :
       les resserrer ne rendrait rien au tapis. */
    if (gain <= 0) { jeu.classList.remove('compact'); return; }
    if (tableDeborde()) { jeu.classList.add('compact'); return; }
    if (!jeu.classList.contains('compact') || essaiLibelles) return;
    essaiLibelles = true;
    jeu.classList.remove('compact');
    paintBoard();
    if (tableDeborde()) { jeu.classList.add('compact'); paintBoard(); }
    essaiLibelles = false;
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
    var mr = METRICS[densiteCourante] || METRICS[''];
    rack.style.setProperty('--cw', mr.cw + 'px');
    rack.style.setProperty('--ch', mr.ch + 'px');
    rack.innerHTML = '';
    var hand = game.human().hand.filter(function (c) {
      return !(drag && drag.card.id === c.id);
    });
    var hints = drag ? hintCache.ids : playableIds();
    /* Indices allumés : la main ne montre plus que les cartes posables. Les
       autres disparaissent au lieu de se ternir — on voit d'un coup d'œil ce
       dont on dispose, et les cartes restantes y gagnent en taille. Si aucune
       n'est posable, on les laisse toutes : une main vide alarmerait pour
       rien, et le message dit déjà qu'il n'y a pas de coup. */
    var tenues = hand.length;        // avant le filtre : la taille n'en depend pas
    if (hints) {
      var posables = hand.filter(function (c) { return hints[c.id]; });
      if (posables.length) hand = posables;
    }
    /* Une seule rangée : si la main ne tient pas en largeur, les cartes se
       chevauchent juste assez pour rentrer, comme un éventail tenu en main.
       Sur un téléphone, c'est une rangée de moins — autant de tapis gagné. */
    var dispo = rack.clientWidth || 600;
    /* La main doit tenir sur sa rangee, en entier. Au-dela d'une quinzaine de
       cartes, l'eventail se resserrait au point que les dernieres sortaient
       de l'ecran : elles rapetissent plutot d'un cran, jusqu'a ce que la
       tranche visible laisse lire la valeur. Mieux vaut dix-sept petites
       cartes toutes visibles que quatre invisibles au bout de la rangee. */
    /* La taille se decide sur la main entiere, indices ou non : masquer les
       cartes injouables desserre l'eventail, ce n'est pas une raison pour
       redessiner les cartes a une autre echelle. Allumer les indices ne doit
       rien changer d'autre que ce qui est montre. */
    var di = DENSITIES.indexOf(densiteCourante);
    if (di < 0) di = 0;
    while (tenues > 1 && di < DENSITIES.length - 1) {
      var m2 = METRICS[DENSITIES[di]];
      if (Math.floor((dispo - m2.cw) / (tenues - 1)) >= Math.round(m2.cw * 0.42)) break;
      di++;
    }
    mr = METRICS[DENSITIES[di]];
    rack.style.setProperty('--cw', mr.cw + 'px');
    rack.style.setProperty('--ch', mr.ch + 'px');
    var chevauche = 0;
    if (hand.length > 1 && hand.length * (mr.cw + 4) - 4 > dispo) {
      var pas = Math.floor((dispo - mr.cw) / (hand.length - 1));
      pas = Math.max(14, Math.min(pas, mr.cw + 4));
      chevauche = pas - mr.cw - 4;
    }
    rack.style.flexWrap = chevauche ? 'nowrap' : 'wrap';
    /* Main resserrée : seule la tranche gauche de chaque carte se voit, le
       symbole de couleur passe donc sous la valeur (voir la feuille de style). */
    rack.classList.toggle('serre', !!chevauche);
    for (var i = 0; i < hand.length; i++) {
      var voile = '';
      if (hints && !hints[hand[i].id]) voile = 'terne';
      if (projecteur === 'main' && piochee !== hand[i].id) voile = 'eteinte';
      var el = cardEl(hand[i], { pickable: isHumanTurn(), voile: voile });
      if (hints) el.classList.add(hints[hand[i].id] ? 'playable' : 'idle');
      if (piochee === hand[i].id) el.classList.add('piochee');
      if (chevauche && i) el.style.marginLeft = chevauche + 'px';
      rack.appendChild(el);
    }
    var nmain = game.human().hand.length;
    $('#racklabel').textContent = TR('zone.votreMain', { n: nmain, cartes: NC(nmain) });
  }

  /* Les noms des joueurs virtuels sont choisis par le jeu — sauf quand une
     partie est rejouee depuis un journal, qui peut venir de n'importe ou. Un
     nom est du texte, jamais du balisage : on l'echappe partout ou il entre
     dans la page. */
  function echapper(txt) {
    return String(txt).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function paintOpponents(thinking) {
    paintOpponentsMini(thinking);
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
        '<div class="av">' + (p.human ? '★' : echapper(p.name.charAt(0))) + '</div>' +
        /* La pastille ne dit plus « a pose » ou « reste a poser » : c'etait le
           vocabulaire du rami classique, ou l'on ne touche pas a la table
           avant d'avoir ouvert soi-meme. Ici la seule contrainte porte sur la
           table vide, et elle s'impose a qui joue a ce moment-la. Les mots
           annoncaient donc une regle que le jeu n'applique pas. */
        '<div class="who"><div class="nm">' + echapper(p.name) + '</div><div class="sub">' +
        p.hand.length + ' ' + NC(p.hand.length) +
        '</div></div><div class="fan">' + fan + '</div>';
      box.appendChild(d);
    }
  }

  /* Bandeau compact de la premiere ligne : qui joue, avec combien de cartes,
     et ce qui reste a piocher. Sur tablette et telephone il tient lieu de
     rangee des joueurs et de pastilles — une ligne de moins avant la table,
     et autant de hauteur rendue aux cartes. */
  function paintOpponentsMini(thinking) {
    var box = $('#oppmini');
    if (!box) return;
    remplirMini(box, thinking, false);
    /* Les noms rognes ne disent plus rien : des que le bandeau deborde de sa
       place, on repasse aux initiales, qui tiennent toujours. Les pastilles
       ne se compriment pas — c'est ce debordement, et non un nom tronque par
       l'ellipse, qui se mesure franchement. */
    if (box.scrollWidth > box.clientWidth + 1) remplirMini(box, thinking, true);
  }

  function remplirMini(box, thinking, initiales) {
    box.innerHTML = '';
    box.classList.toggle('initiales', !!initiales);
    for (var i = 0; i < game.players.length; i++) {
      var p = game.players[i];
      var actif = (i === game.current) && !game.finished;
      var d = document.createElement('div');
      d.className = 'mini' + (actif ? ' actif' : '') + (actif && !p.human && thinking ? ' pense' : '');
      /* L'etoile marque votre place ; pour les autres le nom suffit, et
         l'initiale en plus rognait ce nom sur un telephone. */
      d.innerHTML = (p.human ? '<b>\u2605</b>' : '') +
        (p.human && initiales ? '' : '<span class="nm">' +
          echapper(initiales ? p.name.charAt(0) : p.name) + '</span>') +
        '<span class="n">' + p.hand.length + '</span>';
      box.appendChild(d);
    }
    var pioche = document.createElement('div');
    pioche.className = 'mini pioche';
    pioche.innerHTML = '<span class="lbl">' + TR('hud.pioche') + '</span><span class="n">' +
      game.deck.length + '</span>';
    box.appendChild(pioche);
    if (match && match.total > 1) {
      var manche = document.createElement('div');
      manche.className = 'mini pioche manche';
      manche.innerHTML = '<span class="lbl">' + TR('hud.manche') + '</span><span class="n">' +
        match.manche + '/' + match.total + '</span>';
      box.appendChild(manche);
    }
  }

  function capture() {
    var m = {};
    var els = document.querySelectorAll('.card[data-id]');
    for (var i = 0; i < els.length; i++) m[els[i].dataset.id] = els[i].getBoundingClientRect();
    return m;
  }

  /* La feuille de style neutralise les animations CSS quand le systeme
     demande moins de mouvement ; les animations FLIP sont ecrites en
     JavaScript et lui echappent. On les saute ici. */
  function mouvementReduit() {
    return !!(window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function flip(prev, opts) {
    if (mouvementReduit()) {
      if (opts && opts.land) marquerArrivee(opts.land);
      return;
    }
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
    if (opts && opts.land) marquerArrivee(opts.land);
  }

  function marquerArrivee(id) {
    var t = document.querySelector('.card[data-id="' + id + '"]');
    if (!t) return;
    t.classList.add('landed');
    setTimeout(function () { t.classList.remove('landed'); }, 420);
  }

  function render(opts) {
    opts = opts || {};
    var prev = capture();
    paintBoard();
    paintRack();
    paintOpponents(opts.thinking);
    // La main et la barre peuvent changer de hauteur en se redessinant, donc
    // changer celle du plateau : la grille aurait alors ete calculee pour une
    // hauteur perimee. On la refait une fois, sans animation.
    var bd = $('#board');
    if (bd.dataset.avail && Math.abs(bd.clientHeight - (+bd.dataset.avail)) > 2) {
      paintBoard();
      paintRack();          // la taille des cartes a pu changer avec elle
    }
    $('#deckcount').textContent = game.deck.length;
    var rp = $('#roundpill');
    if (rp) {
      var plusieursManches = match && match.total > 1;
      rp.classList.toggle('hidden', !plusieursManches);
      if (plusieursManches) {
        rp.innerHTML = TR('hud.manche') + '&nbsp;<b>' + match.manche + '/' + match.total + '</b>' +
          (match.scores[0] ? ' &middot; ' + TR('hud.vous') + '&nbsp;<b>' +
            (match.scores[0] > 0 ? '+' : '') + match.scores[0] + '</b>' : '');
      }
    }
    flip(prev, opts);
  }

  /* Vrai tant que la table, vierge en début de tour, n'a pas reçu de suite. */
  /* Le tour a-t-il commencé sur une table vierge ? */
  function tourDOuverture() {
    if (!game || !game.snapshot) return false;
    for (var id in game.snapshot.boardIds) return false;
    return true;
  }

  function ouvertureAttendue() {
    if (!tourDOuverture()) return false;
    for (var i = 0; i < game.board.length; i++) {
      if (E.isRun(game.board[i].cards)) return false;
    }
    return true;
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

    var m = messageContexte();
    var msg = $('#msg');
    msg.className = m.cls;
    msg.innerHTML = m.html;
    /* Hors ordinateur la barre est masquee : seul l'avertissement passe en
       bulle — aucune carte posable, ou l'ouverture a faire en suite. Ce qui
       ne fait que commenter un geste qu'on vient de faire reste dans la
       barre, donc sur ordinateur seulement. Sur une table vide, le tapis
       porte deja le message : pas de bulle alors. */
    if (getComputedStyle(msg).display === 'none') {
      /* La bulle ne redit pas ce que le tapis porte deja — mais seule la
         table libre du telephone affiche ce message en son milieu : la table
         rangee, elle, n'a pas de place vide ou l'ecrire, et c'est alors a la
         bulle de dire la consigne entiere. On regarde donc si elle est bien
         a l'ecran, plutot que de supposer. */
      var surTapis = !!document.querySelector('#board .empty');
      var texte = surTapis ? (m.complement || '') : m.html;
      if (texte && m.bulle && texte !== dernierMessage &&
          !$('#toast').classList.contains('show')) toast(texte);
      dernierMessage = texte;
    } else {
      dernierMessage = '';
    }
  }

  /* Ou en est le tour, en une phrase : ce que la barre affiche sur un
     ordinateur, ce que la table porte quand elle est vide, et la bulle
     ailleurs. */
  var dernierMessage = '';
  function messageContexte() {
    var human = isHumanTurn();
    /* Pendant le tour des autres, la barre se tait : la pastille doree du
       joueur en cours et les points de suspension apres son nom disent deja
       qui joue, et le tapis s'assombrit derriere ce qu'il vient de poser. */
    if (!human) return { cls: '', html: '' };
    var staged = game.stagedCards().length;
    var check = game.checkCommit();
    /* « bulle » distingue l'avertissement — ce qu'on ne peut pas deviner en
       regardant la table — du commentaire de ce qu'on vient de faire. Seul le
       premier passe en bulle la ou la barre n'existe pas ; le reste s'affiche
       dans la barre sur ordinateur, et nulle part ailleurs. */
    if (check.ok) {
      return { cls: 'good', bulle: false,
        html: TR('bar.ok', { n: staged, cartes: NC(staged), p: game.stagedPoints(),
          posees: TR(staged > 1 ? 'bar.posees' : 'bar.posee') }) };
    }
    if (staged) return { cls: 'warn', bulle: false, html: check.reason };
    if (ouvertureAttendue()) {
      var tete = TR('bar.ouverture');
      if (!prefs.hints) return { cls: 'warn', bulle: true, html: tete, tapis: tete };
      /* Les indices ne proposent qu'une ouverture en suite : s'ils ne
         trouvent rien, aucune n'est possible et il faut piocher. Le tapis ne
         porte que la consigne ; ce que les indices y ajoutent passe par la
         barre ou par la bulle, selon l'appareil. */
      playableIds();
      var queue = hintCache.total
        ? TR('bar.ouvertureN', { n: hintCache.total, cartes: NC(hintCache.total),
            mises: TR(hintCache.total > 1 ? 'bar.mises' : 'bar.mise') })
        : TR('bar.ouvertureRien');
      return { cls: 'warn', bulle: true, html: tete + ' — ' + queue,
               tapis: tete, complement: queue };
    }
    /* « Aucune carte posable » suppose d'avoir cherche tous les coups : c'est
       le travail des indices, et on ne le fait pas dans le dos du joueur qui
       les a eteints. */
    if (prefs.hints) {
      playableIds();
      var n = hintCache.total;
      if (!n) return { cls: 'warn', bulle: true, html: TR('bar.indicesRien') };
      /* Le meilleur coup passe en bulle : c'est une reponse a une question
         posee — les indices allumes — et non le commentaire d'un geste. */
      return { cls: 'good', bulle: true, html: TR('bar.indices', { n: n, cartes: NC(n),
        mises: TR(n > 1 ? 'bar.mises' : 'bar.mise') }) };
    }
    /* Rien de particulier a dire : la barre reste vide. Le rappel « glissez
       une carte sur la table » revenait a chaque tour pour une consigne que
       les regles donnent une fois pour toutes. */
    return { cls: '', html: '' };
  }

  /* ================= Aide : cartes posables ======================= */

  var hintCache = { key: '', ids: null, total: 0 };

  /* Les cartes mises en avant sont celles du MEILLEUR coup du tour — celui
     que « Magique » jouerait. Signaler toutes les cartes jouables une
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

    // bestPartition, et non le solveur brut : sur une table vierge la
    // partie doit s'ouvrir par une suite, et un indice qui montrerait un
    // brelan designerait un coup impossible a valider.
    var best = AI.bestPartition(board, pool);
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

  /* Distance du curseur au cadre d'une combinaison : nulle a l'interieur,
     sinon l'ecart au bord le plus proche. */
  function distanceAuCadre(r, x, y) {
    var dx = Math.max(r.left - x, 0, x - r.right);
    var dy = Math.max(r.top - y, 0, y - r.bottom);
    return Math.sqrt(dx * dx + dy * dy);
  }

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

  function setTarget(x, y, force, auto) {
    var t = computeTarget(x, y, auto);
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

  function computeTarget(x, y, auto) {
    var card = drag.card;
    /* Placement automatique (simple clic) : il n'y a pas de curseur a
       respecter. On vise le centre du plateau faute de mieux, mais ce centre
       tombe entre les deux bandes « nouvelle combinaison », et parfois
       dessus : une carte qui avait sa place partait alors seule dans une
       combinaison neuve. On saute donc les bandes et le survol, pour aller
       droit a la meilleure place. */
    if (!auto) {
      if (inRect(drag.rects.__rack, x, y, 6)) return { kind: 'hand' };
      if (!inRect(drag.rects.__board, x, y, 4)) return { kind: 'none' };
      if (inRect(drag.rects.__new_any, x, y, 4)) return { kind: 'new' };
      if (inRect(drag.rects.__new_runs, x, y, 4)) return { kind: 'new', zone: 'runs' };
      if (inRect(drag.rects.__new_groups, x, y, 4)) return { kind: 'new', zone: 'groups' };
    }

    var sets = baseSets(), i;

    // 1) la combinaison directement sous le curseur
    var hover = null;
    if (!auto) for (i = 0; i < sets.length; i++) {
      if (inRect(drag.rects[sets[i].id], x, y, 6)) hover = sets[i];
    }
    if (hover) {
      var hi = E.acceptIndex(hover.cards, card);
      if (hi >= 0) return { kind: 'insert', setId: hover.id, index: hi };
      // Carte déposée au milieu d'une suite : on la coupe là.
      if (splitParts(hover.cards, card)) return { kind: 'split', setId: hover.id };
    }

    // 2) sinon, la meilleure combinaison du plateau. Une carte qui n'a
    //    qu'une seule place possible la rejoint, meme a l'autre bout : c'est
    //    tout l'interet. Mais quand plusieurs conviennent, c'est la plus
    //    proche du curseur qui gagne — et la distance se mesure au bord de
    //    la combinaison, pas a son centre, qu'une longue suite eloigne.
    var best = null, bestScore = -1e9;
    for (i = 0; i < sets.length; i++) {
      var s = sets[i];
      var idx = E.acceptIndex(s.cards, card);
      if (idx < 0) continue;
      var r = drag.rects[s.id];
      var score = -2 * (r ? distanceAuCadre(r, x, y) : 400);
      if (E.isValidSet(s.cards.concat([card]))) score += 5000;
      score += s.cards.length * 10;
      // Une carte sortie d'une combinaison ne doit pas y retourner d'elle-même :
      // sinon impossible de déplacer une carte d'un carré vers un autre groupe
      // sans viser au pixel près. On y revient en relâchant dessus.
      if (drag.origin.type === 'set' && s.id === drag.origin.setId) score -= 4000;
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
    var out = (res && res.count) ? res.sets : null;
    /* Tour d'ouverture : le solveur ne connaît pas la règle de la suite, et
       il peut regrouper par valeur des cartes déjà posées en suites. Il
       défairait alors l'ouverture du joueur et rendrait son tour
       invalidable. Dans ce cas on renonce à réorganiser : la carte ira
       dans une nouvelle combinaison, au joueur de décider. */
    if (out && tourDOuverture()) {
      var suite = false;
      for (i = 0; i < out.length; i++) if (E.isRun(out[i])) suite = true;
      if (!suite) out = null;
    }
    drag.cache.re = out;
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
      txt = TR(E.isValidSet(full) ? 'drag.insere' : 'drag.construction');
    } else if (t.kind === 'split') txt = TR('drag.coupe');
    else if (t.kind === 'rearrange') txt = TR('drag.reorg');
    else if (t.kind === 'new') txt = TR('drag.nouvelle');
    else if (t.kind === 'hand') txt = TR('drag.main');
    else txt = TR('drag.table');
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
      setTarget(b.left + b.width / 2, b.top + b.height * .45, true, true);
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
      if (!isStaged(card)) { toast(TR('toast.dejaTable')); render(); return; }
      jrn('reprise', { carte: card.id });
      pushTurnState();
      removeFromBoard(card);
      game.human().hand.push(card);
      game.sortHand(game.human(), prefs.tri);
      game.compact();
      render(); updateBar(); sndSnap();
      return;
    }

    var cibleSet = t.setId ? game.setById(t.setId) : null;
    jrn('pose', { carte: card.id,
      de: d.origin.type === 'hand' ? 'main' : 'jeu:' + d.origin.setId,
      cible: { kind: t.kind, index: t.index, zone: t.zone,
               // la combinaison visee est designee par son contenu : les
               // identifiants internes changent d'une partie a l'autre.
               cartes: cibleSet ? cibleSet.cards.map(function (c) { return c.id; }).join(',') : undefined },
      sets: t.kind === 'rearrange' ? (t.sets || (d.cache && d.cache.re) || []).map(function (cs) {
        return cs.map(function (c) { return c.id; }); }) : undefined });
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
  
      } else {
        game.board.push(game.newSet([card]));
        sndSnap();
      }
    } else if (t.kind === 'rearrange') {
      var src = t.sets || (d.cache && d.cache.re);
      game.board = E.alignBoard(game.board, src);
      sndMagic();

    } else {
      var fresh = game.newSet([card]);
      fresh.zone = t.zone;
      game.board.push(fresh);
      sndSnap();
    }
    game.compact();
    render({ land: card.id });
    updateBar();
    if (ouvertureAttendue() && game.boardCards().length >= 3) {
      toast(TR('toast.ouvertureBrelan'));
    }
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
    saveGame();
  }

  /* La partie en cours est enregistrée au début de chacun de vos tours : de
     quoi la retrouver si l'app est fermée ou déchargée par le système. */
  function saveGame() {
    if (!game || game.finished) { prefs.saved = null; savePrefs(); return; }
    var d = game.serialize();
    d.match = match;
    prefs.saved = d;
    savePrefs();
  }

  function resumeGame() {
    var d = prefs.saved;
    if (!d) return;
    nVirtual = d.n;
    game = new E.Game(d.n, d.deal);
    game.loadSerialized(d);
    match = d.match || null;
    history = [game.captureState()];
    turnStack = [];
    aiJustPlayed = {};
    $('#menu').classList.add('hidden');
    $('#game').classList.remove('hidden');
    $('#overlay').classList.add('hidden');
    render();
    updateBar();

    if (!game.player().human) aiPhase();
  }

  function canRewind() {
    return history.length >= 2 && game && !game.finished && game.player().human && !busy;
  }

  /* Annule le dernier coup des joueurs virtuels : on revient au début de
     votre tour précédent, donc avant leurs réponses. */
  function doRewind() {
    if (!canRewind()) return;
    jrn('refaire');
    history.pop();
    game.applyState(history[history.length - 1]);
    turnStack = [];
    render();
    updateBar();
    sndLift();
  }

  function doCommit() {
    if (!isHumanTurn()) return;
    jrn('suivant');
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
    aiJustPlayed = {};         // votre premier geste efface le surlignage
    /* Sans cartes en lumiere, le projecteur n'eclairerait plus rien : il
       assombrirait toute la table. Votre premier geste l'eteint. */
    eteindreProjecteur(true);
    turnStack.push(cloneState());
    if (turnStack.length > 200) turnStack.shift();
  }

  function doUndo() {
    if (!isHumanTurn() || !turnStack.length) return;
    jrn('annule');
    restoreState(turnStack.pop());
    render(); updateBar(); sndLift();
  }

  function doDraw() {
    if (!isHumanTurn()) return;
    jrn('pioche');
    var card = game.draw();
    /* La carte piochée se range aussitôt parmi les autres : sans repère, on
       ne sait plus laquelle on vient de prendre. Elle reste signalée tant
       qu'on ne l'a pas posée ni remplacée par une nouvelle pioche. */
    if (card) {
      piochee = card.id;
      allumerProjecteur('main', 2000);
      /* On ne la dit pas tout de suite : le bouton reste eteint tant que les
         joueurs virtuels n'ont pas repondu. Elle attend votre retour, moment
         ou elle devient vraie et ou l'on peut y donner suite. */
      if (astuceRefaire === 0) astuceRefaire = 1;
    }
    render(); updateBar();
    sndHmm(!card);
    if (!card) toast(TR('toast.piocheVide'));
    if (game.finished) { gameOver(); return; }
    game.nextPlayer();
    render(); updateBar();
    aiPhase();
  }

  function doAuto() {
    if (!isHumanTurn()) return;
    jrn('magique');
    var before = cloneState();
    pushTurnState();
    game.restoreTurn();
    var p = game.human();
    var play = AI.findBestPlay(game, p, null, 'difficile');
    if (!play) {
      restoreState(before);
      turnStack.pop();
      render();
      /* Sur une table vierge, « aucun coup » veut dire « aucune suite » :
         le dire, sinon le joueur qui tient un beau brelan ne comprend pas. */
      toast(TR(tourDOuverture() ? 'toast.rienOuvrir' : 'toast.rienAJouer'));
      return;
    }
    AI.applyPlay(game, p, play);
    render(); sndMagic(); updateBar();
  }

  /* Le bouton bascule entre les deux rangements. Trier tout court n'aurait
     servi a rien : la main est deja remise en ordre a la distribution, a
     chaque pioche et des qu'une carte revient de la table. */
  function doSort() {
    if (!isHumanTurn()) return;
    jrn('tri');
    prefs.tri = prefs.tri === 'suit' ? 'rank' : 'suit';
    E.options.sort = prefs.tri;
    savePrefs();
    game.sortHand(game.human(), prefs.tri);
    render();
  }

  /* ================= Tours des joueurs virtuels =================== */

  async function aiPhase() {
    busy = true;
    aiJustPlayed = {};         // on repart d'une table sans surlignage
    updateBar();
    try {
      await tourDesVirtuels();
    } catch (e) {
      /* Sans ce filet, une exception laissait `busy` leve pour toujours :
         plus un bouton ne repondait et rien ne disait pourquoi. Relacher le
         drapeau ne suffit pas — le tour appartient encore au joueur en
         faute, et la barre reste donc eteinte. Celui-la passe son tour, et
         l'on avance jusqu'a vous : la partie continue vraiment. */
      if (window.console) window.console.error(e);
      var sauts = 0;
      while (!game.finished && !game.player().human && sauts++ <= game.players.length) {
        game.pass();
        game.nextPlayer();
      }
      toast(TR('err.interne'));
    }
    busy = false;
    pushHistory();
    render();
    updateBar();
    /* La table reste assombrie une seconde apres votre retour : le temps de
       voir ce qui a change pendant que les autres jouaient. */
    if (projecteur === 'table') projecteurTimer = setTimeout(eteindreProjecteur, 1000);
    direAstuceRefaire();
    if (game.finished) gameOver();
  }

  /* Un vrai avertissement passe avant une astuce : si une bulle est deja a
     l'ecran, celle-ci attend la prochaine occasion plutot que de l'effacer. */
  function direAstuceRefaire() {
    if (astuceRefaire !== 1 || !canRewind()) return;
    if ($('#toast').classList.contains('show')) return;
    astuceRefaire = 2;
    toast(TR('toast.refaireAstuce', { b: TR('btn.refaire') }));
  }

  async function tourDesVirtuels() {
    while (!game.finished && !game.player().human) {
      var p = game.player();
      render({ thinking: true });
      await sleep(480 + Math.random() * 320);
      var avantIA = (prefs.debug && journal) ? jrnEtat() : null;
      var r = AI.playAITurn(game);
      jrn('ia', { joueur: p.name, genre: r.kind,
        cartes: (r.cards || []).map(function (c) { return c.id; }).join(',') }, avantIA);
      if (r.cards) {
        for (var ci = 0; ci < r.cards.length; ci++) aiJustPlayed[r.cards[ci].id] = true;
      }
      if (r.kind === 'play') {
        allumerProjecteur('table');
        sndSnap();
      } else if (r.kind === 'draw') {
        sndHmm(false);
      } else {
        sndHmm(true);
      }
      render();
      await sleep(620);
      if (game.finished) break;
      game.nextPlayer();
    }
  }

  /* ================= Fin de partie ================================ */

  /* Décompte d'une manche : chacun perd la valeur de ses cartes restantes,
     le gagnant encaisse la somme de ce que les autres gardent en main. */
  function roundScores() {
    var mains = game.players.map(function (p) { return game.handScore(p); });
    var gagnant = game.winner ? game.winner.index : 0;
    if (!game.winner) {
      for (var k = 1; k < mains.length; k++) if (mains[k] < mains[gagnant]) gagnant = k;
    }
    var pts = mains.map(function (h, i) { return i === gagnant ? 0 : -h; });
    var somme = 0;
    for (var i = 0; i < mains.length; i++) if (i !== gagnant) somme += mains[i];
    pts[gagnant] = somme;
    return { pts: pts, gagnant: gagnant };
  }

  function nextRound() {
    match.manche++;
    newGame({ n: nVirtual, names: match.noms.slice(1) }, true);
  }

  function gameOver() {
    sndWin();
    prefs.saved = null;
    savePrefs();
    var w = game.winner;
    var m = match || { total: 1, manche: 1, scores: game.players.map(function () { return 0; }) };
    var r = roundScores();
    for (var s = 0; s < r.pts.length; s++) m.scores[s] += r.pts[s];
    var plusieurs = m.total > 1;
    var derniere = m.manche >= m.total;

    var rows = game.players.map(function (p, i) {
      return { p: p, cartes: p.hand.length, enMain: game.handScore(p),
               manche: r.pts[i], total: m.scores[i] };
    });
    rows.sort(plusieurs
      ? function (a, b) { return b.total - a.total; }
      : function (a, b) { return a.enMain - b.enMain; });

    var titre, sous;
    if (plusieurs && !derniere) {
      titre = TR('fin.mancheSur', { n: m.manche, t: m.total });
      sous = w ? (w.human ? TR('fin.vousManche')
                          : TR('fin.ilManche', { nom: echapper(w.name) }))
               : TR('fin.piocheVide1');
    } else if (plusieurs) {
      titre = rows[0].p.human ? TR('fin.vousPartie')
                              : TR('fin.ilPartie', { nom: echapper(rows[0].p.name) });
      sous = TR('fin.classement', { n: m.total });
    } else {
      titre = w ? (w.human ? TR('fin.vousGagnez')
                           : TR('fin.ilGagne', { nom: echapper(w.name) }))
                : TR('fin.terminee');
      sous = w && !w.hand.length ? TR('fin.videePremiere') : TR('fin.piocheVide2');
    }

    var html = '<div class="panel"><div class="trophy">' +
      (rows[0].p.human ? '🏆' : '🃏') + '</div>' +
      '<h2 style="text-align:center">' + titre + '</h2>' +
      '<p style="text-align:center">' + sous + '</p><table class="scores">';
    if (plusieurs) {
      html += '<tr><td></td><td class="n">' + TR('fin.colCartes') + '</td>' +
              '<td class="n">' + TR('fin.colManche') + '</td>' +
              '<td class="n">' + TR('fin.colTotal') + '</td></tr>';
    }
    for (var i = 0; i < rows.length; i++) {
      var signe = rows[i].manche > 0 ? '+' : '';
      html += '<tr class="' + (i === 0 ? 'win' : '') + '"><td>' +
        (i + 1) + '. ' + echapper(rows[i].p.name) + '</td>' +
        '<td class="n">' + rows[i].cartes + ' ' + NC(rows[i].cartes) + '</td>' +
        (plusieurs ? '<td class="n">' + signe + rows[i].manche + '</td>' +
                     '<td class="n">' + rows[i].total + ' ' + TR('hud.pts') + '</td>'
                   : '<td class="n">' + rows[i].enMain + ' ' + TR('hud.pts') + '</td>') +
        '</tr>';
    }
    html += '</table><div class="row">';
    html += (plusieurs && !derniere)
      ? '<button class="cta" id="next" style="flex:1">' + TR('btn.mancheSuivante') + '</button>'
      : '<button class="cta" id="again" style="flex:1">' + TR('btn.nouvellePartie') + '</button>' +
        '<button class="btn" id="redeal">\u21ba ' + TR('btn.memeDonne') + '</button>';
    html += '<button class="btn" id="tomenu">' + TR('btn.menu') + '</button></div></div>';

    var ov = $('#overlay');
    ov.innerHTML = html;
    ov.classList.remove('hidden');
    var donne = game.deal;
    if ($('#next')) $('#next').onclick = function () { ov.classList.add('hidden'); nextRound(); };
    if ($('#again')) $('#again').onclick = function () { newGame(); };
    if ($('#redeal')) $('#redeal').onclick = function () { newGame(donne); };
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

  /* Les couleurs de tapis se choisissent a l'oeil : une rangee de pastilles
     qui portent la couleur elle-meme, plutot que son nom. */
  function feltRow() {
    var html = '<div class="felts">', i;
    for (i = 0; i < FELTS.length; i++) {
      html += '<button class="feltdot' + (prefs.felt === i ? ' on' : '') +
        '" data-felt="' + i + '" title="' + TR(FELTS[i].cle) +
        '" aria-label="' + TR(FELTS[i].cle) + '" style="background:linear-gradient(160deg,' +
        FELTS[i].a + ' 0%,' + FELTS[i].b + ' 100%)"></button>';
    }
    return html + '</div>';
  }

  function showOptions() {
    var ov = $('#overlay');
    var langs = '';
    for (var L = 0; L < I18N.langues.length; L++) {
      var lg = I18N.langues[L];
      langs += optionRow('langue', lg.code, I18N.get() === lg.code, lg.nom, '');
    }
    ov.innerHTML = '<div class="panel"><h2>' + TR('opt.titre') + '</h2>' +
      '<h3>' + TR('opt.langue') + '</h3>' + langs +
      '<h3>' + TR('opt.tri') + '</h3>' +
      optionRow('tri', 'rank', prefs.tri === 'rank', TR('opt.tri.rank'), TR('opt.tri.rank.d')) +
      optionRow('tri', 'suit', prefs.tri === 'suit', TR('opt.tri.suit'), TR('opt.tri.suit.d')) +
      '<h3>' + TR('opt.duree') + '</h3>' +
      optionRow('manches', '1', prefs.manches === 1, TR('opt.m1'), TR('opt.m1.d')) +
      optionRow('manches', '3', prefs.manches === 3, TR('opt.m3'), TR('opt.m3.d')) +
      optionRow('manches', '5', prefs.manches === 5, TR('opt.m5'), TR('opt.m5.d')) +
      '<h3>' + TR('opt.niveau') + '</h3>' +
      optionRow('niveau', 'facile', prefs.niveau === 'facile', TR('opt.facile'), TR('opt.facile.d')) +
      optionRow('niveau', 'normal', prefs.niveau === 'normal', TR('opt.normal'), TR('opt.normal.d')) +
      optionRow('niveau', 'difficile', prefs.niveau === 'difficile', TR('opt.difficile'), TR('opt.difficile.d')) +
      '<h3>' + TR('opt.aide') + '</h3>' +
      optionRow('autoArrange', '0', !prefs.autoArrange, TR('opt.chercher'), TR('opt.chercher.d')) +
      optionRow('autoArrange', '1', prefs.autoArrange, TR('opt.reorganiser'), TR('opt.reorganiser.d')) +
      '<h3>' + TR('opt.sens') + '</h3>' +
      optionRow('sensSuites', 'asc', prefs.sensSuites === 'asc', TR('opt.asc'), TR('opt.asc.d')) +
      optionRow('sensSuites', 'desc', prefs.sensSuites === 'desc', TR('opt.desc'), TR('opt.desc.d')) +
      '<h3>' + TR('opt.tapis') + '</h3>' + feltRow() +
      '<h3>' + TR('opt.table') + '</h3>' +
      optionRow('keepPlaces', '1', prefs.keepPlaces, TR('opt.rangee'), TR('opt.rangee.d')) +
      optionRow('keepPlaces', '0', !prefs.keepPlaces, TR('opt.libre'), TR('opt.libre.d')) +
      '<h3>' + TR('opt.debug') + '</h3>' +
      optionRow('debug', '1', prefs.debug, TR('opt.debugOn'), TR('opt.debugOn.d')) +
      optionRow('debug', '0', !prefs.debug, TR('opt.debugOff'), TR('opt.debugOff.d')) +
      (prefs.debug
        ? '<div class="row"><button class="btn" id="voirjrn" style="flex:1">' +
          TR('btn.journal') + '</button></div>'
        : '') +
      '<div class="row"><button class="cta" id="closeopts" style="flex:1">' +
      TR('btn.fermer') + '</button></div>' +
      '<p class="versiontxt">' + texteVersion + '<br>' +
      COPYRIGHT.replace(/&/g, '&amp;') + '</p></div>';
    ov.classList.remove('hidden');
    $('#closeopts').onclick = function () { ov.classList.add('hidden'); };
    if ($('#voirjrn')) $('#voirjrn').onclick = showJournal;
    var dots = ov.querySelectorAll('.feltdot'), d;
    for (d = 0; d < dots.length; d++) {
      dots[d].onclick = function () {
        choisirFelt(+this.dataset.felt);
        var tous = ov.querySelectorAll('.feltdot'), k;
        for (k = 0; k < tous.length; k++) tous[k].classList.toggle('on', tous[k] === this);
      };
    }
    var rows = ov.querySelectorAll('.optrow');
    for (var i = 0; i < rows.length; i++) {
      rows[i].onclick = function () {
        var name = this.dataset.pref, value = this.dataset.value;
        if (name === 'langue') {
          choisirLangue(value);
        } else if (name === 'tri') {
          prefs.tri = value;
          E.options.sort = value;
          if (game) { game.sortHand(game.human(), value); render(); }
        } else if (name === 'sensSuites') {
          prefs.sensSuites = value;
        } else if (name === 'manches') {
          prefs.manches = +value;
        } else if (name === 'niveau') {
          prefs.niveau = value;
          E.options.difficulty = value;
        } else if (name === 'debug') {
          prefs.debug = (value === '1');
          if (prefs.debug && game && !journal) jrnNouvelle();
          if (!prefs.debug) journal = null;
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
    function li(cle) { return '<li>' + TR(cle) + '</li>'; }
    ov.innerHTML = '<div class="panel">' +
      '<h2>' + TR('reg.titre') + '</h2><p>' + TR('reg.intro') + '</p>' +
      '<h3>' + TR('reg.h.comb') + '</h3><ul>' +
      li('reg.but') + li('reg.as') + '</ul>' +
      '<h3>' + TR('reg.h.deroul') + '</h3><ul>' +
      li('reg.distribution') + li('reg.remanier') + li('reg.ouverture') +
      li('reg.rienAPoser') + li('reg.gagne') + li('reg.manches') + '</ul>' +
      '<h3>' + TR('reg.h.place') + '</h3><ul>' +
      li('reg.glisser') + li('reg.nouvelle') + li('reg.rangee') + li('reg.clic') +
      li('reg.fusion') + '</ul>' +
      '<h3>' + TR('reg.h.cmd') + '</h3><ul>' +
      li('reg.indices') + li('reg.magique') + li('reg.annuler') + li('reg.refaire') +
      li('reg.memeDonne') + '</ul>' +
      '<h3>' + TR('reg.h.racc') + '</h3><p>' + TR('reg.raccourcis') + '</p>' +
      '<div class="row"><button class="cta" id="closerules" style="flex:1">' +
      TR('btn.fermer') + '</button></div></div>';
    ov.classList.remove('hidden');
    $('#closerules').onclick = function () { ov.classList.add('hidden'); };
  }

  /* Change la langue partout, et l'enregistre. */
  function choisirLangue(code) {
    prefs.langue = code;
    I18N.set(code);
    savePrefs();
    traduirePage();
    if (game) { render(); updateBar(); } else { buildMenu(); }
  }

  /* Applique la langue aux textes figés de la page. */
  function traduirePage() {
    var i, els = document.querySelectorAll('[data-i18n]');
    for (i = 0; i < els.length; i++) els[i].textContent = TR(els[i].dataset.i18n);
    els = document.querySelectorAll('[data-i18n-title]');
    for (i = 0; i < els.length; i++) els[i].title = TR(els[i].dataset.i18nTitle);
    var rt = $('#rotate-t'), rp = $('#rotate-p');
    if (rt) rt.textContent = TR('rotate.titre');
    if (rp) rp.textContent = TR('rotate.texte');
    document.documentElement.lang = I18N.get();
    stampFooter();
  }

  /* ---- Panneau du journal ------------------------------------------ */

  function showJournal() {
    var ov = $('#overlay');
    var txt = journal ? JSON.stringify(journal) : '';
    ov.innerHTML = '<div class="panel"><h2>' + TR('dbg.titre') + '</h2>' +
      (txt
        ? '<p>' + TR('dbg.explication') + '</p>' +
          '<textarea id="jrntxt" class="jrn" readonly></textarea>' +
          '<div class="row"><button class="cta" id="jrncopy" style="flex:1">' +
          TR('dbg.copier') + '</button>' +
          '<button class="btn" id="jrnclose">' + TR('btn.fermer') + '</button></div>'
        : '<p>' + TR('dbg.vide') + '</p>' +
          '<div class="row"><button class="cta" id="jrnclose" style="flex:1">' +
          TR('btn.fermer') + '</button></div>') +
      '</div>';
    ov.classList.remove('hidden');
    if (txt) $('#jrntxt').value = txt;
    if ($('#jrncopy')) {
      $('#jrncopy').onclick = function () {
        var z = $('#jrntxt');
        z.select(); z.setSelectionRange(0, z.value.length);
        try {
          if (navigator.clipboard) navigator.clipboard.writeText(z.value);
          else document.execCommand('copy');
          toast(TR('dbg.copie'));
        } catch (e) { /* la selection reste, a copier a la main */ }
      };
    }
    $('#jrnclose').onclick = function () { ov.classList.add('hidden'); };
  }

  /* ---- Rejeu d'un journal ------------------------------------------- */

  function carteParId(id) {
    var h = game.human().hand, i;
    for (i = 0; i < h.length; i++) if (h[i].id === id) return h[i];
    var bc = game.boardCards();
    for (i = 0; i < bc.length; i++) if (bc[i].id === id) return bc[i];
    return null;
  }

  function attendreHumain(max) {
    var t0 = Date.now();
    return new Promise(function (resolve) {
      (function boucle() {
        if (game.finished || (!busy && game.player().human) || Date.now() - t0 > (max || 8000)) {
          return resolve();
        }
        setTimeout(boucle, 10);
      })();
    });
  }

  function rejouerActe(a) {
    var c, d, t;
    if (a.a === 'pose') {
      c = carteParId(a.carte);
      if (!c) return Promise.resolve('carte introuvable : ' + a.carte);
      d = { card: c, cache: {},
            origin: a.de === 'main' ? { type: 'hand' } : { type: 'set', setId: a.de.slice(4) } };
      t = { kind: a.cible.kind, index: a.cible.index, zone: a.cible.zone };
      if (a.cible.cartes) {
        var vise = null;
        for (var q = 0; q < game.board.length; q++) {
          if (game.board[q].cards.map(function (x) { return x.id; }).join(',') === a.cible.cartes) {
            vise = game.board[q]; break;
          }
        }
        if (!vise) return Promise.resolve('combinaison visée introuvable : ' + a.cible.cartes);
        t.setId = vise.id;
      }
      if (t.kind === 'rearrange' && a.sets) {
        t.sets = a.sets.map(function (ids) { return ids.map(carteParId); });
        for (var k = 0; k < t.sets.length; k++) {
          for (var j = 0; j < t.sets[k].length; j++) {
            if (!t.sets[k][j]) return Promise.resolve('réorganisation : carte introuvable');
          }
        }
      }
      applyDrop(d, t);
      return Promise.resolve(null);
    }
    if (a.a === 'reprise') {
      c = carteParId(a.carte);
      if (!c) return Promise.resolve('carte introuvable : ' + a.carte);
      applyDrop({ card: c, cache: {}, origin: { type: 'set', setId: '' } }, { kind: 'hand' });
      return Promise.resolve(null);
    }
    var boutons = { suivant: doCommit, pioche: doDraw, annule: doUndo,
                    magique: doAuto, tri: doSort, refaire: doRewind };
    if (boutons[a.a]) { boutons[a.a](); return attendreHumain().then(function () { return null; }); }
    return Promise.resolve(null);      // 'ia' : rejoué par la phase des joueurs virtuels
  }

  /* Rejoue un journal et signale le premier écart avec ce qui avait été
     enregistré. Sans écart, la séquence est reproduite à l'identique. */
  /* Un reglage relu de l'exterieur n'est retenu que s'il fait partie des
     valeurs prevues : sinon on garde celui du joueur. */
  function reglageSur(valeur, permises, defaut) {
    return permises.indexOf(valeur) >= 0 ? valeur : defaut;
  }

  function rejouerJournal(txt) {
    var j = typeof txt === 'string' ? JSON.parse(txt) : txt;
    /* Le journal vient d'ailleurs : on ne rejoue que s'il decrit vraiment une
       partie. Une donne incomplete fabriquait des cartes impossibles, et un
       nom libre entrait dans la page. */
    var donne = E.donneValide(j && j.donne);
    if (!donne || !Array.isArray(j.actes)) {
      toast(TR('dbg.journalInvalide'));
      /* Le rejeu normal rend une promesse : le refus aussi, pour que l'appelant
         n'ait pas deux formes de reponse a distinguer. */
      return Promise.resolve({ actes: 0, rejoues: 0, divergences: [{ no: -1,
               acte: 'journal', probleme: TR('dbg.journalInvalide') }] });
    }
    if (j.reglages) {
      var g = j.reglages;
      prefs.tri = reglageSur(g.tri, ['suit', 'rank'], prefs.tri);
      prefs.keepPlaces = typeof g.keepPlaces === 'boolean' ? g.keepPlaces : prefs.keepPlaces;
      prefs.autoArrange = typeof g.autoArrange === 'boolean' ? g.autoArrange : prefs.autoArrange;
      prefs.niveau = reglageSur(g.niveau, ['facile', 'normal', 'difficile'], prefs.niveau);
      prefs.manches = reglageSur(g.manches, [1, 3, 5], prefs.manches);
      prefs.sensSuites = reglageSur(g.sensSuites, ['asc', 'desc'], prefs.sensSuites);
      E.options.sort = prefs.tri;
      E.options.keepPlaces = prefs.keepPlaces;
      E.options.difficulty = prefs.niveau;
    }
    rejeuEnCours = true;
    var garde = prefs.debug;
    prefs.debug = false;               // on ne reecrit pas le journal en le rejouant
    newGame(donne);
    var rapport = [], i = 0;
    function suite() {
      if (i >= j.actes.length || rapport.length) {
        rejeuEnCours = false;
        prefs.debug = garde;
        savePrefs();          // newGame a pu enregistrer le drapeau baissé
        return { actes: j.actes.length, rejoues: i, divergences: rapport };
      }
      var a = j.actes[i];
      if (a.a === 'ia') { i++; return suite(); }   // rejoué par la phase virtuelle
      var sig = jrnSignature();
      if (a.table !== undefined && a.table !== sig) {
        rapport.push({ no: i, acte: a.a, tableAttendue: a.table, tableObtenue: sig });
        return suite();
      }
      return rejouerActe(a).then(function (err) {
        if (err) rapport.push({ no: i, acte: a.a, probleme: err });
        i++;
        return suite();
      });
    }
    return attendreHumain().then(suite);
  }

  /* ================= Branchements ================================= */

  $('#start').onclick = function () { newGame(); };
  $('#replay').onclick = replayDeal;
  $('#resume').onclick = resumeGame;
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
    return window.confirm(TR('toast.abandon'));
  }

  $('#restart').onclick = function () {
    if (game && !game.finished && !confirmQuit()) return;
    $('#overlay').classList.add('hidden');
    $('#game').classList.add('hidden');
    $('#menu').classList.remove('hidden');
  };
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
    /* Les lettres seules commandent le jeu, jamais quand une touche de
       commande les accompagne : Cmd+P imprime, Cmd+T ouvre un onglet, et le
       jeu piochait ou changeait le tri par-dessus — un tour perdu sans
       retour possible pour une frappe qui ne le concernait pas. */
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'Enter') { doCommit(); }
    else if (e.key === 'Backspace') { e.preventDefault(); doUndo(); }
    else if (e.key === 'p' || e.key === 'P') { doDraw(); }
    else if (e.key === 'm' || e.key === 'M') { doAuto(); }
    else if (e.key === 't' || e.key === 'T') { doSort(); }
    else if (e.key === 'r' || e.key === 'R') { doRewind(); }
    else if (e.key === 'i' || e.key === 'I') { toggleHints(); }
  });

  window.addEventListener('resize', function () {
    $('#game').classList.remove('compact');
    if (game) render({ animate: false });
  });

  /* Version et copyright : fournis par l'hôte natif, sinon mode navigateur. */
  /* La version se lit a deux endroits : au pied de l'ecran d'accueil, et dans
     les options — seul endroit atteignable une partie commencee, et le
     premier ou l'on regarde quand on se demande si l'appareil a bien recu la
     derniere correction. Le texte est retenu ici pour que le panneau, rebati
     a chaque ouverture, puisse l'afficher sans tout remesurer. */
  var texteVersion = '';
  var COPYRIGHT = '\u00a9 2026 Richard Boulais & Claude';

  function ecrireVersion(txt) {
    texteVersion = txt;
    var cibles = document.querySelectorAll('#version, .versiontxt'), i;
    for (i = 0; i < cibles.length; i++) cibles[i].textContent = txt;
  }

  function stampFooter() {
    var v = $('#version');
    var c = $('#copyright');
    if (c) c.textContent = '\u00a0\u00b7\u00a0' + COPYRIGHT;
    if (!v) return;
    if (window.APP_BUILD) { ecrireVersion(TR('accueil.versionDu', { d: window.APP_BUILD })); return; }
    /* Hors de l'app macOS, la date de publication fait l'affaire — mais celle
       de la page ne bouge que si index.html change, et une correction portee
       a ui.js passait inapercue : sur l'iPad on croyait tourner sur du neuf
       en lisant une date d'hier. On retient donc la plus recente des dates de
       publication des fichiers du jeu. */
    function ecrire(d) {
      ecrireVersion(isNaN(d.getTime())
        ? TR('accueil.versionDev')
        : TR('accueil.versionDu', { d: ('0' + d.getDate()).slice(-2) + '/' +
            ('0' + (d.getMonth() + 1)).slice(-2) + '/' + d.getFullYear() + ' ' +
            ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2) }));
    }
    var plusRecente = new Date(document.lastModified);
    ecrire(plusRecente);
    if (!window.fetch) return;
    var fichiers = ['index.html', 'i18n.js', 'solver.js', 'engine.js', 'ai.js', 'ui.js', 'style.css'];
    Promise.all(fichiers.map(function (f) {
      return fetch(f, { method: 'HEAD', cache: 'no-store' }).then(function (r) {
        var h = r.headers.get('last-modified');
        return h ? new Date(h) : null;
      }).catch(function () { return null; });
    })).then(function (dates) {
      for (var i = 0; i < dates.length; i++) {
        if (dates[i] && !isNaN(dates[i].getTime()) && dates[i] > plusRecente) plusRecente = dates[i];
      }
      ecrire(plusRecente);
    });
  }

  /* Hors ligne : une fois la page ouverte, le jeu se relance sans réseau.
     Sans objet dans l'app macOS, qui charge ses fichiers en local.
     Quand un nouveau service worker prend la main, la page se recharge une
     fois : sans cela il faudrait recharger deux fois pour voir une mise à
     jour — la première pour installer le nouveau worker, la seconde pour
     en profiter. */
  if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
    var avaitUnControleur = !!navigator.serviceWorker.controller;
    var dejaRecharge = false;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (!avaitUnControleur || dejaRecharge) return;
      dejaRecharge = true;
      location.reload();
    });
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () { /* tant pis */ });
    });
  }

  loadPrefs();
  I18N.set(prefs.langue || I18N.detecter());
  E.options.sort = prefs.tri;
  applyFelt();
  traduirePage();
  stampFooter();
  buildMenu();

  /* Point d'acces utilise par les tests automatises. */
  window.RC = {
    get game() { return game; },
    journal: function () { return journal; },
    rejouer: rejouerJournal,
    showJournal: showJournal,
    set game(g) { game = g; },
    render: render,
    updateBar: updateBar,
    newGame: newGame,
    setVirtual: function (n) { nVirtual = n; },
    forceTouch: function (v) { touchMode = !!v; if (game) render(); },
    isTouch: function () { return touchMode; },
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
