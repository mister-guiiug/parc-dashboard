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
