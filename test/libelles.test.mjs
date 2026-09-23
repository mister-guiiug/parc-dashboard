// Les libellés, et le contrat entre les deux langues.
//
// POURQUOI CES TESTS-LÀ. Une traduction ne casse rien : elle s'affiche. Un
// oubli ne lève aucune exception, ne rougit aucune CI, et se voit seulement si
// quelqu'un ouvre la page DANS l'autre langue — ce qui, sur un instrument de
// bord, peut n'arriver jamais. Les défauts de ce fichier sont donc tous
// silencieux, et c'est exactement le profil qui mérite une garde automatique.
//
// Quatre familles de garde :
//
//  1. LE CONTRAT ENTRE LANGUES — mêmes clés, mêmes interpolations, mêmes formes
//     de pluriel. Une clé traduite à moitié retombe sur le français sans le
//     dire.
//  2. LES DEUX SENS DE L'USAGE — toute clé demandée par la page existe, et
//     toute clé du dictionnaire est demandée. Le second sens attrape le texte
//     mort, celui qu'on traduit encore des mois après l'avoir retiré de
//     l'écran.
//  3. LE HTML SERVI DIT LA MÊME CHOSE QUE LE DICTIONNAIRE. Le gabarit porte le
//     français en clair — pour les moteurs, les aperçus de lien et `noscript` —
//     et le JavaScript le remplace au chargement. Deux sources pour un même
//     texte, donc deux textes qui divergent : sauf si un test les compare.
//  4. CE QUE LES MODULES DE CALCUL ÉMETTENT. `regles.mjs`, `modele.mjs` et
//     `vue.mjs` rendent des clés ; aucune ne doit manquer au dictionnaire.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

import { DEFAUT, LANGUES, LIBELLES, choisitLangue, interpole, traducteur } from '../scripts/libelles.mjs'
import { SOCLE, classe } from '../scripts/regles.mjs'
import { GRAVITES, GROUPES, ORDRE_A_FAIRE, PERIODES, elementsHorsNpm } from '../scripts/vue.mjs'
import { pileDuDepot } from '../scripts/modele.mjs'

const ICI = dirname(fileURLToPath(import.meta.url))
const lis = (f) => readFileSync(join(ICI, '..', 'scripts', f), 'utf8')
const GABARIT = lis('gabarit.html')
const CODES = LANGUES.map(([c]) => c)

/* ── 1. Le contrat entre langues ────────────────────────────────────────── */

test('les deux langues portent EXACTEMENT les mêmes clés', () => {
  const reference = Object.keys(LIBELLES[DEFAUT]).sort()
  for (const code of CODES) {
    const siennes = Object.keys(LIBELLES[code]).sort()
    // Nommer ce qui manque : « 320 ≠ 319 » n'aide personne à le corriger.
    assert.deepEqual(
      siennes.filter((c) => !reference.includes(c)),
      [],
      `${code} : clés en trop`,
    )
    assert.deepEqual(
      reference.filter((c) => !siennes.includes(c)),
      [],
      `${code} : clés manquantes`,
    )
  }
})

test('un pluriel dans une langue est un pluriel dans toutes', () => {
  // Une valeur restée simple là où l'autre langue accorde ne lève rien : elle
  // affiche « 1 repositories », et il faut l'avoir sous les yeux pour le voir.
  for (const cle of Object.keys(LIBELLES[DEFAUT])) {
    const formes = CODES.map((c) => typeof LIBELLES[c][cle])
    assert.equal(new Set(formes).size, 1, `${cle} : ${CODES.map((c, i) => `${c}=${formes[i]}`).join(', ')}`)
  }
})

test('un pluriel porte one ET other, et rien de superflu', () => {
  for (const code of CODES) {
    for (const [cle, v] of Object.entries(LIBELLES[code])) {
      if (typeof v !== 'object') continue
      assert.deepEqual(Object.keys(v).sort(), ['one', 'other'], `${code} / ${cle}`)
      for (const forme of Object.values(v)) assert.equal(typeof forme, 'string', `${code} / ${cle}`)
    }
  }
})

/** Les `{marqueurs}` d'une valeur, toutes formes de pluriel confondues. */
const marqueurs = (v) => new Set([...String(typeof v === 'object' ? Object.values(v).join(' ') : v).matchAll(/\{(\w+)\}/g)].map((m) => m[1]))

test('les interpolations sont les mêmes d’une langue à l’autre', () => {
  // Une traduction qui perd son `{n}` affiche une phrase sans son chiffre ; une
  // qui en invente un affiche « {depot} » tel quel à l'écran.
  for (const cle of Object.keys(LIBELLES[DEFAUT])) {
    const attendus = [...marqueurs(LIBELLES[DEFAUT][cle])].sort()
    for (const code of CODES) {
      assert.deepEqual([...marqueurs(LIBELLES[code][cle])].sort(), attendus, `${cle} en ${code}`)
    }
  }
})

test('toutes les formes d’un même pluriel portent les mêmes interpolations', () => {
  for (const code of CODES) {
    for (const [cle, v] of Object.entries(LIBELLES[code])) {
      if (typeof v !== 'object') continue
      const [un, autre] = [marqueurs(v.one), marqueurs(v.other)]
      assert.deepEqual([...un].sort(), [...autre].sort(), `${code} / ${cle}`)
    }
  }
})

test('un pluriel qui compte un TOTAL accorde sur le total', () => {
  // « 1 sur 92 paquet » : le défaut vient de ce que `Intl.PluralRules` tranche
  // sur `n`, et que la première écriture passait le nombre FILTRÉ sous ce nom.
  // La convention est donc : `{n}` est ce sur quoi on accorde, `{vus}` le reste.
  for (const code of CODES) {
    for (const [cle, v] of Object.entries(LIBELLES[code])) {
      if (typeof v !== 'object') continue
      const m = marqueurs(v)
      if (!m.has('vus')) continue
      assert.ok(m.has('n'), `${code} / ${cle} : {vus} sans {n}`)
    }
  }
})

/* ── Le traducteur ──────────────────────────────────────────────────────── */

test('le pluriel suit la langue, et pas une règle écrite à la main', () => {
  const dicos = { fr: { x: { one: '{n} dépôt', other: '{n} dépôts' } }, en: { x: { one: '{n} repository', other: '{n} repositories' } } }
  const fr = traducteur('fr', dicos)
  const en = traducteur('en', dicos)
  // ZÉRO EST LE CAS QUI SÉPARE LES DEUX LANGUES : singulier en français,
  // pluriel en anglais. `n > 1 ? 's' : ''` ne pouvait pas le savoir.
  assert.equal(fr('x', { n: 0 }), '0 dépôt')
  assert.equal(en('x', { n: 0 }), '0 repositories')
  assert.equal(fr('x', { n: 1 }), '1 dépôt')
  assert.equal(en('x', { n: 1 }), '1 repository')
  assert.equal(fr('x', { n: 2 }), '2 dépôts')
  assert.equal(en('x', { n: 2 }), '2 repositories')
})

test('une clé inconnue REND LA CLÉ plutôt que de vider la page', () => {
  // Un tableau de bord dont le rendu lève n'affiche plus rien du tout ; une clé
  // en clair se voit, se lit, et ne coûte que la ligne qu'elle occupe.
  const T = traducteur('fr', { fr: {} })
  assert.equal(T('depots.h2'), 'depots.h2')
  assert.equal(T.connait('depots.h2'), false)
})

test('une langue inconnue retombe sur le défaut, sans lever', () => {
  const T = traducteur('xx')
  assert.equal(T('depots.h2'), LIBELLES[DEFAUT]['depots.h2'])
})

test('une clé absente d’une langue retombe sur le français', () => {
  const T = traducteur('en', { fr: { a: 'français' }, en: {} })
  assert.equal(T('a'), 'français')
})

test('ouTelQuel traduit les clés et laisse passer les noms propres', () => {
  const T = traducteur('fr')
  assert.equal(T.ouTelQuel('role.vscode'), 'extension VS Code')
  // Electron, Rust, C# : le relevé les rend tels quels, et leur inventer une
  // clé n'aurait fait qu'un détour pour rendre la même chaîne.
  assert.equal(T.ouTelQuel('Electron'), 'Electron')
  assert.equal(T.ouTelQuel('4.21.1'), '4.21.1')
  assert.equal(T.ouTelQuel(null), null)
})

test('interpole laisse VISIBLE un paramètre qu’on a oublié de passer', () => {
  // Une chaîne vide ferait une phrase boiteuse qu'on relit dix fois sans voir ;
  // « {depot} » à l'écran dit exactement où chercher.
  assert.equal(interpole('{a} et {b}', { a: 'x' }), 'x et {b}')
  assert.equal(interpole('{n} j', { n: 0 }), '0 j')
})

test('choisitLangue compare sur la BASE, pas sur la région', () => {
  assert.equal(choisitLangue(['fr-CA']), 'fr')
  assert.equal(choisitLangue(['en-GB', 'fr']), 'en')
  assert.equal(choisitLangue(['de-DE', 'en-US']), 'en', 'on descend la liste du navigateur')
  assert.equal(choisitLangue(['de']), DEFAUT, 'aucune ne correspond')
  assert.equal(choisitLangue([]), DEFAUT)
  assert.equal(choisitLangue(null), DEFAUT)
  assert.equal(choisitLangue(['']), DEFAUT)
})

/* ── 2. Les deux sens de l'usage ────────────────────────────────────────── */

/**
 * LES CLÉS CONSTRUITES À L'EXÉCUTION, déclarées ici faute de pouvoir être lues.
 *
 * `T('etat.' + etat)` ne laisse aucun littéral à trouver dans la source. Chaque
 * famille nomme donc la fonction qui décide de ses membres, et la liste est
 * vérifiée dans les DEUX sens : aucun membre ne manque, et aucune clé de la
 * famille ne traîne hors de la liste.
 */
const FAMILLES_DYNAMIQUES = [
  // `etatDe()` de regles.mjs ne rend que ces cinq états.
  { prefixe: 'etat.', membres: ['vert', 'rouge', 'neutre', 'encours', 'jamais', 'neutre.long'] },
  // `etatDormance()` de modele.mjs, plus l'aide de chaque état.
  { prefixe: 'dormance.', membres: ['arretee', 'archivee', 'sans-version', 'inconnue'].flatMap((e) => [e, e + '.aide']), partielle: true },
  // `maturitesDuCatalogue()` rend alpha|beta|stable ; `aucune` est le défaut de la page.
  { prefixe: 'maturite.', membres: ['alpha', 'beta', 'stable', 'aucune'] },
  // `rangEcart()` de vue.mjs, moins les deux rangs sans écart (`0`, `absent`).
  { prefixe: 'matrice.rang.', membres: ['majeure', 'mineure', 'patch'] },
  // `changementsDepuis()` de regles.mjs — les onze types de son barème `rang`.
  {
    prefixe: 'changements.',
    membres: ['ci-rouge', 'ci-vert', 'alertes', 'dormante', 'reveillee', 'amont', 'depot-entre', 'depot-sorti', 'site-tombe', 'site-revenu', 'prod-retard'],
    partielle: true,
  },
  // `aFaire()` de vue.mjs : une entrée par clé de `ORDRE_A_FAIRE`, importé —
  // une rubrique ajoutée demain n'aura pas à être recopiée ici.
  { prefixe: 'afaire.', membres: ORDRE_A_FAIRE, partielle: true },
  // `graviteRetard()` de vue.mjs.
  { prefixe: 'gravite.', membres: GRAVITES },
  // `etatProd()` de collecte.mjs, plus `absente` — une production sans
  // `version.json`, que la page distingue d'une comparaison impossible.
  { prefixe: 'carte.prod.', membres: ['aJour', 'equivalent', 'deploiement', 'retard', 'inconnu', 'absente'], partielle: true },
  // `etatChecks()` de collecte.mjs, `jamais` quand une PR n'a aucun check.
  { prefixe: 'pr.ci.', membres: ['vert', 'rouge', 'encours', 'jamais'] },
  // `FAMILLES` de releve.mjs, trois libellés chacune.
  { prefixe: 'famille.', membres: ['pwa', 'desktop', 'socle', 'autre'].flatMap((f) => [f + '.titre', f + '.sous', f + '.court']), partielle: true },
  // `GROUPES` de vue.mjs, importé : depuis qu'il ne porte plus que des clés
  // nues, `groupe.lang` n'existe en littéral nulle part.
  { prefixe: 'groupe.', membres: GROUPES },
  // `surN()` de la matrice : deux formes par axe.
  { prefixe: 'matrice.compteur.', membres: ['paquets', 'paquetsSur', 'depots', 'depotsSur', 'ecarts'], partielle: true },
]

test('les familles de clés construites à l’exécution sont complètes', () => {
  for (const { prefixe, membres, partielle } of FAMILLES_DYNAMIQUES) {
    for (const m of membres) assert.ok(LIBELLES[DEFAUT][prefixe + m] !== undefined, `clé manquante : ${prefixe}${m}`)
    if (partielle) continue
    // Le sens inverse : une clé de la famille absente de la liste est du texte
    // que plus rien ne demande.
    const trouvees = Object.keys(LIBELLES[DEFAUT])
      .filter((c) => c.startsWith(prefixe))
      .map((c) => c.slice(prefixe.length))
    assert.deepEqual(
      trouvees.filter((c) => !membres.includes(c)),
      [],
      `${prefixe} : clés hors de la liste déclarée`,
    )
  }
})

test('la liste des familles du relevé est bien celle que le dictionnaire traduit', () => {
  // `FAMILLES` n'est pas exportée — le relevé s'exécute à l'import. On la lit
  // donc dans la source, pour que la liste déclarée ci-dessus ne puisse pas
  // vieillir en silence le jour où une cinquième famille apparaît.
  const m = /^const FAMILLES = \[([^\]]+)\]/m.exec(readFileSync(join(ICI, '..', 'scripts', 'releve.mjs'), 'utf8'))
  assert.ok(m, 'FAMILLES introuvable dans releve.mjs')
  const familles = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1])
  const declarees = FAMILLES_DYNAMIQUES.find((f) => f.prefixe === 'famille.').membres
  for (const f of familles) {
    for (const suffixe of ['.titre', '.sous', '.court']) assert.ok(declarees.includes(f + suffixe), `famille ${f} non déclarée dans le test`)
  }
})

/** Les clés demandées EXPLICITEMENT : `data-t*` du balisage et `T('…')` du code. */
function clesDemandees() {
  const out = new Set()
  for (const m of GABARIT.matchAll(/\bdata-t(?:h|-[a-z-]+)?="([^"]+)"/g)) out.add(m[1])
  // `T('cle'`, `T.ouTelQuel('cle'`, et la forme ternaire `T(c ? 'a' : 'b'`.
  //
  // LE LITTÉRAL DOIT ÊTRE L'ARGUMENT ENTIER — d'où le `[,)]` : `T('etat.' + x)`
  // commence par une chaîne qui n'est qu'un PRÉFIXE, et la compter comme une
  // clé faisait réclamer au test un libellé nommé « etat. ».
  for (const m of GABARIT.matchAll(/\bT(?:\.ouTelQuel)?\(\s*'([^']+)'\s*[,)]/g)) out.add(m[1])
  for (const m of GABARIT.matchAll(/\bT\(\s*[^()']*\?\s*'([^']+)'\s*:\s*'([^']+)'/g)) {
    out.add(m[1])
    out.add(m[2])
  }
  return out
}

test('toute clé demandée par la page EXISTE dans les deux langues', () => {
  const inconnues = []
  for (const cle of clesDemandees()) {
    for (const code of CODES) if (LIBELLES[code][cle] === undefined) inconnues.push(`${cle} (${code})`)
  }
  assert.deepEqual(inconnues, [], 'clés demandées mais absentes du dictionnaire')
})

test('toute clé du dictionnaire est DEMANDÉE quelque part', () => {
  // Le sens qui attrape le texte mort : une section retirée de l'écran laisse
  // ses phrases ici, et on continue de les traduire pendant des mois.
  const vues = clesDemandees()
  // Les clés écrites en littéral par les modules de calcul (`role.*`,
  // `pile.*`, `periode.*`, `element.ver.*`) et celles construites à
  // l'exécution.
  // `releve.mjs` en est depuis le flux Atom : il demande `flux.titre`, que la
  // page ne dit jamais.
  const sources = GABARIT + lis('vue.mjs') + lis('modele.mjs') + lis('regles.mjs') + lis('releve.mjs')
  for (const m of sources.matchAll(/'([a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9-]+)+)'/g)) vues.add(m[1])
  for (const { prefixe, membres } of FAMILLES_DYNAMIQUES) for (const x of membres) vues.add(prefixe + x)
  const orphelines = Object.keys(LIBELLES[DEFAUT]).filter((c) => !vues.has(c))
  assert.deepEqual(orphelines, [], 'clés que plus rien ne demande')
})

/* ── 3. Le HTML servi dit la même chose que le dictionnaire ─────────────── */

const espaces = (s) => s.replace(/\s+/g, ' ').trim()

test('le texte SERVI est celui du dictionnaire français', () => {
  // Le gabarit porte le français en clair, et le script le remplace au
  // chargement. Deux écritures du même texte : sans ce test, corriger l'une
  // laisse l'autre — et c'est la version servie que lisent les moteurs, les
  // aperçus de lien, et quiconque a coupé JavaScript.
  const ecarts = []
  for (const m of GABARIT.matchAll(/<(\w+)\b([^>]*?)\bdata-(t|th)="([^"]+)"([^>]*?)>([\s\S]*?)<\/\1>/g)) {
    const [, , , , cle, , contenu] = m
    const attendu = LIBELLES[DEFAUT][cle]
    if (typeof attendu !== 'string') continue
    if (espaces(contenu) !== espaces(attendu)) ecarts.push(`${cle}\n  servi : ${espaces(contenu)}\n  dico  : ${espaces(attendu)}`)
  }
  assert.deepEqual(ecarts, [])
  // Le compte, pour qu'une regex qui cesserait d'accrocher ne rende pas ce
  // test vert par le vide.
  const accroches = [...GABARIT.matchAll(/<(\w+)\b[^>]*?\bdata-(?:t|th)="[^"]+"[^>]*?>[\s\S]*?<\/\1>/g)].length
  assert.ok(accroches > 40, `seulement ${accroches} éléments à clé relus`)
})

test('les attributs SERVIS sont ceux du dictionnaire français', () => {
  const ecarts = []
  const attributs = { 'data-t-placeholder': 'placeholder', 'data-t-aria-label': 'aria-label', 'data-t-content': 'content', 'data-t-title': 'title' }
  for (const [marque, attribut] of Object.entries(attributs)) {
    for (const m of GABARIT.matchAll(new RegExp(`${marque}="([^"]+)"[^>]*?\\b${attribut}="([^"]*)"`, 'g'))) {
      const attendu = LIBELLES[DEFAUT][m[1]]
      if (typeof attendu === 'string' && m[2] !== attendu) ecarts.push(`${m[1]} : servi « ${m[2]} », dico « ${attendu} »`)
    }
    // Un attribut à clé qui n'aurait PAS sa valeur servie : sans elle, la page
    // s'ouvre avec un champ sans libellé le temps du premier rendu.
    for (const m of GABARIT.matchAll(new RegExp(`<[^>]*${marque}="([^"]+)"[^>]*>`, 'g'))) {
      if (!new RegExp(`\\b${attribut}="`).test(m[0])) ecarts.push(`${m[1]} : ${attribut} absent du balisage servi`)
    }
  }
  assert.deepEqual(ecarts, [])
})

test('data-th ne porte que du balisage en ligne, et jamais de script', () => {
  // `data-th` passe par `innerHTML` : c'est le seul endroit de la page où une
  // chaîne devient du balisage. Le dictionnaire est du code source, pas une
  // entrée, mais la liste permise doit rester COURTE et vérifiée.
  // La classe est portée par la balise OUVRANTE seule : `</span>` n'en a pas.
  const permises = /<\/?(?:code|strong|em|br|span)(?:\s+class="(?:mono|sr)")?\s*\/?>/g
  const clesHtml = [...GABARIT.matchAll(/\bdata-th="([^"]+)"/g)].map((m) => m[1])
  assert.ok(clesHtml.length >= 7, `seulement ${clesHtml.length} clés data-th`)
  for (const code of CODES) {
    for (const cle of clesHtml) {
      const reste = String(LIBELLES[code][cle]).replace(permises, '')
      assert.ok(!/[<>]/.test(reste), `${code} / ${cle} : balise hors liste — ${reste.slice(0, 80)}`)
    }
  }
  // Et l'inverse : une clé qui porte du balisage doit être posée en `data-th`,
  // pas en `data-t` — qui l'afficherait en clair, chevrons compris.
  for (const [cle, v] of Object.entries(LIBELLES[DEFAUT])) {
    if (typeof v === 'string' && /<\w/.test(v)) assert.ok(clesHtml.includes(cle), `${cle} porte du balisage mais n'est pas en data-th`)
  }
})

/* ── 4. Ce que les modules de calcul émettent ───────────────────────────── */

test('les rôles rendus par classe() ont tous leur libellé', () => {
  const T = traducteur(DEFAUT)
  const roles = [
    ...Object.values(SOCLE),
    classe('.github', {}, {}, {}, null).role,
    classe('x', {}, {}, { engines: { vscode: '^1' } }, null).role,
    classe('x', { electron: '^44' }, {}, {}, null).role,
    classe('x', {}, { tauri: '2' }, {}, null).role,
    classe('x', {}, {}, {}, 'C#').role,
  ]
  for (const role of roles) {
    // Une clé se traduit ; un nom propre passe tel quel. Ce qui n'est ni l'un
    // ni l'autre — une clé mal orthographiée — s'afficherait en clair.
    if (role.includes('.') && role.startsWith('role.')) assert.ok(T.connait(role), `rôle sans libellé : ${role}`)
    else assert.equal(T.ouTelQuel(role), role, `nom propre altéré : ${role}`)
  }
})

test('les deux noms de socle rendus par pileDuDepot ont leur libellé', () => {
  const T = traducteur(DEFAUT)
  const ctx = { amont: {}, nomSocle: '@mister-guiiug/dev-pwa-config', nettoie: (v) => v }
  const soi = pileDuDepot({ nom: 'dev-pwa-config', paquet: { version: '4.21.1' }, verrouillees: {}, declarees: {} }, ctx)
  const app = pileDuDepot({ nom: 'miss-x', verrouillees: { '@mister-guiiug/dev-pwa-config': '4.20.0' }, declarees: {} }, ctx)
  assert.ok(T.connait(soi[0].nom), soi[0].nom)
  assert.ok(T.connait(app[0].nom), app[0].nom)
  // Les autres lignes de la pile sont des noms propres : React, Vite, Tailwind.
  const pile = pileDuDepot({ nom: 'miss-x', verrouillees: { react: '19.2.0' }, declarees: {} }, ctx)
  assert.equal(T.ouTelQuel(pile[0].nom), 'React')
})

test('les groupes et les périodes de la table des éléments ont leur libellé', () => {
  const T = traducteur(DEFAUT)
  for (const cle of GROUPES) assert.ok(T.connait('groupe.' + cle), `groupe.${cle}`)
  for (const [, cle] of PERIODES) assert.ok(T.connait(cle), cle)
  // Et l'inverse : un groupe retiré de `vue.mjs` laisserait son libellé ici.
  const restes = Object.keys(LIBELLES[DEFAUT]).filter((c) => c.startsWith('groupe.') && !GROUPES.includes(c.slice('groupe.'.length)))
  assert.deepEqual(restes, [])
  const periodes = PERIODES.map(([, c]) => c)
  assert.deepEqual(
    Object.keys(LIBELLES[DEFAUT]).filter((c) => c.startsWith('periode.') && !periodes.includes(c)),
    [],
  )
})

test('les lignes hors lockfile ont toutes leur libellé de version', () => {
  const T = traducteur(DEFAUT)
  // Un parc qui porte TOUS les signaux : c'est la seule façon de voir les dix
  // lignes, donc les dix clés, au lieu des trois que porte un parc d'essai.
  const parc = [
    { nom: 'a', langage: 'Rust', pages: { ok: true }, workflows: [{ nom: 'CI' }, { nom: 'Renovate' }, { nom: 'Lighthouse' }, { nom: 'Supabase' }, { nom: 'Worker' }, { nom: 'Firebase' }] },
    { nom: 'b', langage: 'C#', pages: null, workflows: [{ nom: 'CI' }] },
    { nom: 'c', langage: 'Python', pages: null, workflows: [{ nom: 'CI' }] },
  ]
  const els = elementsHorsNpm(parc)
  assert.equal(els.length, 10, 'le parc d’essai doit déclencher les dix lignes')
  for (const e of els) {
    assert.ok(T.connait(e.ver), `${e.nom} : version sans libellé (${e.ver})`)
    // `nom` reste un nom propre : GitHub Actions, Rust, C#.
    assert.equal(T.ouTelQuel(e.nom), e.nom)
  }
})

/* ── Le transport jusqu'à la page ───────────────────────────────────────── */

test('libelles.mjs survit au retrait des export, comme les autres modules', () => {
  // `releve.mjs` recopie ce fichier dans la page et en retire `export`/`import`
  // par un motif volontairement littéral. Une forme d'export qu'il ne connaît
  // pas passerait la CI et casserait la PAGE, où rien ne la relit.
  const net = lis('libelles.mjs')
    .replace(/^export (?=const |function |let |class )/gm, '')
    .replace(/^import .*$/gm, '')
  assert.ok(!/^\s*(?:export|import)\b/m.test(net), 'un export a survécu au retrait')
})

test('l’empreinte du relevé compte libelles.mjs', () => {
  // SANS ÇA, UNE TRADUCTION CORRIGÉE N'ATTEINDRAIT JAMAIS LA PAGE PUBLIÉE : le
  // relevé ne réécrit `index.html` que si le « fond » a bougé, et une
  // traduction ne change aucune donnée. Le même piège avait déjà figé une
  // refonte du gabarit.
  const src = readFileSync(join(ICI, '..', 'scripts', 'releve.mjs'), 'utf8')
  const empreinte = /modele\.gabarit = createHash\('sha256'\)([\s\S]*?)\.digest/.exec(src)
  assert.ok(empreinte, 'calcul d’empreinte introuvable')
  assert.match(empreinte[1], /\.update\(libelles\)/)
})

test('le sélecteur de langue offre chaque langue livrée, nommée dans sa langue', () => {
  assert.deepEqual(CODES, Object.keys(LIBELLES))
  assert.equal(CODES[0], DEFAUT, 'la première est le défaut')
  for (const [code, nom] of LANGUES) {
    assert.ok(nom && nom.length > 1, `${code} sans nom affichable`)
    // Un nom écrit dans la langue qu'il désigne : « English », pas « Anglais ».
    // Quelqu'un qui cherche sa langue ne lit pas celle qu'il ne comprend pas.
    assert.notEqual(nom, LIBELLES[DEFAUT]['outils.langue'])
  }
})
