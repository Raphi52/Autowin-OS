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
  /**
   * Sort du DÉPÔT durable, distinct du fait d'être retenu ici. Le dire évite la confusion que le prompt
   * pourrait installer : un fait peut vivre dans le fil sans être parti au Brain (serveur injoignable,
   * jeton absent, état indéterminé).
   */
  state?: 'depose' | 'inconnu' | 'local'
}

/** Titre abrégé dans l'écho : un titre non borné pouvait à lui seul épuiser tout le budget du bloc. */
export const ECHO_MAX_TITLE_CHARS = 120

/** Assez pour être utile sur un fil de travail, trop peu pour peser. */
export const ECHO_MAX_FACTS = 12
export const ECHO_MAX_BODY_CHARS = 300
export const ECHO_MAX_BLOCK_CHARS = 1_500

interface ConversationEcho {
  facts: RememberedFact[]
  /** Faits sortis par le plafond. Comptés pour que la perte soit DITE, jamais muette. */
  evicted: number
}

const byConversation = new Map<string, ConversationEcho>()
/** Nombre de conversations suivies : le processus principal d'Electron vit longtemps. */
const MAX_CONVERSATIONS = 50

/**
 * Remet la conversation en fin de Map, pour que l'éviction soit une vraie LRU.
 *
 * Sans ça, `keys().next().value` rend la première clé INSÉRÉE : un `set` sur une clé existante ne change
 * pas sa position dans une Map JS. La conversation la plus ACTIVE — insérée en premier, réalimentée sans
 * cesse — était donc évincée avant 49 fils morts. Défaut reproduit par un juge le 2026-07-30.
 */
function touch(conversationId: string, echo: ConversationEcho): void {
  byConversation.delete(conversationId)
  byConversation.set(conversationId, echo)
}

/**
 * Retient qu'un fait a été déposé. Le plus ANCIEN sort quand le plafond est atteint : sur un fil de
 * travail, ce qui vient d'être établi compte plus que ce qui l'a été il y a trente tours.
 */
export function noteRemembered(conversationId: string, fact: RememberedFact): boolean {
  if (!conversationId || !fact.title.trim() || !fact.body.trim()) return false
  const echo = byConversation.get(conversationId) ?? { facts: [], evicted: 0 }
  /**
   * Déduplication sur le TITRE seul, et non sur le couple titre+corps : deux faits de même titre sont
   * une SUPERSESSION, pas deux faits. Sans ça, « Décision — on part sur A » et « Décision — finalement B,
   * A est abandonné » cohabitaient, le modèle relisait le périmé en premier, et la correction consommait
   * deux des douze places. Relevé le 2026-07-30.
   */
  const already = echo.facts.findIndex((f) => f.title === fact.title)
  if (already >= 0) echo.facts.splice(already, 1)
  echo.facts.push(fact)
  while (echo.facts.length > ECHO_MAX_FACTS) {
    echo.facts.shift()
    echo.evicted += 1
  }
  touch(conversationId, echo)
  while (byConversation.size > MAX_CONVERSATIONS) {
    const oldest = byConversation.keys().next().value
    if (oldest === undefined) break
    byConversation.delete(oldest)
  }
  return true
}

/**
 * Ce que le modèle a retenu dans cette conversation, du plus ancien au plus récent.
 *
 * Rend une COPIE : `readonly` n'existe qu'à la compilation, et un appelant qui trierait ou inverserait le
 * retour muterait l'écho du fil. Lire rafraîchit aussi la récence — c'est le vrai signal d'activité, la
 * conversation en cours étant relue à chaque tour.
 */
export function rememberedFacts(conversationId: string | undefined): readonly RememberedFact[] {
  if (!conversationId) return []
  const echo = byConversation.get(conversationId)
  if (!echo) return []
  touch(conversationId, echo)
  return [...echo.facts]
}

/** Combien de faits le plafond a fait sortir de ce fil. Sert à DIRE la perte. */
export function evictedCount(conversationId: string | undefined): number {
  return (conversationId ? byConversation.get(conversationId)?.evicted : 0) ?? 0
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
  maxChars = ECHO_MAX_BLOCK_CHARS,
  evicted = 0
): string {
  if (facts.length === 0) return ''
  const header =
    'CE QUE TU AS RETENU DANS CETTE CONVERSATION (écho local : relisible ici et maintenant, mais ' +
    'toujours en attente de promotion humaine côté Brain — donc pas encore partagé, ni trouvable par ' +
    'brain_query) :'
  const PIED_MAX = 96
  const lines: string[] = []
  // Le pied est RÉSERVÉ dans le budget : il était concaténé après, et faisait dépasser la borne de ~61
  // caractères (relevé le 2026-07-30 — mon propre test concédait le dépassement au lieu de l'interdire).
  let used = header.length + PIED_MAX
  let omis = evicted
  // Du plus RÉCENT au plus ancien : si le plafond coupe, il coupe le plus vieux.
  for (const fact of [...facts].reverse()) {
    const titre =
      fact.title.length > ECHO_MAX_TITLE_CHARS
        ? `${fact.title.slice(0, ECHO_MAX_TITLE_CHARS).trimEnd()}…`
        : fact.title
    const body =
      fact.body.length > ECHO_MAX_BODY_CHARS
        ? `${fact.body.slice(0, ECHO_MAX_BODY_CHARS).trimEnd()} […]`
        : fact.body
    const etat = fact.state === 'inconnu' || fact.state === 'local' ? ' [non déposé au Brain]' : ''
    const line = `- ${titre} — ${body}${etat}`
    // `continue`, PAS `break` : un seul fait hors gabarit faisait sauter la boucle, et comme on itère du
    // plus récent au plus ancien il effaçait TOUT l'écho — 7 faits retenus, un bloc vide, en silence
    // (reproduit le 2026-07-30). Un fait trop gros est omis, les autres passent.
    if (used + line.length + 1 > maxChars) {
      omis += 1
      continue
    }
    used += line.length + 1
    lines.push(line)
  }
  // Une omission MUETTE ferait croire à une liste complète — y compris quand RIEN ne tient.
  const pied =
    omis > 0 ? `\n(+ ${omis} fait(s) non repris ici, faute de place — redemande-les si besoin)` : ''
  if (lines.length === 0) {
    return omis > 0 ? `${header}${pied}` : ''
  }
  return `${header}\n${lines.reverse().join('\n')}${pied}`
}
