# Jouer à plusieurs, en ligne — étude

*24 octobre 2026*

Comment passer d'un jeu où un humain affronte des adversaires virtuels à un jeu
où plusieurs humains jouent ensemble, chacun sur son appareil. Ce document dit
ce que le code donne déjà, ce qui manque, où héberger ce qui manque, et dans
quel ordre s'y prendre.

Les chiffres de ce document sont de deux sortes, et je les distingue partout :
ceux que j'ai **mesurés** sur ce Mac, et ceux que j'ai **lus** sur les pages
officielles des hébergeurs. Rien n'est de mémoire.

---

## 1. Ce que le code donne déjà

Quatre propriétés du code actuel rendent l'affaire beaucoup plus simple qu'elle
n'en a l'air. Elles n'ont pas été écrites pour ça — c'est une chance, et il faut
en profiter.

### Le moteur tourne hors navigateur

`engine.js`, `solver.js` et `ai.js` s'attachent à `root`, qui vaut `window` dans
un navigateur et `globalThis` ailleurs. Vérifié :

```
window defini ?        undefined
I18N charge ?          undefined
partie creee           : 3 joueurs, 62 cartes en pioche
refus sans carte posee : {"ok":false,"reason":"err.posezCarte"}
```

**Un serveur peut donc faire tourner exactement les mêmes règles que le client,
sans réécrire une ligne.** C'est la propriété la plus précieuse de tout ce
document : les règles ne pourront jamais diverger entre les deux, puisqu'il n'y
en a qu'un seul exemplaire.

Mieux : les refus reviennent sous forme de **clés de traduction**
(`err.posezCarte`), pas de phrases. Le serveur reste donc muet en matière de
langue, et chaque joueur lit le refus dans la sienne. Un serveur neutre pour six
langues, gratuitement.

### L'interface ne regarde jamais les cartes des autres

C'est la deuxième trouvaille, et elle décide de l'ampleur du chantier. Dans tout
`ui.js`, la main d'un autre joueur n'est lue que par sa **longueur** :

| ligne | ce qui est lu |
|---|---|
| [ui.js:1370](../Resources/web/ui.js:1370) | `p.hand.length` — l'éventail de dos, six au plus |
| [ui.js:1380](../Resources/web/ui.js:1380) | `p.hand.length` — « 9 cartes » |
| [ui.js:1414](../Resources/web/ui.js:1414) | `p.hand.length` — le bandeau compact |
| [ui.js:2815](../Resources/web/ui.js:2815) | `handScore(p)` — **le seul endroit où les cartes comptent, et c'est après la fin** |

Autrement dit, l'affichage est **déjà** celui d'un jeu en réseau : il n'a jamais
eu besoin de savoir ce que tenaient les autres. Il n'y a donc presque rien à
changer côté rendu. Le travail est dans l'enchaînement des tours, pas dans le
dessin.

### Il existe déjà un format transmissible

`Game.serialize()` transforme une partie en cartes-identifiants :

```
n, names, board, hands, melded, deck, current, passStreak, turnCount, deal
```

C'est presque le protocole réseau — à ceci près que **trois de ces champs ne
doivent jamais partir chez un joueur** : `hands`, `deck` et `deal`. J'y reviens
au § 2.

### Le tour a un point de validation unique

`checkCommit()` dit si un tour tient debout, et `commit()` le valide. Tout passe
par là. Il n'y a pas dix endroits à intercepter : il y en a un.

---

## 2. Les trois choses à résoudre

### Le secret des mains

C'est le vrai problème, et il interdit la solution qui paraît la plus simple.

La donne est **déterministe** : `deal.order` contient les 104 cartes dans
l'ordre, et c'est ce qui permet « Même donne ». Conséquence : **quiconque reçoit
la donne connaît la main de tout le monde**, pour toute la partie. Il ne s'agit
pas d'obscurcir un peu — il s'agit de ne jamais l'envoyer.

Même chose pour la pioche : l'ordre des cartes à venir est connu d'avance. Un
joueur qui le verrait saurait ce qu'il tirera dans trois tours.

Il faut donc que **la donne et la pioche vivent quelque part où aucun joueur ne
peut les lire**. Cela exclut le pair-à-pair naïf, et cela exclut de confier la
partie à l'appareil d'un des joueurs sans conséquence (§ 3).

J'ai mesuré ce que coûte un état **expurgé** — votre main en entier, celles des
autres réduites à leur compte, la pioche à son compte, la donne jamais transmise
— sur une table de 56 cartes :

| | taille |
|---|---|
| `serialize()` complet | 2 525 octets (contient `hands`, `deck` **et** `deal`) |
| état expurgé | **905 octets** |

Une partie de cent tours à quatre joueurs, c'est de l'ordre de 350 Kio dans le
sens descendant. Le trafic n'est un problème pour personne.

### L'autorité

Si chaque client calcule son propre état, deux clients peuvent diverger — et
l'un d'eux peut mentir. Il faut un arbitre : quelqu'un qui détient la vérité,
valide les coups et annonce le résultat.

### La reprise

Un téléphone s'endort, un tunnel coupe le réseau, et l'app doit retrouver la
partie en cours. Ce n'est pas un raffinement : sur iPhone, c'est le cas normal.
Il faut que l'arbitre garde l'état et qu'un client puisse se rebrancher dessus.

---

## 3. Pourquoi il faut un petit serveur

J'ai regardé les solutions sans serveur, parce que ce serait évidemment le plus
simple. Aucune ne tient.

**Pair-à-pair pur (WebRTC).** Deux navigateurs se parlent directement. Mais il
faut quand même un service pour les présenter l'un à l'autre, et il faut
quelqu'un pour détenir la pioche. Si c'est un des joueurs, il voit tout. Entre
amis on peut l'accepter — sauf que celui qui héberge voit aussi *sa propre*
pioche à venir, ce qui n'est plus un détail de confiance mais un avantage
mécanique. Et si l'hôte quitte, la partie meurt. À cela s'ajoute que les
connexions directes échouent derrière certains réseaux et qu'il faut alors un
relais, qui n'est pas gratuit.

**Échange de codes.** Chacun copie-colle un état de partie à son tour. Sans
serveur, mais le code contient tout, donc plus aucun secret. Et le confort est
celui du courrier postal.

**Un service de synchronisation seul** (une base temps réel, sans code à soi).
Possible, mais pour garder les mains secrètes il faudrait des règles d'accès
ligne à ligne, et surtout quelqu'un pour **valider** les coups. Une base ne sait
pas dire « cette suite est invalide ». On finirait par écrire la validation
quelque part : autant que ce soit un serveur.

**Conclusion : il faut un petit serveur.** La bonne nouvelle, c'est qu'il est
vraiment petit — il ne fait qu'héberger `engine.js` et distribuer des états
expurgés — et qu'il peut être gratuit.

---

## 4. Où héberger, en octobre 2026

Le paysage vient de bouger, et dans le mauvais sens pour deux options que
j'aurais recommandées il y a un mois :

- **PartyKit**, taillé exactement pour ça, a **fermé son service hébergé le
  23 octobre 2026** — avant-hier. Son successeur, PartyServer, est une
  bibliothèque qui tourne sur votre propre compte Cloudflare.
- **Deno Deploy** ferme : l'équipe Deno a rejoint Cloudflare le 9 octobre 2026,
  et le service hébergé s'arrête environ six mois plus tard. À éviter pour
  commencer quelque chose.

Ce qui laisse, en pratique :

| | ce que c'est | gratuit ? | pour ce jeu |
|---|---|---|---|
| **Cloudflare Workers + Durable Objects** | un petit objet serveur par partie, avec WebSocket | oui, voir § 10 | **le bon choix** |
| Supabase Realtime | une base temps réel, sans code à soi | 200 connexions, 2 M messages/mois | pas de validation, secret difficile |
| Fly.io, Render, Railway | une vraie machine | non, ou avec mise en veille | surdimensionné |

**Cloudflare Workers + Durable Objects** correspond à ce jeu presque trop bien :
un *Durable Object* est un petit serveur à état, identifié par un nom — et
« une partie » est exactement ça. Une partie = un objet. L'objet détient la
pioche, valide les coups, et parle à ses joueurs par WebSocket.

---

## 5. L'architecture proposée

```
   iPhone  ─┐
   iPad    ─┼── wss ──►  Durable Object « partie 4F2K »
   Mac     ─┘                 │
                              ├─ engine.js  (les mêmes règles que le client)
                              ├─ ai.js      (pour les sièges vides)
                              └─ la donne, la pioche, les mains  ← ne sortent jamais

   Les fichiers du jeu restent sur GitHub Pages. Rien ne change de ce côté.
```

Le site reste **exactement où il est** : des fichiers statiques sur GitHub
Pages. Seul s'ajoute un WebSocket vers le Worker. L'app macOS continue de
charger ses fichiers en local et ouvre le même WebSocket.

Trois conséquences agréables :

1. Le jeu solo contre les adversaires virtuels **ne change pas du tout**. Pas de
   serveur, pas de réseau, pas de régression possible. Le mode réseau s'ajoute à
   côté.
2. Les sièges vides peuvent être tenus par des adversaires virtuels, **côté
   serveur**, avec le même `ai.js`. « Deux amis et un virtuel » marche sans rien
   de plus.
3. Le serveur ne parle aucune langue : il renvoie des clés, le client traduit.

---

## 6. Le protocole

Quatre messages montants, trois descendants. C'est tout.

**Le client dit :**

```js
{ t:'rejoindre', partie:'4F2K', nom:'Richard' }
{ t:'jouer', board:[['0-7-1','1-7-0','2-7-1'], ...], main:['3-11-0', ...] }
{ t:'piocher' }
{ t:'passer' }
```

Le message `jouer` envoie **la table proposée et la main restante**, pas une
liste de gestes. C'est volontaire : le joueur réorganise librement le tapis
pendant son tour, et décrire ça comme une suite d'opérations serait inutilement
compliqué. Un état complet fait moins d'un kilo-octet (§ 2) ; autant l'envoyer.

**Le serveur dit :**

```js
{ t:'etat', vous:2, courant:0, noms:[...], board:[[...]], main:[...],
  mains:[14,9,7], pioche:31, melded:[true,false,true] }
{ t:'refus', cle:'err.cartesTable', cartes:[...] }
{ t:'fin', gagnant:1, mains:[[...]], scores:[...] }
```

Remarquez `mains:[14,9,7]` — des **comptes**, pas des cartes. C'est tout ce dont
l'interface a besoin (§ 1), jusqu'à la fin de partie où les vraies mains
arrivent pour le décompte.

Le `refus` porte une clé de traduction, que le client passe à `I18N.t()`. Un
détail à corriger au passage : aujourd'hui `whyInvalid` renvoie parfois une
phrase mi-traduite (`"3♠ V♠ : err.manque."`). Le serveur devra renvoyer la clé
**et** les identifiants des cartes, et laisser le client composer la phrase.

---

## 7. La validation qui manque

`checkCommit()` vérifie déjà beaucoup :

- qu'au moins une carte a été posée ;
- que toutes les cartes qui étaient sur la table y sont encore ;
- que toutes les combinaisons sont valides ;
- que sur une table vierge, la partie s'ouvre par une suite.

Il **ne vérifie pas** que les cartes ajoutées viennent bien de la main du
joueur — et c'est normal : en local, l'interface est la seule à pouvoir déplacer
des cartes, donc la question ne se pose pas. En réseau, elle se pose : un client
modifié pourrait poser une carte qu'il n'a pas.

Le contrôle manquant tient en une ligne de principe :

```
multiensemble(nouvelle table) ∪ multiensemble(nouvelle main)
      ==
multiensemble(ancienne table) ∪ multiensemble(ancienne main du joueur)
```

Si les deux multiensembles sont égaux, rien n'a été inventé et rien n'a été
caché. Avec `checkCommit()` par-dessus, le tour est honnête. C'est une quinzaine
de lignes, et elle se teste hors navigateur, contre le moteur existant, sans
interface.

> Attention au piège qui nous a déjà eus : les deux exemplaires d'une carte sont
> interchangeables, donc la comparaison doit porter sur un **multiensemble
> trié**, pas sur une liste ordonnée ni sur un `JSON.stringify`.

---

## 8. Ce qu'il faut écrire

| où | quoi | ampleur |
|---|---|---|
| `serveur/partie.js` | le Durable Object : salon, WebSocket, tours, diffusion | ~250 lignes |
| `serveur/validation.js` | le contrôle du § 7 | ~20 lignes |
| `serveur/wrangler.toml` | la configuration de déploiement | ~15 lignes |
| `Resources/web/reseau.js` | la couche cliente : connexion, reprise, envoi | ~150 lignes |
| `Resources/web/ui.js` | mode réseau : l'état vient du serveur au lieu du moteur local | **le gros morceau** |
| `Resources/web/i18n.js` | les nouvelles phrases × 6 langues | ~25 clés |
| `Resources/web/index.html` | `connect-src` dans la CSP, écran d'invitation | petit |

Le point dur est `ui.js`, et il mérite d'être nommé précisément. Aujourd'hui,
`game` est **la source de vérité** : l'interface le modifie, puis se redessine
d'après lui. En réseau, `game` devient un **reflet** : on le reconstruit à partir
de l'état reçu, on le laisse être modifié localement pendant son propre tour
(c'est ce qui fait marcher « Annuler », qui reste purement local), puis on envoie
le résultat et on attend le nouvel état.

Cette bascule est moins violente qu'elle n'en a l'air, parce que c'est déjà
presque le fonctionnement : `beginTurn()` photographie l'état en début de tour,
le joueur bricole, `commit()` tranche. Le réseau ne fait qu'éloigner le `commit`.

Deux détails à ne pas oublier, tirés de la documentation de Cloudflare :

- **un déploiement de code coupe tous les WebSockets.** Le client doit savoir se
  rebrancher tout seul, sans quoi chaque mise à jour tue les parties en cours ;
- **`setTimeout` et `setInterval` empêchent la mise en veille** de l'objet, donc
  font payer du temps. Pas de minuterie de tour pour commencer.

---

## 9. Les étapes

Découpées pour qu'on puisse **s'arrêter à la fin de n'importe laquelle** sans
avoir rien cassé.

1. **Le serveur, sans interface.** Un Worker qui tient une partie et parle en
   WebSocket. On l'éprouve avec un script de vingt lignes qui joue trois joueurs
   en ligne de commande. Rien ne touche au jeu existant.
2. **La validation du § 7**, testée hors navigateur contre le moteur — c'est
   exactement la méthode qui a marché pour la réduction du solveur.
3. **Le client réseau.** La partie longue. À la fin, deux navigateurs ouverts
   côte à côte sur le même Mac jouent l'un contre l'autre.
4. **L'invitation.** Un code dans l'adresse, `#partie=4F2K`, qu'on envoie par
   message. Un écran pour créer ou rejoindre.
5. **Les sièges vides**, tenus par `ai.js` côté serveur.
6. **La reprise** : rebranchement automatique après une coupure ou un
   déploiement.

Après l'étape 3, c'est jouable. Les étapes 4 à 6 sont du confort — mais la 6 est
le confort sans lequel on ne joue pas depuis un téléphone.

---

## 10. Ce que ça coûte

Chiffres **officiels**, lus sur la page de tarification de Cloudflare (mise à
jour le 18 octobre 2026), formule gratuite :

| | formule gratuite |
|---|---|
| requêtes | 100 000 / jour |
| durée | 13 000 Go-s / jour |
| lignes écrites | 100 000 / jour |
| stockage | 5 Go au total |

Avec trois précisions qui comptent :

- les **messages WebSocket entrants sont comptés 20 pour 1** ; les sortants sont
  gratuits ;
- l'**API de mise en veille** (*WebSocket Hibernation*) fait que l'objet ne coûte
  rien pendant qu'il attend. C'est décisif : dans un jeu au tour par tour,
  l'objet passe l'essentiel de son temps à attendre que quelqu'un réfléchisse.
  La documentation le dit expressément pour les messages « transmis
  occasionnellement, à intervalles espacés » — c'est exactement notre cas ;
- la formule gratuite n'autorise que les objets adossés à SQLite. Sans
  conséquence ici.

**Mon calcul, pas celui de la documentation** : une partie de cent tours à quatre
joueurs coûte environ cent messages entrants, soit cinq requêtes facturées, plus
une par connexion. Disons dix requêtes. Avec 100 000 requêtes par jour, cela
laisse de la place pour des milliers de parties quotidiennes. Le plafond le plus
proche est celui des **lignes écrites** si l'on enregistre l'état après chaque
tour : cent lignes par partie, donc environ mille parties par jour.

À ton échelle — quelques amis, quelques parties — **c'est gratuit avec trois
ordres de grandeur de marge.**

Un point que la documentation **ne dit pas** : il n'y a aucune durée maximale
annoncée pour une connexion WebSocket. Ne pas supposer qu'elle est infinie ;
l'étape 6 (la reprise) la rend sans importance de toute façon.

---

## 11. Sécurité, et le dépôt public

Tu avais posé la question pour les dons ; elle se repose ici, différemment.

**Ce que le dépôt public révèle.** Le code du serveur sera visible, comme le
reste. Ce n'est pas un problème : la sécurité ne repose pas sur le secret du
code, mais sur le fait que **la pioche n'est jamais envoyée**. Un lecteur du code
apprendra comment le jeu valide un tour — et c'est très bien, puisqu'il ne
pourra pas en tirer les cartes des autres.

**Ce qu'il ne faut pas publier.** Rien, en fait, sauf l'identifiant de compte
Cloudflare dans `wrangler.toml` — sans gravité, mais autant le sortir du dépôt
par habitude. Il n'y a pas de clé d'API à cacher : le client ne s'authentifie pas
auprès de Cloudflare, il ouvre juste un WebSocket.

**Ce qui reste possible à un tricheur.** Avec le serveur arbitre et les mains
expurgées, un client modifié ne peut ni voir les cartes des autres, ni poser une
carte qu'il n'a pas, ni jouer hors de son tour. Ce qu'il peut encore faire :
jouer **mieux** que toi, en branchant le solveur sur sa propre main. C'est déjà
vrai aujourd'hui — le bouton « Magicien » est dans le jeu — et ce n'est pas une
triche, c'est une fonctionnalité.

**Un code de partie n'est pas un mot de passe.** `#partie=4F2K` sur quatre
caractères se devine. Pour des parties entre amis, six caractères tirés au hasard
suffisent largement ; au-delà, il faudrait un vrai salon avec invitation nominale,
et ce n'est pas le sujet.

---

## 12. Ce que je ne sais pas encore

Pour être honnête sur les trous :

- **Le WebSocket depuis l'app macOS.** Elle charge ses fichiers en `file://`.
  La CSP devra autoriser `connect-src wss://…`, et il faudra **vérifier sur le
  Mac** qu'une page en `file://` peut bien ouvrir ce WebSocket. Je n'en sais
  rien avant de l'avoir essayé — et on a déjà vu cette session que `file://`
  réserve des surprises (les workers y sont refusés par la CSP).
- **La durée de vie d'une connexion**, non documentée (§ 10).
- **Le comportement exact de l'iPhone au réveil** : combien de temps le
  WebSocket survit en arrière-plan. À mesurer, pas à supposer.

Les trois se tranchent par l'expérience, et les trois sont sans danger : aucune
ne remet en cause l'architecture, elles ne décident que du soin à mettre dans la
reprise.

---

## En résumé

| question | réponse |
|---|---|
| Faut-il un serveur ? | Oui, à cause du secret de la pioche. |
| Lequel ? | Cloudflare Workers + Durable Objects, un objet par partie. |
| Combien ? | Gratuit, très largement. |
| Faut-il réécrire les règles ? | Non. Le moteur tourne tel quel côté serveur. |
| Faut-il réécrire l'affichage ? | Presque pas : il ne lit déjà que le *nombre* de cartes des autres. |
| Où est le travail ? | Dans l'enchaînement des tours de `ui.js`, et nulle part ailleurs. |
| Le jeu solo change-t-il ? | Pas d'une ligne. |

Le plus raisonnable est de commencer par les **étapes 1 et 2** : le serveur et sa
validation s'écrivent et s'éprouvent entièrement hors navigateur, sans toucher au
jeu. On saurait alors que les règles tiennent en réseau avant d'avoir modifié
quoi que ce soit de ce qui marche aujourd'hui.
