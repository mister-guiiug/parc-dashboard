// Les réparations du parc : ce qui se répare seul, dans quelles limites, et ce
// que le réparateur fait (ou ne fait pas) contre l'API.
//
// POURQUOI CES TESTS-LÀ. Un réparateur qui se trompe agit à chaque heure sur
// tout le parc : relancer une migration Supabase, redéployer pendant un
// déploiement, ou boucler sur un échec qui vient du code. Chaque garde est donc
// éprouvée ici, et le mode à blanc doit n'envoyer AUCUNE requête.

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  AGE_MIN_MS,
  DELAI_ENTRE_ESSAIS_MS,
  MAX_PAR_PASSAGE,
  MAX_TENTATIVES,
  MODES,
  candidats,
  idDuRun,
  marqueDe,
  planReparations,
  suiviRepris,
} from '../scripts/reparations.mjs'
import { executeAction, passage, resume } from '../scripts/reparer.mjs'
import { NIVEAU_A_FAIRE } from '../scripts/pilotage.mjs'

const H = 60 * 60 * 1000
const T0 = new Date('2026-11-20T12:00:00Z')

const wf = (fichier, etat, extra = {}) => ({
  nom: fichier.replace(/\.ya?ml$/, ''),
  fichier,
  reutilisable: false,
  etat,
  surDefaut: true,
  url: `https://github.com/x/y/actions/runs/${fichier.length}000`,
  derniers: [{ id: Number(`${fichier.length}000`) }],
  ...extra,
})

const depot = (nom, workflows = [], extra = {}) => ({
  nom,
  nwo: `mister-guiiug/${nom}`,
  brancheDefaut: 'main',
  commit: { sha: 'abc1234' },
  workflows,
  compte: { rouge: workflows.filter((w) => w.etat === 'rouge').length },
  ...extra,
})

const modele = (depots, extra = {}) => ({ soi: 'parc-dashboard', sonde: { date: T0.toISOString(), manquante: false }, depots, ...extra })

/** Le plan après deux passages espacés d'AGE_MIN_MS : l'écart a « mûri ». */
const planMur = (D, opts = {}) => {
  const premier = planReparations(D, { maintenant: new Date(+T0 - AGE_MIN_MS), ...opts })
  return planReparations(D, { suivi: premier.suivi, maintenant: T0, ...opts })
}

test('chaque rubrique « À faire » a un mode de réparation', () => {
  for (const cle of Object.keys(NIVEAU_A_FAIRE)) assert.ok(MODES[cle], `${cle} sans mode`)
  for (const { mode } of Object.values(MODES)) assert.ok(['auto', 'script', 'agent', 'humain'].includes(mode))
})

test('rouges : seuls les workflows qui vérifient se relancent', () => {
  const D = modele([
    depot('miss-a', [wf('ci.yml', 'rouge'), wf('deploy.yml', 'rouge'), wf('supabase-migrations.yml', 'rouge'), wf('publish.yml', 'rouge'), wf('codeql.yml', 'vert')]),
  ])
  const { liste, horsPortee } = candidats(D)
  assert.deepEqual(
    liste.map((c) => c.fichier),
    ['ci.yml'],
  )
  assert.equal(liste[0].action, 'relancer-echecs')
  assert.equal(liste[0].cible, '6000')
  assert.deepEqual(horsPortee.map((h) => h.fichier).sort(), ['deploy.yml', 'publish.yml', 'supabase-migrations.yml'])
})

test('rouges : ni réutilisable, ni run hors de la branche par défaut', () => {
  const D = modele([depot('miss-a', [wf('ci.yml', 'rouge', { reutilisable: true }), wf('lighthouse.yml', 'rouge', { surDefaut: false })])])
  const { liste, horsPortee } = candidats(D)
  assert.equal(liste.length, 0)
  assert.deepEqual(horsPortee.map((h) => h.raison), ['dernier run hors de la branche par défaut'])
})

test('le dépôt du relevé et les dépôts exclus ne sont jamais touchés', () => {
  const D = modele([depot('parc-dashboard', [wf('ci.yml', 'rouge')]), depot('miss-b', [wf('ci.yml', 'rouge')])])
  assert.equal(candidats(D).liste.length, 1)
  assert.equal(candidats(D, { exclus: ['miss-b'] }).liste.length, 0)
})

test('production en retard : redéployer, sauf déploiement en cours ou rouge', () => {
  const D = modele([
    depot('miss-a', [wf('deploy.yml', 'vert')], { prod: { etat: 'retard' } }),
    depot('miss-b', [wf('deploy.yml', 'encours')], { prod: { etat: 'retard' } }),
    depot('miss-c', [wf('ci.yml', 'vert')], { prod: { etat: 'retard' } }),
    depot('miss-d', [wf('deploy.yml', 'vert')], { prod: { etat: 'aJour' } }),
  ])
  const { liste, horsPortee } = candidats(D)
  assert.equal(liste.length, 1)
  assert.deepEqual({ depot: liste[0].depot, action: liste[0].action, fichier: liste[0].fichier, ref: liste[0].ref, cible: liste[0].cible }, {
    depot: 'miss-a',
    action: 'redeployer',
    fichier: 'deploy.yml',
    ref: 'main',
    cible: 'abc1234',
  })
  assert.deepEqual(horsPortee.map((h) => `${h.depot}: ${h.raison}`), ['miss-b: déploiement en cours', 'miss-c: aucun workflow de déploiement reconnu'])
})

test('sonde manquante : relancer le relevé, sur le dépôt du relevé', () => {
  const { liste } = candidats(modele([], { sonde: { date: '2026-11-20T01:00:00Z', manquante: true } }), { nwoSoi: 'mister-guiiug/parc-dashboard' })
  assert.deepEqual(liste.map((c) => [c.action, c.nwo, c.fichier]), [['relancer-releve', 'mister-guiiug/parc-dashboard', 'releve.yml']])
  assert.equal(candidats(modele([], { sonde: null })).liste[0].cible, 'jamais')
})

test('ancienneté : un écart neuf attend un passage', () => {
  const D = modele([depot('miss-a', [wf('ci.yml', 'rouge')])])
  const p = planReparations(D, { maintenant: T0 })
  assert.equal(p.actions.length, 0)
  assert.match(p.reportees[0].raison, /trop récent/)
  assert.equal(planMur(D).actions.length, 1)
})

test('délai et coupe-circuit : un essai par jour, deux au plus, puis une escalade', () => {
  const D = modele([depot('miss-a', [wf('ci.yml', 'rouge')])])
  const marque = marqueDe({ cle: 'rouges', depot: 'miss-a', cible: '6000' })
  const base = { premiereVue: new Date(+T0 - 3 * 24 * H).toISOString() }

  const recent = planReparations(D, { suivi: { [marque]: { ...base, tentatives: 1, dernierEssai: new Date(+T0 - 2 * H).toISOString() } }, maintenant: T0 })
  assert.match(recent.reportees[0].raison, /24 h/)

  const ancien = planReparations(D, { suivi: { [marque]: { ...base, tentatives: 1, dernierEssai: new Date(+T0 - DELAI_ENTRE_ESSAIS_MS - H).toISOString() } }, maintenant: T0 })
  assert.equal(ancien.actions.length, 1)

  const epuise = planReparations(D, { suivi: { [marque]: { ...base, tentatives: MAX_TENTATIVES, dernierEssai: base.premiereVue } }, maintenant: T0 })
  assert.equal(epuise.actions.length, 0)
  assert.equal(epuise.escalades.length, 1)
  // L'escalade ne se répète pas au passage suivant.
  const ensuite = planReparations(D, { suivi: epuise.suivi, maintenant: new Date(+T0 + H) })
  assert.equal(ensuite.escalades.length, 0)
  assert.match(ensuite.reportees[0].raison, /escaladé/)
})

test('budget : au plus MAX_PAR_PASSAGE actions par passage', () => {
  const D = modele(Array.from({ length: MAX_PAR_PASSAGE + 3 }, (_, i) => depot(`miss-${i}`, [wf('ci.yml', 'rouge')])))
  const p = planMur(D)
  assert.equal(p.actions.length, MAX_PAR_PASSAGE)
  assert.equal(p.reportees.filter((r) => /budget/.test(r.raison)).length, 3)
})

test('un écart disparu est marqué résolu, puis oublié au bout d’une semaine', () => {
  const D = modele([depot('miss-a', [wf('ci.yml', 'rouge')])])
  const vu = planReparations(D, { maintenant: T0 })
  const resolu = planReparations(modele([depot('miss-a', [wf('ci.yml', 'vert')])]), { suivi: vu.suivi, maintenant: new Date(+T0 + H) })
  const entree = Object.values(resolu.suivi)[0]
  assert.ok(entree.resoluLe)
  const oublie = planReparations(modele([]), { suivi: resolu.suivi, maintenant: new Date(+T0 + 9 * 24 * H) })
  assert.deepEqual(oublie.suivi, {})
})

test('idDuRun lit le dernier run, sinon l’URL', () => {
  assert.equal(idDuRun({ derniers: [{ id: 42 }] }), '42')
  assert.equal(idDuRun({ url: 'https://github.com/a/b/actions/runs/777' }), '777')
  assert.equal(idDuRun({}), null)
})

test('un journal d’un autre mode repart de zéro', () => {
  const j = { mode: 'a-blanc', suivi: { x: { tentatives: 2 } } }
  assert.deepEqual(suiviRepris(j, 'actif'), {})
  assert.deepEqual(suiviRepris(j, 'a-blanc'), j.suivi)
})

/** Un faux `fetch` qui note chaque appel et répond selon l'URL. */
function fauxFetch(reponses = {}) {
  const appels = []
  const f = async (url, init = {}) => {
    appels.push({ url, methode: init.method || 'GET' })
    const cle = Object.keys(reponses).find((k) => url.endsWith(k) && (reponses[k].methode || 'GET') === (init.method || 'GET'))
    const r = cle ? reponses[cle] : { status: 404 }
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.corps }
  }
  return { f, appels }
}

test('à blanc : aucune requête, même avec un jeton', async () => {
  const D = modele([depot('miss-a', [wf('ci.yml', 'rouge')])])
  const { f, appels } = fauxFetch()
  const premier = await passage(D, { maintenant: new Date(+T0 - AGE_MIN_MS), jeton: 'x', fetch: f })
  const j = await passage(D, { journalPrecedent: premier, maintenant: T0, jeton: 'x', fetch: f })
  assert.equal(j.mode, 'a-blanc')
  assert.equal(appels.length, 0)
  assert.equal(j.actions[0].statut, 'aurait-fait')
  // La simulation compte comme un essai : le passage suivant attend 24 h.
  const apres = await passage(D, { journalPrecedent: j, maintenant: new Date(+T0 + H), fetch: f })
  assert.equal(apres.actions.length, 0)
  assert.match(resume(j), /à blanc/)
})

test('actif sans jeton reste à blanc', async () => {
  const j = await passage(modele([]), { actif: true, jeton: '' })
  assert.equal(j.mode, 'a-blanc')
})

test('relancer : une seule fois, et seulement un run vraiment en échec', async () => {
  const a = { action: 'relancer-echecs', nwo: 'o/r', cible: '9' }
  const echoue = fauxFetch({ '/actions/runs/9': { status: 200, corps: { status: 'completed', conclusion: 'failure', run_attempt: 1 } }, '/rerun-failed-jobs': { status: 201, methode: 'POST' } })
  assert.equal((await executeAction(a, { jeton: 't', fetch: echoue.f })).statut, 'fait')
  assert.deepEqual(echoue.appels.map((x) => x.methode), ['GET', 'POST'])

  const dejaRelance = fauxFetch({ '/actions/runs/9': { status: 200, corps: { status: 'completed', conclusion: 'failure', run_attempt: 2 } } })
  assert.equal((await executeAction(a, { jeton: 't', fetch: dejaRelance.f })).statut, 'sans-objet')
  assert.equal(dejaRelance.appels.length, 1)

  const vert = fauxFetch({ '/actions/runs/9': { status: 200, corps: { status: 'completed', conclusion: 'success', run_attempt: 1 } } })
  assert.equal((await executeAction(a, { jeton: 't', fetch: vert.f })).statut, 'sans-objet')
})

test('redéployer : workflow_dispatch sur la branche par défaut, 422 expliqué', async () => {
  const a = { action: 'redeployer', nwo: 'o/r', fichier: 'deploy.yml', ref: 'main' }
  const ok = fauxFetch({ '/actions/workflows/deploy.yml/dispatches': { status: 204, methode: 'POST' } })
  assert.equal((await executeAction(a, { jeton: 't', fetch: ok.f })).statut, 'fait')
  const sansDispatch = fauxFetch({ '/actions/workflows/deploy.yml/dispatches': { status: 422, methode: 'POST' } })
  const r = await executeAction(a, { jeton: 't', fetch: sansDispatch.f })
  assert.equal(r.statut, 'echec')
  assert.match(r.message, /workflow_dispatch/)
})
