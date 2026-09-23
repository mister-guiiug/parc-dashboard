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
  TRIS_DEPOT,
  correspondDepot,
  correspondLib,
  elementsHorsNpm,
  etiquettes,
  foinDepot,
  groupeDe,
  periodeDe,
  symboles,
  SEUIL_PANNE_MIN,
  fraicheur,
  FRAICHE_H,
  ORDRE_A_FAIRE,
  aFaire,
  chercheCibles,
  demandeMontee,
  graviteRetard,
  heuresDepuis,
  phraseChangement,
  correctifsDe,
  nomUnite,
  nomDemande,
  nbDepotsDe,
  moteurDe,
} from '../scripts/vue.mjs'
import { cmpVersion, etatPublie } from '../scripts/regles.mjs'

test('rangEcart nomme le RANG, pas la distance', () => {
  // Passer de 4.2 à 4.3 n'a rien de commun avec passer de 3 à 4 : c'est ce que
  // la couleur sépare, et ce que le poids facture différemment.
  assert.equal(rangEcart('3.0.0', '4.0.0'), 'majeure')
  assert.equal(rangEcart('4.2.0', '4.3.0'), 'mineure')
  assert.equal(rangEcart('4.3.1', '4.3.9'), 'patch')
  assert.equal(rangEcart('4.3.9', '4.3.9'), '0')
})

test('rangEcart : en 0.x, changer de MINEURE est un majeur — rusqlite 0.32 → 0.40, le 23/09/2026', () => {
  // `^0.32.1` refuse 0.33, Cargo aussi : huit versions cassantes ne sont pas
  // « une mineure à monter ».
  assert.equal(rangEcart('0.32.1', '0.40.2'), 'majeure')
  // Dans la même série 0.13, le correctif reste un correctif.
  assert.equal(rangEcart('0.13.4', '0.13.5'), 'patch')
  // En 0.0.z, chaque correctif rompt.
  assert.equal(rangEcart('0.0.3', '0.0.4'), 'majeure')
  // Au-dessus de 1.0.0, rien ne change.
  assert.equal(rangEcart('1.24.0', '1.26.1'), 'mineure')
  assert.equal(rangEcart('10.75.2', '11.0.0'), 'majeure')
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

test('groupeDe : l’alias `typescript-7` est du langage, pas de l’« autre »', () => {
  // Les dépôts du parc portent deux compilateurs : la 6 que `typescript-eslint`
  // résout et la 7 en second avis. C'est le même langage, donc le même groupe —
  // sinon l'alias tombait en « autre », là où se voit l'arrivée d'une
  // technologie neuve, et brouillait ce signal-là.
  assert.equal(groupeDe('typescript-7'), 'lang')
  // Le motif ne doit pas pour autant avaler ce qui n'est PAS un alias de langage.
  assert.equal(groupeDe('typescript-eslint'), 'qual')
  assert.equal(groupeDe('typescript-plugin-css-modules'), 'autre')
})

test('groupeDe : « autre » est une RÉPONSE, pas un échec', () => {
  // Un paquet qu'aucun motif ne reconnaît s'affiche en gris et se VOIT. Le
  // ranger d'office quelque part cacherait l'arrivée d'une technologie neuve
  // dans une case qui ment.
  assert.equal(groupeDe('une-librairie-inconnue-de-demain'), 'autre')
  // `GROUPES` ne porte plus que des clés : le libellé de chacune vit dans
  // `libelles.mjs`, sous `groupe.<clé>`, dans les deux langues.
  assert.ok(GROUPES.includes('autre'), 'le groupe doit exister')
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

/* ── Les filtres, sortis des rendus ─────────────────────────────────────── */

const depot = (p = {}) => ({
  nom: 'miss-x',
  famille: 'pwa',
  description: '',
  role: '',
  brancheDefaut: 'main',
  pile: [],
  workflows: [],
  compte: { rouge: 0 },
  commit: { jours: 1 },
  ...p,
})

test('foinDepot : on cherche AUSSI dans la pile et les workflows', () => {
  // C'est la partie la moins évidente du filtre, et celle qui rend la recherche
  // utile : taper « supabase » sort les dépôts qui en dépendent, taper une
  // version sort ceux qui la tiennent.
  const d = depot({
    pile: [{ paquet: '@supabase/supabase-js', version: '2.116.0' }],
    workflows: [{ nom: 'Supabase migrations' }],
  })
  const foin = foinDepot(d)
  assert.ok(foin.includes('supabase-js'))
  assert.ok(foin.includes('2.116.0'))
  assert.ok(foin.includes('supabase migrations'))
  // En minuscules : la recherche l'est aussi.
  assert.equal(foin, foin.toLowerCase())
})

test('correspondDepot : les critères se CUMULENT', () => {
  const rouge = depot({ nom: 'a', compte: { rouge: 2 } })
  const vert = depot({ nom: 'b', compte: { rouge: 0 } })
  const drapeaux = new Set(['echec'])
  assert.equal(correspondDepot(rouge, { drapeaux }), true)
  assert.equal(correspondDepot(vert, { drapeaux }), false)
  // Une famille exclue l'emporte sur un drapeau satisfait.
  assert.equal(correspondDepot(rouge, { drapeaux, familles: new Set(['socle']) }), false)
})

test('correspondDepot : sans critère, tout passe', () => {
  assert.equal(correspondDepot(depot()), true)
  assert.equal(correspondDepot(depot(), { q: '   ' }), true, 'une recherche vide n’est pas un filtre')
})

test('correspondDepot ne suppose AUCUN champ présent', () => {
  // Le relevé n'écrit pas `local` sans `--local`, ni `pages` sans site. Un
  // filtre qui lèverait sur un champ absent casserait la page entière.
  const nu = { nom: 'x', famille: 'pwa', compte: {}, commit: {} }
  assert.doesNotThrow(() => correspondDepot(nu, { drapeaux: new Set(['modifie', 'site', 'prive']), q: 'x' }))
  assert.equal(correspondDepot(nu, { drapeaux: new Set(['site']) }), false)
})

test('correspondLib : « partagé » est le DÉFAUT', () => {
  const solo = { paquet: 'a', nbDepots: 1, nbVersions: 1 }
  const partage = { paquet: 'b', nbDepots: 4, nbVersions: 1 }
  assert.equal(correspondLib(solo), false, 'un paquet d’un seul dépôt est une dépendance d’app')
  assert.equal(correspondLib(partage), true)
  assert.equal(correspondLib(solo, { toutes: true }), true)
})

test('correspondLib : « éclaté » demande TROIS versions, pas deux', () => {
  // À deux, c'est une montée en cours ; à trois, c'est une dispersion.
  const deux = { paquet: 'a', nbDepots: 5, nbVersions: 2 }
  const trois = { paquet: 'b', nbDepots: 5, nbVersions: 3 }
  assert.equal(correspondLib(deux, { eclate: true }), false)
  assert.equal(correspondLib(trois, { eclate: true }), true)
})

test('elementsHorsNpm : une ligne sans dépôt ne SORT PAS', () => {
  // Mieux vaut un trou qu'un chiffre inventé : c'est toute la différence entre
  // un relevé et une liste écrite de mémoire.
  const parc = [
    { nom: 'a', langage: 'Rust', workflows: [{ nom: 'CI' }, { nom: 'Renovate' }], pages: null },
    { nom: 'b', langage: 'TypeScript', workflows: [{ nom: 'Lighthouse' }], pages: { ok: true } },
  ]
  const els = elementsHorsNpm(parc)
  const par = Object.fromEntries(els.map((e) => [e.nom, e.n]))
  assert.equal(par['GitHub Actions'], 2)
  assert.equal(par['GitHub Pages'], 1)
  assert.equal(par.Renovate, 1)
  assert.equal(par['Lighthouse CI'], 1)
  assert.equal(par.Rust, 1)
  assert.equal(par['C#'], undefined, 'aucun dépôt en C# : la ligne n’existe pas')
  assert.equal(par.Supabase, undefined)
  assert.ok(els.every((e) => e.n > 0))
})

test('elementsHorsNpm : un parc vide rend une table vide, pas des zéros', () => {
  assert.deepEqual(elementsHorsNpm([]), [])
})

/* ── Fraîcheur : ce que la page dit d'elle-même, d'après etat.json ── */

const T0 = Date.parse('2026-09-23T14:17:00Z')
const minutesAvant = (n) => new Date(T0 - n * 60000).toISOString()

test('fraicheur se tait quand etat.json manque — page en file://, ou publiée avant lui', () => {
  assert.equal(fraicheur('2026-09-23T09:57:00Z', null, T0), null)
  assert.equal(fraicheur('2026-09-23T09:57:00Z', {}, T0), null)
  assert.equal(fraicheur('2026-09-23T09:57:00Z', { verifie: 'pas une date' }, T0), null)
})

test('fraicheur compte les minutes depuis la DERNIÈRE VÉRIFICATION, pas depuis le relevé embarqué', () => {
  // Rien n'a bougé depuis 09:57, mais le relevé est passé il y a 12 minutes :
  // la page est juste, et doit pouvoir le dire.
  const f = fraicheur('2026-09-23T09:57:00Z', { genere: '2026-09-23T09:57:00Z', verifie: minutesAvant(12) }, T0)
  assert.deepEqual(f, { minutes: 12, panne: false, nouveau: null })
})

test('fraicheur annonce un relevé plus récent que la page ouverte', () => {
  const f = fraicheur('2026-09-23T09:57:00Z', { genere: '2026-09-23T13:17:00Z', verifie: minutesAvant(60) }, T0)
  assert.equal(f.nouveau, '2026-09-23T13:17:00Z')
})

test('fraicheur n’invite JAMAIS à recharger vers plus ancien', () => {
  // Le CDN de Pages garde etat.json dix minutes : il peut être en retard sur la
  // page qu'on vient d'ouvrir. Différent ne veut pas dire plus récent.
  const f = fraicheur('2026-09-23T13:17:00Z', { genere: '2026-09-23T09:57:00Z', verifie: minutesAvant(5) }, T0)
  assert.equal(f.nouveau, null)
  // Et un relevé embarqué illisible ne fabrique pas de nouveauté.
  assert.equal(fraicheur(null, { genere: '2026-09-23T13:17:00Z', verifie: minutesAvant(5) }, T0).nouveau, null)
})

test('fraicheur déclare la panne au-delà du seuil, et pas avant', () => {
  const etat = (n) => ({ genere: '2026-09-23T01:00:00Z', verifie: minutesAvant(n) })
  assert.equal(fraicheur('2026-09-23T01:00:00Z', etat(SEUIL_PANNE_MIN), T0).panne, false)
  assert.equal(fraicheur('2026-09-23T01:00:00Z', etat(SEUIL_PANNE_MIN + 1), T0).panne, true)
  // Le seuil couvre le retard MESURÉ du cron de GitHub (4 h 40), avec de la marge.
  assert.ok(SEUIL_PANNE_MIN >= 5 * 60)
})

test('fraicheur borne à zéro une vérification « dans le futur » (horloge locale en avance)', () => {
  const f = fraicheur('2026-09-23T14:00:00Z', { genere: '2026-09-23T14:00:00Z', verifie: new Date(T0 + 90000).toISOString() }, T0)
  assert.equal(f.minutes, 0)
})

test('etatPublie et fraicheur parlent le même contrat', () => {
  // Ce que le relevé écrit, la page le relit : juste après un passage, la page
  // publiée est à jour, vérifiée à l'instant, et rien n'est à recharger.
  const genere = '2026-09-23T14:17:00Z'
  assert.deepEqual(fraicheur(genere, etatPublie({ genere }, T0), T0), { minutes: 0, panne: false, nouveau: null })
})

/* ── Gravité, âge et demande de montée ──────────────────────────────────── */

const lib = (paquet, amont, versions) => ({ paquet, amont, versions: versions.map(([version, depots]) => ({ version, depots: depots.map((d) => (typeof d === 'string' ? { depot: d } : d)) })) })

test('graviteRetard sépare le correctif du nouveau majeur — le défaut du 23/09/2026', () => {
  assert.equal(graviteRetard(lib('prettier', '3.9.9', [['3.9.8', ['a', 'b']]])), 'patch')
  assert.equal(graviteRetard(lib('@sentry/react', '11.0.0', [['10.75.2', ['a']]])), 'majeure')
  // La PIRE version décide : un seul dépôt resté en arrière d'un majeur suffit.
  assert.equal(graviteRetard(lib('vite', '8.3.0', [['8.2.9', ['a']], ['7.4.0', ['b']]])), 'majeure')
  assert.equal(graviteRetard(lib('vite', '8.3.0', [['8.3.0', ['a']]])), null)
  assert.equal(graviteRetard(lib('vite', null, [['8.3.0', ['a']]])), null)
})

test('graviteRetard ne compte pas un majeur ADMIS', () => {
  // TypeScript 6 sous une amont en 7 : typescript-eslint interdit la 7.
  assert.equal(graviteRetard(lib('typescript', '7.0.2', [['6.0.3', ['a', 'b']]])), null)
})

test('heuresDepuis : des heures, jamais négatives, et null sur l’illisible', () => {
  const t = Date.parse('2026-09-23T20:00:00Z')
  assert.equal(heuresDepuis('2026-09-23T17:00:00Z', t), 3)
  assert.equal(heuresDepuis('2026-09-23T21:00:00Z', t), 0)
  assert.equal(heuresDepuis(null, t), null)
  assert.equal(heuresDepuis('hier', t), null)
  assert.equal(FRAICHE_H, 24)
})

test('demandeMontee nomme le paquet EXACT, la cible, et chaque dépôt en retard', () => {
  const l = lib('@sentry/react', '11.0.0', [
    ['11.0.0', ['a-jour']],
    ['10.75.2', ['zeta', 'alpha', { depot: 'bac-sable', transitif: true }]],
  ])
  assert.deepEqual(demandeMontee(l), {
    paquet: '@sentry/react',
    alias: null,
    fichier: null,
    cible: '11.0.0',
    gravite: 'majeure',
    depots: [
      { depot: 'alpha', dossier: null, version: '10.75.2', transitif: false },
      { depot: 'bac-sable', dossier: null, version: '10.75.2', transitif: true },
      { depot: 'zeta', dossier: null, version: '10.75.2', transitif: false },
    ],
  })
  // rien à monter, rien à demander
  assert.equal(demandeMontee(lib('vite', '8.3.0', [['8.3.0', ['a']]])), null)
})

/* ── Les angles morts du 23/09/2026 ─────────────────────────────────────── */

test('correctifsDe : le correctif qu’un nouveau majeur cachait — @sentry/react 10.75.3 sous une 11.0.0', () => {
  const l = lib('@sentry/react', '11.0.0', [['10.75.2', ['b', 'a']]])
  l.versions[0].derniere = '10.75.3'
  l.versions[0].derniereLe = '2026-09-23T14:03:00Z'
  assert.deepEqual(correctifsDe(l), [
    {
      paquet: '@sentry/react',
      alias: null,
      fichier: null,
      cible: '10.75.3',
      serie: '10',
      amont: '11.0.0',
      // la date de la CIBLE, pas celle de la 11.0.0
      publie: '2026-09-23T14:03:00Z',
      gravite: 'patch',
      depots: [
        { depot: 'a', dossier: null, version: '10.75.2', transitif: false },
        { depot: 'b', dossier: null, version: '10.75.2', transitif: false },
      ],
    },
  ])
  // Le majeur reste une décision À PART, et la même ligne en garde la demande.
  assert.equal(demandeMontee(l).cible, '11.0.0')
  assert.equal(demandeMontee(l).gravite, 'majeure')
  // Sans `derniere`, rien à ajouter ; une `derniere` qui n'avance pas non plus.
  assert.deepEqual(correctifsDe(lib('@sentry/react', '11.0.0', [['10.75.2', ['a']]])), [])
  const pareil = lib('x', '2.0.0', [['1.4.0', ['a']]])
  pareil.versions[0].derniere = '1.4.0'
  assert.deepEqual(correctifsDe(pareil), [])
})

test('correctifsDe : un majeur ADMIS a lui aussi ses correctifs', () => {
  // TypeScript 6 n'est pas en retard sous une 7 (typescript-eslint interdit la
  // 7), mais une 6.0.4 serait bien à monter.
  const l = lib('typescript', '7.0.2', [['6.0.3', ['a']]])
  l.versions[0].derniere = '6.0.4'
  assert.equal(graviteRetard(l), null)
  assert.equal(demandeMontee(l), null)
  assert.deepEqual(
    correctifsDe(l).map((d) => [d.cible, d.serie, d.gravite]),
    [['6.0.4', '6', 'patch']],
  )
})

test('@types/vscode se mesure au plafond de engines.vscode, pas à l’amont', () => {
  // vscode-sops-diff : engines ^1.90.0, types 1.125.0 au lock, amont 1.138.0.
  const au = lib('@types/vscode', '1.138.0', [['1.125.0', [{ depot: 'vscode-sops-diff', plafond: '1.90.0' }]]])
  assert.equal(graviteRetard(au), null)
  assert.equal(demandeMontee(au), null)
  assert.deepEqual(correctifsDe(au), [])
  // Resté SOUS son plafond, il se monte jusqu'à lui — pas jusqu'à l'amont.
  const sous = lib('@types/vscode', '1.138.0', [['1.85.0', [{ depot: 'ext', plafond: '1.90.0' }]]])
  assert.equal(graviteRetard(sous), 'mineure')
  assert.equal(demandeMontee(sous), null)
  assert.deepEqual(
    correctifsDe(sous).map((d) => [d.cible, d.plafond, d.gravite, d.depots.map((x) => x.depot)]),
    [['1.90.0', true, 'mineure', ['ext']]],
  )
  assert.equal(moteurDe('@types/vscode'), 'engines.vscode')
})

test('un paquet figé dans un DOSSIER se nomme par lui, et compte pour son dépôt', () => {
  const l = lib('wrangler', '4.137.0', [['4.135.0', [{ depot: 'miss-genius', dossier: 'worker' }, 'miss-genius', { depot: 'mister-cim10', dossier: 'workers' }]]])
  const dm = demandeMontee(l)
  assert.deepEqual(dm.depots.map(nomUnite), ['miss-genius', 'miss-genius/worker', 'mister-cim10/workers'])
  // Deux dossiers d'un même dépôt font deux lignes à monter, mais un seul dépôt.
  assert.equal(nbDepotsDe(dm), 2)
  assert.equal(nomUnite({ depot: 'a' }), 'a')
})

test('nomDemande dit le fichier quand la ligne n’est pas un paquet — Node et son .nvmrc', () => {
  assert.equal(nomDemande({ paquet: 'Node.js', fichier: '.nvmrc' }), 'Node.js (.nvmrc)')
  assert.equal(nomDemande({ paquet: 'vite', fichier: null }), 'vite')
  const node = { ...lib('Node.js', '26.10.0', [['26.9.0', ['a', 'b']]]), fichier: '.nvmrc' }
  assert.deepEqual([demandeMontee(node).fichier, demandeMontee(node).gravite], ['.nvmrc', 'mineure'])
  assert.equal(groupeDe('Node.js'), 'lang')
})

test('aFaire range le correctif caché parmi les correctifs, et laisse le majeur aux décisions', () => {
  const sentry = { ...lib('@sentry/react', '11.0.0', [['10.75.2', ['a', 'b']]]), enRetard: 2 }
  sentry.versions[0].derniere = '10.75.3'
  // un majeur admis : `enRetard` à zéro, et pourtant un correctif à monter
  const ts = { ...lib('typescript', '7.0.2', [['6.0.3', ['a']]]), enRetard: 0 }
  ts.versions[0].derniere = '6.0.4'
  const r = aFaire({ depots: [depotAFaire('a'), depotAFaire('b')], libs: [sentry, ts], kpi: {} })
  const de = (cle) => r.find((x) => x.cle === cle).details.map((d) => `${d.paquet} → ${d.cible}`)
  assert.deepEqual(de('majeures'), ['@sentry/react → 11.0.0'])
  assert.deepEqual(de('correctifs'), ['@sentry/react → 10.75.3', 'typescript → 6.0.4'])
})

/* ── Le bloc « À faire » ────────────────────────────────────────────────── */

const depotAFaire = (nom, extra = {}) => ({ nom, compte: { rouge: 0 }, pages: null, prs: [], ...extra })

test('aFaire range du cassé à l’entretien, et tait ce qui est vide', () => {
  const D = {
    socle: '@s/socle',
    kpi: { alertesLisibles: true },
    depots: [
      depotAFaire('a', { compte: { rouge: 2 }, prod: { etat: 'retard', retard: 3 } }),
      depotAFaire('b', { pages: { url: 'https://b/', ok: false }, prs: [{ num: 7, titre: 'fix', brouillon: false }, { num: 8, titre: 'wip', brouillon: true }] }),
      depotAFaire('c', { renovate: { enAttente: 5, majeures: 2, introuvables: ['@s/socle'], issue: 'https://i' } }),
    ],
    libs: [lib('prettier', '3.9.9', [['3.9.8', ['a', 'b']]]), lib('@sentry/react', '11.0.0', [['10.75.2', ['a']]]), lib('@s/socle', '6.10.0', [['6.7.1', ['a', 'b', 'c']]])].map((l) => ({
      ...l,
      enRetard: 1,
    })),
  }
  const r = aFaire(D)
  assert.deepEqual(
    r.map((x) => x.cle),
    ['rouges', 'sites', 'prod', 'prs', 'majeures', 'correctifs', 'socle', 'renovate', 'introuvables'],
  )
  // un brouillon n'est pas « à relire »
  assert.equal(r.find((x) => x.cle === 'prs').n, 1)
  // le socle compte ses DÉPÔTS en retard, pas ses lignes ; Renovate ses mises à jour
  assert.equal(r.find((x) => x.cle === 'socle').n, 3)
  assert.equal(r.find((x) => x.cle === 'renovate').n, 5)
  // le socle n'apparaît pas aussi parmi les correctifs
  assert.ok(!r.find((x) => x.cle === 'correctifs').details.some((d) => d.paquet === '@s/socle'))
  // l'ordre du bloc est bien celui qu'annonce ORDRE_A_FAIRE
  const rangs = r.map((x) => ORDRE_A_FAIRE.indexOf(x.cle))
  assert.deepEqual(rangs, [...rangs].sort((a, b) => a - b))
})

test('aFaire est vide pour un parc sain, sans lever sur un modèle incomplet', () => {
  assert.deepEqual(aFaire({ depots: [depotAFaire('a')], libs: [], kpi: {} }), [])
  assert.deepEqual(aFaire(null), [])
})

/* ── La recherche de la barre ───────────────────────────────────────────── */

test('chercheCibles : début de nom, puis début de mot, puis le reste', () => {
  const D = {
    depots: [{ nom: 'mister-qowa' }, { nom: 'preact-render' }],
    libs: [{ paquet: '@sentry/react' }, { paquet: 'react' }, { paquet: 'react-dom' }],
  }
  assert.deepEqual(
    chercheCibles('react', D).map((c) => c.nom),
    ['react', 'react-dom', '@sentry/react', 'preact-render'],
  )
  assert.deepEqual(chercheCibles('  QOWA ', D), [{ type: 'depot', nom: 'mister-qowa' }])
  assert.deepEqual(chercheCibles('', D), [])
  assert.equal(chercheCibles('r', D, 2).length, 2)
})

/* ── Les phrases de changement, partagées avec le flux Atom ─────────────── */

test('phraseChangement : le nom propre d’abord, et un nouveau majeur se dit', () => {
  const T = (cle, p = {}) => `[${cle}${Object.keys(p).length ? ' ' + JSON.stringify(p) : ''}]`
  assert.deepEqual(phraseChangement({ type: 'ci-rouge', depot: 'a', workflow: 'CI' }, T), ['a', '[changements.ci-rouge {"workflow":"CI"}]'])
  const amont = phraseChangement({ type: 'amont', paquet: '@sentry/react', de: '10.75.2', a: '11.0.0', majeur: true, nbDepots: 18 }, T)
  assert.equal(amont[0], '@sentry/react')
  assert.ok(amont.includes('[changements.amont.majeur]'))
  assert.deepEqual(phraseChangement({ type: 'site-tombe', depot: 'b' }, T), ['b', '[changements.site-tombe]'])
  assert.deepEqual(phraseChangement({ type: 'prod-retard', depot: 'c', retard: 2 }, T), ['c', '[changements.prod-retard {"n":2}]'])
})
