import test from 'node:test'
import assert from 'node:assert/strict'
import { lienSuivant, lireRulesetsDepot, paginerJson, protectMainSolide } from '../scripts/reseau.mjs'

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

test('protectMainSolide exige PR, checks et au moins un contexte', () => {
  assert.equal(protectMainSolide(null), null)
  assert.equal(protectMainSolide([{ type: 'pull_request' }]), false)
  assert.equal(
    protectMainSolide([{ type: 'pull_request' }, { type: 'required_status_checks' }]),
    false,
    'sans contexte nommé, ce n’est pas Protect main',
  )
  assert.equal(
    protectMainSolide([
      { type: 'pull_request' },
      { type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'ci' }] } },
    ]),
    true,
  )
  assert.equal(
    protectMainSolide([{ type: 'pull_request' }, { type: 'required_status_checks' }], { minContexts: 0 }),
    true,
  )
})

test('lireRulesetsDepot agrège liste + protect', async () => {
  const calls = []
  const fetchFn = async (url) => {
    calls.push(url)
    if (url.endsWith('/rulesets')) {
      return {
        ok: true,
        status: 200,
        json: async () => [{ id: 1, enforcement: 'active' }],
      }
    }
    return {
      ok: true,
      status: 200,
      json: async () => [
        { type: 'pull_request' },
        { type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'ci' }] } },
      ],
    }
  }
  const r = await lireRulesetsDepot('o/r', 'main', fetchFn, { api: 'https://api.example' })
  assert.equal(r.status, 200)
  assert.equal(r.protect, true)
  assert.equal(r.appels, 2)
  assert.equal(calls.length, 2)
})
