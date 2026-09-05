/**
 * « REPRENDRE TOUT » — relance A LA DEMANDE tous les runs interrompus, la ou ils se sont arretes.
 *
 * Le demarrage sait deja le faire (index.ts) ; l'utilisateur, lui, n'avait qu'une reprise par
 * conversation. Ce module refait EXACTEMENT le meme triage, avec les memes briques (preuve de
 * publication Git, action de reprise, file sequentielle, relance), mais declenche par un bouton.
 *
 * Toutes les dependances sont injectees : le module ne touche ni Electron, ni le disque, ni un
 * provider, donc ses gardes OBSERVENT ses effets au lieu de relire du texte.
 */
export type RaisonDeSaut = 'deja-publie' | 'agent-vivant' | 'sans-preuve-de-fin' | 'terminal'

export interface ReprendreToutResume {
  /** Un « Reprendre tout » etait deja en cours : aucun second passage n'a ete lance. */
  dejaEnCours: boolean
  relances: string[]
  ignores: Array<{ runId: string; raison: RaisonDeSaut }>
}

export interface DependancesDeReprendreTout<Etat extends { runId: string }> {
  listerRunsReprenables: () => readonly Etat[]
  /** Preuve Git durable qu'un run a deja publie : le relancer repaierait un appel provider. */
  publicationDejaProuvee: (etat: Etat) => boolean
  actionDeReprise: (etat: Etat) => 'relancer' | 'rattacher' | 'bloquer' | 'ignorer'
  /** File sequentielle partagee avec la reprise de demarrage : jamais deux relances a la fois. */
  mettreEnFile: (tache: () => Promise<void>) => Promise<void>
  relancer: (etat: Etat) => Promise<void>
}

const RAISONS: Record<'rattacher' | 'bloquer' | 'ignorer', RaisonDeSaut> = {
  rattacher: 'agent-vivant',
  bloquer: 'sans-preuve-de-fin',
  ignorer: 'terminal'
}

export function creerReprendreTout<Etat extends { runId: string }>(
  deps: DependancesDeReprendreTout<Etat>
): { reprendreTout: () => Promise<ReprendreToutResume>; enCours: () => boolean } {
  let enVol: Promise<ReprendreToutResume> | null = null

  const passe = async (): Promise<ReprendreToutResume> => {
    const resume: ReprendreToutResume = { dejaEnCours: false, relances: [], ignores: [] }
    const attentes: Promise<void>[] = []
    for (const etat of deps.listerRunsReprenables()) {
      if (deps.publicationDejaProuvee(etat)) {
        resume.ignores.push({ runId: etat.runId, raison: 'deja-publie' })
        continue
      }
      const action = deps.actionDeReprise(etat)
      if (action !== 'relancer') {
        resume.ignores.push({ runId: etat.runId, raison: RAISONS[action] })
        continue
      }
      resume.relances.push(etat.runId)
      // Une relance rouge ne condamne pas les suivantes : la file les enchaine quand meme.
      attentes.push(deps.mettreEnFile(() => deps.relancer(etat)).catch(() => undefined))
    }
    await Promise.all(attentes)
    return resume
  }

  return {
    enCours: () => enVol !== null,
    reprendreTout: async () => {
      // ANTI-DOUBLE-CLIC : un second appel pendant que le premier tourne ne relance rien.
      if (enVol) return { dejaEnCours: true, relances: [], ignores: [] }
      enVol = passe()
      try {
        return await enVol
      } finally {
        enVol = null
      }
    }
  }
}
