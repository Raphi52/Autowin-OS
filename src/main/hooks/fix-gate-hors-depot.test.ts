import { afterAll, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDefaultHookBus } from './default-gate-hooks'
import type { HookContext } from './hook-bus'

/**
 * LE CONTRÔLE « SANS CAUSE » NE COMPTE QUE LES FICHIERS D'UN DÉPÔT (conv-1149, 2026-10-25).
 *
 * Défaut vécu sur conv-1146 (run-ec2036c0932d-1) : 7 des 17 réparations ne venaient QUE de ce
 * contrôle, dont trois pour des scripts jetables écrits hors du dépôt
 * (« 3 édits de D:/tmp/langue-outils/codemod2.cjs sans cause vérifiée »). Chaque refus relançait
 * build + nettoyage + juge, et poussait le run à semer des `fix-ok:` dans le code du produit.
 *
 * La règle : un fichier compte s'il vit dans un dépôt git — celui du run, ou un AUTRE quand le run
 * travaille sur un projet externe (cas réel : D:/GIT/... dans jetons-de-cause.test.ts). Un brouillon
 * hors de tout dépôt ne compte pas.
 */
const racine = mkdtempSync(join(tmpdir(), 'fix-gate-hors-depot-'))
const depot = join(racine, 'depot')
const autreDepot = join(racine, 'autre-projet')
const brouillon = join(racine, 'brouillon')
for (const dossier of [join(depot, '.git'), join(depot, 'src'), autreDepot, brouillon])
  mkdirSync(dossier, { recursive: true })
// Une copie de travail git (worktree) porte un FICHIER `.git`, pas un dossier.
writeFileSync(join(autreDepot, '.git'), 'gitdir: ailleurs\n')
afterAll(() => rmSync(racine, { recursive: true, force: true }))

const avant = (chemin: string): string => chemin.split('\\').join('/')

function ctx(editsByFile: Record<string, number>): HookContext {
  return {
    event: 'pre-green',
    task: 'corrige le bug',
    cwd: depot,
    requireProof: true,
    evidenceOkCount: 1,
    evidence: [],
    editsByFile,
    fichiersTouchesAvantLeRun: []
  }
}
const bus = (): ReturnType<typeof createDefaultHookBus> =>
  createDefaultHookBus(async () => ({ ok: true, exitCode: 0 }))
const refus = async (editsByFile: Record<string, number>): Promise<string> =>
  (await bus().run('pre-green', ctx(editsByFile))).reasons.join(' ')

describe('fix-gate — seuls les fichiers d un dépôt comptent', () => {
  it('ne refuse PAS 4 éditions d un script jetable hors de tout dépôt (cas conv-1146)', async () => {
    expect(await refus({ [avant(join(brouillon, 'codemod2.cjs'))]: 4 })).not.toContain('fix-gate')
  })

  it('refuse toujours 3 éditions d un fichier du dépôt du run, en relatif comme en absolu', async () => {
    expect(await refus({ 'src/a.ts': 3 })).toContain('fix-gate')
    expect(await refus({ [avant(join(depot, 'src', 'a.ts'))]: 3 })).toContain('fix-gate')
  })

  it('refuse toujours 3 éditions d un fichier d un AUTRE dépôt (projet externe du run)', async () => {
    expect(await refus({ [avant(join(autreDepot, 'Projet.csproj'))]: 3 })).toContain('fix-gate')
  })

  it('un brouillon hors dépôt ne masque pas le refus d un fichier du dépôt', async () => {
    const motif = await refus({ [avant(join(brouillon, 'x.cjs'))]: 5, 'src/a.ts': 3 })
    expect(motif).toContain('src/a.ts')
    expect(motif).not.toContain('x.cjs')
  })
})
