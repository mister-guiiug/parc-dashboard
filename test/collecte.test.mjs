// Les règles pures de la collecte — ce que le relevé interprète de textes venus
// d'ailleurs : un `sw.js`, une entrée Vite, un corps d'issue Renovate, une
// réponse de l'API de comparaison.
//
// POURQUOI CES TESTS-LÀ. Chacune de ces lectures peut se tromper EN SILENCE
// dans le sens rassurant : une production « à jour » qui ne l'est pas, un
// morceau fugace que personne ne nomme, un Renovate qui attend sans qu'on le
// voie. Aucune ne lève ; toutes affichent une page verte.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  EMPREINTE_VITE,
  entreeDe,
  etatChecks,
  etatProd,
  fluxAtom,
  fugacesDe,
  horsBuild,
  journalMisAJour,
  lisTableauRenovate,
  pairsDures,
  precacheDe,
  referencesDe,
  resumeScanning,
  satisfait,
  scanningDepuisReponse,
  derniereDeSerie,
  plafondEngines,
  unitesDeLArbre,
  espacesDeTravail,
  verrouilleesDe,
  versionNvmrc,
} from '../scripts/collecte.mjs'

/* ── Pairs du socle ─────────────────────────────────────────────────────── */

test('pairsDures garde les pairs que npm installe d’office, pas les optionnelles', () => {
  const pkg = {
    peerDependencies: { 'typescript-eslint': '^8.58.0', vitest: '^5', '@sentry/react': '^10.75.2', react: '^19' },
    peerDependenciesMeta: { '@sentry/react': { optional: true }, react: { optional: true } },
  }
  assert.deepEqual(pairsDures(pkg), ['typescript-eslint', 'vitest'])
  assert.deepEqual(pairsDures(null), [])
  assert.deepEqual(pairsDures({}), [])
})

/* ── Production ─────────────────────────────────────────────────────────── */

const T0 = Date.parse('2026-09-23T20:00:00Z')

test('etatProd : le commit construit EST la tête de main', () => {
  const r = etatProd({ commit: '9fb31f7d366711d6dc3fa484e0ade88f9d69a43b', buildTime: '2026-09-23T06:46:04Z' }, { sha: '9fb31f7' }, null, T0)
  assert.deepEqual(r, { commit: '9fb31f7', construit: '2026-09-23T06:46:04Z', etat: 'aJour' })
})

test('etatProd ne se prononce pas sans version.json lisible', () => {
  assert.equal(etatProd(null, { sha: '9fb31f7' }, null, T0).etat, 'inconnu')
  // Un champ `commit` qui n'est pas un SHA ne vaut pas mieux qu'aucun.
  assert.equal(etatProd({ commit: 'dev' }, { sha: '9fb31f7' }, null, T0).etat, 'inconnu')
  // Deux commits différents sans comparaison possible : on ne devine pas.
  assert.equal(etatProd({ commit: 'a'.repeat(40) }, { sha: 'bbbbbbb' }, null, T0).etat, 'inconnu')
})

test('etatProd : en retard, et de combien de commits', () => {
  const cmp = { ahead_by: 3, files: [{ filename: 'src/App.tsx' }, { filename: 'README.md' }] }
  const r = etatProd({ commit: 'a'.repeat(40) }, { sha: 'bbbbbbb', dateCommit: '2026-09-23T12:00:00Z' }, cmp, T0)
  assert.equal(r.etat, 'retard')
  assert.equal(r.retard, 3)
})

test('etatProd : ÉQUIVALENTE quand seuls des fichiers hors build ont changé', () => {
  // Un README corrigé, un workflow retouché, des tests ajoutés : la page servie
  // est la même, et crier au retard serait une fausse alarme permanente.
  const cmp = { ahead_by: 2, files: [{ filename: 'README.md' }, { filename: '.github/workflows/ci.yml' }, { filename: 'e2e/a.spec.ts' }] }
  assert.equal(etatProd({ commit: 'a'.repeat(40) }, { sha: 'bbbbbbb' }, cmp, T0).etat, 'equivalent')
})

test('etatProd : une tête de moins de trente minutes est « en déploiement », pas en retard', () => {
  const cmp = { ahead_by: 1, files: [{ filename: 'src/main.ts' }] }
  const r = etatProd({ commit: 'a'.repeat(40) }, { sha: 'bbbbbbb', dateCommit: '2026-09-23T19:50:00Z' }, cmp, T0)
  assert.equal(r.etat, 'deploiement')
})

test('etatProd : une liste de fichiers tronquée ne prouve pas l’équivalence', () => {
  const files = Array.from({ length: 300 }, (_, i) => ({ filename: `docs/${i}.md` }))
  const r = etatProd({ commit: 'a'.repeat(40) }, { sha: 'bbbbbbb' }, { ahead_by: 40, files }, T0)
  assert.equal(r.etat, 'retard')
})

test('horsBuild : ce qui change le site servi n’en est jamais', () => {
  for (const f of ['README.md', 'docs/a.md', '.github/workflows/deploy.yml', 'e2e/x.spec.ts', 'src/a.test.ts', 'vitest.config.ts', 'renovate.json']) assert.ok(horsBuild(f), f)
  for (const f of ['src/App.tsx', 'package.json', 'package-lock.json', 'vite.config.ts', 'public/manifest.webmanifest', '.nvmrc']) assert.ok(!horsBuild(f), f)
})

/* ── Morceaux fugaces ───────────────────────────────────────────────────── */

test('precacheDe lit le manifeste minifié ET développé', () => {
  const mini = 'self.__WB_MANIFEST=[{url:"assets/index-Ab12Cd34.js",revision:null},{url:"index.html",revision:"x"}]'
  const dev = '[{ "url": "assets/vendor-Zz99Yy88.js", "revision": null }]'
  assert.deepEqual([...precacheDe(mini)].sort(), ['index-Ab12Cd34.js', 'index.html'])
  assert.deepEqual([...precacheDe(dev)], ['vendor-Zz99Yy88.js'])
  assert.equal(precacheDe(null).size, 0)
})

test('entreeDe trouve le script module, quel que soit l’ordre des attributs', () => {
  assert.equal(entreeDe('<script type="module" crossorigin src="/app/assets/index-Ab12Cd34.js"></script>'), '/app/assets/index-Ab12Cd34.js')
  assert.equal(entreeDe('<script src="./assets/index-Ab12Cd34.js" type="module"></script>'), './assets/index-Ab12Cd34.js')
  assert.equal(entreeDe('<script src="x.js"></script>'), null)
})

test('referencesDe : imports relatifs et __vite__mapDeps, pas les URL absolues', () => {
  const entree = 'import{a}from"./vendor-Zz99Yy88.js";const m=()=>import("./sentry.js");__vite__mapDeps(["assets/rive-Qq11Ww22.js"]);navigator.serviceWorker.register("/app/sw.js")'
  assert.deepEqual([...referencesDe(entree)].sort(), ['rive-Qq11Ww22.js', 'sentry.js', 'vendor-Zz99Yy88.js'])
})

test('fugacesDe : hors précache ET empreinté — un nom stable n’est pas fugace', () => {
  const refs = new Set(['vendor-Zz99Yy88.js', 'sentry-EYLFX1f0.js', 'sentry.js'])
  const precache = new Set(['vendor-Zz99Yy88.js'])
  // Le cas de mister-qowa le 22/09/2026 : sentry-EYLFX1f0.js, 404 au déploiement suivant.
  assert.deepEqual(fugacesDe(refs, precache), ['sentry-EYLFX1f0.js'])
  assert.ok(EMPREINTE_VITE.test('sentry-EYLFX1f0.js'))
  assert.ok(!EMPREINTE_VITE.test('sentry.js'))
})

/* ── CI d'une pull request ──────────────────────────────────────────────── */

test('etatChecks : un seul rouge suffit, et « aucun check » n’est pas un vert', () => {
  const ok = { status: 'completed', conclusion: 'success' }
  assert.equal(etatChecks([ok, { status: 'completed', conclusion: 'skipped' }]), 'vert')
  assert.equal(etatChecks([ok, { status: 'in_progress', conclusion: null }]), 'encours')
  assert.equal(etatChecks([ok, { status: 'completed', conclusion: 'failure' }, { status: 'queued' }]), 'rouge')
  assert.equal(etatChecks([]), null)
  assert.equal(etatChecks(undefined), null)
})

/* ── Sécurité et qualité (Code scanning) ────────────────────────────────── */

test('resumeScanning compte les graves et les erreurs', () => {
  const liste = [
    { rule: { severity: 'warning', security_severity_level: 'high' } },
    { rule: { severity: 'error', security_severity_level: 'medium' } },
    { rule: { severity: 'note', security_severity_level: null } },
    { rule: { severity: 'warning', security_severity_level: 'critical' } },
  ]
  assert.deepEqual(resumeScanning(liste), { etat: 'lu', total: 4, graves: 2, erreurs: 1 })
  assert.deepEqual(resumeScanning([]), { etat: 'lu', total: 0, graves: 0, erreurs: 0 })
})

test('scanningDepuisReponse : trois états, jamais deux', () => {
  assert.deepEqual(scanningDepuisReponse(404, '{"message":"no analysis found"}'), { etat: 'desactivees' })
  assert.deepEqual(scanningDepuisReponse(403, '{"message":"Code scanning is not enabled for this repository."}'), { etat: 'desactivees' })
  assert.deepEqual(scanningDepuisReponse(403, '{"message":"Resource not accessible by integration"}'), { etat: 'illisible' })
  assert.deepEqual(scanningDepuisReponse(500, 'boom'), { etat: 'illisible' })
  assert.deepEqual(scanningDepuisReponse(200, { oops: true }), { etat: 'illisible' })
  assert.deepEqual(scanningDepuisReponse(200, [{ rule: { severity: 'error', security_severity_level: 'high' } }]), {
    etat: 'lu',
    total: 1,
    graves: 1,
    erreurs: 1,
  })
})

/* ── Renovate ───────────────────────────────────────────────────────────── */

// Extrait RÉEL du « Dependency Dashboard » de mister-qowa, relevé le 23/09/2026.
const TABLEAU_QOWA = `This issue lists Renovate updates and detected dependencies.<br>

## Awaiting Schedule

The following updates are awaiting their schedule. To get an update now, click on a checkbox below.

 - [ ] <!-- unschedule-branch=renovate/npm-(mineur-and-patch) -->fix(deps): update npm (mineur & patch) (\`@sentry/react\`, \`posthog-js\`, \`prettier\`)
 - [ ] <!-- unschedule-branch=renovate/node-26.x -->chore(deps): update node.js to v26.10.0
 - [ ] <!-- unschedule-branch=renovate/major-github-actions -->chore(deps): update github-actions (major) (\`actions/setup-java\`, \`java-jdk\`)
 - [ ] <!-- unschedule-branch=renovate/major-sentry-javascript-monorepo -->fix(deps): update dependency @sentry/react to v11
 - [ ] <!-- unschedule-branch=renovate/motion-13.x -->fix(deps): update dependency motion to v13
 - [ ] <!-- create-all-awaiting-schedule-prs -->🔐 **Create all awaiting schedule PRs at once** 🔐

---

> [!WARNING]
> Renovate failed to look up the following dependencies: \`Failed to look up npm package @mister-guiiug/dev-pwa-config: no-result\`.

## Detected Dependencies

<details><summary>github-actions (5)</summary>
</details>

- [ ] <!-- manual job -->Check this box to trigger a request for Renovate to run again on this repository
`

test('lisTableauRenovate compte les mises à jour en attente, pas les cases d’outillage', () => {
  const r = lisTableauRenovate(TABLEAU_QOWA)
  // cinq mises à jour ; ni « Create all… » ni « manual job » n'en sont
  assert.equal(r.enAttente, 5)
  assert.equal(r.mises[0].section, 'Awaiting Schedule')
  assert.equal(r.mises[3].titre, 'fix(deps): update dependency @sentry/react to v11')
})

test('lisTableauRenovate reconnaît les majeures comme Renovate les écrit', () => {
  const r = lisTableauRenovate(TABLEAU_QOWA)
  assert.deepEqual(
    r.mises.map((m) => m.majeure),
    // groupe mineur & patch, node 26.10.0, github-actions (major), @sentry v11, motion v13
    [false, false, true, true, true],
  )
  assert.equal(r.majeures, 3)
})

test('lisTableauRenovate relève les paquets que Renovate ne sait pas résoudre', () => {
  // Le socle est sur GitHub Packages : Renovate ne le voit pas, donc ne
  // proposera jamais de le monter — et rien d'autre ne le dit.
  assert.deepEqual(lisTableauRenovate(TABLEAU_QOWA).introuvables, ['@mister-guiiug/dev-pwa-config'])
  assert.deepEqual(lisTableauRenovate('').introuvables, [])
})

/* ── Journal et flux Atom ───────────────────────────────────────────────── */

test('journalMisAJour : le plus récent d’abord, daté, et plafonné', () => {
  const j1 = journalMisAJour([], [{ type: 'ci-rouge', depot: 'a', workflow: 'CI' }], '2026-09-23T10:17:00Z')
  const j2 = journalMisAJour(j1, [{ type: 'amont', paquet: 'vite', de: '8.2.0', a: '8.3.0' }], '2026-09-23T11:17:00Z')
  assert.deepEqual(
    j2.map((e) => [e.type, e.quand]),
    [
      ['amont', '2026-09-23T11:17:00Z'],
      ['ci-rouge', '2026-09-23T10:17:00Z'],
    ],
  )
  const plein = journalMisAJour(j2, [{ type: 'depot-entre', depot: 'z' }], '2026-09-23T12:17:00Z', 2)
  assert.equal(plein.length, 2)
  assert.equal(plein[0].type, 'depot-entre')
})

test('journalMisAJour ne renote pas une transition déjà annoncée dans les 24 h', () => {
  const e = { type: 'amont', paquet: 'vite', de: '8.2.0', a: '8.3.0' }
  const j = journalMisAJour([], [e], '2026-09-23T10:17:00Z')
  assert.equal(journalMisAJour(j, [e], '2026-09-23T11:17:00Z').length, 1)
  // Au-delà d'un jour, c'est un nouvel événement (le paquet a pu redescendre).
  assert.equal(journalMisAJour(j, [e], '2026-09-24T11:17:00Z').length, 2)
})

test('fluxAtom rend un flux valide, et échappe tout texte', () => {
  const x = fluxAtom({
    id: 'tag:exemple,2026:flux',
    titre: 'Parc & co',
    lien: 'https://exemple/',
    soi: 'https://exemple/changements.xml',
    maj: '2026-09-23T11:17:00Z',
    entrees: [{ id: 'tag:exemple,2026:1', titre: 'CI <rouge> & "cassée"', quand: '2026-09-23T11:17:00Z', lien: 'https://exemple/#depot-a' }],
  })
  assert.match(x, /^<\?xml version="1\.0" encoding="utf-8"\?>\n<feed xmlns="http:\/\/www\.w3\.org\/2005\/Atom">/)
  assert.match(x, /<title>Parc &amp; co<\/title>/)
  assert.match(x, /<title>CI &lt;rouge&gt; &amp; &quot;cassée&quot;<\/title>/)
  assert.equal((x.match(/<entry>/g) || []).length, 1)
  // chaque entrée porte les trois éléments que la RFC 4287 exige
  for (const balise of ['id', 'title', 'updated']) assert.match(x, new RegExp(`<entry>[\\s\\S]*<${balise}>[\\s\\S]*</entry>`))
})

/* ── Plages, séries, dossiers, .nvmrc : les angles morts du 23/09/2026 ──── */

test('satisfait lit les plages que le socle impose à ses pairs', () => {
  const cas = [
    ['6.0.3', '~6.0.3', true],
    ['6.1.0', '~6.0.3', false],
    ['10.75.3', '^10.75.2', true],
    ['11.0.0', '^10.75.2', false],
    ['10.2.0', '^9.39.4 || ^10.0.0', true],
    ['8.9.0', '^9.39.4 || ^10.0.0', false],
    ['12.3.0', '>=9.0.0', true],
    ['1.5.0', '>=1.2.0 <2.0.0', true],
    ['2.0.0', '>=1.2.0 <2.0.0', false],
    ['1.9.9', '1.x', true],
    ['3.0.0', '*', true],
    ['1.2.9', '~1.2', true],
    ['1.3.0', '~1.2', false],
    ['1.2.3', '> 1.2.2', true],
    ['1.3.0', '<= 1.2', false],
  ]
  for (const [v, plage, attendu] of cas) assert.equal(satisfait(v, plage), attendu, `${v} dans ${plage}`)
})

test('satisfait : en 0.x, le caret s’arrête à la mineure, et en 0.0.z au correctif', () => {
  assert.equal(satisfait('0.32.9', '^0.32.1'), true)
  assert.equal(satisfait('0.33.0', '^0.32.1'), false)
  assert.equal(satisfait('0.0.4', '^0.0.3'), false)
  assert.equal(satisfait('0.9.0', '^0.x'), true)
  assert.equal(satisfait('1.0.0', '^0.x'), false)
})

test('satisfait ne conclut rien de ce qu’il ne sait pas lire, ni d’une préversion', () => {
  // Une plage à tiret n'est pas lue : l'alternative ne prouve rien.
  assert.equal(satisfait('1.5.0', '1.2.3 - 2.0.0'), false)
  assert.equal(satisfait('1.5.0', '1.2.3 - 2.0.0 || ^1.0.0'), true)
  assert.equal(satisfait('2.0.0-beta.1', '^2.0.0'), false)
})

test('derniereDeSerie : la plus haute STABLE de la série — @sentry/react 10 sous une 11', () => {
  const publiees = ['10.75.1', '10.75.2', '10.75.3', '10.76.0-beta.1', '11.0.0', '9.40.0']
  assert.equal(derniereDeSerie(publiees, '10', { latest: '11.0.0' }), '10.75.3')
  assert.equal(derniereDeSerie(publiees, '9', { latest: '11.0.0' }), '9.40.0')
  assert.equal(derniereDeSerie(publiees, '12', { latest: '11.0.0' }), null)
})

test('derniereDeSerie ne dépasse pas `latest` quand il est dans la série — electron-builder et son étiquette v26', () => {
  // 26.15.4 à 26.16.1 publiées sous `v26`, `latest` resté en 26.15.3 :
  // Renovate ne propose rien au-delà, le relevé non plus.
  const publiees = ['26.15.2', '26.15.3', '26.15.4', '26.16.1']
  assert.equal(derniereDeSerie(publiees, '26', { latest: '26.15.3' }), '26.15.3')
  // Hors de la série de `latest`, rien ne plafonne.
  assert.equal(derniereDeSerie(publiees, '26', { latest: '27.0.0' }), '26.16.1')
})

test('derniereDeSerie respecte la plage de pair du socle — une 6.1 ne se conseille pas sous ~6.0.3', () => {
  const publiees = ['6.0.2', '6.0.3', '6.0.4', '6.1.0']
  assert.equal(derniereDeSerie(publiees, '6', { plage: '~6.0.3' }), '6.0.4')
  assert.equal(derniereDeSerie(publiees, '6'), '6.1.0')
})

test('derniereDeSerie : en 0.x, la série est la mineure', () => {
  const publiees = ['0.32.0', '0.32.1', '0.33.0', '0.40.2']
  assert.equal(derniereDeSerie(publiees, '0.32', { latest: '0.40.2' }), '0.32.1')
  assert.equal(derniereDeSerie(publiees, '0.40', { latest: '0.40.2' }), '0.40.2')
})

test('plafondEngines : @types/vscode plafonné par la mineure de engines.vscode', () => {
  const publiees = ['1.89.0', '1.90.0', '1.91.0', '1.125.0', '1.138.0']
  assert.equal(plafondEngines('@types/vscode', { engines: { vscode: '^1.90.0' } }, publiees), '1.90.0')
  // Pas de 1.90 publiée : la plus haute des mineures inférieures.
  assert.equal(plafondEngines('@types/vscode', { engines: { vscode: '^1.90.0' } }, ['1.88.0', '1.89.2', '1.91.0']), '1.89.2')
  // Sans moteur déclaré, ou pour un paquet qui ne suit aucun moteur : pas de plafond.
  assert.equal(plafondEngines('@types/vscode', {}, publiees), null)
  assert.equal(plafondEngines('@types/node', { engines: { node: '>=22' } }, ['22.0.0']), null)
})

test('unitesDeLArbre : un dossier à lockfile PROPRE est une unité ; sans lock ni espace de travail, rien', () => {
  const chemins = [
    'package.json',
    'package-lock.json',
    'worker/package.json',
    'worker/package-lock.json',
    // miss-supaboss/proxy : rien ne fige ses versions, elles se résolvent à
    // chaque installation — les attribuer au lock racine les inventerait
    'proxy/package.json',
    'apps/desktop/package.json',
    'apps/desktop/package-lock.json',
    'apps/desktop/e2e-native/package.json',
  ]
  assert.deepEqual(unitesDeLArbre(chemins), [
    { dossier: 'apps/desktop', lock: 'propre' },
    { dossier: 'worker', lock: 'propre' },
  ])
})

test('unitesDeLArbre : un espace de travail de la racine est figé par le lock racine', () => {
  const chemins = ['package.json', 'package-lock.json', 'packages/a/package.json', 'packages/b/package.json', 'outils/package.json']
  assert.deepEqual(unitesDeLArbre(chemins, espacesDeTravail({ workspaces: ['packages/*'] })), [
    { dossier: 'packages/a', lock: 'racine' },
    { dossier: 'packages/b', lock: 'racine' },
  ])
  assert.deepEqual(espacesDeTravail({ workspaces: { packages: ['apps/**', '!apps/vieux'] } }), ['apps/**'])
  assert.deepEqual(espacesDeTravail({}), [])
})

test('unitesDeLArbre écarte ce qui ne tourne pas : node_modules, jeux d’essai, gabarits, dossiers cachés', () => {
  const avecLock = (d) => [`${d}/package.json`, `${d}/package-lock.json`]
  const chemins = [
    ...avecLock('node_modules/x'),
    ...avecLock('test/fixtures/app'),
    ...avecLock('templates/base'),
    ...avecLock('examples/demo'),
    ...avecLock('.github/actions/outil'),
    ...avecLock('e2e'),
  ]
  assert.deepEqual(unitesDeLArbre(chemins), [{ dossier: 'e2e', lock: 'propre' }])
})

test('verrouilleesDe : le premier niveau du lock, et l’espace de travail l’emporte sur le hissé', () => {
  const lock = {
    packages: {
      '': { name: 'racine' },
      'node_modules/a': { version: '1.0.0' },
      'node_modules/a/node_modules/b': { version: '2.0.0' },
      'node_modules/lien': { resolved: 'packages/x', link: true },
      'packages/x/node_modules/a': { version: '1.1.0' },
    },
  }
  assert.deepEqual(verrouilleesDe(lock), { a: '1.0.0' })
  assert.deepEqual(verrouilleesDe(lock, 'packages/x'), { a: '1.1.0' })
  assert.deepEqual(verrouilleesDe(null), {})
})

test('versionNvmrc : seule une version COMPLÈTE est comparable', () => {
  assert.equal(versionNvmrc('26.9.0\n'), '26.9.0')
  assert.equal(versionNvmrc('v26.10.0\r\n'), '26.10.0')
  // `26` suit la dernière 26.x d'elle-même, `lts/*` la dernière LTS : ni l'une
  // ni l'autre n'est en retard sur quoi que ce soit.
  assert.equal(versionNvmrc('26'), null)
  assert.equal(versionNvmrc('lts/*'), null)
  assert.equal(versionNvmrc(null), null)
})
