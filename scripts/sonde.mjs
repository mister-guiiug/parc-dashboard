#!/usr/bin/env node
// LA SONDE « FONCTIONNE » : ouvre chaque app du catalogue dans Chromium et dit
// si elle FONCTIONNE — pas seulement si elle répond.
//
//   node scripts/sonde.mjs                         # catalogue du socle, sortie sonde/sonde.json
//   node scripts/sonde.mjs --apps miss-arcade      # une app (ou plusieurs, séparées par des virgules)
//   node scripts/sonde.mjs --catalogue ../dev-pwa-config/apps-catalog.js --canal chrome
//
// Ce que fait la CI, à chaque passage du relevé (job `sonder` de releve.yml) :
//
//   node scripts/sonde.mjs --sortie sonde/sonde.json   (SONDE_CANAL=chrome)
//
// Pour chaque app : un contexte neuf, SANS service worker (la sonde juge ce
// que le réseau sert, pas un précache d'hier), un écran de téléphone, puis :
//  - la page se charge-t-elle (2xx) ?
//  - React a-t-il REMPLACÉ le contenu servi aux robots (`data-dwc="served-content"`) ?
//  - l'app montre-t-elle son écran d'erreur (`data-dwc="error-boundary"`) ?
//  - une violation de CSP, une requête en échec (≥ 400 ou réseau) ?
//  - les projets Supabase que son JS nomme répondent-ils (`/auth/v1/health`) ?
// Les règles — ce qui est bloqué, ce qui compte, le verdict — vivent dans
// `scripts/fonctionne.mjs`, éprouvées par `node --test`.
//
// LECTURE SEULE : mesure d'audience, création de session et écritures vers un
// tiers sont bloquées (`requeteBloquee`). Une app en échec est RETENTÉE une
// fois, seule, avant d'être dite en panne : une alerte qui sonne pour un
// hoquet du réseau du runner apprend à ne plus la lire.
//
// Le code de sortie dit si la SONDE a marché, pas si les apps marchent : une
// app en panne ouvre une issue (`scripts/alerte.mjs`), une sonde en panne rend
// le job rouge.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { appsDuCatalogue, classeEchec, decritRequete, estViolationCsp, etatBackend, masqueHote, masqueTexte, requeteBloquee, verdictSonde } from './fonctionne.mjs'

const args = process.argv.slice(2)
const valeurDe = (option) => (args.includes(option) ? args[args.indexOf(option) + 1] : null)
const COMPTE = process.env.PARC_COMPTE || 'mister-guiiug'
const CATALOGUE = valeurDe('--catalogue') || `https://raw.githubusercontent.com/${COMPTE}/dev-pwa-config/main/apps-catalog.js`
const SORTIE = valeurDe('--sortie') || 'sonde/sonde.json'
// `chrome` en CI : le Google Chrome des runners GitHub, déjà installé — rien à
// télécharger à chaque heure. Sans canal, le Chromium de Playwright, s'il a été
// installé (`npx playwright install chromium`).
const CANAL = valeurDe('--canal') || process.env.SONDE_CANAL || null
const PARALLELE = Math.max(1, Number(valeurDe('--parallele')) || 3)
const FILTRE = valeurDe('--apps')?.split(',').filter(Boolean) ?? null
const HOTE_PAGES = `${COMPTE}.github.io`

const t0 = Date.now()
const quitte = (code, message) => {
  console.error(message)
  process.exit(code)
}

/* ── Le catalogue ───────────────────────────────────────────────────────── */

let texte
try {
  texte = /^https?:/.test(CATALOGUE) ? await (await fetch(CATALOGUE, { signal: AbortSignal.timeout(30000) })).text() : readFileSync(CATALOGUE, 'utf8')
} catch (e) {
  quitte(2, `Catalogue illisible (${CATALOGUE}) : ${e.message}`)
}
let apps = appsDuCatalogue(texte, COMPTE)
if (FILTRE) apps = apps.filter((a) => FILTRE.includes(a.id))
if (!apps.length) quitte(2, `Aucune app web lue dans ${CATALOGUE}${FILTRE ? ` pour ${FILTRE.join(', ')}` : ''} : rien à sonder, et rien à conclure.`)

// LE TÉMOIN : si le runner ne joint pas Pages, toutes les apps « tomberaient »
// d'un coup, et chacune ouvrirait son issue. Mieux vaut un job rouge.
try {
  const r = await fetch(`https://${HOTE_PAGES}/`, { signal: AbortSignal.timeout(30000) })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
} catch (e) {
  quitte(2, `Témoin injoignable (https://${HOTE_PAGES}/ : ${e.message}) — sonde abandonnée, aucune app jugée.`)
}

/* ── Le navigateur ──────────────────────────────────────────────────────── */

let chromium
try {
  ;({ chromium } = await import('playwright-core'))
} catch (e) {
  quitte(2, `playwright-core introuvable (${e.message}) — lancer \`npm ci\` d'abord.`)
}
const navigateur = await chromium.launch(CANAL ? { channel: CANAL } : {}).catch((e) => quitte(2, `Navigateur introuvable (${CANAL || 'chromium de Playwright'}) : ${e.message.split('\n')[0]}`))

// React a-t-il monté ? `createRoot` marque son conteneur, et le premier rendu
// remplace ce que le build y avait servi pour les robots.
const MONTE = () => {
  const racine = document.getElementById('root') || document.querySelector('body > div[id]')
  const react = Boolean(racine) && Object.keys(racine).some((k) => k.startsWith('__reactContainer'))
  return react && !document.querySelector('[data-dwc="served-content"]')
}
const ETAT_DOM = () => {
  const racine = document.getElementById('root') || document.querySelector('body > div[id]')
  return {
    react: Boolean(racine) && Object.keys(racine).some((k) => k.startsWith('__reactContainer')),
    servi: Boolean(document.querySelector('[data-dwc="served-content"]')),
    ecranErreur: Boolean(document.querySelector('[data-dwc="error-boundary"]')),
  }
}

/** Une observation de l'app — ni verdict ni réseau tiers au-delà de la page. */
async function observe(app) {
  const obs = { http: null, erreur: null, react: false, servi: false, ecranErreur: false, csp: [], echecs: [], console: [], bloques: 0, supabase: new Set() }
  const ctx = await navigateur.newContext({ locale: 'fr-FR', viewport: { width: 390, height: 844 }, serviceWorkers: 'block' })
  const page = await ctx.newPage()
  await ctx.route('**/*', (route) => {
    const req = route.request()
    const motif = requeteBloquee({ methode: req.method(), url: req.url(), hotePages: HOTE_PAGES })
    if (!motif) return route.continue()
    if (motif !== 'analytique') obs.bloques++
    return route.abort('blockedbyclient')
  })
  page.on('console', (m) => {
    if (m.type() !== 'error') return
    const t = m.text()
    if (estViolationCsp(t)) obs.csp.push(masqueTexte(t, HOTE_PAGES, 180))
    else if (!/ERR_BLOCKED_BY_CLIENT|blockedbyclient/i.test(t)) obs.console.push(masqueTexte(t, HOTE_PAGES))
  })
  page.on('pageerror', (e) => obs.console.push('pageerror: ' + masqueTexte(e.message, HOTE_PAGES)))
  page.on('requestfailed', (req) => {
    const motif = req.failure()?.errorText || ''
    if (classeEchec(motif) !== 'echec') return
    obs.echecs.push(decritRequete(req.url(), HOTE_PAGES, motif))
  })
  page.on('response', async (res) => {
    const req = res.request()
    // Le document lui-même : son code est `http`, pas une requête de plus.
    if (req.isNavigationRequest() && req.frame() === page.mainFrame()) return
    if (res.status() >= 400) obs.echecs.push(decritRequete(res.url(), HOTE_PAGES, `HTTP ${res.status()}`))
    const u = new URL(res.url())
    if (u.hostname === HOTE_PAGES && /\.js$/.test(u.pathname) && res.ok()) {
      try {
        for (const m of (await res.text()).matchAll(/https:\/\/([a-z]{20})\.supabase\.co/g)) obs.supabase.add(m[1])
      } catch {
        /* corps déjà libéré : la santé du backend se passera de ce fichier */
      }
    }
  })
  try {
    const rep = await page.goto(app.url, { waitUntil: 'load', timeout: 45000 })
    obs.http = rep?.status() ?? null
    // Quinze secondes pour monter, puis le réseau : ce que l'app demande APRÈS
    // son montage (le jeu public de miss-arcade) est ce qui la fait vivre. Une
    // app temps réel n'est jamais au repos : huit secondes au plus.
    await page.waitForFunction(MONTE, null, { timeout: 15000 }).catch(() => {})
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {})
    await page.waitForTimeout(1500)
    Object.assign(obs, await page.evaluate(ETAT_DOM))
  } catch (e) {
    obs.erreur = masqueTexte(e.message.split('\n')[0], HOTE_PAGES, 120)
  }
  await ctx.close().catch(() => {})
  return obs
}

/** N à la fois, dans l'ordre du catalogue. */
async function enLot(liste, n, f) {
  const out = new Array(liste.length)
  let i = 0
  await Promise.all(
    Array.from({ length: Math.min(n, liste.length) }, async () => {
      while (i < liste.length) {
        const k = i++
        out[k] = await f(liste[k])
      }
    }),
  )
  return out
}

/* ── La santé des backends ──────────────────────────────────────────────── */

const santes = new Map()
async function santeSupabase(ref) {
  if (santes.has(ref)) return santes.get(ref)
  const essai = async () => {
    try {
      const r = await fetch(`https://${ref}.supabase.co/auth/v1/health`, { signal: AbortSignal.timeout(15000) })
      return etatBackend({ status: r.status })
    } catch (e) {
      return etatBackend({ erreur: e.cause?.code || e.name })
    }
  }
  let etat = await essai()
  if (etat.injoignable) etat = await essai()
  const sante = { hote: masqueHote(`${ref}.supabase.co`), ...etat }
  santes.set(ref, sante)
  return sante
}

async function juge(app, obs) {
  const backends = await Promise.all([...obs.supabase].map(santeSupabase))
  return { obs, backends, ...verdictSonde({ ...obs, backends }) }
}

/* ── Le passage ─────────────────────────────────────────────────────────── */

const premiers = await enLot(apps, PARALLELE, async (app) => juge(app, await observe(app)))
// UNE APP EN ÉCHEC EST RETENTÉE, SEULE : un passage à trois de front sur un
// runner chargé peut faire manquer un montage, et un hoquet du réseau une
// requête. Seul le second avis compte.
const resultats = []
for (const [k, app] of apps.entries()) {
  let r = premiers[k]
  let essais = 1
  if (r.etat === 'ko') {
    santes.clear()
    r = await juge(app, await observe(app))
    essais = 2
  }
  resultats.push({
    id: app.id,
    depot: app.depot,
    url: app.url,
    etat: r.etat,
    raisons: r.raisons,
    essais,
    http: r.obs.http,
    bloques: r.obs.bloques,
    console: [...new Set(r.obs.console)].slice(0, 5),
    backends: r.backends,
  })
}
await navigateur.close()

const sortie = { version: 1, date: new Date().toISOString(), duree: Math.round((Date.now() - t0) / 1000), compte: COMPTE, apps: resultats }
mkdirSync(dirname(SORTIE), { recursive: true })
writeFileSync(SORTIE, JSON.stringify(sortie, null, 1) + '\n')
for (const r of resultats) console.log(`${r.etat === 'ok' ? '✓' : '✕'} ${r.id}${r.essais > 1 ? ' (2 essais)' : ''}${r.raisons.length ? ' — ' + r.raisons.map((x) => [x.cle, x.code, x.n, x.exemple, x.erreur].filter((v) => v != null).join(' ')).join(' ; ') : ''}`)
const ko = resultats.filter((r) => r.etat === 'ko').length
console.error(`${resultats.length} apps sondées en ${sortie.duree} s : ${ko} répondent sans fonctionner. → ${SORTIE}`)
