/**
 * CE QU'UN OUTIL A REÇU ET RENDU, appel par appel (demande du 2026-10-12 : « pareil pour toutes les
 * pastilles, je dois voir ce qui est fait en détail quand je déplie »).
 *
 * Une charge `tool-call` ouvre un appel. Un `tool-result` ou une `error` revient à l'appel de la
 * même ACTION : les lectures d'un message se chevauchent, et « le dernier appel ouvert » laissait
 * a.md sans résultat et donnait les deux notes à b.md (conv-1370, lot 8, 2026-10-31). Sans action
 * connue — trace d'avant, geste propre de l'agent —, il revient au dernier appel ouvert, comme
 * avant : dans une trace écrite en file, c'est le même appel. Un appel sans aucun contenu — un geste
 * propre écrit avant le 2026-10-15, ou par un modèle IA qui ne rend pas ses arguments
 * (`chat-turn-trace.ts`) — n'est pas rendu : rien à montrer.
 */
export interface AppelOutil {
  envoye?: string
  retour?: string
  /** Le retour est une ERREUR de l'outil, pas son résultat. */
  erreur?: boolean
}

interface Charge {
  kind: string
  content: string
  /** L'événement de trace qui porte la charge : c'est lui qui dit son action. */
  evenementId?: string
}

/**
 * Les charges relues au clic, dans l'ordre des événements demandés, chacune avec son événement.
 * `causalTraceCharges` les rend par événement : les mettre à plat sans cet identifiant perdrait la
 * seule chose qui dit à quelle action elles reviennent.
 */
export function chargesAvecLeurEvenement<T extends object>(
  ids: readonly string[],
  parEvenement: Readonly<Record<string, readonly T[]>>
): Array<T & { evenementId: string }> {
  return ids.flatMap((id) =>
    (parEvenement[id] ?? []).map((charge) => ({ ...charge, evenementId: id }))
  )
}

/**
 * L'action d'un événement du pilote : son identifiant sans le genre final. `traceActionEventId`
 * écrit `<tour>:action:natif-0-1:command` et `…:result` : tout ce qui précède est commun aux deux.
 */
function actionDeLEvenement(id: string | undefined): string | undefined {
  return id?.includes(':action:') ? id.slice(0, id.lastIndexOf(':')) : undefined
}

export function appelsDeLOutil(charges: readonly Charge[]): AppelOutil[] {
  const appels: AppelOutil[] = []
  const appelDeLAction = new Map<string, AppelOutil>()
  for (const charge of charges) {
    const contenu = charge.content?.trim() ? charge.content : undefined
    const action = actionDeLEvenement(charge.evenementId)
    if (charge.kind === 'tool-call') {
      const appel: AppelOutil = contenu ? { envoye: contenu } : {}
      appels.push(appel)
      if (action) appelDeLAction.set(action, appel)
      continue
    }
    if ((charge.kind !== 'tool-result' && charge.kind !== 'error') || !contenu) continue
    let courant = (action ? appelDeLAction.get(action) : undefined) ?? appels.at(-1)
    if (!courant) {
      courant = {}
      appels.push(courant)
    }
    courant.retour = courant.retour ? `${courant.retour}\n\n${contenu}` : contenu
    if (charge.kind === 'error') courant.erreur = true
  }
  return appels.filter((appel) => appel.envoye !== undefined || appel.retour !== undefined)
}
