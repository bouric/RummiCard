# Le serveur de parties

Permet à plusieurs personnes de jouer ensemble, chacune sur son appareil.
C'est l'étape 1 et 2 de [l'étude](../docs/multijoueur-2026-10-24.md) : le
serveur et sa validation. **Le client ne s'en sert pas encore** — le jeu
solo n'est pas touché d'une ligne.

## Éprouver, sans rien installer

```bash
node serveur/essais.js
```

Aucun compte, aucun réseau, aucune dépendance : les essais jouent des
parties complètes dans le terminal et vérifient le secret des mains, la
conservation des 104 cartes, et ce qu'un client malhonnête ne peut pas
faire.

## Les fichiers

| fichier | rôle |
|---|---|
| `moteur.js` | importe `engine.js`, `solver.js` et `ai.js` du jeu, tels quels |
| `validation.js` | un tour proposé par un client est-il honnête ? |
| `salon.js` | une partie et ses joueurs — toute la logique, sans réseau |
| `partie.js` | l'enveloppe WebSocket (Cloudflare Durable Object) |
| `essais.js` | les essais, à lancer avec `node` |

Les règles ne sont écrites **qu'une fois** : `moteur.js` importe les
fichiers du client sans les recopier. Un correctif dans `engine.js` vaut
des deux côtés le jour même, et les deux ne peuvent pas diverger.

## Déployer (le jour venu)

```bash
cd serveur && npx wrangler deploy
```

La formule gratuite de Cloudflare suffit très largement : une partie de
cent tours coûte une dizaine de requêtes sur les 100 000 quotidiennes. Voir
le § 10 de l'étude pour les chiffres et leur source.

## Ce qui reste à faire

Le client (étape 3). Aujourd'hui `ui.js` est le maître de la partie ; en
réseau il devient le reflet d'un état reçu. Voir le § 8 de l'étude.

Un client qui s'appuierait sur le solveur pour jouer doit **réattribuer les
exemplaires** avant d'envoyer sa table : les deux exemplaires d'une carte
sont interchangeables pour le solveur, mais le serveur vérifie par
identifiant que toutes les cartes de la table y sont restées.
`normaliserExemplaires()` dans `essais.js` montre comment.
