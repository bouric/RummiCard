# RummiCard

Les règles du **Rummikub** jouées avec **2 jeux de 52 cartes** (104 cartes),
en application macOS native. Un joueur réel, de 1 à 5 joueurs virtuels.

<img src="docs/icon.png" width="128" alt="Icône RummiCard : deux cartes sur tapis vert">

## Installer et lancer

```bash
./build.sh
```

Le script compile l'hôte natif, génère l'icône, assemble le bundle dans
`build/` puis l'**installe dans `/Applications`** en remplaçant la version
précédente (il ferme l'app au passage si elle tourne). Il ne laisse
volontairement aucun bundle dans le dossier du projet : deux copies du même
`.app` sur le disque, et macOS affiche deux icônes dans le Launchpad et
Spotlight.

```bash
open /Applications/RummiCard.app
./build.sh --no-install    # garde l'app dans build/, sans toucher à /Applications
```

Aucune dépendance : seulement les *Command Line Tools* d'Xcode déjà installés
(`swiftc`, `iconutil`), pour un bundle de ≈680 Ko.

## Les règles

- 104 cartes : 4 couleurs (♠ ♥ ♦ ♣) × 13 valeurs × 2 exemplaires.
  As = 1, Valet = 11, Dame = 12, Roi = 13.
- **Groupe** : 3 ou 4 cartes de même valeur, toutes de couleurs différentes.
- **Suite** : 3 cartes ou plus de même couleur, de valeurs consécutives.
  L'As se place **avant le 2 ou après le Roi** : `A-2-3` et `D-R-A` sont deux
  suites valides. La boucle reste interdite : `R-A-2` n'en est pas une. Les deux
  usages peuvent coexister dans une même couleur, avec les deux exemplaires.
- 14 cartes distribuées à chacun.
- À chaque tour, il faut poser **au moins une carte** de sa main — n'importe où,
  y compris sur les combinaisons déjà sur la table. **Pas de minimum de points
  à la première pose** (variante retenue ici ; le Rummikub officiel en impose 30).
- La table entière peut être réorganisée librement, à condition que toutes les
  combinaisons soient valides à la fin du tour : on peut prendre une carte d'une
  combinaison posée (le 4ᵉ d'un carré, par exemple) pour la glisser sur une autre.
- Rien à poser → on pioche et le tour passe.
- Une combinaison invalide est **cerclée de rouge** (à ne pas confondre avec
  l'anneau doré des cartes posées pendant le tour) et le bandeau la nomme en
  expliquant ce qui cloche : *« 5♠ 6♠ : il manque 1 carte (3 minimum). »*
- Le premier à vider sa main gagne ; pioche épuisée, c'est le moins de points.

## Disposition de la table

- Les **suites** s'affichent **verticalement**, cartes décalées façon tableau de
  solitaire : seul le coin (valeur + couleur) de chaque carte dépasse, la
  dernière est entière. Une suite de 13 cartes reste donc compacte.
- Les **groupes** (brelans et carrés) s'affichent **horizontalement**, en ligne.
- En *table rangée*, le décalage vaut exactement une ligne de la graduation :
  les cartes d'une suite tombent donc pile sur les lignes de leurs valeurs.
- Sur **écran tactile**, ce décalage passe de 28 % à 40 % de la hauteur d'une
  carte : la bande qui dépasse — seule prise pour attraper une carte au milieu
  d'une suite — gagne 44 %, sans réduire les cartes ni provoquer de défilement.

L'orientation est déduite du contenu et bascule en direct, y compris pendant
l'aperçu d'un glisser-déposer : deux cartes de même couleur à la suite passent
la combinaison en colonne, deux cartes de même valeur la passent en ligne.

## Le placement automatique

C'est le cœur de l'interface :

| Geste | Effet |
|---|---|
| Glisser une carte vers la table | L'emplacement exact s'affiche en direct (case en pointillés) et la carte s'y pose toute seule, même si on la lâche loin de la bonne combinaison. |
| Glisser une carte qui ne rentre nulle part | Elle ouvre une **nouvelle combinaison** : à vous de réarranger la table. Une option confie cette réorganisation au jeu (✨ : `4♠5♠6♠7♠8♠` + un second `6♠` devient `4♠5♠6♠` + `6♠7♠8♠`, aperçu avant de lâcher), mais il décide alors quelles combinaisons casser — c'est une aide forte, désactivée par défaut. |
| Clic simple sur une carte de la main | Placement automatique au meilleur endroit. |
| Glisser vers sa main une carte posée ce tour-ci | On la récupère. |
| **💡 Indices** | Met en avant les cartes du **meilleur coup** du tour — celui que « Jouer au mieux » jouerait — sans dire où les poser. Aide intermédiaire entre chercher seul et laisser jouer la machine. Ces cartes forment un coup cohérent : elles se posent toutes ensemble, et l'indication se met à jour au fur et à mesure. |
| **✨ Jouer au mieux** | Calcule et joue le coup maximal du tour. |
| **↩ Annuler** | Défait vos mouvements **un par un**, dans l'ordre inverse. |
| Suites qui se suivent | Deux suites de même couleur contiguës (…5♠ et 6♠…) sont **réunies automatiquement** : le solveur en produit souvent deux là où une seule suffit. |
| Suite amputée | Retirer une carte au milieu d'une suite la **scinde en deux** : `A♣…9♣` moins le `6♣` devient `A♣2♣3♣4♣5♣` et `7♣8♣9♣`, deux suites valides, au lieu d'une seule combinaison trouée dont le manque serait invisible. |
| Couper une suite | Déposez une carte **au milieu d'une colonne** : la suite est coupée à cet endroit et occupe les deux colonnes de sa couleur. Les deux morceaux doivent garder trois cartes. |
| Soulever une carte | La table **ne se resserre pas** : l'emplacement libéré reste visible, donc ce que vous visiez ne bouge pas sous le curseur. |
| **⟲ Revenir avant l'IA** | Annule le dernier coup des joueurs virtuels : la partie repart du début de votre tour précédent, dans l'état exact (mains, table, pioche). Plusieurs appuis remontent plus loin. |

Raccourcis : `Entrée` valider · `⌫` annuler · `P` piocher · `A` jouer au mieux ·
`T` trier · `I` indices · `R` revenir avant l'IA. Les mêmes commandes sont dans le menu
**Partie** (⇧⌘Z pour annuler le coup de l'IA).

## Architecture

```
Sources/main.swift        hôte natif AppKit + WKWebView (fenêtre, menus macOS)
Tools/makeicon.swift      dessin vectoriel de l'icône (toutes les tailles)
Resources/web/
  solver.js               solveur Rummikub exact (programmation dynamique)
  engine.js               cartes, combinaisons, règles, déroulement de partie
  ai.js                   joueurs virtuels + assistance au placement
  ui.js                   rendu, glisser-déposer, animations FLIP
  index.html / style.css
  sw.js                   cache hors ligne (ignoré par l'app macOS)
  manifest.webmanifest    nom, icônes et plein écran pour l'écran d'accueil
  icons/                  icônes 180 / 192 / 512 px
build.sh                  compilation + assemblage du bundle .app
serve.sh                  sert le jeu sur le réseau local (iPad, téléphone)
netlify.toml              déploiement en page statique
```

### Le solveur

`solver.js` résout le vrai problème du Rummikub : *partitionner l'ensemble des
cartes de la table plus un sous-ensemble d'une main en combinaisons valides, en
maximisant le nombre (ou la somme) des cartes posées.*

Programmation dynamique sur les valeurs 1 → 14, la 14ᵉ étant l'As placé après
le Roi. Comme les deux emplacements de l'As se disputent les mêmes cartes, le
solveur énumère, par couleur, le nombre d'As joués haut (0, 1 ou 2) et garde la
meilleure partition ; les couleurs sans Dame ni Roi disponibles sont écartées
d'office, et l'énumération s'arrête dès qu'une variante pose toute la main. L'état retient, pour chacune des
4 couleurs, le nombre de suites en cours se terminant à la valeur précédente,
selon leur longueur (1, 2, ou ≥ 3) ; comme chaque carte n'existe qu'en deux
exemplaires, ces trois compteurs totalisent au plus 2, ce qui borne l'espace
d'états. À chaque valeur, on énumère les groupes formables (21 configurations)
puis, couleur par couleur, la répartition des cartes entre prolongation de
suites, nouvelles suites et groupes.

Mesures : ~6 ms en moyenne sur un tour de fin de partie (70 cartes sur la table,
14 en main), 18 ms au pire ; 385 ms sur le cas artificiel des 104 cartes
étalées. C'est ce même solveur qui alimente les
joueurs virtuels, le bouton « Jouer au mieux » et la réorganisation automatique
pendant un glisser-déposer.

## Son

Tout est synthétisé à la volée (Web Audio), sans aucun fichier : un claquement
bref quand une carte se pose, un arpège quand la table se réorganise, une
fanfare à la victoire, et un **« hmm » pensif quand un joueur pioche** —
fredonnement grave bouche fermée (110 Hz), hauteur qui monte puis retombe, léger
vibrato, identique pour tous les joueurs. La version « je passe », faute de
pioche, est plus grave et plus traînante. Le haut-parleur de l'en-tête coupe l'ensemble.

## Jouer sur iPad

Le jeu est une page web sans dépendance : il tourne tel quel dans Safari, au
doigt. Les cartes se glissent au toucher (`touch-action` neutralisé sur les
cartes, geste interrompu par le système correctement rendu), le zoom par
double-tap est désactivé et la mise en page tient en paysage sur un iPad 10,2"
comme sur un 11". Ajouté à l'écran d'accueil, il s'ouvre en plein écran, sans
barre d'adresse, avec son icône.

**Essai immédiat, sans rien installer** — le Mac sert la page sur le Wi-Fi :

```bash
./serve.sh
```

Le script affiche l'adresse à ouvrir sur l'iPad. Le Mac doit rester allumé.

**Adresse permanente** — n'importe quel hébergeur de fichiers statiques
convient ; `netlify.toml` est déjà configuré (dossier publié :
`Resources/web`, rien à compiler). Sur Cloudflare Pages : commande de build
vide, dossier de sortie `Resources/web`. Un *service worker* met les onze
fichiers en cache, donc une fois la page ouverte **le jeu fonctionne sans
réseau** et se met à jour tout seul au prochain passage en ligne. Un
`robots.txt` et une balise `noindex` tiennent la page à l'écart des moteurs de
recherche.

## Couleur du tapis

La palette de l'en-tête fait défiler six teintes de feutre — vert, bleu nuit,
bordeaux, ardoise, prune, tabac — appliquées par variables CSS et conservées
d'une partie à l'autre comme les autres réglages.

## Options

Accessibles par l'engrenage (ou ⌘, / menu **Partie ▸ Options**), conservées
d'une partie à l'autre — l'hôte natif les range dans les préférences de l'app,
le navigateur dans son `localStorage`.

- **Aide au placement** : *me laisser chercher* (par défaut) — une carte qui ne
  rentre nulle part ouvre une nouvelle combinaison — ou *réorganiser la table
  pour moi*, qui refait la table toute seule pour accueillir la carte.
- **Tri de la main** : *par valeur puis couleur* (`A A 2 2 3 3…`) ou *par valeur
  dans les couleurs* (toute une couleur dans l'ordre, puis la suivante).
- **Table rangée** (par défaut) : le tapis est coupé en deux — les **suites à
  gauche**, les **brelans et carrés à droite**.

  À gauche, l'axe vertical vaut la **valeur des cartes** : l'As tout en haut, le
  Roi en bas, puis une **14ᵉ ligne** pour l'As joué après le Roi, avec sa règle
  graduée. Une suite se place donc en fonction de
  ses valeurs, et lui ajouter une carte par le bas la fait remonter d'une ligne
  sans déplacer les cartes déjà posées.

  Les colonnes y sont **fixes : deux par couleur, toujours au même endroit**,
  repérées par leur symbole. Deux suites qui ne se croisent pas (♦2-3-4 et
  ♦9-10-V par exemple) partagent la même colonne, à condition de laisser la
  place à la dernière carte de celle du dessus, qui est affichée en entier.
  Quand les deux colonnes d'une couleur sont prises, la suite part dans une
  **colonne d'appoint** à droite plutôt que d'en recouvrir une autre : les
  combinaisons restent alignées sur leurs valeurs et jamais superposées.

  À droite, **une case fixe par valeur**, de l'As au Roi : sept lignes puis la
  colonne suivante. La case d'une valeur est dessinée même vide, donc on sait
  toujours où regarder, et les cartes ne se recouvrent jamais de ce côté. Un
  second groupe de même valeur (possible avec deux jeux) se range dans une
  colonne d'appoint, sur la ligne de sa valeur.

  L'autre réglage, *table libre*, laisse les combinaisons se suivre au fil des
  coups.

## Version

Le numéro de version est l'**horodatage de compilation** : `build.sh` écrit
`AAAA.MM.JJ.HHMM` dans `CFBundleShortVersionString` et la date lisible dans
`RCBuildDate`. L'hôte natif les injecte dans la page, qui les affiche en bas de
l'écran d'accueil ; le menu **RummiCard ▸ À propos** les reprend aussi.

## Développement

Le jeu est du JavaScript sans dépendance : on peut l'ouvrir directement dans un
navigateur pour itérer sans recompiler.

```bash
python3 -m http.server 8777 --directory Resources/web
```

`window.RC` expose l'état de la partie (`RC.game`, `RC.render()`,
`RC.setVirtual(n)`, `RC.newGame()`) pour scripter des situations de test.

---

© 2026 Richard Boulais & Claude
