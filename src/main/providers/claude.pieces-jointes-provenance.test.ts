import { basename } from 'node:path'
import { describe, expect, it } from 'vitest'
import { materializeClaudeAttachments } from './claude'
import type { Attachment } from './types'

/**
 * UNE capture envoyee, « Je regarde tes deux captures » en reponse.
 *
 * Vecu en conv-150, tour 1bf1ae63-adb7-47be-ba4e-5c65c5593851 (saisie ts 1791620688803,
 * 2026-10-10) : l'utilisateur joint UNE image ; le prompt du tour (session
 * eceabf8f-c2d3-472c-9e7d-bf103d5839c2) listait sous un seul titre « PIÈCES JOINTES FOURNIES PAR
 * L'UTILISATEUR » deux fichiers nommes tous deux `image.png` — la sienne et celle de son PREMIER
 * message, rejointe d'office. La provenance ne tenait qu'a un suffixe entre parentheses ; le
 * modele a compte deux captures avant meme de les ouvrir.
 */
const image = (name: string, provenance?: Attachment['provenance']): Attachment => ({
  name,
  mimeType: 'image/png',
  size: 3,
  kind: 'image',
  content: 'YWJj',
  ...(provenance ? { provenance } : {})
})

describe('materializeClaudeAttachments — provenance des pieces jointes', () => {
  it('compte a part la piece du message courant et celle d un tour anterieur', async () => {
    const m = materializeClaudeAttachments([
      image('image.png'),
      image('image.png (jointe a un message precedent)', 'message-precedent')
    ])
    const [courante, ancienne] = m.paths
    const coupe = m.promptSuffix.indexOf('TOUR ANTÉRIEUR')
    expect(m.promptSuffix).toContain('PIÈCES JOINTES DE TON MESSAGE CI-DESSUS (1)')
    expect(coupe).toBeGreaterThan(0)
    // La piece courante est AVANT le rappel, l'ancienne APRES : jamais dans la meme liste.
    expect(m.promptSuffix.indexOf(courante)).toBeLessThan(coupe)
    expect(m.promptSuffix.indexOf(ancienne)).toBeGreaterThan(coupe)
    // Le chemin lui-meme porte la provenance : un modele qui ne lit que les chemins la voit aussi.
    expect(basename(ancienne)).toMatch(/tour-precedent/)
    expect(basename(courante)).not.toMatch(/tour-precedent/)
    await m.cleanup()
  })

  it('dit qu aucune piece n est jointe au message quand seules des anciennes sont rappelees', async () => {
    const m = materializeClaudeAttachments([
      image('image.png (jointe a un message precedent)', 'message-precedent')
    ])
    expect(m.promptSuffix).toContain('Ton message ci-dessus n’a AUCUNE pièce jointe')
    expect(m.promptSuffix).not.toContain('PIÈCES JOINTES DE TON MESSAGE CI-DESSUS (')
    await m.cleanup()
  })
})
