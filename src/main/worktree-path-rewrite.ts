/**
 * UN RAPPORT NE DOIT PAS POINTER VERS UN DOSSIER QUI N'EXISTE PLUS.
 *
 * Constaté le 2026-07-29, dit par l'agent lui-même en fin de run : « Le rapport pointe vers un worktree
 * qui n'existe plus — je vérifie si le résultat a été rapatrié dans le workspace. » Un run de mutation
 * travaille dans une COPIE isolée (worktree), y écrit ses fichiers, et rédige son rapport avec les
 * chemins de cette copie. Puis la fin de run fusionne le travail dans la base et SUPPRIME la copie :
 * tous les chemins du rapport deviennent morts, alors que les fichiers, eux, sont bien arrivés.
 *
 * Ce module traduit les chemins. Il ne déplace aucun fichier et ne juge pas du succès : il reçoit le
 * verdict de fusion et se contente de dire la vérité correspondante.
 *  - fusionné  → les chemins sont réécrits vers le workspace de base (là où les fichiers SONT).
 *  - conservé  → les chemins de la copie restent VALIDES ; on ajoute où le travail attend, pour que
 *                l'utilisateur sache que ce dossier inhabituel est voulu, pas un accident.
 */

/** Ce que la fin de run a fait de la copie isolée. */
export type WorktreeDisposition =
  /** Le travail est dans la base ; la copie a disparu. */
  | 'merged'
  /** La copie est conservée (run non vert, conflit) : ses chemins existent toujours. */
  | 'kept'

/** Normalise les séparateurs pour comparer deux chemins Windows écrits différemment. */
function normalizeSeparators(value: string): string {
  return value.replace(/\\/g, '/')
}

function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Remplace toute occurrence du chemin de la copie isolée par celui du workspace de base.
 *
 * Tolère les DEUX écritures du chemin (antislashs Windows et slashs), les antislashs DOUBLÉS que
 * produit une sérialisation JSON, et la casse (Windows ne la distingue pas). Le séparateur d'origine de
 * chaque occurrence est PRÉSERVÉ : réécrire un chemin JSON avec des slashs simples casserait le JSON.
 */
export function rewriteWorktreePaths(
  text: string,
  worktreeCwd: string,
  baseWorkspace: string
): string {
  if (!text || !worktreeCwd || !baseWorkspace) return text
  if (normalizeSeparators(worktreeCwd) === normalizeSeparators(baseWorkspace)) return text
  const slashed = normalizeSeparators(worktreeCwd).replace(/\/+$/, '')
  if (!slashed) return text
  // Un motif unique couvre les trois ecritures : chaque separateur accepte /, \ ou \\.
  const pattern = slashed
    .split('/')
    .map(escapeForRegex)
    .join('(?:\\\\\\\\|\\\\|/)')
  const base = normalizeSeparators(baseWorkspace).replace(/\/+$/, '')
  return text.replace(new RegExp(pattern, 'gi'), (match) => {
    // Rendre le remplacement dans le MEME style que l'occurrence trouvee.
    if (match.includes('\\\\')) return base.replace(/\//g, '\\\\')
    if (match.includes('\\')) return base.replace(/\//g, '\\')
    return base
  })
}

/**
 * Note ajoutée quand la copie est CONSERVÉE. Sans elle, l'utilisateur voit un chemin sous
 * `worktrees/agent__run-…` sans savoir s'il doit s'en inquiéter.
 */
export function isolatedWorkNotice(worktreeCwd: string): string {
  return `⚠️ Travail NON fusionné : il reste dans la copie isolée ${worktreeCwd} (rien n'est perdu, rien n'est publié).`
}

export interface ReportPathsInput {
  /** Le texte du rapport. */
  result: string
  /** Les sorties de phase, qui citent les mêmes chemins. */
  phaseOutputs?: { phase: string; text: string }[]
}

/**
 * Aligne un rapport sur la réalité du disque après la fin de run. Rend un NOUVEL objet : l'appelant
 * décide d'écraser ou non, et rien n'est mué dans le dos d'un autre lecteur.
 */
export function alignReportWithDisk<T extends ReportPathsInput>(
  report: T,
  worktreeCwd: string | undefined,
  baseWorkspace: string,
  disposition: WorktreeDisposition
): T {
  if (!worktreeCwd) return report
  if (disposition === 'kept') {
    // Les chemins restent bons : on n'y touche PAS, on explique juste ou le travail attend.
    const notice = isolatedWorkNotice(worktreeCwd)
    return report.result.includes(notice)
      ? report
      : { ...report, result: `${report.result}\n\n${notice}` }
  }
  return {
    ...report,
    result: rewriteWorktreePaths(report.result, worktreeCwd, baseWorkspace),
    ...(report.phaseOutputs
      ? {
          phaseOutputs: report.phaseOutputs.map((output) => ({
            ...output,
            text: rewriteWorktreePaths(output.text, worktreeCwd, baseWorkspace)
          }))
        }
      : {})
  }
}
