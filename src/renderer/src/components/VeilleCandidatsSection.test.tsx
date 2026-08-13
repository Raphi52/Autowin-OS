// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CandidatVeille } from '../../../main/veille/candidats'
import type { StockVeille } from '../../../main/veille/candidats-store'
import { VeilleCandidatsSection } from './VeilleCandidatsSection'

/**
 * La section de veille, et les trois zéros qu'elle refuse d'afficher comme s'ils voulaient dire « rien
 * de neuf » : la lecture pas encore revenue, la lecture en échec, et les sources muettes.
 *
 * C'est le même défaut que ce dépôt a corrigé deux fois aujourd'hui ailleurs — un compteur à zéro qui
 * se lit « aucun » alors qu'il veut dire « pas su ».
 */

let conteneur: HTMLDivElement | undefined
let racine: Root | undefined

afterEach(() => {
  act(() => racine?.unmount())
  conteneur?.remove()
  conteneur = undefined
  racine = undefined
})

const candidat = (partiel: Partial<CandidatVeille> = {}): CandidatVeille => ({
  id: 'codex|https://x.test/releases|support mcp',
  concurrent: 'Codex',
  titre: 'Support MCP distant',
  url: 'https://x.test/releases',
  dateSource: '2026-08-07',
  citation: 'Added support for remote MCP servers with OAuth authentication',
  type: 'ajout',
  prompt: 'Étudie cette nouveauté',
  vuLe: '2026-08-13T00:00:00.000Z',
  statut: 'nouveau',
  ...partiel
})

const stock = (partiel: Partial<StockVeille> = {}): StockVeille => ({
  candidats: [candidat()],
  echecs: [],
  ...partiel
})

async function rendre(props: Parameters<typeof VeilleCandidatsSection>[0]): Promise<void> {
  conteneur = document.createElement('div')
  document.body.appendChild(conteneur)
  racine = createRoot(conteneur)
  await act(async () => {
    racine!.render(<VeilleCandidatsSection {...props} />)
  })
}

const texte = (): string => conteneur?.textContent ?? ''
const trouver = (id: string): HTMLElement | null =>
  conteneur?.querySelector(`[data-testid="${id}"]`) ?? null

describe('ce que la section affiche', () => {
  it('liste un candidat avec sa citation et sa source cliquable', async () => {
    await rendre({ charger: async () => stock() })

    expect(texte()).toContain('Support MCP distant')
    // La citation est la PREUVE que la feature existe : elle doit être lisible, pas cachée.
    expect(texte()).toContain('Added support for remote MCP servers')
    const lien = conteneur?.querySelector('a.veille-source') as HTMLAnchorElement | null
    expect(lien?.getAttribute('href')).toBe('https://x.test/releases')
  })

  it('dit que la lecture est EN COURS, au lieu d’afficher zéro candidat', async () => {
    // Une promesse qui ne se résout pas : c'est l'état réel pendant qu'une passe tourne.
    await rendre({ charger: () => new Promise<StockVeille>(() => {}) })
    expect(trouver('veille-attente')).not.toBeNull()
    expect(trouver('veille-liste')).toBeNull()
  })

  it('dit qu’une lecture a ÉCHOUÉ, au lieu d’afficher une liste vide', async () => {
    await rendre({
      charger: async () => {
        throw new Error('stock illisible')
      }
    })
    expect(trouver('veille-erreur')?.textContent).toContain('stock illisible')
    expect(trouver('veille-liste')).toBeNull()
  })

  it('AFFICHE les sources muettes : sans elles, zéro candidat mentirait', async () => {
    // Cas concret du premier jour : la source Kimi n'avait rien publié depuis novembre 2025.
    await rendre({
      charger: async () =>
        stock({
          candidats: [],
          echecs: [{ concurrent: 'Kimi', url: 'https://k.test/log', detail: 'HTTP 404', vuLe: 'x' }]
        })
    })
    expect(trouver('veille-echecs')?.textContent).toContain('Kimi')
    expect(trouver('veille-echecs')?.textContent).toContain('HTTP 404')
    expect(trouver('veille-vide')).not.toBeNull()
  })

  it('distingue « jamais lu » de « rien trouvé »', async () => {
    await rendre({ charger: async () => stock({ candidats: [] }) })
    expect(trouver('veille-jamais-lue')).not.toBeNull()
  })

  it('cache les candidats écartés, mais dit combien ils sont', async () => {
    await rendre({
      charger: async () =>
        stock({ candidats: [candidat(), candidat({ id: 'b', statut: 'ecarte' })] })
    })
    expect(trouver('veille-compte')?.textContent).toContain('1')
    // Un écarté masqué SANS compteur donnerait l'impression que la veille n'a rien trouvé de plus.
    expect(texte()).toContain('1 écarté')
  })
})

describe('prompter un candidat', () => {
  it('envoie le prompt et marque le candidat comme prompté', async () => {
    const prompter = vi.fn()
    const marquer = vi.fn(async () => stock({ candidats: [candidat({ statut: 'prompte' })] }))
    await rendre({ charger: async () => stock(), marquer, prompter })

    const bouton = conteneur?.querySelector('button.veille-prompter') as HTMLButtonElement
    await act(async () => {
      bouton.click()
    })

    expect(prompter).toHaveBeenCalledTimes(1)
    expect(prompter.mock.calls[0][0]).toMatchObject({ titre: 'Support MCP distant' })
    // Le marquage évite de reproposer indéfiniment ce qu'on vient de lancer.
    expect(marquer).toHaveBeenCalledWith('codex|https://x.test/releases|support mcp', 'prompte')
    expect(texte()).toContain('prompté')
  })

  it('écarter marque le candidat, sans l’envoyer', async () => {
    const prompter = vi.fn()
    const marquer = vi.fn(async () => stock({ candidats: [candidat({ statut: 'ecarte' })] }))
    await rendre({ charger: async () => stock(), marquer, prompter })

    const boutons = [...(conteneur?.querySelectorAll('button') ?? [])] as HTMLButtonElement[]
    const ecarter = boutons.find((b) => b.textContent?.includes('Écarter'))
    await act(async () => {
      ecarter?.click()
    })

    expect(marquer).toHaveBeenCalledWith('codex|https://x.test/releases|support mcp', 'ecarte')
    expect(prompter).not.toHaveBeenCalled()
  })
})
