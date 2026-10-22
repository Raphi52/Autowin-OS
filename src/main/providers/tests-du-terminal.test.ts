import { describe, expect, it } from 'vitest'
import { codeDeSortieDuResultatClaude, testsDuTerminal } from './tests-du-terminal'

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

describe('codeDeSortieDuResultatClaude — le code d’un résultat Bash du CLI', () => {
  it('sans erreur : 0 ; en erreur : le « Exit code N » de tête ; sinon inconnu', () => {
    expect(codeDeSortieDuResultatClaude(false, 'peu importe')).toBe(0)
    expect(codeDeSortieDuResultatClaude(true, 'Exit code 2\nsed: can’t read x')).toBe(2)
    expect(codeDeSortieDuResultatClaude(true, 'Command timed out after 2m 0.0s')).toBeNull()
  })
})
