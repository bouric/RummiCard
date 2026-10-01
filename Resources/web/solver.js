/* =====================================================================
   solver.js — Solveur Rummikub exact (programmation dynamique)
   ---------------------------------------------------------------------
   Problème résolu : étant donné
     - tableCards : les cartes posées sur la table (TOUTES doivent être
       réutilisées, mais on peut les réorganiser librement),
     - handCards  : les cartes de la main (optionnelles),
   trouver une partition de (tableCards + un sous-ensemble de handCards)
   en combinaisons valides (suites et groupes) qui maximise soit le
   nombre de cartes de la main posées, soit leur somme de points.

   Méthode : DP sur les valeurs 1..13. L'état décrit, pour chaque
   couleur, le nombre de suites en cours qui se terminent à la valeur
   precedente :
       a  = suites de longueur exactement 1  (doivent être prolongées)
       b  = suites de longueur exactement 2  (doivent être prolongées)
       c3 = suites de longueur >= 3          (prolongeables au choix)
   Comme il y a au plus 2 exemplaires de chaque carte (2 jeux de 52),
   on a toujours a + b + c3 <= 2, ce qui borne l'espace d'états.
   ===================================================================== */
(function (root) {
  'use strict';

  var NEG = -Infinity;

  /* Masques des groupes possibles : sous-ensembles de 3 ou 4 couleurs. */
  var GROUP_MASKS = [0x7, 0xB, 0xD, 0xE, 0xF];

  /* Configurations de groupes formables sur une même valeur :
     aucun groupe, un groupe, ou deux groupes (2 jeux de cartes). */
  var GROUP_CONFIGS = (function () {
    var out = [];
    function add(masks) {
      var g = [0, 0, 0, 0], i, c;
      for (i = 0; i < masks.length; i++) {
        for (c = 0; c < 4; c++) if (masks[i] & (1 << c)) g[c]++;
      }
      for (c = 0; c < 4; c++) if (g[c] > 2) return;   // max 2 cartes identiques
      out.push({ masks: masks, g: g, total: masks.length });
    }
    add([]);
    for (var i = 0; i < GROUP_MASKS.length; i++) add([GROUP_MASKS[i]]);
    for (var j = 0; j < GROUP_MASKS.length; j++) {
      for (var k = j; k < GROUP_MASKS.length; k++) add([GROUP_MASKS[j], GROUP_MASKS[k]]);
    }
    return out;
  })();

  function emptyCounts() {
    var a = [];
    for (var s = 0; s < 4; s++) {
      a.push([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    }
    return a;
  }

  /**
   * Résout la table.
   * @param {Array} tableCards cartes imposées (toutes utilisées)
   * @param {Array} handCards  cartes disponibles (facultatives)
   * @param {Object} [opts] { objective: 'count' | 'sum', mustUse: [cartes de la main obligatoires] }
   * @returns {?{sets: Array<Array>, played: Array, count: number, points: number}}
   */
  function solve(tableCards, handCards, opts) {
    opts = opts || {};
    var objective = opts.objective === 'sum' ? 'sum' : 'count';
    var mustUse = opts.mustUse || [];

    // Les cartes « mustUse » sont traitées comme des cartes de table
    // (obligatoirement placées) tout en comptant comme cartes jouées.
    var forced = Object.create(null);
    for (var m = 0; m < mustUse.length; m++) forced[mustUse[m].id] = true;

    var table = emptyCounts();   // cartes obligatoires
    var hand = emptyCounts();    // cartes optionnelles
    var pool = [];               // pool[suit][rank] = cartes, obligatoires d'abord
    for (var s = 0; s < 4; s++) {
      pool.push([]);
      for (var r = 0; r <= 13; r++) pool[s].push([]);
    }

    var i, card;
    for (i = 0; i < tableCards.length; i++) {
      card = tableCards[i];
      table[card.suit][card.rank]++;
      pool[card.suit][card.rank].unshift(card);
    }
    for (i = 0; i < handCards.length; i++) {
      card = handCards[i];
      if (forced[card.id]) {
        table[card.suit][card.rank]++;
        pool[card.suit][card.rank].unshift(card);
      } else {
        hand[card.suit][card.rank]++;
        pool[card.suit][card.rank].push(card);
      }
    }
    // Marque les cartes « jouées » : tout ce qui ne vient pas de la table.
    var fromHand = Object.create(null);
    for (i = 0; i < handCards.length; i++) fromHand[handCards[i].id] = true;

    var memo = new Map();

    function valueOfCard(rank) {
      return objective === 'sum' ? rank * 1000 + 1 : 1000 + rank;
    }

    /* ---- DP ------------------------------------------------------- */
    function rec(n, st) {
      if (n === 14) {
        for (var c = 0; c < 4; c++) {
          if (st[3 * c] !== 0 || st[3 * c + 1] !== 0) return { val: NEG };
        }
        return { val: 0 };
      }
      var key = n * 20000000 + encode(st);
      var hit = memo.get(key);
      if (hit !== undefined) return hit;

      var best = { val: NEG };
      var next = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
      var choice = [null, null, null, null];

      for (var ci = 0; ci < GROUP_CONFIGS.length; ci++) {
        var cfg = GROUP_CONFIGS[ci];
        var feasible = true;
        for (var c = 0; c < 4; c++) {
          var avail = table[c][n] + hand[c][n];
          if (st[3 * c] + st[3 * c + 1] + cfg.g[c] > avail) { feasible = false; break; }
        }
        if (!feasible) continue;
        walk(0, 0, cfg);
      }

      function walk(c, gain, cfg) {
        if (c === 4) {
          var sub = rec(n + 1, next);
          if (sub.val === NEG) return;
          var total = gain + sub.val;
          if (total > best.val) {
            best = {
              val: total,
              cfg: cfg,
              per: [choice[0], choice[1], choice[2], choice[3]],
              next: next.slice()
            };
          }
          return;
        }
        var a = st[3 * c], b = st[3 * c + 1], c3 = st[3 * c + 2];
        var base = a + b, g = cfg.g[c];
        var tbl = table[c][n], avail = tbl + hand[c][n];
        for (var e3 = 0; e3 <= c3; e3++) {
          for (var ns = 0; base + g + e3 + ns <= avail; ns++) {
            var used = base + g + e3 + ns;
            if (used < tbl) continue;           // toutes les cartes de table doivent servir
            var hu = used - tbl;
            next[3 * c] = ns;
            next[3 * c + 1] = a;
            next[3 * c + 2] = b + e3;
            choice[c] = { e3: e3, ns: ns, g: g, used: used };
            walk(c + 1, gain + hu * valueOfCard(n), cfg);
          }
        }
        choice[c] = null;
      }

      memo.set(key, best);
      return best;
    }

    function encode(st) {
      var v = 0;
      for (var i2 = 0; i2 < 12; i2++) v = v * 4 + st[i2];
      return v;
    }

    var start = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    var res = rec(1, start);
    if (res.val === NEG) return null;

    /* ---- Reconstruction ------------------------------------------ */
    var cursor = [];              // index de consommation dans chaque pool
    for (var s2 = 0; s2 < 4; s2++) {
      cursor.push([]);
      for (var r2 = 0; r2 <= 13; r2++) cursor[s2].push(0);
    }
    function take(suit, rank) {
      var list = pool[suit][rank];
      var idx = cursor[suit][rank]++;
      return list[idx];
    }

    var runs1 = [[], [], [], []];   // suites de longueur 1 (tableaux de cartes)
    var runs2 = [[], [], [], []];
    var runs3 = [[], [], [], []];
    var sets = [];
    var st2 = start;

    for (var n2 = 1; n2 <= 13; n2++) {
      var entry = memo.get(n2 * 20000000 + encode(st2));
      var cfg2 = entry.cfg, per = entry.per;
      var groupQueue = [[], [], [], []];

      for (var c2 = 0; c2 < 4; c2++) {
        var ch = per[c2];
        var newRuns1 = [], newRuns2 = [], newRuns3 = [];

        // prolonge les suites de longueur 1 -> 2
        for (var q = 0; q < runs1[c2].length; q++) {
          var run = runs1[c2][q];
          run.push(take(c2, n2));
          newRuns2.push(run);
        }
        // prolonge les suites de longueur 2 -> 3
        for (q = 0; q < runs2[c2].length; q++) {
          run = runs2[c2][q];
          run.push(take(c2, n2));
          newRuns3.push(run);
        }
        // prolonge ch.e3 suites deja completes, ferme les autres
        for (q = 0; q < runs3[c2].length; q++) {
          run = runs3[c2][q];
          if (q < ch.e3) { run.push(take(c2, n2)); newRuns3.push(run); }
          else sets.push(run);
        }
        // demarre ch.ns nouvelles suites
        for (q = 0; q < ch.ns; q++) newRuns1.push([take(c2, n2)]);
        // reserve les cartes destinees aux groupes
        for (q = 0; q < ch.g; q++) groupQueue[c2].push(take(c2, n2));

        runs1[c2] = newRuns1; runs2[c2] = newRuns2; runs3[c2] = newRuns3;
      }

      for (var gi = 0; gi < cfg2.masks.length; gi++) {
        var mask = cfg2.masks[gi], group = [];
        for (var c3i = 0; c3i < 4; c3i++) {
          if (mask & (1 << c3i)) group.push(groupQueue[c3i].shift());
        }
        sets.push(group);
      }
      st2 = entry.next;
    }
    for (var c4 = 0; c4 < 4; c4++) {
      for (var z = 0; z < runs3[c4].length; z++) sets.push(runs3[c4][z]);
    }

    // Cartes de la main effectivement posées
    var placed = [], points = 0;
    for (var si = 0; si < sets.length; si++) {
      for (var k2 = 0; k2 < sets[si].length; k2++) {
        var cd = sets[si][k2];
        if (fromHand[cd.id]) { placed.push(cd); points += cd.rank; }
      }
    }
    return { sets: sets, played: placed, count: placed.length, points: points };
  }

  root.Solver = { solve: solve, GROUP_CONFIGS: GROUP_CONFIGS };
})(typeof window !== 'undefined' ? window : globalThis);
