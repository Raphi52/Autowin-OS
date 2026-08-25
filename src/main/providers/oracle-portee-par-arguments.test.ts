import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { attestIsolatedVerificationEvidence } from './causal-verification-evidence'
import { loadTrustedLearningOracles } from './learning-oracle-manifest'
import type { ExecutionEvidence, TrustedLearningOracle } from './types'

/**
 * `vitest related` — LE SEUL ORACLE DONT LA PORTÉE EST PROUVÉE, pas déclarée.
 *
 * LE DÉFAUT, mesuré le 2026-08-25. Après avoir levé le verrou d'attestation du juge (une observation
 * en porte enfin une : 0 sur 256 avant, 1 sur 261 après), il ne restait qu'un motif de blocage sur la
 * dernière leçon : `causality-not-proven`. La cause est une tension entre deux mesures du même jour :
 *
 *   - mes oracles exigent la suite COMPLÈTE (`npm run test:unit`, `npx vitest run`, `vitest run`) ;
 *   - la suite complète DÉPASSE le plafond de 600 s de ce dépôt.
 *
 * Les agents lancent donc nécessairement du ciblé, et le ciblé n'obtenait aucune attestation. La borne
 * que j'avais choisie — « une suite partielle ne couvre pas `src/**` » — était juste pour un fichier
 * choisi au hasard, et fausse pour `vitest related` : cette commande joue précisément les tests qui
 * IMPORTENT les fichiers qu'on lui nomme.
 *
 * D'OÙ LA FORME PARTICULIÈRE DE CET ORACLE : sa couverture ne vient pas d'une liste `covers` qu'il
 * faudrait croire, elle vient de SES PROPRES ARGUMENTS, confrontés aux chemins réellement mutés. Une
 * couverture prouvée par construction, jamais déclarée. C'est plus fort que les trois autres.
 *
 * LA BORNE QUI COMPTE : si UN SEUL chemin muté manque aux arguments, la couverture est incomplète et
 * l'attestation est refusée. Sans cela, un agent qui mute deux fichiers et n'en vérifie qu'un
 * obtiendrait une preuve causale pour du code que rien n'a exercé.
 */

const ORACLE_RELATED: TrustedLearningOracle = {
  command: 'vitest related',
  covers: [],
  attestedFiles: ['vitest.config.ts'],
  attestation: 'manifest:related',
  couvreSesArguments: true
}

const preuve = (partiel: Partial<ExecutionEvidence>): ExecutionEvidence => ({
  type: 'command_execution',
  kind: 'verification',
  status: 'completed',
  ok: false,
  summary: '',
  ...partiel
})

const mutation = (...chemins: string[]): ExecutionEvidence =>
  preuve({
    kind: 'mutation',
    ok: true,
    paths: chemins,
    pathFingerprints: Object.fromEntries(chemins.map((c) => [c, `sha:${c}`]))
  })

describe('`vitest related` atteste quand ses arguments couvrent la mutation', () => {
  it('atteste une vérification dont les arguments citent le fichier muté', () => {
    const evidence = [
      mutation('src/main/chose.ts'),
      preuve({ command: 'vitest related src/main/chose.ts --run', exitCode: 1 })
    ]

    const [, verification] = attestIsolatedVerificationEvidence(evidence, true, [ORACLE_RELATED])

    expect(verification.oracleStable).toBe(true)
    expect(verification.oracleAttestation).toBe('manifest:related')
  })

  it('atteste quand TOUS les fichiers mutés sont cités', () => {
    const evidence = [
      mutation('src/main/a.ts', 'src/main/b.ts'),
      preuve({ command: 'vitest related src/main/a.ts src/main/b.ts --run', exitCode: 1 })
    ]

    const [, verification] = attestIsolatedVerificationEvidence(evidence, true, [ORACLE_RELATED])

    expect(verification.oracleAttestation).toBe('manifest:related')
  })

  it('REFUSE une couverture INCOMPLÈTE — le bord qui décide de la sûreté', () => {
    // Deux fichiers mutés, un seul vérifié : accorder la preuve causale ici la donnerait à du code
    // que rien n'a exercé. C'est exactement le faux vert que ce mécanisme existe pour empêcher.
    const evidence = [
      mutation('src/main/a.ts', 'src/main/b.ts'),
      preuve({ command: 'vitest related src/main/a.ts --run', exitCode: 1 })
    ]

    const [, verification] = attestIsolatedVerificationEvidence(evidence, true, [ORACLE_RELATED])

    expect(verification.oracleAttestation).toBeUndefined()
  })

  it('REFUSE quand le run modifie ce qui DÉFINIT la suite', () => {
    // Anti-auto-attestation, comme pour les autres oracles.
    const evidence = [
      mutation('vitest.config.ts'),
      preuve({ command: 'vitest related vitest.config.ts --run', exitCode: 1 })
    ]

    const [, verification] = attestIsolatedVerificationEvidence(evidence, true, [ORACLE_RELATED])

    expect(verification.oracleAttestation).toBeUndefined()
  })

  it('n’atteste PAS une autre commande qui commencerait pareil', () => {
    // La correspondance porte sur le PREMIER segment de commande, pas sur une sous-chaîne : sinon
    // `vitest relatedxyz` ou un habillage quelconque passerait.
    const evidence = [
      mutation('src/main/chose.ts'),
      preuve({ command: 'vitest relatedxyz src/main/chose.ts --run', exitCode: 1 })
    ]

    const [, verification] = attestIsolatedVerificationEvidence(evidence, true, [ORACLE_RELATED])

    expect(verification.oracleAttestation).toBeUndefined()
  })

  it('un oracle SANS `couvreSesArguments` garde la correspondance EXACTE', () => {
    // La forme historique ne change pas : ce n'est pas un assouplissement général.
    const exact: TrustedLearningOracle = {
      command: 'npm run test:unit',
      covers: ['src/**'],
      attestedFiles: ['vitest.config.ts'],
      attestation: 'manifest:exact'
    }
    const evidence = [
      mutation('src/main/chose.ts'),
      preuve({ command: 'npm run test:unit src/main/chose.ts', exitCode: 1 })
    ]

    const [, verification] = attestIsolatedVerificationEvidence(evidence, true, [exact])

    expect(verification.oracleAttestation).toBeUndefined()
  })
})

/**
 * DE BOUT EN BOUT, depuis la DECLARATION reelle du depot — pas depuis un oracle fabrique dans le test.
 *
 * Une entree de manifeste peut etre parfaitement ecrite et ignoree en silence par le chargeur : c'est
 * exactement ce qui est arrive ici avant que le chargeur ne transporte `couvreSesArguments`. Ce bloc
 * part donc de `package.json`.
 */
describe('l’oracle déclaré dans le dépôt atteste la commande réelle', () => {
  const oracles = loadTrustedLearningOracles(join(__dirname, '..', '..', '..'))

  it('`vitest related` est déclaré, et son drapeau survit au chargement', () => {
    const related = oracles.find((oracle) => oracle.command === 'vitest related')
    expect(related, 'oracle `vitest related` absent du manifeste chargé').toBeTruthy()
    expect(related?.couvreSesArguments).toBe(true)
  })

  it('atteste la commande que le gate ciblé lance réellement', () => {
    // La forme EXACTE produite par `decideRelatedVerify` : `vitest related <chemins> --run`.
    const evidence = [
      mutation('src/main/verify-command.ts'),
      preuve({ command: 'vitest related src/main/verify-command.ts --run', exitCode: 1 })
    ]

    const [, verification] = attestIsolatedVerificationEvidence(evidence, true, oracles)

    expect(verification.oracleStable).toBe(true)
    expect(verification.oracleAttestation).toBeTruthy()
  })

  it('la suite COMPLÈTE garde son attestation — élargir n’a rien retiré', () => {
    const evidence = [
      mutation('src/main/verify-command.ts'),
      preuve({ command: 'npm run test:unit', exitCode: 1 })
    ]

    const [, verification] = attestIsolatedVerificationEvidence(evidence, true, oracles)

    expect(verification.oracleAttestation).toBeTruthy()
  })

  it('`typecheck` et `build` restent SANS attestation', () => {
    for (const commande of ['npm run typecheck', 'npm run build']) {
      const evidence = [
        mutation('src/main/verify-command.ts'),
        preuve({ command: commande, exitCode: 1 })
      ]
      const [, verification] = attestIsolatedVerificationEvidence(evidence, true, oracles)
      expect(verification.oracleAttestation, commande).toBeUndefined()
    }
  })
})
