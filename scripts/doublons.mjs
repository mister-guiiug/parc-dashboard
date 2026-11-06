// Les pages que le parc publie en double — les règles pures.
//
// LE CONSTAT DU 06/11/2026. Le générateur recopiait tout le squelette, son
// contenu compris : miss-arcade et miss-holi-voyage, nées le 31/10, servaient
// en accueil « C'est le squelette des applications de la famille » et
// publiaient mot pour mot ses trois guides. Neuf pages pour trois textes,
// chacune se déclarant l'originale par sa canonique : un moteur n'en garde
// qu'une, et une IA répète ce qu'elles affirment, vrai ou faux pour le site
// qui les porte. Rien ne l'a signalé pendant six jours ; un relevé fait à la
// main l'a trouvé. Le générateur est corrigé (create-lg-pwa-app#27), mais une
// page se recopie aussi à la main, d'une app sœur à l'autre : cette règle ne
// dépend pas de la cause.
//
// LA MESURE. Similarité de Jaccard entre les suites de cinq mots consécutifs
// (« bardeaux ») du texte RÉDIGÉ : l'article d'une page de contenu, le bloc
// servi d'un accueil — pas l'en-tête, le pied de page ni l'encadré, que le
// gabarit du socle donne à toutes. Relevée le 06/11/2026 sur les 85 pages du
// parc : les copies sont toutes au-dessus de 0,97 ; la paire suivante (l'index
// des guides du hub, en français et en anglais, qui listent les mêmes titres)
// est à 0,54 ; tout le reste sous 0,14. D'où le seuil à 0,8.
//
// La règle ne dit pas laquelle est l'originale : cela se décide chez celui qui
// a reçu la copie, et seul un humain le sait.

/** Au-dessus, deux pages disent la même chose. Voir l'en-tête. */
export const SEUIL_DOUBLON = 0.8

/** La longueur d'un bardeau, en mots. */
export const TAILLE_BARDEAU = 5

/**
 * Sous ce nombre de bardeaux (environ trente-cinq mots), un texte est trop
 * court pour qu'une ressemblance veuille dire quelque chose.
 */
export const BARDEAUX_MIN = 30

const ENTITES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

/** Les entités HTML d'un texte, décodées. */
function decode(texte) {
  return texte.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] !== '#') return ENTITES[e.toLowerCase()] ?? m
    const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
    return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : m
  })
}

/**
 * Les URL d'un plan de site, et s'il s'agit d'un INDEX de plans — celui de la
 * racine, qui liste le plan du hub et celui de chaque app.
 *
 * @param {string} xml
 * @returns {{ index: boolean, locs: string[] }}
 */
export function urlsDuPlan(xml) {
  const texte = String(xml || '')
  return {
    index: /<sitemapindex\b/i.test(texte),
    locs: [...texte.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => decode(m[1])),
  }
}

/**
 * Le site auquel une URL appartient : celui dont l'adresse est le plus long
 * préfixe. La racine du compte préfixe toutes les apps ; sans cette règle,
 * chaque page d'app serait relevée deux fois, et se trouverait en double
 * d'elle-même.
 *
 * @param {string} url
 * @param {Array<{ depot: string, base: string }>} sites
 * @returns {string | null} le nom du dépôt
 */
export function proprietaire(url, sites) {
  let retenu = null
  for (const s of sites || []) {
    if (url.startsWith(s.base) && (!retenu || s.base.length > retenu.base.length)) retenu = s
  }
  return retenu?.depot ?? null
}

/**
 * Le texte rédigé d'une page : l'`<article>` d'une page de contenu, sinon le
 * bloc servi d'un accueil (`data-dwc="served-text"`, le texte de
 * `content/accueil.md`), sinon le `<main>`. `''` sans rien de tout cela.
 *
 * @param {string} html
 */
export function texteRedige(html) {
  const sans = String(html || '').replace(/<(script|style|noscript|template)\b[\s\S]*?<\/\1\s*>/gi, ' ')
  const bloc =
    /<article\b[^>]*>([\s\S]*?)<\/article>/i.exec(sans)?.[1] ??
    /<section\b[^>]*data-dwc="served-text"[^>]*>([\s\S]*?)<\/section>/i.exec(sans)?.[1] ??
    /<main\b[^>]*>([\s\S]*?)<\/main>/i.exec(sans)?.[1] ??
    ''
  return decode(bloc.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Le titre à montrer : le `<h1>` de l'article, sinon celui de la page, sinon
 * son `<title>`.
 *
 * @param {string} html
 */
export function titreDe(html) {
  const texte = String(html || '')
  const article = /<article\b[^>]*>([\s\S]*?)<\/article>/i.exec(texte)?.[1] ?? ''
  const brut = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(article)?.[1] ?? /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(texte)?.[1] ?? /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(texte)?.[1] ?? ''
  return decode(brut.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Les bardeaux d'un texte : chaque suite de `k` mots, en minuscules. Les
 * apostrophes typographiques valent la droite : une page recopiée puis
 * retouchée par Prettier ou un correcteur ne change pas pour si peu.
 *
 * @param {string} texte
 * @param {number} [k]
 * @returns {Set<string>}
 */
export function bardeaux(texte, k = TAILLE_BARDEAU) {
  const mots =
    String(texte || '')
      .toLowerCase()
      .replace(/[’‘]/g, "'")
      .match(/[\p{L}\p{N}]+(?:'[\p{L}\p{N}]+)*/gu) || []
  const out = new Set()
  for (let i = 0; i + k <= mots.length; i++) out.add(mots.slice(i, i + k).join(' '))
  return out
}

/**
 * La similarité de Jaccard de deux ensembles : la part commune de leur union.
 *
 * @param {Set<string>} a
 * @param {Set<string>} b
 */
export function jaccard(a, b) {
  if (!a.size && !b.size) return 0
  const [petit, grand] = a.size < b.size ? [a, b] : [b, a]
  let communs = 0
  for (const x of petit) if (grand.has(x)) communs++
  return communs / (a.size + b.size - communs)
}

/**
 * Les groupes de pages qui disent la même chose.
 *
 * Deux pages au-dessus du seuil sont liées ; un groupe est un ensemble de
 * pages liées de proche en proche — trois copies d'un même guide font UN
 * groupe, pas trois paires. Sa similarité est celle de son lien le plus
 * faible. Les pages trop courtes (`BARDEAUX_MIN`) ne se comparent pas.
 *
 * @param {Array<{ depot: string, url: string, titre?: string, bardeaux: Set<string> }>} pages
 * @param {number} [seuil]
 * @returns {Array<{ titre: string | null, url: string, similarite: number, depots: Array<{ depot: string, url: string }> }>}
 *   triés du plus grand groupe au plus petit, puis par titre ; `titre` est nul
 *   quand les pages n'en partagent pas ; `url` est celle
 *   de la première page, par ordre d'URL — une clé stable pour la case
 *   « traité ».
 */
export function groupesDeDoublons(pages, seuil = SEUIL_DOUBLON) {
  const vues = new Map()
  for (const p of pages || []) if (p?.url && p.bardeaux?.size >= BARDEAUX_MIN && !vues.has(p.url)) vues.set(p.url, p)
  const liste = [...vues.values()]
  const parent = liste.map((_, i) => i)
  const racine = (i) => (parent[i] === i ? i : (parent[i] = racine(parent[i])))
  const plusFaible = new Map()
  for (let i = 0; i < liste.length; i++) {
    for (let j = i + 1; j < liste.length; j++) {
      const s = jaccard(liste[i].bardeaux, liste[j].bardeaux)
      if (s < seuil) continue
      const [ri, rj] = [racine(i), racine(j)]
      const min = Math.min(s, plusFaible.get(ri) ?? 1, plusFaible.get(rj) ?? 1)
      parent[rj] = ri
      plusFaible.set(ri, min)
    }
  }
  const groupes = new Map()
  for (let i = 0; i < liste.length; i++) {
    const r = racine(i)
    groupes.set(r, [...(groupes.get(r) || []), liste[i]])
  }
  return [...groupes.entries()]
    .filter(([, membres]) => membres.length > 1)
    .map(([r, membres]) => {
      const tries = membres.sort((a, b) => a.url.localeCompare(b.url))
      // UN TITRE S'IL EST COMMUN, AUCUN SINON. Les accueils recopiés du
      // squelette partagent leur texte, pas leur h1 : nommer le groupe par celui
      // de la première app laissait croire que c'était elle, la copiée.
      const titres = new Set(tries.map((p) => p.titre).filter(Boolean))
      return {
        titre: titres.size === 1 ? [...titres][0] : null,
        url: tries[0].url,
        similarite: Math.floor((plusFaible.get(r) ?? 1) * 100) / 100,
        depots: tries.map((p) => ({ depot: p.depot, url: p.url })),
      }
    })
    .sort((a, b) => b.depots.length - a.depots.length || (a.titre ?? '').localeCompare(b.titre ?? '') || a.url.localeCompare(b.url))
}
