import { mkdtempSync, mkdirSync, writeFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  listSessionsAsync,
  parseSession,
  readSessionForImport,
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

  // fix-ok: cause mesurée des éditions répétées — test écrit ROUGE d'abord (fonction absente :
  // « readSessionForImport is not a function »), puis le shell (heredoc) a mangé les antislashs
  // des chemins Windows attendus (E:\Projet) : assertion rouge alors que la valeur REÇUE était
  // correcte ; échappements restaurés → vert, puis `eslint --fix` (mise en forme l.212).
  it('readSessionForImport rend le PLEIN TEXTE, le titre et le dossier de travail dominant', async () => {
    const long = 'x'.repeat(600) // bien au-dessus de TEXT_CAP (280) : prouve l'absence de troncature
    const importLines = [
      JSON.stringify({ type: 'queue-operation', operation: 'enqueue', content: 'pas un message' }),
      JSON.stringify({ type: 'summary', summary: 'Titre de repli' }),
      JSON.stringify({ type: 'custom-title', customTitle: 'SWLG v2  : Recherche' }),
      // meta → sauté, même filtre que parseSession ; son cwd ne compte pas
      JSON.stringify({
        type: 'user',
        isMeta: true,
        timestamp: '2026-09-17T09:06:16.000Z',
        cwd: 'C:\\Scratch',
        message: { content: 'caveat meta' }
      }),
      JSON.stringify({
        type: 'user',
        timestamp: '2026-09-17T09:06:20.000Z',
        cwd: 'C:\\Scratch',
        message: { content: 'première question' }
      }),
      JSON.stringify({
        type: 'assistant',
        timestamp: '2026-09-17T09:06:25.000Z',
        cwd: 'E:\\Projet',
        message: {
          content: [
            { type: 'text', text: long },
            { type: 'tool_use', name: 'Read', input: { file_path: 'C:\\code\\a.ts' } }
          ]
        }
      }),
      // tool_result (événement user sans texte) → pas un message, mais son cwd compte
      JSON.stringify({
        type: 'user',
        timestamp: '2026-09-17T09:06:27.000Z',
        cwd: 'E:\\Projet',
        message: { content: [{ type: 'tool_result', content: 'ok' }] }
      }),
      // bloc assistant CONSÉCUTIF (même tour vécu) → fusionné dans le message précédent
      JSON.stringify({
        type: 'assistant',
        timestamp: '2026-09-17T09:06:30.000Z',
        cwd: 'E:\\Projet',
        message: { content: [{ type: 'text', text: 'suite du même tour' }] }
      }),
      // sidechain = sous-agent : ses « user » ne sont pas les mots de l'utilisateur
      JSON.stringify({
        type: 'user',
        isSidechain: true,
        timestamp: '2026-09-17T09:06:40.000Z',
        cwd: 'E:\\Projet',
        message: { content: 'prompt de sous-agent' }
      }),
      JSON.stringify({
        type: 'user',
        timestamp: '2026-09-17T09:07:00.000Z',
        cwd: 'E:\\Projet',
        message: { content: 'seconde question' }
      }),
      'ligne{corrompue'
    ]
    // Dossier À PART : ne pas polluer l'inventaire que les tests de listing comptent.
    const importDir = mkdtempSync(join(tmpdir(), 'aos-transcripts-import-'))
    const importFile = join(importDir, 'import-1.jsonl')
    writeFileSync(importFile, importLines.join('\n'), 'utf8')

    const t = await readSessionForImport(importFile)

    expect(t.title).toBe('SWLG v2  : Recherche') // custom-title l'emporte sur summary
    expect(t.cwd).toBe('E:\\Projet') // dominant (3 occurrences) contre C:\Scratch (1, hors meta)
    expect(t.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user'])
    expect(t.messages[0]).toMatchObject({
      content: 'première question',
      ts: Date.parse('2026-09-17T09:06:20.000Z')
    })
    // plein texte : aucun « … » à 280 caractères, et les deux blocs du tour sont réunis
    expect(t.messages[1].content).toBe(`${long}\n\nsuite du même tour`)
    expect(t.messages[1].ts).toBe(Date.parse('2026-09-17T09:06:25.000Z'))
    expect(t.messages[2].content).toBe('seconde question')
  })

  it('readSessionForImport sans custom-title : le dernier summary sert de titre', async () => {
    const fallbackFile = join(
      mkdtempSync(join(tmpdir(), 'aos-transcripts-import-')),
      'import-2.jsonl'
    )
    writeFileSync(
      fallbackFile,
      [
        JSON.stringify({ type: 'summary', summary: 'Résumé de session' }),
        JSON.stringify({
          type: 'user',
          timestamp: '2026-09-17T10:00:00.000Z',
          message: { content: 'bonjour' }
        })
      ].join('\n'),
      'utf8'
    )
    const t = await readSessionForImport(fallbackFile)
    expect(t.title).toBe('Résumé de session')
    expect(t.messages).toHaveLength(1)
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
