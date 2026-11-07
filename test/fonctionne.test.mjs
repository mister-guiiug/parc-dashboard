// La sonde « fonctionne » : ce qu'elle sonde, ce qu'elle bloque, ce qu'elle
// conclut, et ce qu'elle en dit par issue.
//
// POURQUOI CES TESTS-LÀ. Trois jours durant, jusqu'au 07/11/2026, le jeu public de miss-arcade
// renvoyait 401 à chaque visiteur, et la page affichait « 200 / à jour ». La
// première sonde écrite pour le voir bloquait les POST — elle ne voyait donc
// PAS cette panne, et en inventait une autre (« jeu introuvable, Failed to
// fetch »). Chacun de ces défauts est muet : un faux vert ne lève rien, un
// faux rouge ouvre une issue à chaque heure. Ils se gardent ici.

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  RAISONS_SONDE,
  appDeLIssue,
  appsDuCatalogue,
  classeEchec,
  corpsIssue,
  dateUtc,
  decritRequete,
  estViolationCsp,
  etatBackend,
  lisSonde,
  masqueHote,
  masqueTexte,
  md,
  planAlertes,
  requeteBloquee,
  titreIssue,
  verdictSonde,
  verdictsDuReleve,
} from '../scripts/fonctionne.mjs'
import { phraseRaison } from '../scripts/vue.mjs'
import { traducteur } from '../scripts/libelles.mjs'

/* ── Les apps du catalogue ──────────────────────────────────────────────── */

// Extrait RÉEL de `apps-catalog.js` (dev-pwa-config, 07/11/2026), raccourci :
// le commentaire qui cite `FAMILY_APPS` et `appUrl` AVANT la déclaration, la
// fabrique `app()`, une entrée par défaut, l'entrée desktop, et ce qui suit
// la fin du tableau.
const CATALOGUE = `
// Fabrique une entrée de catalogue. \`appUrl\` par défaut = GitHub Pages.
//   - \`appUrl\`, \`repoUrl\`, \`themeColor\` (hébergement/casse custom) ;
//   - \`languages\`, \`features\` : voir \`FAMILY_APPS\`.
function app(id, name, description, maturity, overrides = {}) {
  const appUrl = overrides.appUrl ?? pagesUrl(id);
  return { id, platform: overrides.platform ?? 'web', appUrl };
}

export const FAMILY_APPS = [
  app(
    'miss-carbook',
    'Miss Carbook',
    'Comparatif collaboratif de véhicules, en temps réel.',
    'alpha',
    {
      descriptionEn: 'Collaborative vehicle comparison, in real time.',
      category: 'outils',
      backend: 'supabase',
    }
  ),
  app(
    'mister-quota',
    'Mister Quota',
    'Suivi de consommation des services IA (application desktop).',
    'alpha',
    // App Electron : pas de PWA hébergée → on pointe vers le dépôt (releases),
    // et pas d'icône web.
    {
      descriptionEn: 'AI service usage tracker (desktop app).',
      appUrl: repoUrl('mister-quota'),
      iconUrl: null,
      category: 'dev',
      platform: 'desktop',
    }
  ),
  app(
    'miss-arcade',
    'Miss Arcade',
    'Jeux tactiles pour stand et point de vente.',
    'alpha',
    // appUrl: 'https://ailleurs.example/' — un commentaire, pas un champ
    { category: 'loisirs', backend: 'supabase' }
  ),
  app('miss-ailleurs', 'Miss Ailleurs', 'Hébergée hors Pages.', 'beta', {
    appUrl: 'https://ailleurs.example/app/',
    repoUrl: 'https://github.com/mister-guiiug/ailleurs-depot',
  }),
];

/** Les apps de la famille SAUF celle d'id \`currentId\` (ordre préservé). */
export function otherApps(currentId) {
  return FAMILY_APPS.filter(a => a.id !== currentId);
}
const piege = app('hors-tableau', 'x', 'y', 'alpha');
`

test('appsDuCatalogue : les apps web, à leur adresse, et pas l’app desktop', () => {
  assert.deepEqual(appsDuCatalogue(CATALOGUE, 'mister-guiiug'), [
    { id: 'miss-carbook', depot: 'miss-carbook', url: 'https://mister-guiiug.github.io/miss-carbook/' },
    // un commentaire qui écrit « appUrl: » n'est pas un champ
    { id: 'miss-arcade', depot: 'miss-arcade', url: 'https://mister-guiiug.github.io/miss-arcade/' },
    { id: 'miss-ailleurs', depot: 'ailleurs-depot', url: 'https://ailleurs.example/app/' },
  ])
})

test('appsDuCatalogue : sans déclaration lisible, aucune app — et la sonde s’arrête', () => {
  assert.deepEqual(appsDuCatalogue('', 'x'), [])
  assert.deepEqual(appsDuCatalogue(null, 'x'), [])
  // une simple mention dans un commentaire ne fait pas un catalogue
  assert.deepEqual(appsDuCatalogue("// voir FAMILY_APPS\napp('a', 'b')", 'x'), [])
})

/* ── Ce que la sonde bloque ─────────────────────────────────────────────── */

const PAGES = 'mister-guiiug.github.io'
const bloque = (methode, url) => requeteBloquee({ methode, url, hotePages: PAGES })

test('requeteBloquee : le jeu public de miss-arcade se lit en POST /rpc — il PASSE', () => {
  // La première sonde le bloquait, et prenait son propre blocage pour une panne.
  assert.equal(bloque('POST', 'https://wksbsqwjbqfnsgqwjzon.supabase.co/rest/v1/rpc/jeu_public'), null)
  assert.equal(bloque('POST', 'https://firestore.googleapis.com/google.firestore.v1.Firestore/Listen/channel?VER=8'), null)
})

test('requeteBloquee : aucune écriture vers un tiers, aucune session, aucune mesure d’audience', () => {
  assert.equal(bloque('POST', 'https://wksbsqwjbqfnsgqwjzon.supabase.co/rest/v1/arcade_leads'), 'ecriture')
  assert.equal(bloque('PATCH', 'https://wksbsqwjbqfnsgqwjzon.supabase.co/rest/v1/rpc/jeu_public'), 'ecriture')
  assert.equal(bloque('POST', 'https://wksbsqwjbqfnsgqwjzon.supabase.co/storage/v1/object/branding/x.png'), 'ecriture')
  assert.equal(bloque('POST', 'https://firestore.googleapis.com/google.firestore.v1.Firestore/Write/channel'), 'ecriture')
  assert.equal(bloque('POST', 'https://x.supabase.co/auth/v1/signup'), 'session')
  assert.equal(bloque('POST', 'https://x.supabase.co/auth/v1/token?grant_type=password'), 'session')
  assert.equal(bloque('POST', 'https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=k'), 'session')
  assert.equal(bloque('GET', 'https://eu.i.posthog.com/decide/'), 'analytique')
  assert.equal(bloque('POST', 'https://o1.ingest.sentry.io/api/1/envelope/'), 'analytique')
})

test('requeteBloquee : les lectures passent, et tout ce qui vise Pages', () => {
  assert.equal(bloque('GET', 'https://x.supabase.co/rest/v1/jeux?select=*'), null)
  assert.equal(bloque('HEAD', 'https://mister-guiiug.github.io/miss-arcade/version.json'), null)
  assert.equal(bloque('POST', 'https://mister-guiiug.github.io/miss-arcade/x'), null)
  assert.equal(bloque('GET', 'pas une url'), null)
})

test('classeEchec : une requête annulée ou bloquée par la sonde n’est pas un échec', () => {
  assert.equal(classeEchec('net::ERR_ABORTED'), 'ignore')
  assert.equal(classeEchec('net::ERR_BLOCKED_BY_CLIENT'), 'ignore')
  assert.equal(classeEchec('net::ERR_BLOCKED_BY_CSP'), 'csp')
  assert.equal(classeEchec('net::ERR_NAME_NOT_RESOLVED'), 'echec')
  assert.equal(classeEchec(''), 'echec')
})

test('estViolationCsp : une politique Report-Only ne bloque rien', () => {
  assert.equal(estViolationCsp("Refused to connect to 'https://x.supabase.co/' because it violates the following Content Security Policy directive: \"connect-src 'self'\"."), true)
  assert.equal(estViolationCsp("[Report Only] Refused to load the script 'https://x/' because it violates the following Content Security Policy directive"), false)
  assert.equal(estViolationCsp('TypeError: Failed to fetch'), false)
})

test('masqueHote : la nature et quatre caractères, rien de plus', () => {
  assert.equal(masqueHote('wksbsqwjbqfnsgqwjzon.supabase.co', PAGES), 'supabase:wksb…')
  assert.equal(masqueHote('firestore.googleapis.com', PAGES), 'firebase:googleapis.com')
  assert.equal(masqueHote('proxy-abc.mister.workers.dev', PAGES), 'worker:prox…')
  assert.equal(masqueHote(PAGES, PAGES), 'self')
  assert.equal(masqueHote('api.frankfurter.dev', PAGES), 'api.frankfurter.dev')
})

test('masqueTexte et decritRequete : ni hôte en clair, ni requête (apikey)', () => {
  assert.equal(
    masqueTexte('GET https://wksbsqwjbqfnsgqwjzon.supabase.co/rest/v1/x 401   (Unauthorized)', PAGES),
    'GET supabase:wksb…/rest/v1/x 401 (Unauthorized)',
  )
  assert.equal(
    decritRequete('https://wksbsqwjbqfnsgqwjzon.supabase.co/rest/v1/rpc/jeu_public?apikey=secret', PAGES, 'HTTP 401'),
    'supabase:wksb… /rest/v1/rpc/jeu_public HTTP 401',
  )
  assert.equal(decritRequete('https://mister-guiiug.github.io/miss-arcade/assets/a-1.js', PAGES, 'HTTP 404'), 'self /miss-arcade/assets/a-1.js HTTP 404')
})

/* ── Le verdict ─────────────────────────────────────────────────────────── */

const sain = { http: 200, react: true, servi: false, csp: [], echecs: [], backends: [] }

test('verdictSonde : une app saine fonctionne — même si elle journalise l’échec de son worker', () => {
  // mister-cim10 et mister-doc, le 07/11/2026 : la sonde bloque le service
  // worker, l'app le dit en console. Ce n'est pas une panne.
  const v = verdictSonde({ ...sain, console: ["[pwa] Service worker registration error {error: TypeError: Cannot read properties of undefined (reading 'waiting')}"] })
  assert.deepEqual(v, { etat: 'ok', raisons: [] })
})

test('verdictSonde : le 401 du jeu public de miss-arcade — répond, mais ne fonctionne pas', () => {
  const v = verdictSonde({ ...sain, echecs: ['supabase:wksb… /rest/v1/rpc/jeu_public HTTP 401', 'supabase:wksb… /rest/v1/rpc/jeu_public HTTP 401'] })
  assert.equal(v.etat, 'ko')
  // la même requête deux fois est UNE requête en échec
  assert.deepEqual(v.raisons, [{ cle: 'requetes', n: 1, exemple: 'supabase:wksb… /rest/v1/rpc/jeu_public HTTP 401' }])
})

test('verdictSonde : React qui ne monte pas, ou qui laisse le contenu servi en place', () => {
  assert.deepEqual(verdictSonde({ ...sain, react: false }).raisons, [{ cle: 'react' }])
  assert.deepEqual(verdictSonde({ ...sain, servi: true }).raisons, [{ cle: 'react' }])
  assert.deepEqual(verdictSonde({ ...sain, ecranErreur: true }).raisons, [{ cle: 'ecranErreur' }])
})

test('verdictSonde : une page qui ne se charge pas ne se juge pas en plus sur son montage', () => {
  assert.deepEqual(verdictSonde({ http: 404, react: false, servi: false }).raisons, [{ cle: 'http', code: 404 }])
  assert.deepEqual(verdictSonde({ erreur: 'page.goto: Timeout 45000ms exceeded.', http: null, react: false }).raisons, [
    { cle: 'chargement', erreur: 'page.goto: Timeout 45000ms exceeded.' },
  ])
})

test('verdictSonde : CSP et backend injoignable, dans l’ordre des raisons', () => {
  const v = verdictSonde({
    ...sain,
    csp: ["Refused to connect to 'supabase:wksb…'", "Refused to connect to 'supabase:wksb…'"],
    backends: [
      { hote: 'supabase:ucnq…', etat: 'HTTP 401', injoignable: false },
      { hote: 'supabase:wksb…', etat: 'injoignable (ENOTFOUND)', injoignable: true },
    ],
  })
  assert.deepEqual(
    v.raisons.map((r) => r.cle),
    ['csp', 'backend'],
  )
  assert.equal(v.raisons[0].n, 1)
  assert.equal(v.raisons[1].exemple, 'supabase:wksb… injoignable (ENOTFOUND)')
  // l'ordre déclaré est bien celui que rend le verdict
  const rangs = verdictSonde({ http: 500, ecranErreur: true, csp: ['a'], echecs: ['b'], backends: [{ hote: 'h', etat: 'e', injoignable: true }] }).raisons.map((r) => RAISONS_SONDE.indexOf(r.cle))
  assert.deepEqual(rangs, [...rangs].sort((a, b) => a - b))
})

test('etatBackend : 401 sans clé est un projet VIVANT ; 5xx ou rien, injoignable', () => {
  assert.deepEqual(etatBackend({ status: 401 }), { etat: 'HTTP 401', injoignable: false })
  assert.deepEqual(etatBackend({ status: 540 }), { etat: 'HTTP 540', injoignable: true })
  assert.deepEqual(etatBackend({ erreur: 'ENOTFOUND' }), { etat: 'injoignable (ENOTFOUND)', injoignable: true })
})

/* ── Du fichier au modèle ───────────────────────────────────────────────── */

const SONDE = {
  version: 1,
  date: '2026-11-07T12:17:00.000Z',
  apps: [
    { id: 'miss-arcade', depot: 'miss-arcade', url: 'u', etat: 'ko', raisons: [{ cle: 'requetes', n: 1, exemple: 'e' }], essais: 2 },
    { id: 'miss-dice', depot: 'miss-dice', url: 'u', etat: 'ok', raisons: [], essais: 1 },
  ],
}

test('lisSonde refuse un fichier partiel plutôt que d’y lire « tout fonctionne »', () => {
  assert.equal(lisSonde(null), null)
  assert.equal(lisSonde({ date: 'hier', apps: SONDE.apps }), null)
  assert.equal(lisSonde({ date: SONDE.date, apps: [] }), null)
  assert.equal(lisSonde({ date: SONDE.date, apps: [{ id: 'x', etat: 'peut-être' }] }), null)
  assert.equal(lisSonde(SONDE).apps.length, 2)
})

test('verdictsDuReleve : une sonde fraîche donne ses verdicts, sans ses essais', () => {
  const r = verdictsDuReleve(lisSonde(SONDE), null)
  assert.deepEqual(r.sonde, { date: SONDE.date, apps: 2, ko: 1 })
  assert.deepEqual(r.parDepot.get('miss-arcade'), { etat: 'ko', raisons: [{ cle: 'requetes', n: 1, exemple: 'e' }] })
  assert.deepEqual(r.parDepot.get('miss-dice'), { etat: 'ok', raisons: [] })
})

test('verdictsDuReleve : sans sonde, ceux de la page en ligne sont REPRIS avec leur date', () => {
  const precedent = { sonde: { date: '2026-11-07T03:17:00.000Z', apps: 2, ko: 0, manquante: false }, depots: [{ nom: 'miss-dice', sonde: { etat: 'ok', raisons: [] } }, { nom: 'x' }] }
  const r = verdictsDuReleve(null, precedent)
  assert.deepEqual(r.sonde, { date: '2026-11-07T03:17:00.000Z', apps: 2, ko: 0 })
  assert.deepEqual([...r.parDepot.keys()], ['miss-dice'])
  // ni sonde ni page : `null`, que la page dit — pas un parc « sans souci »
  assert.deepEqual(verdictsDuReleve(null, null).sonde, null)
  assert.deepEqual(verdictsDuReleve(null, { depots: [] }).sonde, null)
})

/* ── L'alerte ───────────────────────────────────────────────────────────── */

const T = traducteur('fr')
const CTX = { quand: '2026-11-07T12:17:00.000Z', phrase: (r) => phraseRaison(r, T), page: 'https://mister-guiiug.github.io/parc-dashboard/', run: 'https://github.com/o/r/actions/runs/1' }
const ko = (id, raisons = [{ cle: 'requetes', n: 1, exemple: 'supabase:wksb… /rest/v1/rpc/jeu_public HTTP 401' }]) => ({ id, url: `https://h/${id}/`, etat: 'ko', raisons })
const ok = (id) => ({ id, url: `https://h/${id}/`, etat: 'ok', raisons: [] })
const issue = (numero, app, state, raisons, depuis = '2026-11-06T08:00:00.000Z') => ({
  number: numero,
  state,
  title: titreIssue(app.id),
  body: corpsIssue({ ...app, raisons: raisons ?? app.raisons }, { ...CTX, depuis }),
})

test('corpsIssue : marque stable, raisons en phrases, texte de l’app échappé', () => {
  const c = corpsIssue({ ...ko('miss-arcade'), console: ['x `y` z'] }, { ...CTX, depuis: CTX.quand })
  assert.equal(appDeLIssue(c), 'miss-arcade')
  assert.match(c, /^- 1 requête en échec — supabase:wksb… \/rest\/v1\/rpc\/jeu\\_public HTTP 401$/m)
  assert.match(c, /\| En panne depuis \| 2026-11-07 12:17 UTC \|/)
  assert.match(c, /#depot-miss-arcade/)
  // la console est jointe, sans pouvoir fermer son bloc de code
  assert.match(c, /x 'y' z/)
  assert.equal(md('a_b*<c>'), 'a\\_b\\*\\<c\\>')
  assert.equal(dateUtc('pas une date'), '—')
})

test('planAlertes : une app qui échoue sans issue en ouvre UNE', () => {
  const p = planAlertes([ko('miss-arcade'), ok('miss-dice')], [], CTX)
  assert.equal(p.length, 1)
  assert.equal(p[0].type, 'creer')
  assert.equal(p[0].titre, 'Sonde : miss-arcade ne fonctionne pas')
  assert.equal(appDeLIssue(p[0].corps), 'miss-arcade')
})

test('planAlertes : la même panne à l’heure suivante ne touche à rien — aucun doublon, aucun bruit', () => {
  const app = ko('miss-arcade')
  assert.deepEqual(planAlertes([app], [issue(12, app, 'open')], CTX), [])
})

test('planAlertes : un autre exemple de la même raison met l’issue à jour sans commenter', () => {
  const app = ko('miss-arcade')
  const avant = issue(12, app, 'open', [{ cle: 'requetes', n: 1, exemple: 'autre chemin' }])
  const [a] = planAlertes([app], [avant], CTX)
  assert.equal(a.type, 'maj')
  assert.equal(a.numero, 12)
  assert.equal(a.commentaire, null)
  // « en panne depuis » garde la date de la première constatation
  assert.match(a.corps, /<!-- depuis:2026-11-06T08:00:00.000Z -->/)
})

test('planAlertes : une panne qui change de NATURE se commente — c’est ce qui notifie', () => {
  const app = ko('miss-arcade', [{ cle: 'react' }])
  const [a] = planAlertes([app], [issue(12, ko('miss-arcade'), 'open')], CTX)
  assert.equal(a.type, 'maj')
  assert.match(a.commentaire, /La panne a changé/)
  assert.match(a.commentaire, /React n'a pas monté/)
})

test('planAlertes : une app retombée rouvre SON issue, et ne crée rien', () => {
  const app = ko('miss-arcade')
  const p = planAlertes([app], [issue(7, app, 'closed'), issue(3, app, 'closed')], CTX)
  assert.deepEqual(
    p.map((a) => [a.type, a.numero]),
    [['rouvrir', 7]],
  )
  assert.match(p[0].commentaire, /De nouveau en panne/)
  assert.match(p[0].corps, /<!-- depuis:2026-11-07T12:17:00.000Z -->/)
})

test('planAlertes : une app qui repasse ferme son issue, avec un mot', () => {
  const p = planAlertes([ok('miss-arcade')], [issue(12, ko('miss-arcade'), 'open')], CTX)
  assert.deepEqual(
    p.map((a) => [a.type, a.numero, a.raison]),
    [['fermer', 12, 'completed']],
  )
  assert.match(p[0].commentaire, /Repassée/)
  // et une app saine sans issue ouverte ne fait rien
  assert.deepEqual(planAlertes([ok('miss-arcade')], [issue(12, ko('miss-arcade'), 'closed')], CTX), [])
})

test('planAlertes : une issue dont l’app n’est plus sondée se ferme — mais pas sur une sonde vide', () => {
  const ouverte = issue(9, ko('mister-ancienne'), 'open')
  const p = planAlertes([ok('miss-dice')], [ouverte], CTX)
  assert.deepEqual(
    p.map((a) => [a.type, a.numero, a.raison]),
    [['fermer', 9, 'not_planned']],
  )
  assert.deepEqual(planAlertes([], [ouverte], CTX), [])
})

test('planAlertes : deux issues pour une app, l’OUVERTE fait foi ; les autres issues sont ignorées', () => {
  const app = ko('miss-arcade')
  const etrangere = { number: 1, state: 'open', title: 'Sonde : miss-arcade ne fonctionne pas', body: 'écrite à la main, sans marque' }
  const p = planAlertes([ok('miss-arcade')], [issue(20, app, 'closed'), issue(15, app, 'open'), etrangere], CTX)
  assert.deepEqual(
    p.map((a) => [a.type, a.numero]),
    [['fermer', 15]],
  )
})
