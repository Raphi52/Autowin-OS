import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { OrchestrationStep } from '../orchestrator'
import {
  etatsDesSousTaches,
  mettreAJourPlanDuRun,
  placerSectionPlan,
  sectionPlan,
  vaguesDuPlan,
  type SousTachePlan
} from './plan-en-vagues'

/*
 * LE PLAN DU BUILD, RELISIBLE DANS LE RUN.md (conv-1083, 2026-10-22).
 *
 * Le décomposeur rend un graphe de sous-tâches et leurs dépendances ; seul « plan de N sous-tâches »
 * arrivait à l'écran. Entrée qui ferait échouer ce banc si le calcul était faux : D dépend de B et C,
 * qui dépendent de A — si les vagues ignoraient les dépendances, D sortirait en vague 1 ; et C, sautée
 * parce que A a échoué, ne doit pas être lue comme « échouée ».
 */
const PLAN: SousTachePlan[] = [
  { id: 'A', consigne: 'Écrire le module de lecture', deps: [] },
  { id: 'B', consigne: 'Brancher la lecture dans la vue', deps: ['A'] },
  { id: 'C', consigne: 'Ajouter le test de la lecture', deps: ['A'] },
  { id: 'D', consigne: 'Documenter', deps: ['B', 'C'] }
]

function etape(
  taskId: string,
  status: OrchestrationStep['status'],
  error?: string
): OrchestrationStep {
  return {
    step: 'exec',
    status,
    ...(error ? { error } : {}),
    execution: { phase: 'build', taskId, groupId: 'build:greedy' }
  }
}

describe('vaguesDuPlan', () => {
  it('range chaque sous-tâche après toutes ses dépendances', () => {
    expect(vaguesDuPlan(PLAN).vagues.map((v) => v.map((n) => n.id))).toEqual([
      ['A'],
      ['B', 'C'],
      ['D']
    ])
  })

  it('une dépendance inconnue ou un cycle sort en « non ordonnables », jamais en vague 1', () => {
    const r = vaguesDuPlan([
      { id: 'X', consigne: 'x', deps: ['Y'] },
      { id: 'Y', consigne: 'y', deps: ['X'] },
      { id: 'Z', consigne: 'z', deps: ['fantome'] },
      { id: 'W', consigne: 'w', deps: [] }
    ])
    expect(r.vagues.map((v) => v.map((n) => n.id))).toEqual([['W']])
    expect(r.nonOrdonnables.map((n) => n.id)).toEqual(['X', 'Y', 'Z'])
  })
})

describe('etatsDesSousTaches', () => {
  it('lit la dernière issue de chaque sous-tâche ; une sautée reste « sautée »', () => {
    const etats = etatsDesSousTaches(PLAN, [
      etape('A', 'failed', 'sous-agent en échec'),
      etape('C', 'failed', 'sous-tâche C sautée (dépendance en échec)'),
      etape('B', 'completed')
    ])
    expect(etats.get('A')).toBe('échouée')
    expect(etats.get('B')).toBe('faite')
    expect(etats.get('C')).toBe('sautée')
    expect(etats.get('D')).toBe('à faire')
  })

  it('une réparation réussie remplace l’échec d’avant', () => {
    const etats = etatsDesSousTaches(PLAN, [etape('A', 'failed', 'x'), etape('A', 'completed')])
    expect(etats.get('A')).toBe('faite')
  })

  it('une étape hors du découpage (juge, autre phase) ne compte pas', () => {
    const etats = etatsDesSousTaches(PLAN, [
      { step: 'judge', status: 'failed', execution: { taskId: 'A' } }
    ])
    expect(etats.get('A')).toBe('à faire')
  })
})

describe('sectionPlan / placerSectionPlan', () => {
  const RUN = `status: open

## Besoin
x

## SOP
<!-- y -->

## Journal
[2026-10-22] Orchestration lancée.

## Défauts
`

  it('écrit les vagues, les dépendances et l’état de chaque sous-tâche', () => {
    const section = sectionPlan(PLAN, new Map([['A', 'faite']]))
    expect(section).toContain('## Plan')
    expect(section).toContain('### Vague 1')
    expect(section).toContain('- [x] A · Écrire le module de lecture — faite')
    expect(section).toContain('- [ ] D · Documenter (après B, C) — à faire')
  })

  it('se place avant le Journal, et se REMPLACE au passage suivant (jamais deux sections)', () => {
    const une = placerSectionPlan(RUN, sectionPlan(PLAN, new Map()))
    const deux = placerSectionPlan(une, sectionPlan(PLAN, new Map([['A', 'faite']])))
    expect(deux.match(/^## Plan$/gm)).toHaveLength(1)
    expect(deux.indexOf('## Plan')).toBeLessThan(deux.indexOf('## Journal'))
    expect(deux).toContain('A · Écrire le module de lecture — faite')
    expect(deux).toContain('## Défauts')
  })
})

describe('mettreAJourPlanDuRun', () => {
  const dossiers: string[] = []
  afterEach(() => {
    for (const d of dossiers.splice(0)) rmSync(d, { recursive: true, force: true })
  })

  it('reprend le plan porté par l’étape de découpage et l’écrit dans le RUN.md', () => {
    const dossier = mkdtempSync(join(tmpdir(), 'plan-vagues-'))
    dossiers.push(dossier)
    const run = join(dossier, 'RUN.md')
    writeFileSync(run, '## Besoin\nx\n\n## Journal\n[j] lancé\n', 'utf8')
    const steps: OrchestrationStep[] = [
      { step: 'gate', role: 'decompose', status: 'completed', plan: PLAN },
      etape('A', 'completed')
    ]
    mettreAJourPlanDuRun(run, steps)
    const md = readFileSync(run, 'utf8')
    expect(md).toContain('- [x] A · Écrire le module de lecture — faite')
    expect(md).toContain('- [ ] B · Brancher la lecture dans la vue (après A) — à faire')
  })

  it('sans plan (tâche atomique), le RUN.md ne change pas', () => {
    const dossier = mkdtempSync(join(tmpdir(), 'plan-vagues-'))
    dossiers.push(dossier)
    const run = join(dossier, 'RUN.md')
    writeFileSync(run, '## Journal\n', 'utf8')
    mettreAJourPlanDuRun(run, [{ step: 'gate', role: 'decompose', status: 'completed' }])
    expect(readFileSync(run, 'utf8')).toBe('## Journal\n')
  })
})
