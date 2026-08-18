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
  /**
   * L'intégration n'a pas ÉCHOUÉ, elle est DIFFÉRÉE : la base portait une opération git en cours au
   * moment de la finalisation (`blocked` / `base-in-progress`), et le coordinateur a programmé une
   * reprise automatique. Distinguer ce cas de `kept` n'est pas cosmétique — mesuré le 2026-08-18 :
   * les 24 copies présentes sur disque portaient TOUTES un commit déjà ancêtre du HEAD de la base
   * (0 orpheline), donc l'avertissement « rien n'est publié » était faux dans 100 % des cas. Il est
   * écrit une seule fois à la clôture, la reprise fusionne ensuite, et personne ne le corrige.
   */
  | 'pending'

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

/**
 * Note ajoutée quand l'intégration est DIFFÉRÉE, pas ratée.
 *
 * `isolatedWorkNotice` affirme « rien n'est publié » — un état DÉFINITIF. Or `base-in-progress` est
 * réessayable (`run-worktree-coordinator.ts`, jusqu'à 6 reprises) : la phrase était donc un verdict
 * posé sur un état encore en mouvement, et la reprise la démentait sans que rien ne la réécrive.
 * Celle-ci ne promet pas la publication et ne la nie pas : elle dit ce qui est vrai à cet instant.
 */
export function pendingIntegrationNotice(worktreeCwd: string): string {
  return (
    `⏳ Intégration DIFFÉRÉE, pas échouée : la base portait une opération git en cours, une reprise ` +
    `automatique est programmée. En attendant, le travail est dans la copie isolée ${worktreeCwd} ` +
    `(rien n'est perdu ; vérifie la publication avant de conclure qu'elle a manqué).`
  )
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
  if (disposition === 'kept' || disposition === 'pending') {
    // Les chemins restent bons : on n'y touche PAS, on explique juste ou le travail attend. Le
    // LIBELLE, lui, depend de la nature du sursis : definitif (`kept`) ou differe (`pending`).
    const notice =
      disposition === 'pending'
        ? pendingIntegrationNotice(worktreeCwd)
        : isolatedWorkNotice(worktreeCwd)
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
