import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AppCommandBus } from './commands'
import { porteeDerivableDesChangements, verifyTimeoutOutcome } from './verify-command'

/**
 * DEFAUT VECU le 2026-08-25 (conv-1404) : `verify` sans cible a rendu
 * « verification arretee apres 600 s (plafond) — rien n'est prouve, la suite n'a pas rendu son
 * verdict ». Ce n'est pas un rouge, c'est une ABSENCE de verdict : dix minutes d'attente pour
 * apprendre qu'on ne sait rien. Et c'est aussi le repli d'`edit_file` quand la portee n'est pas
 * derivable, donc une edition saine peut se faire refuser par un chronometre.
 *
 * La question que l'agent pose en pratique n'est pas « le depot entier est-il vert ? » mais « est-ce
 * que ce que je viens de changer casse quelque chose ? ». Cette portee-la existait deja pour
 * `edit_file` (2026-08-22) et pour une cible source (2026-08-25) : elle manquait au seul cas sans
 * cible. Mesure des deux precedents : 20 a 70 s contre plus de dix minutes.
 *
 * ENTREES QUI DOIVENT FAIRE ECHOUER CES TESTS SI LA CORRECTION EST FAUSSE :
 *  - un arbre PROPRE : il n'y a rien a cibler, donc la suite complete doit rester la reponse — sinon
 *    on repond « rien n'est casse » a la question « le depot est-il vert ? », ce qui est un faux vert ;
 *  - un vert rendu SANS nommer sa portee : un vert dont on ignore l'etendue se lit plus large qu'il
 *    n'est, et c'est exactement ainsi qu'un « pret pour la fusion » a ete conclu a tort (conv-1371).
 */
const SAUT = String.fromCharCode(10)
const RACINE = join(process.cwd(), '.autowin-data', 'tests-verify-defaut')

const temporaires: string[] = []
afterEach(() => {
  for (const chemin of temporaires.splice(0)) {
    try {
      rmSync(chemin, { recursive: true, force: true })
    } catch {
      /* Windows relache ses verrous en differe — le menage est un confort, pas le verdict */
    }
  }
})

/** Un `vitest` neutre : ce test observe QUELLE commande est jouee, pas ce que le runner prouve. */
function runnerNeutre(repo: string): void {
  const bin = join(repo, 'node_modules', '.bin')
  mkdirSync(bin, { recursive: true })
  writeFileSync(
    join(bin, 'vitest.cmd'),
    ['@echo off', 'echo Tests 1 passed', 'exit /b 0', ''].join(SAUT),
    'utf8'
  )
  writeFileSync(
    join(bin, 'vitest'),
    ['#!/bin/sh', 'echo "Tests 1 passed"', 'exit 0', ''].join(SAUT),
    'utf8'
  )
  chmodSync(join(bin, 'vitest'), 0o755)
}

function depot(): { repo: string; salir: () => void } {
  mkdirSync(RACINE, { recursive: true })
  const repo = mkdtempSync(join(RACINE, 'repo-'))
  temporaires.push(repo)
  const git = (...args: string[]): string =>
    execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim()
  writeFileSync(
    join(repo, 'package.json'),
    JSON.stringify({ name: 'depot', scripts: { 'test:unit': 'vitest run' } }),
    'utf8'
  )
  writeFileSync(join(repo, 'sujet.ts'), 'export const valeur = (): number => 1' + SAUT, 'utf8')
  // Comme un vrai depot : sans cela le `node_modules` du runner neutre serait vu comme un
  // changement non commite, et la portee derivee serait `node_modules/` — un vert qui ne mesure rien.
  writeFileSync(join(repo, '.gitignore'), 'node_modules/' + SAUT, 'utf8')
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 't@t')
  git('config', 'user.name', 'T')
  git('config', 'commit.gpgsign', 'false')
  git('add', '-A')
  git('commit', '-q', '-m', 'base')
  runnerNeutre(repo)
  return {
    repo,
    salir: () =>
      writeFileSync(
        join(repo, 'sujet.ts'),
        'export const valeur = (): number => 2' + SAUT,
        'utf8'
      )
  }
}

const busSur = (repo: string): AppCommandBus =>
  new AppCommandBus({ executionWorkspace: repo } as never, () => undefined)

describe('verify sans cible — la portee vient de ce qui a CHANGE', () => {
  it('cible les fichiers non commites au lieu de rejouer toute la suite', async () => {
    const { repo, salir } = depot()
    salir()

    const result = await busSur(repo).exec('verify', {}, 'conv-1')

    const data = result.data as { command?: string }
    expect(data.command).toContain('vitest related')
    expect(data.command).toContain('sujet.ts')
  }, 120_000)

  it('NOMME la portee du vert, pour qu il ne se lise pas plus large qu il n est', async () => {
    const { repo, salir } = depot()
    salir()

    const result = await busSur(repo).exec('verify', {}, 'conv-1')

    const data = result.data as { portee?: string; output?: string }
    expect(String(data.portee ?? '') + String(data.output ?? '')).toContain('importent')
  }, 120_000)

  it('sur un arbre PROPRE, la suite complete reste la reponse (retrocompat)', async () => {
    const { repo } = depot()

    const result = await busSur(repo).exec('verify', {}, 'conv-1')

    const data = result.data as { command?: string }
    expect(data.command).not.toContain('related')
    expect(data.command).toContain('test:unit')
  }, 120_000)
})

/**
 * ATTRAPE PAR LE TEST DE RETROCOMPAT ci-dessus : un `node_modules/` non suivi devenait la cible, et
 * la commande jouee etait `vitest related node_modules/ --run` — un vert qui n'a rien mesure.
 */
describe('porteeDerivableDesChangements', () => {
  it('garde les fichiers de code', () => {
    expect(porteeDerivableDesChangements(['src/a.ts', 'src/b.tsx'])).toEqual([
      'src/a.ts',
      'src/b.tsx'
    ])
  })

  it('rend RIEN quand un seul chemin echappe au graphe d imports', () => {
    // Une portee qui ne couvre pas tout ce qui a change n'est pas une portee : c'est un faux vert.
    expect(porteeDerivableDesChangements(['src/a.ts', 'node_modules/'])).toBeUndefined()
    expect(porteeDerivableDesChangements(['README.md'])).toBeUndefined()
    expect(porteeDerivableDesChangements(['package.json'])).toBeUndefined()
  })

  it('rend RIEN sur un arbre propre', () => {
    expect(porteeDerivableDesChangements([])).toBeUndefined()
  })

  it('normalise les antislashs de Windows', () => {
    expect(porteeDerivableDesChangements(['src' + String.fromCharCode(92) + 'a.ts'])).toEqual([
      'src/a.ts'
    ])
  })
})

/**
 * DEFAUT VECU le 2026-08-25 (conv-1405), APRES le correctif ci-dessus : arbre PROPRE, donc plus
 * rien a cibler, donc suite entiere, donc plafond — « rien n'est prouve » une fois de plus. Le
 * ménage du depot avait rendu ce chemin actif.
 *
 * Mesure du meme jour : la suite entiere tourne PLUS DE 40 MINUTES sans finir, sous un plafond de
 * 600 s. Lancer une action dont l'echec est CERTAIN n'est pas une verification : c'est dix minutes
 * d'attente pour apprendre qu'on ne sait rien.
 *
 * Sur un arbre propre, la question naturelle n'est pas « le depot entier est-il vert ? » mais « ce
 * que je viens de COMMITTER casse-t-il quelque chose ? ». Cette portee-la est derivable du dernier
 * commit, et elle est NOMMEE — un vert plus etroit qui s'annonce vaut mieux qu'un plafond muet.
 */
describe('verify sans cible sur arbre PROPRE — la portee vient du dernier commit', () => {
  it('cible les fichiers du dernier commit plutot que la suite entiere', async () => {
    const { repo } = depot()
    const git = (...args: string[]): string =>
      execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim()
    writeFileSync(join(repo, 'sujet.ts'), 'export const valeur = (): number => 3' + SAUT, 'utf8')
    git('add', '-A')
    git('commit', '-q', '-m', 'change le sujet')

    const result = await busSur(repo).exec('verify', {}, 'conv-1')

    const data = result.data as { command?: string }
    expect(data.command).toContain('vitest related')
    expect(data.command).toContain('sujet.ts')
  }, 120_000)

  it('un dernier commit SANS code retombe sur la suite entiere (aucune portee derivable)', async () => {
    const { repo } = depot()
    const git = (...args: string[]): string =>
      execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim()
    writeFileSync(join(repo, 'LISEZMOI.md'), 'du texte' + SAUT, 'utf8')
    git('add', '-A')
    git('commit', '-q', '-m', 'doc seule')

    const result = await busSur(repo).exec('verify', {}, 'conv-1')

    const data = result.data as { command?: string }
    expect(data.command).not.toContain('related')
    expect(data.command).toContain('test:unit')
  }, 120_000)
})

/**
 * Un plafond atteint doit dire QUOI FAIRE. « rien n'est prouve » est exact mais sterile : l'agent
 * relance la meme commande et reperd dix minutes. Mesure du 2026-08-25 : trois occurrences en une
 * journee (conv-1400, conv-1404, conv-1405), la meme commande relancee a chaque fois.
 */
describe('verifyTimeoutOutcome — le plafond nomme la sortie de secours', () => {
  it('propose de cibler un fichier, au lieu de laisser relancer la meme commande', () => {
    const out = verifyTimeoutOutcome('npm run test:unit', 600_000)

    expect(out.ok).toBe(false)
    expect(out.output).toContain('cible')
    expect(out.output).toMatch(/AUTOWIN_VERIFY_TIMEOUT_MS/)
  })

  it('garde le message de plafond en TETE de ce que la suite avait ecrit (retrocompat)', () => {
    const out = verifyTimeoutOutcome('npm run test:unit', 600_000, 'des lignes deja tombees')

    expect(out.output.startsWith('vérification arrêtée')).toBe(true)
    expect(out.output).toContain('des lignes deja tombees')
  })
})
