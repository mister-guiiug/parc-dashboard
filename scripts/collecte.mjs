/**
 * Les règles pures de la COLLECTE — ce que `releve.mjs` lit sur le réseau, et
 * qui se vérifie sans lui.
 *
 * À la différence de `regles.mjs` et de `vue.mjs`, ce module n'est PAS inséré
 * dans la page : rien de ce qu'il fait ne sert au navigateur. Il est né le
 * 23/09/2026 avec les lectures nouvelles du relevé — la production de chaque
 * app, ses morceaux fugaces, Renovate, les pairs du socle, le journal et son
 * flux Atom. Chacune interprète un TEXTE venu d'ailleurs (un `sw.js`, un corps
 * d'issue, une réponse d'API), donc a des cas à éprouver.
 */
import { PLAFONDS_ENGINES, cmpVersion, nettoie, serieDe } from './regles.mjs'

/* ── Les pairs du socle ─────────────────────────────────────────────────── */

/**
 * Les pairs DURES d'un `package.json` : celles que npm installe d'office chez
 * chaque consommateur, qu'il les déclare ou non.
 *
 * C'est l'angle mort mesuré le 23/09/2026 : `typescript-eslint` était figé
 * dans 23 lockfiles du parc, mais seuls 6 dépôts le DÉCLARAIENT — le tableau
 * de bord, qui ne lisait que les déclarations, en comptait 5. Les pairs
 * OPTIONNELLES restent dehors : `@sentry/react` s'installe aussi chez qui ne
 * s'en sert pas, et la compter partout ferait du bruit, pas de la mesure.
 */
export function pairsDures(pkg) {
  const pairs = pkg?.peerDependencies || {}
  const meta = pkg?.peerDependenciesMeta || {}
  return Object.keys(pairs)
    .filter((p) => !meta[p]?.optional)
    .sort()
}

/* ── Les plages npm, et la dernière version d'une série ─────────────────── */

const triplet = (v) =>
  nettoie(v)
    .split('.')
    .map((n) => parseInt(n, 10) || 0)
const cmp3 = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]
// Une version STABLE et complète : ni préversion, ni métadonnée de build.
const STABLE = /^\d+\.\d+\.\d+$/
const COMPARATEUR = /^(\^|~|>=|<=|>|<|=)?v?(\d+|[xX*])(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?(?:-[0-9A-Za-z.-]+)?$/

/** Un comparateur npm (`^1.2.3`, `~1.2`, `>=7`, `1.x`…) en prédicat — `null` s'il est illisible. */
function comparateur(c) {
  const m = COMPARATEUR.exec(c)
  if (!m) return null
  const op = m[1] || '='
  const parts = [m[2], m[3], m[4]].map((x) => (x === undefined || /^[xX*]$/.test(x) ? null : Number(x)))
  const k = parts.indexOf(null)
  const prec = k === -1 ? 3 : k
  const base = [0, 1, 2].map((i) => (i < prec ? parts[i] : 0))
  // la borne haute, exclue : la partie `i` augmentée, les suivantes à zéro
  const sup = (i) => [0, 1, 2].map((j) => (j < i ? base[j] : j === i ? base[j] + 1 : 0))
  // `*`, `x`, `>=*` : tout ; `<*`, `>*` : rien
  if (prec === 0) return op === '<' || op === '>' ? () => false : () => true
  if (op === '=') return prec === 3 ? (v) => cmp3(v, base) === 0 : (v) => cmp3(v, base) >= 0 && cmp3(v, sup(prec - 1)) < 0
  if (op === '^') {
    // La première partie NON NULLE parmi celles écrites fixe la série — c'est
    // toute la règle du 0.x : `^0.32.1` s'arrête avant 0.33.0.
    let i = base.findIndex((n, j) => j < prec && n !== 0)
    if (i === -1) i = prec - 1
    return (v) => cmp3(v, base) >= 0 && cmp3(v, sup(i)) < 0
  }
  if (op === '~') return (v) => cmp3(v, base) >= 0 && cmp3(v, sup(prec >= 2 ? 1 : 0)) < 0
  if (op === '>=') return (v) => cmp3(v, base) >= 0
  if (op === '<') return (v) => cmp3(v, base) < 0
  if (op === '>') return prec === 3 ? (v) => cmp3(v, base) > 0 : (v) => cmp3(v, sup(prec - 1)) >= 0
  return prec === 3 ? (v) => cmp3(v, base) <= 0 : (v) => cmp3(v, sup(prec - 1)) < 0
}

/**
 * Une version satisfait-elle une plage npm ?
 *
 * Le sous-ensemble dont le parc se sert — relevé le 24/09/2026 sur les 33 pairs
 * du socle : `^`, `~`, `>=`, les unions `||` — plus les comparateurs nus, les
 * jokers et les intersections (`>=1.2.0 <2.0.0`). Le relevé n'a AUCUNE
 * dépendance, et `semver` ne vaut pas d'en prendre une pour quarante lignes.
 *
 * Ce qu'il ne lit pas — une plage à tiret `1.2.3 - 2.0.0` — ne prouve rien :
 * l'alternative est écartée, et une version douteuse n'est pas proposée.
 */
export function satisfait(version, plage) {
  if (!STABLE.test(String(version ?? ''))) return false
  const v = triplet(version)
  for (const alternative of String(plage ?? '').split('||')) {
    const comps = alternative
      .trim()
      .replace(/(>=|<=|>|<|=|\^|~)\s+/g, '$1')
      .split(/\s+/)
      .filter(Boolean)
    if (comps.includes('-')) continue
    const predicats = comps.map(comparateur)
    if (predicats.includes(null)) continue
    if (predicats.every((p) => p(v))) return true
  }
  return false
}

/**
 * LA DERNIÈRE VERSION D'UNE SÉRIE — la cible d'un correctif qui ne change pas
 * de majeur.
 *
 * Le 23/09/2026, `@sentry/react` 10.75.3 existait pour dix-huit dépôts en
 * 10.75.2, et la page ne le disait pas : l'amont était la 11.0.0, sortie le même
 * jour, et seul le majeur s'affichait. La cible d'un dépôt resté dans une autre
 * série que l'amont est la plus haute version STABLE de SA série, avec deux
 * bornes :
 *
 *  - **`latest`, quand il est dans cette série.** electron-builder publie ses
 *    26.15.4 à 26.16.1 sous l'étiquette `v26` et laisse `latest` en 26.15.3 ;
 *    Renovate ne propose jamais au-delà de `latest`, le relevé non plus.
 *  - **La plage que le socle impose à ses consommateurs** (`plage`) : une pair
 *    `~6.0.3` refuse 6.1, et une montée qui casserait `npm ci` n'est pas un
 *    correctif.
 *
 * Les versions dépréciées (npm) ou retirées (crates.io) sont écartées par
 * l'appelant, qui seul les connaît.
 *
 * @param {string[]} publiees Les versions publiées et utilisables.
 * @param {string} serie Une série de `serieDe` : `10`, `0.32`, `0.0.3`.
 * @param {{ latest?: string|null, plage?: string|null }} [bornes]
 */
export function derniereDeSerie(publiees, serie, { latest = null, plage = null } = {}) {
  const plafond = latest && STABLE.test(latest) && serieDe(latest) === serie ? latest : null
  let meilleure = null
  for (const v of publiees || []) {
    if (!STABLE.test(v) || serieDe(v) !== serie) continue
    if (plafond && cmpVersion(v, plafond) > 0) continue
    if (plage && !satisfait(v, plage)) continue
    if (!meilleure || cmpVersion(v, meilleure) > 0) meilleure = v
  }
  return meilleure
}

/**
 * Le plafond que le moteur impose à un paquet de types (`PLAFONDS_ENGINES` de
 * `regles.mjs`) : la plus haute version publiée qui n'en dépasse pas la
 * MINEURE. `engines.vscode: ^1.90.0` plafonne `@types/vscode` à la dernière
 * 1.90.x — ou, si aucune 1.90 n'existe, à la plus haute des mineures
 * inférieures. `null` quand le paquet ou le moteur ne s'y prêtent pas.
 */
export function plafondEngines(paquet, pkg, publiees) {
  const moteur = PLAFONDS_ENGINES[paquet]
  const plage = moteur ? pkg?.engines?.[moteur] : null
  if (!plage) return null
  const [maj, min] = triplet(plage)
  let meilleure = null
  for (const v of publiees || []) {
    if (!STABLE.test(v)) continue
    const [a, b] = triplet(v)
    if (a !== maj || b > min) continue
    if (!meilleure || cmpVersion(v, meilleure) > 0) meilleure = v
  }
  return meilleure
}

/* ── Les package.json imbriqués, et les `.nvmrc` ────────────────────────── */

// Ce qui ne porte pas le code du dépôt : un `package.json` d'exemple, de jeu
// d'essai ou de gabarit n'est pas une dépendance qui TOURNE, et les dossiers
// cachés (`.github/`, `.claude/`) non plus.
const HORS_UNITE = /(?:^|\/)(?:node_modules|fixtures?|__fixtures__|examples?|templates?|\.[^/]+)\//

/** Un motif d'espace de travail npm (`packages/*`, `apps/**`) en expression régulière. */
const motifEspace = (g) =>
  new RegExp(
    '^' +
      String(g)
        .replace(/\/+$/, '')
        .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*/g, '\u0000')
        .replace(/\*/g, '[^/]*')
        .replace(/\u0000/g, '.*') +
      '$',
  )

/** Les espaces de travail que déclare un `package.json` racine. */
export const espacesDeTravail = (pkg) => {
  const w = pkg?.workspaces
  return (Array.isArray(w) ? w : Array.isArray(w?.packages) ? w.packages : []).filter((g) => typeof g === 'string' && !g.startsWith('!'))
}

/**
 * LES PACKAGE.JSON IMBRIQUÉS QUI FIGENT QUELQUE CHOSE, d'après la liste des
 * fichiers d'un dépôt (l'arbre git).
 *
 * Le relevé ne lisait que la racine. Le 23/09/2026, cinq dossiers portaient
 * leur PROPRE lockfile, donc leurs propres versions : `miss-genius/worker`,
 * `miss-supatool/proxy`, `mister-cim10/workers` (wrangler), `mister-doc/e2e`
 * (Playwright), `mister-commitia/apps/desktop` (React, Tauri). Aucun n'était
 * compté.
 *
 * Un dossier SANS lockfile propre n'est retenu que s'il est un espace de
 * travail de la racine — c'est alors le lock racine qui le fige
 * (`lock: 'racine'`). Sinon, rien ne fige ses versions : elles se résolvent à
 * chaque installation (`miss-supaboss/proxy`), et les attribuer au lock racine
 * inventerait une version qu'il ne tient pas.
 *
 * @param {string[]} chemins Les fichiers du dépôt.
 * @param {string[]} espaces Les motifs `workspaces` de la racine.
 * @returns {{dossier: string, lock: 'propre'|'racine'}[]}
 */
export function unitesDeLArbre(chemins, espaces = []) {
  const presents = new Set(chemins || [])
  const motifs = espaces.map(motifEspace)
  const out = []
  for (const p of presents) {
    if (!p.endsWith('/package.json') || HORS_UNITE.test(p)) continue
    const dossier = p.slice(0, -'/package.json'.length)
    if (presents.has(`${dossier}/package-lock.json`)) out.push({ dossier, lock: 'propre' })
    else if (motifs.some((re) => re.test(dossier))) out.push({ dossier, lock: 'racine' })
  }
  return out.sort((a, b) => a.dossier.localeCompare(b.dossier))
}

/**
 * Les versions qu'un lockfile fige pour une unité : ses dépendances de premier
 * niveau. Pour un espace de travail, ce que le lock range sous
 * `<dossier>/node_modules/` l'emporte sur ce qu'il a hissé à la racine.
 */
export function verrouilleesDe(lock, dossier = '') {
  const out = {}
  const paquets = lock?.packages || {}
  const lis = (prefixe) => {
    for (const [chemin, info] of Object.entries(paquets)) {
      if (!chemin.startsWith(prefixe) || !info?.version) continue
      const nom = chemin.slice(prefixe.length)
      if (!nom.includes('node_modules/')) out[nom] = info.version
    }
  }
  lis('node_modules/')
  if (dossier) lis(`${dossier}/node_modules/`)
  return out
}

/**
 * La version qu'un `.nvmrc` épingle — seulement si elle est COMPLÈTE. `26`
 * suit la dernière 26.x d'elle-même, `lts/*` la dernière LTS : ni l'une ni
 * l'autre n'est en retard sur quoi que ce soit, et les comparer à 26.10.0 les
 * y mettrait.
 */
export function versionNvmrc(texte) {
  const t = String(texte ?? '')
    .split(/\r?\n/)[0]
    .trim()
    .replace(/^v/i, '')
  return STABLE.test(t) ? t : null
}

/* ── La production ──────────────────────────────────────────────────────── */

// Un changement qui ne touche QUE ces fichiers ne change pas le site servi :
// documentation, outillage, tests. `package.json`, les lockfiles et `.nvmrc`
// n'y sont PAS — une dépendance ou un Node différents peuvent changer le build.
const HORS_BUILD =
  /^(?:.*\.md|docs\/.*|\.github\/.*|\.vscode\/.*|\.husky\/.*|\.changeset\/.*|(?:e2e|tests?)\/.*|.*\.(?:test|spec)\.[cm]?[jt]sx?|(?:playwright|vitest|eslint|prettier|commitlint|lint-staged)\.config\.[cm]?[jt]s|LICEN[CS]E.*|renovate\.json5?|\.gitattributes|\.gitignore|\.editorconfig|\.prettierignore)$/i

/** Ce fichier peut-il changer sans que le site servi change ? */
export const horsBuild = (chemin) => HORS_BUILD.test(String(chemin || ''))

// Au-delà, l'API de comparaison tronque la liste des fichiers : on ne peut
// plus affirmer que TOUT ce qui a changé est hors build.
const PLAFOND_FICHIERS = 300

// Un déploiement Pages prend quelques minutes : une tête plus jeune que ça
// est probablement en train de partir, pas en retard.
const DELAI_DEPLOIEMENT_MIN = 30

/**
 * L'état de la production d'une app, d'après le `version.json` qu'elle publie
 * et la tête de sa branche par défaut.
 *
 * Chaque app du parc sert un `version.json` qui porte le commit construit.
 * Le comparer à `main` répond à une question qu'aucun vert de CI ne tranche :
 * ce qui tourne en ligne est-il ce qui est fusionné ? Un déploiement bloqué
 * (`miss-carbook`, dont le build attend une migration Supabase) laisse une CI
 * verte et une production d'hier.
 *
 * @param {{commit?: string, buildTime?: string}|null} version  `version.json` lu sur le site
 * @param {{sha?: string, dateCommit?: string}} tete  dernier commit de la branche par défaut
 * @param {{ahead_by?: number, files?: {filename: string}[]}|null} comparaison
 *   `compare/<déployé>...<branche>`, demandée seulement quand les deux diffèrent
 * @param {number} maintenant
 */
export function etatProd(version, tete, comparaison, maintenant) {
  const deploye = typeof version?.commit === 'string' && /^[0-9a-f]{7,40}$/i.test(version.commit) ? version.commit : null
  if (!deploye) return { etat: 'inconnu' }
  const base = { commit: deploye.slice(0, 7), construit: version.buildTime ?? null }
  const sha = String(tete?.sha || '')
  if (sha.length >= 7 && (deploye.startsWith(sha) || sha.startsWith(deploye))) return { ...base, etat: 'aJour' }
  if (!comparaison) return { ...base, etat: 'inconnu' }
  const retard = comparaison.ahead_by ?? 0
  if (retard === 0) return { ...base, etat: 'aJour' }
  const fichiers = (comparaison.files || []).map((f) => f.filename)
  if (fichiers.length < PLAFOND_FICHIERS && fichiers.every(horsBuild)) return { ...base, etat: 'equivalent', retard }
  const age = tete?.dateCommit ? (maintenant - Date.parse(tete.dateCommit)) / 60000 : Infinity
  if (age < DELAI_DEPLOIEMENT_MIN) return { ...base, etat: 'deploiement', retard }
  return { ...base, etat: 'retard', retard }
}

/* ── Les morceaux fugaces ───────────────────────────────────────────────── */

/**
 * Le nom d'un morceau que Vite a empreinté : `-` puis huit caractères, puis
 * `.js`. C'est la règle `chunk-hors-precache` de `pwa-doctor` (socle 6.8.0),
 * appliquée cette fois au site EN LIGNE plutôt qu'au `dist/` d'un build.
 */
export const EMPREINTE_VITE = /-[A-Za-z0-9_-]{8}\.js$/

/** Les fichiers d'un manifeste de précache Workbox, qu'il soit minifié ou non. */
export function precacheDe(sw) {
  const re = /["']?url["']?\s*:\s*["']([^"']+\.(?:js|css|html|svg|png|webp|woff2|webmanifest|ico|json))["']/g
  return new Set([...String(sw || '').matchAll(re)].map((m) => m[1].split('/').pop()))
}

/**
 * L'entrée d'une page servie : le premier `<script type="module" src>`, dans
 * un ordre d'attributs ou dans l'autre.
 */
export function entreeDe(html) {
  const t = String(html || '')
  const m = /<script\b[^>]*\btype=["']module["'][^>]*\bsrc=["']([^"']+)["']/i.exec(t) || /<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*\btype=["']module["']/i.exec(t)
  return m ? m[1] : null
}

/**
 * Les morceaux qu'une entrée Vite charge : les imports relatifs (`"./x.js"`) et
 * les listes de `__vite__mapDeps` (`"assets/x.js"`). Une URL absolue — le
 * `/app/sw.js` que l'entrée enregistre — n'a ni l'un ni l'autre préfixe, et
 * reste dehors.
 */
export function referencesDe(entree) {
  const out = new Set()
  for (const m of String(entree || '').matchAll(/["'`](?:\.\/|assets\/)([A-Za-z0-9._-]+\.js)["'`]/g)) out.add(m[1])
  return out
}

/**
 * Les morceaux FUGACES : chargés par l'entrée, absents du précache, et nommés
 * par empreinte. Leur URL meurt au déploiement suivant, pendant que la coquille
 * précachée continue de la demander — c'est ce qui a rendu Sentry muet sur
 * dix-neuf dépôts jusqu'au 22/09/2026.
 */
export function fugacesDe(references, precache) {
  return [...references].filter((f) => !precache.has(f) && EMPREINTE_VITE.test(f)).sort()
}

/* ── L'état de CI d'une pull request ────────────────────────────────────── */

/**
 * Un seul mot pour l'ensemble des check-runs d'un commit : `rouge` si un seul
 * échoue, `encours` si l'un tourne encore, `vert` sinon — et `null` quand il
 * n'y en a aucun, ce qui n'est pas un succès.
 */
export function etatChecks(checkRuns) {
  const runs = Array.isArray(checkRuns) ? checkRuns : []
  if (!runs.length) return null
  if (runs.some((r) => ['failure', 'timed_out', 'cancelled', 'action_required', 'startup_failure'].includes(r.conclusion))) return 'rouge'
  if (runs.some((r) => r.status !== 'completed')) return 'encours'
  return 'vert'
}

/* ── Sécurité et qualité (Code scanning / CodeQL) ───────────────────────── */

// Une alerte est GRAVE quand GitHub lui donne un niveau de sécurité élevé —
// c'est le chiffre que l'onglet « Security and quality » met en avant. La
// sévérité SARIF (`error` / `warning`) reste un second axe : une `error` sans
// niveau de sécurité compte aussi, mais à part.
const SCANNING_GRAVE = (a) => ['high', 'critical'].includes(a?.rule?.security_severity_level)
const SCANNING_ERREUR = (a) => a?.rule?.severity === 'error'

/**
 * Le résumé d'une liste d'alertes Code scanning déjà lue.
 *
 * @param {unknown[]} liste
 * @returns {{ etat: 'lu', total: number, graves: number, erreurs: number }}
 */
export function resumeScanning(liste) {
  const l = Array.isArray(liste) ? liste : []
  return {
    etat: 'lu',
    total: l.length,
    graves: l.filter(SCANNING_GRAVE).length,
    erreurs: l.filter(SCANNING_ERREUR).length,
  }
}

/**
 * Interprète la réponse HTTP de `GET /repos/.../code-scanning/alerts`.
 *
 * Trois états, jamais deux — comme les alertes Dependabot : un compte, ou
 * « pas d'analyse sur ce dépôt », ou « illisible ». Afficher « 0 » quand le
 * jeton n'a pas le droit de lire serait exactement la fausse assurance que
 * le relevé refuse ailleurs.
 *
 * - `404` « no analysis found » et `403` « not enabled » : le dépôt n'a
 *   simplement pas d'analyse — `desactivees`.
 * - tout autre échec : `illisible`.
 *
 * @param {number} status
 * @param {unknown} corps corps JSON, ou texte brut d'erreur
 */
export function scanningDepuisReponse(status, corps) {
  const msg = typeof corps === 'string' ? corps : JSON.stringify(corps ?? '')
  if (status === 404 || (status === 403 && /not enabled|no analysis found/i.test(msg))) {
    return { etat: 'desactivees' }
  }
  if (status < 200 || status >= 300) return { etat: 'illisible' }
  if (!Array.isArray(corps)) return { etat: 'illisible' }
  return resumeScanning(corps)
}

/* ── Renovate ───────────────────────────────────────────────────────────── */

// Une ligne d'action du « Dependency Dashboard » : une case, un commentaire qui
// nomme la branche, puis le titre. `create-all-…` et `manual job` n'ont pas de
// `-branch=` et restent dehors — ce ne sont pas des mises à jour.
const ACTION_RENOVATE = /^\s*-\s*\[[ xX]\]\s*<!--\s*(?:unschedule|approve|rebase|recreate|unlimit|retry)-branch=(\S+)\s*-->(.*)$/

/**
 * Les mises à jour qu'un « Dependency Dashboard » de Renovate tient en attente.
 *
 * Format relevé sur le tableau de `mister-qowa` le 23/09/2026, pas supposé :
 * une section `## Awaiting Schedule` (le préréglage du parc ne passe que le
 * samedi), des cases `- [ ] <!-- unschedule-branch=… -->titre`, puis
 * `## Detected Dependencies`, qui n'est qu'un inventaire.
 *
 * Une mise à jour est MAJEURE quand Renovate le dit : une branche `major-…`,
 * un groupe « (major) », ou un titre en `to vN` — les mineures et correctifs
 * s'écrivent `to v1.2.3`.
 *
 * `introuvables` : les paquets que Renovate n'a PAS PU RÉSOUDRE. Relevé sur le
 * même tableau : « Failed to look up npm package @mister-guiiug/dev-pwa-config:
 * no-result ». Le socle est publié sur GitHub Packages, que Renovate ne sait
 * pas interroger sans jeton : la règle du préréglage qui lui réserve « une PR à
 * lui seul, dès qu'il sort » ne peut donc jamais servir. Un robot qui se tait
 * sur un paquet ne dit pas qu'il est à jour.
 */
export function lisTableauRenovate(corps) {
  const mises = []
  const introuvables = new Set()
  for (const m of String(corps || '').matchAll(/Failed to look up (?:\S+ )?package ([^\s:`]+)/g)) introuvables.add(m[1])
  let section = null
  for (const ligne of String(corps || '').split('\n')) {
    const h = /^##\s+(.+?)\s*$/.exec(ligne)
    if (h) {
      section = h[1]
      continue
    }
    const m = ACTION_RENOVATE.exec(ligne)
    if (!m) continue
    const titre = m[2].replace(/\s+/g, ' ').trim()
    const majeure = /(?:^|\/)major-/.test(m[1]) || /\(major\)/i.test(titre) || /\bto v\d+(?=\s|$)/.test(titre)
    mises.push({ section, branche: m[1], titre, majeure })
  }
  return { enAttente: mises.length, majeures: mises.filter((x) => x.majeure).length, mises, introuvables: [...introuvables].sort() }
}

/* ── Le journal des changements, et son flux Atom ───────────────────────── */

const cleEvenement = (e) => [e.type, e.depot, e.paquet, e.workflow, e.de, e.a].join('|')

/**
 * Le journal des changements, relevé après relevé — le plus récent d'abord.
 *
 * `changements` de la page se compare à la photo du jour ; le journal, lui,
 * garde la TRANSITION de chaque passage horaire, datée. C'est lui que le flux
 * Atom publie. Un événement identique déjà noté dans les dernières 24 h n'est
 * pas renoté : un repli sur la photo du jour recalculerait sinon des
 * transitions déjà annoncées.
 */
export function journalMisAJour(journal, nouveaux, quand, max = 60) {
  const avant = Array.isArray(journal) ? journal.filter((e) => e && typeof e.quand === 'string') : []
  const limite = Date.parse(quand) - 86400000
  const recents = new Set(avant.filter((e) => Date.parse(e.quand) >= limite).map(cleEvenement))
  const ajouts = (Array.isArray(nouveaux) ? nouveaux : []).filter((e) => !recents.has(cleEvenement(e))).map((e) => ({ ...e, quand }))
  return [...ajouts, ...avant].slice(0, max)
}

const echappeXml = (s) => String(s ?? '').replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c])

/**
 * Un flux Atom (RFC 4287) minimal et valide : `id`, `title`, `updated` et un
 * auteur au niveau du flux ; `id`, `title`, `updated` et un lien par entrée.
 * Tout texte passe par l'échappement XML — un titre de commit porte volontiers
 * des `<` et des `&`.
 */
export function fluxAtom({ id, titre, lien, soi, maj, entrees }) {
  const l = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom">',
    `  <id>${echappeXml(id)}</id>`,
    `  <title>${echappeXml(titre)}</title>`,
    `  <link rel="alternate" type="text/html" href="${echappeXml(lien)}"/>`,
    `  <link rel="self" type="application/atom+xml" href="${echappeXml(soi)}"/>`,
    `  <updated>${echappeXml(maj)}</updated>`,
    '  <author><name>parc-dashboard</name></author>',
  ]
  for (const e of entrees || []) {
    l.push(
      '  <entry>',
      `    <id>${echappeXml(e.id)}</id>`,
      `    <title>${echappeXml(e.titre)}</title>`,
      `    <updated>${echappeXml(e.quand)}</updated>`,
      `    <link rel="alternate" type="text/html" href="${echappeXml(e.lien)}"/>`,
      '  </entry>',
    )
  }
  l.push('</feed>', '')
  return l.join('\n')
}
