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

  const tiers = salon.rejoindre('jeton-C', 'Intrus');
  verifier(!tiers.ok && tiers.cle === 'res.partieCommencee',
    'on n’entre pas dans une partie commencée', tiers.cle);
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
