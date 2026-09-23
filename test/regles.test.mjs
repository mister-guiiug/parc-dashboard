// Les règles pures du relevé — aucun réseau, aucun jeton.
//
// Ce qui est éprouvé ici n'est pas choisi au hasard : ce sont les fonctions
// dont une régression se voit LE PLUS TARD. `fond()` décide si le relevé
// publie une page neuve ; une erreur y ferait republier à chaque passage
// horaire sans que rien n'ait bougé — et annoncer à chaque lecteur « un relevé
// plus récent » qui n'apporte rien. `classe()` range les vingt-huit dépôts, et un dépôt mal rangé change
// des compteurs que rien ne recoupe.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MAJEURS_ADMIS, PLAFONDS, PLAFONDS_ENGINES, SOCLE, aliasNpm, amontAdmis, changementsDepuis, classe, cmpVersion, estEnRetard, etatDe, etatPublie, fond, fusionneHistoriques, fusionnePoint, joursAbsents, majeurAdmis, majeurDe, nettoie, paquetReel, serieDe } from '../scripts/regles.mjs'

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

/* ------------------------------------------------- les alias npm */

// `"typescript-7": "npm:typescript@~7.0.2"` déclare une dépendance dont le nom
// n'existe PAS au registre : interrogé sur `typescript-7`, npm répond 404. Sans
// résoudre l'alias, la ligne du tableau restait sans amont ni date — donc une
// librairie que la page ne pouvait jamais dire en retard.

test('aliasNpm reconnaît un alias et rend le paquet réellement publié', () => {
  assert.deepEqual(aliasNpm('npm:typescript@~7.0.2'), { paquet: 'typescript', plage: '~7.0.2' })
  assert.deepEqual(aliasNpm('npm:typescript@7.0.2'), { paquet: 'typescript', plage: '7.0.2' })
})

test('aliasNpm coupe au DERNIER @ : un paquet scopé garde son scope', () => {
  // Couper au premier `@` rendrait `{ paquet: '' }` sur un scope, et la requête
  // partirait sur une chaîne vide.
  assert.deepEqual(aliasNpm('npm:@scope/nom@^1.2.3'), { paquet: '@scope/nom', plage: '^1.2.3' })
})

test('aliasNpm rend null sur ce qui n’est pas un alias', () => {
  for (const plage of ['^6.0.3', '~7.0.2', '>=4.8.4 <6.1.0', '*', '', 'workspace:*', 'file:../x']) {
    assert.equal(aliasNpm(plage), null, plage)
  }
  assert.equal(aliasNpm(undefined), null)
})

test('paquetReel laisse passer un nom ordinaire et traduit un alias', () => {
  assert.equal(paquetReel('typescript', '~6.0.3'), 'typescript')
  assert.equal(paquetReel('typescript-7', 'npm:typescript@~7.0.2'), 'typescript')
  assert.equal(paquetReel('react', '^19.2.0'), 'react')
})

test('sans lockfile, la version affichée d’un alias est sa PLAGE, pas la chaîne npm:', () => {
  // C'est la composition exacte dont `releve.mjs` se sert pour le repli. Sans
  // `aliasNpm`, `nettoie` ne voit aucun préfixe de plage dans
  // `npm:typescript@~7.0.2` et la rend TELLE QUELLE — la barre de répartition
  // afficherait alors cette chaîne en guise de numéro de version.
  const repli = (declaree) => nettoie(aliasNpm(declaree)?.plage ?? declaree)
  assert.equal(repli('npm:typescript@~7.0.2'), '7.0.2')
  assert.equal(repli('npm:@scope/nom@^1.2.3'), '1.2.3')
  // Le repli ordinaire est inchangé.
  assert.equal(repli('^6.0.3'), '6.0.3')
  assert.equal(repli('~7.0.2'), '7.0.2')
})

/* --------------------------------------------------- les plafonds */

// PLAFONNER N'EST PAS EXEMPTER. `MAJEURS_ADMIS` retire une version du compte
// des retards ; `PLAFONDS` ne fait que changer la RÉFÉRENCE. Confondre les deux
// aurait éteint un voyant : un alias resté en 7.0.2 quand la 7.0.9 existe serait
// passé pour à jour.

test('un paquet plafonné n’est PAS exempté du retard', () => {
  for (const paquet of Object.keys(PLAFONDS)) {
    assert.equal(
      majeurAdmis(paquet, '7.0.0'),
      false,
      `${paquet} est plafonné, il ne doit pas être exempté`
    )
    assert.ok(!(paquet in MAJEURS_ADMIS), `${paquet} ne doit pas figurer dans les DEUX tables`)
  }
})

test('tant que latest tient dans le plafond, amontAdmis ne change rien', () => {
  // L'état du 21/09/2026 : `latest` de typescript est 7.0.2, dans le plafond.
  assert.equal(amontAdmis('typescript-7', ['6.0.3', '7.0.1', '7.0.2'], '7.0.2'), '7.0.2')
  // Et un retard DANS la 7.x reste visible : la référence est bien 7.0.2.
  assert.equal(amontAdmis('typescript-7', ['7.0.1', '7.0.2'], '7.0.2'), '7.0.2')
})

test('le jour où latest sort du plafond, la référence devient la plus haute version admise', () => {
  const publiees = ['6.0.3', '7.0.2', '7.0.9', '8.0.0', '8.1.0']
  assert.equal(amontAdmis('typescript-7', publiees, '8.1.0'), '7.0.9')
})

test('amontAdmis écarte les préversions', () => {
  // Une `7.1.0-dev` n'est pas une cible : elle rétrograderait la référence sous
  // une version stable si elle triait devant.
  assert.equal(amontAdmis('typescript-7', ['7.0.2', '7.1.0-dev.20260921.1'], '8.0.0'), '7.0.2')
})

test('amontAdmis laisse intact tout paquet NON plafonné', () => {
  assert.equal(amontAdmis('react', ['19.1.0', '19.2.0'], '19.2.0'), '19.2.0')
  assert.equal(amontAdmis('typescript', ['6.0.3', '7.0.2'], '7.0.2'), '7.0.2')
  // Amont inconnu (hors ligne) : on ne fabrique pas une référence.
  assert.equal(amontAdmis('typescript-7', ['7.0.2'], null), null)
})

test('amontAdmis rend latest quand aucune version ne tient le plafond', () => {
  // Cas limite : la liste publiée ne contient rien d'admis. Mieux vaut une
  // référence fausse mais AFFICHÉE qu'un `null` qui éteindrait la colonne.
  assert.equal(amontAdmis('typescript-7', ['8.0.0', '8.1.0'], '8.1.0'), '8.1.0')
  assert.equal(amontAdmis('typescript-7', undefined, '8.1.0'), '8.1.0')
})

/* ── Relevé horaire : l'historique à deux sources, l'instantané, etat.json ── */

test('fusionneHistoriques unit les jours des deux sources sans en perdre un', () => {
  // Le dépôt a le 21 et le 22 ; la page en ligne a le 22 (plus frais) et le 23.
  const depot = [
    { jour: '2026-09-21', taux: 95 },
    { jour: '2026-09-22', taux: 96, alertes: 0 },
  ]
  const enLigne = [
    { jour: '2026-09-22', taux: 97, alertes: null },
    { jour: '2026-09-23', taux: 99 },
  ]
  assert.deepEqual(fusionneHistoriques(depot, enLigne), [
    { jour: '2026-09-21', taux: 95 },
    // la source la plus fraîche l'emporte — sauf là où elle ne sait rien
    { jour: '2026-09-22', taux: 97, alertes: 0 },
    { jour: '2026-09-23', taux: 99 },
  ])
})

test('fusionneHistoriques tient une source absente ou illisible pour vide', () => {
  const h = [{ jour: '2026-09-23', taux: 99 }]
  // La page en ligne illisible : le dépôt suffit, rien ne lève.
  assert.deepEqual(fusionneHistoriques(h, undefined), h)
  assert.deepEqual(fusionneHistoriques(null, h), h)
  assert.deepEqual(fusionneHistoriques('pas un tableau', h), h)
  // Un point sans jour n'a pas de place dans une courbe datée.
  assert.deepEqual(fusionneHistoriques([null, { taux: 1 }, { jour: 3 }], h), h)
})

test('fusionneHistoriques rend l’ordre du calendrier, quel que soit celui des sources', () => {
  const r = fusionneHistoriques([{ jour: '2026-09-23' }, { jour: '2026-09-01' }], [{ jour: '2026-09-12' }])
  assert.deepEqual(
    r.map((p) => p.jour),
    ['2026-09-01', '2026-09-12', '2026-09-23'],
  )
})

test('joursAbsents déclenche l’instantané au premier point d’un jour, et plus ensuite', () => {
  const depot = [{ jour: '2026-09-22' }]
  // Premier passage qui change quelque chose le 23 : le jour manque au dépôt.
  assert.deepEqual(joursAbsents(depot, [{ jour: '2026-09-22' }, { jour: '2026-09-23' }]), ['2026-09-23'])
  // Une fois l'instantané commité, les passages du même jour ne commitent plus.
  assert.deepEqual(joursAbsents([...depot, { jour: '2026-09-23' }], [{ jour: '2026-09-22' }, { jour: '2026-09-23' }]), [])
  // Un dépôt sans historique : tout est à écrire.
  assert.deepEqual(joursAbsents(undefined, [{ jour: '2026-09-23' }]), ['2026-09-23'])
})

test('etatPublie date la page publiée ET le passage, séparément', () => {
  const maintenant = Date.parse('2026-09-23T14:17:30Z')
  assert.deepEqual(etatPublie({ genere: '2026-09-23T09:57:45.678Z' }, maintenant), {
    genere: '2026-09-23T09:57:45.678Z',
    verifie: '2026-09-23T14:17:30.000Z',
  })
  // Sans page à décrire, `genere` reste nul plutôt qu'inventé.
  assert.equal(etatPublie(null, maintenant).genere, null)
})

/* ── Transitions nouvelles : sites, production, nouveau majeur, journal ── */

test('changementsDepuis relève le site qui tombe et celui qui revient — pas une mesure absente', () => {
  const av = avec([{ nom: 'a', pages: { ok: true } }, { nom: 'b', pages: { ok: false } }, { nom: 'c', pages: { ok: null } }])
  const ap = avec([{ nom: 'a', pages: { ok: false, url: 'https://a/' } }, { nom: 'b', pages: { ok: true, url: 'https://b/' } }, { nom: 'c', pages: { ok: false } }])
  const c = changementsDepuis(av, ap)
  assert.deepEqual(
    c.map((x) => [x.type, x.depot]),
    [
      ['site-tombe', 'a'],
      ['site-revenu', 'b'],
    ],
  )
})

test('changementsDepuis relève la production qui décroche — si elle était DÉJÀ mesurée', () => {
  const av = avec([{ nom: 'a', prod: { etat: 'aJour' } }, { nom: 'b' }])
  const ap = avec([{ nom: 'a', prod: { etat: 'retard', retard: 3 } }, { nom: 'b', prod: { etat: 'retard', retard: 9 } }])
  // `b` n'était pas mesurée avant : le premier relevé qui la lit n'annonce rien.
  assert.deepEqual(changementsDepuis(av, ap), [{ type: 'prod-retard', depot: 'a', retard: 3 }])
})

test('changementsDepuis marque un nouveau MAJEUR amont, et le fait passer devant', () => {
  const av = avec([], [{ paquet: 'prettier', amont: '3.9.8' }, { paquet: '@sentry/react', amont: '10.75.2' }])
  const ap = avec([], [{ paquet: 'prettier', amont: '3.9.9' }, { paquet: '@sentry/react', amont: '11.0.0' }])
  const c = changementsDepuis(av, ap)
  assert.deepEqual(
    c.map((x) => [x.paquet, x.majeur]),
    [
      ['@sentry/react', true],
      ['prettier', false],
    ],
  )
})

test('changementsDepuis : en 0.x, changer de mineure est un nouveau majeur', () => {
  const av = avec([], [{ paquet: 'rusqlite', amont: '0.32.1' }, { paquet: 'reqwest', amont: '0.13.4' }])
  const ap = avec([], [{ paquet: 'rusqlite', amont: '0.40.2' }, { paquet: 'reqwest', amont: '0.13.5' }])
  assert.deepEqual(
    changementsDepuis(av, ap).map((x) => [x.paquet, x.majeur]),
    [
      ['rusqlite', true],
      ['reqwest', false],
    ],
  )
})

test('serieDe : le majeur au-dessus de 1.0.0, la mineure en 0.x, le correctif en 0.0.z', () => {
  assert.equal(serieDe('10.75.2'), '10')
  assert.equal(serieDe('^6.0.3'), '6')
  assert.equal(serieDe('0.32.1'), '0.32')
  assert.equal(serieDe('~0.13.4'), '0.13')
  assert.equal(serieDe('0.0.3'), '0.0.3')
  // `majeurDe` reste ce qu'il dit : les majeurs admis nomment des majeurs.
  assert.equal(majeurDe('0.32.1'), '0')
})

test('estEnRetard : l’amont, les majeurs admis, et le plafond d’un moteur', () => {
  assert.equal(estEnRetard('vite', '8.2.9', '8.3.0', { depot: 'a' }), true)
  assert.equal(estEnRetard('vite', '8.3.0', '8.3.0', { depot: 'a' }), false)
  assert.equal(estEnRetard('vite', '8.2.9', null, { depot: 'a' }), false)
  // TypeScript 6 sous une 7 : admis, donc pas en retard.
  assert.equal(estEnRetard('typescript', '6.0.3', '7.0.2', { depot: 'a' }), false)
  // Un dépôt plafonné se juge sur son plafond : au-delà, à l'heure ; en deçà, en retard.
  assert.equal(estEnRetard('@types/vscode', '1.125.0', '1.138.0', { depot: 'x', plafond: '1.90.0' }), false)
  assert.equal(estEnRetard('@types/vscode', '1.85.0', '1.138.0', { depot: 'x', plafond: '1.90.0' }), true)
  assert.deepEqual(PLAFONDS_ENGINES, { '@types/vscode': 'vscode' })
})

test('fond ignore le journal, comme l’historique', () => {
  const a = modeleMinimal()
  const b = modeleMinimal()
  b.journal = [{ type: 'amont', paquet: 'vite', quand: '2026-09-23T10:17:00Z' }]
  assert.equal(fond(a), fond(b))
})
