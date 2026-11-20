/**
 * LES RÉPARATIONS DU PARC — règles pures, éprouvées par `node --test`.
 *
 * Le relevé voit un écart ; ce module dit ce qu'on peut y faire SANS
 * intervention, et dans quelles limites. Il ne touche à rien : `reparer.mjs`
 * exécute son plan, ou le simule (à blanc, le mode par défaut).
 *
 * RÉPARER N'EST PAS FUSIONNER. Une réparation relance une opération sans code
 * (des jobs en échec, un déploiement, le relevé lui-même) ou, plus tard, ouvre
 * une PR. Elle ne pousse jamais sur `main` et ne fusionne rien : c'est le
 * propriétaire qui fusionne. Au relevé suivant, l'écart a disparu, ou il est
 * repris ; après deux essais sans effet, on cesse et on le dit (escalade).
 *
 * QUATRE MODES, un par rubrique « À faire » (`MODES`) :
 *   - `auto`   : sans code, relancé ici (étape 1) ;
 *   - `script` : une PR écrite par un script, sans IA (étape 2 ; Renovate pour
 *                les correctifs et le socle) ;
 *   - `agent`  : une PR écrite par un agent, toujours relue (étape 3) ;
 *   - `humain` : une décision ou un droit d'administration, jamais automatisé.
 *
 * LES GARDES, toutes ici pour être testées :
 *   - ancienneté : un écart n'est traité qu'après `AGE_MIN_MS` (un déploiement
 *     lancé par une fusion a le temps de finir) ;
 *   - délai : `DELAI_ENTRE_ESSAIS_MS` entre deux essais sur le même écart ;
 *   - coupe-circuit : après `MAX_TENTATIVES` essais, plus rien, une escalade ;
 *   - budget : au plus `MAX_PAR_PASSAGE` actions par passage ;
 *   - périmètre : jamais le dépôt du relevé lui-même (sauf la sonde, qui est
 *     la sienne), jamais un dépôt de `exclus`, et seuls les workflows de
 *     VÉRIFICATION se relancent — un déploiement, une publication ou une
 *     migration relancés à l'aveugle peuvent agir sur le monde.
 */

import { aFaire } from './vue.mjs'

export const AGE_MIN_MS = 60 * 60 * 1000
export const DELAI_ENTRE_ESSAIS_MS = 24 * 60 * 60 * 1000
export const MAX_TENTATIVES = 2
export const MAX_PAR_PASSAGE = 5
/** Une réparation résolue reste au journal une semaine, puis en sort. */
export const GARDE_RESOLUES_MS = 7 * 24 * 60 * 60 * 1000

/** Le mode de chaque rubrique, et l'étape qui l'automatise. */
export const MODES = {
  graves: { mode: 'agent', etape: 3 },
  rouges: { mode: 'auto', etape: 1 },
  sites: { mode: 'humain', etape: null },
  fonctionne: { mode: 'agent', etape: 3 },
  sonde: { mode: 'auto', etape: 1 },
  mortes: { mode: 'agent', etape: 3 },
  prod: { mode: 'auto', etape: 1 },
  fugaces: { mode: 'agent', etape: 3 },
  doublons: { mode: 'agent', etape: 3 },
  alertes: { mode: 'script', etape: 2 },
  scanning: { mode: 'agent', etape: 3 },
  scanningOff: { mode: 'script', etape: 2 },
  envManifest: { mode: 'script', etape: 2 },
  rulesets: { mode: 'humain', etape: null },
  dossiersIncertains: { mode: 'humain', etape: null },
  prs: { mode: 'humain', etape: null },
  publier: { mode: 'script', etape: 2 },
  majeures: { mode: 'humain', etape: null },
  remplacer: { mode: 'humain', etape: null },
  correctifs: { mode: 'script', etape: 0 },
  socle: { mode: 'script', etape: 0 },
  renovate: { mode: 'humain', etape: null },
  introuvables: { mode: 'agent', etape: 3 },
}

/**
 * LES WORKFLOWS QUI SE RELANCENT : ceux qui VÉRIFIENT, sans rien changer
 * ailleurs. Relancer CI, CodeQL ou Lighthouse coûte des minutes de runner ;
 * relancer un déploiement, une publication, une migration Supabase ou
 * Renovate agit sur le monde, et reste hors de ce mode.
 */
export const RELANCABLES = /^(ci|codeql|lighthouse|security|vice|e2e|signatures|no-ai-attribution|plafonds|validate|rules)\.ya?ml$/

/** Le workflow qui déploie une app, pour une production en retard. */
export const DEPLOIEMENTS = /^(deploy|pages)\.ya?ml$/

/** L'identifiant du dernier run d'un workflow, lu dans le modèle. */
export function idDuRun(w) {
  const id = w?.derniers?.[0]?.id ?? w?.idDernier
  if (id) return String(id)
  const m = /\/actions\/runs\/(\d+)/.exec(w?.url || '')
  return m ? m[1] : null
}

/** La marque d'un écart : stable d'un passage à l'autre, unique par cible. */
export const marqueDe = (c) => `reparation:${c.cle}:${c.depot}:${c.cible}`

/**
 * Les réparations possibles en mode `auto`, avant les gardes. Les écarts d'une
 * rubrique `auto` qu'on ne sait pas réparer ici sont rendus dans `horsPortee`,
 * avec leur raison : la page ne doit pas laisser croire qu'ils le seront.
 */
export function candidats(D, { exclus = [], nwoSoi = null } = {}) {
  const soi = D?.soi || 'parc-dashboard'
  const depots = (D?.depots || []).filter((d) => d.nom !== soi && !exclus.includes(d.nom))
  const liste = []
  const horsPortee = []

  for (const d of depots) {
    const workflows = (d.workflows || []).filter((w) => !w.reutilisable)
    for (const w of workflows.filter((x) => x.etat === 'rouge')) {
      const base = { cle: 'rouges', depot: d.nom, workflow: w.nom, fichier: w.fichier }
      if (!RELANCABLES.test(w.fichier || '')) {
        horsPortee.push({ ...base, raison: 'workflow qui agit (déploiement, publication, migration…) : étape 3' })
        continue
      }
      if (w.surDefaut === false) {
        horsPortee.push({ ...base, raison: 'dernier run hors de la branche par défaut' })
        continue
      }
      const cible = idDuRun(w)
      if (!cible) {
        horsPortee.push({ ...base, raison: 'run introuvable dans le relevé' })
        continue
      }
      liste.push({ ...base, nwo: d.nwo, cible, action: 'relancer-echecs' })
    }

    if (d.prod?.etat === 'retard') {
      const base = { cle: 'prod', depot: d.nom }
      const deploiement = workflows.find((w) => DEPLOIEMENTS.test(w.fichier || ''))
      if (!deploiement) horsPortee.push({ ...base, raison: 'aucun workflow de déploiement reconnu' })
      else if (deploiement.etat === 'encours') horsPortee.push({ ...base, raison: 'déploiement en cours' })
      else if (deploiement.etat === 'rouge') horsPortee.push({ ...base, raison: 'déploiement rouge : voir « rouges »' })
      else
        liste.push({
          ...base,
          nwo: d.nwo,
          cible: String(d.commit?.sha || d.commit || d.prod.commit || 'tete'),
          action: 'redeployer',
          workflow: deploiement.nom,
          fichier: deploiement.fichier,
          ref: d.brancheDefaut || 'main',
        })
    }
  }

  if (D?.sonde === null || D?.sonde?.manquante) {
    liste.push({
      cle: 'sonde',
      depot: soi,
      nwo: nwoSoi || `mister-guiiug/${soi}`,
      cible: D?.sonde?.date || 'jamais',
      action: 'relancer-releve',
      fichier: 'releve.yml',
      ref: 'main',
    })
  }

  return { liste, horsPortee }
}

/**
 * Le plan d'un passage : les actions à faire, celles qui attendent, les
 * escalades, et le suivi mis à jour. `suivi` est celui du journal précédent
 * (une entrée par marque).
 *
 * À BLANC, une action simulée compte comme un essai : le journal montre alors
 * la cadence réelle (une fois par jour au plus, deux essais puis l'escalade)
 * et non la même ligne à chaque heure.
 */
export function planReparations(D, { suivi = {}, maintenant = new Date(), exclus = [], nwoSoi = null } = {}) {
  const t = +maintenant
  const iso = new Date(t).toISOString()
  const { liste, horsPortee } = candidats(D, { exclus, nwoSoi })
  const actions = []
  const reportees = []
  const escalades = []
  const nouveauSuivi = {}

  for (const c of liste) {
    const marque = marqueDe(c)
    const avant = suivi[marque] || {}
    const entree = {
      cle: c.cle,
      depot: c.depot,
      action: c.action,
      premiereVue: avant.premiereVue || iso,
      derniereVue: iso,
      tentatives: avant.tentatives || 0,
      dernierEssai: avant.dernierEssai || null,
      escalade: avant.escalade || null,
    }
    nouveauSuivi[marque] = entree
    const ligne = { ...c, marque }

    if (entree.tentatives >= MAX_TENTATIVES) {
      if (!entree.escalade) {
        entree.escalade = iso
        escalades.push({ ...ligne, raison: `${entree.tentatives} essais sans effet` })
      } else reportees.push({ ...ligne, raison: 'escaladé : plus de nouvel essai' })
      continue
    }
    if (t - Date.parse(entree.premiereVue) < AGE_MIN_MS) {
      reportees.push({ ...ligne, raison: 'écart trop récent : un passage de plus' })
      continue
    }
    if (entree.dernierEssai && t - Date.parse(entree.dernierEssai) < DELAI_ENTRE_ESSAIS_MS) {
      reportees.push({ ...ligne, raison: 'essai de moins de 24 h' })
      continue
    }
    if (actions.length >= MAX_PAR_PASSAGE) {
      reportees.push({ ...ligne, raison: 'budget du passage atteint' })
      continue
    }
    actions.push(ligne)
  }

  // Ce qui n'est plus candidat est résolu (ou sorti du périmètre) : gardé une
  // semaine au journal, pour mesurer le délai de réparation, puis oublié.
  for (const [marque, avant] of Object.entries(suivi)) {
    if (nouveauSuivi[marque]) continue
    const resoluLe = avant.resoluLe || iso
    if (t - Date.parse(resoluLe) > GARDE_RESOLUES_MS) continue
    nouveauSuivi[marque] = { ...avant, resoluLe }
  }

  return { actions, reportees, escalades, horsPortee, suivi: nouveauSuivi }
}

/** Le suivi après exécution : un essai de plus par action tentée. */
export function apresExecution(suivi, resultats, maintenant = new Date()) {
  const iso = new Date(+maintenant).toISOString()
  const out = { ...suivi }
  for (const r of resultats) {
    if (!out[r.marque] || r.statut === 'sans-objet') continue
    out[r.marque] = { ...out[r.marque], tentatives: (out[r.marque].tentatives || 0) + 1, dernierEssai: iso, dernierStatut: r.statut }
  }
  return out
}

/** Ce que couvre chaque mode aujourd'hui : une ligne par rubrique « À faire ». */
export function couverture(D) {
  return aFaire(D).map((it) => ({ cle: it.cle, n: it.n, ...(MODES[it.cle] || { mode: 'humain', etape: null }) }))
}

/**
 * Le journal publié (`reparations.json`). Un journal d'un autre mode que le
 * passage en cours repart de zéro : les essais simulés à blanc ne doivent pas
 * déclencher le coupe-circuit du premier passage réel.
 */
export function suiviRepris(journalPrecedent, mode) {
  return journalPrecedent?.mode === mode ? journalPrecedent.suivi || {} : {}
}
