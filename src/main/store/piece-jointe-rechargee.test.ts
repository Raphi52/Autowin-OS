import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  chatArtifactRoot,
  materializeUserImageArtifact,
  rechargerContenuPieceJointe
} from './chat-artifact-store'

/**
 * Une image d'un tour passe doit survivre a un REDEMARRAGE.
 *
 * Le binaire est deja persiste a l'envoi, mais n'etait jamais relu : un fil rouvert ne portait plus
 * que la vignette, et le modele lisait une image degradee. Ces tests couvrent le chainon manquant
 * ET ses refus — un chemin hors du store ne doit JAMAIS etre lu.
 */
describe('rechargerContenuPieceJointe', () => {
  const base = () => mkdtempSync(join(tmpdir(), 'autowin-store-test-'))
  const IMAGE = Buffer.from('89504e470d0a1a0a-faux-png', 'utf8').toString('base64')

  it('rend le binaire ORIGINAL persiste a l envoi', () => {
    const racine = base()
    const artifact = materializeUserImageArtifact(
      { name: 'bandes.png', mimeType: 'image/png', size: 24, content: IMAGE },
      'conv-42',
      'turn-1',
      racine
    )
    // Le fil rehydrate ne porte QUE la metadonnee : ni `content`, ni rien d'autre du binaire.
    const rendu = rechargerContenuPieceJointe({ mimeType: 'image/png', artifact }, racine)
    expect(rendu?.content).toBe(IMAGE)
    expect(rendu?.mimeType).toBe('image/png')
  })

  it('REFUSE un chemin hors du store d artefacts', () => {
    const racine = base()
    mkdirSync(chatArtifactRoot(racine), { recursive: true })
    const dehors = join(racine, 'secret.png')
    writeFileSync(dehors, Buffer.from(IMAGE, 'base64'))
    expect(
      rechargerContenuPieceJointe(
        {
          mimeType: 'image/png',
          artifact: {
            id: 'forge',
            name: 'secret.png',
            mimeType: 'image/png',
            kind: 'image',
            size: 24,
            createdAt: 1,
            path: dehors,
            source: { provider: 'user' }
          }
        },
        racine
      )
    ).toBeUndefined()
  })

  it('rend undefined sans jamais jeter quand l artefact manque ou est ecarte', () => {
    const racine = base()
    expect(rechargerContenuPieceJointe({ mimeType: 'image/png' }, racine)).toBeUndefined()
    const artifact = materializeUserImageArtifact(
      { name: 'x.png', mimeType: 'image/png', size: 24, content: IMAGE },
      'conv-42',
      'turn-1',
      racine
    )
    // Marquee indisponible a l envoi : on ne tente pas de la ressusciter.
    expect(
      rechargerContenuPieceJointe({ artifact, originalUnavailable: true }, racine)
    ).toBeUndefined()
    // Trop volumineuse pour un prompt : la vignette reste le bon compromis.
    expect(rechargerContenuPieceJointe({ artifact }, racine, 4)).toBeUndefined()
  })
})
