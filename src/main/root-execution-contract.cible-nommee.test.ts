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

/**
 * REGRESSION VECUE le 2026-08-18, en production, sur conv-1304.
 *
 * Le garde a bloque un run qui avait POURTANT modifie et committe la cible nommee. Cause : la preuve
 * d'execution portait `path: "0"` — une valeur degeneree, pas un chemin. `attributedPaths` la rend
 * telle quelle, le repli « aucun chemin attribue → sans-objet » n'a donc pas joue, et le croisement a
 * conclu au miss total. Un faux blocage est PIRE que le defaut que ce garde corrige : il rend l'app
 * inutilisable sur une demande legitime.
 *
 * Regle : une valeur n'est un chemin que si elle porte un separateur ou une extension de fichier.
 */
describe('cibleNommeeTouchee — une valeur degeneree n est pas un chemin', () => {
  const demande = 'corrige src/main/task-regime.ts:20 en ajoutant un commentaire'

  it('path "0" ne vaut PAS une preuve de chemin : on ne bloque pas', () => {
    const preuve = [
      { kind: 'mutation', status: 'ok', ok: true, path: '0' }
    ] as unknown as Parameters<typeof cibleNommeeTouchee>[1]
    expect(cibleNommeeTouchee(demande, preuve)).toBe('sans-objet')
  })

  it('une vraie preuve sur un AUTRE fichier bloque toujours', () => {
    const preuve = [
      { kind: 'mutation', status: 'ok', ok: true, path: 'src/main/orchestrator.ts' }
    ] as unknown as Parameters<typeof cibleNommeeTouchee>[1]
    expect(cibleNommeeTouchee(demande, preuve)).toBe('manquee')
  })

  it('la cible reellement touchee reste admise', () => {
    const preuve = [
      { kind: 'mutation', status: 'ok', ok: true, path: 'src/main/task-regime.ts' }
    ] as unknown as Parameters<typeof cibleNommeeTouchee>[1]
    expect(cibleNommeeTouchee(demande, preuve)).toBe('touchee')
  })
})

/**
 * CONFLIT D'INTÉRÊT — un run bloqué ne se déverrouille pas en réécrivant son propre gate.
 *
 * Défaut vécu (conv-1302, 2026-08-18) : bloqué par le gate, le run a réparé LE GATE quatre fois de
 * suite — `root-execution-contract.ts`, `phase-briefs.ts` — au lieu de la tâche demandée, puis a
 * fermé. L'autorité de clôture était devenue la chose que l'agent modifiait pour passer.
 *
 * Sens d'erreur imposé : faux négatif toléré, faux positif JAMAIS. La garde ne mord donc que sur le
 * cas total — AUCUNE mutation ailleurs que dans les garde-fous — et seulement si la demande ne
 * parlait ni des fichiers ni du gate.
 */
describe('etatDeCloture — le run ne se déverrouille pas en mutant son propre gate', () => {
  const gate = (chemin: string): ExecutionEvidence => mutation([chemin])
  const phase = (evidence: ExecutionEvidence[]): {
    phase: string
    text: string
    executionEvidence: ExecutionEvidence[]
  } => ({ phase: 'build', text: 'rapport', executionEvidence: evidence })

  // La demande ANCRÉE (`chemin:ligne`) est déjà couverte par la garde « cible nommée ». Le trou
  // qui reste est la demande NUE — « finis », « repare jusqu'a finir » — sur laquelle cette garde
  // s'ouvre volontairement (aucune cible à croiser). C'est exactement là que les quatre dérives de
  // conv-1302 sont passées : le tour ne nommait plus rien, donc plus rien ne les contredisait.
  it('BLOQUE : demande NUE, seule mutation = le contrat de clôture lui-même', () => {
    const etat = etatDeCloture(
      'finis',
      [phase([gate('src/main/root-execution-contract.ts')])],
      true,
      true
    )
    expect(etat.status).toBe('red')
    expect(etat.dod.some((c) => /garde-fou/i.test(c.label) && !c.checked)).toBe(true)
  })

  it('BLOQUE aussi via phase-briefs.ts (le prompt du juge est une autorité de clôture)', () => {
    const etat = etatDeCloture(
      'repare jusqu a finir cette task',
      [phase([gate('src/main/phase-briefs.ts')])],
      true,
      true
    )
    expect(etat.status).toBe('red')
  })

  it('BLOQUE quand la demande ancre une AUTRE cible (garde existante) ET nomme le motif', () => {
    const etat = etatDeCloture(
      DEMANDE_CONV_1302,
      [phase([gate('src/main/root-execution-contract.ts')])],
      true,
      true
    )
    expect(etat.status).toBe('red')
  })

  it('CONTRE-EXEMPLE — la demande NOMME le fichier du gate : mutation légitime', () => {
    const etat = etatDeCloture(
      'corrige src/main/root-execution-contract.ts:210 pour exiger toutes les cibles',
      [phase([gate('src/main/root-execution-contract.ts')])],
      true,
      true
    )
    expect(etat.status).toBe('green')
  })

  it('CONTRE-EXEMPLE — la demande PARLE du gate (kaizen) : mutation légitime', () => {
    const etat = etatDeCloture(
      'integre le garde kaizen qui refuse une cloture hors sujet dans le gate',
      [phase([gate('src/main/root-execution-contract.ts')])],
      true,
      true
    )
    expect(etat.status).toBe('green')
  })

  it('CONTRE-EXEMPLE — le run a AUSSI touché la cible demandée : rien à reprocher', () => {
    const etat = etatDeCloture(
      DEMANDE_CONV_1302,
      [phase([gate('src/main/root-execution-contract.ts'), gate(CIBLE)])],
      true,
      true
    )
    expect(etat.status).toBe('green')
  })

  it('CONTRE-EXEMPLE — un run en lecture seule n’est jamais concerné', () => {
    const etat = etatDeCloture(
      DEMANDE_CONV_1302,
      [{ phase: 'scout', text: 'shortlist' }],
      false,
      true
    )
    expect(etat.status).toBe('green')
  })
})
