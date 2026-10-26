/**
 * LE CANAL DE LA LANGUE (conv-1146, 2026-10-26) — Settings · Interface, liste « Langue ».
 *
 * L'interface transmet la langue choisie ; le moteur l'enregistre (`langue-reglage.ts`) pour écrire
 * la consigne de chaque tour dans cette langue. Une seule écriture, bornée : `ecrireLangueReglee`
 * refuse toute valeur hors de `LANGUES` (le rejet remonte à l'interface) et n'écrit rien si la
 * langue ne change pas. Rend la langue telle que le moteur l'a enregistrée.
 */
import { ipcMain } from 'electron'
import { assertTrustedRendererSender } from '../ipc-senders'
import { ecrireLangueReglee, lireLangueReglee } from '../langue-reglage'

export function registerLangueIpc(): void {
  ipcMain.handle('app:langue:ecrire', (event, langue: unknown) => {
    assertTrustedRendererSender(event, 'Langue')
    ecrireLangueReglee(langue)
    return lireLangueReglee()
  })
}
