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
  function bestPartition(board, pool, mustUse) {
    var forced = mustUse || [];
    var r = Solver.solve(board, pool, { objective: 'count', mustUse: forced });
    if (board.length || !r || !r.count || hasRun(r.sets)) return r;

    // Le meilleur coup n'ouvre que des groupes : on impose une suite.
    var cands = candidateRuns(pool), best = null;
    for (var i = 0; i < cands.length; i++) {
      var alt = Solver.solve(board, pool, { objective: 'count', mustUse: forced.concat(cands[i]) });
      if (alt && alt.count && hasRun(alt.sets) && (!best || alt.count > best.count)) best = alt;
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
  function findBestPlay(game, player, mustUse) {
    var hand = player.hand;
    if (!hand.length) return null;

    var board = game.boardCards();
    var r = bestPartition(board, hand, mustUse);
    if (!r || !r.count) return null;
    return { sets: r.sets, played: r.played, points: r.points, rebuild: true };
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
    var play = findBestPlay(game, player, null);
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
