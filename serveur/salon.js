/* RummiCard — © 2026 Richard Boulais & Claude */
/* =====================================================================
   salon.js — Une partie et ses joueurs, sans réseau
   ---------------------------------------------------------------------
   Toute la logique d'une partie en ligne est ici, et rien d'autre : pas de
   WebSocket, pas de Cloudflare, pas de stockage. On entre des messages, on
   ressort des états. C'est ce qui permet d'éprouver une partie complète
   dans un terminal, sans navigateur et sans serveur — la méthode qui a
   servi pour le solveur, et qui a trouvé en quelques secondes ce qu'un
   essai à la main n'aurait pas vu.

   Le découpage : partie.js branche un WebSocket sur ce fichier, et c'est
   son seul rôle.

   ----- Ce qui ne sort jamais d'ici -----------------------------------
   La donne (deal.order) est déterministe : elle contient les 104 cartes
   dans l'ordre, et c'est ce qui fait marcher « Même donne ». Qui la reçoit
   connaît la main de tous et la pioche à venir. Elle ne quitte donc jamais
   ce fichier, pas plus que la pioche ni la main des autres. C'est la seule
   chose qui rende le jeu en ligne honnête, et c'est etatPour() qui en
   répond.
   ===================================================================== */
import { Engine, AI } from './moteur.js';
import { verifierTour } from './validation.js';

/* Filet : si tous les sièges étaient virtuels et qu'une fin de partie
   échappait au moteur, la boucle des tours virtuels pourrait ne pas
   s'arrêter. Une partie dépasse rarement deux cents tours ; mille est
   large et borne le pire cas. */
const TOURS_MAX = 1000;

/* Combien de temps on attend un joueur parti avant de passer son tour.
   Assez pour un tunnel, un téléphone qui s'endort ou un changement de
   réseau ; pas assez pour que les autres se demandent si la partie est
   morte. */
const GRACE_ABSENCE = 45000;

export class Salon {
  /**
   * @param {{places?: number, difficulte?: string}} options
   */
  constructor(options = {}) {
    const places = Math.min(6, Math.max(2, options.places || 2));
    this.places = places;
    this.difficulte = options.difficulte || 'normal';
    /* Un siège par joueur. `jeton` est la pièce d'identité que le client
       garde chez lui : c'est elle qui lui rend sa place après une coupure,
       un sommeil de téléphone ou un déploiement. */
    this.sieges = [];
    for (let i = 0; i < places; i++) {
      this.sieges.push({ jeton: null, nom: null, humain: false, connecte: false });
    }
    this.partie = null;
    this.commencee = false;
  }

  /* ---- Entrées et sorties des joueurs ------------------------------ */

  /**
   * Prendre une place, ou retrouver la sienne.
   * @returns {{ok: boolean, siege?: number, cle?: string}}
   */
  rejoindre(jeton, nom) {
    if (typeof jeton !== 'string' || !jeton || jeton.length > 64) {
      return { ok: false, cle: 'res.messageInvalide' };
    }
    const deja = this.sieges.findIndex((s) => s.jeton === jeton);
    if (deja >= 0) {
      /* Reprise : on ne renomme pas, on ne redistribue pas. Le joueur
         retrouve exactement ce qu'il avait quitté. */
      this.sieges[deja].connecte = true;
      return { ok: true, siege: deja, reprise: true };
    }
    if (this.commencee) return { ok: false, cle: 'res.partieCommencee' };
    const libre = this.sieges.findIndex((s) => !s.jeton);
    if (libre < 0) return { ok: false, cle: 'res.salonComplet' };
    this.sieges[libre] = {
      jeton,
      nom: this.nomPropre(nom, libre),
      humain: true,
      connecte: true
    };
    return { ok: true, siege: libre, reprise: false };
  }

  /* Un nom venu du réseau est une donnée, pas du texte sûr : on le borne
     et on le nettoie ici plutôt que de compter sur l'affichage. */
  nomPropre(nom, siege) {
    const brut = typeof nom === 'string' ? nom.trim().replace(/\s+/g, ' ') : '';
    const propre = brut.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 20);
    return propre || 'Joueur ' + (siege + 1);
  }

  quitter(jeton) {
    const i = this.sieges.findIndex((s) => s.jeton === jeton);
    if (i >= 0) this.sieges[i].connecte = false;
    return i;
  }

  /**
   * Qui est là, constaté sur les connexions vivantes plutôt que déduit des
   * départs. La nuance n'est pas théorique : un même jeton peut tenir deux
   * fils — deux onglets, ou un téléphone qui rouvre avant que l'ancien fil
   * soit tombé. En comptant les départs, la fermeture du second marquait
   * absent quelqu'un qui était toujours là.
   * @param {Array<string>} jetons les jetons actuellement connectés
   */
  presence(jetons) {
    const maintenant = Date.now();
    for (const s of this.sieges) {
      s.connecte = !!s.jeton && jetons.indexOf(s.jeton) >= 0;
      if (s.connecte) {
        s.depuis = null;
      } else if (s.jeton && !s.depuis) {
        /* On date la première fois qu'on CONSTATE l'absence, et non la
           transition. La nuance a coûté un essai : quitter() met le siège à
           « déconnecté » de son côté, si bien que la transition n'avait
           déjà plus lieu quand presence() passait — le départ n'était
           jamais daté, et le tour ne se passait jamais.
           Dater ce qu'on constate est d'ailleurs plus juste : si le serveur
           dormait, le délai de grâce doit courir depuis le moment où l'on
           pouvait s'en apercevoir, pas depuis un départ que personne n'a vu. */
        s.depuis = maintenant;
      }
    }
  }

  /**
   * Passer le tour d'un joueur parti.
   *
   * Sans cela, une déconnexion arrête tout le monde : les autres attendent
   * un coup qui ne viendra pas, et rien à l'écran ne dit pourquoi.
   *
   * N'importe quel client peut le demander — c'est le serveur qui juge, sur
   * sa propre horloge, et refuse tant que le délai de grâce court. Un
   * téléphone qui s'endort ou un tunnel ne coûtent donc pas un tour.
   *
   * On **pioche** pour l'absent plutôt que de jouer sa main : perdre un tour
   * est moins grave que se faire dépenser ses cartes par une machine, et il
   * retrouvera son jeu tel qu'il l'a laissé, une carte de plus.
   */
  relancer(maintenant) {
    if (!this.commencee || this.partie.finished || this.abandon) {
      return { ok: false, cle: 'res.rienAPasser' };
    }
    const siege = this.partie.current;
    const s = this.sieges[siege];
    if (!s.humain || s.connecte) return { ok: false, cle: 'res.rienAPasser' };
    if (!s.depuis || maintenant - s.depuis < GRACE_ABSENCE) {
      return { ok: false, cle: 'res.encoreUnPeu' };
    }
    this.partie.draw();
    this.terminerTour();
    return { ok: true, siege: siege, nom: s.nom };
  }

  /**
   * S'en aller pour de bon.
   *
   * Partir et se déconnecter sont deux choses, et les confondre serait
   * fâcheux dans les deux sens. Un fil qui tombe se répare — téléphone
   * endormi, tunnel, changement de réseau — et la partie attend, quitte à
   * passer un tour. Un joueur qui s'en va, lui, ne revient pas : continuer
   * à l'attendre, ou jouer sa main à sa place, n'aurait aucun sens. On
   * arrête la partie, et l'on dit pourquoi.
   *
   * Avant que la partie ne commence, c'est plus simple : la place
   * redevient libre, et les autres continuent de s'organiser.
   */
  partir(jeton) {
    const i = this.sieges.findIndex((s) => s.jeton === jeton);
    if (i < 0) return { ok: false, cle: 'res.pasAssis' };
    const nom = this.sieges[i].nom;
    if (!this.commencee) {
      this.sieges[i] = { jeton: null, nom: null, humain: false, connecte: false };
      return { ok: true, siege: i, nom: nom, salon: true };
    }
    /* On ne marque pas la partie « finie » : finie, elle appellerait le
       décompte des points, et compter les points d'une partie qu'on
       abandonne n'a pas de sens. On la marque abandonnée, ce qui est
       autre chose, et les clients repartent à l'accueil. */
    this.abandon = { siege: i, nom: nom };
    return { ok: true, siege: i, nom: nom, salon: false };
  }

  /* ---- Le départ ---------------------------------------------------- */

  /**
   * Distribuer et lancer. Les sièges que personne n'a pris sont tenus par
   * des adversaires virtuels — le même ai.js que dans le jeu solo. « Deux
   * amis et un virtuel » ne demande donc rien de plus.
   */
  demarrer() {
    if (this.commencee) return { ok: false, cle: 'res.partieCommencee' };
    if (!this.sieges.some((s) => s.humain)) return { ok: false, cle: 'res.salonVide' };

    Engine.options.difficulty = this.difficulte;
    this.partie = new Engine.Game(this.places - 1);
    this.commencee = true;

    /* Le moteur nomme lui-même ses joueurs virtuels ; on garde ses noms
       pour les sièges vides et l'on impose les nôtres pour les autres. */
    for (let i = 0; i < this.places; i++) {
      const s = this.sieges[i];
      if (s.humain) this.partie.players[i].name = s.nom;
      else s.nom = this.partie.players[i].name;
      /* `human` ne décrit plus « le joueur de cet appareil » mais « ce
         siège est-il tenu par une personne » : c'est ce qui dit à la
         boucle des tours virtuels quand s'arrêter. */
      this.partie.players[i].human = s.humain;
    }

    this.jouerLesVirtuels();
    return { ok: true };
  }

  /* ---- Les tours ---------------------------------------------------- */

  /**
   * Un joueur annonce sa table et sa main. On vérifie, on valide, on passe
   * la main. Le refus ne modifie rien : validation.js remet en place.
   */
  jouer(siege, board, main) {
    if (!this.commencee) return { ok: false, cle: 'res.partieNonCommencee' };
    if (this.abandon) return { ok: false, cle: 'res.partieAbandonnee' };
    const verdict = verifierTour(this.partie, siege, board, main);
    if (!verdict.ok) return verdict;
    const pose = this.partie.commit();
    if (!pose.ok) {
      /* Ceinture et bretelles : verifierTour a déjà appelé checkCommit, et
         commit() le rappelle. Si les deux se contredisaient, mieux vaut le
         savoir que poser un tour douteux. */
      this.partie.restoreTurn();
      return { ok: false, cle: pose.reason };
    }
    this.terminerTour();
    return { ok: true };
  }

  /**
   * Piocher. Le moteur remet d'abord la table comme au début du tour :
   * côté serveur elle l'est déjà, puisqu'on n'applique un tour qu'une fois
   * validé. Le client, lui, interdit de piocher après avoir posé — c'est
   * sa règle de confort, et elle n'a pas à être rejouée ici.
   */
  piocher(siege) {
    if (!this.commencee) return { ok: false, cle: 'res.partieNonCommencee' };
    if (this.abandon) return { ok: false, cle: 'res.partieAbandonnee' };
    if (this.partie.finished) return { ok: false, cle: 'res.partieFinie' };
    if (siege !== this.partie.current) return { ok: false, cle: 'res.pasVotreTour' };
    const carte = this.partie.draw();
    this.terminerTour();
    return { ok: true, pioche: !!carte };
  }

  terminerTour() {
    if (this.partie.finished) return;
    this.partie.nextPlayer();
    this.jouerLesVirtuels();
  }

  jouerLesVirtuels() {
    let garde = 0;
    while (
      !this.partie.finished &&
      !this.sieges[this.partie.current].humain &&
      garde++ < TOURS_MAX
    ) {
      AI.playAITurn(this.partie);
      if (this.partie.finished) break;
      this.partie.nextPlayer();
    }
  }

  /* ---- Ce que chacun a le droit de voir ----------------------------- */

  /**
   * L'état expurgé, du point de vue d'un siège. Votre main en entier, celle
   * des autres réduite à son compte, la pioche à son compte, la donne
   * jamais.
   *
   * L'interface n'en demande pas plus : dans tout ui.js, la main d'un autre
   * joueur n'est lue que par sa longueur — l'éventail de dos et « 9 cartes ».
   * Le seul endroit qui lit les vraies cartes est le décompte final, et il
   * arrive avec la fin de partie ci-dessous.
   */
  etatPour(siege) {
    if (!this.commencee) {
      return {
        t: 'salon',
        vous: siege,
        places: this.places,
        joueurs: this.sieges.map((s) => ({ nom: s.nom, humain: s.humain, connecte: s.connecte })),
        commencee: false
      };
    }
    const g = this.partie;
    const etat = {
      t: 'etat',
      vous: siege,
      courant: g.current,
      tour: g.turnCount,
      noms: this.sieges.map((s) => s.nom),
      humains: this.sieges.map((s) => s.humain),
      connectes: this.sieges.map((s) => s.connecte),
      board: g.board.map((s) => s.cards.map((c) => c.id)),
      main: siege >= 0 ? g.players[siege].hand.map((c) => c.id) : [],
      mains: g.players.map((p) => p.hand.length),
      pioche: g.deck.length,
      melded: g.players.map((p) => p.melded),
      fini: g.finished
    };
    if (this.abandon) etat.abandon = this.abandon;
    if (g.finished) {
      /* La partie est jouée : les mains peuvent enfin être dites, et il le
         faut — c'est le seul endroit de l'interface qui lit les cartes des
         autres, pour compter les points. */
      etat.gagnant = g.winner ? g.winner.index : null;
      etat.mainsFinales = g.players.map((p) => p.hand.map((c) => c.id));
    }
    return etat;
  }

  /* ---- Mémoire ------------------------------------------------------ */

  /** Tout ce qu'il faut pour reconstituer le salon après une mise en veille. */
  serialiser() {
    return {
      v: 1,
      places: this.places,
      difficulte: this.difficulte,
      sieges: this.sieges,
      commencee: this.commencee,
      abandon: this.abandon || null,
      partie: this.partie ? this.partie.serialize() : null
    };
  }

  static deserialiser(brut) {
    if (!brut || brut.v !== 1) return null;
    const salon = new Salon({ places: brut.places, difficulte: brut.difficulte });
    salon.sieges = brut.sieges;
    salon.commencee = brut.commencee;
    salon.abandon = brut.abandon || null;
    if (brut.partie) {
      Engine.options.difficulty = brut.difficulte;
      salon.partie = new Engine.Game(brut.places - 1, brut.partie.deal);
      salon.partie.loadSerialized(brut.partie);
      for (let i = 0; i < salon.places; i++) {
        salon.partie.players[i].human = salon.sieges[i].humain;
        if (salon.sieges[i].nom) salon.partie.players[i].name = salon.sieges[i].nom;
      }
    }
    return salon;
  }
}
