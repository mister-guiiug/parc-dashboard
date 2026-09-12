# parc-dashboard

Page statique qui montre, en un écran, l'état des dépôts publics du compte
[`mister-guiiug`](https://github.com/mister-guiiug) : pipelines GitHub Actions,
dernier CI/CD de chaque workflow, et versions des librairies réellement
verrouillées dans les lockfiles.

**→ https://mister-guiiug.github.io/parc-dashboard/**

## Ce que la page répond

| Question | Où |
|---|---|
| Qu'est-ce qui est rouge, et à quelle étape exactement ? | section « Ce qui est rouge » |
| Plusieurs pipelines cassent-ils pour la même raison ? | bandeau de motif partagé, en tête de cette section |
| Où en est chaque dépôt (branche, commit, modifs locales) ? | grille des dépôts |
| Quels workflows tournent, et avec quel historique ? | les cinq derniers runs, en bande, sur chaque carte |
| Le site déployé répond-il vraiment ? | pastille « site en ligne » (requête HTTP réelle, pas l'état déclaré par l'API) |
| Qui est en retard sur quelle librairie ? | section « Librairies », ligne dépliable |

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

La page est un instantané : les chiffres sont ceux du relevé daté en pied de
page, ils ne se rafraîchissent pas tout seuls. Le relevé est produit par une
série de scripts Node (git local, API GitHub Actions, lockfiles, registre npm)
qui vivent hors de ce dépôt, du côté de la copie de travail du parc.

## Licence

MIT — voir [LICENSE](LICENSE).
