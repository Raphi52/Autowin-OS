import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  cibleNommeeTouchee,
  ciblesNommees,
  etatDeCloture,
  ROOT_DOD
} from './root-execution-contract'
import type { ExecutionEvidence } from '../providers/types'

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
    expect(cibleNommeeTouchee(DEMANDE_CONV_1302, [mutation(['src/main/orchestration/orchestrator.ts'])])).toBe(
      'manquee'
    )
  })

  it('evidence sur la cible → touchee', () => {
    expect(cibleNommeeTouchee(DEMANDE_CONV_1302, [mutation([CIBLE])])).toBe('touchee')
  })

  it('chemin absolu Windows rapproche du chemin relatif de la demande', () => {
    expect(
      cibleNommeeTouchee(DEMANDE_CONV_1302, [
        mutation(undefined, { path: ['C:', 'Acme', 'Autowin OS', ...CIBLE.split('/')].join(SEP) })
      ])
    ).toBe('touchee')
  })

  it('aucune preuve ne porte de chemin attribue → sans-objet (fail-open)', () => {
    expect(cibleNommeeTouchee(DEMANDE_CONV_1302, [mutation(undefined)])).toBe('sans-objet')
  })

  it('aucune cible nommee → sans-objet', () => {
    expect(cibleNommeeTouchee('Corrige le bug', [mutation(['src/main/orchestration/orchestrator.ts'])])).toBe(
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
      phases([mutation(['src/main/orchestration/orchestrator.ts'])]),
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
      phases([mutation(['src/main/orchestration/orchestrator.ts'])]),
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
 * REGRESSION VECUE le 2026-08-18, en production.
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
  const demande = 'corrige src/main/orchestration/task-regime.ts:20 en ajoutant un commentaire'

  it('path "0" ne vaut PAS une preuve de chemin : on ne bloque pas', () => {
    const preuve = [
      { kind: 'mutation', status: 'ok', ok: true, path: '0' }
    ] as unknown as Parameters<typeof cibleNommeeTouchee>[1]
    expect(cibleNommeeTouchee(demande, preuve)).toBe('sans-objet')
  })

  it('une vraie preuve sur un AUTRE fichier bloque toujours', () => {
    const preuve = [
      { kind: 'mutation', status: 'ok', ok: true, path: 'src/main/orchestration/orchestrator.ts' }
    ] as unknown as Parameters<typeof cibleNommeeTouchee>[1]
    expect(cibleNommeeTouchee(demande, preuve)).toBe('manquee')
  })

  it('la cible reellement touchee reste admise', () => {
    const preuve = [
      { kind: 'mutation', status: 'ok', ok: true, path: 'src/main/orchestration/task-regime.ts' }
    ] as unknown as Parameters<typeof cibleNommeeTouchee>[1]
    expect(cibleNommeeTouchee(demande, preuve)).toBe('touchee')
  })
})

/**
 * Une demande écrite AVANT un rangement de dossiers cite l'ancien chemin : le fichier a été déplacé
 * dans un sous-dossier, la cible nommée n'existe plus. Le contrôle exigeait la modification d'un
 * fichier absent, donc un travail juste fait sur le fichier déplacé était refusé à chaque réparation.
 */
describe('cibleNommeeTouchee — cible déplacée dans un sous-dossier', () => {
  const demande =
    'Étends aussi `redactSecrets` (`src/main/crash-handlers.ts:32`, utilisé par crash.log)'
  const deplace = ['D:', 'Depot', 'copie', 'src', 'main', 'app', 'crash-handlers.ts'].join(SEP)
  const absente = (): boolean => false
  const presente = (): boolean => true

  it('ancien chemin absent, même fichier modifié dans un sous-dossier → touchee', () => {
    expect(cibleNommeeTouchee(demande, [mutation([deplace])], absente)).toBe('touchee')
  })

  it('jumeau : ancien chemin TOUJOURS présent → le fichier homonyme ne compte pas, manquee', () => {
    expect(cibleNommeeTouchee(demande, [mutation([deplace])], presente)).toBe('manquee')
  })

  it('ancien chemin absent, mais AUTRE fichier modifié dans le sous-dossier → manquee', () => {
    const autre = ['D:', 'Depot', 'copie', 'src', 'main', 'app', 'app-data.ts'].join(SEP)
    expect(cibleNommeeTouchee(demande, [mutation([autre])], absente)).toBe('manquee')
  })

  it('ancien chemin absent, homonyme HORS du dossier cité → manquee', () => {
    const ailleurs = ['D:', 'Depot', 'copie', 'src', 'renderer', 'crash-handlers.ts'].join(SEP)
    expect(cibleNommeeTouchee(demande, [mutation([ailleurs])], absente)).toBe('manquee')
  })

  it('l’existence est sondée à la racine de la copie qui porte la modification', () => {
    const sondes: string[] = []
    cibleNommeeTouchee(demande, [mutation([deplace])], (chemin) => {
      sondes.push(chemin)
      return false
    })
    expect(sondes).toEqual(['d:/depot/copie/src/main/crash-handlers.ts'])
  })

  describe('etatDeCloture sur un vrai dossier', () => {
    let racine = ''
    beforeEach(() => {
      racine = mkdtempSync(join(tmpdir(), 'cible-deplacee-'))
      mkdirSync(join(racine, 'src', 'main', 'app'), { recursive: true })
      writeFileSync(join(racine, 'src', 'main', 'app', 'crash-handlers.ts'), 'export {}\n')
    })
    afterEach(() => {
      rmSync(racine, { recursive: true, force: true })
    })
    const phases = (chemin: string) => [
      { phase: 'build', text: 'ok', executionEvidence: [mutation([chemin])] }
    ]

    it('fichier déplacé et modifié ⇒ green', () => {
      const etat = etatDeCloture(
        demande,
        phases(join(racine, 'src', 'main', 'app', 'crash-handlers.ts')),
        true,
        true
      )
      expect(etat.status).toBe('green')
    })

    it('jumeau : l’ancien fichier existe encore ⇒ red, la cible reste exigée', () => {
      writeFileSync(join(racine, 'src', 'main', 'crash-handlers.ts'), 'export {}\n')
      const etat = etatDeCloture(
        demande,
        phases(join(racine, 'src', 'main', 'app', 'crash-handlers.ts')),
        true,
        true
      )
      expect(etat.status).toBe('red')
    })
  })
})
