/**
 * Les règles PURES de la vue — celles que la page calcule, sorties du HTML.
 *
 * POURQUOI CE FICHIER EXISTE. `gabarit.html` fait 2 465 lignes, dont l'essentiel
 * est du JavaScript en ligne : tout le rendu, tous les comparateurs, le rang
 * d'un écart, son poids. `node --test` ne peut rien en atteindre, et
 * `test/regles.test.mjs` ne couvrait donc que `regles.mjs`, c'est-à-dire la
 * moitié serveur.
 *
 * Ce que ça a coûté, le 16/09/2026 : la colonne « Écarts » affichait un compte
 * pendant que son tri ordonnait sur une somme pondérée. Quatre inversions
 * visibles sur la page publiée, personne pour les voir, et aucun test possible
 * là où le défaut vivait.
 *
 * DEUX COMPARATEURS DE VERSIONS VIVAIENT DANS CE DÉPÔT. `regles.mjs` porte
 * `cmpVersion`, éprouvé par douze tests, qui nettoie les plages (`^4.15.1`) et
 * les préversions. Le gabarit portait `cmpV`, sans filet : `Number('^4')` rend
 * `NaN`, ramené à 0 — `cmpV('^4.15.1', '4.15.1')` répondait **-1** là où
 * `cmpVersion` répond **0**.
 *
 * Aucune donnée actuelle ne déclenche l'écart : relevé du 16/09/2026, les 94
 * versions de la page viennent des lockfiles, donc toutes exactes, sans plage
 * ni préversion ni quatrième segment. C'est une divergence DORMANTE — celle qui
 * se réveille le jour où la source change. Il n'en reste qu'une.
 *
 * La page reste UN SEUL FICHIER sans ressource externe : `releve.mjs` insère ce
 * module et `regles.mjs` à la place du marqueur `__VUE__`, `export` et `import`
 * retirés.
 */
import { cmpVersion } from './regles.mjs'

/**
 * Le RANG de l'écart, pas sa distance.
 *
 * Passer de 4.2 à 4.3 n'a rien de commun avec passer de 3 à 4 : un chiffre
 * unique mélangerait les deux, et c'est précisément ce que la couleur sépare.
 *
 * @returns {'absent'|'0'|'majeure'|'mineure'|'patch'}
 */
export const rangEcart = (v, ref) => {
  if (!v) return 'absent'
  if (!ref || cmpVersion(v, ref) >= 0) return '0'
  const a = String(v).split('.').map(Number)
  const b = String(ref).split('.').map(Number)
  if ((a[0] || 0) !== (b[0] || 0)) return 'majeure'
  if ((a[1] || 0) !== (b[1] || 0)) return 'mineure'
  return 'patch'
}

/** Ce que coûte un écart, par rang. Un majeur ne se paie pas comme un patch. */
export const POIDS = { majeure: 3, mineure: 2, patch: 1, 0: 0, absent: 0 }

/** Le nombre d'écarts d'une ligne — ce que la colonne « Écarts » affiche. */
export const compteEcarts = (cellules) => cellules.filter((c) => POIDS[c.rang] > 0).length

/** La gravité d'une ligne — ce qui départage deux dépôts à égalité de compte. */
export const graviteEcarts = (cellules) => cellules.reduce((n, c) => n + POIDS[c.rang], 0)

/**
 * L'ordre « plus d'écarts d'abord » : LE COMPTE, puis la gravité, puis le nom.
 *
 * Le compte passe devant parce que c'est lui qu'on lit dans la colonne. Quand
 * la gravité menait, le tableau montrait 9, 9, 8, 7, 8, 6, 7… et paraissait
 * simplement cassé.
 *
 * `parNombreEcarts` et non `parEcarts` : le gabarit porte déjà un `parEcarts`
 * qui range les COLONNES (par nombre de versions éclatées), pas les lignes.
 * Deux tris voisins par le sens, opposés par ce qu'ils classent.
 */
export const parNombreEcarts = (a, b) => b.nb - a.nb || b.score - a.score || a.depot.localeCompare(b.depot)

/**
 * L'ordre sur une colonne de paquet.
 *
 * UN DÉPÔT QUI NE DÉPEND PAS DU PAQUET n'a pas de version, et n'est donc ni en
 * avance ni en retard : il va au bout dans les DEUX sens. L'inverse ferait
 * ouvrir le tri croissant sur une colonne de « · ».
 *
 * @param {number} sens -1 pour le plus récent d'abord, 1 pour l'inverse.
 * @param {(depot: string) => number} rang L'ordre d'avant, qui départage.
 */
export const parVersion = (i, sens, rang) => (a, b) => {
  const va = a.cellules[i].version
  const vb = b.cellules[i].version
  if (!va && !vb) return rang(a.depot) - rang(b.depot)
  if (!va) return 1
  if (!vb) return -1
  return cmpVersion(va, vb) * sens || rang(a.depot) - rang(b.depot)
}
