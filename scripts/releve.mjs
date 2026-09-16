#!/usr/bin/env node
// Relève l'état du parc et régénère index.html.
//
//   node scripts/releve.mjs                    # API seule (ce que fait la CI)
//   node scripts/releve.mjs --local D:/Src/... # + l'état des copies de travail
//   node scripts/releve.mjs --prives           # + les dépôts privés (PAT requis)
//
// Tout vient de l'API GitHub, de raw.githubusercontent et du registre npm : le
// runner n'a aucune copie de travail sous la main. Le mode --local n'ajoute que
// ce que l'API ne peut pas savoir (branche courante, fichiers non commités).
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
// Les règles pures vivent à part : ce fichier-ci s'exécute à l'import, elles
// ne seraient pas testables autrement. Voir `scripts/regles.mjs`.
import { SOCLE, changementsDepuis, classe, cmpVersion, etatDe, fond, fusionnePoint, nettoie } from './regles.mjs'
// Ce que le relevé CALCULE vit à part de ce qu'il va CHERCHER : importer ce
// fichier-ci déclenche la collecte, exige un jeton et consomme trois cent
// trente appels d'API. Voir `scripts/modele.mjs`.
import { SEUIL_DORMANCE_JOURS, estDormante, etatDormance, maturitesDuCatalogue, pileDuDepot } from './modele.mjs'

const ICI = dirname(fileURLToPath(import.meta.url))
const COMPTE = process.env.PARC_COMPTE || 'mister-guiiug'
// PARC_TOKEN d'abord : si le GITHUB_TOKEN du dépôt ne suffit pas à lire l'API
// Actions des AUTRES dépôts, un PAT en secret prend le relais sans rien changer.
const JETON = process.env.PARC_TOKEN || process.env.GITHUB_TOKEN || process.env.GH_TOKEN || ''
const args = process.argv.slice(2)
const RACINE_LOCALE = args.includes('--local') ? args[args.indexOf('--local') + 1] : null
const AVEC_PRIVES = args.includes('--prives')
// En mode --local la page porte l'état de la copie de travail : elle ne doit
// pas atterrir dans le fichier publié, que la CI réécrirait au relevé suivant.
const SORTIE = args.includes('--sortie') ? args[args.indexOf('--sortie') + 1] : join(ICI, '..', RACINE_LOCALE ? 'index.local.html' : 'index.html')
// L'historique publié n'est alimenté QUE par le relevé publié. Ni `--local`, qui
// porte l'état d'une copie de travail, ni `--sortie`, qui sert aux essais, n'ont
// à laisser un point dans une série qui se lit sur un an.
const ALIMENTE_HISTORIQUE = !RACINE_LOCALE && !args.includes('--sortie')

if (!JETON) {
  console.error('GITHUB_TOKEN absent : les quotas anonymes (60 req/h) ne suffiront pas.')
  process.exit(1)
}

/* ------------------------------------------------------------------ outils */

const API = 'https://api.github.com'
let appels = 0
const refus = new Set()

async function api(chemin, { brut = false, silence404 = false } = {}) {
  const url = chemin.startsWith('http') ? chemin : API + chemin
  for (let essai = 1; essai <= 4; essai++) {
    appels++
    const res = await fetch(url, {
      headers: {
        authorization: `Bearer ${JETON}`,
        accept: brut ? 'application/vnd.github.raw' : 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'user-agent': 'parc-dashboard',
      },
    })
    if (res.status === 404) {
      if (!silence404) console.error(`  404 ${chemin}`)
      return null
    }
    if (res.status === 403 || res.status === 429) {
      const reste = res.headers.get('x-ratelimit-remaining')
      const retry = Number(res.headers.get('retry-after'))
      const estLimite = retry > 0 || reste === '0'
      if (!estLimite) {
        // 403 de DROITS, pas de quota : réessayer n'y changerait rien, et
        // attendre quatre fois ferait passer une panne de permission pour
        // une lenteur. On le dit et on rend la main.
        refus.add(chemin.split('/').slice(0, 3).join('/'))
        console.error(`  403 refusé (droits) sur ${chemin}`)
        return null
      }
      const attente = retry || Math.min(60, 2 ** essai)
      console.error(`  ${res.status} sur ${chemin} — quota épuisé, pause ${attente}s`)
      await new Promise((r) => setTimeout(r, attente * 1000))
      continue
    }
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} sur ${chemin}`)
    return brut ? await res.text() : await res.json()
  }
  throw new Error(`abandon après 4 essais : ${chemin}`)
}

// les fichiers passent par raw.githubusercontent : hors quota d'API et sans
// la limite de 1 Mo de l'API contents (un package-lock la dépasse souvent)
async function fichier(nwo, branche, chemin) {
  const res = await fetch(`https://raw.githubusercontent.com/${nwo}/${branche}/${chemin}`, {
    headers: { authorization: `Bearer ${JETON}`, 'user-agent': 'parc-dashboard' },
  })
  if (!res.ok) return null
  return await res.text()
}

async function enLot(elements, largeur, travail) {
  const sortie = new Array(elements.length)
  let i = 0
  await Promise.all(
    Array.from({ length: Math.min(largeur, elements.length) }, async () => {
      while (i < elements.length) {
        const n = i++
        sortie[n] = await travail(elements[n], n)
      }
    }),
  )
  return sortie
}

const json = (t) => {
  if (!t) return null
  try {
    return JSON.parse(t)
  } catch {
    return null
  }
}

/* ------------------------------------------------- classement des dépôts */

const FAMILLES = {
  pwa: { titre: 'Applications PWA', sous: 'Applications web installables, déployées sur GitHub Pages.' },
  desktop: { titre: 'Applications desktop', sous: 'Empaquetées avec Electron, Tauri ou .NET — hors chaîne Pages.' },
  socle: { titre: 'Socle', sous: 'La bibliothèque, le squelette et le générateur dont vivent les applications.' },
  autre: { titre: 'Outillage et divers', sous: 'Extensions, compétences, configuration du compte.' },
}

/* --------------------------------------------------------- enrichissement local */

function git(dir, ...a) {
  return new Promise((ok) => {
    execFile('git', ['-C', dir, ...a], { windowsHide: true, maxBuffer: 1 << 24 }, (e, out) => ok(e ? '' : out.trim()))
  })
}
async function etatLocal(nom) {
  if (!RACINE_LOCALE) return null
  const dir = join(RACINE_LOCALE, nom)
  if (!existsSync(join(dir, '.git'))) return null
  const [branche, porcelain, amont] = await Promise.all([
    git(dir, 'rev-parse', '--abbrev-ref', 'HEAD'),
    git(dir, 'status', '--porcelain'),
    git(dir, 'rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'),
  ])
  let avance = null
  let retard = null
  if (amont) {
    const c = (await git(dir, 'rev-list', '--left-right', '--count', `${amont}...HEAD`)).split(/\s+/)
    if (c.length === 2) {
      retard = Number(c[0])
      avance = Number(c[1])
    }
  }
  return { branche, modifies: porcelain ? porcelain.split('\n').filter(Boolean).length : 0, avance, retard }
}

/* ------------------------------------------------------------- collecte */

const MAINTENANT = new Date()
const jours = (iso) => (iso ? Math.floor((MAINTENANT - new Date(iso)) / 86400000) : null)

const allege = (r) => ({
  etat: etatDe(r),
  conclusion: r.conclusion,
  statut: r.status,
  date: r.created_at,
  url: r.html_url,
  num: r.run_number,
  ms: r.updated_at && r.created_at ? new Date(r.updated_at) - new Date(r.created_at) : null,
  branche: r.head_branch,
  titre: r.display_title,
  id: r.id,
})

console.error(`Relevé du parc ${COMPTE}${RACINE_LOCALE ? ' (+ copies de travail)' : ''}…`)

const bruts = []
for (let page = 1; page <= 5; page++) {
  const lot = await api(`/users/${COMPTE}/repos?per_page=100&type=owner&page=${page}`)
  if (!lot || !lot.length) break
  bruts.push(...lot)
  if (lot.length < 100) break
}
// Le dépôt qui héberge ce relevé s'exclut lui-même : au moment où il se lit,
// son propre workflow est forcément « en cours », et ses numéros de run bougent
// à chaque passage — il se rendrait éternellement différent de lui-même, et la
// comparaison « le fond a-t-il changé ? » ne dirait plus jamais non.
const SOI = (process.env.GITHUB_REPOSITORY || '').split('/')[1] || 'parc-dashboard'
const depotsGitHub = bruts.filter((r) => !r.fork && !r.archived && r.name !== SOI && (AVEC_PRIVES || !r.private)).sort((a, b) => a.name.localeCompare(b.name))
console.error(`${depotsGitHub.length} dépôts retenus (${SOI} s'exclut lui-même)`)

const depots = await enLot(depotsGitHub, 5, async (g) => {
  const nwo = g.full_name
  const def = g.default_branch

  const [commit, listeWf, pages, prs, pkgTxt, lockTxt, cargoTxt, local] = await Promise.all([
    api(`/repos/${nwo}/commits/${encodeURIComponent(def)}`, { silence404: true }),
    api(`/repos/${nwo}/actions/workflows?per_page=100`),
    api(`/repos/${nwo}/pages`, { silence404: true }),
    api(`/repos/${nwo}/pulls?state=open&per_page=30`),
    fichier(nwo, def, 'package.json'),
    fichier(nwo, def, 'package-lock.json'),
    fichier(nwo, def, 'Cargo.lock'),
    etatLocal(g.name),
  ])

  // Une lecture refusée ne doit pas ressembler à « ce dépôt n'a pas de
  // pipeline » : sans ce drapeau, un 403 publierait une page tout au vert.
  const lectureIncomplete = listeWf === null
  // L'API nomme un workflow SUPPRIMÉ par son chemin de fichier : interroger
  // /actions/runs à plat ferait remonter de vieux échecs comme actuels.
  const actifs = (listeWf?.workflows || []).filter((w) => w.state === 'active')
  const workflows = await enLot(actifs, 4, async (w) => {
    let surDefaut = true
    let runs = (await api(`/repos/${nwo}/actions/workflows/${w.id}/runs?per_page=5&branch=${encodeURIComponent(def)}`))?.workflow_runs || []
    if (!runs.length) {
      surDefaut = false
      runs = (await api(`/repos/${nwo}/actions/workflows/${w.id}/runs?per_page=1`))?.workflow_runs || []
    }
    const derniers = runs.map(allege)
    const dernier = derniers[0] || null
    return {
      nom: w.name,
      fichier: w.path.replace('.github/workflows/', ''),
      chemin: w.path,
      // les réutilisables du socle n'ont pas de run propre : les compter avec
      // les autres les ferait passer pour « jamais exécutés »
      reutilisable: /^(Reusable|pwa-)/i.test(w.name) || /\/pwa-[a-z0-9-]+\.ya?ml$/.test(w.path),
      etat: dernier ? dernier.etat : 'jamais',
      surDefaut,
      conclusion: dernier?.conclusion || null,
      date: dernier?.date || null,
      url: dernier?.url || w.html_url,
      duree: dernier?.ms || null,
      branche: dernier?.branche || null,
      derniers,
      idDernier: dernier?.id || null,
    }
  })
  workflows.sort((a, b) => {
    const rang = (w) => (w.etat === 'rouge' ? 0 : w.etat === 'encours' ? 1 : w.etat === 'vert' ? 2 : 3)
    return rang(a) - rang(b) || a.nom.localeCompare(b.nom)
  })

  // Une plage `^4.7.0` accepte déjà 4.9.0 : seul le lockfile dit l'installé.
  const pkg = json(pkgTxt)
  const lock = json(lockTxt)
  const verrouillees = {}
  if (lock?.packages) {
    for (const [chemin, info] of Object.entries(lock.packages)) {
      if (!chemin.startsWith('node_modules/')) continue
      const n = chemin.slice('node_modules/'.length)
      if (n.includes('node_modules/') || !info.version) continue
      verrouillees[n] = info.version
    }
  }
  const crates = {}
  if (cargoTxt) {
    for (const bloc of cargoTxt.split('[[package]]').slice(1)) {
      const n = /name\s*=\s*"([^"]+)"/.exec(bloc)?.[1]
      const v = /version\s*=\s*"([^"]+)"/.exec(bloc)?.[1]
      if (n && v) crates[n] = v
    }
  }
  const declarees = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) }

  const compte = { vert: 0, rouge: 0, neutre: 0, encours: 0, jamais: 0 }
  for (const w of workflows) compte[w.etat]++

  return {
    nom: g.name,
    nwo,
    url: g.html_url,
    visibilite: g.private ? 'PRIVATE' : 'PUBLIC',
    prive: g.private,
    description: g.description,
    licence: g.license?.spdx_id || null,
    tailleKo: g.size,
    brancheDefaut: def,
    pushGitHub: g.pushed_at,
    joursDepuisPush: jours(g.pushed_at),
    commit: commit
      ? { sha: commit.sha.slice(0, 7), auteur: commit.commit.author?.name || '?', date: commit.commit.author?.date, sujet: (commit.commit.message || '').split('\n')[0], jours: jours(commit.commit.author?.date) }
      : { sha: '?', auteur: '?', date: g.pushed_at, sujet: '(commit illisible)', jours: jours(g.pushed_at) },
    local,
    pagesUrl: pages?.html_url || null,
    prs: (prs || []).map((p) => ({ num: p.number, titre: p.title, brouillon: p.draft, branche: p.head?.ref, date: p.created_at })),
    workflows,
    compte,
    declarees,
    verrouillees,
    crates,
    paquet: pkg ? { nom: pkg.name, version: pkg.version, prive: !!pkg.private } : null,
    nbDeps: Object.keys(declarees).length,
    nbVerrouilles: Object.keys(verrouillees).length || null,
    nbCrates: Object.keys(crates).length || null,
    langage: g.language || null,
    lectureIncomplete,
    ...classe(g.name, declarees, crates, pkg, g.language),
  }
})

// contrôle : un dépôt du socle qui disparaît doit se voir, pas se taire
for (const nom of Object.keys(SOCLE)) {
  if (!depots.some((d) => d.nom === nom)) console.error(`  ATTENTION : ${nom} est déclaré dans le socle mais absent du relevé`)
}

/* ------------------------------------------------ maturité des applications */

const depotSocle = depots.find((d) => d.nom === 'dev-pwa-config')
const catalogue = depotSocle ? await fichier(depotSocle.nwo, depotSocle.brancheDefaut, 'apps-catalog.js') : null
const maturites = catalogue ? maturitesDuCatalogue(catalogue) : {}
// Un extracteur muet ne doit pas passer pour « aucune app n'a de maturité » :
// le filtre de la page serait là, sans rien à filtrer, et personne ne saurait.
if (!Object.keys(maturites).length) console.error('  ATTENTION : aucune maturité lue dans apps-catalog.js — le filtre par maturité sera vide')
for (const d of depots) d.maturite = maturites[d.nom] || null

// Garde-fou : mieux vaut un relevé qui échoue bruyamment qu'une page qui
// annonce « tout au vert » parce que le jeton n'a pas pu lire les pipelines.
const incomplets = depots.filter((d) => d.lectureIncomplete)
if (incomplets.length) {
  console.error(`\n${incomplets.length}/${depots.length} dépôts dont les workflows sont illisibles : ${incomplets.map((d) => d.nom).join(', ')}`)
  if (refus.size) console.error(`Refus de droits sur : ${[...refus].join(', ')}`)
  if (incomplets.length > depots.length / 10) {
    console.error(`\nABANDON : trop de lectures refusées pour publier un état fiable.`)
    console.error(`Le GITHUB_TOKEN d'un dépôt ne couvre pas l'API Actions des autres.`)
    console.error(`Poser un PAT (scope public_repo) dans le secret PARC_TOKEN du dépôt.`)
    process.exit(2)
  }
}

/* --------------------------------------- alertes de vulnérabilité */

// LE JETON DU DÉPÔT NE SUFFIT PROBABLEMENT PAS ICI, et le relevé doit le dire
// plutôt que d'afficher « 0 alerte » — qui se lirait comme une bonne nouvelle.
// Lire `/dependabot/alerts` d'un AUTRE dépôt demande le droit « Dependabot
// alerts : read », que le `GITHUB_TOKEN` d'un dépôt ne porte pas, même sur des
// dépôts publics du même compte. C'est le même besoin que `PARC_TOKEN`.
//
// On distingue donc trois états, et jamais deux : un compte, « illisible », ou
// « désactivé sur ce dépôt » (403 au message explicite). `api()` n'en dirait
// rien — il rend `null` pour un 403 comme pour un 404 — d'où la requête directe.
let alertesLisibles = false
let alertesRefusees = 0
await enLot(depots, 5, async (d) => {
  d.alertes = null
  try {
    appels++
    const res = await fetch(`${API}/repos/${d.nwo}/dependabot/alerts?state=open&per_page=100`, {
      headers: { authorization: `Bearer ${JETON}`, accept: 'application/vnd.github+json', 'user-agent': 'parc-dashboard' },
    })
    if (res.status === 403 || res.status === 404) {
      const msg = await res.text()
      // « Dependabot alerts are disabled for this repository » est une réponse
      // exacte, pas un refus : le dépôt ne les a tout simplement pas activées.
      d.alertes = /disabled for this repository/i.test(msg) ? { etat: 'desactivees' } : { etat: 'illisible' }
      if (d.alertes.etat === 'illisible') alertesRefusees++
      return
    }
    if (!res.ok) {
      d.alertes = { etat: 'illisible' }
      alertesRefusees++
      return
    }
    const liste = await res.json()
    const grave = (a) => ['high', 'critical'].includes(a.security_advisory?.severity)
    d.alertes = {
      etat: 'lu',
      total: liste.length,
      graves: liste.filter(grave).length,
      // Une alerte en dépendance de PRODUCTION part chez l'utilisateur ; une
      // alerte de chaîne de développement compromet ce qu'on publie. Les deux
      // comptent, pas de la même façon.
      production: liste.filter((a) => a.dependency?.scope === 'runtime').length,
    }
    alertesLisibles = true
  } catch {
    d.alertes = { etat: 'illisible' }
    alertesRefusees++
  }
})
if (!alertesLisibles) {
  console.error(`\nAlertes de vulnérabilité illisibles sur ${alertesRefusees}/${depots.length} dépôts — la section restera muette.`)
  console.error(`Il faut un PAT portant « Dependabot alerts : read » dans le secret PARC_TOKEN ; le GITHUB_TOKEN du dépôt ne suffit pas.`)
}

/* ------------------------------------------------ détail des échecs */

const cibles = depots.flatMap((d) => d.workflows.filter((w) => w.etat === 'rouge' && w.idDernier).map((w) => ({ d, w })))
const echecs = await enLot(cibles, 4, async ({ d, w }) => {
  const jobs = await api(`/repos/${d.nwo}/actions/runs/${w.idDernier}/jobs?per_page=100`)
  const enEchec = (jobs?.jobs || [])
    .filter((j) => j.conclusion && !['success', 'skipped'].includes(j.conclusion))
    .map((j) => ({ name: j.name, conclusion: j.conclusion, etapes: (j.steps || []).filter((s) => s.conclusion && !['success', 'skipped'].includes(s.conclusion)).map((s) => ({ name: s.name })) }))
  return {
    depot: d.nom,
    famille: d.famille,
    workflow: w.nom,
    date: w.date,
    jours: jours(w.date),
    conclusion: w.conclusion,
    branche: w.branche,
    url: w.url,
    jobs: enEchec,
    etape: enEchec.flatMap((j) => j.etapes.map((s) => s.name))[0] || null,
    demarrage: enEchec.length === 0,
  }
})
echecs.sort((a, b) => new Date(b.date) - new Date(a.date))

const motifs = new Map()
for (const e of echecs) {
  if (!e.etape) continue
  if (!motifs.has(e.etape)) motifs.set(e.etape, new Set())
  motifs.get(e.etape).add(e.depot)
}
const motifsPartages = [...motifs]
  .filter(([, s]) => s.size > 1)
  .map(([etape, s]) => ({ etape, depots: [...s].sort() }))
  .sort((a, b) => b.depots.length - a.depots.length)

/* ------------------------------------------------ sites et versions amont */

const sites = depots.filter((d) => d.pagesUrl)
await enLot(sites, 8, async (d) => {
  const t0 = Date.now()
  try {
    const res = await fetch(d.pagesUrl, { redirect: 'follow' })
    const corps = await res.text()
    d.pages = { url: d.pagesUrl, code: res.status, ok: res.ok, ms: Date.now() - t0, titre: /<title[^>]*>([^<]*)<\/title>/i.exec(corps)?.[1]?.trim() || null }
  } catch (e) {
    d.pages = { url: d.pagesUrl, code: null, ok: false, erreur: String(e.message || e) }
  }
})
for (const d of depots) if (!d.pages) d.pages = d.pagesUrl ? { url: d.pagesUrl, code: null, ok: null } : null

const SUIVIES = new Set()
for (const d of depots) for (const p of Object.keys(d.declarees)) SUIVIES.add(p)
const NOM_SOCLE = '@mister-guiiug/dev-pwa-config'
const amont = {}
const publieLe = {}
const depotAmont = {}

// ON LIT LE DOCUMENT COMPLET, ET NON `/latest`. Il coûte plus cher — 232 Mo
// décompressés pour les 83 paquets du parc, mais il arrive en gzip et
// l'ensemble tient en QUATRE SECONDES à six requêtes de front. En échange il
// porte les deux choses que `/latest` n'a pas : `time[<latest>]`, date exacte
// de la dernière publication, et l'URL du dépôt amont.
//
// La recherche npm (`/-/v1/search`) rendait la même date en 1 Ko, et a été
// écartée sur mesure : elle répond 429 dès la deuxième requête — dix réponses
// utiles sur quinze en série, deux sur quinze à deux de front — et sa
// correspondance est FLOUE. Interrogée sur `@mister-guiiug/dev-pwa-config`,
// elle rend la fiche de `vite-plugin-pwa`.
//
// `time.modified` du document abrégé n'est pas une réponse non plus : il bouge
// pour une dépréciation ou un changement de mainteneur. `lodash.escaperegexp`
// s'y donne modifié en 2022 alors que sa dernière version date de 2016.
await enLot([...SUIVIES], 6, async (p) => {
  try {
    const res = await fetch(`https://registry.npmjs.org/${p.replace('/', '%2f')}`)
    if (!res.ok) return
    const doc = await res.json()
    const derniere = doc['dist-tags']?.latest
    if (!derniere) return
    amont[p] = derniere
    if (doc.time?.[derniere]) publieLe[p] = doc.time[derniere]
    const url = doc.repository?.url || doc.versions?.[derniere]?.repository?.url || ''
    const m = /github\.com[:/]([^/]+)\/([^/#?]+?)(?:\.git)?(?:[#?].*)?$/.exec(url)
    if (m) depotAmont[p] = `${m[1]}/${m[2]}`
  } catch {
    /* hors ligne : les colonnes amont et dormance restent vides, ce n'est pas bloquant */
  }
})
// le socle n'est pas sur npm public : sa référence est la version de son dépôt
const socle = depots.find((d) => d.nom === 'dev-pwa-config')
if (socle?.paquet?.version) amont[NOM_SOCLE] = socle.paquet.version
// et sa « dernière publication » est son dernier push : il paraît plusieurs
// fois par jour, l'interroger sur npm public rendrait un 404.
if (socle?.pushGitHub) publieLe[NOM_SOCLE] = socle.pushGitHub
if (socle) depotAmont[NOM_SOCLE] = `${COMPTE}/dev-pwa-config`

/* ------------------------------------------------------------- modèle */

const libs = []
for (const paquet of SUIVIES) {
  const parVersion = new Map()
  for (const d of depots) {
    if (!(paquet in d.declarees)) continue
    const v = d.verrouillees[paquet] || nettoie(d.declarees[paquet])
    if (!parVersion.has(v)) parVersion.set(v, [])
    parVersion.get(v).push({ depot: d.nom, plage: d.declarees[paquet], verrouille: !!d.verrouillees[paquet] })
  }
  if (!parVersion.size) continue
  const versions = [...parVersion].sort((a, b) => cmpVersion(b[0], a[0])).map(([version, deps]) => ({ version, depots: deps.sort((a, b) => a.depot.localeCompare(b.depot)) }))
  const nbDepots = versions.reduce((n, v) => n + v.depots.length, 0)
  const a = amont[paquet] || null
  const enRetard = a ? versions.filter((v) => cmpVersion(v.version, a) < 0).reduce((n, v) => n + v.depots.length, 0) : null
  libs.push({ paquet, ecosysteme: 'npm', nbDepots, nbVersions: versions.length, versions, amont: a, enRetard, plusRecente: versions[0].version, publieLe: publieLe[paquet] || null, depotAmont: depotAmont[paquet] || null })
}
const cratesMap = new Map()
const NOTABLES = ['tauri', 'tokio', 'serde', 'serde_json', 'clap', 'anyhow', 'thiserror', 'chrono', 'uuid', 'reqwest', 'tracing', 'rusqlite', 'git2', 'axum', 'regex']
for (const d of depots) {
  for (const c of NOTABLES) {
    if (!d.crates[c]) continue
    if (!cratesMap.has(c)) cratesMap.set(c, new Map())
    const m = cratesMap.get(c)
    if (!m.has(d.crates[c])) m.set(d.crates[c], [])
    m.get(d.crates[c]).push({ depot: d.nom, plage: d.crates[c], verrouille: true })
  }
}
// crates.io : même question, autre registre. `versions[]` y vient du plus
// récent au plus ancien ; on écarte les versions retirées (`yanked`) et les
// préversions, qui ne disent rien de la vitalité d'une crate.
await enLot([...cratesMap.keys()], 3, async (c) => {
  try {
    const res = await fetch(`https://crates.io/api/v1/crates/${c}`, { headers: { 'user-agent': 'parc-dashboard (https://github.com/mister-guiiug/parc-dashboard)' } })
    if (!res.ok) return
    const doc = await res.json()
    const v = doc.versions?.find((x) => !x.yanked && !x.num.includes('-'))
    if (!v) return
    amont[c] = v.num
    publieLe[c] = v.created_at
    const url = doc.crate?.repository || ''
    const m = /github\.com[:/]([^/]+)\/([^/#?]+?)(?:\.git)?(?:[#?].*)?$/.exec(url)
    if (m) depotAmont[c] = `${m[1]}/${m[2]}`
  } catch {
    /* hors ligne : même traitement que npm */
  }
})
for (const [crate, m] of cratesMap) {
  const versions = [...m].sort((a, b) => cmpVersion(b[0], a[0])).map(([version, deps]) => ({ version, depots: deps }))
  const a = amont[crate] || null
  libs.push({
    paquet: crate,
    ecosysteme: 'cargo',
    nbDepots: versions.reduce((n, v) => n + v.depots.length, 0),
    nbVersions: versions.length,
    versions,
    amont: a,
    enRetard: a ? versions.filter((v) => cmpVersion(v.version, a) < 0).reduce((n, v) => n + v.depots.length, 0) : null,
    plusRecente: versions[0].version,
    publieLe: publieLe[crate] || null,
    depotAmont: depotAmont[crate] || null,
  })
}
libs.sort((a, b) => b.nbDepots - a.nbDepots || a.paquet.localeCompare(b.paquet))

/* --------------------------------------------------------- dormance */

// UNE LIBRAIRIE SANS PUBLICATION DEPUIS UN AN N'EST PAS FORCÉMENT ABANDONNÉE,
// et c'est tout l'objet de ce relevé. Mesuré le 14/09/2026 sur les dix
// dormantes du parc : `leaflet` n'a rien publié depuis mai 2023 mais son dépôt
// a reçu un commit LE JOUR MÊME ; `react-qr-reader` en est à une `3.0.0-beta-1`
// de février 2022 et son dépôt n'a pas bougé depuis novembre 2023. Le même
// chiffre — « plus d'un an sans version » — recouvre une bibliothèque vivante
// qui ne publie pas et une autre qu'il faut remplacer.
//
// La date npm seule ne peut donc pas trancher. On va chercher le dernier
// commit du dépôt amont, mais SEULEMENT pour les dormantes : dix appels au
// lieu de quatre-vingts, et la question ne se pose que là.
const dormantes = libs.filter((l) => estDormante(l, MAINTENANT))
await enLot(dormantes, 5, async (l) => {
  if (!l.depotAmont) return
  const g = await api(`/repos/${l.depotAmont}`, { silence404: true })
  if (!g) return
  l.amontPousseLe = g.pushed_at || null
  l.amontArchive = !!g.archived
  l.amontIssues = g.open_issues_count ?? null
})
for (const l of dormantes) l.dormance = etatDormance(l, MAINTENANT)

// la pile montrée sur chaque carte
for (const d of depots) {
  d.pile = pileDuDepot(d, { amont, nomSocle: NOM_SOCLE, crates: NOTABLES.slice(0, 8), nettoie })
  delete d.declarees
  delete d.verrouillees
  delete d.crates
  for (const w of d.workflows) delete w.idDernier
}

const propres = depots.flatMap((d) => d.workflows.filter((w) => !w.reutilisable))
const parFamille = {}
for (const f of Object.keys(FAMILLES)) {
  const liste = depots.filter((d) => d.famille === f)
  const wf = liste.flatMap((d) => d.workflows.filter((w) => !w.reutilisable))
  parFamille[f] = {
    ...FAMILLES[f],
    depots: liste.length,
    workflows: wf.length,
    verts: wf.filter((w) => w.etat === 'vert').length,
    rouges: wf.filter((w) => w.etat === 'rouge').length,
    depotsRouges: liste.filter((d) => d.compte.rouge).length,
    sites: liste.filter((d) => d.pages?.ok).length,
  }
  parFamille[f].taux = parFamille[f].verts + parFamille[f].rouges ? Math.round((parFamille[f].verts / (parFamille[f].verts + parFamille[f].rouges)) * 100) : null
}

const kpi = {
  depots: depots.length,
  publics: depots.filter((d) => !d.prive).length,
  prives: depots.filter((d) => d.prive).length,
  workflows: propres.length,
  workflowsTous: depots.reduce((n, d) => n + d.workflows.length, 0),
  reutilisables: depots.reduce((n, d) => n + d.workflows.filter((w) => w.reutilisable).length, 0),
  verts: propres.filter((w) => w.etat === 'vert').length,
  rouges: propres.filter((w) => w.etat === 'rouge').length,
  neutres: propres.filter((w) => w.etat === 'neutre').length,
  jamais: propres.filter((w) => w.etat === 'jamais').length,
  depotsRouges: depots.filter((d) => d.compte.rouge > 0).length,
  depotsModifies: depots.filter((d) => d.local?.modifies).length,
  horsBrancheDefaut: depots.filter((d) => d.local && d.local.branche !== d.brancheDefaut).length,
  prOuvertes: depots.reduce((n, d) => n + d.prs.length, 0),
  sites: depots.filter((d) => d.pages?.url).length,
  sitesEnLigne: depots.filter((d) => d.pages?.ok).length,
  socleAmont: amont[NOM_SOCLE] || null,
  socleEnRetard: libs.find((l) => l.paquet === NOM_SOCLE)?.enRetard ?? null,
  appsPwa: parFamille.pwa.depots,
  // Trois états possibles, jamais deux : « 0 alerte » et « je n'ai pas pu lire »
  // ne se ressemblent que pour qui ne regarde pas.
  alertesLisibles,
  alertes: alertesLisibles ? depots.reduce((n, d) => n + (d.alertes?.total || 0), 0) : null,
  alertesGraves: alertesLisibles ? depots.reduce((n, d) => n + (d.alertes?.graves || 0), 0) : null,
  alertesProduction: alertesLisibles ? depots.reduce((n, d) => n + (d.alertes?.production || 0), 0) : null,
  depotsSansAlertes: depots.filter((d) => d.alertes?.etat === 'desactivees').length,
  depotsAlertesIllisibles: depots.filter((d) => d.alertes?.etat === 'illisible').length,
  lecturesIncompletes: depots.filter((d) => d.lectureIncomplete).length,
  librairiesDatees: libs.filter((l) => l.publieLe).length,
  dormantes: dormantes.length,
  // Celles dont le DÉPÔT aussi s'est tu : les seules qui appellent une décision.
  dormantesArretees: dormantes.filter((l) => l.dormance === 'arretee' || l.dormance === 'archivee').length,
}
kpi.taux = kpi.verts + kpi.rouges ? Math.round((kpi.verts / (kpi.verts + kpi.rouges)) * 100) : null

const activite = depots
  .map((d) => ({ depot: d.nom, famille: d.famille, jours: d.commit.jours, date: d.commit.date }))
  .sort((a, b) => a.jours - b.jours)

const modele = {
  genere: MAINTENANT.toISOString(),
  compte: COMPTE,
  source: RACINE_LOCALE ? 'api+local' : 'api',
  avecLocal: !!RACINE_LOCALE,
  publicsSeulement: !AVEC_PRIVES,
  soi: SOI,
  familles: FAMILLES,
  parFamille,
  kpi,
  depots,
  libs,
  echecs,
  motifsPartages,
  activite,
  socle: NOM_SOCLE,
  seuilDormanceJours: SEUIL_DORMANCE_JOURS,
}

/* ------------------------------------------- ce qui a bougé, et depuis quand */

const modeleDe = (t) => {
  const m = /<script type="application\/json" id="donnees">([\s\S]*?)<\/script>/.exec(t || '')
  if (!m) return null
  try {
    return JSON.parse(m[1].replace(/\\u003c/g, '<'))
  } catch {
    return null
  }
}
const ancienne = existsSync(SORTIE) ? readFileSync(SORTIE, 'utf8') : ''
const avant = modeleDe(ancienne)

modele.changements = changementsDepuis(avant, modele)
modele.compareA = avant?.genere || null

/* ------------------------------------------------------------- rendu */

const gabarit = readFileSync(join(ICI, 'gabarit.html'), 'utf8')
if (!gabarit.includes('__DONNEES__')) throw new Error('placeholder __DONNEES__ absent du gabarit')
if (!gabarit.includes('__VUE__')) throw new Error('placeholder __VUE__ absent du gabarit')
if (!gabarit.includes('__STYLE__')) throw new Error('placeholder __STYLE__ absent du gabarit')

// LES RÈGLES DE LA VUE, INSÉRÉES PLUTÔT QU'ÉCRITES DANS LE HTML.
//
// Elles vivaient en JavaScript dans `gabarit.html`, donc hors de portée de
// `node --test` : c'est ce qui a laissé la colonne « Écarts » contredire son
// propre tri pendant des semaines. Elles sont désormais dans `regles.mjs` et
// `vue.mjs`, éprouvées, et recopiées ici au rendu.
//
// La page reste UN SEUL FICHIER sans ressource externe — elle est poussée telle
// quelle sur Pages, et un second fichier à charger changerait ça. Le transport
// se paie en octets : les deux modules pèsent quelques kilo-octets bruts,
// quelques centaines une fois gzippés, contre 59 ko pour la page entière.
//
// `export` et `import` retirés : le script de la page n'est pas un module. Le
// motif est volontairement littéral — un `import` multiligne casserait le
// retrait, et la garde ci-dessous le dit plutôt que de le laisser passer.
const sansModule = (src, nom) => {
  const net = src.replace(/^export (?=const |function |let |class )/gm, '').replace(/^import .*$/gm, '')
  if (/^\s*(?:export|import)\b/m.test(net))
    throw new Error(`${nom} : un export ou un import a survécu au retrait — forme multiligne ?`)
  return net
}

const regles = readFileSync(join(ICI, 'regles.mjs'), 'utf8')
const vue = readFileSync(join(ICI, 'vue.mjs'), 'utf8')

// LA FEUILLE DE STYLE, SORTIE DU GABARIT POUR LA MÊME RAISON QUE LES RÈGLES.
// `gabarit.html` faisait 2 986 lignes, dont 1 220 de CSS et 1 478 de
// JavaScript : dix pour cent du fichier était ce que son nom annonce. Un
// éditeur ouvre désormais du CSS quand il ouvre du CSS, et la page servie ne
// change pas d'un octet — hors l'indentation, qui n'avait de sens que dans le
// HTML.
const style = readFileSync(join(ICI, 'style.css'), 'utf8')

// L'empreinte entre dans le modèle : sans elle, la comparaison ne porterait que
// sur les données et une refonte de la page ne serait JAMAIS republiée — le
// relevé répondrait « rien n'a bougé » sur un gabarit réécrit. Les DEUX modules
// y entrent aussi : depuis qu'ils portent la logique, les oublier rendrait
// invisible un changement de tri ou de rang d'écart.
modele.gabarit = createHash('sha256')
  .update(gabarit)
  .update(regles)
  .update(vue)
  .update(style)
  .digest('hex')
  .slice(0, 12)

// La décision se prend AVANT d'assembler la page : l'historique qui y sera
// embarqué dépend d'elle.
const inchange = ancienne && fond(avant) === fond(modele)

/* ------------------------------------------------------------ historique */

// UNE PAGE QUI NE GARDE RIEN NE PEUT PAS DIRE SI ÇA S'AMÉLIORE. Le taux de vert
// est passé de 93 à 96 % en une journée sans que rien ne l'ait jamais montré.
//
// Un point par jour au maximum, et SEULEMENT quand le fond a bougé : un relevé
// identique n'apporte pas de point, il prolonge le précédent. Le dernier point
// du jour remplace celui du matin, sinon une journée agitée pèserait dix fois
// plus qu'une journée calme dans la courbe.
//
// L'historique est aussi EMBARQUÉ dans la page, comme tout le reste : la
// promesse du showroom vaut ici — aucune requête réseau, la page s'ouvre en
// `file://`. Un `fetch('historique.json')` la casserait.
//
// Plafonné à 400 entrées, un peu plus d'un an.
const CHEMIN_HISTORIQUE = join(ICI, '..', 'historique.json')
const MAX_HISTORIQUE = 400
let histo = []
try {
  if (existsSync(CHEMIN_HISTORIQUE)) histo = JSON.parse(readFileSync(CHEMIN_HISTORIQUE, 'utf8'))
  if (!Array.isArray(histo)) histo = []
} catch {
  // un historique illisible ne doit pas emporter le relevé : on repart de zéro
  console.error(`  historique.json illisible — un nouveau est écrit`)
  histo = []
}
if (!inchange) {
  const jour = MAINTENANT.toISOString().slice(0, 10)
  const point = {
    jour,
    taux: kpi.taux,
    verts: kpi.verts,
    rouges: kpi.rouges,
    depots: kpi.depots,
    dormantes: kpi.dormantes,
    dormantesArretees: kpi.dormantesArretees,
    alertes: kpi.alertes,
    alertesGraves: kpi.alertesGraves,
    socleEnRetard: kpi.socleEnRetard,
  }
  const i = histo.findIndex((p) => p.jour === jour)
  if (i >= 0) histo[i] = fusionnePoint(histo[i], point)
  else histo.push(point)
  histo = histo.slice(-MAX_HISTORIQUE)
  if (ALIMENTE_HISTORIQUE) {
    writeFileSync(CHEMIN_HISTORIQUE, JSON.stringify(histo) + '\n')
    console.error(`historique.json : ${histo.length} point(s), dont celui du ${jour}.`)
  }
}
modele.historique = histo

/* ------------------------------------------------------------- page */

const charge = JSON.stringify(modele).replace(/</g, '\\u003c').replace(/[\u2028\u2029]/g, (c) => '\\u' + c.charCodeAt(0).toString(16))
// `__VUE__` d'abord : le code inséré ne contient aucun marqueur, mais les
// données, elles, sont du JSON arbitraire — remplacer dans l'autre sens ferait
// dépendre le résultat de ce qu'un dépôt a mis dans sa description.
const page = gabarit
  // Le saut de ligne final du fichier est retiré ici : il est de rigueur dans un
  // fichier source, et poserait une ligne vide de plus avant `</style>`.
  .replace('__STYLE__', () => style.replace(/\n$/, ''))
  .replace('__VUE__', () => `${sansModule(regles, 'regles.mjs')}\n${sansModule(vue, 'vue.mjs')}`)
  .replace('__DONNEES__', () => charge)

if (inchange) {
  console.error(`Rien n'a bougé depuis le relevé précédent (${appels} appels d'API). Fichier laissé tel quel.`)
} else {
  writeFileSync(SORTIE, page)
  console.error(`${SORTIE} réécrit : ${(page.length / 1024).toFixed(1)} Kio, ${appels} appels d'API.`)
}
console.error(
  `${kpi.depots} dépôts — ${parFamille.pwa.depots} PWA, ${parFamille.socle.depots} socle, ${parFamille.desktop.depots} desktop, ${parFamille.autre.depots} autres | ` +
    `${kpi.verts} verts / ${kpi.rouges} rouges (${kpi.taux} %) | ${kpi.sitesEnLigne}/${kpi.sites} sites en ligne`,
)
if (process.env.GITHUB_OUTPUT) writeFileSync(process.env.GITHUB_OUTPUT, `change=${inchange ? 'non' : 'oui'}\n`, { flag: 'a' })
