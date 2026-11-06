import { describe, expect, it } from 'vitest'
import { COMMANDE_DE_TEST_MAX, commandeJouee, lireTestsDuTerminal } from './chat-turn'
import {
  constatsRetenus,
  rougesRestants,
  verifyPeutLeverCeRouge,
  vertCouvreRouge
} from './preuve-du-tour'
import { testsDuTerminal } from '../main/providers/tests-du-terminal'
import { ALLOWED_COMMANDS } from '../main/commands/verify-command'

/**
 * LA COUVERTURE D'UN ROUGE (conv-1423). La même règle sert au Board et à la relance de fin de tour :
 * si elle se trompe vers le vert, un test cassé passe pour prouvé. Chaque refus a donc son jumeau
 * accepté, à la même borne.
 *
 * fix-ok: `--bail a.ts`, `pytest -V` et une commande relue d'un caractère sous son plafond donnaient
 * un faux vert, mesuré sur `vertCouvreRouge` ; npx, pnpm, yarn et `python -m pytest` n'avaient aucun
 * test, donc aucune réinjection ne pouvait les atteindre.
 */

/*
 * LE VRAI CHEMIN DE LA LIGNE AU CONSTAT (conv-1423, objection du contrôle final). `npm test` lu dans
 * `cd ../autre-projet && npm test` paraissait complet, et effaçait le rouge du projet courant. Ces
 * essais passent par le lecteur du terminal : c'est là que le `cd` se perdait, pas dans la règle.
 */
describe('un test lancé après un changement de dossier ne couvre rien, et n’est pas couvert', () => {
  const constat = (
    ligne: string,
    code: number,
    sortie = ''
  ): { cle: string; commande: string; etat: string } => {
    const [test] = testsDuTerminal(ligne, { codeDeSortie: code, sortie })
    const commande = commandeJouee(test)
    return { cle: `commande:${commande}`, commande, etat: code === 0 ? 'ok' : 'failed' }
  }

  it.each([
    ['cd ../autre-projet && npm test'],
    ['cd packages/autre && npx vitest run'],
    ['pushd ../autre && npx vitest run'],
    ['cd ../autre; npm test'],
    ['builtin cd ../autre && npm test'],
    ['if cd ../autre; then true; fi; npm test'],
    ['eval "cd ../autre" && npm test'],
    ['alias c=cd; c ../autre; npm test'],
    ['alias t="cd ../autre"; t; npm test'],
    ['c=cd; $c ../autre; npm test'],
    ['c=cd; ${c} ../autre; npm test'],
    ['${c:-cd} ../autre; npm test'],
    ['Set-Alias c Set-Location; c ../autre; npm test'],
    ['{ X=1 cd ../autre; }; npm test'],
    ['if X=1 cd ../autre; then true; fi; npm test'],
    ['X+=1 cd ../autre && npm test'],
    ['command -p cd ../autre && npm test'],
    ['command "-p" cd ../autre && npm test'],
    ['builtin "--" cd ../autre && npm test'],
    ["c'd' ../autre && npm test"],
    ['c\\d ../autre && npm test'],
    ['{ command -p cd ../autre; }; npm test'],
    ['{ time -p cd ../autre; }; npm test'],
    ['builtin -- cd ../autre && npm test'],
    ['"builtin" cd ../autre && npm test'],
    ['\\builtin cd ../autre && npm test'],
    ['cd.. && npm test']
  ])('`%s` vert ne rachète pas un rouge du dossier courant', (vert) => {
    const rouge = constat('npx vitest run src/main/a.test.ts', 1)
    expect(rougesRestants([rouge, constat(vert, 0)])).toEqual(['npx vitest run src/main/a.test.ts'])
  })

  it('un `cd` dans un bloc, lu par le bilan de vitest, ne rachète pas non plus', () => {
    const vert = constat(
      '{ cd ../autre; npx vitest run; }',
      0,
      ' Test Files  1 passed (1)\n Tests  1 passed (1)\n Duration  1s'
    )
    const rouge = constat('npx vitest run src/main/a.test.ts', 1)
    expect(rougesRestants([rouge, vert])).toEqual(['npx vitest run src/main/a.test.ts'])
  })

  it('jumeau : un `cd` limité à son sous-shell laisse le vert racheter le rouge', () => {
    const rouge = constat('npx vitest run src/main/a.test.ts', 1)
    expect(rougesRestants([rouge, constat('(cd ../autre) && npm test', 0)])).toEqual([])
  })

  it.each([
    ['$env:CI=1; npm test'],
    ['$x = 1; npm test'],
    ['$HOME/bin/outil; npm test'],
    ['${HOME}/bin/outil; npm test'],
    ['echo X=1 cd ../autre; npm test'],
    ['{ X=1 echo cd ../autre; }; npm test'],
    ['command -v cd && npm test'],
    ['mkdir -p cd && npm test'],
    ['git checkout -- cd && npm test'],
    ['echo builtin cd ../autre; npm test']
  ])('jumeau : `%s` vert rachète le rouge, aucun verbe n’y est illisible', (vert) => {
    const rouge = constat('npx vitest run src/main/a.test.ts', 1)
    expect(rougesRestants([rouge, constat(vert, 0)])).toEqual([])
  })

  it('même commande, autre dossier : deux vérifications distinctes', () => {
    expect(rougesRestants([constat('npm test', 1), constat('cd ../autre && npm test', 0)])).toEqual(
      ['npm test']
    )
  })

  it('un rouge lancé ailleurs n’est pas couvert par un vert du dossier courant', () => {
    const rouge = constat('cd ../autre && npx vitest run a.test.ts', 1)
    expect(rougesRestants([rouge, constat('npm test', 0)])).toEqual([
      'cd ../autre && npx vitest run a.test.ts'
    ])
  })

  it('deux dossiers différents ne se rachètent pas', () => {
    const rouge = constat('cd ../un && npm test', 1)
    expect(rougesRestants([rouge, constat('cd ../deux && npm test', 0)])).toEqual([
      'cd ../un && npm test'
    ])
  })

  it('jumeau : la même ligne rejouée dans le même dossier reste la boucle normale', () => {
    const ligne = 'cd ../autre && npm test'
    expect(rougesRestants([constat(ligne, 1), constat(ligne, 0)])).toEqual([])
  })

  it('jumeau : sans changement de dossier, le vert plus large couvre toujours', () => {
    const rouge = constat('npx vitest run src/main/a.test.ts', 1)
    expect(rougesRestants([rouge, constat('git status && npm test', 0)])).toEqual([])
  })
})

/*
 * LE LIBELLÉ D'UN `verify` CIBLÉ (conv-1423, objection du contrôle final). La relance propose cette
 * voie, et 291 `verify` sur 551 l'empruntent depuis le 20/10 : tant que la règle la lisait « inconnue »,
 * l'agent obéissait et le faux « Bloqué » restait. Les libellés viennent de la liste des commandes que
 * `verify` peut jouer, et non d'une copie : un script ajouté là échoue ici.
 *
 * fix-ok: `scriptLu` refusait tout ce qui suit `--`, or `commands.ts` écrit le libellé d'un `verify`
 * ciblé `<script> -- <fichier>` : ces tests étaient rouges avant la lecture de cette forme.
 */
describe('un `verify` sur un fichier de test : `<script> -- <fichier>`', () => {
  it.each([...ALLOWED_COMMANDS])('`%s -- <fichier>` rachète le rouge de ce fichier', (script) => {
    const vert = `${script} -- src/a.test.ts`
    expect(vertCouvreRouge(vert, 'npx vitest run src/a.test.ts')).toBe(true)
    expect(vertCouvreRouge(vert, 'npx vitest run src/a.test.ts --reporter=dot')).toBe(true)
    expect(vertCouvreRouge(vert, 'npx vitest run src/a.test.ts -t cas')).toBe(true)
    expect(vertCouvreRouge(vert, 'npx jest src/a.test.ts')).toBe(true)
  })

  it.each([
    ['le rouge visait aussi un autre fichier', 'npx vitest run src/a.test.ts src/b.test.ts'],
    ['un autre fichier', 'npx vitest run src/b.test.ts'],
    ['toute la suite', 'npx vitest run'],
    ['autre outil', 'pytest tests/a.py'],
    ['le typage', 'npm run typecheck'],
    ['le lint', 'npx eslint src/a.test.ts'],
    ['le `npm test` du projet', 'npm test']
  ])('refus — %s', (_cas, rouge) => {
    expect(vertCouvreRouge('npm run test:unit -- src/a.test.ts', rouge)).toBe(false)
  })

  it.each([
    ['une cible source', 'npm run test:unit -- src/a.ts'],
    ['deux fichiers, dont une source', 'npm run test:unit -- src/a.test.ts src/a.ts'],
    ['sans cible', 'npm run test:unit --'],
    ['un filtre sans cible', 'npm run test:unit -- -t cas'],
    ['un autre script', 'npm run build -- src/a.test.ts'],
    ['option inconnue', 'npm run test:unit -- --changed src/a.test.ts'],
    ['une chaîne', 'npm run test:unit -- src/a.test.ts && echo ok'],
    ['un joker', 'npm run test:unit -- src/*.test.ts'],
    // La voie d'une cible source : les tests qui importent ce fichier, liste que la règle ignore.
    ['`verify` sur une source', 'vitest related src/a.ts --run'],
    ['un mot devant `--`', 'npm run test:unit foo -- src/a.test.ts']
  ])('inconnu = ne couvre pas — %s', (_cas, vert) => {
    expect(vertCouvreRouge(vert, 'npx vitest run src/a.test.ts')).toBe(false)
    // Contre un rouge de la MÊME famille aussi : là, un vert sans fichier passerait pour « tout ».
    expect(vertCouvreRouge(vert, 'npm run test:unit -- src/a.test.ts')).toBe(false)
  })

  it('une option du lanceur devant `--` ne change rien : le jumeau du mot inconnu', () => {
    const vert = 'npm run test:unit --silent -- src/a.test.ts'
    expect(vertCouvreRouge(vert, 'npx vitest run src/a.test.ts')).toBe(true)
  })

  it('un filtre de nom reste plus étroit qu’un rouge sans filtre', () => {
    const vert = 'npm run test:unit -- src/a.test.ts -t cas'
    expect(vertCouvreRouge(vert, 'npx vitest run src/a.test.ts')).toBe(false)
    expect(vertCouvreRouge(vert, 'npx vitest run src/a.test.ts -t cas')).toBe(true)
  })

  it('plusieurs fichiers de test nommés se lisent comme avec l’outil', () => {
    const vert = 'npm run test:unit -- src/a.test.ts src/b.spec.tsx'
    expect(vertCouvreRouge(vert, 'npx vitest run src/a.test.ts src/b.spec.tsx')).toBe(true)
  })

  it('son rouge est couvert par ce qui rejoue ce fichier ou tout le projet', () => {
    const rouge = 'npm run test:unit -- src/a.test.ts'
    expect(vertCouvreRouge('npx vitest run src/a.test.ts', rouge)).toBe(true)
    expect(vertCouvreRouge('npx vitest run src/a.test.ts src/b.test.ts', rouge)).toBe(true)
    expect(vertCouvreRouge('npm test', rouge)).toBe(true)
    expect(vertCouvreRouge('npm run test:unit -- src/a.test.ts src/b.test.ts', rouge)).toBe(true)
  })

  it('son rouge n’est pas couvert par un vert qui ne nomme pas le fichier', () => {
    const rouge = 'npm run test:unit -- src/a.test.ts'
    // Rien ne dit que l'outil lancé seul lit la configuration du script : seul un fichier nommé,
    // donc trouvé, a tourné à coup sûr. `npm test` reste la règle du projet entier.
    expect(vertCouvreRouge('npx vitest run', rouge)).toBe(false)
    expect(vertCouvreRouge('npx vitest run src/b.test.ts', rouge)).toBe(false)
    expect(vertCouvreRouge('npm run test:unit', rouge)).toBe(false)
  })

  it('le même libellé rejoué au terminal se lit pareil', () => {
    const [test] = testsDuTerminal('npm run test:unit -- src/a.test.ts', {
      codeDeSortie: 0,
      sortie: ''
    })
    expect(test.commande).toBe('npm run test:unit -- src/a.test.ts')
    expect(vertCouvreRouge(commandeJouee(test), 'npx vitest run src/a.test.ts')).toBe(true)
  })
})

/*
 * fix-ok: la relance proposait `verify` sur tout rouge, avec une simple condition écrite pour l'agent.
 * Reproduit par le contrôle final : rouge `cd sous && npx vitest run src/a.test.ts`, `verify` vert sur
 * `src/a.test.ts`, et le rouge reste. La proposition est donc une question posée à la règle.
 */
describe('verifyPeutLeverCeRouge — `verify` ne se propose que s’il lèverait le rouge', () => {
  /** Un `verify` qui joue tout fichier : ici, seule la lecture du rouge est en jeu. */
  const joueTout = (fichier: string): string => `npm run test:unit -- ${fichier}`

  it.each([
    'npx vitest run src/a.test.ts',
    'npx vitest run src/a.test.ts --reporter=dot',
    'npx vitest run src/a.test.ts -t "un seul cas"',
    'npx jest src/a.test.tsx',
    'npm run test:unit -- src/a.test.ts',
    'npm test -- src/a.spec.ts'
  ])('oui : %s vise un seul fichier de test du dépôt', (rouge) => {
    expect(verifyPeutLeverCeRouge(rouge, joueTout)).toBe(true)
  })

  /*
   * fix-ok: `CIBLE_REFUSEE_PAR_VERIFY` recopiait les refus de `cibleDeVerification` sur un chemin passé
   * en minuscules. Comparé au vrai contrôle : 3 écarts sur 28 formes (`.git/`, `src/.git/`, `.Test.`).
   * La réponse vient donc de `verify` lui-même, et il reçoit le chemin tel qu'il est écrit.
   */
  it.each([
    ['src/A.Test.ts', 'npx vitest run src/A.Test.ts'],
    ['src\\A.Test.ts', 'npx vitest run src\\A.Test.ts'],
    ['./src/a.test.ts', 'npx vitest run ./src/a.test.ts'],
    ['src/a.test.ts', 'npx vitest run src/a.test.ts src/b.test.ts']
  ])('`verify` reçoit %s, tel qu’écrit dans le rouge', (attendu, rouge) => {
    const recus: string[] = []
    verifyPeutLeverCeRouge(rouge, (fichier) => {
      recus.push(fichier)
      return joueTout(fichier)
    })
    expect(recus).toEqual([attendu])
  })

  it('non : `verify` refuse ce fichier', () => {
    expect(verifyPeutLeverCeRouge('npx vitest run src/a.test.ts', () => null)).toBe(false)
  })

  it('non : `verify` jouerait un autre libellé que ce fichier', () => {
    const autre = (): string => 'npx vitest related src/a.test.ts --run'
    expect(verifyPeutLeverCeRouge('npx vitest run src/a.test.ts', autre)).toBe(false)
  })

  it('`verify` n’est pas interrogé quand le rouge ne nomme aucun fichier', () => {
    const interroge = (): string => {
      throw new Error('aucun fichier à interroger')
    }
    expect(verifyPeutLeverCeRouge('npx vitest run', interroge)).toBe(false)
    expect(verifyPeutLeverCeRouge('npm test', interroge)).toBe(false)
    expect(verifyPeutLeverCeRouge('npx vitest run src/a.test.ts | tail -5', interroge)).toBe(false)
  })

  it.each([
    ['un `cd` hors du dossier du tour', 'cd sous && npx vitest run src/a.test.ts'],
    ['une option inconnue', 'npx vitest run src/a.test.ts --changed'],
    ['un autre mode de vitest', 'npx vitest related src/a.ts --run'],
    ['deux fichiers : `verify` n’en prend qu’un', 'npx vitest run src/a.test.ts src/b.test.ts'],
    ['un dossier', 'npx vitest run src/main'],
    ['tout l’outil', 'npx vitest run'],
    ['le test du projet', 'npm test'],
    ['un fichier avec une espace', 'npx vitest run "src/mon fichier.test.ts"'],
    ['un autre outil de test', 'pytest a.test.py'],
    ['le typage', 'npm run typecheck'],
    ['le lint', 'npx eslint src/a.test.ts'],
    ['une commande illisible', 'npx vitest run src/a.test.ts | tail -5'],
    ['une commande vide', '']
  ])('non : %s', (_cas, rouge) => {
    expect(verifyPeutLeverCeRouge(rouge, joueTout)).toBe(false)
  })

  it('non : une commande peut-être coupée, à chaque plafond, avec son jumeau lisible', () => {
    const longue = (taille: number): string => {
      const debut = 'npx vitest run src/'
      const fin = '.test.ts'
      return `${debut}${'a'.repeat(taille - debut.length - fin.length)}${fin}`
    }
    expect(verifyPeutLeverCeRouge(longue(298), joueTout)).toBe(true)
    expect(verifyPeutLeverCeRouge(longue(299), joueTout)).toBe(false)
    expect(verifyPeutLeverCeRouge(longue(300), joueTout)).toBe(false)
    expect(verifyPeutLeverCeRouge(longue(301), joueTout)).toBe(true)
  })
})

describe('vertCouvreRouge — le vert a rejoué tout ce que le rouge visait', () => {
  it.each([
    ['plus large', 'npx vitest run src/a.test.ts src/b.test.ts', 'npx vitest run src/a.test.ts'],
    ['sans cible : tout l’outil', 'npx vitest run', 'npx vitest run src/a.test.ts'],
    [
      'dossier qui contient la cible',
      'npx vitest run src/main',
      'npx vitest run src/main/a.test.ts'
    ],
    [
      'sans le filtre -t',
      'npx vitest run src/a.test.ts',
      'npx vitest run src/a.test.ts -t "un cas"'
    ],
    ['même filtre, plus de cibles', 'npx vitest run a.ts b.ts -t x', 'npx vitest run a.ts -t x'],
    ['option d’affichage en plus', 'npx vitest run a.ts --reporter=dot', 'npx vitest run a.ts'],
    ['séparateurs différents', 'npx vitest run src/a.test.ts', 'npx vitest run src\\a.test.ts'],
    ['préfixe ./ retiré', 'npx vitest run src/a.test.ts', 'npx vitest run ./src/a.test.ts'],
    ['eslint : format différent', 'npx eslint src/a.ts -f json', 'npx eslint src/a.ts -f stylish'],
    ['eslint : --format=', 'npx eslint src/a.ts', 'npx eslint --format=json src/a.ts'],
    ['eslint complet', 'npm run lint', 'npx eslint src/a.ts'],
    ['eslint sur la racine', 'npx eslint .', 'npx eslint src/a.ts'],
    ['typage complet', 'npm run typecheck', 'npm run typecheck:node'],
    ['typage complet après tsc', 'npm run typecheck', 'tsc --noEmit -p tsconfig.node.json'],
    [
      'tsc des scripts du dépôt',
      'npm run typecheck',
      'npx tsc --noEmit -p x.json --composite false'
    ],
    ['eslint : --no-warn-ignored', 'npx eslint a.ts', 'npx eslint --no-warn-ignored a.ts'],
    ['npm test couvre un test', 'npm test', 'npx vitest run src/a.test.ts'],
    ['npm test couvre un test filtré', 'npm test', 'npx vitest run a.ts -t x'],
    ['pytest : le fichier couvre son cas', 'pytest tests/a.py', 'pytest tests/a.py::test_x'],
    ['chemin du lanceur', 'node_modules/.bin/vitest run', 'npx vitest run a.ts'],
    ['npx --no-install', 'npx --no-install vitest run', 'npx vitest run a.ts'],
    ['npx -y', 'npx -y vitest run', 'npx vitest run a.ts'],
    ['pnpm exec', 'pnpm exec vitest run', 'npx vitest run a.ts'],
    ['pnpm test', 'pnpm test', 'npx vitest run a.ts'],
    ['pnpm run lint', 'pnpm run lint', 'npx eslint src/a.ts'],
    ['yarn test', 'yarn test', 'npx vitest run a.ts'],
    ['yarn sans run', 'yarn lint', 'npx eslint src/a.ts'],
    ['yarn typecheck', 'yarn typecheck', 'npm run typecheck:node'],
    ['python -m pytest', 'python -m pytest tests/a.py', 'pytest tests/a.py::test_x'],
    ['python3 -m pytest', 'python3 -m pytest', 'pytest tests/a.py'],
    ['py -m pytest', 'py -m pytest', 'pytest tests/a.py'],
    ['--bail sans nombre garde sa cible', 'npx jest --bail a.test.ts', 'npx jest a.test.ts'],
    ['--bail suivi d’un nombre', 'npx vitest run --bail 1 a.ts', 'npx vitest run a.ts'],
    ['--bail=', 'npx vitest run --bail=1 a.ts', 'npx vitest run a.ts'],
    ['--bail sans cible : tout l’outil', 'npx jest --bail', 'npx jest a.test.ts'],
    ['--bail 1 sans cible : tout l’outil', 'npx vitest run --bail 1', 'npx vitest run a.ts'],
    ['npm t', 'npm t', 'npx vitest run a.ts'],
    ['npm run-script', 'npm run-script test', 'npx vitest run a.ts'],
    ['pytest -v reste de l’affichage', 'pytest -v tests/a.py', 'pytest tests/a.py'],
    ['option longue, casse libre', 'npx jest --runInBand a.ts', 'npx jest a.ts']
  ])('%s', (_cas, vert, rouge) => {
    expect(vertCouvreRouge(vert, rouge)).toBe(true)
  })

  it.each([
    ['partiel : il manque une cible', 'npx vitest run a.ts', 'npx vitest run a.ts b.ts'],
    ['vert ciblé, rouge complet', 'npx vitest run a.ts', 'npx vitest run'],
    ['autre fichier', 'npx vitest run b.ts', 'npx vitest run a.ts'],
    ['filtre -t ajouté au vert', 'npx vitest run a.ts -t x', 'npx vitest run a.ts'],
    ['autre filtre', 'npx vitest run a.ts -t y', 'npx vitest run a.ts -t x'],
    ['typage rouge, tests verts (conv-76)', 'npx vitest run', 'npm run typecheck'],
    ['typage rouge, npm test vert (conv-76)', 'npm test', 'npm run typecheck'],
    ['lint rouge, npm test vert', 'npm test', 'npm run lint'],
    ['eslint rouge, npm test vert', 'npm test', 'npx eslint src/a.ts'],
    ['tsc rouge, npm test vert', 'npm test', 'tsc --noEmit'],
    ['npm test rouge, vitest vert', 'npx vitest run', 'npm test'],
    ['typage partiel', 'npm run typecheck:node', 'npm run typecheck'],
    ['tsc nu ne vaut pas le typage complet', 'tsc --noEmit', 'npm run typecheck'],
    ['eslint partiel', 'npx eslint src/a.ts', 'npx eslint src/a.ts src/b.ts'],
    ['nom de dossier voisin', 'npx vitest run src/ma', 'npx vitest run src/main/a.test.ts'],
    ['outils différents', 'npx jest a.ts', 'npx vitest run a.ts'],
    // `--bail` n'avale pas la cible : lue comme sa valeur, elle laissait « tout l'outil » (conv-1423).
    ['--bail ne rend pas la commande complète', 'npx jest --bail a.test.ts', 'npx jest'],
    ['--bail garde sa cible', 'npx jest --bail a.test.ts', 'npx jest b.test.ts'],
    ['--bail suivi d’un nombre garde sa cible', 'npx jest --bail 1 a.ts', 'npx jest b.ts'],
    ['pnpm : filtre -t', 'pnpm exec vitest run a.ts -t x', 'npx vitest run a.ts'],
    ['python -m pytest partiel', 'python -m pytest tests/a.py', 'pytest tests/b.py']
  ])('refus — %s', (_cas, vert, rouge) => {
    expect(vertCouvreRouge(vert, rouge)).toBe(false)
  })

  it.each([
    ['option inconnue', 'npx vitest run --project web', 'npx vitest run a.ts'],
    ['configuration choisie', 'npx vitest run --config x.ts', 'npx vitest run a.ts'],
    ['script de test au périmètre inconnu', 'npm run test:unit', 'npx vitest run a.ts'],
    ['arguments passés derrière --', 'npm test -- a.ts', 'npx vitest run a.ts'],
    ['chaîne de commandes', 'npx vitest run && echo ok', 'npx vitest run a.ts'],
    ['commande vide', '', 'npx vitest run a.ts'],
    ['commande inconnue', 'make test', 'npx vitest run a.ts'],
    // `-V` affiche la version de pytest, aucun test ne tourne : une option courte garde sa casse.
    ['pytest -V', 'pytest -V', 'pytest tests/a.py'],
    ['option courte en capitale', 'npx jest -I', 'npx jest a.ts'],
    ['python sans pytest', 'python -m unittest', 'pytest tests/a.py'],
    ['python -c', 'python -c pytest', 'pytest tests/a.py'],
    ['script python', 'python tests/a.py', 'pytest tests/a.py'],
    ['pnpm exec d’un inconnu', 'pnpm exec make test', 'npx vitest run a.ts'],
    ['yarn : autre script', 'yarn build', 'npx vitest run a.ts'],
    ['npm n’a pas ce raccourci', 'npm lint', 'npx eslint src/a.ts'],
    ['npx : option inconnue', 'npx --yes vitest run', 'npx vitest run a.ts']
  ])('inconnu = ne couvre pas — %s', (_cas, vert, rouge) => {
    expect(vertCouvreRouge(vert, rouge)).toBe(false)
  })

  it('une commande coupée ne couvre rien et ne peut pas être couverte', () => {
    const cibles = (n: number): string =>
      Array.from({ length: n }, (_, i) => `src/fichier-${i}.test.ts`).join(' ')
    const coupeeAncienne = `npx vitest run ${cibles(40)}`.slice(0, 300)
    const coupee = `npx vitest run ${cibles(400)}`.slice(0, COMMANDE_DE_TEST_MAX)
    expect(coupeeAncienne).toHaveLength(300)
    expect(coupee).toHaveLength(COMMANDE_DE_TEST_MAX)
    for (const tronquee of [coupeeAncienne, coupee]) {
      // Un rouge coupé montre moins de cibles qu'il n'en a : même un vert complet ne le rachète pas.
      expect(vertCouvreRouge('npx vitest run', tronquee)).toBe(false)
      expect(vertCouvreRouge(tronquee, 'npx vitest run src/fichier-1.test.ts')).toBe(false)
    }
  })

  it.each([
    ['ancien plafond', 300],
    ['plafond actuel', COMMANDE_DE_TEST_MAX]
  ])('coupée juste après un espace, relue sans lui — %s', (_cas, plafond) => {
    // Le vrai chemin : le lecteur coupe, puis `lireTestsDuTerminal` retire l'espace final du morceau.
    const cible = 'src/a.test.ts '
    const debut = 'npx vitest run '
    const place = plafond - debut.length
    const coupee = `${debut}${'x'.repeat(place % cible.length)}${cible.repeat(Math.floor(place / cible.length))}`
    expect(coupee).toHaveLength(plafond)
    expect(coupee.endsWith(' ')).toBe(true)
    const [relue] = lireTestsDuTerminal([{ commande: coupee, codeDeSortie: 1 }])
    expect(relue.commande).toHaveLength(plafond - 1)
    expect(vertCouvreRouge('npx vitest run', relue.commande)).toBe(false)
    expect(vertCouvreRouge(relue.commande, 'npx vitest run src/a.test.ts')).toBe(false)
  })

  it('coupée dans une suite d’espaces entre guillemets : le guillemet resté ouvert la refuse', () => {
    const debut = 'npx vitest run src/a.test.ts -t "'
    const coupee = `${debut}${'x'.repeat(COMMANDE_DE_TEST_MAX - debut.length - 3)}   `
    const [relue] = lireTestsDuTerminal([{ commande: coupee, codeDeSortie: 1 }])
    expect(relue.commande).toHaveLength(COMMANDE_DE_TEST_MAX - 3)
    expect(vertCouvreRouge('npx vitest run', relue.commande)).toBe(false)
  })

  it('jumeau accepté : deux caractères de moins que la coupure, la commande reste lisible', () => {
    const base = 'npx vitest run src/a.test.ts '
    const longue = `${base}${'x'.repeat(298 - base.length)}`
    expect(longue).toHaveLength(298)
    expect(vertCouvreRouge('npx vitest run', longue)).toBe(true)
  })
})

describe('constatsRetenus — la dernière issue de chaque vérification, rouges couverts retirés', () => {
  const vert = (commande: string): { cle: string; commande: string; etat: string } => ({
    cle: commande,
    commande,
    etat: 'ok'
  })
  const rouge = (commande: string): { cle: string; commande: string; etat: string } => ({
    cle: commande,
    commande,
    etat: 'failed'
  })

  it('un vert plus large retire le rouge', () => {
    const lus = constatsRetenus([rouge('npx vitest run a.ts'), vert('npx vitest run')])
    expect(lus.map((c) => c.commande)).toEqual(['npx vitest run'])
  })

  it('un vert ANTÉRIEUR au rouge ne couvre rien', () => {
    expect(rougesRestants([vert('npx vitest run'), rouge('npx vitest run a.ts')])).toEqual([
      'npx vitest run a.ts'
    ])
  })

  it('rouge, vert, puis rouge à nouveau : rouge', () => {
    expect(
      rougesRestants([
        rouge('npx vitest run a.ts'),
        vert('npx vitest run a.ts'),
        rouge('npx vitest run a.ts')
      ])
    ).toEqual(['npx vitest run a.ts'])
  })

  it('rouge, vert plus large, puis le même rouge : rouge', () => {
    expect(
      rougesRestants([
        rouge('npx vitest run a.ts'),
        vert('npx vitest run'),
        rouge('npx vitest run a.ts')
      ])
    ).toEqual(['npx vitest run a.ts'])
  })

  it('la même commande rouge puis verte : plus rien de rouge', () => {
    expect(rougesRestants([rouge('npm test'), vert('npm test')])).toEqual([])
  })

  it('un constat sans commande (orchestration) n’est ni couvert ni couvrant', () => {
    const lus = constatsRetenus([
      { cle: 'orchestrate', etat: 'failed' },
      vert('npm test'),
      { cle: 'npx vitest run a.ts', commande: 'npx vitest run a.ts', etat: 'failed' },
      { cle: 'orchestrate-2', etat: 'ok' }
    ])
    expect(lus.map((c) => c.cle)).toEqual([
      'orchestrate',
      'npm test',
      'npx vitest run a.ts',
      'orchestrate-2'
    ])
  })

  it('l’ordre gardé est celui de la dernière issue', () => {
    const lus = constatsRetenus([vert('npm test'), vert('npx eslint a.ts'), vert('npm test')])
    expect(lus.map((c) => c.cle)).toEqual(['npx eslint a.ts', 'npm test'])
  })
})
