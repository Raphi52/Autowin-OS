import { extraireBilan } from './bilan-d-etape'

/**
 * LE RUN PARLE LUI-MEME A LA FIN (conv-1008, 2026-10-16).
 *
 * Demande : « claude.exe sait faire ça c pas mal je veux pareil », capture jointe d'une carte
 * « Message from subagent › » — deux lignes de resume, une question, deux reponses cliquables et
 * une croix. Jusqu'ici un run orchestre ne pouvait RIEN demander a l'utilisateur : son texte
 * remontait a l'agent du chat, qui seul posait une question (`ask`). Le canal `<question>` des
 * runs est desactive (`src/main/model-questions.ts`).
 *
 * La question du run vit dans la ligne `- Question :` du bilan de fin d'etape (consigne
 * `CONSIGNE_BILAN`, phase-briefs.ts). Ce module la lit, au meme endroit que `extraireBilan`, dans
 * la DERNIERE etape qui porte un bilan : une question posee par une etape anterieure a ete
 * depassee par celles qui ont suivi, on ne la ressort donc jamais.
 *
 * Forme lue : `- Question : <question> → <reponse recommandee> | <autre reponse>` ; « aucune »
 * (le defaut) ne produit rien. Une ligne mal formee ne produit rien non plus : une question dont
 * on devinerait les reponses ferait cliquer l'utilisateur sur un texte que personne n'a ecrit.
 */

/** Une reponse proposee par le run. La premiere est la recommandee. */
export interface ReponseDuRun {
  libelle: string
  recommande?: true
}

export interface MessageDuRun {
  /** Le resume en une ou deux phrases : la phrase du verdict, puis ce qui reste a faire. */
  resume?: string
  question: string
  reponses: ReponseDuRun[]
}

/** Les sorties d'etapes telles que l'orchestrateur les rend (`phaseOutputs`). */
export interface SortieDEtape {
  phase?: string
  text?: string
}

const REPONSES_MIN = 2
const REPONSES_MAX = 4
const PLAFOND_QUESTION = 300
const PLAFOND_REPONSE = 120
const PLAFOND_RESUME = 400

const LIGNE_QUESTION = /^\s*[-*]\s*Question\s*:\s*(.+?)\s*$/imu
const LIGNE_VERDICT = /^\s*[-*]\s*Verdict\s*:\s*(.+?)\s*$/imu
const LIGNE_RESTE = /^\s*[-*]\s*Reste à faire\s*:\s*(.+?)\s*$/imu
/** `aucune`, `aucune question`, `—`, `-` : le defaut, rien a demander. */
const SANS_QUESTION = /^(?:aucune\b.*|néant|non|—|-|–)$/iu
/** `aucun reste`, `aucun`, `rien` : rien a ajouter au resume. */
const SANS_RESTE = /^(?:aucun(?:e)?\b.*|rien\b.*|néant|—|-|–)$/iu
/** Fleche entre la question et ses reponses : la consigne demande `→`, `->` est tolere. */
const FLECHE = /\s*(?:→|->)\s*/u

/** Enleve l'habillage Markdown qu'un modele pose volontiers autour d'un libelle. */
function nettoyer(segment: string): string {
  return segment
    .trim()
    .replace(/^[`*_«"“]+|[`*_»"”]+$/gu, '')
    .trim()
}

/** Un gabarit recopie tel quel (`<question>`) n'est pas une question. */
function estUnGabarit(segment: string): boolean {
  return /^<.*>$/u.test(segment)
}

/**
 * La question de CE bilan, ou `undefined`. Exporte pour le test qui lie la consigne et le lecteur.
 */
export function questionDuBilan(bilan: string): Omit<MessageDuRun, 'resume'> | undefined {
  const brut = LIGNE_QUESTION.exec(bilan)?.[1]
  if (!brut || SANS_QUESTION.test(nettoyer(brut))) return undefined
  const [avant, ...apres] = brut.split(FLECHE)
  if (apres.length !== 1) return undefined
  const question = nettoyer(avant ?? '')
  if (!question || estUnGabarit(question) || question.length > PLAFOND_QUESTION) return undefined
  const libelles = (apres[0] ?? '')
    .split('|')
    .map(nettoyer)
    .filter((libelle) => libelle.length > 0)
  if (libelles.length < REPONSES_MIN || libelles.length > REPONSES_MAX) return undefined
  if (libelles.some((libelle) => estUnGabarit(libelle) || libelle.length > PLAFOND_REPONSE))
    return undefined
  // Deux reponses identiques ne font pas un choix.
  if (new Set(libelles.map((libelle) => libelle.toLowerCase())).size !== libelles.length)
    return undefined
  return {
    question,
    reponses: libelles.map((libelle, rang) =>
      rang === 0 ? { libelle, recommande: true as const } : { libelle }
    )
  }
}

/** La phrase du verdict (apres le tiret), puis le reste a faire s'il y en a un. */
function resumeDuBilan(bilan: string): string | undefined {
  const verdict = LIGNE_VERDICT.exec(bilan)?.[1]
  const phrase = verdict
    ? nettoyer(
        verdict
          .split(/\s+[—–-]\s+/u)
          .slice(1)
          .join(' — ') || verdict
      )
    : ''
  const reste = nettoyer(LIGNE_RESTE.exec(bilan)?.[1] ?? '')
  const morceaux = [phrase, reste && !SANS_RESTE.test(reste) ? `Reste à faire : ${reste}` : '']
    .map((morceau) => morceau.trim())
    .filter(Boolean)
    .map((morceau) => (/[.!?…]$/u.test(morceau) ? morceau : `${morceau}.`))
  const resume = morceaux.join(' ')
  if (!resume) return undefined
  return resume.length > PLAFOND_RESUME ? `${resume.slice(0, PLAFOND_RESUME - 1)}…` : resume
}

/**
 * Le message que le run adresse a l'utilisateur, ou `undefined` s'il n'a rien a lui demander.
 * Seule la DERNIERE etape qui porte un bilan parle (le juge n'en porte pas : format strict).
 */
export function messageDuRun(
  sorties: readonly SortieDEtape[] | undefined
): MessageDuRun | undefined {
  if (!sorties?.length) return undefined
  for (let rang = sorties.length - 1; rang >= 0; rang -= 1) {
    const texte = sorties[rang]?.text
    if (!texte) continue
    const trouve = extraireBilan(texte)
    if (!trouve) continue
    const question = questionDuBilan(trouve.bilan)
    if (!question) return undefined
    const resume = resumeDuBilan(trouve.bilan)
    return resume ? { resume, ...question } : question
  }
  return undefined
}

/**
 * Relit un message du run venu du DISQUE ou de l'IPC (`data.messageDuRun` d'une action
 * `orchestrate`) : une forme inattendue ne produit rien, jamais des boutons a moitie remplis.
 */
export function lireMessageDuRun(valeur: unknown): MessageDuRun | undefined {
  if (!valeur || typeof valeur !== 'object' || Array.isArray(valeur)) return undefined
  const brut = valeur as Record<string, unknown>
  const question = typeof brut.question === 'string' ? brut.question.trim() : ''
  if (!question || !Array.isArray(brut.reponses)) return undefined
  const reponses = brut.reponses.flatMap((reponse): ReponseDuRun[] => {
    if (!reponse || typeof reponse !== 'object') return []
    const libelle = (reponse as { libelle?: unknown }).libelle
    if (typeof libelle !== 'string' || !libelle.trim()) return []
    return [
      (reponse as { recommande?: unknown }).recommande === true
        ? { libelle: libelle.trim(), recommande: true }
        : { libelle: libelle.trim() }
    ]
  })
  if (reponses.length < REPONSES_MIN) return undefined
  const resume =
    typeof brut.resume === 'string' && brut.resume.trim() ? brut.resume.trim() : undefined
  return resume ? { resume, question, reponses } : { question, reponses }
}

/**
 * Ce que l'agent du chat lit a cote de l'issue du run : la question est DEJA a l'ecran, avec ses
 * reponses cliquables. Sans cet avis, il la reposait avec `ask` et l'utilisateur voyait deux fois
 * la meme decision. Deterministe : l'avis n'existe que si la carte existe.
 */
export function avisMessageDuRun(message: MessageDuRun | undefined): string | undefined {
  if (!message) return undefined
  const reponses = message.reponses.map((reponse) => `« ${reponse.libelle} »`).join(' / ')
  return (
    `QUESTION DU RUN DÉJÀ AFFICHÉE à l'utilisateur, avec ses réponses cliquables : ` +
    `« ${message.question} » → ${reponses}. Ne la repose pas avec ask ; ` +
    `sa réponse arrivera comme son prochain message.`
  )
}
