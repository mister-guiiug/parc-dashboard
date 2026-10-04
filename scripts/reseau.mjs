/**
 * Lectures réseau du relevé — helpers purs (pagination, Link) et lecteurs
 * injectables (fetch fourni par l'appelant). `releve.mjs` reste le CLI ;
 * ce module ne s'exécute pas à l'import.
 */

/**
 * Extrait l'URL `rel="next"` d'un en-tête Link GitHub.
 * @param {string | null | undefined} link
 * @returns {string | null}
 */
export function lienSuivant(link) {
  if (!link || typeof link !== 'string') return null
  for (const part of link.split(',')) {
    const m = /<([^>]+)>\s*;\s*rel="next"/i.exec(part)
    if (m) return m[1]
  }
  return null
}

/**
 * Agrège les pages d'une collection JSON GitHub (Link: rel="next").
 *
 * @param {string} urlPremiere
 * @param {(url: string) => Promise<Response>} fetchFn
 * @param {{ maxPages?: number, headers?: Record<string, string> }} [opts]
 * @returns {Promise<{ ok: boolean, status: number, items: unknown[], corpsTexte?: string }>}
 */
export async function paginerJson(urlPremiere, fetchFn, opts = {}) {
  const maxPages = opts.maxPages ?? 10
  const headers = opts.headers || {}
  let url = urlPremiere
  const items = []
  let status = 0
  for (let page = 0; page < maxPages && url; page++) {
    const res = await fetchFn(url, { headers })
    status = res.status
    if (!res.ok) {
      const corpsTexte = await res.text().catch(() => '')
      return { ok: false, status, items, corpsTexte }
    }
    const corps = await res.json()
    if (!Array.isArray(corps)) return { ok: false, status, items, corpsTexte: '' }
    items.push(...corps)
    url = lienSuivant(res.headers.get('link'))
  }
  return { ok: true, status, items }
}

/**
 * Les règles effectives d'une branche indiquent-elles un Protect main solide
 * (PR obligatoire + checks requis) ?
 *
 * @param {unknown} regles réponse de /repos/.../rules/branches/{branch}
 * @returns {boolean | null} null si illisible
 */
export function protectMainSolide(regles) {
  if (!Array.isArray(regles)) return null
  const types = new Set(regles.map((r) => r && r.type).filter(Boolean))
  return types.has('pull_request') && types.has('required_status_checks')
}
