// La page reste hors des moteurs de recherche.
//
// C'est un tableau de bord technique, pas une page de destination : le 29/09/2026,
// la revue SEO du parc l'a trouvée indexable, et liée depuis la navigation du
// catalogue. GitHub Pages ne pose aucun en-tête HTTP, donc pas de `X-Robots-Tag` :
// la seule consigne possible est la balise du `<head>`, et le seul endroit où la
// page s'écrit est ce gabarit. Un retrait de la balise ne casserait rien de
// visible, c'est précisément ce que ce test garde.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

const ICI = dirname(fileURLToPath(import.meta.url))
const GABARIT = readFileSync(join(ICI, '..', 'scripts', 'gabarit.html'), 'utf8')

test('le gabarit porte noindex dans son <head>', () => {
  const tete = /<head>([\s\S]*?)<\/head>/.exec(GABARIT)?.[1]
  assert.ok(tete, '<head> introuvable')
  assert.match(tete, /<meta name="robots" content="noindex" \/>/)
  // Une seule consigne : deux balises contradictoires se liraient mal.
  assert.equal([...tete.matchAll(/<meta name="robots"/g)].length, 1)
})

test('le script principal du gabarit est syntaxiquement valide', () => {
  // Une accolade de trop (injectée le 03/10/2026) a publié une page blanche :
  // le navigateur refuse tout le script, donc tout le rendu. Les tests de
  // libellés ne parse jamais ce JS — il fallait ce filet.
  const scripts = [...GABARIT.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map((m) => m[1])
  const principal = scripts.find((s) => s.includes('function rendTout'))
  assert.ok(principal, 'script principal introuvable')
  const source = principal
    .replaceAll('__VUE__', "'use strict';")
    .replaceAll('__DONNEES__', '{}')
    .replaceAll('__EMPREINTE__', 'x')
    .replaceAll('__STYLE__', '')
  assert.doesNotThrow(() => new Function(source))
})

test('la recherche globale délègue au module command du socle', () => {
  assert.match(GABARIT, /window\.__parcCommand\s*=/)
  assert.match(GABARIT, /<script type="module" src="\.\/parc-command\.js"><\/script>/)
  assert.doesNotMatch(GABARIT, /resultatsGlobaux\.forEach/)
  assert.doesNotMatch(GABARIT, /e\.key === 'ArrowDown'/)
  const compagnon = readFileSync(join(ICI, '..', 'scripts', 'parc-command.js'), 'utf8')
  assert.match(compagnon, /attachCommandCombobox/)
  assert.match(compagnon, /from ['"]\.\/command\.js['"]/)
})
