import { describe, expect, it } from 'vitest'
import { extensionPourType, nomDeFichierPourPieceJointe } from './claude'

/**
 * Un fichier sans extension VALIDE est lu en octets, pas en image.
 *
 * Mesure du 2026-08-27, dite par l'app elle-meme : « le seul chemin lisible (…png (miniature)
 * (jointe a un message precedent)) est retourne en octets JPEG bruts, pas en image affichable ».
 * Les libelles humains doivent donc rester dans le prompt et sortir du nom de fichier.
 */
describe('nom de fichier d une piece jointe materialisee', () => {
  it('retire les libelles et met l extension du TYPE reel', () => {
    expect(
      nomDeFichierPourPieceJointe('bandes-test.png (miniature) (jointe a un message precedent)', 'image/jpeg')
    ).toBe('bandes-test.jpg')
    expect(nomDeFichierPourPieceJointe('capture.png (miniature)', 'image/png')).toBe('capture.png')
    expect(nomDeFichierPourPieceJointe('rapport.pdf', 'application/pdf')).toBe('rapport.pdf')
  })

  it('garde l extension du nom quand le type est inconnu, et ne rend jamais un nom vide', () => {
    expect(nomDeFichierPourPieceJointe('notes.md', 'text/markdown')).toBe('notes.md')
    expect(nomDeFichierPourPieceJointe('(miniature)', 'image/png')).toBe('fichier.png')
    expect(nomDeFichierPourPieceJointe('sans-extension', '')).toBe('sans-extension')
  })

  it('deduit l extension du type avant celle du nom — le type fait foi', () => {
    // Le cas exact du defaut : une MINIATURE jpeg portant un nom en .png.
    expect(extensionPourType('image/jpeg', 'x.png')).toBe('.jpg')
    expect(extensionPourType('', 'x.PNG')).toBe('.png')
    expect(extensionPourType('', 'x')).toBe('')
  })
})
