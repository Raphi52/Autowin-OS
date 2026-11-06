import { describe, expect, it } from 'vitest'
import type { ExecutionEvidence } from '../providers/types'
import { ROOT_DOD, rootRequirementChecks } from './root-execution-contract'

/**
 * « PAS NPM TEST ENTIER » N'EST PAS UNE DEMANDE DE LANCER NPM TEST.
 *
 * Vécu le 2026-11-06 (plan-a53e62ac, lot 1 dans conv-1655, run-8f276dd9bb2f-1) : la consigne des
 * lots disait « Vérifier : npm run typecheck, puis npx vitest run <fichiers>. Pas npm test entier. »
 * Le lot a joué vitest (code 0, 161 tests verts), mais le contrôle final a laissé la case des tests
 * décochée. Cause : `verificationTargetsRequest` cherchait « npm test » dans la demande avec un
 * simple `.test()`, sans la lecture des négations que `hasRequestedAction` fait déjà pour la DoD
 * (même fichier). Une interdiction devenait donc la seule preuve acceptée.
 */
const TACHE_QUI_INTERDIT_LA_SUITE =
  '/build Crée le garde-fou src/main/consignes/consignes-plafond.test.ts. Vérifier : npm run typecheck, ' +
  'puis npx vitest run src/main/chat-pilotage-prompt src/main/consignes/consignes-plafond.test.ts. ' +
  'Pas npm test entier.'

function verification(command: string): ExecutionEvidence {
  return {
    type: 'command_execution',
    kind: 'verification',
    status: 'completed',
    ok: true,
    summary: command,
    command,
    exitCode: 0
  }
}

function caseTests(task: string, command: string): boolean | undefined {
  return rootRequirementChecks(task, {
    phases: [{ phase: 'build', text: 'livrable', executionEvidence: [verification(command)] }]
  }).find((check) => check.label === ROOT_DOD.tests)?.checked
}

describe('une suite interdite ne devient pas la seule preuve de tests acceptée', () => {
  it('coche la case des tests avec vitest quand « npm test » est interdit', () => {
    expect(
      caseTests(
        TACHE_QUI_INTERDIT_LA_SUITE,
        'npx vitest run src/main/chat-pilotage-prompt src/main/consignes/consignes-plafond.test.ts'
      )
    ).toBe(true)
  })

  it('reconnaît « jamais npm test » et « sans npm test » comme des interdictions', () => {
    for (const tache of [
      'Corrige le défaut. Vérifie avec npx vitest run src/main/x.test.ts, jamais npm test.',
      'Corrige le défaut et vérifie avec npx vitest run src/main/x.test.ts, sans npm test.'
    ]) {
      expect(caseTests(tache, 'npx vitest run src/main/x.test.ts')).toBe(true)
    }
  })

  it('garde l’exigence quand npm test est vraiment demandé', () => {
    // Le défaut corrigé ne doit pas desserrer le cas légitime : « lance npm test » exige npm test.
    expect(
      caseTests('Corrige le défaut puis lance npm test.', 'npx vitest run src/main/x.test.ts')
    ).toBe(false)
    expect(caseTests('Corrige le défaut puis lance npm test.', 'npm test')).toBe(true)
  })
})
