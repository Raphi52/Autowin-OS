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

/**
 * Corpus des DEUX faux positifs mesures : un mot-marqueur qui nomme l'OBJET du travail, et un
 * marqueur sur le PREMIER tour — celui-ci ne peut rien reprendre, rien ne le precede.
 * Les tours 4 et 5 portent les MEMES mots employes en reproche : ils doivent rester comptes.
 */
function corpusFauxPositifs() {
  const data = mkdtempSync(join(tmpdir(), 'rendement-fp-'))
  mkdirSync(join(data, 'activity'), { recursive: true })
  writeFileSync(
    join(data, 'conversations.json'),
    JSON.stringify([
      {
        id: 'conv-1',
        title: 'test',
        messages: [
          // Tour 1 : marqueur NU (aucune contre-epreuve ne l'ecarte) — seule la borne du premier
          // tour peut l'empecher de compter. Retirer la borne rend ce test rouge.
          { role: 'user', content: 'Regarde mieux le rapport joint et dis-moi ce qui cloche', ts: 1000 },
          { role: 'user', content: 'Corrige le faux vert D2 dans les palettes', ts: 2000 },
          { role: 'user', content: 'Refais le controle : les runs sont-ils finis ?', ts: 3000 },
          { role: 'user', content: 'c est faux, le compteur affiche 27', ts: 4000 },
          { role: 'user', content: 'refais, ca ne donne rien', ts: 5000 }
        ]
      }
    ])
  )
  writeFileSync(join(data, 'activity', 'conv-1.jsonl'), '')
  return data
}

describe('scout-rendement — le marqueur seul ne prouve pas la reprise', () => {
  const comptes = (r) => r.rows[0].tours_detail.filter((t) => t.reprise).map((t) => t.index)

  it('ne compte JAMAIS le premier tour : rien ne le precede, il ne reprend rien', () => {
    const r = rapport(corpusFauxPositifs())
    expect(r.rows[0].tours_detail[0].reprise).toBe(false)
    expect(comptes(r)).not.toContain(1)
  })

  it('ne compte pas un mot-marqueur qui nomme l objet du travail (« le faux vert », « Refais le controle »)', () => {
    const r = rapport(corpusFauxPositifs())
    expect(r.rows[0].tours_detail[1].reprise).toBe(false)
    expect(r.rows[0].tours_detail[2].reprise).toBe(false)
  })

  it('garde les MEMES mots employes en reproche (« c est faux », « refais, » nu)', () => {
    const r = rapport(corpusFauxPositifs())
    expect(comptes(r)).toEqual([4, 5])
    expect(r.summary.reprises).toBe(2)
  })
})

/**
 * Contre-epreuve lue PAR OCCURRENCE — defaut nomme par le juge du banc arena du 2026-09-08 :
 * testee sur le message ENTIER, une seule mention de l'objet faisait taire un reproche present
 * ailleurs dans la meme phrase, donc la correction des faux positifs creait des faux NEGATIFS.
 */
function corpusDoubleEmploi() {
  const data = mkdtempSync(join(tmpdir(), 'rendement-occ-'))
  mkdirSync(join(data, 'activity'), { recursive: true })
  writeFileSync(
    join(data, 'conversations.json'),
    JSON.stringify([
      {
        id: 'conv-1',
        title: 'test',
        messages: [
          { role: 'user', content: 'analyse la sonde de rendement', ts: 1000 },
          { role: 'user', content: 'le faux positif est corrige mais ton total est faux', ts: 2000 },
          { role: 'user', content: 'refais-le, et refais le tri aussi tant que tu y es', ts: 3000 },
          { role: 'user', content: 'liste les faux departs de la semaine', ts: 4000 }
        ]
      }
    ])
  )
  writeFileSync(join(data, 'activity', 'conv-1.jsonl'), '')
  return data
}

describe('scout-rendement — la contre-epreuve ne vaut que pour l occurrence qu elle couvre', () => {
  it('compte le reproche meme si le meme mot nomme un objet ailleurs dans le message', () => {
    const r = rapport(corpusDoubleEmploi())
    const tours = r.rows[0].tours_detail
    expect(tours[1].reprise).toBe(true) // « ton total est faux » : predicatif, donc reproche
    expect(tours[2].reprise).toBe(true) // « refais-le » : anaphorique, donc reproche
  })

  it('ecarte encore le mot employe SEULEMENT comme objet du travail', () => {
    const r = rapport(corpusDoubleEmploi())
    expect(r.rows[0].tours_detail[3].reprise).toBe(false) // « les faux departs »
  })

  it('rend le champ d audit avec les DEUX moities de la regle (motif + contre-epreuve)', () => {
    const r = rapport(corpusDoubleEmploi())
    expect(r.rows[0].tours_detail[1].marqueurReprise).toContain('sauf')
    expect(r.rows[0].tours_detail[1].extraitReprise).toBe('faux')
  })
})
