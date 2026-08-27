import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  porteDesPiecesJointes,
  referencesDesPiecesJointes
} from './store/pieces-jointes-orchestration'

/**
 * PRINCIPE : ce qu'une conversation contient, un lecteur peut l'atteindre.
 *
 * Test delibere de l'utilisateur le 2026-08-27 : image jointe dans une conversation, question posee
 * depuis une AUTRE. La knowledge ne traversait pas — la lecture rendait le texte et jetait les
 * pieces jointes. Ces tests portent sur la fonction UNIQUE que tous les chemins de lecture empruntent.
 */
describe('omniscience inter-conversation — references des pieces jointes', () => {
  const fichierReel = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'autowin-omni-'))
    const chemin = join(dir, 'user-image-abc.png')
    writeFileSync(chemin, Buffer.from('faux-png'))
    return chemin
  }

  it('rend un chemin LISIBLE pour une piece jointe dont l original est sur le disque', () => {
    const chemin = fichierReel()
    const refs = referencesDesPiecesJointes({
      attachments: [
        {
          name: 'bandes.png',
          mimeType: 'image/png',
          size: 8,
          artifact: {
            id: 'user-image-abc',
            name: 'bandes.png',
            mimeType: 'image/png',
            kind: 'image',
            size: 8,
            createdAt: 1,
            path: chemin,
            source: { provider: 'user' }
          }
        }
      ]
    } as never)
    expect(refs).toEqual([
      { name: 'bandes.png', mimeType: 'image/png', size: 8, chemin }
    ])
  })

  it('DIT qu une piece jointe est indisponible plutot que de la taire', () => {
    const refs = referencesDesPiecesJointes({
      attachments: [
        { name: 'perdue.png', mimeType: 'image/png', size: 8 },
        {
          name: 'ecartee.png',
          mimeType: 'image/png',
          size: 8,
          originalUnavailable: true,
          artifact: {
            id: 'x',
            name: 'ecartee.png',
            mimeType: 'image/png',
            kind: 'image',
            size: 8,
            createdAt: 1,
            path: fichierReel(),
            source: { provider: 'user' }
          }
        }
      ]
    } as never)
    expect(refs.map((r) => [r.name, r.indisponible === true, r.chemin])).toEqual([
      ['perdue.png', true, undefined],
      ['ecartee.png', true, undefined]
    ])
  })

  it('un chemin annonce mais absent du disque compte comme indisponible', () => {
    const refs = referencesDesPiecesJointes(
      {
        attachments: [
          {
            name: 'fantome.png',
            artifact: {
              id: 'x',
              name: 'fantome.png',
              mimeType: 'image/png',
              kind: 'image',
              size: 8,
              createdAt: 1,
              path: 'C:/nexiste/pas.png',
              source: { provider: 'user' }
            }
          }
        ]
      } as never,
      () => false
    )
    expect(refs[0]?.indisponible).toBe(true)
    expect(refs[0]?.chemin).toBeUndefined()
  })

  it('porteDesPiecesJointes repere un fil a ouvrir, et ignore un fil purement textuel', () => {
    expect(porteDesPiecesJointes([{ attachments: [{ name: 'a.png' }] }] as never)).toBe(true)
    expect(porteDesPiecesJointes([{}, { attachments: [] }] as never)).toBe(false)
  })
})
