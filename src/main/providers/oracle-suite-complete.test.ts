import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { loadTrustedLearningOracles } from './learning-oracle-manifest'
import { attestIsolatedVerificationEvidence } from './causal-verification-evidence'
import type { ExecutionEvidence } from './types'
import { evidenceRefs } from '../outcome-learning-supervisor'
import { decideOutcomeLearning } from '../outcome-learning-policy'
import {
  createIndependentLearningAttestation,
  learningProposalAttestation
} from '../outcome-learning-proposal'
import {
  OUTCOME_LEARNING_SCHEMA,
  type LearningEvidenceRef,
  type LearningProposalV1,
  type OutcomeObservedV1
} from '../../shared/run-learning'

/**
 * LE DÉFAUT, mesuré le 2026-08-25 sur les données réelles de l'apprentissage.
 *
 * Sur 255 issues observées : 22 leçons proposées, 22 décisions, **22 fois `inbox`, zéro publiée**.
 * Deux verrous mordaient sur chacune, dont `causality-not-proven` — qui exige un `oracleAttestation`
 * sur la preuve rouge. Compté sur le magasin : **0 occurrence sur 6013 preuves**, et `oracleStable`
 * vrai dans **0** des 678 vérifications qui portent le champ.
 *
 * LA CAUSE : une SEULE oracle était déclarée, un script PowerShell dont les `covers` ne listent que
 * les fichiers du sous-système d'apprentissage lui-même. Une preuve ne gagnait son attestation que
 * si sa commande était exactement ce script — donc un run sur le décor, les copies agent ou les
 * budgets ne pouvait JAMAIS prouver sa causalité. `publish` et `escrow` étaient hors d'atteinte par
 * construction pour tout travail normal.
 *
 * L'ÉLARGISSEMENT, et ses bornes. On déclare la suite comportementale complète, dans les TROIS
 * formes réellement relevées dans les traces de run (`npm run test:unit`, `npx vitest run`,
 * `vitest run`). Sont délibérément EXCLUS `npm run typecheck` et `npm run build`, pourtant plus
 * fréquents encore : un vert de compilation ne prouve pas un comportement, et une leçon « prouvée »
 * par un typecheck serait une fausse preuve causale.
 *
 * CE QUI PORTE VRAIMENT LA PREUVE reste la paire rouge→vert de `causalPair` : même signature de
 * commande, cibles croisées avec celles de la mutation, et deux verts identiques après. `covers` ne
 * dit que la PORTÉE de la commande ; il ne remplace pas cette paire.
 */

const RACINE = join(__dirname, '..', '..', '..')

/** Chargees UNE fois, avant tout `describe` qui les lit : ne pas dependre de l ordre de collecte. */
const oraclesDeclarees = loadTrustedLearningOracles(RACINE)

const preuve = (partiel: Partial<ExecutionEvidence>): ExecutionEvidence => ({
  type: 'command_execution',
  kind: 'verification',
  status: 'completed',
  ok: false,
  summary: '',
  ...partiel
})

describe('les oracles déclarées', () => {
  it('couvrent la suite complète, en plus du script historique', () => {
    const oracles = loadTrustedLearningOracles(RACINE)
    const commandes = oracles.map((oracle) => oracle.command)

    expect(commandes).toContain('npm run test:unit')
    expect(commandes).toContain('npx vitest run')
    expect(commandes).toContain('vitest run')
    // L'oracle d'origine survit : élargir n'est pas remplacer.
    expect(commandes.some((commande) => commande.includes('verify-brain-outcome-writeback'))).toBe(
      true
    )
  })

  it('n’attestent NI le typecheck NI le build — un vert de compilation ne prouve pas un comportement', () => {
    // L'entrée qui doit faire échouer un élargissement trop gourmand. Ces deux commandes sont les
    // PLUS fréquentes dans les traces (50 et 39 occurrences) : les inclure serait tentant, et
    // rendrait « causalement prouvée » une leçon qu'aucun test n'a exercée.
    const commandes = loadTrustedLearningOracles(RACINE).map((oracle) => oracle.command)

    expect(commandes.some((commande) => commande.includes('typecheck'))).toBe(false)
    expect(commandes.some((commande) => commande.includes('run build'))).toBe(false)
  })
})

describe('ce que la suite complète atteste vraiment', () => {
  const oracles = oraclesDeclarees

  it('atteste une vérification qui suit une mutation de `src/`', () => {
    const evidence: ExecutionEvidence[] = [
      preuve({ kind: 'mutation', ok: true, path: 'src/main/agent-pilot.ts' }),
      preuve({ command: 'npm run test:unit', exitCode: 1 })
    ]

    const [, verification] = attestIsolatedVerificationEvidence(evidence, true, oracles)

    expect(verification.oracleStable).toBe(true)
    expect(verification.oracleAttestation).toBeTruthy()
  })

  it('REFUSE d’attester un run qui modifie ce qui DÉFINIT la suite', () => {
    // Anti-auto-attestation : un run qui change `vitest.config.ts` change ce que la suite exécute.
    // Il ne peut pas se servir de cette même suite comme preuve de lui-même.
    const evidence: ExecutionEvidence[] = [
      preuve({ kind: 'mutation', ok: true, path: 'vitest.config.ts' }),
      preuve({ command: 'npm run test:unit', exitCode: 1 })
    ]

    const [, verification] = attestIsolatedVerificationEvidence(evidence, true, oracles)

    expect(verification.oracleStable).toBeUndefined()
    expect(verification.oracleAttestation).toBeUndefined()
  })

  it('REFUSE une suite PARTIELLE — elle ne couvre pas ce qu’une suite complète couvre', () => {
    // Le bord qui décide de l'honnêteté de tout l'élargissement : `npx vitest run <un fichier>` est
    // la forme la plus courante dans les traces. Lui accorder la portée `src/**` ferait attester une
    // couverture qui n'a pas eu lieu.
    const evidence: ExecutionEvidence[] = [
      preuve({ kind: 'mutation', ok: true, path: 'src/main/agent-pilot.ts' }),
      preuve({ command: 'npx vitest run src/main/agent-pilot.test.ts', exitCode: 1 })
    ]

    const [, verification] = attestIsolatedVerificationEvidence(evidence, true, oracles)

    expect(verification.oracleAttestation).toBeUndefined()
  })

  it('n’atteste RIEN quand le run n’est pas causalement isolé', () => {
    const evidence: ExecutionEvidence[] = [
      preuve({ kind: 'mutation', ok: true, path: 'src/main/agent-pilot.ts' }),
      preuve({ command: 'npm run test:unit', exitCode: 1 })
    ]

    const [, verification] = attestIsolatedVerificationEvidence(evidence, false, oracles)

    expect(verification.oracleAttestation).toBeUndefined()
  })
})

/**
 * LA CHAÎNE ENTIÈRE, de la preuve brute au verdict de la politique.
 *
 * Les deux bouts étaient déjà couverts — l'attestation ici, la décision dans
 * `outcome-learning-policy.test.ts` qui publie sur une observation aux champs remplis. Ce qui
 * manquait était la démonstration que la RÉALITÉ remplit ces champs : sur les données du magasin,
 * `oracleAttestation` valait 0 sur 6013 preuves.
 *
 * Ce test rejoue un run ordinaire — rouge, mutation, deux verts — avec de VRAIES commandes, et
 * vérifie que `causality-not-proven` disparaît des motifs.
 */
const runOrdinairePartage = (commande: string): ExecutionEvidence[] => [
  preuve({ command: commande, exitCode: 1, ok: false }),
  // `pathFingerprints` n'est pas decoratif : c'est LUI qui rend la mutation « materielle » aux yeux
  // de `causalPair`. Une mutation sans empreinte ne prouve rien, et le magasin le confirme —
  // 379 mutations sur 1266 en portent.
  preuve({
    kind: 'mutation',
    ok: true,
    path: 'src/main/agent-pilot.ts',
    pathFingerprints: { 'src/main/agent-pilot.ts': 'sha256:apres-la-mutation' }
  }),
  preuve({ command: commande, exitCode: 0, ok: true }),
  preuve({ command: commande, exitCode: 0, ok: true })
]

const propositionPartagee = (): LearningProposalV1 => ({
  schema: OUTCOME_LEARNING_SCHEMA,
  eventId: 'proposal-1',
  conversationId: 'conv-1',
  turnId: 'turn-1',
  runId: 'run-1',
  createdAt: '2026-08-25T10:00:00.000Z',
  outcome: 'success',
  title: 'La suite complète encadre la mutation',
  body: 'Rejouer le même signal avant et après la mutation établit la causalité locale.',
  type: 'lesson',
  scope: 'autowin-os',
  source: 'session:turn-1',
  tags: ['outcome-learning'],
  confidence: 'high',
  candidateId: 'inbox/lesson.md',
  stored: true,
  truncated: false
})

const observationPartagee = (evidence: LearningEvidenceRef[]): OutcomeObservedV1 => ({
  schema: OUTCOME_LEARNING_SCHEMA,
  eventId: 'outcome-1',
  conversationId: 'conv-1',
  turnId: 'turn-1',
  runId: 'run-1',
  workspace: 'C:/Amitel/Autowin OS',
  createdAt: '2026-08-25T10:01:00.000Z',
  status: 'succeeded',
  valid: true,
  gateBlocked: false,
  reused: false,
  evidence,
  attestedProposalHashes: [learningProposalAttestation(propositionPartagee())],
  independentProposalAttestations: [
    createIndependentLearningAttestation(
      learningProposalAttestation(propositionPartagee()),
      'run-1',
      'judge:test'
    )
  ]
})

const motifs = (commande: string, oraclesUtilisees = oraclesDeclarees): string[] =>
  decideOutcomeLearning(
    propositionPartagee(),
    observationPartagee(
      evidenceRefs(
        attestIsolatedVerificationEvidence(runOrdinairePartage(commande), true, oraclesUtilisees)
      )
    )
  ).reasons

describe('la chaîne causale complète, sur un run ordinaire', () => {
  it('la causalité cesse d’être un motif de blocage', () => {
    // LA mesure de tout l'élargissement : ce motif tombait sur 22 leçons sur 22.
    expect(motifs('npm run test:unit')).not.toContain('causality-not-proven')
  })

  it('AVANT l’élargissement, le même run restait bloqué', () => {
    // Contre-épreuve : avec la seule oracle historique, la même séquence ne prouve rien — c'est
    // l'état mesuré sur les 6013 preuves du magasin.
    const historique = oraclesDeclarees.filter((oracle) =>
      oracle.command.includes('verify-brain-outcome')
    )

    expect(motifs('npm run test:unit', historique)).toContain('causality-not-proven')
  })

  it('une suite PARTIELLE reste bloquée', () => {
    expect(motifs('npx vitest run src/main/agent-pilot.test.ts')).toContain('causality-not-proven')
  })
})

describe('jusqu’où la décision monte, une fois la causalité prouvée', () => {
  const oracles = oraclesDeclarees

  it('atteint `publish` quand la causalité ET l’attestation du juge sont réunies', () => {
    // Ce que l'élargissement rend ATTEIGNABLE. Il ne rend pas la publication automatique : l'autre
    // verrou — l'attestation indépendante du juge — reste exigé, et il est ici satisfait par le
    // fixture. Sur les données réelles il ne l'a jamais été (0 sur 256 observations) : c'est le
    // chantier suivant, distinct de celui-ci.
    const evidence = evidenceRefs(
      attestIsolatedVerificationEvidence(runOrdinairePartage('npm run test:unit'), true, oracles)
    )

    expect(decideOutcomeLearning(propositionPartagee(), observationPartagee(evidence)).route).toBe(
      'publish'
    )
  })
})
