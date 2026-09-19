/* fix-ok: cause mesuree — le processus principal tenait la vue courante sur un seul scalaire (this.tab, src/main/commands.ts) diffuse a TOUTES les fenetres (broadcast navigate) ; deux fenetres s'ecrasaient donc mutuellement. Remplace par un agencement fenetre -> onglets -> actif. Verifie par src/shared/tab-layout.test.ts + src/main/tab-windows.test.ts + src/renderer/src/App.tabs.test.tsx (35 tests verts). */
/**
 * LA MÉMOIRE DE L'AGENCEMENT — quels onglets, dans quelle fenêtre, à quelle place à l'écran.
 *
 * Elle ne peut pas vivre dans le stockage de la page : la position d'une fenêtre n'est connue que
 * du processus principal. Un fichier JSON dans le dossier de données de l'app, écrit à chaque
 * changement, relu au démarrage. Une mémoire abîmée ne bloque JAMAIS le lancement : on repart sur
 * l'agencement par défaut.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { lireAgencement, type TabLayout } from '../shared/tab-layout'

export function cheminAgencement(userDataDir: string): string {
  return join(userDataDir, 'tab-layout.json')
}

export function lireAgencementDisque(fichier: string): TabLayout | null {
  try {
    if (!existsSync(fichier)) return null
    return lireAgencement(readFileSync(fichier, 'utf8'))
  } catch {
    return null
  }
}

/** Rend `true` si l'écriture a réellement eu lieu — un échec disque ne casse pas l'interface. */
export function ecrireAgencementDisque(fichier: string, layout: TabLayout): boolean {
  try {
    mkdirSync(dirname(fichier), { recursive: true })
    writeFileSync(fichier, `${JSON.stringify(layout, null, 2)}\n`, 'utf8')
    return true
  } catch {
    return false
  }
}
