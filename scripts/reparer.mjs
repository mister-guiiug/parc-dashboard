#!/usr/bin/env node
// LE RÉPARATEUR : exécute le plan de `reparations.mjs`, ou le simule.
//
//   node scripts/reparer.mjs --donnees _site/donnees.json --sortie _site/reparations.json \
//     --precedent https://mister-guiiug.github.io/parc-dashboard/reparations.json
//
// À BLANC PAR DÉFAUT. Il n'agit que si `--actif` est passé ET qu'un jeton
// `REPARATEUR_TOKEN` est là (une GitHub App aux droits Actions, Contents, Pull
// requests et Issues ; jamais Administration). Sans l'un ou l'autre, il dit ce
// qu'il ferait — dans `reparations.json`, publié avec la page, et dans le
// résumé du job — sans un seul appel d'écriture.
//
// IL NE FAIT JAMAIS ÉCHOUER LE RELEVÉ : une panne ici se lit au journal et au
// résumé, la page part quand même.
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { apresExecution, couverture, planReparations, suiviRepris } from './reparations.mjs'

const API = process.env.GITHUB_API_URL || 'https://api.github.com'

/**
 * Une action, contre l'API. Rend `fait`, `sans-objet` (rien à relancer) ou
 * `echec`, avec un message lisible.
 */
export async function executeAction(a, { jeton, fetch: f = fetch }) {
  const headers = {
    authorization: `Bearer ${jeton}`,
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'user-agent': 'parc-dashboard-reparateur',
  }
  try {
    if (a.action === 'relancer-echecs') {
      // Une seule relance par run, et seulement s'il a vraiment échoué : un run
      // déjà relancé (run_attempt > 1) ou repassé vert n'a rien à reprendre.
      const run = await f(`${API}/repos/${a.nwo}/actions/runs/${a.cible}`, { headers })
      if (!run.ok) return { statut: 'echec', message: `lecture du run : HTTP ${run.status}` }
      const r = await run.json()
      if (r.status !== 'completed' || r.conclusion === 'success') return { statut: 'sans-objet', message: `run ${r.status}/${r.conclusion}` }
      if ((r.run_attempt || 1) > 1) return { statut: 'sans-objet', message: `déjà relancé (essai ${r.run_attempt})` }
      const res = await f(`${API}/repos/${a.nwo}/actions/runs/${a.cible}/rerun-failed-jobs`, { method: 'POST', headers })
      return res.ok ? { statut: 'fait', message: 'jobs en échec relancés' } : { statut: 'echec', message: `relance : HTTP ${res.status}` }
    }
    if (a.action === 'redeployer' || a.action === 'relancer-releve') {
      const res = await f(`${API}/repos/${a.nwo}/actions/workflows/${a.fichier}/dispatches`, {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ ref: a.ref || 'main' }),
      })
      if (res.ok) return { statut: 'fait', message: `${a.fichier} lancé sur ${a.ref || 'main'}` }
      // 422 : le workflow n'a pas de déclencheur `workflow_dispatch`.
      return { statut: 'echec', message: res.status === 422 ? `${a.fichier} ne se lance pas à la main (workflow_dispatch absent)` : `lancement : HTTP ${res.status}` }
    }
    return { statut: 'echec', message: `action inconnue : ${a.action}` }
  } catch (e) {
    return { statut: 'echec', message: String(e?.message || e) }
  }
}

/** Un passage complet : plan, exécution (ou simulation), journal. */
export async function passage(D, { journalPrecedent = null, actif = false, jeton = '', maintenant = new Date(), exclus = [], nwoSoi = null, fetch: f = fetch } = {}) {
  const mode = actif && jeton ? 'actif' : 'a-blanc'
  const plan = planReparations(D, { suivi: suiviRepris(journalPrecedent, mode), maintenant, exclus, nwoSoi })
  const resultats = []
  for (const a of plan.actions) {
    const r = mode === 'actif' ? await executeAction(a, { jeton, fetch: f }) : { statut: 'aurait-fait', message: 'à blanc' }
    resultats.push({ ...a, ...r })
  }
  return {
    genere: new Date(+maintenant).toISOString(),
    mode,
    actions: resultats,
    reportees: plan.reportees,
    escalades: plan.escalades,
    horsPortee: plan.horsPortee,
    couverture: couverture(D),
    suivi: apresExecution(plan.suivi, resultats, maintenant),
  }
}

const LIBELLE_ACTION = {
  'relancer-echecs': 'relancer les jobs en échec',
  redeployer: 'relancer le déploiement',
  'relancer-releve': 'relancer le relevé (sonde)',
}

/** Le résumé du job, en Markdown. */
export function resume(j) {
  const l = []
  l.push(`## Réparations du parc (${j.mode === 'actif' ? 'actif' : 'à blanc'})`, '')
  if (!j.actions.length && !j.escalades.length) l.push('Aucune réparation à faire à ce passage.', '')
  if (j.actions.length) {
    l.push('| Rubrique | Dépôt | Action | Cible | Résultat |', '| --- | --- | --- | --- | --- |')
    for (const a of j.actions) l.push(`| ${a.cle} | ${a.depot} | ${LIBELLE_ACTION[a.action] || a.action} | ${a.workflow || a.fichier || ''} \`${a.cible}\` | ${a.statut} : ${a.message} |`)
    l.push('')
  }
  if (j.escalades.length) {
    l.push('**Escalades** (plus de nouvel essai) :', '')
    for (const e of j.escalades) l.push(`- ${e.cle} · ${e.depot} · ${e.workflow || e.fichier || ''} : ${e.raison}`)
    l.push('')
  }
  if (j.reportees.length) {
    l.push(`<details><summary>${j.reportees.length} en attente</summary>`, '')
    for (const r of j.reportees) l.push(`- ${r.cle} · ${r.depot} : ${r.raison}`)
    l.push('', '</details>', '')
  }
  if (j.horsPortee.length) {
    l.push(`<details><summary>${j.horsPortee.length} hors de portée du mode automatique</summary>`, '')
    for (const h of j.horsPortee) l.push(`- ${h.cle} · ${h.depot}${h.workflow ? ` · ${h.workflow}` : ''} : ${h.raison}`)
    l.push('', '</details>', '')
  }
  const parMode = {}
  for (const c of j.couverture) parMode[c.mode] = (parMode[c.mode] || 0) + c.n
  l.push(`Couverture des écarts du jour : ${Object.entries(parMode).map(([m, n]) => `${m} ${n}`).join(' · ') || 'aucun écart'}.`)
  return l.join('\n') + '\n'
}

async function lisJournal(source) {
  if (!source) return null
  try {
    if (/^https?:/.test(source)) {
      const r = await fetch(source, { headers: { 'cache-control': 'no-cache' } })
      return r.ok ? await r.json() : null
    }
    return JSON.parse(readFileSync(source, 'utf8'))
  } catch {
    return null
  }
}

async function principal() {
  const args = process.argv.slice(2)
  const val = (nom) => {
    const i = args.indexOf(nom)
    return i >= 0 ? args[i + 1] : null
  }
  const D = JSON.parse(readFileSync(val('--donnees'), 'utf8'))
  const journal = await passage(D, {
    journalPrecedent: await lisJournal(val('--precedent')),
    actif: args.includes('--actif'),
    jeton: process.env.REPARATEUR_TOKEN || '',
    nwoSoi: process.env.GITHUB_REPOSITORY || null,
  })
  const sortie = val('--sortie')
  if (sortie) writeFileSync(sortie, JSON.stringify(journal) + '\n')
  const texte = resume(journal)
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, texte)
  console.log(texte)
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  principal().catch((e) => {
    console.log(`::warning::Réparateur en panne : ${e?.message || e}. Le relevé continue.`)
  })
}
