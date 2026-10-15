/**
 * CE QU'UN OUTIL A REÇU ET RENDU, appel par appel (demande du 2026-10-12 : « pareil pour toutes les
 * pastilles, je dois voir ce qui est fait en détail quand je déplie »).
 *
 * Les charges arrivent dans l'ordre de leurs événements (appel, résultat, appel, résultat…) : une
 * charge `tool-call` ouvre un appel, les `tool-result` et `error` qui suivent s'y rattachent. Un
 * appel sans aucun contenu — un geste propre de l'agent écrit avant le 2026-10-15, ou par un modèle
 * IA qui ne rend pas ses arguments (`chat-turn-trace.ts`) — n'est pas rendu : rien à montrer.
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
}

export function appelsDeLOutil(charges: readonly Charge[]): AppelOutil[] {
  const appels: AppelOutil[] = []
  for (const charge of charges) {
    const contenu = charge.content?.trim() ? charge.content : undefined
    if (charge.kind === 'tool-call') {
      appels.push(contenu ? { envoye: contenu } : {})
      continue
    }
    if ((charge.kind !== 'tool-result' && charge.kind !== 'error') || !contenu) continue
    let courant = appels.at(-1)
    if (!courant) {
      courant = {}
      appels.push(courant)
    }
    courant.retour = courant.retour ? `${courant.retour}\n\n${contenu}` : contenu
    if (charge.kind === 'error') courant.erreur = true
  }
  return appels.filter((appel) => appel.envoye !== undefined || appel.retour !== undefined)
}
