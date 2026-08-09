import { assertTraceEvent, type TraceEventV1 } from './trace-event'

/**
 * Forme MINIMALE d'un artefact dont la trace a besoin — volontairement structurelle plutot qu'un
 * import de `ChatArtifact` : la trace ne doit dependre que du nom, du chemin et de la taille, et
 * surtout ne JAMAIS casser un tour parce qu'un champ nouveau ou absent l'a surprise.
 */
interface ArtifactLike {
  kind?: string
  name?: string
  path?: string
  bytes?: number
  mediaType?: string
}

interface ChatArtifactTraceInput {
  id: string
  conversationId: string
  turnId: string
  parentId?: string
  timestamp: string
  sequence: number
  artifact: ArtifactLike
}

/**
 * Construit l'evenement causal d'un artefact produit par le modele.
 *
 * L'artefact est attribue a l'AGENT et passe par le canal `assistant` : c'est une sortie du modele,
 * pas le retour d'un appel d'outil. Le distinguer de `tool-result` evite de gonfler le comptage des
 * appels d'outils qu'Observatory affiche en en-tete.
 *
 * La charge utilise le genre `attachment`, deja present dans `TracePayloadKind` — le contrat
 * anticipait les pieces jointes, il n'y avait qu'a s'en servir.
 */
export function chatArtifactToTraceEvent(input: ChatArtifactTraceInput): TraceEventV1 {
  const { artifact } = input
  const label = artifact.name ?? artifact.path ?? 'artefact sans nom'
  // Un artefact mal forme (ni nom ni chemin) ne doit pas faire echouer la validation et donc faire
  // perdre la trace du tour ENTIER : mieux vaut un evenement pauvre qu'une trace absente.
  const description = [
    `artefact : ${label}`,
    artifact.kind ? `genre : ${artifact.kind}` : undefined,
    artifact.path && artifact.path !== label ? `chemin : ${artifact.path}` : undefined,
    typeof artifact.bytes === 'number' ? `taille : ${artifact.bytes} octets` : undefined
  ]
    .filter(Boolean)
    .join('\n')

  return assertTraceEvent({
    schema: 'autowin.trace/v1',
    id: input.id,
    conversationId: input.conversationId,
    turnId: input.turnId,
    parentId: input.parentId,
    timestamp: input.timestamp,
    sequence: input.sequence,
    type: 'artifact',
    status: 'completed',
    actor: { id: 'orchestrator', kind: 'agent', label: 'Orchestrateur' },
    injector: { id: 'autowin', kind: 'system', label: 'Autowin OS' },
    recipient: { id: 'user', kind: 'human', label: 'Utilisateur' },
    channel: 'assistant',
    payloads: [
      {
        kind: 'attachment',
        name: artifact.name,
        mediaType: artifact.mediaType,
        content: description
      }
    ],
    observation: { boundary: 'Autowin OS chat artifact store', fidelity: 'exact' }
  })
}
