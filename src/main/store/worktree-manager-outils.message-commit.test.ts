import { describe, expect, it } from 'vitest'
import { messageCommitAgent } from './worktree-manager-outils'

/**
 * Message du commit qui ramène le travail d'une copie. Il reprend la première ligne de la demande, qui peut
 * nommer l'entreprise ; `.githooks/commit-msg` refuserait alors le commit, donc le travail du run. La règle
 * du dépôt (`texteReserve`) arrive en `estReserve` : un résumé réservé laisse le seul préfixe `agent <id>`.
 */
const reserve = (texte: string): boolean => /zorglub/i.test(texte)

describe('messageCommitAgent', () => {
  it('reprend la première ligne non vide de la demande après le préfixe', () => {
    expect(messageCommitAgent('run-1', '\n  Ajoute le tri par date  \nsuite')).toBe(
      'agent run-1: Ajoute le tri par date'
    )
  })

  it('garde le seul préfixe quand le résumé nomme ce que la règle du dépôt réserve', () => {
    expect(messageCommitAgent('run-1', 'Corrige le cas Zorglub', reserve)).toBe('agent run-1')
  })

  it('garde le résumé quand la règle ne réserve rien', () => {
    expect(messageCommitAgent('run-1', 'Ajoute le tri par date', reserve)).toBe(
      'agent run-1: Ajoute le tri par date'
    )
  })

  it('juge le résumé tel qu il part, coupé à 72 caractères', () => {
    // Le terme réservé est au-delà de la coupe : le message envoyé ne le porte pas, il n'a pas à être écarté.
    const longue = `${'a'.repeat(80)} zorglub`
    expect(messageCommitAgent('run-1', longue, reserve)).toBe(`agent run-1: ${'a'.repeat(71)}…`)
  })
})
