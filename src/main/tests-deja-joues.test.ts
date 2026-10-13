import { describe, expect, it } from 'vitest'
import type { ExecutionEvidence } from './providers/types'
import { PHASE_BRIEFS } from './phase-briefs'
import {
  estTestReutilisable,
  noteTestsDejaJouesPourJuge,
  testsJouesSurLeCodeActuel
} from './tests-deja-joues'

// fix-ok: run-a8a70cd0ee56-1 réparation 3 — réécrit après rejeu des journaux réels : la preuve Bash
// de Claude n'a pas d'exitCode (seulement ok) et « 2>&1; echo EXIT=$? » était refusé ; rouge
// mesuré en réinjectant l'exigence d'un code chiffré (2 tests en échec, code 1).

const edition = (chemin = 'src/main/a.ts'): ExecutionEvidence => ({
  type: 'Edit',
  kind: 'mutation',
  status: 'completed',
  ok: true,
  summary: `Edit ${chemin}`,
  path: chemin
})
/** Preuve Codex : code de sortie chiffré. */
const bash = (
  command: string,
  kind: ExecutionEvidence['kind'],
  exitCode?: number
): ExecutionEvidence => ({
  type: 'Bash',
  kind,
  status: 'completed',
  ok: exitCode === undefined || exitCode === 0,
  summary: `Bash ${command}`,
  command,
  ...(exitCode === undefined ? {} : { exitCode })
})
/** Preuve Claude : pas de code chiffré, `ok`/`status` viennent de `is_error` (claude.ts). */
const claude = (command: string, ok: boolean, stdout?: string): ExecutionEvidence => ({
  type: 'Bash',
  kind: 'verification',
  status: ok ? 'completed' : 'failed',
  ok,
  summary: `Bash ${command}`,
  command,
  ...(stdout === undefined ? {} : { stdout })
})
const lecture = (type = 'Read'): ExecutionEvidence => ({
  type,
  kind: 'inspection',
  status: 'completed',
  ok: true,
  summary: type
})

const VITEST = 'cd "D:/copie" && npx vitest run src/main/a.test.ts > /tmp/v.log 2>&1'
const TYPECHECK = 'npm run typecheck'
/** La forme que les agents écrivent presque toujours (mesuré dans les journaux de ce run). */
const VITEST_ECHO =
  'npx vitest run src/main/a.test.ts > "$TEMP/v.log" 2>&1; echo EXIT=$?; tail -3 "$TEMP/v.log"'

describe('tests déjà joués sur le code actuel (piste 4 de conv-914)', () => {
  it('un test joué APRÈS la dernière édition, suivi de lectures seulement, est réutilisable', () => {
    const tests = testsJouesSurLeCodeActuel([
      edition(),
      bash(VITEST, 'verification', 0),
      lecture('Read'),
      lecture('Grep'),
      bash('cd "D:/copie" && git status --porcelain', 'inspection', 0),
      bash(TYPECHECK, 'verification', 2)
    ])
    expect(tests).toEqual([
      { commande: VITEST, exitCode: 0, reussi: true },
      { commande: TYPECHECK, exitCode: 2, reussi: false }
    ])
  })

  it('jumeau : un test suivi d une édition ne vaut plus pour le code actuel', () => {
    expect(testsJouesSurLeCodeActuel([bash(VITEST, 'verification', 0), edition()])).toEqual([])
  })

  // fix-ok: run-a8a70cd0ee56-1 réparation 5 — rejeu sur run-state : les 4 étapes build sur 4 finissent
  // par ce bilan, la remontée s'y arrêtait toujours ; ce test est rouge sur la règle d'avant (code 1).
  it('le bilan de fin d étape (workspace_delta) récapitule des écritures déjà comptées : il ne l arrête pas', () => {
    const bilan: ExecutionEvidence = {
      type: 'workspace_delta',
      kind: 'mutation',
      status: 'completed',
      ok: true,
      summary: '1 fichier(s) modifié(s) dans le worktree isolé',
      paths: ['src/main/a.ts']
    }
    expect(testsJouesSurLeCodeActuel([edition(), bash(VITEST, 'verification', 0), bilan])).toEqual([
      { commande: VITEST, exitCode: 0, reussi: true }
    ])
    // Jumeau : l'édition faite APRÈS le test reste une écriture, bilan ou pas.
    expect(testsJouesSurLeCodeActuel([bash(VITEST, 'verification', 0), edition(), bilan])).toEqual(
      []
    )
  })

  it('preuve Claude sans code chiffré : réussi ou échoué, tiré de `ok`', () => {
    expect(testsJouesSurLeCodeActuel([edition(), claude(TYPECHECK, true)])).toEqual([
      { commande: TYPECHECK, reussi: true }
    ])
    expect(testsJouesSurLeCodeActuel([edition(), claude(TYPECHECK, false)])).toEqual([
      { commande: TYPECHECK, reussi: false }
    ])
  })

  it('`; echo EXIT=$?` : le code du test est relu dans la sortie, pas celui de la commande', () => {
    // La commande entière réussit (le dernier segment est `tail`) alors que le test a échoué.
    const rouge = claude(VITEST_ECHO, true, 'EXIT=1\n Tests  1 failed | 6 passed (7)')
    expect(testsJouesSurLeCodeActuel([edition(), rouge])).toEqual([
      { commande: VITEST_ECHO, exitCode: 1, reussi: false }
    ])
    const vert = claude(VITEST_ECHO, true, 'EXIT=0\n Tests  7 passed (7)')
    expect(testsJouesSurLeCodeActuel([edition(), vert])).toEqual([
      { commande: VITEST_ECHO, exitCode: 0, reussi: true }
    ])
    // Sortie sans la ligne `EXIT=` (coupée) : le résultat est inconnu, le test n'est pas listé.
    expect(testsJouesSurLeCodeActuel([edition(), claude(VITEST_ECHO, true, 'rien')])).toEqual([])
  })

  it('une commande en arrière-plan n est pas un test fini, et peut encore écrire', () => {
    const fond = claude(
      'npx vitest run',
      true,
      'Command running in background with ID: b1x. Output is being written to: C:/t'
    )
    expect(testsJouesSurLeCodeActuel([edition(), fond])).toEqual([])
    // Elle borne aussi la remontée : le test d'avant ne compte plus.
    expect(testsJouesSurLeCodeActuel([claude(TYPECHECK, true), fond])).toEqual([])
  })

  it('une commande inconnue après le test (script qui peut écrire) arrête aussi la remontée', () => {
    const preuves = [bash(VITEST, 'verification', 0), bash('node patch.cjs', 'inspection', 0)]
    expect(testsJouesSurLeCodeActuel(preuves)).toEqual([])
    // Jumeau : une lecture de la liste fermée, même avec une variable, ne l'arrête pas.
    expect(
      testsJouesSurLeCodeActuel([
        bash(VITEST, 'verification', 0),
        bash('cat "$TEMP/v.log"', 'inspection', 0)
      ])
    ).toHaveLength(1)
  })

  // fix-ok: run-a8a70cd0ee56-1 réparation 7 — le dernier nettoyage finissait par la lecture réelle
  // ci-dessous ; le tube et les caractères `^!` entre apostrophes la faisaient compter comme une
  // écriture, 0 test retrouvé. Rouge sur la règle d'avant (code 1).
  it('un tube de lectures après le test, apostrophes comprises, n arrête pas la remontée', () => {
    const LECTURE_REELLE =
      "git status --porcelain | wc -l; git status --porcelain --ignored -uall | grep '^!!' | grep -vc '^!! node_modules/'"
    for (const lire of ['git status --porcelain | wc -l', LECTURE_REELLE]) {
      expect(
        testsJouesSurLeCodeActuel([edition(), claude(TYPECHECK, true), bash(lire, 'inspection')]),
        lire
      ).toEqual([{ commande: TYPECHECK, reussi: true }])
    }
    // Jumeaux : un maillon qui écrit, une redirection, `||`, une apostrophe coupée par `;`, une
    // option interdite cachée entre apostrophes arrêtent toujours la remontée.
    for (const ecrire of [
      'git status --porcelain | tee etat.txt',
      'git status --porcelain | wc -l > compte.txt',
      "git status --porcelain | grep '^M' | xargs rm",
      'grep -q motif src/a.ts || rm src/a.ts',
      "cat 'a;wc '>f' b'",
      "rg '--pre=sh' motif src",
      `wc "'" >f "'"`
    ]) {
      expect(
        testsJouesSurLeCodeActuel([claude(TYPECHECK, true), bash(ecrire, 'inspection')]),
        ecrire
      ).toEqual([])
    }
  })

  it('un outil externe sans commande (MCP) compte comme une écriture possible ; Read non', () => {
    expect(
      testsJouesSurLeCodeActuel([
        bash(VITEST, 'verification', 0),
        lecture('mcp__autowin__brain_write')
      ])
    ).toEqual([])
    expect(
      testsJouesSurLeCodeActuel([bash(VITEST, 'verification', 0), lecture('Read')])
    ).toHaveLength(1)
  })

  it('le même test rejoué ne compte qu une fois, avec son résultat le plus récent', () => {
    const tests = testsJouesSurLeCodeActuel([
      bash(TYPECHECK, 'verification', 2),
      bash(TYPECHECK, 'verification', 0)
    ])
    expect(tests).toEqual([{ commande: TYPECHECK, exitCode: 0, reussi: true }])
  })

  it('seuls les tests dont le résultat est bien celui du test sont réutilisables', () => {
    expect(estTestReutilisable(VITEST)).toBe(true)
    expect(estTestReutilisable(VITEST_ECHO)).toBe(true)
    expect(estTestReutilisable('npx tsc --noEmit -p tsconfig.node.json')).toBe(true)
    expect(estTestReutilisable('npm run test:unit')).toBe(true)
    // `| tail` : le code capturé est celui de `tail`. `; rm` : une écriture suit le test.
    expect(estTestReutilisable('npx vitest run | tail -5')).toBe(false)
    expect(estTestReutilisable('npx vitest run; echo EXIT=$?; rm -f src/a.ts')).toBe(false)
    expect(estTestReutilisable('npx vitest run; rm -f src/a.ts')).toBe(false)
    // Lanceurs qui ÉCRIVENT : instantanés mis à jour, corrections, sortie compilée, script libre.
    expect(estTestReutilisable('npx vitest run -u')).toBe(false)
    expect(estTestReutilisable('npx eslint src --fix')).toBe(false)
    expect(estTestReutilisable('npx tsc -p tsconfig.json')).toBe(false)
    expect(estTestReutilisable("node -e \"require('fs').writeFileSync('a', 'b')\"")).toBe(false)
    expect(estTestReutilisable('npm run build')).toBe(false)
  })

  it('les commandes que le brief CLEAN donne pour son dernier geste sont acceptées par la règle', () => {
    const geste = PHASE_BRIEFS.clean.split('\n').find((ligne) => ligne.includes('DERNIER geste'))
    const exemples = [...(geste ?? '').matchAll(/`((?:npx|npm)[^`]+)`/g)].map((m) => m[1])
    expect(exemples.length).toBeGreaterThanOrEqual(2)
    for (const commande of exemples) {
      expect(estTestReutilisable(commande), commande).toBe(true)
      expect(estTestReutilisable(`${commande}; echo EXIT=$?`), commande).toBe(true)
    }
  })

  it('le bloc du juge liste commande et résultat, et reste vide sans test réutilisable', () => {
    const note = noteTestsDejaJouesPourJuge([
      edition(),
      bash(TYPECHECK, 'verification', 0),
      claude('npx vitest run', true)
    ])
    expect(note).toContain('TESTS DÉJÀ JOUÉS SUR LE CODE ACTUEL')
    expect(note).toContain('`npm run typecheck` → code de sortie 0')
    expect(note).toContain('`npx vitest run` → réussi')
    expect(note).toContain('Ne les relance pas')
    expect(noteTestsDejaJouesPourJuge([bash(TYPECHECK, 'verification', 0), edition()])).toBe('')
    expect(noteTestsDejaJouesPourJuge(undefined)).toBe('')
  })
})
