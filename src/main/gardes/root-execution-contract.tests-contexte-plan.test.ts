import { describe, expect, it } from 'vitest'
import type { ExecutionEvidence } from '../providers/types'
import { ROOT_DOD, rootRequirementChecks } from './root-execution-contract'
import { promptDuLot, type LotDuPlan, type PlanDeLots } from '../../shared/plan-de-lots'

/**
 * LE CONTEXTE COMMUN D'UN PLAN NE CHOISIT PAS LA COMMANDE DE TEST D'UN LOT.
 *
 * Vécu le 2026-11-20 (lot 7 d'un plan, conv-2047, run-26218cd842c9-1) : le contexte commun du plan
 * décrivait les conventions du dépôt de l'utilisateur — « tests par .\tests.ps1 ; vitest à côté de
 * chaque .tsx ». Le lot a lancé `powershell -File ./tests.ps1` (code 0, 33 bancs verts, vitest
 * compris), mais le contrôle final a refusé TROIS fois « Promis mais pas fait : "Tests demandes
 * executes avec un code de sortie 0" » (7,55 $). Cause : `verificationTargetsRequest` lisait le mot
 * « vitest » du contexte commun comme LA commande demandée, et n'acceptait plus qu'une commande
 * contenant « vitest ». Rejoué sur les preuves réelles du run : case décochée avec la demande telle
 * quelle, cochée dès que le mot « vitest » est retiré du contexte. Même coupe que `ciblesNommees`
 * (même fichier, test `root-execution-contract.contexte-plan.test.ts`) : seule la demande du lot
 * choisit sa commande de test.
 */
const CONTEXTE =
  'RÈGLES DU DÉPÔT : compiler par .\\compiler.ps1 (jamais dotnet build), tests par ' +
  '.\\tests.ps1 ; vitest à côté de chaque .tsx ; banc C# tests/GestesCheck pour les gestes.'

function plan(lots: LotDuPlan[]): PlanDeLots {
  return {
    id: 'plan-test',
    titre: 'Vue du dossier',
    chef: 'conv-1',
    contexte: CONTEXTE,
    lots
  } as unknown as PlanDeLots
}

function lot(demande: string): LotDuPlan {
  return { rang: 7, titre: 'Lot 7', demande, fichiers: [], etat: 'en-cours' } as LotDuPlan
}

function verification(command: string, exitCode = 0): ExecutionEvidence {
  return {
    type: 'command_execution',
    kind: 'verification',
    status: 'completed',
    ok: true,
    summary: command,
    command,
    exitCode
  }
}

function caseTests(demandeDuLot: string, preuve: ExecutionEvidence): boolean | undefined {
  const l = lot(demandeDuLot)
  return rootRequirementChecks(promptDuLot(plan([l]), l), {
    phases: [{ phase: 'build', text: 'livrable', executionEvidence: [preuve] }]
  }).find((check) => check.label === ROOT_DOD.tests)?.checked
}

const LOT_7 =
  '/build Le rapport du dossier 42 affiche une autre société. Preuve attendue : un contrôle rouge ' +
  'puis vert dans tests/GestesCheck ; .\\compiler.ps1 et .\\tests.ps1 code 0.'
const TESTS_PS1 = 'powershell -NoProfile -ExecutionPolicy Bypass -File ./tests.ps1'

describe('le contexte commun d’un plan ne choisit pas la commande de test du lot', () => {
  it('coche la case avec tests.ps1 quand seul le contexte commun cite vitest', () => {
    expect(caseTests(LOT_7, verification(TESTS_PS1))).toBe(true)
  })

  it('jumeau : une demande de lot qui nomme vitest exige toujours vitest', () => {
    const lotVitest = '/build Corrige Panneau.tsx. Vérifier : npx vitest run web/src/plan.'
    expect(caseTests(lotVitest, verification(TESTS_PS1))).toBe(false)
    expect(caseTests(lotVitest, verification('npx vitest run web/src/plan'))).toBe(true)
  })

  it('frontière : un test en échec ne coche rien', () => {
    expect(caseTests(LOT_7, verification(TESTS_PS1, 1))).toBe(false)
  })
})
