import { describe, expect, it } from 'vitest'
import {
  cibleNommeeTouchee,
  ciblesNommees,
  etatDeCloture,
  ROOT_DOD
} from './root-execution-contract'
import type { ExecutionEvidence } from './providers/types'

const DEMANDE_CONV_1302 = `/frame Traite ce candidat issu du scout interne d'Autowin :
1. Préserver la cause réelle des échecs de publication — ancrage src/main/store/run-worktree-coordinator.ts:1810 — pertinence 89/100
   Comment : Capturer l'erreur dans \`src/main/store/run-worktree-coordinator.ts:1810\`.`

const CIBLE = 'src/main/store/run-worktree-coordinator.ts'
const SEP = String.fromCharCode(92)

function mutation(paths: string[] | undefined, extra: Partial<ExecutionEvidence> = {}) {
  return {
    kind: 'mutation',
    status: 'completed',
    ok: true,
    summary: 'edit',
    ...(paths ? { paths } : {}),
    ...extra
  } as ExecutionEvidence
}

describe('ciblesNommees — extraction pure (INC-1)', () => {
  const cas: Array<[string, string, string[]]> = [
    ['demande verbatim conv-1302', DEMANDE_CONV_1302, [CIBLE]],
    ['aucun chemin', 'Corrige le bug de publication et relance les tests', []],
    ['perimetre OUT ancre', 'Périmètre OUT : src/a.ts:12 — reste intact', []],
    ['negation explicite', 'Répare le gate sans toucher à src/b.ts:4', []],
    ['chemin sans numero de ligne', 'Corrige le gate, voir aussi src/main/x.ts', []],
    ['fichier de test cite en passant', 'Le comportement est décrit dans src/main/gate.test.ts', []],
    ['URL avec port', 'Ouvre http://localhost:3000/src/app.ts:12 dans le navigateur', []],
    ['deux cibles ancrees', 'Corrige src/a.ts:12 puis src/main/b.ts:8', ['src/a.ts', 'src/main/b.ts']],
    ['chemin windows ancre', `Corrige src${SEP}main${SEP}store${SEP}gate.ts:44`, ['src/main/store/gate.ts']],
    ['doublon dedoublonne', 'src/main/x.ts:10 et encore src/main/x.ts:99', ['src/main/x.ts']]
  ]
  for (const [nom, demande, attendu] of cas) {
    it(nom, () => {
      expect(ciblesNommees(demande)).toEqual(attendu)
    })
  }
})

describe('cibleNommeeTouchee — croisement (INC-2)', () => {
  it('evidence sur un AUTRE fichier que la cible → manquee', () => {
    expect(cibleNommeeTouchee(DEMANDE_CONV_1302, [mutation(['src/main/orchestrator.ts'])])).toBe(
      'manquee'
    )
  })

  it('evidence sur la cible → touchee', () => {
    expect(cibleNommeeTouchee(DEMANDE_CONV_1302, [mutation([CIBLE])])).toBe('touchee')
  })

  it('chemin absolu Windows rapproche du chemin relatif de la demande', () => {
    expect(
      cibleNommeeTouchee(DEMANDE_CONV_1302, [
        mutation(undefined, { path: ['C:', 'Amitel', 'Autowin OS', ...CIBLE.split('/')].join(SEP) })
      ])
    ).toBe('touchee')
  })

  it('aucune preuve ne porte de chemin attribue → sans-objet (fail-open)', () => {
    expect(cibleNommeeTouchee(DEMANDE_CONV_1302, [mutation(undefined)])).toBe('sans-objet')
  })

  it('aucune cible nommee → sans-objet', () => {
    expect(cibleNommeeTouchee('Corrige le bug', [mutation(['src/main/orchestrator.ts'])])).toBe(
      'sans-objet'
    )
  })

  it('couverture PARTIELLE ne bloque pas : une cible sur deux suffit', () => {
    expect(cibleNommeeTouchee('Corrige src/a.ts:12 puis src/main/b.ts:8', [mutation(['src/a.ts'])])).toBe(
      'touchee'
    )
  })
})

describe('etatDeCloture — cablage du gate (INC-3, pas la fonction pure)', () => {
  const phases = (evidence: ExecutionEvidence[]) => [
    { phase: 'build', text: 'ok', executionEvidence: evidence }
  ]

  it('miss total ⇒ red + case de DoD non cochee NOMMANT la cible manquee', () => {
    const etat = etatDeCloture(
      DEMANDE_CONV_1302,
      phases([mutation(['src/main/orchestrator.ts'])]),
      true,
      true
    )
    expect(etat.status).toBe('red')
    const case_ = etat.dod.find((c) => c.label.includes(CIBLE))
    expect(case_).toBeDefined()
    expect(case_?.checked).toBe(false)
  })

  it('cible touchee ⇒ green, exactement comme aujourd’hui', () => {
    const etat = etatDeCloture(DEMANDE_CONV_1302, phases([mutation([CIBLE])]), true, true)
    expect(etat.status).toBe('green')
    expect(etat.dod.some((c) => c.label.includes(CIBLE))).toBe(false)
  })

  it('demande SANS chemin ⇒ aucune obligation inventee (non-regression n°1)', () => {
    const etat = etatDeCloture(
      'Corrige le bug de publication',
      phases([mutation(['src/main/orchestrator.ts'])]),
      true,
      true
    )
    expect(etat.status).toBe('green')
    expect(etat.dod.map((c) => c.label)).toEqual([ROOT_DOD.mutation])
  })

  it('couverture partielle reste VERTE au gate (le juge signale, il ne bloque pas)', () => {
    const etat = etatDeCloture(
      'Corrige src/a.ts:12 puis src/main/b.ts:8',
      phases([mutation(['src/a.ts'])]),
      true,
      true
    )
    expect(etat.status).toBe('green')
  })

  it('run en lecture seule : le controle ne s’applique pas', () => {
    const etat = etatDeCloture(
      DEMANDE_CONV_1302,
      [{ phase: 'scout', text: 'shortlist' }],
      false,
      true
    )
    expect(etat.status).toBe('green')
  })
})
