import { describe, expect, it } from 'vitest'
import { formatOrchestrationOutcome } from './orchestration-outcome'

/**
 * UNE CAUSE REPARABLE N'EST PAS UN ECHEC — c'est une attente.
 *
 * Ce que l'utilisateur lisait, mot pour mot, le 2026-08-27 (conv-1450) :
 *   « ⛔ Travail NON integre — ton arbre principal a une base sale (des fichiers non committes) ·
 *     statut echoue · cout 1,32 $ »
 * Sa reponse : « je ne veux plus jamais voir ce panneau sens interdit il me rend fou » et
 * « on ne finit jamais un tour sur un echec comme ca, on enchaine jusqu a reussir ».
 *
 * Le message DISAIT vrai — le travail n'etait pas integre — mais il le disait comme un point final :
 * un panneau d'interdiction et un statut « echoue », alors que la cause se repare, qu'une reprise est
 * armee, et que le travail est intact et atteignable. Le defaut n'est pas la franchise, c'est la
 * FINALITE.
 *
 * On ne fabrique pas le faux vert pour autant : « en attente » n'est PAS « integre », et le mot
 * « integre » ne doit apparaitre nulle part comme un acquis. Une cause que l'app ne peut PAS reparer
 * seule (un conflit de contenu reel) garde son panneau d'arret : la sortie honnete y est l'arbitrage
 * humain, pas une attente qui n'aboutira jamais.
 */
describe('formatOrchestrationOutcome — attente active plutot qu echec terminal', () => {
  const issue = (
    reason: string,
    files: string[] = []
  ): Parameters<typeof formatOrchestrationOutcome>[1] => ({
    gateBlocked: true,
    status: 'failed',
    gateReasons: [
      'intégration locale non terminée',
      `blocage d’intégration: ${reason}${files.length ? ` — fichiers en cause: ${files.join(', ')}` : ''}`
    ]
  })

  it('base sale : plus de panneau d interdiction, plus de statut echoue', () => {
    const texte = formatOrchestrationOutcome(true, issue('base-dirty', ['src/main/agent-pilot.ts']))

    expect(texte).not.toContain('⛔')
    expect(texte).not.toContain('Travail NON intégré')
    // Le mot exact qui a fait dire « statut echoue » a l'utilisateur.
    expect(texte).not.toContain('échoué')
    expect(texte).toContain('⏳')
    expect(texte).toContain('EN ATTENTE')
    // La franchise reste : la cause et les fichiers sont toujours nommes.
    expect(texte).toContain('base sale')
    expect(texte).toContain('src/main/agent-pilot.ts')
    // Et surtout : jamais present comme livre.
    expect(texte).not.toMatch(/✅|Workflow terminé/)
  })

  it('les autres causes reparables suivent la meme regle', () => {
    for (const cause of ['base-in-progress', 'merge-failed', 'ignored-deliverables']) {
      const texte = formatOrchestrationOutcome(true, issue(cause))
      expect(texte, cause).toContain('⏳')
      expect(texte, cause).not.toContain('échoué')
    }
  })

  it('un conflit de contenu reel garde son panneau d ARRET — aucune attente ne le resoudra', () => {
    const texte = formatOrchestrationOutcome(true, issue('conflict'))

    expect(texte).toContain('⛔')
    expect(texte).not.toContain('⏳')
    // L'arbitrage reste a l'humain : c'est ce que dit deja le catalogue des blocages.
    expect(texte).toContain('arbitrer')
  })

  it('un blocage de cause INCONNUE reste un arret : on n annonce pas une reprise non armee', () => {
    const texte = formatOrchestrationOutcome(true, {
      gateBlocked: true,
      status: 'failed',
      gateReasons: ['intégration locale non terminée']
    })

    expect(texte).toContain('⛔')
    expect(texte).not.toContain('⏳')
  })
})
