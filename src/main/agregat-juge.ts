import { OUTCOME_LESSON_MARKER } from './outcome-learning-proposal'
import { AGGREGATE_MAX_CHARS } from './evidence-digest'
import { couperEnGardantLeBilan } from '../shared/bilan-d-etape'

/**
 * Le texte AGRÉGÉ d'un run à plusieurs phases : celui que lit le juge, que `attestJudgeApprovedLearning`
 * atteste, et que `observeOutcomeLearning` relit pour enregistrer la leçon (`result` du run).
 *
 * Chaque bloc de phase est borné à `plafond` caractères (#3 : le prompt du juge ne grossit plus avec
 * le nombre de phases). La sortie intégrale reste dans `phaseOutputs` et la trace des sous-agents.
 *
 * LA LEÇON PROPOSÉE EST CELLE DE LA RÉPONSE LA PLUS RÉCENTE QUI EN PORTE UNE.
 *
 * fix-ok: run-85d8e7f57af2-1 (conv-892, 2026-10-01) — cinq réponses de build portaient une ligne
 * `AUTOWIN_LESSON_V1` (caractères 9 054, 10 011, 4 821, 8 363, 4 559 dans `phaseOutputs`). Deux
 * causes, mesurées sur `run-state/run-85d8e7f57af2-1.json` en rejouant `parseAttestedLearningProposal` :
 * (1) le brief place la leçon en DERNIÈRE ligne, et le plafond garde le DÉBUT de la réponse : trois
 * versions étaient coupées, dont la corrigée ; (2) les phases s'ajoutent sans jamais s'effacer : la
 * version fausse de la réparation 3 restait lisible, et la règle « une seule ligne » annulait tout dès
 * qu'une réparation proposait la version corrigée. Le juge, dont le VALIDE enregistre la ligne qu'il
 * voit, ne pouvait que refuser (réparations 4, 5) puis bloquer sur la perte (réparation 6) : aucune
 * réparation ne pouvait lever ce refus. D'où : seule la réponse la plus récente garde ses lignes de
 * leçon, hors du plafond ; les plus anciennes sont remplacées par une mention sans marqueur.
 * Deux lignes dans CETTE réponse restent ambiguës et ne sont pas départagées (aucune leçon).
 */
export interface SortieDePhase {
  phase: string
  text: string
}

export const MARQUE_TRONQUE = '\n…[tronqué — voir le fil des sous-agents]'

/**
 * La marque de coupe NOMME la copie entiere quand elle existe (conv-989, 2026-10-16). « Le fil des
 * sous-agents » (`trace.json`) est plafonne a 4 000 caracteres par etape : plus court que ce que le
 * juge lit deja. `ouLire` est le fichier ecrit par `runs/livrable-entier.ts`.
 */
export function marqueDeCoupe(ouLire?: string): string {
  return ouLire ? `\n…[tronqué — sortie entière de cette étape : \`${ouLire}\`]` : MARQUE_TRONQUE
}
export const MENTION_LECON_REMPLACEE =
  '(proposition de leçon remplacée par celle d’une réponse plus récente)'

/**
 * LA VERSION LA PLUS RÉCENTE D'UNE ÉTAPE REJOUÉE EN ENTIER REMPLACE LES PRÉCÉDENTES.
 *
 * fix-ok: conv-914 (2026-10-13) — cause lue dans le code : une réparation d'étape nommée rejoue
 * l'étape EN ENTIER et `phaseOutputs.push` (orchestrator.ts) n'efface rien ; l'agrégat portait donc
 * toutes les versions du tableau du `/scout` réparé (4 d'après l'analyse de conv-914, non re-mesuré),
 * relues en entier par le juge à chaque passage. Une étape nommée (scout, frame, terrain) rend un
 * résultat COMPLET à chaque passage (« porte le résultat, ne le remplace jamais ») : seule la
 * dernière fait foi. Un build ou un clean de réparation, lui, AJOUTE un changement : tous restent.
 */
export const PHASES_REJOUEES_EN_ENTIER: ReadonlySet<string> = new Set(['scout', 'frame', 'terrain'])
export const MENTION_VERSION_REMPLACEE =
  '(version remplacée par la version plus récente de cette étape, plus bas)'

/**
 * Coupe un bloc trop long en gardant son DÉBUT (2/3 du plafond) et sa FIN (le reste), comme
 * `clampAggregateForJudge` (evidence-digest.ts). Le texte gardé, ligne de raccord comprise, ne
 * dépasse jamais `plafond` : seule la marque de coupe s'y ajoute.
 *
 * fix-ok: `slice(0, plafond)` gardait le seul début ; un cadrage long perdait sa fin — conclusion et
 * ligne `CausalHypothesis`, posées en dernier (précédent rapporté : run-85d8e7f57af2-1, caractère
 * 7 507). La fin est recalée au début d'une ligne quand elle en contient une, pour ne pas la couper.
 */
export function couperDebutEtFin(
  texte: string,
  plafond: number,
  marque: string = MARQUE_TRONQUE
): string {
  if (texte.length <= plafond) return texte
  const tete = Math.ceil((plafond * 2) / 3)
  // -1 : le saut de ligne qui sépare la marque de coupe de la fin gardée.
  const queue = plafond - tete - 1
  let debutQueue = texte.length - queue
  const finDeLigne = texte.indexOf('\n', debutQueue)
  if (finDeLigne >= 0 && finDeLigne < texte.length - 1) debutQueue = finDeLigne + 1
  const fin = queue > 0 ? texte.slice(debutQueue) : ''
  return `${texte.slice(0, tete)}${marque}${fin ? `\n${fin}` : ''}`
}

function estLigneDeLecon(ligne: string): boolean {
  return ligne.trimStart().startsWith(OUTCOME_LESSON_MARKER)
}

/**
 * LA PLACE QU'UNE ÉTAPE COURTE N'UTILISE PAS REVIENT AUX ÉTAPES LONGUES (piste 5 de conv-914).
 *
 * Répartition « par remplissage » de `budget` : un bloc plus court que sa part garde tout, les autres
 * se partagent le reste à parts égales. Chaque bloc reçoit au moins min(sa longueur, budget / nombre
 * de blocs) : avec `budget` = plafond × nombre de blocs, aucun n'est coupé plus court qu'avant.
 */
export function repartirLaPlace(longueurs: readonly number[], budget: number): number[] {
  const parts = longueurs.map(() => 0)
  const ordre = longueurs.map((_, i) => i).sort((a, b) => longueurs[a]! - longueurs[b]!)
  let reste = Math.max(0, Math.floor(budget))
  ordre.forEach((i, rang) => {
    parts[i] = Math.min(longueurs[i]!, Math.floor(reste / (ordre.length - rang)))
    reste -= parts[i]!
  })
  return parts
}

/**
 * `plafond` est la part de CHAQUE bloc ; leur somme (plafond × nombre de blocs, le maximum que
 * l'agrégat pouvait déjà atteindre) est mise en commun, et l'agrégat entier, en-têtes et leçons
 * comprises, ne dépasse jamais `totalMax`.
 * fix-ok: réparation 5 de run-a8a70cd0ee56-1 — `couperDebutEtFin(texte, plafond)` coupait chaque bloc à
 * 6 000 même quand les autres laissaient leur place vide (cadrage de 9 000 + build court : coupé), et
 * 12 blocs longs donnaient 71 664 caractères, au-delà des 60 000 de `AGGREGATE_MAX_CHARS`.
 */
export function agregerPhasesPourLeJuge(
  sorties: SortieDePhase[],
  plafond: number,
  totalMax: number = AGGREGATE_MAX_CHARS,
  ouLire?: string
): string {
  const marque = marqueDeCoupe(ouLire)
  let derniere = -1
  sorties.forEach((p, i) => {
    if (p.text.split(/\r?\n/u).some(estLigneDeLecon)) derniere = i
  })
  const blocs = sorties.map((p, i) => {
    const entete = `[phase ${p.phase}]\n`
    const lignes = p.text.split(/\r?\n/u)
    const lecons = lignes.filter(estLigneDeLecon)
    const remplacee =
      PHASES_REJOUEES_EN_ENTIER.has(p.phase) && sorties.some((q, j) => j > i && q.phase === p.phase)
    if (remplacee) {
      // La leçon reste celle de la réponse la plus récente qui en porte une, même remplacée.
      const recollees = i === derniere && lecons.length > 0 ? `\n${lecons.join('\n')}` : ''
      return { entete, fixe: `${MENTION_VERSION_REMPLACEE}${recollees}` }
    }
    let texte = p.text
    let aRecoller: string[] = []
    if (lecons.length > 0) {
      if (i === derniere) {
        texte = lignes.filter((l) => !estLigneDeLecon(l)).join('\n')
        aRecoller = lecons
      } else {
        texte = lignes.map((l) => (estLigneDeLecon(l) ? MENTION_LECON_REMPLACEE : l)).join('\n')
      }
    }
    return { entete, texte, recolle: aRecoller.length > 0 ? `\n${aRecoller.join('\n')}` : '' }
  })
  const aCouper = blocs.filter((b) => b.texte !== undefined)
  // Ce qui ne se coupe pas : en-têtes, séparateurs, versions remplacées, leçons recollées, marques.
  const horsCoupe =
    blocs.reduce(
      (n, b) => n + b.entete.length + (b.fixe?.length ?? 0) + (b.recolle?.length ?? 0),
      0
    ) +
    2 * Math.max(0, blocs.length - 1) +
    aCouper.length * marque.length
  const parts = repartirLaPlace(
    aCouper.map((b) => b.texte!.length),
    Math.min(plafond * sorties.length, totalMax - horsCoupe)
  )
  let rang = 0
  return blocs
    .map((b) => {
      if (b.texte === undefined) return `${b.entete}${b.fixe}`
      // conv-989 : le bilan de fin d'etape passe EN ENTIER, meme quand la part est petite.
      let body = couperEnGardantLeBilan(b.texte, parts[rang++]!, (corps, longueur) =>
        couperDebutEtFin(corps, longueur, marque)
      )
      if (b.recolle) body = `${body.replace(/\s+$/u, '')}${b.recolle}`
      return `${b.entete}${body}`
    })
    .join('\n\n')
}

/**
 * LE RÉSULTAT RENDU À L'UTILISATEUR NE PORTE PAS LES VERSIONS REMPLACÉES.
 *
 * fix-ok: conv-339, tour b6150a1a-6518-4d4b-99b4-3218b5efb501 — le `result` du run reprenait
 * l'agrégat du JUGE : la réponse affichée commençait par deux fois « [phase scout] » +
 * `MENTION_VERSION_REMPLACEE` (« …plus bas »), une indication écrite pour le juge, avant la seule
 * version qui compte. Ici, une version remplacée disparaît, SAUF si elle porte la leçon la plus
 * récente (`observeOutcomeLearning` la relit dans `result`). Le budget reste celui de l'agrégat du
 * juge (plafond × nombre de sorties) : la version gardée n'est pas coupée plus court. Une seule sortie
 * visible → pas d'en-tête, comme un run d'une seule étape. Le juge, lui, reçoit toujours l'agrégat
 * entier (`agregerPhasesPourLeJuge`).
 */
export function agregerPhasesPourLUtilisateur(
  sorties: SortieDePhase[],
  plafond: number,
  totalMax: number = AGGREGATE_MAX_CHARS,
  ouLire?: string
): string {
  let derniere = -1
  sorties.forEach((p, i) => {
    if (p.text.split(/\r?\n/u).some(estLigneDeLecon)) derniere = i
  })
  const visibles = sorties.filter(
    (p, i) =>
      i === derniere ||
      !(PHASES_REJOUEES_EN_ENTIER.has(p.phase) && sorties.some((q, j) => j > i && q.phase === p.phase))
  )
  if (visibles.length === 0) return ''
  const plafondVisible = (plafond * sorties.length) / visibles.length
  const agregat = agregerPhasesPourLeJuge(visibles, plafondVisible, totalMax, ouLire)
  const entete = `[phase ${visibles[0]!.phase}]\n`
  return visibles.length === 1 && agregat.startsWith(entete) ? agregat.slice(entete.length) : agregat
}
