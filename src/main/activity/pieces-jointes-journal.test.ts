import { describe, expect, it } from 'vitest'
import { remplacerContenuJoint } from './pieces-jointes-journal'

const image = 'iVBORw0KGgo'.repeat(400_000) // ~4,4 Mo, comme une capture de conv-331

describe('remplacerContenuJoint', () => {
  it('retire le base64 d une image jointe (rejeu conv-331)', () => {
    const appel = {
      messages: [
        {
          role: 'user',
          content: 'ETAT DE L APP',
          attachments: [{ name: 'image.png', mimeType: 'image/png', kind: 'image', content: image }]
        }
      ]
    }
    const ligne = JSON.stringify(appel, remplacerContenuJoint)
    expect(ligne.length).toBeLessThan(500)
    expect(ligne).toContain('image.png')
    expect(ligne).toContain('piece jointe non journalisee')
  })

  it('garde intacts le texte du message et une piece jointe texte', () => {
    const long = 'x'.repeat(10_000)
    const appel = {
      content: long,
      attachments: [{ name: 'a.md', mimeType: 'text/markdown', content: long }]
    }
    expect(JSON.parse(JSON.stringify(appel, remplacerContenuJoint))).toEqual(appel)
  })
})
