/**
 * UNE REPRISE QUI TUE L'APP N'EST JAMAIS REJOUÉE (conv-1150, 2026-10-26).
 *
 * Mesuré le 26/10 à 08:56 : la reprise au démarrage de `run-ec2036c0932d-1` (une vingtaine de
 * boucles build/clean) a fait monter le processus principal à 3,2 Go → `JavaScript heap out of
 * memory` 6 s après la relance. Le checkpoint restant sur le disque, CHAQUE démarrage rejouait la
 * même reprise et replantait : l'app « se fermait toute seule ».
 *
 * Le geste : un marqueur est posé sur le disque AVANT la reprise et retiré une fois que le
 * processus a survécu `DELAI_DE_SURVIE_MS`. Un marqueur encore présent au démarrage suivant prouve
 * que l'app est morte pendant cette reprise : le run est abandonné au lieu d'être rejoué. Le garde
 * ne dépend pas de la cause du plantage (mémoire, natif, boucle) : il casse la boucle elle-même.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const DELAI_DE_SURVIE_MS = 60_000

type Marqueurs = Record<string, { poseLe: string; pid: number }>

export type GardeRepriseCrash = {
  /** Vrai si un démarrage précédent est mort pendant la reprise de ce run. */
  aPlanteAuparavant: (runId: string) => boolean
  /** Pose le marqueur ; le retire seul après la survie. */
  poser: (runId: string) => void
  /** Retire le marqueur (run abandonné, ou survie prouvée). */
  retirer: (runId: string) => void
}

export function creerGardeRepriseCrash(
  chemin: string,
  minuterie: (rappel: () => void, delaiMs: number) => unknown = (rappel, delaiMs) =>
    (setTimeout(rappel, delaiMs) as { unref?: () => void }).unref?.()
): GardeRepriseCrash {
  const lire = (): Marqueurs => {
    try {
      return existsSync(chemin) ? (JSON.parse(readFileSync(chemin, 'utf8')) as Marqueurs) : {}
    } catch {
      return {}
    }
  }
  const ecrire = (marqueurs: Marqueurs): void => {
    try {
      if (Object.keys(marqueurs).length === 0) {
        rmSync(chemin, { force: true })
        return
      }
      mkdirSync(dirname(chemin), { recursive: true })
      writeFileSync(chemin, JSON.stringify(marqueurs, null, 2))
    } catch {
      /* garde best-effort : ne jamais empêcher une reprise pour une écriture */
    }
  }
  const retirer = (runId: string): void => {
    const marqueurs = lire()
    if (!(runId in marqueurs)) return
    delete marqueurs[runId]
    ecrire(marqueurs)
  }
  return {
    aPlanteAuparavant: (runId) => runId in lire(),
    poser: (runId) => {
      ecrire({ ...lire(), [runId]: { poseLe: new Date().toISOString(), pid: process.pid } })
      minuterie(() => retirer(runId), DELAI_DE_SURVIE_MS)
    },
    retirer
  }
}

export const cheminGardeRepriseCrash = (racineDonnees: string): string =>
  join(racineDonnees, 'reprises-en-cours.json')
