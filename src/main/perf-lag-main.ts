import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { resumerJalons, type RapportLatence } from '../shared/perf-lag'

/**
 * Cote main de l'onglet « Latence » : lit le journal de jalons ecrit par `turn-timing.ts` et rend
 * un rapport. Lecture SEULE, bornee aux derniers tours — une lenteur d'il y a trois semaines ne
 * decrit pas l'etat courant du produit.
 */
export interface RapportLatenceTours extends RapportLatence {
  /** FAUX quand aucun journal n'existe encore : la vue le DIT au lieu d'afficher un zero rassurant. */
  disponible: boolean
  source: string
}

export function lireLatenceTours(dir: string, derniers = 200): RapportLatenceTours {
  const source = join(dir, 'turn-timing.jsonl')
  if (!existsSync(source)) {
    return { ...resumerJalons([]), disponible: false, source }
  }
  const lignes = readFileSync(source, 'utf8').split(/\r?\n/).filter(Boolean)
  const fenetre = derniers > 0 ? lignes.slice(-derniers) : lignes
  return { ...resumerJalons(fenetre), disponible: true, source }
}
