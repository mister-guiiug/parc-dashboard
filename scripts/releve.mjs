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
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

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
const nettoie = (v) => String(v || '').replace(/^[\^~>=<\s]*/, '').split('-')[0]
function cmpVersion(a, b) {
  const pa = nettoie(a).split('.').map((n) => parseInt(n, 10) || 0)
  const pb = nettoie(b).split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0)
  return 0
}

/* ------------------------------------------------- classement des dépôts */

// Les trois couches du socle ne se devinent pas : `pwa-starter-kit` EST une PWA
// (il en est le squelette), un signal seul le rangerait avec les applications.
// Voir la note d'architecture du parc : bibliothèque, squelette, générateur.
const SOCLE = {
  'dev-pwa-config': 'bibliothèque partagée',
  'pwa-starter-kit': "squelette d'application",
  'create-lg-pwa-app': 'générateur',
}
const FAMILLES = {
  pwa: { titre: 'Applications PWA', sous: 'Applications web installables, déployées sur GitHub Pages.' },
  desktop: { titre: 'Applications desktop', sous: 'Empaquetées avec Electron, Tauri ou .NET — hors chaîne Pages.' },
  socle: { titre: 'Socle', sous: 'La bibliothèque, le squelette et le générateur dont vivent les applications.' },
  autre: { titre: 'Outillage et divers', sous: 'Extensions, compétences, configuration du compte.' },
}

// Chaque règle repose sur un signal LISIBLE dans le dépôt, pas sur son nom —
// sauf le socle et `.github`, qui n'en portent aucun.
function classe(nom, deps, crates, pkg, langage) {
  if (SOCLE[nom]) return { famille: 'socle', role: SOCLE[nom] }
  if (nom === '.github') return { famille: 'autre', role: 'configuration du compte' }
  if (pkg?.engines?.vscode || pkg?.contributes) return { famille: 'autre', role: 'extension VS Code' }
  if (deps.electron) return { famille: 'desktop', role: 'Electron' }
  if (crates.tauri || deps['@tauri-apps/api']) return { famille: 'desktop', role: 'Tauri' }
  if (langage === 'C#') return { famille: 'desktop', role: '.NET' }
  if (deps['vite-plugin-pwa']) return { famille: 'pwa', role: null }
  return { famille: 'autre', role: langage || null }
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

function etatDe(run) {
  if (!run) return 'jamais'
  if (run.status !== 'completed') return 'encours'
  if (run.conclusion === 'success') return 'vert'
  if (['skipped', 'cancelled', 'neutral'].includes(run.conclusion)) return 'neutre'
  return 'rouge'
}
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
await enLot([...SUIVIES], 10, async (p) => {
  try {
    const res = await fetch(`https://registry.npmjs.org/${p}/latest`)
    if (res.ok) amont[p] = (await res.json()).version
  } catch {
    /* hors ligne : la colonne amont reste vide, ce n'est pas bloquant */
  }
})
// le socle n'est pas sur npm public : sa référence est la version de son dépôt
const socle = depots.find((d) => d.nom === 'dev-pwa-config')
if (socle?.paquet?.version) amont[NOM_SOCLE] = socle.paquet.version

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
  libs.push({ paquet, ecosysteme: 'npm', nbDepots, nbVersions: versions.length, versions, amont: a, enRetard, plusRecente: versions[0].version })
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
for (const [crate, m] of cratesMap) {
  const versions = [...m].sort((a, b) => cmpVersion(b[0], a[0])).map(([version, deps]) => ({ version, depots: deps }))
  libs.push({ paquet: crate, ecosysteme: 'cargo', nbDepots: versions.reduce((n, v) => n + v.depots.length, 0), nbVersions: versions.length, versions, amont: null, enRetard: null, plusRecente: versions[0].version })
}
libs.sort((a, b) => b.nbDepots - a.nbDepots || a.paquet.localeCompare(b.paquet))

// la pile montrée sur chaque carte
for (const d of depots) {
  const pile = []
  const pousse = (nom, paquet) => {
    const v = d.verrouillees[paquet] || nettoie(d.declarees[paquet])
    if (v) pile.push({ nom, paquet, version: v, verrouille: !!d.verrouillees[paquet], amont: amont[paquet] || null })
  }
  if (d.nom === 'dev-pwa-config') pile.push({ nom: 'socle (ce dépôt)', paquet: NOM_SOCLE, version: d.paquet?.version || '?', verrouille: true, amont: amont[NOM_SOCLE] })
  else pousse('socle', NOM_SOCLE)
  for (const [etiq, p] of [
    ['React', 'react'],
    ['Vite', 'vite'],
    ['Vitest', 'vitest'],
    ['TypeScript', 'typescript'],
    ['Tailwind', 'tailwindcss'],
    ['Supabase', '@supabase/supabase-js'],
    ['Firebase', 'firebase'],
    ['Electron', 'electron'],
    ['Playwright', '@playwright/test'],
  ])
    pousse(etiq, p)
  for (const c of NOTABLES.slice(0, 8)) if (d.crates[c]) pile.push({ nom: c, paquet: c, version: d.crates[c], verrouille: true, amont: null, rust: true })
  d.pile = pile
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
}

/* ------------------------------------------------------------- rendu */

const gabarit = readFileSync(join(ICI, 'gabarit.html'), 'utf8')
if (!gabarit.includes('__DONNEES__')) throw new Error('placeholder __DONNEES__ absent du gabarit')
const charge = JSON.stringify(modele).replace(/</g, '\\u003c').replace(/[\u2028\u2029]/g, (c) => '\\u' + c.charCodeAt(0).toString(16))
const page = gabarit.replace('__DONNEES__', charge)

// Ne réécrire que si le FOND a bougé. Le fond exclut ce qui se mesure à
// nouveau sans rien dire de l'état : l'horodatage du relevé, et le temps de
// réponse de chaque site — sans ça, deux relevés consécutifs identiques
// produiraient quand même un commit par jour.
function fond(modele) {
  if (!modele) return null
  const o = JSON.parse(JSON.stringify(modele))
  delete o.genere
  for (const d of o.depots || []) {
    if (d.pages) delete d.pages.ms
  }
  return JSON.stringify(o)
}
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
const inchange = ancienne && fond(modeleDe(ancienne)) === fond(modele)

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
