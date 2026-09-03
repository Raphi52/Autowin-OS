import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  questionPoseeSansAvoirLu,
  statusEstUneLecture,
  RELANCE_QUESTION_SANS_LECTURE
} from './chat-turn-messages'

/**
 * LE DÉFAUT, mesuré le 2026-08-25 sur conv-1399.
 *
 * L'utilisateur demande « je vois toujours le fond d'écran […] je veux une reproduction en 3d ».
 * L'agent répond par un choix à quatre options — « profondeur sur l'image existante » ou « vraie
 * scène 3D qui remplace l'image » — en ayant lu **zéro fichier**. Or l'une de ces options était déjà
 * implémentée ET committée dans le dépôt. L'utilisateur a donc attendu pour une réponse qui était à
 * portée de lecture. Son mot : « son agent a posé une question dont la réponse était dans le code
 * qu'il pouvait lire. »
 *
 * POURQUOI UN MÉCANISME ET PAS UNE CONSIGNE. La règle existait DÉJÀ en prose dans la constitution
 * remise à l'agent (réflexe 1 : « avant de poser une question → board-gate : un fait CITÉ peut
 * répondre ? »). Elle a été enfreinte quand même. C'est le motif connu du garde-fou PASSIF. On la
 * rend donc mécanique, sur le modèle exact de sa jumelle — la relance du chiffre deviné.
 *
 * LE DÉCLENCHEUR est l'ABSENCE TOTALE de lecture, jamais la forme de la question : une question de
 * GOÛT appartient légitimement à l'humain, et elle passe dès qu'une lecture a eu lieu.
 */

describe('une question posée sans avoir rien lu est relancée', () => {
  it('mord sur le cas mesuré : question posée, aucune lecture', () => {
    expect(questionPoseeSansAvoirLu(true, false)).toBe(true)
  })

  it('ne mord PAS quand une lecture a eu lieu — une question éclairée reste légitime', () => {
    // Le bord qui compte : un arbitrage de goût, un choix que seul l'utilisateur possède, doivent
    // continuer de passer. Ce garde refuse de demander AVANT d'avoir regardé, pas de demander.
    expect(questionPoseeSansAvoirLu(true, true)).toBe(false)
  })

  it('ne mord pas sur un tour sans question', () => {
    expect(questionPoseeSansAvoirLu(false, false)).toBe(false)
    expect(questionPoseeSansAvoirLu(false, true)).toBe(false)
  })

  it('la relance ORDONNE de lire, et laisse la question possible après lecture', () => {
    // Une relance qui interdirait de questionner tout court retirerait à l'utilisateur les
    // arbitrages qui lui appartiennent. Elle doit exiger la lecture, puis rouvrir les deux issues.
    expect(RELANCE_QUESTION_SANS_LECTURE).toMatch(/read_file|find_in_files|list_files/)
    expect(RELANCE_QUESTION_SANS_LECTURE).toContain('hypothèse énoncée')
    expect(RELANCE_QUESTION_SANS_LECTURE).toMatch(/repose\s+la\s+question/)
  })
})

/**
 * LE CÂBLAGE, testé à part — une fonction pure que personne n'appelle ne garde rien.
 *
 * Ce dépôt a déjà payé ce défaut ailleurs : des valeurs calculées avec soin, retournées, et lues par
 * AUCUN consommateur de production (voir `travauxNonLivres` dans `stopgate.ts`). Le test pur
 * ci-dessus passerait à l'identique si le garde n'était branché nulle part.
 */
describe('le garde est réellement branché dans la boucle de tour', () => {
  const source = readFileSync(join(__dirname, 'agent-pilot.ts'), 'utf8')

  it('lève le drapeau quand l’action `ask` s’exécute', () => {
    // Sans cette ligne, `questionPoseeCeTour` reste faux et le garde ne peut jamais mordre.
    expect(source).toMatch(/token\.name === 'ask'\)\s*questionPoseeCeTour = true/)
  })

  it('appelle le garde et renvoie la relance à l’agent', () => {
    expect(source).toMatch(/questionPoseeSansAvoirLu\(questionPoseeCeTour,\s*anyReadExecuted\)/)
    expect(source).toContain('convo.push(RELANCE_QUESTION_SANS_LECTURE)')
  })

  /*
   * Les outils NATIFS de lecture n'emettent aucun jeton `<cmd>` : ils passent par le battement
   * d'outil (`chunk.status`). Sans ce branchement, `anyReadExecuted` restait faux apres une douzaine
   * de fichiers lus, et le garde mordait a chaque question — en ordonnant d'avancer sans demander,
   * donc en ecrasant la skill `draft` qui exige de faire choisir l'humain (conv-167, 2026-09-03).
   */
  it('compte AUSSI les lectures natives, qui arrivent par le battement d’outil', () => {
    expect(source).toMatch(/statusEstUneLecture\(chunk\.status\)\)\s*anyReadExecuted = true/)
  })

  it('ne relance QU’UNE FOIS — sinon un tour peut boucler en payant à chaque passage', () => {
    expect(source).toContain('questionSansLectureRecoveryAvailable = false')
  })
})

describe('une lecture NATIVE compte comme une lecture', () => {
  it('reconnaît les outils de lecture du modèle', () => {
    expect(statusEstUneLecture('Read · src/main/agent-pilot.ts')).toBe(true)
    expect(statusEstUneLecture('Grep · questionPoseeSansAvoirLu')).toBe(true)
    expect(statusEstUneLecture('Glob · **/*.tsx')).toBe(true)
  })

  it('reconnaît un `Bash` de lecture', () => {
    expect(statusEstUneLecture('Bash · cat src/main/skill-pipeline.ts')).toBe(true)
    expect(statusEstUneLecture('Bash · sed -n 1,60p fichier.ts')).toBe(true)
    expect(statusEstUneLecture('Bash · grep -n motif src')).toBe(true)
  })

  /* La liste est FERMÉE : un `Bash` quelconque n'est pas une lecture, sinon le garde ne mord plus. */
  it('refuse un `Bash` qui ne lit rien', () => {
    expect(statusEstUneLecture('Bash · npm run build')).toBe(false)
    expect(statusEstUneLecture('Bash · git commit -m "x"')).toBe(false)
    expect(statusEstUneLecture('Write · fichier.ts')).toBe(false)
    expect(statusEstUneLecture('')).toBe(false)
    expect(statusEstUneLecture(undefined)).toBe(false)
  })
})
