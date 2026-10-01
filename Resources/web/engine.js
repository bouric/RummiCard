/* =====================================================================
   engine.js — Moteur de jeu : cartes, combinaisons, règles Rummikub
   ---------------------------------------------------------------------
   104 cartes = 2 jeux de 52 (4 couleurs x 13 valeurs, 2 exemplaires).
   Les couleurs remplacent les couleurs des tuiles Rummikub :
     0 pique, 1 coeur, 2 carreau, 3 trefle
   Combinaisons valides :
     - GROUPE : 3 ou 4 cartes de meme valeur, toutes de couleurs differentes
     - SUITE  : 3 cartes ou plus de meme couleur, valeurs consecutives
   ===================================================================== */
(function (root) {
  'use strict';

  var SUIT_GLYPH = ['♠', '♥', '♦', '♣'];
  var SUIT_NAME = ['pique', 'coeur', 'carreau', 'trèfle'];
  var RANK_LABEL = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'V', 'D', 'R'];
  var HAND_SIZE = 14;
  var MIN_FIRST_MELD = 30;

  var AI_NAMES = ['Camille', 'Hugo', 'Léa', 'Marin', 'Noa', 'Sacha'];

  function makeDeck() {
    var cards = [];
    for (var copy = 0; copy < 2; copy++) {
      for (var suit = 0; suit < 4; suit++) {
        for (var rank = 1; rank <= 13; rank++) {
          cards.push({
            id: suit + '-' + rank + '-' + copy,
            suit: suit,
            rank: rank,
            copy: copy
          });
        }
      }
    }
    return cards;
  }

  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function label(card) { return RANK_LABEL[card.rank] + SUIT_GLYPH[card.suit]; }

  /* ---- Validation d'une combinaison ------------------------------- */

  function isGroup(cards) {
    if (cards.length < 3 || cards.length > 4) return false;
    var rank = cards[0].rank, seen = 0;
    for (var i = 0; i < cards.length; i++) {
      if (cards[i].rank !== rank) return false;
      var bit = 1 << cards[i].suit;
      if (seen & bit) return false;          // deux fois la meme couleur
      seen |= bit;
    }
    return true;
  }

  function isRun(cards) {
    if (cards.length < 3) return false;
    var suit = cards[0].suit;
    for (var i = 0; i < cards.length; i++) if (cards[i].suit !== suit) return false;
    var ranks = cards.map(function (c) { return c.rank; }).sort(function (a, b) { return a - b; });
    for (var k = 1; k < ranks.length; k++) if (ranks[k] !== ranks[k - 1] + 1) return false;
    return true;
  }

  function isValidSet(cards) { return isGroup(cards) || isRun(cards); }

  /* Peut-on ajouter `card` a la combinaison `cards` ?
     Renvoie l'index d'insertion, ou -1. Accepte les combinaisons
     incompletes (1 ou 2 cartes) en cours de construction.          */
  function acceptIndex(cards, card) {
    if (!cards.length) return 0;
    if (cards.length >= 4 && sameRank(cards)) return -1;

    // --- mode groupe : meme valeur, couleur absente
    if (sameRank(cards) && cards[0].rank === card.rank && cards.length < 4) {
      var used = 0;
      for (var i = 0; i < cards.length; i++) used |= 1 << cards[i].suit;
      if (!(used & (1 << card.suit))) return cards.length;
    }
    // --- mode suite : meme couleur, valeurs consecutives
    if (sameSuit(cards) && cards[0].suit === card.suit) {
      var ranks = cards.map(function (c) { return c.rank; }).sort(function (a, b) { return a - b; });
      var contiguous = true;
      for (var k = 1; k < ranks.length; k++) if (ranks[k] !== ranks[k - 1] + 1) contiguous = false;
      if (contiguous) {
        if (card.rank === ranks[0] - 1) return 0;
        if (card.rank === ranks[ranks.length - 1] + 1) return cards.length;
      }
    }
    return -1;
  }

  function sameRank(cards) {
    for (var i = 1; i < cards.length; i++) if (cards[i].rank !== cards[0].rank) return false;
    return true;
  }
  function sameSuit(cards) {
    for (var i = 1; i < cards.length; i++) if (cards[i].suit !== cards[0].suit) return false;
    return true;
  }

  /* Range les cartes d'une combinaison dans l'ordre d'affichage. */
  function orderSet(cards) {
    var out = cards.slice();
    if (sameSuit(out)) out.sort(function (a, b) { return a.rank - b.rank; });
    else out.sort(function (a, b) { return a.suit - b.suit; });
    return out;
  }

  /* ---- Partie ----------------------------------------------------- */

  var setSeq = 0;

  function Game(nVirtual) {
    this.deck = shuffle(makeDeck());
    this.board = [];
    this.players = [];
    this.current = 0;
    this.finished = false;
    this.winner = null;
    this.passStreak = 0;
    this.turnCount = 0;

    var aiNames = shuffle(AI_NAMES.slice()).slice(0, nVirtual);
    this.players.push({ index: 0, name: 'Vous', human: true, hand: [], melded: false });
    for (var i = 0; i < nVirtual; i++) {
      this.players.push({ index: i + 1, name: aiNames[i], human: false, hand: [], melded: false });
    }
    for (var p = 0; p < this.players.length; p++) {
      for (var k = 0; k < HAND_SIZE; k++) this.players[p].hand.push(this.deck.pop());
    }
    this.sortHand(this.players[0], 'suit');
    this.snapshot = null;
    this.beginTurn();
  }

  Game.prototype.player = function () { return this.players[this.current]; };
  Game.prototype.human = function () { return this.players[0]; };

  Game.prototype.boardCards = function () {
    var out = [];
    for (var i = 0; i < this.board.length; i++) out = out.concat(this.board[i].cards);
    return out;
  };

  Game.prototype.newSet = function (cards) {
    return { id: 's' + (++setSeq), cards: cards || [] };
  };

  Game.prototype.setById = function (id) {
    for (var i = 0; i < this.board.length; i++) if (this.board[i].id === id) return this.board[i];
    return null;
  };

  Game.prototype.sortHand = function (player, mode) {
    player.hand.sort(function (a, b) {
      if (mode === 'rank') return (a.rank - b.rank) || (a.suit - b.suit);
      return (a.suit - b.suit) || (a.rank - b.rank);
    });
  };

  /* Debut de tour : memorise l'etat pour permettre l'annulation. */
  Game.prototype.beginTurn = function () {
    var p = this.player();
    this.snapshot = {
      board: this.board.map(function (s) { return { id: s.id, cards: s.cards.slice() }; }),
      hand: p.hand.slice(),
      melded: p.melded,
      boardIds: {}
    };
    var bc = this.boardCards();
    for (var i = 0; i < bc.length; i++) this.snapshot.boardIds[bc[i].id] = true;
  };

  Game.prototype.restoreTurn = function () {
    if (!this.snapshot) return;
    this.board = this.snapshot.board.map(function (s) { return { id: s.id, cards: s.cards.slice() }; });
    this.player().hand = this.snapshot.hand.slice();
  };

  /* Cartes posees pendant le tour en cours. */
  Game.prototype.stagedCards = function () {
    if (!this.snapshot) return [];
    var ids = this.snapshot.boardIds, out = [], bc = this.boardCards();
    for (var i = 0; i < bc.length; i++) if (!ids[bc[i].id]) out.push(bc[i]);
    return out;
  };

  Game.prototype.stagedPoints = function () {
    var s = this.stagedCards(), t = 0;
    for (var i = 0; i < s.length; i++) t += s[i].rank;
    return t;
  };

  /* Enleve les combinaisons vides. */
  Game.prototype.compact = function () {
    this.board = this.board.filter(function (s) { return s.cards.length > 0; });
  };

  /**
   * Le tour peut-il etre valide ?
   * @returns {{ok: boolean, reason: string}}
   */
  Game.prototype.checkCommit = function () {
    var staged = this.stagedCards();
    if (!staged.length) return { ok: false, reason: 'Posez au moins une carte, ou piochez.' };

    // toutes les cartes initialement sur la table doivent y rester
    var present = {}, bc = this.boardCards(), i;
    for (i = 0; i < bc.length; i++) present[bc[i].id] = true;
    for (var id in this.snapshot.boardIds) {
      if (!present[id]) return { ok: false, reason: 'Les cartes de la table ne peuvent pas rejoindre votre main.' };
    }
    // toutes les combinaisons doivent etre valides
    for (i = 0; i < this.board.length; i++) {
      if (!isValidSet(this.board[i].cards)) {
        return { ok: false, reason: 'Une combinaison est incomplète ou invalide.' };
      }
    }
    // premiere pose : 30 points, sans utiliser les cartes de la table
    if (!this.player().melded) {
      var stagedIds = {};
      for (i = 0; i < staged.length; i++) stagedIds[staged[i].id] = true;
      for (i = 0; i < this.board.length; i++) {
        var cards = this.board[i].cards, hasNew = false, hasOld = false;
        for (var k = 0; k < cards.length; k++) {
          if (stagedIds[cards[k].id]) hasNew = true; else hasOld = true;
        }
        if (hasNew && hasOld) {
          return { ok: false, reason: 'Première pose : vos combinaisons doivent être composées uniquement de vos cartes.' };
        }
      }
      var pts = this.stagedPoints();
      if (pts < MIN_FIRST_MELD) {
        return { ok: false, reason: 'Première pose : ' + MIN_FIRST_MELD + ' points minimum (vous en avez ' + pts + ').' };
      }
    }
    return { ok: true, reason: '' };
  };

  Game.prototype.commit = function () {
    var check = this.checkCommit();
    if (!check.ok) return check;
    var p = this.player();
    p.melded = true;
    this.passStreak = 0;
    this.compact();
    for (var i = 0; i < this.board.length; i++) this.board[i].cards = orderSet(this.board[i].cards);
    if (!p.hand.length) { this.finished = true; this.winner = p; }
    return { ok: true, reason: '' };
  };

  Game.prototype.draw = function () {
    var p = this.player();
    this.restoreTurn();
    if (!this.deck.length) { this.passStreak++; return null; }
    var card = this.deck.pop();
    p.hand.push(card);
    if (p.human) this.sortHand(p, 'suit');
    this.passStreak = 0;
    return card;
  };

  Game.prototype.pass = function () { this.passStreak++; };

  Game.prototype.nextPlayer = function () {
    if (this.finished) return;
    if (this.passStreak >= this.players.length && !this.deck.length) {
      this.finished = true;
      this.winner = this.lowestHand();
      return;
    }
    this.current = (this.current + 1) % this.players.length;
    this.turnCount++;
    this.beginTurn();
  };

  Game.prototype.handScore = function (p) {
    var t = 0;
    for (var i = 0; i < p.hand.length; i++) t += p.hand[i].rank;
    return t;
  };

  Game.prototype.lowestHand = function () {
    var best = this.players[0];
    for (var i = 1; i < this.players.length; i++) {
      if (this.handScore(this.players[i]) < this.handScore(best)) best = this.players[i];
    }
    return best;
  };

  root.Engine = {
    SUIT_GLYPH: SUIT_GLYPH,
    SUIT_NAME: SUIT_NAME,
    RANK_LABEL: RANK_LABEL,
    MIN_FIRST_MELD: MIN_FIRST_MELD,
    HAND_SIZE: HAND_SIZE,
    makeDeck: makeDeck,
    shuffle: shuffle,
    label: label,
    isGroup: isGroup,
    isRun: isRun,
    isValidSet: isValidSet,
    acceptIndex: acceptIndex,
    orderSet: orderSet,
    sameRank: sameRank,
    sameSuit: sameSuit,
    Game: Game
  };
})(typeof window !== 'undefined' ? window : globalThis);
