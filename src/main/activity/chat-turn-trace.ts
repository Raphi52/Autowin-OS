import { gesteDeLaLigne, type GesteAgent } from '../../shared/gestes-agent'
import { extraitDemandeUtilisateur } from './trace-allegee'
import { assertTraceEvent, type TraceEventV1 } from './trace-event'

/**
 * DEUX FAITS D'UN TOUR DE CHAT QUE LA TRACE NE GARDAIT PAS — pour l'arbre du panneau Détails.
 *
 * 1. LA DEMANDE REÇUE, au DÉBUT du tour. Le premier événement d'un tour de chat n'était écrit qu'à
 *    la FIN du premier appel au modèle (`agent-pilot.ts`, émission du `prompt-call`). Mesuré le
 *    2026-10-12 sur 43 tours de conv-879, 903, 904 et 906 : 32 à 100 % de la durée d'un tour
 *    passaient sans aucun événement. L'arbre reprenait alors le DERNIER tour écrit — le précédent —
 *    sous la mention « en direct », et datait la demande de la fin du premier appel (tour e074265e :
 *    titré 11:09, parti vers 11:05). Cet événement est le même instant que l'envoi.
 *
 * 2. LES GESTES PROPRES DE L'AGENT (Read, Bash, Edit…). Un run les écrit déjà en `tool-call`
 *    (`orchestration-observability.ts`, preuves d'exécution) ; le chat direct, non : un tour de
 *    18 min et 94 gestes tenait dans une seule perle « Orchestrateur ». La ligne d'état du modèle
 *    (« Read terminé - 3 s ») en donne le nom, l'issue et la durée : c'est TOUT ce qui est écrit,
 *    jamais un argument ni un retour.
 *
 * Fonctions pures : l'appelant fournit identifiant, séquence et horloge, et décide de l'écriture.
 */

/** Frontière d'observation des deux événements : les consommateurs les reconnaissent par elle. */
export { FRONTIERE_DEMANDE_RECUE, FRONTIERE_GESTE_AGENT } from '../../shared/trace-tour-chat'
import { FRONTIERE_DEMANDE_RECUE, FRONTIERE_GESTE_AGENT } from '../../shared/trace-tour-chat'

/** Texte humain d'un message, ramené au segment `UTILISATEUR:` borné que lit l'arbre. */
function segmentDemande(contenu: string): string {
  const marque = /(^|\n)\s*UTILISATEUR\s*:/.test(contenu) ? contenu : `UTILISATEUR: ${contenu}`
  return extraitDemandeUtilisateur(marque)
}

export function evenementDemandeRecue(input: {
  conversationId: string
  turnId: string
  sequence: number
  at: number
  contenu: string
}): TraceEventV1 {
  return assertTraceEvent({
    schema: 'autowin.trace/v1',
    id: `${input.turnId}:demande-recue`,
    conversationId: input.conversationId,
    turnId: input.turnId,
    timestamp: new Date(input.at).toISOString(),
    sequence: input.sequence,
    type: 'message',
    // Un fait accompli (la demande est arrivée), pas une activité : rien ne le « termine » plus tard.
    // L'arbre déduit « en cours » de l'absence de bilan du superviseur, sans laisser de `running`
    // orphelin sur le disque.
    status: 'completed',
    actor: { id: 'user', kind: 'human', label: 'Utilisateur' },
    recipient: { id: 'orchestrator', kind: 'agent', label: 'Orchestrateur' },
    channel: 'user',
    payloads: [{ kind: 'user-message', content: segmentDemande(input.contenu) }],
    observation: {
      boundary: FRONTIERE_DEMANDE_RECUE,
      fidelity: 'derived',
      limitation:
        'Segment UTILISATEUR de la demande, borné ; le message complet envoyé au modèle est porté par l’appel.'
    }
  })
}

/** Le geste fini qu'annonce une ligne d'état du modèle (« Read terminé - 3 s »), sinon rien. */
export { gesteDeLaLigne }

export function evenementGesteAgent(input: {
  conversationId: string
  turnId: string
  id: string
  sequence: number
  /** Instant où la ligne de fin est arrivée ; le début est reconstitué avec la durée. */
  finAt: number
  geste: GesteAgent
}): TraceEventV1 {
  const { geste } = input
  return assertTraceEvent({
    schema: 'autowin.trace/v1',
    id: input.id,
    conversationId: input.conversationId,
    turnId: input.turnId,
    // Horodaté au DÉBUT du geste : l'arbre le range sous l'appel au modèle pendant lequel il a eu
    // lieu (l'appel est écrit à sa fin, donc après tous ses gestes).
    timestamp: new Date(input.finAt - geste.dureeMs).toISOString(),
    sequence: input.sequence,
    type: 'tool-call',
    status: geste.ok ? 'completed' : 'failed',
    actor: { id: 'orchestrator', kind: 'agent', label: 'Orchestrateur' },
    recipient: { id: geste.nom, kind: 'tool', label: geste.nom },
    channel: 'tool',
    payloads: [{ kind: 'tool-call', name: geste.nom, content: '' }],
    observation: {
      boundary: FRONTIERE_GESTE_AGENT,
      fidelity: 'derived',
      limitation:
        'Nom, issue et durée du geste, relevés sur la ligne d’état du modèle : aucun argument ni retour.'
    },
    metrics: { durationMs: geste.dureeMs }
  })
}
