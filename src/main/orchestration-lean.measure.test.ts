/**
 * Mesure DÉTERMINISTE (zéro token, zéro réseau) du gain structurel des 3 leviers.
 * Ce n'est PAS l'A/B live (magnitude token/latence réelle en prod) — c'est le gain PROUVABLE par
 * construction : réduction du nombre d'appels modèle (#1) + octets système injectés par phase (#1/#3).
 * Sortie chiffrée dans la console de test ; assertions garantissent la DIRECTION du gain.
 */
import { describe, it, expect } from 'vitest'
import { regimePhases } from './task-regime'
import { phaseBrief } from './phase-briefs'
import { PIPELINE_DISCIPLINE_INSTRUCTION } from './pipeline-discipline'
import { CONCISE_STRUCTURED_RESPONSE_INSTRUCTION } from './response-style'
import type { PipelinePhase } from './skill-pipeline'

const OLD_PHASES: PipelinePhase[] = ['scout', 'frame', 'terrain', 'build', 'clean']
const CONSTANT_SYSTEM =
  PIPELINE_DISCIPLINE_INSTRUCTION.length + CONCISE_STRUCTURED_RESPONSE_INSTRUCTION.length

/** Octets système injectés pour un ensemble de phases (consigne/phase + discipline + style, ×phases). */
function injectedSystemBytes(phases: PipelinePhase[]): number {
  return phases.reduce((sum, p) => sum + phaseBrief(p).length + CONSTANT_SYSTEM, 0)
}

describe('gain structurel des 3 leviers (déterministe, ~tokens = octets/4)', () => {
  it('imprime le tableau de réduction et garantit la direction', () => {
    const cases: { label: string; task: string }[] = [
      { label: 'trivial', task: 'corrige la typo' },
      { label: 'standard', task: 'ajoute un bouton export CSV' }
    ]
    const oldCalls = OLD_PHASES.length + 1 // +1 juge
    const oldBytes = injectedSystemBytes(OLD_PHASES)
    const rows: string[] = []
    for (const c of cases) {
      const phases = regimePhases(c.task)
      const newCalls = phases.length + 1
      const newBytes = injectedSystemBytes(phases)
      const callCut = Math.round((1 - newCalls / oldCalls) * 100)
      const byteCut = Math.round((1 - newBytes / oldBytes) * 100)
      rows.push(
        `${c.label.padEnd(9)} phases ${OLD_PHASES.length}→${phases.length} | appels ${oldCalls}→${newCalls} (−${callCut}%) | sys injecté ${oldBytes}→${newBytes} o (−${byteCut}%)`
      )
      // Direction garantie : jamais PLUS d'appels ni PLUS d'octets qu'avant.
      expect(newCalls).toBeLessThanOrEqual(oldCalls)
      expect(newBytes).toBeLessThanOrEqual(oldBytes)
    }
    // #3 : sur une chaîne resume, la re-injection (TÂCHE + Brain + acquis) n'est envoyée QU'UNE fois
    // au lieu de N. Note informative (le contexte Brain live n'est pas mesurable ici).
    // eslint-disable-next-line no-console
    console.log(
      '\n=== Gain structurel (déterministe, hors A/B live) ===\n' +
        rows.join('\n') +
        `\nsystème constant (discipline+style) = ${CONSTANT_SYSTEM} o / phase évitée` +
        '\n#3 resume : re-injection TÂCHE+Brain+acquis = 1× au lieu de N (magnitude Brain → A/B live)\n'
    )
    // Le cas trivial DOIT réduire strictement (sinon la proportionnalité n'apporte rien).
    expect(regimePhases('corrige la typo').length).toBeLessThan(OLD_PHASES.length)
  })
})
