import { describe, expect, it } from 'vitest'
import { extrairePropositionsSuite } from '../../shared/prompt-suivant'
import { ConversationStore } from '../store/conversations'
import { PROPOSITION_GROW } from '../chat/proposition-grow'
import { createOrchestrateTurnPersistence } from './orchestrate-turn-persistence'

/**
 * GROW PROPOSÉE SUR L'AUTRE FIN DE RUN (objection du juge, 2026-11-02).
 *
 * Un run lancé depuis les tickets (`os:orchestrate`) ou repris après un redémarrage
 * (`relaunch-resumable-run.ts`) ne se clôt PAS par le tour de chat : il se clôt ici, par `succeed`,
 * avec le résultat BRUT du moteur. Le bouton `/grow` doit y apparaître aux mêmes conditions. On lit
 * le fil ENREGISTRÉ comme le champ de saisie (toutes les parts texte du dernier message).
 */
const sortie = (phase: string) => ({ phase, text: `sortie ${phase}` })
const LIVRE = {
  result: 'Fait : correctif publié.',
  valid: true,
  gateBlocked: false,
  gateReasons: []
}

function propositionsApres(
  demande: string,
  resultat: Parameters<ReturnType<typeof createOrchestrateTurnPersistence>['succeed']>[0],
  resumeExisting = false
): string[] {
  let t = 1
  const store = new ConversationStore(() => t++)
  const id = store.create({ title: 'grow', provider: 'cc' }).id
  if (resumeExisting) store.beginTurn(id, { content: demande }, { turnId: 'tour' })
  const tour = createOrchestrateTurnPersistence({
    conversations: store,
    conversationId: id,
    turnId: 'tour',
    resumeExisting
  })
  tour.begin(demande)
  tour.succeed(resultat)
  const dernier = [...store.get(id)!.messages].reverse().find((m) => m.role === 'assistant')
  const texte = (dernier?.parts ?? [])
    .flatMap((p) => (p.kind === 'text' ? [p.text] : []))
    .join('\n')
  return extrairePropositionsSuite(texte, demande).map((p) => p.texte)
}

describe('fin de run hors chat : grow est proposée après une demande d’action livrée', () => {
  it('run lancé depuis un ticket, build livré → /grow proposé', () => {
    const suites = propositionsApres('/build corrige le ticket', {
      ...LIVRE,
      phaseOutputs: [sortie('frame'), sortie('build')]
    })
    expect(suites).toContain(PROPOSITION_GROW)
  })

  it('run repris après redémarrage (tour existant), clean livré → /grow proposé', () => {
    const suites = propositionsApres('/clean', { ...LIVRE, phaseOutputs: [sortie('clean')] }, true)
    expect(suites).toContain(PROPOSITION_GROW)
  })

  it('analyse seule (scout) livrée → pas de /grow', () => {
    expect(
      propositionsApres('/scout pistes', { ...LIVRE, phaseOutputs: [sortie('scout')] })
    ).not.toContain(PROPOSITION_GROW)
  })

  it('build refusé par le contrôle final → pas de /grow', () => {
    expect(
      propositionsApres('/build x', {
        ...LIVRE,
        valid: false,
        gateBlocked: true,
        gateReasons: ['preuve absente'],
        phaseOutputs: [sortie('build')]
      })
    ).not.toContain(PROPOSITION_GROW)
  })

  it('build resté dans sa copie de travail → pas de /grow', () => {
    expect(
      propositionsApres('/build x', {
        ...LIVRE,
        phaseOutputs: [sortie('build')],
        retainedWorkspace: { runId: 'r', path: 'p', files: [] }
      })
    ).not.toContain(PROPOSITION_GROW)
  })

  it('clôture sans exécution (publication déjà acquise, rattachement) → pas de /grow', () => {
    expect(propositionsApres('/build x', { result: 'Rattachement terminé.' })).not.toContain(
      PROPOSITION_GROW
    )
  })

  it('le tour de grow lui-même ne se repropose pas', () => {
    expect(
      propositionsApres(PROPOSITION_GROW, { ...LIVRE, phaseOutputs: [sortie('build')] })
    ).not.toContain(PROPOSITION_GROW)
  })
})
