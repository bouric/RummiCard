/* RummiCard — © 2026 Richard Boulais & Claude */
/* =====================================================================
   ai.js — Joueurs virtuels + assistance de placement pour le joueur
   Tout repose sur Solver.solve (partition exacte de la table).
   ===================================================================== */
(function (root) {
  'use strict';

  var Engine = root.Engine, Solver = root.Solver;

  function hasRun(sets) {
    for (var i = 0; i < sets.length; i++) if (Engine.isRun(sets[i])) return true;
    return false;
  }

  /* Suites de trois cartes réalisables avec une main : candidates pour
     l'ouverture, As compté 1 ou 14. */
  function candidateRuns(cards) {
    var par = {}, out = [], i, s, start, k;
    for (i = 0; i < cards.length; i++) par[cards[i].suit + ':' + cards[i].rank] = cards[i];
    for (s = 0; s < 4; s++) {
      for (start = 1; start <= 12; start++) {
        var trio = [];
        for (k = 0; k < 3; k++) {
          var v = start + k;
          var c = par[s + ':' + (v === 14 ? 1 : v)];
          if (!c) break;
          trio.push(c);
        }
        if (trio.length === 3) out.push(trio);
      }
    }
    return out;
  }

  /**
   * Meilleure répartition de la table : le maximum de cartes posées, en
   * respectant la règle d'ouverture — sur une table vide, la partie doit
   * commencer par une suite.
   */
  function mieux(a, b) {
    /* Aux points d'abord, au nombre de cartes ensuite : poser deux As rapporte
       plus que trois petites cartes, et c'est bien ce qu'on cherche. */
    if (!b) return true;
    if (a.points !== b.points) return a.points > b.points;
    return a.count > b.count;
  }

  function bestPartition(board, pool, mustUse, opening) {
    var forced = mustUse || [];
    if (opening === undefined) opening = board.length === 0;
    var r = Solver.solve(board, pool, { objective: 'sum', mustUse: forced });
    if (!opening || !r || !r.count || hasRun(r.sets)) return r;

    // Le meilleur coup n'ouvre que des groupes : on impose une suite.
    var cands = candidateRuns(pool), best = null;
    for (var i = 0; i < cands.length; i++) {
      var alt = Solver.solve(board, pool, { objective: 'sum', mustUse: forced.concat(cands[i]) });
      if (alt && alt.count && hasRun(alt.sets) && mieux(alt, best)) best = alt;
    }
    return best;
  }

  /**
   * Cherche le meilleur coup pour un joueur.
   * @param {Game} game
   * @param {Object} player
   * @param {Array} [mustUse] cartes de la main a placer obligatoirement
   * @returns {?{sets: Array, played: Array, points: number, rebuild: boolean}}
   */
  function findBestPlay(game, player, mustUse, level) {
    var hand = player.hand;
    if (!hand.length) return null;
    if (level === 'facile') return simplePlay(game, player);
    if (level === 'normal') {
      var simple = simplePlay(game, player);
      if (simple) return simple;          // sinon seulement, il réfléchit
    }

    var board = game.boardCards();
    var r = bestPartition(board, hand, mustUse);
    if (!r || !r.count) return null;
    return { sets: r.sets, played: r.played, points: r.points, rebuild: true };
  }

  /* ---- Niveaux des joueurs virtuels -------------------------------
     facile    : ne touche jamais à l'agencement de la table ; se contente
                 des ajouts directs et de ses propres combinaisons.
     normal    : joue au plus simple et ne réorganise la table que lorsqu'il
                 ne trouve rien autrement — comme un joueur qui ne se creuse
                 la tête qu'en cas de blocage.
     difficile : le solveur complet, sans concession.
     Les trois sont déterministes : une même donne rejouée se déroule à
     l'identique. */

  /* Coup du niveau facile : on complète ce qui se complète, puis on pose ce
     qu'on peut former seul. La table garde son agencement. */
  function simplePlay(game, player) {
    var vide = game.boardCards().length === 0;
    var board = game.board.map(function (s) { return s.cards.slice(); });
    var hand = player.hand.slice(), played = [], i, k, encore = true;

    while (encore && !vide) {
      encore = false;
      for (i = 0; i < hand.length && !encore; i++) {
        for (k = 0; k < board.length; k++) {
          if (Engine.acceptIndex(board[k], hand[i]) < 0) continue;
          if (!Engine.isValidSet(board[k].concat([hand[i]]))) continue;
          board[k] = Engine.orderSet(board[k].concat([hand[i]]));
          played.push(hand[i]);
          hand.splice(i, 1);
          encore = true;
          break;
        }
      }
    }

    var neuf = bestPartition([], hand, null, vide);
    if (neuf && neuf.count) {
      for (i = 0; i < neuf.sets.length; i++) board.push(neuf.sets[i]);
      played = played.concat(neuf.played);
    }
    if (!played.length) return null;
    var pts = 0;
    for (i = 0; i < played.length; i++) pts += Engine.valeur(played[i]);
    return { sets: board, played: played, points: pts, rebuild: true };
  }

  /**
   * Applique un coup : remplace la table et retire les cartes de la main.
   */
  function applyPlay(game, player, play) {
    var playedIds = {};
    for (var i = 0; i < play.played.length; i++) playedIds[play.played[i].id] = true;
    player.hand = player.hand.filter(function (c) { return !playedIds[c.id]; });

    if (play.rebuild) {
      game.board = Engine.alignBoard(game.board, play.sets);
    } else {
      for (var k = 0; k < play.sets.length; k++) {
        game.board.push(game.newSet(Engine.orderSet(play.sets[k])));
      }
    }
    game.compact();
  }

  /**
   * Tour complet d'un joueur virtuel.
   * @returns {{kind: 'play'|'draw'|'pass', played: number, points: number, drawn: ?Object}}
   */
  function playAITurn(game) {
    var player = game.player();
    var play = findBestPlay(game, player, null, Engine.options.difficulty);
    if (play) {
      applyPlay(game, player, play);
      player.melded = true;
      game.passStreak = 0;
      if (!player.hand.length) { game.finished = true; game.winner = player; }
      return { kind: 'play', played: play.played.length, cards: play.played,
               points: play.points, drawn: null };
    }
    var card = game.draw();
    return { kind: card ? 'draw' : 'pass', played: 0, cards: [], points: 0, drawn: card };
  }

  /* ---- Assistance pour le joueur humain --------------------------- */

  /**
   * Tente de reorganiser la table pour y intégrer `card`
   * (toutes les cartes deja posees restent en jeu).
   * @returns {?Array<Array>} nouvelle liste de combinaisons
   */
  function fitCard(game, card) {
    var board = game.boardCards();
    if (!board.length) return null;
    var r = Solver.solve(board, [card], { objective: 'count', mustUse: [card] });
    if (!r || !r.count) return null;
    return r.sets;
  }

  root.AI = {
    bestPartition: bestPartition,
    findBestPlay: findBestPlay,
    applyPlay: applyPlay,
    playAITurn: playAITurn,
    fitCard: fitCard
  };
})(typeof window !== 'undefined' ? window : globalThis);
