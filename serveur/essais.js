/* RummiCard — © 2026 Richard Boulais & Claude */
/* =====================================================================
   essais.js — Éprouver le salon et la validation, sans navigateur
   ---------------------------------------------------------------------
   `node serveur/essais.js`

   Trois questions, dans l'ordre d'importance :

     1. Le secret tient-il ? Un état envoyé à un joueur ne doit contenir
        aucune carte qu'il n'a pas le droit de voir. C'est l'essai qui
        compte le plus : s'il échoue, tout le reste est sans objet.
     2. Une partie complète se joue-t-elle de bout en bout, sans perdre
        une carte ni poser une combinaison invalide ?
     3. Un client malhonnête est-il arrêté — et son refus laisse-t-il la
        partie intacte ?
   ===================================================================== */
import { Engine, AI } from './moteur.js';
import { Salon } from './salon.js';

/* ---- Une suite aléatoire reproductible ------------------------------
   Sans graine, deux exécutions ne jouent pas la même partie : un défaut
   rare passerait un jour et échouerait le lendemain, sans qu'on sache
   lequel des deux croire. On sème, et l'on rejoue plusieurs donnes. */
let graine = 1;
Math.random = () => {
  graine = (graine * 1103515245 + 12345) & 0x7fffffff;
  return graine / 0x7fffffff;
};
const semer = (n) => { graine = n; };

/* ---- Petit appareil d'essai ---------------------------------------- */
let reussis = 0;
let echoues = 0;
const ratés = [];

function verifier(condition, titre, detail) {
  if (condition) {
    reussis++;
  } else {
    echoues++;
    ratés.push(titre + (detail ? '  — ' + detail : ''));
  }
}

function section(titre) {
  console.log('\n—— ' + titre + ' ——');
}

/* ---- Un client, tel qu'il verra les choses -------------------------- */

/* Le client ne reçoit que des identifiants : il reconstruit ses cartes.
   « 2-7-1 » est le septième pique du second jeu. */
function carte(id) {
  const [suit, rank, copy] = id.split('-').map(Number);
  return { id, suit, rank, copy };
}

/* Les deux exemplaires d'une carte sont interchangeables pour le solveur,
   qui peut donc proposer de poser celui de la main là où celui de la table
   se trouvait déjà. Le serveur refuserait : toutes les cartes de la table
   doivent y rester, et c'est par identifiant qu'il le vérifie. Un client
   qui s'appuie sur le solveur doit donc réattribuer les exemplaires, la
   table servie la première. ui.js fait le même raisonnement, par couleur
   et valeur, pour les indices. */
function normaliserExemplaires(sets, cartesTable, main) {
  const dispo = new Map();
  const ranger = (c, devant) => {
    const cle = c.suit + '-' + c.rank;
    if (!dispo.has(cle)) dispo.set(cle, []);
    if (devant) dispo.get(cle).unshift(c.id);
    else dispo.get(cle).push(c.id);
  };
  for (const c of main) ranger(c, false);
  for (const c of cartesTable) ranger(c, true);

  const consommes = new Set();
  const board = sets.map((s) =>
    s.map((c) => {
      const file = dispo.get(c.suit + '-' + c.rank);
      const id = file.shift();
      consommes.add(id);
      return id;
    })
  );
  const reste = main.filter((c) => !consommes.has(c.id)).map((c) => c.id);
  return { board, main: reste };
}

/** Que jouerait un client honnête, ne sachant que ce que l'état lui dit ? */
function coupDuClient(etat) {
  const cartesTable = etat.board.flat().map(carte);
  const main = etat.main.map(carte);
  const r = AI.bestPartition(cartesTable, main);
  if (!r || !r.count) return null;
  return normaliserExemplaires(r.sets, cartesTable, main);
}

/* ---- 1. Le secret ---------------------------------------------------- */

section('1. Ce qu’un joueur a le droit de voir');
{
  const salon = new Salon({ places: 3 });
  salon.rejoindre('jeton-A', 'Richard');
  salon.rejoindre('jeton-B', 'Ami');
  salon.demarrer();

  const etat = salon.etatPour(0);
  const texte = JSON.stringify(etat);

  /* Tout ce que le siège 0 n'a pas le droit de voir : les mains des
     autres, et la pioche entière. */
  const interdits = new Set();
  for (let i = 1; i < salon.partie.players.length; i++) {
    for (const c of salon.partie.players[i].hand) interdits.add(c.id);
  }
  for (const c of salon.partie.deck) interdits.add(c.id);

  const fuites = [...interdits].filter((id) => texte.includes('"' + id + '"'));
  verifier(fuites.length === 0, 'aucune carte interdite dans l’état',
    fuites.length ? fuites.length + ' fuites, dont ' + fuites.slice(0, 3).join(', ') : '');

  verifier(!('deal' in etat) && !texte.includes('"order"'),
    'la donne ne part jamais');
  verifier(!('deck' in etat) && typeof etat.pioche === 'number',
    'la pioche n’est qu’un compte', 'pioche = ' + etat.pioche);
  verifier(Array.isArray(etat.mains) && etat.mains.every((n) => typeof n === 'number'),
    'les mains des autres ne sont que des comptes', JSON.stringify(etat.mains));
  verifier(etat.main.length === 14, 'votre main vous est donnée en entier',
    etat.main.length + ' cartes');

  /* Et l'état du voisin ne doit pas laisser voir la vôtre. */
  const texteB = JSON.stringify(salon.etatPour(1));
  const aMoi = salon.partie.players[0].hand.map((c) => c.id);
  const vues = aMoi.filter((id) => texteB.includes('"' + id + '"'));
  verifier(vues.length === 0, 'votre main reste invisible au voisin',
    vues.length ? vues.length + ' cartes vues' : '');
}

/* ---- 2. Une partie complète ------------------------------------------ */

section('2. Des parties complètes, deux humains et un virtuel');
for (const donne of [11, 22, 33, 44, 55]) {
  semer(donne);
  const salon = new Salon({ places: 3 });
  salon.rejoindre('jeton-A', 'Richard');
  salon.rejoindre('jeton-B', 'Ami');
  const depart = salon.demarrer();
  verifier(depart.ok, 'la partie démarre');
  verifier(salon.sieges[2].humain === false, 'le siège libre est tenu par un virtuel',
    'nommé ' + salon.sieges[2].nom);

  const toutes = (g) => {
    const ids = g.deck.map((c) => c.id).concat(g.boardCards().map((c) => c.id));
    for (const p of g.players) for (const c of p.hand) ids.push(c.id);
    return ids.sort();
  };
  const auDepart = toutes(salon.partie).join(',');

  let tours = 0;
  let refus = 0;
  let poses = 0;
  let pioches = 0;
  while (!salon.partie.finished && tours < 400) {
    const siege = salon.partie.current;
    verifier(salon.sieges[siege].humain, 'le serveur rend la main à un humain', 'siège ' + siege);
    const etat = salon.etatPour(siege);
    const coup = coupDuClient(etat);
    let r;
    if (coup) {
      r = salon.jouer(siege, coup.board, coup.main);
      if (r.ok) poses++;
      else refus++;
    }
    if (!coup || !r.ok) {
      r = salon.piocher(siege);
      pioches++;
    }
    verifier(r.ok, 'le coup est accepté', r.ok ? '' : r.cle);
    verifier(toutes(salon.partie).join(',') === auDepart,
      'les 104 cartes sont toujours là', 'au tour ' + tours);
    for (const s of salon.partie.board) {
      verifier(Engine.isValidSet(s.cards), 'toute combinaison posée est valide',
        s.cards.map((c) => c.id).join(' '));
    }
    tours++;
    if (echoues) break;          // inutile d'empiler : on s'arrête au premier
  }

  verifier(salon.partie.finished, 'la partie se termine', tours + ' tours');
  console.log('   donne ' + donne + ' : ' + tours + ' tours, ' + poses + ' posés, ' +
              pioches + ' pioches, ' + refus + ' refus');
  const etatFinal = salon.etatPour(0);
  verifier(etatFinal.fini === true, 'l’état final le dit');
  verifier(Array.isArray(etatFinal.mainsFinales),
    'les mains sont révélées à la fin, pour le décompte');
}

/* ---- 3. Un client malhonnête ----------------------------------------- */

section('3. Ce qu’un client modifié ne peut pas faire');
{
  function neuf() {
    const s = new Salon({ places: 2 });
    s.rejoindre('jeton-A', 'Richard');
    s.rejoindre('jeton-B', 'Ami');
    s.demarrer();
    /* On veut la main au siège 0 pour éprouver les refus. */
    while (s.partie.current !== 0 && !s.partie.finished) s.piocher(s.partie.current);
    return s;
  }
  const photo = (s) => JSON.stringify(s.partie.serialize());

  /* a. inventer une carte */
  {
    const s = neuf();
    const avant = photo(s);
    const main = s.etatPour(0).main.slice();
    const absente = ['0-1-0', '0-1-1', '3-13-0', '3-13-1'].find((id) => !main.includes(id));
    const r = s.jouer(0, [[absente, main[0], main[1]]], main.slice(2));
    verifier(!r.ok && r.cle === 'res.cartesInventees', 'poser une carte qu’on n’a pas',
      r.ok ? 'ACCEPTÉ !' : r.cle);
    /* Un refus, jamais une exception : c'est le sabotage du contrôle de
       conservation qui a montré que, sans garde, le moteur tombait sur une
       carte inexistante au lieu de répondre. */
    verifier(typeof r.cle === 'string', '… par un refus, pas par une exception');
    verifier(photo(s) === avant, '… et la partie n’a pas bougé');
  }

  /* b. cacher une carte, pour alléger son score */
  {
    const s = neuf();
    const avant = photo(s);
    const main = s.etatPour(0).main.slice();
    const r = s.jouer(0, [], main.slice(0, 5));
    verifier(!r.ok && r.cle === 'res.cartesInventees', 'faire disparaître des cartes de sa main',
      r.ok ? 'ACCEPTÉ !' : r.cle);
    verifier(photo(s) === avant, '… et la partie n’a pas bougé');
  }

  /* c. dédoubler une carte */
  {
    const s = neuf();
    const main = s.etatPour(0).main.slice();
    const r = s.jouer(0, [[main[0], main[0], main[0]]], main.slice(1));
    verifier(!r.ok && r.cle === 'res.cartesInventees', 'poser trois fois la même carte',
      r.ok ? 'ACCEPTÉ !' : r.cle);
  }

  /* d. jouer à la place d'un autre */
  {
    const s = neuf();
    const main = s.etatPour(1).main.slice();
    const r = s.jouer(1, [], main);
    verifier(!r.ok && r.cle === 'res.pasVotreTour', 'jouer quand ce n’est pas son tour',
      r.ok ? 'ACCEPTÉ !' : r.cle);
  }

  /* e. poser une combinaison qui n'en est pas une */
  {
    const s = neuf();
    const avant = photo(s);
    const main = s.etatPour(0).main.slice();
    const r = s.jouer(0, [[main[0], main[1]]], main.slice(2));
    verifier(!r.ok, 'poser une combinaison invalide', r.ok ? 'ACCEPTÉ !' : r.cle);
    verifier(Array.isArray(r.cartes) && r.cartes.length === 2,
      '… le refus désigne les cartes fautives, pas une phrase',
      JSON.stringify(r.cartes));
    verifier(photo(s) === avant, '… et la partie n’a pas bougé');
  }

  /* f. messages difformes */
  {
    const s = neuf();
    const difformes = [
      ['pas une liste', []],
      [[['ok']], 'pas une liste'],
      [[[{ id: 'objet' }]], []],
      [[new Array(200).fill('0-1-0')], []]
    ];
    let tous = true;
    for (const [board, main] of difformes) {
      const r = s.jouer(0, board, main);
      if (r.ok) tous = false;
    }
    verifier(tous, 'un message difforme est écarté sans rien casser');
    verifier(s.partie && !s.partie.finished, '… et le salon tient toujours debout');
  }
}

/* ---- 4. Reprise après coupure ---------------------------------------- */

section('4. Reprise');
{
  const salon = new Salon({ places: 3 });
  const a = salon.rejoindre('jeton-A', 'Richard');
  const b = salon.rejoindre('jeton-B', 'Ami');
  verifier(a.siege === 0 && b.siege === 1, 'chacun reçoit une place');
  salon.demarrer();

  salon.quitter('jeton-A');
  verifier(salon.sieges[0].connecte === false, 'un départ est noté');

  const retour = salon.rejoindre('jeton-A', 'QuelqueChoseDAutre');
  verifier(retour.ok && retour.siege === 0 && retour.reprise === true,
    'le jeton rend sa place, et son nom', salon.sieges[0].nom);
  verifier(salon.sieges[0].nom === 'Richard', '… sans se laisser renommer');

  /* On entre désormais dans une partie commencée s'il reste un adversaire
     virtuel à relever — c'est l'objet de la section suivante. Ici le salon
     compte trois places pour deux humains, donc un virtuel : le tiers s'y
     assied. Quand il n'en reste plus, la partie est complète. */
  const tiers = salon.rejoindre('jeton-C', 'Tiers');
  verifier(tiers.ok && tiers.siege === 2,
    'un tiers relève le virtuel restant', tiers.ok ? '' : tiers.cle);
  const quatrieme = salon.rejoindre('jeton-D', 'Quatrième');
  verifier(!quatrieme.ok && quatrieme.cle === 'res.salonComplet',
    'mais plus personne ensuite', quatrieme.cle);
}

/* ---- 4 bis. Un joueur qui s'en va ----------------------------------- */

section('4 bis. Quand un joueur quitte la partie');
{
  const salon = new Salon({ places: 3 });
  salon.rejoindre('jeton-A', 'Richard');
  salon.rejoindre('jeton-B', 'Ami');
  salon.demarrer();

  /* On amène la main au siège 1, puis il disparaît. */
  while (salon.partie.current !== 1 && !salon.partie.finished) {
    salon.piocher(salon.partie.current);
  }
  verifier(salon.partie.current === 1, 'la main est au siège qui va partir');

  salon.presence(['jeton-A']);            // B a disparu
  verifier(salon.sieges[1].connecte === false, 'son départ est vu');
  verifier(typeof salon.sieges[1].depuis === 'number', '… et daté');

  const avantMain = salon.partie.players[1].hand.length;
  const tot = salon.relancer(Date.now());
  verifier(!tot.ok && tot.cle === 'res.encoreUnPeu',
    'on ne passe pas son tour tout de suite', tot.ok ? 'PASSÉ !' : tot.cle);
  verifier(salon.partie.current === 1, '… la main lui reste');

  /* Une minute plus tard, la partie ne doit plus attendre. */
  const tard = salon.relancer(Date.now() + 60000);
  verifier(tard.ok, 'après le délai, son tour est passé', tard.ok ? '' : tard.cle);
  verifier(salon.partie.current !== 1 || salon.partie.finished,
    '… et la main a bougé', 'siège ' + salon.partie.current);
  verifier(salon.partie.players[1].hand.length === avantMain + 1,
    '… il a pioché, sa main est intacte à une carte près',
    salon.partie.players[1].hand.length + ' au lieu de ' + (avantMain + 1));

  /* Le chemin qui avait échappé : quitter() marque le siège déconnecté de
     son côté, sans dater. Si presence() ne datait que la transition, elle
     n'avait déjà plus lieu, et le tour ne se passait jamais. */
  {
    const autre = new Salon({ places: 3 });
    autre.rejoindre('jeton-A', 'Richard');
    autre.rejoindre('jeton-B', 'Ami');
    autre.demarrer();
    while (autre.partie.current !== 1 && !autre.partie.finished) {
      autre.piocher(autre.partie.current);
    }
    autre.quitter('jeton-B');                 // le fil tombe, sans date
    verifier(!autre.sieges[1].depuis, 'quitter() ne date pas, c’est son droit');
    autre.presence(['jeton-A']);              // le serveur constate
    verifier(typeof autre.sieges[1].depuis === 'number',
      'le constat date l’absence, même sans transition');
    const apres = autre.relancer(Date.now() + 60000);
    verifier(apres.ok, 'et le tour finit par se passer', apres.ok ? '' : apres.cle);
  }

  /* Et l'on ne passe pas le tour de quelqu'un qui est là. */
  salon.presence(['jeton-A', 'jeton-B']);
  verifier(salon.sieges[1].depuis === null, 'son retour efface la date');
  const present = salon.relancer(Date.now() + 60000);
  verifier(!present.ok, 'on ne passe pas le tour d’un joueur présent',
    present.ok ? 'PASSÉ !' : present.cle);
}

/* ---- 4 ter. Un joueur qui s'en va pour de bon ------------------------ */

section('4 ter. Partir, ce n’est pas se déconnecter');
{
  /* Avant le départ : la place redevient simplement libre. */
  {
    const salon = new Salon({ places: 3 });
    salon.rejoindre('jeton-A', 'Richard');
    salon.rejoindre('jeton-B', 'Ami');
    const r = salon.partir('jeton-B');
    verifier(r.ok && r.salon === true, 'avant le début, partir libère la place',
      r.ok ? '' : r.cle);
    verifier(!salon.sieges[1].jeton && !salon.sieges[1].humain,
      '… et la place est reprenable');
    const reprise = salon.rejoindre('jeton-C', 'Autre');
    verifier(reprise.ok && reprise.siege === 1, '… quelqu’un d’autre peut s’y asseoir');
  }

  /* En cours de partie : tout s'arrête, et l'on dit qui est parti. */
  {
    const salon = new Salon({ places: 3 });
    salon.rejoindre('jeton-A', 'Richard');
    salon.rejoindre('jeton-B', 'Ami');
    salon.demarrer();
    const r = salon.partir('jeton-B');
    verifier(r.ok && r.salon === false, 'en cours de partie, partir l’arrête',
      r.ok ? '' : r.cle);
    verifier(!!salon.abandon && salon.abandon.nom === 'Ami',
      '… et l’on sait qui', JSON.stringify(salon.abandon));

    const etat = salon.etatPour(0);
    verifier(!!etat.abandon, 'l’état le dit aux autres');
    verifier(etat.fini !== true,
      '… sans prétendre que la partie est finie — on n’en compte pas les points');

    /* Et plus personne ne joue. */
    const main = etat.main.slice();
    verifier(salon.piocher(salon.partie.current).cle === 'res.partieAbandonnee',
      'on ne pioche plus');
    verifier(salon.jouer(salon.partie.current, [], main).cle === 'res.partieAbandonnee',
      'on ne pose plus');
    verifier(!salon.relancer(Date.now() + 60000).ok,
      'et il n’y a plus de tour à passer');

    /* La mémoire du serveur la retient abandonnée. */
    const reveille = Salon.deserialiser(JSON.parse(JSON.stringify(salon.serialiser())));
    verifier(!!reveille.abandon, 'le réveil se souvient de l’abandon');
  }

  /* Un jeton inconnu ne fait rien. */
  {
    const salon = new Salon({ places: 2 });
    salon.rejoindre('jeton-A', 'Richard');
    const r = salon.partir('jeton-inconnu');
    verifier(!r.ok, 'un jeton inconnu ne peut pas arrêter la partie des autres', r.cle);
  }
}

/* ---- 4 quater. Relever un adversaire virtuel -------------------------- */

section('4 quater. Un ami prend la place d’un virtuel');
{
  const salon = new Salon({ places: 3 });
  salon.rejoindre('jeton-A', 'Richard');
  salon.demarrer();
  verifier(salon.sieges[1].humain === false && salon.sieges[2].humain === false,
    'deux sièges sont tenus par des virtuels');

  const avant = salon.partie.players[1].name;
  const mains = salon.partie.players.map((p) => p.hand.length);

  const r = salon.rejoindre('jeton-B', 'Ami');
  verifier(r.ok && r.siege === 1, 'un ami muni du code s’assied', r.ok ? '' : r.cle);
  verifier(r.remplace === avant, '… à la place du virtuel, qui est nommé', r.remplace);
  verifier(salon.sieges[1].humain === true && salon.partie.players[1].human === true,
    '… et le siège devient humain des deux côtés');
  verifier(salon.partie.players[1].name === 'Ami', '… sous son propre nom');
  verifier(salon.partie.players[1].hand.length === mains[1],
    '… en héritant de la main telle qu’elle est : c’est une relève',
    salon.partie.players[1].hand.length + ' au lieu de ' + mains[1]);

  /* Et il voit sa main, pas celle d'un autre. */
  const etat = salon.etatPour(1);
  verifier(etat.main.length === mains[1], 'il reçoit sa main en entier');
  const interdites = salon.partie.players[0].hand.map((c) => c.id);
  const texte = JSON.stringify(etat);
  verifier(!interdites.some((id) => texte.includes('"' + id + '"')),
    '… et pas celle des autres');

  /* Le dernier siège reste prenable, puis la partie est complète. */
  const c = salon.rejoindre('jeton-C', 'Autre');
  verifier(c.ok && c.siege === 2, 'le dernier virtuel peut être relevé aussi');
  const d = salon.rejoindre('jeton-D', 'Trop tard');
  verifier(!d.ok && d.cle === 'res.salonComplet', 'une fois pleine, la partie se ferme', d.cle);

  /* Et l'on ne relève personne dans une partie abandonnée. */
  const mort = new Salon({ places: 3 });
  mort.rejoindre('jeton-A', 'Richard');
  mort.demarrer();
  mort.partir('jeton-A');
  const refus = mort.rejoindre('jeton-Z', 'Tard');
  verifier(!refus.ok && refus.cle === 'res.partieAbandonnee',
    'on ne s’assied pas dans une partie abandonnée', refus.cle);
}

/* ---- 5. Mise en veille et réveil -------------------------------------- */

section('5. Mise en veille');
{
  const salon = new Salon({ places: 3 });
  salon.rejoindre('jeton-A', 'Richard');
  salon.rejoindre('jeton-B', 'Ami');
  salon.demarrer();
  for (let i = 0; i < 4 && !salon.partie.finished; i++) salon.piocher(salon.partie.current);

  const avant = salon.etatPour(0);
  const reveille = Salon.deserialiser(JSON.parse(JSON.stringify(salon.serialiser())));
  verifier(!!reveille, 'le salon se reconstitue');
  const apres = reveille.etatPour(0);
  verifier(JSON.stringify(avant) === JSON.stringify(apres),
    'le réveil rend exactement le même état');
  verifier(reveille.sieges[2].humain === false,
    'le siège virtuel le reste au réveil');

  const r = reveille.piocher(reveille.partie.current);
  verifier(r.ok, 'et la partie continue après le réveil', r.ok ? '' : r.cle);
}

/* ---- Verdict ---------------------------------------------------------- */

console.log('\n' + '═'.repeat(58));
console.log(reussis + ' vérifications passées, ' + echoues + ' échouées');
if (ratés.length) {
  console.log('\nÉchecs :');
  for (const r of ratés.slice(0, 12)) console.log('  ✗ ' + r);
}
console.log('═'.repeat(58));
process.exit(echoues ? 1 : 0);
