/**
 * LE MESSAGE D'ERREUR D'UNE ACTION ROUGE, sans un seul appel au modèle (conv-341, 2026-10-19).
 *
 * Demande de l'utilisateur : « quand y a une action rouge, c'est possible d'avoir le message d'erreur
 * que l'action a rencontré ? […] un truc qui coûte pas de token ». Le bloc Actions ne montrait que
 * « Glob — 25 s » en rouge, alors que l'outil avait rendu « Ripgrep search timed out after 20 seconds… »
 * et que ce texte était DÉJÀ reçu par l'adaptateur Claude (`tool_result`, `is_error: true`).
 *
 * Le journal d'actions n'est qu'une liste de LIGNES de texte, sauvegardées avec le message
 * (`actionsLog`). L'erreur y voyage donc en ligne à part, émise juste après la ligne de fin
 * (« Glob échoué - 25 s ») : `Glob erreur - Ripgrep search timed out…`. Une ligne À PART, et non un
 * suffixe de la ligne de fin, parce que plusieurs lecteurs attendent cette ligne EXACTE (décompte des
 * gestes `gestes-agent.ts`, trace du tour) : elle reste intacte, et ces lecteurs ignorent celle-ci.
 */

import { ACTIONS_LINE_MAX } from './chat-turn'

/**
 * Une ligne du journal d'actions plafonne à `ACTIONS_LINE_MAX` (chat-turn.ts). Avant conv-1228
 * (2026-10-28), 300 caractères : le message d'erreur d'une action rouge était amputé au bout de
 * deux lignes, souvent avant la ligne qui disait POURQUOI.
 */
const LIGNE_MAX = ACTIONS_LINE_MAX

/** Ce qu'on lit de la sortie au plus : une sortie Bash peut faire 20 000 caractères. */
const LECTURE_MAX = ACTIONS_LINE_MAX

const LIGNE_D_ERREUR = /^([A-Za-z][\w-]*) erreur - (.+)$/s

/**
 * Le message d'un outil en échec, sur UNE ligne : balises `<tool_use_error>` retirées, lignes vides
 * sautées, lignes jointes par « · ». Vide si l'outil n'a rien rendu.
 *
 * Formes relevées le 2026-10-19 dans 40 sessions : une phrase seule (Glob, Grep : « Ripgrep search
 * timed out… »), « Exit code N » suivi de la sortie (Bash, PowerShell), un refus entre balises
 * (`<tool_use_error>Blocked: …</tool_use_error>`).
 */
export function messageDErreur(retour: string): string {
  return retour
    .slice(0, LECTURE_MAX)
    .replace(/<\/?tool_use_error>/g, '')
    .split(/\r?\n/)
    .map((ligne) => ligne.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(' · ')
}

/** La ligne `<outil> erreur - <message>`, coupée pour tenir dans le journal ; rien sans message. */
export function ligneDErreurDAction(outil: string, retour: string): string | undefined {
  const message = messageDErreur(retour)
  if (!message) return undefined
  const tete = `${outil} erreur - `
  const place = LIGNE_MAX - tete.length
  if (message.length > place) return `${tete}${message.slice(0, place - 1).trimEnd()}…`
  // Une sortie plus longue que ce qu'on en lit est coupée, même si le message tient : on le dit.
  return `${tete}${message}${retour.length > LECTURE_MAX ? '…' : ''}`
}

/** L'outil et son message, si la ligne est une ligne d'erreur d'action ; sinon rien. */
export function lireLigneDErreur(ligne: string): { outil: string; message: string } | undefined {
  const m = LIGNE_D_ERREUR.exec(ligne.trim())
  return m ? { outil: m[1]!, message: m[2]!.trim() } : undefined
}
