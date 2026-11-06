// Les pages publiées en double entre les sites du parc.
//
// POURQUOI CES TESTS-LÀ. Une règle de ressemblance se trompe de deux façons,
// toutes deux silencieuses : elle se tait sur une vraie copie (ce qui s'est
// passé six jours durant, du 31/10 au 06/11/2026), ou elle accuse deux pages
// qui partagent seulement le gabarit du socle — et une alerte qui crie à tort
// cesse vite d'être lue.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { BARDEAUX_MIN, SEUIL_DOUBLON, bardeaux, groupesDeDoublons, jaccard, proprietaire, texteRedige, titreDe, urlsDuPlan } from '../scripts/doublons.mjs'

/** Un texte rédigé, assez long pour se comparer, et propre à `graine`. */
const texte = (graine, n = 60) => Array.from({ length: n }, (_, i) => `${graine}${i}`).join(' ')

/** Une page de contenu telle que le gabarit du socle la rend. */
const pageDeContenu = (titre, corps) => `<!doctype html><html><head><title>${titre} · Miss X</title></head><body>
<header><a href="./">Miss X</a> · application du parc</header>
<main><nav aria-label="Fil d’Ariane">Accueil › Guides</nav>
<article><h1>${titre}</h1><p>${corps}</p></article>
<aside class="cta">Ouvrir l’application</aside></main>
<footer>Code source · Signaler un problème · M’offrir un café</footer></body></html>`

/** Un accueil construit : le bloc servi, dans le point de montage. */
const accueil = (corps) => `<html><head><title>Miss X</title><script>var x = "<article>leurre</article>"</script></head><body>
<div id="app"><div data-dwc="served-content"><h1>Miss X - le titre</h1><p>La description.</p><section data-dwc="served-text"><h2>Pour qui</h2><p>${corps}</p></section></div></div></body></html>`

const SITES = [
  { depot: 'mister-guiiug.github.io', base: 'https://mister-guiiug.github.io/' },
  { depot: 'miss-x', base: 'https://mister-guiiug.github.io/miss-x/' },
  { depot: 'miss-xy', base: 'https://mister-guiiug.github.io/miss-xy/' },
]

test('le plan de site : ses URL, et un index se reconnaît', () => {
  const plan = urlsDuPlan(`<?xml version="1.0"?><urlset><url><loc> https://a/x.html </loc><lastmod>2026-11-01</lastmod></url><url><loc>https://a/?q=1&amp;r=2</loc></url></urlset>`)
  assert.deepEqual(plan, { index: false, locs: ['https://a/x.html', 'https://a/?q=1&r=2'] })
  assert.equal(urlsDuPlan('<sitemapindex><sitemap><loc>https://a/sitemap-hub.xml</loc></sitemap></sitemapindex>').index, true)
  assert.deepEqual(urlsDuPlan(null), { index: false, locs: [] })
})

test('une URL appartient au site de plus long préfixe, pas à la racine qui les préfixe tous', () => {
  assert.equal(proprietaire('https://mister-guiiug.github.io/miss-x/guide.html', SITES), 'miss-x')
  // `miss-xy` commence par `miss-x` : le préfixe se compare avec sa barre finale.
  assert.equal(proprietaire('https://mister-guiiug.github.io/miss-xy/', SITES), 'miss-xy')
  assert.equal(proprietaire('https://mister-guiiug.github.io/guides.html', SITES), 'mister-guiiug.github.io')
  assert.equal(proprietaire('https://ailleurs.example/', SITES), null)
})

test('le texte rédigé : l’article, sinon le bloc servi, sinon le main — jamais le gabarit', () => {
  const p = texteRedige(pageDeContenu('Règles du jeu', 'Le texte d&#39;un guide &amp; ses r&#xE8;gles.'))
  assert.equal(p, "Règles du jeu Le texte d'un guide & ses règles.")
  assert.doesNotMatch(p, /Signaler|Ariane|Ouvrir/)
  // Un accueil : le texte d'accueil seul, et un `<article>` cité dans un script
  // n'est pas un article.
  assert.equal(texteRedige(accueil('Les joueurs du dimanche.')), 'Pour qui Les joueurs du dimanche.')
  assert.equal(texteRedige('<main><p>Une page hors socle.</p></main>'), 'Une page hors socle.')
  assert.equal(texteRedige('<body><p>Rien de rédigé.</p></body>'), '')
})

test('le titre : le h1 de l’article, sinon celui de la page, sinon le title', () => {
  assert.equal(titreDe(pageDeContenu('Créer une PWA', 'x')), 'Créer une PWA')
  assert.equal(titreDe(accueil('x')), 'Miss X - le titre')
  assert.equal(titreDe('<title> Seul &amp; unique </title>'), 'Seul & unique')
})

test('des bardeaux de cinq mots, insensibles à la casse et à l’apostrophe typographique', () => {
  assert.deepEqual([...bardeaux('Un deux trois quatre cinq six')], ['un deux trois quatre cinq', 'deux trois quatre cinq six'])
  assert.deepEqual(bardeaux("L’appli d'un club à Lyon ici"), bardeaux("l'appli d’un CLUB à lyon ici"))
  assert.equal(bardeaux('trop court').size, 0)
  assert.equal(jaccard(new Set(['a', 'b']), new Set(['b', 'c'])), 1 / 3)
  assert.equal(jaccard(new Set(), new Set()), 0)
})

test('les copies renommées du squelette forment UN groupe, et les pages sœurs aucun', () => {
  // Le cas du 31/10/2026 : le même guide sur trois sites, où seul le nom de
  // l'application change — quelques bardeaux de différence sur des centaines.
  const guide = texte('pwa', 400)
  const pages = [
    { depot: 'pwa-starter-kit', url: 'https://h/pwa-starter-kit/creer.html', titre: 'Créer une PWA', bardeaux: bardeaux(`PWA Starter Kit ${guide}`) },
    { depot: 'miss-holi-voyage', url: 'https://h/miss-holi-voyage/creer.html', titre: 'Créer une PWA', bardeaux: bardeaux(`Miss Holi Voyage ${guide}`) },
    { depot: 'miss-arcade', url: 'https://h/miss-arcade/creer.html', titre: 'Créer une PWA', bardeaux: bardeaux(`Miss Arcade ${guide}`) },
    // Deux apps sœurs qui partagent une section entière : sous le seuil.
    { depot: 'miss-supaboss', url: 'https://h/miss-supaboss/', titre: 'Supaboss', bardeaux: bardeaux(`${texte('commun', 40)} ${texte('boss', 120)}`) },
    { depot: 'miss-supatool', url: 'https://h/miss-supatool/', titre: 'Supatool', bardeaux: bardeaux(`${texte('commun', 40)} ${texte('tool', 120)}`) },
  ]
  const groupes = groupesDeDoublons(pages)
  assert.equal(groupes.length, 1)
  const [g] = groupes
  assert.equal(g.titre, 'Créer une PWA')
  // La première par ordre d'URL : une clé stable d'un relevé à l'autre.
  assert.equal(g.url, 'https://h/miss-arcade/creer.html')
  assert.deepEqual(
    g.depots.map((x) => x.depot),
    ['miss-arcade', 'miss-holi-voyage', 'pwa-starter-kit'],
  )
  assert.ok(g.similarite >= SEUIL_DOUBLON && g.similarite <= 1, String(g.similarite))
  assert.ok(jaccard(pages[3].bardeaux, pages[4].bardeaux) < SEUIL_DOUBLON)
})

test('des accueils au même texte sous des titres différents : le groupe ne prend aucun des titres', () => {
  // L'accueil de miss-arcade portait son h1, et le texte du squelette.
  const corps = bardeaux(texte('accueil', 200))
  const [g] = groupesDeDoublons([
    { depot: 'miss-arcade', url: 'https://h/miss-arcade/', titre: 'Miss Arcade - jeux de stand', bardeaux: corps },
    { depot: 'pwa-starter-kit', url: 'https://h/pwa-starter-kit/', titre: 'PWA Starter Kit - squelette', bardeaux: corps },
  ])
  assert.equal(g.titre, null)
  assert.equal(g.similarite, 1)
})

test('un groupe se forme de proche en proche, et garde son lien le plus faible', () => {
  // A ≈ B et B ≈ C, A un peu plus loin de C : un seul groupe de trois.
  const base = texte('m', 200)
  const pages = [
    { depot: 'a', url: 'https://h/a/', bardeaux: bardeaux(`${base} ${texte('a', 8)}`) },
    { depot: 'b', url: 'https://h/b/', bardeaux: bardeaux(base) },
    { depot: 'c', url: 'https://h/c/', bardeaux: bardeaux(`${texte('c', 8)} ${base}`) },
  ]
  const [g, ...rien] = groupesDeDoublons(pages)
  assert.equal(rien.length, 0)
  assert.equal(g.depots.length, 3)
  const faible = Math.min(jaccard(pages[0].bardeaux, pages[1].bardeaux), jaccard(pages[1].bardeaux, pages[2].bardeaux), jaccard(pages[0].bardeaux, pages[2].bardeaux))
  assert.equal(g.similarite, Math.floor(faible * 100) / 100)
  // Sans titre commun, le groupe n'en porte aucun.
  assert.equal(g.titre, null)
})

test('une page trop courte, ou relevée deux fois, ne fait pas de doublon', () => {
  const court = bardeaux(texte('c', BARDEAUX_MIN + 2))
  assert.ok(court.size < BARDEAUX_MIN)
  assert.deepEqual(
    groupesDeDoublons([
      { depot: 'a', url: 'https://h/a/a-propos', bardeaux: court },
      { depot: 'b', url: 'https://h/b/a-propos', bardeaux: court },
    ]),
    [],
  )
  // La même URL listée par deux plans (la racine et l'app) n'est pas un doublon d'elle-même.
  const long = bardeaux(texte('l', 100))
  assert.deepEqual(
    groupesDeDoublons([
      { depot: 'miss-x', url: 'https://h/miss-x/g.html', bardeaux: long },
      { depot: 'miss-x', url: 'https://h/miss-x/g.html', bardeaux: long },
    ]),
    [],
  )
  assert.deepEqual(groupesDeDoublons(undefined), [])
})
