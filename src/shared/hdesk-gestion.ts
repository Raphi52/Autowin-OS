/**
 * VUE « BUREAUX CACHÉS » (conv-951, 2026-10-16) : « j'aimerais une view dédiée pour gérer tous mes
 * Hdesk, pouvoir les fermer, les créer et tout ». Types et validation partagés par le processus
 * principal (src/main/hdesk-gestion.ts), le pont et l'écran (HdeskGestionView.tsx) : la même règle
 * refuse une saisie invalide AVANT tout lancement, côté écran, et de nouveau côté processus principal,
 * qui ne fait jamais confiance à l'écran.
 */

/** Même motif que scripts/hdesk-lancer.ps1 (`ValidatePattern`) et ID_BUREAU de src/main/hdesk-tv.ts. */
export const MOTIF_IDENTIFIANT = /^[a-zA-Z0-9_-]+$/

/**
 * Fil donné à un bureau créé à la main. Le lanceur EXIGE un fil (hdesk-lancer.ps1, 2026-09-13) : un
 * bureau sans fil n'est plus lançable. Hypothèse du cadrage conv-951, modifiable dans le formulaire.
 */
export const FIL_MANUEL = 'manuel'

/**
 * Attente maximale d'une création par la vue (lanceur : 30 s de fenêtre + 6 s de survie + journal
 * Windows, plus le lancement détaché). Partagée : l'écran annonçait « 40 s » en dur (conv-344).
 */
export const CREATION_ATTENTE_MS = 90_000

/** Un bureau caché VIVANT, quel que soit son fil. */
export interface BureauGere {
  id: string
  /** Libellé du travail ; « travail non relié » quand le bureau n'a pas de fiche au registre. */
  travail: string
  /**
   * Faux quand aucune fiche ne relie ce bureau à un travail (ui-capture-*, preuve-*). Il se ferme
   * quand même, en mode « sans fiche » : seules ses fenêtres sont visées (conv-344).
   */
  relie: boolean
  conversationId?: string
  lanceLe?: string
  pid?: number
  executable?: string
}

export type ResultatListeBureaux =
  { ok: true; bureaux: BureauGere[] } | { ok: false; message: string }

export interface ResultatFermetureGeree {
  ok: boolean
  /** Code de scripts/hdesk-fermer.ps1, null quand rien n'a été lancé. */
  code: number | null
  /** Le bureau était déjà vide : rien à fermer, ce n'est pas une erreur. */
  dejaFerme?: boolean
  message: string
}

export interface DemandeCreationBureau {
  id: string
  executable: string
  arguments?: string
  travail: string
  /** Fil de rattachement ; FIL_MANUEL quand il est laissé vide. */
  conversationId?: string
}

export type ResultatCreationBureau =
  | { ok: true; id: string; pid?: number; message: string }
  | {
      ok: false
      /** Code de scripts/hdesk-lancer.ps1, null quand rien n'a été lancé ou rien lu. */
      code: number | null
      message: string
      /** Code 5 : identifiant libre proposé par le lanceur. Jamais relancé tout seul. */
      idLibre?: string
      travailOccupant?: string
      conversationOccupante?: string
    }

/** Fil effectif d'une demande : la valeur saisie, ou FIL_MANUEL si elle est vide. */
export function filDeLaDemande(d: Pick<DemandeCreationBureau, 'conversationId'>): string {
  const fil = typeof d?.conversationId === 'string' ? d.conversationId.trim() : ''
  return fil || FIL_MANUEL
}

/**
 * Refus d'une demande de création, ou null si elle peut partir. Un chemin d'exécutable INEXISTANT
 * n'est pas refusé ici : c'est le lanceur qui le dit (« Executable introuvable »), sur la machine réelle.
 */
export function refusCreation(d: DemandeCreationBureau | null | undefined): string | null {
  if (!d || typeof d !== 'object') return 'Demande de création vide.'
  const id = typeof d.id === 'string' ? d.id.trim() : ''
  if (!id) return 'Donne un identifiant au bureau.'
  if (!MOTIF_IDENTIFIANT.test(id))
    return 'Identifiant invalide : lettres sans accent, chiffres, « - » et « _ » seulement.'
  if (typeof d.executable !== 'string' || !d.executable.trim())
    return "Indique le chemin de l'application à lancer (.exe)."
  if (typeof d.travail !== 'string' || !d.travail.trim())
    return 'Dis en quelques mots ce que tu fais dans ce bureau.'
  if (d.arguments !== undefined && typeof d.arguments !== 'string') return 'Arguments invalides.'
  if (!MOTIF_IDENTIFIANT.test(filDeLaDemande(d)))
    return 'Fil invalide : lettres sans accent, chiffres, « - » et « _ » seulement.'
  return null
}
