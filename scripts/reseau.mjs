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
 * @param {(url: string, init?: object) => Promise<Response>} fetchFn
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
 * (PR obligatoire + checks requis avec au moins un contexte nommé) ?
 *
 * Aligné sur l'esprit de `apply-rulesets.mjs` : un ruleset « active » sans
 * contexte exigé n'est pas une protection réelle — `false`, pas `true`.
 *
 * @param {unknown} regles réponse de /repos/.../rules/branches/{branch}
 * @param {{ minContexts?: number }} [opts]
 * @returns {boolean | null} null si illisible
 */
export function protectMainSolide(regles, opts = {}) {
  const minContexts = opts.minContexts ?? 1
  if (!Array.isArray(regles)) return null
  const types = new Set(regles.map((r) => r && r.type).filter(Boolean))
  if (!types.has('pull_request') || !types.has('required_status_checks')) return false
  if (minContexts <= 0) return true
  const checks = regles.find((r) => r && r.type === 'required_status_checks')
  const liste = checks?.parameters?.required_status_checks
  if (!Array.isArray(liste)) return false
  const n = liste.filter((c) => c && (typeof c === 'string' ? c : c.context)).length
  return n >= minContexts
}

/**
 * Lit les rulesets d'un dépôt puis, s'il y a un actif, les règles effectives
 * de la branche par défaut — headers communs, contrat métier inchangé.
 *
 * @param {string} nwo
 * @param {string | null | undefined} branche
 * @param {(url: string, init?: object) => Promise<Response>} fetchFn
 * @param {{ api?: string, headers?: Record<string, string> }} [opts]
 * @returns {Promise<{ status: number, liste: unknown, protect: boolean | null, appels: number }>}
 */
export async function lireRulesetsDepot(nwo, branche, fetchFn, opts = {}) {
  const api = opts.api || 'https://api.github.com'
  const headers = opts.headers || {}
  let appels = 1
  const res = await fetchFn(`${api}/repos/${nwo}/rulesets`, { headers })
  if (!res.ok) {
    return { status: res.status, liste: null, protect: null, appels }
  }
  const liste = await res.json()
  let protect = null
  if (Array.isArray(liste) && liste.some((r) => r && r.enforcement === 'active') && branche) {
    appels++
    const br = await fetchFn(`${api}/repos/${nwo}/rules/branches/${encodeURIComponent(branche)}`, { headers })
    if (br.ok) protect = protectMainSolide(await br.json())
  }
  return { status: res.status, liste, protect, appels }
}
