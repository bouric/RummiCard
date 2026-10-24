/* RummiCard — © 2026 Richard Boulais & Claude */
/* =====================================================================
   validation.js — Un tour proposé par un client est-il honnête ?
   ---------------------------------------------------------------------
   En local, la question ne se posait pas : l'interface est la seule à
   pouvoir déplacer une carte, et elle ne déplace que ce que le joueur
   tient. checkCommit() n'a donc jamais eu besoin de vérifier d'où venaient
   les cartes posées — seulement que la table restait cohérente.

   En réseau, la question se pose. Un client modifié peut envoyer n'importe
   quoi : une carte qu'il n'a pas, une carte en double, une main dont il
   aurait discrètement retiré ses mauvaises cartes.

   Tout cela se referme avec une seule égalité :

       (nouvelle table + nouvelle main) == (ancienne table + ancienne main)

   Rien n'entre, rien ne sort : les cartes n'ont fait que changer de place.
   Comme chaque carte porte un identifiant unique — « 2-7-1 », le pique 7
   du second jeu — comparer les deux listes triées suffit, et attrape du
   même coup le doublon, l'invention et la disparition.

   Le piège, qui nous a déjà coûté une fausse alerte : comparer des objets
   ou des listes dans leur ordre d'arrivée ne marche pas. L'ordre n'a aucun
   sens ici, et les deux exemplaires d'une même carte sont interchangeables
   pour le solveur mais pas pour cette comparaison. On trie, et on trie des
   identifiants.

   Le reste du travail est déjà fait par le moteur : checkCommit() dit si
   les combinaisons tiennent debout et si la règle d'ouverture est
   respectée. On ne la réécrit pas, on l'appelle.
   ===================================================================== */
import { Engine } from './moteur.js';

/* Garde-fous de forme. Un client hostile envoie n'importe quoi, et on ne
   veut pas qu'une liste de dix mille éléments nous occupe. Le jeu compte
   104 cartes : au-delà, inutile de regarder le contenu. */
const CARTES_EN_JEU = 104;
const MAX_PAR_COMBINAISON = 14;

function estListeDIdentifiants(v, maxi) {
  if (!Array.isArray(v) || v.length > maxi) return false;
  for (const x of v) if (typeof x !== 'string' || x.length > 8) return false;
  return true;
}

/** Forme attendue : board = liste de listes d'identifiants, main = liste. */
export function formeValide(board, main) {
  if (!Array.isArray(board) || board.length > CARTES_EN_JEU) return false;
  let total = 0;
  for (const combinaison of board) {
    if (!estListeDIdentifiants(combinaison, MAX_PAR_COMBINAISON)) return false;
    total += combinaison.length;
    if (total > CARTES_EN_JEU) return false;
  }
  return estListeDIdentifiants(main, CARTES_EN_JEU);
}

/* Les identifiants d'une liste de cartes, triés. C'est la forme sous
   laquelle on compare « avant » et « après ». */
function empreinte(...groupes) {
  const ids = [];
  for (const g of groupes) {
    for (const c of g) ids.push(typeof c === 'string' ? c : c.id);
  }
  ids.sort();
  return ids;
}

function memeEmpreinte(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Le tour proposé est-il recevable ?
 *
 * La partie doit être positionnée au tour de `siege` : son instantané de
 * début de tour (partie.snapshot) sert de référence pour « avant ».
 *
 * En cas de refus, la table et la main sont remises comme elles étaient :
 * un client malhonnête ne doit pas pouvoir abîmer la partie en essayant.
 *
 * @param {Object} partie   une Engine.Game faisant autorité
 * @param {number} siege    le joueur qui prétend jouer
 * @param {Array<Array<string>>} board  la table proposée
 * @param {Array<string>} main          la main restante annoncée
 * @returns {{ok: boolean, cle?: string, cartes?: Array<string>}}
 */
export function verifierTour(partie, siege, board, main) {
  if (partie.finished) return { ok: false, cle: 'res.partieFinie' };
  if (siege !== partie.current) return { ok: false, cle: 'res.pasVotreTour' };
  if (!partie.snapshot) return { ok: false, cle: 'res.tourNonCommence' };
  if (!formeValide(board, main)) return { ok: false, cle: 'res.messageInvalide' };

  /* --- 1. Rien n'entre, rien ne sort -------------------------------- */
  const avant = empreinte(
    partie.snapshot.board.flatMap((s) => s.cards),
    partie.snapshot.hand
  );
  const apres = empreinte(board.flat(), main);
  if (!memeEmpreinte(avant, apres)) {
    return { ok: false, cle: 'res.cartesInventees' };
  }

  /* --- 2. Les identifiants désignent-ils les bonnes cartes ? --------
     L'empreinte étant identique, chaque identifiant proposé existe parmi
     les cartes dont ce joueur disposait. On peut donc les retrouver sans
     risque — et surtout sans fabriquer de carte à partir d'une chaîne
     venue du réseau. */
  const parId = new Map();
  for (const s of partie.snapshot.board) for (const c of s.cards) parId.set(c.id, c);
  for (const c of partie.snapshot.hand) parId.set(c.id, c);

  /* Ceinture et bretelles. En principe l'empreinte garantit que chaque
     identifiant est connu ; si jamais elle laissait passer quelque chose,
     parId.get() rendrait `undefined` et le moteur tomberait sur une carte
     sans `.id`. Un serveur qui plante sur une entrée hostile, c'est une
     porte ouverte : on préfère un refus. Vérifié en retirant volontairement
     le contrôle ci-dessus — sans cette garde, le serveur levait une
     exception au lieu de répondre. */
  const inconnu = (id) => !parId.has(id);
  if (main.some(inconnu) || board.some((ids) => ids.some(inconnu))) {
    return { ok: false, cle: 'res.carteInconnue' };
  }

  /* --- 3. On pose, puis on laisse le moteur juger ------------------- */
  partie.board = board.map((ids) => partie.newSet(ids.map((id) => parId.get(id))));
  partie.players[siege].hand = main.map((id) => parId.get(id));
  partie.compact();

  const verdict = partie.checkCommit();
  if (!verdict.ok) {
    /* On désigne la combinaison fautive par ses cartes : le client a le
       moteur et les traductions, il composera la phrase lui-même, dans sa
       langue et avec le bon compte. Le serveur n'a pas à parler. */
    for (const s of partie.board) {
      if (!Engine.isValidSet(s.cards)) {
        partie.restoreTurn();
        return { ok: false, cle: 'res.combinaison', cartes: s.cards.map((c) => c.id) };
      }
    }
    partie.restoreTurn();
    return { ok: false, cle: verdict.reason };
  }

  return { ok: true };
}
