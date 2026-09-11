import { describe, expect, it } from 'vitest'
import { depotCiteDansLeMessage } from './depot-cite-dans-le-message'

const ACTIF = 'D:\\AutoWinOS'

/** Faux disque : seuls les chemins listes existent. */
const disque = (...presents: string[]) => {
  const set = new Set(presents.map((p) => p.toLowerCase()))
  return (chemin: string) => set.has(chemin.toLowerCase())
}

describe('depotCiteDansLeMessage', () => {
  it('rend la racine du depot cite quand elle differe du dossier actif', () => {
    const existe = disque('D:\\Projets\\Rig', 'D:\\Projets\\Rig\\.git', 'D:\\Projets\\Rig\\src')
    expect(depotCiteDansLeMessage('corrige D:\\Projets\\Rig\\src stp', ACTIF, existe)).toBe(
      'D:\\Projets\\Rig'
    )
  })

  it('ignore la ponctuation collee au chemin', () => {
    const existe = disque('D:\\Projets\\Rig', 'D:\\Projets\\Rig\\.git')
    expect(depotCiteDansLeMessage('va dans D:\\Projets\\Rig.', ACTIF, existe)).toBe(
      'D:\\Projets\\Rig'
    )
  })

  it('ne bascule pas quand le depot cite EST deja le dossier actif', () => {
    const existe = disque(ACTIF, `${ACTIF}\\.git`)
    expect(depotCiteDansLeMessage(`lis ${ACTIF}`, ACTIF, existe)).toBeNull()
  })

  it('ne bascule pas sur un chemin qui n existe pas sur ce poste', () => {
    expect(depotCiteDansLeMessage('ouvre D:\\Nimporte\\Quoi', ACTIF, disque())).toBeNull()
  })

  it('ne bascule pas sur un dossier sans depot git', () => {
    const existe = disque('D:\\Docs', 'D:\\Docs\\note.md')
    expect(depotCiteDansLeMessage('lis D:\\Docs\\note.md', ACTIF, existe)).toBeNull()
  })

  it('ne DEVINE pas depuis un simple nom de projet', () => {
    const existe = disque('D:\\Projets\\Rig', 'D:\\Projets\\Rig\\.git')
    expect(depotCiteDansLeMessage('faut regarder le projet Rig', ACTIF, existe)).toBeNull()
  })

  it('accepte un partage reseau', () => {
    const existe = disque('\\\\ged2\\rig\\Brain', '\\\\ged2\\rig\\Brain\\.git')
    expect(depotCiteDansLeMessage('va dans \\\\ged2\\rig\\Brain', ACTIF, existe)).toBe(
      '\\\\ged2\\rig\\Brain'
    )
  })
})
