#!/usr/bin/env node
// L'ALERTE : une issue par app qui répond sans fonctionner, dans ce dépôt.
//
//   node scripts/alerte.mjs sonde/sonde.json            # ce que fait la CI
//   node scripts/alerte.mjs sonde/sonde.json --a-blanc  # dit ce qu'il ferait, ne touche à rien
//
// La page ne prévient personne : il faut l'ouvrir. Une issue, si — GitHub
// notifie le propriétaire du dépôt. Une par app, retrouvée par la marque de son
// corps (`<!-- sonde-fonctionne:<id> -->`) : ouverte quand l'app tombe,
// rouverte si elle retombe, mise à jour quand la panne change, fermée quand
// elle repasse. Le plan vient de `planAlertes` (`scripts/fonctionne.mjs`),
// éprouvé par `node --test` ; ce script ne fait que l'exécuter.
//
// Jeton : `GITHUB_TOKEN` du workflow, avec `issues: write` — déclaré dans
// releve.yml pour ce job seul. Les issues sont ainsi ouvertes par
// `github-actions[bot]`, et le propriétaire en est notifié comme de toute
// issue nouvelle de son dépôt.
import { readFileSync } from 'node:fs'
import { lisSonde, planAlertes } from './fonctionne.mjs'
import { phraseRaison } from './vue.mjs'
import { traducteur } from './libelles.mjs'

const args = process.argv.slice(2)
const FICHIER = args.find((a) => !a.startsWith('--'))
const A_BLANC = args.includes('--a-blanc')
const DEPOT = process.env.GITHUB_REPOSITORY || 'mister-guiiug/parc-dashboard'
const JETON = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || ''
const API = process.env.GITHUB_API_URL || 'https://api.github.com'
const SERVEUR = process.env.GITHUB_SERVER_URL || 'https://github.com'
const [proprietaire, nom] = DEPOT.split('/')

if (!FICHIER) {
  console.error('usage : node scripts/alerte.mjs <sonde.json> [--a-blanc]')
  process.exit(2)
}
let sonde
try {
  sonde = lisSonde(JSON.parse(readFileSync(FICHIER, 'utf8')))
} catch (e) {
  console.error(`::warning::sonde illisible (${e.message}) — aucune issue touchée`)
  process.exit(0)
}
// Une sonde vide ou illisible ne prouve rien : ni panne à signaler, ni
// retour à fermer. On ne touche à rien.
if (!sonde) {
  console.error('::warning::sonde sans verdict lisible — aucune issue touchée')
  process.exit(0)
}
if (!JETON) {
  console.error('GITHUB_TOKEN absent : impossible de lire les issues.')
  process.exit(1)
}

async function gh(methode, chemin, corps) {
  const res = await fetch(API + chemin, {
    method: methode,
    headers: {
      authorization: `Bearer ${JETON}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'parc-dashboard-alerte',
      ...(corps ? { 'content-type': 'application/json' } : {}),
    },
    body: corps ? JSON.stringify(corps) : undefined,
  })
  if (!res.ok) throw new Error(`${methode} ${chemin} : HTTP ${res.status} ${(await res.text()).slice(0, 200)}`)
  return res.status === 204 ? null : res.json()
}

// TOUTES les issues du dépôt, ouvertes et fermées : une issue fermée se
// rouvre plutôt que d'en ouvrir une seconde. Les PR passent par la même
// route ; elles n'ont pas la marque, `planAlertes` les ignore.
const issues = []
for (let page = 1; page <= 20; page++) {
  const lot = await gh('GET', `/repos/${DEPOT}/issues?state=all&per_page=100&page=${page}`)
  issues.push(...lot.filter((i) => !i.pull_request).map((i) => ({ number: i.number, state: i.state, title: i.title, body: i.body ?? '' })))
  if (lot.length < 100) break
}

const T = traducteur('fr')
const run = process.env.GITHUB_RUN_ID ? `${SERVEUR}/${DEPOT}/actions/runs/${process.env.GITHUB_RUN_ID}` : null
const ctx = { quand: sonde.date, phrase: (r) => phraseRaison(r, T), page: `https://${proprietaire}.github.io/${nom}/`, run }
const plan = planAlertes(sonde.apps, issues, ctx)

const ko = sonde.apps.filter((a) => a.etat === 'ko').length
console.error(`${sonde.apps.length} apps sondées, ${ko} en panne ; ${issues.filter((i) => /<!-- sonde-fonctionne:/.test(i.body)).length} issue(s) de sonde connue(s) ; ${plan.length} geste(s).`)
for (const a of plan) console.error(`  ${a.type.padEnd(8)} ${a.id}${a.numero ? ` #${a.numero}` : ''}${a.commentaire ? ' (avec commentaire)' : ''}`)
if (A_BLANC) {
  for (const a of plan) console.log(`\n===== ${a.type} ${a.id}${a.numero ? ' #' + a.numero : ''}\n${a.titre ? a.titre + '\n\n' : ''}${a.corps ?? ''}${a.commentaire ? '\n----- commentaire\n' + a.commentaire : ''}`)
  process.exit(0)
}

let echecs = 0
for (const a of plan) {
  try {
    if (a.type === 'creer') {
      // Le libellé `sonde` aide à filtrer à la main ; l'identité de l'issue
      // n'en dépend pas. S'il est refusé, l'issue s'ouvre sans lui.
      const cree = await gh('POST', `/repos/${DEPOT}/issues`, { title: a.titre, body: a.corps, labels: ['sonde'] }).catch(() => gh('POST', `/repos/${DEPOT}/issues`, { title: a.titre, body: a.corps }))
      console.error(`  ouverte : #${cree.number} ${a.id}`)
      continue
    }
    if (a.type === 'rouvrir') await gh('PATCH', `/repos/${DEPOT}/issues/${a.numero}`, { state: 'open', body: a.corps })
    if (a.type === 'maj') await gh('PATCH', `/repos/${DEPOT}/issues/${a.numero}`, { body: a.corps })
    if (a.commentaire) await gh('POST', `/repos/${DEPOT}/issues/${a.numero}/comments`, { body: a.commentaire })
    if (a.type === 'fermer') await gh('PATCH', `/repos/${DEPOT}/issues/${a.numero}`, { state: 'closed', state_reason: a.raison })
  } catch (e) {
    echecs++
    console.error(`::error::${a.type} ${a.id} : ${e.message}`)
  }
}
// Un geste refusé rend le job rouge : une alerte qui ne part pas doit se voir.
process.exit(echecs ? 1 : 0)
