// @vitest-environment happy-dom
/**
 * FERMER LE BANDEAU « travail jamais publié » — ET QU'IL RESTE FERMÉ.
 *
 * Demande de l'utilisateur le 2026-08-27 : « je veux une petite croix pour fermer ce bandeau ».
 *
 * Le piège est dans le relevé : `getWorktreeActivity` est rappelé TOUTES LES 30 SECONDES et
 * réécrit le message. Une croix qui ferait seulement `setTravailNonPublie(null)` verrait donc le
 * bandeau revenir au tick suivant — un bouton qui promet une action sans effet durable, exactement
 * le défaut reproché le matin même sur le bouton « Déplier » : l'utilisateur clique, ça revient, et
 * il ne sait pas si c'est cassé ou si c'est lui.
 *
 * Mais l'inverse serait pire. Ce bandeau existe parce que trois travaux finis ont été perdus de vue
 * le 2026-08-23 ; le masquer POUR TOUJOURS étoufferait l'alerte suivante. La fermeture porte donc
 * sur CE message : si la liste change, l'avertissement revient.
 *
 * Entrées qui doivent faire échouer ces tests si la correction est fausse : (a) un relevé identique
 * après fermeture — le bandeau doit rester absent ; (b) un relevé DIFFÉRENT après fermeture — il
 * doit réapparaître.
 */
import { act, createElement } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { chatApi, installRafShim, mountChat, type ChatHarness } from './ChatView.harness'

vi.mock('./Markdown', () => ({
  Markdown: ({ text }: { text: string }) => createElement('span', null, text),
  extractRecommendation: (): string | null => null
}))

const travail = (agentId: string, fichier: string): Record<string, unknown> => ({
  agentId,
  travailNonPublie: true,
  fichiersNonPublies: [fichier],
  dateNonPublie: '2026-08-26'
})

let harnais: ChatHarness | undefined
beforeAll(() => installRafShim())
afterEach(async () => {
  await harnais?.unmount()
  harnais = undefined
  vi.useRealTimers()
})

const bandeau = (h: ChatHarness): Element | null =>
  h.container.querySelector('[data-testid="chat-travail-non-publie"]')

describe('bandeau « travail jamais publié » — sa croix', () => {
  it('porte une croix, et le clic le referme', async () => {
    const api = chatApi({
      getWorktreeActivity: vi.fn().mockResolvedValue([travail('a1', 'src/UpdateBanner.tsx')])
    })
    harnais = await mountChat(api)
    expect(bandeau(harnais), 'le bandeau doit d’abord s’afficher').not.toBeNull()

    const croix = harnais.container.querySelector('[data-testid="chat-travail-non-publie-fermer"]')
    expect(croix, 'la croix doit exister').not.toBeNull()

    await harnais.click('[data-testid="chat-travail-non-publie-fermer"]')
    expect(bandeau(harnais), 'le clic doit refermer le bandeau').toBeNull()
  })

  it('reste fermé au relevé suivant — sinon la croix ne promet rien', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const api = chatApi({
      getWorktreeActivity: vi.fn().mockResolvedValue([travail('a1', 'src/UpdateBanner.tsx')])
    })
    harnais = await mountChat(api)
    await harnais.click('[data-testid="chat-travail-non-publie-fermer"]')
    expect(bandeau(harnais)).toBeNull()

    // Le relevé périodique repasse avec EXACTEMENT le même message.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(31_000)
    })
    expect(bandeau(harnais), 'un relevé identique ne doit PAS rouvrir le bandeau').toBeNull()
  })

  it('revient si un NOUVEAU travail apparaît — une alerte neuve ne s’étouffe pas', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const activite = vi
      .fn()
      .mockResolvedValueOnce([travail('a1', 'src/UpdateBanner.tsx')])
      .mockResolvedValue([travail('a1', 'src/UpdateBanner.tsx'), travail('a2', 'src/HomeView.css')])
    harnais = await mountChat(chatApi({ getWorktreeActivity: activite }))
    await harnais.click('[data-testid="chat-travail-non-publie-fermer"]')
    expect(bandeau(harnais)).toBeNull()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(31_000)
    })
    expect(bandeau(harnais), 'un travail de PLUS doit rouvrir l’alerte').not.toBeNull()
  })
})
