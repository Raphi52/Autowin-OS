/**
 * CANDIDATS DANS UN MESSAGE DE SCOUT → panneau de sélection natif.
 *
 * Demande utilisateur du 2026-08-14 : le rendu du scout doit être « accompagné de checkbox et d'un
 * bouton qui frame les lignes sélectionnées ». Le HTML du modèle ne peut pas porter ces contrôles
 * (le sanitizeur refuse volontairement input/button — anti-hameçonnage) : c'est donc l'APP qui les
 * rend, en détectant la charge utile JSON que le scout termine toujours par (bloc ```json).
 *
 * Module PUR : détection + rédaction du prompt, testables sans React.
 */
import { porteUnSignalDeRisque } from '../../../shared/signaux-de-risque'
import { ligneDuLot, type RangDuLot } from '../../../shared/selection-scout'
import { DEMANDE_MAX, FICHIERS_MAX, type SelectionAPlanifier } from '../../../shared/plan-de-lots'
import { parseScoutTable } from '../../../shared/scout-table'
import { langueCourante } from '../langue'
import { traduireChatDecisions } from '../textes-ecrans/chat-decisions'

/*
 * Ce que l'ÉCRAN dit des pistes (voie, motif, plan) suit la langue de l'interface (traduction
 * anglaise, conv-1170) ; les PROMPTS rédigés plus bas restent en français : ce sont des consignes
 * pour l'agent, que la langue de ses réponses règle à part.
 */
const tx = (
  cle: Parameters<typeof traduireChatDecisions>[0],
  valeurs?: Parameters<typeof traduireChatDecisions>[2]
): string => traduireChatDecisions(cle, langueCourante(), valeurs)

export interface CandidatAffiche {
  titre: string
  /**
   * Le NUMÉRO de la ligne dans le tableau du scout (colonne `#`), tel qu'écrit. L'app retrie le
   * tableau après avoir ajusté les notes en GARDANT ces numéros (`scout-plafond.ts`) : la position
   * dans la liste n'est donc pas le numéro que la cible du scout désigne (conv-1074).
   */
  num?: string
  /**
   * Ancrage interne `src/...:ligne` ou URL web — affiché tel quel, jamais réécrit.
   *
   * OPTIONNEL depuis le 2026-08-18 : un scout de code rend un tableau markdown dont toutes les
   * lignes ne portent pas d'ancrage. L'exiger interdisait au panneau de sélection d'exister sur
   * ces scouts — c'est-à-dire sur le cas d'usage principal.
   */
  url?: string
  citation?: string
  pertinence?: number
  type?: string
  dateSource?: string
  langue?: string
  what?: string
  why?: string
  how?: string
  /** La commande de preuve de la ligne du tableau scout (colonne `Commande`, piste 3 de conv-1033). */
  commande?: string
  /**
   * Pastilles du tableau scout, telles quelles ('g' | 'y' | 'r'). Sur un scout au format
   * Impact/Effort il n'existe AUCUN nombre : ces deux pastilles SONT l'indication de valeur de la
   * ligne. Les jeter vidait la ligne de tout reperage (constate le 2026-08-18).
   */
  impact?: 'g' | 'y' | 'r'
  effort?: 'g' | 'y' | 'r'
}

interface ChargeJson {
  valeur: unknown
  debut: number
  fin: number
}

function trouverDerniereChargeJson(texte: string): ChargeJson | undefined {
  const ouvertureJson = /^ {0,3}```json[ \t]*\r?$/gim
  let debut: number | undefined
  let finOuverture: number | undefined
  for (const correspondance of texte.matchAll(ouvertureJson)) {
    debut = correspondance.index
    finOuverture = correspondance.index + correspondance[0].length
  }
  if (debut === undefined || finOuverture === undefined) return undefined
  const apresOuverture = texte.slice(finOuverture)
  const fermeture = /^ {0,3}```[ \t]*\r?$/m.exec(apresOuverture)
  if (!fermeture || fermeture.index === undefined) return undefined
  const fin = finOuverture + fermeture.index + fermeture[0].length
  const charge = apresOuverture.slice(0, fermeture.index).trim()
  try {
    return {
      valeur: JSON.parse(charge),
      debut,
      fin
    }
  } catch {
    return undefined
  }
}

/**
 * Extrait les candidats d'un texte de message. On ne détecte QUE la forme émise par les scouts :
 * un tableau JSON d'objets portant au moins `titre` et `url`. Un JSON cassé ou d'une autre forme
 * rend `undefined` — ce panneau est un bonus, jamais une raison d'échouer un rendu.
 */
export function extraireCandidatsAffiches(texte: string): CandidatAffiche[] | undefined {
  const charge = trouverDerniereChargeJson(texte)
  if (!charge) return undefined
  const valeur = charge.valeur
  if (!Array.isArray(valeur) || valeur.length === 0) return undefined
  const candidats: CandidatAffiche[] = []
  for (const brut of valeur) {
    if (!brut || typeof brut !== 'object') return undefined
    const objet = brut as Record<string, unknown>
    if (typeof objet.titre !== 'string' || !objet.titre.trim()) return undefined
    if (typeof objet.url !== 'string' || !objet.url.trim()) return undefined
    candidats.push({
      titre: objet.titre.trim(),
      url: objet.url.trim(),
      ...(typeof objet.citation === 'string' && objet.citation.trim()
        ? { citation: objet.citation.trim() }
        : {}),
      ...(typeof objet.pertinence === 'number' && Number.isFinite(objet.pertinence)
        ? { pertinence: objet.pertinence }
        : {}),
      ...(typeof objet.type === 'string' && objet.type.trim() ? { type: objet.type.trim() } : {}),
      ...(typeof objet.dateSource === 'string' && objet.dateSource.trim()
        ? { dateSource: objet.dateSource.trim() }
        : {}),
      ...(typeof objet.langue === 'string' && objet.langue.trim()
        ? { langue: objet.langue.trim() }
        : {}),
      ...(typeof objet.what === 'string' && objet.what.trim() ? { what: objet.what.trim() } : {}),
      ...(typeof objet.why === 'string' && objet.why.trim() ? { why: objet.why.trim() } : {}),
      ...(typeof objet.how === 'string' && objet.how.trim() ? { how: objet.how.trim() } : {})
    })
  }
  return candidats
}

/** Premier ancrage `chemin:ligne` trouvé dans les cellules, dans l'ordre où on le lirait. */
function ancrageDansCellules(cellules: readonly string[]): string | undefined {
  for (const cellule of cellules) {
    const trouve = /(?:src|scripts|tests|tools)\/[\w./-]+:\d+/.exec(cellule)
    if (trouve) return trouve[0]
  }
  return undefined
}

/**
 * Convertit un tableau scout markdown déjà analysé en candidats SÉLECTIONNABLES.
 *
 * Le panneau de sélection ne savait lire qu'une charge JSON de veille web ; un scout interne rend un
 * tableau. Ce pont réutilise le panneau existant au lieu de recoder des cases à cocher ailleurs.
 * L'ancrage est EXTRAIT des cellules quand il y est, jamais inventé quand il n'y est pas.
 */
/**
 * L'EFFORT ET LA PREUVE ÉCRITS DANS LE « COMMENT » (conv-1333, 2026-10-30). Le tableau actuel du scout
 * n'a ni colonne Effort ni colonne Commande : sur les 64 pistes proposées depuis le 22/10, l'effort
 * était vide 64 fois, alors que le texte disait « **Effort :** moyen ». La règle « effort fort = à
 * cadrer » ne se déclenchait donc jamais. Lecture bornée à ces deux formes : rien n'est deviné.
 */
const MOTS_D_EFFORT: Readonly<Record<string, 'g' | 'y' | 'r'>> = {
  faible: 'g',
  petit: 'g',
  leger: 'g',
  low: 'g',
  small: 'g',
  moyen: 'y',
  modere: 'y',
  medium: 'y',
  fort: 'r',
  eleve: 'r',
  gros: 'r',
  grand: 'r',
  lourd: 'r',
  high: 'r',
  large: 'r'
}

function effortDuComment(how: string): 'g' | 'y' | 'r' | undefined {
  const mot = /\beffort\b[\s*_:]*([a-z]+)/u.exec(sansAccents(how))?.[1]
  return mot ? MOTS_D_EFFORT[mot] : undefined
}

/** La commande de preuve citée : une vraie commande, qui vise un fichier (`npx vitest run src/a.test.ts`). */
function preuveDuComment(how: string): string | undefined {
  const commande = /\b(?:preuve|proof)\b[\s*_:]*`([^`\n]+)`/iu.exec(how)?.[1]?.trim()
  if (!commande) return undefined
  const lancee = /^(?:npx|npm|node|pnpm|yarn|pwsh|powershell|python|dotnet)\b/u.test(commande)
  return lancee && /\s\S+[./]\S/u.test(commande) ? commande : undefined
}

export function candidatsDepuisScoutTable(
  rows: readonly {
    num: string
    score?: number
    impact: 'g' | 'y' | 'r' | null
    effort: 'g' | 'y' | 'r' | null
    type: 'fix' | 'new' | null
    what: string
    why: string
    how: string
    commande?: string
  }[]
): CandidatAffiche[] {
  return rows.map((row) => {
    const ancrage = ancrageDansCellules([row.how, row.what, row.why])
    const effort = row.effort ?? effortDuComment(row.how)
    const commande = row.commande?.trim() || preuveDuComment(row.how)
    return {
      titre: row.what.trim() || `Candidat #${row.num}`,
      ...(row.num.trim() ? { num: row.num.trim() } : {}),
      ...(row.score === undefined ? {} : { pertinence: row.score }),
      ...(row.impact ? { impact: row.impact } : {}),
      ...(effort ? { effort } : {}),
      ...(ancrage ? { url: ancrage } : {}),
      ...(row.type ? { type: row.type } : {}),
      ...(row.what.trim() ? { what: row.what.trim() } : {}),
      ...(row.why.trim() ? { why: row.why.trim() } : {}),
      ...(row.how.trim() ? { how: row.how.trim() } : {}),
      ...(commande ? { commande } : {})
    }
  })
}

/**
 * Le prompt « parfait » pour enchaîner : le WORKFLOW COMPLET sur LA SÉLECTION, avec les ancrages et
 * preuves, et la consigne d'aller jusqu'au commit publié — le même contrat que les campagnes.
 *
 * Demande utilisateur du 2026-09-02 : le bouton de la shortlist scout doit lancer TOUT le workflow,
 * pas seulement le cadrage. Le préfixe `/frame` réduisait le run à la seule phase frame
 * (`skill-routing.ts` → `explicitPhase`), donc l'ancienne version ne pouvait rien livrer. Ici :
 * AUCUN préfixe de phase, et le mot « pipeline » dans la consigne classe la tâche en régime
 * `critical` (`shared/signaux-de-risque.ts`, lu par `task-regime.ts`), qui joue frame → build →
 * clean puis le juge — sans rejouer le scout qui vient d'être fait (`selection-sans-scout.ts`).
 *
 * `lot` : la place de ce message dans une sélection découpée (`planDeLancement`) ; absent ou seul lot,
 * aucune ligne de plus.
 */
export function redigerPromptWorkflowSelection(
  selection: readonly CandidatAffiche[],
  lot?: RangDuLot
): string {
  return [
    enteteSelection(selection),
    '',
    ...lignesDesCandidats(selection),
    '',
    'Commence par relire chaque ancrage et vérifier que le besoin tient toujours, puis joue le',
    'PIPELINE complet — cadrage, build, nettoyage, jugement — jusqu’au COMMIT PUBLIÉ et',
    'vérifié. Si un ancrage ne tient plus, dis-le franchement plutôt que de traiter un besoin mort.',
    ...lignesDuLot(lot)
  ].join('\n')
}

/**
 * LA CORRECTION DIRECTE — le même contrat de fin (commit publié et vérifié), sans recadrer.
 *
 * Demande utilisateur du 2026-10-22 (conv-1080) : « après un scout ça me propose toujours lancer le
 * workflow complet… mais parfois y a pas besoin du workflow complet ». Le pipeline complet rejoue un
 * cadrage et un nettoyage sur une piste que le scout vient de LOCALISER : pour une correction ancrée,
 * c'est payer deux fois l'éclairage déjà fait.
 *
 * Le préfixe `/build` en PREMIÈRE ligne est une phase NOMMÉE : `agent-pilot` l'orchestre lui-même,
 * sans que le modèle du chat puisse la réinterpréter, et `regimePhases` ne joue que `build` — le juge
 * et la capitalisation (`learn`) restent ajoutés par l'orchestrateur (task-regime.ts,
 * `phasesApresJugeHorsGraphe`). L'en-tête « Traite… issu du scout » reste lisible par la mémoire du
 * scout (`shared/selection-scout.ts`), qui note les pistes prises et leur voie.
 */
export function redigerPromptCorrectionDirecte(
  selection: readonly CandidatAffiche[],
  lot?: RangDuLot
): string {
  return [
    '/build',
    enteteSelection(selection),
    '',
    ...lignesDesCandidats(selection),
    '',
    'Correction DIRECTE, sans recadrer : le scout a déjà localisé chaque piste. Pour chacune, relis',
    'son ancrage, reproduis le défaut en rouge (ou constate le manque), corrige au plus juste, puis',
    'rejoue sa preuve jusqu’au vert — jusqu’au COMMIT PUBLIÉ et vérifié.',
    'Si une piste s’avère plus large qu’une correction ciblée (plusieurs modules, un choix de',
    'conception à trancher), ne la force pas : dis-le, elle relève du workflow complet. Si un ancrage',
    'ne tient plus, dis-le franchement plutôt que de traiter un besoin mort.',
    ...lignesDuLot(lot)
  ].join('\n')
}

function lignesDuLot(lot: RangDuLot | undefined): string[] {
  return lot && lot.total > 1 ? ['', ligneDuLot(lot)] : []
}

/** Les deux façons de traiter des candidats scout. */
export type VoieSelection = 'directe' | 'complete'

/** La voie d'UNE piste, et pourquoi — c'est ce que la pastille de la ligne affiche. */
export interface VoieDeLaPiste {
  voie: VoieSelection
  motif: string
}

/**
 * Une PREUVE de localisation : un ancrage `chemin:ligne`, ou un chemin avec son dossier
 * (`src/main/a.ts`) — pas une URL de page web (`https://x.fr/a.html` : `:` et `//` l'excluent).
 */
const ANCRAGE_DE_CODE =
  /(?:^|[\s(`])(?:[\w./-]+\.[a-z]{1,6}:\d+|[\w-]+(?:\/[\w.-]+)+\.[a-z]{1,6}\b(?!\/))/iu

/** Le « Pourquoi » compte : c'est là que le scout cite la ligne qu'il a lue (conv-1332, `/draft`). */
function estLocalisee(candidat: CandidatAffiche): boolean {
  if (candidat.commande) return true
  return [candidat.url, candidat.how, candidat.what, candidat.why].some(
    (champ) => champ !== undefined && ANCRAGE_DE_CODE.test(` ${champ}`)
  )
}

/**
 * Un chemin n'est pas un signal de risque : `orchestrator.ts:12` nomme une ADRESSE, pas un chantier
 * d'orchestration (conv-1097, deux corrections envoyées au cadrage pour ce seul mot). Le `/build` de
 * la voie directe est une phase nommée, que `regimePhases` ne réélargit pas : le classement du run
 * n'a pas à lire la même chose.
 */
function sansCheminsNiCode(texte: string): string {
  return texte
    .replace(/`[^`\n]*`/gu, ' ')
    .replace(/[\w./\\-]+\.[a-z]{1,6}(?::\d+(?:-\d+)?)?/giu, ' ')
}

/**
 * QUELLE VOIE POUR CETTE PISTE ? — lue sur la FORME de ce que le scout a écrit, jamais sur la qualité
 * de son choix (le producteur et le juge sont le même modèle : contrainte du Brain « sélection auto
 * des candidats scout »), ni sur une confiance que le modèle déclarerait lui-même.
 *
 * PISTE PAR PISTE depuis le 2026-10-22 (conv-1080, « fais le truc parfait ») : la règle décidait pour
 * la sélection ENTIÈRE, et 26 sélections sur 49 étaient mixtes — une seule piste à cadrer envoyait
 * toutes les corrections localisées dans le workflow complet. Le reproche que la recherche fait à
 * l'adaptation « par demande entière » (DAAO, arXiv 2509.11079 : trop grossière) était exactement
 * le nôtre. Les signaux restent visibles et vérifiables, comme le Plan Mode de Cursor ou la note de
 * confiance par tâche de Devin 2.1.
 *
 * Correction directe seulement si la piste est une correction (`fix`) déjà localisée (ancrage de code
 * ou commande de preuve), sans effort fort déclaré, sans signal de risque (le même motif que
 * `classifyRegime` : ce que le panneau envoie en direct, l'orchestrateur ne l'aurait pas classé en
 * chantier). Le moindre doute garde le workflow complet : se tromper vers le complet coûte de
 * l'argent, se tromper vers le direct coûte un cadrage qui manquait.
 */
export function voieDeLaPiste(candidat: CandidatAffiche): VoieDeLaPiste {
  if (candidat.type !== 'fix' && candidat.type !== 'correction') {
    return {
      voie: 'complete',
      motif:
        candidat.type === 'new' || candidat.type === 'ajout'
          ? tx('candidats.motif.ajout')
          : tx('candidats.motif.natureNonDeclaree')
    }
  }
  if (candidat.effort === 'r') return { voie: 'complete', motif: tx('candidats.motif.effortFort') }
  const texte = [candidat.titre, candidat.what, candidat.why, candidat.how]
    .filter(Boolean)
    .join(' ')
  if (porteUnSignalDeRisque(sansCheminsNiCode(texte))) {
    return {
      voie: 'complete',
      motif: tx('candidats.motif.risque')
    }
  }
  if (!estLocalisee(candidat)) {
    return { voie: 'complete', motif: tx('candidats.motif.nonLocalisee') }
  }
  return {
    voie: 'directe',
    motif: candidat.commande
      ? tx('candidats.motif.localiseeAvecPreuve')
      : tx('candidats.motif.localisee')
  }
}

/**
 * Au plus 3 pistes par lot. Sur nos 49 runs de sélection (mesure du 2026-10-22, conv-1080), 16 ont
 * été coupés par la limite de session ou de quota du modèle, avec 6 pistes en moyenne : tout ce
 * qu'ils avaient fait était perdu. Un lot court finit, et chaque lot vert est livré.
 *
 * Pas une piste par lot : un lot coûte un run entier (11 $ pour une seule correction, conv-1199).
 */
export const MAX_PISTES_PAR_LOT = 3

/** Un lancement : une voie, et les pistes qu'elle traite ensemble. */
export interface LotDeLancement {
  voie: VoieSelection
  /** Le rang de chaque piste dans la sélection reçue (0 = la première), dans l'ordre du scout. */
  positions: number[]
  candidats: CandidatAffiche[]
}

/**
 * LE PLAN DU WORKFLOW INTELLIGENT : chaque piste reçoit sa voie, puis les pistes d'une même voie sont
 * groupées en lots de `MAX_PISTES_PAR_LOT` au plus, ÉQUILIBRÉS (4 pistes → 2 + 2, pas 3 + 1).
 *
 * Les corrections directes sont rangées EN PREMIER : courtes, elles livrent vite. Dans chaque voie,
 * l'ordre du scout est gardé. Deux lots ou plus partent en super conversation (`selectionAPlanifier`,
 * conv-1333) : chacun dans son fil, 3 à la fois, ceux qui annoncent un même fichier l'un après l'autre.
 */
export function planDeLancement(selection: readonly CandidatAffiche[]): LotDeLancement[] {
  const voies = selection.map(voieDeLaPiste)
  const lots: LotDeLancement[] = []
  for (const voie of ['directe', 'complete'] as const) {
    const positions = selection.flatMap((_, rang) => (voies[rang]!.voie === voie ? [rang] : []))
    if (positions.length === 0) continue
    const nombre = Math.ceil(positions.length / MAX_PISTES_PAR_LOT)
    let debut = 0
    for (let rangLot = 0; rangLot < nombre; rangLot++) {
      // 7 pistes → 3 + 2 + 2 : les premiers lots prennent le reste de la division, un par un.
      const taille =
        Math.floor(positions.length / nombre) + (rangLot < positions.length % nombre ? 1 : 0)
      const tranche = positions.slice(debut, debut + taille)
      debut += taille
      lots.push({ voie, positions: tranche, candidats: tranche.map((rang) => selection[rang]!) })
    }
  }
  return lots
}

/** Le message de chaque lot, dans l'ordre : une seule porte d'entrée pour le bouton ET le clic auto. */
export function redigerPromptsDuPlan(plan: readonly LotDeLancement[]): string[] {
  return plan.map((lot, rang) =>
    redigerPromptSelon(lot.voie, lot.candidats, { numero: rang + 1, total: plan.length })
  )
}

/** Le message d'une voie sur des pistes données. */
export function redigerPromptSelon(
  voie: VoieSelection,
  selection: readonly CandidatAffiche[],
  lot?: RangDuLot
): string {
  return voie === 'directe'
    ? redigerPromptCorrectionDirecte(selection, lot)
    : redigerPromptWorkflowSelection(selection, lot)
}

/** Un chemin du dépôt, dossier compris : un nom seul (`os.ts`) ne dit pas assez pour réserver un fichier. */
const CHEMIN_DU_DEPOT =
  /(?:^|[\s(`"'«])((?:src|scripts|skills|tests|tools|docs)\/[\w./-]+\.[a-z0-9]{1,6})/giu

/**
 * Les fichiers qu'une piste annonce de toucher : son ancrage et son « Comment », pas son « Pourquoi »,
 * qui cite ce que le scout a LU (deux pistes qui citent le même fichier ne le modifient pas forcément,
 * et le plan fait passer l'un après l'autre deux lots aux fichiers communs).
 */
function fichiersDeLaPiste(candidat: CandidatAffiche): string[] {
  return [candidat.url, candidat.how, candidat.what].flatMap((champ) =>
    champ ? Array.from(` ${champ}`.matchAll(CHEMIN_DU_DEPOT), (trouve) => trouve[1]!) : []
  )
}

const sansMiseEnForme = (texte: string): string => texte.replace(/\*\*|`/gu, '').trim()

/** Le titre du fil du lot : sa voie, et ce qu'il traite. */
function titreDuLot(lot: LotDeLancement): string {
  const premier = sansMiseEnForme(lot.candidats[0]!.titre).slice(0, 56)
  const autres = lot.candidats.length - 1
  return `${lot.voie === 'directe' ? 'Direct' : 'À cadrer'} — ${premier}${autres > 0 ? ` (+${autres})` : ''}`
}

const NOTE_DE_COUPE = ' … (coupé : le détail est dans le tableau du scout, fil chef)'

function couper(texte: string | undefined, plafond: number): string | undefined {
  if (texte === undefined || texte.length <= plafond) return texte
  return `${texte.slice(0, plafond).trimEnd()}${NOTE_DE_COUPE}`
}

/**
 * LE MESSAGE D'UN LOT TIENT DANS LA BORNE DU PLAN. Un plan refuse une demande de plus de
 * `DEMANDE_MAX` caractères, et un seul « Pourquoi » de scout en fait déjà 2 000 (conv-1332). Le
 * « Pourquoi » et le « Comment » se raccourcissent ; le « Quoi » reste entier, c'est lui que la mémoire
 * du scout relit pour reconnaître la piste prise. Le détail coupé reste lisible dans le fil chef.
 */
function demandeBornee(lot: LotDeLancement, rang: RangDuLot): string {
  const complete = redigerPromptSelon(lot.voie, lot.candidats, rang)
  if (complete.length <= DEMANDE_MAX) return complete
  for (const plafond of [1_000, 600, 300, 120]) {
    const courts = lot.candidats.map((candidat) => ({
      ...candidat,
      why: couper(candidat.why, plafond),
      how: couper(candidat.how, plafond),
      citation: couper(candidat.citation, plafond)
    }))
    const demande = redigerPromptSelon(lot.voie, courts, rang)
    if (demande.length <= DEMANDE_MAX) return demande
  }
  return complete.slice(0, DEMANDE_MAX)
}

/**
 * LA SÉLECTION CONFIÉE À LA SUPER CONVERSATION (conv-1333, 2026-10-30) — ce que le bouton dépose dès
 * qu'elle compte au moins deux lots. Chaque lot garde le message exact d'un envoi dans le fil : l'en-tête
 * et le `/build` restent lus par la mémoire du scout et par le choix des étapes du run.
 */
export function selectionAPlanifier(plan: readonly LotDeLancement[]): SelectionAPlanifier {
  const pistes = plan.reduce((total, lot) => total + lot.candidats.length, 0)
  return {
    titre: `Sélection du scout : ${pistes} pistes`,
    contexte:
      "Ces pistes viennent du panneau des candidats d'un scout : l'utilisateur les a retenues, et le " +
      'workflow intelligent a choisi la voie de chacune. Chaque lot ne traite que ses pistes, ' +
      "jusqu'au commit publié et vérifié. Le tableau complet du scout, preuves comprises, est dans le " +
      'fil chef : lis-le avec conversation_read si une piste manque de détail.',
    lots: plan.map((lot, rang) => ({
      titre: titreDuLot(lot),
      demande: demandeBornee(lot, { numero: rang + 1, total: plan.length }),
      fichiers: [...new Set(lot.candidats.flatMap(fichiersDeLaPiste))].slice(0, FICHIERS_MAX)
    }))
  }
}

/** Le plan en une phrase courte, pour le bandeau du choix du scout : « 2 lots (1 direct, 1 complet) ». */
export function resumeDuPlan(plan: readonly LotDeLancement[]): string {
  const directs = plan.filter((lot) => lot.voie === 'directe').length
  const complets = plan.length - directs
  if (plan.length === 1) {
    return directs === 1 ? tx('candidats.plan.direct') : tx('candidats.plan.complet')
  }
  const parts = [
    ...(directs > 0 ? [tx('candidats.plan.nDirects', { n: directs })] : []),
    ...(complets > 0 ? [tx('candidats.plan.nComplets', { n: complets })] : [])
  ]
  return tx('candidats.plan.lots', { n: plan.length, detail: parts.join(', ') })
}

/** Ce que joue une voie, en clair : l'utilisateur voit les étapes avant de cliquer. */
export function libelleVoie(voie: VoieSelection): string {
  return voie === 'directe'
    ? tx('candidats.voie.libelleDirecte')
    : tx('candidats.voie.libelleComplete')
}

/** Pourquoi ce lot prend sa voie : nommé pour une seule piste, motifs distincts sinon. */
export function motifDuLot(lot: LotDeLancement): string {
  if (lot.voie === 'directe') {
    return lot.candidats.length > 1
      ? tx('candidats.lot.directs', { n: lot.candidats.length })
      : tx('candidats.lot.direct')
  }
  const motifs = [...new Set(lot.candidats.map((candidat) => voieDeLaPiste(candidat).motif))]
  return lot.candidats.length === 1
    ? tx('candidats.lot.unePiste', { titre: lot.candidats[0]!.titre, motif: motifs[0] ?? '' })
    : motifs.join(tx('candidats.lot.separateur'))
}

function enteteSelection(selection: readonly CandidatAffiche[]): string {
  return selection.length > 1
    ? `Traite ENSEMBLE ces ${selection.length} candidats issus du scout interne d'Autowin :`
    : `Traite ce candidat issu du scout interne d'Autowin :`
}

function lignesDesCandidats(selection: readonly CandidatAffiche[]): string[] {
  return selection.map((candidat, index) => {
    const morceaux = [
      candidat.url
        ? `${index + 1}. ${candidat.titre} — ancrage ${candidat.url}`
        : `${index + 1}. ${candidat.titre}`
    ]
    if (candidat.citation) morceaux.push(`preuve : « ${candidat.citation} »`)
    if (candidat.pertinence !== undefined) morceaux.push(`pertinence ${candidat.pertinence}/100`)
    const details = [
      candidat.type ? `   Type : ${candidat.type}` : undefined,
      candidat.what ? `   Quoi : ${candidat.what}` : undefined,
      candidat.why ? `   Pourquoi : ${candidat.why}` : undefined,
      candidat.how ? `   Comment : ${candidat.how}` : undefined,
      candidat.commande ? `   Preuve à lancer : ${candidat.commande}` : undefined,
      candidat.dateSource ? `   Date source : ${candidat.dateSource}` : undefined,
      candidat.langue ? `   Langue : ${candidat.langue}` : undefined
    ].filter((detail): detail is string => detail !== undefined)
    return [morceaux.join(' — '), ...details].join('\n')
  })
}

/**
 * Le même texte SANS la charge utile JSON (et sa clôture de fence) : une fois le panneau de
 * sélection affiché, le pavé brut ferait doublon — c'est une charge machine, pas une lecture.
 */
export function texteSansChargeJson(texte: string): string {
  const charge = trouverDerniereChargeJson(texte)
  if (!charge) return texte
  const avant = texte.slice(0, charge.debut)
  const apres = texte.slice(charge.fin)
  return `${avant.trimEnd()}
${apres.trimStart()}`.trim()
}

/** L'emoji de nature, affiché dans la barre du candidat sans avoir à déplier. */
export function emojiType(type: string | undefined): string {
  // DEUX vocabulaires arrivent ici : celui de la veille web (« correction » / « ajout ») et celui du
  // tableau scout (« fix » / « new »). N'en connaitre qu'un affichait « ❔ » sur chaque ligne d'un
  // scout de code — constate le 2026-08-18. Le repli reste EXPLICITE pour une nature vraiment
  // inconnue : mieux vaut un point d'interrogation assume qu'un emoji devine.
  if (type === 'correction' || type === 'fix') return '🔧'
  if (type === 'ajout' || type === 'new') return '🆕'
  return '❔'
}

/**
 * Le numéro qu'affiche chaque ligne du panneau — et que la cible du scout désigne. Une seule règle
 * pour les deux : un numéro affiché qui ne serait pas celui que la sélection lit referait le défaut
 * de conv-1074 (« ligne 1 » qui cochait la ligne n° 4 d'un tableau retrié).
 */
export function numerosDesCandidats(candidats: readonly CandidatAffiche[]): number[] {
  return numerosDuTableau(candidats) ?? candidats.map((_, index) => index + 1)
}

/**
 * Les numéros du tableau, s'ils sont FIABLES : tous présents, entiers et distincts. Sinon `null`, et
 * la position reprend la main — pour TOUTE la liste, jamais ligne par ligne : mélanger les deux
 * ferait désigner deux lignes par le même numéro. Les candidats de la veille web n'en ont aucun.
 */
function numerosDuTableau(candidats: readonly CandidatAffiche[]): number[] | null {
  if (candidats.length === 0) return null
  const numeros = candidats.map((candidat) => {
    const brut = candidat.num?.trim() ?? ''
    return /^\d{1,3}$/u.test(brut) ? Number(brut) : NaN
  })
  if (numeros.some((numero) => !Number.isInteger(numero))) return null
  return new Set(numeros).size === numeros.length ? numeros : null
}

/**
 * LA SÉLECTION DÉCIDÉE PAR L'AGENT — le pont entre le choix ÉCRIT du scout et les cases du panneau.
 *
 * Défaut nommé (2026-09-06) : deux systèmes de choix coexistaient sans se parler. Les cases du
 * panneau (multi-sélection, tout coché par défaut) d'un côté, la ligne `CIBLE:` que le mode auto lit
 * dans le texte (mono-sélection) de l'autre. Résultat : l'agent pouvait bien désigner des candidats,
 * le panneau restait sur « tout », donc le clic partait sur des lignes que personne n'avait choisies.
 *
 * Ici la déclaration du scout — `CIBLE:` ou `CIBLES:` — pilote les cases. Un candidat est retenu s'il
 * est désigné par son NUMÉRO de ligne (1, 2…) ou si son titre apparaît dans la déclaration. Rien de
 * déclaré, ou déclaration qui ne correspond à AUCUNE ligne → `null` : le panneau garde son
 * comportement d'origine (tout coché). Aucun envoi n'est déclenché ici : le bouton reste à cliquer.
 */
export function selectionAutoDepuisScout(
  candidats: readonly CandidatAffiche[],
  texteScout: string | undefined
): ReadonlySet<number> | null {
  const declarations = lireLignesCibles(texteScout ?? '')
  if (declarations === null) return null
  const nues = declarations.map(sansAccents)
  // « aucune » / « rien » = le scout dit explicitement de ne rien enchaîner : zéro case cochée.
  if (/^(aucune?|rien)\b/u.test(nues[0]!.trim())) return new Set()
  const numeros = new Set(nues.flatMap(numerosDesignes))
  // Le NUMÉRO de la ligne, pas sa position : l'app retrie le tableau en gardant ses numéros (conv-1074).
  const numerosLignes = numerosDesCandidats(candidats)
  const retenus = new Set<number>()
  candidats.forEach((candidat, index) => {
    if (numeros.has(numerosLignes[index])) {
      retenus.add(index)
      return
    }
    const titre = sansAccents(candidat.titre).trim()
    if (titre.length >= 4 && nues.some((nu) => nu.includes(titre))) retenus.add(index)
  })
  return retenus.size > 0 ? retenus : null
}

/** « 2 », « 2, 5 et 7 », « 1 + 3 » : un numéro de ligne, et ceux qui le suivent. */
const LISTE_DE_NUMEROS = String.raw`\d{1,3}(?:\s*(?:,|;|\/|\+|&|\bet\b|\band\b|\bpuis\b|\bthen\b)\s*\d{1,3})*`
/** Un numéro DÉSIGNÉ : « ligne 2 », « Row 1 », « piste 3 », « n° 4 », « #5 ». */
const NUMERO_DESIGNE = new RegExp(
  String.raw`(?:\b(?:lignes?|lines?|rows?|pistes?|candidats?|n[o°])\s*|#\s*)(${LISTE_DE_NUMEROS})`,
  'gu'
)
/** La déclaration OUVRE sur ses numéros : « 2 et 3 », « 2 — le plus court ». Jamais « 13 % des cas ». */
const NUMEROS_EN_TETE = new RegExp(
  String.raw`^[\s*_(#]*(${LISTE_DE_NUMEROS})(?=\s*(?:$|[—–:.,;)*_-]))`,
  'u'
)

/**
 * LES NUMÉROS QU'UNE CIBLE DÉSIGNE, PAS CEUX QU'ELLE CITE (conv-1333, 2026-10-30). Tout nombre de la
 * déclaration valait un numéro de ligne : sur 5 cibles réelles depuis le 22/10, 4 cochaient des lignes
 * jamais nommées (conv-1332 : « ligne 1 » et « ligne 2 » voulues, « 13 % » et « 05/09 » cochaient 5,
 * 9, 10 et 13 — en mode auto, elles partaient sans personne). Témoin :
 * `veille-candidats-message.cible-reelle.test.ts`.
 */
function numerosDesignes(declaration: string): number[] {
  const listes = Array.from(declaration.matchAll(NUMERO_DESIGNE), (trouve) => trouve[1]!)
  const enTete = NUMEROS_EN_TETE.exec(declaration)?.[1]
  return [...listes, ...(enTete ? [enTete] : [])].flatMap((liste) =>
    Array.from(liste.matchAll(/\d{1,3}/gu), (numero) => Number(numero[0]))
  )
}

/** Minuscules sans diacritiques : comparer un titre a une declaration ne doit pas buter sur un accent. */
function sansAccents(texte: string): string {
  return texte.normalize('NFD').replace(/[̀-ͯ]/gu, '').toLowerCase()
}

/**
 * Les déclarations de cible d'un scout ; `null` s'il n'en pose aucune.
 *
 * DEUX formes, les mêmes que `lireCibleScout` (src/main/scout/scout-cible.ts) : une ligne `CIBLE:`/
 * `CIBLES:`, ou une section `## Cible` non vide. N'en reconnaître qu'une rendait le pont inerte sur
 * la forme la plus courante — le scout déclarait, le panneau restait « tout coché ».
 *
 * D'une section, seul le PREMIER paragraphe déclare : la suite commente (conv-1199 : « Piste 2 : la
 * lumière est éteinte », une correction après relecture, pas un choix).
 */
function lireLignesCibles(texteScout: string): string[] | null {
  const lignes = texteScout.split(String.fromCharCode(10))
  const morceaux: string[] = []
  for (let i = 0; i < lignes.length; i++) {
    const ligne = lignes[i]!
    const enLigne = ligne.match(/^\s*[>*_`\s]*cibles?\s*[:：]\s*(.*?)\s*[*_`]*\s*$/iu)
    if (enLigne) {
      morceaux.push(enLigne[1]!.replace(/^[\s*_`]+/u, '').trim())
      continue
    }
    const titre = ligne.match(/^\s{0,3}#{1,6}\s+(.+?)\s*$/u)
    if (
      !titre ||
      !/^cibles?$/u.test(
        sansAccents(titre[1]!)
          .replace(/[^a-z0-9]+/gu, ' ')
          .trim()
      )
    )
      continue
    // Le corps de la section : jusqu'au titre suivant. Une section vide ne déclare rien.
    const corps: string[] = []
    for (let j = i + 1; j < lignes.length; j++) {
      // fix-ok: le tableau qui suit la section n'est pas la declaration — ses chiffres (scores, l.3)
      // cochaient tout (conv-690, saisie ts 1789715005953 : 5/5 envoyes pour « la piste 1 »).
      if (/^\s{0,3}#{1,6}\s+/u.test(lignes[j]!) || /^\s*\|/u.test(lignes[j]!)) break
      if (!lignes[j]!.trim()) {
        if (corps.length > 0) break
        continue
      }
      corps.push(lignes[j]!)
    }
    const valeur = corps.join(' ').trim()
    if (valeur) morceaux.push(valeur)
  }
  return morceaux.length > 0 ? morceaux : null
}

/**
 * CE QUE L'UTILISATEUR TAPE SOUS UN PANNEAU (conv-1333, 2026-10-30). Sur 6 panneaux depuis le 22/10,
 * 2 ont reçu une réponse tapée au lieu d'un clic : « 1 et 12 » (conv-1196) et « fais au mieux c trop
 * complexe pour moi » (conv-1097). Ces réponses passaient à côté de tout : aucune voie choisie, aucun
 * lot, et la mémoire du scout notait ces pistes « ignorées ».
 *
 * Reconnu : des numéros de lignes EXISTANTES, « toutes », ou une délégation (« fais au mieux », « go »,
 * « choisis ») quand le scout a déclaré sa cible — sans cible, personne n'a choisi, et le message suit
 * son chemin normal. « ok » et « oui » n'y sont pas : ils accusent réception, un plan coûte plusieurs
 * runs. Rien d'autre n'est deviné : le moindre mot de plus laisse le message au modèle.
 */
const CHOIX_PAR_NUMEROS = new RegExp(
  String.raw`^(?:(?:prends?|fais|lance|garde)\s+)?(?:(?:la|le|les)\s+)?(?:(?:lignes?|pistes?|candidats?|n[o°]|#)\s*)?(${LISTE_DE_NUMEROS})$`,
  'u'
)
const CHOIX_DE_TOUT = /^(?:toutes?|tous|tout|all)(?:\s+(?:les\s+)?(?:pistes|lignes|candidats))?$/u
const DELEGATION =
  /^(?:fais au mieux\b.*|au mieux|choisis(?: pour moi)?|a toi de choisir|decide(?: pour moi)?|go|vas[ -]y|lance(?:[ -]le)?|fais[ -]le)$/u

export function selectionTapee(
  texte: string,
  candidats: readonly CandidatAffiche[],
  texteScout: string | undefined
): ReadonlySet<number> | null {
  const nu = sansAccents(texte)
    .trim()
    .replace(/[\s.!]+$/u, '')
    .replace(/\s+(?:stp|svp|please|merci)$/u, '')
  if (!nu || nu.length > 80) return null
  const liste = CHOIX_PAR_NUMEROS.exec(nu)?.[1]
  if (liste) {
    const voulus = new Set(Array.from(liste.matchAll(/\d{1,3}/gu), (numero) => Number(numero[0])))
    const lignes = numerosDesCandidats(candidats)
    const retenus = new Set(lignes.flatMap((numero, rang) => (voulus.has(numero) ? [rang] : [])))
    // Un numéro hors du tableau n'est pas un choix de ce tableau (« 2024 », une ligne qui n'existe pas).
    return retenus.size === voulus.size ? retenus : null
  }
  if (CHOIX_DE_TOUT.test(nu)) return new Set(candidats.map((_, rang) => rang))
  if (DELEGATION.test(nu)) {
    const choix = selectionAutoDepuisScout(candidats, texteScout)
    return choix && choix.size > 0 ? choix : null
  }
  return null
}

/** Ce que ces fonctions lisent d'un message du fil — un sous-ensemble de `Msg`. */
export interface MessageLuParLePanneau {
  role: string
  done?: boolean
  status?: string
  parts?: readonly unknown[]
}

/** Le panneau du dernier tour, tel que le fil l'affiche ; `null` s'il n'y en a pas ou si le tour est refusé. */
export function panneauDuDernierTour(
  fil: readonly MessageLuParLePanneau[]
): { candidats: CandidatAffiche[]; texteScout: string } | null {
  const dernier = fil.at(-1)
  if (dernier?.role !== 'assistant' || dernier.done !== true) return null
  const textes = (dernier.parts ?? []).flatMap((part) => {
    const lue = part as { kind?: unknown; text?: unknown } | null
    return lue?.kind === 'text' && typeof lue.text === 'string' ? [lue.text] : []
  })
  if (tourRefusePourAutoLancer(dernier.status, textes)) return null
  for (const texte of textes) {
    const lignes = parseScoutTable(texte)
    const candidats = lignes ? candidatsDepuisScoutTable(lignes) : extraireCandidatsAffiches(texte)
    if (candidats) return { candidats, texteScout: texte }
  }
  return null
}

/** Le plan qu'un message tapé déclenche sous le panneau du dernier tour ; `null` sinon. */
export function planDeLaSaisie(
  texte: string,
  fil: readonly MessageLuParLePanneau[]
): LotDeLancement[] | null {
  const panneau = panneauDuDernierTour(fil)
  if (!panneau) return null
  const choix = selectionTapee(texte, panneau.candidats, panneau.texteScout)
  if (!choix || choix.size === 0) return null
  return planDeLancement(panneau.candidats.filter((_, rang) => choix.has(rang)))
}

/**
 * LE CLIC AUTOMATIQUE NE PART PAS D'UN TOUR REFUSÉ.
 *
 * Défaut vécu (conv-690, tour `dc63d3ea-7d64-472b-a6db-773f81ee5d82`) : le juge a refusé deux fois
 * (SCORE 60 puis 58, contrôle final rouge à 07:03:23), et 2,9 s plus tard le mode auto envoyait
 * « Traite ENSEMBLE ces 5 candidats… » (saisie ts 1789715005953) jusqu'au COMMIT PUBLIÉ. Le panneau
 * relisait le tableau scout reporté dans la bulle et cliquait sans rien savoir du verdict. Un tour
 * échoué, ou dont l'en-tête dit que le juge/contrôle final a refusé, laisse le bouton à l'humain.
 */
export function tourRefusePourAutoLancer(
  status: string | undefined,
  textes: readonly string[]
): boolean {
  if (status === 'failed' || status === 'cancelled' || status === 'interrupted') return true
  return textes.some((texte) =>
    /(⛔ Workflow ARRÊTÉ|⛔ Travail NON intégré|⏳ Travail PAS ENCORE intégré|le juge a REFUSÉ)/u.test(
      texte
    )
  )
}
