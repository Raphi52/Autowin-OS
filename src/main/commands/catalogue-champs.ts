// Champs et phrases partagés par plusieurs familles du catalogue des commandes, sortis tels quels
// de commands/catalogue.ts (conv-1580) pour que chaque famille les importe sans cycle.
import type { SchemaArgument } from '../skills/skill-node-mcp'

/**
 * Pas-à-pas du navigateur intégré (conv-1286, 2026-10-30) : chaque geste de l'agent (ouvrir, lire,
 * capturer, agir) peut ATTENDRE l'utilisateur, ou être refusé s'il a repris la main. Phrase commune
 * aux quatre outils concernés : sans elle, l'agent prendrait l'attente pour une panne et relancerait.
 */
export const PHRASE_PAS_A_PAS_NAVIGATEUR =
  '. Si l’utilisateur a mis l’agent en pause, ce geste attend qu’il le libère ; un refus « main-reprise » veut dire qu’il a repris la main : n’agis plus dans la page sans qu’il te le redemande'

/** Une liste de textes, publiée comme telle (conv-1370) : `ids`, `chemins`. */
export const LISTE_DE_TEXTES: SchemaArgument = { type: 'array', items: { type: 'string' } }

/**
 * `conversation_read` avec `message` : taille d'une tranche, à l'échelle des pages de `retrospective`.
 * À 4 000 caractères comme la liste, lire un message de 50 000 caractères coûterait 13 appels.
 */
export const TRANCHE_MESSAGE_LU = 20_000

/**
 * LA FORME D'UNE TÂCHE, publiée telle que `parseTaskInput` la valide (task-manager-ipc.ts).
 *
 * conv-1370, 2026-10-31 : `task` partait en texte, et 4 échecs sur 12 de `task_create` venaient de
 * `watchdog.guards`, un objet exigé même vide que rien n'annonçait. `task_update` publie les mêmes
 * champs sans rien exiger : on n'y passe que ce qui change.
 */
export const CHAMPS_DE_TACHE: Record<string, SchemaArgument> = {
  title: { type: 'string' },
  prompt: { type: 'string' },
  enabled: { type: 'boolean' },
  mode: { type: 'string', enum: ['active-only', 'windows'] },
  destination: {
    type: 'object',
    description:
      'où part le prompt. kind « existing » : conversationId exigé. kind « new » : title, category et provider exigés',
    properties: {
      kind: { type: 'string', enum: ['existing', 'new'] },
      conversationId: { type: 'string' },
      title: { type: 'string' },
      category: { type: 'string' },
      provider: { type: 'string' },
      model: { type: 'string' },
      reasoningEffort: { type: 'string' }
    },
    required: ['kind']
  },
  action: { type: 'string', enum: ['chat', 'veille'] },
  schedule: {
    type: 'object',
    description: 'déclencheur horaire, à la place de watchdog',
    properties: {
      startDate: { type: 'string', description: 'AAAA-MM-JJ' },
      time: { type: 'string', description: 'HH:MM' },
      timeZone: { type: 'string', description: 'ex. Europe/Paris' },
      endDate: { type: 'string', description: 'facultatif — AAAA-MM-JJ' },
      recurrence: {
        type: 'object',
        description: 'unit « none » = une seule fois',
        properties: {
          unit: { type: 'string', enum: ['none', 'minute', 'hour', 'day', 'week', 'month'] },
          interval: { type: 'integer', minimum: 1 },
          weekDays: { type: 'array', items: { type: 'integer' } }
        },
        required: ['unit', 'interval']
      }
    },
    required: ['startDate', 'time', 'timeZone', 'recurrence']
  },
  watchdog: {
    type: 'object',
    description: 'réveil sur événement, à la place de schedule',
    properties: {
      source: {
        type: 'object',
        description:
          'ce qui réveille. kind « file-match » : path et pattern (expression régulière) exigés. kind « app-event » : events exigé, et conversationId avec chat-turn-done. kind « outlook-mail » : rien d’autre',
        properties: {
          kind: { type: 'string', enum: ['file-match', 'app-event', 'outlook-mail'] },
          path: { type: 'string' },
          pattern: { type: 'string' },
          caseSensitive: { type: 'boolean' },
          events: {
            type: 'array',
            items: {
              type: 'string',
              enum: [
                'orchestration-red',
                'task-failed',
                'task-missed',
                'workflow-gate-failed',
                'workflow-unverified',
                'workflow-proof-lost',
                'chat-turn-done'
              ]
            }
          },
          conversationId: { type: 'string' },
          channel: { type: 'string', enum: ['outlook', 'teams'] },
          senders: { type: 'object' },
          newSenders: { type: 'string', enum: ['ignore'] }
        },
        required: ['kind']
      },
      guards: {
        type: 'object',
        description:
          'gardes anti-rafale, OBLIGATOIRES même sans réglage : passe {} pour les valeurs par défaut',
        properties: {
          dedupWindowMs: {
            type: 'integer',
            minimum: 0,
            maximum: 86_400_000,
            description: 'fenêtre d’anti-doublon en millisecondes (défaut 60000)'
          },
          maxTriggersPerHour: {
            type: 'integer',
            minimum: 1,
            maximum: 240,
            description: 'réveils par heure au plus (défaut 12)'
          },
          maxChainDepth: {
            type: 'integer',
            minimum: 0,
            maximum: 3,
            description: 'profondeur d’une chaîne de réveils (défaut 0)'
          },
          maxPerRoot: {
            type: 'integer',
            minimum: 1,
            maximum: 500,
            description: 'largeur d’une cascade (défaut 20)'
          },
          maxTriggersPerDay: { type: 'integer', minimum: 1, maximum: 5760 },
          maxKnownCostUsdPerDay: { type: 'number', minimum: 0.01, maximum: 10_000 },
          maxUnpricedCallsPerDay: { type: 'integer', minimum: 1, maximum: 5760 }
        }
      },
      action: { type: 'string', enum: ['chat', 'orchestration'] }
    },
    required: ['source', 'guards']
  }
}
