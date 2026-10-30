import type { PlanDeLots } from './plan-de-lots'

/*
 * CE QUE DIT LE FIL D'UN LOT, EN UNE LIGNE — CALCUL PUR, partagé par le processus principal et l'écran.
 *
 * Né dans `frise-des-lots.ts` (conv-1305), côté écran : il ne lisait donc que les fils déjà peints, et
 * un lot jamais ouvert gardait sa piste vide. Déplacé ici (conv-1315, 2026-10-30) : le processus
 * principal tient TOUS les fils en mémoire, tour en cours compris (`applyTurnEvent`), et rend chaque
 * phrase par le canal `os:plansDeLots`, sans faire traverser les messages.
 */

/** Au-delà, la phrase d'un lot ne tient plus sur sa ligne de piste. */
export const PHRASE_MAX = 160

/** Lignes qui ne disent rien à un humain : marqueurs techniques, blocs de code, HTML, tableaux. */
const LIGNE_TECHNIQUE = /^(?:AUTOWIN_[A-Z_]+\d*:|```|<|\||[-=*_]{3,}$)/u
/**
 * Lignes écrites par l'app ou par la forme de clôture, pas par le lot : les rubriques de fin de tour
 * et le bandeau d'un fil repris (mesuré sur conv-1307 : ce bandeau passait pour le résultat du lot).
 */
const LIGNE_DE_CADRE = /^(?:✅ Fait|📍 Maintenant|⏳ Reste à faire|👉 Recommandé|Reprise du fil\b)/u

const lisible = (ligne: string): string =>
  ligne
    .replace(/[*_`]/g, '')
    .replace(/^[\s#>•\-\d.)]+/u, '')
    .replace(/\s+/g, ' ')
    .trim()

const lignesLisibles = (texte: string): string[] =>
  texte
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !LIGNE_TECHNIQUE.test(l))
    .map(lisible)
    .filter((l) => l && !LIGNE_DE_CADRE.test(l))

export type MessagePourPhrase = {
  role: string
  content?: string
  parts?: ReadonlyArray<{ kind: string; text?: string }>
}

/**
 * Les textes d'un message, dans l'ordre. Un tour en écrit un par étape, entre deux outils : c'est pour
 * ça que la phrase d'un lot fini se lit dans le DERNIER (mesuré sur conv-1259, 24 textes : le premier
 * disait « Je lis encore les outils de capture », le dernier « J'ai fait les 21 captures »).
 */
function textesDuMessage(message: MessagePourPhrase): string[][] {
  const textes = message.parts
    ? message.parts.flatMap((p) => (p.kind === 'text' && p.text ? [p.text] : []))
    : [message.content ?? '']
  return textes.map(lignesLisibles).filter((lignes) => lignes.length > 0)
}

/**
 * CE QUE DIT LE FIL, sur la piste de son lot. Lot qui tourne : la DERNIÈRE ligne écrite (ce qu'il fait
 * en ce moment). Lot fini : la PREMIÈRE ligne de son dernier texte, celle qui porte le résultat.
 * `undefined` quand le fil n'a encore rien écrit.
 */
export function phraseDuFil(
  messages: readonly MessagePourPhrase[],
  enCours: boolean
): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message.role !== 'assistant') continue
    const dernier = textesDuMessage(message).at(-1)
    const ligne = enCours ? dernier?.at(-1) : dernier?.[0]
    if (ligne) return ligne.length > PHRASE_MAX ? `${ligne.slice(0, PHRASE_MAX - 1)}…` : ligne
    if (!enCours) return undefined
  }
  return undefined
}

/** La phrase de chaque lot lancé, par rang. Un fil inconnu ou muet ne donne aucune entrée. */
export function phrasesDesLots(
  plan: Pick<PlanDeLots, 'lots'>,
  messagesDuFil: (fil: string) => readonly MessagePourPhrase[] | undefined
): Record<number, string> {
  const phrases: Record<number, string> = {}
  for (const lot of plan.lots) {
    const messages = lot.fil ? messagesDuFil(lot.fil) : undefined
    const phrase = messages ? phraseDuFil(messages, lot.etat === 'en-cours') : undefined
    if (phrase) phrases[lot.rang] = phrase
  }
  return phrases
}
