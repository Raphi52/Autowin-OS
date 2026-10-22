import { spawnSync, type SpawnSyncReturns } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { autowinAppDataRoot } from './app-data'
import {
  refusCommitReserve,
  reserverOuRefuser,
  type IoCommitReserve,
  type IoReservation
} from '../shared/reservation-fichiers'

/**
 * RÉSERVATION DES FICHIERS, CÔTÉ APP (conv-1083, 2026-10-22).
 *
 * Le hook des agents Claude réserve avant chaque Edit/Write et refuse un commit qui emporterait le
 * fichier d'un autre fil (`shared/garde-git-destructeur.ts`). Les commandes de l'app servies à TOUT
 * modèle IA passaient à côté — le contrôle final l'a relevé deux fois : `edit_file`, puis le
 * `git commit` lancé par `run`. Elles consultent maintenant le MÊME registre, avec les mêmes règles.
 */

/** Le registre unique, partagé par le hook de chaque lancement et par `edit_file`. */
export function cheminRegistreReservations(racine = autowinAppDataRoot()): string {
  return join(racine, 'reservations-fichiers.json')
}

const ioNode: IoReservation = {
  lire: (p) => {
    try {
      return readFileSync(p, 'utf8')
    } catch {
      return undefined
    }
  },
  ecrire: (p, t) => {
    mkdirSync(dirname(p), { recursive: true })
    // Écriture en deux temps : un hook qui lit au même instant ne voit jamais un JSON coupé. Nom
    // temporaire unique PAR APPEL : deux fils d'exécution d'un même processus partagent son pid.
    const tmp = `${p}.${process.pid}.${randomUUID()}.tmp`
    writeFileSync(tmp, t, 'utf8')
    try {
      renameSync(tmp, p)
    } catch (e) {
      try {
        unlinkSync(tmp)
      } catch {
        // Déjà parti.
      }
      throw e
    }
  },
  // Appelé seulement quand un AUTRE fil tient le fichier (court-circuit de la règle) : le coût d'un
  // `git status` synchrone ne se paie que sur un conflit.
  estPropre: (c) => {
    const r = spawnSync('git', ['status', '--porcelain', '--', c], {
      cwd: dirname(c),
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true
    })
    return r.status === 0 ? !String(r.stdout || '').trim() : undefined
  }
}

const git = (dossier: string, args: string[]): SpawnSyncReturns<string> =>
  spawnSync('git', args, { cwd: dossier, encoding: 'utf8', timeout: 5000, windowsHide: true })

// Mêmes sondes git que le hook (`garde-git-destructeur.ts`, `ioReservation`) : une seule lecture de
// l'état, que le commit passe par le hook d'un agent Claude ou par `run`.
const ioCommitNode: IoCommitReserve = {
  lire: ioNode.lire,
  estPropre: ioNode.estPropre,
  estIndexe: (c) => {
    const r = git(dirname(c), ['diff', '--cached', '--name-only', '--', c])
    return r.status === 0 ? !!String(r.stdout || '').trim() : undefined
  },
  racineDepot: (d) => {
    const r = git(d, ['rev-parse', '--show-toplevel'])
    const s = r.status === 0 ? String(r.stdout || '').trim() : ''
    return s || undefined
  }
}

/**
 * Refus d'un `git commit` lancé par `run` au nom de `fil`, s'il emporterait un fichier qu'un AUTRE
 * fil tient encore (motif qui nomme ce fil), sinon `undefined`. Même politique que le hook : une
 * sonde qui plante laisse passer la commande plutôt que de bloquer tout commit.
 */
export function refusCommitDeFichierReserve(
  fil: string,
  commande: string,
  cwd: string,
  maintenant = Date.now()
): string | undefined {
  if (!/\bcommit\b/.test(commande)) return undefined
  try {
    return refusCommitReserve(
      ioCommitNode,
      { fil, registre: cheminRegistreReservations() },
      commande,
      cwd,
      maintenant,
      process.platform === 'win32'
    )
  } catch {
    return undefined
  }
}

/** Refus (motif qui nomme le fil propriétaire) ou `undefined` : le fichier est alors réservé à `fil`. */
export function refusReservationEdition(
  fil: string,
  chemin: string,
  maintenant = Date.now()
): string | undefined {
  return reserverOuRefuser(
    ioNode,
    { fil, registre: cheminRegistreReservations() },
    resolve(chemin),
    maintenant,
    process.platform === 'win32'
  )
}
