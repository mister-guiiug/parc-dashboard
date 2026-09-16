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
 * L'ordre sur un CHAMP quelconque — le tri des tableaux qui n'en avaient aucun.
 *
 * Relevé du 16/09/2026 : sur les cinq tableaux de la page, un seul portait des
 * en-têtes triables. `librairies` — le plus gros, jusqu'à 92 paquets — ne
 * pouvait s'ordonner ni par nombre de dépôts, ni par retard, alors qu'il a une
 * recherche et trois filtres : l'effort était mis, le tri oublié.
 *
 * UNE VALEUR ABSENTE VA AU BOUT DANS LES DEUX SENS, comme un dépôt qui ne
 * dépend pas d'un paquet dans la matrice : elle n'est ni la plus grande ni la
 * plus petite, elle manque. Sans ça, le tri croissant d'« Amont » ouvrirait sur
 * une colonne de tirets.
 *
 * @param {(x: any) => any} lire Le champ, extrait de la ligne.
 * @param {number} sens -1 décroissant, 1 croissant.
 * @param {(a: any, b: any) => number} [cmp] Comparaison, numérique par défaut.
 */
export const parChamp =
  (lire, sens, cmp = (a, b) => (a > b ? 1 : a < b ? -1 : 0)) =>
  (a, b) => {
    const va = lire(a)
    const vb = lire(b)
    const rienA = va === null || va === undefined || va === ''
    const rienB = vb === null || vb === undefined || vb === ''
    if (rienA && rienB) return 0
    if (rienA) return 1
    if (rienB) return -1
    return cmp(va, vb) * sens
  }

/** Comparaison de textes, insensible à la casse et aux accents. */
export const parTexte = (a, b) => String(a).localeCompare(String(b), 'fr', { sensitivity: 'base' })

/* ── Les filtres, sortis des rendus ───────────────────────────────────────
 *
 * Ils vivaient DANS `rendDepots` et `rendLibs`, mêlés à la construction du DOM :
 * une règle métier — « un dépôt se cherche aussi par le nom d'un paquet de sa
 * pile » — qu'aucun test ne pouvait atteindre. Sortis ici, ils se jouent sur
 * trois objets littéraux.
 */

/**
 * Le texte dans lequel une recherche de dépôt cherche.
 *
 * PAS SEULEMENT LE NOM. On y trouve la description, le rôle, la branche par
 * défaut, **les paquets de la pile avec leur version**, et les noms de
 * workflows : taper `supabase` sort les dépôts qui en dépendent, taper `8.3.0`
 * sort ceux qui tiennent cette version de Vite. C'est la partie la moins
 * évidente du filtre, et la seule qui méritait d'être éprouvée.
 */
export const foinDepot = (d) =>
  [
    d.nom,
    d.description || '',
    d.role || '',
    d.brancheDefaut || '',
    ...(d.pile || []).map((p) => `${p.paquet} ${p.version}`),
    ...(d.workflows || []).map((w) => w.nom),
  ]
    .join(' ')
    .toLowerCase()

/**
 * Un dépôt répond-il aux filtres ?
 *
 * @param {object} d
 * @param {{ q?: string, familles?: Set<string>, drapeaux?: Set<string> }} c
 */
export function correspondDepot(d, c = {}) {
  const familles = c.familles ?? new Set()
  const drapeaux = c.drapeaux ?? new Set()
  if (familles.size && !familles.has(d.famille)) return false
  if (drapeaux.has('echec') && !d.compte?.rouge) return false
  if (drapeaux.has('modifie') && !d.local?.modifies) return false
  if (drapeaux.has('prive') && !d.prive) return false
  if (drapeaux.has('site') && !d.pages?.ok) return false
  const q = (c.q ?? '').trim().toLowerCase()
  return !q || foinDepot(d).includes(q)
}

/** Les quatre ordres de la liste des dépôts. */
export const TRIS_DEPOT = {
  echecs: (a, b) => b.compte.rouge - a.compte.rouge || a.commit.jours - b.commit.jours || a.nom.localeCompare(b.nom),
  activite: (a, b) => a.commit.jours - b.commit.jours || a.nom.localeCompare(b.nom),
  nom: (a, b) => a.nom.localeCompare(b.nom),
  workflows: (a, b) => b.workflows.length - a.workflows.length || a.nom.localeCompare(b.nom),
}

/**
 * Un paquet répond-il aux filtres de la section « librairies » ?
 *
 * PAR DÉFAUT, SEULEMENT CE QUI EST PARTAGÉ : un paquet présent dans un seul
 * dépôt est une dépendance d'application, pas une librairie du parc. C'est la
 * règle que la table des éléments a reprise ensuite.
 *
 * « Éclaté » demande TROIS versions et non deux : à deux, c'est une montée en
 * cours ; à trois, c'est une dispersion.
 *
 * @param {object} l
 * @param {{ q?: string, toutes?: boolean, retard?: boolean, eclate?: boolean }} c
 */
export function correspondLib(l, c = {}) {
  if (!c.toutes && l.nbDepots < 2) return false
  if (c.retard && !l.enRetard) return false
  if (c.eclate && l.nbVersions < 3) return false
  const q = (c.q ?? '').trim().toLowerCase()
  return !q || l.paquet.toLowerCase().includes(q)
}

/**
 * CE QU'AUCUN LOCKFILE NE DÉCLARE, mais que le relevé sait compter.
 *
 * GitHub Actions, Pages, Lighthouse, Renovate, Supabase, Cloudflare : ces
 * technologies ne sont dans aucun `package.json`, et elles portent pourtant la
 * moitié de ce que le parc fait. Chacune est DÉDUITE d'un nom de workflow ou
 * d'un champ du dépôt, jamais écrite de mémoire.
 *
 * **Une ligne qui ne trouve aucun dépôt ne sort pas** : mieux vaut un trou
 * qu'un chiffre inventé.
 */
export function elementsHorsNpm(depots) {
  const wf = (re) => depots.filter((d) => (d.workflows || []).some((w) => re.test(w.nom || w.name || ''))).length
  const lang = (nom) => depots.filter((d) => d.langage === nom).length
  return [
    { nom: 'GitHub Actions', n: depots.filter((d) => (d.workflows || []).length).length, ver: 'workflows', groupe: 'infra' },
    { nom: 'GitHub Pages', n: depots.filter((d) => d.pages).length, ver: 'sites servis', groupe: 'infra' },
    { nom: 'Renovate', n: wf(/renovate/i), ver: 'montées de deps', groupe: 'qual' },
    { nom: 'Lighthouse CI', n: wf(/lighthouse/i), ver: 'seuils a11y', groupe: 'test' },
    { nom: 'Supabase', n: wf(/supabase/i), ver: 'Postgres · RLS', groupe: 'dos' },
    { nom: 'Cloudflare Workers', n: wf(/worker/i), ver: 'proxys', groupe: 'dos' },
    { nom: 'Firebase Hosting', n: wf(/firebase/i), ver: 'déploiement', groupe: 'dos' },
    { nom: 'Rust', n: lang('Rust'), ver: 'crates', groupe: 'lang' },
    { nom: 'C#', n: lang('C#'), ver: '.NET', groupe: 'lang' },
    { nom: 'Python', n: lang('Python'), ver: 'scripts', groupe: 'lang' },
  ].filter((e) => e.n > 0)
}

/* ── La table des éléments ────────────────────────────────────────────────
 *
 * Le parc porte une centaine de paquets. La section « librairies » les liste,
 * la matrice les croise avec les dépôts — mais aucune des deux ne répond à
 * « de quoi cette famille d'applications est-elle FAITE ? ». La table des
 * éléments range chaque technologie par ce à quoi elle sert (le GROUPE) et par
 * le nombre de dépôts qui la portent (la PÉRIODE).
 *
 * TOUT EST MESURÉ, rien n'est écrit à la main : les comptes viennent du relevé,
 * les symboles se dérivent des noms, et un paquet qui apparaîtra demain trouvera
 * sa place sans qu'on touche à ce fichier.
 */

/** Les groupes, dans l'ordre de la chaîne : de la source au regard porté dessus. */
export const GROUPES = [
  ['lang', 'Langage & types'],
  ['build', 'Construction'],
  ['ui', 'Interface'],
  ['data', 'État & données'],
  ['dos', 'Dorsale'],
  ['test', 'Tests'],
  ['qual', 'Qualité & style'],
  ['obs', 'Observabilité'],
  ['infra', 'Socle & infrastructure'],
  ['autre', 'Non classé'],
]

/**
 * LE GROUPE D'UN PAQUET, par motifs ordonnés — le premier qui accroche gagne.
 *
 * L'ordre compte et n'est pas alphabétique : `@testing-library/*` doit être vu
 * comme un test AVANT que `react` ne l'attire vers l'interface, et
 * `@sentry/vite-plugin` comme de l'observabilité avant que `vite-plugin` ne
 * l'envoie à la construction.
 *
 * `autre` est une RÉPONSE, pas un échec : un paquet qu'aucun motif ne reconnaît
 * s'affiche en gris et se voit. L'alternative — le ranger d'office quelque part
 * — cacherait l'arrivée d'une technologie nouvelle dans une case qui ment.
 */
const MOTIFS = [
  [/^@types\//, 'lang'],
  [/^(typescript|globals|serde|serde_json)$/, 'lang'],
  [/^@mister-guiiug\//, 'infra'],
  [/^@sentry\/|^web-vitals$|^tracing$/, 'obs'],
  [/^@testing-library\/|^@playwright\/|playwright|^axe-core$|^jsdom$|^fake-indexeddb$|coverage|rules-unit-testing/, 'test'],
  [/eslint|prettier|husky|lint-staged|commitlint|changesets/, 'qual'],
  [/^@tailwindcss\/|^vite$|^@vitejs\/|vite-plugin|^esbuild$|^rollup-|^sharp$|^cross-env$|^concurrently$|^wait-on$|^electron/, 'build'],
  [/^vitest$|^@vitest\//, 'test'],
  [/^react$|^react-dom$|^react-router|^tailwindcss$|^lucide-react$|^framer-motion$|^@rive-app\/|^leaflet$|^maplibre-gl$|^recharts$/, 'ui'],
  [/^zustand$|^zod$|^@tanstack\/|date-fns|^uqr$|^qr-scanner$|^jszip$|^uuid$|^yaml$|^jsonc-parser$|^sql\.js$|^rusqlite$|^chrono$|^regex$/, 'data'],
  [/^@supabase\/|^firebase$|^@firebase\/|^fastify$|^@fastify\/|^tokio$|^reqwest$|^anyhow$|^thiserror$|^git2$/, 'dos'],
  [/^tauri$|^@vscode\/|^vsce$/, 'infra'],
]

/** @returns {string} La clé du groupe, `'autre'` si aucun motif n'accroche. */
export const groupeDe = (paquet) => MOTIFS.find(([re]) => re.test(paquet))?.[1] ?? 'autre'

/**
 * LES SYMBOLES, DÉRIVÉS — jamais une liste tenue à la main.
 *
 * Une liste écrite serait juste le jour où on l'écrit : le paquet suivant
 * arriverait sans symbole, ou pire, avec celui d'un autre. La règle :
 *
 *   1. le nom est découpé sur tout ce qui n'est pas une lettre ou un chiffre —
 *      la portée `@scope/` compte comme un segment, sans quoi `@types/react` et
 *      `react` porteraient le même symbole ;
 *   2. un seul segment → ses deux premières lettres ; plusieurs → l'initiale de
 *      chacun, jusqu'à trois ;
 *   3. en cas de COLLISION, on prend d'abord une initiale de PLUS — les deux
 *      `eslint-plugin-react-*` donnent ainsi `Eprh` et `Eprr`, là où allonger
 *      sur les lettres rendait `Epr` et `Esli`, qui ne se répondent pas ;
 *   4. à court de segments, on allonge sur les lettres, puis on numérote.
 *
 * L'ordre d'entrée décide donc qui garde le symbole court — on passe les
 * paquets les plus portés d'abord, pour que le noyau ait les symboles les plus
 * nets. `vite` (22 dépôts) garde `Vi`, `vitest` devient `Vit`.
 *
 * @param {string[]} paquets Dans l'ordre de priorité.
 * @returns {Map<string, string>}
 */
export function symboles(paquets) {
  const pris = new Set()
  const out = new Map()
  for (const p of paquets) {
    const seg = String(p)
      .split(/[^A-Za-z0-9]+/)
      .filter(Boolean)
    const initiales = (n) => seg.slice(0, n).map((s) => s[0]).join('')
    const base = seg.length === 1 ? seg[0].slice(0, 2) : initiales(3)
    let sym = base
    // 3. Une initiale de plus, tant qu'il reste un segment à prendre.
    for (let n = 4; pris.has(sym.toLowerCase()) && n <= seg.length; n += 1) sym = initiales(n)
    // 4. Puis les lettres du nom sans séparateurs : `vite`/`vitest` se
    // départagent à la quatrième lettre, là où aucune initiale n'existe.
    const nu = String(p).replace(/[^A-Za-z0-9]/g, '')
    for (let n = sym.length; pris.has(sym.toLowerCase()) && n < nu.length; n += 1) sym = nu.slice(0, n + 1)
    // Dernier recours : un chiffre, pour que la fonction rende TOUJOURS des
    // symboles uniques — deux noms identiques aux séparateurs près existeront.
    let suffixe = 2
    while (pris.has(sym.toLowerCase())) sym = base + suffixe++
    pris.add(sym.toLowerCase())
    out.set(p, sym[0].toUpperCase() + sym.slice(1).toLowerCase())
  }
  return out
}

/**
 * L'ÉTIQUETTE D'UNE CASE — le nom raccourci, sauf quand raccourcir ment.
 *
 * Une case de 82 px ne tient pas `@testing-library/jest-dom`. Retirer la portée
 * règle le problème dans la plupart des cas — mais pas pour `@types/react` et
 * `react`, qui se retrouvaient TOUS DEUX affichés « react », côte à côte, avec
 * deux symboles différents et deux comptes différents. Vu à l'écran le
 * 17/09/2026.
 *
 * La règle : on raccourcit, et si deux noms raccourcis se rejoignent, ceux-là
 * gardent leur nom entier. Le doute ne coûte alors qu'à ceux qu'il concerne.
 *
 * @param {string[]} paquets
 * @returns {Map<string, string>}
 */
export function etiquettes(paquets) {
  const court = (p) => String(p).replace(/^@[^/]+\//, '')
  const compte = new Map()
  for (const p of paquets) compte.set(court(p), (compte.get(court(p)) ?? 0) + 1)
  return new Map(paquets.map((p) => [p, compte.get(court(p)) > 1 ? String(p) : court(p)]))
}

/**
 * LES PÉRIODES, EN PROPORTION DU PARC et non en nombres figés.
 *
 * Un seuil écrit « 20 dépôts » vaudrait aujourd'hui et mentirait le jour où le
 * parc en compte quarante. Les bornes sont donc des parts : le noyau est ce que
 * portent au moins sept dépôts sur dix.
 */
export const PERIODES = [
  [0.7, 'Le noyau'],
  [0.5, 'La ceinture'],
  [0.3, 'Selon le besoin'],
  [0.1, 'Les spécialités'],
  [0, 'Les traces'],
]

/** L'index de période d'un paquet porté par `n` dépôts sur `total`. */
export const periodeDe = (n, total) => {
  const part = total > 0 ? n / total : 0
  const i = PERIODES.findIndex(([seuil]) => part >= seuil)
  return i === -1 ? PERIODES.length - 1 : i
}

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
