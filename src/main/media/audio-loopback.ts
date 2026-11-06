/**
 * CAPTER LE SON QUE LA MACHINE JOUE — « ce que j'entends », pas « ce que je dis ».
 *
 * Le mode conversation téléphonique du widget Enregistrements doit transcrire les DEUX voix. Le
 * micro donne la première ; la seconde sort des haut-parleurs (Teams, Meet, un téléphone posé à
 * côté) et n'existe nulle part ailleurs. Chromium ne l'ouvre qu'à travers `getDisplayMedia`, et
 * Electron n'y répond QUE si le processus principal fournit un gestionnaire : sans lui, la demande
 * du renderer est rejetée sans explication.
 *
 * TROIS DÉCISIONS portées ici :
 *  - `audio: 'loopback'` est le seul mode qui rend la sortie audio du système. Il est documenté
 *    Windows-seulement (electron/electron#30702, https://alec.is/posts/bringing-system-audio-loopback-to-electron/).
 *    Ailleurs, on REFUSE explicitement plutôt que de rendre un flux muet : un enregistrement qui
 *    affiche « en cours » sur du silence est le pire résultat possible.
 *  - la vidéo est imposée par l'API (une source d'écran est obligatoire), et coupée aussitôt côté
 *    renderer. Aucune image n'est enregistrée ni transmise.
 *  - la demande n'est honorée QUE pour un rendu de l'application (l'appelant décide) : la capture du
 *    son du système n'est pas quelque chose qu'un contenu quelconque peut déclencher.
 */

export interface SourceCapture {
  id: string
  name: string
}

interface SessionCapturable {
  setDisplayMediaRequestHandler(
    handler: (
      request: unknown,
      callback: (
        reponse: { video?: SourceCapture; audio?: 'loopback' } | Record<string, never>
      ) => void
    ) => void,
    options?: { useSystemPicker?: boolean }
  ): void
}

export interface DependancesLoopback {
  /** Les écrans capturables — `desktopCapturer.getSources({ types: ['screen'] })` en production. */
  sources: () => Promise<SourceCapture[]>
  plateforme: string
}

/**
 * Ce que le gestionnaire doit répondre à une demande de capture. Séparé de l'installation pour être
 * prouvable sans Electron : c'est ICI que vit la règle, l'installation n'est qu'un branchement.
 */
export async function reponseCaptureSonSysteme(
  deps: DependancesLoopback
): Promise<{ video: SourceCapture; audio: 'loopback' } | null> {
  if (deps.plateforme !== 'win32') return null
  const sources = await deps.sources()
  const ecran = sources[0]
  if (!ecran) return null
  return { video: ecran, audio: 'loopback' }
}

/** Branche la règle sur la session Electron. Rend le gestionnaire installé, pour inspection. */
export function installerCaptureSonSysteme(
  session: SessionCapturable,
  deps: DependancesLoopback
): void {
  session.setDisplayMediaRequestHandler(
    (_demande, callback) => {
      void reponseCaptureSonSysteme(deps).then(
        (reponse) => callback(reponse ?? {}),
        // Un refus se répond par un objet VIDE : laisser la promesse tomber laisserait le renderer
        // attendre indéfiniment un flux qui n'arrivera jamais.
        () => callback({})
      )
    },
    // Le sélecteur natif de Windows demanderait à l'utilisateur QUEL écran partager : hors sujet, on
    // ne veut que le son, et la question serait incompréhensible.
    { useSystemPicker: false }
  )
}
