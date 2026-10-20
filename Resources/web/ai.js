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


  /* ---- Reduction du champ de recherche -----------------------------
     Le solveur est exact, et son cout grimpe avec le volume de la main :
     mesure sur une table de 57 cartes, 50 ms pour 20 cartes en main,
     790 ms pour 34 — et les indices relancent ce calcul a chaque repeint.
     On ne lui presente donc pas toujours la main entiere.

     Premier tri, qui ne perd rien : toutes les cartes que le solveur peut
     voir sont la, table et main reunies. Une carte qui n'a ni trois rangs
     consecutifs disponibles dans sa couleur, ni deux comparses de son rang
     dans d'autres couleurs, n'entre dans aucune combinaison valide — ni
     telle quelle, ni apres le plus grand des remaniements. L'ecarter ne
     change pas le resultat, et fait gagner du temps a chaque appel.

     Second tri, seulement si la main reste trop fournie : on garde les
     mieux entourees, les plus fortes d'abord. La, l'indice devient moins
     ambitieux — il reste juste, il n'est plus forcement le meilleur. Mieux
     vaut un bon coup tout de suite qu'un coup parfait une seconde plus
     tard. Les cartes imposees par l'appelant ne sont jamais ecartees.

     Le plafond depend aussi de la table, parce que le cout depend des deux.
     Mesure sur ce Mac, en millisecondes, pour une recherche a l'objectif
     « points » :

         table \ main      14     18     22     26     30
              46            3      4      6      8     18
              50            3      5     15     27    170
              60           11     23     48    235    339

     D'ou les deux seuils ci-dessous : vingt-deux cartes d'ordinaire,
     dix-huit quand la table en porte plus de cinquante. En jeu normal la
     main en compte quatorze et rien n'est ecarte. */
  var POOL_MAX = 22;
  var POOL_MAX_DENSE = 18;
  var TABLE_DENSE = 50;

  function reduirePool(board, pool, mustUse) {
    var i, j, c;

    /* Combien d'exemplaires de chaque couleur et de chaque rang, table et
       main confondues. L'As y compte deux fois, en 1 et en 14 : il peut
       ouvrir une suite comme suivre le Roi. */
    var vus = [];
    for (i = 0; i < 4; i++) vus.push([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    function compter(cs) {
      for (var k = 0; k < cs.length; k++) {
        vus[cs[k].suit][cs[k].rank]++;
        if (cs[k].rank === 1) vus[cs[k].suit][14]++;
      }
    }
    compter(board);
    compter(pool);
    function dispo(s, n) { return n >= 1 && n <= 14 ? vus[s][n] : 0; }

    /* Une suite de trois rangs consecutifs qui la contienne, ou un groupe
       de trois couleurs a son rang : faute des deux, la carte est injouable. */
    function utile(s, p) {
      var d, comparses = 0, o;
      for (d = p - 2; d <= p; d++) {
        if (d < 1 || d + 2 > 14) continue;
        if (dispo(s, d) && dispo(s, d + 1) && dispo(s, d + 2)) return true;
      }
      for (o = 0; o < 4; o++) if (o !== s && dispo(o, p)) comparses++;
      return comparses >= 2;
    }

    /* Ses partenaires possibles : les voisines de sa couleur, les comparses
       de son rang. C'est ce qui departage quand il faut plafonner. */
    function entourage(s, p) {
      var n = dispo(s, p - 2) + dispo(s, p - 1) + dispo(s, p + 1) + dispo(s, p + 2);
      for (var o = 0; o < 4; o++) if (o !== s && dispo(o, p)) n++;
      return n;
    }

    var impose = Object.create(null), nImposees = 0;
    for (i = 0; i < (mustUse || []).length; i++) {
      if (!impose[mustUse[i].id]) nImposees++;
      impose[mustUse[i].id] = true;
    }

    var gardees = [];
    for (i = 0; i < pool.length; i++) {
      c = pool[i];
      var places = c.rank === 1 ? [1, 14] : [c.rank];   // l'As a deux places
      var forcee = !!impose[c.id], bonne = forcee, mieuxEntouree = -1;
      for (j = 0; j < places.length; j++) {
        if (!bonne && utile(c.suit, places[j])) bonne = true;
        var e = entourage(c.suit, places[j]);
        if (e > mieuxEntouree) mieuxEntouree = e;
      }
      if (bonne) {
        gardees.push({ carte: c, forcee: forcee, entouree: mieuxEntouree,
                       points: Engine.valeur(c) });
      }
    }

    var plafond = Math.max(board.length > TABLE_DENSE ? POOL_MAX_DENSE : POOL_MAX,
                           nImposees);
    if (gardees.length > plafond) {
      gardees.sort(function (a, b) {
        if (a.forcee !== b.forcee) return a.forcee ? -1 : 1;
        if (a.entouree !== b.entouree) return b.entouree - a.entouree;
        return b.points - a.points;
      });
      gardees.length = plafond;
    }
    return gardees.map(function (g) { return g.carte; });
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
    pool = reduirePool(board, pool, forced);
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
    reduirePool: reduirePool,
    findBestPlay: findBestPlay,
    applyPlay: applyPlay,
    playAITurn: playAITurn,
    fitCard: fitCard
  };
})(typeof window !== 'undefined' ? window : globalThis);
