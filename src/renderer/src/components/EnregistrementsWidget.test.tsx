// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EnregistrementsWidget } from './EnregistrementsWidget'

;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

/** Le moteur vocal du navigateur, rejoue : une liste de resultats, finaux ou non. */
class FakeRecognition {
  static instances: FakeRecognition[] = []
  continuous = false
  interimResults = false
  lang = ''
  demarrages = 0
  arrets = 0
  onresult: ((e: unknown) => void) | null = null
  onend: (() => void) | null = null
  onerror: ((e: unknown) => void) | null = null
  constructor() {
    FakeRecognition.instances.push(this)
  }
  start(): void {
    this.demarrages += 1
  }
  stop(): void {
    this.arrets += 1
  }
  abort(): void {
    this.arrets += 1
  }
  dire(texte: string, final: boolean): void {
    this.onresult?.({
      resultIndex: 0,
      results: [Object.assign([{ transcript: texte }], { isFinal: final })]
    })
  }
}

const monte: Array<{ root: ReturnType<typeof createRoot>; container: HTMLDivElement }> = []

/** Un disque factice, mais qui se COMPORTE comme le vrai : on relit ce qu'il a recu. */
const disque = new Map<string, string[]>()
const transcriptDemarrer = vi.fn(async () => {
  disque.set('s-1', [])
  return { id: 's-1', nom: 'enregistrement-2026-09-01_14-32-05.txt', chemin: 'C:/t/e.txt' }
})
const transcriptAjouter = vi.fn(async (id: string, texte: string) => {
  const lignes = disque.get(id)
  if (!lignes) throw new Error(`Enregistrement inconnu : ${id}`)
  lignes.push(texte)
  return { octets: lignes.join('\n').length }
})
const transcriptTerminer = vi.fn(async () => ({ chemin: 'C:/t/e.txt' }))
const transcriptLister = vi.fn(async () => [
  {
    nom: 'enregistrement-2026-09-01_14-32-05.txt',
    chemin: 'C:/t/e.txt',
    octets: 2_400,
    le: Date.now() - 120_000
  }
])
const transcriptRevealer = vi.fn(async () => ({ ok: true as const }))

function rendre(): HTMLDivElement {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => root.render(createElement(EnregistrementsWidget)))
  monte.push({ root, container })
  return container
}

const clic = (container: HTMLElement, testid: string): void => {
  const bouton = container.querySelector<HTMLButtonElement>(`[data-testid="${testid}"]`)
  if (!bouton) throw new Error(`bouton absent : ${testid}`)
  act(() => bouton.dispatchEvent(new MouseEvent('click', { bubbles: true })))
}

beforeEach(() => {
  FakeRecognition.instances = []
  disque.clear()
  transcriptDemarrer.mockClear()
  transcriptAjouter.mockClear()
  transcriptTerminer.mockClear()
  transcriptLister.mockClear()
  transcriptRevealer.mockClear()
  ;(window as never as Record<string, unknown>).SpeechRecognition = FakeRecognition
  ;(window as never as Record<string, unknown>).api = {
    whisperEtat: vi.fn(async () => ({ installe: false })),
    transcriptDemarrer,
    transcriptAjouter,
    transcriptTerminer,
    transcriptLister,
    transcriptRevealer
  }
})

afterEach(() => {
  for (const { root, container } of monte.splice(0)) {
    act(() => root.unmount())
    container.remove()
  }
})

describe('widget Enregistrements', () => {
  it('n ouvre aucun micro et n ecrit rien avant qu on appuie', async () => {
    const c = rendre()
    await act(async () => {
      await Promise.resolve()
    })
    expect(FakeRecognition.instances).toHaveLength(0)
    expect(transcriptDemarrer).not.toHaveBeenCalled()
    expect(c.querySelector('[data-testid="enregistrements-etat"]')?.textContent).toContain(
      'Micro coupé'
    )
  })

  it('ECRIT CHAQUE PHRASE au fil de l eau, sans attendre l arret', async () => {
    // LE DEFAUT REPARE : l'ancien bouton de Jarvis n'ecrivait NULLE PART, et une reunion de trois
    // heures etait perdue. L'ENTREE QUI CASSERAIT UN FAUX FIX : on relit le disque APRES deux
    // phrases et AVANT d'avoir arrete — un widget qui n'ecrirait qu'a la fin serait rouge ici.
    const c = rendre()
    clic(c, 'enregistrements-bascule')
    await act(async () => {
      await Promise.resolve()
    })
    const moteur = FakeRecognition.instances.at(-1)!
    expect(moteur.demarrages).toBe(1)

    await act(async () => moteur.dire('on commence la reunion', true))
    await act(async () => moteur.dire('Jarvis, ouvre le task manager', true))

    expect(disque.get('s-1')).toEqual(['on commence la reunion', 'Jarvis, ouvre le task manager'])
    // Et le mot d'eveil prononce n'a rien lance : ce widget ne parle pas a Jarvis.
    expect(c.textContent).toContain('Jarvis, ouvre le task manager')
    expect(transcriptTerminer).not.toHaveBeenCalled()
  })

  it('n ecrit pas un segment encore en cours de dictee', async () => {
    const c = rendre()
    clic(c, 'enregistrements-bascule')
    await act(async () => {
      await Promise.resolve()
    })
    const moteur = FakeRecognition.instances.at(-1)!
    await act(async () => moteur.dire('je suis en train de', false))
    expect(transcriptAjouter).not.toHaveBeenCalled()
    expect(c.querySelector('[data-testid="enregistrements-partiel"]')?.textContent).toBe(
      'je suis en train de'
    )
  })

  it('relance le moteur qui se coupe seul, et ne le relance plus une fois arrete', async () => {
    // Un moteur de reconnaissance se coupe apres un silence. Sans relance, un enregistrement de
    // trois heures s'arreterait a la premiere pause ; avec une relance NON gardee, le micro
    // repartirait apres l'arret, dans un fichier qu'on croit ferme.
    const c = rendre()
    clic(c, 'enregistrements-bascule')
    await act(async () => {
      await Promise.resolve()
    })
    const moteur = FakeRecognition.instances.at(-1)!
    act(() => moteur.onend?.())
    expect(moteur.demarrages).toBe(2)

    clic(c, 'enregistrements-bascule')
    await act(async () => {
      await Promise.resolve()
    })
    const apres = moteur.demarrages
    act(() => moteur.onend?.())
    expect(moteur.demarrages).toBe(apres)
    expect(transcriptTerminer).toHaveBeenCalledWith('s-1')
  })

  it('ARRETE et le DIT quand l ecriture echoue', async () => {
    // Le pire resultat serait de continuer a afficher « enregistrement en cours » sur un disque
    // muet : on croirait avoir tout, on n'aurait rien.
    transcriptAjouter.mockRejectedValueOnce(new Error('disque plein'))
    const c = rendre()
    clic(c, 'enregistrements-bascule')
    await act(async () => {
      await Promise.resolve()
    })
    const moteur = FakeRecognition.instances.at(-1)!
    await act(async () => moteur.dire('une phrase perdue', true))
    await act(async () => {
      await Promise.resolve()
    })
    expect(c.querySelector('[data-testid="enregistrements-erreur"]')?.textContent).toContain(
      'disque plein'
    )
    expect(moteur.arrets).toBeGreaterThan(0)
    expect(c.querySelector('[data-testid="enregistrements-bascule"]')?.getAttribute(
      'aria-pressed'
    )).toBe('false')
  })

  it('MONTRE les derniers fichiers enregistres, et les ouvre dans l explorateur', async () => {
    const c = rendre()
    await act(async () => {
      await Promise.resolve()
    })
    const liste = c.querySelector('[data-testid="enregistrements-fichiers"]')
    expect(liste?.textContent).toContain('01/09/2026 à 14:32')
    expect(liste?.textContent).toContain('2.4 ko')
    const bouton = liste?.querySelector('button')
    act(() => bouton?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(transcriptRevealer).toHaveBeenCalledWith('C:/t/e.txt')
  })

  it('dit clairement qu il n y a encore rien', async () => {
    transcriptLister.mockResolvedValueOnce([])
    const c = rendre()
    await act(async () => {
      await Promise.resolve()
    })
    expect(c.querySelector('[data-testid="enregistrements-vide"]')).not.toBeNull()
  })
})
