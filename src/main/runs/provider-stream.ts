/**
 * LECTURE DU FLUX BRUT DU FOURNISSEUR (`run-stdout/<run>.stdout.jsonl`).
 *
 * Ce fichier est ce que le CLI du fournisseur a RÉELLEMENT émis : sa réflexion, chaque commande
 * avec son texte entier, chaque résultat, et le coût de chaque message. Le journal de tour, lui,
 * n'en garde qu'un résumé (`delta`, `command`, `result`). Le panneau Logs lisait le résumé ; il
 * peut désormais lire la source.
 *
 * Trois exigences tenues ici, et nulle part ailleurs :
 *  - AUCUNE COUPE : le fichier est lu ENTIER (par tranches, jamais un `readFileSync` d'un seul
 *    bloc), et aucune valeur n'est raccourcie. La borne d'affichage reste une borne de HAUTEUR.
 *  - MASQUAGE ≠ TRONCATURE : les jetons d'accès présents en clair dans la sortie du CLI sont
 *    remplacés par `[REDACTED]` (`redactTrace`), ce qui ne raccourcit aucun texte légitime.
 *  - LECTURE TOLÉRANTE : un fichier en cours d'écriture finit par une ligne incomplète. Elle n'est
 *    pas parsée à moitié, elle est comptée puis ignorée — jamais une exception à l'affichage.
 */
import { existsSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { redactTrace } from '../activity/trace-redact'
import { readChunkFrom, splitCompleteLines } from './stdout-journal'

export interface ProviderStreamRead {
  /** Lignes JSON lisibles, dans l'ordre d'émission, valeurs sensibles masquées. */
  lines: Array<Record<string, unknown>>
  /** Octets lus (fin de la dernière ligne complète). */
  offset: number
  /** Le fichier n'existe pas / plus : purgé par le ramasse-miettes, ou run d'un autre poste. */
  missing: boolean
  /** Lignes illisibles rencontrées (écriture en cours, ligne tronquée). Comptées, jamais tues. */
  unreadable: number
}

/**
 * Le chemin vient du RENDERER (il le lit dans l'événement `provider-journal`) : il est donc traité
 * comme une entrée non fiable. Seul un fichier `*.stdout.jsonl` SOUS la racine des flux bruts est
 * lisible ; toute autre demande est refusée, jamais « lue au cas où ».
 */
export function resolveProviderStreamPath(root: string, journalPath: string): string {
  if (!root) throw new Error('racine des flux bruts absente')
  if (typeof journalPath !== 'string' || !journalPath) throw new Error('chemin de flux invalide')
  const base = resolve(root)
  const cible = resolve(journalPath)
  if (cible !== base && !cible.startsWith(base.endsWith(sep) ? base : base + sep))
    throw new Error('chemin de flux hors de la racine des flux bruts')
  if (!cible.endsWith('.stdout.jsonl')) throw new Error('ce fichier n’est pas un flux brut')
  return cible
}

/** Lit tout le flux brut déjà écrit, par tranches, sans jamais charger le fichier d'un seul bloc. */
export function readProviderStream(
  path: string,
  options: { maxBytes?: number; chunkBytes?: number } = {}
): ProviderStreamRead {
  const chunkBytes = Math.max(options.chunkBytes ?? 1_000_000, 4_096)
  const maxBytes = options.maxBytes ?? Number.POSITIVE_INFINITY
  const lines: Array<Record<string, unknown>> = []
  let unreadable = 0
  let offset = 0
  let buffered = ''
  for (;;) {
    const restant = maxBytes - offset
    if (restant <= 0) break
    const { text, next } = readChunkFrom(path, offset, Math.min(chunkBytes, restant))
    if (!text) break
    offset = next
    buffered += text
    const decoupe = splitCompleteLines(buffered)
    buffered = decoupe.rest
    for (const ligne of decoupe.lines) {
      const valeur = parseLine(ligne)
      if (valeur) lines.push(valeur)
      else unreadable += 1
    }
  }
  // La ligne partielle n'est PAS consommée : l'offset rendu s'arrête devant elle pour qu'une
  // relecture la reprenne ENTIÈRE plutôt que coupée en deux.
  const partiel = Buffer.byteLength(buffered, 'utf8')
  if (buffered.trim()) unreadable += 1
  return {
    lines,
    offset: Math.max(offset - partiel, 0),
    missing: !existsSync(path),
    unreadable
  }
}

function parseLine(ligne: string): Record<string, unknown> | null {
  try {
    const valeur: unknown = JSON.parse(ligne)
    if (!valeur || typeof valeur !== 'object' || Array.isArray(valeur)) return null
    return redactTrace(valeur) as Record<string, unknown>
  } catch {
    return null
  }
}
