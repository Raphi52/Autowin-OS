import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { boardDuCollegue, creerLecteurDesCollegues, nomDuCollegue } from './board-collegues'

const dossiers: string[] = []
afterEach(() => {
  for (const d of dossiers.splice(0)) rmSync(d, { recursive: true, force: true })
})

function dossierDuBoard(): string {
  const d = mkdtempSync(join(tmpdir(), 'board-collegues-'))
  dossiers.push(d)
  return d
}

function postIt(conversationId: string, nom?: string): Record<string, unknown> {
  return {
    conversationId,
    titre: `Fil ${conversationId}`,
    projet: { cle: 'D:\\AutoWinOS', libelle: 'AutoWinOS' },
    etage: 'en-cours',
    etatPreuve: 'en-cours',
    derniereDemande: '2026-10-28T09:00:00.000Z',
    ...(nom ? { demandeur: { nom, email: `${nom}@ex.fr` } } : {}),
    demandes: [
      {
        rang: 0,
        titre: 'corrige le bouton',
        statut: 'en-cours',
        constat: 'tour en cours',
        date: '2026-10-28T09:00:00.000Z'
      }
    ]
  }
}

function ecrireBoard(dossier: string, poste: string, postIts: unknown[]): string {
  mkdirSync(join(dossier, poste), { recursive: true })
  const fichier = join(dossier, poste, 'board.json')
  writeFileSync(
    fichier,
    JSON.stringify({ format: 'autowin-board/1', poste, enregistreA: '2026-10-28T10:00:00Z', postIts })
  )
  return fichier
}

describe('boardDuCollegue — le fichier d’un autre poste est une donnée, contrôlée champ par champ', () => {
  it('garde les post-it bien formés et écarte les autres un à un', () => {
    const lu = boardDuCollegue(
      'jdupont',
      JSON.stringify({
        format: 'autowin-board/1',
        postIts: [
          postIt('conv-1', 'Jean Dupont'),
          { ...postIt('conv-2'), etage: 'n-importe-quoi' },
          { ...postIt('conv-3'), demandes: [] },
          'pas un post-it'
        ]
      })
    )
    expect(lu?.postIts.map((p) => p.conversationId)).toEqual(['conv-1'])
    expect(lu?.nom).toBe('Jean Dupont')
  })

  it('refuse un JSON cassé ou un autre format', () => {
    expect(boardDuCollegue('x', '{pas du json')).toBeNull()
    expect(boardDuCollegue('x', JSON.stringify({ format: 'autre/1', postIts: [] }))).toBeNull()
  })

  it('retire les caractères de contrôle et borne les textes', () => {
    const lu = boardDuCollegue(
      'x',
      JSON.stringify({
        format: 'autowin-board/1',
        postIts: [{ ...postIt('conv-1'), titre: `a\u0007b${'z'.repeat(5000)}` }]
      })
    )
    const titre = lu?.postIts[0].titre ?? ''
    expect(titre.startsWith('abz')).toBe(true)
    expect(titre.length).toBeLessThanOrEqual(4000)
  })

  it('nomme le collègue par son demandeur le plus fréquent, sinon par son compte', () => {
    const lu = boardDuCollegue(
      'jdupont',
      JSON.stringify({
        format: 'autowin-board/1',
        postIts: [postIt('conv-1', 'Jean'), postIt('conv-2', 'Jean D.'), postIt('conv-3', 'Jean')]
      })
    )
    expect(nomDuCollegue('jdupont', lu?.postIts ?? [])).toBe('Jean')
    expect(nomDuCollegue('jdupont', [])).toBe('jdupont')
  })
})

describe('creerLecteurDesCollegues — relit les AUTRES sous-dossiers du dossier du Board', () => {
  it('lit les collègues et jamais le sous-dossier de ce poste', async () => {
    const dossier = dossierDuBoard()
    ecrireBoard(dossier, 'raphael.vilain', [postIt('conv-9', 'Raphaël')])
    ecrireBoard(dossier, 'jdupont', [postIt('conv-1', 'Jean Dupont')])
    mkdirSync(join(dossier, 'vide'))
    const lecteur = creerLecteurDesCollegues({ dossier: () => dossier, poste: 'Raphael.Vilain' })
    const lu = await lecteur.lire()
    expect(lu.collegues.map((c) => c.poste)).toEqual(['jdupont'])
    expect(lu.collegues[0].nom).toBe('Jean Dupont')
    expect(lu.erreur).toBeUndefined()
  })

  it('sans dossier choisi, aucun collègue et aucune lecture', async () => {
    const lecteur = creerLecteurDesCollegues({ dossier: () => null, poste: 'moi' })
    expect(await lecteur.lire()).toEqual({ collegues: [] })
  })

  it('dit en clair un dossier injoignable, sans lever', async () => {
    const lecteur = creerLecteurDesCollegues({
      dossier: () => join(dossierDuBoard(), 'absent'),
      poste: 'moi'
    })
    const lu = await lecteur.lire()
    expect(lu.collegues).toEqual([])
    expect(lu.erreur).toMatch(/injoignable/)
  })

  it('nomme un Board illisible sans priver les autres', async () => {
    const dossier = dossierDuBoard()
    ecrireBoard(dossier, 'jdupont', [postIt('conv-1', 'Jean')])
    mkdirSync(join(dossier, 'casse'))
    writeFileSync(join(dossier, 'casse', 'board.json'), '{oups')
    const lu = await creerLecteurDesCollegues({ dossier: () => dossier, poste: 'moi' }).lire()
    expect(lu.collegues.map((c) => c.poste)).toEqual(['jdupont'])
    expect(lu.erreur).toContain('casse')
  })

  it('espace deux relectures, puis relit un fichier qui a changé', async () => {
    const dossier = dossierDuBoard()
    const fichier = ecrireBoard(dossier, 'jdupont', [postIt('conv-1', 'Jean')])
    let t = 0
    const lecteur = creerLecteurDesCollegues({
      dossier: () => dossier,
      poste: 'moi',
      maintenant: () => t,
      delaiMs: 1000
    })
    expect((await lecteur.lire()).collegues[0].postIts).toHaveLength(1)
    ecrireBoard(dossier, 'jdupont', [postIt('conv-1', 'Jean'), postIt('conv-2', 'Jean')])
    // Date de modification forcée : deux écritures dans la même milliseconde garderaient la même.
    utimesSync(fichier, new Date(), new Date(Date.now() + 5000))
    t = 500
    expect((await lecteur.lire()).collegues[0].postIts).toHaveLength(1)
    t = 2000
    expect((await lecteur.lire()).collegues[0].postIts).toHaveLength(2)
  })
})
