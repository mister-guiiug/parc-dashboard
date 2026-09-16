/**
 * Les règles de la vue — celles qui décidaient de l'affichage sans qu'aucun
 * test puisse les atteindre.
 *
 * Elles vivaient en JavaScript dans `gabarit.html`. Le 16/09/2026, la colonne
 * « Écarts » affichait un compte pendant que son tri ordonnait sur une somme
 * pondérée : quatre inversions visibles sur la page publiée, et rien pour les
 * voir. Ce fichier est la contrepartie de l'extraction.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  POIDS,
  compteEcarts,
  graviteEcarts,
  parChamp,
  parNombreEcarts,
  parTexte,
  parVersion,
  rangEcart,
  GROUPES,
  PERIODES,
  etiquettes,
  groupeDe,
  periodeDe,
  symboles,
} from '../scripts/vue.mjs'
import { cmpVersion } from '../scripts/regles.mjs'

test('rangEcart nomme le RANG, pas la distance', () => {
  // Passer de 4.2 à 4.3 n'a rien de commun avec passer de 3 à 4 : c'est ce que
  // la couleur sépare, et ce que le poids facture différemment.
  assert.equal(rangEcart('3.0.0', '4.0.0'), 'majeure')
  assert.equal(rangEcart('4.2.0', '4.3.0'), 'mineure')
  assert.equal(rangEcart('4.3.1', '4.3.9'), 'patch')
  assert.equal(rangEcart('4.3.9', '4.3.9'), '0')
})

test('rangEcart : une version EN AVANCE du parc n’est pas un écart', () => {
  // Un dépôt peut tenir mieux que la plus récente connue au moment du relevé.
  // La couleur ne doit pas l'en punir.
  assert.equal(rangEcart('5.0.0', '4.9.9'), '0')
})

test('rangEcart : pas de version, pas d’écart — c’est une absence', () => {
  // Un dépôt qui ne dépend pas du paquet n'est ni en avance ni en retard.
  assert.equal(rangEcart(null, '4.0.0'), 'absent')
  assert.equal(rangEcart('', '4.0.0'), 'absent')
  // Et sans référence, il n'y a rien à quoi comparer.
  assert.equal(rangEcart('1.0.0', null), '0')
})

test('rangEcart lit une PLAGE comme la version qu’elle nomme', () => {
  // LA DIVERGENCE QUE L'EXTRACTION A REFERMÉE. Le gabarit portait son propre
  // comparateur, sans nettoyage : `Number('^4')` rend `NaN`, ramené à 0, donc
  // `^4.15.1` passait pour une version majeure 0 — plus ancienne que tout.
  // Aucune donnée actuelle ne déclenche le cas (les 94 versions de la page
  // viennent des lockfiles, toutes exactes), mais il n'y a plus qu'un seul
  // comparateur, et c'est celui que douze tests éprouvent déjà.
  assert.equal(rangEcart('^4.15.1', '4.15.1'), '0')
  assert.equal(rangEcart('~1.2.3', '1.2.3'), '0')
  // Une préversion se compare sur sa version.
  assert.equal(rangEcart('2.0.0-rc.1', '2.0.0'), '0')
})

test('le compte et la gravité ne mesurent pas la même chose', () => {
  const cellules = [
    { rang: 'majeure' },
    { rang: 'majeure' },
    { rang: '0' },
    { rang: 'absent' },
  ]
  assert.equal(compteEcarts(cellules), 2)
  assert.equal(graviteEcarts(cellules), 6)

  const patchs = [1, 2, 3, 4, 5].map(() => ({ rang: 'patch' }))
  assert.equal(compteEcarts(patchs), 5)
  assert.equal(graviteEcarts(patchs), 5)

  // LE CŒUR DU DÉFAUT DU 16/09/2026 : deux majeures pèsent PLUS que cinq
  // patchs, mais s'affichent « 2 » contre « 5 ».
  assert.ok(graviteEcarts(cellules) > graviteEcarts(patchs))
  assert.ok(compteEcarts(cellules) < compteEcarts(patchs))
})

test('ni « à jour » ni « absent » ne pèsent quoi que ce soit', () => {
  assert.equal(POIDS['0'], 0)
  assert.equal(POIDS.absent, 0)
})

test('parNombreEcarts classe sur ce que la colonne AFFICHE', () => {
  // Le tri ordonnait sur la gravité pendant que la colonne montrait le compte :
  // 9, 9, 8, 7, 8, 6, 7… à l'écran. Le compte passe devant.
  const deuxMajeures = { depot: 'a', nb: 2, score: 6 }
  const cinqPatchs = { depot: 'b', nb: 5, score: 5 }
  assert.ok(parNombreEcarts(deuxMajeures, cinqPatchs) > 0, 'cinq écarts avant deux')

  // À compte égal, la GRAVITÉ départage — le poids n'est pas perdu.
  const grave = { depot: 'c', nb: 3, score: 9 }
  const legere = { depot: 'd', nb: 3, score: 3 }
  assert.ok(parNombreEcarts(grave, legere) < 0)

  // Et à égalité complète, le nom : un ordre stable d'un relevé à l'autre.
  assert.ok(parNombreEcarts({ depot: 'a', nb: 1, score: 1 }, { depot: 'b', nb: 1, score: 1 }) < 0)
})

test('parVersion : un dépôt SANS le paquet va au bout dans les deux sens', () => {
  // L'inverse ferait ouvrir le tri croissant sur une colonne de « · ».
  const rang = (d) => ({ a: 0, b: 1, sans: 2 })[d]
  const lignes = [
    { depot: 'a', cellules: [{ version: '1.0.0' }] },
    { depot: 'b', cellules: [{ version: '2.0.0' }] },
    { depot: 'sans', cellules: [{ version: null }] },
  ]

  const decroissant = [...lignes].sort(parVersion(0, -1, rang)).map((l) => l.depot)
  assert.deepEqual(decroissant, ['b', 'a', 'sans'])

  const croissant = [...lignes].sort(parVersion(0, 1, rang)).map((l) => l.depot)
  assert.deepEqual(croissant, ['a', 'b', 'sans'], 'le dépôt sans version reste en bas')
})

test('parVersion compare sémantiquement, pas textuellement', () => {
  // Le piège de la comparaison de chaînes : '1.10.0' < '1.9.0'.
  const rang = (d) => ({ neuf: 0, dix: 1 })[d]
  const lignes = [
    { depot: 'neuf', cellules: [{ version: '1.9.0' }] },
    { depot: 'dix', cellules: [{ version: '1.10.0' }] },
  ]
  assert.deepEqual([...lignes].sort(parVersion(0, -1, rang)).map((l) => l.depot), ['dix', 'neuf'])
})

test('parVersion : à versions égales, l’ordre d’avant est CONSERVÉ', () => {
  // Le tri par colonne passe devant celui de la liste déroulante, qui reste le
  // départage : deux dépôts sur la même version gardent l'ordre choisi.
  const rang = (d) => ({ premier: 0, second: 1 })[d]
  const lignes = [
    { depot: 'second', cellules: [{ version: '4.0.0' }] },
    { depot: 'premier', cellules: [{ version: '4.0.0' }] },
  ]
  assert.deepEqual([...lignes].sort(parVersion(0, -1, rang)).map((l) => l.depot), ['premier', 'second'])
})

test('parChamp met les valeurs ABSENTES en bas, dans les deux sens', () => {
  // Comme un dépôt qui ne dépend pas d'un paquet : une version amont manquante
  // n'est ni la plus grande ni la plus petite. Sans ça, le tri croissant
  // d'« Amont » ouvrirait sur une colonne de tirets.
  const lignes = [
    { p: 'a', amont: '2.0.0' },
    { p: 'sans', amont: null },
    { p: 'b', amont: '10.0.0' },
    { p: 'vide', amont: '' },
  ]
  const noms = (sens) => [...lignes].sort(parChamp((l) => l.amont, sens, cmpVersion)).map((l) => l.p)
  assert.deepEqual(noms(-1), ['b', 'a', 'sans', 'vide'])
  assert.deepEqual(noms(1), ['a', 'b', 'sans', 'vide'])
})

test('parChamp ordonne les nombres en nombres, pas en chaînes', () => {
  const lignes = [{ n: 9 }, { n: 10 }, { n: 2 }]
  assert.deepEqual([...lignes].sort(parChamp((l) => l.n, -1)).map((l) => l.n), [10, 9, 2])
  assert.deepEqual([...lignes].sort(parChamp((l) => l.n, 1)).map((l) => l.n), [2, 9, 10])
})

test('parChamp : zéro n’est pas une absence', () => {
  // `enRetard: 0` veut dire « à jour », pas « on ne sait pas » — que `null`
  // exprime. Les confondre enverrait les paquets à jour en bas de liste.
  const lignes = [{ n: 0 }, { n: null }, { n: 3 }]
  assert.deepEqual([...lignes].sort(parChamp((l) => l.n, 1)).map((l) => l.n), [0, 3, null])
})

test('parTexte ignore la casse et les accents', () => {
  const noms = ['Zod', 'éslint', 'axe']
  assert.deepEqual([...noms].sort(parTexte), ['axe', 'éslint', 'Zod'])
})

/* ── La table des éléments ──────────────────────────────────────────────── */

test('groupeDe : l’ordre des motifs décide, et il n’est pas alphabétique', () => {
  // `@testing-library/react` est un test AVANT d'être du React, et
  // `@sentry/vite-plugin` de l'observabilité avant d'être un plugin Vite.
  assert.equal(groupeDe('@testing-library/react'), 'test')
  assert.equal(groupeDe('@sentry/vite-plugin'), 'obs')
  assert.equal(groupeDe('vite-plugin-pwa'), 'build')
  assert.equal(groupeDe('react'), 'ui')
  assert.equal(groupeDe('typescript'), 'lang')
  assert.equal(groupeDe('@types/react'), 'lang')
  assert.equal(groupeDe('eslint-plugin-react-hooks'), 'qual')
  assert.equal(groupeDe('@mister-guiiug/dev-pwa-config'), 'infra')
})

test('groupeDe : « autre » est une RÉPONSE, pas un échec', () => {
  // Un paquet qu'aucun motif ne reconnaît s'affiche en gris et se VOIT. Le
  // ranger d'office quelque part cacherait l'arrivée d'une technologie neuve
  // dans une case qui ment.
  assert.equal(groupeDe('une-librairie-inconnue-de-demain'), 'autre')
  assert.ok(GROUPES.some(([cle]) => cle === 'autre'), 'le groupe doit exister')
})

test('symboles : uniques, dérivés, et les plus portés gardent le plus court', () => {
  const s = symboles(['vite', 'vitest', 'react', 'react-dom', '@types/react'])
  assert.equal(s.get('vite'), 'Vi', 'passé en premier, il garde le symbole court')
  assert.equal(s.get('vitest'), 'Vit')
  assert.equal(s.get('react'), 'Re')
  assert.equal(s.get('react-dom'), 'Rd')
  // La portée compte comme un segment : sans elle, `@types/react` et `react`
  // porteraient le même symbole.
  assert.equal(s.get('@types/react'), 'Tr')
  assert.equal(new Set(s.values()).size, 5)
})

test('symboles : une collision prend une initiale de PLUS avant les lettres', () => {
  // `Epr` et `Esli` ne se répondent pas ; `Epr` et `Eprr` si.
  const s = symboles(['eslint-plugin-react-hooks', 'eslint-plugin-react-refresh'])
  assert.equal(s.get('eslint-plugin-react-hooks'), 'Epr')
  assert.equal(s.get('eslint-plugin-react-refresh'), 'Eprr')
})

test('symboles : l’ordre d’entrée décide, et rien d’autre', () => {
  // La fonction est déterministe : mêmes entrées, mêmes symboles. C'est ce qui
  // permet de les passer triés par adoption sans craindre qu'ils dansent d'un
  // relevé à l'autre.
  const a = symboles(['vitest', 'vite'])
  assert.equal(a.get('vitest'), 'Vi', 'passé en premier, c’est lui qui garde Vi')
  assert.equal(a.get('vite'), 'Vit')
  assert.deepEqual([...symboles(['a-b', 'c-d'])], [...symboles(['a-b', 'c-d'])])
})

test('symboles rend TOUJOURS des symboles uniques, même sur des noms jumeaux', () => {
  const s = symboles(['x-y', 'x_y', 'x.y', 'xy'])
  assert.equal(new Set(s.values()).size, 4)
})

test('periodeDe raisonne en PART du parc, pas en nombres figés', () => {
  // Un seuil écrit « 20 dépôts » vaudrait aujourd'hui et mentirait le jour où
  // le parc en compte quarante.
  assert.equal(periodeDe(28, 28), 0, 'tout le parc : le noyau')
  assert.equal(periodeDe(20, 28), 0, '71 % : encore le noyau')
  assert.equal(periodeDe(19, 28), 1, '68 % : la ceinture')
  assert.equal(periodeDe(1, 28), 4, 'une trace')
  // Le même paquet, dans un parc deux fois plus grand, descend d'une période.
  assert.equal(periodeDe(20, 56), 2)
  // Aucun dépôt : pas de division par zéro, pas de NaN.
  assert.equal(periodeDe(0, 0), PERIODES.length - 1)
})

test('etiquettes : on raccourcit, sauf quand raccourcir ment', () => {
  // `@types/react` et `react` s'affichaient TOUS DEUX « react », côte à côte,
  // avec deux symboles et deux comptes différents. Vu à l'écran le 17/09/2026.
  const e = etiquettes(['@types/react', 'react', '@testing-library/jest-dom'])
  assert.equal(e.get('@types/react'), '@types/react', 'le doute lui coûte son nom entier')
  assert.equal(e.get('react'), 'react')
  // Celui que rien n'ambiguïse garde son nom court : une case de 82 px ne tient
  // pas `@testing-library/jest-dom`.
  assert.equal(e.get('@testing-library/jest-dom'), 'jest-dom')
})

test('etiquettes : deux portées différentes du même nom gardent les deux', () => {
  const e = etiquettes(['@a/x', '@b/x'])
  assert.equal(e.get('@a/x'), '@a/x')
  assert.equal(e.get('@b/x'), '@b/x')
})
