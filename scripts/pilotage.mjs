/**
 * Pilotage du parc — règles pures pour les chantiers C1–C12.
 *
 * Inséré dans la page comme `vue.mjs` (via `__VUE__` / releve.mjs).
 * Aucune dépendance DOM : tout ce qui est ici est éprouvé par `node --test`.
 */

/** Niveau d’une rubrique « À faire » — couleur et glyphe du gabarit. */
export const NIVEAU_A_FAIRE = {
  rouges: 'critique',
  sites: 'critique',
  mortes: 'critique',
  prod: 'attention',
  fugaces: 'attention',
  alertes: 'attention',
  scanning: 'attention',
  scanningOff: 'attention',
  envManifest: 'attention',
  rulesets: 'attention',
  dossiersIncertains: 'attention',
  introuvables: 'attention',
  prs: 'decision',
  publier: 'decision',
  majeures: 'decision',
  correctifs: 'entretien',
  socle: 'entretien',
  renovate: 'entretien',
}

export const GLYPHES_A_FAIRE = { critique: '✕', attention: '!', decision: '◆', entretien: '↑' }

/** Entrées du rail hors chapitres `main` (contexte, file, cockpit). */
export const LIENS_RAIL_OPS = [
  { id: 'contexte', cle: 'nav.contexte' },
  { id: 'afaire', cle: 'afaire.h2' },
  { id: 'cockpit', cle: 'nav.cockpit' },
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
    familles: [],
    retard: false,
    echec: false,
  },
}

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

/** Alertes sécu cross-parc (C11) — agrégat approximatif par dépôt (pas d’id CVE dans le modèle). */
export function alertesCrossParc(depots = []) {
  const lignes = []
  for (const d of depots) {
    if (d.alertes?.etat === 'lu' && d.alertes.total) {
      lignes.push({
        depot: d.nom,
        kind: 'dependabot',
        n: d.alertes.total,
        graves: d.alertes.graves || 0,
      })
    }
    if (d.scanning?.etat === 'lu' && d.scanning.total) {
      lignes.push({
        depot: d.nom,
        kind: 'codeql',
        n: d.scanning.total,
        graves: d.scanning.graves || 0,
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
 * Tendances sur l’historique (C9).
 * @param {Array<{jour:string,taux?:number,rouges?:number,alertes?:number,socleEnRetard?:number,dormantes?:number}>} histo
 * @param {number} fenetre jours
 */
export function tendances(histo = [], fenetre = 30) {
  const pts = (histo || []).filter((p) => p && p.jour).slice(-fenetre)
  if (pts.length < 2) return { ok: false, pts: pts.length, delta: null }
  const a = pts[0]
  const b = pts[pts.length - 1]
  const delta = (cle) => {
    const va = typeof a[cle] === 'number' ? a[cle] : null
    const vb = typeof b[cle] === 'number' ? b[cle] : null
    if (va == null || vb == null) return null
    return vb - va
  }
  return {
    ok: true,
    pts: pts.length,
    de: a.jour,
    a: b.jour,
    delta: {
      taux: delta('taux'),
      rouges: delta('rouges'),
      alertes: delta('alertes'),
      dormantes: delta('dormantes'),
      socleEnRetard: delta('socleEnRetard'),
    },
    dernier: {
      taux: b.taux,
      rouges: b.rouges,
      alertes: b.alertes,
      dormantes: b.dormantes,
      socleEnRetard: b.socleEnRetard,
    },
  }
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
