/**
 * Pilotage du parc — règles pures pour les chantiers C1–C12.
 *
 * Inséré dans la page comme `vue.mjs` (via `__VUE__` / releve.mjs).
 * Aucune dépendance DOM : tout ce qui est ici est éprouvé par `node --test`.
 */

import { aFaire, kpiDepuisDepots } from './vue.mjs'

/** Niveau d’une rubrique « À faire » — couleur et glyphe du gabarit. */
export const NIVEAU_A_FAIRE = {
  graves: 'critique',
  rouges: 'critique',
  sites: 'critique',
  mortes: 'critique',
  introuvables: 'critique',
  prod: 'attention',
  fugaces: 'attention',
  doublons: 'attention',
  alertes: 'attention',
  scanning: 'attention',
  scanningOff: 'attention',
  envManifest: 'attention',
  rulesets: 'attention',
  dossiersIncertains: 'attention',
  prs: 'decision',
  publier: 'decision',
  majeures: 'decision',
  // Rubrique de la page seule : une librairie dormante que le propriétaire a
  // décidé de remplacer. La décision vit dans son navigateur, pas dans le relevé.
  remplacer: 'decision',
  correctifs: 'entretien',
  socle: 'entretien',
  renovate: 'entretien',
}

export const GLYPHES_A_FAIRE = { critique: '✕', attention: '!', decision: '◆', entretien: '↑' }

/**
 * « À FAIRE », LU PAR UN PROGRAMME. La page dresse sa liste dans le navigateur,
 * depuis les données qu'elle embarque. Un autre lecteur (le serveur MCP
 * `mister-parc-mcp`) devait donc refaire `aFaire()`, ses gardes de lisibilité
 * et ses niveaux, dans un autre langage : la même règle à deux endroits, dont
 * l'un vieillirait sans le dire. Le relevé la calcule ici, une fois, et la
 * publie à côté de la page (`a-faire.json`).
 *
 * Le titre est celui de la page, dans la langue de `T` ; le niveau, celui qui
 * colore la rubrique. Clés et détails passent tels quels : c'est sur eux qu'un
 * programme filtre.
 */
export function aFairePublie(D, T) {
  return {
    genere: D?.genere ?? null,
    items: aFaire(D).map((it) => ({
      cle: it.cle,
      niveau: NIVEAU_A_FAIRE[it.cle] ?? null,
      titre: T('afaire.' + it.cle, { n: it.n }),
      n: it.n,
      details: it.details,
    })),
  }
}

/**
 * Entrées du rail hors chapitres `main`, DANS L'ORDRE DE LA PAGE. « Production »
 * était troisième ici et onzième à l'écran : le lien faisait sauter huit
 * écrans. Les chapitres de `main` suivent, lus dans le DOM.
 */
export const LIENS_RAIL_OPS = [
  { id: 'etat', cle: 'nav.etat' },
  { id: 'afaire', cle: 'afaire.h2' },
  { id: 'bandeauChangements', cle: 'changements.h2' },
  { id: 'indicateurs', cle: 'nav.indicateurs' },
  { id: 'contexte', cle: 'nav.contexte' },
]

/** Presets d’écran (C12) — clés stables dans l’URL `?preset=…`. */
export const PRESETS = {
  'matin-ci': {
    hash: 'echecs',
    familles: [],
    retard: false,
    echec: true,
  },
  'entretien-majeurs': {
    hash: 'afaire',
    familles: ['pwa'],
    retard: true,
    echec: false,
  },
  'prod-drift': {
    hash: 'cockpit',
    familles: ['pwa'],
    retard: true,
    echec: false,
  },
  conformite: {
    hash: 'afaire',
    familles: ['pwa'],
    retard: false,
    echec: false,
    rubriques: ['scanningOff', 'envManifest', 'rulesets'],
  },
  'secu-grave': {
    hash: 'secu',
    familles: [],
    retard: false,
    echec: false,
    secuGrave: true,
  },
}

/** Docs / pistes runbook (C3) — lien stable hors du run GitHub. */
export const RUNBOOK_LIENS = {
  pages: 'https://github.com/mister-guiiug/dev-pwa-config/blob/main/docs/CONFIG.md',
  lockfile: 'https://github.com/mister-guiiug/dev-pwa-config/blob/main/docs/MIGRATIONS.md',
  socle: 'https://github.com/mister-guiiug/dev-pwa-config/blob/main/README.md',
  tests: 'https://github.com/mister-guiiug/dev-pwa-config/blob/main/docs/BINS.md',
  qualite: 'https://github.com/mister-guiiug/dev-pwa-config/blob/main/docs/CONFIGS.md',
  generique: 'https://github.com/mister-guiiug/parc-dashboard/blob/main/README.md',
}

/** Workflow Renovate auto-hébergé (jeton Packages). */
export const LIEN_RENOVATE_SOCLE =
  'https://github.com/mister-guiiug/dev-pwa-config/actions/workflows/renovate.yml'

/**
 * Score de santé 0–100 (C4).
 * Axes : CI (40), prod (20), deps/Renovate (20), sécu (20).
 */
export function scoreSante(d) {
  if (!d) return { score: 0, axes: { ci: 0, prod: 0, deps: 0, secu: 0 } }
  const wf = (d.compte?.vert || 0) + (d.compte?.rouge || 0)
  const ci = wf === 0 ? 20 : Math.round(40 * ((d.compte?.vert || 0) / wf))
  let prod = 20
  if (d.pages?.url && d.pages.ok === false) prod = 0
  else if (d.prod?.mortes?.length) prod = 4
  else if (d.prod?.etat === 'retard') prod = 8
  else if (d.prod?.fugaces?.length) prod = 12
  else if (d.prod?.etat === 'deploiement') prod = 16
  else if (!d.pages?.url && !d.prod) prod = 14
  const attente = d.renovate?.enAttente || 0
  const majeures = d.renovate?.majeures || 0
  let deps = 20
  if (attente + majeures > 0) deps = Math.max(0, 20 - attente - majeures * 2)
  let secu = 20
  const alertes = d.alertes?.etat === 'lu' ? d.alertes.total || 0 : 0
  const graves = d.alertes?.etat === 'lu' ? d.alertes.graves || 0 : 0
  const scan = d.scanning?.etat === 'lu' ? d.scanning.total || 0 : 0
  secu = Math.max(0, 20 - graves * 6 - (alertes - graves) * 2 - scan * 2)
  // Conformité : CodeQL off, env.manifest manquant, ruleset faible / absent.
  if (d.scanning?.etat === 'desactivees') secu = Math.max(0, secu - 4)
  if (d.envManifest && d.envManifest.etat !== 'ok' && d.envManifest.etat !== 'hors-scope') secu = Math.max(0, secu - 3)
  if (d.ruleset && (d.ruleset.etat === 'absent' || d.ruleset.etat === 'disabled')) secu = Math.max(0, secu - 4)
  else if (d.ruleset?.etat === 'faible') secu = Math.max(0, secu - 2)
  const score = Math.max(0, Math.min(100, ci + prod + deps + secu))
  return { score, axes: { ci, prod, deps, secu } }
}

/** Cockpit production / sites (C8). */
export function cockpitProd(depots = []) {
  const enCours = []
  const retard = []
  const sitesDown = []
  const mortes = []
  const fugaces = []
  for (const d of depots) {
    if (d.prod?.etat === 'deploiement') enCours.push({ depot: d.nom, etat: d.prod.etat })
    if (d.prod?.etat === 'retard') retard.push({ depot: d.nom, retard: d.prod.retard })
    if (d.pages?.url && d.pages.ok === false) sitesDown.push({ depot: d.nom, url: d.pages.url })
    if (d.prod?.mortes?.length) mortes.push({ depot: d.nom, fichiers: d.prod.mortes })
    if (d.prod?.fugaces?.length) fugaces.push({ depot: d.nom, fichiers: d.prod.fugaces })
  }
  return { enCours, retard, sitesDown, mortes, fugaces }
}

/** Salle Renovate agrégée (C5). */
export function salleRenovate(depots = []) {
  const enAttente = []
  const introuvables = new Map()
  let total = 0
  let majeures = 0
  for (const d of depots) {
    const r = d.renovate
    if (!r) continue
    if (r.enAttente) {
      enAttente.push({
        depot: d.nom,
        n: r.enAttente,
        majeures: r.majeures || 0,
        url: r.issue || null,
      })
      total += r.enAttente
      majeures += r.majeures || 0
    }
    for (const p of r.introuvables || []) {
      introuvables.set(p, [...(introuvables.get(p) || []), d.nom])
    }
  }
  enAttente.sort((a, b) => b.n - a.n || a.depot.localeCompare(b.depot))
  return {
    total,
    majeures,
    enAttente,
    introuvables: [...introuvables]
      .map(([paquet, noms]) => ({ paquet, depots: noms.sort() }))
      .sort((a, b) => b.depots.length - a.depots.length || a.paquet.localeCompare(b.paquet)),
  }
}

/** Alertes sécu cross-parc (C11) — agrégat par dépôt, avec un échantillon d’ids. */
export function alertesCrossParc(depots = []) {
  const lignes = []
  for (const d of depots) {
    if (d.alertes?.etat === 'lu' && d.alertes.total) {
      lignes.push({
        depot: d.nom,
        kind: 'dependabot',
        n: d.alertes.total,
        graves: d.alertes.graves || 0,
        ids: Array.isArray(d.alertes.ids) ? d.alertes.ids.slice(0, 5) : [],
      })
    }
    if (d.scanning?.etat === 'lu' && d.scanning.total) {
      lignes.push({
        depot: d.nom,
        kind: 'codeql',
        n: d.scanning.total,
        graves: d.scanning.graves || 0,
        ids: Array.isArray(d.scanning.ids) ? d.scanning.ids.slice(0, 5) : [],
      })
    }
  }
  lignes.sort((a, b) => b.graves - a.graves || b.n - a.n || a.depot.localeCompare(b.depot))
  const depotsTouches = new Set(lignes.map((l) => l.depot)).size
  const graves = lignes.reduce((n, l) => n + l.graves, 0)
  const total = lignes.reduce((n, l) => n + l.n, 0)
  return { lignes, depotsTouches, graves, total }
}

/**
 * LES ALERTES PAR CAUSE, et non plus par dépôt.
 *
 * Le 06/11/2026, la section listait 26 lignes Dependabot pour deux CVE
 * seulement : 23 dépôts portaient les deux, trois une seule. Le propriétaire,
 * et l'agent à qui il copiait la demande, traitaient vingt-six fois la même
 * chose. Une cause est un identifiant d'alerte (CVE, GHSA, règle CodeQL) et
 * sa source ; elle porte les dépôts touchés, et quand le relevé l'a lu, le
 * paquet en cause et la première version corrigée.
 *
 * Deux formes de données, parce que le relevé a changé : `causes` (identifiant,
 * paquet, correctif, gravité) depuis novembre 2026, et `ids` avant — un simple
 * échantillon des huit premiers identifiants, sans gravité. Avec `ids`, la
 * gravité d'une cause est INCONNUE (`null`), et `echantillon` dit que d'autres
 * identifiants ont pu échapper au relevé.
 *
 * @param {object[]} depots
 */
export function alertesParCause(depots = []) {
  const causes = new Map()
  for (const d of depots) {
    for (const [kind, a] of [
      ['dependabot', d.alertes],
      ['codeql', d.scanning],
    ]) {
      if (a?.etat !== 'lu' || !a.total) continue
      const detaillees = Array.isArray(a.causes) && a.causes.length > 0
      const liste = detaillees ? a.causes : [...new Set(a.ids || [])].map((id) => ({ id, grave: null }))
      const echantillon = !detaillees && (a.ids || []).length < a.total
      for (const c of liste) {
        if (!c?.id) continue
        const cle = kind + ':' + c.id
        const x = causes.get(cle) || { id: c.id, kind, paquet: null, corrige: null, grave: c.grave ?? null, echantillon: false, depots: [] }
        if (c.grave === true) x.grave = true
        else if (c.grave === false && x.grave === null) x.grave = false
        x.paquet = x.paquet || c.paquet || null
        x.corrige = x.corrige || c.corrige || null
        x.echantillon = x.echantillon || echantillon
        if (!x.depots.includes(d.nom)) x.depots.push(d.nom)
        causes.set(cle, x)
      }
    }
  }
  return [...causes.values()]
    .map((x) => ({ ...x, depots: x.depots.sort() }))
    .sort((a, b) => Number(b.grave === true) - Number(a.grave === true) || b.depots.length - a.depots.length || a.id.localeCompare(b.id))
}

/**
 * LA DEMANDE DE CORRECTION, une par cause, prête à confier à un agent.
 *
 * Elle remplace le « prompt sécu » : écrit en dur, sans accents, non traduit,
 * et une ligne par dépôt qui répétait les mêmes identifiants. Même forme que
 * « Copier la demande » des montées : l'en-tête daté, puis chaque cause avec
 * ses dépôts.
 *
 * @param {ReturnType<typeof alertesParCause>} causes
 * @param {(cle: string, p?: object) => string} T
 * @param {string} quand date du relevé, déjà formatée
 */
export function texteCorrectionSecu(causes, T, quand) {
  const blocs = (causes || []).map((c) => {
    const lignes = [T('secu.demande.cause', { id: c.id, source: T('secu.kind.' + c.kind), n: c.depots.length })]
    if (c.paquet) lignes.push(c.corrige ? T('secu.demande.paquet', { paquet: c.paquet, corrige: c.corrige }) : T('secu.demande.paquetSansCorrectif', { paquet: c.paquet }))
    if (c.grave === true) lignes.push(T('secu.demande.grave'))
    for (const depot of c.depots) lignes.push('- ' + depot)
    return lignes.join('\n')
  })
  return [T('secu.demande.entete', { quand }), ...blocs].join('\n\n')
}

/**
 * LA LIGNE D'ÉTAT DU PARC : ce qui va et ce qui ne va pas, en une rangée.
 *
 * Cinq blocs de la page existaient surtout pour dire « rien » — un tableau
 * d'échecs vide sous ses en-têtes, « Rien à signaler côté production »,
 * « 0 mises à jour en attente », quatre familles « 100 % au vert », et un
 * « 100 % » de 64 px. Une ligne les remplace ; un bloc ne paraît plus que s'il
 * a quelque chose à montrer.
 *
 * `niveau` : `ok`, `attention` (à traiter sans urgence), `critique`, ou
 * `inconnu` quand le relevé n'a pas pu lire la source.
 *
 * @param {object[]} depots les dépôts du contexte courant
 * @param {{ renovateLu?: boolean, kpi?: object }} [opts] `kpi` : ceux du relevé,
 *   qui disent ce qu'il a pu LIRE — un filtre vide ne rend pas une source illisible
 */
export function etatDuParc(depots = [], opts = {}) {
  const k = kpiDepuisDepots(depots, opts.kpi || {})
  const prod = cockpitProd(depots)
  const reno = salleRenovate(depots)
  const secu = alertesCrossParc(depots)
  const niv = (critique, attention) => (critique ? 'critique' : attention ? 'attention' : 'ok')
  const secuLisible = k.alertesLisibles || k.scanningLisible
  return [
    { cle: 'ci', niveau: niv(k.rouges > 0, false), n: k.rouges, verts: k.verts, total: k.workflows, neutres: k.neutres, jamais: k.jamais, ancre: 'echecs' },
    {
      cle: 'production',
      niveau: niv(prod.mortes.length > 0, prod.retard.length + prod.fugaces.length > 0),
      n: prod.retard.length + prod.mortes.length + prod.fugaces.length,
      encours: prod.enCours.length,
      ancre: 'cockpit',
    },
    { cle: 'sites', niveau: niv(k.sitesEnLigne < k.sites, false), n: k.sites - k.sitesEnLigne, enLigne: k.sitesEnLigne, total: k.sites, ancre: 'cockpit' },
    {
      cle: 'securite',
      niveau: secuLisible ? niv(secu.graves > 0, secu.total > 0) : 'inconnu',
      n: secu.graves,
      total: secu.total,
      ancre: 'secu',
    },
    { cle: 'pr', niveau: niv(false, k.prOuvertes > 0), n: k.prOuvertes, ancre: 'afaire' },
    {
      cle: 'renovate',
      niveau: opts.renovateLu === false ? 'inconnu' : niv(reno.introuvables.length > 0, reno.total > 0),
      n: reno.total,
      introuvables: reno.introuvables.length,
      ancre: 'renovate',
    },
  ]
}

/**
 * MES DÉCISIONS, EN UN FICHIER. Les cases « traité » et les décisions de
 * dormance vivaient chacune avec son export et son import : quatre boutons pour
 * un même besoin — retrouver ses choix sur un autre poste.
 *
 * @param {Iterable<string>} traites
 * @param {Record<string, { decision: string, jusqua?: string }>} dormance
 */
export function exporteDecisions(traites, dormance) {
  return JSON.stringify({ version: 2, traites: [...(traites || [])].sort(), dormance: dormance || {} }, null, 2)
}

/**
 * Relit un fichier de décisions. Accepte aussi les deux formats d'avant
 * (`{ version: 1, traites }`, une liste nue, `{ version: 1, dormance }`) : un
 * export fait la veille doit se réimporter.
 *
 * @param {string} texte
 * @returns {{ traites: string[], dormance: Record<string, { decision: string, jusqua?: string }> } | null}
 */
export function importeDecisions(texte) {
  let j
  try {
    j = JSON.parse(texte)
  } catch {
    return null
  }
  if (j === null || typeof j !== 'object') return null
  const listeTraites = Array.isArray(j) ? j : Array.isArray(j.traites) ? j.traites : []
  const brut = Array.isArray(j) ? null : j.dormance && typeof j.dormance === 'object' && !Array.isArray(j.dormance) ? j.dormance : !('traites' in j) && !('version' in j) ? j : null
  const dormance = {}
  for (const [paquet, v] of Object.entries(brut || {})) {
    if (!v || typeof v !== 'object' || typeof v.decision !== 'string') continue
    dormance[paquet] = { decision: v.decision, ...(v.jusqua ? { jusqua: v.jusqua } : {}) }
  }
  const traites = listeTraites.filter((x) => typeof x === 'string' && x)
  if (!traites.length && !Object.keys(dormance).length && !Array.isArray(j) && !('traites' in j) && !('dormance' in j)) return null
  return { traites, dormance }
}

/**
 * Scopes PAT incomplets d’après les KPI du relevé.
 * @param {object} kpi
 */
export function scopesIncomplets(kpi = {}) {
  const manques = []
  if (!kpi.alertesLisibles) manques.push('dependabot')
  if (!kpi.scanningLisible) manques.push('scanning')
  if (!kpi.rulesetsLisibles) manques.push('rulesets')
  return manques
}

/** Suggestion de runbook pour un échec CI (C3). */
export function runbookEchec(e) {
  const texte = `${e?.workflow || ''} ${e?.etape || ''} ${(e?.jobs || []).map((j) => j.name).join(' ')}`.toLowerCase()
  if (/deploy|pages|gh-pages|upload-pages/.test(texte)) return 'pages'
  if (/lock|npm ci|pnpm i|yarn|package-lock|pnpm-lock/.test(texte)) return 'lockfile'
  if (/migrate|pwa-ci|pwa-deploy|reusable|dev-pwa-config/.test(texte)) return 'socle'
  if (/test|vitest|playwright|e2e/.test(texte)) return 'tests'
  if (/lint|eslint|typecheck|tsc/.test(texte)) return 'qualite'
  return 'generique'
}

/** @param {string} cle */
export function runbookDocUrl(cle) {
  return RUNBOOK_LIENS[cle] || RUNBOOK_LIENS.generique
}

/** Clé stable d’une action À faire (C2). */
export function cleActionAFaire(rubrique, detail) {
  if (!detail) return rubrique
  if (detail.depot && detail.paquet) return `${rubrique}:${detail.depot}:${detail.paquet}`
  if (detail.paquet) return `${rubrique}:${detail.paquet}`
  if (detail.depot) return `${rubrique}:${detail.depot}`
  if (detail.url) return `${rubrique}:${detail.url}`
  return `${rubrique}:${JSON.stringify(detail)}`
}

/** Stockage session (C2, C7) — interface testable. */
export function litStockage(cle, fallback, stockage = null) {
  try {
    const raw = (stockage || globalThis.localStorage)?.getItem?.(cle)
    if (raw == null) return fallback
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}

export function ecritStockage(cle, valeur, stockage = null) {
  try {
    ;(stockage || globalThis.localStorage)?.setItem?.(cle, JSON.stringify(valeur))
    return true
  } catch {
    return false
  }
}
