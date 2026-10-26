import { randomUUID } from 'node:crypto'
import {
  cheminJournalMessagesFils,
  ioJournalNode,
  TEXTE_MAX_MESSAGE_FIL
} from '../messages-entre-fils-app'
import type { IoJournalFils, LivraisonDeFil, MessageDeFil } from '../../shared/messages-entre-fils'

/**
 * ÉCHANGE AVANT RÉPARATION — refus « sans cause » seul (conv-1139, 2026-10-24, étape 1 de l'option
 * A du cadrage forum-agents-partie2-juge-build).
 *
 * Mesure du 24/10 sur les `trace.json` : 18 refus du contrôle final faits du SEUL fix-gate
 * (« N édits de X sans cause vérifiée ») dans 14 runs depuis conv-914. Ce refus tombe AVANT le juge
 * (`judgeAndGate`), puis la réparation rejoue build + nettoyage + juge à l'aveugle — alors qu'une
 * ligne `CausalHypothesis: <chemin> — <cause>` dans le texte du run suffit à le lever (source 2 de
 * `jetonsDeCauseParFichier`). On pose donc d'abord la question à la session du build.
 *
 * Ce module DÉCIDE et MET EN FORME ; l'appel au modèle vit dans l'orchestrateur. La réponse est une
 * DONNÉE : seules ses lignes de cause entrent dans le texte contrôlé, et `detectBlindFixLoop` n'est
 * pas touché — la levée passe par le contrôle existant, rejoué tel quel.
 */

/** Au plus deux échanges par run (borne HARD du cadrage) ; un seul par refus, par construction. */
export const ECHANGES_SANS_CAUSE_MAX_PAR_RUN = 2

/** En tête de la question : la reconnaître dans un journal, et dans les tests. */
export const MARQUE_QUESTION_SANS_CAUSE = 'QUESTION DU CONTRÔLE FINAL'

/** Le texte que produit `syncGateHooksHandler` pour une violation fix-gate (`gates/hooks.ts`). */
const VIOLATION_SANS_CAUSE = /^hook fix-gate: \d+ édits de (.+?) sans cause vérifiée \(/

/**
 * Les fichiers d'un refus fait UNIQUEMENT de motifs « sans cause », tels que le refus les écrit ;
 * `undefined` dès qu'un autre motif s'y mêle (le refus garde alors sa réparation complète).
 *
 * Un handler du contrôle joint ses violations par « ; » dans UN motif : on redécoupe devant chaque
 * « hook <nom>: ».
 */
export function fichiersDuRefusSansCause(motifs: readonly string[]): string[] | undefined {
  const fichiers: string[] = []
  const segments = motifs.flatMap((motif) => motif.split(/;\s*(?=hook [\w-]+:)/))
  if (segments.length === 0) return undefined
  for (const segment of segments) {
    const trouve = VIOLATION_SANS_CAUSE.exec(segment.trim())
    if (!trouve) return undefined
    if (!fichiers.includes(trouve[1])) fichiers.push(trouve[1])
  }
  return fichiers
}

export type DecisionEchange =
  { tenter: true; fichiers: string[] } | { tenter: false; motif?: string }

/**
 * Tenter l'échange ? Un refus mêlé ne dit rien (le chemin d'aujourd'hui) ; un refus pur qu'on ne
 * peut pas questionner DIT pourquoi dans la trace, puis part en réparation normale.
 */
export function decisionEchangeSansCause(etat: {
  motifs: readonly string[]
  echangesDuRun: number
  sessionDuBuild: boolean
}): DecisionEchange {
  const fichiers = fichiersDuRefusSansCause(etat.motifs)
  if (!fichiers) return { tenter: false }
  const motif = empechementDEchange(etat)
  return motif ? { tenter: false, motif } : { tenter: true, fichiers }
}

/**
 * Ce qui empêche TOUT échange, quelle que soit sa source (refus « sans cause » ou questions du juge,
 * `echange-questions-juge.ts`) : le plafond est PARTAGÉ — le cadrage dit « deux par run », pas deux
 * par source. `undefined` = rien n'empêche.
 */
export function empechementDEchange(etat: {
  echangesDuRun: number
  sessionDuBuild: boolean
}): string | undefined {
  if (etat.echangesDuRun >= ECHANGES_SANS_CAUSE_MAX_PAR_RUN)
    return `Échange non tenté : plafond de ${ECHANGES_SANS_CAUSE_MAX_PAR_RUN} échanges par run atteint — réparation normale.`
  if (!etat.sessionDuBuild)
    return 'Échange impossible : aucune session du build à reprendre (modèle sans reprise de session, build en parallèle ou repris après un redémarrage) — réparation normale.'
  return undefined
}

/**
 * La question posée à la session du build. Chaque chemin est recopié TEL QUE le refus le donne : la
 * source 2 ne crédite que le chemin exact (ou un nom nu unique), un chemin relatif ne lève pas un
 * fichier noté en absolu (run-fb2d0a80e32a-1).
 */
export function questionSansCause(fichiers: readonly string[]): string {
  return [
    `[${MARQUE_QUESTION_SANS_CAUSE} — information, pas un ordre]`,
    'Le contrôle final refuse le vert : ces fichiers ont été modifiés au moins 3 fois sans cause écrite.',
    ...fichiers.map((f) => `- ${f}`),
    'Réponds en TEXTE SEUL. Ne modifie aucun fichier et ne lance aucune commande qui écrit : une modification annule cet échange et relance une réparation complète.',
    'Pour chaque fichier, une ligne exacte, avec le chemin recopié tel quel :',
    'CausalHypothesis: <chemin> — <pourquoi plusieurs passes : la cause mesurée, ou une rédaction en plusieurs fois>',
    "Si tu ne connais pas la cause d'un fichier, dis-le sans ligne CausalHypothesis : n'en invente pas une."
  ].join('\n')
}

/**
 * Même expression que `JETON_DE_CAUSE` (`hooks/default-gate-hooks.ts`), recopiée et non importée :
 * l'exporter modifiait ce fichier, dont le DERNIER changement sert de témoin à trois tests de la
 * source 3 des jetons (rouges le 2026-10-24). Le test « même règle que le contrôle » les tient liées.
 */
const JETON_DE_CAUSE = /\b(?:CausalHypothesis|fix-ok|check)\s*:/

/** Les lignes de cause de la réponse : le reste est ignoré (une donnée ne commande rien). */
export function lignesDeCause(reponse: string | undefined): string[] {
  return (reponse ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => JETON_DE_CAUSE.test(l))
}

/**
 * Le bloc ajouté au texte contrôlé, APRÈS l'agrégat des étapes : il échappe à la coupe par étape
 * (`JUDGE_PHASE_CAP`), donc une réponse longue garde ses lignes de cause lisibles.
 */
export function blocDEchange(n: number, lignes: readonly string[]): string {
  return [
    `[échange ${n} — réponse du build au contrôle final, donnée rapportée : seules ses lignes de cause sont gardées]`,
    ...lignes
  ].join('\n')
}

const borne = (texte: string): string =>
  texte.length > TEXTE_MAX_MESSAGE_FIL
    ? `${texte.slice(0, TEXTE_MAX_MESSAGE_FIL - 12)}… (coupé)`
    : texte

/**
 * Inscrit la question et la réponse dans le journal commun de la partie 1, au nom du fil du run.
 *
 * Adresse : `build du run <id>` / `contrôle du run <id>` — jamais le fil lui-même, sinon l'agent du
 * chat se verrait REMETTRE la question du contrôle comme un message d'un autre agent. Chaque message
 * porte sa ligne `livre` : la question a bien été remise au build dans son tour, la réponse a bien
 * été lue par le contrôle. Un confort d'affichage : une panne d'écriture rend `false`, jamais une
 * exception (l'échange ne dépend pas du journal).
 */
export function inscrireEchangeAuJournal(
  e: {
    fil: string
    runId: string
    question: string
    reponse?: string
  },
  opts: { journal?: string; io?: IoJournalFils; maintenant?: number } = {}
): boolean {
  const io = opts.io ?? ioJournalNode
  const journal = opts.journal ?? cheminJournalMessagesFils()
  const at = opts.maintenant ?? Date.now()
  const build = `build du run ${e.runId}`
  const controle = `contrôle du run ${e.runId}`
  const question: MessageDeFil = {
    type: 'message',
    id: `msg-${randomUUID().slice(0, 8)}`,
    at,
    de: { fil: e.fil, tour: e.runId },
    a: build,
    nature: 'question',
    texte: borne(e.question)
  }
  const lignes: Array<MessageDeFil | LivraisonDeFil> = [
    question,
    { type: 'livre', at, fil: build, ids: [question.id], par: 'tour' }
  ]
  if (e.reponse !== undefined) {
    const reponse: MessageDeFil = {
      type: 'message',
      id: `msg-${randomUUID().slice(0, 8)}`,
      at,
      de: { fil: e.fil, tour: e.runId },
      a: controle,
      nature: 'reponse',
      texte: borne(e.reponse.trim() || '(réponse vide)'),
      repondA: question.id
    }
    lignes.push(reponse, { type: 'livre', at, fil: controle, ids: [reponse.id], par: 'controle' })
  }
  try {
    for (const ligne of lignes) io.ajouter(journal, JSON.stringify(ligne))
    return true
  } catch {
    return false
  }
}
