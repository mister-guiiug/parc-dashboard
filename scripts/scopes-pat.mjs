#!/usr/bin/env node
/**
 * Sonde les scopes de PARC_TOKEN (ou GITHUB_TOKEN) sur un dépôt public du
 * compte. Échoue si Dependabot, Code scanning ou rulesets répondent 403 —
 * le contrat du secret cesse d'être seulement des console.error du relevé.
 *
 *   node scripts/scopes-pat.mjs
 */
const JETON = process.env.PARC_TOKEN || process.env.GITHUB_TOKEN || process.env.GH_TOKEN || ''
const NWO = process.env.PARC_SONDE || 'mister-guiiug/miss-contraction'
const API = 'https://api.github.com'

if (!JETON) {
  console.error('PARC_TOKEN (ou GITHUB_TOKEN) absent.')
  process.exit(2)
}

const headers = {
  authorization: `Bearer ${JETON}`,
  accept: 'application/vnd.github+json',
  'user-agent': 'parc-dashboard-scopes-pat',
}

const sondes = [
  {
    nom: 'Dependabot alerts',
    url: `${API}/repos/${NWO}/dependabot/alerts?state=open&per_page=1`,
    scope: 'Dependabot alerts : read',
  },
  {
    nom: 'Code scanning',
    url: `${API}/repos/${NWO}/code-scanning/alerts?state=open&per_page=1`,
    scope: 'security_events (Code scanning alerts : read)',
  },
  {
    nom: 'Rulesets',
    url: `${API}/repos/${NWO}/rulesets`,
    scope: 'Administration : Read',
  },
]

let echecs = 0
for (const s of sondes) {
  const res = await fetch(s.url, { headers })
  const ok = res.status !== 401 && res.status !== 403
  const marque = ok ? 'ok' : 'MANQUE'
  console.error(`${marque.padEnd(6)} ${s.nom} → HTTP ${res.status} (scope attendu : ${s.scope})`)
  if (!ok) echecs++
}

if (echecs) {
  console.error(`\n${echecs} scope(s) manquant(s) sur PARC_TOKEN — le relevé restera partiellement muet.`)
  process.exit(1)
}
console.error('\nTous les endpoints sensibles répondent sans 401/403.')
