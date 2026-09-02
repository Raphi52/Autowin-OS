import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/** Corpus minimal : 1 conversation, 2 tours, des evenements d'orchestration reels. */
function corpus() {
  const data = mkdtempSync(join(tmpdir(), 'rendement-'))
  mkdirSync(join(data, 'activity'), { recursive: true })
  writeFileSync(
    join(data, 'conversations.json'),
    JSON.stringify([
      {
        id: 'conv-1',
        title: 'test',
        messages: [
          { role: 'user', content: 'fais X', ts: 1000 },
          { role: 'assistant', content: 'ok', ts: 1100, turnId: 'T1' },
          { role: 'user', content: 'toujours pas', ts: 2000 },
          { role: 'assistant', content: 'ok', ts: 2100, turnId: 'T2' }
        ]
      }
    ])
  )
  const lignes = [
    { ts: new Date(1050).toISOString(), kind: 'exec', label: 'subagent', costUsd: 1, turnId: 'T1' },
    { ts: new Date(1060).toISOString(), kind: 'judge', label: 'judge', costUsd: 2, turnId: 'T1' },
    { ts: new Date(2050).toISOString(), kind: 'gate', label: 'gate', costUsd: 3, turnId: 'T2' },
    { ts: new Date(2060).toISOString(), kind: 'chat', label: 'chat', costUsd: 4, turnId: 'T2' },
    // Evenement ARRIVE en retard (apres le tour suivant) mais qui appartient au tour 1 :
    // seul `turnId` peut le rattacher correctement, l'heure le mettrait sur le tour 2.
    { ts: new Date(2500).toISOString(), kind: 'exec', label: 'subagent', costUsd: 5, turnId: 'T1' }
  ]
  writeFileSync(
    join(data, 'activity', 'conv-1.jsonl'),
    lignes.map((l) => JSON.stringify(l)).join('\n') + '\n'
  )
  return data
}

function rapport(data) {
  const out = execFileSync(
    process.execPath,
    ['scripts/scout-rendement.mjs', '--data', data, '--json'],
    {
      encoding: 'utf8'
    }
  )
  return JSON.parse(out)
}

describe('scout-rendement — colonne orchestrations et rattachement des tours', () => {
  it('compte les etapes d orchestration reellement ecrites (exec, judge, gate)', () => {
    const r = rapport(corpus())
    expect(r.rows[0].orchestrations).toBe(4)
  })

  it('rattache une depense a son tour par turnId, pas par l heure', () => {
    const r = rapport(corpus())
    const tours = r.rows[0].tours_detail
    expect(tours[0].coutUsd).toBe(8)
    expect(tours[1].coutUsd).toBe(7)
  })
})
