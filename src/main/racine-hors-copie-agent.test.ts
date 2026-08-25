import { describe, expect, it } from 'vitest'
import { portableAppDataBase, racineHorsCopieAgent } from './app-data'

/**
 * LE DÉFAUT, mesuré le 2026-08-24. La racine de données est `join(appPath, '.autowin-data')` : elle
 * SUIT l'app qui tourne. Un agent lançant l'app depuis sa propre copie créait donc un `.autowin-data`
 * DEDANS — **66 Mo observés** — avec ses propres worktrees à l'intérieur, qui pouvaient à leur tour
 * en contenir. Constaté sur disque : `agent__run-ee040823ca71-1/.autowin-data/…/agent__run-749c…`.
 *
 * DEUX DÉGÂTS RÉELS, pas une inélégance :
 *   - des copies imbriquées qu'aucun balayage ne retrouve, parce qu'elles ne sont pas là où il cherche ;
 *   - une suite de tests passée de 743 à 1421 fichiers, vitest ramassant une copie complète du dépôt.
 *     Quatre des cinq échecs venaient de cette copie, pas du code — le signal devenait illisible.
 */

describe('la racine de données ne se réplique pas dans les copies agent', () => {
  it('laisse un chemin de dépôt normal intact', () => {
    expect(racineHorsCopieAgent('C:/Amitel/Autowin OS')).toBe('C:/Amitel/Autowin OS')
  })

  it('remonte hors d’une copie agent — le cas mesuré', () => {
    const dansUneCopie =
      'C:/Amitel/Autowin OS/.autowin-data/autowin-os/worktrees/68fe8b086ee864a1/agent__run-ee040823ca71-1'

    expect(racineHorsCopieAgent(dansUneCopie)).toBe('C:/Amitel/Autowin OS')
  })

  it('remonte au dépôt RÉEL même sur une imbrication de plusieurs niveaux', () => {
    // C'est le cas trouvé sur le disque : une copie contenant sa propre racine de données, elle-même
    // contenant une copie. Couper au PREMIER marqueur est ce qui rend le vrai dépôt.
    const imbrique =
      'C:/Amitel/Autowin OS/.autowin-data/a/worktrees/h/agent__x/.autowin-data/b/worktrees/h/agent__y'

    expect(racineHorsCopieAgent(imbrique)).toBe('C:/Amitel/Autowin OS')
  })

  it('gère les séparateurs Windows', () => {
    const windows = 'C:\\Amitel\\Autowin OS\\.autowin-data\\autowin-os\\worktrees\\h\\agent__z'

    expect(racineHorsCopieAgent(windows)).toBe('C:\\Amitel\\Autowin OS')
  })

  it('ne coupe PAS sur un dossier qui ressemble sans en être un', () => {
    // L'entrée qui doit faire échouer une garde trop gourmande : un nom qui CONTIENT le marqueur
    // sans être ce dossier. Couper ici renverrait une racine fausse.
    const ressemblant = 'C:/projets/mon.autowin-data-perso/depot'

    expect(racineHorsCopieAgent(ressemblant)).toBe(ressemblant)
  })

  it('la racine calculée pointe hors de la copie, pas dedans', () => {
    const dansUneCopie = 'C:/Amitel/Autowin OS/.autowin-data/autowin-os/worktrees/h/agent__q'

    const base = portableAppDataBase(dansUneCopie, '/ignore', false)

    // Une seule occurrence du dossier de données : la récursion est cassée.
    expect(base.split('.autowin-data').length - 1).toBe(1)
  })

  it('en mode PACKAGÉ, la racine reste celle de l’exécutable — comportement inchangé', () => {
    // Bord à ne pas casser : l'application portable écrit à côté de son exécutable, et ce chemin-là
    // ne passe pas par la détection.
    const base = portableAppDataBase('/ignore', 'D:/Portable/Autowin', true)

    expect(base.split('\\').join('/')).toBe('D:/Portable/Autowin/.autowin-data')
  })
})
