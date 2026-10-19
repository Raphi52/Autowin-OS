// @vitest-environment happy-dom
import { act } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { chatApi, installRafShim, mountChat, type ChatHarness } from './ChatView.harness'

/**
 * Preuve que le bloc est ALIMENTE, pas seulement atteignable : l'evenement du run le fait
 * apparaitre, et le clic pre-remplit reellement le composer. Un composant qu'aucun evenement
 * n'atteint est du theatre, quel que soit le nombre de ses tests unitaires.
 */
describe('ChatView — les suppositions du cadrage arrivent dans le fil', () => {
  let harness: ChatHarness | undefined

  beforeAll(installRafShim)
  afterEach(async () => {
    await harness?.unmount()
    harness = undefined
  })

  async function monter(): Promise<(event: Record<string, unknown>) => void> {
    let emit!: (event: Record<string, unknown>) => void
    harness = await mountChat(
      chatApi({
        onAppEvent: vi.fn((listener) => {
          emit = listener as (event: Record<string, unknown>) => void
          return vi.fn()
        })
      })
    )
    return emit
  }

  const evenement = (convId: string): Record<string, unknown> => ({
    type: 'orchestrate-hypotheses',
    convId,
    hypotheses: [
      { affirmation: 'le sanitizeur refuse les contrôles', source: 'confiance' },
      { affirmation: 'le store est vide au premier lancement', source: 'besoin' }
    ]
  })

  it('affiche le bloc pour la conversation ACTIVE, et pas pour une autre', async () => {
    const emit = await monter()
    // Le harnais monte une seule conversation, « A », qui est donc l'active.
    await act(async () => emit(evenement('conv-etrangere')))
    expect(harness!.container.querySelector('[data-testid="cadrage-hypotheses"]')).toBeNull()

    await act(async () => emit(evenement('A')))
    const bloc = harness!.container.querySelector('[data-testid="cadrage-hypotheses"]')
    expect(bloc?.textContent).toContain('le sanitizeur refuse les contrôles')
    expect(harness!.container.querySelectorAll('[data-testid="cadrage-hypothese"]')).toHaveLength(2)
  })

  it('un clic sur une supposition PRE-REMPLIT le composer, sans envoyer', async () => {
    const emit = await monter()
    await act(async () => emit(evenement('A')))
    const ligne = harness!.container.querySelectorAll<HTMLButtonElement>('.askd-choix')[0]
    await act(async () => ligne.click())
    const composer = harness!.textarea()
    expect(composer.value).toContain('le sanitizeur refuse les contrôles')
    expect(composer.value).toMatch(/En réalité\s*:\s*$/u)
  })

  /**
   * LE BLOC EST VIVANT, PAS PERSISTANT — defaut vecu sur conv-512.
   *
   * Le run s'est termine a 16:31:43 (tour `24bf5294-7ab1-4104-aa0c-1c0f62009fb8`, evenement de
   * cloture `status: succeeded`). La capture jointe par l'utilisateur a la saisie `ts`
   * 1789233975928 (17:26:15, 55 minutes plus tard) montre encore le bloc et son pied « Le run
   * continue — rien n'attend ta reponse » : l'application affirmait qu'un travail etait en cours
   * alors que plus rien ne tournait. `orchestrate-end` ne purgeait pas les suppositions.
   */
  it('la fin du run fait disparaitre le bloc de la conversation concernee', async () => {
    const emit = await monter()
    await act(async () => emit(evenement('A')))
    expect(harness!.container.querySelector('[data-testid="cadrage-hypotheses"]')).not.toBeNull()

    await act(async () =>
      emit({ type: 'orchestrate-end', convId: 'A', runPath: 'RUN.md', status: 'green' })
    )
    expect(harness!.container.querySelector('[data-testid="cadrage-hypotheses"]')).toBeNull()
  })

  it('la fin du run d une AUTRE conversation laisse le bloc en place', async () => {
    const emit = await monter()
    await act(async () => emit(evenement('A')))
    await act(async () =>
      emit({
        type: 'orchestrate-end',
        convId: 'conv-etrangere',
        runPath: 'RUN.md',
        status: 'green'
      })
    )
    expect(harness!.container.querySelector('[data-testid="cadrage-hypotheses"]')).not.toBeNull()
  })

  it('un evenement sans supposition ne fait apparaitre aucun bloc', async () => {
    const emit = await monter()
    await act(async () => emit({ type: 'orchestrate-hypotheses', convId: 'A', hypotheses: [] }))
    expect(harness!.container.querySelector('[data-testid="cadrage-hypotheses"]')).toBeNull()
  })
})

/**
 * LE REPLI SE GARDE PAR CONVERSATION — demande du 19/10 (conv-358) : « garde l'état replié du bloc
 * cadrage par conversation, pour qu'il reste fermé quand je change de fil et que je reviens ».
 *
 * Avant : le repli vivait DANS le composant. Changer pour un fil sans cadrage démontait le bloc et
 * l'état repartait « ouvert » au retour ; changer pour un fil AVEC cadrage gardait la même instance,
 * donc le repli de A s'appliquait à B.
 */
describe('ChatView — le repli du cadrage suit la conversation', () => {
  let harness: ChatHarness | undefined

  beforeAll(installRafShim)
  afterEach(async () => {
    // Le fil actif est memorise : sans remise a zero, le test suivant s'ouvrirait sur B ou C.
    localStorage.clear()
    await harness?.unmount()
    harness = undefined
  })

  const stubs = [
    { id: 'A', title: 'Conversation A', category: 'codex', provider: 'codex', updatedAt: 3 },
    { id: 'B', title: 'Conversation B', category: 'codex', provider: 'codex', updatedAt: 2 },
    { id: 'C', title: 'Conversation C', category: 'codex', provider: 'codex', updatedAt: 1 }
  ]

  async function monter(): Promise<(event: Record<string, unknown>) => void> {
    let emit!: (event: Record<string, unknown>) => void
    harness = await mountChat(
      chatApi({
        conversations: vi.fn().mockResolvedValue(stubs),
        conversation: vi.fn(async (id: string) => ({
          ...stubs.find((s) => s.id === id),
          messages: []
        })),
        onAppEvent: vi.fn((listener) => {
          emit = listener as (event: Record<string, unknown>) => void
          return vi.fn()
        })
      })
    )
    return emit
  }

  const hypotheses = (convId: string, runPath?: string): Record<string, unknown> => ({
    type: 'orchestrate-hypotheses',
    convId,
    runPath,
    hypotheses: [{ affirmation: `supposition de ${convId}`, source: 'besoin' }]
  })

  const ouvrir = async (id: string): Promise<void> => {
    const pick = [...harness!.container.querySelectorAll<HTMLElement>('.conv-pick')].find((el) =>
      el.textContent?.includes(`Conversation ${id}`)
    )
    if (!pick) throw new Error(`conversation ${id} absente de la liste`)
    await act(async () => pick.click())
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })
  }

  const replie = (): boolean | null => {
    const bloc = harness!.container.querySelector('[data-testid="cadrage-hypotheses"]')
    return bloc ? bloc.classList.contains('is-replie') : null
  }

  const plier = async (): Promise<void> => {
    const fleche = harness!.container.querySelector<HTMLButtonElement>('.cadrage-hyp-plier')!
    await act(async () => fleche.click())
  }

  it('replié dans A, ouvert dans B, toujours replié au retour dans A', async () => {
    const emit = await monter()
    await act(async () => {
      emit(hypotheses('A'))
      emit(hypotheses('B'))
    })
    await plier()
    expect(replie()).toBe(true)

    await ouvrir('B')
    expect(replie()).toBe(false)
    expect(harness!.container.textContent).toContain('supposition de B')

    await ouvrir('A')
    expect(replie()).toBe(true)
    // Et c'est bien le bloc de A : deplie, il montre SES suppositions.
    await plier()
    expect(replie()).toBe(false)
    expect(harness!.container.textContent).toContain('supposition de A')
  })

  it('reste replié après un passage par un fil SANS cadrage (le bloc y est démonté)', async () => {
    const emit = await monter()
    await act(async () => emit(hypotheses('A')))
    await plier()

    await ouvrir('C')
    expect(replie()).toBeNull()

    await ouvrir('A')
    expect(replie()).toBe(true)
  })

  it('un NOUVEAU run du même fil rouvre le bloc : ses suppositions sont neuves', async () => {
    const emit = await monter()
    await act(async () => emit(hypotheses('A')))
    await plier()
    await act(async () =>
      emit({ type: 'orchestrate-end', convId: 'A', runPath: 'RUN.md', status: 'green' })
    )
    await act(async () => emit(hypotheses('A')))
    expect(replie()).toBe(false)
  })

  it('un re-cadrage du MÊME run garde le repli ; celui d’un AUTRE run arrive ouvert, fin perdue ou pas', async () => {
    const emit = await monter()
    await act(async () => emit(hypotheses('A', 'runs/r1/RUN.md')))
    await plier()
    await act(async () => emit(hypotheses('A', 'runs/r1/RUN.md')))
    expect(replie()).toBe(true)
    // Aucun `orchestrate-end` pour r1 : la fin s'est perdue, le run r2 cadre quand meme.
    await act(async () => emit(hypotheses('A', 'runs/r2/RUN.md')))
    expect(replie()).toBe(false)
  })
})
