// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
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

  it('SCINDE en deux colonnes : ajouts d’un côté, corrections de l’autre', async () => {
    // Mesuré sur un seul CHANGELOG : 19 corrections pour 2 ajouts. Mélangées, les nouveautés étaient
    // noyées ; refusées, l'information disparaissait. Deux colonnes gardent les deux.
    await rendre({
      charger: async () =>
        stock({
          candidats: [
            candidat(),
            candidat({ id: 'fix', titre: 'Corrige un crash UNC', type: 'correction' }),
            candidat({ id: 'autre', titre: 'Documentation revue', type: 'autre' })
          ]
        })
    })
    const ajouts = trouver('veille-colonne-ajouts')
    const corrections = trouver('veille-colonne-corrections')
    expect(ajouts?.textContent).toContain('Support MCP distant')
    expect(ajouts?.textContent).not.toContain('Corrige un crash UNC')
    expect(corrections?.textContent).toContain('Corrige un crash UNC')
    // `autre` n'est pas un ajout prouvé : il n'a rien à faire dans la colonne où l'on pioche.
    expect(corrections?.textContent).toContain('Documentation revue')
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

describe('pertinence — la note du scout, affichee et triable', () => {
  const av = (id: string, titre: string, pertinence: number | undefined): CandidatVeille =>
    candidat({ id, titre, ...(pertinence !== undefined ? { pertinence } : {}) })

  it('affiche la note a cote du candidat, et « non note » quand elle manque', async () => {
    await rendre({
      charger: async () =>
        stock({ candidats: [av('a', 'Avec note', 82), av('b', 'Sans note', undefined)] })
    })
    const notes = [...(conteneur?.querySelectorAll('[data-testid="veille-pertinence"]') ?? [])]
    expect(notes.some((n) => n.textContent?.includes('82'))).toBe(true)
    expect(trouver('veille-pertinence-absente')?.textContent).toContain('non noté')
  })

  it('trie par pertinence DECROISSANTE par defaut, le non-note en dernier', async () => {
    await rendre({
      charger: async () =>
        stock({
          candidats: [av('a', 'Moyen', 40), av('b', 'Fort', 95), av('c', 'Inconnu', undefined)]
        })
    })
    const titres = [...(conteneur?.querySelectorAll('.veille-titre') ?? [])].map(
      (t) => t.textContent
    )
    expect(titres.indexOf('Fort')).toBeLessThan(titres.indexOf('Moyen'))
    expect(titres.indexOf('Moyen')).toBeLessThan(titres.indexOf('Inconnu'))
  })

  it('bascule sur l’ordre de lecture quand on choisit « date »', async () => {
    await rendre({
      charger: async () => stock({ candidats: [av('a', 'Premier', 10), av('b', 'Second', 90)] })
    })
    const select = trouver('veille-tri') as HTMLSelectElement
    await act(async () => {
      select.value = 'date'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    const titres = [...(conteneur?.querySelectorAll('.veille-titre') ?? [])].map(
      (t) => t.textContent
    )
    // Ordre d'origine conserve : « Premier » avant « Second » malgre sa note plus faible.
    expect(titres.indexOf('Premier')).toBeLessThan(titres.indexOf('Second'))
  })

  it('la zone des colonnes defile : min-height 0 + overflow, sinon la liste deborde', () => {
    // happy-dom ne calcule pas le layout ; on verifie la REGLE, pas le rendu — c'est la propriete qui
    // rendait la liste inatteignable en bas quand `.tickets-view` est `overflow: hidden`.
    const css = readFileSync(join(__dirname, 'VeilleCandidatsSection.css'), 'utf8')
    const regle = css.match(/\.veille-colonnes\s*{[^}]*}/s)?.[0] ?? ''
    expect(regle).toMatch(/overflow-y:\s*auto/)
    expect(regle).toMatch(/min-height:\s*0/)
  })
})

describe('« En générer plus » — le scout interne depuis la vue', () => {
  it('déclenche la génération, montre l’état occupé, puis RELIT le stock', async () => {
    let resoudre!: (v: unknown) => void
    const generer = vi.fn(() => new Promise((r) => (resoudre = r)))
    const charges: StockVeille[] = [
      stock(),
      stock({ candidats: [candidat(), candidat({ id: 'interne|src/x.ts:1|vue cout', concurrent: 'Autowin OS', titre: 'Vue coût par rôle', url: 'src/x.ts:1' })] })
    ]
    const charger = vi.fn(async () => charges.shift() ?? stock())
    await rendre({ charger, generer })

    const bouton = trouver('veille-generer') as HTMLButtonElement
    expect(bouton).not.toBeNull()
    await act(async () => {
      bouton.click()
    })
    // Pendant la passe : bouton désactivé et libellé d'attente — un double-clic ne repaie rien.
    expect((trouver('veille-generer') as HTMLButtonElement).disabled).toBe(true)
    expect(texte()).toContain('Génération en cours…')

    await act(async () => {
      resoudre({ retenus: 1 })
    })
    expect(generer).toHaveBeenCalledTimes(1)
    // Le stock a été RELU après la passe : le nouveau candidat interne est affiché.
    expect(charger).toHaveBeenCalledTimes(2)
    expect(texte()).toContain('Vue coût par rôle')
    expect((trouver('veille-generer') as HTMLButtonElement).disabled).toBe(false)
  })

  it('une génération en échec est NOMMÉE à l’écran, pas avalée', async () => {
    const generer = vi.fn(async () => {
      throw new Error('génération interne non câblée sur ce poste')
    })
    await rendre({ charger: async () => stock(), generer })
    await act(async () => {
      ;(trouver('veille-generer') as HTMLButtonElement).click()
    })
    expect(texte()).toContain('non câblée')
  })
})
