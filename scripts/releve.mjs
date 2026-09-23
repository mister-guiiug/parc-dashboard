#!/usr/bin/env node
// Relève l'état du parc et régénère index.html.
//
//   node scripts/releve.mjs                    # API seule, écrit index.html ici
//   node scripts/releve.mjs --local D:/Src/... # + l'état des copies de travail
//   node scripts/releve.mjs --prives           # + les dépôts privés (PAT requis)
//
// Ce que fait la CI, chaque heure depuis le 23/09/2026 :
//
//   node scripts/releve.mjs --precedente <url de la page> --publier _site --instantane
//
//   --precedente  la page EN LIGNE sert d'état précédent : c'est elle, et non
//                 l'`index.html` du dépôt, qui dit s'il y a quelque chose à
//                 republier, et elle porte l'historique le plus frais ;
//   --publier     le site à déployer sur Pages est écrit dans ce dossier —
//                 `index.html`, `etat.json`, `historique.json` — au lieu d'un
//                 commit sur `main` ;
//   --instantane  le premier passage d'un jour nouveau réécrit aussi
//                 l'`index.html` et le `historique.json` du dépôt, que la CI
//                 commite : la photo du jour (voir plus bas).
//
// Tout vient de l'API GitHub, de raw.githubusercontent et du registre npm : le
// runner n'a aucune copie de travail sous la main. Le mode --local n'ajoute que
// ce que l'API ne peut pas savoir (branche courante, fichiers non commités).
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
// Les règles pures vivent à part : ce fichier-ci s'exécute à l'import, elles
// ne seraient pas testables autrement. Voir `scripts/regles.mjs`.
import { MAJEURS_ADMIS, SOCLE, aliasNpm, amontAdmis, changementsDepuis, classe, cmpVersion, estEnRetard, etatDe, etatPublie, fond, fusionneHistoriques, fusionnePoint, joursAbsents, nettoie, paquetReel, serieDe } from './regles.mjs'
// Ce que le relevé CALCULE vit à part de ce qu'il va CHERCHER : importer ce
// fichier-ci déclenche la collecte, exige un jeton et consomme trois cent
// trente appels d'API. Voir `scripts/modele.mjs`.
import { SEUIL_DORMANCE_JOURS, estDormante, etatDormance, maturitesDuCatalogue, pileDuDepot } from './modele.mjs'
// Les lectures nouvelles du 23/09/2026 — production, morceaux fugaces,
// Renovate, pairs du socle, journal — ont leurs règles pures à part, hors de la
// page. Voir `scripts/collecte.mjs`.
import { derniereDeSerie, entreeDe, espacesDeTravail, etatChecks, etatProd, fluxAtom, fugacesDe, journalMisAJour, lisTableauRenovate, pairsDures, plafondEngines, precacheDe, referencesDe, unitesDeLArbre, verrouilleesDe, versionNvmrc } from './collecte.mjs'
// Le flux Atom dit les changements avec les MÊMES phrases que la page.
import { phraseChangement } from './vue.mjs'
import { traducteur } from './libelles.mjs'

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
const valeurDe = (option) => (args.includes(option) ? args[args.indexOf(option) + 1] : null)
const URL_PUBLIEE = valeurDe('--precedente')
const DOSSIER_PUBLIE = valeurDe('--publier')
const INSTANTANE = args.includes('--instantane')
for (const [option, valeur] of [
  ['--precedente', URL_PUBLIEE],
  ['--publier', DOSSIER_PUBLIE],
]) {
  // `--publier --instantane` prendrait « --instantane » pour un dossier.
  if (args.includes(option) && (!valeur || valeur.startsWith('--'))) {
    console.error(`${option} attend une valeur.`)
    process.exit(2)
  }
}

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
// UNE LECTURE FACULTATIVE : tout échec rend `null`, sans lever et sans compter
// parmi les refus. `api()` lève sur une réponse inattendue — juste pour ce qui
// fonde la page, mais l'état de CI d'une PR, un tableau Renovate ou une
// comparaison de commits ne doivent jamais coûter le relevé entier.
async function apiFacultatif(chemin) {
  appels++
  try {
    const res = await fetch(API + chemin, {
      headers: { authorization: `Bearer ${JETON}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'parc-dashboard' },
    })
    return res.ok ? await res.json() : null
  } catch {
    return null
  }
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

/* ------------------------------------------------------- l'état précédent */

const modeleDe = (t) => {
  const m = /<script type="application\/json" id="donnees">([\s\S]*?)<\/script>/.exec(t || '')
  if (!m) return null
  try {
    return JSON.parse(m[1].replace(/\\u003c/g, '<'))
  } catch {
    return null
  }
}
// L'INSTANTANÉ DU DÉPÔT, repère de « ce qui a bougé ». Depuis que le relevé est
// horaire, l'`index.html` du dépôt n'est plus la page publiée : c'est la photo
// que le premier passage de chaque jour y commite. Comparer à ELLE, et non à la
// page de l'heure précédente, garde au bandeau sa portée d'une journée — sinon
// il ne montrerait que la dernière heure, et un CI tombé à 03:17 sortirait de
// la liste au passage de 04:17.
const ancienne = existsSync(SORTIE) ? readFileSync(SORTIE, 'utf8') : ''
const avant = modeleDe(ancienne)

// LA PAGE EN LIGNE, état précédent de ce qui est PUBLIÉ. C'est elle qui décide
// s'il y a quelque chose à republier, et elle porte l'historique et le journal
// les plus frais. Lue AVANT la collecte, depuis que la production d'une app
// réutilise ce qu'elle savait déjà d'un même déploiement (voir `releveProd`).
// Illisible (Pages en panne, premier déploiement), on se replie sur
// l'instantané du dépôt, et sans perte : l'historique est recomposé jour par
// jour depuis les deux sources, plus bas.
let publiee = ancienne
if (URL_PUBLIEE) {
  try {
    // Le CDN de Pages garde une page dix minutes (`max-age=600`) : une requête
    // qui porte un paramètre inédit va la chercher à la source.
    const url = new URL(URL_PUBLIEE)
    url.searchParams.set('releve', String(Date.now()))
    const res = await fetch(url, { redirect: 'follow' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const texte = await res.text()
    if (!modeleDe(texte)) throw new Error('aucune donnée embarquée')
    publiee = texte
  } catch (e) {
    console.error(`::warning::page publiée illisible (${e.message}) — repli sur l'instantané du dépôt`)
  }
}
const avantPublie = modeleDe(publiee)

/* ------------------------------------------------- classement des dépôts */

// LES FAMILLES NE SONT PLUS QU'UN ORDRE. Elles portaient ici leur titre et leur
// sous-titre en français, et le modèle les embarquait dans la page : la langue
// était cuite dans la DONNÉE, là où aucun sélecteur ne pouvait plus la
// défaire. Les quatre paires vivent désormais dans `libelles.mjs`, sous
// `famille.<clé>.titre` et `.sous`, dans chaque langue — et ce tableau ne dit
// plus que ce qu'il est seul à savoir : dans quel ordre les montrer.
const FAMILLES = ['pwa', 'desktop', 'socle', 'autre']

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

  const [commit, listeWf, pages, prs, pkgTxt, lockTxt, cargoTxt, nvmrcTxt, local] = await Promise.all([
    api(`/repos/${nwo}/commits/${encodeURIComponent(def)}`, { silence404: true }),
    api(`/repos/${nwo}/actions/workflows?per_page=100`),
    api(`/repos/${nwo}/pages`, { silence404: true }),
    api(`/repos/${nwo}/pulls?state=open&per_page=30`),
    fichier(nwo, def, 'package.json'),
    fichier(nwo, def, 'package-lock.json'),
    fichier(nwo, def, 'Cargo.lock'),
    fichier(nwo, def, '.nvmrc'),
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
  const verrouillees = verrouilleesDe(lock)
  const crates = {}
  if (cargoTxt) {
    for (const bloc of cargoTxt.split('[[package]]').slice(1)) {
      const n = /name\s*=\s*"([^"]+)"/.exec(bloc)?.[1]
      const v = /version\s*=\s*"([^"]+)"/.exec(bloc)?.[1]
      if (n && v) crates[n] = v
    }
  }
  const declarees = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) }

  // LES DOSSIERS QUI FIGENT LEURS PROPRES VERSIONS — un `worker/`, un `e2e/` à
  // lockfile propre, ou un espace de travail (voir `unitesDeLArbre`). Il faut
  // l'arbre du dépôt pour les trouver, et il coûte UN appel d'API : on ne le
  // relit que quand la tête de la branche a bougé, sinon on reprend ce que la
  // page en ligne en savait, comme pour la production. Leurs fichiers, eux,
  // passent par raw.githubusercontent, hors quota.
  const connu = avantPublie?.depots?.find((x) => x.nom === g.name)
  let dossiers = null
  if (commit && connu?.commit?.sha === commit.sha.slice(0, 7) && Array.isArray(connu.dossiers)) dossiers = connu.dossiers
  else if (commit) {
    const arbre = await apiFacultatif(`/repos/${nwo}/git/trees/${commit.sha}?recursive=1`)
    if (Array.isArray(arbre?.tree) && !arbre.truncated)
      dossiers = unitesDeLArbre(
        arbre.tree.filter((e) => e.type === 'blob').map((e) => e.path),
        espacesDeTravail(pkg),
      )
  }
  // Arbre illisible : on garde ce qu'on savait plutôt que d'effacer des dossiers.
  if (!dossiers) dossiers = Array.isArray(connu?.dossiers) ? connu.dossiers : []
  const unites = [{ dossier: '', pkg, declarees, verrouillees }]
  for (const u of dossiers) {
    const p = json(await fichier(nwo, def, `${u.dossier}/package.json`))
    if (!p) continue
    const l = u.lock === 'propre' ? json(await fichier(nwo, def, `${u.dossier}/package-lock.json`)) : lock
    unites.push({
      dossier: u.dossier,
      pkg: p,
      declarees: { ...(p.dependencies || {}), ...(p.devDependencies || {}) },
      verrouillees: verrouilleesDe(l, u.lock === 'racine' ? u.dossier : ''),
    })
  }

  // LES PR OUVERTES, AVEC LEUR CI. La tuile disait « 1 PR à relire » sans dire
  // laquelle ; le bloc « À faire » la nomme, et dit si elle est fusionnable.
  // Une lecture par PR, facultative : sans elle, la PR reste listée, sans état.
  const prsLues = await enLot(prs || [], 4, async (p) => {
    const checks = p.head?.sha ? await apiFacultatif(`/repos/${nwo}/commits/${p.head.sha}/check-runs?per_page=100`) : null
    return {
      num: p.number,
      titre: p.title,
      brouillon: p.draft,
      branche: p.head?.ref,
      date: p.created_at,
      auteur: p.user?.login || null,
      robot: p.user?.type === 'Bot',
      url: p.html_url,
      ci: etatChecks(checks?.check_runs),
    }
  })

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
      ? {
          sha: commit.sha.slice(0, 7),
          auteur: commit.commit.author?.name || '?',
          date: commit.commit.author?.date,
          // la date où le commit est ARRIVÉ sur la branche — celle d'écriture
          // peut dater de plusieurs jours pour une PR rebasée : c'est la
          // première qui dit si un déploiement a eu le temps de partir
          dateCommit: commit.commit.committer?.date || null,
          sujet: (commit.commit.message || '').split('\n')[0],
          jours: jours(commit.commit.author?.date),
        }
      : { sha: '?', auteur: '?', date: g.pushed_at, sujet: '(commit illisible)', jours: jours(g.pushed_at) },
    local,
    pagesUrl: pages?.html_url || null,
    prs: prsLues,
    workflows,
    compte,
    declarees,
    verrouillees,
    crates,
    // ce qui sert à construire les lignes, puis est retiré du modèle
    unites,
    nvmrc: versionNvmrc(nvmrcTxt),
    nvmrcBrut: nvmrcTxt ? nvmrcTxt.split(/\r?\n/)[0].trim() : null,
    // et ce qui reste : la liste des dossiers, reprise au passage suivant
    // tant que la tête ne bouge pas
    dossiers,
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

// Une URL du site, avec un paramètre inédit : le CDN de Pages garde un fichier
// dix minutes, et la page servie juste après un déploiement ne doit pas être
// jugée sur la version d'avant.
const fraiche = (chemin, base) => {
  const u = new URL(chemin, base)
  u.searchParams.set('releve', String(MAINTENANT.getTime()))
  return u
}

/**
 * LA PRODUCTION D'UNE APP : ce qui tourne en ligne est-il ce qui est fusionné,
 * et ses URL survivront-elles au déploiement suivant ?
 *
 * 1. `version.json`, que chaque app publie, porte le commit construit ; il se
 *    compare à la tête de la branche par défaut (`etatProd`). La comparaison
 *    d'API n'est demandée que quand les deux diffèrent.
 * 2. L'entrée de la page, son `sw.js` : les morceaux qu'elle charge hors du
 *    précache et nommés par empreinte sont FUGACES (`fugacesDe`), et chacun est
 *    demandé pour de vrai — une URL qui ne répond pas est MORTE.
 *
 * Le second volet ne dépend que du commit servi : tant qu'il n'a pas changé,
 * on reprend ce que la page en ligne en savait, au lieu de retélécharger à
 * chaque heure une entrée de plusieurs centaines de kilo-octets.
 */
async function releveProd(d, html) {
  let version = null
  try {
    const r = await fetch(fraiche('version.json', d.pagesUrl))
    if (r.ok) version = await r.json()
  } catch {
    /* pas de version.json lisible : la production reste « inconnue » */
  }
  let comparaison = null
  if (typeof version?.commit === 'string' && d.commit?.sha && !version.commit.startsWith(d.commit.sha)) {
    comparaison = await apiFacultatif(`/repos/${d.nwo}/compare/${version.commit}...${encodeURIComponent(d.brancheDefaut)}`)
  }
  const prod = etatProd(version, { sha: d.commit?.sha, dateCommit: d.commit?.dateCommit }, comparaison, MAINTENANT.getTime())

  const deja = avantPublie?.depots?.find((x) => x.nom === d.nom)?.prod
  if (prod.commit && deja?.commit === prod.commit && Array.isArray(deja.mortes)) {
    prod.fugaces = deja.fugaces ?? null
    prod.mortes = deja.mortes
    return prod
  }
  const src = entreeDe(html)
  if (!src) return prod
  try {
    const urlEntree = new URL(src, d.pagesUrl)
    const re = await fetch(urlEntree)
    if (!re.ok) return prod
    const references = referencesDe(await re.text())
    let sw = null
    for (const nom of ['sw.js', 'service-worker.js']) {
      const r = await fetch(fraiche(nom, d.pagesUrl))
      if (r.ok) {
        sw = await r.text()
        break
      }
    }
    // Sans service worker, rien n'est précaché, donc aucune coquille périmée ne
    // redemandera une URL disparue : la règle se tait, comme celle du docteur.
    const precache = sw === null ? null : precacheDe(sw)
    prod.fugaces = precache ? fugacesDe(references, precache) : null
    const aDemander = [...references].filter((f) => !precache?.has(f))
    const mortes = []
    await enLot(aDemander, 4, async (f) => {
      try {
        const r = await fetch(new URL('./' + f, urlEntree), { method: 'HEAD' })
        if (!r.ok) mortes.push(f)
      } catch {
        mortes.push(f)
      }
    })
    prod.mortes = mortes.sort()
  } catch {
    /* entrée illisible : la production garde son état, sans volet « URL » */
  }
  return prod
}

const sites = depots.filter((d) => d.pagesUrl)
await enLot(sites, 8, async (d) => {
  const t0 = Date.now()
  let corps = ''
  try {
    const res = await fetch(fraiche('', d.pagesUrl), { redirect: 'follow' })
    corps = await res.text()
    d.pages = { url: d.pagesUrl, code: res.status, ok: res.ok, ms: Date.now() - t0, titre: /<title[^>]*>([^<]*)<\/title>/i.exec(corps)?.[1]?.trim() || null }
  } catch (e) {
    d.pages = { url: d.pagesUrl, code: null, ok: false, erreur: String(e.message || e) }
  }
  if (d.pages.ok) d.prod = await releveProd(d, corps)
})
for (const d of depots) if (!d.pages) d.pages = d.pagesUrl ? { url: d.pagesUrl, code: null, ok: null } : null

/* ------------------------------------------------------------ Renovate */

// UNE SEULE RECHERCHE pour tout le compte : les « Dependency Dashboard » que
// Renovate tient ouverts. Leur corps dit ce qui attend le samedi — et ce que
// Renovate ne sait pas résoudre. Facultative : sans elle, les cartes ne disent
// rien de Renovate, et `renovateLu` le sait.
const tableaux = await apiFacultatif(`/search/issues?q=${encodeURIComponent(`user:${COMPTE} is:issue is:open in:title "Dependency Dashboard"`)}&per_page=100`)
const renovateLu = Array.isArray(tableaux?.items)
for (const it of tableaux?.items || []) {
  if (it.user?.login !== 'renovate[bot]') continue
  const d = depots.find((x) => x.nom === String(it.repository_url || '').split('/').pop())
  if (!d) continue
  const t = lisTableauRenovate(it.body)
  d.renovate = { issue: it.html_url, enAttente: t.enAttente, majeures: t.majeures, introuvables: t.introuvables, mises: t.mises.slice(0, 12).map((m) => ({ titre: m.titre, majeure: m.majeure })) }
}

/* ------------------------------------------------------ pairs du socle */

// LES PAIRS DURES DU SOCLE s'installent chez chaque consommateur, qu'il les
// déclare ou non : c'est le lockfile qui décide de leur version. Le 23/09/2026,
// `typescript-eslint` était figé dans 23 dépôts et la page en comptait 5.
const pkgSocle = depotSocle ? json(await fichier(depotSocle.nwo, depotSocle.brancheDefaut, 'package.json')) : null
const PAIRS = new Set(pairsDures(pkgSocle))

const SUIVIES = new Set()
// UN ALIAS PORTE UN NOM QUI N'EXISTE PAS AU REGISTRE. `"typescript-7":
// "npm:typescript@~7.0.2"` s'interroge sous `typescript`, sinon npm répond 404
// et la ligne reste sans amont, sans date et sans dépôt amont — indatable, donc
// jamais dite en retard. On garde le nom DÉCLARÉ pour la ligne (il distingue
// les deux compilateurs) et le nom RÉEL pour la requête.
const REEL = new Map()
for (const d of depots) {
  for (const u of d.unites) {
    for (const [p, plage] of Object.entries(u.declarees)) {
      SUIVIES.add(p)
      const r = paquetReel(p, plage)
      if (r !== p) REEL.set(p, r)
    }
  }
}
for (const p of PAIRS) SUIVIES.add(p)
const NOM_SOCLE = '@mister-guiiug/dev-pwa-config'
const amont = {}
const publieLe = {}
const depotAmont = {}
const versionsPubliees = {}
// La date de publication de CHAQUE version (`time` du document npm), gardée en
// mémoire seulement : c'est elle qui date la version amont ADMISE — celle d'un
// paquet plafonné n'est pas `latest` — et dit si elle a moins de 24 h.
const temps = {}
// Les versions qu'on peut CONSEILLER : ni dépréciées (npm), ni retirées
// (crates.io). C'est dans elles que se cherche la dernière d'une série.
const utilisables = {}

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
const INTERROGES = new Set([...SUIVIES].map((p) => REEL.get(p) ?? p))
await enLot([...INTERROGES], 6, async (p) => {
  try {
    const res = await fetch(`https://registry.npmjs.org/${p.replace('/', '%2f')}`)
    if (!res.ok) return
    const doc = await res.json()
    const derniere = doc['dist-tags']?.latest
    if (!derniere) return
    amont[p] = derniere
    versionsPubliees[p] = Object.keys(doc.versions || {})
    utilisables[p] = Object.entries(doc.versions || {})
      .filter(([, m]) => !m?.deprecated)
      .map(([v]) => v)
    temps[p] = doc.time || null
    if (doc.time?.[derniere]) publieLe[p] = doc.time[derniere]
    const url = doc.repository?.url || doc.versions?.[derniere]?.repository?.url || ''
    const m = /github\.com[:/]([^/]+)\/([^/#?]+?)(?:\.git)?(?:[#?].*)?$/.exec(url)
    if (m) depotAmont[p] = `${m[1]}/${m[2]}`
  } catch {
    /* hors ligne : les colonnes amont et dormance restent vides, ce n'est pas bloquant */
  }
})
// Reporter sur le nom déclaré ce qui a été relevé sous le nom réel.
for (const [nom, reel] of REEL) {
  if (amont[reel]) amont[nom] = amont[reel]
  if (versionsPubliees[reel]) versionsPubliees[nom] = versionsPubliees[reel]
  if (utilisables[reel]) utilisables[nom] = utilisables[reel]
  if (publieLe[reel]) publieLe[nom] = publieLe[reel]
  if (depotAmont[reel]) depotAmont[nom] = depotAmont[reel]
  if (temps[reel]) temps[nom] = temps[reel]
}
// le socle n'est pas sur npm public : sa référence est la version de son dépôt
const socle = depots.find((d) => d.nom === 'dev-pwa-config')
if (socle?.paquet?.version) amont[NOM_SOCLE] = socle.paquet.version
// et sa « dernière publication » est son dernier push : il paraît plusieurs
// fois par jour, l'interroger sur npm public rendrait un 404.
if (socle?.pushGitHub) publieLe[NOM_SOCLE] = socle.pushGitHub
if (socle) depotAmont[NOM_SOCLE] = `${COMPTE}/dev-pwa-config`

/* ------------------------------------------------------------- modèle */

const libs = []

// Une ligne compte des DÉPÔTS, pas des dossiers : un dépôt qui fige le même
// paquet à sa racine et dans `e2e/` reste UN dépôt — sinon il passerait pour
// « partagé » et gonflerait le retard.
const dansDepots = (entrees) => new Set(entrees.map((e) => e.depot)).size
const ordreEntrees = (a, b) => a.depot.localeCompare(b.depot) || (a.dossier ?? '').localeCompare(b.dossier ?? '')
// Le retard se compte par la règle que la page détaille (`estEnRetard`).
const enRetardDans = (paquet, versions, a) => dansDepots(versions.flatMap((v) => v.depots.filter((e) => estEnRetard(paquet, v.version, a, e))))

/**
 * LA DERNIÈRE DE SA SÉRIE, posée sur chaque version d'une AUTRE série que
 * l'amont : le correctif qu'un nouveau majeur cachait (voir `derniereDeSerie`
 * et `correctifsDe`). Dans la série de l'amont, c'est l'amont qui fait foi.
 * Rien à interroger de plus : les documents du registre sont déjà là.
 */
function poseDernieres(versions, a, publiees, latest, { plageDe = () => null, dateDe = () => null } = {}) {
  if (!a) return
  for (const v of versions) {
    if (serieDe(v.version) === serieDe(a)) continue
    const d = derniereDeSerie(publiees, serieDe(v.version), { latest, plage: plageDe(v) })
    if (!d || cmpVersion(d, v.version) <= 0) continue
    v.derniere = d
    // sa date à ELLE : « moins de 24 h » ne se lit pas sur celle de l'amont
    const quand = dateDe(d)
    if (quand) v.derniereLe = quand
  }
}

// Les plages que le socle impose à qui le consomme : ses pairs, dures ou non —
// npm refuse aussi une pair OPTIONNELLE installée hors de sa plage. Une montée
// dans la série ne se conseille qu'à l'intérieur.
const PLAGES_SOCLE = pkgSocle?.peerDependencies || {}
const unitesDuSocle = new Set(depots.flatMap((d) => d.unites.filter((u) => NOM_SOCLE in u.declarees).map((u) => `${d.nom}|${u.dossier}`)))

for (const paquet of SUIVIES) {
  const parVersion = new Map()
  const ajoute = (v, entree) => {
    if (!parVersion.has(v)) parVersion.set(v, [])
    parVersion.get(v).push(entree)
  }
  for (const d of depots) {
    for (const u of d.unites) {
      const ou = u.dossier ? { depot: d.nom, dossier: u.dossier } : { depot: d.nom }
      // TRANSITIF : une pair dure du socle, non déclarée, mais figée par le
      // lockfile d'une unité qui consomme le socle — c'est elle qui tourne.
      const transitif = !(paquet in u.declarees) && PAIRS.has(paquet) && NOM_SOCLE in u.declarees && Boolean(u.verrouillees[paquet])
      if (transitif) {
        ajoute(u.verrouillees[paquet], { ...ou, plage: null, verrouille: true, transitif: true })
        continue
      }
      if (!(paquet in u.declarees)) continue
      // Sans lockfile, la plage déclarée fait foi — et pour un ALIAS, la plage
      // est celle de l'alias (`~7.0.2`), pas la chaîne `npm:typescript@~7.0.2`
      // entière : `nettoie` n'y voit aucun préfixe de plage et la rendrait telle
      // quelle, en guise de numéro de version, dans la barre de répartition.
      const declaree = u.declarees[paquet]
      const v = u.verrouillees[paquet] || nettoie(aliasNpm(declaree)?.plage ?? declaree)
      const entree = { ...ou, plage: declaree, verrouille: !!u.verrouillees[paquet] }
      // `@types/vscode` suit le moteur que CE dépôt déclare : voir `PLAFONDS_ENGINES`.
      const plafond = plafondEngines(paquet, u.pkg, utilisables[paquet])
      if (plafond) entree.plafond = plafond
      ajoute(v, entree)
    }
  }
  if (!parVersion.size) continue
  const versions = [...parVersion].sort((a, b) => cmpVersion(b[0], a[0])).map(([version, deps]) => ({ version, depots: deps.sort(ordreEntrees) }))
  const entrees = versions.flatMap((v) => v.depots)
  // La référence d'un paquet PLAFONNÉ n'est pas `latest` : voir `amontAdmis`.
  const a = amontAdmis(paquet, versionsPubliees[paquet], amont[paquet] || null)
  poseDernieres(versions, a, utilisables[paquet], amont[paquet] || null, {
    plageDe: (v) => (v.depots.some((e) => unitesDuSocle.has(`${e.depot}|${e.dossier ?? ''}`)) ? (PLAGES_SOCLE[paquet] ?? null) : null),
    dateDe: (d) => temps[paquet]?.[d] || null,
  })
  // Un majeur ADMIS n'est pas un retard : voir `MAJEURS_ADMIS` dans
  // `regles.mjs`, et la contrainte amont qui l'y justifie. Un dépôt plafonné se
  // juge sur son plafond, même sans amont lisible.
  const enRetard = a || entrees.some((e) => e.plafond) ? enRetardDans(paquet, versions, a) : null
  libs.push({
    paquet,
    alias: REEL.get(paquet) ?? null,
    ecosysteme: 'npm',
    nbDepots: dansDepots(entrees),
    nbTransitifs: dansDepots(entrees.filter((e) => e.transitif)),
    nbVersions: versions.length,
    versions,
    amont: a,
    enRetard,
    majeursAdmis: MAJEURS_ADMIS[paquet] ?? null,
    plusRecente: versions[0].version,
    publieLe: publieLe[paquet] || null,
    // la date de la version amont ADMISE ; pour le socle, publié hors npm, son
    // dernier push fait foi, comme pour `publieLe`
    publieAmont: (a && temps[paquet]?.[a]) || (paquet === NOM_SOCLE ? publieLe[paquet] || null : null),
    depotAmont: depotAmont[paquet] || null,
  })
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
    utilisables[c] = doc.versions.filter((x) => !x.yanked).map((x) => x.num)
    temps[c] = Object.fromEntries(doc.versions.map((x) => [x.num, x.created_at]))
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
  poseDernieres(versions, a, utilisables[crate], a, { dateDe: (d) => temps[crate]?.[d] || null })
  libs.push({
    paquet: crate,
    ecosysteme: 'cargo',
    nbDepots: dansDepots(versions.flatMap((v) => v.depots)),
    nbVersions: versions.length,
    versions,
    amont: a,
    enRetard: a ? enRetardDans(crate, versions, a) : null,
    majeursAdmis: MAJEURS_ADMIS[crate] ?? null,
    plusRecente: versions[0].version,
    publieLe: publieLe[crate] || null,
    // crates.io ne rend que la dernière version stable : c'est l'amont
    publieAmont: publieLe[crate] || null,
    nbTransitifs: 0,
    depotAmont: depotAmont[crate] || null,
  })
}

// NODE, ÉPINGLÉ PAR LE `.nvmrc` DE CHAQUE DÉPÔT — la version que le
// développement installe. Le 23/09/2026, dix-huit apps restaient en 26.9.0
// quand le socle était passé en 26.10.0, et aucune ligne ne le disait. Seules
// les versions COMPLÈTES comptent (`versionNvmrc`). L'amont vient de
// nodejs.org, hors quota d'API : la plus haute publiée — la dernière de chaque
// série en sort aussi, pour le correctif qu'un nouveau majeur cacherait.
const parVersionNode = new Map()
for (const d of depots) {
  if (!d.nvmrc) continue
  if (!parVersionNode.has(d.nvmrc)) parVersionNode.set(d.nvmrc, [])
  parVersionNode.get(d.nvmrc).push({ depot: d.nom, plage: d.nvmrcBrut, verrouille: true })
}
if (parVersionNode.size) {
  const publieesNode = []
  const datesNode = {}
  try {
    const res = await fetch('https://nodejs.org/dist/index.json')
    if (res.ok)
      for (const n of await res.json()) {
        const v = String(n.version || '').replace(/^v/, '')
        publieesNode.push(v)
        if (n.date) datesNode[v] = n.date
      }
  } catch {
    /* hors ligne : la ligne reste, sans amont — comme un paquet illisible */
  }
  const aNode = publieesNode.filter((v) => /^\d+\.\d+\.\d+$/.test(v)).sort((x, y) => cmpVersion(y, x))[0] || null
  const versions = [...parVersionNode].sort((a, b) => cmpVersion(b[0], a[0])).map(([version, deps]) => ({ version, depots: deps.sort(ordreEntrees) }))
  const dateNode = (v) => (datesNode[v] ? new Date(datesNode[v]).toISOString() : null)
  poseDernieres(versions, aNode, publieesNode, aNode, { dateDe: dateNode })
  const date = aNode ? dateNode(aNode) : null
  libs.push({
    // Un nom qu'aucun paquet npm ne peut porter (majuscule) : la ligne ne se
    // confond pas avec `node` ni avec `@types/node`.
    paquet: 'Node.js',
    ecosysteme: 'node',
    fichier: '.nvmrc',
    nbDepots: dansDepots(versions.flatMap((v) => v.depots)),
    nbTransitifs: 0,
    nbVersions: versions.length,
    versions,
    amont: aNode,
    enRetard: aNode ? enRetardDans('Node.js', versions, aNode) : null,
    majeursAdmis: null,
    plusRecente: versions[0].version,
    publieLe: date,
    publieAmont: date,
    depotAmont: 'nodejs/node',
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
  delete d.unites
  delete d.nvmrc
  delete d.nvmrcBrut
  for (const w of d.workflows) delete w.idDernier
}

const propres = depots.flatMap((d) => d.workflows.filter((w) => !w.reutilisable))
const parFamille = {}
for (const f of FAMILLES) {
  const liste = depots.filter((d) => d.famille === f)
  const wf = liste.flatMap((d) => d.workflows.filter((w) => !w.reutilisable))
  parFamille[f] = {
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
  // la recherche des tableaux Renovate a-t-elle abouti ? Sans ce drapeau, une
  // carte muette sur Renovate ne dirait pas si rien n'attend ou si rien n'a
  // été lu.
  renovateLu,
  // les pairs dures du socle, suivies jusque dans les lockfiles
  pairsSocle: [...PAIRS],
}

/* ------------------------------------------- ce qui a bougé, et depuis quand */

// `avant` (la photo du jour) et `avantPublie` (la page en ligne) sont lus au
// début du relevé : voir « l'état précédent ».
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

// LES LIBELLÉS, POUR LA MÊME RAISON — et une de plus. Le texte de la page
// vivait à trois endroits : les nœuds du gabarit, les chaînes du JavaScript en
// ligne, et des phrases françaises que CE script calculait puis embarquait
// dans le JSON. Rassemblés dans `libelles.mjs`, ils sont éprouvés par
// `node --test` — qui exige notamment que les deux langues portent les mêmes
// clés, les mêmes interpolations et les mêmes formes de pluriel.
const libelles = readFileSync(join(ICI, 'libelles.mjs'), 'utf8')

// LA FEUILLE DE STYLE, SORTIE DU GABARIT POUR LA MÊME RAISON QUE LES RÈGLES.
// `gabarit.html` faisait 2 986 lignes, dont 1 220 de CSS et 1 478 de
// JavaScript : dix pour cent du fichier était ce que son nom annonce. Un
// éditeur ouvre désormais du CSS quand il ouvre du CSS, et la page servie ne
// change pas d'un octet — hors l'indentation, qui n'avait de sens que dans le
// HTML.
const style = readFileSync(join(ICI, 'style.css'), 'utf8')

// L'empreinte entre dans le modèle : sans elle, la comparaison ne porterait que
// sur les données et une refonte de la page ne serait JAMAIS republiée — le
// relevé répondrait « rien n'a bougé » sur un gabarit réécrit. Les modules y
// entrent aussi : depuis qu'ils portent la logique, les oublier rendrait
// invisible un changement de tri ou de rang d'écart. `libelles.mjs` en est le
// cas le plus net — une traduction corrigée ne change AUCUNE donnée, et sans
// son empreinte ici elle n'atteindrait jamais la page publiée.
modele.gabarit = createHash('sha256')
  .update(gabarit)
  .update(regles)
  .update(vue)
  .update(libelles)
  .update(style)
  .digest('hex')
  .slice(0, 12)

// La décision se prend AVANT d'assembler la page : l'historique qui y sera
// embarqué dépend d'elle.
const inchange = Boolean(publiee) && fond(avantPublie) === fond(modele)

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
let histoDepot = []
try {
  if (existsSync(CHEMIN_HISTORIQUE)) histoDepot = JSON.parse(readFileSync(CHEMIN_HISTORIQUE, 'utf8'))
  if (!Array.isArray(histoDepot)) histoDepot = []
} catch {
  // un historique illisible ne doit pas emporter le relevé : on repart de zéro
  console.error(`  historique.json illisible — un nouveau est écrit`)
  histoDepot = []
}
// Deux sources depuis le relevé horaire : le dépôt, figé une fois par jour par
// l'instantané, et la page en ligne, plus fraîche. Aucune n'est l'autre en
// mieux — voir `fusionneHistoriques`. Hors publication, la page « précédente »
// EST l'instantané du dépôt, et l'union ne change rien.
let histo = fusionneHistoriques(histoDepot, avantPublie?.historique).slice(-MAX_HISTORIQUE)
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
  // En publication, l'historique part avec le site ; le dépôt ne le reçoit
  // qu'avec l'instantané du jour, plus bas.
  if (ALIMENTE_HISTORIQUE && !DOSSIER_PUBLIE) {
    writeFileSync(CHEMIN_HISTORIQUE, JSON.stringify(histo) + '\n')
    console.error(`historique.json : ${histo.length} point(s), dont celui du ${jour}.`)
  }
}
modele.historique = histo

/* ------------------------------------------------------------- journal */

// LA TRANSITION DE CE PASSAGE, datée, en tête du journal. « Ce qui a bougé »
// se compare à la photo du jour ; le journal, lui, garde chaque transition
// horaire — c'est ce que le flux Atom publie. Comparé à la page EN LIGNE, et
// seulement quand le fond a bougé : un passage identique n'a rien à dire.
modele.journal = inchange ? avantPublie?.journal || [] : journalMisAJour(avantPublie?.journal, changementsDepuis(avantPublie, modele), modele.genere)

/* ------------------------------------------------------------- page */

const charge = JSON.stringify(modele).replace(/</g, '\\u003c').replace(/[\u2028\u2029]/g, (c) => '\\u' + c.charCodeAt(0).toString(16))
// `__VUE__` d'abord : le code inséré ne contient aucun marqueur, mais les
// données, elles, sont du JSON arbitraire — remplacer dans l'autre sens ferait
// dépendre le résultat de ce qu'un dépôt a mis dans sa description.
const page = gabarit
  // Le saut de ligne final du fichier est retiré ici : il est de rigueur dans un
  // fichier source, et poserait une ligne vide de plus avant `</style>`.
  .replace('__STYLE__', () => style.replace(/\n$/, ''))
  .replace('__VUE__', () => [sansModule(regles, 'regles.mjs'), sansModule(vue, 'vue.mjs'), sansModule(libelles, 'libelles.mjs')].join('\n'))
  .replace('__DONNEES__', () => charge)

// LE SITE À DÉPLOYER, écrit à CHAQUE passage — même quand rien n'a bougé. La
// page est alors la page en ligne à l'identique ; seul `etat.json` change, pour
// dire que le passage a eu lieu. Sans lui, une page restée la même depuis le
// matin ne saurait pas distinguer « rien n'a bougé » de « le relevé est en
// panne ».
const pageServie = inchange ? publiee : page
let instantane = false
if (DOSSIER_PUBLIE) {
  mkdirSync(DOSSIER_PUBLIE, { recursive: true })
  writeFileSync(join(DOSSIER_PUBLIE, 'index.html'), pageServie)
  writeFileSync(join(DOSSIER_PUBLIE, 'historique.json'), JSON.stringify(histo) + '\n')
  writeFileSync(join(DOSSIER_PUBLIE, 'etat.json'), JSON.stringify(etatPublie(inchange ? avantPublie : modele, MAINTENANT)) + '\n')

  // LE FLUX ATOM des changements : être prévenu sans ouvrir la page — un
  // lecteur de flux, un téléphone. Les titres sont les phrases de la page
  // (`phraseChangement`), en français, la langue servie par défaut. L'URL de
  // la page publiée fait l'identité du flux : elle ne change pas.
  if (URL_PUBLIEE) {
    const Tfr = traducteur('fr')
    const base = new URL(URL_PUBLIEE)
    const tag = `tag:${base.host},2026-09-23:${base.pathname.replace(/\/+$/, '')}`
    const ancre = (e) => (e.depot ? '#depot-' + e.depot : e.paquet ? '#lib-' + e.paquet : '')
    const entrees = modele.journal.map((e) => ({
      id: `${tag}/${e.quand}/${createHash('sha1').update(JSON.stringify([e.type, e.depot, e.paquet, e.workflow, e.de, e.a])).digest('hex').slice(0, 12)}`,
      titre: phraseChangement(e, Tfr).filter(Boolean).join(''),
      quand: e.quand,
      lien: base.href + ancre(e),
    }))
    writeFileSync(
      join(DOSSIER_PUBLIE, 'changements.xml'),
      fluxAtom({ id: tag + '/changements', titre: Tfr('flux.titre'), lien: base.href, soi: base.href + 'changements.xml', maj: modele.journal[0]?.quand || modele.genere, entrees }),
    )
  }
  console.error(
    inchange
      ? `Rien n'a bougé (${appels} appels d'API) : la page en ligne est republiée telle quelle, etat.json daté du passage.`
      : `${DOSSIER_PUBLIE} : nouvelle page, ${(page.length / 1024).toFixed(1)} Kio, ${appels} appels d'API.`,
  )

  // LA PHOTO DU JOUR. Le premier passage qui voit un jour nouveau réécrit aussi
  // l'`index.html` et le `historique.json` du DÉPÔT, et la CI les commite. Trois
  // raisons, dont chacune suffirait :
  //  - « ce qui a bougé » se compare à cette photo (voir plus haut) ;
  //  - l'historique garde une copie dans git, qui survit à tout ce qui peut
  //    arriver au site ;
  //  - GitHub DÉSACTIVE les crons d'un dépôt public resté soixante jours sans
  //    activité. Sans ce commit, le relevé horaire — qui ne commite plus rien
  //    d'autre — finirait par s'éteindre sans prévenir.
  // Si la poussée échoue, le jour reste absent du dépôt et le passage suivant
  // réessaie : rien à surveiller.
  instantane = INSTANTANE && joursAbsents(histoDepot, histo).length > 0
  if (instantane) {
    writeFileSync(SORTIE, pageServie)
    writeFileSync(CHEMIN_HISTORIQUE, JSON.stringify(histo) + '\n')
    console.error(`Instantané du jour : ${SORTIE} et historique.json réécrits pour le commit.`)
  }
} else if (inchange) {
  console.error(`Rien n'a bougé depuis le relevé précédent (${appels} appels d'API). Fichier laissé tel quel.`)
} else {
  writeFileSync(SORTIE, page)
  console.error(`${SORTIE} réécrit : ${(page.length / 1024).toFixed(1)} Kio, ${appels} appels d'API.`)
}
console.error(
  `${kpi.depots} dépôts — ${parFamille.pwa.depots} PWA, ${parFamille.socle.depots} socle, ${parFamille.desktop.depots} desktop, ${parFamille.autre.depots} autres | ` +
    `${kpi.verts} verts / ${kpi.rouges} rouges (${kpi.taux} %) | ${kpi.sitesEnLigne}/${kpi.sites} sites en ligne`,
)
if (process.env.GITHUB_OUTPUT) writeFileSync(process.env.GITHUB_OUTPUT, `change=${inchange ? 'non' : 'oui'}\ninstantane=${instantane ? 'oui' : 'non'}\n`, { flag: 'a' })
