import { describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  collectStdoutJournals,
  journauxReferencesParUneReservation,
  planJournalGc,
  type JournalEntry
} from './journal-gc'
import { loadOrchestrationStates, saveOrchestrationState } from './orchestration-state'
import { compileExecutionQuote } from '../execution-quote'

const NOW = 1_800_000_000_000
const VIEUX_DE_43_H = NOW - 43 * 60 * 60 * 1000

/**
 * CAUSE RACINE mesuree le 2026-09-06 sur `run-f668f46966fd-1` (conv-43).
 *
 * Le menage decidait par l'AGE seul. Il a donc supprime le `.stdout.jsonl` de l'agent `build` d'un
 * point de reprise encore vivant, dont la reservation d'appel n'etait pas soldee. Le sidecar
 * `.exit.json`, hors du menage, a survecu : le run est devenu insolvable et s'est rejoue rouge a
 * chaque demarrage. La protection ne peut pas venir de l'age — elle vient de la REFERENCE.
 */
describe('un journal reference par une reservation non soldee', () => {
  const entree = (path: string): JournalEntry => ({
    path,
    size: 900_000,
    modifiedMs: VIEUX_DE_43_H
  })

  it('n est pas supprime, meme inactif depuis 43 h et au-dela du plafond', () => {
    const protege = '/j/agent-build.stdout.jsonl'
    const autres = Array.from({ length: 4 }, (_, index) => entree(`/j/vieux-${index}.stdout.jsonl`))
    const plan = planJournalGc([entree(protege), ...autres], {
      nowMs: NOW,
      maxFiles: 1,
      protectedPaths: [protege]
    })
    expect(plan).not.toContain(protege)
    // Les autres, eux, partent bien : la protection ne desactive pas le menage.
    expect(plan.length).toBe(4)
  })

  it('reste protege quand son age depasse la fenetre de conservation', () => {
    const protege = '/j/agent-build.stdout.jsonl'
    const plan = planJournalGc(
      [{ path: protege, size: 900_000, modifiedMs: NOW - 30 * 86_400_000 }],
      {
        nowMs: NOW,
        protectedPaths: [protege]
      }
    )
    expect(plan).toEqual([])
  })

  it('recense les journaux a proteger depuis les points de reprise', () => {
    const reference = journauxReferencesParUneReservation([
      // Le cas conv-43 : non terminal, un appel actif, l'agent `build` encore declare actif.
      {
        usage: { activeCalls: 1 },
        agents: [
          { active: false, journalPath: 'E:\\d\\run-stdout\\frame.stdout.jsonl' },
          { active: true, journalPath: 'E:\\d\\run-stdout\\build.stdout.jsonl' }
        ]
      },
      // Run deja terminal : plus rien a proteger, son journal peut partir.
      {
        terminal: { status: 'interrupted' },
        usage: { activeCalls: 1 },
        agents: [{ active: true, journalPath: 'E:\\d\\run-stdout\\clos.stdout.jsonl' }]
      },
      // Aucun appel actif : plus aucune reservation a solder.
      {
        usage: { activeCalls: 0 },
        agents: [{ active: true, journalPath: 'E:\\d\\run-stdout\\solde.stdout.jsonl' }]
      }
    ])
    expect(reference).toEqual(['E:\\d\\run-stdout\\build.stdout.jsonl'])
  })

  it('un point de reprise ECRIT SUR DISQUE protege son journal du menage', () => {
    // Meme composition que le demarrage de l'app (`src/main/index.ts`) : les checkpoints reels
    // alimentent la liste des journaux a proteger, puis le menage tourne.
    const root = mkdtempSync(join(tmpdir(), 'gc-bout-en-bout-'))
    try {
      const stateRoot = join(root, 'run-state')
      const journalRoot = join(root, 'run-stdout')
      mkdirSync(journalRoot, { recursive: true })
      const attendu = join(journalRoot, 'agent-build.stdout.jsonl')
      const jetable = join(journalRoot, 'agent-oublie.stdout.jsonl')
      for (const path of [attendu, jetable]) {
        writeFileSync(path, 'x'.repeat(1000), 'utf8')
        utimesSync(path, new Date(VIEUX_DE_43_H), new Date(VIEUX_DE_43_H))
      }
      const quote = compileExecutionQuote('frame un truc parfait pour voir et modifier le CWD')
      saveOrchestrationState(stateRoot, {
        runId: 'run-verrou-fantome',
        task: 'Frame un truc parfait pour voir et modifier le CWD',
        phaseOutputs: [{ phase: 'frame', text: 'cadrage', agentToken: 'agent-frame' }],
        executionQuote: quote,
        usage: {
          quoteId: quote.id,
          startedAgents: 2,
          startedCalls: 3,
          completedCalls: 2,
          failedCalls: 0,
          activeCalls: 1,
          activeReservationIds: ['reservation-build'],
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          totalTokens: 0,
          freshTokens: 0,
          knownCostUsd: 0,
          unpricedCalls: 0,
          unmeteredCalls: 0,
          tokenCoverage: 'complete'
        },
        agents: [
          {
            token: 'agent-build',
            reservationId: 'reservation-build',
            provider: 'claude',
            phase: 'build',
            active: true,
            fanOut: false,
            journalPath: attendu
          }
        ],
        startedAt: 1,
        updatedAt: 2
      })

      const bilan = collectStdoutJournals(journalRoot, {
        nowMs: NOW,
        maxFiles: 0,
        protectedPaths: journauxReferencesParUneReservation(loadOrchestrationStates(stateRoot))
      })

      expect(existsSync(attendu)).toBe(true)
      expect(existsSync(jetable)).toBe(false)
      expect(bilan.removed).toBe(1)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('protege le fichier reel sur le disque, casse de lecteur comprise', () => {
    const root = mkdtempSync(join(tmpdir(), 'gc-reservation-'))
    try {
      const protege = join(root, 'agent-build.stdout.jsonl')
      const jetable = join(root, 'agent-vieux.stdout.jsonl')
      for (const path of [protege, jetable]) {
        writeFileSync(path, 'x'.repeat(1000), 'utf8')
        utimesSync(path, new Date(VIEUX_DE_43_H), new Date(VIEUX_DE_43_H))
      }
      const bilan = collectStdoutJournals(root, {
        nowMs: NOW,
        maxFiles: 0,
        // Meme chemin, casse differente : c'est ce que produit un checkpoint ecrit par un autre process.
        protectedPaths: [protege.toUpperCase()]
      })
      expect(existsSync(protege)).toBe(true)
      expect(existsSync(jetable)).toBe(false)
      expect(bilan.removed).toBe(1)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
