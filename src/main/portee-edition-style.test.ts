import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { porteeDUneEdition } from './verify-command'
import { readTestsCitant } from './git-read-main'

/**
 * DEFAUT VECU le 2026-09-03 (conv-21) : `edit_file` rejouait la SUITE ENTIERE pour un changement de
 * couleur d'une seule feuille de style — donc plafond de temps atteint, donc edition refusee sans
 * qu'aucun verdict ne soit rendu. La derivation de portee existait deja, mais `EXTENSIONS_DE_CODE`
 * excluait `.css` : plus rien a cibler, repli global, chronometre.
 *
 * MESURE HORS MODELE du meme jour, dans ce depot :
 *   npx vitest related src/renderer/src/components/ChatView.css --run
 *   -> EXIT 0, 89 fichiers, 401 tests, 38 s (la suite entiere depasse 600 s).
 * Cibler MARCHE donc sur une feuille de style : le graphe d'imports la voit, via le composant qui
 * fait `import './ChatView.css'`.
 *
 * MAIS la meme mesure a montre le piege, et c'est lui qui commande la forme du correctif : les tests
 * qui JUGENT reellement le CSS ne l'IMPORTENT pas, ils le LISENT (`readFileSync`). Absents de la
 * portee mesuree : `ChatView.style.test.ts`, `ChatView.pastilles.test.ts`, `ui-system.test.ts`,
 * `spinner-legibility.test.ts`, `spinner-partout.test.ts`. Se contenter d'ajouter `.css` a la liste
 * des extensions de code aurait donc publie un VERT qui n'a jamais joue les tests du CSS.
 *
 * D'ou la regle testee ici : pour une feuille de style, la portee = le graphe d'imports PLUS les
 * fichiers de test qui NOMMENT ce type de fichier. Et quand la recherche ne peut pas conclure, il
 * n'y a pas de portee du tout — la suite entiere reprend la main.
 */

const SAUT = String.fromCharCode(10)

const jamais = async (): Promise<readonly string[] | undefined> => {
  throw new Error('la recherche de tests ne doit pas être lancée sur ce chemin')
}

describe('porteeDUneEdition — ce qu’une édition oblige à rejouer', () => {
  it('laisse la portée du CODE inchangée, sans chercher quoi que ce soit', async () => {
    await expect(porteeDUneEdition('src/a.ts', jamais)).resolves.toEqual(['src/a.ts'])
    await expect(porteeDUneEdition('src/a.tsx', jamais)).resolves.toEqual(['src/a.tsx'])
  })

  /*
   * L'ENTREE QUI DOIT FAIRE ECHOUER CE TEST SI LA CORRECTION EST FAUSSE : ajouter simplement `.css`
   * aux extensions de code. La portee vaudrait alors `['src/x.css']` seul, les tests qui LISENT la
   * feuille ne tourneraient pas, et une regression de couleur serait publiee sous le mot « verifie ».
   */
  it('ajoute à une feuille de style les tests qui la NOMMENT sans l’importer', async () => {
    const demandes: string[] = []
    const portee = await porteeDUneEdition('src/x.css', async (motif) => {
      demandes.push(motif)
      return ['a.test.ts', 'b.test.tsx']
    })
    expect(portee).toEqual(['src/x.css', 'a.test.ts', 'b.test.tsx'])
    // La recherche porte sur l'EXTENSION, pas sur le nom : `spinner-partout.test.ts` balaie tout
    // `src/renderer` sans jamais citer un fichier precis, et il juge pourtant ce qu'on vient d'editer.
    expect(demandes).toEqual(['.css'])
  })

  it('cherche l’extension RÉELLE du fichier de style édité', async () => {
    const demandes: string[] = []
    await porteeDUneEdition('src/x.scss', async (motif) => {
      demandes.push(motif)
      return []
    })
    expect(demandes).toEqual(['.scss'])
  })

  it('ne compte jamais deux fois le même fichier', async () => {
    const portee = await porteeDUneEdition('src/x.css', async () => [
      'a.test.ts',
      'src/x.css',
      'a.test.ts'
    ])
    expect(portee).toEqual(['src/x.css', 'a.test.ts'])
  })

  it('se contente du graphe d’imports quand AUCUN test ne nomme ce type de fichier', async () => {
    await expect(porteeDUneEdition('src/x.css', async () => [])).resolves.toEqual(['src/x.css'])
  })

  /*
   * « Je ne sais pas » n'est pas « il n'y en a pas ». Si la recherche echoue (pas de git, commande
   * absente), conclure a une portee COMPLETE serait exactement le faux vert qu'on evite : on rend
   * `undefined`, et l'appelant repart sur la suite entiere — lente, mais honnete.
   */
  it('ne dérive AUCUNE portée quand la recherche ne peut pas conclure', async () => {
    await expect(porteeDUneEdition('src/x.css', async () => undefined)).resolves.toBeUndefined()
  })

  it('laisse le non-code hors portée, comme avant', async () => {
    await expect(porteeDUneEdition('README.md', jamais)).resolves.toBeUndefined()
    await expect(porteeDUneEdition('package.json', jamais)).resolves.toBeUndefined()
    await expect(porteeDUneEdition('', jamais)).resolves.toBeUndefined()
  })
})

const temporaires: string[] = []
afterAll(() => {
  for (const chemin of temporaires.splice(0)) {
    try {
      rmSync(chemin, { recursive: true, force: true })
    } catch {
      /* Windows relâche ses verrous en différé — le ménage est un confort, pas le verdict. */
    }
  }
})

function depotJetable(): string {
  const repo = mkdtempSync(join(tmpdir(), 'autowin-citations-'))
  temporaires.push(repo)
  const git = (...args: string[]): string =>
    execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim()
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 't@t')
  git('config', 'user.name', 'T')
  git('config', 'commit.gpgsign', 'false')
  return repo
}

describe('readTestsCitant — les tests qui NOMMENT un type de fichier', () => {
  it('rend les fichiers de test qui le citent, et EUX SEULS', async () => {
    const repo = depotJetable()
    writeFileSync(
      join(repo, 'lit-le-style.test.ts'),
      ["import { readFileSync } from 'node:fs'", "readFileSync('./x.css', 'utf8')", ''].join(SAUT),
      'utf8'
    )
    writeFileSync(join(repo, 'sans-rapport.test.ts'), 'export const rien = 1' + SAUT, 'utf8')
    // Un fichier de PRODUCTION qui cite le style n'est pas un test : il n'a rien a jouer.
    writeFileSync(join(repo, 'composant.ts'), "import './x.css'" + SAUT, 'utf8')
    execFileSync('git', ['add', '-A'], { cwd: repo })
    execFileSync('git', ['commit', '-q', '-m', 'base'], { cwd: repo })

    await expect(readTestsCitant(repo, '.css')).resolves.toEqual(['lit-le-style.test.ts'])
  })

  it('rend une liste VIDE quand personne ne le cite — ce n’est pas un échec', async () => {
    const repo = depotJetable()
    writeFileSync(join(repo, 'sans-rapport.test.ts'), 'export const rien = 1' + SAUT, 'utf8')
    execFileSync('git', ['add', '-A'], { cwd: repo })
    execFileSync('git', ['commit', '-q', '-m', 'base'], { cwd: repo })

    await expect(readTestsCitant(repo, '.css')).resolves.toEqual([])
  })

  /*
   * HORS D'UN DEPOT, la recherche ne sait RIEN — et « rien trouve » se lirait comme « aucun test ne
   * le juge », donc comme une portee complete. Elle doit dire qu'elle ne sait pas.
   */
  it('rend « je ne sais pas » hors d’un dépôt git', async () => {
    const pasUnDepot = mkdtempSync(join(tmpdir(), 'autowin-sans-git-'))
    temporaires.push(pasUnDepot)
    await expect(readTestsCitant(pasUnDepot, '.css')).resolves.toBeUndefined()
  })
})
