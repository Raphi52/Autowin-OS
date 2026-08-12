/**
 * Le signal « l'interface est visible », pour le travail qui doit attendre derrière elle.
 *
 * Pourquoi ce module existe plutôt qu'un simple délai : la première version reportait la
 * réconciliation des copies git de 1 500 ms. MESURÉ, ça n'a rien réglé — ça a seulement DÉPLACÉ le
 * blocage. La réconciliation est synchrone et dure ~23 s ; lancée par une minuterie, elle occupait le
 * fil principal juste avant que la micro-tâche de `app.whenReady` puisse s'exécuter, et `whenReady`
 * arrivait à 26 047 ms au lieu de 1 545 ms. Un test d'inversion (report poussé à 45 s) a confirmé la
 * cause : `whenReady` à 1 545 ms, fenêtre visible à 7,2 s au lieu de 31 s.
 *
 * La leçon est le minutage aveugle lui-même : « attendre assez longtemps » n'est pas une garantie
 * d'ordonnancement. On attend donc l'ÉVÉNEMENT réel.
 *
 * Le filet de sécurité n'est pas décoratif : les pilotes de fumée et les scénarios sans fenêtre ne
 * déclenchent jamais `ready-to-show`, et sans lui la récupération des runs interrompus ne se ferait
 * jamais — un démarrage rapide au prix d'un état jamais restauré serait une régression, pas un gain.
 */

/** Au-delà de ce délai, on n'attend plus la fenêtre : mieux vaut réconcilier tard que jamais. */
const FILET_MS = 20_000

let declencher: () => void = () => {}
let deja = false

/**
 * Résolu quand la fenêtre principale devient visible — ou au bout de {@link FILET_MS} si aucune
 * fenêtre ne se montre.
 */
export const interfaceVisible: Promise<void> = new Promise<void>((resolve) => {
  declencher = resolve
  const filet = setTimeout(resolve, FILET_MS)
  // Sans cela, ce minuteur retiendrait tout seul un processus par ailleurs prêt à sortir.
  filet.unref?.()
})

/** Appelé à `ready-to-show`. Idempotent : la fenêtre peut émettre l'événement plus d'une fois. */
export function signalerInterfaceVisible(): void {
  if (deja) return
  deja = true
  declencher()
}
