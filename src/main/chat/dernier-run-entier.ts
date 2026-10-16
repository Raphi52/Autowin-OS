import {
  flattenChatPartsForModel,
  MAX_STRING,
  type PersistedChatActionPart,
  type PersistedChatPart
} from '../../shared/chat-turn'
import {
  formatOrchestrationOutcome,
  formatOrchestrationOutcomePourLeModele,
  type OrchestrationOutcome
} from '../../shared/orchestration-outcome'
import { bornerResultatDeCommande } from '../resultat-de-commande-borne'
import { readTurnJournal } from '../runs/turn-journal'

/**
 * SESSION NON REPRISE : LE MODELE RELIT LE DERNIER RUN EN ENTIER (conv-989, 2026-10-16).
 *
 * Quand la session du modele n'est pas reprise (session neuve, compaction, modele qui ne reprend pas
 * ses sessions comme Codex), il relit l'historique du FIL. Or le fil coupe le resultat d'un run deux
 * fois : la bulle a 4 000 caracteres (`formatOrchestrationOutcome`), et les donnees de l'action a
 * 12 000 (`sanitizePersistedValue`), que `flattenChatPartsForModel` reduisait encore a 1 200. Mesure
 * sur conv-914 : 23 192 caracteres rendus par le scout, aucune copie entiere dans le fil. Seul le
 * JOURNAL du tour (`turn-journals/<conv>/<tour>.jsonl`, evenement `result`) la porte.
 *
 * On relit donc le journal, pour le DERNIER run de la fenetre seulement : relire chaque run en entier
 * ferait grossir tout le fil a chaque tour. La protection de la fenetre de contexte reste celle de
 * tout resultat injecte (`bornerResultatDeCommande`).
 */

/**
 * OU RELIRE LE RUN d'un message de l'agent : le journal de SON tour.
 *
 * `conversationId` est celle qui POSSEDE le journal (`turnConversationId` d'un message copie par un
 * fork, sinon la conversation courante).
 */
export interface SourceDuRun {
  journalRoot: string
  conversationId: string
  turnId?: string
}

/** La DERNIERE action `orchestrate` reussie d'un message, avec son rang dans les parts. */
function derniereOrchestration(
  parts: readonly PersistedChatPart[]
): { rang: number; action: PersistedChatActionPart } | undefined {
  for (let rang = parts.length - 1; rang >= 0; rang -= 1) {
    const part = parts[rang]
    if (
      part?.kind === 'action' &&
      part.name === 'orchestrate' &&
      part.ok === true &&
      part.data !== null &&
      typeof part.data === 'object'
    )
      return { rang, action: part }
  }
  return undefined
}

/**
 * L'issue ENTIERE de cette action, relue dans le journal du tour ; `undefined` si le journal n'existe
 * plus (purge apres 7 jours, `JOURNAL_RETENTION_MS`) ou ne la porte pas.
 */
function issueDuJournal(
  source: SourceDuRun,
  actionId: string | undefined
): OrchestrationOutcome | undefined {
  if (!source.turnId) return undefined
  let evenements: ReturnType<typeof readTurnJournal>
  try {
    evenements = readTurnJournal(source.journalRoot, source.conversationId, source.turnId)
  } catch {
    // Identifiant illisible pour un nom de fichier : on retombe sur la copie du fil, qui le DIT.
    return undefined
  }
  for (let rang = evenements.length - 1; rang >= 0; rang -= 1) {
    const evenement = evenements[rang]
    if (
      evenement?.kind === 'result' &&
      evenement.name === 'orchestrate' &&
      evenement.ok === true &&
      (actionId === undefined || evenement.actionId === actionId) &&
      evenement.data !== null &&
      typeof evenement.data === 'object'
    )
      return evenement.data as OrchestrationOutcome
  }
  return undefined
}

/** Le contenu d'un message de l'agent tel que le MODELE le relit dans l'historique. */
export function contenuAssistantPourLeModele(
  parts: PersistedChatPart[],
  dernierRun?: SourceDuRun
): string {
  const trouve = dernierRun ? derniereOrchestration(parts) : undefined
  if (!dernierRun || !trouve) return flattenChatPartsForModel(parts)

  const copieDuFil = trouve.action.data as OrchestrationOutcome
  const entiere = issueDuJournal(dernierRun, trouve.action.actionId)
  const resultatDuFil = typeof copieDuFil.result === 'string' ? copieDuFil.result : ''
  // Sans journal, la copie du fil est la meilleure source — mais coupee : on le DIT, sinon le modele
  // conclurait sur un resultat qu'il croit complet.
  const avisDeCoupe =
    !entiere && resultatDuFil.length > MAX_STRING
      ? // Espace simple entre les milliers : `toLocaleString('fr-FR')` pose une espace fine
        // insecable (U+202F), qu'aucune recherche tapee au clavier ne retrouve.
        `\n[RÉSULTAT coupé à ${String(MAX_STRING).replace(/\B(?=(\d{3})+$)/g, ' ')} caractères à l'enregistrement du ` +
        `fil, et le journal de ce tour n'existe plus : la fin du résultat n'est PAS ici.]`
      : ''
  const compteRendu = bornerResultatDeCommande(
    'orchestrate',
    formatOrchestrationOutcomePourLeModele(true, entiere ?? copieDuFil) + avisDeCoupe
  )

  // La BULLE de l'app est le meme compte-rendu, coupe : on la reconnait a sa premiere ligne (statut,
  // cout, run), qui ne depend pas de la longueur du resultat. Le texte du MODELE, lui, est garde.
  const enTeteDeLaBulle = formatOrchestrationOutcome(true, copieDuFil).split('\n')[0] ?? ''
  const relues: PersistedChatPart[] = []
  parts.forEach((part, rang) => {
    if (rang === trouve.rang) {
      relues.push({ kind: 'text', text: `[orchestrate : ok]\n${compteRendu}` })
      return
    }
    if (part.kind === 'text' && enTeteDeLaBulle && part.text.includes(enTeteDeLaBulle)) {
      // Ce qui PRECEDE l'en-tete (avis d'orientation tardive) n'est pas dans le compte-rendu.
      const avant = part.text.slice(0, part.text.indexOf(enTeteDeLaBulle)).trim()
      if (avant) relues.push({ kind: 'text', text: avant })
      return
    }
    relues.push(part)
  })
  return flattenChatPartsForModel(relues)
}

/** Rang du DERNIER message de la fenetre qui porte une orchestration ; -1 s'il n'y en a pas. */
export function rangDuDernierRun<T>(
  fenetre: readonly T[],
  partsDe: (message: T) => PersistedChatPart[] | undefined
): number {
  for (let rang = fenetre.length - 1; rang >= 0; rang -= 1) {
    const parts = partsDe(fenetre[rang] as T)
    if (parts?.some((part) => part.kind === 'action' && part.name === 'orchestrate')) return rang
  }
  return -1
}
