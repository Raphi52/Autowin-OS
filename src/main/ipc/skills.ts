/**
 * LE CANAL DE L'INVENTAIRE DES SKILLS, sorti de `src/main/index.ts`.
 *
 * Un seul canal : lister les skills découverts dans les sources CONFIGURÉES.
 *
 * Déplacement MÉCANIQUE depuis `index.ts` : corps identique, même garde d'expéditeur.
 *
 * La règle de fond que le déplacement ne touche pas : la liste des dossiers à parcourir vient d'un
 * fichier de configuration situé dans les données de l'application — la fenêtre ne choisit AUCUN
 * chemin. Ce chemin est calculé une seule fois au câblage : il ne change pas pendant la vie de
 * l'application, contrairement aux dépendances qui, elles, sont reçues comme lecteurs.
 */
import { ipcMain } from 'electron'
import { assertTrustedRendererSender } from '../ipc-senders'
import { discoverConfiguredSkillRegistry } from '../skill-registry'

/** Ce que le canal des skills prenait dans `index.ts` — désormais passé explicitement. */
export type SkillsIpcDeps = {
  /** Le fichier qui déclare les sources de skills, dans les données de l'application. */
  skillSourcesPath: string
}

export function registerSkillsIpc({ skillSourcesPath }: SkillsIpcDeps): void {
  ipcMain.handle('skills:registry:list', (event) => {
    assertTrustedRendererSender(event, 'Skills')
    return discoverConfiguredSkillRegistry(skillSourcesPath)
  })
}
