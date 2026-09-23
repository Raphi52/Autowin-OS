import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { messagesDepuisTranscriptClaude, scannerSessionsClaudeExe } from './import-claude-exe'
import { ConversationStore } from './conversations'

/**
 * Import des conversations de claude.exe (demande du 2026-09-22) : « importe toutes mes
 * conversations active et inactive que j'ai dans claude.exe et reproduit le systeme de conv
 * active/inactive ».
 *
 * Sources REELLES verifiees sur le poste : les transcripts vivent dans
 * `~/.claude/projects/<cwd encode>/<sessionId>.jsonl` et portent `"entrypoint":"claude-desktop"`
 * sur leurs lignes user ; les sessions OUVERTES posent un verrou `~/.claude/sessions/<pid>.json`
 * qui porte `pid`, `procStart` (FILETIME Windows) et le nom du fil. Statut actif = verrou dont le
 * processus est VIVANT et dont le demarrage correspond (un PID reutilise n'est pas la meme
 * session). Tout est LU, jamais ecrit : `~/.claude` appartient a claude.exe.
 *
 * fix-ok: les editions successives sont la construction incrementale de la suite (un cas par
 * comportement), pas une boucle de fix : le seul rouge volontaire est le test `desktop-released`
 * ecrit AVANT le correctif (rouge mesure : la session supprimee `aaa` importee a tort), passe au
 * vert par le filtre du scanner — 7/7 verts, exit 0.
 */

const dossiers: string[] = []

function racineFixture(): string {
  const racine = mkdtempSync(join(tmpdir(), 'autowin-claude-exe-'))
  dossiers.push(racine)
  mkdirSync(join(racine, 'projects'), { recursive: true })
  mkdirSync(join(racine, 'sessions'), { recursive: true })
  return racine
}

afterEach(() => {
  while (dossiers.length > 0) rmSync(dossiers.pop()!, { recursive: true, force: true })
})

function ligne(objet: Record<string, unknown>): string {
  return `${JSON.stringify(objet)}\n`
}

/** Transcript claude-desktop minimal : un tour user, une reponse, un tool_result (a ignorer). */
function transcriptDesktop(sessionId: string, cwd: string): string {
  return (
    ligne({
      type: 'user',
      entrypoint: 'claude-desktop',
      cwd,
      sessionId,
      uuid: `${sessionId}-u1`,
      timestamp: '2026-09-20T10:00:00.000Z',
      message: { role: 'user', content: 'Premier message du fil, qui sert de titre' }
    }) +
    ligne({
      type: 'assistant',
      sessionId,
      uuid: `${sessionId}-a1`,
      timestamp: '2026-09-20T10:00:05.000Z',
      message: { role: 'assistant', content: [{ type: 'text', text: 'Réponse du modèle' }] }
    }) +
    ligne({
      type: 'user',
      sessionId,
      uuid: `${sessionId}-u2`,
      timestamp: '2026-09-20T10:00:06.000Z',
      message: { role: 'user', content: [{ type: 'tool_result', content: 'sortie outil' }] }
    })
  )
}

function poserTranscript(
  racine: string,
  projet: string,
  sessionId: string,
  contenu: string
): string {
  const dossier = join(racine, 'projects', projet)
  mkdirSync(dossier, { recursive: true })
  const chemin = join(dossier, `${sessionId}.jsonl`)
  writeFileSync(chemin, contenu, 'utf8')
  return chemin
}

function poserVerrou(
  racine: string,
  pid: number,
  sessionId: string,
  extra: Record<string, unknown> = {}
): void {
  writeFileSync(
    join(racine, 'sessions', `${pid}.json`),
    JSON.stringify({
      pid,
      sessionId,
      cwd: 'C:\\Travaux\\demo',
      procStart: '134346257930615435',
      entrypoint: 'claude-desktop',
      name: 'Fil vivant nommé par claude.exe',
      status: 'idle',
      ...extra
    }),
    'utf8'
  )
}

describe('scannerSessionsClaudeExe — inventaire des fils de claude.exe', () => {
  it('retient les sessions claude-desktop, ignore les sessions sdk-cli, et lit titre/cwd', async () => {
    const racine = racineFixture()
    poserTranscript(racine, 'C--Travaux-demo', 'aaa', transcriptDesktop('aaa', 'C:\\Travaux\\demo'))
    poserTranscript(
      racine,
      'E--SOURCES-run',
      'bbb',
      ligne({
        type: 'user',
        entrypoint: 'sdk-cli',
        sessionId: 'bbb',
        timestamp: '2026-09-20T11:00:00.000Z',
        message: { role: 'user', content: 'run interne autowin' }
      })
    )
    const sessions = await scannerSessionsClaudeExe({
      racines: [racine],
      sondeDemarrage: async () => new Map()
    })
    expect(sessions.map((s) => s.sessionId)).toEqual(['aaa'])
    expect(sessions[0].titre).toBe('Premier message du fil, qui sert de titre')
    expect(sessions[0].cwd).toBe('C:\\Travaux\\demo')
    expect(sessions[0].statut).toBe('inactive')
    expect(sessions[0].createdAt).toBe(Date.parse('2026-09-20T10:00:00.000Z'))
  })

  it('marque ACTIVE la session dont le verrou pointe un processus vivant au même démarrage, et prend son nom', async () => {
    const racine = racineFixture()
    poserTranscript(racine, 'C--Travaux-demo', 'aaa', transcriptDesktop('aaa', 'C:\\Travaux\\demo'))
    poserVerrou(racine, 100, 'aaa')
    const sessions = await scannerSessionsClaudeExe({
      racines: [racine],
      sondeDemarrage: async (pids) =>
        new Map(pids.filter((p) => p === 100).map((p) => [p, '134346257930615435']))
    })
    expect(sessions[0].statut).toBe('active')
    expect(sessions[0].titre).toBe('Fil vivant nommé par claude.exe')
  })

  it('écarte les sessions SUPPRIMÉES dans claude.exe (marqueur <id>.desktop-released.json, reason delete)', async () => {
    const racine = racineFixture()
    // Forme REELLE observée sur le poste le 2026-09-23 (12 marqueurs, tous reason "delete") :
    // { "v": 1, "releasedAt": "2026-09-11T08:40:03.503Z", "reason": "delete" }
    poserTranscript(racine, 'C--Travaux-demo', 'aaa', transcriptDesktop('aaa', 'C:\\Travaux\\demo'))
    poserTranscript(racine, 'C--Travaux-demo', 'bbb', transcriptDesktop('bbb', 'C:\\Travaux\\demo'))
    poserTranscript(racine, 'C--Travaux-demo', 'ccc', transcriptDesktop('ccc', 'C:\\Travaux\\demo'))
    writeFileSync(
      join(racine, 'projects', 'C--Travaux-demo', 'aaa.desktop-released.json'),
      JSON.stringify({ v: 1, releasedAt: '2026-09-11T08:40:03.503Z', reason: 'delete' }),
      'utf8'
    )
    // Marqueur ILLISIBLE : il ne décide rien — la session reste importée (cohérent avec les verrous).
    writeFileSync(
      join(racine, 'projects', 'C--Travaux-demo', 'bbb.desktop-released.json'),
      '{oops',
      'utf8'
    )
    const sessions = await scannerSessionsClaudeExe({
      racines: [racine],
      sondeDemarrage: async () => new Map()
    })
    expect(sessions.map((s) => s.sessionId).sort()).toEqual(['bbb', 'ccc'])
  })

  it('un PID réutilisé (démarrage différent) ou mort rend le verrou périmé : session INACTIVE', async () => {
    const racine = racineFixture()
    poserTranscript(racine, 'C--Travaux-demo', 'aaa', transcriptDesktop('aaa', 'C:\\Travaux\\demo'))
    poserVerrou(racine, 100, 'aaa')
    const reemploi = await scannerSessionsClaudeExe({
      racines: [racine],
      sondeDemarrage: async (pids) => new Map(pids.map((p) => [p, '999999999999999999']))
    })
    expect(reemploi[0].statut).toBe('inactive')
    const mort = await scannerSessionsClaudeExe({
      racines: [racine],
      sondeDemarrage: async () => new Map()
    })
    expect(mort[0].statut).toBe('inactive')
  })
})

describe('messagesDepuisTranscriptClaude — lecture A LA DEMANDE du fil complet', () => {
  it('rend les tours user/assistant, ignore les tool_result sans texte', async () => {
    const racine = racineFixture()
    const chemin = poserTranscript(
      racine,
      'C--Travaux-demo',
      'aaa',
      transcriptDesktop('aaa', 'C:\\Travaux\\demo')
    )
    const messages = await messagesDepuisTranscriptClaude(chemin)
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant'])
    expect(messages[0].content).toBe('Premier message du fil, qui sert de titre')
    expect(messages[1].content).toBe('Réponse du modèle')
    expect(messages[0].ts).toBe(Date.parse('2026-09-20T10:00:00.000Z'))
  })
})

describe('ConversationStore.importerSessionsClaudeExe — upsert idempotent', () => {
  const session = (statut: 'active' | 'inactive') => ({
    sessionId: 'aaa',
    transcriptPath: 'C:\\Users\\x\\.claude\\projects\\C--Travaux-demo\\aaa.jsonl',
    titre: 'Premier message du fil',
    cwd: 'C:\\Travaux\\demo',
    statut,
    createdAt: 1000,
    updatedAt: 2000
  })

  it('crée la conversation au premier import (provider claude, dossier = cwd, messages vides)', () => {
    const store = new ConversationStore(() => 5000)
    const bilan = store.importerSessionsClaudeExe([session('inactive')])
    expect(bilan.creees).toBe(1)
    const conv = store.list().find((c) => c.claudeExe?.sessionId === 'aaa')
    expect(conv).toBeDefined()
    expect(conv!.provider).toBe('claude')
    expect(conv!.messages).toEqual([])
    expect(conv!.projectPath).toBe('C:\\Travaux\\demo')
    expect(conv!.claudeExe!.statut).toBe('inactive')
  })

  it('ré-import : rien de créé, statut rafraîchi, titre renommé par l’utilisateur PRÉSERVÉ', () => {
    const store = new ConversationStore(() => 5000)
    store.importerSessionsClaudeExe([session('inactive')])
    const conv = store.list().find((c) => c.claudeExe?.sessionId === 'aaa')!
    store.rename(conv.id, 'Mon titre à moi')
    const bilan = store.importerSessionsClaudeExe([session('active')])
    expect(bilan.creees).toBe(0)
    expect(bilan.statutsMisAJour).toBe(1)
    const relue = store.list().find((c) => c.claudeExe?.sessionId === 'aaa')!
    expect(relue.id).toBe(conv.id)
    expect(relue.claudeExe!.statut).toBe('active')
    expect(relue.title).toBe('Mon titre à moi')
    expect(store.list().filter((c) => c.claudeExe?.sessionId === 'aaa')).toHaveLength(1)
  })
})
