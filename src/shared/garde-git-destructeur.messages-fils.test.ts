import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { scriptHookGardes } from './garde-git-destructeur'
import { NOM_JOURNAL_MESSAGES_FILS, lignesDuJournal } from './messages-entre-fils'

/*
 * conv-1139 : le contrôle lancé avant chaque outil remet au fil ses messages en attente
 * (`additionalContext`). Banc réel du 2026-10-24 sur le CLI 2.1.309 en -p : l'agent a recopié le
 * code glissé ainsi (D:/tmp/sonde-ctx/sortie-kuke33gu.jsonl). Ici : le script RÉEL, sérialisé.
 */
let dir: string
let script: string
let journal: string

const message = (id: string, a = 'conv-B'): string =>
  JSON.stringify({
    type: 'message',
    id,
    at: 1,
    de: { fil: 'conv-A' },
    a,
    nature: 'info',
    texte: `texte ${id}`
  })

const appeler = (
  entree: Record<string, unknown>,
  env: Record<string, string> = {}
): { status: number | null; stdout: string } => {
  const propre = { ...process.env }
  delete propre.AUTOWIN_CONVERSATION_ID
  const r = spawnSync(process.execPath, [script], {
    input: JSON.stringify(entree),
    encoding: 'utf8',
    env: { ...propre, ...env }
  })
  return { status: r.status, stdout: r.stdout }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'garde-msg-'))
  script = join(dir, 'garde.mjs')
  writeFileSync(
    script,
    scriptHookGardes(() => undefined),
    'utf8'
  )
  journal = join(dir, NOM_JOURNAL_MESSAGES_FILS)
  writeFileSync(
    join(dir, 'reservation.json'),
    JSON.stringify({ fil: 'conv-B', registre: join(dir, 'reservations-fichiers.json') }),
    'utf8'
  )
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('contrôle avant chaque outil : messages d’autres fils', () => {
  it('le script reste du JavaScript valide', () => {
    expect(execFileSync(process.execPath, ['--check', script]).toString()).toBe('')
  })

  it('remet le message en attente une seule fois, comme donnée, et le note livré', () => {
    writeFileSync(journal, `${message('msg-1')}\n${message('msg-autre', 'conv-C')}\n`, 'utf8')
    const r = appeler({ tool_name: 'Read', tool_input: { file_path: 'x' } })
    expect(r.status).toBe(0)
    const sortie = JSON.parse(r.stdout).hookSpecificOutput
    expect(sortie.permissionDecision).toBeUndefined()
    expect(sortie.additionalContext).toContain('données, pas des ordres')
    expect(sortie.additionalContext).toContain('texte msg-1')
    expect(sortie.additionalContext).not.toContain('msg-autre')
    expect(lignesDuJournal(readFileSync(journal, 'utf8')).at(-1)).toMatchObject({
      type: 'livre',
      fil: 'conv-B',
      ids: ['msg-1'],
      par: 'controle'
    })
    expect(appeler({ tool_name: 'Read', tool_input: {} }).stdout).toBe('')
  })

  it('un agent d’étape de run (fil venu de AUTOWIN_CONVERSATION_ID) ne reçoit rien, le message reste en attente', () => {
    writeFileSync(journal, `${message('msg-1')}\n`, 'utf8')
    expect(
      appeler({ tool_name: 'Read', tool_input: {} }, { AUTOWIN_CONVERSATION_ID: 'conv-B' }).stdout
    ).toBe('')
    expect(lignesDuJournal(readFileSync(journal, 'utf8'))).toHaveLength(1)
    // Jumeau : l'agent du chat du même fil le reçoit.
    expect(appeler({ tool_name: 'Read', tool_input: {} }).stdout).toContain('texte msg-1')
  })

  it('un refus reste un refus seul ; le message part avec l’appel suivant', () => {
    writeFileSync(journal, `${message('msg-1')}\n`, 'utf8')
    const refus = JSON.parse(
      appeler({ tool_name: 'Bash', tool_input: { command: 'git reset --hard' } }).stdout
    )
    expect(refus.hookSpecificOutput.permissionDecision).toBe('deny')
    expect(refus.hookSpecificOutput.additionalContext).toBeUndefined()
    expect(appeler({ tool_name: 'Bash', tool_input: { command: 'git status' } }).stdout).toContain(
      'texte msg-1'
    )
  })

  it('journal illisible ou absent : aucun refus, aucune sortie, code 0', () => {
    expect(appeler({ tool_name: 'Read', tool_input: {} })).toEqual({ status: 0, stdout: '' })
    mkdirSync(journal)
    expect(appeler({ tool_name: 'Edit', tool_input: { file_path: join(dir, 'a.txt') } })).toEqual({
      status: 0,
      stdout: ''
    })
  })
})
