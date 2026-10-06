import { describe, expect, it } from 'vitest'
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { resolve, sep } from 'node:path'
import { jetonsDeCauseParFichier } from './default-gate-hooks'

/**
 * UN VIEUX `fix-ok:` NE VAUT PAS LAISSEZ-PASSER PERPETUEL (default-gate-hooks.ts, commentaire de
 * `jetonsDeCauseParFichier`). La regle n'etait ecrite qu'en prose : kaizen conv-113 (reparation 2,
 * commit d1b97289) l'a cassee avec tous les tests au vert, en lisant l'attente ET le dernier
 * commit ensemble. Effet : un run qui modifie a l'aveugle un fichier dont le dernier commit porte
 * une cause etait credite par cette vieille cause. Ce test la rend deterministe.
 */
function depot(etapes: { commite: string; enAttente?: string }): string {
  const repo = mkdtempSync(resolve(realpathSync.native(tmpdir()), 'jeton-perime-'))
  const git = (...a: string[]): void => {
    execFileSync('git', a, { cwd: repo, stdio: 'ignore' })
  }
  const cible = resolve(repo, 'cible.ts')
  git('init', '-b', 'main')
  git('config', 'user.email', 'a@b.c')
  git('config', 'user.name', 'test')
  writeFileSync(cible, 'export const x = 1\n')
  git('add', '-A')
  git('commit', '-m', 'avant')
  writeFileSync(cible, etapes.commite)
  git('add', '-A')
  git('commit', '-m', 'ancien correctif')
  if (etapes.enAttente !== undefined) writeFileSync(cible, etapes.enAttente)
  return cible.split(sep).join('/')
}

const ANCIEN = '// fix-ok: cause mesuree d un ancien correctif\nexport const x = 1\n'

describe('jetonsDeCauseParFichier — une cause deja commitee ne couvre pas une NOUVELLE modification', () => {
  it('ne credite PAS des lignes en attente sans jeton, meme si le dernier commit en porte un', async () => {
    const cible = depot({ commite: ANCIEN, enAttente: `${ANCIEN}export const y = 2\n` })
    expect(await jetonsDeCauseParFichier('', [], [cible])).toEqual({})
  })

  it('temoin : credite des lignes en attente qui portent leur propre jeton', async () => {
    const cible = depot({
      commite: ANCIEN,
      enAttente: `${ANCIEN}// fix-ok: nouvelle cause mesuree\nexport const y = 2\n`
    })
    expect(await jetonsDeCauseParFichier('', [], [cible])).toEqual({ [cible]: true })
  })

  it('temoin : sans rien en attente, la cause du dernier commit reste creditee', async () => {
    const cible = depot({ commite: ANCIEN })
    expect(await jetonsDeCauseParFichier('', [], [cible])).toEqual({ [cible]: true })
  })
})
