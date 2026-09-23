// fix-ok: les mocks initiaux envoyaient des chemins relatifs, masquant le cas reel mesure (chemin absolu rendu par le modele) ; le test reprend la forme reelle observee.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { configureAutowinAppDataBase, ensureAutowinAppData } from './app-data'
import { AppCommandBus } from './commands'
import { AgentPilot } from './agent-pilot'
import { ConversationStore } from './store/conversations'
import {
  readConversationFileTraces,
  readCurrentConversationPathOwnership
} from './activity/conversation-file-trace-spool'
import type { Message, SendOptions, SendResult } from './providers/types'

/**
 * JOURNAL DES FICHIERS — l'onglet Fichiers ne montre qu'un fichier TRACÉ par la conversation.
 * Seule `edit_file` écrivait la trace : create/move/delete_file et les Edit/Write natifs du chat
 * restaient invisibles (conv-804). Échoue si un de ces sites d'appel n'écrit plus sa trace.
 */
function depot(): string {
  const ws = mkdtempSync(join(tmpdir(), 'autowin-journal-ws-'))
  execFileSync('git', ['init', '-q'], { cwd: ws })
  execFileSync(
    'git',
    ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init'],
    { cwd: ws }
  )
  return ws
}

function bus(workspace: string): AppCommandBus {
  let horloge = 1000
  return new AppCommandBus(
    {
      conversations: new ConversationStore(() => horloge++),
      executionWorkspace: workspace,
      getWorktreeRuntimeStatus: () => ({ available: false, workspacePath: workspace }),
      getWorktreeConflictDiff: async () => ({ available: false, reason: 'not-conflict' })
    } as never,
    () => undefined
  )
}

describe('journal des fichiers : mutations de l’agent du chat', () => {
  afterEach(() => configureAutowinAppDataBase(undefined))

  it('trace create/move/delete_file avec empreinte, et rien pour une commande refusée', async () => {
    const data = mkdtempSync(join(tmpdir(), 'autowin-journal-data-'))
    configureAutowinAppDataBase(data)
    const base = ensureAutowinAppData()
    const ws = depot()
    const b = bus(ws)
    await b.exec('create_file', { path: 'neuf.ts', content: 'x\n' }, 'conv-j', undefined, 't1')
    await b.exec('move_file', { from: 'neuf.ts', to: 'dep.ts' }, 'conv-j', undefined, 't2')
    writeFileSync(join(ws, 'jetable.ts'), 'y')
    await b.exec('delete_file', { path: 'jetable.ts' }, 'conv-j', undefined, 't3')
    await b.exec('create_file', { path: '../evade.ts', content: 'x' }, 'conv-j', undefined, 't4')

    const traces = readConversationFileTraces('conv-j', base)
    expect(traces.map((t) => [t.turnId, t.source, t.paths])).toEqual([
      ['t1', 'file_command', ['neuf.ts']],
      ['t2', 'file_command', ['neuf.ts', 'dep.ts']],
      ['t3', 'file_command', ['jetable.ts']]
    ])
    expect(traces[0].pathFingerprints?.['neuf.ts']).toMatch(/^[0-9a-f]{64}$/)
    expect(readCurrentConversationPathOwnership('conv-j', base).map((o) => o.path)).toContain(
      'dep.ts'
    )
  })

  it('trace un Edit/Write natif du modèle du chat', async () => {
    const data = mkdtempSync(join(tmpdir(), 'autowin-journal-data-'))
    configureAutowinAppDataBase(data)
    const base = ensureAutowinAppData()
    const ws = depot()
    writeFileSync(join(ws, 'ecrit.ts'), 'export const a = 1\n')
    mkdirSync(join(ws, 'sous'), { recursive: true })
    writeFileSync(join(ws, 'sous', 'delta.ts'), 'x\n')
    const registry = {
      send: vi.fn(
        async (_p: string, _m: Message[], _o: SendOptions): Promise<SendResult> =>
          ({
            text: 'Fichier écrit.',
            provider: 'claude',
            systemInjected: true,
            executionEvidence: [
              {
                type: 'Write',
                kind: 'mutation',
                status: 'completed',
                ok: true,
                summary: 'Write',
                // Forme EXACTE émise par providers/claude.ts (tool_result) : `path` = file_path brut
                // (absolu), `paths` = relatif au cwd du CLI.
                path: join(ws, 'ecrit.ts'),
                paths: ['ecrit.ts'],
                writtenLineFingerprints: ['a'.repeat(64)]
              },
              {
                // Forme EXACTE de providers/workspace-mutation-evidence.ts : relatifs + workspaceRoot.
                type: 'workspace_delta',
                kind: 'mutation',
                status: 'completed',
                ok: true,
                summary: '1 fichier(s) modifié(s)',
                paths: ['sous/delta.ts'],
                workspaceRoot: ws
              },
              {
                type: 'Edit',
                kind: 'mutation',
                status: 'failed',
                ok: false,
                summary: 'Edit',
                path: join(ws, 'rate.ts')
              }
            ]
          }) as SendResult
      ),
      describePrompt: vi.fn(() => ({ provider: 'claude', messages: [], transport: 'test' }))
    }
    const roles = { getBinding: vi.fn(() => ({ provider: 'claude', model: 'm' })) }
    const commandBus = {
      catalog: vi.fn(() => []),
      snapshotForPrompt: vi.fn(async () => ({})),
      exec: vi.fn()
    }
    const pilot = new AgentPilot(
      registry as never,
      roles as never,
      commandBus as never,
      undefined,
      undefined,
      () => ws
    )
    await pilot.chat(
      [{ role: 'user', content: 'écris' }],
      () => undefined,
      undefined,
      2,
      'conv-chat',
      undefined,
      undefined,
      undefined,
      'turn-chat'
    )

    const traces = readConversationFileTraces('conv-chat', base)
    expect(traces.map((t) => [t.turnId, t.source, t.paths])).toEqual([
      ['turn-chat', 'chat_tool', ['ecrit.ts']],
      ['turn-chat', 'chat_tool', ['sous/delta.ts']]
    ])
    expect(traces[0].pathFingerprints?.['ecrit.ts']).toMatch(/^[0-9a-f]{64}$/)
    // Mesuré en réel (Write du CLI Claude) : les empreintes de lignes arrivaient sous le chemin
    // ABSOLU, donc sous une clé que `paths` ne contient pas.
    expect(traces[0].pathLineFingerprints).toEqual({ 'ecrit.ts': ['a'.repeat(64)] })
    // Une autre conversation ne voit rien ; la propriété revient bien à conv-chat.
    expect(readConversationFileTraces('conv-autre', base)).toEqual([])
    expect(readCurrentConversationPathOwnership('conv-chat', base).map((o) => o.path)).toContain(
      'ecrit.ts'
    )
  })
})
