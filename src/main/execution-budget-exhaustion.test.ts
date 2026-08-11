import { describe, expect, it } from 'vitest'
import { ExecutionBudgetExceededError, isBudgetExhaustion } from './execution-supervisor'
import { explainRoleFailure } from './provider-failure-diagnosis'

/**
 * Un plafond atteint n'est pas un defaut du livrable — c'est une limite de DEPENSE.
 *
 * Mesure du 2026-08-10 sur l'instance canary : un run a heurte « Budget tokens total atteint » en
 * phase `clean`, APRES avoir produit un commit verifie (lint vert, TypeScript vert, 183 tests
 * cibles, suite complete 469 fichiers / 4978 tests). Le run s'est ferme `failed`, le commit est
 * reste orphelin dans son worktree, et il a fallu deux prompts de recuperation manuelle.
 * La cause racine : l'enveloppe de role reecrivait l'erreur en `Error` generique, donc plus rien en
 * aval ne pouvait distinguer « plus de budget » de « le modele a echoue ».
 */
describe('isBudgetExhaustion — la nature de l’erreur survit aux enveloppes', () => {
  it('reconnaît l’erreur nue', () => {
    expect(
      isBudgetExhaustion(new ExecutionBudgetExceededError('Budget tokens total atteint'))
    ).toBe(true)
  })

  it('la reconnaît À TRAVERS l’enveloppe de rôle — le cas réellement observé', () => {
    const nue = new ExecutionBudgetExceededError('Budget tokens total atteint (6000000)')
    const enveloppee = new Error(
      explainRoleFailure('Phase clean', 'subagent', {
        provider: 'claude',
        model: 'claude-opus-5',
        message: nue.message
      }),
      { cause: nue }
    )

    // Le message exact relevé dans les conversations du 2026-08-10.
    expect(enveloppee.message).toContain('Budget tokens total atteint')
    expect(isBudgetExhaustion(enveloppee)).toBe(true)
  })

  it('la reconnaît même sans `cause`, par le message — enveloppes anciennes', () => {
    expect(isBudgetExhaustion(new Error("Phase build : Budget d'agents atteint (10)"))).toBe(true)
  })

  it('remonte plusieurs niveaux d’enveloppe', () => {
    const profond = new Error('a', {
      cause: new Error('b', { cause: new ExecutionBudgetExceededError('Budget USD atteint') })
    })
    expect(isBudgetExhaustion(profond)).toBe(true)
  })

  it('NE confond PAS un vrai échec du livrable avec un plafond', () => {
    // Le contre-test qui compte : si ceci passait, un run réellement cassé serait clos en douceur.
    expect(isBudgetExhaustion(new Error('codex exec échec exit-code=1'))).toBe(false)
    expect(isBudgetExhaustion(new Error('Gate BLOQUÉ : intégrité non prouvée'))).toBe(false)
    expect(isBudgetExhaustion(new Error('le budget prévisionnel du projet est serré'))).toBe(false)
    expect(isBudgetExhaustion(undefined)).toBe(false)
  })

  it('ne boucle pas sur une chaîne de causes circulaire', () => {
    const a = new Error('a')
    const b = new Error('b', { cause: a })
    ;(a as { cause?: unknown }).cause = b
    expect(isBudgetExhaustion(a)).toBe(false)
  })
})

describe('robustesse inter-contextes — la raison du duck-typing', () => {
  it('reconnaît une erreur venue d’un AUTRE contexte d’exécution', () => {
    // Mesuré en écrivant ce test : `instanceof Error` échoue sur un objet créé dans un autre
    // contexte (le cas normal dans Electron entre main/preload/renderer). Un garde qui rend `false`
    // sans rien dire est pire qu'absent : on croit qu'il protège.
    const etrangere = {
      name: 'Error',
      message: "Phase build : Budget d'agents atteint (10)",
      stack: 'ailleurs'
    }

    expect(etrangere instanceof Error).toBe(false)
    expect(isBudgetExhaustion(etrangere)).toBe(true)
  })

  it('reconnaît la classe par son NOM quand l’identité d’objet est perdue', () => {
    expect(
      isBudgetExhaustion({ name: 'ExecutionBudgetExceededError', message: 'peu importe' })
    ).toBe(true)
  })

  it('ne se laisse pas berner par un objet quelconque', () => {
    expect(isBudgetExhaustion({ message: 42 })).toBe(false)
    expect(isBudgetExhaustion({ nom: 'budget tokens' })).toBe(false)
    expect(isBudgetExhaustion('budget tokens atteint')).toBe(false)
  })
})
