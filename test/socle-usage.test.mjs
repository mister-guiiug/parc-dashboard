// L'usage du socle, mesuré dans le code de chaque consommateur.
//
// POURQUOI CES TESTS-LÀ. La mesure se trompe EN SILENCE dans les deux sens :
// un import manqué fait passer un module pour orphelin, et on le retirerait du
// socle ; un import compté à tort fait croire une adoption qui n'existe pas.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  appelsDuSocle,
  brutsDepuisFichiers,
  categorieModule,
  CATEGORIES,
  cibleExport,
  estReutilisable,
  fichiersAScanner,
  fichiersDuSocle,
  grapheDuSocle,
  importesDe,
  importsDuSocle,
  moduleDe,
  offreDuSocle,
  outilsDuReutilisable,
  outilsDuSocle,
  outilsParLaCi,
  rattache,
  usageReprenable,
  VERSION_MESURE,
  workflowsDuSocle,
} from '../scripts/socle-usage.mjs'

test('les fichiers scannés : le code et les workflows, pas les sorties ni les données', () => {
  const arbre = [
    'src/App.tsx',
    'src/index.css',
    'src/features/a/A.test.tsx',
    'e2e/smoke.spec.ts',
    'vite.config.ts',
    'tsconfig.app.json',
    'package.json',
    'index.html',
    'package-lock.json',
    'e2e/package-lock.json',
    '.github/workflows/ci.yml',
    '.github/dependabot.yml',
    'node_modules/x/index.js',
    'dist/assets/index.js',
    'public/manifest.json',
    'supabase/functions/f/index.ts',
    'docs/adr/0001.md',
    'README.md',
    'public/icons/icon-512.png',
  ]
  assert.deepEqual(fichiersAScanner(arbre), [
    'src/App.tsx',
    'src/index.css',
    'src/features/a/A.test.tsx',
    'e2e/smoke.spec.ts',
    'vite.config.ts',
    'tsconfig.app.json',
    'package.json',
    'index.html',
    '.github/workflows/ci.yml',
  ])
})

test('toutes les formes d’import sont lues : from, import(), @import, extends, resolve', () => {
  const texte = `
    import { Card } from '@mister-guiiug/dev-pwa-config/react/card'
    const x = await import("@mister-guiiug/dev-pwa-config/csv")
    @import '@mister-guiiug/dev-pwa-config/components.css';
    { "extends": "@mister-guiiug/dev-pwa-config/tsconfig-app-react" }
    import.meta.resolve('@mister-guiiug/dev-pwa-config/testing/pwa-register')
    import '@mister-guiiug/dev-pwa-config/vitest-setup'
    // et une seconde fois, comptée une seule
    import { Button } from '@mister-guiiug/dev-pwa-config/react/card'
  `
  assert.deepEqual(importsDuSocle(texte).sort(), [
    'components.css',
    'csv',
    'react/card',
    'testing/pwa-register',
    'tsconfig-app-react',
    'vitest-setup',
  ])
  assert.deepEqual(importsDuSocle('import x from "@mister-guiiug/autre/react/card"'), [])
})

test('une simple mention n’est pas un usage : commentaire, découpage, verrou', () => {
  // Les trois faux positifs du premier relevé réel (06/10/2026).
  const texte = `
    // Le socle livre \`@mister-guiiug/dev-pwa-config/react/sheet\` depuis 6.2.0.
    if (norm.includes('/@mister-guiiug/dev-pwa-config/themes.js')) return 'themes'
    "resolved": "https://npm.pkg.github.com/download/@mister-guiiug/dev-pwa-config/6.25.0/fb24414"
  `
  assert.deepEqual(importsDuSocle(texte), [])
})

test('un sous-chemin se rattache à son export, y compris par motif', () => {
  const cles = ['react/card', 'components.css', 'components/*.css']
  assert.equal(moduleDe('react/card', cles), 'react/card')
  assert.equal(moduleDe('components/sheet.css', cles), 'components/*.css')
  assert.equal(moduleDe('components/.css', cles), null, 'le motif exige au moins un caractère')
  assert.equal(moduleDe('react/carte', cles), null, 'un export disparu n’est rattaché à rien')
})

test('les outils se reconnaissent en mot entier dans les scripts', () => {
  const scripts = {
    build: 'tsc -b && vite build && pwa-bundle-budget && pwa-doctor --strict',
    icons: 'pwa-icons --source public/favicon.svg',
    autre: 'node scripts/pwa-doctor-maison.mjs',
  }
  assert.deepEqual(outilsDuSocle(scripts, ['pwa-bundle-budget', 'pwa-doctor', 'pwa-icons', 'pwa-screenshots']), [
    'pwa-bundle-budget',
    'pwa-doctor',
    'pwa-icons',
  ])
  assert.deepEqual(outilsDuSocle(undefined, ['pwa-doctor']), [])
})

test('les workflows réutilisables appelés, et ceux qui le sont', () => {
  const ci = `
jobs:
  ci:
    uses: mister-guiiug/dev-pwa-config/.github/workflows/pwa-ci.yml@v6
  lh:
    uses: 'mister-guiiug/dev-pwa-config/.github/workflows/pwa-lighthouse.yml@v6'
  autre:
    uses: actions/checkout@v7
  ancien:
    # uses: mister-guiiug/dev-pwa-config/.github/workflows/pwa-deploy.yml@v6
    run: echo "uses: mister-guiiug/dev-pwa-config/.github/workflows/pwa-vice.yml@v6"
`
  // Un appel commenté, ou cité dans une commande, n'appelle rien : même
  // lecture que `appelsDuSocle`, pour que les deux canaux ne se contredisent pas.
  assert.deepEqual(workflowsDuSocle(ci), ['pwa-ci.yml', 'pwa-lighthouse.yml'])
  assert.deepEqual(
    appelsDuSocle(ci).map((a) => a.workflow),
    ['pwa-ci.yml', 'pwa-lighthouse.yml'],
  )
  assert.equal(estReutilisable('on:\n  workflow_call:\n    inputs: {}'), true)
  assert.equal(estReutilisable('on: [push, workflow_call]'), true)
  assert.equal(estReutilisable('on:\n  push:\n    branches: [main]'), false)
})

test('les familles de modules', () => {
  const attendu = {
    'eslint-react': 'outillage',
    'tsconfig-app-react': 'outillage',
    'testing/pwa-register': 'outillage',
    'components.css': 'outillage',
    'components/*.css': 'outillage',
    'vite-pwa': 'vite',
    'react/labels-fr': 'libelles',
    'react/use-online': 'crochet',
    'react/card': 'composant',
    react: 'composant',
    format: 'bibliotheque',
    'auth/supabase': 'bibliotheque',
  }
  for (const [cle, cat] of Object.entries(attendu)) assert.equal(categorieModule(cle), cat, cle)
  for (const cat of Object.values(attendu)) assert.ok(CATEGORIES.includes(cat), cat)
})

test('l’usage d’un dépôt : direct, par la CI, indirect, et les imports orphelins', () => {
  const ciYml = [
    'jobs:',
    '  ci:',
    '    uses: mister-guiiug/dev-pwa-config/.github/workflows/pwa-ci.yml@v6',
    '    with:',
    '      run-doctor: true # la checklist',
    '      server-dir: server',
  ].join('\n')
  const bruts = brutsDepuisFichiers([
    { chemin: 'src/A.tsx', texte: "import { Card } from '@mister-guiiug/dev-pwa-config/react/card'" },
    { chemin: 'src/index.css', texte: "@import '@mister-guiiug/dev-pwa-config/components/sheet.css';" },
    { chemin: 'src/B.ts', texte: "import x from '@mister-guiiug/dev-pwa-config/ancien-module'" },
    { chemin: 'src/illisible.ts', texte: null },
    { chemin: '.github/workflows/ci.yml', texte: ciYml },
  ])
  assert.deepEqual(bruts, {
    importes: ['ancien-module', 'components/sheet.css', 'react/card'],
    workflows: ['pwa-ci.yml'],
    appels: [{ workflow: 'pwa-ci.yml', avec: { 'run-doctor': 'true', 'server-dir': 'server' } }],
  })
  const offre = {
    modules: ['react/card', 'react/labels', 'csv', 'apps-catalog', 'components.css', 'components/*.css'],
    outils: ['pwa-doctor', 'pwa-icons'],
    ci: { 'pwa-ci.yml': { defauts: { 'run-doctor': 'false' }, outils: [{ outil: 'pwa-doctor', si: [{ input: 'run-doctor', vrai: true }] }] } },
    graphe: { modules: { 'react/card': ['react/labels', 'react/card'] } },
  }
  assert.deepEqual(rattache(bruts, offre, { build: 'vite build && pwa-icons' }), {
    modules: ['components/*.css', 'react/card'],
    inconnus: ['ancien-module'],
    viaMotif: ['components/sheet.css'],
    outils: ['pwa-icons'],
    outilsCi: ['pwa-doctor'],
  })
})

test('les options d’un appel au réutilisable, ligne à ligne', () => {
  const texte = [
    'jobs:',
    '  ci:',
    '    uses: mister-guiiug/dev-pwa-config/.github/workflows/pwa-ci.yml@v6',
    '    # un commentaire entre les clés',
    '    with:',
    "      run-doctor: 'true'",
    '      e2e-grep: "@critical|@a11y"',
    '        sous-niveau: ignore',
    '    secrets:',
    '      SENTRY: x',
    '  deploy:',
    '    uses: mister-guiiug/dev-pwa-config/.github/workflows/pwa-deploy.yml@v6',
    '  autre:',
    '    uses: actions/checkout@v7',
  ].join('\n')
  assert.deepEqual(appelsDuSocle(texte), [
    { workflow: 'pwa-ci.yml', avec: { 'run-doctor': 'true', 'e2e-grep': '@critical|@a11y' } },
    { workflow: 'pwa-deploy.yml', avec: {} },
  ])
})

test('ce qu’un réutilisable lance, et sous quelles options', () => {
  const texte = [
    'on:',
    '  workflow_call:',
    '    inputs:',
    '      run-doctor:',
    '        type: boolean',
    '        default: false',
    '      run-icons:',
    '        default: true',
    'jobs:',
    '  ci:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - uses: actions/checkout@v7',
    '      - name: Docteur',
    '        if: ${{ inputs.run-doctor }}',
    '        run: |',
    '          # pwa-env est cité dans un commentaire : il ne compte pas',
    '          npx pwa-doctor --strict',
    '      - if: ${{ !inputs.run-icons }}',
    '        run: npx pwa-icons',
    '  e2e:',
    '    if: ${{ inputs.run-e2e }}',
    '    steps:',
    '      - run: npx pwa-screenshots',
  ].join('\n')
  const outils = ['pwa-doctor', 'pwa-icons', 'pwa-env', 'pwa-screenshots']
  const analyse = outilsDuReutilisable(texte, outils)
  assert.deepEqual(analyse, {
    defauts: { 'run-doctor': 'false', 'run-icons': 'true' },
    outils: [
      { outil: 'pwa-doctor', si: [{ input: 'run-doctor', vrai: true }] },
      { outil: 'pwa-icons', si: [{ input: 'run-icons', vrai: false }] },
      { outil: 'pwa-screenshots', si: [{ input: 'run-e2e', vrai: true }] },
    ],
  })
  const ci = { 'pwa-ci.yml': analyse }
  // Le défaut décide quand l'app ne dit rien ; ce qu'elle passe l'emporte.
  assert.deepEqual(outilsParLaCi([{ workflow: 'pwa-ci.yml', avec: {} }], ci), [])
  assert.deepEqual(outilsParLaCi([{ workflow: 'pwa-ci.yml', avec: { 'run-doctor': 'true', 'run-icons': 'false', 'run-e2e': 'true' } }], ci), [
    'pwa-doctor',
    'pwa-icons',
    'pwa-screenshots',
  ])
  assert.deepEqual(outilsParLaCi([{ workflow: 'autre.yml', avec: { 'run-doctor': 'true' } }], ci), [])
})

test('un outil n’est lancé que sous la condition de son étape, quel que soit l’ordre des clés', () => {
  const texte = [
    'on:',
    '  workflow_call:',
    '    inputs:',
    '      run-doctor:',
    '        description: Lance pwa-doctor après le build',
    '        default: false',
    'jobs:',
    '  ci:',
    '    steps:',
    '      - name: Lance pwa-doctor',
    '        if: ${{ inputs.run-doctor }}',
    '        run: npx pwa-doctor # pwa-icons est cité en commentaire',
    '      - uses: actions/upload-artifact@v7',
    '        with:',
    '          name: pwa-icons',
    '          path: dist',
  ].join('\n')
  const analyse = outilsDuReutilisable(texte, ['pwa-doctor', 'pwa-icons'])
  // Le `name:` venait avant le `if:` : l'outil était noté sans condition, donc
  // lancé pour tous les appelants. Ni la description de l'option, ni le nom
  // d'un artefact, ni un commentaire ne lancent quoi que ce soit.
  assert.deepEqual(analyse.outils, [{ outil: 'pwa-doctor', si: [{ input: 'run-doctor', vrai: true }] }])
  assert.deepEqual(outilsParLaCi([{ workflow: 'pwa-ci.yml', avec: {} }], { 'pwa-ci.yml': analyse }), [])
})

test('le graphe interne du socle : fermeture transitive, motifs, auto-références', () => {
  const pkg = {
    exports: {
      './react/i18n': { types: './react/i18n.d.ts', import: './react/i18n.js' },
      './react/labels-fr': './react/labels-fr.js',
      './eslint-react': './eslint-react.js',
      './eslint-base': './eslint-base.js',
      './components.css': './components.css',
      './components/*.css': './components/*.css',
      './csv': './csv.js',
      './tsconfig-app-react': './tsconfig-app-react.json',
      './tsconfig-app': './tsconfig-app.json',
    },
    bin: { 'pwa-doctor': './scripts/pwa-doctor.mjs' },
  }
  const fichiers = [
    // i18n passe par un intermédiaire qui n'est pas un export
    { chemin: 'react/i18n.js', texte: "import { charge } from './interne/charge.js'" },
    { chemin: 'react/interne/charge.js', texte: "const fr = () => import('../labels-fr.js')" },
    { chemin: 'react/labels-fr.js', texte: 'export default {}' },
    { chemin: 'eslint-react.js', texte: "import base from './eslint-base.js'" },
    { chemin: 'eslint-base.js', texte: '' },
    { chemin: 'components.css', texte: "@import './components/sheet.css';\n@import './components/toast.css';" },
    { chemin: 'components/sheet.css', texte: '' },
    { chemin: 'components/toast.css', texte: '' },
    { chemin: 'csv.js', texte: "// cite './inexistant.js' : rien\nimport x from '@mister-guiiug/dev-pwa-config/eslint-base'" },
    { chemin: 'tsconfig-app-react.json', texte: '{ "extends": "./tsconfig-app.json" }' },
    { chemin: 'tsconfig-app.json', texte: '{}' },
    { chemin: 'scripts/pwa-doctor.mjs', texte: "import { lis } from '../csv.js'" },
  ]
  assert.deepEqual(grapheDuSocle(pkg, fichiers), {
    modules: {
      'react/i18n': ['react/labels-fr'],
      'eslint-react': ['eslint-base'],
      'components.css': ['components/*.css'],
      csv: ['eslint-base'],
      'tsconfig-app-react': ['tsconfig-app'],
    },
  })
  // Un fichier illisible retire ses arêtes : le graphe le dit, pour ne pas
  // être gardé en cache jusqu'au prochain commit du socle.
  const ampute = grapheDuSocle(
    pkg,
    fichiers.map((f) => (f.chemin === 'eslint-react.js' ? { ...f, texte: null } : f)),
  )
  assert.equal(ampute.incomplet, true)
  assert.equal(ampute.modules['eslint-react'], undefined)
  assert.equal('incomplet' in grapheDuSocle(pkg, fichiers), false)
})

test('les fichiers lus pour le graphe du socle, et la cible d’un export', () => {
  assert.deepEqual(
    fichiersDuSocle(['react/card.js', 'react/card.d.ts', 'components/x.css', 'test/a.test.mjs', 'showroom/app.js', 'package.json', 'package-lock.json', 'README.md']),
    ['react/card.js', 'components/x.css', 'package.json'],
  )
  assert.equal(cibleExport('./csv.js'), 'csv.js')
  assert.equal(cibleExport({ types: './x.d.ts', import: './x.js' }), 'x.js')
  assert.equal(cibleExport({ node: { import: './n.js' } }), 'n.js')
  assert.equal(cibleExport(null), null)
})

test('ce que le socle offre : ses exports sans « ./ », ses outils, ses workflows', () => {
  const pkg = {
    version: '6.24.0',
    exports: { './react/card': {}, './csv': {}, './package.json': './package.json' },
    bin: { 'pwa-doctor': 'x', 'pwa-icons': 'y' },
  }
  assert.deepEqual(offreDuSocle(pkg, ['pwa-deploy.yml', 'pwa-ci.yml']), {
    version: '6.24.0',
    modules: ['csv', 'react/card'],
    categories: { csv: 'bibliotheque', 'react/card': 'composant' },
    outils: ['pwa-doctor', 'pwa-icons'],
    workflows: ['pwa-ci.yml', 'pwa-deploy.yml'],
  })
  assert.deepEqual(offreDuSocle(null), { version: null, modules: [], categories: {}, outils: [], workflows: [] })
})

test('le cache de la mesure : même tête ET même version de mesure, sinon on relit', () => {
  const connu = { usageSocle: { v: VERSION_MESURE, importes: ['react/card'] } }
  assert.equal(usageReprenable(connu, true), true)
  assert.equal(usageReprenable(connu, false), false, 'la tête a bougé')
  // Une mesure d'avant la correction : reprise, elle garderait ses faux imports.
  assert.equal(usageReprenable({ usageSocle: { v: VERSION_MESURE - 1, importes: [] } }, true), false)
  assert.equal(usageReprenable({ usageSocle: { importes: [] } }, true), false, 'sans version')
  assert.equal(usageReprenable(undefined, true), false)
})

test('les imports bruts se reconstituent depuis une mesure publiée', () => {
  // Publiés, ils doublaient `modules` : la page ne garde que modules et inconnus.
  assert.deepEqual(importesDe({ modules: ['react/card', 'components/*.css'], inconnus: ['ancien'] }), ['ancien', 'components/*.css', 'react/card'])
  assert.deepEqual(importesDe({ importes: ['x'] }), ['x'])
  // Et le rattachement redonne la même chose : un export se rattache à lui-même.
  const offre = { modules: ['react/card', 'components/*.css'], outils: [] }
  assert.deepEqual(rattache({ importes: importesDe({ modules: ['react/card', 'components/*.css'], inconnus: ['ancien'] }) }, offre).modules, ['components/*.css', 'react/card'])
  assert.equal(usageReprenable({ usageSocle: { v: VERSION_MESURE, modules: [] } }, true), true, 'une mesure publiée, sans importes, se reprend')
})

test('un import servi par un motif se reconstitue tel quel, pas comme le motif', () => {
  const bruts = { importes: ['components/sheet.css', 'react/card'] }
  const publie = rattache(bruts, { modules: ['react/card', 'components/*.css'], outils: [] })
  assert.deepEqual(publie.viaMotif, ['components/sheet.css'])
  assert.deepEqual(importesDe(publie), ['components/sheet.css', 'react/card'])
  // Le socle remplace le motif par des exports exacts : l'import suit, au lieu
  // de passer pour inconnu — « un import qui casserait » — sans relire le dépôt.
  const apres = rattache({ importes: importesDe(publie) }, { modules: ['react/card', 'components/sheet.css'], outils: [] })
  assert.deepEqual(apres.modules, ['components/sheet.css', 'react/card'])
  assert.deepEqual(apres.inconnus, [])
})
