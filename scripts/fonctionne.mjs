/**
 * LES RÈGLES PURES DE LA SONDE « FONCTIONNE » — ce qu'elle sonde, ce qu'elle
 * bloque, ce qu'elle conclut, et ce qu'elle en dit par issue.
 *
 * POURQUOI. Le relevé disait si une app RÉPOND (HTTP 200, `version.json` à
 * jour), pas si elle FONCTIONNE. Pendant trois jours, jusqu'au 07/11/2026, le jeu public de
 * miss-arcade renvoyait 401 à chaque visiteur (RLS anonyme), et la page
 * affichait « 200 / à jour » : la coquille était servie, React montait, et
 * l'appel qui fait vivre l'écran échouait derrière.
 *
 * La sonde (`scripts/sonde.mjs`) ouvre chaque app dans Chromium, sans service
 * worker, et observe ; ce module dit ce que l'observation VEUT DIRE. Il ne
 * touche ni au réseau ni au navigateur : tout ce qui est ici est éprouvé par
 * `node --test` (`test/fonctionne.test.mjs`). Il n'est pas inséré dans la page
 * — la page ne lit que le verdict, rangé dans le modèle par le relevé.
 */

/* ── Les apps à sonder ──────────────────────────────────────────────────── */

/**
 * LES APPS WEB DU CATALOGUE, lues dans le texte de `apps-catalog.js` — le
 * fichier même que le relevé relit pour les maturités, et que chaque app lit
 * pour afficher ses sœurs. Une liste tenue ici serait un second endroit où la
 * même chose vieillit.
 *
 * Une app `platform: 'desktop'` n'est pas sondée, ni une app dont l'`appUrl`
 * est CALCULÉE (`repoUrl('mister-quota')` : la page des releases, pas une
 * app). Sans `appUrl`, l'adresse est celle de GitHub Pages — le défaut de
 * `app()` dans le catalogue.
 *
 * @param {string} texte le source de `apps-catalog.js`
 * @param {string} compte le propriétaire GitHub (`mister-guiiug`)
 * @returns {{ id: string, depot: string, url: string }[]}
 */
export function appsDuCatalogue(texte, compte) {
  const t = String(texte ?? '')
  // La DÉCLARATION, pas la première mention : des commentaires plus haut
  // dans le fichier citent `FAMILY_APPS`.
  const debut = /\bFAMILY_APPS\b[^=\n]*=\s*\[/.exec(t)
  if (!debut) return []
  const fin = t.indexOf('\n];', debut.index)
  const bloc = t.slice(debut.index, fin < 0 ? undefined : fin)
  const out = []
  for (const brut of bloc.split(/\bapp\(/).slice(1)) {
    // Les commentaires d'une entrée racontent ses choix — « App Electron : pas
    // de PWA hébergée », « appUrl par défaut »… — et ne sont pas ses champs.
    const morceau = brut.replace(/^\s*\/\/.*$/gm, '')
    const id = /^\s*'([^']+)'/.exec(morceau)?.[1]
    if (!id) continue
    if (/\bplatform:\s*'desktop'/.test(morceau)) continue
    const litterale = /\bappUrl:\s*'([^']+)'/.exec(morceau)?.[1]
    if (!litterale && /\bappUrl:/.test(morceau)) continue
    const url = litterale ?? `https://${compte}.github.io/${id}/`
    if (!/^https:\/\//.test(url)) continue
    const depot = /\brepoUrl:\s*'https:\/\/github\.com\/[^/']+\/([^/']+)'/.exec(morceau)?.[1] ?? id
    out.push({ id, depot, url })
  }
  return out
}

/* ── Ce que la sonde laisse passer ──────────────────────────────────────── */

/**
 * UN HÔTE DE BACKEND, MASQUÉ : sa nature et ses quatre premiers caractères.
 * La sortie part sur une page publique et dans des issues publiques ; l'URL
 * d'un projet Supabase est déjà dans le bundle, mais rien n'oblige à la
 * recopier en clair là où on ne la cherche pas.
 */
export function masqueHote(hote, hotePages = '') {
  const h = String(hote ?? '')
  if (hotePages && h === hotePages) return 'self'
  if (/\.supabase\.co$/.test(h)) return 'supabase:' + h.slice(0, 4) + '…'
  if (/firebase|firestore|googleapis\.com$/.test(h)) return 'firebase:' + h.split('.').slice(-2).join('.')
  if (/\.workers\.dev$/.test(h)) return 'worker:' + h.slice(0, 4) + '…'
  return h
}

/** Toute adresse d'un texte (console, CSP) remplacée par son hôte masqué. */
export function masqueTexte(texte, hotePages = '', max = 200) {
  return String(texte ?? '')
    .replace(/https?:\/\/([a-z0-9.-]+)(:\d+)?/gi, (_, h) => masqueHote(h.toLowerCase(), hotePages))
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

/**
 * « supabase:wksb… /rest/v1/rpc/jeu_public HTTP 401 » — une requête en échec,
 * dite assez pour chercher, sans sa requête (`?apikey=…`) ni l'hôte en clair.
 */
export function decritRequete(url, hotePages, motif) {
  let u
  try {
    u = new URL(url)
  } catch {
    return String(motif ?? '').trim()
  }
  const chemin = u.hostname === hotePages ? u.pathname : u.pathname.slice(0, 60)
  return `${masqueHote(u.hostname, hotePages)} ${chemin} ${motif ?? ''}`.trim()
}

const ANALYTIQUE = /posthog|google-analytics|googletagmanager|sentry\.io|ingest\./
const SESSION = /identitytoolkit\.googleapis|securetoken\.googleapis|\/auth\/v1\/(signup|token|otp|magiclink|recover|verify)/
const LECTURE = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * CE QUE LA SONDE BLOQUE, et pourquoi — `null` quand la requête passe.
 *
 * - `analytique` : PostHog, GA, Sentry. Une visite de robot chaque heure dans
 *   vingt-deux apps fausserait leur mesure, et rien de ce que la sonde juge
 *   n'en dépend.
 * - `session` : toute CRÉATION de session (Firebase Auth, `/auth/v1/signup`…).
 *   Une connexion anonyme à chaque passage remplirait la table des comptes.
 * - `ecriture` : toute méthode d'écriture vers un tiers.
 *
 * SAUF LES LECTURES QUI VOYAGENT EN POST. La première sonde (07/11/2026)
 * bloquait tout POST : elle ne voyait donc PAS la panne qui l'a fait écrire.
 * Le jeu public de miss-arcade se lit par `POST /rest/v1/rpc/…` — le chemin
 * des fonctions Supabase, en lecture comme en écriture —, et la sonde le
 * rapportait comme « jeu introuvable, Failed to fetch », une erreur qu'elle
 * avait elle-même causée. Une RPC passe donc, comme l'écoute Firestore
 * (`…/Listen/channel`) ; une écriture dans une table (`/rest/v1/<table>`),
 * dans un seau ou par `Write/channel` reste bloquée. Une RPC appelée à
 * l'ouverture, sans geste de l'utilisateur, est ce que fait chaque visiteur.
 *
 * @param {{ methode: string, url: string, hotePages: string }} r
 * @returns {null | 'analytique' | 'session' | 'ecriture'}
 */
export function requeteBloquee({ methode, url, hotePages }) {
  let u
  try {
    u = new URL(url)
  } catch {
    return null
  }
  if (ANALYTIQUE.test(u.hostname)) return 'analytique'
  if (SESSION.test(u.href)) return 'session'
  const m = String(methode ?? 'GET').toUpperCase()
  if (LECTURE.has(m) || u.hostname === hotePages) return null
  if (m === 'POST' && /\.supabase\.co$/.test(u.hostname) && u.pathname.startsWith('/rest/v1/rpc/')) return null
  if (m === 'POST' && u.hostname === 'firestore.googleapis.com' && /\/Listen\/channel$/.test(u.pathname)) return null
  return 'ecriture'
}

/**
 * UNE REQUÊTE EN ÉCHEC COMPTE-T-ELLE ? `ignore` pour ce que la sonde a bloqué
 * elle-même et pour une requête ANNULÉE (`ERR_ABORTED` : une navigation qui
 * part, un `AbortController`, un préchargement abandonné — rien de cassé) ;
 * `csp` pour un refus de la CSP, que la console dit déjà ; `echec` sinon.
 */
export function classeEchec(texteErreur) {
  const t = String(texteErreur ?? '')
  if (/BLOCKED_BY_CLIENT|blockedbyclient|ERR_ABORTED/i.test(t)) return 'ignore'
  if (/BLOCKED_BY_CSP/i.test(t)) return 'csp'
  return 'echec'
}

/**
 * UNE LIGNE DE CONSOLE EST-ELLE UNE VIOLATION DE CSP QUI BLOQUE ? Une
 * politique `Report-Only` écrit le même « Refused to … » précédé de
 * « [Report Only] » — et ne bloque rien.
 */
export const estViolationCsp = (texte) => /Content Security Policy|Refused to /i.test(String(texte ?? '')) && !/\[Report Only\]/i.test(String(texte ?? ''))

/* ── Le verdict ─────────────────────────────────────────────────────────── */

/**
 * Les raisons d'un « répond mais ne fonctionne pas », dans l'ordre où la
 * page les dit. Chacune est une CLÉ (`sonde.raison.<clé>` dans
 * `libelles.mjs`) : un module qui calcule n'écrit pas de phrase.
 */
export const RAISONS_SONDE = ['chargement', 'http', 'react', 'ecranErreur', 'csp', 'requetes', 'backend']

const uniques = (liste) => [...new Set((liste || []).filter(Boolean))]
const court = (s, max = 160) => String(s ?? '').slice(0, max)

/**
 * CE QUE L'OBSERVATION VEUT DIRE. Une app fonctionne quand sa page se charge
 * (2xx), que React a REMPLACÉ le contenu servi aux robots (le seul contenu
 * qu'aucun script ne produit), qu'elle n'affiche pas son écran d'erreur, et
 * qu'aucune violation de CSP, aucune requête en échec, aucun backend
 * injoignable ne s'est montré.
 *
 * Les erreurs de console NE SONT PAS un critère : elles restent jointes, à
 * titre indicatif. Les sonder aurait fait échouer chaque app qui journalise
 * l'échec de son service worker — que la sonde bloque (« Cannot read
 * properties of undefined (reading 'waiting') », mister-cim10 et mister-doc
 * le 07/11/2026).
 *
 * @param {{ erreur?: string|null, http?: number|null, react?: boolean, servi?: boolean, ecranErreur?: boolean, csp?: string[], echecs?: string[], backends?: { hote: string, etat: string, injoignable: boolean }[] }} obs
 * @returns {{ etat: 'ok' | 'ko', raisons: object[] }}
 */
export function verdictSonde(obs) {
  const o = obs || {}
  const raisons = []
  const httpOk = o.http == null || (o.http >= 200 && o.http < 400)
  if (o.erreur) raisons.push({ cle: 'chargement', erreur: court(o.erreur, 120) })
  else if (!httpOk) raisons.push({ cle: 'http', code: o.http })
  // Le montage ne se juge que sur une page chargée : une 404 de Pages n'a
  // jamais eu de React à monter, et le dire deux fois n'apprend rien.
  if (!o.erreur && httpOk && (!o.react || o.servi)) raisons.push({ cle: 'react' })
  if (o.ecranErreur) raisons.push({ cle: 'ecranErreur' })
  const csp = uniques(o.csp)
  if (csp.length) raisons.push({ cle: 'csp', n: csp.length, exemple: court(csp[0]) })
  const echecs = uniques(o.echecs)
  if (echecs.length) raisons.push({ cle: 'requetes', n: echecs.length, exemple: court(echecs[0]) })
  const morts = (o.backends || []).filter((b) => b?.injoignable)
  if (morts.length) raisons.push({ cle: 'backend', exemple: court(`${morts[0].hote} ${morts[0].etat}`) })
  return { etat: raisons.length ? 'ko' : 'ok', raisons }
}

/**
 * L'ÉTAT D'UN BACKEND d'après sa sonde de santé (`/auth/v1/health` d'un projet
 * Supabase, sans clé) : une réponse 401 dit un projet VIVANT qui demande sa
 * clé ; un échec réseau (nom introuvable : projet supprimé) ou une réponse
 * 5xx (projet en pause, panne) le dit injoignable.
 *
 * @param {{ status?: number, erreur?: string }} r
 */
export function etatBackend(r) {
  if (r?.status != null) return { etat: `HTTP ${r.status}`, injoignable: r.status >= 500 }
  return { etat: `injoignable (${r?.erreur || 'réseau'})`, injoignable: true }
}

/* ── Du fichier de la sonde au modèle de la page ────────────────────────── */

/**
 * Le fichier de la sonde est-il lisible, et de quel jour ? `null` sinon :
 * une sonde partielle ou d'un autre format ne doit pas passer pour « tout
 * fonctionne ».
 */
export function lisSonde(json) {
  if (!json || typeof json !== 'object') return null
  if (typeof json.date !== 'string' || !Number.isFinite(Date.parse(json.date))) return null
  if (!Array.isArray(json.apps) || !json.apps.length) return null
  const apps = json.apps.filter((a) => a && typeof a.id === 'string' && (a.etat === 'ok' || a.etat === 'ko'))
  if (!apps.length) return null
  return { date: json.date, apps }
}

/**
 * LES VERDICTS QUE PORTE LA PAGE. Une sonde fraîche donne les siens ; sans
 * elle (job en échec, fichier absent), ceux de la page en ligne sont REPRIS,
 * avec leur date — une sonde ratée n'efface rien, elle vieillit, et la page
 * dit depuis quand (`sondeManquante` de `vue.mjs`). Sans l'une ni l'autre,
 * `sonde` vaut `null` : la page le dit aussi, plutôt que de se taire.
 *
 * Seuls `etat` et `raisons` entrent dans le modèle : le nombre d'essais, la
 * console, les durées changent à chaque passage et feraient republier une
 * page identique.
 *
 * @param {ReturnType<typeof lisSonde>} sonde
 * @param {{ sonde?: object|null, depots?: object[] } | null} precedent le modèle de la page en ligne
 * @returns {{ sonde: null | { date: string, apps: number, ko: number }, parDepot: Map<string, { etat: string, raisons: object[] }> }}
 */
export function verdictsDuReleve(sonde, precedent) {
  const parDepot = new Map()
  if (sonde) {
    for (const a of sonde.apps) parDepot.set(a.depot || a.id, { etat: a.etat, raisons: Array.isArray(a.raisons) ? a.raisons : [] })
    return { sonde: { date: sonde.date, apps: sonde.apps.length, ko: sonde.apps.filter((a) => a.etat === 'ko').length }, parDepot }
  }
  const p = precedent?.sonde
  if (!p || typeof p.date !== 'string') return { sonde: null, parDepot }
  for (const d of precedent.depots || []) if (d?.sonde) parDepot.set(d.nom, { etat: d.sonde.etat, raisons: d.sonde.raisons || [] })
  return { sonde: { date: p.date, apps: p.apps ?? parDepot.size, ko: p.ko ?? [...parDepot.values()].filter((v) => v.etat === 'ko').length }, parDepot }
}

/* ── L'alerte : une issue par app ───────────────────────────────────────── */

const MARQUE = /<!-- sonde-fonctionne:([\w.-]+) -->/
const DEPUIS = /<!-- depuis:(\S+) -->/
const BLOC = /<!-- raisons -->([\s\S]*?)<!-- \/raisons -->/
const CLES = /<!-- cles:([\w,]*) -->/

/** Le titre STABLE d'une issue — un humain la retrouve à l'œil, le script par sa marque. */
export const titreIssue = (id) => `Sonde : ${id} ne fonctionne pas`

/** L'app qu'une issue suit, d'après la marque de son corps — `null` pour toute autre issue. */
export const appDeLIssue = (corps) => MARQUE.exec(String(corps ?? ''))?.[1] ?? null

/** « 2026-11-07 12:17 UTC » : sans fuseau ni langue de la machine qui écrit. */
export const dateUtc = (iso) => {
  const t = Date.parse(iso)
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : '—'
}

/** Échappe le Markdown d'un texte que l'app sondée a produit (chemin, message). */
export const md = (s) => String(s ?? '').replace(/[\\`*_<>[\]|]/g, (c) => '\\' + c)

/**
 * LE CORPS D'UNE ISSUE. Les raisons vivent entre deux marques : c'est sur ce
 * bloc, et sur lui seul, que se décide une mise à jour — la date du passage
 * et la console changent à chaque heure, et republier pour elles ferait
 * bouger l'issue sans que rien n'ait changé.
 *
 * @param {{ id: string, url: string, raisons: object[], console?: string[] }} app
 * @param {{ depuis: string, quand: string, phrase: (r: object) => string, page?: string|null, run?: string|null }} ctx
 */
export function corpsIssue(app, ctx) {
  const lignes = [
    `<!-- sonde-fonctionne:${app.id} -->`,
    `<!-- depuis:${ctx.depuis} -->`,
    `<!-- cles:${clesDe(app.raisons)} -->`,
    `**${md(app.id)}** ne fonctionne pas : la sonde du tableau de bord l'a ouverte dans Chromium, sans service worker, et voici ce qu'elle a vu.`,
    '',
    '<!-- raisons -->',
    ...(app.raisons || []).map((r) => `- ${md(ctx.phrase(r))}`),
    '<!-- /raisons -->',
    '',
    '| | |',
    '|---|---|',
    `| Application | ${app.url} |`,
    `| En panne depuis | ${dateUtc(ctx.depuis)} |`,
    `| Constat | ${dateUtc(ctx.quand)}${ctx.run ? ` — [passage de la sonde](${ctx.run})` : ''} |`,
    ...(ctx.page ? [`| Tableau de bord | ${ctx.page}#depot-${encodeURIComponent(app.id)} |`] : []),
  ]
  const consoles = (app.console || []).slice(0, 5)
  if (consoles.length)
    lignes.push('', '<details><summary>Erreurs de console (indicatives : elles ne comptent pas dans le verdict)</summary>', '', '```text', ...consoles.map((c) => String(c).replace(/`/g, "'")), '```', '', '</details>')
  lignes.push(
    '',
    "Ce que la sonde ne voit pas : ce qui se passe derrière la connexion, les écritures (elle les bloque), le hors-ligne, et toute autre page que l'accueil.",
    '',
    "_Cette issue est tenue par le workflow « Relevé du parc » : mise à jour quand la panne change, fermée dès que l'app repasse._",
  )
  return lignes.join('\n')
}

/** L'issue que suit une app : l'ouverte d'abord, la plus récente ensuite. */
function issueDe(issues, id) {
  const siennes = issues.filter((i) => appDeLIssue(i.body) === id)
  siennes.sort((a, b) => (a.state === 'open') - (b.state === 'open') || a.number - b.number)
  return siennes.at(-1) ?? null
}

const clesDe = (raisons) => (raisons || []).map((r) => r.cle).join(',')

/**
 * CE QUE L'ALERTE FAIT, sans le faire. Une issue par app, retrouvée par la
 * marque `<!-- sonde-fonctionne:<id> -->` de son corps et non par un libellé
 * — un libellé refusé ne doit pas faire ouvrir une issue de plus à chaque
 * heure :
 *
 * - l'app échoue, aucune issue : `creer` ;
 * - elle échoue, son issue est fermée : `rouvrir`, avec un commentaire — c'est
 *   lui qui notifie ;
 * - elle échoue, son issue est ouverte : rien, sauf si la panne a changé
 *   (`maj`) ; un commentaire seulement quand ses RAISONS changent, pas pour un
 *   autre exemple de la même ;
 * - elle repasse, son issue est ouverte : `fermer`, avec un commentaire ;
 * - une issue ouverte suit une app que la sonde ne sonde plus (retirée du
 *   catalogue, passée en desktop) : `fermer` sans verdict.
 *
 * @param {{ id: string, url: string, etat: string, raisons?: object[], console?: string[] }[]} apps
 * @param {{ number: number, state: string, body?: string }[]} issues
 * @param {{ quand: string, phrase: (r: object) => string, page?: string|null, run?: string|null }} ctx
 */
export function planAlertes(apps, issues, ctx) {
  const actions = []
  // Un corps retouché dans l'interface revient en fins de ligne Windows : la
  // comparaison des raisons ne doit pas y voir une panne nouvelle.
  const liste = (issues || []).filter((i) => appDeLIssue(i.body)).map((i) => ({ ...i, body: String(i.body).replace(/\r\n/g, '\n') }))
  const vues = new Set()
  for (const app of apps || []) {
    vues.add(app.id)
    const issue = issueDe(liste, app.id)
    const ouverte = issue?.state === 'open'
    if (app.etat === 'ko') {
      const raisons = (app.raisons || []).map((r) => `- ${md(ctx.phrase(r))}`).join('\n')
      if (ouverte) {
        const avant = BLOC.exec(issue.body ?? '')?.[1]?.trim() ?? ''
        if (avant === raisons.trim()) continue
        const depuis = DEPUIS.exec(issue.body ?? '')?.[1] ?? ctx.quand
        const change = clesDe(app.raisons) !== (CLES.exec(issue.body ?? '')?.[1] ?? '')
        actions.push({
          type: 'maj',
          id: app.id,
          numero: issue.number,
          corps: corpsIssue(app, { ...ctx, depuis }),
          commentaire: change ? `La panne a changé (${dateUtc(ctx.quand)}) :\n\n${raisons}` : null,
        })
      } else if (issue) {
        actions.push({
          type: 'rouvrir',
          id: app.id,
          numero: issue.number,
          corps: corpsIssue(app, { ...ctx, depuis: ctx.quand }),
          commentaire: `De nouveau en panne (${dateUtc(ctx.quand)}) :\n\n${raisons}`,
        })
      } else {
        actions.push({ type: 'creer', id: app.id, titre: titreIssue(app.id), corps: corpsIssue(app, { ...ctx, depuis: ctx.quand }) })
      }
    } else if (ouverte) {
      actions.push({
        type: 'fermer',
        id: app.id,
        numero: issue.number,
        raison: 'completed',
        commentaire: `Repassée (${dateUtc(ctx.quand)}) : la page se charge, React a monté, aucune requête en échec ni violation de CSP.`,
      })
    }
  }
  // Rien à retirer sur une sonde vide : elle n'a rien vu, elle ne prouve pas
  // que les apps ont quitté le catalogue.
  if (vues.size) {
    for (const issue of liste) {
      const id = appDeLIssue(issue.body)
      if (issue.state !== 'open' || vues.has(id)) continue
      if (issueDe(liste, id) !== issue) continue
      actions.push({
        type: 'fermer',
        id,
        numero: issue.number,
        raison: 'not_planned',
        commentaire: `${id} n'est plus sondée (absente du catalogue, ou passée en desktop) : issue fermée sans verdict.`,
      })
    }
  }
  return actions
}
