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
export const VERSION_MESURE = 2

/** La mesure connue d'un dépôt est-elle reprenable telle quelle ? */
export function usageReprenable(connu, memeTete) {
  return Boolean(memeTete && connu?.usageSocle?.v === VERSION_MESURE && Array.isArray(connu.usageSocle.importes))
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
 * L'usage d'un dépôt, à partir de ses fichiers lus.
 *
 * `inconnus` : des sous-chemins importés que le socle n'exporte pas — un
 * module retiré, ou une faute. Ils ne comptent dans aucune ligne, mais la
 * page les montre : c'est un import qui casserait à la prochaine montée.
 *
 * @param {{ chemin: string, texte: string | null }[]} fichiers
 * @param {{ modules: string[], outils: string[] }} offre
 */
export function usageDepuisFichiers(fichiers = [], offre = { modules: [], outils: [] }) {
  const cles = new Set(offre.modules || [])
  const modules = new Set()
  const inconnus = new Set()
  const workflows = new Set()
  let outils = []
  for (const { chemin, texte } of fichiers) {
    if (texte == null) continue
    if (WORKFLOW.test(chemin)) {
      for (const w of workflowsDuSocle(texte)) workflows.add(w)
      continue
    }
    for (const s of importsDuSocle(texte)) {
      const m = moduleDe(s, cles)
      if (m) modules.add(m)
      else inconnus.add(s)
    }
    if (chemin === 'package.json') {
      try {
        outils = outilsDuSocle(JSON.parse(texte).scripts, offre.outils || [])
      } catch {
        // un package.json illisible ne dit rien des outils
      }
    }
  }
  const tri = (s) => [...s].sort()
  return { modules: tri(modules), outils: [...outils].sort(), workflows: tri(workflows), inconnus: tri(inconnus) }
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
