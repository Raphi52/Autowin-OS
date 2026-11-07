/**
 * LA PUBLICATION DE LA PRÉSENCE DU POSTE (plan « Village commun », lot 1).
 *
 * Demande : voir dans l'Accueil les tanukis des collègues à côté des siens. Ce module écrit ceux de
 * CE poste dans `<dossier du Board>\<compte Windows>\presence.json` (format dans
 * `src/shared/quartier-presence.ts`), que les autres postes relisent.
 *
 * Règles tranchées (`grill/agent-hq-japon-town.md`) :
 *  - D-9 : le partage est actif pour tous, et chaque titre passe par `filtrerTitre` AVANT d'être écrit ;
 *  - D6 : l'interrupteur du poste (`partagerPresence` du réglage du Board) coupé, on écrit
 *    `{ coupe: true, agents: [] }` — jamais de suppression sur le partage —, et plus de battement : un
 *    battement dirait encore que le poste est allumé. Un fil privé garde son animal, sans titre.
 *
 * Le partage est un dossier réseau, parfois lent ou injoignable (hors VPN) : comme pour le Board
 * (`board-dossier.ts`), rien ici ne bloque ni ne lève d'exception. Une écriture à la fois, au plus
 * toutes les `PRESENCE_DELAI_ECRITURE_MS` ; un échec est gardé et retenté au battement suivant.
 */
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  FICHIER_PRESENCE,
  FORMAT_PRESENCE,
  PHASES_PRESENCE,
  PRESENCE_AGENTS_MAX,
  PRESENCE_BATTEMENT_MS,
  PRESENCE_DELAI_ECRITURE_MS,
  PRESENCE_TAILLE_MAX,
  postesLisibles,
  tenueLisible,
  type AgentAPublier,
  type AgentPublie,
  type AnimalAgent,
  type EtatDeLaPresence,
  type PhasePresence,
  type PresenceDuPoste,
  type TenueAgent
} from '../../shared/quartier-presence'
import { filtrerTitre } from './quartier-presence-filtre'

/** Ce que l'écrivain lit du réglage du poste, AU MOMENT d'écrire : un changement compte aussitôt. */
export interface ReglageDeLaPresence {
  /** Le dossier du Board, `null` = aucun : rien n'est écrit. */
  dossier: string | null
  /** Le nom choisi pour le Board, sinon le compte Windows. */
  nom: string
  /** `false` = partage coupé sur ce poste (D6). */
  partager: boolean
  /**
   * L'animal des agents du poste, écrit dans `presence.json` pour que les collègues
   * dessinent le même. Absent = non écrit : le lecteur garde l'animal tiré du nom du poste.
   */
  animal?: AnimalAgent
  /**
   * La couleur de tenue des agents du poste, écrite dans `presence.json` pour que les
   * collègues dessinent la même. Absente = non écrite : la tenue d'origine de l'animal.
   */
  tenue?: TenueAgent
  /**
   * « Afficher mes agents à » : les postes à qui ce poste masque ses agents. Écrits dans
   * `presence.json` ; l'Autowin de chacun d'eux ne les affiche pas. Absent ou vide = visibles pour tous.
   */
  masquesPour?: readonly string[]
  /**
   * Les projets cochés dans le Board (`board-projets-partages.ts`) : les collègues ne voient que
   * les tanukis de ces projets, comme ils ne voient que leurs demandes. `null` ou absent = tous.
   */
  projets?: readonly string[] | null
}

/** Le projet d'un fil, clé de `groupeDe` comme celle du Board ; `undefined` = fil inconnu. */
export type ProjetDuFil = (id: string) => string | undefined

// ———————————————————————————————————————————————————————————————— ce qui arrive de la vue

const ID_LISIBLE = /^[\w.-]{1,80}$/
const METIER_LISIBLE = /^[a-z-]{1,40}$/
/** Un titre plus long n'est pas un titre de fil : on le borne avant même de le filtrer. */
const TITRE_BRUT_MAX = 2_000

const estPhase = (v: unknown): v is PhasePresence =>
  typeof v === 'string' && (PHASES_PRESENCE as readonly string[]).includes(v)

/**
 * L'instantané envoyé par la vue, relu champ par champ : la vue n'est pas une source sûre, et ce
 * qui en sort part sur un partage d'équipe. Un agent illisible est écarté ; 15 au plus.
 */
export function agentsAPublierLisibles(brut: unknown): AgentAPublier[] {
  if (!Array.isArray(brut)) return []
  const sortie: AgentAPublier[] = []
  for (const v of brut) {
    if (sortie.length >= PRESENCE_AGENTS_MAX) break
    if (!v || typeof v !== 'object') continue
    const o = v as Record<string, unknown>
    if (typeof o.id !== 'string' || !ID_LISIBLE.test(o.id)) continue
    if (!estPhase(o.phase)) continue
    const metier = typeof o.metier === 'string' && METIER_LISIBLE.test(o.metier) ? o.metier : null
    if (typeof o.depuis !== 'number' || !Number.isFinite(new Date(o.depuis).getTime())) continue
    const titre = typeof o.titre === 'string' ? o.titre.slice(0, TITRE_BRUT_MAX) : ''
    sortie.push({
      id: o.id,
      titre,
      phase: o.phase,
      metier,
      depuis: o.depuis,
      ...(o.prive === true ? { prive: true } : {})
    })
  }
  return sortie
}

/** Un agent tel qu'il part sur le partage : titre filtré et coupé, absent pour un fil privé (D6). */
export function agentPublie(a: AgentAPublier): AgentPublie {
  const titre = a.prive ? '' : filtrerTitre(a.titre)
  return {
    id: a.id,
    ...(titre ? { titre } : {}),
    phase: a.phase,
    metier: a.metier,
    depuis: new Date(a.depuis).toISOString()
  }
}

/**
 * Les agents dont le fil appartient à un projet coché. Liste blanche, comme le Board : un fil
 * dont on ne sait pas lire le projet ne part pas, pas plus qu'un projet nouveau non coché.
 */
export function agentsDesProjetsPartages(
  agents: readonly AgentAPublier[],
  projets: readonly string[] | null | undefined,
  projetDuFil?: ProjetDuFil
): readonly AgentAPublier[] {
  if (projets === null || projets === undefined) return agents
  if (!projetDuFil) return []
  const coches = new Set(projets)
  return agents.filter((a) => {
    const projet = projetDuFil(a.id)
    return projet !== undefined && coches.has(projet)
  })
}

/**
 * Le contenu de `presence.json`, sans sa date d'écriture (posée au moment d'écrire). Coupé : aucun
 * agent. Au-delà de `PRESENCE_TAILLE_MAX`, les derniers agents (les moins pressants) sont retirés.
 */
export function presenceAEcrire(
  agents: readonly AgentAPublier[],
  reglage: Pick<
    ReglageDeLaPresence,
    'nom' | 'partager' | 'animal' | 'masquesPour' | 'tenue' | 'projets'
  >,
  poste: string,
  projetDuFil?: ProjetDuFil
): Omit<PresenceDuPoste, 'enregistreA'> {
  if (!reglage.partager)
    return { format: FORMAT_PRESENCE, poste, nom: reglage.nom, coupe: true, agents: [] }
  // Filtré AVANT la limite : les 15 places vont aux tanukis que les collègues ont le droit de voir.
  const publies = agentsDesProjetsPartages(agents, reglage.projets, projetDuFil)
    .slice(0, PRESENCE_AGENTS_MAX)
    .map(agentPublie)
  // Relue ici aussi : le réglage vient d'un fichier du poste, et ce qui part sur le partage est borné.
  const masquesPour = postesLisibles(reglage.masquesPour)
  const tenue = tenueLisible(reglage.tenue)
  const presence: Omit<PresenceDuPoste, 'enregistreA'> = {
    format: FORMAT_PRESENCE,
    poste,
    nom: reglage.nom,
    ...(reglage.animal ? { animal: reglage.animal } : {}),
    ...(tenue ? { tenue } : {}),
    ...(masquesPour.length ? { masquesPour } : {}),
    agents: publies
  }
  // La date ajoutée ensuite tient en 60 octets : la marge est gardée ici.
  while (
    publies.length > 0 &&
    Buffer.byteLength(JSON.stringify(presence, null, 2), 'utf8') > PRESENCE_TAILLE_MAX - 200
  )
    publies.pop()
  return presence
}

// ———————————————————————————————————————————————————————————————— l'écrivain

async function estUnDossier(chemin: string): Promise<boolean> {
  try {
    return (await stat(chemin)).isDirectory()
  } catch {
    return false
  }
}

/** Écrit en entier ou pas du tout : un lecteur du partage ne voit jamais un fichier à moitié écrit. */
async function ecrireEntier(fichier: string, contenu: string): Promise<void> {
  const provisoire = `${fichier}.${process.pid}.tmp`
  await writeFile(provisoire, contenu, 'utf8')
  try {
    await rename(provisoire, fichier)
  } catch (erreur) {
    await rm(provisoire, { force: true }).catch(() => undefined)
    throw erreur
  }
}

export interface PublicationDeLaPresence {
  /** L'instantané des agents, envoyé par la vue à chaque changement : écrit dans les 5 s. */
  recevoir: (agents: readonly AgentAPublier[]) => void
  /** Le réglage a changé (partage coupé ou rétabli, dossier, nom) : la prochaine écriture le suit. */
  reglageChange: () => void
  etat: () => EtatDeLaPresence
  /** À l'arrêt de l'app : plus aucune écriture ni minuteur. */
  arreter: () => void
  /** Pour les tests : attend la fin de l'écriture en cours et de celle qui attend sans délai. */
  attendre: () => Promise<void>
}

export function creerPublicationDeLaPresence(deps: {
  /** Lu à chaque écriture : le dossier du Board, le nom, le partage. */
  reglage: () => ReglageDeLaPresence
  /** Le sous-dossier du poste (`sousDossierDuPoste`), le même que celui de `board.json`. */
  poste: string
  maintenant?: () => number
  planifier?: (fn: () => void, ms: number) => { annuler: () => void }
  delaiMs?: number
  battementMs?: number
  /** L'écriture atomique ; remplacée par les tests pour simuler un partage en panne. */
  ecrire?: (fichier: string, contenu: string) => Promise<void>
  /** Le projet du fil de chaque agent, lu à chaque écriture pour appliquer les projets cochés. */
  projetDuFil?: ProjetDuFil
}): PublicationDeLaPresence {
  const maintenant = deps.maintenant ?? Date.now
  const delaiMs = deps.delaiMs ?? PRESENCE_DELAI_ECRITURE_MS
  const battementMs = deps.battementMs ?? PRESENCE_BATTEMENT_MS
  const ecrireFichier = deps.ecrire ?? ecrireEntier
  const planifier =
    deps.planifier ??
    ((fn: () => void, ms: number): { annuler: () => void } => {
      const t = setTimeout(fn, ms)
      t.unref?.()
      return { annuler: () => clearTimeout(t) }
    })

  let agents: readonly AgentAPublier[] = []
  let aEcrire = false
  /** Le battement est dû : on réécrit même un contenu inchangé, pour dater le fichier. */
  let battementDu = false
  let ecriture: Promise<void> | null = null
  let minuteur: { annuler: () => void } | null = null
  let battement: { annuler: () => void } | null = null
  let derniereEcriture = Number.NEGATIVE_INFINITY
  /** Ce qui a été écrit en dernier, et où, sans la date : un contenu inchangé attend le battement. */
  let empreinte: { fichier: string; corps: string } | null = null
  let dernier: EtatDeLaPresence['dernier']
  let erreur: string | undefined
  let arrete = false

  const lireReglage = (): ReglageDeLaPresence | null => {
    try {
      return deps.reglage()
    } catch {
      return null
    }
  }
  const fichierDe = (r: ReglageDeLaPresence | null): string | null =>
    r?.dossier ? join(r.dossier, deps.poste, FICHIER_PRESENCE) : null

  function planifierBattement(): void {
    battement?.annuler()
    battement = planifier(() => {
      battement = null
      battementDu = true
      aEcrire = true
      pousser()
    }, battementMs)
  }

  async function ecrire(force: boolean): Promise<void> {
    const r = lireReglage()
    const fichier = fichierDe(r)
    if (!r || !r.dossier || !fichier) {
      // Sans dossier, rien n'est écrit, mais le battement continue (sans accès disque) : un dossier
      // choisi ensuite dans le Board reçoit le fichier dans la minute, même si aucun agent ne bouge
      // — la vue n'envoie un instantané qu'au changement.
      if (!arrete) planifierBattement()
      return
    }
    let presence: Omit<PresenceDuPoste, 'enregistreA'>
    try {
      presence = presenceAEcrire(agents, r, deps.poste, deps.projetDuFil)
    } catch {
      // Les fils illisibles à cet instant : on n'écrit rien plutôt qu'un tanuki d'un projet non coché.
      if (!arrete) planifierBattement()
      return
    }
    const corps = JSON.stringify(presence)
    if (!force && empreinte?.fichier === fichier && empreinte.corps === corps) return
    derniereEcriture = maintenant()
    try {
      if (!(await estUnDossier(r.dossier)))
        throw new Error(`Dossier introuvable ou injoignable : ${r.dossier}`)
      await mkdir(join(r.dossier, deps.poste), { recursive: true })
      const complet: PresenceDuPoste = {
        ...presence,
        enregistreA: new Date(maintenant()).toISOString()
      }
      await ecrireFichier(fichier, `${JSON.stringify(complet, null, 2)}\n`)
      empreinte = { fichier, corps }
      dernier = { a: maintenant(), agents: presence.agents.length, coupe: Boolean(presence.coupe) }
      erreur = undefined
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      // Un partage en panne se signale une fois, pas à chaque battement.
      if (message !== erreur) console.warn('[presence] presence.json non écrit :', message)
      erreur = message
      empreinte = null
    }
    // Coupé et écrit : plus de battement, il dirait que le poste est allumé (D6). Un échec, lui, est
    // retenté au battement suivant, coupé ou non.
    if (arrete) return
    if (r.partager || erreur) planifierBattement()
    else {
      battement?.annuler()
      battement = null
    }
  }

  function pousser(): void {
    if (arrete || ecriture || minuteur || !aEcrire) return
    const reste = derniereEcriture + delaiMs - maintenant()
    if (reste > 0) {
      minuteur = planifier(() => {
        minuteur = null
        pousser()
      }, reste)
      return
    }
    aEcrire = false
    const force = battementDu
    battementDu = false
    ecriture = ecrire(force)
      .catch(() => undefined)
      .finally(() => {
        ecriture = null
        pousser()
      })
  }

  return {
    recevoir(liste) {
      try {
        agents = agentsAPublierLisibles(liste)
        aEcrire = true
        pousser()
      } catch {
        // Un instantané illisible laisse le précédent : la présence n'arrête jamais l'app.
      }
    },
    reglageChange() {
      aEcrire = true
      pousser()
    },
    etat() {
      const r = lireReglage()
      return {
        partager: r?.partager ?? true,
        fichier: fichierDe(r),
        ...(dernier ? { dernier } : {}),
        ...(erreur ? { erreur } : {})
      }
    },
    arreter() {
      arrete = true
      minuteur?.annuler()
      minuteur = null
      battement?.annuler()
      battement = null
    },
    async attendre() {
      while (ecriture) await ecriture
    }
  }
}
