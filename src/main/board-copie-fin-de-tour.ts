/**
 * LE BOARD RECOPIÉ À CHAQUE FIN DE TOUR (demande utilisateur du 2026-10-28, conv-1210).
 *
 * Demande : « fais que la copie du Board vers la GED se mette à jour même quand le Board n'est pas
 * affiché, par exemple à chaque fin de tour ». Jusque-là, le Board n'était recopié dans le dossier
 * (`board-dossier.ts`, conv-1206) qu'au moment où la vue le calculait : app ouverte sur une autre
 * vue, la copie vieillissait.
 *
 * Ce module, appelé à la fin de chaque tour de chat (`index.ts`, observateur de fin de tour) :
 *  - ne calcule RIEN sans dossier choisi ;
 *  - calcule la carte au plus une fois par `delaiMs` (le même délai que l'écriture) : une rafale de
 *    fins de tour, sur plusieurs fils, ne coûte qu'un calcul, plus un dernier pour la fin de rafale ;
 *  - confie la carte à `enregistrer`, qui garde ses propres règles (délai, Board inchangé non
 *    réécrit, projets partagés) ;
 *  - joint les états posés à la main que la vue lui a transmis en dernier, gardés sur le poste
 *    (`board-etats-manuels.json`) : sans eux, après un redémarrage et avant toute ouverture du
 *    Board, un post-it glissé à la main serait recopié à l'étage de ses preuves.
 *
 * Fichier à part : `board-dossier.ts` portait le travail en cours d'un autre fil (conv-1211).
 */
import { readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { CarteDesBesoins } from '../shared/carte-des-besoins'
import { etatManuelLisible, type EtatManuelDuBoard } from '../shared/board-dossier'
import { DELAI_ENTRE_ECRITURES_MS, type DossierDuBoard } from './board-dossier'

export const FICHIER_DES_ETATS_MANUELS = 'board-etats-manuels.json'

type Manuels = Readonly<Record<string, EtatManuelDuBoard>>

/** Les états posés à la main gardés sur le poste ; absents ou illisibles = aucun, jamais d'échec. */
export function lireEtatsManuelsGardes(racine: string): Record<string, EtatManuelDuBoard> {
  const lus: Record<string, EtatManuelDuBoard> = {}
  try {
    const brut = JSON.parse(
      readFileSync(join(racine, FICHIER_DES_ETATS_MANUELS), 'utf8')
    ) as unknown
    if (!brut || typeof brut !== 'object' || Array.isArray(brut)) return lus
    for (const [id, valeur] of Object.entries(brut)) {
      const etat = etatManuelLisible(valeur)
      if (etat) lus[id] = etat
    }
  } catch {
    // Absent au premier lancement, ou illisible : la vue les renverra à sa prochaine ouverture.
  }
  return lus
}

export interface CopieDeFinDeTour {
  /** Les états posés à la main que la vue vient de transmettre ; gardés sur le poste s'ils changent. */
  retenirManuels: (manuels: Manuels) => void
  /** À la fin d'un tour : recalcule et recopie le Board, sans attendre ni bloquer le tour. */
  recopier: () => void
  /** Pour les tests : attend le calcul en cours et la garde des états manuels. */
  attendre: () => Promise<void>
}

export function creerCopieDeFinDeTour(deps: {
  /** Dossier de données de l'app, où vit `board-etats-manuels.json`. */
  racine: string
  dossierDuBoard: Pick<DossierDuBoard, 'etat' | 'enregistrer'>
  calculer: () => Promise<CarteDesBesoins>
  maintenant?: () => number
  delaiMs?: number
  planifier?: (fn: () => void, ms: number) => { annuler: () => void }
}): CopieDeFinDeTour {
  const maintenant = deps.maintenant ?? Date.now
  const delaiMs = deps.delaiMs ?? DELAI_ENTRE_ECRITURES_MS
  const planifier =
    deps.planifier ??
    ((fn: () => void, ms: number): { annuler: () => void } => {
      const t = setTimeout(fn, ms)
      t.unref?.()
      return { annuler: () => clearTimeout(t) }
    })
  let manuels: Manuels = lireEtatsManuelsGardes(deps.racine)
  let manuelsGardes = JSON.stringify(manuels)
  let garde: Promise<void> = Promise.resolve()
  let calcul: Promise<void> | null = null
  let minuteur: { annuler: () => void } | null = null
  /** Une fin de tour est arrivée pendant un calcul ou un délai : un calcul de plus, pas un par tour. */
  let encore = false
  let dernierCalcul = Number.NEGATIVE_INFINITY

  async function calculerEtConfier(): Promise<void> {
    dernierCalcul = maintenant()
    try {
      const carte = await deps.calculer()
      deps.dossierDuBoard.enregistrer(carte, manuels)
    } catch (e) {
      // Une copie ratée ne casse jamais la fin d'un tour : la suivante réessaiera.
      console.warn(
        '[board] copie de fin de tour non calculée :',
        e instanceof Error ? e.message : e
      )
    }
  }

  function recopier(): void {
    if (!deps.dossierDuBoard.etat().dossier) return
    if (calcul || minuteur) {
      encore = true
      return
    }
    const reste = dernierCalcul + delaiMs - maintenant()
    if (reste > 0) {
      minuteur = planifier(() => {
        minuteur = null
        recopier()
      }, reste)
      return
    }
    encore = false
    calcul = calculerEtConfier().finally(() => {
      calcul = null
      if (encore) recopier()
    })
  }

  return {
    retenirManuels(nouveaux) {
      const texte = JSON.stringify(nouveaux)
      manuels = nouveaux
      if (texte === manuelsGardes) return
      manuelsGardes = texte
      garde = garde
        .then(async () => {
          await mkdir(deps.racine, { recursive: true })
          await writeFile(join(deps.racine, FICHIER_DES_ETATS_MANUELS), `${texte}\n`, 'utf8')
        })
        .catch((e: unknown) =>
          console.warn(
            '[board] états posés à la main non gardés :',
            e instanceof Error ? e.message : e
          )
        )
    },
    recopier,
    async attendre() {
      while (calcul) await calcul
      await garde
    }
  }
}
