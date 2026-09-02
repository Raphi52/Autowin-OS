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

/** Corpus dedie aux REPRISES : un vrai retour negatif, et un « non » ADJECTIF a ne pas compter. */
function corpusReprises() {
  const data = mkdtempSync(join(tmpdir(), 'rendement-rep-'))
  mkdirSync(join(data, 'activity'), { recursive: true })
  writeFileSync(
    join(data, 'conversations.json'),
    JSON.stringify([
      {
        id: 'conv-1',
        title: 'test',
        messages: [
          { role: 'user', content: '/salvage 5 travaux non publies vivent sur une branche', ts: 1000 },
          { role: 'user', content: 'Regarde le fichier non suivi X et dis-moi ce qu il teste', ts: 2000 },
          { role: 'user', content: 'non, refais : ca marche pas', ts: 3000 }
        ]
      }
    ])
  )
  writeFileSync(join(data, 'activity', 'conv-1.jsonl'), '')
  return data
}

function rapportTexte(data) {
  return execFileSync(process.execPath, ['scripts/scout-rendement.mjs', '--data', data], {
    encoding: 'utf8'
  })
}

describe('scout-rendement — compteur de reprises auditable', () => {
  it('ne compte pas le « non » ADJECTIF au milieu d une phrase (faux positif mesure : 20 sur 27)', () => {
    const r = rapport(corpusReprises())
    expect(r.summary.reprises).toBe(1)
    expect(r.rows[0].tours_detail.filter((t) => t.reprise).map((t) => t.index)).toEqual([3])
  })

  it('expose l expression qui a declenche le comptage, pour que le chiffre soit verifiable', () => {
    const r = rapport(corpusReprises())
    const tour = r.rows[0].tours_detail[2]
    // Le premier marqueur du tableau qui matche gagne : ici « ca marche pas », pas le « non ».
    expect(tour.extraitReprise.length).toBeGreaterThan(0)
    expect(tour.demande.toLowerCase()).toContain(tour.extraitReprise.toLowerCase())
    expect(tour.marqueurReprise).not.toBe('')
  })

  it('liste les tours comptes dans le rapport, et le total de la section egale le compteur', () => {
    const texte = rapportTexte(corpusReprises())
    expect(texte).toContain('## Tours comptes comme REPRISE — 1 tour(s)')
    expect(texte).toContain('| conv-1 | #3 |')
  })
})
