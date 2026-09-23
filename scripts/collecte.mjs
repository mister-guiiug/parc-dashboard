/**
 * Les règles pures de la COLLECTE — ce que `releve.mjs` lit sur le réseau, et
 * qui se vérifie sans lui.
 *
 * À la différence de `regles.mjs` et de `vue.mjs`, ce module n'est PAS inséré
 * dans la page : rien de ce qu'il fait ne sert au navigateur. Il est né le
 * 23/09/2026 avec les lectures nouvelles du relevé — la production de chaque
 * app, ses morceaux fugaces, Renovate, les pairs du socle, le journal et son
 * flux Atom. Chacune interprète un TEXTE venu d'ailleurs (un `sw.js`, un corps
 * d'issue, une réponse d'API), donc a des cas à éprouver.
 */

/* ── Les pairs du socle ─────────────────────────────────────────────────── */

/**
 * Les pairs DURES d'un `package.json` : celles que npm installe d'office chez
 * chaque consommateur, qu'il les déclare ou non.
 *
 * C'est l'angle mort mesuré le 23/09/2026 : `typescript-eslint` était figé
 * dans 23 lockfiles du parc, mais seuls 6 dépôts le DÉCLARAIENT — le tableau
 * de bord, qui ne lisait que les déclarations, en comptait 5. Les pairs
 * OPTIONNELLES restent dehors : `@sentry/react` s'installe aussi chez qui ne
 * s'en sert pas, et la compter partout ferait du bruit, pas de la mesure.
 */
export function pairsDures(pkg) {
  const pairs = pkg?.peerDependencies || {}
  const meta = pkg?.peerDependenciesMeta || {}
  return Object.keys(pairs)
    .filter((p) => !meta[p]?.optional)
    .sort()
}

/* ── La production ──────────────────────────────────────────────────────── */

// Un changement qui ne touche QUE ces fichiers ne change pas le site servi :
// documentation, outillage, tests. `package.json`, les lockfiles et `.nvmrc`
// n'y sont PAS — une dépendance ou un Node différents peuvent changer le build.
const HORS_BUILD =
  /^(?:.*\.md|docs\/.*|\.github\/.*|\.vscode\/.*|\.husky\/.*|\.changeset\/.*|(?:e2e|tests?)\/.*|.*\.(?:test|spec)\.[cm]?[jt]sx?|(?:playwright|vitest|eslint|prettier|commitlint|lint-staged)\.config\.[cm]?[jt]s|LICEN[CS]E.*|renovate\.json5?|\.gitattributes|\.gitignore|\.editorconfig|\.prettierignore)$/i

/** Ce fichier peut-il changer sans que le site servi change ? */
export const horsBuild = (chemin) => HORS_BUILD.test(String(chemin || ''))

// Au-delà, l'API de comparaison tronque la liste des fichiers : on ne peut
// plus affirmer que TOUT ce qui a changé est hors build.
const PLAFOND_FICHIERS = 300

// Un déploiement Pages prend quelques minutes : une tête plus jeune que ça
// est probablement en train de partir, pas en retard.
const DELAI_DEPLOIEMENT_MIN = 30

/**
 * L'état de la production d'une app, d'après le `version.json` qu'elle publie
 * et la tête de sa branche par défaut.
 *
 * Chaque app du parc sert un `version.json` qui porte le commit construit.
 * Le comparer à `main` répond à une question qu'aucun vert de CI ne tranche :
 * ce qui tourne en ligne est-il ce qui est fusionné ? Un déploiement bloqué
 * (`miss-carbook`, dont le build attend une migration Supabase) laisse une CI
 * verte et une production d'hier.
 *
 * @param {{commit?: string, buildTime?: string}|null} version  `version.json` lu sur le site
 * @param {{sha?: string, dateCommit?: string}} tete  dernier commit de la branche par défaut
 * @param {{ahead_by?: number, files?: {filename: string}[]}|null} comparaison
 *   `compare/<déployé>...<branche>`, demandée seulement quand les deux diffèrent
 * @param {number} maintenant
 */
export function etatProd(version, tete, comparaison, maintenant) {
  const deploye = typeof version?.commit === 'string' && /^[0-9a-f]{7,40}$/i.test(version.commit) ? version.commit : null
  if (!deploye) return { etat: 'inconnu' }
  const base = { commit: deploye.slice(0, 7), construit: version.buildTime ?? null }
  const sha = String(tete?.sha || '')
  if (sha.length >= 7 && (deploye.startsWith(sha) || sha.startsWith(deploye))) return { ...base, etat: 'aJour' }
  if (!comparaison) return { ...base, etat: 'inconnu' }
  const retard = comparaison.ahead_by ?? 0
  if (retard === 0) return { ...base, etat: 'aJour' }
  const fichiers = (comparaison.files || []).map((f) => f.filename)
  if (fichiers.length < PLAFOND_FICHIERS && fichiers.every(horsBuild)) return { ...base, etat: 'equivalent', retard }
  const age = tete?.dateCommit ? (maintenant - Date.parse(tete.dateCommit)) / 60000 : Infinity
  if (age < DELAI_DEPLOIEMENT_MIN) return { ...base, etat: 'deploiement', retard }
  return { ...base, etat: 'retard', retard }
}

/* ── Les morceaux fugaces ───────────────────────────────────────────────── */

/**
 * Le nom d'un morceau que Vite a empreinté : `-` puis huit caractères, puis
 * `.js`. C'est la règle `chunk-hors-precache` de `pwa-doctor` (socle 6.8.0),
 * appliquée cette fois au site EN LIGNE plutôt qu'au `dist/` d'un build.
 */
export const EMPREINTE_VITE = /-[A-Za-z0-9_-]{8}\.js$/

/** Les fichiers d'un manifeste de précache Workbox, qu'il soit minifié ou non. */
export function precacheDe(sw) {
  const re = /["']?url["']?\s*:\s*["']([^"']+\.(?:js|css|html|svg|png|webp|woff2|webmanifest|ico|json))["']/g
  return new Set([...String(sw || '').matchAll(re)].map((m) => m[1].split('/').pop()))
}

/**
 * L'entrée d'une page servie : le premier `<script type="module" src>`, dans
 * un ordre d'attributs ou dans l'autre.
 */
export function entreeDe(html) {
  const t = String(html || '')
  const m = /<script\b[^>]*\btype=["']module["'][^>]*\bsrc=["']([^"']+)["']/i.exec(t) || /<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*\btype=["']module["']/i.exec(t)
  return m ? m[1] : null
}

/**
 * Les morceaux qu'une entrée Vite charge : les imports relatifs (`"./x.js"`) et
 * les listes de `__vite__mapDeps` (`"assets/x.js"`). Une URL absolue — le
 * `/app/sw.js` que l'entrée enregistre — n'a ni l'un ni l'autre préfixe, et
 * reste dehors.
 */
export function referencesDe(entree) {
  const out = new Set()
  for (const m of String(entree || '').matchAll(/["'`](?:\.\/|assets\/)([A-Za-z0-9._-]+\.js)["'`]/g)) out.add(m[1])
  return out
}

/**
 * Les morceaux FUGACES : chargés par l'entrée, absents du précache, et nommés
 * par empreinte. Leur URL meurt au déploiement suivant, pendant que la coquille
 * précachée continue de la demander — c'est ce qui a rendu Sentry muet sur
 * dix-neuf dépôts jusqu'au 22/09/2026.
 */
export function fugacesDe(references, precache) {
  return [...references].filter((f) => !precache.has(f) && EMPREINTE_VITE.test(f)).sort()
}

/* ── L'état de CI d'une pull request ────────────────────────────────────── */

/**
 * Un seul mot pour l'ensemble des check-runs d'un commit : `rouge` si un seul
 * échoue, `encours` si l'un tourne encore, `vert` sinon — et `null` quand il
 * n'y en a aucun, ce qui n'est pas un succès.
 */
export function etatChecks(checkRuns) {
  const runs = Array.isArray(checkRuns) ? checkRuns : []
  if (!runs.length) return null
  if (runs.some((r) => ['failure', 'timed_out', 'cancelled', 'action_required', 'startup_failure'].includes(r.conclusion))) return 'rouge'
  if (runs.some((r) => r.status !== 'completed')) return 'encours'
  return 'vert'
}

/* ── Renovate ───────────────────────────────────────────────────────────── */

// Une ligne d'action du « Dependency Dashboard » : une case, un commentaire qui
// nomme la branche, puis le titre. `create-all-…` et `manual job` n'ont pas de
// `-branch=` et restent dehors — ce ne sont pas des mises à jour.
const ACTION_RENOVATE = /^\s*-\s*\[[ xX]\]\s*<!--\s*(?:unschedule|approve|rebase|recreate|unlimit|retry)-branch=(\S+)\s*-->(.*)$/

/**
 * Les mises à jour qu'un « Dependency Dashboard » de Renovate tient en attente.
 *
 * Format relevé sur le tableau de `mister-qowa` le 23/09/2026, pas supposé :
 * une section `## Awaiting Schedule` (le préréglage du parc ne passe que le
 * samedi), des cases `- [ ] <!-- unschedule-branch=… -->titre`, puis
 * `## Detected Dependencies`, qui n'est qu'un inventaire.
 *
 * Une mise à jour est MAJEURE quand Renovate le dit : une branche `major-…`,
 * un groupe « (major) », ou un titre en `to vN` — les mineures et correctifs
 * s'écrivent `to v1.2.3`.
 *
 * `introuvables` : les paquets que Renovate n'a PAS PU RÉSOUDRE. Relevé sur le
 * même tableau : « Failed to look up npm package @mister-guiiug/dev-pwa-config:
 * no-result ». Le socle est publié sur GitHub Packages, que Renovate ne sait
 * pas interroger sans jeton : la règle du préréglage qui lui réserve « une PR à
 * lui seul, dès qu'il sort » ne peut donc jamais servir. Un robot qui se tait
 * sur un paquet ne dit pas qu'il est à jour.
 */
export function lisTableauRenovate(corps) {
  const mises = []
  const introuvables = new Set()
  for (const m of String(corps || '').matchAll(/Failed to look up (?:\S+ )?package ([^\s:`]+)/g)) introuvables.add(m[1])
  let section = null
  for (const ligne of String(corps || '').split('\n')) {
    const h = /^##\s+(.+?)\s*$/.exec(ligne)
    if (h) {
      section = h[1]
      continue
    }
    const m = ACTION_RENOVATE.exec(ligne)
    if (!m) continue
    const titre = m[2].replace(/\s+/g, ' ').trim()
    const majeure = /(?:^|\/)major-/.test(m[1]) || /\(major\)/i.test(titre) || /\bto v\d+(?=\s|$)/.test(titre)
    mises.push({ section, branche: m[1], titre, majeure })
  }
  return { enAttente: mises.length, majeures: mises.filter((x) => x.majeure).length, mises, introuvables: [...introuvables].sort() }
}

/* ── Le journal des changements, et son flux Atom ───────────────────────── */

const cleEvenement = (e) => [e.type, e.depot, e.paquet, e.workflow, e.de, e.a].join('|')

/**
 * Le journal des changements, relevé après relevé — le plus récent d'abord.
 *
 * `changements` de la page se compare à la photo du jour ; le journal, lui,
 * garde la TRANSITION de chaque passage horaire, datée. C'est lui que le flux
 * Atom publie. Un événement identique déjà noté dans les dernières 24 h n'est
 * pas renoté : un repli sur la photo du jour recalculerait sinon des
 * transitions déjà annoncées.
 */
export function journalMisAJour(journal, nouveaux, quand, max = 60) {
  const avant = Array.isArray(journal) ? journal.filter((e) => e && typeof e.quand === 'string') : []
  const limite = Date.parse(quand) - 86400000
  const recents = new Set(avant.filter((e) => Date.parse(e.quand) >= limite).map(cleEvenement))
  const ajouts = (Array.isArray(nouveaux) ? nouveaux : []).filter((e) => !recents.has(cleEvenement(e))).map((e) => ({ ...e, quand }))
  return [...ajouts, ...avant].slice(0, max)
}

const echappeXml = (s) => String(s ?? '').replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c])

/**
 * Un flux Atom (RFC 4287) minimal et valide : `id`, `title`, `updated` et un
 * auteur au niveau du flux ; `id`, `title`, `updated` et un lien par entrée.
 * Tout texte passe par l'échappement XML — un titre de commit porte volontiers
 * des `<` et des `&`.
 */
export function fluxAtom({ id, titre, lien, soi, maj, entrees }) {
  const l = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom">',
    `  <id>${echappeXml(id)}</id>`,
    `  <title>${echappeXml(titre)}</title>`,
    `  <link rel="alternate" type="text/html" href="${echappeXml(lien)}"/>`,
    `  <link rel="self" type="application/atom+xml" href="${echappeXml(soi)}"/>`,
    `  <updated>${echappeXml(maj)}</updated>`,
    '  <author><name>parc-dashboard</name></author>',
  ]
  for (const e of entrees || []) {
    l.push(
      '  <entry>',
      `    <id>${echappeXml(e.id)}</id>`,
      `    <title>${echappeXml(e.titre)}</title>`,
      `    <updated>${echappeXml(e.quand)}</updated>`,
      `    <link rel="alternate" type="text/html" href="${echappeXml(e.lien)}"/>`,
      '  </entry>',
    )
  }
  l.push('</feed>', '')
  return l.join('\n')
}
