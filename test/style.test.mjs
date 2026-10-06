// La feuille de style, lue comme du texte.
//
// POURQUOI CE TEST-LÀ. Un texte `.sr` est absolu : il prend pour repère le
// premier ancêtre POSITIONNÉ. Dans une zone à défilement qui n'en est pas un,
// il sort de la zone et élargit toute la page — sans que rien ne se voie, sinon
// une barre de défilement horizontale. Vécu deux fois : 227 px par la matrice
// d'usage (06/10/2026), puis 177 px sur un écran de 426 px, par la colonne
// « Retard » des Librairies.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const css = readFileSync(new URL('../scripts/style.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
// Les règles feuilles : celles d'un `@media` sont lues comme les autres.
const regles = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, sel, corps]) => ({
  selecteurs: sel
    .trim()
    .split(',')
    .map((s) => s.trim()),
  corps,
}))

test('toute zone à défilement est le repère des textes .sr qu’elle contient', () => {
  const positionnes = new Set(regles.filter((r) => /position:\s*(?:relative|absolute|fixed|sticky)/.test(r.corps)).flatMap((r) => r.selecteurs))
  const defilants = regles.filter((r) => /overflow(?:-[xy])?:\s*(?:auto|scroll)/.test(r.corps)).flatMap((r) => r.selecteurs)
  assert.ok(defilants.includes('.tableEnveloppe') && defilants.includes('.matriceEnveloppe'), 'la lecture des règles a changé')
  assert.deepEqual(
    defilants.filter((s) => !positionnes.has(s)),
    [],
    'une zone à défilement sans `position` laisse ses `.sr` élargir la page',
  )
})
