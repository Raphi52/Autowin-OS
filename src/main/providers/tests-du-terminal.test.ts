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
import { COMMANDE_DE_TEST_MAX, lireTestsDuTerminal } from '../../shared/chat-turn'

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
      {
        commande: 'npx vitest run a.test.ts',
        codeDeSortie: 0,
        changementDeDossier: 'cd /d/AutoWinOS'
      }
    ])
    expect(lire('timeout 540 npm run typecheck > /tmp/maj-1038/typecheck.log 2>&1', 124)).toEqual([
      { commande: 'npm run typecheck', codeDeSortie: 124 }
    ])
  })

  /*
   * LE `cd` ÉTAIT PERDU (conv-1423, objection du contrôle final) : le libellé ne garde que le maillon
   * du test, donc `cd ../autre-projet && npm test` se lisait `npm test` et rachetait un rouge du
   * projet courant. Le libellé ne change pas : l'information voyage à côté.
   */
  it.each([
    ['cd ../x; npm test', 'cd ../x'],
    ['cd ../x\nnpm test', 'cd ../x'],
    ['pushd ../x && npm test', 'pushd ../x'],
    ['chdir ../x && npm test', 'chdir ../x'],
    ['Set-Location ../x; npm test', 'Set-Location ../x'],
    ['sl ../x; npm test', 'sl ../x'],
    ['Push-Location ../x; npm test', 'Push-Location ../x'],
    ['Pop-Location; npm test', 'Pop-Location'],
    ['cd a && cd b && npm test', 'cd a && cd b'],
    ['cd a && git pull && npm test', 'cd a'],
    ['pushd a && popd && npm test', 'pushd a && popd'],
    ['cd "D:/Mon Projet" > /dev/null && npm test', 'cd "D:/Mon Projet"']
  ])('le test de `%s` garde son libellé, et dit où il a tourné', (ligne, attendu) => {
    expect(lire(ligne, 0)).toEqual([
      { commande: 'npm test', codeDeSortie: 0, changementDeDossier: attendu }
    ])
  })

  /*
   * fix-ok: le verbe n'était cherché qu'en tête du maillon, alors que la grammaire du shell le place
   * aussi derrière `builtin`, `{` ou `then` : le `cd` passait inaperçu et le rouge était effacé
   * (essai exécuté avec les vraies fonctions). 0 de ces formes sur 1 291 commandes réelles (01/11) :
   * les fermer ne coûte aucun faux « Bloqué ».
   */
  it.each([
    ['builtin cd ../x && npm test', 'cd ../x'],
    ['! cd ../x; npm test', 'cd ../x'],
    ['{ cd ../x; }; npm test', 'cd ../x'],
    ['{ builtin cd ../x; }; npm test', 'cd ../x'],
    ['{ command cd ../x; }; npm test', 'cd ../x'],
    ['! time cd ../x; npm test', 'cd ../x'],
    ['if cd ../x; then true; fi; npm test', 'cd ../x'],
    ['if true; then cd ../x; fi; npm test', 'cd ../x'],
    ['if a; then b; elif cd ../x; then c; fi; npm test', 'cd ../x'],
    ['if a; then b; else cd ../x; fi; npm test', 'cd ../x'],
    ['while cd ../x; do break; done; npm test', 'cd ../x'],
    ['until cd ../x; do break; done; npm test', 'cd ../x'],
    ['for d in a b; do cd $d; done; npm test', 'cd $d'],
    ['case a in a) cd ../x;; esac; npm test', 'cd ../x'],
    ['f() { cd ../x; }; f; npm test', 'cd ../x'],
    ['f(){ cd ../x; }; f; npm test', 'cd ../x'],
    ['function f { cd ../x; }; f; npm test', 'cd ../x'],
    // Accolades collées : forme de PowerShell, 0 appel de cet outil sur 1 212 sorties récentes.
    ['{cd ../x}; npm test', '{cd ../x}'],
    ['if ($x) {cd ../x}; npm test', '{cd ../x}'],
    ['{popd}; npm test', '{popd}']
  ])('`%s` : le verbe caché par le shell reste vu', (ligne, attendu) => {
    expect(lire(ligne, 0)).toEqual([
      { commande: 'npm test', codeDeSortie: 0, changementDeDossier: attendu }
    ])
  })

  // fix-ok: le mot juste avant décidait seul de la position de commande, et une affectation s'y glisse
  // sans la changer : `{ X=1 cd ../x; }; npm test` effaçait un rouge (essai exécuté sur `rougesRestants`
  // par le nettoyage). `X+=1` et `a[0]=1` en tête de maillon passaient de la même façon.
  it.each([
    ['{ X=1 cd ../x; }; npm test', 'cd ../x'],
    ['{ X=1 Y=2 cd ../x; }; npm test', 'cd ../x'],
    ['{ X="a b" cd ../x; }; npm test', 'cd ../x'],
    ['{ X= cd ../x; }; npm test', 'cd ../x'],
    ['{ X=$(pwd) cd ../x; }; npm test', 'cd ../x'],
    ['{ X+=1 cd ../x; }; npm test', 'cd ../x'],
    ['{ a[0]=1 cd ../x; }; npm test', 'cd ../x'],
    ['X+=1 cd ../x && npm test', 'cd ../x'],
    ['a[0]=1 cd ../x && npm test', 'cd ../x'],
    ['if X=1 cd ../x; then true; fi; npm test', 'cd ../x'],
    ['while X=1 cd ../x; do break; done; npm test', 'cd ../x'],
    ['if a; then X=1 cd ../x; fi; npm test', 'cd ../x'],
    ['! X=1 cd ../x; npm test', 'cd ../x'],
    ['case a in a) X=1 cd ../x;; esac; npm test', 'cd ../x'],
    ['f(){ X=1 cd ../x; }; f; npm test', 'cd ../x'],
    ['{ time X=1 cd ../x; }; npm test', 'cd ../x'],
    ['{ X=1 builtin cd ../x; }; npm test', 'cd ../x'],
    ['{ X=1 eval "cd ../x"; }; npm test', 'eval "cd ../x"'],
    ['{ X=1 $c ../x; }; npm test', '$c ../x']
  ])('`%s` : une affectation ne cache pas le verbe', (ligne, attendu) => {
    expect(lire(ligne, 0)).toEqual([
      { commande: 'npm test', codeDeSortie: 0, changementDeDossier: attendu }
    ])
  })

  // À la même borne : passé l'affectation, c'est le mot d'avant qui décide, jamais l'affectation seule.
  it.each([
    ['echo X=1 cd ../x; npm test'],
    ['{ echo X=1 cd ../x; }; npm test'],
    ['{ X=1 echo cd ../x; }; npm test'],
    ['X=1 echo cd ../x; npm test'],
    ['export X=1 cd; npm test'],
    ['git config X=1 cd && npm test'],
    ['npm run lint X=1 Y=2 cd; npm test'],
    ['echo "X=1" cd ../x; npm test'],
    ['echo X=$(pwd) cd ../x; npm test'],
    ['echo --x=1 cd ../x; npm test'],
    // Entre guillemets ou derrière un tiret, ce n'est plus une affectation : c'est la commande.
    ['{ "X=1" cd ../x; }; npm test'],
    ['{ --x=1 cd ../x; }; npm test'],
    ['{ 1X=2 cd ../x; }; npm test'],
    ['if X=1 true; then echo cd; fi; npm test'],
    ['{ X=1 true; }; npm test']
  ])('jumeau : dans `%s`, le `cd` reste un argument', (ligne) => {
    expect(lire(ligne, 0)).toEqual([{ commande: 'npm test', codeDeSortie: 0 }])
  })

  // fix-ok: la position de commande ne remontait que les affectations : l'option de `command`, `time`
  // ou `builtin` séparait le verbe de son lanceur, et `command -p cd ../x && npm test` effaçait un rouge
  // (sonde du nettoyage sur `rougesRestants`, 02/11). `"builtin" cd` et `\builtin cd` passaient aussi :
  // le lanceur n'était reconnu qu'écrit nu, alors que le shell lance le même mot sans ses guillemets.
  it.each([
    ['command -p cd ../x && npm test', 'cd ../x'],
    ['{ command -p cd ../x; }; npm test', 'cd ../x'],
    ['{ time -p cd ../x; }; npm test', 'cd ../x'],
    ['time -p cd ../x; npm test', 'cd ../x'],
    ['builtin -- cd ../x && npm test', 'cd ../x'],
    ['command -- cd ../x && npm test', 'cd ../x'],
    ['time -- cd ../x; npm test', 'cd ../x'],
    ['command -p -- cd ../x && npm test', 'cd ../x'],
    ['{ time -p command -p -- cd ../x; }; npm test', 'cd ../x'],
    ['command builtin -- cd ../x && npm test', 'cd ../x'],
    ['{ time -p X=1 cd ../x; }; npm test', 'cd ../x'],
    ['! command -p cd ../x; npm test', 'cd ../x'],
    ['if command -p cd ../x; then true; fi; npm test', 'cd ../x'],
    ['if ! command -p cd ../x; then true; fi; npm test', 'cd ../x'],
    ['command -p pushd ../x && npm test', 'pushd ../x'],
    ['command -p eval "cd ../x" && npm test', 'eval "cd ../x"'],
    ['{ command -p $c ../x; }; npm test', '$c ../x'],
    ['\\builtin cd ../x && npm test', 'cd ../x'],
    ['"builtin" cd ../x && npm test', 'cd ../x'],
    ["'builtin' -- cd ../x && npm test", 'cd ../x'],
    ['{ \\command cd ../x; }; npm test', 'cd ../x'],
    ['{ "command" -p cd ../x; }; npm test', 'cd ../x']
  ])('`%s` : une option du lanceur ne cache pas le verbe', (ligne, attendu) => {
    expect(lire(ligne, 0)).toEqual([
      { commande: 'npm test', codeDeSortie: 0, changementDeDossier: attendu }
    ])
  })

  // Objection du contrôle final (conv-1423) : l'option de lanceur était lue brute et le verbe par `nu`,
  // qui ne retire que les guillemets du bord : `command "-p" cd`, `c'd'` et `c\d` effaçaient un rouge.
  // Le shell joue ces mots sans leurs guillemets ni leurs barres : on les lit pareil.
  it.each([
    ['command "-p" cd ../x && npm test', 'cd ../x'],
    ["command '-p' cd ../x && npm test", 'cd ../x'],
    ['command \\-p cd ../x && npm test', 'cd ../x'],
    ['command -"p" cd ../x && npm test', 'cd ../x'],
    ['builtin "--" cd ../x && npm test', 'cd ../x'],
    ['{ time "-p" cd ../x; }; npm test', 'cd ../x'],
    ["com'mand' cd ../x && npm test", 'cd ../x'],
    ['b"uiltin" cd ../x && npm test', 'cd ../x'],
    ['bui\\ltin cd ../x && npm test', 'cd ../x'],
    ["c'd' ../x && npm test", "c'd' ../x"],
    ['c"d" ../x && npm test', 'c"d" ../x'],
    ['"c"d ../x && npm test', '"c"d ../x'],
    ["c''d ../x && npm test", "c''d ../x"],
    ['c\\d ../x && npm test', 'c\\d ../x'],
    ['\\c\\d ../x && npm test', '\\c\\d ../x'],
    ["$'cd' ../x && npm test", "$'cd' ../x"],
    ['$"cd" ../x && npm test', '$"cd" ../x'],
    ["{ c'd' ../x; }; npm test", "c'd' ../x"],
    ["X=1 c'd' ../x; npm test", "c'd' ../x"],
    ["pu'shd' ../x && npm test", "pu'shd' ../x"],
    ['ev\'al\' "cd ../x" && npm test', 'ev\'al\' "cd ../x"'],
    ['sou\\rce a.sh && npm test', 'sou\\rce a.sh']
  ])('`%s` : un mot cité se lit comme le shell le joue', (ligne, attendu) => {
    expect(lire(ligne, 0)).toEqual([
      { commande: 'npm test', codeDeSortie: 0, changementDeDossier: attendu }
    ])
  })

  // Le jumeau : retirer les citations ne fait pas d'un argument un verbe, et `D:\outils\outil` n'est
  // pas lu `D:outilsoutil` : les barres d'un chemin restent celles d'un chemin.
  it.each([
    ["echo c'd' ../x; npm test"],
    ['echo "-p" cd; npm test'],
    ['command "-v" cd && npm test'],
    ['command \\-v cd && npm test'],
    ['git log "--" cd; npm test'],
    ['mkdir "-p" cd && npm test'],
    ["grep 'cd' a.txt; npm test"],
    ['"D:\\outils\\outil" ../x; npm test'],
    ["'cdk' deploy; npm test"],
    ["c'dk' deploy; npm test"]
  ])('jumeau : dans `%s`, aucun `cd` n’est joué', (ligne) => {
    expect(lire(ligne, 0)).toEqual([{ commande: 'npm test', codeDeSortie: 0 }])
  })

  it('jumeau : un chemin Windows vers `cd` reste un `cd`', () => {
    expect(lire('D:\\outils\\cd ../x && npm test', 0)).toEqual([
      { commande: 'npm test', codeDeSortie: 0, changementDeDossier: 'D:\\outils\\cd ../x' }
    ])
  })

  // Le jumeau : `command -v` interroge sans lancer, et une option d'un autre programme ne prouve rien.
  // `command -v` figure dans 1 commande réelle sur 2 043 (02/11) : le marquer créerait un faux « Bloqué ».
  it.each([
    ['command -v cd && npm test'],
    ['command -V cd && npm test'],
    ['command -pv cd && npm test'],
    ['command -p -v cd && npm test'],
    ['command -v -p cd && npm test'],
    ['{ command -v cd; }; npm test'],
    ['if command -v cd; then true; fi; npm test'],
    ['command -v source && npm test'],
    ['command -v $c && npm test'],
    ['mkdir -p cd && npm test'],
    ['mkdir -p -- cd && npm test'],
    ['git checkout -- cd && npm test'],
    ['rm -- cd && npm test'],
    ['npm run -- cd; npm test'],
    ['grep -- cd a.txt; npm test'],
    ['echo command -p cd ../x; npm test'],
    ['echo time -- cd ../x; npm test'],
    ['echo builtin cd ../x; npm test'],
    ['echo command cd ../x; npm test'],
    ['echo "builtin" cd ../x; npm test'],
    ['{ echo command -p cd; }; npm test']
  ])('jumeau : dans `%s`, le `cd` n’est pas joué', (ligne) => {
    expect(lire(ligne, 0)).toEqual([{ commande: 'npm test', codeDeSortie: 0 }])
  })

  it('jumeau : `command -p cd <dossier de l’agent>` reste dans le dossier de l’agent', () => {
    expect(
      testsDuTerminal(
        'command -p cd D:/Projet && npm test',
        { codeDeSortie: 0, sortie: '' },
        'D:\\Projet'
      )
    ).toEqual([{ commande: 'npm test', codeDeSortie: 0 }])
  })

  // Une chaîne de 200 000 lanceurs ne doit pas épuiser la pile du hook : la remontée est une boucle.
  it('une longue suite de lanceurs reste lue, sans épuiser la pile', () => {
    const ligne = `${'command '.repeat(200_000)}cd ../x; npm test`
    expect(lire(ligne, 0)).toEqual([
      { commande: 'npm test', codeDeSortie: 0, changementDeDossier: 'cd ../x' }
    ])
  })

  // `cd..` est un verbe de PowerShell et de cmd : collé, il n'était pas lu comme `cd ..`.
  it('`cd..` de PowerShell reste marqué, `cd...txt` non', () => {
    expect(lire('cd.. && npm test', 0)).toEqual([
      { commande: 'npm test', codeDeSortie: 0, changementDeDossier: 'cd..' }
    ])
    expect(lire('cd...txt && npm test', 0)).toEqual([{ commande: 'npm test', codeDeSortie: 0 }])
  })

  it('jumeau : `{ X=1 cd <dossier de l’agent>; }` reste dans le dossier de l’agent', () => {
    expect(
      testsDuTerminal(
        '{ X=1 cd D:/Projet; }; npm test',
        { codeDeSortie: 0, sortie: '' },
        'D:\\Projet'
      )
    ).toEqual([{ commande: 'npm test', codeDeSortie: 0 }])
  })

  it('le `cd` en bloc suit le test lu par son `echo` ou par le bilan de vitest', () => {
    expect(lire('{ cd ../x; npm test; echo EXIT=$?; }', 0, 'EXIT=1')).toEqual([
      { commande: 'npm test', codeDeSortie: 1, changementDeDossier: 'cd ../x' }
    ])
    expect(
      lire(
        '{ cd ../x; npx vitest run; }',
        0,
        ' Test Files  1 passed (1)\n Tests  1 passed (1)\n Duration  1s'
      )
    ).toEqual([{ commande: 'npx vitest run', codeDeSortie: 0, changementDeDossier: 'cd ../x' }])
  })

  // Un texte qu'on ne lit pas peut changer de dossier : inconnu = ne couvre pas. 0 sur 1 293 commandes.
  it.each([
    ['eval "cd ../x" && npm test', 'eval "cd ../x"'],
    ['source ./env.sh && npm test', 'source ./env.sh'],
    ['. ./env.sh && npm test', '. ./env.sh'],
    ['{ eval "cd ../x"; }; npm test', 'eval "cd ../x"']
  ])('`%s` : le texte joué reste marqué devant le test', (ligne, attendu) => {
    expect(lire(ligne, 0)).toEqual([
      { commande: 'npm test', codeDeSortie: 0, changementDeDossier: attendu }
    ])
  })

  // fix-ok: un `cd` nommé autrement ne se lit pas : `alias c=cd; c ../x; npm test` et
  // `c=cd; $c ../x; npm test` se lisaient `npm test`, et effaçaient un rouge (sonde du contrôle final
  // sur le vrai lecteur et la vraie règle). On marque ce qui rend le verbe illisible, comme `eval`.
  it.each([
    ['alias c=cd; c ../x; npm test', 'alias c=cd'],
    ['alias t="cd ../x"; t; npm test', 'alias t="cd ../x"'],
    ['c=cd; $c ../x; npm test', '$c ../x'],
    ['c=cd; "$c" ../x; npm test', '"$c" ../x'],
    ['c=cd; ${c} ../x; npm test', '${c} ../x'],
    ['${c:-cd} ../x; npm test', '${c:-cd} ../x'],
    ['"${c:-cd}" ../x; npm test', '"${c:-cd}" ../x'],
    ['{ ${c:-cd} ../x; }; npm test', '${c:-cd} ../x'],
    ['c="cd ../x"; $c; npm test', '$c'],
    ['$c=cd; $c ../x; npm test', '$c ../x'],
    ['$(echo cd) ../x; npm test', '$(echo cd) ../x'],
    ['`echo cd` ../x; npm test', '`echo cd` ../x'],
    ['{ $c ../x; }; npm test', '$c ../x'],
    ['Set-Alias c Set-Location; c ../x; npm test', 'Set-Alias c Set-Location'],
    ['New-Alias c Set-Location; c ../x; npm test', 'New-Alias c Set-Location'],
    ['sal c sl; c ../x; npm test', 'sal c sl'],
    ['nal c sl; c ../x; npm test', 'nal c sl'],
    ['Invoke-Expression "cd ../x"; npm test', 'Invoke-Expression "cd ../x"'],
    ['iex "cd ../x"; npm test', 'iex "cd ../x"']
  ])('`%s` : le verbe illisible reste marqué devant le test', (ligne, attendu) => {
    expect(lire(ligne, 0)).toEqual([
      { commande: 'npm test', codeDeSortie: 0, changementDeDossier: attendu }
    ])
  })

  // Le jumeau compte autant : `$env:CI=1` est la forme courante de PowerShell, et un chemin en `$HOME`
  // lance un programme, qui ne peut pas changer le dossier de la ligne.
  it.each([
    ['$env:CI=1; npm test'],
    ['$env:CI = "1"; npm test'],
    ['$env:PATH; npm test'],
    ['$x = 1; npm test'],
    ['$x=1; npm test'],
    ['$x += 1; npm test'],
    ['$HOME/bin/outil; npm test'],
    ['"$HOME/bin/outil" --vite; npm test'],
    ['${HOME}/bin/outil; npm test'],
    ['${X:-a}/bin/outil; npm test'],
    ['echo ${c:-cd} ../x; npm test'],
    ['echo $c ../x; npm test'],
    ['echo alias c=cd; npm test'],
    ['npm run alias && npm test'],
    ['ICI=$(pwd) && npm test']
  ])('jumeau : `%s` ne rend pas le verbe illisible', (ligne) => {
    expect(lire(ligne, 0)).toEqual([{ commande: 'npm test', codeDeSortie: 0 }])
  })

  // fix-ok: le mot d'avant se lisait sans ses guillemets, donc `grep -E '^(a|b)' "$P"` et
  // `node -e "f()" "$F"` passaient pour un `a)` de `case`, et leur argument pour un verbe (13 formes
  // sur 2 012 commandes réelles, 01/11, en ajoutant un test après chaque ligne).
  it.each([
    [`grep -E '^(a|b)' "$F"; npm test`],
    ['node -e "f()" "$F"; npm test'],
    ['node -e "f()" "$(cygpath -w a.txt)"; npm test'],
    ['cp "$(git rev-parse --git-path index)" "$F"; npm test'],
    ['echo $(pwd) "$F"; npm test'],
    ['node -e "f()" cd; npm test'],
    ['echo "{" cd ../x; npm test'],
    ['echo "then" cd ../x; npm test']
  ])('jumeau : dans `%s`, le mot d’après est un argument', (ligne) => {
    expect(lire(ligne, 0)).toEqual([{ commande: 'npm test', codeDeSortie: 0 }])
  })

  // À la même borne, la vraie position de commande reste vue, en bash comme en PowerShell.
  it.each([
    ['case "$x" in "a") $c ../x;; esac; npm test', '$c ../x'],
    ['if ($x) {cd ../y}; npm test', '{cd ../y}'],
    ['IF ($x) { cd ../y }; npm test', 'cd ../y }'],
    ['f(){ $c ../x; }; f; npm test', '$c ../x']
  ])('`%s` : ce qui suit `)` hors guillemets reste une commande', (ligne, attendu) => {
    expect(lire(ligne, 0)).toEqual([
      { commande: 'npm test', codeDeSortie: 0, changementDeDossier: attendu }
    ])
  })

  it('un programme rangé dans une variable reste marqué : on ne sait pas lire ce qu’il est', () => {
    expect(lire('FF=/c/outils/ffmpeg.exe; "$FF" --version; npm test', 0)).toEqual([
      { commande: 'npm test', codeDeSortie: 0, changementDeDossier: '"$FF" --version' }
    ])
  })

  // fix-ok: `DEVANT_UNE_COMMANDE` n'acceptait qu'un mot fini par `)`, donc `f(){ cd ../x; }; f; npm test`
  // effaçait un rouge, alors que `f() { cd ../x; }` était vu (essai exécuté par le contrôle final).
  it('`f(){` sans `cd` ne marque rien : le jumeau de la forme collée', () => {
    expect(lire('f(){ echo a; }; f; npm test', 0)).toEqual([
      { commande: 'npm test', codeDeSortie: 0 }
    ])
    // Une accolade collée à un mot quelconque n'ouvre aucun bloc : ce `cd` est un texte d'`echo`.
    expect(lire('echo a{ cd ../x; npm test', 0)).toEqual([
      { commande: 'npm test', codeDeSortie: 0 }
    ])
  })

  it.each([
    ['(cd ../x) && npm test'],
    ['(cd ../x && git pull) && npm test'],
    ['( cd ../x ); npm test'],
    ['ICI=$(cd ../x && pwd) && npm test'],
    ['git log --grep cd && npm test'],
    ['grep cd a.txt && npm test'],
    ['npm run cd && npm test'],
    ['{ echo cd; }; npm test'],
    ['builtin echo cd && npm test'],
    ['{ true; }; npm test'],
    ['! git diff --quiet; npm test'],
    ['if true; then echo ok; fi; npm test'],
    ['case a in a) echo cd;; esac; npm test'],
    ['{cdx ../y}; npm test'],
    ['echo {cd && npm test'],
    ['echo source; npm test'],
    ['echo eval && npm test']
  ])('jumeau : `%s` ne change pas le dossier du test', (ligne) => {
    expect(lire(ligne, 0)).toEqual([{ commande: 'npm test', codeDeSortie: 0 }])
  })

  it.each([
    ['{ cd D:/Projet; }; npm test'],
    ['builtin cd D:/Projet && npm test'],
    ['if cd "D:\\Projet"; then true; fi; npm test']
  ])('jumeau : `%s` reste dans le dossier de l’agent', (ligne) => {
    expect(testsDuTerminal(ligne, { codeDeSortie: 0, sortie: '' }, 'D:\\Projet')).toEqual([
      { commande: 'npm test', codeDeSortie: 0 }
    ])
  })

  // `!` inverse le code : le retirer du verbe ferait d'un test rouge un vert.
  it('jumeau : ces mots ne deviennent pas des lanceurs de test', () => {
    expect(lire('! npm test', 0)).toEqual([])
    expect(lire('{ npm test; echo EXIT=$?; }', 0, 'EXIT=1')).toEqual([])
    expect(lire('if true; then npm test; echo EXIT=$?; fi', 0, 'EXIT=1')).toEqual([])
  })

  /*
   * fix-ok: 30 des 33 `cd` mesurés avant un test (161 sorties réelles, 01/11) visent le dossier de
   * l'agent : les compter comme un départ recréerait de faux « Bloqué » sur près d'un test sur trois.
   */
  const VERT = { codeDeSortie: 0, sortie: '' }

  it.each([
    ['cd D:/Projet && npm test'],
    ['cd "D:\\Projet" && npm test'],
    ['cd d:/projet/ && npm test'],
    ['cd /d/Projet && npm test'],
    ['cd D:/Projet; npm test']
  ])('`%s` : aller dans le dossier de l’agent n’est pas en changer', (ligne) => {
    expect(testsDuTerminal(ligne, VERT, 'D:\\Projet')).toEqual([
      { commande: 'npm test', codeDeSortie: 0 }
    ])
  })

  it.each([
    ['cd D:/Projet/sous && npm test', 'cd D:/Projet/sous'],
    ['cd D:/Projet2 && npm test', 'cd D:/Projet2'],
    ['cd D:/Projet && cd .. && npm test', 'cd ..'],
    ['cd .. && cd D:/Projet && npm test', 'cd ..'],
    ['pushd D:/Projet && npm test', 'pushd D:/Projet'],
    ['cd . && npm test', 'cd .']
  ])('jumeau : `%s` reste un changement de dossier', (ligne, attendu) => {
    expect(testsDuTerminal(ligne, VERT, 'D:\\Projet')).toEqual([
      { commande: 'npm test', codeDeSortie: 0, changementDeDossier: attendu }
    ])
  })

  it('jumeau : sans dossier connu, tout `cd` compte', () => {
    expect(testsDuTerminal('cd D:/Projet && npm test', VERT)).toEqual([
      { commande: 'npm test', codeDeSortie: 0, changementDeDossier: 'cd D:/Projet' }
    ])
  })

  it('le `cd` suit le test partout où son code est lu : `echo`, bilan vitest, tube', () => {
    expect(lire('cd ../x && npm test > l.log 2>&1; echo EXIT=$?', 0, 'EXIT=1')).toEqual([
      { commande: 'npm test', codeDeSortie: 1, changementDeDossier: 'cd ../x' }
    ])
    expect(
      lire('cd ../x && npm test | tail -5; echo "exit ${PIPESTATUS[0]}"', 0, 'exit 2')
    ).toEqual([{ commande: 'npm test', codeDeSortie: 2, changementDeDossier: 'cd ../x' }])
    expect(
      lire(
        'cd ../x && npx vitest run | tail -5',
        0,
        ' Test Files  1 passed (1)\n Tests  1 passed (1)\n Duration  1s'
      )
    ).toEqual([{ commande: 'npx vitest run', codeDeSortie: 0, changementDeDossier: 'cd ../x' }])
  })

  it('ce qui ne change pas le dossier du test ne le marque pas', () => {
    const sansDossier = [{ commande: 'npm test', codeDeSortie: 0 }]
    expect(lire('git status && npm test', 0)).toEqual(sansDossier)
    expect(lire('echo cd ../x && npm test', 0)).toEqual(sansDossier)
    expect(lire('CI=1 npm test', 0)).toEqual(sansDossier)
    expect(lire('env CI=1 npm test', 0)).toEqual(sansDossier)
    // Le `cd` qui SUIT le test n'a rien changé pour lui.
    expect(lire('npm test && cd ..; echo EXIT=$?', 0, 'EXIT=0')).toEqual([])
    expect(lire('npm test; echo EXIT=$?; cd ..', 0, 'EXIT=0')).toEqual(sansDossier)
    expect(lire('npx vitest run cd', 0)).toEqual([
      { commande: 'npx vitest run cd', codeDeSortie: 0 }
    ])
  })

  it('`env --chdir` lance le test ailleurs dans son propre maillon : il n’est plus lu comme un test', () => {
    expect(lire('env --chdir=../x npm test', 0)).toEqual([])
    expect(lire('env -C../x npm test', 0)).toEqual([])
    expect(lire('env -C ../x npm test', 0)).toEqual([])
    expect(lire('env --chdir ../x npm test', 0)).toEqual([])
    // Jumeau : `env` avec d'autres options reste lu.
    expect(lire('env -i CI=1 npm test', 0)).toEqual([{ commande: 'npm test', codeDeSortie: 0 }])
  })

  it('un changement de dossier très long reste borné, et le test reste marqué', () => {
    const [test] = testsDuTerminal(`cd ${'a'.repeat(COMMANDE_DE_TEST_MAX * 2)} && npm test`, {
      codeDeSortie: 0,
      sortie: ''
    })
    expect(test.commande).toBe('npm test')
    expect(test.changementDeDossier).toHaveLength(COMMANDE_DE_TEST_MAX)
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

describe('testsDuTerminal — une commande reste lisible ENTIÈRE (conv-1423)', () => {
  const cibles = (n: number): string =>
    Array.from({ length: n }, (_, i) => `src/fichier-${i}.test.ts`).join(' ')

  it('une commande de 1 000 caractères est gardée entière, à la lecture comme au stockage', () => {
    const ligne = `npx vitest run ${cibles(40)}`
    expect(ligne.length).toBeGreaterThan(900)
    const lus = testsDuTerminal(ligne, { codeDeSortie: 1, sortie: '' })
    expect(lus).toEqual([{ commande: ligne, codeDeSortie: 1 }])
    expect(lireTestsDuTerminal(lus)).toEqual(lus)
  })

  it('le plafond du lecteur est celui du fil : ils sont écrits à deux endroits', () => {
    const ligne = `npx vitest run ${cibles(400)}`
    expect(ligne.length).toBeGreaterThan(COMMANDE_DE_TEST_MAX)
    const [lu] = testsDuTerminal(ligne, { codeDeSortie: 1, sortie: '' })
    expect(lu.commande).toHaveLength(COMMANDE_DE_TEST_MAX)
    expect(lireTestsDuTerminal([{ commande: ligne, codeDeSortie: 1 }])[0].commande).toHaveLength(
      COMMANDE_DE_TEST_MAX
    )
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
