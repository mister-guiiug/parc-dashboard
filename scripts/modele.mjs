/**
 * Ce que le relevé CALCULE, séparé de ce qu'il va CHERCHER.
 *
 * `releve.mjs` fait 841 lignes et quatorze métiers : outils, classement,
 * enrichissement local, collecte (sept points de `fetch`), maturité, alertes,
 * échecs, sites et versions amont, modèle, dormance, changements, rendu,
 * historique, page. Le réseau et le calcul y sont mêlés — et c'est le mélange
 * qui rend le second intestable : importer le fichier déclenche la collecte,
 * exige un jeton, et consomme trois cent trente appels d'API.
 *
 * Ce module ne contient que des fonctions PURES : on leur donne des objets, on
 * regarde ce qu'elles rendent. Elles n'ouvrent rien, ne lisent rien, ne
 * dépendent d'aucune horloge qu'on ne leur passe pas.
 *
 * `regles.mjs` porte les règles partagées avec la PAGE (comparaison de
 * versions, état d'un run, empreinte). Celui-ci porte celles du RELEVÉ seul.
 */

/**
 * LES MATURITÉS, LUES DANS LE CATALOGUE DU SOCLE.
 *
 * La maturité est ÉDITORIALE : aucun signal du dépôt ne la donne. Sa seule
 * source de vérité est `FAMILY_APPS` du socle — le même fichier que lisent les
 * applications pour s'afficher les unes aux autres. La relire, plutôt que tenir
 * une liste à côté, évite un second endroit où la même chose vieillit.
 *
 * DEUX PIÈGES, ET LES DEUX ONT MORDU :
 *
 *  1. **Le découpage se fait sur les appels `app(`, pas sur une fenêtre de
 *     caractères.** Deux entrées portent de longs commentaires à l'intérieur de
 *     l'appel, qu'aucune fenêtre raisonnable ne couvrait.
 *  2. **La maturité est un argument SEUL SUR SA LIGNE** (le fichier est formaté
 *     par prettier). Chercher le littéral n'importe où l'attraperait dans un
 *     commentaire, où le mot « stable » revient souvent.
 *
 * @param {string} texte Le contenu de `apps-catalog.js`.
 * @returns {Record<string, 'alpha'|'beta'|'stable'|null>}
 */
export function maturitesDuCatalogue(texte) {
  const i = String(texte ?? '').indexOf('FAMILY_APPS')
  if (i < 0) return {}
  const out = {}
  for (const morceau of texte.slice(i).split(/\bapp\(/).slice(1)) {
    const id = /^\s*'([^']+)'/.exec(morceau)
    if (!id) continue
    const m = /^\s*'(alpha|beta|stable)',\s*$/m.exec(morceau)
    out[id[1]] = m ? m[1] : null
  }
  return out
}

/** Jours écoulés depuis une date ISO, ou `null` si elle manque. */
export const joursDepuis = (iso, maintenant) => (iso ? (maintenant - new Date(iso)) / 86400000 : null)

/** Au-delà de ce délai sans publication, une librairie est dite dormante. */
export const SEUIL_DORMANCE_JOURS = 365

/** Une librairie n'a-t-elle rien publié depuis plus d'un an ? */
export const estDormante = (l, maintenant, seuil = SEUIL_DORMANCE_JOURS) => Boolean(l.publieLe) && joursDepuis(l.publieLe, maintenant) > seuil

/**
 * POURQUOI ELLE DORT — et c'est tout l'objet du relevé.
 *
 * Mesuré le 14/09/2026 sur les dix dormantes du parc : `leaflet` n'a rien
 * publié depuis mai 2023 mais son dépôt a reçu un commit LE JOUR MÊME ;
 * `react-qr-reader` en est à une `3.0.0-beta-1` de février 2022 et son dépôt
 * n'a pas bougé depuis novembre 2023. Le même chiffre — « plus d'un an sans
 * version » — recouvre une bibliothèque vivante qui ne publie pas et une autre
 * qu'il faut remplacer.
 *
 * La date npm seule ne peut donc pas trancher : il faut le dernier commit de
 * l'amont, et l'ignorer se DIT (`inconnue`) plutôt que de se deviner.
 *
 * @returns {'archivee'|'inconnue'|'arretee'|'sans-version'}
 */
export function etatDormance(l, maintenant, seuil = SEUIL_DORMANCE_JOURS) {
  if (l.amontArchive) return 'archivee'
  const pousse = joursDepuis(l.amontPousseLe, maintenant)
  if (pousse == null) return 'inconnue'
  return pousse > seuil ? 'arretee' : 'sans-version'
}

/** Les technologies nommées sur la carte d'un dépôt, dans cet ordre. */
export const PILE_MONTREE = [
  ['React', 'react'],
  ['Vite', 'vite'],
  ['Vitest', 'vitest'],
  ['TypeScript', 'typescript'],
  ['Tailwind', 'tailwindcss'],
  ['Supabase', '@supabase/supabase-js'],
  ['Firebase', 'firebase'],
  ['Electron', 'electron'],
  ['Playwright', '@playwright/test'],
]

/**
 * LA PILE MONTRÉE SUR UNE CARTE.
 *
 * La version VERROUILLÉE l'emporte sur la version déclarée : une plage `^4.7.0`
 * accepte déjà `4.9.0`, et afficher la plage ferait passer un dépôt à jour pour
 * un retardataire. `verrouille` dit laquelle des deux on a pu lire.
 *
 * Le socle se nomme différemment DANS son propre dépôt — « socle (ce dépôt) » —
 * parce qu'il n'y est pas une dépendance mais le sujet.
 *
 * @param {object} d Le dépôt, avec `verrouillees`, `declarees`, `crates`.
 * @param {{ amont: Record<string,string>, nomSocle: string,
 *   crates?: string[], nettoie: (v: string) => string }} ctx
 */
export function pileDuDepot(d, ctx) {
  const { amont = {}, nomSocle, crates = [], nettoie } = ctx
  const pile = []
  const pousse = (nom, paquet) => {
    const v = d.verrouillees?.[paquet] || nettoie(d.declarees?.[paquet])
    if (v) pile.push({ nom, paquet, version: v, verrouille: Boolean(d.verrouillees?.[paquet]), amont: amont[paquet] || null })
  }
  if (d.nom === 'dev-pwa-config') {
    pile.push({ nom: 'socle (ce dépôt)', paquet: nomSocle, version: d.paquet?.version || '?', verrouille: true, amont: amont[nomSocle] })
  } else {
    pousse('socle', nomSocle)
  }
  for (const [etiquette, paquet] of PILE_MONTREE) pousse(etiquette, paquet)
  for (const c of crates) {
    if (d.crates?.[c]) pile.push({ nom: c, paquet: c, version: d.crates[c], verrouille: true, amont: null, rust: true })
  }
  return pile
}
