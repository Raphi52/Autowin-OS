import { cadrageRefuse } from '../orchestration/frame-cas-limites'
import { FENETRE_FERMEE } from '../gates/etendue-repetee'
import type { ModelQuestion } from '../modeles/model-questions'
import { messageDuRun } from '../../shared/message-du-run'

/**
 * UN CADRAGE RELU À FROID AVANT LE CODE (2026-11-01, repris de Google Elephant-Goldfish).
 *
 * Rien ne comparait le cadrage à la demande avant le build. Une réduction de la demande n'apparaissait
 * donc qu'au juge final, après un ou plusieurs builds payés.
 *
 * MESURE, rejouée sur 7 vrais cadrages avec le modèle des petites tâches, sans outil (0,06 $ en
 * moyenne par relecture) : les 3 cadrages qui avaient réduit la demande sont repérés (deux
 * runs : « full anglais » réduit à un lot ; : test réel sorti du périmètre). Sur 4 témoins,
 * 1 fausse alerte. Le gain en argent n'est PAS prouvé : seule la détection l'est, et la mesure
 * `/arena` reste à faire.
 *
 * QUATRE BORNES, et chacune répond à un risque :
 *  - une seule relecture par run : ce contrôle n'est pas une boucle de plus ;
 *  - une alerte ne bloque rien, elle relance le cadrage une fois. Une fausse alerte se règle alors
 *    sans l'utilisateur (`Écart assumé`), et un vrai choix lui remonte avant le code ;
 *  - une panne de relecture ne coûte jamais le run : l'appelant continue et le dit dans la trace ;
 *  - une question laissée ouverte ne retient le run que `DELAI_QUESTION_CADRAGE_MS`.
 *
 * LES TÂCHES CRITIQUES SEULEMENT, comme le voulait la demande (« commencer par les tâches critiques,
 * puis mesurer »). Repassés dans `classifyRegime`, 19 des 131 runs cadrage + build du corpus sont
 * critiques ; l'en-tête `regime: standard` de leurs RUN.md est écrit en dur par `runs/conv-runs.ts`
 * et ne prouve rien. LIMITE CONNUE : qui ont servi à mesurer la détection,
 * sont standard, et ce filtre les aurait laissés passer. Étendre la relecture aux tâches standard
 * se décide après la mesure `/arena`.
 *
 * HORS DEVIS, comme l'arbitrage d'une dérive : ni l'appel ni la reprise ne comptent dans le pire cas
 * d'un graphe. Sans danger tant que les plafonds d'appels restent ceux des préréglages (1 000 à
 * 20 000) ; un plafond d'appels serré, quel que soit le mode, devrait d'abord les compter.
 *
 * PUR : pas d'horloge, pas de provider, aucune E/S.
 */

/** Bornes de ce que lit le relecteur. Le plus long cadrage rejoué fait 32 Ko, et coûte 0,13 $. */
export const BORNE_DEMANDE = 8_000
export const BORNE_CADRAGE = 40_000

/**
 * Combien de temps une question du cadrage repris retient le run. Sans borne, une fenêtre
 * ignorée le gardait en attente avant le code. Passé ce délai, le run suit le cadrage tel qu'il est
 * écrit, et la trace dit que la question est restée sans réponse.
 */
export const DELAI_QUESTION_CADRAGE_MS = 30 * 60_000

const MAX_ECARTS = 8
const MAX_CARACTERES_PAR_ECART = 600

function borne(texte: string, plafond: number): { texte: string; coupe: boolean } {
  return texte.length > plafond
    ? { texte: texte.slice(0, plafond), coupe: true }
    : { texte, coupe: false }
}

/** Ce que reçoit le relecteur : la demande et le cadrage, rien d'autre. Une coupe se dit. */
export function promptDeRelecture(demande: string, cadrage: string): string {
  const d = borne(demande.trim(), BORNE_DEMANDE)
  const c = borne(cadrage.trim(), BORNE_CADRAGE)
  const coupe = (partie: { coupe: boolean }): string =>
    partie.coupe ? '\n[coupé ici : la suite n’a pas été lue, n’en déduis aucun écart]' : ''
  return `=== DEMANDE D'ORIGINE ===\n${d.texte}${coupe(d)}\n\n=== CADRAGE ===\n${c.texte}${coupe(c)}`
}

export type IssueDeRelecture =
  { kind: 'conforme' } | { kind: 'ecarts'; ecarts: string[] } | { kind: 'illisible' }

/** Ce qui entoure souvent la ligne attendue : puce, numéro, gras, code, citation. */
const DECOR_DEBUT = /^[\s>*_`•-]*(?:\d+[.)]\s*)?[*_`]*/u
const DECOR_FIN = /[\s*_`]+$/u
const LIGNE_AUCUN = /^[ÉE]CARTS?\s*[*_`]*\s*:\s*[*_`]*\s*aucun\b/iu
const LIGNE_ECART = /^[ÉE]CART\s*[*_`]*\s*:\s*[*_`]*\s*(\S.*)$/iu

/**
 * Lit la réponse du relecteur. Les écarts priment sur un `ÉCARTS: aucun` : une alerte de trop coûte
 * un cadrage, un écart perdu peut coûter un build entier.
 */
export function lireRelecture(reponse: string): IssueDeRelecture {
  const lignes = (reponse ?? '')
    .normalize('NFC')
    .split(/\r?\n/u)
    .map((ligne) => ligne.replace(DECOR_DEBUT, '').replace(DECOR_FIN, ''))
  const aucun = lignes.some((ligne) => LIGNE_AUCUN.test(ligne))
  const ecarts = lignes.flatMap((ligne) => {
    if (LIGNE_AUCUN.test(ligne)) return []
    const trouve = LIGNE_ECART.exec(ligne)?.[1]
    return trouve ? [trouve.slice(0, MAX_CARACTERES_PAR_ECART)] : []
  })
  if (ecarts.length > 0) return { kind: 'ecarts', ecarts: ecarts.slice(0, MAX_ECARTS) }
  return aucun ? { kind: 'conforme' } : { kind: 'illisible' }
}

/**
 * La relecture part-elle ? Le cadrage complet d'une tâche critique, joué par CE run, suivi d'un
 * build, une seule fois.
 */
export function relectureAPasser(etat: {
  dejaFaite: boolean
  /** Le run prévoit un build : un cadrage qui est lui-même le résultat n'a rien à protéger. */
  buildPrevu: boolean
  /** Faux pour un cadrage repris après un redémarrage : déjà payé, la suite l'a peut-être utilisé. */
  cadrageJoue: boolean
  /** Le cadrage a écrit `SUITE: fin` : aucune suite à protéger. */
  arretDemande: boolean
  annule: boolean
  /** Le run est classé critique : son devis, sinon le texte de la demande. */
  critique: boolean
  cadrage: string
}): boolean {
  return (
    !etat.dejaFaite &&
    etat.buildPrevu &&
    etat.cadrageJoue &&
    !etat.arretDemande &&
    !etat.annule &&
    etat.critique &&
    etat.cadrage.trim().length > 0 &&
    // Le refus des cas limites repart déjà en `frame` : on relira la version complète.
    !cadrageRefuse(etat.cadrage)
  )
}

/**
 * La consigne de la reprise. Le relecteur n'a vu ni le fil ni le code : il peut se tromper. La sortie
 * `Écart assumé` existe pour ça, sinon une fausse alerte élargirait le travail pour lui plaire.
 */
export function consigneDeReprise(ecarts: readonly string[]): string {
  const liste = ecarts.map((ecart) => `- ÉCART: ${ecart}`).join('\n')
  return (
    `⛔ Relecture à froid du cadrage — ${ecarts.length} écart(s) avec la demande d'origine.\n` +
    `Un relecteur qui n'a lu que la demande et ton cadrage a relevé :\n${liste}\n` +
    'Refais le cadrage, une seule fois. Pour CHAQUE écart, choisis une sortie :\n' +
    '- couvre ce que la demande exige ;\n' +
    '- ou, si la demande permet vraiment ce choix, écris sous `## Besoin` : `Écart assumé : <raison>` ;\n' +
    "- ou, si le choix revient à l'utilisateur, écris dans ton bilan " +
    '`- Question : <question> → <réponse recommandée> | <autre réponse>` : elle lui sera posée avant le code.\n' +
    "Ce relecteur n'a vu ni le fil ni le code : s'il se trompe, dis-le dans `Écart assumé`, n'élargis pas " +
    'le travail pour lui donner raison. Il ne relira pas ta nouvelle version.'
  )
}

/** La question du cadrage repris, dans la forme de la fenêtre de question. */
export function questionDuCadrageRepris(cadrage: string): ModelQuestion | undefined {
  const message = messageDuRun([{ text: cadrage }])
  if (!message) return undefined
  return {
    text: message.question,
    options: message.reponses.map((reponse) => reponse.libelle),
    reason: 'material-ambiguity'
  }
}

/** La réponse à porter au build, ou rien si la question est restée sans réponse. */
export function consigneDeLaReponse(reponse: string | undefined): string | undefined {
  const texte = (reponse ?? '').trim()
  return texte && texte !== FENETRE_FERMEE ? texte : undefined
}

/** La ligne de trace : c'est elle qui permettra de mesurer la relecture après coup. */
export function ligneDeRelecture(issue: IssueDeRelecture, coutUsd: number | undefined): string {
  const cout = coutUsd === undefined ? 'coût inconnu' : `${coutUsd.toFixed(4)} $`
  if (issue.kind === 'conforme') return `Relecture à froid du cadrage : aucun écart (${cout}).`
  if (issue.kind === 'illisible') {
    return `Relecture à froid du cadrage : réponse illisible, le run continue (${cout}).`
  }
  return (
    `Relecture à froid du cadrage : ${issue.ecarts.length} écart(s) (${cout}), le cadrage repart une fois — ` +
    issue.ecarts.join(' ; ')
  )
}

/** La ligne de trace d'une panne : elle ne coûte pas le run, elle se dit. */
export function ligneDePanneDeRelecture(erreur: unknown): string {
  const motif = erreur instanceof Error ? erreur.message : String(erreur)
  return `Relecture à froid du cadrage en panne, le run continue sans elle : ${motif.slice(0, 300)}`
}

/** Le résumé écrit dans `cost.jsonl`, une ligne courte. */
export function issueDeRelecturePourLeCout(issue: IssueDeRelecture): string {
  if (issue.kind === 'ecarts') return `${issue.ecarts.length} écart(s)`
  return issue.kind === 'conforme' ? 'aucun écart' : 'réponse illisible'
}
