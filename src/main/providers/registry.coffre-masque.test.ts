import { describe, expect, it, vi } from 'vitest'
import type { ProviderAdapter, SendResult, StreamChunk } from './types'

// Un vrai coffre (chiffrement factice, fichier temporaire) tient la clé : la sortie d'un moteur doit
// ressortir de la pompe du routeur avec son masquage réel, `[secret:NOM]`.
const { VALEUR } = vi.hoisted(() => ({ VALEUR: 'sk-coffre-0123456789abcdef' }))
vi.mock('../app/coffre-cles', async (importOriginal) => {
  const vrai = await importOriginal<typeof import('../app/coffre-cles')>()
  const { mkdtempSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const dossier = mkdtempSync(join(tmpdir(), 'coffre-routeur-'))
  const coffre = vrai.creerCoffre({
    chemin: () => join(dossier, 'coffre-cles.bin'),
    chiffrement: () => ({
      isEncryptionAvailable: () => true,
      encryptString: (t: string) => Buffer.from(t, 'utf8'),
      decryptString: (b: Buffer) => b.toString('utf8')
    }),
    lireRegistre: () => new Map(),
    env: {}
  })
  coffre.ajouterCle('MISTRAL_API_KEY', VALEUR)
  return { ...vrai, masquerValeurs: (texte: string) => coffre.masquerValeurs(texte) }
})

const MASQUE = '[secret:MISTRAL_API_KEY]'

function moteur(id: string, chunks: StreamChunk[], fin: () => SendResult): ProviderAdapter {
  return {
    id,
    auth: async () => true,
    async *send(): AsyncGenerator<StreamChunk, SendResult, void> {
      for (const c of chunks) yield c
      return fin()
    }
  }
}

describe('ProviderRegistry — la sortie d’un moteur entre masquée', () => {
  it('masque la valeur dans chaque morceau livré au fil et dans le résultat final', async () => {
    const { ProviderRegistry } = await import('./registry')
    const brut = new Uint8Array([1, 2, 3])
    const registry = new ProviderRegistry().register(
      moteur(
        'fuite',
        [
          { delta: `la clé vaut ${VALEUR}` },
          {
            delta: '',
            status: `Bash · echo ${VALEUR}`,
            statusDetail: { envoye: 'echo', retour: `${VALEUR}\n` }
          },
          { delta: '', testsDuTerminal: [{ commande: `curl -H "x: ${VALEUR}"`, codeDeSortie: 0 }] }
        ],
        () => ({
          text: `réponse : ${VALEUR}`,
          thinking: `j'ai lu ${VALEUR}`,
          provider: 'fuite',
          systemInjected: true,
          artifacts: [{ brut } as never]
        })
      )
    )
    const recus: StreamChunk[] = []
    const resultat = await registry.send('fuite', [{ role: 'user', content: 'x' }], {}, (c) =>
      recus.push(c)
    )
    const tout = JSON.stringify({ recus, resultat })
    expect(tout).not.toContain(VALEUR)
    expect(recus[0].delta).toBe(`la clé vaut ${MASQUE}`)
    expect(recus[1].statusDetail).toEqual({ envoye: 'echo', retour: `${MASQUE}\n` })
    expect(recus[2].testsDuTerminal?.[0].commande).toBe(`curl -H "x: ${MASQUE}"`)
    expect(resultat.text).toBe(`réponse : ${MASQUE}`)
    expect(resultat.thinking).toBe(`j'ai lu ${MASQUE}`)
    // Les données binaires ne sont pas parcourues : elles ressortent intactes.
    expect((resultat.artifacts?.[0] as unknown as { brut: Uint8Array }).brut).toBe(brut)
  })

  it('masque la valeur dans le message d’erreur rendu par un moteur qui échoue', async () => {
    const { ProviderRegistry } = await import('./registry')
    const registry = new ProviderRegistry().register({
      id: 'echec',
      auth: async () => true,
      // eslint-disable-next-line require-yield
      async *send(): AsyncGenerator<StreamChunk, SendResult, void> {
        throw new Error(`401 Unauthorized pour ${VALEUR}`)
      }
    })
    await expect(registry.send('echec', [{ role: 'user', content: 'x' }])).rejects.toThrow(
      `401 Unauthorized pour ${MASQUE}`
    )
  })

  it('jumeau : sans valeur du coffre, le morceau livré est le MÊME objet, inchangé', async () => {
    const { ProviderRegistry } = await import('./registry')
    const morceau: StreamChunk = {
      delta: 'rien de secret',
      statusDetail: { envoye: 'a', retour: 'b' }
    }
    const registry = new ProviderRegistry().register(
      moteur('propre', [morceau], () => ({ text: 'ok', provider: 'propre', systemInjected: true }))
    )
    const recus: StreamChunk[] = []
    const resultat = await registry.send('propre', [{ role: 'user', content: 'x' }], {}, (c) =>
      recus.push(c)
    )
    expect(recus[0]).toBe(morceau)
    expect(resultat.text).toBe('ok')
  })
})
