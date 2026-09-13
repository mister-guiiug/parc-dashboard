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
| Quel dépôt est en retard sur quoi, tout en un coup d'œil ? | section « Matrice des écarts » |
| Où suis-je dans la page, et comment revenir en haut ? | sommaire flottant en bas à droite |

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

Les lignes se filtrent aussi par **maturité** — alpha, bêta, stable, ou non
renseignée. Aucun bouton pressé les montre toutes ; plusieurs se cumulent. La
maturité est **éditoriale** : aucun signal du dépôt ne la donne, et sa seule
source de vérité est `FAMILY_APPS` dans `apps-catalog.js` du socle — le fichier
même que les applications lisent pour s'afficher les unes aux autres. Le relevé
l'y relit à chaque passage plutôt que de tenir une liste à côté, qui serait un
second endroit où la même chose vieillit. Elle est affichée en pastille à côté
du dépôt : filtrer sur un critère invisible obligerait à croire le filtre sur
parole.

Les huit dépôts qui n'en portent pas sont ceux qui ne sont pas des
applications — les trois couches du socle, l'outillage, et `.github`.

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
- L'API GitHub nomme un workflow **supprimé** par son chemin de fichier ; ces
  entrées sont écartées, sinon d'anciens échecs seraient comptés comme actuels.
- Les **dépôts privés du compte sont exclus** de cette page.

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

Si le `GITHUB_TOKEN` du dépôt ne suffit pas à lire l'API Actions des autres
dépôts, le relevé s'arrête avec un message explicite plutôt que de publier une
page « tout au vert » : poser alors un PAT (`public_repo`) dans le secret
`PARC_TOKEN`.

## Licence

MIT — voir [LICENSE](LICENSE).
