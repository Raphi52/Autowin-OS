import { prochainResetUtile, type ModelQuotaSnapshot } from '../../../shared/model-quotas'

/**
 * QUAND FAUT-IL REPRENDRE TOUT SEUL — et quand faut-il s'abstenir.
 *
 * Le bouton « Reprendre les conversations coupées par le quota » existe depuis le 2026-09-05, mais
 * il faut être DEVANT l'écran au bon moment pour le cliquer. Mesuré le 2026-09-11 : 136 messages
 * utilisateur ne contiennent QUE « reprend », « go » ou « finis » — l'attente du retour de quota
 * est faite à la main, alors que l'heure du retour est connue (`resetsAt`) et jusqu'ici seulement
 * AFFICHÉE.
 *
 * Cette décision est extraite de la vue exprès : un minuteur branché directement dans un composant
 * ne se teste que par du temps simulé et de l'affichage. Ici, elle se lit comme une phrase.
 */

export interface EtatRepriseProgrammee {
  /** Nombre de fils rouges dont le motif est un mur de quota. */
  coupees: number
  /** Le snapshot de quotas courant, ou rien s'il n'a pas encore été lu. */
  quotas: Pick<ModelQuotaSnapshot, 'models'> | null | undefined
  /** L'utilisateur a cliqué « ne pas reprendre » : son refus prime sur tout le reste. */
  refusee: boolean
  /** Une reprise (manuelle ou automatique) tourne déjà. */
  enCours: boolean
  /** L'heure de reset déjà honorée — on ne rearme jamais deux fois la même. */
  dejaTentee?: string
  maintenant?: Date
}

export type DecisionReprise =
  | { readonly type: 'aucune' }
  | { readonly type: 'programmer'; readonly resetsAt: string; readonly dansMs: number }

/**
 * MARGE après l'heure annoncée. Repartir à la seconde près retomberait sur le mur : le compteur du
 * fournisseur et l'horloge locale ne sont pas alignés à la seconde, et le refus coûterait un tour.
 */
export const MARGE_APRES_RESET_MS = 60_000

export function deciderRepriseProgrammee(etat: EtatRepriseProgrammee): DecisionReprise {
  const rien = { type: 'aucune' } as const
  // Le refus de l'utilisateur est un VERROU, pas une préférence : il passe avant l'échéance.
  if (etat.refusee) return rien
  // Rien à reprendre, ou une reprise tourne déjà : réarmer ferait doublon.
  if (etat.coupees <= 0 || etat.enCours) return rien
  const maintenant = etat.maintenant ?? new Date()
  const resetsAt = prochainResetUtile(etat.quotas, maintenant)
  if (!resetsAt) return rien
  // Une échéance déjà honorée ne se rejoue pas : si la reprise a échoué, c'est que le mur tient
  // encore — y revenir en boucle brûlerait le quota qui vient de revenir.
  if (etat.dejaTentee === resetsAt) return rien
  const dansMs = new Date(resetsAt).valueOf() - maintenant.valueOf() + MARGE_APRES_RESET_MS
  return { type: 'programmer', resetsAt, dansMs }
}

/** « reprise automatique à 19:10 » — l'heure locale, telle que l'utilisateur lit sa montre. */
export function libelleRepriseProgrammee(resetsAt: string, coupees: number): string {
  const heure = new Date(resetsAt).toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit'
  })
  const quoi = coupees > 1 ? `${coupees} conversations reprises` : 'reprise'
  return `${quoi} automatiquement à ${heure}`
}
