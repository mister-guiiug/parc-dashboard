#!/usr/bin/env node
// Reconstruit `historique.json` à partir de l'historique git de `index.html`.
//
//   node scripts/historique-depuis-git.mjs [--ecrire]
//
// POURQUOI. La série démarrerait vide, et la première courbe n'apparaîtrait
// qu'au bout de deux relevés — alors que chaque révision de `index.html`
// déjà commitée PORTE ses propres compteurs, dans le `<script id="donnees">`
// qu'elle embarque. Les remonter donne une tendance dès le premier jour au lieu
// d'attendre des semaines.
//
// Un point par jour, le DERNIER relevé de la journée : c'est la même règle que
// le relevé quotidien, sinon une journée agitée pèserait dix fois plus qu'une
// journée calme. Les compteurs absents d'une vieille révision — `dormantes` et
// `alertes` n'existent que depuis le 14/09/2026, `scanning` depuis le 26/09 —
// restent `null` : une courbe ne se trace qu'à partir de deux points réels, et
// un zéro inventé ferait croire à une amélioration qui n'a pas eu lieu.
//
// Outil de reprise, pas de production : à relancer seulement si le fichier est
// perdu. Le relevé quotidien, lui, ajoute son point tout seul.
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ICI = dirname(fileURLToPath(import.meta.url))
const RACINE = join(ICI, '..')
const ECRIRE = process.argv.includes('--ecrire')

const git = (...a) => execFileSync('git', ['-C', RACINE, ...a], { encoding: 'utf8', maxBuffer: 1 << 28 })

const lignes = git('log', '--format=%H %cI', '--follow', '--', 'index.html').trim().split('\n').filter(Boolean)
console.error(`${lignes.length} révisions de index.html`)

const parJour = new Map()
for (const l of lignes.reverse()) {
  const [sha, date] = l.split(' ')
  let texte
  try {
    texte = git('show', `${sha}:index.html`)
  } catch {
    continue
  }
  const m = /<script type="application\/json" id="donnees">([\s\S]*?)<\/script>/.exec(texte)
  if (!m) continue
  let d
  try {
    d = JSON.parse(m[1].replace(/\\u003c/g, '<'))
  } catch {
    continue
  }
  const k = d.kpi || {}
  const jour = (d.genere || date).slice(0, 10)
  // `reverse()` a remis l'ordre chronologique : la dernière écriture d'un jour
  // écrase les précédentes, ce qui est exactement la règle voulue.
  parJour.set(jour, {
    jour,
    taux: k.taux ?? null,
    verts: k.verts ?? null,
    rouges: k.rouges ?? null,
    depots: k.depots ?? null,
    dormantes: k.dormantes ?? null,
    dormantesArretees: k.dormantesArretees ?? null,
    alertes: k.alertes ?? null,
    alertesGraves: k.alertesGraves ?? null,
    scanning: k.scanning ?? null,
    scanningGraves: k.scanningGraves ?? null,
    socleEnRetard: k.socleEnRetard ?? null,
  })
}

const histo = [...parJour.values()].sort((a, b) => a.jour.localeCompare(b.jour))
for (const p of histo) console.error(`  ${p.jour}  taux ${p.taux ?? '—'}  verts ${p.verts ?? '—'}  rouges ${p.rouges ?? '—'}`)

if (ECRIRE) {
  writeFileSync(join(RACINE, 'historique.json'), JSON.stringify(histo) + '\n')
  console.error(`\nhistorique.json écrit : ${histo.length} point(s).`)
} else {
  console.error(`\nEssai à blanc — relancer avec --ecrire pour écrire historique.json.`)
}
