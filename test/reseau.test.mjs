import test from 'node:test'
import assert from 'node:assert/strict'
import { lienSuivant, paginerJson, protectMainSolide } from '../scripts/reseau.mjs'

test('lienSuivant lit rel=next dans l’en-tête Link', () => {
  assert.equal(lienSuivant(null), null)
  assert.equal(
    lienSuivant('<https://api.github.com/x?page=2>; rel="next", <https://api.github.com/x?page=1>; rel="prev"'),
    'https://api.github.com/x?page=2',
  )
})

test('paginerJson agrège les pages et s’arrête sur erreur', async () => {
  const pages = {
    'https://x?page=1': {
      ok: true,
      status: 200,
      headers: { get: () => '<https://x?page=2>; rel="next"' },
      json: async () => [{ id: 1 }],
    },
    'https://x?page=2': {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => [{ id: 2 }],
    },
  }
  const r = await paginerJson('https://x?page=1', async (url) => pages[url])
  assert.equal(r.ok, true)
  assert.deepEqual(
    r.items.map((i) => i.id),
    [1, 2],
  )

  const refus = await paginerJson('https://x', async () => ({
    ok: false,
    status: 403,
    headers: { get: () => null },
    text: async () => 'forbidden',
  }))
  assert.equal(refus.ok, false)
  assert.equal(refus.status, 403)
  assert.equal(refus.corpsTexte, 'forbidden')
})

test('protectMainSolide exige pull_request et required_status_checks', () => {
  assert.equal(protectMainSolide(null), null)
  assert.equal(protectMainSolide([{ type: 'pull_request' }]), false)
  assert.equal(
    protectMainSolide([{ type: 'pull_request' }, { type: 'required_status_checks' }]),
    true,
  )
})
