import type { Msg } from './chat-view-types'

/**
 * Relance AUTOMATIQUE d'un tour mort sans rien produire — le seul cas où relancer est gratuit.
 *
 * Demande utilisateur du 2026-08-13 : « on peut pas faire en sorte que ça tue pas les runs ? ».
 * L'inventaire des protections existantes montre que la survie est déjà là pour tout ce qui a un
 * checkpoint : CLI détachés avec journal disque, agents encore vivants réattachés (« un agent
 * travaille ENCORE : aucune relance »), phases payées jamais rejouées (« phases déjà acquises »),
 * et un garde anti-double-coût pour les appels au résultat irrécupérable.
 *
 * Le SEUL trou est le tour tué avant d'avoir rien produit — mesuré trois fois sur les campagnes des
 * 12-13/08 (scouts à 0 token marqués `cancelled`/`interrupted` après un redémarrage). Rien n'a été
 * payé, rien n'est à reprendre, donc personne ne le relançait : il fallait un humain pour cliquer
 * « Renvoyer ». C'est exactement le cas où une relance automatique ne coûte RIEN et ne double RIEN.
 *
 * Bornes strictes — on ne relance PAS si le tour a produit quoi que ce soit :
 *  - un texte non vide (le modèle a parlé : de l'argent a été dépensé, l'humain arbitre) ;
 *  - une action aboutie ou en échec (un outil a tourné : des effets ont peut-être eu lieu) ;
 *  - un coût enregistré. Une action `interrupted` SANS résultat ne compte pas : c'est le marquage
 *    de la réconciliation, pas une production.
 */
export function promptDeRelanceGratuite(messages: readonly Msg[]): string | undefined {
  const dernier = messages.at(-1)
  if (!dernier || dernier.role !== 'assistant') return undefined
  // UNIQUEMENT `interrupted` — le marquage posé par la réconciliation quand l'APP est morte.
  // `cancelled` peut être un stop VOLONTAIRE de l'utilisateur : le relancer irait contre son
  // intention (appris des tests de comportement, où le stop utilisateur déclenchait ma relance).
  if (dernier.status !== 'interrupted') return undefined

  // `HydratedAssistantMessage` ne porte pas de `content` : tout son texte vit dans `parts`.
  const aProduit = (dernier.parts ?? []).some(
    (part) =>
      (part.kind === 'text' && part.text.trim().length > 0) ||
      (part.kind === 'action' && part.ok !== undefined)
  )
  if (aProduit) return undefined

  for (let i = messages.length - 2; i >= 0; i -= 1) {
    const candidat = messages[i]
    if (candidat.role === 'user' && candidat.content.trim()) return candidat.content
  }
  return undefined
}
