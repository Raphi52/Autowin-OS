import { ENTETE_REPRISE_AUTOMATIQUE } from './relance-taches-de-fond'

/**
 * LE TOUR DE RÉPARATION APRÈS UN REFUS DE LA PORTE. Quand le travail d'un fil n'entre pas dans main
 * (conflit de lignes, nom réservé, erreur git), l'app lance elle-même un tour dans ce fil, avec la
 * raison que la porte a donnée. L'utilisateur n'a pas à lire le refus, à en chercher la cause, puis à
 * demander la réparation : il retrouve le fil avec le compte rendu du tour.
 *
 * Le message s'ouvre par l'en-tête des reprises automatiques : il est écrit par Autowin, jamais au nom
 * de l'utilisateur, et les contrôles comme l'interface le reconnaissent à cet en-tête.
 */

/** Suit l'en-tête : distingue cette reprise des autres, pour ne la lancer qu'une fois par demande. */
const MARQUE = 'Envoi refusé, réparation lancée par Autowin'

/**
 * La fin du texte d'un refus que la porte réessaie seule (fichier non commité dans le dossier partagé) :
 * un tour du modèle n'y changerait rien. La phrase vit ici, à côté de celui qui la relit.
 */
export const SUITE_QUAND_LA_PORTE_RETENTE_SEULE = 'Autowin retentera tout seul.'

/** Ce message est-il le tour de réparation composé ici ? */
export function estUneReparationDuRefus(message: string | undefined): boolean {
  return (message ?? '').trimStart().startsWith(`${ENTETE_REPRISE_AUTOMATIQUE} ${MARQUE}`)
}

/** Le message du tour de réparation : ce que la porte a refusé, et ce qui est attendu du tour. */
export function composerPromptDeReparation(detail: string | undefined): string {
  const raison = detail?.trim()
  return [
    `${ENTETE_REPRISE_AUTOMATIQUE} ${MARQUE} : le travail de ton tour précédent n’est pas entré dans main.`,
    raison
      ? `Raison donnée par l’app : ${raison}`
      : 'Raison non précisée par l’app : retrouve-la (fusion à blanc avec main, contrôle des noms réservés, base du fil).',
    'Règle la cause dans la copie de ce fil, sans rien demander à l’utilisateur : corrige les fichiers nommés (un conflit se tranche par contenu, en gardant les deux apports ; un nom réservé se retire), puis rejoue les tests de ce que tu touches.',
    'Ne commite pas et ne pousse pas : l’app refait l’entrée dans main à la fin de ce tour.',
    'Termine par un compte rendu pour l’utilisateur : la cause, ce que tu as corrigé, et ce qui bloque encore s’il reste un blocage.'
  ].join('\n')
}

export type DecisionDeReparation =
  | { lancer: true; prompt: string }
  | {
      lancer: false
      raison:
        | 'pas-un-refus-de-la-porte'
        | 'retente-seule'
        | 'deja-tentee'
        | 'tour-de-fond'
        | 'lot-de-plan'
        | 'fil-occupe'
    }

export interface TourRefuse {
  /** Le rapport de publication du tour (`AutoCloseReport`), ou rien si la publication n'a rien rendu. */
  rapport: unknown
  /** La demande du tour refusé. */
  demande: string
  /** Tour de fond (tâche planifiée) : personne n'attend ce fil, la réparation reste à l'humain. */
  deFond: boolean
  /** Lot d'un plan : son refus remonte à son chef, qui décide. */
  lotDePlan: boolean
  /** Un tour tourne déjà dans le fil : l'utilisateur l'a relancé lui-même. */
  filOccupe: boolean
}

/**
 * La condition de lancement, entière, sans effet de bord.
 *
 * UNE SEULE RÉPARATION PAR DEMANDE : si le tour refusé est déjà un tour de réparation, rien n'est
 * relancé. Le refus reste dit dans le fil, et c'est à l'utilisateur de trancher : une boucle de
 * réparations refusées coûterait un tour du modèle à chaque passage.
 */
export function decisionDeReparation(tour: TourRefuse): DecisionDeReparation {
  const projet =
    typeof tour.rapport === 'object' && tour.rapport !== null
      ? (tour.rapport as { project?: unknown }).project
      : undefined
  const { status, reason, detail } = (
    typeof projet === 'object' && projet !== null ? projet : {}
  ) as { status?: unknown; reason?: unknown; detail?: unknown }
  if (status !== 'skipped' || reason !== 'porte-refusee')
    return { lancer: false, raison: 'pas-un-refus-de-la-porte' }
  const texte = typeof detail === 'string' ? detail : undefined
  if (texte?.trimEnd().endsWith(SUITE_QUAND_LA_PORTE_RETENTE_SEULE))
    return { lancer: false, raison: 'retente-seule' }
  if (estUneReparationDuRefus(tour.demande)) return { lancer: false, raison: 'deja-tentee' }
  if (tour.deFond) return { lancer: false, raison: 'tour-de-fond' }
  if (tour.lotDePlan) return { lancer: false, raison: 'lot-de-plan' }
  if (tour.filOccupe) return { lancer: false, raison: 'fil-occupe' }
  return { lancer: true, prompt: composerPromptDeReparation(texte) }
}

/**
 * Lance le tour de réparation si la décision le permet. N'attend pas sa fin et ne lève jamais : appelé
 * sur le chemin de la publication, dont un échec ne doit pas atteindre la réponse du tour. Rend `true`
 * si un tour est parti.
 */
export function lancerLaReparationDuRefus(
  deps: {
    envoyerTour: (
      conversationId: string,
      prompt: string
    ) => Promise<{ ok?: boolean; error?: string } | undefined>
    journal: (message: string, detail?: unknown) => void
  },
  tour: TourRefuse & { conversationId: string }
): boolean {
  const decision = decisionDeReparation(tour)
  if (!decision.lancer) return false
  void deps
    .envoyerTour(tour.conversationId, decision.prompt)
    .then((resultat) => {
      if (resultat && resultat.ok === false)
        deps.journal(`tour de réparation en échec dans ${tour.conversationId}`, resultat.error)
    })
    .catch((erreur: unknown) =>
      deps.journal(`tour de réparation non lancé dans ${tour.conversationId}`, erreur)
    )
  return true
}
