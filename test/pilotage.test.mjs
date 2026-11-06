import test from 'node:test'
import assert from 'node:assert/strict'
import {
  PRESETS,
  scoreSante,
  cockpitProd,
  salleRenovate,
  alertesCrossParc,
  alertesParCause,
  texteCorrectionSecu,
  etatDuParc,
  LIENS_RAIL_OPS,
  runbookEchec,
  cleActionAFaire,
  litStockage,
  ecritStockage,
  exporteDecisions,
  importeDecisions,
  scopesIncomplets,
  runbookDocUrl,
  aFairePublie,
  NIVEAU_A_FAIRE,
} from '../scripts/pilotage.mjs'
import { ORDRE_A_FAIRE } from '../scripts/vue.mjs'
import { traducteur } from '../scripts/libelles.mjs'

test('scoreSante : dépôt sain proche de 100', () => {
  const s = scoreSante({
    compte: { vert: 5, rouge: 0 },
    pages: { url: 'https://x', ok: true },
    prod: { etat: 'aJour' },
    renovate: { enAttente: 0, majeures: 0 },
    alertes: { etat: 'lu', total: 0, graves: 0 },
    scanning: { etat: 'lu', total: 0 },
  })
  assert.ok(s.score >= 90)
})

test('scoreSante : rouge + site down + majeures tire vers le bas', () => {
  const s = scoreSante({
    compte: { vert: 1, rouge: 4 },
    pages: { url: 'https://x', ok: false },
    prod: { etat: 'retard', retard: 3 },
    renovate: { enAttente: 5, majeures: 2 },
    alertes: { etat: 'lu', total: 3, graves: 1 },
    scanning: { etat: 'lu', total: 2, graves: 0 },
  })
  assert.ok(s.score < 40)
})

test('scoreSante pénalise CodeQL off, env.manifest et ruleset faible', () => {
  const base = {
    compte: { vert: 5, rouge: 0 },
    pages: { url: 'https://x', ok: true },
    prod: { etat: 'aJour' },
    renovate: { enAttente: 0, majeures: 0 },
    alertes: { etat: 'lu', total: 0, graves: 0 },
    scanning: { etat: 'lu', total: 0 },
    envManifest: { etat: 'ok', n: 1 },
    ruleset: { etat: 'actif', n: 1 },
  }
  const sain = scoreSante(base)
  const penalise = scoreSante({
    ...base,
    scanning: { etat: 'desactivees' },
    envManifest: { etat: 'absent' },
    ruleset: { etat: 'faible', n: 1 },
  })
  assert.ok(penalise.axes.secu < sain.axes.secu)
  assert.ok(penalise.score < sain.score)
})

test('cockpitProd range les signaux', () => {
  const c = cockpitProd([
    { nom: 'a', prod: { etat: 'deploiement' } },
    { nom: 'b', prod: { etat: 'retard', retard: 2 }, pages: { url: 'u', ok: false } },
    { nom: 'c', prod: { mortes: ['x.js'], fugaces: ['y.js'] } },
  ])
  assert.equal(c.enCours.length, 1)
  assert.equal(c.retard.length, 1)
  assert.equal(c.sitesDown.length, 1)
  assert.equal(c.mortes.length, 1)
  assert.equal(c.fugaces.length, 1)
})

test('salleRenovate agrège et classe', () => {
  const s = salleRenovate([
    { nom: 'a', renovate: { enAttente: 3, majeures: 1, issue: 'https://i/a', introuvables: ['@x/y'] } },
    { nom: 'b', renovate: { enAttente: 1, majeures: 0, introuvables: ['@x/y'] } },
  ])
  assert.equal(s.total, 4)
  assert.equal(s.majeures, 1)
  assert.equal(s.enAttente[0].depot, 'a')
  assert.deepEqual(s.introuvables[0], { paquet: '@x/y', depots: ['a', 'b'] })
})

test('alertesCrossParc compte dépôts et gravité', () => {
  const a = alertesCrossParc([
    { nom: 'a', alertes: { etat: 'lu', total: 2, graves: 1 }, scanning: { etat: 'lu', total: 1, graves: 0 } },
    { nom: 'b', alertes: { etat: 'lu', total: 0 }, scanning: { etat: 'absente' } },
  ])
  assert.equal(a.depotsTouches, 1)
  assert.equal(a.lignes.length, 2)
  assert.equal(a.graves, 1)
})

test('runbookEchec reconnaît les familles', () => {
  assert.equal(runbookEchec({ workflow: 'deploy', etape: 'upload-pages' }), 'pages')
  assert.equal(runbookEchec({ workflow: 'ci', etape: 'npm ci' }), 'lockfile')
  assert.equal(runbookEchec({ workflow: 'pwa-ci', etape: 'call' }), 'socle')
  assert.equal(runbookEchec({ workflow: 'ci', etape: 'vitest' }), 'tests')
  assert.equal(runbookEchec({ workflow: 'ci', etape: 'eslint' }), 'qualite')
  assert.equal(runbookEchec({ workflow: 'build', etape: 'compile' }), 'generique')
})

test('cleActionAFaire est stable', () => {
  assert.equal(cleActionAFaire('rouges', { depot: 'x', n: 1 }), 'rouges:x')
  assert.equal(cleActionAFaire('majeures', { paquet: 'vite', depots: [] }), 'majeures:vite')
})

test('stockage session lit et écrit', () => {
  const mem = new Map()
  const fake = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, v),
  }
  assert.deepEqual(litStockage('k', [], fake), [])
  assert.equal(ecritStockage('k', ['a'], fake), true)
  assert.deepEqual(litStockage('k', [], fake), ['a'])
})

test('PRESETS portent hash et drapeaux', () => {
  assert.ok(PRESETS['matin-ci'].hash)
  assert.equal(PRESETS['entretien-majeurs'].retard, true)
  assert.deepEqual(PRESETS['prod-drift'].familles, ['pwa'])
  assert.equal(PRESETS['prod-drift'].retard, true)
  assert.equal(PRESETS['prod-drift'].hash, 'cockpit')
  assert.deepEqual(PRESETS.conformite.rubriques, ['scanningOff', 'envManifest', 'rulesets'])
  assert.equal(PRESETS['secu-grave'].secuGrave, true)
  assert.ok(Object.keys(PRESETS).length >= 5)
})

test('exporteDecisions / importeDecisions : un seul fichier, aller-retour', () => {
  const json = exporteDecisions(['rouges:a', 'prod:b'], { lodash: { decision: 'garder' } })
  assert.deepEqual(importeDecisions(json), { traites: ['prod:b', 'rouges:a'], dormance: { lodash: { decision: 'garder' } } })
  assert.equal(importeDecisions('{'), null)
  assert.equal(importeDecisions('42'), null)
})

test('importeDecisions relit les deux fichiers d’avant', () => {
  // Un export fait la veille, avec l'ancien bouton, doit se réimporter.
  assert.deepEqual(importeDecisions('{"version":1,"traites":["x"]}'), { traites: ['x'], dormance: {} })
  assert.deepEqual(importeDecisions('["x","",3]'), { traites: ['x'], dormance: {} })
  assert.deepEqual(importeDecisions('{"version":1,"dormance":{"leaflet":{"decision":"ignorer","jusqua":"2027-01-01"}}}'), {
    traites: [],
    dormance: { leaflet: { decision: 'ignorer', jusqua: '2027-01-01' } },
  })
  // Une décision mal formée est écartée, sans emporter les autres.
  assert.deepEqual(importeDecisions('{"dormance":{"a":{"decision":"garder"},"b":"x"}}').dormance, { a: { decision: 'garder' } })
})

/* ── Alertes par cause ──────────────────────────────────────────────────── */

test('alertesParCause : vingt-six dépôts, deux CVE, deux lignes', () => {
  // Le relevé du 05/11/2026 : 23 dépôts portaient les deux CVE, trois une seule.
  const deux = (nom) => ({ nom, alertes: { etat: 'lu', total: 2, graves: 0, ids: ['CVE-2026-118764', 'CVE-2026-93753'] } })
  const une = (nom) => ({ nom, alertes: { etat: 'lu', total: 1, graves: 0, ids: ['CVE-2026-118764'] } })
  const depots = [...Array.from({ length: 23 }, (_, i) => deux('app-' + i)), une('x'), une('y'), une('z')]
  const c = alertesParCause(depots)
  assert.equal(c.length, 2)
  assert.deepEqual(
    c.map((x) => [x.id, x.depots.length]),
    [
      ['CVE-2026-118764', 26],
      ['CVE-2026-93753', 23],
    ],
  )
  // Avec le seul échantillon `ids`, la gravité d'une cause est INCONNUE, pas « non grave ».
  assert.equal(c[0].grave, null)
  assert.equal(c[0].echantillon, false)
})

test('alertesParCause : les causes détaillées portent paquet, correctif et gravité, les graves d’abord', () => {
  const c = alertesParCause([
    { nom: 'a', alertes: { etat: 'lu', total: 1, causes: [{ id: 'CVE-1', paquet: 'vite', corrige: '8.3.6', grave: false, n: 1 }] } },
    { nom: 'b', scanning: { etat: 'lu', total: 12, causes: [{ id: 'js/polynomial-redos', grave: true, n: 1 }, { id: 'vice/deps/vulnerable-dep', grave: false, n: 11 }] } },
    { nom: 'c', alertes: { etat: 'lu', total: 1, causes: [{ id: 'CVE-1', paquet: 'vite', corrige: '8.3.6', grave: false, n: 1 }] } },
  ])
  assert.deepEqual(c[0], { id: 'js/polynomial-redos', kind: 'codeql', paquet: null, corrige: null, grave: true, echantillon: false, depots: ['b'] })
  assert.deepEqual(c[1], { id: 'CVE-1', kind: 'dependabot', paquet: 'vite', corrige: '8.3.6', grave: false, echantillon: false, depots: ['a', 'c'] })
})

test('alertesParCause dit quand l’échantillon a pu laisser échapper des causes', () => {
  // Huit identifiants gardés pour douze alertes : d'autres causes ont pu manquer.
  const c = alertesParCause([{ nom: 'a', scanning: { etat: 'lu', total: 12, ids: Array(8).fill('vice/deps/vulnerable-dep') } }])
  assert.equal(c.length, 1)
  assert.equal(c[0].echantillon, true)
  assert.deepEqual(alertesParCause([{ nom: 'a', alertes: { etat: 'illisible' } }]), [])
})

test('texteCorrectionSecu : une demande par cause, datée, avec paquet et gravité', () => {
  const T = traducteur('fr')
  const texte = texteCorrectionSecu(
    [
      { id: 'js/polynomial-redos', kind: 'codeql', paquet: null, corrige: null, grave: true, depots: ['dev-pwa-config'] },
      { id: 'CVE-1', kind: 'dependabot', paquet: 'vite', corrige: '8.3.6', grave: false, depots: ['a', 'b'] },
    ],
    T,
    '5 novembre 2026 à 20:57',
  )
  const blocs = texte.split('\n\n')
  assert.equal(blocs.length, 3)
  assert.match(blocs[0], /relevé du 5 novembre 2026 à 20:57/)
  assert.match(blocs[1], /^Corriger js\/polynomial-redos \(CodeQL\) dans 1 dépôt :/)
  assert.match(blocs[1], /Gravité élevée ou critique/)
  assert.match(blocs[2], /Paquet en cause : vite, corrigé en 8\.3\.6\./)
  assert.match(blocs[2], /\n- a\n- b$/)
  // des accents, et la langue de la page
  assert.match(texteCorrectionSecu([], traducteur('en'), 'x'), /^From the estate dashboard/)
})

/* ── Ligne d'état ───────────────────────────────────────────────────────── */

test('etatDuParc : chaque élément dit son niveau, et mène à sa section', () => {
  const sain = { nom: 'a', compte: { vert: 3, rouge: 0 }, workflows: [{ etat: 'vert' }, { etat: 'vert' }, { etat: 'vert' }], pages: { url: 'https://a', ok: true } }
  const e = etatDuParc([sain], { renovateLu: true })
  assert.deepEqual(
    e.map((x) => [x.cle, x.niveau]),
    [
      ['ci', 'ok'],
      ['production', 'ok'],
      ['sites', 'ok'],
      ['securite', 'inconnu'],
      ['pr', 'ok'],
      ['renovate', 'ok'],
    ],
  )
  const malade = {
    nom: 'b',
    compte: { vert: 1, rouge: 1 },
    workflows: [{ etat: 'vert' }, { etat: 'rouge' }],
    pages: { url: 'https://b', ok: false },
    prod: { etat: 'retard', retard: 2 },
    alertes: { etat: 'lu', total: 3, graves: 1 },
    prs: [{ num: 1 }],
  }
  const m = Object.fromEntries(etatDuParc([malade], { renovateLu: true }).map((x) => [x.cle, x]))
  assert.equal(m.ci.niveau, 'critique')
  assert.equal(m.ci.ancre, 'echecs')
  assert.equal(m.sites.niveau, 'critique')
  assert.equal(m.production.niveau, 'attention')
  assert.equal(m.securite.niveau, 'critique')
  assert.equal(m.securite.n, 1)
  assert.equal(m.securite.total, 3)
  assert.equal(m.pr.niveau, 'attention')
  // Renovate non lu se dit « inconnu », pas « rien en attente »
  assert.equal(etatDuParc([sain], { renovateLu: false }).find((x) => x.cle === 'renovate').niveau, 'inconnu')
})

test('le rail suit l’ordre de la page', () => {
  // « Production » était troisième dans le rail et onzième à l'écran.
  assert.deepEqual(
    LIENS_RAIL_OPS.map((x) => x.id),
    ['etat', 'afaire', 'bandeauChangements', 'indicateurs', 'contexte'],
  )
})

test('runbookDocUrl pointe hors du run', () => {
  assert.match(runbookDocUrl('pages'), /github\.com/)
  assert.match(runbookDocUrl('inconnu'), /parc-dashboard/)
})

test('scopesIncomplets lit les KPI', () => {
  assert.deepEqual(scopesIncomplets({ alertesLisibles: true, scanningLisible: true, rulesetsLisibles: true }), [])
  assert.deepEqual(scopesIncomplets({ alertesLisibles: false, scanningLisible: true, rulesetsLisibles: false }), [
    'dependabot',
    'rulesets',
  ])
})

// `a-faire.json`, que lit le serveur MCP : la liste de la page, pas une autre.
test('aFairePublie : la liste de la page, avec son niveau et son titre', () => {
  const D = {
    genere: '2026-10-29T18:27:49.157Z',
    depots: [
      { nom: 'a', compte: { rouge: 2 } },
      { nom: 'b', compte: { rouge: 1 } },
    ],
    libs: [],
    kpi: {},
    socleAPublier: { version: '6.29.0' },
  }
  const r = aFairePublie(D, traducteur('fr'))
  assert.equal(r.genere, D.genere)
  assert.deepEqual(r.items, [
    {
      cle: 'rouges',
      niveau: 'critique',
      titre: '2 dépôts ont des workflows rouges',
      n: 2,
      details: [
        { depot: 'a', n: 2 },
        { depot: 'b', n: 1 },
      ],
    },
    { cle: 'publier', niveau: 'decision', titre: 'Version du socle à publier', n: 1, details: [{ version: '6.29.0' }] },
  ])
})

test('aFairePublie : rien à faire, une liste vide et datée de rien', () => {
  assert.deepEqual(aFairePublie({}, traducteur('fr')), { genere: null, items: [] })
})

// Une rubrique sans niveau sortirait en `niveau: null` : un programme qui trie
// par gravité la rangerait nulle part.
test('chaque rubrique « À faire » a un niveau', () => {
  for (const cle of ORDRE_A_FAIRE) assert.ok(NIVEAU_A_FAIRE[cle], cle)
})
