import { mkdirSync } from 'node:fs'
import { readdir, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { ensureAutowinAppData } from '../app-data'

/**
 * LA COPIE ENTIERE ET DURABLE DES SORTIES D'ETAPES D'UN RUN (conv-989, 2026-10-16).
 *
 * Le juge lit chaque etape bornee (`agregerPhasesPourLeJuge`, 6 000 caracteres par etape, 60 000 au
 * total), et sa marque de coupe le renvoyait vers « le fil des sous-agents » — `trace.json`, lui-meme
 * plafonne a 4 000 caracteres par etape (`STEP_TEXT_CAP`, conv-runs.ts) : une copie PLUS courte que
 * celle qu'il avait sous les yeux. La seule copie entiere, `run-state/<run>.json`, est effacee des que
 * le run se regle (`onRunSettled`, os.ts). Aucun lecteur — juge, agent du chat, utilisateur — ne
 * pouvait donc lire la fin d'une etape longue.
 *
 * Ce fichier est ecrit a CHAQUE etape terminee, a cote du checkpoint de reprise, et n'est pas efface
 * a la cloture : c'est lui que nomme la marque de coupe. Markdown lisible tel quel, une section par
 * etape, dans l'ordre ou elles ont tourne.
 */
export const DOSSIER_LIVRABLES = 'run-livrables'

/**
 * 30 jours : bien au-dela des 7 jours des journaux de tour, parce que c'est le seul endroit ou le
 * travail d'une etape longue survit en entier. Purge a l'ecriture, sans tache dediee.
 */
export const RETENTION_LIVRABLE_MS = 30 * 24 * 3_600_000

export interface SortieDEtape {
  phase: string
  text: string
}

/** Meme regle que les journaux : un identifiant de run ne doit jamais sortir de son dossier. */
function segmentSur(runId: string): string {
  const nettoye = runId.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120)
  if (!nettoye || nettoye === '.' || nettoye === '..')
    throw new Error('identifiant de run invalide')
  return nettoye
}

export function cheminDuLivrableEntier(runId: string, base = ensureAutowinAppData()): string {
  return join(base, DOSSIER_LIVRABLES, `${segmentSur(runId)}.md`)
}

export function texteDuLivrableEntier(runId: string, sorties: readonly SortieDEtape[]): string {
  const sections = sorties.map(
    (sortie, rang) => `## ${rang + 1}. étape ${sortie.phase}\n\n${sortie.text.trim()}\n`
  )
  return `# Sorties entières du run ${runId}\n\n${sections.join('\n')}`
}

/**
 * Ecriture ATOMIQUE (temporaire puis `rename`) et DIFFEREE : le checkpoint de reprise voisin
 * bloquait le fil principal jusqu'a 10 s en synchrone (`gels.jsonl`, 2026-09-04).
 */
export async function ecrireLivrableEntier(
  runId: string,
  sorties: readonly SortieDEtape[],
  base = ensureAutowinAppData(),
  maintenant = Date.now()
): Promise<void> {
  if (!sorties.some((sortie) => sortie.text.trim())) return
  const fichier = cheminDuLivrableEntier(runId, base)
  const dossier = join(base, DOSSIER_LIVRABLES)
  mkdirSync(dossier, { recursive: true })
  const temporaire = `${fichier}.tmp`
  await writeFile(temporaire, texteDuLivrableEntier(runId, sorties), 'utf8')
  await rename(temporaire, fichier)
  await purgerLesAnciens(dossier, maintenant)
}

async function purgerLesAnciens(dossier: string, maintenant: number): Promise<void> {
  let noms: string[]
  try {
    noms = await readdir(dossier)
  } catch {
    return
  }
  for (const nom of noms) {
    if (!nom.endsWith('.md')) continue
    const chemin = join(dossier, nom)
    try {
      if (maintenant - (await stat(chemin)).mtimeMs > RETENTION_LIVRABLE_MS) await unlink(chemin)
    } catch {
      /* best-effort : un fichier verrouille sera purge a la prochaine ecriture */
    }
  }
}

/**
 * LA MEME COPIE, A COTE DU RUN.md (conv-989) — permanente, et lisible par le panneau du run.
 *
 * Le panneau « Fil des sous-agents » ouvre un run par le chemin de son RUN.md ; ni ce fichier ni
 * `trace.json` ne portent l'identifiant du run de l'orchestrateur, sous lequel `run-livrables` range
 * sa copie. Ecrite par la fin du run (`commands.ts`, qui connait les deux), la copie voisine se
 * retrouve par convention de nom, sans identifiant. Elle ne suit pas la purge a 30 jours : elle vit
 * et meurt avec son RUN.md.
 */
export const NOM_LIVRABLE_DU_RUN = 'livrable.md'

export function cheminDuLivrableDuRun(runPath: string): string {
  return join(dirname(runPath), NOM_LIVRABLE_DU_RUN)
}

export async function ecrireLivrableDuRun(
  runPath: string,
  libelle: string,
  sorties: readonly SortieDEtape[]
): Promise<void> {
  if (!sorties.some((sortie) => sortie.text.trim())) return
  const fichier = cheminDuLivrableDuRun(runPath)
  const temporaire = `${fichier}.tmp`
  await writeFile(temporaire, texteDuLivrableEntier(libelle, sorties), 'utf8')
  await rename(temporaire, fichier)
}
