/**
 * RÉVEIL APRÈS LE MUR DE QUOTA — un run suspendu repart tout seul à l'heure annoncée, app ouverte.
 *
 * Mesuré le 2026-10-22 : `quotaWall.resumeAfter` n'était relu qu'au DÉMARRAGE
 * (`index.ts`, filtre `repriseAutoRetenueParQuota`) et par le bouton « Reprendre tout ». Un run coupé
 * à 11:01 par « resets 11:30am » attendait donc le prochain redémarrage de l'app, à l'encontre du
 * choix de l'utilisateur cité dans `index.ts` : reprise AUTOMATIQUE, pas de bouton, pas de question.
 *
 * Partage des rôles avec le démarrage, par la SEULE heure de retour : un mur échu au démarrage
 * (`resumeAfter <= demarrageMs`) a été relancé par lui ; tout mur échu APRÈS est à ce module. Le même
 * instant `demarrageMs` sert aux deux, sinon un run tomberait entre eux ou partirait deux fois.
 *
 * La relance passe par le MÊME chemin que « Reprendre tout » (preuve de publication, action de
 * reprise, file séquentielle partagée). Elle revérifie l'état AU MOMENT de partir, dans la file : un
 * run déjà relancé à la main, allé au bout ou recoupé par un NOUVEAU mur n'est pas relancé une
 * seconde fois. Toutes les dépendances sont injectées : aucun accès à Electron, au disque ni à un
 * modèle, pour que le test à horloge simulée observe les relances elles-mêmes.
 */

/** L'heure annoncée est à la minute (« resets 11:30am ») : partir pile dessus risque le même refus,
 *  qui serait alors relu comme « demain 11:30 ». Deux minutes de marge. */
export const MARGE_APRES_RETOUR_MS = 2 * 60_000

/** Attente découpée : l'horloge murale est relue au moins tous les quarts d'heure. Une mise en
 *  veille du poste fige le minuteur sans figer l'heure : une seule longue attente partirait en retard. */
export const PLAFOND_ATTENTE_MS = 15 * 60_000

export interface RunSuspenduParQuota {
  runId: string
  quotaWall?: { resumeAfter?: number; decidedAt: number }
}

export interface DependancesDuReveil<Etat extends RunSuspenduParQuota> {
  /** L'instant exact où le démarrage a trié ses reprises (`repriseAutoRetenueParQuota`). */
  demarrageMs: number
  listerRunsReprenables: () => readonly Etat[]
  /** Preuve Git durable qu'un run a déjà publié : le relancer repaierait un appel. */
  publicationDejaProuvee: (etat: Etat) => boolean
  actionDeReprise: (etat: Etat) => 'relancer' | 'rattacher' | 'bloquer' | 'ignorer'
  /** File séquentielle partagée avec le démarrage et « Reprendre tout ». */
  mettreEnFile: (tache: () => Promise<void>) => Promise<void>
  relancer: (etat: Etat) => Promise<void>
  maintenant?: () => number
  journal?: (message: string) => void
  /**
   * Sans elle, pour les runs : un mur se tente une fois, à son heure. Avec elle, pour les fils : tant
   * qu'elle rend vrai, un passage reste prévu, et un départ écarté à l'heure redevient possible.
   *
   * fix-ok: rien ne repassait entre deux échéances, et un départ écarté gardait sa clé : un fil
   * réactivé s'affichait « repart seule » avec 0 minuterie et 0 départ (essai du contrôle final sur le
   * vrai `creerRepriseDesFils`). Option plutôt que changement : le contrat des runs tient.
   */
  surveillerEncore?: () => boolean
}

const cle = (etat: RunSuspenduParQuota): string =>
  `${etat.runId}@${etat.quotaWall?.decidedAt ?? ''}@${etat.quotaWall?.resumeAfter ?? ''}`

export function creerReveilApresQuota<Etat extends RunSuspenduParQuota>(
  deps: DependancesDuReveil<Etat>
): { replanifier: () => void; arreter: () => void } {
  const maintenant = deps.maintenant ?? Date.now
  /** Murs déjà réveillés : une replanification ne relance jamais deux fois le même. */
  const reveilles = new Set<string>()
  let minuterie: ReturnType<typeof setTimeout> | undefined

  const echeance = (etat: Etat): number | undefined => {
    const resumeAfter = etat.quotaWall?.resumeAfter
    if (resumeAfter === undefined || resumeAfter <= deps.demarrageMs) return undefined
    if (reveilles.has(cle(etat))) return undefined
    return resumeAfter + MARGE_APRES_RETOUR_MS
  }

  const reveiller = (etat: Etat): void => {
    reveilles.add(cle(etat))
    let tente = false
    deps
      .mettreEnFile(async () => {
        // Relu DANS la file : la tâche d'avant a pu relancer ce run, le finir ou le recouper.
        const actuel = deps.listerRunsReprenables().find((e) => e.runId === etat.runId)
        if (!actuel || cle(actuel) !== cle(etat)) return
        if (deps.publicationDejaProuvee(actuel)) return
        if (deps.actionDeReprise(actuel) !== 'relancer') return
        tente = true
        deps.journal?.(`${actuel.runId} -> reprise automatique : l'heure du quota est passée`)
        await deps.relancer(actuel)
      })
      .catch((erreur: unknown) =>
        deps.journal?.(`${etat.runId} -> reprise après quota en échec : ${String(erreur)}`)
      )
      // Un départ tenté garde sa clé même en échec : il a pu coûter. Écarté, il n'a rien coûté.
      .finally(() => {
        if (!tente && deps.surveillerEncore) reveilles.delete(cle(etat))
      })
  }

  const replanifier = (): void => {
    if (minuterie !== undefined) clearTimeout(minuterie)
    minuterie = undefined
    const instant = maintenant()
    let prochaine: number | undefined
    for (const etat of deps.listerRunsReprenables()) {
      const quand = echeance(etat)
      if (quand === undefined) continue
      if (quand <= instant) reveiller(etat)
      else prochaine = prochaine === undefined ? quand : Math.min(prochaine, quand)
    }
    if (prochaine === undefined && deps.surveillerEncore?.() !== true) return
    minuterie = setTimeout(
      replanifier,
      Math.min((prochaine ?? Infinity) - instant, PLAFOND_ATTENTE_MS)
    )
  }

  return {
    replanifier,
    arreter: () => {
      if (minuterie !== undefined) clearTimeout(minuterie)
      minuterie = undefined
    }
  }
}
