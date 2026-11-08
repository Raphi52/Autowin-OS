import { bandeauPublie } from '../git/git-apres-fil'
import { messageCommitAgent } from '../store/worktree-manager'
import {
  avertissementDePublication,
  phraseDuRefus,
  refusDePublication,
  type RefusDePublication
} from '../../shared/echec-publication'

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
 * que le run avait commité en cachette malgré la consigne. Rend `undefined` quand aucun
 * commit n'a été créé par ce run (rien de modifié, ou issue autre qu'une fusion).
 *
 * Le push est dit d'après `push`, le compte rendu de la clôture : « non poussé » était écrit en dur,
 * et la clôture automatique a poussé `494e7d45` puis `e4daf170` sur `origin/main` le 2026-10-24
 * sous cette phrase.
 *
 * `refus` : l'envoi n'est pas parti et la clôture dit pourquoi. La réponse du run est le seul message
 * que l'utilisateur lit dans son fil : sans cette ligne, l'échec ne s'y voit pas.
 */
export function annonceCommitLocal(
  issue: unknown,
  agentId: string,
  task: string | undefined,
  push?: PushDuRun,
  refus?: RefusDePublication
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
  // fix-ok: sans le motif, la réponse ne dit que « non poussé » : l'échec ne se voit pas dans le fil.
  if (!push) {
    const commit = `Commit local créé : ${message}, non poussé. ${transport}`
    return refus ? `${commit}\n\n${phraseDuRefus(refus)}` : commit
  }
  const destination =
    push.mode === 'pr'
      ? `sur la branche dédiée \`origin/${push.branche}\``
      : `sur \`origin/${push.branche}\``
  const phrase = `Commit créé : ${message}, puis poussé ${destination} par la clôture automatique. ${transport}`
  return sha ? `${bandeauGit(sha, messageCommitAgent(agentId, task), push)}\n\n${phrase}` : phrase
}

/**
 * Le même bloc git que la passe /git après un fil (`bandeauPublie`).
 * Les trois lots d'un plan ont poussé par la clôture automatique, et l'utilisateur n'a
 * vu aucun bandeau — celui-ci ne couvrait que la passe /git. La ligne est celle que
 * `run-autoclose.ts` envoie (`git push origin <sha>:refs/heads/<branche>`, `ALLOW_MAIN_PUSH=1`
 * en direct), pas une ligne lue dans un shell : la clôture appelle git sans passer par lui.
 * Ce bloc avait sa propre copie de l'ancienne mise en page, et le rail compact
 * n'y est jamais arrivé ; il appelle donc `bandeauPublie` au lieu de la recopier.
 */
function bandeauGit(sha: string, sujet: string, push: PushDuRun): string {
  const accord = push.mode === 'direct' ? 'ALLOW_MAIN_PUSH=1 ' : ''
  const ligne = `${accord}git push origin ${sha}:refs/heads/${push.branche}`
  return bandeauPublie([{ sha: sha.slice(0, 8), sujet }], [ligne])
}

/** Ce que la annonce du refus a besoin du fil : le lire, et y poser un message de l'app. */
export interface FilDuRefus {
  get(id: string): { messages: ReadonlyArray<{ role: string; content: string }> } | undefined
  append(id: string, message: { role: 'assistant'; content: string }): unknown
}

/**
 * Pose dans le fil le refus d'une publication : celle d'un tour de chat, ou une publication reprise
 * au démarrage (la réponse du run, elle, est déjà partie). Sans ce message, l'échec ne se voit que
 * dans le panneau Git.
 *
 * Pas de doublon DANS LE TOUR COURANT : si la phrase y figure déjà (dans la réponse du run, ou posée
 * par un rejeu au démarrage), elle n'est pas reposée. Un refus identique d'un tour antérieur ne
 * compte pas : un nouveau tour qui échoue se dit, même avec le même texte. Rend `false` si rien
 * n'a été posé (fil disparu, ou refus déjà dit dans ce tour).
 */
export function annonceRefusAuFil(
  fil: FilDuRefus,
  conversationId: string,
  refus: RefusDePublication
): boolean {
  return annonceAuFil(fil, conversationId, phraseDuRefus(refus))
}

/**
 * Pose une phrase de l'app dans le fil, une fois par tour : un refus et une réserve passent par la même
 * règle de doublon, celle du tour courant.
 */
function annonceAuFil(fil: FilDuRefus, conversationId: string, phrase: string): boolean {
  const conversation = fil.get(conversationId)
  if (!conversation) return false
  if (dejaDitDansLeTourCourant(conversation.messages, phrase)) return false
  fil.append(conversationId, { role: 'assistant', content: phrase })
  return true
}

/** Le tour courant commence après le dernier message de l'utilisateur. */
function dejaDitDansLeTourCourant(
  messages: ReadonlyArray<{ role: string; content: string }>,
  phrase: string
): boolean {
  let debut = 0
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === 'user') {
      debut = i + 1
      break
    }
  }
  return messages.slice(debut).some((m) => m.role === 'assistant' && m.content.includes(phrase))
}

/**
 * Le refus d'un rapport de publication (le `project` d'un rapport de clôture), posé dans le fil de son
 * tour. Rend `false` quand rien n'est à dire : envoi parti, rien à envoyer, ou une attente
 * (`porte-en-attente`) qui se réessaie toute seule.
 */
export function annonceRefusDuProjet(
  fil: FilDuRefus,
  conversationId: string,
  projet: unknown
): boolean {
  // fix-ok: cause mesurée — un envoi parti avec une réserve (profil mal formé, rattachement refusé) ne
  // laissait aucune trace dans le fil : `refusDePublication` ne rend rien pour un envoi parti.
  const refus = refusDePublication(projet)
  if (refus) return annonceRefusAuFil(fil, conversationId, refus)
  const avertissement = avertissementDePublication(projet)
  return avertissement ? annonceAuFil(fil, conversationId, avertissement) : false
}
