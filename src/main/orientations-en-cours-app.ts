import { randomUUID } from 'node:crypto'
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { autowinAppDataRoot } from './app-data'
import { lignesDuJournal } from '../shared/messages-entre-fils'
import {
  NOM_JOURNAL_ORIENTATIONS,
  deposerOrientation,
  solderOrientations,
  type IoJournalOrientations
} from '../shared/orientations-en-cours'

/**
 * ORIENTATIONS EN COURS, CÔTÉ APP (conv-1241, 2026-10-28) — voir `shared/orientations-en-cours.ts`.
 *
 * La file en mémoire (`pendingDirectives`, `index.ts`) reste la source du tour : ce journal ne fait
 * que la DOUBLER pour le contrôle lancé avant chaque outil du CLI Claude, qui tourne dans un autre
 * processus. Toute panne d'écriture ou de lecture rend la file intacte : c'est le comportement
 * d'avant le journal (orientation relue entre deux appels, ou rendue à l'écran en fin de tour).
 */

/** À côté du registre des réservations (`reservation-fichiers-app.ts`), où le contrôle le cherche. */
export function cheminJournalOrientations(racine = autowinAppDataRoot()): string {
  return join(racine, NOM_JOURNAL_ORIENTATIONS)
}

const ioNode: IoJournalOrientations = {
  lire: (p) => {
    try {
      return readFileSync(p, 'utf8')
    } catch (e) {
      if ((e as NodeJS.ErrnoException)?.code === 'ENOENT') return ''
      throw e
    }
  },
  ajouter: (p, ligne) => {
    mkdirSync(dirname(p), { recursive: true })
    appendFileSync(p, `${ligne}\n`, 'utf8')
  }
}

/** Double dans le journal une orientation que l'app vient de mettre dans la file du tour. */
export function deposerOrientationDuFil(
  fil: string,
  texte: string,
  io: IoJournalOrientations = ioNode,
  journal = cheminJournalOrientations()
): void {
  try {
    deposerOrientation(io, journal, { id: randomUUID(), at: Date.now(), fil, texte })
  } catch (e) {
    console.warn('[orientations] dépôt impossible, relecture entre deux appels seulement', e)
  }
}

/**
 * L'app sort `textes` de la file du fil : relus par la boucle pilote (`tour`) ou rendus à l'écran en
 * fin de tour (`rendue`). Rend ceux que le contrôle n'a pas déjà remis au modèle.
 */
export function solderOrientationsDuFil(
  fil: string,
  textes: string[],
  par: 'tour' | 'rendue',
  io: IoJournalOrientations = ioNode,
  journal = cheminJournalOrientations()
): string[] {
  if (!textes.length) return textes
  try {
    return solderOrientations(io, journal, fil, textes, Date.now(), par, lignesDuJournal)
  } catch (e) {
    console.warn('[orientations] solde impossible, file rendue telle quelle', e)
    return textes
  }
}
