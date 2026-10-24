/* RummiCard — © 2026 Richard Boulais & Claude */
/* =====================================================================
   reseau.js — Le fil jusqu'au serveur de parties
   ---------------------------------------------------------------------
   Ce fichier ne connaît aucune règle du rami. Il ouvre un WebSocket, le
   rouvre quand il casse, et passe les messages à l'interface. Toute la
   logique de jeu est ailleurs — chez le serveur pour ce qui fait foi,
   dans ui.js pour ce qui s'affiche.

   ----- Pourquoi la reprise n'est pas un raffinement ------------------
   Trois choses coupent le fil, et les trois sont ordinaires :
     — le téléphone s'endort ou passe en arrière-plan ;
     — le réseau change, d'un wifi à la 4G ;
     — une mise à jour du serveur, qui déconnecte toutes les parties.
   Un jeu au tour par tour peut parfaitement traverser tout cela, à une
   condition : que le client sache revenir à sa place tout seul. C'est le
   rôle du jeton — une pièce d'identité tirée une fois et gardée ici. Le
   serveur rend le siège à qui le présente.
   ===================================================================== */
(function (root) {
  'use strict';

  /* L'adresse du serveur de parties, à remplir après le premier
     déploiement du Worker (voir serveur/LISEZMOI.md). Tant qu'elle est
     vide, le jeu entre amis ne fonctionne qu'en local — ce qui suffit
     pour la mise au point, et ce que l'interface dit clairement plutôt
     que d'échouer sans expliquer. */
  var SERVEUR_PUBLIC = '';

  /* On réessaie de plus en plus lentement : inutile de marteler un réseau
     absent, et inutile d'attendre une minute quand il revient tout de
     suite. Plafonné, sans quoi une coupure longue finirait par ne plus
     jamais retenter. */
  var ATTENTES = [500, 1000, 2000, 4000, 8000, 15000];

  var ws = null;
  var code = null;
  var places = 2;
  var nom = '';
  var essais = 0;
  var minuteur = null;
  var voulu = false;        // l'utilisateur veut-il être connecté ?

  function jeton() {
    var j = null;
    try { j = window.localStorage.getItem('rummicard.jeton'); } catch (e) { /* file:// */ }
    if (!j) {
      /* Assez long pour qu'on ne tombe pas dessus par hasard : c'est lui
         qui rend un siège. Ce n'est pas un secret de haute sécurité, et
         le code de partie n'en est pas un non plus — pour des parties
         entre amis, c'est la bonne mesure. */
      j = 'j' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
      try { window.localStorage.setItem('rummicard.jeton', j); } catch (e) { }
    }
    return j;
  }

  function adresse() {
    var hote = root.location && root.location.hostname;
    var local = hote === 'localhost' || hote === '127.0.0.1';
    var base;
    if (local) {
      base = (root.location.protocol === 'https:' ? 'wss://' : 'ws://') + root.location.host;
    } else if (SERVEUR_PUBLIC) {
      base = SERVEUR_PUBLIC;
    } else {
      return null;
    }
    return base + '/partie/' + encodeURIComponent(code) + '?places=' + places;
  }

  function dire(etat, cle) {
    if (RESEAU.onConnexion) RESEAU.onConnexion(etat, cle);
  }

  function brancher() {
    var url = adresse();
    if (!url) { dire('impossible', 'res.pasDeServeur'); return; }
    dire(essais ? 'reprise' : 'connexion');
    try {
      ws = new WebSocket(url);
    } catch (e) {
      replanifier();
      return;
    }

    ws.onopen = function () {
      essais = 0;
      /* Toujours « rejoindre » en premier, même après une coupure : c'est
         ce message qui présente le jeton et récupère le siège. Le serveur
         répond par l'état complet, donc rien n'est à reconstituer ici. */
      RESEAU.envoyer({ t: 'rejoindre', jeton: jeton(), nom: nom });
      dire('ouvert');
    };

    ws.onmessage = function (e) {
      var m;
      try { m = JSON.parse(e.data); } catch (err) { return; }
      if (!m || typeof m.t !== 'string') return;
      if (m.t === 'refus') { if (RESEAU.onRefus) RESEAU.onRefus(m); return; }
      if (RESEAU.onEtat) RESEAU.onEtat(m);
    };

    ws.onclose = function () {
      ws = null;
      if (voulu) replanifier();
      else dire('ferme');
    };

    ws.onerror = function () { /* onclose suit toujours : on l'y traite */ };
  }

  function replanifier() {
    if (!voulu) return;
    var attente = ATTENTES[Math.min(essais, ATTENTES.length - 1)];
    essais++;
    dire('coupe');
    clearTimeout(minuteur);
    minuteur = setTimeout(brancher, attente);
  }

  var RESEAU = {
    onEtat: null,       // function (etat)
    onRefus: null,      // function ({cle, cartes})
    onConnexion: null,  // function (etat, cle)

    /** Y a-t-il de quoi jouer en ligne depuis cet appareil ? */
    disponible: function () {
      if (!root.WebSocket) return false;
      var hote = root.location && root.location.hostname;
      return !!SERVEUR_PUBLIC || hote === 'localhost' || hote === '127.0.0.1';
    },

    connecte: function () { return !!ws && ws.readyState === 1; },
    codePartie: function () { return code; },

    connecter: function (codePartie, nbPlaces, nomJoueur) {
      RESEAU.fermer();
      code = String(codePartie || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
      places = Math.min(6, Math.max(2, nbPlaces || 2));
      nom = nomJoueur || '';
      if (code.length < 4) { dire('impossible', 'res.codeInvalide'); return false; }
      voulu = true;
      essais = 0;
      brancher();
      return true;
    },

    envoyer: function (objet) {
      if (!ws || ws.readyState !== 1) return false;
      try { ws.send(JSON.stringify(objet)); return true; } catch (e) { return false; }
    },

    fermer: function () {
      voulu = false;
      clearTimeout(minuteur);
      essais = 0;
      if (ws) { try { ws.close(); } catch (e) { } }
      ws = null;
      code = null;
    },

    /** Un code de partie lisible au téléphone : ni O ni 0, ni I ni 1. */
    codeNeuf: function () {
      var lettres = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      var out = '';
      for (var i = 0; i < 6; i++) {
        out += lettres.charAt(Math.floor(Math.random() * lettres.length));
      }
      return out;
    }
  };

  root.RESEAU = RESEAU;
})(window);
