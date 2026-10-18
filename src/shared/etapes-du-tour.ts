/**
 * ÉTAPES DU TOUR — le format de ligne partagé entre le processus principal qui l'ÉCRIT
 * (`main/providers/claude-etapes.ts`, à chaque appel TaskCreate / TaskUpdate / TaskList du CLI)
 * et le fil qui le RELIT pour dessiner le bloc « Étapes » (demande conv-304, 2026-10-17 : « un bloc
 * avec les étapes de la task et leur progression, ils ont mis ça dans claude.exe »).
 *
 * Une ligne = un CHANGEMENT d'une étape : `Étape #<id> <état> · <sujet>`. Le journal des actions
 * (`actionsLog`) les garde dans l'ordre et survit au rechargement ; la liste se reconstruit en les
 * rejouant. Lisible telle quelle là où un statut brut s'affiche.
 */
export type StatutEtape = 'pending' | 'in_progress' | 'completed' | 'deleted'

const ETAT_LISIBLE: Record<StatutEtape, string> = {
  pending: 'à faire',
  in_progress: 'en cours',
  completed: 'terminée',
  deleted: 'supprimée'
}

const STATUT_DU_MOT = new Map(
  (Object.entries(ETAT_LISIBLE) as Array<[StatutEtape, string]>).map(([s, mot]) => [mot, s])
)

/** Sujet borné pour que la ligne entière tienne dans les 300 caractères d'une ligne du journal. */
const SUJET_MAX = 200

const LIGNE = /^Étape #(\S+) (à faire|en cours|terminée|supprimée)(?: · (.*))?$/

export function ligneDEtape(id: string, statut: StatutEtape, sujet: string): string {
  const propre = sujet.replace(/\s+/g, ' ').trim()
  const coupe = propre.length > SUJET_MAX ? `${propre.slice(0, SUJET_MAX - 1)}…` : propre
  return `Étape #${id} ${ETAT_LISIBLE[statut]}${coupe ? ` · ${coupe}` : ''}`
}

export function estLigneDEtape(ligne: string): boolean {
  return LIGNE.test(ligne)
}

/** Une ligne d'étape lue : son identifiant et son nouvel état ; `null` pour toute autre ligne. */
export function lireLigneDEtape(ligne: string): { id: string; statut: StatutEtape } | null {
  const m = LIGNE.exec(ligne)
  return m ? { id: m[1]!, statut: STATUT_DU_MOT.get(m[2]!)! } : null
}

export type Etape = { id: string; sujet: string; statut: Exclude<StatutEtape, 'deleted'> }

/**
 * La liste à l'instant de la DERNIÈRE ligne : chaque ligne met à jour son étape, une étape garde
 * sa place de première apparition, une étape supprimée sort de la liste. Une ligne sans sujet
 * (étape d'un tour précédent dont le titre est inconnu) garde le sujet déjà connu.
 */
export function etapesDuJournal(lignes: readonly string[] | undefined): Etape[] {
  const parId = new Map<string, Etape>()
  for (const ligne of lignes ?? []) {
    const m = LIGNE.exec(ligne)
    if (!m) continue
    const id = m[1]!
    const statut = STATUT_DU_MOT.get(m[2]!)!
    if (statut === 'deleted') {
      parId.delete(id)
      continue
    }
    const sujet = (m[3] ?? '').trim() || parId.get(id)?.sujet || ''
    const avant = parId.get(id)
    if (avant) {
      avant.statut = statut
      avant.sujet = sujet
    } else parId.set(id, { id, sujet, statut })
  }
  return [...parId.values()]
}
