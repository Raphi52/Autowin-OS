import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { transformSync } from 'esbuild'
import { describe, expect, it } from 'vitest'
import { lignesRedessinees, moduleSansReutilisation } from './cdp-profil-liste-chat.mjs'

/**
 * L'« avant » de la mesure conv-1115 doit VRAIMENT rejouer l'ancien comportement : on part du vrai
 * module, transformé comme le serveur de dev le sert (TypeScript retiré par esbuild).
 */
const SOURCE = resolve(
  import.meta.dirname,
  '..',
  'src/renderer/src/components/conversations-stables.ts'
)

async function charger(code) {
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
}

describe('moduleSansReutilisation', () => {
  const affichees = [{ id: 'a', title: 'A' }]
  const chargees = [{ id: 'a', title: 'A' }]

  it('forme esbuild (`export { x }`) : le module servi rend la liste chargée telle quelle', async () => {
    const transforme = transformSync(readFileSync(SOURCE, 'utf8'), {
      loader: 'ts',
      format: 'esm'
    }).code
    const avant = moduleSansReutilisation(transforme)
    expect(avant).not.toBeNull()

    const { reutiliserConversationsInchangees: corrige } = await charger(transforme)
    expect(corrige(affichees, chargees)).toBe(affichees)

    const { reutiliserConversationsInchangees: ancien } = await charger(avant)
    expect(ancien(affichees, chargees)).toBe(chargees)
  })

  it('forme du serveur de dev (`export function x(`) : même remplacement', async () => {
    // Forme relevée sur http://localhost:5173/src/components/conversations-stables.ts (23/10).
    const servi = transformSync(readFileSync(SOURCE, 'utf8'), { loader: 'ts' }).code
    expect(servi).toContain('export function reutiliserConversationsInchangees(')
    const avant = moduleSansReutilisation(servi)
    expect(avant).not.toBeNull()

    const { reutiliserConversationsInchangees: ancien, memeContenu } = await charger(avant)
    expect(ancien(affichees, chargees)).toBe(chargees)
    // Le reste du module est intact.
    expect(memeContenu(affichees, chargees)).toBe(true)
  })

  it('module sans la fonction ⇒ null (la sonde refuse un faux « avant »)', () => {
    expect(moduleSansReutilisation('export const x = 1')).toBeNull()
  })
})

describe('lignesRedessinees', () => {
  it('additionne les appels de LigneConversation de ChatView.tsx, et rien d’autre', () => {
    const releve = [
      {
        url: 'http://localhost:5173/src/components/ChatView.tsx?t=1',
        functions: [
          { functionName: 'LigneConversation2', ranges: [{ count: 985 }] },
          { functionName: 'ChatView', ranges: [{ count: 3 }] }
        ]
      },
      {
        url: 'http://localhost:5173/src/components/Autre.tsx',
        functions: [{ functionName: 'LigneConversation', ranges: [{ count: 7 }] }]
      }
    ]
    expect(lignesRedessinees(releve)).toBe(985)
    expect(lignesRedessinees(undefined)).toBe(0)
  })
})
