// L'usage du socle, mesuré dans le code de chaque consommateur.
//
// POURQUOI CES TESTS-LÀ. La mesure se trompe EN SILENCE dans les deux sens :
// un import manqué fait passer un module pour orphelin, et on le retirerait du
// socle ; un import compté à tort fait croire une adoption qui n'existe pas.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  categorieModule,
  CATEGORIES,
  estReutilisable,
  fichiersAScanner,
  importsDuSocle,
  moduleDe,
  offreDuSocle,
  outilsDuSocle,
  usageDepuisFichiers,
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
`
  assert.deepEqual(workflowsDuSocle(ci), ['pwa-ci.yml', 'pwa-lighthouse.yml'])
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

test('l’usage d’un dépôt : modules, outils, workflows, et les imports orphelins', () => {
  const offre = {
    modules: ['react/card', 'csv', 'components.css', 'components/*.css'],
    outils: ['pwa-doctor', 'pwa-icons'],
  }
  const u = usageDepuisFichiers(
    [
      { chemin: 'src/A.tsx', texte: "import { Card } from '@mister-guiiug/dev-pwa-config/react/card'" },
      { chemin: 'src/index.css', texte: "@import '@mister-guiiug/dev-pwa-config/components/sheet.css';" },
      { chemin: 'src/B.ts', texte: "import x from '@mister-guiiug/dev-pwa-config/ancien-module'" },
      { chemin: 'src/illisible.ts', texte: null },
      { chemin: 'package.json', texte: JSON.stringify({ scripts: { build: 'vite build && pwa-doctor --strict' } }) },
      { chemin: '.github/workflows/ci.yml', texte: 'uses: mister-guiiug/dev-pwa-config/.github/workflows/pwa-ci.yml@v6' },
    ],
    offre,
  )
  assert.deepEqual(u, {
    modules: ['components/*.css', 'react/card'],
    outils: ['pwa-doctor'],
    workflows: ['pwa-ci.yml'],
    inconnus: ['ancien-module'],
  })
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
