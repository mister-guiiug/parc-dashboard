/**
 * TOUT CE QUE LA PAGE DIT, dans chaque langue qu'elle parle.
 *
 * POURQUOI CE FICHIER EXISTE. Le texte vivait à trois endroits : les nœuds du
 * `gabarit.html`, les chaînes du JavaScript en ligne, et — le plus sournois —
 * des libellés FRANÇAIS calculés par le relevé puis embarqués dans le JSON
 * (`role`, `titre` de famille, `nom` de pile). Les deux premiers se voient à la
 * relecture ; le troisième cuisait la langue dans la donnée, et aucun
 * sélecteur n'aurait pu la défaire après coup.
 *
 * LA RÈGLE, DEPUIS : un module qui CALCULE n'écrit jamais une phrase, il rend
 * une CLÉ. `regles.mjs` rend `role.vscode`, pas « extension VS Code ».
 * `modele.mjs` rend `pile.socle`. `vue.mjs` rend `groupe.lang`. La page est le
 * seul endroit qui sache dans quelle langue on lit, et donc le seul qui
 * traduise. Un test l'exige : toute clé émise par ces trois modules doit
 * exister dans les deux dictionnaires.
 *
 * DEUX LANGUES, ET LE MÉCANISME OUVERT. Le parc en sert sept dans le socle,
 * pour des applications que d'autres gens ouvrent ; cette page-ci est un
 * instrument de bord, lu par une personne, et son texte est de la prose
 * technique qui bouge à chaque relevé. En ajouter une, le jour où le besoin
 * existe, c'est une entrée dans `LANGUES` et un objet de plus ici — le gabarit
 * ne bouge pas.
 *
 * LES PLURIELS PASSENT PAR `Intl.PluralRules`, jamais par `n > 1 ? 's' : ''`.
 * La forme écrite à la main était juste en français — 0 et 1 y sont au
 * singulier — et fausse en anglais dès « 0 repositories ». Une valeur plurielle
 * est un objet `{ one, other }` indexé par la catégorie CLDR de la langue
 * courante.
 */

/** Les langues livrées, dans l'ordre du sélecteur. La première est le défaut. */
export const LANGUES = [
  ['fr', 'Français'],
  ['en', 'English'],
]

/** La langue de secours : celle dans laquelle le texte est écrit d'abord. */
export const DEFAUT = 'fr'

/**
 * La langue à servir, d'après ce que le navigateur demande.
 *
 * On compare sur la BASE (`fr-CA` → `fr`) : servir du français à un navigateur
 * canadien vaut mieux que de retomber sur le défaut parce qu'une région ne
 * correspond pas.
 *
 * @param {string[]} demandees `navigator.languages`, ou une langue mémorisée.
 */
export function choisitLangue(demandees, dispos = LANGUES.map(([c]) => c), defaut = DEFAUT) {
  for (const d of demandees ?? []) {
    const base = String(d || '')
      .toLowerCase()
      .split('-')[0]
    if (dispos.includes(base)) return base
  }
  return defaut
}

/** `{nom}` → la valeur passée. Un paramètre absent laisse le marqueur VISIBLE. */
export const interpole = (texte, params) => String(texte).replace(/\{(\w+)\}/g, (tout, nom) => (params && nom in params ? String(params[nom]) : tout))

/**
 * Le traducteur d'une langue : `T('cle')`, `T('cle', { n: 3 })`.
 *
 * UNE CLÉ INCONNUE REND LA CLÉ, elle ne lève pas. Sur un tableau de bord, une
 * exception dans le rendu vide la page entière ; une clé affichée en clair se
 * voit, se lit, et ne coûte que la ligne qu'elle occupe. C'est le test qui
 * garantit qu'il n'y en a pas — pas le rendu.
 */
export function traducteur(langue, dicos = LIBELLES, defaut = DEFAUT) {
  const dico = dicos[langue] ?? dicos[defaut]
  const secours = dicos[defaut]
  const pluriel = new Intl.PluralRules(langue)
  const T = (cle, params) => {
    let v = dico[cle]
    if (v === undefined) v = secours[cle]
    if (v === undefined) return cle
    if (v && typeof v === 'object') v = v[pluriel.select(Number(params?.n ?? 0))] ?? v.other ?? v.one
    return params ? interpole(v, params) : v
  }
  /** La clé est-elle connue ? Ce qui rend `ouTelQuel` sûr. */
  T.connait = (cle) => typeof cle === 'string' && (dico[cle] !== undefined || secours[cle] !== undefined)
  /**
   * Traduire ce qui est une clé, laisser passer ce qui est un nom propre.
   *
   * Le relevé rend `role.vscode` pour « extension VS Code » mais `Electron`
   * pour Electron : un nom propre n'a pas de traduction, et lui inventer une
   * clé n'aurait fait qu'un détour pour rendre la même chaîne.
   */
  T.ouTelQuel = (x) => (T.connait(x) ? T(x) : x)
  T.langue = langue
  return T
}

/* ══════════════════════════════════════════════════════════════════════════
 * LES DICTIONNAIRES
 *
 * Clés plates et pointées : elles se lisent dans le gabarit (`data-t`) et se
 * comparent d'une langue à l'autre sans parcourir un arbre. Les objets
 * `{ one, other }` sont des pluriels, les `{n}` des interpolations — et un test
 * vérifie que les deux langues portent les mêmes de chaque côté.
 * ═════════════════════════════════════════════════════════════════════════ */

const LIBELLES_FR = {
  /* ── la page ── */
  'page.titre': 'Parc mister-guiiug — dépôts, pipelines, librairies',
  'page.description': 'État des dépôts git du parc : pipelines GitHub Actions, dernier CI/CD, versions des librairies.',
  'page.h1': 'Parc <span class="mono">mister-guiiug</span> — dépôts, pipelines, librairies',
  'a11y.evitement': 'Aller au contenu',

  /* ── barre d'outils ── */
  'outils.theme': 'Thème',
  'outils.langue': 'Langue',
  'outils.echecs': 'Échecs',
  'outils.depots': 'Dépôts',
  'outils.librairies': 'Librairies',

  /* ── sommaire ── */
  'sommaire.bouton': 'Sommaire',
  'sommaire.al': 'Chapitres de la page',
  'sommaire.haut': '↑ Haut de page',

  /* ── en-tête chiffré ── */
  'entete.sousTitre': 'Relevé du {quand} · {depots} · {pwa} · {workflows}',
  'entete.sousTitre.depots': { one: '{n} dépôt git', other: '{n} dépôts git' },
  'entete.sousTitre.depotsPublics': { one: '{n} dépôt git public', other: '{n} dépôts git publics' },
  'entete.sousTitre.pwa': { one: '{n} application PWA', other: '{n} applications PWA' },
  'entete.sousTitre.workflows': { one: '{n} workflow', other: '{n} workflows' },
  'entete.heroQuoi': 'des workflows exécutés sont au vert sur leur dernier passage.',
  'entete.heroDetail': '{verts} verts · {rouges} rouges · répartis sur {sains} et {reprendre}.',
  'entete.heroDetail.sains': { one: '{n} dépôt sain', other: '{n} dépôts sains' },
  'entete.heroDetail.reprendre': { one: '{n} à reprendre', other: '{n} à reprendre' },
  'entete.barre.al': 'Répartition de {n} workflows : {detail}',
  'entete.barre.titre': { one: '{n} workflow — {mot}', other: '{n} workflows — {mot}' },

  /* ── états d'un run ── */
  'etat.vert': 'succès',
  'etat.rouge': 'échec',
  'etat.neutre': 'neutralisé',
  'etat.encours': 'en cours',
  'etat.jamais': 'jamais exécuté',
  'etat.neutre.long': 'neutralisé (skipped)',

  /* ── tuiles ── */
  'tuile.depots': 'Dépôts git suivis',
  'tuile.depots.publics': 'dépôts publics du compte',
  'tuile.depots.mixte': '{publics} publics · {prives} privés',
  'tuile.pwa': 'Applications PWA',
  'tuile.pwa.app': '{socle} dépôts de socle · {desktop} desktop',
  'tuile.workflows': 'Workflows actifs',
  'tuile.workflows.app': { one: '+ {n} réutilisable du socle', other: '+ {n} réutilisables du socle' },
  'tuile.vert': 'Workflows au vert',
  'tuile.vert.app': '{verts} verts · {rouges} rouges',
  'tuile.rouges': 'Workflows en échec',
  'tuile.rouges.app': { one: 'sur {n} dépôt', other: 'sur {n} dépôts' },
  'tuile.sites': 'Sites Pages en ligne',
  'tuile.sites.app': 'vérifiés par requête HTTP',
  'tuile.pr': 'Pull requests ouvertes',
  'tuile.pr.aRelire': 'à relire',
  'tuile.pr.aucune': 'aucune revue en attente',
  'tuile.socle': 'Socle publié',
  'tuile.socle.app': { one: '{n} dépôt en dessous', other: '{n} dépôts en dessous' },
  'tuile.socle.serie': 'dépôts en dessous',
  'tuile.alertes': 'Alertes de vulnérabilité',
  'tuile.alertes.dont': 'dont {graves} graves · {production} en production',
  'tuile.alertes.aucune': { one: 'aucune sur {n} dépôt interrogé', other: 'aucune sur {n} dépôts interrogés' },
  'tuile.alertes.illisibles': { one: 'illisible sur {n} dépôt — PARC_TOKEN sans le droit « Dependabot alerts »', other: 'illisibles sur {n} dépôts — PARC_TOKEN sans le droit « Dependabot alerts »' },
  'tuile.malLus': 'Dépôts mal lus',
  'tuile.malLus.app': "workflows illisibles — l'état affiché n'est pas concluant",
  'tuile.local': 'Copies de travail modifiées',
  'tuile.local.hors': { one: '{n} hors branche par défaut', other: '{n} hors branche par défaut' },
  'tuile.local.propre': 'toutes sur la branche par défaut',
  'courbe.stable': { one: 'stable sur {n} relevé', other: 'stable sur {n} relevés' },
  'courbe.delta': { one: '{signe}{delta} sur {n} relevé', other: '{signe}{delta} sur {n} relevés' },
  'courbe.al': 'de {de} à {a}, sur {n} relevés',

  /* ── ce qui a bougé ── */
  'changements.h2': 'Ce qui a bougé',
  'changements.compteur': { one: '{n} depuis le relevé du {quand}', other: '{n} depuis le relevé du {quand}' },
  'changements.ci-rouge': ' · {workflow} devient rouge',
  'changements.ci-vert': ' · {workflow} repasse au vert',
  'changements.amont': ' publie {a}',
  'changements.amont.de': ' (était {de})',
  'changements.amont.depots': { one: ' — {n} dépôt concerné', other: ' — {n} dépôts concernés' },
  'changements.dormante': ' entre dans les dormantes',
  'changements.reveillee': ' publie à nouveau',
  'changements.alertes': 'alertes de vulnérabilité : ',
  'changements.alertes.suite': '{de} → {a}',
  'changements.depot-entre': ' entre au relevé',
  'changements.depot-sorti': ' sort du relevé',
  'changements.amont.majeur': ' — nouveau majeur',
  'changements.site-tombe': ' · site injoignable',
  'changements.site-revenu': ' · site de nouveau en ligne',
  'changements.prod-retard': { one: ' · la production a {n} commit de retard', other: ' · la production a {n} commits de retard' },

  /* ── familles ── */
  'familles.h2': 'Par famille',
  'familles.chapo':
    'Une application PWA se reconnaît à <code>vite-plugin-pwa</code> et à son déploiement Pages ; une application desktop à Electron ou Tauri. Les trois couches du socle sont nommées explicitement : le squelette est lui-même une PWA, aucun signal ne le distinguerait de ce qu\'il engendre.',
  'famille.pwa.titre': 'Applications PWA',
  'famille.pwa.sous': 'Applications web installables, déployées sur GitHub Pages.',
  'famille.desktop.titre': 'Applications desktop',
  'famille.desktop.sous': 'Empaquetées avec Electron, Tauri ou .NET — hors chaîne Pages.',
  'famille.socle.titre': 'Socle',
  'famille.socle.sous': 'La bibliothèque, le squelette et le générateur dont vivent les applications.',
  'famille.autre.titre': 'Outillage et divers',
  'famille.autre.sous': 'Extensions, compétences, configuration du compte.',
  'famille.pwa.court': 'PWA',
  'famille.desktop.court': 'Desktop',
  'famille.socle.court': 'Socle',
  'famille.autre.court': 'Outillage',
  // Le mot SEUL, accordé : le chiffre est dans un `<b>` à côté.
  'famille.depots': { one: ' dépôt', other: ' dépôts' },
  'famille.auVert': ' au vert',
  'famille.rouges': { one: ' rouge', other: ' rouges' },
  'famille.barre.al': '{famille} : {verts} workflows en succès, {rouges} en échec',

  /* ── rôles, rendus par `classe()` ── */
  'role.bibliotheque': 'bibliothèque partagée',
  'role.squelette': "squelette d'application",
  'role.generateur': 'générateur',
  'role.compte': 'configuration du compte',
  'role.vscode': 'extension VS Code',

  /* ── pile d'un dépôt, rendue par `pileDuDepot()` ── */
  'pile.socle': 'socle',
  'pile.socleCeDepot': 'socle (ce dépôt)',


  /* ── ce qui est rouge ── */
  'echecs.h2': 'Ce qui est rouge',
  'echecs.chapo':
    "Dernier run de chaque workflow actif, pris sur la branche par défaut du dépôt (à défaut, le dernier run toutes branches). Les workflows réutilisables du socle sont exclus : ils n'ont pas de run propre.",
  'echecs.caption': 'Workflows en échec : dépôt, workflow, état, étape fautive, ancienneté, lien vers le run.',
  'echecs.compteur': '{rouges} sur {actifs}',
  'echecs.compteur.rouges': { one: '{n} workflow rouge', other: '{n} workflows rouges' },
  'echecs.compteur.actifs': { one: '{n} actif', other: '{n} actifs' },
  'echecs.th.depot': 'Dépôt',
  'echecs.th.workflow': 'Workflow',
  'echecs.th.etat': 'État',
  'echecs.th.ou': 'Où ça casse',
  'echecs.th.depuis': 'Depuis',
  'echecs.motif': { one: "Même cause sur {n} dépôt — l'étape « {etape} » : {depots}. Un correctif, {n} pipeline.", other: "Même cause sur {n} dépôts — l'étape « {etape} » : {depots}. Un correctif, {n} pipelines." },
  'echecs.branche': 'branche {branche}',
  'echecs.pasDemarre': "n'a pas démarré (aucun job)",
  'echecs.job': 'job : {jobs}',
  'echecs.run': 'run ↗',

  /* ── dépôts ── */
  'depots.h2': 'Dépôts',
  'depots.chapo':
    'Une carte par dépôt git : copie locale, pipelines, pile technique. Les versions de librairies sont celles <em>verrouillées</em> dans le lockfile — pas la plage déclarée.',
  'depots.recherche.ph': 'Filtrer : nom, description, librairie…',
  'depots.recherche.al': 'Filtrer les dépôts',
  'depots.filtre.echec': 'Avec échec',
  'depots.filtre.site': 'Site en ligne',
  'depots.filtre.modifie': 'Modifs locales',
  'depots.filtre.prive': 'Privés',
  'depots.tri.al': 'Trier les dépôts',
  'depots.tri.echecs': "Trier : échecs d'abord",
  'depots.tri.activite': 'Trier : activité récente',
  'depots.tri.nom': 'Trier : nom',
  'depots.tri.workflows': 'Trier : nombre de workflows',
  'depots.depliees': 'Cartes dépliées',
  'depots.aucun': 'Aucun dépôt ne répond à ces filtres.',
  'depots.compteur.tous': { one: '{n} dépôt', other: '{n} dépôts' },
  'depots.compteur.filtre': { one: '{vus} sur {n} dépôt', other: '{vus} sur {n} dépôts' },
  'depots.compteur.depliees': { one: ' · {n} dépliée', other: ' · {n} dépliées' },
  'depots.groupe.compteur': { one: '{n} dépôt', other: '{n} dépôts' },
  'depots.groupe.rouges': { one: ' · {n} workflow rouge', other: ' · {n} workflows rouges' },
  'depots.groupe.toutVert': ' · tout au vert',

  /* ── une carte de dépôt ── */
  'carte.ouvrir': 'Ouvrir {depot} sur GitHub',
  'carte.prive': 'privé',
  'carte.alertes.badge': '⚠ {n}',
  'carte.alertes.titre': { one: '{n} alerte de vulnérabilité', other: '{n} alertes de vulnérabilité' },
  'carte.alertes.graves': { one: ', dont {n} grave', other: ', dont {n} graves' },
  'carte.alertes.production': { one: ' · {n} en dépendance de production', other: ' · {n} en dépendances de production' },
  'carte.malLu.badge': '⚠ lecture partielle',
  'carte.malLu.titre': "Workflows illisibles — le jeton n'a pas pu lire l'API Actions de ce dépôt.",
  'carte.malLu.corps': "Workflows illisibles — le jeton n'a pas pu lire l'API Actions de ce dépôt. Ce qui suit n'est pas concluant.",
  'carte.copie': 'Copie de travail · ',
  'carte.copie.horsDefaut': '{branche} (défaut : {defaut})',
  'carte.copie.modifies': { one: '{n} fichier non commité', other: '{n} fichiers non commités' },
  'carte.copie.avance': '{n} en avance',
  'carte.copie.retard': '{n} en retard',
  'carte.copie.propre': ' — propre et à jour',
  'carte.branche': 'Branche · ',
  'carte.pr': { one: ' — {n} PR ouverte', other: ' — {n} PR ouvertes' },
  'carte.commit': 'Dernier commit · ',
  'carte.wf.reutilisable': ' · réutilisable',
  'carte.wf.hors': ' · hors {branche}',
  'carte.wf.jamais': 'jamais',
  'carte.wf.bande': '#{num} · {mot} · {date}',
  'carte.wf.titre': '{nom} ({fichier}) — {mot}',
  'carte.wf.titreDate': '{nom} ({fichier}) — {mot} le {date}',
  'carte.wf.plus': { one: '{n} autre workflow — {resume}', other: '{n} autres workflows — {resume}' },
  'carte.wf.aucun': 'Aucun workflow GitHub Actions.',
  'carte.pile.verrouille': '{paquet} {version} (verrouillé)',
  'carte.pile.plage': '{paquet} {version} (plage déclarée)',
  'carte.pile.amont': ' · amont : {amont}',
  'carte.site.enLigne': 'site en ligne',
  'carte.site.injoignable': 'site injoignable',
  'carte.site.titre': 'HTTP {code} en {ms} ms — {quoi}',
  'carte.deps': '{deps} dépendances déclarées · {verrouilles} paquets verrouillés',
  'carte.deps.sansLock': '{deps} dépendances déclarées · pas de package-lock',
  'carte.crates': { one: '{n} crate verrouillée', other: '{n} crates verrouillées' },
  'carte.compte.verts': { one: '{n} vert', other: '{n} verts' },
  'carte.compte.rouges': ' · {n} rouges',
  'carte.resume.sr.echec': { one: '{n} workflow en échec, ', other: '{n} workflows en échec, ' },
  'carte.resume.sr.vert': '{n} au vert, ',
  'carte.resume.titre': { one: '{n} workflow au vert', other: '{n} workflows au vert' },
  'carte.resume.titre.echec': ' · {n} en échec',
  'carte.resume.titre.commit': ' · dernier commit {date}',

  /* ── librairies ── */
  'libs.h2': 'Librairies',
  'libs.chapo':
    'Versions réellement verrouillées dans les lockfiles, agrégées sur tout le parc. Seuls les paquets présents dans <strong>au moins deux dépôts</strong> sont listés : un paquet unique est une dépendance d\'application, pas une librairie du parc. Le dégradé va du plus récent (foncé) au plus ancien ; au-delà de quatre versions, la queue est repliée en gris. Cliquez une ligne pour voir quel dépôt porte quelle version.',
  'libs.recherche.ph': 'Filtrer une librairie…',
  'libs.recherche.al': 'Filtrer les librairies',
  'libs.filtre.retard': 'Avec du retard',
  'libs.filtre.eclate': 'Versions éclatées',
  'libs.filtre.toutes': 'Mono-dépôt compris',
  'libs.aucun': 'Aucun paquet ne répond à ces filtres.',
  'libs.caption': 'Librairies du parc : paquet, nombre de dépôts, répartition des versions, version amont, dépôts en retard.',
  'libs.th.paquet': 'Paquet',
  'libs.th.depots': 'Dépôts',
  'libs.th.repartition': 'Répartition des versions <span class="sr">(du plus récent au plus ancien)</span>',
  'libs.th.amont': 'Amont',
  'libs.th.retard': 'En retard',
  'libs.compteur.tous': { one: '{n} paquet', other: '{n} paquets' },
  'libs.compteur.filtre': { one: '{vus} sur {n} paquet', other: '{vus} sur {n} paquets' },
  'libs.queue': { one: '{n} plus ancienne', other: '{n} plus anciennes' },
  'libs.seg.titre': { one: '{version} — {n} dépôt', other: '{version} — {n} dépôts' },
  'libs.barre.al': '{paquet} : {detail}',
  'libs.barre.al.seg': { one: '{version} sur {n} dépôt', other: '{version} sur {n} dépôts' },
  'libs.retard.sr': 'en retard sur l’amont : ',
  'libs.aJour': 'à jour',
  'libs.majeursAdmis': 'majeurs {majeurs}',
  'libs.majeursAdmis.titre':
    '{paquet} vit à deux majeurs dans ce parc, par décision et non par retard : une contrainte amont interdit le plus récent à une partie des dépôts. La raison est écrite dans `MAJEURS_ADMIS` (scripts/regles.mjs).',
  'libs.alias': 'alias de {paquet}',
  'libs.alias.titre':
    '{nom} n’existe pas au registre npm : c’est un alias, déclaré `npm:{paquet}@…`, qui installe {paquet} sous un autre nom. Le versionnage affiché est donc celui de {paquet}, et c’est ce qui permet de dire si l’alias prend du retard.',
  'libs.detail.amont': 'amont {amont}',
  'libs.detail.plage': 'plage déclarée : {plage} · version verrouillée',
  'libs.detail.plageSeule': 'plage déclarée : {plage} · pas de lockfile, plage affichée',
  'libs.tri.paquet': 'Trier par nom de paquet',
  'libs.tri.depots': 'Trier par nombre de dépôts',
  'libs.tri.amont': 'Trier par version amont',
  'libs.tri.retard': 'Trier par nombre de dépôts en retard',

  /* ── librairies dormantes ── */
  'dormance.h2': 'Librairies dormantes',
  'dormance.chapo':
    'Librairies dont la dernière version publiée a <strong>plus d\'un an</strong>. La date de publication seule ne dit pas grand-chose : une bibliothèque peut être stable et finie, ou simplement abandonnée. Ce tableau montre donc <strong>deux dates</strong> — la dernière version parue au registre, et le dernier commit reçu par le dépôt amont. Quand les deux se sont tues, la question d\'un remplacement se pose ; quand seul le registre se tait, c\'est une version qui manque, pas un projet mort.',
  'dormance.caption': 'Librairies sans publication depuis plus d’un an : paquet, dépôts, dernière version, âge, dépôt amont, dernier commit, lecture.',
  'dormance.th.paquet': 'Paquet',
  'dormance.th.depots': 'Dépôts',
  'dormance.th.version': 'Dernière version',
  'dormance.th.age': 'Publiée il y a',
  'dormance.th.amont': 'Dépôt amont',
  'dormance.th.commit': 'Dernier commit',
  'dormance.th.lecture': 'Lecture',
  'dormance.aucune': "Aucune librairie du parc n'est restée plus d'un an sans publication.",
  'dormance.seuil.an': 'plus d’un an',
  'dormance.seuil.ans': 'plus de {n} ans',
  'dormance.compteur': '{n} sur {total} sans version depuis {seuil} — {arretees} dont le dépôt amont s’est tu aussi',
  'dormance.compteur.aucune': { one: 'aucune sur {n} librairie datée', other: 'aucune sur {n} librairies datées' },
  'dormance.arretee': 'à l’arrêt',
  'dormance.arretee.aide': 'Ni version publiée ni commit depuis plus d’un an : prévoir un remplacement.',
  'dormance.archivee': 'archivée',
  'dormance.archivee.aide': 'Le dépôt amont est archivé : il ne recevra plus rien.',
  'dormance.sans-version': 'développée, pas publiée',
  'dormance.sans-version.aide': 'Le dépôt bouge encore ; c’est la publication qui manque.',
  'dormance.inconnue': 'dépôt introuvable',
  'dormance.inconnue.aide': 'Le paquet ne déclare pas de dépôt GitHub exploitable.',
  'dormance.archive': 'archivé',
  'dormance.tickets': { one: '{n} ticket ouvert', other: '{n} tickets ouverts' },

  /* ── matrice des écarts ── */
  'matrice.h2': 'Matrice des écarts',
  'matrice.chapo':
    'La section précédente répond « qui porte quelle version » paquet par paquet ; celle-ci les met côte à côte. Une ligne est un dépôt, une colonne un paquet, une cellule la version qu\'il <strong>verrouille</strong>. La couleur ne dit pas « vieux » dans l\'absolu mais l\'<strong>écart à la version la plus récente du parc</strong> — la seule sur laquelle on peut agir, puisqu\'un autre dépôt la tient déjà. Par défaut, seuls les paquets réellement éclatés sont montrés ; les colonnes s\'ajoutent et se retirent une à une. <strong>Tout en-tête classe le tableau</strong> — un paquet sur la version portée, <em>Dépôt</em> sur le nom, <em>Écarts</em> sur leur nombre. Un clic, puis l\'inverse, puis retour au tri courant. La comparaison des versions est <strong>sémantique</strong> : <code>1.9.0</code> précède <code>1.10.0</code>. Un dépôt qui ne dépend pas du paquet n\'a pas de version à comparer, il reste en bas dans les deux sens.',
  'matrice.caption': 'Matrice des écarts : une ligne par dépôt, une colonne par paquet, la cellule donne la version verrouillée.',
  'matrice.colonnes': 'Choisir les colonnes',
  'matrice.eclate': 'Seulement les paquets éclatés',
  'matrice.lignes': 'Seulement les dépôts en écart',
  'matrice.tri.al': 'Trier les lignes de la matrice',
  'matrice.tri.ecarts': "Trier : plus d'écarts d'abord",
  'matrice.tri.nom': 'Trier : nom',
  'matrice.tri.famille': 'Trier : famille',
  'matrice.tri.maturite': 'Trier : maturité',
  'matrice.famille.al': 'Filtrer par famille',
  'matrice.famille.etiq': 'Famille',
  'matrice.maturite.al': 'Filtrer par maturité',
  'matrice.maturite.etiq': 'Maturité',
  'maturite.alpha': 'Alpha',
  'maturite.beta': 'Bêta',
  'maturite.stable': 'Stable',
  'maturite.aucune': 'Non renseignée',
  'matrice.aucuneColonne': 'Aucune colonne sélectionnée.',
  'matrice.aucuneLigne': 'Aucun dépôt ne répond à ces filtres.',
  'matrice.th.depot': 'Dépôt',
  'matrice.th.ecarts': 'Écarts',
  'matrice.tri.depot.inactif': 'Trier les dépôts par nom',
  'matrice.tri.depot.croissant': 'Dépôt : trié de A à Z. Cliquer pour inverser.',
  'matrice.tri.depot.decroissant': 'Dépôt : trié de Z à A. Cliquer pour revenir au tri par défaut.',
  'matrice.tri.col.titre': '{paquet} — plus récente du parc : {recente}',
  'matrice.tri.col.titreAmont': '{paquet} — plus récente du parc : {recente}, amont : {amont}',
  'matrice.tri.col.inactif': 'Trier les dépôts sur la version de {paquet}',
  'matrice.tri.col.croissant': '{paquet} : trié du plus ancien au plus récent. Cliquer pour revenir au tri par défaut.',
  'matrice.tri.col.decroissant': '{paquet} : trié du plus récent au plus ancien. Cliquer pour inverser.',
  'matrice.tri.ecarts.titre': 'Nombre d’écarts sur les colonnes affichées ; la gravité départage les ex æquo.',
  'matrice.tri.ecarts.inactif': 'Trier les dépôts sur le nombre d’écarts',
  'matrice.tri.ecarts.croissant': 'Écarts : trié du moins au plus. Cliquer pour revenir au tri par défaut.',
  'matrice.tri.ecarts.decroissant': 'Écarts : trié du plus au moins. Cliquer pour inverser.',
  'matrice.cellule.aJour': '{depot} — {paquet} {version} (à jour dans le parc)',
  'matrice.cellule.retard': '{depot} — {paquet} {version} — le parc tient déjà {recente}',
  'matrice.cellule.absent': '{depot} ne dépend pas de {paquet}',
  'matrice.total.titre': { one: '{depot} — {n} écart sur les colonnes affichées ({detail}) — gravité {score}', other: '{depot} — {n} écarts sur les colonnes affichées ({detail}) — gravité {score}' },
  'matrice.total.aucun': '{depot} — aucun écart sur les colonnes affichées',
  'matrice.rang.majeure': { one: '{n} majeure', other: '{n} majeures' },
  'matrice.rang.mineure': { one: '{n} mineure', other: '{n} mineures' },
  'matrice.rang.patch': { one: '{n} patch', other: '{n} patchs' },
  'matrice.pastilleCol': '{versions}v · {depots}d',
  'matrice.compteur': '{paquets} × {depots} — {ecarts}',
  'matrice.compteur.paquets': { one: '{n} paquet', other: '{n} paquets' },
  'matrice.compteur.paquetsSur': { one: '{vus} sur {n} paquet', other: '{vus} sur {n} paquets' },
  'matrice.compteur.depots': { one: '{n} dépôt', other: '{n} dépôts' },
  'matrice.compteur.depotsSur': { one: '{vus} sur {n} dépôt', other: '{vus} sur {n} dépôts' },
  'matrice.compteur.ecarts': { one: '{n} écart', other: '{n} écarts' },

  /* ── table des éléments ── */
  'elements.h2': 'Table des éléments',
  'elements.chapo':
    'La section « librairies » les liste, la matrice les croise avec les dépôts ; celle-ci répond à une autre question — <strong>de quoi ce parc est-il fait ?</strong> Une <strong>période</strong> (une ligne) dit combien de dépôts portent l\'élément, en part du parc et non en nombre figé. Un <strong>groupe</strong> (une couleur) dit à quoi il sert. Le nombre en haut d\'une case est le compte de dépôts, la ligne du bas la version la plus récente que le parc tienne. <strong>Rien n\'est écrit à la main</strong> : les symboles se dérivent des noms, et un paquet qui arrivera demain trouvera sa place tout seul.',
  'elements.partages': 'Seulement ce qui est partagé',
  'elements.groupes.al': 'Filtrer par groupe',
  'elements.aucun': 'Aucun élément ne répond à ces filtres.',
  'elements.periode.borne': { one: '{n} dépôt', other: '{n} dépôts' },
  'elements.periode.plage': '{haut} → {bas}',
  'elements.case.titre': '{nom} — {depots} · {version} · {groupe}',
  'elements.case.depots': { one: '{n} dépôt', other: '{n} dépôts' },
  'elements.case.deduit': ' · déduit du relevé, hors lockfile',
  'elements.compteur': '{elements} · {depots}',
  'elements.compteur.tous': { one: '{n} élément', other: '{n} éléments' },
  'elements.compteur.filtre': { one: '{vus} sur {n} élément', other: '{vus} sur {n} éléments' },
  'elements.compteur.depots': { one: '{n} dépôt', other: '{n} dépôts' },
  'groupe.lang': 'Langage & types',
  'groupe.build': 'Construction',
  'groupe.ui': 'Interface',
  'groupe.data': 'État & données',
  'groupe.dos': 'Dorsale',
  'groupe.test': 'Tests',
  'groupe.qual': 'Qualité & style',
  'groupe.obs': 'Observabilité',
  'groupe.infra': 'Socle & infrastructure',
  'groupe.autre': 'Non classé',
  'periode.noyau': 'Le noyau',
  'periode.ceinture': 'La ceinture',
  'periode.besoin': 'Selon le besoin',
  'periode.specialites': 'Les spécialités',
  'periode.traces': 'Les traces',
  'element.ver.workflows': 'workflows',
  'element.ver.sites': 'sites servis',
  'element.ver.deps': 'montées de deps',
  'element.ver.a11y': 'seuils a11y',
  'element.ver.postgres': 'Postgres · RLS',
  'element.ver.proxys': 'proxys',
  'element.ver.deploiement': 'déploiement',
  'element.ver.crates': 'crates',
  'element.ver.dotnet': '.NET',
  'element.ver.scripts': 'scripts',

  /* ── activité ── */
  'activite.h2': 'Jours depuis le dernier commit local',
  'activite.chapo': 'Mesuré sur la copie de travail, pas sur GitHub.',
  'activite.tableau': 'Voir en tableau',
  'activite.graphique': 'Voir le graphique',
  'activite.th.depot': 'Dépôt',
  'activite.th.jours': 'Jours',
  'activite.th.date': 'Date du commit',
  'activite.compteur': { one: '{n} dépôt', other: '{n} dépôts' },
  'activite.axe': "Échelle de 0 à {max} jours. Le dépôt le plus ancien du parc a {max} jours de retard sur son dernier commit : aucun dépôt n'est en sommeil.",
  'activite.piste.titre': '{depot} — dernier commit le {date}',
  'activite.tri.depot': 'Trier par nom de dépôt',
  'activite.tri.jours': 'Trier par nombre de jours',
  'activite.tri.date': 'Trier par date du dernier commit',

  /* ── pied ── */
  'pied.releve': 'Relevé du {quand}.',
  'pied.source': 'Source : API GitHub, lockfiles lus sur la branche par défaut, registre npm.',
  'pied.sourceLocale': 'Source : API GitHub, lockfiles lus sur la branche par défaut, registre npm, copies de travail locales.',
  'pied.publics': 'Les dépôts privés du compte sont exclus de ce relevé.',
  'pied.soi': "Le dépôt {depot}, qui produit cette page, s'exclut lui-même.",
  'pied.regenere': 'Page régénérée chaque heure par GitHub Actions.',

  /* ── fraîcheur (etat.json) ── */
  'fraicheur.verifie': 'Vérifié {quand} · relevé chaque heure',
  'fraicheur.panne': 'Dernière vérification {quand} : le relevé horaire ne passe plus',
  'fraicheur.aLInstant': "à l'instant",
  'fraicheur.relancer': 'Relancer le relevé',
  'fraicheur.nouveau': 'Un relevé plus récent est en ligne : {quand}.',
  'fraicheur.recharger': 'Recharger',
  'fraicheur.flux': "S'abonner (Atom)",
  'flux.titre': 'Parc mister-guiiug — ce qui a bougé',

  /* ── à faire ── */
  'afaire.h2': 'À faire',
  'afaire.compteur': { one: '{n} rubrique', other: '{n} rubriques' },
  'afaire.vide': 'Rien à faire : tout est vert, en ligne et à jour.',
  'afaire.rouges': { one: '{n} dépôt a un workflow rouge', other: '{n} dépôts ont des workflows rouges' },
  'afaire.sites': { one: '{n} site injoignable', other: '{n} sites injoignables' },
  'afaire.mortes': { one: '{n} app sert des URL mortes', other: '{n} apps servent des URL mortes' },
  'afaire.prod': { one: '{n} production en retard sur sa branche', other: '{n} productions en retard sur leur branche' },
  'afaire.fugaces': { one: '{n} app charge des morceaux fugaces', other: '{n} apps chargent des morceaux fugaces' },
  'afaire.alertes': { one: '{n} dépôt a des alertes de vulnérabilité', other: '{n} dépôts ont des alertes de vulnérabilité' },
  'afaire.prs': { one: '{n} pull request à relire', other: '{n} pull requests à relire' },
  'afaire.majeures': { one: '{n} nouveau majeur à arbitrer', other: '{n} nouveaux majeurs à arbitrer' },
  'afaire.correctifs': { one: '{n} correctif ou mineure à monter', other: '{n} correctifs et mineures à monter' },
  'afaire.socle': { one: 'Socle à monter dans {n} dépôt', other: 'Socle à monter dans {n} dépôts' },
  'afaire.renovate': { one: '{n} mise à jour Renovate en attente', other: '{n} mises à jour Renovate en attente' },
  'afaire.introuvables': { one: '{n} paquet que Renovate ne sait pas résoudre', other: '{n} paquets que Renovate ne sait pas résoudre' },
  'afaire.plus': { one: '+ {n} autre', other: '+ {n} autres' },
  'afaire.moins': 'Réduire',
  'afaire.detail.compte': '{nom} ({n})',
  'afaire.detail.prod': { one: '{depot} : {n} commit de retard', other: '{depot} : {n} commits de retard' },
  'afaire.detail.fichiers': '{depot} : {fichiers}',
  'afaire.detail.pr': '{depot}#{num} {titre}',
  'afaire.detail.renovate': { one: '{depot} : {n} en attente', other: '{depot} : {n} en attente' },
  'afaire.detail.renovate.majeures': { one: ', dont {n} majeure', other: ', dont {n} majeures' },
  'afaire.detail.introuvable': { one: '{paquet} — {n} dépôt', other: '{paquet} — {n} dépôts' },
  'afaire.detail.lib': { one: '{paquet} {de} → {cible} ({n} dépôt)', other: '{paquet} {de} → {cible} ({n} dépôts)' },
  'afaire.introuvables.aide':
    "Renovate ne proposera jamais la montée d'un paquet qu'il ne résout pas. Le socle est publié sur GitHub Packages, que Renovate n'interroge pas sans jeton : tant qu'on ne lui en donne pas un, le socle se monte à la main.",
  'pr.ci.vert': 'CI verte',
  'pr.ci.rouge': 'CI rouge',
  'pr.ci.encours': 'CI en cours',
  'pr.ci.jamais': 'aucune CI',
  'pr.robot': 'robot',
  'pr.brouillon': 'brouillon',

  /* ── demande de montée ── */
  'demande.copier': 'Copier la demande',
  'demande.copiee': 'Copié ✓',
  'demande.echec': 'Copie impossible',
  'demande.entete': "D'après le tableau de bord du parc (relevé du {quand}) :",
  'demande.montee': { one: 'Monter {paquet} en {cible} ({gravite}) dans {n} dépôt :', other: 'Monter {paquet} en {cible} ({gravite}) dans {n} dépôts :' },
  'demande.depot': '{depot} (en {version})',
  'demande.depot.transitif': '{depot} (en {version}, au lockfile seulement : non déclaré, pair du socle)',
  'gravite.patch': 'correctif',
  'gravite.mineure': 'mineure',
  'gravite.majeure': 'majeure',

  /* ── librairies : âge, notes, transitifs ── */
  'libs.fraiche': 'moins de 24 h',
  'libs.fraiche.titre': "Publiée le {quand}, il y a moins de 24 h : pnpm 12 refuse de l'installer, et un correctif du correctif sort souvent le lendemain.",
  'libs.publiee': 'Publiée le {quand}',
  'libs.notes': 'Notes de version ↗',
  'libs.transitifs': { one: 'dont {n} transitif', other: 'dont {n} transitifs' },
  'libs.transitifs.titre': "Dépôts qui ne déclarent pas ce paquet : c'est une pair du socle, installée d'office, et c'est leur lockfile qui fixe la version qui tourne.",
  'libs.detail.transitif': 'Non déclaré : pair du socle, figée par le lockfile',

  /* ── correctifs de série, plafonds, Node ── */
  'libs.serie': 'correctif {cible} dans la {serie}',
  'libs.serie.titre': "La dernière version de la série en cours : elle se monte sans attendre la décision sur l'amont.",
  'libs.detail.derniere': 'dernière de la {serie} : {version}',
  'libs.plafond': 'plafonné par {moteur}',
  'libs.plafond.titre':
    "Ces types suivent la version que déclare {moteur} ({plafond}) : plus récents, ils décriraient une API que le moteur promis n'a pas. On les compare à ce plafond, pas à l'amont.",
  'libs.detail.plafond': 'plafond {moteur} : {plafond}',
  'libs.nvmrc.titre': "La version de Node qu'épingle le .nvmrc de chaque dépôt ; l'amont est la dernière publiée sur nodejs.org.",
  'afaire.detail.serie': 'sans quitter la {serie}',
  'afaire.detail.plafond': 'plafond {moteur}',
  'demande.montee.serie': {
    one: 'Monter {paquet} en {cible} ({gravite}, sans quitter la {serie} ; la {amont} se décide à part) dans {n} dépôt :',
    other: 'Monter {paquet} en {cible} ({gravite}, sans quitter la {serie} ; la {amont} se décide à part) dans {n} dépôts :',
  },
  'demande.montee.plafond': {
    one: 'Monter {paquet} en {cible} ({gravite}, plafond de {moteur}) dans {n} dépôt :',
    other: 'Monter {paquet} en {cible} ({gravite}, plafond de {moteur}) dans {n} dépôts :',
  },

  /* ── production, Renovate (cartes) ── */
  'carte.prod': 'Production · ',
  'carte.prod.aJour': '{commit} = {branche}, construite {quand}',
  'carte.prod.equivalent': {
    one: "{commit} — {branche} a {n} commit d'avance, hors build seulement",
    other: "{commit} — {branche} a {n} commits d'avance, hors build seulement",
  },
  'carte.prod.deploiement': {
    one: "{commit} — {branche} a {n} commit d'avance : déploiement probablement en cours",
    other: "{commit} — {branche} a {n} commits d'avance : déploiement probablement en cours",
  },
  'carte.prod.retard': { one: "{commit} — {branche} a {n} commit d'avance, non déployé", other: "{commit} — {branche} a {n} commits d'avance, non déployés" },
  'carte.prod.inconnu': '{commit}, comparaison impossible',
  'carte.prod.absente': 'non mesurable : le site ne publie pas de version.json',
  'carte.prod.titre': 'Construite le {quand}',
  'carte.prod.badge': 'prod en retard',
  'carte.mortes': 'URL mortes en production : {fichiers}. La page en ligne les demande, et elles ne répondent pas.',
  'carte.mortes.badge': 'URL mortes',
  'carte.fugaces':
    'Morceaux fugaces : {fichiers}. Hors précache et nommés par empreinte, leur URL mourra au prochain déploiement — règle chunk-hors-precache de pwa-doctor.',
  'carte.fugaces.badge': 'URL fugaces',
  'carte.renovate': 'Renovate · ',
  'carte.renovate.attente': { one: '{n} mise à jour en attente', other: '{n} mises à jour en attente' },
  'carte.renovate.majeures': { one: ', dont {n} majeure', other: ', dont {n} majeures' },
  'carte.renovate.introuvables': ' — ne résout pas : {paquets}',

  /* ── barre de navigation, sections repliables ── */
  'nav.recherche': 'Aller à un dépôt, une librairie… ( / )',
  'nav.recherche.al': 'Aller à un dépôt ou à une librairie',
  'nav.sections': 'Sections de la page',
  'nav.type.depot': 'dépôt',
  'nav.type.lib': 'librairie',
  'section.deplier': 'Déplier',
  'section.replier': 'Replier',

  /* ── transverse ── */
  raz: 'Tout réafficher',
  'temps.aujourdhui': "aujourd'hui",
  'temps.hier': 'hier',
  'temps.jours': '{n} j',
  'temps.rien': '—',
  liste: ', ',
}

const LIBELLES_EN = {
  /* ── la page ── */
  'page.titre': 'mister-guiiug estate — repositories, pipelines, libraries',
  'page.description': 'State of the estate’s git repositories: GitHub Actions pipelines, latest CI/CD, library versions.',
  'page.h1': '<span class="mono">mister-guiiug</span> estate — repositories, pipelines, libraries',
  'a11y.evitement': 'Skip to content',

  /* ── barre d'outils ── */
  'outils.theme': 'Theme',
  'outils.langue': 'Language',
  'outils.echecs': 'Failures',
  'outils.depots': 'Repositories',
  'outils.librairies': 'Libraries',

  /* ── sommaire ── */
  'sommaire.bouton': 'Contents',
  'sommaire.al': 'Page chapters',
  'sommaire.haut': '↑ Back to top',

  /* ── en-tête chiffré ── */
  'entete.sousTitre': 'Surveyed {quand} · {depots} · {pwa} · {workflows}',
  'entete.sousTitre.depots': { one: '{n} git repository', other: '{n} git repositories' },
  'entete.sousTitre.depotsPublics': { one: '{n} public git repository', other: '{n} public git repositories' },
  'entete.sousTitre.pwa': { one: '{n} PWA application', other: '{n} PWA applications' },
  'entete.sousTitre.workflows': { one: '{n} workflow', other: '{n} workflows' },
  'entete.heroQuoi': 'of the workflows that ran were green on their last pass.',
  'entete.heroDetail': '{verts} green · {rouges} red · spread over {sains} and {reprendre}.',
  'entete.heroDetail.sains': { one: '{n} healthy repository', other: '{n} healthy repositories' },
  'entete.heroDetail.reprendre': { one: '{n} needing work', other: '{n} needing work' },
  'entete.barre.al': 'Breakdown of {n} workflows: {detail}',
  'entete.barre.titre': { one: '{n} workflow — {mot}', other: '{n} workflows — {mot}' },

  /* ── états d'un run ── */
  'etat.vert': 'success',
  'etat.rouge': 'failure',
  'etat.neutre': 'neutralised',
  'etat.encours': 'running',
  'etat.jamais': 'never ran',
  'etat.neutre.long': 'neutralised (skipped)',

  /* ── tuiles ── */
  'tuile.depots': 'Git repositories tracked',
  'tuile.depots.publics': 'public repositories of the account',
  'tuile.depots.mixte': '{publics} public · {prives} private',
  'tuile.pwa': 'PWA applications',
  'tuile.pwa.app': '{socle} core repositories · {desktop} desktop',
  'tuile.workflows': 'Active workflows',
  'tuile.workflows.app': { one: '+ {n} reusable from the core', other: '+ {n} reusables from the core' },
  'tuile.vert': 'Workflows green',
  'tuile.vert.app': '{verts} green · {rouges} red',
  'tuile.rouges': 'Workflows failing',
  'tuile.rouges.app': { one: 'across {n} repository', other: 'across {n} repositories' },
  'tuile.sites': 'Pages sites online',
  'tuile.sites.app': 'checked by real HTTP request',
  'tuile.pr': 'Open pull requests',
  'tuile.pr.aRelire': 'awaiting review',
  'tuile.pr.aucune': 'no review pending',
  'tuile.socle': 'Core published',
  'tuile.socle.app': { one: '{n} repository below', other: '{n} repositories below' },
  'tuile.socle.serie': 'repositories below',
  'tuile.alertes': 'Vulnerability alerts',
  'tuile.alertes.dont': 'of which {graves} severe · {production} in production',
  'tuile.alertes.aucune': { one: 'none across {n} repository queried', other: 'none across {n} repositories queried' },
  'tuile.alertes.illisibles': { one: 'unreadable on {n} repository — PARC_TOKEN without the “Dependabot alerts” scope', other: 'unreadable on {n} repositories — PARC_TOKEN without the “Dependabot alerts” scope' },
  'tuile.malLus': 'Repositories read badly',
  'tuile.malLus.app': 'workflows unreadable — the state shown is not conclusive',
  'tuile.local': 'Working copies modified',
  'tuile.local.hors': { one: '{n} off the default branch', other: '{n} off the default branch' },
  'tuile.local.propre': 'all on the default branch',
  'courbe.stable': { one: 'flat over {n} survey', other: 'flat over {n} surveys' },
  'courbe.delta': { one: '{signe}{delta} over {n} survey', other: '{signe}{delta} over {n} surveys' },
  'courbe.al': 'from {de} to {a}, over {n} surveys',

  /* ── ce qui a bougé ── */
  'changements.h2': 'What moved',
  'changements.compteur': { one: '{n} since the survey of {quand}', other: '{n} since the survey of {quand}' },
  'changements.ci-rouge': ' · {workflow} turns red',
  'changements.ci-vert': ' · {workflow} back to green',
  'changements.amont': ' publishes {a}',
  'changements.amont.de': ' (was {de})',
  'changements.amont.depots': { one: ' — {n} repository affected', other: ' — {n} repositories affected' },
  'changements.dormante': ' goes dormant',
  'changements.reveillee': ' publishes again',
  'changements.alertes': 'vulnerability alerts: ',
  'changements.alertes.suite': '{de} → {a}',
  'changements.depot-entre': ' enters the survey',
  'changements.depot-sorti': ' leaves the survey',
  'changements.amont.majeur': ' — new major',
  'changements.site-tombe': ' · site unreachable',
  'changements.site-revenu': ' · site back online',
  'changements.prod-retard': { one: ' · production is {n} commit behind', other: ' · production is {n} commits behind' },

  /* ── familles ── */
  'familles.h2': 'By family',
  'familles.chapo':
    'A PWA application is recognised by <code>vite-plugin-pwa</code> and its Pages deployment; a desktop application by Electron or Tauri. The three core layers are named explicitly: the skeleton is itself a PWA, and no signal would tell it apart from what it generates.',
  'famille.pwa.titre': 'PWA applications',
  'famille.pwa.sous': 'Installable web applications, deployed on GitHub Pages.',
  'famille.desktop.titre': 'Desktop applications',
  'famille.desktop.sous': 'Packaged with Electron, Tauri or .NET — outside the Pages chain.',
  'famille.socle.titre': 'Core',
  'famille.socle.sous': 'The library, the skeleton and the generator the applications live on.',
  'famille.autre.titre': 'Tooling and sundry',
  'famille.autre.sous': 'Extensions, skills, account configuration.',
  'famille.pwa.court': 'PWA',
  'famille.desktop.court': 'Desktop',
  'famille.socle.court': 'Core',
  'famille.autre.court': 'Tooling',
  'famille.depots': { one: ' repository', other: ' repositories' },
  'famille.auVert': ' green',
  'famille.rouges': { one: ' red', other: ' red' },
  'famille.barre.al': '{famille}: {verts} workflows succeeding, {rouges} failing',

  /* ── rôles, rendus par `classe()` ── */
  'role.bibliotheque': 'shared library',
  'role.squelette': 'application skeleton',
  'role.generateur': 'generator',
  'role.compte': 'account configuration',
  'role.vscode': 'VS Code extension',

  /* ── pile d'un dépôt, rendue par `pileDuDepot()` ── */
  'pile.socle': 'core',
  'pile.socleCeDepot': 'core (this repository)',


  /* ── ce qui est rouge ── */
  'echecs.h2': 'What is red',
  'echecs.chapo':
    'Latest run of every active workflow, taken on the repository’s default branch (failing that, the latest run across all branches). The core’s reusable workflows are excluded: they have no run of their own.',
  'echecs.caption': 'Failing workflows: repository, workflow, state, offending step, age, link to the run.',
  'echecs.compteur': '{rouges} out of {actifs}',
  'echecs.compteur.rouges': { one: '{n} red workflow', other: '{n} red workflows' },
  'echecs.compteur.actifs': { one: '{n} active', other: '{n} active' },
  'echecs.th.depot': 'Repository',
  'echecs.th.workflow': 'Workflow',
  'echecs.th.etat': 'State',
  'echecs.th.ou': 'Where it breaks',
  'echecs.th.depuis': 'Since',
  'echecs.motif': { one: 'Same cause on {n} repository — step “{etape}”: {depots}. One fix, {n} pipeline.', other: 'Same cause on {n} repositories — step “{etape}”: {depots}. One fix, {n} pipelines.' },
  'echecs.branche': 'branch {branche}',
  'echecs.pasDemarre': 'did not start (no job)',
  'echecs.job': 'job: {jobs}',
  'echecs.run': 'run ↗',

  /* ── dépôts ── */
  'depots.h2': 'Repositories',
  'depots.chapo':
    'One card per git repository: local copy, pipelines, technical stack. Library versions are the ones <em>locked</em> in the lockfile — not the declared range.',
  'depots.recherche.ph': 'Filter: name, description, library…',
  'depots.recherche.al': 'Filter the repositories',
  'depots.filtre.echec': 'With a failure',
  'depots.filtre.site': 'Site online',
  'depots.filtre.modifie': 'Local changes',
  'depots.filtre.prive': 'Private',
  'depots.tri.al': 'Sort the repositories',
  'depots.tri.echecs': 'Sort: failures first',
  'depots.tri.activite': 'Sort: recent activity',
  'depots.tri.nom': 'Sort: name',
  'depots.tri.workflows': 'Sort: number of workflows',
  'depots.depliees': 'Cards unfolded',
  'depots.aucun': 'No repository matches these filters.',
  'depots.compteur.tous': { one: '{n} repository', other: '{n} repositories' },
  'depots.compteur.filtre': { one: '{vus} of {n} repository', other: '{vus} of {n} repositories' },
  'depots.compteur.depliees': { one: ' · {n} unfolded', other: ' · {n} unfolded' },
  'depots.groupe.compteur': { one: '{n} repository', other: '{n} repositories' },
  'depots.groupe.rouges': { one: ' · {n} red workflow', other: ' · {n} red workflows' },
  'depots.groupe.toutVert': ' · all green',

  /* ── une carte de dépôt ── */
  'carte.ouvrir': 'Open {depot} on GitHub',
  'carte.prive': 'private',
  'carte.alertes.badge': '⚠ {n}',
  'carte.alertes.titre': { one: '{n} vulnerability alert', other: '{n} vulnerability alerts' },
  'carte.alertes.graves': { one: ', of which {n} severe', other: ', of which {n} severe' },
  'carte.alertes.production': { one: ' · {n} in a production dependency', other: ' · {n} in production dependencies' },
  'carte.malLu.badge': '⚠ partial read',
  'carte.malLu.titre': 'Workflows unreadable — the token could not read this repository’s Actions API.',
  'carte.malLu.corps': 'Workflows unreadable — the token could not read this repository’s Actions API. What follows is not conclusive.',
  'carte.copie': 'Working copy · ',
  'carte.copie.horsDefaut': '{branche} (default: {defaut})',
  'carte.copie.modifies': { one: '{n} uncommitted file', other: '{n} uncommitted files' },
  'carte.copie.avance': '{n} ahead',
  'carte.copie.retard': '{n} behind',
  'carte.copie.propre': ' — clean and up to date',
  'carte.branche': 'Branch · ',
  'carte.pr': { one: ' — {n} open PR', other: ' — {n} open PRs' },
  'carte.commit': 'Latest commit · ',
  'carte.wf.reutilisable': ' · reusable',
  'carte.wf.hors': ' · off {branche}',
  'carte.wf.jamais': 'never',
  'carte.wf.bande': '#{num} · {mot} · {date}',
  'carte.wf.titre': '{nom} ({fichier}) — {mot}',
  'carte.wf.titreDate': '{nom} ({fichier}) — {mot} on {date}',
  'carte.wf.plus': { one: '{n} more workflow — {resume}', other: '{n} more workflows — {resume}' },
  'carte.wf.aucun': 'No GitHub Actions workflow.',
  'carte.pile.verrouille': '{paquet} {version} (locked)',
  'carte.pile.plage': '{paquet} {version} (declared range)',
  'carte.pile.amont': ' · upstream: {amont}',
  'carte.site.enLigne': 'site online',
  'carte.site.injoignable': 'site unreachable',
  'carte.site.titre': 'HTTP {code} in {ms} ms — {quoi}',
  'carte.deps': '{deps} declared dependencies · {verrouilles} locked packages',
  'carte.deps.sansLock': '{deps} declared dependencies · no package-lock',
  'carte.crates': { one: '{n} locked crate', other: '{n} locked crates' },
  'carte.compte.verts': { one: '{n} green', other: '{n} green' },
  'carte.compte.rouges': ' · {n} red',
  'carte.resume.sr.echec': { one: '{n} workflow failing, ', other: '{n} workflows failing, ' },
  'carte.resume.sr.vert': '{n} green, ',
  'carte.resume.titre': { one: '{n} workflow green', other: '{n} workflows green' },
  'carte.resume.titre.echec': ' · {n} failing',
  'carte.resume.titre.commit': ' · latest commit {date}',

  /* ── librairies ── */
  'libs.h2': 'Libraries',
  'libs.chapo':
    'Versions actually locked in the lockfiles, aggregated across the whole estate. Only packages present in <strong>at least two repositories</strong> are listed: a single-repository package is an application dependency, not a library of the estate. The gradient runs from newest (dark) to oldest; past four versions, the tail is folded into grey. Click a row to see which repository carries which version.',
  'libs.recherche.ph': 'Filter a library…',
  'libs.recherche.al': 'Filter the libraries',
  'libs.filtre.retard': 'Behind upstream',
  'libs.filtre.eclate': 'Scattered versions',
  'libs.filtre.toutes': 'Single-repository included',
  'libs.aucun': 'No package matches these filters.',
  'libs.caption': 'Libraries of the estate: package, number of repositories, version breakdown, upstream version, repositories behind.',
  'libs.th.paquet': 'Package',
  'libs.th.depots': 'Repos',
  'libs.th.repartition': 'Version breakdown <span class="sr">(newest to oldest)</span>',
  'libs.th.amont': 'Upstream',
  'libs.th.retard': 'Behind',
  'libs.compteur.tous': { one: '{n} package', other: '{n} packages' },
  'libs.compteur.filtre': { one: '{vus} of {n} package', other: '{vus} of {n} packages' },
  'libs.queue': { one: '{n} older', other: '{n} older' },
  'libs.seg.titre': { one: '{version} — {n} repository', other: '{version} — {n} repositories' },
  'libs.barre.al': '{paquet}: {detail}',
  'libs.barre.al.seg': { one: '{version} on {n} repository', other: '{version} on {n} repositories' },
  'libs.retard.sr': 'behind upstream: ',
  'libs.aJour': 'up to date',
  'libs.majeursAdmis': 'majors {majeurs}',
  'libs.majeursAdmis.titre':
    '{paquet} lives at two majors in this estate, by decision and not by neglect: an upstream constraint forbids the newer one to some of the repositories. The reason is written in `MAJEURS_ADMIS` (scripts/regles.mjs).',
  'libs.alias': 'alias of {paquet}',
  'libs.alias.titre':
    '{nom} does not exist on the npm registry: it is an alias, declared `npm:{paquet}@…`, that installs {paquet} under another name. The versions shown are therefore those of {paquet}, which is what makes it possible to say whether the alias has fallen behind.',
  'libs.detail.amont': 'upstream {amont}',
  'libs.detail.plage': 'declared range: {plage} · locked version',
  'libs.detail.plageSeule': 'declared range: {plage} · no lockfile, range shown',
  'libs.tri.paquet': 'Sort by package name',
  'libs.tri.depots': 'Sort by number of repositories',
  'libs.tri.amont': 'Sort by upstream version',
  'libs.tri.retard': 'Sort by number of repositories behind',

  /* ── librairies dormantes ── */
  'dormance.h2': 'Dormant libraries',
  'dormance.chapo':
    'Libraries whose latest published version is <strong>over a year old</strong>. The publication date alone says little: a library can be stable and finished, or simply abandoned. So this table shows <strong>two dates</strong> — the last version released to the registry, and the last commit received by the upstream repository. When both have fallen silent, replacement is worth considering; when only the registry is quiet, it is a release that is missing, not a dead project.',
  'dormance.caption': 'Libraries with no release for over a year: package, repositories, latest version, age, upstream repository, latest commit, reading.',
  'dormance.th.paquet': 'Package',
  'dormance.th.depots': 'Repos',
  'dormance.th.version': 'Latest version',
  'dormance.th.age': 'Published',
  'dormance.th.amont': 'Upstream repository',
  'dormance.th.commit': 'Latest commit',
  'dormance.th.lecture': 'Reading',
  'dormance.aucune': 'No library of the estate has gone over a year without a release.',
  'dormance.seuil.an': 'over a year',
  'dormance.seuil.ans': 'over {n} years',
  'dormance.compteur': '{n} of {total} without a release for {seuil} — {arretees} whose upstream repository has fallen silent too',
  'dormance.compteur.aucune': { one: 'none of {n} dated library', other: 'none of {n} dated libraries' },
  'dormance.arretee': 'stopped',
  'dormance.arretee.aide': 'Neither a release nor a commit for over a year: plan a replacement.',
  'dormance.archivee': 'archived',
  'dormance.archivee.aide': 'The upstream repository is archived: it will receive nothing more.',
  'dormance.sans-version': 'developed, not released',
  'dormance.sans-version.aide': 'The repository still moves; it is the release that is missing.',
  'dormance.inconnue': 'repository not found',
  'dormance.inconnue.aide': 'The package declares no usable GitHub repository.',
  'dormance.archive': 'archived',
  'dormance.tickets': { one: '{n} open issue', other: '{n} open issues' },

  /* ── matrice des écarts ── */
  'matrice.h2': 'Gap matrix',
  'matrice.chapo':
    'The previous section answers “who carries which version” package by package; this one puts them side by side. A row is a repository, a column a package, a cell the version it <strong>locks</strong>. The colour does not say “old” in the abstract but the <strong>gap to the newest version in the estate</strong> — the only one you can act on, since another repository already holds it. By default only genuinely scattered packages are shown; columns are added and removed one at a time. <strong>Every header sorts the table</strong> — a package on the version carried, <em>Repository</em> on the name, <em>Gaps</em> on their number. One click, then the reverse, then back to the current sort. Version comparison is <strong>semantic</strong>: <code>1.9.0</code> precedes <code>1.10.0</code>. A repository that does not depend on the package has no version to compare, and stays at the bottom either way.',
  'matrice.caption': 'Gap matrix: one row per repository, one column per package, the cell gives the locked version.',
  'matrice.colonnes': 'Choose the columns',
  'matrice.eclate': 'Scattered packages only',
  'matrice.lignes': 'Repositories with a gap only',
  'matrice.tri.al': 'Sort the matrix rows',
  'matrice.tri.ecarts': 'Sort: most gaps first',
  'matrice.tri.nom': 'Sort: name',
  'matrice.tri.famille': 'Sort: family',
  'matrice.tri.maturite': 'Sort: maturity',
  'matrice.famille.al': 'Filter by family',
  'matrice.famille.etiq': 'Family',
  'matrice.maturite.al': 'Filter by maturity',
  'matrice.maturite.etiq': 'Maturity',
  'maturite.alpha': 'Alpha',
  'maturite.beta': 'Beta',
  'maturite.stable': 'Stable',
  'maturite.aucune': 'Not stated',
  'matrice.aucuneColonne': 'No column selected.',
  'matrice.aucuneLigne': 'No repository matches these filters.',
  'matrice.th.depot': 'Repository',
  'matrice.th.ecarts': 'Gaps',
  'matrice.tri.depot.inactif': 'Sort the repositories by name',
  'matrice.tri.depot.croissant': 'Repository: sorted A to Z. Click to reverse.',
  'matrice.tri.depot.decroissant': 'Repository: sorted Z to A. Click to return to the default sort.',
  'matrice.tri.col.titre': '{paquet} — newest in the estate: {recente}',
  'matrice.tri.col.titreAmont': '{paquet} — newest in the estate: {recente}, upstream: {amont}',
  'matrice.tri.col.inactif': 'Sort the repositories on the version of {paquet}',
  'matrice.tri.col.croissant': '{paquet}: sorted oldest to newest. Click to return to the default sort.',
  'matrice.tri.col.decroissant': '{paquet}: sorted newest to oldest. Click to reverse.',
  'matrice.tri.ecarts.titre': 'Number of gaps across the columns shown; severity breaks ties.',
  'matrice.tri.ecarts.inactif': 'Sort the repositories on the number of gaps',
  'matrice.tri.ecarts.croissant': 'Gaps: sorted fewest to most. Click to return to the default sort.',
  'matrice.tri.ecarts.decroissant': 'Gaps: sorted most to fewest. Click to reverse.',
  'matrice.cellule.aJour': '{depot} — {paquet} {version} (up to date in the estate)',
  'matrice.cellule.retard': '{depot} — {paquet} {version} — the estate already holds {recente}',
  'matrice.cellule.absent': '{depot} does not depend on {paquet}',
  'matrice.total.titre': { one: '{depot} — {n} gap across the columns shown ({detail}) — severity {score}', other: '{depot} — {n} gaps across the columns shown ({detail}) — severity {score}' },
  'matrice.total.aucun': '{depot} — no gap across the columns shown',
  'matrice.rang.majeure': { one: '{n} major', other: '{n} major' },
  'matrice.rang.mineure': { one: '{n} minor', other: '{n} minor' },
  'matrice.rang.patch': { one: '{n} patch', other: '{n} patches' },
  'matrice.pastilleCol': '{versions}v · {depots}r',
  'matrice.compteur': '{paquets} × {depots} — {ecarts}',
  'matrice.compteur.paquets': { one: '{n} package', other: '{n} packages' },
  'matrice.compteur.paquetsSur': { one: '{vus} of {n} package', other: '{vus} of {n} packages' },
  'matrice.compteur.depots': { one: '{n} repository', other: '{n} repositories' },
  'matrice.compteur.depotsSur': { one: '{vus} of {n} repository', other: '{vus} of {n} repositories' },
  'matrice.compteur.ecarts': { one: '{n} gap', other: '{n} gaps' },

  /* ── table des éléments ── */
  'elements.h2': 'Periodic table',
  'elements.chapo':
    'The “libraries” section lists them, the matrix crosses them with the repositories; this one answers a different question — <strong>what is this estate made of?</strong> A <strong>period</strong> (a row) says how many repositories carry the element, as a share of the estate rather than a fixed number. A <strong>group</strong> (a colour) says what it is for. The number at the top of a cell is the repository count, the bottom line the newest version the estate holds. <strong>Nothing is written by hand</strong>: the symbols derive from the names, and a package arriving tomorrow will find its place on its own.',
  'elements.partages': 'Shared only',
  'elements.groupes.al': 'Filter by group',
  'elements.aucun': 'No element matches these filters.',
  'elements.periode.borne': { one: '{n} repository', other: '{n} repositories' },
  'elements.periode.plage': '{haut} → {bas}',
  'elements.case.titre': '{nom} — {depots} · {version} · {groupe}',
  'elements.case.depots': { one: '{n} repository', other: '{n} repositories' },
  'elements.case.deduit': ' · inferred from the survey, outside any lockfile',
  'elements.compteur': '{elements} · {depots}',
  'elements.compteur.tous': { one: '{n} element', other: '{n} elements' },
  'elements.compteur.filtre': { one: '{vus} of {n} element', other: '{vus} of {n} elements' },
  'elements.compteur.depots': { one: '{n} repository', other: '{n} repositories' },
  'groupe.lang': 'Language & types',
  'groupe.build': 'Build',
  'groupe.ui': 'Interface',
  'groupe.data': 'State & data',
  'groupe.dos': 'Backend',
  'groupe.test': 'Tests',
  'groupe.qual': 'Quality & style',
  'groupe.obs': 'Observability',
  'groupe.infra': 'Core & infrastructure',
  'groupe.autre': 'Unclassified',
  'periode.noyau': 'The nucleus',
  'periode.ceinture': 'The belt',
  'periode.besoin': 'As needed',
  'periode.specialites': 'The specialities',
  'periode.traces': 'The traces',
  'element.ver.workflows': 'workflows',
  'element.ver.sites': 'sites served',
  'element.ver.deps': 'dep bumps',
  'element.ver.a11y': 'a11y budgets',
  'element.ver.postgres': 'Postgres · RLS',
  'element.ver.proxys': 'proxies',
  'element.ver.deploiement': 'deployment',
  'element.ver.crates': 'crates',
  'element.ver.dotnet': '.NET',
  'element.ver.scripts': 'scripts',

  /* ── activité ── */
  'activite.h2': 'Days since the last local commit',
  'activite.chapo': 'Measured on the working copy, not on GitHub.',
  'activite.tableau': 'View as a table',
  'activite.graphique': 'View the chart',
  'activite.th.depot': 'Repository',
  'activite.th.jours': 'Days',
  'activite.th.date': 'Commit date',
  'activite.compteur': { one: '{n} repository', other: '{n} repositories' },
  'activite.axe': 'Scale from 0 to {max} days. The oldest repository of the estate is {max} days behind its last commit: no repository is asleep.',
  'activite.piste.titre': '{depot} — last commit on {date}',
  'activite.tri.depot': 'Sort by repository name',
  'activite.tri.jours': 'Sort by number of days',
  'activite.tri.date': 'Sort by date of the last commit',

  /* ── pied ── */
  'pied.releve': 'Surveyed {quand}.',
  'pied.source': 'Source: GitHub API, lockfiles read on the default branch, npm registry.',
  'pied.sourceLocale': 'Source: GitHub API, lockfiles read on the default branch, npm registry, local working copies.',
  'pied.publics': 'The account’s private repositories are excluded from this survey.',
  'pied.soi': 'The repository {depot}, which produces this page, excludes itself.',
  'pied.regenere': 'Page regenerated every hour by GitHub Actions.',

  /* ── fraîcheur (etat.json) ── */
  'fraicheur.verifie': 'Checked {quand} · surveyed every hour',
  'fraicheur.panne': 'Last check {quand}: the hourly survey has stopped running',
  'fraicheur.aLInstant': 'just now',
  'fraicheur.relancer': 'Run the survey now',
  'fraicheur.nouveau': 'A newer survey is online: {quand}.',
  'fraicheur.recharger': 'Reload',
  'fraicheur.flux': 'Subscribe (Atom)',
  'flux.titre': 'mister-guiiug estate — what changed',

  /* ── à faire ── */
  'afaire.h2': 'To do',
  'afaire.compteur': { one: '{n} item', other: '{n} items' },
  'afaire.vide': 'Nothing to do: everything is green, online and up to date.',
  'afaire.rouges': { one: '{n} repository has a red workflow', other: '{n} repositories have red workflows' },
  'afaire.sites': { one: '{n} site unreachable', other: '{n} sites unreachable' },
  'afaire.mortes': { one: '{n} app serves dead URLs', other: '{n} apps serve dead URLs' },
  'afaire.prod': { one: '{n} production behind its branch', other: '{n} productions behind their branch' },
  'afaire.fugaces': { one: '{n} app loads short-lived chunks', other: '{n} apps load short-lived chunks' },
  'afaire.alertes': { one: '{n} repository has vulnerability alerts', other: '{n} repositories have vulnerability alerts' },
  'afaire.prs': { one: '{n} pull request to review', other: '{n} pull requests to review' },
  'afaire.majeures': { one: '{n} new major to decide on', other: '{n} new majors to decide on' },
  'afaire.correctifs': { one: '{n} patch or minor to upgrade', other: '{n} patches and minors to upgrade' },
  'afaire.socle': { one: 'Core to upgrade in {n} repository', other: 'Core to upgrade in {n} repositories' },
  'afaire.renovate': { one: '{n} Renovate update pending', other: '{n} Renovate updates pending' },
  'afaire.introuvables': { one: '{n} package Renovate cannot resolve', other: '{n} packages Renovate cannot resolve' },
  'afaire.plus': { one: '+ {n} more', other: '+ {n} more' },
  'afaire.moins': 'Show less',
  'afaire.detail.compte': '{nom} ({n})',
  'afaire.detail.prod': { one: '{depot}: {n} commit behind', other: '{depot}: {n} commits behind' },
  'afaire.detail.fichiers': '{depot}: {fichiers}',
  'afaire.detail.pr': '{depot}#{num} {titre}',
  'afaire.detail.renovate': { one: '{depot}: {n} pending', other: '{depot}: {n} pending' },
  'afaire.detail.renovate.majeures': { one: ', {n} major', other: ', {n} majors' },
  'afaire.detail.introuvable': { one: '{paquet} — {n} repository', other: '{paquet} — {n} repositories' },
  'afaire.detail.lib': { one: '{paquet} {de} → {cible} ({n} repository)', other: '{paquet} {de} → {cible} ({n} repositories)' },
  'afaire.introuvables.aide':
    'Renovate will never propose upgrading a package it cannot resolve. The core is published on GitHub Packages, which Renovate does not query without a token: until it gets one, the core is upgraded by hand.',
  'pr.ci.vert': 'CI green',
  'pr.ci.rouge': 'CI red',
  'pr.ci.encours': 'CI running',
  'pr.ci.jamais': 'no CI',
  'pr.robot': 'bot',
  'pr.brouillon': 'draft',

  /* ── upgrade request ── */
  'demande.copier': 'Copy the request',
  'demande.copiee': 'Copied ✓',
  'demande.echec': 'Could not copy',
  'demande.entete': 'From the estate dashboard (survey of {quand}):',
  'demande.montee': { one: 'Upgrade {paquet} to {cible} ({gravite}) in {n} repository:', other: 'Upgrade {paquet} to {cible} ({gravite}) in {n} repositories:' },
  'demande.depot': '{depot} (at {version})',
  'demande.depot.transitif': '{depot} (at {version}, lockfile only: not declared, a peer of the core)',
  'gravite.patch': 'patch',
  'gravite.mineure': 'minor',
  'gravite.majeure': 'major',

  /* ── libraries: age, notes, transitive ── */
  'libs.fraiche': 'under 24 h',
  'libs.fraiche.titre': 'Published {quand}, less than 24 h ago: pnpm 12 refuses to install it, and a fix for the fix often ships the next day.',
  'libs.publiee': 'Published {quand}',
  'libs.notes': 'Release notes ↗',
  'libs.transitifs': { one: '{n} transitive', other: '{n} transitive' },
  'libs.transitifs.titre': 'Repositories that do not declare this package: it is a peer of the core, installed regardless, and their lockfile sets the version that runs.',
  'libs.detail.transitif': 'Not declared: a peer of the core, pinned by the lockfile',

  /* ── series fixes, caps, Node ── */
  'libs.serie': 'fix {cible} on {serie}.x',
  'libs.serie.titre': 'The latest release of the current series: it can be upgraded without waiting for the decision on upstream.',
  'libs.detail.derniere': 'latest {serie}.x: {version}',
  'libs.plafond': 'capped by {moteur}',
  'libs.plafond.titre':
    'These types follow the version {moteur} declares ({plafond}): newer ones would describe an API the promised engine lacks. They are compared with that cap, not with upstream.',
  'libs.detail.plafond': '{moteur} cap: {plafond}',
  'libs.nvmrc.titre': "The Node version each repository's .nvmrc pins; upstream is the latest release on nodejs.org.",
  'afaire.detail.serie': 'staying on {serie}.x',
  'afaire.detail.plafond': '{moteur} cap',
  'demande.montee.serie': {
    one: 'Upgrade {paquet} to {cible} ({gravite}, staying on {serie}.x; {amont} is a separate decision) in {n} repository:',
    other: 'Upgrade {paquet} to {cible} ({gravite}, staying on {serie}.x; {amont} is a separate decision) in {n} repositories:',
  },
  'demande.montee.plafond': {
    one: 'Upgrade {paquet} to {cible} ({gravite}, capped by {moteur}) in {n} repository:',
    other: 'Upgrade {paquet} to {cible} ({gravite}, capped by {moteur}) in {n} repositories:',
  },

  /* ── production, Renovate (cards) ── */
  'carte.prod': 'Production · ',
  'carte.prod.aJour': '{commit} = {branche}, built {quand}',
  'carte.prod.equivalent': {
    one: '{commit} — {branche} is {n} commit ahead, outside the build only',
    other: '{commit} — {branche} is {n} commits ahead, outside the build only',
  },
  'carte.prod.deploiement': {
    one: '{commit} — {branche} is {n} commit ahead: a deployment is probably running',
    other: '{commit} — {branche} is {n} commits ahead: a deployment is probably running',
  },
  'carte.prod.retard': { one: '{commit} — {branche} is {n} commit ahead, not deployed', other: '{commit} — {branche} is {n} commits ahead, not deployed' },
  'carte.prod.inconnu': '{commit}, comparison unavailable',
  'carte.prod.absente': 'not measurable: the site publishes no version.json',
  'carte.prod.titre': 'Built {quand}',
  'carte.prod.badge': 'prod behind',
  'carte.mortes': 'Dead URLs in production: {fichiers}. The live page requests them, and they do not answer.',
  'carte.mortes.badge': 'dead URLs',
  'carte.fugaces':
    'Short-lived chunks: {fichiers}. Outside the precache and named by content hash, their URL will die at the next deployment — pwa-doctor rule chunk-hors-precache.',
  'carte.fugaces.badge': 'short-lived URLs',
  'carte.renovate': 'Renovate · ',
  'carte.renovate.attente': { one: '{n} pending update', other: '{n} pending updates' },
  'carte.renovate.majeures': { one: ', {n} major', other: ', {n} majors' },
  'carte.renovate.introuvables': ' — cannot resolve: {paquets}',

  /* ── navigation bar, collapsible sections ── */
  'nav.recherche': 'Go to a repository, a library… ( / )',
  'nav.recherche.al': 'Go to a repository or a library',
  'nav.sections': 'Page sections',
  'nav.type.depot': 'repository',
  'nav.type.lib': 'library',
  'section.deplier': 'Expand',
  'section.replier': 'Collapse',

  /* ── transverse ── */
  raz: 'Show everything again',
  'temps.aujourdhui': 'today',
  'temps.hier': 'yesterday',
  'temps.jours': '{n} d',
  'temps.rien': '—',
  liste: ', ',
}

export const LIBELLES = { fr: LIBELLES_FR, en: LIBELLES_EN }
