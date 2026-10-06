/**
 * CE QUE CHAQUE CONSOMMATEUR UTILISE VRAIMENT DU SOCLE — mesuré dans son code.
 *
 * POURQUOI LE CODE, ET PAS LE CATALOGUE. `apps-catalog.js` porte un champ
 * `configs` (les sous-chemins qu'une app importe), mais il est tenu À LA MAIN ;
 * `showroom/adoption.js` est mesuré, mais par un script qui exige les vingt
 * dépôts clonés à côté du socle, et il date du dernier qui l'a lancé. Ici, le
 * relevé lit les fichiers sur `raw.githubusercontent` (hors quota d'API), et ne
 * les relit que quand la tête de la branche a bougé.
 *
 * TROIS CANAUX, parce que le socle se consomme de trois façons :
 * - un MODULE importé (`import … from '@mister-guiiug/dev-pwa-config/react/card'`,
 *   `@import '…/components.css'`, un `extends` de tsconfig) ;
 * - un OUTIL appelé dans un script de `package.json` (`pwa-doctor`) ;
 * - un WORKFLOW réutilisable (`uses: mister-guiiug/dev-pwa-config/.github/workflows/pwa-ci.yml@v6`).
 *
 * Module SANS dépendance et SANS phrase : il rend des clés (`categorie`), la
 * page traduit.
 */

export const SOCLE_PAQUET = '@mister-guiiug/dev-pwa-config'
export const SOCLE_DEPOT = 'mister-guiiug/dev-pwa-config'

/** Au-delà, la lecture d'un dépôt est jugée trop chère pour un passage horaire. */
export const PLAFOND_FICHIERS = 600

/**
 * LA VERSION DE LA MESURE, gardée avec elle. Le cache se reprend tant que la
 * tête d'un dépôt ne bouge pas — donc une mesure CORRIGÉE ne se verrait que
 * sur les dépôts qui reçoivent un commit. Vécu au premier prototype : les
 * lockfiles comptés à tort comme imports sont restés dans quinze dépôts sur
 * vingt-deux après la correction. Monter ce numéro force une relecture.
 */
export const VERSION_MESURE = 3

/** La mesure connue d'un dépôt est-elle reprenable telle quelle ? */
export function usageReprenable(connu, memeTete) {
  const u = connu?.usageSocle
  return Boolean(memeTete && u?.v === VERSION_MESURE && (Array.isArray(u.importes) || Array.isArray(u.modules)))
}

const EXTENSIONS = /\.(?:[cm]?[jt]sx?|css|html|json)$/i
// Ce qui n'est pas du code de l'app : dépendances, sorties de build, données,
// documentation. `supabase/` porte du SQL et des fonctions Deno, qui ne
// peuvent pas importer le socle (il ne franchit pas Deno).
const EXCLUS = /(?:^|\/)(?:node_modules|dist|build|coverage|public|supabase|docs|\.claude|playwright-report|test-results)\//
// UN LOCKFILE CITE LE SOCLE SANS L'UTILISER : son `resolved` porte
// `…/@mister-guiiug/dev-pwa-config/6.25.0/<empreinte>`, qui passait pour un
// import d'un module « 6.25.0 » dans les vingt-deux dépôts au premier relevé.
const VERROUS = /(?:^|\/)(?:package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock)$/
const WORKFLOW = /^\.github\/workflows\/[^/]+\.ya?ml$/i

/** Les fichiers d'un arbre git qui peuvent consommer le socle. */
export function fichiersAScanner(chemins = []) {
  return chemins.filter((c) => WORKFLOW.test(c) || (EXTENSIONS.test(c) && !EXCLUS.test(c) && !VERROUS.test(c) && !c.startsWith('.github/')))
}

const echappe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// ENTRE GUILLEMETS, et seulement là. Un import, un `@import`, un `extends`, un
// `vi.mock` citent le module comme une chaîne ; un commentaire le cite entre
// accents graves, et une règle de découpage le cherche précédé d'un `/`
// (`'/@mister-guiiug/dev-pwa-config/themes.js'` dans un `manualChunks`) — ni
// l'un ni l'autre n'est un usage.
const RE_IMPORT = new RegExp(`['"]${echappe(SOCLE_PAQUET)}/([A-Za-z0-9._/-]+)['"]`, 'g')

/** Les sous-chemins du socle cités dans un texte — import, `@import`, `extends`, `import.meta.resolve`, `vi.mock`. */
export function importsDuSocle(texte = '') {
  const out = new Set()
  for (const m of String(texte).matchAll(RE_IMPORT)) out.add(m[1])
  return [...out]
}

/**
 * La clé d'export qui sert un sous-chemin importé, sans le `./` — ou `null`
 * si le socle ne l'exporte pas (plus). Le motif `components/*.css` couvre les
 * feuilles une à une.
 */
export function moduleDe(sousChemin, cles = []) {
  const ensemble = cles instanceof Set ? cles : new Set(cles)
  if (ensemble.has(sousChemin)) return sousChemin
  for (const cle of ensemble) {
    if (!cle.includes('*')) continue
    const [avant, apres] = cle.split('*')
    if (sousChemin.startsWith(avant) && sousChemin.endsWith(apres) && sousChemin.length > avant.length + apres.length) return cle
  }
  return null
}

/** Les outils du socle appelés par les scripts d'un `package.json`. */
export function outilsDuSocle(scripts = {}, outils = []) {
  const texte = Object.values(scripts || {}).join('\n')
  return outils.filter((o) => new RegExp(`(?:^|[\\s"'&|;(])${echappe(o)}(?=[\\s"'&|;)]|$)`, 'm').test(texte))
}

const RE_USES = new RegExp(`uses:\\s*['"]?${echappe(SOCLE_DEPOT)}/\\.github/workflows/([\\w.-]+\\.ya?ml)@`, 'g')

/** Les workflows réutilisables du socle appelés par un fichier de workflow. */
export function workflowsDuSocle(texte = '') {
  return [...new Set([...String(texte).matchAll(RE_USES)].map((m) => m[1]))]
}

/** Un workflow du socle est réutilisable s'il se déclenche par `workflow_call`. */
export function estReutilisable(texte = '') {
  return /^\s*workflow_call\s*:/m.test(String(texte)) || /^on:\s*\[?[^\n]*\bworkflow_call\b/m.test(String(texte))
}

/**
 * LA FAMILLE D'UN MODULE, pour grouper les lignes. Une clé, jamais une phrase.
 * L'ordre des tests compte : `react/use-…` est un crochet avant d'être du React.
 */
export function categorieModule(cle = '') {
  if (/\.css$/.test(cle) || /^(?:eslint|prettier|commitlint|lint-staged|tsconfig|vitest|playwright|tailwind-preset|testing\/)/.test(cle)) return 'outillage'
  if (/^vite-/.test(cle)) return 'vite'
  if (/^react\/labels/.test(cle)) return 'libelles'
  if (/^react\/use-/.test(cle)) return 'crochet'
  if (/^react(?:\/|$)/.test(cle)) return 'composant'
  return 'bibliotheque'
}

export const CATEGORIES = ['outillage', 'vite', 'composant', 'crochet', 'libelles', 'bibliotheque']
export const CANAUX = ['module', 'outil', 'workflow']

/**
 * Ce qu'un dépôt cite du socle, BRUT : les sous-chemins importés, les
 * workflows réutilisables appelés et les options qu'il leur passe. Seule cette
 * forme est gardée en cache — le rattachement aux exports se refait à chaque
 * passage (voir `rattache`).
 *
 * @param {{ chemin: string, texte: string | null }[]} fichiers
 */
export function brutsDepuisFichiers(fichiers = []) {
  const importes = new Set()
  const workflows = new Set()
  const appels = []
  for (const { chemin, texte } of fichiers) {
    if (texte == null) continue
    if (WORKFLOW.test(chemin)) {
      for (const w of workflowsDuSocle(texte)) workflows.add(w)
      appels.push(...appelsDuSocle(texte))
      continue
    }
    for (const s of importsDuSocle(texte)) importes.add(s)
  }
  return { importes: [...importes].sort(), workflows: [...workflows].sort(), appels }
}

/* ── les options passées aux workflows réutilisables ───────────────────── */

const retraitDe = (ligne) => /^\s*/.exec(ligne)[0].length
const sansCommentaire = (v) => String(v).replace(/\s+#.*$/, '').trim()
const sansGuillemets = (v) => v.replace(/^(['"])(.*)\1$/, '$2')

/**
 * Les appels d'un fichier de workflow aux réutilisables du socle, avec leurs
 * `with:`. Une lecture LIGNE À LIGNE plutôt qu'un analyseur YAML : la page
 * n'a aucune dépendance, et la forme d'un appel est toujours la même —
 * `uses:` puis, au même retrait, `with:` et ses clés une par ligne.
 *
 * @returns {{ workflow: string, avec: Record<string, string> }[]}
 */
export function appelsDuSocle(texte = '') {
  const lignes = String(texte).split(/\r?\n/)
  const appels = []
  const re = new RegExp(`^(\\s*)(?:-\\s+)?uses:\\s*['"]?${echappe(SOCLE_DEPOT)}/\\.github/workflows/([\\w.-]+\\.ya?ml)@`)
  for (let i = 0; i < lignes.length; i++) {
    const m = re.exec(lignes[i])
    if (!m) continue
    const niveau = m[1].length
    const avec = {}
    for (let j = i + 1; j < lignes.length; j++) {
      const l = lignes[j]
      if (!l.trim() || /^\s*#/.test(l)) continue
      if (retraitDe(l) < niveau) break
      if (retraitDe(l) === niveau && /^\s*with:\s*$/.test(l)) {
        for (let k = j + 1; k < lignes.length; k++) {
          const lk = lignes[k]
          if (!lk.trim() || /^\s*#/.test(lk)) continue
          if (retraitDe(lk) <= niveau) break
          const kv = /^\s*([\w-]+):\s*(.*)$/.exec(lk)
          if (kv && retraitDe(lk) === niveau + 2) avec[kv[1]] = sansGuillemets(sansCommentaire(kv[2])).slice(0, 60)
        }
        break
      }
    }
    appels.push({ workflow: m[2], avec })
  }
  return appels
}

/**
 * CE QU'UN RÉUTILISABLE LANCE COMME OUTILS DU SOCLE, et sous quelles options.
 *
 * Pour chaque étape qui nomme un outil, les options `inputs.<nom>` de son
 * `if:` et de celui de son job. `!inputs.x` demande l'option fausse. Une
 * condition plus riche (`||`, comparaison) est lue comme si chaque option
 * citée devait être vraie : on peut sous-compter, jamais inventer un usage.
 *
 * @returns {{ defauts: Record<string, string>, outils: { outil: string, si: { input: string, vrai: boolean }[] }[] }}
 */
export function outilsDuReutilisable(texte = '', outils = []) {
  const lignes = String(texte).split(/\r?\n/)
  const defauts = {}
  const iInputs = lignes.findIndex((l, i) => /^\s*inputs:\s*$/.test(l) && lignes.slice(Math.max(0, i - 3), i).some((p) => /workflow_call:\s*$/.test(p)))
  if (iInputs !== -1) {
    const base = retraitDe(lignes[iInputs])
    let courant = null
    for (let i = iInputs + 1; i < lignes.length; i++) {
      const l = lignes[i]
      if (!l.trim() || /^\s*#/.test(l)) continue
      if (retraitDe(l) <= base) break
      const nom = /^\s*([\w-]+):\s*$/.exec(l)
      if (nom && retraitDe(l) === base + 2) {
        courant = nom[1]
        continue
      }
      const d = /^\s*default:\s*(.*)$/.exec(l)
      if (d && courant) defauts[courant] = sansGuillemets(sansCommentaire(d[1]))
    }
  }
  const conditions = (expr) =>
    [...String(expr || '').matchAll(/(!?)\s*inputs\.([\w-]+)/g)].map((m) => ({ input: m[2], vrai: m[1] !== '!' }))
  const trouves = []
  let ifJob = ''
  let ifEtape = ''
  let retraitEtape = -1
  const reOutils = outils.length ? new RegExp(`(?:^|[\\s"'&|;(/])(${outils.map(echappe).join('|')})(?=[\\s"'&|;)]|$)`, 'g') : null
  for (const l of lignes) {
    if (!l.trim() || /^\s*#/.test(l)) continue
    // un job : deux espaces sous `jobs:` ; son `if:` à quatre
    if (/^ {2}[\w-]+:\s*$/.test(l)) {
      ifJob = ''
      ifEtape = ''
      retraitEtape = -1
      continue
    }
    const sij = /^ {4}if:\s*(.+)$/.exec(l)
    if (sij) {
      ifJob = sij[1]
      continue
    }
    // une étape commence par `- ` ; son `if:` peut être sur la même ligne
    const etape = /^(\s*)-\s+(.*)$/.exec(l)
    if (etape && (retraitEtape === -1 || etape[1].length <= retraitEtape)) {
      retraitEtape = etape[1].length
      const si = /^if:\s*(.+)$/.exec(etape[2])
      ifEtape = si ? si[1] : ''
      // `- run: npx pwa-screenshots` : l'outil est sur la ligne même de
      // l'étape, il faut la lire comme les suivantes.
      if (si) continue
    }
    const sie = /^\s*if:\s*(.+)$/.exec(l)
    if (sie && retraitEtape !== -1 && retraitDe(l) === retraitEtape + 2) {
      ifEtape = sie[1]
      continue
    }
    if (!reOutils) continue
    for (const m of l.matchAll(reOutils)) {
      const si = [...conditions(ifJob), ...conditions(ifEtape)]
      const cle = m[1] + '|' + JSON.stringify(si)
      if (!trouves.some((t) => t.cle === cle)) trouves.push({ cle, outil: m[1], si })
    }
  }
  return { defauts, outils: trouves.map(({ outil, si }) => ({ outil, si })) }
}

const vraie = (v) => v != null && !['', 'false', '0', 'null'].includes(String(v).trim().toLowerCase())

/** Les outils que la CI partagée lance pour un dépôt, d'après les options qu'il passe. */
export function outilsParLaCi(appels = [], ci = {}) {
  const out = new Set()
  for (const { workflow, avec } of appels) {
    const analyse = ci[workflow]
    if (!analyse) continue
    for (const { outil, si } of analyse.outils) {
      const valeur = (input) => (input in (avec || {}) ? avec[input] : analyse.defauts[input])
      if (si.every(({ input, vrai }) => vraie(valeur(input)) === vrai)) out.add(outil)
    }
  }
  return [...out].sort()
}

/* ── le graphe interne du socle ─────────────────────────────────────────── */

/** Le fichier qu'un export sert : la chaîne, ou la condition `import`/`default`. */
export function cibleExport(valeur) {
  if (typeof valeur === 'string') return valeur.replace(/^\.\//, '')
  if (valeur && typeof valeur === 'object') {
    for (const c of ['import', 'default', 'require', 'node']) {
      const v = cibleExport(valeur[c])
      if (v) return v
    }
  }
  return null
}

const normalise = (chemin) => {
  const out = []
  for (const s of chemin.split('/')) {
    if (s === '' || s === '.') continue
    if (s === '..') out.pop()
    else out.push(s)
  }
  return out.join('/')
}
const dossierDe = (chemin) => chemin.split('/').slice(0, -1).join('/')

/**
 * Les fichiers du socle qu'un fichier du socle cite : toute chaîne relative
 * (`'./labels.js'`, `"../format.js"`, `@import './components/x.css'`,
 * `extends: "./tsconfig-app.json"`, `new URL('./x.js', import.meta.url)`) qui
 * désigne un fichier EXISTANT, et toute auto-référence par le nom du paquet.
 */
export function dependancesDuFichier(chemin, texte, existants, parExport = new Map()) {
  const out = new Set()
  for (const m of String(texte).matchAll(/['"](\.\.?\/[^'"\s]+)['"]/g)) {
    const cible = normalise(`${dossierDe(chemin)}/${m[1]}`)
    if (cible !== chemin && existants.has(cible)) out.add(cible)
  }
  for (const s of importsDuSocle(texte)) {
    const cible = parExport.get(s)
    if (cible && cible !== chemin) out.add(cible)
  }
  return [...out]
}

/**
 * CE QUE CHAQUE MODULE DU SOCLE EMPORTE D'AUTRES MODULES — par fermeture
 * transitive sur les fichiers, intermédiaires compris.
 *
 * C'est ce qui sépare un module MORT d'un module qu'aucune app n'importe mais
 * que tout le monde reçoit : les huit `react/labels-*` passent par `react/i18n`,
 * `eslint-base` par `eslint-react`.
 *
 * LES OUTILS N'Y SONT PAS, et c'est délibéré. Essayé sur le vrai socle :
 * `pwa-doctor` cite le chemin de presque tous les modules, parce qu'il les
 * VÉRIFIE — il « emportait » 160 modules sur 173, et chaque app qui le lance
 * en CI les aurait tous reçus. Un outil de contrôle ne livre rien à l'app.
 *
 * @param {object} pkg  le package.json du socle
 * @param {{ chemin: string, texte: string | null }[]} fichiers
 * @returns {{ modules: Record<string, string[]> }}
 */
export function grapheDuSocle(pkg, fichiers = []) {
  const existants = new Set(fichiers.filter((f) => f.texte != null).map((f) => f.chemin))
  const textes = new Map(fichiers.map((f) => [f.chemin, f.texte]))
  // Fichier → clé d'export ; un motif (`components/*.css`) couvre ses fichiers.
  const cles = Object.entries(pkg?.exports || {})
    .filter(([k]) => k !== '.' && k !== './package.json')
    .map(([k, v]) => [k.replace(/^\.\//, ''), cibleExport(v)])
    .filter(([, cible]) => cible)
  const parExport = new Map(cles.filter(([k]) => !k.includes('*')).map(([k, cible]) => [k, cible]))
  const cleDuFichier = (f) => {
    for (const [k, cible] of cles) {
      if (!k.includes('*') && cible === f) return k
      if (k.includes('*')) {
        const [avant, apres] = cible.split('*')
        if (f.startsWith(avant) && f.endsWith(apres) && f.length > avant.length + apres.length) return k
      }
    }
    return null
  }
  const aretes = new Map()
  for (const f of existants) aretes.set(f, dependancesDuFichier(f, textes.get(f), existants, parExport))
  const atteint = (depart) => {
    const vus = new Set()
    const pile = [...(aretes.get(depart) || [])]
    while (pile.length) {
      const f = pile.pop()
      if (vus.has(f)) continue
      vus.add(f)
      pile.push(...(aretes.get(f) || []))
    }
    return vus
  }
  const enCles = (fichiersAtteints, soi) => [...new Set([...fichiersAtteints].map(cleDuFichier).filter((k) => k && k !== soi))].sort()
  const departs = (k, cible) => (k.includes('*') ? [...existants].filter((f) => cleDuFichier(f) === k) : [cible])
  const modules = {}
  for (const [k, cible] of cles) {
    const atteints = new Set(departs(k, cible).flatMap((f) => [...atteint(f)]))
    const liste = enCles(atteints, k)
    if (liste.length) modules[k] = liste
  }
  return { modules }
}

/** Les fichiers du socle à lire pour son graphe : le code et les feuilles, sans tests ni vitrine. */
export function fichiersDuSocle(chemins = []) {
  return chemins.filter(
    (c) => /\.(?:[cm]?js|css|json)$/i.test(c) && !/\.d\.ts$/.test(c) && !/(?:^|\/)package-lock\.json$/.test(c) && !/^(?:test|showroom|docs|node_modules|\.github|\.changeset|templates)\//.test(c),
  )
}

/* ── le rattachement ────────────────────────────────────────────────────── */

/**
 * L'usage d'un dépôt, rattaché à ce que le socle offre AUJOURD'HUI.
 *
 * - `modules` / `outils` : pris DIRECTEMENT (importés, appelés par un script) ;
 * - `outilsCi` : lancés pour lui par la CI partagée, selon ses options ;
 * - `inconnus` : des sous-chemins importés que le socle n'exporte pas — un
 *   module retiré, ou une faute : un import qui casserait à la prochaine montée.
 */
export function rattache(bruts, offre, scripts = {}) {
  const cles = new Set(offre?.modules || [])
  const modules = new Set()
  const inconnus = new Set()
  for (const s of bruts?.importes || []) {
    const m = moduleDe(s, cles)
    if (m) modules.add(m)
    else inconnus.add(s)
  }
  const outils = outilsDuSocle(scripts, offre?.outils || [])
  const outilsCi = outilsParLaCi(bruts?.appels || [], offre?.ci || {}).filter((o) => !outils.includes(o))
  const tri = (s) => [...s].sort()
  // Les modules reçus INDIRECTEMENT ne sont pas rangés ici : la page les
  // déduit de `modules` et du graphe du socle (`indirectsDe`, vue.mjs). Les
  // publier par dépôt pesait 23 Kio de plus, pour une donnée calculable.
  return { modules: tri(modules), inconnus: tri(inconnus), outils: [...outils].sort(), outilsCi }
}

/**
 * Les sous-chemins bruts d'une mesure reprise du cache. Ils ne sont pas
 * publiés — ils doublaient `modules`, 17 Kio — mais se reconstituent sans
 * perte : un export se rattache à lui-même, et un `inconnu` le reste tant que
 * le socle ne le réexporte pas.
 */
export function importesDe(usage) {
  if (Array.isArray(usage?.importes)) return usage.importes
  return [...(usage?.modules || []), ...(usage?.inconnus || [])].sort()
}

/**
 * Ce que le socle offre : ses exports (sans `./`), ses outils, ses workflows
 * réutilisables — et la famille de chaque module, calculée ICI parce que la
 * page n'embarque pas ce module (seuls `regles`, `vue`, `pilotage` et
 * `libelles` y sont insérés).
 */
export function offreDuSocle(pkg, workflowsReutilisables = []) {
  const modules = Object.keys(pkg?.exports || {})
    .filter((k) => k !== '.' && k !== './package.json')
    .map((k) => k.replace(/^\.\//, ''))
    .sort()
  return {
    version: pkg?.version ?? null,
    modules,
    categories: Object.fromEntries(modules.map((m) => [m, categorieModule(m)])),
    outils: Object.keys(pkg?.bin || {}).sort(),
    workflows: [...workflowsReutilisables].sort(),
  }
}
