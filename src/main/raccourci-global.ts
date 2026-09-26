/**
 * RACCOURCI CLAVIER GLOBAL « ramène Autowin » (app en arrière-plan).
 *
 * Pourquoi : tous les raccourcis du produit étaient LOCAUX à la fenêtre (`App.tsx`, `ChatView.tsx`)
 * — `globalShortcut` n'avait aucune occurrence dans `src`. Fenêtre réduite ou cachée en zone de
 * notification, il fallait aller la CHERCHER pour déposer une idée.
 *
 * L'API d'Electron est passée en paramètre : le test la double, sans Electron réel. Le
 * désenregistrement est rendu à l'appelant — un raccourci global laissé posé continue de capter la
 * combinaison pour TOUTE la session Windows, bien après la fermeture de l'app.
 */
export type ApiRaccourcis = {
  register(accelerateur: string, action: () => void): boolean
  isRegistered(accelerateur: string): boolean
  unregisterAll(): void
}

/** Combinaison par défaut : libre sous Windows, proche du réflexe « Spotlight ». */
export const RACCOURCI_CAPTURE_DEFAUT = 'Alt+Space'

export type RaccourciInstalle = {
  installe: boolean
  accelerateur: string
  desinstaller: () => void
}

export function installerRaccourciCapture(
  api: ApiRaccourcis,
  onDeclenche: () => void,
  accelerateur: string = RACCOURCI_CAPTURE_DEFAUT
): RaccourciInstalle {
  const desinstaller = (): void => {
    try {
      api.unregisterAll()
    } catch {
      // Fermeture en cours : rien à récupérer ici.
    }
  }
  // Déjà pris par une autre application : on ne l'arrache pas, et ce n'est pas une panne.
  if (api.isRegistered(accelerateur)) return { installe: false, accelerateur, desinstaller }
  let installe = false
  try {
    installe = api.register(accelerateur, onDeclenche)
  } catch {
    installe = false
  }
  return { installe, accelerateur, desinstaller }
}
