/**
 * LES DUELS D'ARENE DEJA MESURES, LUS — PAS REJOUES.
 *
 * `scripts/arena-duel.mjs` ecrit `.autowin-data/<profil>/arena-duels.jsonl` (append seul) : 82
 * duels horodates portant `workflow`, `dureeMs`, `coutUsd`, `verdict`. Aucun fichier de `src/` ne
 * le lisait : la vue des workflows promet de « comparer » en REJOUANT l'objectif, donc en repayant
 * (2,1 a 16 min et 0,55 a 5,51 $ par bras) une mesure deja acquise sur disque.
 *
 * Lecture seule, bornee aux dernieres lignes. Une ligne illisible ou sans `workflow` est ignoree :
 * un journal append-only ecrit par un script externe n'est jamais suppose parfait.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface AgregatDuels {
  /** Nombre de duels retenus pour ce workflow. */
  duels: number
  /** Mediane, pas moyenne : un bras aberrant (98 min) ne doit pas deplacer le repere. */
  dureeMedianeMs: number
  coutMedianUsd: number
  /** Comptage par valeur de verdict, tel qu'ecrit par le banc. */
  verdicts: Record<string, number>
  /** Date ISO du duel le plus recent retenu. */
  dernierTs?: string
}

interface LigneDuel {
  workflow?: unknown
  dureeMs?: unknown
  coutUsd?: unknown
  verdict?: unknown
  ts?: unknown
}

const mediane = (valeurs: number[]): number => {
  if (valeurs.length === 0) return 0
  const tri = [...valeurs].sort((a, b) => a - b)
  const milieu = Math.floor(tri.length / 2)
  return tri.length % 2 === 1 ? tri[milieu] : (tri[milieu - 1] + tri[milieu]) / 2
}

/**
 * `racineDonnees` : le dossier qui contient `arena-duels.jsonl`.
 * `derniers` : borne haute du nombre de lignes relues (defaut 500).
 */
export function lireDuelsParWorkflow(
  racineDonnees: string,
  derniers = 500
): Record<string, AgregatDuels> {
  const fichier = join(racineDonnees, 'arena-duels.jsonl')
  if (!existsSync(fichier)) return {}

  let brut = ''
  try {
    brut = readFileSync(fichier, 'utf8')
  } catch {
    return {}
  }

  const lignes = brut.split(/\r?\n/).filter(Boolean).slice(-Math.max(1, derniers))
  const parWorkflow = new Map<
    string,
    {
      lignes: number
      durees: number[]
      couts: number[]
      verdicts: Record<string, number>
      dernierTs?: string
    }
  >()

  for (const ligne of lignes) {
    let parsed: LigneDuel
    try {
      parsed = JSON.parse(ligne) as LigneDuel
    } catch {
      continue
    }
    const workflow = typeof parsed.workflow === 'string' ? parsed.workflow.trim() : ''
    if (!workflow) continue

    const entree = parWorkflow.get(workflow) ?? { lignes: 0, durees: [], couts: [], verdicts: {} }
    // On ne compte que les lignes qui portent une MESURE : une ligne nue afficherait sinon
    // « 1 duel · 0 s · 0,00 $ », soit exactement le zero trompeur qu'on refuse.
    const mesuree =
      typeof parsed.dureeMs === 'number' ||
      typeof parsed.coutUsd === 'number' ||
      typeof parsed.verdict === 'string'
    if (mesuree) entree.lignes += 1
    if (typeof parsed.dureeMs === 'number' && Number.isFinite(parsed.dureeMs)) {
      entree.durees.push(parsed.dureeMs)
    }
    if (typeof parsed.coutUsd === 'number' && Number.isFinite(parsed.coutUsd)) {
      entree.couts.push(parsed.coutUsd)
    }
    if (typeof parsed.verdict === 'string' && parsed.verdict) {
      entree.verdicts[parsed.verdict] = (entree.verdicts[parsed.verdict] ?? 0) + 1
    }
    if (typeof parsed.ts === 'string' && (!entree.dernierTs || parsed.ts > entree.dernierTs)) {
      entree.dernierTs = parsed.ts
    }
    parWorkflow.set(workflow, entree)
  }

  const sortie: Record<string, AgregatDuels> = {}
  for (const [workflow, e] of parWorkflow) {
    sortie[workflow] = {
      duels: e.lignes,
      dureeMedianeMs: mediane(e.durees),
      coutMedianUsd: mediane(e.couts),
      verdicts: e.verdicts,
      dernierTs: e.dernierTs
    }
  }
  return sortie
}
