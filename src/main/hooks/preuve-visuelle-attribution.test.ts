import { describe, expect, it } from 'vitest'
import { creerPreuveVisuelleHandler, creerPreuveMouvementHandler } from './default-gate-hooks'
import type { HookContext } from './hook-bus'

/**
 * ATTRIBUTION — un run ne se fait pas bloquer par la saleté de quelqu'un d'autre.
 *
 * DEFAUT MESURE le 2026-09-12 (conv-512) : `orchestrator.hooks.test.ts` > « le VRAI runner exécute
 * la commande » echouait — `exit 0` rendait `gateBlocked: true`. Le runner n'y etait pour rien : le
 * test travaille dans le depot REEL, et le garde-fou de preuve visuelle reconstruit sa liste de
 * fichiers depuis `git status` du depot ENTIER. L'arbre portait 217 fichiers modifies, dont 55 de
 * rendu, laisses par d'autres sessions — le hook les a attribues au run et a refuse le vert.
 *
 * La regle juste est celle que le kit ecrit deja pour le fichier « co-sale » : ce qui etait DEJA
 * modifie avant le demarrage du run ne lui appartient pas. Le handler soustrait donc l'etat de
 * depart, quand l'orchestrateur le lui donne.
 *
 * Ces tests injectent la liste de fichiers : ils prouvent la REGLE, sans dependre de l'etat du
 * depot au moment ou ils tournent.
 */
const RENDU = 'src/renderer/src/components/ChatView.tsx'
const AUTRE_RENDU = 'src/renderer/src/components/HomeView.tsx'

function ctx(fichiersAvant?: readonly string[]): HookContext {
  return {
    event: 'pre-green',
    task: 'corrige le bug',
    cwd: 'D:\\depot',
    requireProof: true,
    evidence: [],
    fichiersTouchesAvantLeRun: fichiersAvant
  }
}

describe('preuve visuelle — attribution des fichiers de rendu', () => {
  it('BLOQUE quand le run touche lui-meme un fichier de rendu sans capture lue', async () => {
    const handler = creerPreuveVisuelleHandler(() => [RENDU])
    expect((await handler(ctx([]))).block).toBe(true)
  })

  it('ne bloque PAS quand ce fichier etait DEJA sale avant le demarrage du run', async () => {
    const handler = creerPreuveVisuelleHandler(() => [RENDU])
    expect((await handler(ctx([RENDU]))).block).toBe(false)
  })

  it('bloque encore sur le fichier NEUF quand un autre etait deja sale', async () => {
    const handler = creerPreuveVisuelleHandler(() => [RENDU, AUTRE_RENDU])
    const verdict = await handler(ctx([RENDU]))
    expect(verdict.block).toBe(true)
    expect(verdict.reason).toContain('HomeView.tsx')
    expect(verdict.reason).not.toContain('ChatView.tsx')
  })

  it('sans etat de depart connu, garde le comportement prudent (il bloque)', async () => {
    const handler = creerPreuveVisuelleHandler(() => [RENDU])
    expect((await handler(ctx(undefined))).block).toBe(true)
  })
})

describe('preuve de mouvement — meme regle d attribution', () => {
  const DIFF_ANIMATION = ['+++ b/' + RENDU, '+  animation: pulse 2s infinite;'].join('\n')

  it('BLOQUE une animation ajoutee par le run sans mesure de mouvement', async () => {
    const handler = creerPreuveMouvementHandler(() => DIFF_ANIMATION)
    expect((await handler(ctx([]))).block).toBe(true)
  })

  it('ne bloque PAS quand le fichier anime etait deja sale au demarrage', async () => {
    const handler = creerPreuveMouvementHandler(() => DIFF_ANIMATION)
    expect((await handler(ctx([RENDU]))).block).toBe(false)
  })
})
