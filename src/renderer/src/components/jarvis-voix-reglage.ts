/**
 * LA VOIX CHOISIE POUR L'ASSISTANT, en fonctions PURES.
 *
 * Jusqu'ici la voix etait imposee : la premiere voix francaise trouvee sur le poste, un debit et une
 * hauteur ecrits en dur. Or les postes n'ont pas les memes voix installees, et une voix qui convient
 * a l'un est penible pour l'autre. Le choix appartient donc a l'utilisateur, il survit au
 * redemarrage, et il est relu par la synthese a chaque phrase.
 *
 * Hors React pour que la normalisation et la relecture se prouvent sans monter d'interface.
 */
import { autowinStorageKey } from '../storage-keys'

export interface ReglageVoix {
  /** L'identifiant systeme de la voix retenue. Vide = « laisser l'application choisir ». */
  voixURI: string
  /** Vitesse de parole. 1 = vitesse normale du systeme. */
  debit: number
  /** Hauteur du timbre. 1 = timbre normal du systeme. */
  hauteur: number
}

/**
 * Le reglage d'origine. Le debit est LEGEREMENT au-dessus de la normale et la hauteur legerement
 * en dessous : c'est exactement ce que la synthese appliquait en dur avant ce reglage, donc un
 * poste qui n'a jamais rien choisi entend la meme voix qu'avant.
 */
export const REGLAGE_VOIX_DEFAUT: ReglageVoix = { voixURI: '', debit: 1.05, hauteur: 0.95 }

/** Bornes de l'API de synthese du navigateur : au-dela, la phrase est refusee, pas ralentie. */
export const DEBIT_MIN = 0.5
export const DEBIT_MAX = 2
export const HAUTEUR_MIN = 0.5
export const HAUTEUR_MAX = 2

export const CLE_VOIX_JARVIS = autowinStorageKey('home.jarvis-voix.v1')

/**
 * L'evenement emis quand la voix change, dans la MEME fenetre.
 *
 * Le navigateur n'emet `storage` que pour les autres onglets : sans cet evenement, la synthese
 * garderait la voix chargee au premier mot et le nouveau choix ne s'entendrait qu'au redemarrage.
 */
export const EVENEMENT_VOIX_JARVIS = 'autowin:jarvis-voix'

interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

function borner(valeur: unknown, min: number, max: number, defaut: number): number {
  const nombre = typeof valeur === 'number' ? valeur : Number(valeur)
  if (!Number.isFinite(nombre)) return defaut
  return Math.min(max, Math.max(min, Math.round(nombre * 100) / 100))
}

/** Ramene n'importe quoi (JSON abime, valeur hors bornes, champ absent) a un reglage utilisable. */
export function normaliserReglageVoix(brut: unknown): ReglageVoix {
  const source = (brut ?? {}) as Partial<ReglageVoix>
  const uri = typeof source.voixURI === 'string' ? source.voixURI.trim().slice(0, 200) : ''
  return {
    voixURI: uri,
    debit: borner(source.debit, DEBIT_MIN, DEBIT_MAX, REGLAGE_VOIX_DEFAUT.debit),
    hauteur: borner(source.hauteur, HAUTEUR_MIN, HAUTEUR_MAX, REGLAGE_VOIX_DEFAUT.hauteur)
  }
}

/** Le reglage enregistre, ou celui d'origine si rien n'a ete choisi (ou si la relecture echoue). */
export function lireReglageVoix(storage: StorageLike): ReglageVoix {
  try {
    const brut = storage.getItem(CLE_VOIX_JARVIS)
    if (brut === null) return { ...REGLAGE_VOIX_DEFAUT }
    return normaliserReglageVoix(JSON.parse(brut))
  } catch {
    // Stockage indisponible ou JSON abime : l'assistant garde sa voix d'origine plutot que de se taire.
    return { ...REGLAGE_VOIX_DEFAUT }
  }
}

/**
 * Enregistre un reglage PARTIEL par-dessus l'existant et rend celui qui a REELLEMENT ete retenu.
 * Rendre la valeur normalisee, et non la saisie, evite que l'affichage et le stockage divergent.
 */
export function ecrireReglageVoix(
  storage: StorageLike,
  modification: Partial<ReglageVoix>
): ReglageVoix {
  const reglage = normaliserReglageVoix({ ...lireReglageVoix(storage), ...modification })
  try {
    storage.setItem(CLE_VOIX_JARVIS, JSON.stringify(reglage))
  } catch {
    // Sans ecriture, le choix vaut pour la session : moins surprenant qu'un echec visible.
  }
  try {
    const fenetre = globalThis as unknown as {
      dispatchEvent?: (e: Event) => boolean
      CustomEvent?: typeof CustomEvent
    }
    if (fenetre.dispatchEvent && fenetre.CustomEvent) {
      fenetre.dispatchEvent(new fenetre.CustomEvent(EVENEMENT_VOIX_JARVIS, { detail: reglage }))
    }
  } catch {
    // Pas de fenetre (test unitaire pur) : personne n'ecoute, il n'y a rien a prevenir.
  }
  return reglage
}
