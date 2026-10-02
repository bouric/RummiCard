/* RummiCard — © 2026 Richard Boulais & Claude */
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

  /* Réglages partagés avec l'interface. */
  var options = { keepPlaces: true, sort: 'suit' };

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

  /* L'As vaut 1 (avant le 2) ou 14 (après le Roi), jamais les deux dans la
     même suite : A-2-3 et D-R-A sont des suites, R-A-2 n'en est pas une. */
  var ACE_HIGH = 14;

  function effRank(card, high) {
    return (high && card.rank === 1) ? ACE_HIGH : card.rank;
  }

  function consecutive(ranks) {
    for (var i = 1; i < ranks.length; i++) if (ranks[i] !== ranks[i - 1] + 1) return false;
    return true;
  }

  function sortedEff(cards, high) {
    var r = [], i;
    for (i = 0; i < cards.length; i++) r.push(effRank(cards[i], high));
    return r.sort(function (a, b) { return a - b; });
  }

  /**
   * Suite d'une combinaison, As bas ou As haut.
   * @returns {?Array<number>} valeurs triées, ou null si ce n'est pas une suite
   */
  function runSeq(cards) {
    if (!cards.length || !sameSuit(cards)) return null;
    var low = sortedEff(cards, false);
    if (consecutive(low)) return low;
    var hasAce = false, i;
    for (i = 0; i < cards.length; i++) if (cards[i].rank === 1) hasAce = true;
    if (!hasAce) return null;
    var high = sortedEff(cards, true);
    return consecutive(high) ? high : null;
  }

  /* Vrai si la combinaison se lit avec l'As après le Roi. */
  function aceHighRun(cards) {
    var seq = runSeq(cards);
    return !!(seq && seq[seq.length - 1] === ACE_HIGH);
  }

  function isRun(cards) {
    return cards.length >= 3 && !!runSeq(cards);
  }

  function isValidSet(cards) { return isGroup(cards) || isRun(cards); }

  /* Pourquoi une combinaison n'est-elle pas valide ? Formulé pour le joueur. */
  function whyInvalid(cards) {
    if (cards.length < 3) {
      return 'il manque ' + (3 - cards.length) + ' carte' +
        (3 - cards.length > 1 ? 's' : '') + ' (3 minimum)';
    }
    if (sameRank(cards)) {
      var seen = 0, i;
      for (i = 0; i < cards.length; i++) {
        if (seen & (1 << cards[i].suit)) {
          return 'un groupe ne peut pas contenir deux ' + SUIT_GLYPH[cards[i].suit];
        }
        seen |= 1 << cards[i].suit;
      }
      return 'un groupe compte au plus 4 cartes';
    }
    if (sameSuit(cards)) {
      var high = false, hasAce = false, hasHigh = false, k;
      for (k = 0; k < cards.length; k++) {
        if (cards[k].rank === 1) hasAce = true;
        if (cards[k].rank >= 11) hasHigh = true;
      }
      high = hasAce && hasHigh;
      var r = sortedEff(cards, high), manque = [];
      for (k = 1; k < r.length; k++) {
        if (r[k] === r[k - 1]) return 'deux fois la même carte dans une suite';
        for (var v = r[k - 1] + 1; v < r[k]; v++) {
          manque.push(RANK_LABEL[v === ACE_HIGH ? 1 : v] + SUIT_GLYPH[cards[0].suit]);
        }
      }
      if (manque.length > 2) return 'ses valeurs ne se suivent pas';
      if (manque.length) {
        return 'il manque ' + manque.join(' et ') + ' pour que la suite se tienne';
      }
    }
    return 'ni une suite ni un groupe';
  }

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
    // --- mode suite : meme couleur, valeurs consecutives, As bas ou haut
    if (sameSuit(cards) && cards[0].suit === card.suit) {
      for (var h = 0; h < 2; h++) {
        var high = h === 1;
        var ranks = sortedEff(cards, high);
        if (!consecutive(ranks)) continue;
        var cr = effRank(card, high);
        if (cr === ranks[0] - 1) return 0;
        if (cr === ranks[ranks.length - 1] + 1) return cards.length;
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

  /* Range les cartes d'une combinaison dans l'ordre d'affichage : dans une
     suite As haut, l'As se place après le Roi. */
  function orderSet(cards) {
    var out = cards.slice();
    if (sameSuit(out)) {
      var high = aceHighRun(out);
      out.sort(function (a, b) { return effRank(a, high) - effRank(b, high); });
    } else {
      out.sort(function (a, b) { return a.suit - b.suit; });
    }
    return out;
  }

  /* ---- Partie ----------------------------------------------------- */

  var setSeq = 0;

  /**
   * Reconstruit la table à partir d'une nouvelle répartition des cartes.
   * Si options.keepPlaces est vrai, chaque nouvelle combinaison reprend la
   * place (et l'identifiant) de celle avec laquelle elle partage le plus de
   * cartes : la table ne se remélange pas sous les yeux du joueur.
   * @param {Array} oldSets combinaisons actuelles
   * @param {Array<Array>} newSets nouvelles combinaisons (listes de cartes)
   * @returns {Array} nouvelle table
   */
  function alignBoard(oldSets, newSets) {
    var i, j, k;
    if (!options.keepPlaces) {
      return newSets.map(function (cards) {
        return { id: 's' + (++setSeq), cards: orderSet(cards) };
      });
    }
    var scored = [];
    for (i = 0; i < oldSets.length; i++) {
      var ids = {};
      for (k = 0; k < oldSets[i].cards.length; k++) ids[oldSets[i].cards[k].id] = true;
      for (j = 0; j < newSets.length; j++) {
        var n = 0;
        for (var m = 0; m < newSets[j].length; m++) if (ids[newSets[j][m].id]) n++;
        if (n) scored.push({ o: i, n: j, score: n });
      }
    }
    scored.sort(function (a, b) { return b.score - a.score; });

    var pairs = {}, takenOld = {}, takenNew = {};
    for (k = 0; k < scored.length; k++) {
      if (takenOld[scored[k].o] || takenNew[scored[k].n]) continue;
      takenOld[scored[k].o] = true;
      takenNew[scored[k].n] = true;
      pairs[scored[k].o] = scored[k].n;
    }
    var out = [];
    for (i = 0; i < oldSets.length; i++) {
      if (pairs[i] !== undefined) {
        out.push({ id: oldSets[i].id, cards: orderSet(newSets[pairs[i]]) });
      }
    }
    for (j = 0; j < newSets.length; j++) {
      if (!takenNew[j]) out.push({ id: 's' + (++setSeq), cards: orderSet(newSets[j]) });
    }
    return out;
  }

  /* Reconstitue une carte à partir de son identifiant « couleur-valeur-ex ». */
  function cardFromId(id) {
    var p = id.split('-');
    return { id: id, suit: +p[0], rank: +p[1], copy: +p[2] };
  }

  /**
   * @param {number} nVirtual nombre de joueurs virtuels
   * @param {Object} [deal] donne à rejouer : { order: [identifiants], names: [...] }
   */
  function Game(nVirtual, deal) {
    this.deck = deal && deal.order && deal.order.length === 104
      ? deal.order.map(cardFromId)
      : shuffle(makeDeck());
    this.board = [];
    this.players = [];
    this.current = 0;
    this.finished = false;
    this.winner = null;
    this.passStreak = 0;
    this.turnCount = 0;

    // La donne, mémorisée avant distribution : de quoi la rejouer à l'identique.
    this.deal = { n: nVirtual, order: this.deck.map(function (c) { return c.id; }), names: null };
    var aiNames = deal && deal.names && deal.names.length === nVirtual
      ? deal.names.slice()
      : shuffle(AI_NAMES.slice()).slice(0, nVirtual);
    this.deal.names = aiNames.slice();
    this.players.push({ index: 0, name: 'Vous', human: true, hand: [], melded: false });
    for (var i = 0; i < nVirtual; i++) {
      this.players.push({ index: i + 1, name: aiNames[i], human: false, hand: [], melded: false });
    }
    for (var p = 0; p < this.players.length; p++) {
      for (var k = 0; k < HAND_SIZE; k++) this.players[p].hand.push(this.deck.pop());
    }
    this.sortHand(this.players[0], options.sort);
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
        var bad = this.board[i].cards;
        return {
          ok: false,
          reason: bad.map(label).join(' ') + ' : ' + whyInvalid(bad) + '.'
        };
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
    if (p.human) this.sortHand(p, options.sort);
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

  /* ---- Historique : photographie complète d'une partie ----------- */

  Game.prototype.captureState = function () {
    return {
      board: this.board.map(function (s) { return { id: s.id, cards: s.cards.slice() }; }),
      hands: this.players.map(function (p) { return p.hand.slice(); }),
      melded: this.players.map(function (p) { return p.melded; }),
      deck: this.deck.slice(),
      current: this.current,
      passStreak: this.passStreak,
      turnCount: this.turnCount,
      finished: this.finished,
      winner: this.winner ? this.winner.index : -1
    };
  };

  Game.prototype.applyState = function (st) {
    this.board = st.board.map(function (s) { return { id: s.id, cards: s.cards.slice() }; });
    for (var i = 0; i < this.players.length; i++) {
      this.players[i].hand = st.hands[i].slice();
      this.players[i].melded = st.melded[i];
    }
    this.deck = st.deck.slice();
    this.current = st.current;
    this.passStreak = st.passStreak;
    this.turnCount = st.turnCount;
    this.finished = st.finished;
    this.winner = st.winner >= 0 ? this.players[st.winner] : null;
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
    HAND_SIZE: HAND_SIZE,
    options: options,
    alignBoard: alignBoard,
    makeDeck: makeDeck,
    shuffle: shuffle,
    label: label,
    isGroup: isGroup,
    isRun: isRun,
    runSeq: runSeq,
    aceHighRun: aceHighRun,
    effRank: effRank,
    ACE_HIGH: ACE_HIGH,
    isValidSet: isValidSet,
    whyInvalid: whyInvalid,
    acceptIndex: acceptIndex,
    orderSet: orderSet,
    sameRank: sameRank,
    sameSuit: sameSuit,
    Game: Game
  };
})(typeof window !== 'undefined' ? window : globalThis);
