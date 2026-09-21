# parc-dashboard

Page statique qui montre, en un écran, l'état des dépôts publics du compte
[`mister-guiiug`](https://github.com/mister-guiiug) : pipelines GitHub Actions,
dernier CI/CD de chaque workflow, et versions des librairies réellement
verrouillées dans les lockfiles.

**→ https://mister-guiiug.github.io/parc-dashboard/**

Elle se régénère **toute seule chaque jour** (workflow [`releve.yml`](.github/workflows/releve.yml), 05:17 UTC).

## Ce que la page répond

| Question | Où |
|---|---|
| Combien d'applications PWA, et qu'est-ce qui n'en est pas une ? | bloc « Par famille », puis une section par famille |
| Qu'est-ce qui est rouge, et à quelle étape exactement ? | section « Ce qui est rouge » |
| Plusieurs pipelines cassent-ils pour la même raison ? | bandeau de motif partagé, en tête de cette section |
| Quels workflows tournent, et avec quel historique ? | les cinq derniers runs, en bande, sur chaque carte |
| Le site déployé répond-il vraiment ? | pastille « site en ligne » (requête HTTP réelle, pas l'état déclaré par l'API) |
| Qui est en retard sur quelle librairie ? | section « Librairies », ligne dépliable |
| Une librairie du parc est-elle encore entretenue ? | section « Librairies dormantes » |
| Qu'est-ce qui a changé depuis hier ? | bandeau « Ce qui a bougé », sous les tuiles |
| Est-ce que ça s'améliore ? | courbe sous les tuiles qui en portent une |
| Où sont les vulnérabilités connues ? | tuile « Alertes de vulnérabilité », et bandeau sur la carte du dépôt |
| Quel dépôt est en retard sur quoi, tout en un coup d'œil ? | section « Matrice des écarts » |
| Où suis-je dans la page, et comment revenir en haut ? | sommaire flottant en bas à droite |
| Et en anglais ? | liste déroulante en haut à droite — voir « Les deux langues » |

## La matrice des écarts

« Librairies » répond paquet par paquet ; la matrice les met côte à côte. Une
ligne est un dépôt, une colonne un paquet, une cellule la version qu'il
**verrouille**.

La couleur ne dit pas « vieux » dans l'absolu mais l'**écart à la version la
plus récente du parc** — pas à celle publiée en amont. C'est délibéré : la
version que tient déjà un dépôt voisin est atteignable aujourd'hui, sans
attendre ni arbitrer. Le rang de l'écart est montré, pas sa distance : passer
de 4.2 à 4.3 n'a rien de commun avec passer de 3 à 4, et un chiffre unique
mélangerait les deux.

| Cellule | Ce qu'elle dit |
| --- | --- |
| verte | ce dépôt tient la version la plus récente du parc |
| jaune | écart de correctif |
| orange | écart de version mineure |
| rouge | écart de version **majeure** |
| `·` grisé | ce dépôt ne dépend pas de ce paquet |

Par défaut, seuls les paquets réellement éclatés sont montrés — les quatorze
qui divergent le plus. *Choisir les colonnes* les ajoute et les retire une à
une ; relâcher *Seulement les paquets éclatés* ouvre la liste aux cent paquets
du parc. La dernière colonne compte les écarts d'une ligne, et le tri par
défaut met les dépôts les plus en retard en tête.

Les lignes se filtrent par **famille** et par **maturité**. Aucun bouton pressé
les montre toutes ; plusieurs se cumulent, et les deux axes se croisent. Le
compteur décrit alors le tableau affiché et non le parc : sous un filtre, il
totalise les écarts des seules lignes visibles.

Les boutons de famille sont construits d'après le relevé — une famille
qu'aucun dépôt à lockfile ne porte n'obtient pas de bouton qui ne filtrerait
rien. Ils ne portent volontairement pas de compte : le choix des colonnes fait
varier les lignes visibles, et un nombre écrit là finirait par contredire le
tableau. `create-lg-pwa-app` en est l'exemple — il est du socle, mais ne
dépend d'aucun des quatorze paquets montrés par défaut.

La **maturité** — alpha, bêta, stable, ou non renseignée — est d'une autre
nature : elle est **éditoriale**. Aucun signal du dépôt ne la donne, et sa
seule source de vérité est `FAMILY_APPS` dans `apps-catalog.js` du socle — le
fichier même que les applications lisent pour s'afficher les unes aux autres.
Le relevé l'y relit à chaque passage plutôt que de tenir une liste à côté, qui
serait un second endroit où la même chose vieillit.

Famille et maturité sont toutes deux affichées en pastille à côté du dépôt :
filtrer sur un critère invisible obligerait à croire le filtre sur parole. La
pastille de famille reste en pointillé et sans couleur — dans cette section,
une couleur veut dire « écart », et rien d'autre.

Les huit dépôts qui n'en portent pas sont ceux qui ne sont pas des
applications — les trois couches du socle, l'outillage, et `.github`.

## Les deux langues

La page se lit en **français** ou en **anglais**, et la bascule est immédiate :
rien n'est rechargé, tout est déjà dans le document.

La langue servie se décide dans cet ordre — **l'URL**, puis le **choix
mémorisé**, puis le **navigateur**. L'URL passe devant parce qu'elle est ce
qu'on envoie à quelqu'un : un lien qui s'ouvrirait dans la langue du
destinataire ne montrerait pas ce qu'on voulait montrer. Le paramètre `?lang=en`
rejoint donc les onze autres que la page sait déjà transmettre, et le défaut ne
s'écrit pas.

Tout le texte vit dans [`scripts/libelles.mjs`](scripts/libelles.mjs), recopié
dans la page comme les autres modules. **Une langue de plus, c'est une entrée
dans `LANGUES` et un objet de plus dans `LIBELLES`** — le gabarit ne bouge pas.
Deux langues seulement, et non les sept du socle : celui-ci habille des
applications que d'autres gens ouvrent, quand cette page est un instrument de
bord dont le texte est de la prose technique qui bouge à chaque relevé.

Trois règles portent l'ensemble :

- **Un module qui calcule n'écrit jamais une phrase, il rend une clé.**
  `regles.mjs` rend `role.vscode`, pas « extension VS Code » ; `modele.mjs` rend
  `pile.socle` ; `vue.mjs` rend `groupe.lang`. C'est la correction d'un défaut
  réel : le relevé embarquait ses libellés français **dans le JSON**, et aucun
  sélecteur n'aurait pu défaire après coup une langue cuite dans la donnée. Ce
  qui n'est pas une clé — `Electron`, `.NET`, un langage rendu par l'API —
  traverse tel quel : un nom propre n'a pas de traduction à chercher.
- **Le balisage porte les clés, et c'est ce qui permet de retraduire sans rien
  reconstruire.** `data-t` remplace le texte, `data-th` le balisage intérieur
  (les chapeaux portent du `<code>` et du `<strong>`), `data-t-placeholder` et
  ses voisins les attributs. Un bouton dont le libellé dépend de son état pose
  sa clé au lieu d'écrire son texte — son état survit ainsi au changement de
  langue.
- **Les pluriels passent par `Intl.PluralRules`.** La forme écrite à la main —
  `n > 1 ? 's' : ''` — était juste en français, où 0 et 1 sont au singulier, et
  fausse en anglais dès « 0 repositories ». Et quand une phrase compte un
  total (« 1 sur 92 paquets »), c'est le **total** qui commande l'accord.

Le HTML servi reste en français en clair : les moteurs, les aperçus de lien et
le paragraphe `noscript` lisent le document tel qu'il arrive. Deux écritures du
même texte, donc deux textes qui divergeraient — `npm test` les compare.

## Comment les familles sont établies

Chaque règle s'appuie sur un signal lisible dans le dépôt, jamais sur son nom —
à deux exceptions près, qui n'en portent aucun :

| Famille | Signal |
|---|---|
| Applications PWA | `vite-plugin-pwa` dans les dépendances |
| Applications desktop | `electron`, le crate `tauri`, ou langage principal C# |
| Socle | **liste explicite** de trois dépôts : le squelette *est* une PWA, aucun signal ne le distinguerait de ce qu'il engendre |
| Outillage et divers | `engines.vscode` pour une extension, `.github` pour la configuration du compte, le langage principal sinon |

Si un dépôt du socle disparaît du compte, le relevé le signale au lieu de le
laisser glisser en silence dans une autre famille.

## Ce que les chiffres veulent dire

- **L'état d'un workflow** est celui de son **dernier run sur la branche par
  défaut** du dépôt. À défaut de run sur cette branche, le dernier run toutes
  branches confondues est affiché, marqué comme tel.
- Les **workflows réutilisables** (ceux du socle, appelés par les autres dépôts)
  sont comptés à part : ils n'ont pas de run propre, les inclure ferait passer
  pour « jamais exécuté » ce qui tourne en réalité chez les consommateurs.
- Les **versions de librairies** sont lues dans `package-lock.json`, pas dans
  `package.json` : une plage `^4.7.0` accepte déjà `4.9.0`, elle ne dit pas ce
  qui est installé. Pour les deux dépôts Cargo, la source est `Cargo.lock`.
- Un **alias npm** (`"typescript-7": "npm:typescript@~7.0.2"`) porte un nom qui
  n'existe pas au registre : interrogé sur `typescript-7`, npm répond **404**.
  L'alias est donc résolu vers le paquet réellement publié, et la ligne porte le
  badge « alias de … ». Sans cela elle restait sans amont, sans date et sans
  dépôt amont — une librairie que la page ne pouvait *jamais* dire en retard.
- **Deux majeurs de TypeScript coexistent dans ce parc, par décision.** La 6 est
  celle que `typescript-eslint` résout — il refuse la 7 par un `throw` à
  l'import — et la 7 vit à côté, sous l'alias `typescript-7`, en second avis non
  bloquant (`type-check:7`). Les 6.x ne sont donc pas comptées en retard
  (`MAJEURS_ADMIS`), et l'alias, lui, **reste surveillé dans la 7.x** : sa
  référence est la plus haute 7.x publiée et non `latest`, pour qu'une
  TypeScript 8 ne le dise pas en retard alors que l'écarter est son office
  (`PLAFONDS`). Plafonner n'est pas exempter, et les confondre aurait éteint le
  voyant.
- L'API GitHub nomme un workflow **supprimé** par son chemin de fichier ; ces
  entrées sont écartées, sinon d'anciens échecs seraient comptés comme actuels.
- Une librairie est dite **dormante** quand sa dernière version publiée a plus
  d'un an. Ce chiffre seul ne conclut rien : le tableau montre aussi le
  **dernier commit du dépôt amont**, et n'appelle « à l'arrêt » que les
  librairies dont les deux dates se sont tues. `leaflet` n'a rien publié depuis
  mai 2023 mais reçoit des commits le jour même ; `react-qr-reader` en est à
  une préversion de 2022 et son dépôt n'a pas bougé depuis 2023. Le même
  « plus d'un an » recouvrait les deux.
- **« Ce qui a bougé » compare au relevé précédent**, pas à hier au sens strict :
  le bandeau nomme la date à laquelle il se compare. Cette liste décrit une
  transition, pas un état — elle est donc exclue de la comparaison « le fond
  a-t-il changé ? », sinon un jour de changement serait suivi d'un second commit
  le lendemain, celui qui remet la liste à vide.
- Les **courbes** ne se tracent qu'à partir de **deux points** : une ligne d'un
  seul point laisserait croire à une tendance plate. `historique.json` reçoit un
  point par jour au maximum, et seulement quand le fond a bougé.
- Les **alertes de vulnérabilité** ont trois états, jamais deux : un compte,
  « désactivées sur ce dépôt », ou **illisibles**. Les lire sur un AUTRE dépôt
  demande un jeton portant « Dependabot alerts : read » — le `GITHUB_TOKEN` du
  dépôt ne l'a pas, même sur des dépôts publics. Sans ce droit la tuile affiche
  `—` et dit pourquoi : « 0 alerte » se lirait comme une bonne nouvelle.
- Un dépôt dont les **workflows n'ont pas pu être lus** le dit sur sa carte. Le
  relevé abandonne au-delà de 10 % de lectures refusées ; en dessous, sans ce
  bandeau, un dépôt mal lu s'afficherait comme un dépôt sain et vide.
- Les **dépôts privés du compte sont exclus** de cette page.

## Vérifier

```bash
npm test
```

La version de Node est dans [`.nvmrc`](.nvmrc) — **un seul endroit**, que les
trois jobs lisent par `node-version-file`. Elle y est entrée le 14/09/2026
parce qu'elle était écrite en dur trois fois, et qu'une des trois avait dérivé :
le relevé tournait sur Node 24 quand le reste du parc était en 26.2.0.

Les règles pures du relevé — `cmpVersion`, `classe`, `etatDe`, `fond`,
`changementsDepuis` — vivent dans [`scripts/regles.mjs`](scripts/regles.mjs),
séparées du script qui les applique : `releve.mjs` s'exécute à l'import et part
chercher l'API, rien n'y serait testable autrement. Aucune dépendance, aucun
jeton, `node:test` suffit.

C'est `fond()` qui justifie surtout ces tests : elle décide si la CI commite. Une
régression y ferait réécrire `index.html` toutes les nuits sans que rien n'ait
bougé, et personne ne le verrait avant des semaines de commits vides.

[`test/libelles.test.mjs`](test/libelles.test.mjs) garde les traductions, dont
les défauts sont **tous silencieux** : un oubli ne lève rien, ne rougit rien, et
ne se voit que si quelqu'un ouvre la page dans l'autre langue. Il exige donc que
les deux langues portent les mêmes clés, les mêmes interpolations et les mêmes
formes de pluriel ; que **toute clé demandée existe et que toute clé du
dictionnaire soit demandée** — le second sens attrape le texte mort ; que le
français **servi** dans le gabarit soit mot pour mot celui du dictionnaire ; et
que l'empreinte du relevé compte `libelles.mjs`, sans quoi une traduction
corrigée — qui ne change aucune donnée — n'atteindrait jamais la page publiée.

## Régénérer

```bash
node scripts/releve.mjs
```

Un seul script, sans dépendance : `GITHUB_TOKEN` (ou `PARC_TOKEN`) dans
l'environnement, environ 320 appels d'API, et `index.html` est réécrit.

| Option | Effet | Écrit dans |
|---|---|---|
| *(rien)* | ce que fait la CI : dépôts publics, tout depuis l'API | `index.html` |
| `--local <racine>` | ajoute ce que l'API ignore : branche courante et fichiers non commités des copies de travail | `index.local.html` (ignoré par git) |
| `--prives` | inclut les dépôts privés du compte (demande un PAT, pas le `GITHUB_TOKEN`) | — |
| `--sortie <chemin>` | force le fichier de sortie | — |

Le mode `--local` écrit volontairement ailleurs : sa page porte l'état d'une
copie de travail, qui n'a rien à faire en ligne et que le relevé suivant
effacerait de toute façon.

Le dépôt qui héberge le relevé **s'exclut lui-même** : lu pendant sa propre
exécution, son workflow serait toujours « en cours » et ses numéros de run
changeraient à chaque passage — il se rendrait éternellement différent de
lui-même.

Le fichier n'est réécrit que si le **fond** a bougé : sans cette comparaison, la
CI commiterait chaque jour un diff d'une ligne où seul l'horodatage change.

`historique.json` reçoit son point dans le même mouvement, et seulement pour le
relevé publié : ni `--local` ni `--sortie` n'y touchent, une sonde n'a rien à
laisser dans une série qui se lit sur un an. S'il est perdu,
[`scripts/historique-depuis-git.mjs`](scripts/historique-depuis-git.mjs) le
reconstruit depuis les révisions de `index.html`, qui portent chacune leurs
propres compteurs.

Si le `GITHUB_TOKEN` du dépôt ne suffit pas à lire l'API Actions des autres
dépôts, le relevé s'arrête avec un message explicite plutôt que de publier une
page « tout au vert » : poser alors un PAT (`public_repo`) dans le secret
`PARC_TOKEN`.

## Licence

MIT — voir [LICENSE](LICENSE).
