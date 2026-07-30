/**
 * ÉCHO DE MÉMOIRE — ce qui ferme vraiment la régression face à claude.exe.
 *
 * La mécanique de claude.exe est un COUPLE : le modèle écrit une fiche, ET il la relit au tour suivant.
 * `remember` n'en livrait que la première moitié : le fait part comme candidat dans la boîte de réception
 * du Brain, un humain le promeut, et il ne devient trouvable qu'après réindexation. Un audit l'a nommé
 * pour ce qu'il était — la régression DÉPLACÉE et honnêtement dite, pas fermée.
 *
 * Cet écho rend la seconde moitié, localement : ce que le modèle a retenu DANS CETTE CONVERSATION lui est
 * remis au tour suivant. Rien de plus.
 *
 * TROIS LIMITES ASSUMÉES, et elles doivent être dites au modèle plutôt que découvertes :
 *  1. C'est un écho LOCAL et VOLATILE : il vit dans le processus, il meurt avec lui. Le Brain reste la
 *     mémoire durable, et lui seul est partagé.
 *  2. Il est PLAFONNÉ, et ce n'est pas une timidité : la lecture automatique des fiches de claude.exe a
 *     été coupée dans Autowin parce qu'elle pesait 552 Ko — ~9 200 tokens à CHAQUE appel. Rouvrir ce
 *     robinet sans borne rejouerait exactement le défaut qu'on avait payé pour fermer.
 *  3. Il est cloisonné PAR CONVERSATION : les faits d'un fil n'ont pas à polluer le contexte d'un autre.
 *
 * Il vit dans le MESSAGE du tour, jamais dans le prompt système : celui-ci doit rester identique d'un tour
 * à l'autre pour que le cache de préfixe fonctionne (mesuré le 2026-07-28 : `cache_read` à 0 sur 100 % des
 * appels tant qu'un contenu variable y était concaténé).
 */

export interface RememberedFact {
  title: string
  body: string
  /** Nom du fichier candidat rendu par le Brain, quand il y en a un. */
  note?: string
}

/** Assez pour être utile sur un fil de travail, trop peu pour peser. */
export const ECHO_MAX_FACTS = 12
export const ECHO_MAX_BODY_CHARS = 300
export const ECHO_MAX_BLOCK_CHARS = 1_500

const byConversation = new Map<string, RememberedFact[]>()
/** Nombre de conversations suivies : le processus principal d'Electron vit longtemps. */
const MAX_CONVERSATIONS = 50

/**
 * Retient qu'un fait a été déposé. Le plus ANCIEN sort quand le plafond est atteint : sur un fil de
 * travail, ce qui vient d'être établi compte plus que ce qui l'a été il y a trente tours.
 */
export function noteRemembered(conversationId: string, fact: RememberedFact): void {
  if (!conversationId || !fact.title.trim() || !fact.body.trim()) return
  const facts = byConversation.get(conversationId) ?? []
  // Un même fait re-déposé ne s'empile pas deux fois dans l'écho.
  const already = facts.findIndex((f) => f.title === fact.title && f.body === fact.body)
  if (already >= 0) facts.splice(already, 1)
  facts.push(fact)
  while (facts.length > ECHO_MAX_FACTS) facts.shift()
  byConversation.set(conversationId, facts)
  while (byConversation.size > MAX_CONVERSATIONS) {
    const oldest = byConversation.keys().next().value
    if (oldest === undefined) break
    byConversation.delete(oldest)
  }
}

/** Ce que le modèle a retenu dans cette conversation, du plus ancien au plus récent. */
export function rememberedFacts(conversationId: string | undefined): readonly RememberedFact[] {
  return (conversationId ? byConversation.get(conversationId) : undefined) ?? []
}

/** Vide l'écho. Existe pour qu'aucun fait ne fuite d'un test à l'autre. */
export function forgetEcho(): void {
  byConversation.clear()
}

/**
 * Rend le bloc à remettre au modèle, ou une chaîne vide s'il n'y a rien à dire.
 *
 * Le texte dit la MÉCANIQUE en une ligne : relisible ici, pas encore partagé. Sans cela le modèle
 * conclurait que le Brain le lui a rendu, et promettrait une mémoire durable qui n'existe pas encore.
 */
export function sessionMemoryBlock(
  facts: readonly RememberedFact[],
  maxChars = ECHO_MAX_BLOCK_CHARS
): string {
  if (facts.length === 0) return ''
  const header =
    'CE QUE TU AS RETENU DANS CETTE CONVERSATION (écho local : relisible ici et maintenant, mais ' +
    'toujours en attente de promotion humaine côté Brain — donc pas encore partagé, ni trouvable par ' +
    'brain_query) :'
  const lines: string[] = []
  let used = header.length
  // Du plus RÉCENT au plus ancien : si le plafond coupe, il coupe le plus vieux.
  for (const fact of [...facts].reverse()) {
    const body =
      fact.body.length > ECHO_MAX_BODY_CHARS
        ? `${fact.body.slice(0, ECHO_MAX_BODY_CHARS).trimEnd()} […]`
        : fact.body
    const line = `- ${fact.title} — ${body}`
    if (used + line.length + 1 > maxChars) break
    used += line.length + 1
    lines.push(line)
  }
  if (lines.length === 0) return ''
  const omis = facts.length - lines.length
  // Une troncature MUETTE ferait croire à une liste complète. On dit ce qui manque.
  const pied = omis > 0 ? `\n(+ ${omis} fait(s) plus ancien(s) non repris ici, faute de place)` : ''
  return `${header}\n${lines.reverse().join('\n')}${pied}`
}
