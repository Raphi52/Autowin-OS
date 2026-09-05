import { describe, expect, it } from 'vitest'
import { basculeDeDossierRequise } from './bascule-dossier-conversation'

describe('basculeDeDossierRequise', () => {
  const existe = (): boolean => true
  const AUTOWIN = 'D:\\AutoWinOS'

  it('demande la bascule quand la conversation est rangee dans un AUTRE depot', () => {
    expect(basculeDeDossierRequise('D:\\RIGApplication', AUTOWIN, existe)).toBe(
      'D:\\RIGApplication'
    )
  })

  it('ne bascule pas quand la conversation vise le dossier deja actif', () => {
    expect(basculeDeDossierRequise(AUTOWIN, AUTOWIN, existe)).toBeNull()
  })

  /** Sans cette garde, deux graphies du meme dossier relanceraient l'app en boucle sous Windows. */
  it('ignore la casse et la barre finale, sinon le redemarrage boucle', () => {
    expect(basculeDeDossierRequise('d:\\autowinos\\', AUTOWIN, existe)).toBeNull()
  })

  it('ne bascule pas sur une conversation non rangee', () => {
    expect(basculeDeDossierRequise(undefined, AUTOWIN, existe)).toBeNull()
    expect(basculeDeDossierRequise('   ', AUTOWIN, existe)).toBeNull()
  })

  /** Un rangement peut n'etre qu'un LIBELLE de classement : basculer dessus casserait tout. */
  it('ne bascule pas sur un simple libelle de rangement', () => {
    expect(basculeDeDossierRequise('Clients/Amitel', AUTOWIN, existe)).toBeNull()
  })

  it('ne bascule pas vers un dossier qui n existe plus sur le disque', () => {
    expect(basculeDeDossierRequise('D:\\Disparu', AUTOWIN, () => false)).toBeNull()
  })
})
