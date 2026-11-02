import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ENTETE_REPRISE_AUTOMATIQUE } from './chat/relance-taches-de-fond'
import { depotCiteDansLeMessage } from './depot-cite-dans-le-message'
import { promptDOrdre } from './messages-entre-fils-app'
import { consommerReprise, poserReprise } from './redemarrage-reprise'

const ACTIF = 'D:\\AutoWinOS'

/** Faux disque : seuls les chemins listes existent. */
const disque = (...presents: string[]) => {
  const set = new Set(presents.map((p) => p.toLowerCase()))
  return (chemin: string) => set.has(chemin.toLowerCase())
}

describe('depotCiteDansLeMessage', () => {
  it('rend la racine du depot cite quand elle differe du dossier actif', () => {
    const existe = disque(
      'D:\\Projets\\Contoso',
      'D:\\Projets\\Contoso\\.git',
      'D:\\Projets\\Contoso\\src'
    )
    expect(depotCiteDansLeMessage('corrige D:\\Projets\\Contoso\\src stp', ACTIF, existe)).toBe(
      'D:\\Projets\\Contoso'
    )
  })

  it('ignore la ponctuation collee au chemin', () => {
    const existe = disque('D:\\Projets\\Contoso', 'D:\\Projets\\Contoso\\.git')
    expect(depotCiteDansLeMessage('va dans D:\\Projets\\Contoso.', ACTIF, existe)).toBe(
      'D:\\Projets\\Contoso'
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
    const existe = disque('D:\\Projets\\Contoso', 'D:\\Projets\\Contoso\\.git')
    expect(depotCiteDansLeMessage('faut regarder le projet Contoso', ACTIF, existe)).toBeNull()
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
      'D:\\Projets\\Contoso',
      'D:\\Projets\\Contoso\\.git'
    )
    expect(
      depotCiteDansLeMessage(`compare ${jetable} et D:\\Projets\\Contoso`, ACTIF, existe)
    ).toBe('D:\\Projets\\Contoso')
  })

  it('bascule toujours d un dossier parent SANS depot vers un projet qu il contient', () => {
    const existe = disque('D:\\GIT', 'D:\\GIT\\ContosoApp', 'D:\\GIT\\ContosoApp\\.git')
    expect(depotCiteDansLeMessage('corrige D:\\GIT\\ContosoApp', 'D:\\GIT', existe)).toBe(
      'D:\\GIT\\ContosoApp'
    )
  })

  it('ne prend pas un depot VOISIN au nom prolonge pour un depot imbrique', () => {
    const existe = disque(ACTIF, `${ACTIF}\\.git`, 'D:\\AutoWinOS2', 'D:\\AutoWinOS2\\.git')
    expect(depotCiteDansLeMessage('va dans D:\\AutoWinOS2', ACTIF, existe)).toBe('D:\\AutoWinOS2')
  })

  it('accepte un partage reseau', () => {
    const existe = disque('\\\\nas1\\partage\\Brain', '\\\\nas1\\partage\\Brain\\.git')
    expect(depotCiteDansLeMessage('va dans \\\\nas1\\partage\\Brain', ACTIF, existe)).toBe(
      '\\\\nas1\\partage\\Brain'
    )
  })

  /*
   * MESSAGE ÉCRIT PAR UN AGENT (conv-1306, 2026-10-30). Un ordre de conv-1306 à conv-1329 citait
   * D:/ContosoApp-arena/depart dans la LISTE DES DOSSIERS À RETIRER du Board : le fil a basculé
   * dans ce dossier, celui-là même que l'utilisateur voulait voir disparaître.
   */
  it('ne bascule pas sur un ordre d un autre fil, meme s il cite un autre depot', () => {
    const existe = disque('D:\\Projets\\Contoso', 'D:\\Projets\\Contoso\\.git')
    const ordre = promptDOrdre({
      id: 'msg-1',
      de: 'conv-1306',
      texte: `retire du Board : node retraits.mjs '["D:\\Projets\\Contoso"]'`
    })
    expect(depotCiteDansLeMessage(ordre, ACTIF, existe)).toBeNull()
  })

  /*
   * La consigne de restart_app arrive telle quelle, sans en-tete (ChatView l'envoie comme une frappe).
   * Celle de conv-1329 (2026-10-30) citait la meme liste de dossiers a retirer : rejouee, elle aurait
   * fait la meme bascule que l'ordre.
   */
  it('ne bascule pas sur la consigne rejouee apres un redemarrage', () => {
    const existe = disque('D:\\Projets\\Contoso', 'D:\\Projets\\Contoso\\.git')
    const racine = mkdtempSync(join(tmpdir(), 'reprise-bascule-'))
    try {
      const consigne = `Reprise apres redemarrage : retire D:\\Projets\\Contoso du Board.`
      poserReprise(racine, { conversationId: 'conv-1', consigne, poseeA: 1_000 })
      expect(consommerReprise(racine, 2_000, 1_500)?.consigne).toBe(consigne)
      expect(depotCiteDansLeMessage(consigne, ACTIF, existe)).toBeNull()
      // Le meme chemin ECRIT par l'utilisateur fait toujours basculer.
      expect(depotCiteDansLeMessage('va dans D:\\Projets\\Contoso', ACTIF, existe)).toBe(
        'D:\\Projets\\Contoso'
      )
    } finally {
      rmSync(racine, { recursive: true, force: true })
    }
  })

  it('ne bascule pas sur une reprise automatique ecrite par Autowin', () => {
    const existe = disque('D:\\Projets\\Contoso', 'D:\\Projets\\Contoso\\.git')
    const reprise = `${ENTETE_REPRISE_AUTOMATIQUE} Ton tour précédent s’est terminé.\nDossier : D:\\Projets\\Contoso`
    expect(depotCiteDansLeMessage(reprise, ACTIF, existe)).toBeNull()
  })
})
