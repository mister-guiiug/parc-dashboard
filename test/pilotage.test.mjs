import test from 'node:test'
import assert from 'node:assert/strict'
import {
  PRESETS,
  scoreSante,
  cockpitProd,
  salleRenovate,
  alertesCrossParc,
  tendances,
  runbookEchec,
  cleActionAFaire,
  litStockage,
  ecritStockage,
} from '../scripts/pilotage.mjs'

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

test('tendances exige deux points', () => {
  assert.equal(tendances([{ jour: '2026-01-01', taux: 90 }]).ok, false)
  const t = tendances([
    { jour: '2026-01-01', taux: 90, rouges: 2, alertes: 10, dormantes: 3, socleEnRetard: 1 },
    { jour: '2026-01-10', taux: 100, rouges: 0, alertes: 8, dormantes: 3, socleEnRetard: 0 },
  ])
  assert.equal(t.ok, true)
  assert.equal(t.delta.taux, 10)
  assert.equal(t.delta.rouges, -2)
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
  assert.ok(Object.keys(PRESETS).length >= 3)
})
