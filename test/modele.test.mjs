/**
 * Ce que le relevé CALCULE — enfin joignable par un test.
 *
 * Ces règles vivaient dans `releve.mjs`, entre deux appels réseau : l'importer
 * déclenchait la collecte, exigeait un jeton et consommait trois cent trente
 * appels d'API. Aucune d'elles n'avait de test, et deux portaient dans leur
 * commentaire la trace d'un piège qui avait déjà mordu.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { PILE_MONTREE, SEUIL_DORMANCE_JOURS, estDormante, etatDormance, joursDepuis, maturitesDuCatalogue, pileDuDepot } from '../scripts/modele.mjs'

const JOUR = 86400000
const MAINTENANT = new Date('2026-09-17T00:00:00Z')
const ilYA = (n) => new Date(MAINTENANT - n * JOUR).toISOString()

/* ── Les maturités, lues dans le catalogue du socle ─────────────────────── */

test('maturitesDuCatalogue découpe sur les appels `app(`, pas sur une fenêtre', () => {
  // LE PIÈGE QUI A MORDU. Deux entrées portent de longs commentaires à
  // l'intérieur de l'appel : une fenêtre de caractères raisonnable ne les
  // couvrait pas, et leur maturité sortait à `null`.
  const catalogue = `
    export const FAMILY_APPS = [
      app(
        'miss-courte',
        'Courte',
        'stable',
      ),
      app(
        'miss-longue',
        'Longue',
        // Un commentaire très long, comme il en existe deux dans le catalogue
        // réel, qui explique pourquoi cette application est là, ce qu'elle
        // remplace, et pourquoi son identifiant ne ressemble pas à son nom.
        // Il tient sur plus de lignes qu'aucune fenêtre ne couvrirait.
        'beta',
      ),
    ]
  `
  assert.deepEqual(maturitesDuCatalogue(catalogue), { 'miss-courte': 'stable', 'miss-longue': 'beta' })
})

test('maturitesDuCatalogue ne lit PAS une maturité dans un commentaire', () => {
  // Le second piège : le mot « stable » revient souvent en prose. La maturité
  // est un argument seul sur sa ligne — le fichier est formaté par prettier.
  const catalogue = `
    export const FAMILY_APPS = [
      app(
        'miss-x',
        'X',
        // cette application n'est pas encore 'stable', loin de là
        'alpha',
      ),
    ]
  `
  assert.deepEqual(maturitesDuCatalogue(catalogue), { 'miss-x': 'alpha' })
})

test('maturitesDuCatalogue : une entrée sans maturité rend null, pas rien', () => {
  const catalogue = `FAMILY_APPS = [ app(\n 'miss-y',\n 'Y',\n ) ]`
  assert.deepEqual(maturitesDuCatalogue(catalogue), { 'miss-y': null })
})

test('maturitesDuCatalogue : sans FAMILY_APPS, rien — et surtout pas une exception', () => {
  // Le relevé le signale bruyamment plus haut ; ici, il ne doit pas lever.
  assert.deepEqual(maturitesDuCatalogue('const x = 1'), {})
  assert.deepEqual(maturitesDuCatalogue(''), {})
  assert.deepEqual(maturitesDuCatalogue(null), {})
})

/* ── La dormance ───────────────────────────────────────────────────────── */

test('estDormante : un an sans publication, et une date qui manque n’en est pas une', () => {
  assert.equal(estDormante({ publieLe: ilYA(400) }, MAINTENANT), true)
  assert.equal(estDormante({ publieLe: ilYA(100) }, MAINTENANT), false)
  // Sans date de publication, on ne sait pas — ce n'est pas « dormante ».
  assert.equal(estDormante({ publieLe: null }, MAINTENANT), false)
  assert.equal(estDormante({}, MAINTENANT), false)
  assert.equal(SEUIL_DORMANCE_JOURS, 365)
})

test('etatDormance distingue « elle dort » de « elle est morte »', () => {
  // C'est TOUT l'objet du relevé : le même chiffre — plus d'un an sans version
  // — recouvre une bibliothèque vivante qui ne publie pas et une autre qu'il
  // faut remplacer. Mesuré le 14/09/2026 : leaflet n'avait rien publié depuis
  // mai 2023 mais son dépôt avait reçu un commit le jour même.
  assert.equal(etatDormance({ amontPousseLe: ilYA(0) }, MAINTENANT), 'sans-version')
  assert.equal(etatDormance({ amontPousseLe: ilYA(800) }, MAINTENANT), 'arretee')
  assert.equal(etatDormance({ amontArchive: true, amontPousseLe: ilYA(0) }, MAINTENANT), 'archivee')
})

test('etatDormance DIT qu’il ne sait pas, plutôt que de deviner', () => {
  // Sans dépôt amont connu, aucune des deux réponses n'est vraie. La page
  // affiche « inconnue » ; l'inverse ferait passer une lacune pour un constat.
  assert.equal(etatDormance({ amontPousseLe: null }, MAINTENANT), 'inconnue')
  assert.equal(etatDormance({}, MAINTENANT), 'inconnue')
})

test('joursDepuis rend null sur une date absente, jamais NaN', () => {
  assert.equal(joursDepuis(null, MAINTENANT), null)
  assert.equal(joursDepuis(undefined, MAINTENANT), null)
  assert.equal(Math.round(joursDepuis(ilYA(10), MAINTENANT)), 10)
})

/* ── La pile montrée sur une carte ─────────────────────────────────────── */

const ctx = (amont = {}) => ({ amont, nomSocle: '@mister-guiiug/dev-pwa-config', nettoie: (v) => String(v || '').replace(/^[\^~]/, '') })

test('pileDuDepot : la version VERROUILLÉE l’emporte sur la déclarée', () => {
  // Une plage `^4.7.0` accepte déjà `4.9.0` : afficher la plage ferait passer
  // un dépôt à jour pour un retardataire.
  const d = { nom: 'miss-x', verrouillees: { react: '19.3.0' }, declarees: { react: '^19.0.0' } }
  const [re] = pileDuDepot(d, ctx()).filter((p) => p.paquet === 'react')
  assert.equal(re.version, '19.3.0')
  assert.equal(re.verrouille, true)
})

test('pileDuDepot : sans lockfile, la plage déclarée est NETTOYÉE et signalée', () => {
  const d = { nom: 'miss-x', verrouillees: {}, declarees: { vite: '^8.3.0' } }
  const [vi] = pileDuDepot(d, ctx()).filter((p) => p.paquet === 'vite')
  assert.equal(vi.version, '8.3.0')
  assert.equal(vi.verrouille, false, 'l’app doit pouvoir dire que ce n’est qu’une plage')
})

test('pileDuDepot : le socle se nomme autrement DANS son propre dépôt', () => {
  // Il n'y est pas une dépendance, il en est le sujet.
  const socle = pileDuDepot({ nom: 'dev-pwa-config', paquet: { version: '4.21.1' }, verrouillees: {}, declarees: {} }, ctx())
  assert.equal(socle[0].nom, 'socle (ce dépôt)')
  assert.equal(socle[0].version, '4.21.1')

  const app = pileDuDepot({ nom: 'miss-x', verrouillees: { '@mister-guiiug/dev-pwa-config': '4.20.0' }, declarees: {} }, ctx())
  assert.equal(app[0].nom, 'socle')
})

test('pileDuDepot : un paquet absent ne laisse pas de case vide', () => {
  const d = { nom: 'miss-x', verrouillees: { react: '19.3.0' }, declarees: {} }
  const pile = pileDuDepot(d, ctx())
  assert.deepEqual(
    pile.map((p) => p.paquet),
    ['react'],
    'ni le socle ni les huit autres ne doivent apparaître à vide',
  )
})

test('pileDuDepot : les crates Rust sont marquées, et sans amont', () => {
  const d = { nom: 'mister-commitia', verrouillees: {}, declarees: {}, crates: { tauri: '2.11.5', tokio: '1.53.1' } }
  const pile = pileDuDepot(d, { ...ctx(), crates: ['tauri', 'tokio', 'absente'] })
  assert.deepEqual(
    pile.map((p) => p.paquet),
    ['tauri', 'tokio'],
  )
  assert.ok(pile.every((p) => p.rust === true && p.amont === null))
})

test('pileDuDepot suit l’ordre écrit, pas celui du lockfile', () => {
  const tout = Object.fromEntries(PILE_MONTREE.map(([, p]) => [p, '1.0.0']))
  const d = { nom: 'miss-x', verrouillees: tout, declarees: {} }
  assert.deepEqual(
    pileDuDepot(d, ctx()).map((p) => p.nom),
    PILE_MONTREE.map(([n]) => n),
  )
})
