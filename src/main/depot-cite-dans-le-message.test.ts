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

  it('ne bascule pas vers un depot git IMBRIQUE dans le depot de travail actuel', () => {
    // Mesure du 2026-09-28 (conv-770) : la consigne de reprise citait un depot jetable range sous
    // .autowin-data ; la conversation est partie travailler DEDANS, puis a rebascule au tour suivant.
    const jetable = `${ACTIF}\\.autowin-data\\essai-garde`
    const existe = disque(ACTIF, `${ACTIF}\\.git`, jetable, `${jetable}\\.git`)
    expect(
      depotCiteDansLeMessage(
        `verifie que bash -c "git -C ${jetable} stash" est refuse`,
        ACTIF,
        existe
      )
    ).toBeNull()
  })

  it('ne bascule pas vers la copie de travail d un agent rangee dans le depot actuel', () => {
    // Une copie de travail git a un FICHIER .git : elle ressemble a un depot a part entiere.
    const copie = `${ACTIF}\\.autowin-data\\autowin-os\\worktrees\\5a94\\agent__run-1`
    const existe = disque(ACTIF, `${ACTIF}\\.git`, copie, `${copie}\\.git`, `${copie}\\src`)
    expect(depotCiteDansLeMessage(`regarde ${copie}\\src`, ACTIF, existe)).toBeNull()
  })

  it('ignore aussi le depot imbrique quand le dossier actif est un sous-dossier du depot', () => {
    const jetable = `${ACTIF}\\.autowin-data\\essai-garde`
    const existe = disque(ACTIF, `${ACTIF}\\.git`, `${ACTIF}\\src`, jetable, `${jetable}\\.git`)
    expect(depotCiteDansLeMessage(`lis ${jetable}`, `${ACTIF}\\src`, existe)).toBeNull()
  })

  it('passe le depot imbrique et prend le depot externe cite ensuite', () => {
    const jetable = `${ACTIF}\\.autowin-data\\essai-garde`
    const existe = disque(
      ACTIF,
      `${ACTIF}\\.git`,
      jetable,
      `${jetable}\\.git`,
      'D:\\Projets\\Rig',
      'D:\\Projets\\Rig\\.git'
    )
    expect(depotCiteDansLeMessage(`compare ${jetable} et D:\\Projets\\Rig`, ACTIF, existe)).toBe(
      'D:\\Projets\\Rig'
    )
  })

  it('bascule toujours d un dossier parent SANS depot vers un projet qu il contient', () => {
    const existe = disque('D:\\GIT', 'D:\\GIT\\RigApplication', 'D:\\GIT\\RigApplication\\.git')
    expect(depotCiteDansLeMessage('corrige D:\\GIT\\RigApplication', 'D:\\GIT', existe)).toBe(
      'D:\\GIT\\RigApplication'
    )
  })

  it('ne prend pas un depot VOISIN au nom prolonge pour un depot imbrique', () => {
    const existe = disque(ACTIF, `${ACTIF}\\.git`, 'D:\\AutoWinOS2', 'D:\\AutoWinOS2\\.git')
    expect(depotCiteDansLeMessage('va dans D:\\AutoWinOS2', ACTIF, existe)).toBe('D:\\AutoWinOS2')
  })

  it('accepte un partage reseau', () => {
    const existe = disque('\\\\ged2\\rig\\Brain', '\\\\ged2\\rig\\Brain\\.git')
    expect(depotCiteDansLeMessage('va dans \\\\ged2\\rig\\Brain', ACTIF, existe)).toBe(
      '\\\\ged2\\rig\\Brain'
    )
  })
})
