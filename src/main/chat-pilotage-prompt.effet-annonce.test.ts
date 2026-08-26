import { describe, expect, it } from 'vitest'
import { buildChatPilotagePrompt } from './chat-pilotage-prompt'

/**
 * LE FAUX VERT SUR UNE COMMANDE ORDINAIRE — le trou de la règle existante.
 *
 * Le prompt interdit déjà d'annoncer « un lancement, un succès ou une clôture avant son résultat
 * observable ». Mais tout ce paragraphe parle d'ORCHESTRATION : il cite `reused`, `running`,
 * `failed`, `succeeded`, `runId`. Une commande ordinaire n'y est pas couverte.
 *
 * Le trou a coûté, et c'est mesuré. conv-1086, 2026-08-20 : l'agent écrit « je dépose le diagnostic
 * au Brain », puis `remember` est REFUSÉ (`type invalide`). Rien n'a été retenu. Son constat au tour
 * suivant : « J'ai écrit "je dépose le diagnostic au Brain" sans attendre le compte-rendu de la
 * commande. » L'utilisateur, lui, repart en croyant une leçon retenue — donc il ne la redonnera pas.
 *
 * Ce qui rend le piège vicieux : une commande peut RÉUSSIR en portant un REFUS. `ok: true` ne veut
 * pas dire « effet obtenu ». Rien dans le déroulement ne signale l'écart, sauf la lecture du
 * compte-rendu.
 *
 * La règle vit dans une chaîne de prompt : rien d'autre qu'un test ne l'empêche de disparaître en
 * silence lors d'une réécriture. Entrée qui DOIT faire rougir : le paragraphe retiré, ou l'interdit
 * re-restreint à l'orchestration.
 */
describe('chat-pilotage-prompt — annoncer un effet, c’est déjà le déclarer fait', () => {
  it('étend l’interdit à TOUTE commande, pas seulement à l’orchestration', () => {
    const prompt = buildChatPilotagePrompt([])
    expect(prompt).toMatch(/toute commande|n'importe quelle commande/iu)
    expect(prompt).toMatch(/compte-rendu/iu)
  })

  it('nomme le piège : une commande peut réussir EN PORTANT un refus', () => {
    const prompt = buildChatPilotagePrompt([])
    expect(prompt).toMatch(/REUSSIR|réussir/u)
    expect(prompt).toMatch(/refus/iu)
  })

  it('donne la formulation de repli quand le résultat n’est pas encore lu', () => {
    // Sans porte de sortie, la règle est inapplicable : l'agent doit pouvoir dire qu'il TENTE.
    const prompt = buildChatPilotagePrompt([])
    expect(prompt).toMatch(/je tente|j'essaie|tenter/iu)
  })

  it('garde la règle d’orchestration existante intacte', () => {
    // L'autre bord : élargir ne doit pas effacer ce qui marchait déjà.
    const prompt = buildChatPilotagePrompt([])
    expect(prompt).toContain('succeeded')
    expect(prompt).toContain('runId')
  })
})
