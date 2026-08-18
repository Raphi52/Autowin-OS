/**
 * Filiation Auto-Kaizen — type PARTAGÉ.
 *
 * Vit ici et non dans `auto-kaizen-supervisor.ts` parce que le magasin de conversations (couche
 * basse) le porte sur `Conversation.autoKaizen` : c'était la couche basse qui importait la couche
 * haute. L'import était `import type`, donc l'arête runtime était nulle — mais le sens de lecture,
 * lui, était inversé. Le superviseur ré-exporte ces deux noms pour ses appelants existants.
 */
export type AutoKaizenConversationRole = 'analysis' | 'fix'

export interface AutoKaizenConversationLink {
  incidentId: string
  sourceConversationId: string
  role: AutoKaizenConversationRole
  rootIncidentId: string
  parentIncidentId?: string
  depth: number
}
