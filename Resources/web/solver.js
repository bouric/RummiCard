/* RummiCard — © 2026 Richard Boulais & Claude */
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
      a.push([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    }
    return a;
  }

  /**
   * Résout la table.
   *
   * L'As vaut 1 ou 14 (après le Roi). Comme les deux emplacements se
   * disputent les mêmes cartes, on énumère, pour chaque couleur, le nombre
   * d'As placés après le Roi (0, 1 ou 2) et on garde la meilleure partition.
   * Les couleurs sans Dame ni Roi disponibles sont écartées d'office.
   *
   * @param {Array} tableCards cartes imposées (toutes utilisées)
   * @param {Array} handCards  cartes disponibles (facultatives)
   * @param {Object} [opts] { objective: 'count' | 'sum', mustUse: [cartes de la main obligatoires] }
   * @returns {?{sets: Array<Array>, played: Array, count: number, points: number}}
   */
  function solve(tableCards, handCards, opts) {
    opts = opts || {};
    var objective = opts.objective === 'sum' ? 'sum' : 'count';
    var mustUse = opts.mustUse || [];

    var forced = Object.create(null), i;
    for (i = 0; i < mustUse.length; i++) forced[mustUse[i].id] = true;
    var fromHand = Object.create(null);
    for (i = 0; i < handCards.length; i++) fromHand[handCards[i].id] = true;

    // Cartes rangées par couleur et valeur, obligatoires d'abord.
    var slots = [];
    for (var s0 = 0; s0 < 4; s0++) {
      slots.push([]);
      for (var r0 = 0; r0 <= 14; r0++) slots[s0].push({ must: [], free: [] });
    }
    for (i = 0; i < tableCards.length; i++) {
      slots[tableCards[i].suit][tableCards[i].rank].must.push(tableCards[i]);
    }
    for (i = 0; i < handCards.length; i++) {
      var c = handCards[i];
      if (forced[c.id]) slots[c.suit][c.rank].must.push(c);
      else slots[c.suit][c.rank].free.push(c);
    }

    // Combien d'As peuvent passer après le Roi, couleur par couleur ?
    var maxHigh = [];
    for (var sc = 0; sc < 4; sc++) {
      var hasQ = slots[sc][12].must.length + slots[sc][12].free.length > 0;
      var hasK = slots[sc][13].must.length + slots[sc][13].free.length > 0;
      var aces = slots[sc][1].must.length + slots[sc][1].free.length;
      maxHigh.push(hasQ && hasK ? Math.min(2, aces) : 0);
    }

    // On compare les variantes sur leur résultat réel : la valeur interne de
    // la programmation dynamique ne compte pas les cartes imposées.
    var best = null, done = false;
    var k = [0, 0, 0, 0];
    for (k[0] = 0; k[0] <= maxHigh[0] && !done; k[0]++) {
      for (k[1] = 0; k[1] <= maxHigh[1] && !done; k[1]++) {
        for (k[2] = 0; k[2] <= maxHigh[2] && !done; k[2]++) {
          for (k[3] = 0; k[3] <= maxHigh[3] && !done; k[3]++) {
            var res = attempt(slots, k, objective, fromHand);
            if (res) {
              res.score = objective === 'sum'
                ? res.points * 10000 + res.count
                : res.count * 10000 + res.points;
              if (!best || res.score > best.score) best = res;
              // Toute la main posée : aucune variante ne fera mieux.
              if (objective === 'count' && res.count === handCards.length) done = true;
            }
          }
        }
      }
    }
    return best;
  }

  /* Résout avec une répartition fixée des As hauts. */
  function attempt(slots, high, objective, fromHand) {
    var table = emptyCounts(), hand = emptyCounts(), pool = [];
    var s, r, i;
    for (s = 0; s < 4; s++) {
      pool.push([]);
      for (r = 0; r <= 14; r++) pool[s].push([]);
    }
    for (s = 0; s < 4; s++) {
      for (r = 1; r <= 13; r++) {
        var slot = slots[s][r];
        if (r === 1 && high[s]) {
          // Les As hauts sont pris parmi les cartes imposées en priorité :
          // une carte de la main est interchangeable avec une carte de table.
          var all = slot.must.concat(slot.free);
          var up = all.slice(0, high[s]), down = all.slice(high[s]);
          for (i = 0; i < up.length; i++) pool[s][14].push(up[i]);
          table[s][14] = up.length;              // placés d'office après le Roi
          var mustLeft = Math.max(0, slot.must.length - high[s]);
          for (i = 0; i < down.length; i++) pool[s][1].push(down[i]);
          table[s][1] = mustLeft;
          hand[s][1] = down.length - mustLeft;
        } else {
          for (i = 0; i < slot.must.length; i++) pool[s][r].push(slot.must[i]);
          for (i = 0; i < slot.free.length; i++) pool[s][r].push(slot.free[i]);
          table[s][r] = slot.must.length;
          hand[s][r] = slot.free.length;
        }
      }
    }

    var memo = new Map();
    function points(n) { return n === 14 ? 1 : n; }
    function valueOfCard(n) {
      return objective === 'sum' ? points(n) * 1000 + 1 : 1000 + points(n);
    }

    function rec(n, st) {
      if (n === 15) {
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
      // Après le Roi, seules des suites peuvent continuer : pas de groupe d'As hauts.
      var configs = n === 14 ? [GROUP_CONFIGS[0]] : GROUP_CONFIGS;

      for (var ci = 0; ci < configs.length; ci++) {
        var cfg = configs[ci];
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
            best = { val: total, cfg: cfg, per: [choice[0], choice[1], choice[2], choice[3]],
                     next: next.slice() };
          }
          return;
        }
        var a = st[3 * c], b = st[3 * c + 1], c3 = st[3 * c + 2];
        var base = a + b, g = cfg.g[c];
        var tbl = table[c][n], avail = tbl + hand[c][n];
        for (var e3 = 0; e3 <= c3; e3++) {
          for (var ns = 0; base + g + e3 + ns <= avail; ns++) {
            var used = base + g + e3 + ns;
            if (used < tbl) continue;
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
    var cursor = [];
    for (var s2 = 0; s2 < 4; s2++) {
      cursor.push([]);
      for (var r2 = 0; r2 <= 14; r2++) cursor[s2].push(0);
    }
    function take(suit, rank) {
      return pool[suit][rank][cursor[suit][rank]++];
    }

    var runs1 = [[], [], [], []];
    var runs2 = [[], [], [], []];
    var runs3 = [[], [], [], []];
    var sets = [];
    var st2 = start;

    for (var n2 = 1; n2 <= 14; n2++) {
      var entry = memo.get(n2 * 20000000 + encode(st2));
      var cfg2 = entry.cfg, per = entry.per;
      var groupQueue = [[], [], [], []];

      for (var c2 = 0; c2 < 4; c2++) {
        var ch = per[c2];
        var newRuns1 = [], newRuns2 = [], newRuns3 = [], q, run;

        for (q = 0; q < runs1[c2].length; q++) {
          run = runs1[c2][q];
          run.push(take(c2, n2));
          newRuns2.push(run);
        }
        for (q = 0; q < runs2[c2].length; q++) {
          run = runs2[c2][q];
          run.push(take(c2, n2));
          newRuns3.push(run);
        }
        for (q = 0; q < runs3[c2].length; q++) {
          run = runs3[c2][q];
          if (q < ch.e3) { run.push(take(c2, n2)); newRuns3.push(run); }
          else sets.push(run);
        }
        for (q = 0; q < ch.ns; q++) newRuns1.push([take(c2, n2)]);
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

    var placed = [], pts = 0;
    for (var si = 0; si < sets.length; si++) {
      for (var k2 = 0; k2 < sets[si].length; k2++) {
        var cd = sets[si][k2];
        if (fromHand[cd.id]) { placed.push(cd); pts += cd.rank; }
      }
    }
    return { sets: sets, played: placed, count: placed.length, points: pts, val: res.val };
  }

  root.Solver = { solve: solve, GROUP_CONFIGS: GROUP_CONFIGS };
})(typeof window !== 'undefined' ? window : globalThis);
