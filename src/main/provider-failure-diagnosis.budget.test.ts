import { describe, expect, it } from 'vitest'
import {
  classifyProviderFailure,
  diagnoseProviderFailure,
  explainRoleFailure
} from './provider-failure-diagnosis'

/**
 * UN BUDGET ÉPUISÉ N'EST PAS UNE PANNE DU RÔLE QUI SE LE VOIT REFUSER.
 *
 * Mesuré sur le run réel conv-1102 (vue Worktrees, 11/08). Message rendu à l'utilisateur :
 *   « verdict — le rôle judge est bindé sur claude (claude-opus-5) :
 *     Budget tokens total depasse (9639639/2500000) »
 * Or la trace du même appel porte `"durationMs": 0.698` : l'appel du juge a été REFUSÉ à
 * l'admission, il n'a jamais atteint le provider et n'a donc consommé aucun de ces 9,6 M de
 * tokens — ils l'ont été par les phases précédentes. Nommer le juge et son binding désigne un
 * innocent : c'est cette étiquette qui a fait chercher la panne du côté du juge et de Claude
 * pendant plusieurs jours, alors que le consommateur réel était la phase build.
 *
 * Le budget est par ailleurs comptabilisé APRÈS coup (`reserveProviderCall` réserve
 * budget_restant / appels_restants, une prévision), donc le dépassement ne peut être constaté
 * qu'à l'admission suivante — qui est presque toujours celle du juge, dernier de la chaîne.
 * Le rôle nommé est donc structurellement le mauvais.
 */
const echecBudget = {
  provider: 'claude',
  model: 'claude-opus-5',
  message: 'Budget tokens total depasse (9639639/2500000)'
}

describe('diagnostic d’un budget épuisé', () => {
  it('classe le dépassement de budget à part, pas en « other »', () => {
    expect(classifyProviderFailure('Budget tokens total depasse (9639639/2500000)')).toBe('budget')
    expect(classifyProviderFailure('Budget tokens frais depasse (900/800)')).toBe('budget')
    expect(classifyProviderFailure("Budget d'appels provider atteint (24)")).toBe('budget')
    expect(classifyProviderFailure('Budget duree depasse (7200000 ms)')).toBe('budget')
  })

  it('ne confond pas un budget avec une panne d’authentification ou de CLI', () => {
    expect(classifyProviderFailure('codex non authentifié — lance npm run codex:login')).toBe('auth')
    expect(classifyProviderFailure('spawn claude ENOENT')).toBe('cli-missing')
  })

  it('n’impute PAS la consommation au rôle qui se voit refuser l’appel', () => {
    const message = explainRoleFailure('verdict', 'judge', echecBudget)
    expect(message).not.toContain('est bindé sur')
    expect(message).toContain('judge')
    // La cause chiffrée reste lisible telle quelle : on ne masque rien.
    expect(message).toContain('9639639/2500000')
  })

  it('dit que la consommation vient des phases précédentes et propose un geste utile', () => {
    const diagnosed = diagnoseProviderFailure(echecBudget)
    expect(diagnosed.kind).toBe('budget')
    expect(diagnosed.hint).toBeDefined()
    const message = explainRoleFailure('verdict', 'judge', echecBudget)
    expect(message).toMatch(/phases précédentes|déjà consommé/)
  })

  it('laisse intact le message d’une vraie panne de rôle', () => {
    const message = explainRoleFailure('Phase build', 'subagent', {
      provider: 'codex',
      model: 'gpt-5.6-sol',
      message: 'codex non authentifié — lance npm run codex:login'
    })
    expect(message).toContain('le rôle subagent est bindé sur codex')
  })
})
