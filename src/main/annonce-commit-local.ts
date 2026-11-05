import { messageCommitAgent } from './store/worktree-manager'
import { titreDuBandeau } from './titre-bandeau-git'

/**
 * Ce que la clôture automatique a fait du commit sur le dépôt distant. Absent = rien poussé.
 * Lu dans le compte rendu de la clôture (`AutoCloseResult` de `run-autoclose.ts`), jamais deviné.
 */
export interface PushDuRun {
  branche: string
  /** `pr` : push direct refusé, repli sur une branche dédiée. */
  mode?: 'direct' | 'pr'
}

/**
 * Traduit le compte rendu de la clôture en état du push. `undefined` pour tout ce qui n'a rien
 * poussé : clôture éteinte (elle ne rend rien), commit seul, publication sautée ou forme inconnue.
 */
export function pushDuCompteRendu(compteRendu: unknown): PushDuRun | undefined {
  if (typeof compteRendu !== 'object' || compteRendu === null) return undefined
  const { status, branch, mode } = compteRendu as {
    status?: unknown
    branch?: unknown
    mode?: unknown
  }
  if (status !== 'pushed' || typeof branch !== 'string' || !branch.trim()) return undefined
  return { branche: branch.trim(), ...(mode === 'direct' || mode === 'pr' ? { mode } : {}) }
}

/**
 * Ligne qui ANNONCE, dans la réponse d'un run, le commit qu'il a créé pour ramener son travail.
 *
 * Ce commit est le transport obligatoire de la copie isolée vers la branche de l'utilisateur. Il
 * arrivait sans un mot : l'utilisateur découvrait `agent run-xxx-1` dans son historique et croyait
 * que le run avait commité en cachette malgré la consigne (conv-710). Rend `undefined` quand aucun
 * commit n'a été créé par ce run (rien de modifié, ou issue autre qu'une fusion).
 *
 * Le push est dit d'après `push`, le compte rendu de la clôture : « non poussé » était écrit en dur,
 * et la clôture automatique a poussé `494e7d45` puis `e4daf170` sur `origin/main` le 2026-10-24
 * sous cette phrase (conv-1139).
 */
export function annonceCommitLocal(
  issue: unknown,
  agentId: string,
  task: string | undefined,
  push?: PushDuRun
): string | undefined {
  if (typeof issue !== 'object' || issue === null) return undefined
  const { outcome, committed, publishedSha } = issue as {
    outcome?: unknown
    committed?: unknown
    publishedSha?: unknown
  }
  if (outcome !== 'merged' || committed !== true) return undefined
  const sha = typeof publishedSha === 'string' && publishedSha.trim() ? publishedSha.trim() : ''
  // `publishedSha` est la tête posée sur la branche (le commit lui-même ou sa fusion) : on la cite
  // comme adresse de l'intégration, et on donne le message du commit créé, sans les confondre.
  const tete = sha ? ` (tête de branche \`${sha.slice(0, 8)}\`)` : ''
  const message = `« ${messageCommitAgent(agentId, task)} », intégré dans ta branche${tete}`
  const transport = `C'est lui qui ramène le travail de la copie isolée.`
  if (!push) return `Commit local créé : ${message}, non poussé. ${transport}`
  const destination =
    push.mode === 'pr'
      ? `sur la branche dédiée \`origin/${push.branche}\``
      : `sur \`origin/${push.branche}\``
  const phrase = `Commit créé : ${message}, puis poussé ${destination} par la clôture automatique. ${transport}`
  return sha ? `${bandeauGit(sha, messageCommitAgent(agentId, task), push)}\n\n${phrase}` : phrase
}

const echapper = (texte: string): string =>
  texte.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/**
 * Le même bandeau « GIT : N commit » que la passe /git après un fil (`bandeauPublie`, conv-1553).
 * conv-1558 : les trois lots d'un plan ont poussé par la clôture automatique, et l'utilisateur n'a
 * vu aucun bandeau — celui-ci ne couvrait que la passe /git. La ligne est celle que
 * `run-autoclose.ts` envoie (`git push origin <sha>:refs/heads/<branche>`, `ALLOW_MAIN_PUSH=1`
 * en direct), pas une ligne lue dans un shell : la clôture appelle git sans passer par lui.
 */
function bandeauGit(sha: string, sujet: string, push: PushDuRun): string {
  const accord = push.mode === 'direct' ? 'ALLOW_MAIN_PUSH=1 ' : ''
  const ligne = `${accord}git push origin ${sha}:refs/heads/${push.branche}`
  return [
    '```html-render',
    '<style>.awp-shell{white-space:pre-wrap;word-break:break-all;margin:4px 0}</style>',
    // Titre = statut lu sur la ligne envoyée, comme le bloc de la passe /git (conv-1573).
    `<div class="aw-kicker">${echapper(titreDuBandeau(1, [ligne]))}</div>`,
    `<div><b>Commit et push</b> : <b class="aw-chiffre">1 commit</b> <b>en ligne</b> par la clôture automatique.</div>`,
    `<div><span class="aw-chip">${echapper(sha.slice(0, 8))}</span> ${echapper(sujet)}</div>`,
    `<pre class="aw-chip awp-shell">${echapper(ligne)}</pre>`,
    '```'
  ].join('\n')
}
