import type { ConversationStore } from './store/conversations'

/**
 * RAPPELER D'OFFICE ce que la demande suppose connu.
 *
 * Les volets precedents de conv-1407 ont donne a l'orchestrateur de quoi CHERCHER
 * (`conversation_search`) et de quoi RELIRE (`conversation_read`, `retrospective`). Restait une
 * faille qu'aucun outil ne peut fermer : rien ne garantit que le modele PENSE a les appeler.
 *
 * Et il ne le pensera pas, parce qu'il ne sait pas qu'il ignore quelque chose. « remake les
 * pastilles de couleurs » se lit comme une demande complete : elle a un verbe, un objet, aucune
 * marque d'incompletude. Un agent qui ignore qu'il lui manque une information ne va pas la
 * chercher — attendre qu'il s'en avise, c'est reconduire conv-1407 en esperant mieux.
 *
 * Le tour porte donc DEJA le rappel. La place existait : le bloc de contexte etait rempli de bruit
 * AST (`.all()`, `.constructor()`, `.flashFrame()`), sans rapport avec la demande.
 */

/**
 * Au-dela de cette longueur, la demande se suffit a elle-meme.
 *
 * Ce qui declenche le besoin n'est pas le sujet mais la BRIEVETE : une demande courte est courte
 * parce qu'elle s'appuie sur un contexte partage. « remake les pastilles de couleurs » fait 31
 * caracteres ; une demande qui nomme ses fichiers et son critere n'a besoin de rien.
 */
const LONGUEUR_QUI_SE_SUFFIT = 160

/** Plafond du bloc : un rappel qui noie le tour vaut le bruit qu'il remplace. */
const PLAFOND = 3_000

const EN_TETE =
  'RAPPEL DE CE QU’ON S’EST DIT (extraits d’échanges passés qui portent les mots de ta demande — ' +
  'ta demande est brève, elle s’appuie probablement dessus. Ouvre-les avec `conversation_read` ' +
  'si tu as besoin du fil complet) :'

/**
 * Les extraits d'echanges passes qui eclairent une demande breve, ou une chaine vide.
 *
 * La conversation COURANTE est exclue : le modele la porte deja par sa session, et la rappeler
 * consommerait la place au profit de ce qu'il sait deja.
 */
export function rappelDesEchangesPasses(
  conversations: Pick<ConversationStore, 'search'>,
  demande: string | undefined,
  conversationCouranteId: string | undefined
): string {
  const terme = (demande ?? '').trim()
  if (!terme || terme.length > LONGUEUR_QUI_SE_SUFFIT) return ''

  const trouvees = conversations
    .search(terme, { limite: 3, extraitsParConversation: 2 })
    .filter((conversation) => conversation.id !== conversationCouranteId)
  if (trouvees.length === 0) return ''

  const lignes: string[] = [EN_TETE]
  for (const conversation of trouvees) {
    lignes.push(`— ${conversation.id} « ${conversation.title} »`)
    for (const extrait of conversation.extraits) {
      lignes.push(`  ${extrait.role === 'user' ? 'utilisateur' : 'toi'}: ${extrait.extrait}`)
    }
  }
  const rendu = lignes.join('\n')
  // Coupe DITE : une troncature muette se lit comme un rappel complet, donc comme la preuve qu'il
  // n'y avait rien de plus.
  return rendu.length <= PLAFOND ? rendu : `${rendu.slice(0, PLAFOND)}…[rappel tronqué]`
}
