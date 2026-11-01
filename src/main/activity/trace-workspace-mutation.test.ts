import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExecutionEvidence } from '../providers/types'
import * as preuves from '../providers/workspace-mutation-evidence'
import {
  attendreEcrituresDesTraces,
  readConversationFileTraces
} from './conversation-file-trace-spool'
import { appendCallMutationTraces, appendWorkspaceMutationTrace } from './trace-workspace-mutation'

vi.mock('../providers/workspace-mutation-evidence', async (importOriginal) => {
  const reel = await importOriginal<typeof import('../providers/workspace-mutation-evidence')>()
  return {
    ...reel,
    captureWorkspaceMutationSnapshot: vi.fn(reel.captureWorkspaceMutationSnapshot)
  }
})

const photos = vi.mocked(preuves.captureWorkspaceMutationSnapshot)
const dossiers: string[] = []

function dossierTemporaire(prefixe: string): string {
  const dossier = mkdtempSync(join(tmpdir(), prefixe))
  dossiers.push(dossier)
  return dossier
}

function depot(fichiers: readonly string[]): string {
  const repo = dossierTemporaire('autowin-trace-fin-appel-')
  const git = (...args: string[]): void => {
    execFileSync('git', args, { cwd: repo, stdio: 'ignore' })
  }
  git('init', '-q')
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'Test')
  git('config', 'core.autocrlf', 'false')
  for (const fichier of fichiers) writeFileSync(join(repo, fichier), 'depart\n')
  git('add', '-A')
  git('commit', '-qm', 'depart')
  return repo
}

const edition = (path: string, extra: Partial<ExecutionEvidence> = {}): ExecutionEvidence => ({
  type: 'Edit',
  kind: 'mutation',
  status: 'completed',
  ok: true,
  summary: `Edit ${path}`,
  path,
  ...extra
})

const commande = (command: string): ExecutionEvidence => ({
  type: 'Bash',
  kind: 'other',
  status: 'completed',
  ok: true,
  summary: `Bash ${command}`,
  command
})

async function tracesDuFil(base: string, conversationId: string) {
  await attendreEcrituresDesTraces()
  return readConversationFileTraces(conversationId, base)
}

beforeEach(() => {
  photos.mockClear()
})

afterEach(() => {
  for (const dossier of dossiers.splice(0)) rmSync(dossier, { recursive: true, force: true })
})

/**
 * LE SPINNER D'UN LOT TOURNAIT ENCORE APRÈS SA RÉPONSE (conv-1379, 2026-10-31).
 *
 * Lot 1/3 : 76 modifications, 70 s entre sa dernière réponse et l'arrêt du spinner ; Lot 3/3 : 164
 * modifications, 81 s. Chaque modification reprenait une photo complète du dépôt (887 ms pour les
 * 206 fichiers modifiés de D:/AutoWinOS), alors qu'elles sont toutes prises APRÈS la fin de l'appel
 * et voient donc le même état. Une photo par dossier suffit, quel que soit le nombre d'écritures.
 */
describe('fin d’appel — une seule photo du dépôt pour toutes les écritures', () => {
  it('12 écritures d’un même dossier : une seule photo, 12 traces', async () => {
    const fichiers = Array.from({ length: 10 }, (_, rang) => `f${rang}.ts`)
    const repo = depot(fichiers)
    const base = dossierTemporaire('autowin-trace-base-')
    for (const fichier of fichiers) writeFileSync(join(repo, fichier), `modifie ${fichier}\n`)
    writeFileSync(join(repo, 'genere.txt'), 'par commande\n')

    await appendCallMutationTraces(
      {
        conversationId: 'conv-lot',
        turnId: 'tour-lot',
        workspaceRoot: repo,
        evidence: [
          ...fichiers.map((fichier) => edition(fichier)),
          edition('f0.ts'),
          commande('echo x > genere.txt')
        ]
      },
      base
    )

    expect(photos).toHaveBeenCalledTimes(1)
    expect(await tracesDuFil(base, 'conv-lot')).toHaveLength(12)
  })

  it('rend les mêmes traces qu’écriture par écriture', async () => {
    const repo = depot(['a.ts', 'b.ts'])
    const base = dossierTemporaire('autowin-trace-base-')
    writeFileSync(join(repo, 'a.ts'), 'modifie\n')
    writeFileSync(join(repo, 'b.ts'), 'modifie\n')

    await appendWorkspaceMutationTrace(
      {
        conversationId: 'conv-unitaire',
        workspaceRoot: repo,
        source: 'chat_tool',
        paths: ['a.ts'],
        pathLineFingerprints: { 'a.ts': ['ligne-a'] }
      },
      base
    )
    await appendWorkspaceMutationTrace(
      {
        conversationId: 'conv-unitaire',
        workspaceRoot: repo,
        source: 'chat_tool',
        paths: ['b.ts'],
        nommeParCommande: true
      },
      base
    )
    await appendCallMutationTraces(
      {
        conversationId: 'conv-appel',
        workspaceRoot: repo,
        evidence: [
          edition('a.ts', { writtenLineFingerprints: ['ligne-a'] }),
          commande('echo x > b.ts')
        ]
      },
      base
    )

    const sansDate = (traces: Awaited<ReturnType<typeof tracesDuFil>>) =>
      traces
        .map(({ timestamp: _date, conversationId: _fil, ...trace }) => trace)
        .sort((a, b) => a.paths[0]!.localeCompare(b.paths[0]!))
    const parEcriture = sansDate(await tracesDuFil(base, 'conv-unitaire'))
    expect(parEcriture).toHaveLength(2)
    expect(parEcriture[0]?.pathFingerprints?.['a.ts']).toBeTruthy()
    expect(parEcriture[0]?.pathLineFingerprints).toEqual({ 'a.ts': ['ligne-a'] })
    expect(parEcriture[1]?.nommeParCommande).toBe(true)
    expect(sansDate(await tracesDuFil(base, 'conv-appel'))).toEqual(parEcriture)
  })

  it('un fichier sans aucun diff garde son empreinte', async () => {
    const repo = depot(['propre.ts'])
    const base = dossierTemporaire('autowin-trace-base-')

    await appendCallMutationTraces(
      { conversationId: 'conv-propre', workspaceRoot: repo, evidence: [edition('propre.ts')] },
      base
    )

    const [trace] = await tracesDuFil(base, 'conv-propre')
    expect(trace?.pathFingerprints?.['propre.ts']).toBeTruthy()
  })

  it('deux dossiers de travail : une photo chacun', async () => {
    const repoA = depot(['a.ts'])
    const repoB = depot(['b.ts'])
    const base = dossierTemporaire('autowin-trace-base-')

    await appendCallMutationTraces(
      {
        conversationId: 'conv-deux',
        workspaceRoot: repoA,
        evidence: [
          edition('a.ts'),
          edition('a.ts'),
          edition('b.ts', { workspaceRoot: repoB }),
          edition('b.ts', { workspaceRoot: repoB })
        ]
      },
      base
    )

    expect(photos).toHaveBeenCalledTimes(2)
    expect(await tracesDuFil(base, 'conv-deux')).toHaveLength(4)
  })

  it('aucune écriture réussie : aucune photo', async () => {
    const repo = depot(['a.ts'])
    const base = dossierTemporaire('autowin-trace-base-')

    await appendCallMutationTraces(
      {
        conversationId: 'conv-rien',
        workspaceRoot: repo,
        evidence: [edition('a.ts', { ok: false }), commande('git status')]
      },
      base
    )

    expect(photos).not.toHaveBeenCalled()
    expect(await tracesDuFil(base, 'conv-rien')).toHaveLength(0)
  })

  it('sans conversation : aucune photo', async () => {
    const repo = depot(['a.ts'])
    const base = dossierTemporaire('autowin-trace-base-')

    await appendCallMutationTraces({ workspaceRoot: repo, evidence: [edition('a.ts')] }, base)

    expect(photos).not.toHaveBeenCalled()
  })

  it('un chemin hors du dossier ne déclenche aucune photo', async () => {
    const repo = depot(['a.ts'])
    const base = dossierTemporaire('autowin-trace-base-')

    await appendCallMutationTraces(
      {
        conversationId: 'conv-hors',
        workspaceRoot: repo,
        evidence: [edition(join(dossierTemporaire('autowin-trace-ailleurs-'), 'x.ts'))]
      },
      base
    )

    expect(photos).not.toHaveBeenCalled()
    expect(await tracesDuFil(base, 'conv-hors')).toHaveLength(0)
  })

  it('rend les éditions du modèle, pas les fichiers nommés par une commande', async () => {
    const repo = depot(['a.ts'])
    mkdirSync(join(repo, 'Sous'))
    const base = dossierTemporaire('autowin-trace-base-')

    const editions = await appendCallMutationTraces(
      {
        conversationId: 'conv-editions',
        workspaceRoot: repo,
        evidence: [edition('Sous\\Fichier.ts'), commande('echo x > a.ts')]
      },
      base
    )

    expect([...editions]).toEqual(['sous/fichier.ts'])
  })
})

describe('appendWorkspaceMutationTrace — photo fournie', () => {
  it('une photo déjà prise n’est pas reprise', async () => {
    const repo = depot(['a.ts'])
    const base = dossierTemporaire('autowin-trace-base-')
    writeFileSync(join(repo, 'a.ts'), 'modifie\n')
    const apres = await preuves.captureWorkspaceMutationSnapshot(repo)
    photos.mockClear()

    await appendWorkspaceMutationTrace(
      {
        conversationId: 'conv-photo',
        workspaceRoot: repo,
        source: 'chat_tool',
        paths: ['a.ts'],
        after: apres
      },
      base
    )

    expect(photos).not.toHaveBeenCalled()
    const [trace] = await tracesDuFil(base, 'conv-photo')
    expect(trace?.pathFingerprints?.['a.ts']).toBe(apres.get('a.ts'))
  })
})
