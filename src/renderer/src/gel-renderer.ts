import { SEUIL_GEL_MS } from '../../shared/gel-detector'

/**
 * SONDE PERMANENTE DES GELS DU RENDERER — ce qui manquait pour trancher « main ou interface ? ».
 *
 * `PerfLagPanel` savait deja observer les `longtask`, mais seulement A LA DEMANDE et seulement A
 * L'ECRAN : rien n'etait ecrit. Apres coup, un freeze de la FENETRE cause par le thread d'interface
 * n'etait donc attribuable NULLE PART — alors que les deux derniers gigalags corriges (home-decor,
 * commits 476b1128 et 864b4af2) venaient precisement de la, et que le journal `gels.jsonl` ne
 * couvre que le process main. Une tache longue au-dela du seuil est desormais poussee vers le MEME
 * journal, sous une operation prefixee `renderer:`, via l'unique puits d'ecriture existant.
 *
 * Best-effort de bout en bout : sans `PerformanceObserver`, ou si le canal est absent (moteur non
 * reconstruit), la sonde reste inerte — un instrument muet ne doit jamais casser l'interface.
 */
export type FabriqueObservateur = (
  rappel: (durees: number[]) => void
) => { disconnect: () => void } | undefined

function fabriqueParDefaut(rappel: (durees: number[]) => void): { disconnect: () => void } | undefined {
  if (typeof PerformanceObserver !== 'function') return undefined
  try {
    const observer = new PerformanceObserver((liste) => {
      rappel(liste.getEntries().map((e) => e.duration))
    })
    observer.observe({ entryTypes: ['longtask'] })
    return observer
  } catch {
    /* `longtask` non supporte par ce moteur : pas de sonde, pas d'erreur. */
    return undefined
  }
}

/**
 * Demarre la surveillance et rend la fonction qui l'arrete.
 *
 * `signaler` recoit la duree ARRONDIE a la milliseconde de chaque tache longue ayant atteint le
 * seuil — le meme seuil que le detecteur du main, pour que les deux moities du journal se
 * comparent sans conversion.
 */
export function surveillerGelsRenderer(
  signaler: (dureeMs: number) => void,
  seuilMs: number = SEUIL_GEL_MS,
  fabrique: FabriqueObservateur = fabriqueParDefaut
): () => void {
  const observer = fabrique((durees) => {
    for (const duree of durees) {
      const dureeMs = Math.round(duree)
      if (dureeMs >= seuilMs) {
        try {
          signaler(dureeMs)
        } catch {
          /* observabilite best-effort : un canal indisponible ne doit rien casser */
        }
      }
    }
  })
  return () => observer?.disconnect()
}
