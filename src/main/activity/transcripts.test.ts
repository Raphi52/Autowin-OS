import { mkdtempSync, mkdirSync, writeFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  listSessionsAsync,
  parseSession,
  resolveListedSessionAsync,
  resolveListedSessionImage,
  type SessionMeta
} from './transcripts'

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
const unreferencedImage = join(root, 'secret.png')
writeFileSync(unreferencedImage, 'not exposed merely because the extension is valid', 'utf8')

const meta: SessionMeta = {
  id: 'abc-123',
  project: 'C--Mon-Projet',
  path: file,
  sizeMb: 0,
  mtime: statSync(file).mtimeMs
}

afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('transcripts — parse streaming des sessions Claude Code', () => {
  it('liste les sessions par projet, triées par mtime', async () => {
    const s = await listSessionsAsync(10, root, 0)
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

  it('racine absente → liste vide, pas de crash', async () => {
    await expect(listSessionsAsync(10, join(root, 'nexiste-pas'), 0)).resolves.toEqual([])
  })

  it('résout sessions et images depuis l’inventaire serveur, jamais depuis un chemin forgé', async () => {
    await expect(
      resolveListedSessionAsync({ id: 'abc-123', project: 'C--Mon-Projet' }, 10, root)
    ).resolves.toMatchObject({ path: file })
    await expect(
      resolveListedSessionAsync({ id: 'inconnue', project: 'C--Mon-Projet' }, 10, root)
    ).resolves.toBeNull()
    await expect(
      resolveListedSessionImage(
        { id: 'abc-123', project: 'C--Mon-Projet' },
        unreferencedImage,
        10,
        root
      )
    ).resolves.toBeNull()
  })

  it('keeps the async inventory bounded and reuses its short-lived cache', async () => {
    const asyncRoot = mkdtempSync(join(tmpdir(), 'aos-transcripts-async-'))
    try {
      const project = join(asyncRoot, 'project')
      mkdirSync(project)
      const { utimesSync } = await import('node:fs')
      for (let index = 0; index < 5; index += 1) {
        const candidate = join(project, `session-${index}.jsonl`)
        writeFileSync(candidate, '{}', 'utf8')
        const timestamp = new Date(Date.now() + index * 1_000)
        utimesSync(candidate, timestamp, timestamp)
      }

      const first = await listSessionsAsync(2, asyncRoot, 60_000)
      expect(first.map((session) => session.id)).toEqual(['session-4', 'session-3'])

      writeFileSync(join(project, 'session-new.jsonl'), '{}', 'utf8')
      expect(await listSessionsAsync(2, asyncRoot, 60_000)).toEqual(first)
      expect(
        await resolveListedSessionAsync({ id: 'session-new', project: 'project' }, 10, asyncRoot)
      ).toMatchObject({ id: 'session-new' })
    } finally {
      rmSync(asyncRoot, { recursive: true, force: true })
    }
  })
})
