/* RummiCard — © 2026 Richard Boulais & Claude */
/* =====================================================================
   local.js — Le même serveur, mais sur cette machine
   ---------------------------------------------------------------------
   `node serveur/local.js` — puis http://localhost:8777/#partie=ESSAI

   Sert les fichiers du jeu et ouvre des parties, pour pouvoir faire jouer
   deux fenêtres l'une contre l'autre sans compte Cloudflare et sans
   réseau. C'est un outil de mise au point, pas un serveur de production :
   il écoute en clair, sur cette machine seulement, et ne garde rien quand
   on l'arrête.

   La logique est exactement celle de partie.js — même salon.js, même
   validation.js, mêmes messages. Seule l'enveloppe change : ici un
   WebSocket écrit à la main, là-bas un Durable Object.

   Le WebSocket tient en une poignée de lignes parce qu'on n'a besoin que
   d'une fraction du protocole : poignée de main, trames de texte non
   fragmentées, fermeture. Pas de dépendance à installer.
   ===================================================================== */
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync } from 'node:fs';
import { Salon } from './salon.js';

const RACINE = fileURLToPath(new URL('../Resources/web/', import.meta.url));
const PORT = Number(process.env.PORT) || 8777;
const MAGIE = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';   // RFC 6455

const salons = new Map();                 // code -> { salon, prises: Set }

/* Le Durable Object garde ses parties dans son stockage : une mise à jour du
   code coupe les connexions mais ne perd pas la partie. Pour que la mise au
   point éprouve la même chose — et c'est le cas qui compte, puisqu'un
   déploiement déconnecte tout le monde — on en fait autant ici, dans un
   fichier. Le contenu est celui que serialiser() produirait côté Cloudflare. */
const MEMOIRE = fileURLToPath(new URL('./.parties.json', import.meta.url));

function relire() {
  try {
    const brut = JSON.parse(readFileSync(MEMOIRE, 'utf8'));
    for (const [code, etat] of Object.entries(brut)) {
      const salon = Salon.deserialiser(etat);
      if (salon) salons.set(code, { salon, prises: new Set() });
    }
    console.log('  ' + salons.size + ' partie(s) retrouvée(s)');
  } catch { /* premier démarrage : rien à relire */ }
}

function retenir() {
  const brut = {};
  for (const [code, chambre] of salons) brut[code] = chambre.salon.serialiser();
  try { writeFileSync(MEMOIRE, JSON.stringify(brut)); } catch { /* tant pis */ }
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};

/* ---- Les fichiers du jeu --------------------------------------------- */

const serveur = createServer(async (req, res) => {
  try {
    const chemin = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const relatif = normalize(chemin === '/' ? 'index.html' : chemin.slice(1));
    if (relatif.startsWith('..')) {
      res.writeHead(403).end('non');
      return;
    }
    const corps = await readFile(join(RACINE, relatif));
    const entetes = {
      'content-type': TYPES[extname(relatif)] || 'application/octet-stream'
    };
    /* Pas de cache : en mise au point, on veut le fichier qu'on vient
       d'enregistrer, pas celui d'il y a dix minutes. Le cache d'un serveur
       de développement nous a déjà fait croire à un bogue qui n'existait
       plus.
       Sauf pour sw.js : un navigateur refuse d'enregistrer un service
       worker servi en « no-store », et l'échec n'apparaît que comme une
       erreur obscure dans la console. Mesuré ici même. */
    if (relatif !== 'sw.js') entetes['cache-control'] = 'no-store';
    res.writeHead(200, entetes);
    res.end(corps);
  } catch {
    res.writeHead(404).end('introuvable');
  }
});

/* ---- Le WebSocket ----------------------------------------------------- */

serveur.on('upgrade', (req, prise) => {
  const cle = req.headers['sec-websocket-key'];
  const url = new URL(req.url, 'http://x');
  const m = url.pathname.match(/^\/partie\/([A-Za-z0-9]{4,12})$/);
  if (!cle || !m) {
    prise.destroy();
    return;
  }
  const code = m[1].toUpperCase();
  const places = Math.min(6, Math.max(2, Number(url.searchParams.get('places')) || 2));

  prise.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
    'Sec-WebSocket-Accept: ' +
      createHash('sha1').update(cle + MAGIE).digest('base64') + '\r\n\r\n'
  );

  if (!salons.has(code)) salons.set(code, { salon: new Salon({ places }), prises: new Set() });
  const chambre = salons.get(code);
  chambre.prises.add(prise);
  prise.moi = { siege: -1, jeton: null };

  let tampon = Buffer.alloc(0);
  prise.on('data', (bloc) => {
    tampon = Buffer.concat([tampon, bloc]);
    let trame;
    while ((trame = lireTrame(tampon))) {
      tampon = tampon.subarray(trame.taille);
      if (trame.fermeture) { prise.end(); return; }
      if (trame.texte !== null) traiter(chambre, prise, trame.texte);
    }
  });

  const partir = () => {
    chambre.prises.delete(prise);
    if (prise.moi.jeton) {
      chambre.salon.quitter(prise.moi.jeton);
      diffuser(chambre);
    }
    if (!chambre.prises.size) {
      console.log('  salon ' + code + ' : plus personne');
    }
  };
  prise.on('close', partir);
  prise.on('error', partir);
  console.log('  salon ' + code + ' : une connexion de plus (' + chambre.prises.size + ')');
});

/* ---- Trames : juste ce qu'il faut ------------------------------------- */

function lireTrame(b) {
  if (b.length < 2) return null;
  const opcode = b[0] & 0x0f;
  const masque = (b[1] & 0x80) !== 0;
  let taille = b[1] & 0x7f;
  let i = 2;
  if (taille === 126) {
    if (b.length < 4) return null;
    taille = b.readUInt16BE(2);
    i = 4;
  } else if (taille === 127) {
    if (b.length < 10) return null;
    taille = Number(b.readBigUInt64BE(2));
    i = 10;
  }
  const cle = masque ? b.subarray(i, i + 4) : null;
  if (masque) i += 4;
  if (b.length < i + taille) return null;
  const charge = Buffer.from(b.subarray(i, i + taille));
  if (cle) for (let k = 0; k < charge.length; k++) charge[k] ^= cle[k & 3];
  return {
    taille: i + taille,
    fermeture: opcode === 0x8,
    texte: opcode === 0x1 ? charge.toString('utf8') : null
  };
}

function ecrire(prise, texte) {
  const charge = Buffer.from(texte, 'utf8');
  let entete;
  if (charge.length < 126) {
    entete = Buffer.from([0x81, charge.length]);
  } else if (charge.length < 65536) {
    entete = Buffer.alloc(4);
    entete[0] = 0x81; entete[1] = 126;
    entete.writeUInt16BE(charge.length, 2);
  } else {
    entete = Buffer.alloc(10);
    entete[0] = 0x81; entete[1] = 127;
    entete.writeBigUInt64BE(BigInt(charge.length), 2);
  }
  try { prise.write(Buffer.concat([entete, charge])); } catch { /* partie */ }
}

/* ---- Les messages : mot pour mot ceux de partie.js -------------------- */

function envoyer(prise, objet) { ecrire(prise, JSON.stringify(objet)); }

function diffuser(chambre) {
  const jetons = [];
  for (const p of chambre.prises) if (p.moi && p.moi.jeton) jetons.push(p.moi.jeton);
  chambre.salon.presence(jetons);
  for (const p of chambre.prises) {
    if (p.moi && p.moi.siege >= 0) envoyer(p, chambre.salon.etatPour(p.moi.siege));
  }
}

function traiter(chambre, prise, brut) {
  let m;
  try { m = JSON.parse(brut); } catch { return envoyer(prise, { t: 'refus', cle: 'res.messageInvalide' }); }
  if (!m || typeof m.t !== 'string') return envoyer(prise, { t: 'refus', cle: 'res.messageInvalide' });
  const salon = chambre.salon;
  const moi = prise.moi;
  if (moi.siege < 0 && m.t !== 'rejoindre') {
    return envoyer(prise, { t: 'refus', cle: 'res.pasAssis' });
  }
  let r;
  switch (m.t) {
    case 'rejoindre': {
      r = salon.rejoindre(m.jeton, m.nom);
      if (!r.ok) return envoyer(prise, { t: 'refus', cle: r.cle });
      prise.moi = { siege: r.siege, jeton: m.jeton };
      if (r.remplace) {
        retenir();
        diffuser(chambre);
        const avis = { t: 'avis', cle: 'res.aPrisLaPlace',
                       nom: salon.sieges[r.siege].nom, remplace: r.remplace };
        for (const p2 of chambre.prises) {
          if (p2 === prise) continue;      // pas à celui qui vient d'arriver
          envoyer(p2, avis);
        }
        return;
      }
      break;
    }
    case 'demarrer':
      if (moi.siege !== 0) return envoyer(prise, { t: 'refus', cle: 'res.pasHote' });
      r = salon.demarrer();
      if (!r.ok) return envoyer(prise, { t: 'refus', cle: r.cle });
      break;
    case 'jouer':
      r = salon.jouer(moi.siege, m.board, m.main);
      if (!r.ok) return envoyer(prise, { t: 'refus', cle: r.cle, cartes: r.cartes });
      break;
    case 'piocher':
      r = salon.piocher(moi.siege);
      if (!r.ok) return envoyer(prise, { t: 'refus', cle: r.cle });
      break;
    case 'partir':
      r = salon.partir(moi.jeton);
      if (!r.ok) return envoyer(prise, { t: 'refus', cle: r.cle });
      prise.moi = { siege: -1, jeton: null };
      break;
    case 'relancer': {
      /* Même refusée, la demande fait constater la présence : c'est ainsi
         qu'une déconnexion silencieuse finit par se voir. */
      const vivants = [];
      for (const p2 of chambre.prises) if (p2.moi && p2.moi.jeton) vivants.push(p2.moi.jeton);
      salon.presence(vivants);
      salon.relancer(Date.now());
      retenir();
      diffuser(chambre);
      return;
    }
    default:
      return envoyer(prise, { t: 'refus', cle: 'res.messageInvalide' });
  }
  retenir();
  diffuser(chambre);
}

relire();
serveur.listen(PORT, '127.0.0.1', () => {
  console.log('RummiCard, serveur de mise au point');
  console.log('  http://localhost:' + PORT + '/');
  console.log('  une partie :  http://localhost:' + PORT + '/#partie=ESSAI');
});
