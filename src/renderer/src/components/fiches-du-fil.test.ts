import { describe, expect, it } from 'vitest'
import {
  corpsDeLaFiche,
  demanderFicheAOuvrir,
  reclamerFicheAOuvrir,
  runDeLaFiche
} from './fiches-du-fil'

describe('fiches du fil (conv-1441)', () => {
  it('une fiche devient une entrée que le panneau déplie comme un run', () => {
    expect(
      runDeLaFiche({
        chemin: 'D:/d/demandes/conv-1/a/RUN.md',
        conversationId: 'conv-1',
        titre: 'Ajoute un tri',
        statut: 'prouve',
        maj: 42,
        demandes: 2
      })
    ).toEqual({
      subject: 'Ajoute un tri',
      session: 'conv-1',
      path: 'D:/d/demandes/conv-1/a/RUN.md',
      mtime: 42,
      summary: { status: 'prouve', dodTotal: 0, dodChecked: 0, journalEvents: 0, defauts: 0 }
    })
  })

  it('le corps lisible commence après l’en-tête technique', () => {
    expect(corpsDeLaFiche('status: prouve\r\nsession: conv-1\r\n\r\n## Besoin\r\nX\r\n')).toBe(
      '## Besoin\nX\n'
    )
    expect(corpsDeLaFiche('sans en-tête')).toBe('sans en-tête')
  })

  it('la demande du Board ne sert qu’une fois, et seulement au fil visé', () => {
    demanderFicheAOuvrir('conv-2', 'D:/f/RUN.md')
    expect(reclamerFicheAOuvrir('conv-1')).toBeNull()
    expect(reclamerFicheAOuvrir('conv-2')).toBe('D:/f/RUN.md')
    expect(reclamerFicheAOuvrir('conv-2')).toBeNull()
  })
})
