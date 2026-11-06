/**
 * PC ÉVEILLÉ PENDANT QU'UN AGENT TRAVAILLE (conv-364).
 *
 * Un run de nuit était coupé par la mise en veille de Windows. Chaque processus d'agent prend un
 * jeton au lancement et le rend à sa fin ; tant qu'au moins un jeton est tenu, Electron empêche la
 * mise en veille du PC (`prevent-app-suspension` : l'écran peut s'éteindre, la machine non).
 * Compteur de références : deux agents en parallèle ne relâchent le verrou qu'à la fin du dernier.
 */
export interface BloqueurDeVeille {
  start(type: 'prevent-app-suspension'): number
  stop(id: number): void
}

export function creerGardeEveil(bloqueur: () => BloqueurDeVeille | undefined): {
  prendre(): () => void
  actif: () => boolean
  jetons: () => number
} {
  let tenus = 0
  let idBloqueur: number | undefined
  return {
    /** Prend un jeton ; la fonction rendue le relâche (une seule fois, même appelée deux fois). */
    prendre(): () => void {
      tenus++
      if (idBloqueur === undefined) {
        try {
          idBloqueur = bloqueur()?.start('prevent-app-suspension')
        } catch {
          idBloqueur = undefined // hors Electron (tests, CLI) : aucun verrou possible, on continue
        }
      }
      let rendu = false
      return () => {
        if (rendu) return
        rendu = true
        tenus--
        if (tenus === 0 && idBloqueur !== undefined) {
          try {
            bloqueur()?.stop(idBloqueur)
          } finally {
            idBloqueur = undefined
          }
        }
      }
    },
    actif: (): boolean => idBloqueur !== undefined,
    jetons: (): number => tenus
  }
}

function bloqueurElectron(): BloqueurDeVeille | undefined {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const electron = require('electron') as { powerSaveBlocker?: BloqueurDeVeille }
    return typeof electron?.powerSaveBlocker?.start === 'function'
      ? electron.powerSaveBlocker
      : undefined
  } catch {
    return undefined
  }
}

export const gardeEveil = creerGardeEveil(bloqueurElectron)
