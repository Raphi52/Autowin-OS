import { describe, expect, it } from 'vitest'
import {
  formatOrchestrationOutcome,
  hasAuthoritativeDeliveredClosingBlock
} from './orchestration-outcome'

/**
 * LA CLOTURE DOIT DIRE DE QUOI ELLE PARLE.
 *
 * Defaut rapporte le 23/08 (conv-1376) : « ce bloc est trop generique il ne me donne pas d'info sur
 * la task ». Le pied etait rigoureusement le meme pour n'importe quel travail — impossible, en
 * relisant un fil, de savoir a quelle demande ce « ✅ Fait » repondait. Le SUJET du run est pourtant
 * deja porte par l'issue (`runPath`), et deja lu ailleurs dans ce meme module.
 *
 * ENTREE QUI DOIT FAIRE ECHOUER une correction fausse : une issue SANS `runPath`. Si le correctif
 * fabriquait un sujet (chemin devine, id de run brut, libelle par defaut), le dernier test rougit.
 */
const livre = (
  phases: string[],
  runPath?: string
): Parameters<typeof formatOrchestrationOutcome>[1] => ({
  status: 'succeeded',
  valid: true,
  gateBlocked: false,
  reused: false,
  result: 'Le cadrage du besoin.',
  ...(runPath ? { runPath } : {}),
  phaseOutputs: phases.map((phase) => ({ phase, text: `livrable ${phase}` }))
})

const chemin = 'C:/x/runs/conv-1376/rendre-la-cloture-parlante-workspace/RUN.md'

/*
 * ON N'ASSERTE QUE LE BLOC, pas le texte entier. Premiere version de ce test : verte AVANT toute
 * correction, parce que l'entete « ✅ Workflow terminé · statut … · run « X » » nomme deja le sujet.
 * Le defaut rapporte porte sur le PIED, qui reste generique meme quand l'entete est precise.
 */
const bloc = (texte: string): string => texte.slice(texte.indexOf('\n---\n'))

describe('le pied de clôture nomme le SUJET du travail', () => {
  it('portée inconnue (juge seul) : le sujet est dit DANS le bloc', () => {
    const texte = bloc(formatOrchestrationOutcome(true, livre([], chemin)))
    expect(texte).toContain('rendre-la-cloture-parlante')
    // La garantie d'honnêteté d'origine reste : pas de « rien » sur une portée inconnue.
    expect(texte).toContain('Reste à faire : inconnu ici')
  })

  it('run d’analyse seule : le sujet est dit en plus de la phase', () => {
    const texte = bloc(formatOrchestrationOutcome(true, livre(['frame'], chemin)))
    expect(texte).toContain('rendre-la-cloture-parlante')
    expect(texte).toContain('phase frame')
    expect(texte).toContain('Recommandé : lancer terrain.')
  })

  it('run qui a muté : le sujet est dit, « reste à faire : rien » intact', () => {
    const texte = bloc(formatOrchestrationOutcome(true, livre(['frame', 'build', 'judge'], chemin)))
    expect(texte).toContain('rendre-la-cloture-parlante')
    expect(texte).toContain('Reste à faire : rien.')
  })

  it('le bloc enrichi est toujours RELU comme celui d’Autowin', () => {
    for (const phases of [[], ['frame'], ['frame', 'build']]) {
      const texte = formatOrchestrationOutcome(true, livre(phases, chemin))
      expect(hasAuthoritativeDeliveredClosingBlock(texte)).toBe(true)
    }
  })

  it('SANS runPath : aucun sujet inventé', () => {
    const brut = formatOrchestrationOutcome(true, livre(['frame']))
    const texte = bloc(brut)
    expect(texte).not.toContain('sujet')
    expect(texte).not.toContain('«')
    expect(hasAuthoritativeDeliveredClosingBlock(texte)).toBe(true)
  })
})
