/* RummiCard — © 2026 Richard Boulais & Claude */
/* =====================================================================
   partie.js — L'enveloppe réseau, et rien d'autre
   ---------------------------------------------------------------------
   Un Durable Object par partie. Il ne connaît aucune règle du rami : il
   ouvre des WebSockets, passe les messages à salon.js, et renvoie à chacun
   ce qu'il a le droit de voir. Toute la logique est à côté, et s'éprouve
   sans réseau (serveur/essais.js).

   ----- La mise en veille ---------------------------------------------
   On accepte les connexions par ctx.acceptWebSocket() et non par
   serveur.accept(). La différence décide du prix : avec accept(), la
   durée est facturée pendant tout le temps où la connexion reste
   ouverte — c'est-à-dire pendant que les joueurs réfléchissent, ce qui
   est l'essentiel d'une partie de rami. Avec acceptWebSocket(), l'objet
   s'endort entre deux messages sans que personne soit déconnecté, et la
   durée n'est plus comptée. La documentation de Cloudflare recommande
   expressément cette voie pour des messages « transmis occasionnellement,
   à intervalles espacés ».

   Le prix de ce sommeil : l'état en mémoire est perdu à chaque réveil et
   le constructeur rejoué. D'où charger() à chaque message, et le salon
   gardé dans le stockage plutôt que dans un champ.

   Deux pièges, tirés de la même documentation :
     — setTimeout et setInterval empêchent le sommeil. Pas de minuterie de
       tour, donc, tant qu'on n'en a pas vraiment besoin ;
     — un déploiement de code coupe toutes les connexions. Le client devra
       savoir se rebrancher seul ; son jeton lui rendra sa place.
   ===================================================================== */
import { Salon } from './salon.js';

/* Un message de jeu pèse moins d'un kilo-octet (mesuré : 905 octets pour
   une table de 56 cartes). Cent kilo-octets laissent une marge confortable
   et ferment la porte à l'envoi d'un million de cartes. */
const MAX_MESSAGE = 100 * 1024;

/* Les origines d'où le jeu se joue. Ce n'est pas une barrière de sécurité
   — un en-tête Origin s'invente — mais cela évite qu'une page tierce
   ouvre des parties chez nous par distraction. « null » est l'origine
   d'une page chargée en file://, c'est-à-dire l'app macOS. */
const ORIGINES = ['https://bouric.github.io', 'null'];

export class Partie {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.salon = null;
  }

  /* ---- Le salon, réveillé si besoin -------------------------------- */

  async charger(places) {
    if (this.salon) return this.salon;
    const brut = await this.ctx.storage.get('salon');
    this.salon = (brut && Salon.deserialiser(brut)) || new Salon({ places: places || 2 });
    return this.salon;
  }

  async enregistrer() {
    await this.ctx.storage.put('salon', this.salon.serialiser());
  }

  /* ---- Ouverture d'une connexion ----------------------------------- */

  async fetch(request) {
    const url = new URL(request.url);
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('RummiCard — cette adresse attend un WebSocket.', { status: 426 });
    }
    const origine = request.headers.get('Origin');
    if (origine && !ORIGINES.includes(origine)) {
      return new Response('Origine inattendue.', { status: 403 });
    }

    const places = Number(url.searchParams.get('places'));
    await this.charger(Number.isFinite(places) ? places : 2);

    const paire = new WebSocketPair();
    const [coteClient, coteServeur] = Object.values(paire);
    this.ctx.acceptWebSocket(coteServeur);
    /* Ce que cette connexion sait d'elle-même, et qui doit survivre au
       sommeil : rien encore, jusqu'au message « rejoindre ». */
    coteServeur.serializeAttachment({ siege: -1, jeton: null });
    return new Response(null, { status: 101, webSocket: coteClient });
  }

  /* ---- Messages ------------------------------------------------------ */

  async webSocketMessage(ws, brut) {
    if (typeof brut !== 'string' || brut.length > MAX_MESSAGE) {
      return this.envoyer(ws, { t: 'refus', cle: 'res.messageInvalide' });
    }
    let m;
    try {
      m = JSON.parse(brut);
    } catch {
      return this.envoyer(ws, { t: 'refus', cle: 'res.messageInvalide' });
    }
    if (!m || typeof m.t !== 'string') {
      return this.envoyer(ws, { t: 'refus', cle: 'res.messageInvalide' });
    }

    const salon = await this.charger();
    const moi = ws.deserializeAttachment() || { siege: -1, jeton: null };

    /* Tant qu'on n'a pas de siège, on n'a le droit que d'en demander un. */
    if (moi.siege < 0 && m.t !== 'rejoindre') {
      return this.envoyer(ws, { t: 'refus', cle: 'res.pasAssis' });
    }

    let r;
    switch (m.t) {
      case 'rejoindre':
        r = salon.rejoindre(m.jeton, m.nom);
        if (!r.ok) return this.envoyer(ws, { t: 'refus', cle: r.cle });
        ws.serializeAttachment({ siege: r.siege, jeton: m.jeton });
        break;

      case 'demarrer':
        /* Celui qui a ouvert la partie décide du départ. */
        if (moi.siege !== 0) return this.envoyer(ws, { t: 'refus', cle: 'res.pasHote' });
        r = salon.demarrer();
        if (!r.ok) return this.envoyer(ws, { t: 'refus', cle: r.cle });
        break;

      case 'jouer':
        r = salon.jouer(moi.siege, m.board, m.main);
        if (!r.ok) return this.envoyer(ws, { t: 'refus', cle: r.cle, cartes: r.cartes });
        break;

      case 'piocher':
        r = salon.piocher(moi.siege);
        if (!r.ok) return this.envoyer(ws, { t: 'refus', cle: r.cle });
        break;

      default:
        return this.envoyer(ws, { t: 'refus', cle: 'res.messageInvalide' });
    }

    await this.enregistrer();
    this.diffuser();
  }

  async webSocketClose(ws) {
    const moi = ws.deserializeAttachment();
    if (moi && moi.jeton) {
      const salon = await this.charger();
      salon.quitter(moi.jeton);
      await this.enregistrer();
      this.diffuser();
    }
  }

  async webSocketError(ws) {
    return this.webSocketClose(ws);
  }

  /* ---- Parole ------------------------------------------------------- */

  envoyer(ws, objet) {
    try {
      ws.send(JSON.stringify(objet));
    } catch {
      /* Connexion déjà close : rien à dire, et surtout rien à faire
         tomber — une diffusion ne doit pas échouer parce qu'un joueur
         est parti entre-temps. */
    }
  }

  /** À chacun son état : ce n'est pas le même message pour tout le monde. */
  diffuser() {
    for (const ws of this.ctx.getWebSockets()) {
      const moi = ws.deserializeAttachment();
      if (!moi || moi.siege < 0) continue;
      this.envoyer(ws, this.salon.etatPour(moi.siege));
    }
  }
}

/* ---- L'aiguillage ---------------------------------------------------- */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const m = url.pathname.match(/^\/partie\/([A-Za-z0-9]{4,12})$/);
    if (!m) {
      return new Response('RummiCard — /partie/<code>', { status: 404 });
    }
    /* Le code de la partie nomme l'objet : même code, même objet, partout
       dans le monde. C'est tout le mécanisme des salons. Majuscules
       imposées pour qu'un code dicté au téléphone retombe sur ses pieds. */
    const id = env.PARTIE.idFromName(m[1].toUpperCase());
    return env.PARTIE.get(id).fetch(request);
  }
};
