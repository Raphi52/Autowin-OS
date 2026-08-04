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
 *  1. C'est un écho LOCAL et DURABLE : il survit au redémarrage, mais reste provisoire. Le Brain demeure
 *     la seule mémoire canonique partagée.
 *  2. Il est PLAFONNÉ, et ce n'est pas une timidité : la lecture automatique des fiches de claude.exe a
 *     été coupée dans Autowin parce qu'elle pesait 552 Ko — ~9 200 tokens à CHAQUE appel. Rouvrir ce
 *     robinet sans borne rejouerait exactement le défaut qu'on avait payé pour fermer.
 *  3. Il est cloisonné PAR CONVERSATION ET WORKSPACE : changer de dépôt ne réinjecte pas les faits du
 *     précédent. Seule une portée explicitement `global` traverse cette frontière.
 *
 * Il vit dans le MESSAGE du tour, jamais dans le prompt système : celui-ci doit rester identique d'un tour
 * à l'autre pour que le cache de préfixe fonctionne (mesuré le 2026-07-28 : `cache_read` à 0 sur 100 % des
 * appels tant qu'un contenu variable y était concaténé).
 */

export interface RememberedFact {
  title: string
  body: string
  /** Portée métier validée par `remember` (`global` reste volontairement inter-workspaces). */
  scope?: string
  /** Identité du workspace actif au moment où le fait a été retenu. */
  workspace?: string
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
  evictedByWorkspace: Record<string, number>
}

const byConversation = new Map<string, ConversationEcho>()
/** Nombre de conversations suivies : le processus principal d'Electron vit longtemps. */
const MAX_CONVERSATIONS = 50
const MAX_STORE_BYTES = 2 * 1024 * 1024
const MAX_STORED_TITLE_CHARS = 500
const MAX_STORED_BODY_CHARS = 8_000
const MAX_FACTS_PER_CONVERSATION = ECHO_MAX_FACTS * 4
let persistencePath: string | undefined

interface StoredEchoFile {
  version: 1 | 2
  conversations: Array<{
    id: string
    facts: RememberedFact[]
    evicted: number
    evictedByWorkspace?: Record<string, number>
  }>
}

/** Une même copie de travail doit produire la même clé malgré la casse et les séparateurs Windows. */
export function memoryWorkspaceIdentity(workspace?: string): string {
  const value = workspace?.trim()
  if (!value) return ''
  return resolve(value).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

function factWorkspaceKey(fact: Pick<RememberedFact, 'scope' | 'workspace'>): string {
  if (fact.scope?.trim().toLowerCase() === 'global') return 'global'
  const workspace = memoryWorkspaceIdentity(fact.workspace)
  return workspace ? `workspace:${workspace}` : 'legacy-unscoped'
}

function validEvictedByWorkspace(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, count]) => Number.isFinite(count))
      .map(([key, count]) => [key.slice(0, 1_000), Math.max(0, Math.floor(Number(count)))])
  )
}

function validFact(value: unknown): RememberedFact | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  if (typeof raw.title !== 'string' || typeof raw.body !== 'string') return undefined
  const title = raw.title.trim().slice(0, MAX_STORED_TITLE_CHARS)
  const body = raw.body.trim().slice(0, MAX_STORED_BODY_CHARS)
  if (!title || !body) return undefined
  const state =
    raw.state === 'depose' || raw.state === 'inconnu' || raw.state === 'local'
      ? raw.state
      : undefined
  return {
    title,
    body,
    ...(typeof raw.scope === 'string' && raw.scope.trim()
      ? { scope: raw.scope.trim().slice(0, 120) }
      : {}),
    ...(typeof raw.workspace === 'string' && raw.workspace.trim()
      ? { workspace: memoryWorkspaceIdentity(raw.workspace) }
      : {}),
    ...(typeof raw.note === 'string' && raw.note.trim()
      ? { note: raw.note.trim().slice(0, 500) }
      : {}),
    ...(state ? { state } : {})
  }
}

function persistEcho(): void {
  if (!persistencePath) return
  const data: StoredEchoFile = {
    version: 2,
    conversations: [...byConversation.entries()].map(([id, echo]) => ({
      id,
      facts: echo.facts,
      evicted: echo.evicted,
      evictedByWorkspace: echo.evictedByWorkspace
    }))
  }
  const temp = `${persistencePath}.${process.pid}.${Date.now()}.tmp`
  try {
    mkdirSync(dirname(persistencePath), { recursive: true })
    writeFileSync(temp, JSON.stringify(data), { encoding: 'utf8', mode: 0o600 })
    renameSync(temp, persistencePath)
  } catch {
    try {
      unlinkSync(temp)
    } catch {
      // Une panne de persistance ne doit jamais casser le run courant.
    }
  }
}

/** Active le store durable local, ou le desactive sans effacer le fichier quand path est absent. */
export function configureSessionMemoryEcho(path?: string): void {
  persistencePath = path?.trim() || undefined
  byConversation.clear()
  if (!persistencePath || !existsSync(persistencePath)) return
  try {
    if (statSync(persistencePath).size > MAX_STORE_BYTES) return
    const parsed = JSON.parse(readFileSync(persistencePath, 'utf8')) as Partial<StoredEchoFile>
    if ((parsed.version !== 1 && parsed.version !== 2) || !Array.isArray(parsed.conversations))
      return
    for (const item of parsed.conversations.slice(-MAX_CONVERSATIONS)) {
      if (!item || typeof item.id !== 'string' || !item.id.trim()) continue
      const facts = Array.isArray(item.facts)
        ? item.facts
            .map(validFact)
            .filter((fact): fact is RememberedFact => Boolean(fact))
            .slice(-MAX_FACTS_PER_CONVERSATION)
        : []
      if (facts.length === 0) continue
      byConversation.set(item.id.slice(0, 256), {
        facts,
        evicted: Number.isFinite(item.evicted) ? Math.max(0, Math.floor(item.evicted)) : 0,
        evictedByWorkspace:
          parsed.version === 2
            ? validEvictedByWorkspace(item.evictedByWorkspace)
            : {
                'legacy-unscoped': Number.isFinite(item.evicted)
                  ? Math.max(0, Math.floor(item.evicted))
                  : 0
              }
      })
    }
  } catch {
    byConversation.clear()
  }
}

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
  const normalized = validFact(fact)
  if (!conversationId || !normalized) return false
  const echo = byConversation.get(conversationId) ?? {
    facts: [],
    evicted: 0,
    evictedByWorkspace: {}
  }
  const workspaceKey = factWorkspaceKey(normalized)
  /**
   * Déduplication sur le TITRE seul, et non sur le couple titre+corps : deux faits de même titre sont
   * une SUPERSESSION, pas deux faits. Sans ça, « Décision — on part sur A » et « Décision — finalement B,
   * A est abandonné » cohabitaient, le modèle relisait le périmé en premier, et la correction consommait
   * deux des douze places. Relevé le 2026-07-30.
   */
  const already = echo.facts.findIndex(
    (candidate) =>
      factWorkspaceKey(candidate) === workspaceKey && candidate.title === normalized.title
  )
  if (already >= 0) echo.facts.splice(already, 1)
  echo.facts.push(normalized)
  while (
    echo.facts.filter((candidate) => factWorkspaceKey(candidate) === workspaceKey).length >
    ECHO_MAX_FACTS
  ) {
    const oldest = echo.facts.findIndex((candidate) => factWorkspaceKey(candidate) === workspaceKey)
    if (oldest < 0) break
    echo.facts.splice(oldest, 1)
    echo.evicted += 1
    echo.evictedByWorkspace[workspaceKey] = (echo.evictedByWorkspace[workspaceKey] ?? 0) + 1
  }
  while (echo.facts.length > MAX_FACTS_PER_CONVERSATION) {
    const removed = echo.facts.shift()
    if (!removed) break
    const removedKey = factWorkspaceKey(removed)
    echo.evicted += 1
    echo.evictedByWorkspace[removedKey] = (echo.evictedByWorkspace[removedKey] ?? 0) + 1
  }
  touch(conversationId, echo)
  while (byConversation.size > MAX_CONVERSATIONS) {
    const oldest = byConversation.keys().next().value
    if (oldest === undefined) break
    byConversation.delete(oldest)
  }
  persistEcho()
  return true
}

/**
 * Ce que le modèle a retenu dans cette conversation, du plus ancien au plus récent.
 *
 * Rend une COPIE : `readonly` n'existe qu'à la compilation, et un appelant qui trierait ou inverserait le
 * retour muterait l'écho du fil. Lire rafraîchit aussi la récence — c'est le vrai signal d'activité, la
 * conversation en cours étant relue à chaque tour.
 */
export function rememberedFacts(
  conversationId: string | undefined,
  workspace?: string
): readonly RememberedFact[] {
  if (!conversationId) return []
  const echo = byConversation.get(conversationId)
  if (!echo) return []
  touch(conversationId, echo)
  if (workspace === undefined) return [...echo.facts]
  const workspaceKey = `workspace:${memoryWorkspaceIdentity(workspace)}`
  return echo.facts.filter((fact) => {
    const key = factWorkspaceKey(fact)
    return key === 'global' || key === workspaceKey
  })
}

/** Combien de faits le plafond a fait sortir de ce fil. Sert à DIRE la perte. */
export function evictedCount(conversationId: string | undefined, workspace?: string): number {
  const echo = conversationId ? byConversation.get(conversationId) : undefined
  if (!echo) return 0
  if (workspace === undefined) return echo.evicted
  const workspaceKey = `workspace:${memoryWorkspaceIdentity(workspace)}`
  return (echo.evictedByWorkspace.global ?? 0) + (echo.evictedByWorkspace[workspaceKey] ?? 0)
}

/** Vide l'écho. Existe pour qu'aucun fait ne fuite d'un test à l'autre. */
export function forgetEcho(): void {
  byConversation.clear()
  persistEcho()
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
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { dirname, resolve } from 'node:path'
