// Les règles pures du relevé — aucun réseau, aucun jeton.
//
// Ce qui est éprouvé ici n'est pas choisi au hasard : ce sont les fonctions
// dont une régression se voit LE PLUS TARD. `fond()` décide si la CI commite ;
// une erreur y ferait réécrire `index.html` toutes les nuits sans que rien
// n'ait bougé, et personne ne le remarquerait avant des semaines de commits
// vides. `classe()` range les vingt-huit dépôts, et un dépôt mal rangé change
// des compteurs que rien ne recoupe.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MAJEURS_ADMIS, SOCLE, changementsDepuis, classe, cmpVersion, etatDe, fond, fusionnePoint, majeurAdmis, majeurDe, nettoie } from '../scripts/regles.mjs'

test('nettoie retire la plage et la préversion', () => {
  assert.equal(nettoie('^4.7.0'), '4.7.0')
  assert.equal(nettoie('~1.2.3'), '1.2.3')
  assert.equal(nettoie('>=2.0.0'), '2.0.0')
  assert.equal(nettoie('3.0.0-beta-1'), '3.0.0')
  assert.equal(nettoie(null), '')
})

test('cmpVersion ordonne sur trois segments, pas sur la chaîne', () => {
  // Le piège de la comparaison textuelle : '10' < '9' en lexicographique.
  assert.ok(cmpVersion('1.9.0', '1.10.0') < 0)
  assert.ok(cmpVersion('2.0.0', '10.0.0') < 0)
  assert.equal(cmpVersion('4.2.0', '4.2.0'), 0)
  // Un segment manquant vaut zéro, pas NaN.
  assert.equal(cmpVersion('5', '5.0.0'), 0)
  // Une plage se compare comme la version qu'elle nomme.
  assert.equal(cmpVersion('^4.15.1', '4.15.1'), 0)
})

test('cmpVersion ignore le quatrième segment', () => {
  // Choix assumé : le parc raisonne en major.minor.patch. Deux versions qui ne
  // diffèrent qu'au quatrième rang sont vues comme identiques.
  assert.equal(cmpVersion('1.2.3.4', '1.2.3.9'), 0)
})

test('etatDe : un run non terminé n’est NI vert NI rouge', () => {
  assert.equal(etatDe({ status: 'in_progress', conclusion: null }), 'encours')
  assert.equal(etatDe({ status: 'queued', conclusion: null }), 'encours')
  assert.equal(etatDe({ status: 'completed', conclusion: 'success' }), 'vert')
  assert.equal(etatDe({ status: 'completed', conclusion: 'failure' }), 'rouge')
  assert.equal(etatDe({ status: 'completed', conclusion: 'startup_failure' }), 'rouge')
  assert.equal(etatDe(null), 'jamais')
})

test('etatDe : skipped, cancelled et neutral ne sont pas des échecs', () => {
  for (const c of ['skipped', 'cancelled', 'neutral']) {
    assert.equal(etatDe({ status: 'completed', conclusion: c }), 'neutre', c)
  }
})

test('classe range par SIGNAL, jamais par nom', () => {
  // Une PWA se reconnaît à vite-plugin-pwa, pas à son préfixe miss-/mister-.
  assert.equal(classe('miss-quelquechose', { 'vite-plugin-pwa': '^1' }, {}, {}, 'TypeScript').famille, 'pwa')
  assert.equal(classe('mister-autre-chose', {}, {}, {}, 'TypeScript').famille, 'autre')
  assert.equal(classe('x', { electron: '^44' }, {}, {}, null).famille, 'desktop')
  assert.equal(classe('x', {}, { tauri: '2' }, {}, null).famille, 'desktop')
  assert.equal(classe('x', {}, {}, {}, 'C#').famille, 'desktop')
  // Le rôle est une CLÉ, pas une phrase : `libelles.mjs` la traduit, et un
  // nom propre (Electron, .NET) reste tel quel — voir libelles.test.mjs.
  assert.equal(classe('x', {}, {}, { engines: { vscode: '^1' } }, null).role, 'role.vscode')
  assert.equal(classe('x', { electron: '^44' }, {}, {}, null).role, 'Electron')
})

test('classe : les trois couches du socle sont une liste explicite', () => {
  // `pwa-starter-kit` EST une PWA : aucun signal ne le distinguerait de ce
  // qu'il engendre. C'est pour ça que la liste existe.
  for (const nom of Object.keys(SOCLE)) {
    assert.equal(classe(nom, { 'vite-plugin-pwa': '^1' }, {}, {}, 'TypeScript').famille, 'socle', nom)
  }
})

/* ------------------------------------------------------------------ fond */

const modeleMinimal = () => ({
  genere: '2026-09-14T05:17:00.000Z',
  kpi: { taux: 96 },
  depots: [{ nom: 'a', pages: { url: 'https://x', ok: true, ms: 120 } }],
})

test('fond ignore l’horodatage et le temps de réponse HTTP', () => {
  const a = modeleMinimal()
  const b = modeleMinimal()
  b.genere = '2026-09-15T05:17:00.000Z'
  b.depots[0].pages.ms = 980
  assert.equal(fond(a), fond(b), 'deux relevés identiques doivent rendre le même fond')
})

test('fond voit un vrai changement d’état', () => {
  const a = modeleMinimal()
  const b = modeleMinimal()
  b.kpi.taux = 93
  assert.notEqual(fond(a), fond(b))
  const c = modeleMinimal()
  c.depots[0].pages.ok = false
  assert.notEqual(fond(a), fond(c), 'un site tombé doit republier')
})

test('fond ignore le récit de transition et le journal', () => {
  // Sinon un jour de changement serait suivi d’un second commit le lendemain,
  // celui qui remet `changements` à vide — alors que rien n’aurait bougé.
  const a = modeleMinimal()
  const b = modeleMinimal()
  b.changements = [{ type: 'ci-rouge', depot: 'a' }]
  b.compareA = '2026-09-13T05:17:00.000Z'
  b.historique = [{ jour: '2026-09-14', taux: 96 }]
  assert.equal(fond(a), fond(b))
})

test('fond ne modifie pas le modèle qu’on lui passe', () => {
  const a = modeleMinimal()
  fond(a)
  assert.equal(a.genere, '2026-09-14T05:17:00.000Z')
  assert.equal(a.depots[0].pages.ms, 120)
})

test('fond rend null sur rien', () => {
  assert.equal(fond(null), null)
})

/* -------------------------------------------------------- changements */

const avec = (depots, libs = [], kpi = {}) => ({ depots, libs, kpi })

test('changementsDepuis : rien à comparer au premier relevé', () => {
  assert.deepEqual(changementsDepuis(null, avec([])), [])
})

test('changementsDepuis relève les bascules de CI, dans les deux sens', () => {
  const av = avec([{ nom: 'a', workflows: [{ nom: 'CI', etat: 'vert' }, { nom: 'Deploy', etat: 'rouge' }] }])
  const ap = avec([{ nom: 'a', workflows: [{ nom: 'CI', etat: 'rouge' }, { nom: 'Deploy', etat: 'vert' }] }])
  const c = changementsDepuis(av, ap)
  assert.equal(c.length, 2)
  // Ce qui casse d’abord.
  assert.equal(c[0].type, 'ci-rouge')
  assert.equal(c[0].workflow, 'CI')
  assert.equal(c[1].type, 'ci-vert')
})

test('changementsDepuis ignore les passages par « en cours »', () => {
  // Un job qui tourne n’est pas un événement : sans ce filtre, chaque relevé
  // pris pendant une exécution annoncerait une fausse bascule.
  const av = avec([{ nom: 'a', workflows: [{ nom: 'CI', etat: 'vert' }] }])
  const ap = avec([{ nom: 'a', workflows: [{ nom: 'CI', etat: 'encours' }] }])
  assert.deepEqual(changementsDepuis(av, ap), [])
  assert.deepEqual(changementsDepuis(ap, av), [])
})

test('changementsDepuis relève les entrées et sorties de dépôt', () => {
  const c = changementsDepuis(avec([{ nom: 'a' }]), avec([{ nom: 'b' }]))
  assert.deepEqual(
    c.map((x) => x.type).sort(),
    ['depot-entre', 'depot-sorti']
  )
})

test('changementsDepuis relève une version amont, et l’entrée en dormance', () => {
  const av = avec([], [{ paquet: 'vite', amont: '8.2.0' }, { paquet: 'qrcode', amont: '1.5.4' }])
  const ap = avec([], [{ paquet: 'vite', amont: '8.3.0', nbDepots: 20 }, { paquet: 'qrcode', amont: '1.5.4', dormance: 'arretee', publieLe: '2024-08-05' }])
  const c = changementsDepuis(av, ap)
  const amont = c.find((x) => x.type === 'amont')
  assert.equal(amont.paquet, 'vite')
  assert.equal(amont.de, '8.2.0')
  assert.equal(amont.a, '8.3.0')
  assert.ok(c.some((x) => x.type === 'dormante' && x.paquet === 'qrcode'))
})

test('changementsDepuis ne compare les alertes que si les DEUX relevés ont su les lire', () => {
  // « 0 alerte » et « je n’ai pas pu lire » ne doivent jamais se soustraire.
  const illisible = avec([], [], { alertesLisibles: false, alertes: null })
  const lu = avec([], [], { alertesLisibles: true, alertes: 12 })
  assert.deepEqual(changementsDepuis(illisible, lu), [])
  assert.deepEqual(changementsDepuis(lu, illisible), [])
  const c = changementsDepuis(lu, avec([], [], { alertesLisibles: true, alertes: 0 }))
  assert.deepEqual(c, [{ type: 'alertes', de: 12, a: 0 }])
})

/* ------------------------------------------------------ fusionnePoint */

test('fusionnePoint : une mesure absente n’efface pas une mesure réelle', () => {
  // Le cas mesuré le 14/09 : le relevé de CI, avec le seul GITHUB_TOKEN, ne
  // sait pas lire les alertes et écrit `null`. Il ne doit pas écraser le 0 relevé
  // le matin par un passage mieux doté.
  const matin = { jour: '2026-09-14', taux: 96, alertes: 0, alertesGraves: 0, dormantes: 10 }
  const soir = { jour: '2026-09-14', taux: 94, alertes: null, alertesGraves: null, dormantes: 11 }
  assert.deepEqual(fusionnePoint(matin, soir), {
    jour: '2026-09-14',
    taux: 94,
    alertes: 0,
    alertesGraves: 0,
    dormantes: 11,
  })
})

test('fusionnePoint : une valeur fraîche l’emporte, même à zéro', () => {
  // `0` n’est pas `null` : un compte retombé à zéro est une vraie mesure.
  assert.deepEqual(fusionnePoint({ jour: 'j', alertes: 12 }, { jour: 'j', alertes: 0 }), { jour: 'j', alertes: 0 })
})

test('fusionnePoint sans point antérieur rend le nouveau', () => {
  const p = { jour: 'j', taux: 96 }
  assert.equal(fusionnePoint(null, p), p)
})

test('changementsDepuis borne la liste', () => {
  const beaucoup = (etat) => [{ nom: 'a', workflows: Array.from({ length: 60 }, (_, i) => ({ nom: 'w' + i, etat })) }]
  assert.equal(changementsDepuis(avec(beaucoup('vert')), avec(beaucoup('rouge'))).length, 40)
})

/* ---------------------------------------------- les majeurs admis */

// Le voyant « en retard » compare au `latest` du registre, ce qui suppose
// qu'un parc n'a qu'une bonne réponse. TypeScript n'en a pas qu'une :
// `typescript-eslint` interdit le 7, donc tout dépôt qui lint reste au 6.
// Sans cette règle, vingt-deux dépôts criaient pour une version qu'ils ne
// peuvent pas prendre — et le seul moyen de les taire était de casser leur
// lint. Ces tests tiennent les deux bords : l'exception s'applique, et elle
// ne déborde pas.

test('majeurDe lit le majeur d’une plage comme d’une version verrouillée', () => {
  assert.equal(majeurDe('6.0.3'), '6')
  assert.equal(majeurDe('^6.0.3'), '6')
  assert.equal(majeurDe('>=7.0.0-beta.2'), '7')
  assert.equal(majeurDe('10.11.0'), '10')
})

test('TypeScript 6 et 7 sont admis, et rien d’autre ne l’est', () => {
  assert.equal(majeurAdmis('typescript', '6.0.3'), true)
  assert.equal(majeurAdmis('typescript', '7.0.2'), true)
  // Un majeur ABANDONNÉ reste un retard : l'exception nomme deux majeurs,
  // elle n'ouvre pas le paquet en grand.
  assert.equal(majeurAdmis('typescript', '5.9.3'), false)
  assert.equal(majeurAdmis('typescript', '8.0.0'), false)
})

test('l’exception ne déborde sur AUCUN autre paquet', () => {
  for (const paquet of ['eslint', '@eslint/js', 'typescript-eslint', 'react', 'vite']) {
    assert.equal(majeurAdmis(paquet, '1.0.0'), false, paquet)
    assert.equal(majeurAdmis(paquet, '6.0.3'), false, paquet)
  }
  assert.equal(majeurAdmis('inconnu', '6.0.3'), false)
})

test('la table reste une DÉCISION : une entrée nomme au moins deux majeurs', () => {
  // Un seul majeur admis n'exempterait rien — ce serait le cas normal écrit
  // en exception, donc une ligne qui ne dit rien et que personne ne relit.
  for (const [paquet, majeurs] of Object.entries(MAJEURS_ADMIS)) {
    assert.ok(Array.isArray(majeurs), paquet)
    assert.ok(majeurs.length >= 2, `${paquet} n’admet qu’un majeur : ce n’est pas une exception`)
    for (const m of majeurs) assert.match(m, /^\d+$/, `${paquet} : « ${m} » n’est pas un majeur`)
  }
})
