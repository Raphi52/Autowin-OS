import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  avertissementTestsNonComptes,
  codeDeSortieDuResultatClaude,
  scriptHookTestsNonComptes,
  testsDuTerminal,
  testsNonComptes
} from './tests-du-terminal'

/**
 * TESTS DU TERMINAL (conv-1059, 2026-10-22) — lire, dans UNE ligne shell lancée par l'agent, les
 * tests qu'elle a joués et LEUR code de sortie, pour que la carte du fil les compte comme preuve.
 *
 * Les entrées qui font échouer une version naïve, toutes vues dans les tours réels de conv-1038 :
 *   - `… | tail -20` : le code rendu est celui de `tail` (`false | cat` rend 0, mesuré dans ce
 *     terminal le 2026-10-22) — compter ce 0 serait un FAUX VERT ;
 *   - `npm run typecheck > log 2>&1; echo EXIT=$?` : le code rendu est celui d'`echo` (0), le vrai
 *     n'existe que dans la SORTIE (`EXIT=2`) ;
 *   - `npx eslint … | tail -8; echo EXIT=$?` : là, `$?` est celui de `tail` — rien n'est prouvé ;
 *   - `timeout 540 npm run typecheck` : le lanceur cache le verbe ;
 *   - `npx vitest run $(cat liste | tr …)` : le `|` de la substitution ne coupe pas la commande.
 */

const lire = (ligne: string, codeDeSortie: number | null, sortie = ''): unknown =>
  testsDuTerminal(ligne, { codeDeSortie, sortie })

describe('testsDuTerminal — le code rendu par l’outil est celui du test', () => {
  it('un test seul : son code, vert comme rouge', () => {
    expect(lire('npx vitest run src/a.test.ts', 0)).toEqual([
      { commande: 'npx vitest run src/a.test.ts', codeDeSortie: 0 }
    ])
    expect(lire('npx vitest run src/a.test.ts', 1)).toEqual([
      { commande: 'npx vitest run src/a.test.ts', codeDeSortie: 1 }
    ])
  })

  it('après un `cd … &&`, et sans les redirections ni le `timeout` dans le libellé', () => {
    expect(lire('cd /d/AutoWinOS && npx vitest run a.test.ts', 0)).toEqual([
      { commande: 'npx vitest run a.test.ts', codeDeSortie: 0 }
    ])
    expect(lire('timeout 540 npm run typecheck > /tmp/maj-1038/typecheck.log 2>&1', 124)).toEqual([
      { commande: 'npm run typecheck', codeDeSortie: 124 }
    ])
  })

  it('le `|` d’une substitution `$( … )` ne coupe pas la commande', () => {
    expect(
      lire("npx vitest run $(cat /tmp/tests.txt | tr '\\n' ' ') > /tmp/v.log 2>&1", 0)
    ).toEqual([
      { commande: "npx vitest run $(cat /tmp/tests.txt | tr '\\n' ' ')", codeDeSortie: 0 }
    ])
  })

  it('les lanceurs de tests reconnus — et ce qui n’en est pas un', () => {
    expect(lire('python -m pytest -q', 0)).toHaveLength(1)
    expect(lire('node --test scripts/x.test.mjs', 0)).toHaveLength(1)
    expect(lire('npm test', 0)).toHaveLength(1)
    expect(lire('npx tsc --noEmit -p tsconfig.web.json', 0)).toHaveLength(1)
    expect(lire('npm run lint', 0)).toHaveLength(1)
    // `node -e` exécute un script quelconque, `npm run build` construit : ni l'un ni l'autre ne teste.
    expect(lire('node -e "console.log(1)"', 0)).toEqual([])
    expect(lire('npm run build', 0)).toEqual([])
    expect(lire('git status', 0)).toEqual([])
    expect(lire('echo npm test', 0)).toEqual([])
  })
})

describe('testsDuTerminal — jamais de faux vert', () => {
  it('un test suivi d’un `|` : le code est celui du dernier maillon, rien n’est prouvé', () => {
    expect(lire('npx vitest run a.test.ts 2>&1 | tail -20', 0)).toEqual([])
  })

  it('`||` masque l’échec, `&` rend la main avant la fin : rien n’est prouvé', () => {
    expect(lire('npm test || true', 0)).toEqual([])
    expect(lire('npm test &', 0)).toEqual([])
  })

  it('une boucle n’est pas un test unique', () => {
    expect(lire('for i in 1 2; do npx vitest run a.test.ts; done', 0)).toEqual([])
  })

  it('un code inconnu (outil coupé par son délai) ne prouve rien', () => {
    expect(lire('npx vitest run a.test.ts', null)).toEqual([])
  })
})

describe('testsDuTerminal — le code écrit par `echo …=$?` juste après le test', () => {
  it('lit le vrai code dans la sortie, pas le 0 d’`echo`', () => {
    expect(lire('npm run typecheck > /tmp/tc.log 2>&1; echo EXIT=$?', 0, 'EXIT=2\n')).toEqual([
      { commande: 'npm run typecheck', codeDeSortie: 2 }
    ])
  })

  it('plusieurs tests marqués dans la même ligne, chacun son code', () => {
    const ligne =
      'npm run typecheck > /dev/null 2>&1; echo TYPECHECK=$?; npx vitest run src/a src/b > /tmp/v.log 2>&1; echo VITEST=$?'
    expect(lire(ligne, 0, 'TYPECHECK=0\nVITEST=1\n')).toEqual([
      { commande: 'npm run typecheck', codeDeSortie: 0 },
      { commande: 'npx vitest run src/a src/b', codeDeSortie: 1 }
    ])
  })

  it('le même marqueur deux fois : les codes dans l’ordre ; un marqueur de trop dans la sortie : rien', () => {
    const ligne = 'npm run lint; echo EXIT=$?; npm test; echo EXIT=$?'
    expect(lire(ligne, 0, 'EXIT=0\nEXIT=1\n')).toEqual([
      { commande: 'npm run lint', codeDeSortie: 0 },
      { commande: 'npm test', codeDeSortie: 1 }
    ])
    expect(lire(ligne, 0, 'EXIT=5\nEXIT=0\nEXIT=1\n')).toEqual([])
  })

  it('marqueur entre guillemets doubles, ou après `&&`', () => {
    expect(lire('npm test; echo "exit: $?"', 0, 'exit: 3')).toEqual([
      { commande: 'npm test', codeDeSortie: 3 }
    ])
    expect(lire('npm test && echo OK=$?', 0, 'OK=0')).toEqual([
      { commande: 'npm test', codeDeSortie: 0 }
    ])
  })

  it('`$?` après un `| tail`, marqueur entre apostrophes, ou absent de la sortie : rien', () => {
    expect(lire('npx eslint x.ts 2>&1 | tail -8; echo EXIT=$?', 0, 'EXIT=0')).toEqual([])
    expect(lire("npm test; echo 'EXIT=$?'", 0, 'EXIT=$?')).toEqual([])
    expect(lire('npm test; echo EXIT=$?', 0, '…sortie coupée')).toEqual([])
  })
})

/*
 * conv-1221 (2026-10-28) : sur 6 jours, 251 tests lancés au terminal, 25 comptés par le Board ; 190
 * passaient par un tube (`| tail`, `| grep`) et 12 imprimaient pourtant leur vrai code par
 * `echo "exit ${PIPESTATUS[0]}"`. Sur 103 vitest raccourcis, 79 laissaient voir leur bilan.
 */
describe('testsDuTerminal — `${PIPESTATUS[k]}` imprimé après un tube', () => {
  it('lit le code du test placé au maillon k, pas celui de `tail`', () => {
    expect(
      lire(
        'npx vitest run src/a.test.ts 2>&1 | grep -E "×|FAIL" | head -15; echo "exit ${PIPESTATUS[0]}"',
        0,
        ' × a > b\nexit 1'
      )
    ).toEqual([{ commande: 'npx vitest run src/a.test.ts', codeDeSortie: 1 }])
    expect(lire('npx eslint x.ts 2>&1 | tail -8; echo EXIT=${PIPESTATUS[0]}', 0, 'EXIT=0')).toEqual(
      [{ commande: 'npx eslint x.ts', codeDeSortie: 0 }]
    )
  })

  it('le maillon visé n’est pas un test, marqueur entre apostrophes, ou absent : rien', () => {
    expect(
      lire('npx vitest run a.test.ts | tail -3; echo "exit ${PIPESTATUS[1]}"', 0, 'exit 0')
    ).toEqual([])
    expect(
      lire(
        "npx vitest run a.test.ts | tail -3; echo 'exit ${PIPESTATUS[0]}'",
        0,
        'exit ${PIPESTATUS[0]}'
      )
    ).toEqual([])
    expect(
      lire('npx vitest run a.test.ts | tail -3; echo "exit ${PIPESTATUS[0]}"', 0, '…coupé')
    ).toEqual([])
  })
})

const BILAN_VERT = [
  ' ✓ src/a.test.ts (3 tests) 12ms',
  '',
  ' Test Files  1 passed (1)',
  '      Tests  3 passed (3)',
  '   Start at  10:01:02',
  '   Duration  1.23s (transform 50ms, setup 0ms)'
].join('\n')

describe('testsDuTerminal — le bilan de vitest resté visible dans la sortie', () => {
  it('vert : bilan entier sous un `tail` (aucune ligne retirée au milieu)', () => {
    expect(lire('npx vitest run src/a.test.ts 2>&1 | tail -6', 0, BILAN_VERT)).toEqual([
      { commande: 'npx vitest run src/a.test.ts', codeDeSortie: 0 }
    ])
    // Couleurs du terminal comprises.
    expect(
      lire(
        'npx vitest run a.test.ts | tail -6',
        0,
        BILAN_VERT.replace('Test Files', '\u001b[2mTest Files\u001b[22m')
      )
    ).toHaveLength(1)
  })

  it('rouge : un « failed » ou une ligne « Errors » se lit même sous un `grep`', () => {
    expect(
      lire(
        'npx vitest run a.test.ts 2>&1 | grep -E "Test Files|Tests |×"',
        0,
        ' × a > b\n Test Files  1 failed (1)\n      Tests  1 failed | 2 passed (3)'
      )
    ).toEqual([{ commande: 'npx vitest run a.test.ts', codeDeSortie: 1 }])
    expect(
      lire(
        'npx vitest run a.test.ts | tail -7',
        0,
        BILAN_VERT.replace('   Start at', '     Errors  1 error\n   Start at')
      )
    ).toEqual([{ commande: 'npx vitest run a.test.ts', codeDeSortie: 1 }])
  })

  it('jamais de faux vert : `grep` a pu retirer la ligne « Errors », bilan coupé, ou pas vitest seul', () => {
    // Un `grep` qui ne garde que « Test Files|Tests » aurait aussi retiré une ligne « Errors ».
    expect(
      lire('npx vitest run a.test.ts | grep -E "Test Files|Tests |Duration"', 0, BILAN_VERT)
    ).toEqual([])
    // `tail -2` : la ligne « Test Files » n'est plus là.
    expect(
      lire('npx vitest run a.test.ts | tail -2', 0, BILAN_VERT.split('\n').slice(-2).join('\n'))
    ).toEqual([])
    // Sortie coupée avant « Duration » : le bilan n'est pas entier.
    expect(
      lire('npx vitest run a.test.ts | tail -6', 0, BILAN_VERT.split('\n').slice(0, 4).join('\n'))
    ).toEqual([])
    // `npm test` joue aussi le typage et le lint : le bilan de vitest ne dit pas son code.
    expect(lire('npm test 2>&1 | tail -6', 0, BILAN_VERT)).toEqual([])
    // Deux vitest dans la ligne : on ne sait plus à qui est le bilan.
    expect(
      lire('npx vitest run a.test.ts | tail -6; npx vitest run b.test.ts | tail -6', 0, BILAN_VERT)
    ).toEqual([])
  })
})

describe('testsNonComptes — les tests lancés dont le code reste illisible', () => {
  const nonComptes = (ligne: string, code: number | null, sortie = ''): string[] =>
    testsNonComptes(ligne, { codeDeSortie: code, sortie })

  it('nomme le test raccourci par un tube, masqué par `||` ou lancé en fond', () => {
    expect(nonComptes('npx vitest run a.test.ts 2>&1 | grep FAIL', 1)).toEqual([
      'npx vitest run a.test.ts'
    ])
    expect(nonComptes('npm test || true', 0)).toEqual(['npm test'])
    expect(nonComptes('npm test &', 0)).toEqual(['npm test'])
    expect(nonComptes('cd x && npx tsc --noEmit | head -5; npm run lint', 0)).toEqual([
      'npx tsc --noEmit'
    ])
  })

  it('rien quand le test est compté, quand la ligne ne teste rien, ou quand elle est illisible', () => {
    expect(nonComptes('npx vitest run a.test.ts', 0)).toEqual([])
    expect(nonComptes('npx vitest run a.test.ts | tail -6', 0, BILAN_VERT)).toEqual([])
    expect(nonComptes('git status | head', 0)).toEqual([])
    expect(nonComptes("cat > a.ts <<'EOF'\nx\nEOF\nnpx vitest run a.ts | tail", 0)).toEqual([])
  })
})

describe('avertissementTestsNonComptes — ce que lit l’agent', () => {
  it('nomme le test et les trois façons de le faire compter', () => {
    const texte = avertissementTestsNonComptes(
      'npx vitest run a.test.ts | tail -3',
      { codeDeSortie: 0, sortie: '' },
      false
    )
    expect(texte).toContain('`npx vitest run a.test.ts`')
    expect(texte).toContain('Board')
    expect(texte).toContain('verify')
    expect(texte).toContain('${PIPESTATUS[0]}')
  })

  it('en fond : tout test est non compté ; sans test illisible : aucun avertissement', () => {
    expect(
      avertissementTestsNonComptes(
        'npx vitest run a.test.ts',
        { codeDeSortie: 0, sortie: '' },
        true
      )
    ).toContain('en fond')
    expect(
      avertissementTestsNonComptes(
        'npx vitest run a.test.ts',
        { codeDeSortie: 0, sortie: '' },
        false
      )
    ).toBeUndefined()
    expect(
      avertissementTestsNonComptes('git status', { codeDeSortie: 0, sortie: '' }, true)
    ).toBeUndefined()
  })
})

describe('scriptHookTestsNonComptes — le VRAI script du hook, lancé par node', () => {
  const dossier = mkdtempSync(join(tmpdir(), 'hook-tests-non-comptes-'))
  const script = join(dossier, 'tests-non-comptes.mjs')
  writeFileSync(script, scriptHookTestsNonComptes(), 'utf8')
  afterAll(() => rmSync(dossier, { recursive: true, force: true }))
  const hook = (entree: unknown): string =>
    spawnSync(process.execPath, [script], {
      input: typeof entree === 'string' ? entree : JSON.stringify(entree),
      encoding: 'utf8'
    }).stdout

  it('PostToolUse : un test raccourci par `| tail` reçoit l’avertissement à côté de son résultat', () => {
    const sortie = JSON.parse(
      hook({
        hook_event_name: 'PostToolUse',
        tool_name: 'Bash',
        tool_input: { command: 'npx vitest run a.test.ts 2>&1 | tail -3' },
        tool_response: { stdout: 'x', stderr: '' }
      })
    )
    expect(sortie.hookSpecificOutput.hookEventName).toBe('PostToolUse')
    expect(sortie.hookSpecificOutput.additionalContext).toContain('`npx vitest run a.test.ts`')
  })

  it('PostToolUseFailure : la ligne en échec (« Exit code 1 ») est lue aussi', () => {
    const sortie = JSON.parse(
      hook({
        hook_event_name: 'PostToolUseFailure',
        tool_name: 'Bash',
        tool_input: { command: 'npx vitest run a.test.ts | grep FAIL' },
        error: 'Exit code 1\n',
        is_interrupt: false
      })
    )
    expect(sortie.hookSpecificOutput.hookEventName).toBe('PostToolUseFailure')
    expect(sortie.hookSpecificOutput.additionalContext).toContain('`npx vitest run a.test.ts`')
  })

  it('silencieux : test compté, bilan lisible, autre outil, entrée illisible', () => {
    const base = {
      hook_event_name: 'PostToolUse',
      tool_name: 'Bash',
      tool_response: { stdout: BILAN_VERT }
    }
    expect(hook({ ...base, tool_input: { command: 'npx vitest run a.test.ts' } })).toBe('')
    expect(hook({ ...base, tool_input: { command: 'npx vitest run a.test.ts | tail -6' } })).toBe(
      ''
    )
    expect(hook({ ...base, tool_name: 'Read', tool_input: { command: 'npm test | tail' } })).toBe(
      ''
    )
    expect(hook('pas du json')).toBe('')
  })
})

describe('codeDeSortieDuResultatClaude — le code d’un résultat Bash du CLI', () => {
  it('sans erreur : 0 ; en erreur : le « Exit code N » de tête ; sinon inconnu', () => {
    expect(codeDeSortieDuResultatClaude(false, 'peu importe')).toBe(0)
    expect(codeDeSortieDuResultatClaude(true, 'Exit code 2\nsed: can’t read x')).toBe(2)
    expect(codeDeSortieDuResultatClaude(true, 'Command timed out after 2m 0.0s')).toBeNull()
  })
})
