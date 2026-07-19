import { mkdtempSync, mkdirSync, writeFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { listSessions, parseSession, aggregateHabits, type SessionMeta } from './transcripts'

/** Fixture au format transcript Claude Code réel (types/champs relevés sur un vrai .jsonl). */
const LINES = [
  JSON.stringify({ type: 'mode', mode: 'x', sessionId: 's' }),
  JSON.stringify({
    type: 'user',
    timestamp: '2026-07-18T10:00:00Z',
    message: { content: 'corrige le bug du parseur' }
  }),
  JSON.stringify({
    type: 'assistant',
    timestamp: '2026-07-18T10:00:05Z',
    message: {
      content: [
        { type: 'text', text: 'Je lis la capture puis le code.' },
        {
          type: 'tool_use',
          name: 'Read',
          input: { file_path: 'C:\\tmp\\capture-inexistante.png' }
        },
        { type: 'tool_use', name: 'Bash', input: { command: 'npm test' } }
      ]
    }
  }),
  // bloc assistant consécutif SANS texte → regroupé dans le tour précédent
  JSON.stringify({
    type: 'assistant',
    timestamp: '2026-07-18T10:00:09Z',
    message: {
      content: [{ type: 'tool_use', name: 'Read', input: { file_path: 'C:\\code\\a.ts' } }]
    }
  }),
  // tool_result (événement user sans texte) → PAS un tour humain
  JSON.stringify({
    type: 'user',
    timestamp: '2026-07-18T10:00:10Z',
    message: { content: [{ type: 'tool_result', content: 'ok' }] }
  }),
  // sidechain (sous-agent)
  JSON.stringify({
    type: 'assistant',
    isSidechain: true,
    timestamp: '2026-07-18T10:00:12Z',
    message: { content: [{ type: 'text', text: 'exploration' }] }
  }),
  'ligne{corrompue' // tolérance : ignorée sans crash
]

const root = mkdtempSync(join(tmpdir(), 'aos-transcripts-'))
const projDir = join(root, 'C--Mon-Projet')
mkdirSync(projDir)
const file = join(projDir, 'abc-123.jsonl')
writeFileSync(file, LINES.join('\n'), 'utf8')

const meta: SessionMeta = {
  id: 'abc-123',
  project: 'C--Mon-Projet',
  path: file,
  sizeMb: 0,
  mtime: statSync(file).mtimeMs
}

afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('transcripts — parse streaming des sessions Claude Code', () => {
  it('liste les sessions par projet, triées par mtime', () => {
    const s = listSessions(10, root)
    expect(s).toHaveLength(1)
    expect(s[0].project).toBe('C--Mon-Projet')
    expect(s[0].id).toBe('abc-123')
  })

  it('extrait tours, tool calls, screenshots ; regroupe les blocs assistant ; ignore le corrompu', async () => {
    const a = await parseSession(meta)
    // 1 tour humain + 1 tour modèle (2 blocs regroupés) + 1 tour sidechain ; le tool_result n'est PAS un tour
    expect(a.turns).toHaveLength(3)
    expect(a.turns[0]).toMatchObject({ kind: 'user', text: 'corrige le bug du parseur' })
    expect(a.turns[1].kind).toBe('assistant')
    expect(a.turns[1].tools.map((t) => t.tool)).toEqual(['Read', 'Bash', 'Read'])
    expect(a.turns[2].sidechain).toBe(true)
    expect(a.toolCounts).toEqual({ Read: 2, Bash: 1 })
    expect(a.totalToolCalls).toBe(3)
    // screenshot consulté détecté, fichier disparu signalé
    expect(a.images).toHaveLength(1)
    expect(a.images[0].path).toMatch(/capture-inexistante\.png$/)
    expect(a.images[0].exists).toBe(false)
  })

  it('cache par mtime : re-parse évité sur transcript inchangé', async () => {
    const first = await parseSession(meta)
    const second = await parseSession(meta)
    expect(second).toBe(first) // même objet = cache hit
  })

  it('agrège les habitudes de tools sur les sessions récentes', async () => {
    const h = await aggregateHabits(10, root)
    expect(h.sessionsScanned).toBe(1)
    expect(h.tools[0]).toEqual({ tool: 'Read', count: 2 })
    expect(h.imagesConsulted).toBe(1)
  })

  it('racine absente → liste vide, pas de crash', () => {
    expect(listSessions(10, join(root, 'nexiste-pas'))).toEqual([])
  })
})
