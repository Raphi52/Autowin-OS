import { describe, expect, it } from 'vitest'
import { CostAggregator } from './dashboards/cost'
import { Orchestrator, type RunWorktrees } from './orchestrator'
import { ProviderRegistry } from './providers/registry'
import type {
  Message,
  ProviderAdapter,
  SendOptions,
  SendResult,
  StreamChunk
} from './providers/types'
import { RoleModelConfig } from './roles'
import { TrustLedger } from './trust/ledger'
import type { PipelinePhase } from './skill-pipeline'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * LE GATE JUGE UN RUN SUR LES PHASES QU'IL JOUE, PAS SUR LA PHRASE DE L'UTILISATEUR.
 *
 * Defaut vecu le 2026-08-18 : une demande limitee a la phase FRAME a rendu un livrable complet et
 * l'application a affiche « Workflow BLOQUE par le gate — livrable non valide · statut failed ».
 * `rootExecutionRequirements(task)` derivait `commit: true` du seul TEXTE (« ... publie un
 * commit »), et le gate exigeait une identite Git d'un run qui n'ecrit pas une ligne de code.
 *
 * LA REGRESSION QUI MENACE ICI N'EST PAS « le gate ne bloque plus ce run-la », C'EST « le gate ne
 * bloque plus rien » : desarmer la garde en croyant la corriger. Chaque cas ci-dessous est donc
 * SYMETRIQUE — le meme texte, le meme provider, les memes preuves ; seul le programme de phases
 * change, et le run qui comporte `build` doit TOUJOURS etre bloque.
 */
class ProviderDeTest implements ProviderAdapter {
  readonly id = 'gate-phases'
  readonly supportsExecution = true
  async auth(): Promise<boolean> {
    return true
  }
  // AUCUN `yield` a dessein : ce double simule un provider qui repond SANS streamer, ce que le
  // contrat `AsyncGenerator` autorise -- le consommateur recoit `{done:true, value}` des le premier
  // `next()`. La regle existe pour attraper un `yield` OUBLIE ; ici il n'y en a jamais eu.
  // eslint-disable-next-line require-yield
  async *send(
    _m: Message[],
    _options: SendOptions = {}
  ): AsyncGenerator<StreamChunk, SendResult, void> {
    // Dernier appel = le juge : il VALIDE, donc rien d'autre que le gate ne peut rougir le run.
    return {
      text: 'VALIDE',
      provider: this.id,
      systemInjected: false,
      executionEvidence: [
        { type: 'file_change', kind: 'mutation', status: 'completed', ok: true, summary: 'm' },
        {
          type: 'command_execution',
          kind: 'verification',
          status: 'completed',
          ok: true,
          exitCode: 0,
          summary: 'npm test',
          command: 'npm test'
        }
      ]
    }
  }
}

/**
 * Bureaux isoles STUB : `end` rend `merged` — le travail est donc integre, et la SEULE chose qui
 * manque au run est l'identite Git publiee. C'est exactement le fait que le gate commit teste.
 */
const bureau = mkdtempSync(join(tmpdir(), 'aos-gate-phases-'))
const bureaux: RunWorktrees = {
  begin: () => bureau,
  end: () => ({ outcome: 'merged', files: ['a.ts'] })
}

/** Bureaux dont le travail N'EST PAS fusionne : c'est le gate d'INTEGRATION qui est exerce ici. */
const bureauxNonFusionnes: RunWorktrees = {
  begin: () => bureau,
  end: () => ({ outcome: 'kept', files: ['a.ts'] })
}

function orchestrateur(phases: PipelinePhase[], worktrees: RunWorktrees = bureaux): Orchestrator {
  const provider = new ProviderDeTest()
  return new Orchestrator({
    registry: new ProviderRegistry().register(provider),
    roles: new RoleModelConfig({
      subagent: { provider: provider.id, model: 'worker' },
      judge: { provider: provider.id, model: 'judge' }
    }),
    cost: new CostAggregator(),
    trust: new TrustLedger(),
    executionWorkspace: process.cwd(),
    classifyPhases: () => [...phases],
    worktrees
  })
}

// Le texte reclame explicitement une mutation, des tests ET un commit.
const DEMANDE = 'Traite ce candidat : corrige le bug, lance les tests et publie un commit.'

describe('gate de cloture — croise avec les phases programmees', () => {
  it.each<[PipelinePhase[]]>([[['frame']], [['scout']], [['terrain']]])(
    'un run sans phase build n est plus bloque pour un commit qu il ne peut pas produire : %s',
    async ([...phases]) => {
      const resultat = await orchestrateur(phases).run(DEMANDE)
      expect(resultat.gateReasons.join(' | ')).not.toMatch(/identite Git/i)
      expect(resultat.gateReasons.join(' | ')).not.toMatch(/integration locale non terminee/i)
    }
  )

  it.each<[PipelinePhase[]]>([[['build']], [['frame', 'build']]])(
    'LE TEST SYMETRIQUE — un run AVEC build qui ne publie rien reste BLOQUE : %s',
    async ([...phases]) => {
      const resultat = await orchestrateur(phases).run(DEMANDE)
      expect(resultat.gateBlocked).toBe(true)
      expect(resultat.gateReasons.join(' | ')).toMatch(/identite Git/i)
      expect(resultat.valid).toBe(false)
    }
  )
})

describe("gate d'integration — croise avec les phases programmees", () => {
  it.each<[PipelinePhase[]]>([[['frame']], [['scout']], [['terrain']]])(
    "un run sans phase build n a rien a integrer : %s",
    async ([...phases]) => {
      const resultat = await orchestrateur(phases, bureauxNonFusionnes).run(DEMANDE)
      expect(resultat.gateReasons.join(' | ')).not.toMatch(/int.gration locale non termin.e/i)
    }
  )

  it.each<[PipelinePhase[]]>([[['build']], [['frame', 'build']]])(
    'LE TEST SYMETRIQUE — un run AVEC build dont le travail n est pas fusionne reste BLOQUE : %s',
    async ([...phases]) => {
      const resultat = await orchestrateur(phases, bureauxNonFusionnes).run(DEMANDE)
      expect(resultat.gateBlocked).toBe(true)
      expect(resultat.gateReasons.join(' | ')).toMatch(/int.gration locale non termin.e/i)
    }
  )
})
