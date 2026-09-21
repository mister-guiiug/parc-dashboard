// Les règles pures du relevé, séparées du script qui les applique.
//
// POURQUOI UN FICHIER À PART. `releve.mjs` s'exécute à l'import : il a du
// `await` au niveau racine et fait trois cents appels réseau. Rien de ce qu'il
// contient n'était donc testable sans partir chercher l'API GitHub. Ces
// cinq fonctions-là ne dépendent de rien — même entrée, même sortie — et ce
// sont exactement celles dont une régression se voit le plus tard :
// `fond()` en particulier décide si la CI commite, et une erreur y ferait
// réécrire `index.html` toutes les nuits sans que rien ait bougé.

/** Retire le préfixe de plage (`^`, `~`, `>=`) et la préversion. */
export const nettoie = (v) =>
  String(v || '')
    .replace(/^[\^~>=<\s]*/, '')
    .split('-')[0]

/** Compare deux versions sur leurs trois premiers segments. < 0 si a est plus ancienne. */
export function cmpVersion(a, b) {
  const pa = nettoie(a).split('.').map((n) => parseInt(n, 10) || 0)
  const pb = nettoie(b).split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0)
  return 0
}

// Les trois couches du socle ne se devinent pas : `pwa-starter-kit` EST une PWA
// (il en est le squelette), un signal seul le rangerait avec les applications.
//
// LES RÔLES SONT DES CLÉS, PAS DES PHRASES. Écrits en français, ils cuisaient
// la langue dans le modèle : le JSON embarqué portait « bibliothèque
// partagée », et aucun sélecteur de langue n'aurait pu le défaire après coup.
// La page les traduit par `libelles.mjs`, qui laisse passer tel quel ce qui
// n'est pas une clé — un nom propre (`Electron`, `.NET`, un langage rendu par
// l'API GitHub) n'a pas de traduction à chercher.
export const SOCLE = {
  'dev-pwa-config': 'role.bibliotheque',
  'pwa-starter-kit': 'role.squelette',
  'create-lg-pwa-app': 'role.generateur',
}

/**
 * UN ALIAS npm N'EST PAS UN PAQUET.
 *
 * `"typescript-7": "npm:typescript@~7.0.2"` déclare une dépendance dont le NOM
 * dans `package.json` n'existe pas au registre : interrogé sur `typescript-7`,
 * npm répond **404**. Sans résoudre l'alias, le relevé produisait une ligne
 * sans amont, sans date de publication et sans dépôt amont — donc une
 * librairie que la page ne pouvait jamais dire en retard. Un angle mort, et
 * pas un blanc anodin : le jour où l'alias resterait figé sur une version
 * corrigée depuis, rien ne l'aurait signalé.
 *
 * La règle est GÉNÉRALE, et c'est voulu : tout ce qui commence par `npm:` est
 * un alias, quel que soit le paquet visé. Un cas particulier écrit pour
 * `typescript-7` aurait laissé le prochain alias reproduire le défaut.
 *
 * @param {string} plage La valeur déclarée dans `package.json`.
 * @returns {{paquet: string, plage: string} | null} `null` si ce n'est pas un alias.
 */
export function aliasNpm(plage) {
  const brut = String(plage || '')
  if (!brut.startsWith('npm:')) return null
  const reste = brut.slice(4)
  // Le paquet peut être SCOPÉ (`npm:@scope/nom@^1.2.3`) : le séparateur est le
  // dernier `@`, pas le premier — sur un scope, le premier est celui du scope.
  const coupe = reste.lastIndexOf('@')
  if (coupe <= 0) return reste ? { paquet: reste, plage: '' } : null
  return { paquet: reste.slice(0, coupe), plage: reste.slice(coupe + 1) }
}

/** Le paquet RÉELLEMENT publié derrière une dépendance déclarée. */
export const paquetReel = (nom, plage) => aliasNpm(plage)?.paquet || nom

/**
 * DEUX MAJEURS QUI COEXISTENT PAR DÉCISION, PAS PAR RETARD.
 *
 * `enRetard` compare une version au `latest` du registre, ce qui est juste
 * tant qu'un parc n'a qu'une bonne réponse. TypeScript n'en a pas qu'une :
 *
 *  - **`typescript-eslint` interdit le 7.** Sa dernière version, la 8.70.1,
 *    déclare `typescript: ">=4.8.4 <6.1.0"` — relu sur le registre le
 *    21/09/2026, pas supposé, et la canary `8.70.2-alpha.0` porte la même
 *    plage. Ce n'est même pas une peer qu'on pourrait forcer : `dist/index.js`
 *    **lève à l'import** quand le majeur est ≥ 7, donc ESLint meurt pour TOUS
 *    les fichiers. Et comme espree ne lit pas la syntaxe TypeScript, s'en
 *    passer n'enlèverait pas quelques règles — cela éteindrait tout le lint des
 *    `.ts`. Le garde visant `>= 7`, il attrapera aussi la 7.1 : le suivi amont
 *    est typescript-eslint#10940.
 *  - **Ce qui ne lint pas avec lui prend le 7**, et c'est bien. Au relevé du
 *    20/09/2026, `vscode-sops-diff` y est, seul, sans rien casser.
 *
 * Les vingt-deux dépôts en 6.0.3 étaient donc comptés « en retard » sur une
 * version qu'ils ne PEUVENT PAS prendre, et la seule manière de faire taire le
 * signal aurait été de casser leur lint. Un voyant qui ne s'éteint qu'en
 * dégradant ce qu'il surveille ne mesure plus rien : il apprend à être ignoré.
 *
 * CE N'EST PAS UNE LISTE D'EXEMPTIONS COMMODE. Y ajouter une ligne est une
 * décision, qui demande la même chose que celle-ci : une contrainte AMONT
 * vérifiable, écrite avec sa source. Le jour où `typescript-eslint` accepte le
 * 7, cette entrée disparaît et vingt-deux dépôts redeviennent en retard —
 * c'est exactement ce qu'on veut qu'il se passe.
 */
export const MAJEURS_ADMIS = {
  typescript: ['6', '7'],
}

/**
 * PLAFONNER N'EST PAS EXEMPTER, ET LES CONFONDRE AURAIT ÉTEINT UN VOYANT.
 *
 * `typescript-7` est l'autre moitié de la décision ci-dessus : depuis le
 * 21/09/2026 les dépôts du parc portent les deux compilateurs — la 6 que
 * `typescript-eslint` résout, et la 7 en second avis non bloquant
 * (`type-check:7`). L'alias est délibérément tenu en 7.x.
 *
 * Il aurait été tentant de l'écrire dans `MAJEURS_ADMIS`, et ce serait faux :
 * cette table EXEMPTE du retard, donc un alias resté en 7.0.2 quand la 7.0.9
 * existe serait passé pour à jour. Ce qu'on veut dire est plus étroit — sa
 * référence n'est pas `latest`, c'est la plus haute 7.x — et cela se dit ici.
 *
 * Tant que `latest` tient dans le plafond, cette table ne change RIEN : elle
 * prendra effet le jour où TypeScript 8 paraîtra, sans qu'on ait à y revenir.
 */
export const PLAFONDS = {
  'typescript-7': ['7'],
}

/** Le majeur d'une version ou d'une plage : `^6.0.3` → `6`. */
export const majeurDe = (v) => nettoie(v).split('.')[0]

/** Cette version tient-elle un majeur ADMIS pour ce paquet ? */
export const majeurAdmis = (paquet, version) =>
  (MAJEURS_ADMIS[paquet] ?? []).includes(majeurDe(version))

/**
 * LA RÉFÉRENCE D'UN PAQUET PLAFONNÉ N'EST PAS `latest`.
 *
 * `typescript-7` existe pour tenir la 7 pendant que `typescript` tient la 6.
 * Le jour où TypeScript 8 paraîtra, le comparer à `latest` le dirait « en
 * retard » alors qu'écarter la 8 est précisément son office — et l'inverse est
 * aussi vrai : tant qu'on le compare à `latest`, un alias resté en 7.0.2 quand
 * la 7.0.9 existe passerait pour à jour si on l'avait simplement exempté.
 *
 * On ne l'exempte donc pas, on lui donne la BONNE référence : la plus haute
 * version publiée dans ses majeurs admis. Tant que `latest` y est — c'est le
 * cas aujourd'hui, 7.0.2 — la fonction rend `latest` sans rien changer.
 *
 * Les préversions sont écartées : une `8.0.0-beta` n'est pas une cible, et une
 * préversion publiée sous une étiquette stable ferait rétrograder le parc en
 * silence.
 */
export function amontAdmis(paquet, versionsPubliees, latest) {
  const majeurs = PLAFONDS[paquet]
  if (!majeurs || !latest) return latest ?? null
  if (majeurs.includes(majeurDe(latest))) return latest
  const dans = (versionsPubliees ?? []).filter(
    (v) => majeurs.includes(majeurDe(v)) && !String(v).includes('-')
  )
  if (!dans.length) return latest
  return dans.sort((a, b) => cmpVersion(b, a))[0]
}

/** Chaque règle repose sur un signal LISIBLE dans le dépôt, pas sur son nom —
 *  sauf le socle et `.github`, qui n'en portent aucun. */
export function classe(nom, deps, crates, pkg, langage) {
  if (SOCLE[nom]) return { famille: 'socle', role: SOCLE[nom] }
  if (nom === '.github') return { famille: 'autre', role: 'role.compte' }
  if (pkg?.engines?.vscode || pkg?.contributes) return { famille: 'autre', role: 'role.vscode' }
  if (deps.electron) return { famille: 'desktop', role: 'Electron' }
  if (crates.tauri || deps['@tauri-apps/api']) return { famille: 'desktop', role: 'Tauri' }
  if (langage === 'C#') return { famille: 'desktop', role: '.NET' }
  if (deps['vite-plugin-pwa']) return { famille: 'pwa', role: null }
  return { famille: 'autre', role: langage || null }
}

/** L'état d'un run : un run non terminé n'est NI vert ni rouge. */
export function etatDe(run) {
  if (!run) return 'jamais'
  if (run.status !== 'completed') return 'encours'
  if (run.conclusion === 'success') return 'vert'
  if (['skipped', 'cancelled', 'neutral'].includes(run.conclusion)) return 'neutre'
  return 'rouge'
}

/**
 * Le FOND d'un relevé : ce qui doit déclencher une réécriture du fichier.
 *
 * En sont retirées les mesures qui changent d'un passage à l'autre sans rien
 * dire de l'état du parc — l'horodatage, et le temps de réponse HTTP de chaque
 * site. Sans ça, deux relevés identiques produiraient quand même un commit par
 * jour. C'est aussi pour cette raison que le relevé stocke des DATES et jamais
 * des âges en jours : un âge vieillit tout seul, et rendrait cette comparaison
 * éternellement fausse.
 *
 * `changements` en est retiré POUR UNE AUTRE RAISON, et elle mérite d'être
 * écrite. Cette liste décrit une TRANSITION, pas un état. Si on la comptait
 * dans le fond, un jour de changement serait suivi d'un second commit le
 * lendemain — celui qui remet la liste à vide — alors que rien n'aurait bougé.
 * Le bandeau de la page dit donc « depuis le relevé du … », et reste juste :
 * il décrit le dernier vrai changement, sur la page née de ce changement.
 */
export function fond(modele) {
  if (!modele) return null
  const o = JSON.parse(JSON.stringify(modele))
  delete o.genere
  delete o.changements
  delete o.compareA
  // L'historique est un JOURNAL : il grandit à chaque publication, donc le
  // compter reviendrait à publier une fois de plus chaque fois qu'on publie.
  delete o.historique
  for (const d of o.depots || []) {
    if (d.pages) delete d.pages.ms
  }
  return JSON.stringify(o)
}

/**
 * Remplace le point du jour sans PERDRE ce qu'un passage précédent avait su
 * mesurer.
 *
 * Mesuré le 14/09/2026, et pas supposé : un relevé lancé en CI avec le seul
 * `GITHUB_TOKEN` ne sait pas lire les alertes de vulnérabilité — il écrit donc
 * `alertes: null`. Sans cette fusion, ce passage-là écrasait le `alertes: 0`
 * qu'un relevé mieux doté avait relevé le matin même, et la courbe perdait son
 * point. Une mesure absente n'est pas une mesure à zéro, et elle n'a surtout
 * pas à effacer une mesure réelle.
 *
 * L'inverse est vrai aussi : une valeur fraîche l'emporte toujours sur
 * l'ancienne. On ne garde l'ancienne que là où la nouvelle est `null`.
 */
export function fusionnePoint(ancien, nouveau) {
  if (!ancien) return nouveau
  const out = { ...nouveau }
  for (const [k, v] of Object.entries(ancien)) {
    if (out[k] == null && v != null) out[k] = v
  }
  return out
}

// LE RELEVÉ PRÉCÉDENT ÉTAIT DÉJÀ LU, PUIS JETÉ. Il servait uniquement à décider
// s'il fallait réécrire le fichier. Le comparer coûte donc zéro appel réseau, et
// répond à la question qu'on se pose vraiment en ouvrant la page : qu'est-ce qui
// a changé depuis la dernière fois ?
export function changementsDepuis(av, ap) {
  if (!av) return []
  const out = []
  const parNom = (m) => new Map((m.depots || []).map((d) => [d.nom, d]))
  const A = parNom(av)
  const B = parNom(ap)

  for (const nom of B.keys()) if (!A.has(nom)) out.push({ type: 'depot-entre', depot: nom })
  for (const nom of A.keys()) if (!B.has(nom)) out.push({ type: 'depot-sorti', depot: nom })

  for (const [nom, d] of B) {
    const a = A.get(nom)
    if (!a) continue
    const wA = new Map((a.workflows || []).map((w) => [w.nom, w]))
    for (const w of d.workflows || []) {
      const p = wA.get(w.nom)
      // Un passage PAR « en cours » n'est pas un événement : le job tournait,
      // voilà tout. Seuls les états conclusifs se comparent.
      const conclusif = (e) => e === 'vert' || e === 'rouge'
      if (!p || !conclusif(p.etat) || !conclusif(w.etat) || p.etat === w.etat) continue
      out.push({ type: w.etat === 'rouge' ? 'ci-rouge' : 'ci-vert', depot: nom, workflow: w.nom, url: w.url })
    }
  }

  const lA = new Map((av.libs || []).map((l) => [l.paquet, l]))
  for (const l of ap.libs || []) {
    const p = lA.get(l.paquet)
    if (!p) continue
    if (p.amont && l.amont && p.amont !== l.amont) out.push({ type: 'amont', paquet: l.paquet, de: p.amont, a: l.amont, nbDepots: l.nbDepots })
    if (!p.dormance && l.dormance) out.push({ type: 'dormante', paquet: l.paquet, depuis: l.publieLe })
    if (p.dormance && !l.dormance) out.push({ type: 'reveillee', paquet: l.paquet })
  }

  const ka = av.kpi || {}
  const kb = ap.kpi || {}
  if (ka.alertesLisibles && kb.alertesLisibles && ka.alertes !== kb.alertes) out.push({ type: 'alertes', de: ka.alertes, a: kb.alertes })

  // Le plus parlant d'abord : ce qui casse, puis ce qui se répare.
  const rang = { 'ci-rouge': 0, alertes: 1, dormante: 2, 'depot-sorti': 3, 'ci-vert': 4, reveillee: 5, amont: 6, 'depot-entre': 7 }
  return out.sort((x, y) => (rang[x.type] ?? 9) - (rang[y.type] ?? 9)).slice(0, 40)
}
