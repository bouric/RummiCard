/* RummiCard — © 2026 Richard Boulais & Claude */
/* =====================================================================
   moteur.js — Les règles du jeu, côté serveur
   ---------------------------------------------------------------------
   On ne recopie rien. Les fichiers du client sont des fonctions
   immédiatement appelées qui s'attachent à `root` — `window` dans un
   navigateur, `globalThis` partout ailleurs. Ils tournent donc ici sans
   la moindre adaptation.

   C'est la propriété qui tient tout ce serveur debout : il n'existe qu'un
   seul exemplaire des règles, et les deux côtés ne pourront jamais
   diverger. Un bogue corrigé dans engine.js l'est des deux côtés le jour
   même.

   Conséquence agréable : I18N n'est pas chargé, et le moteur le sait. Ses
   refus reviennent alors sous forme de clés de traduction brutes —
   « err.posezCarte » et non « Posez au moins une carte ». Le serveur reste
   donc muet en matière de langue, et chaque joueur lit le refus dans la
   sienne.

   L'ordre des importations compte : ai.js lit root.Engine et root.Solver
   dès son exécution.
   ===================================================================== */
import '../Resources/web/engine.js';
import '../Resources/web/solver.js';
import '../Resources/web/ai.js';

export const Engine = globalThis.Engine;
export const Solver = globalThis.Solver;
export const AI = globalThis.AI;

if (!Engine || !Solver || !AI) {
  throw new Error('moteur.js : les fichiers du jeu ne se sont pas attachés à globalThis');
}
