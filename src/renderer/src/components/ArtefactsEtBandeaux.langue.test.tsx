// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { ChatArtifact } from '../../../shared/artifacts'
import { UPDATE_STRATEGY_HINTS, UPDATE_STRATEGY_LABELS } from '../../../shared/update-contract'
import { appliquerLangue } from '../langue'
import { TEXTES_FR } from '../textes-ecrans/artefacts-et-bandeaux'
import { ArtifactPreview } from './ArtifactPreview'
import { UpdateBanner } from './UpdateBanner'
import { depuis } from './depuis'
import { libelleCadence } from './video-pointage'

/**
 * LES APERÇUS D'ARTEFACTS ET LE BOUTON DE MISE À JOUR SUIVENT LA LANGUE (conv-1170, lot 6). Entrée
 * qui doit faire échouer ce test : un libellé laissé en dur dans ArtifactPreview, artifact-outils
 * ou UpdateBanner, un composant qui ne se redessine pas quand la langue change, ou un français qui
 * ne revient pas mot pour mot.
 */
beforeAll(() => {
  ;(globalThis as never as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
})

let root: Root | null = null
let hote: HTMLDivElement | null = null

async function monter(element: React.JSX.Element): Promise<HTMLDivElement> {
  hote = document.createElement('div')
  document.body.appendChild(hote)
  root = createRoot(hote)
  await act(async () => {
    root!.render(element)
    await Promise.resolve()
    await Promise.resolve()
  })
  return hote
}

async function langue(code: 'fr' | 'en'): Promise<void> {
  await act(async () => appliquerLangue(code))
}

afterEach(async () => {
  await act(async () => root?.unmount())
  hote?.remove()
  root = null
  hote = null
  appliquerLangue('fr')
})

const executable: ChatArtifact = {
  id: 'artefact-outil',
  name: 'outil.exe',
  mimeType: 'application/x-msdownload',
  kind: 'executable',
  size: 2048,
  createdAt: 1,
  path: 'C:\\travail\\outil.exe',
  source: { provider: 'claude', model: 'opus-test' }
}

describe('aperçu d’artefact — langue', () => {
  it('bascule en anglais sans être remonté, puis revient au français', async () => {
    const zone = await monter(
      <ArtifactPreview artifact={executable} conversationId="conv-1" turnId="tour-1" />
    )
    const type = () => zone.querySelector('.artifact-preview__kind')!.textContent
    const bloque = () => zone.querySelector('.artifact-preview__blocked')!.textContent
    const poids = () => zone.querySelector('.artifact-preview__header span:last-child')!.textContent
    const afficher = () => zone.querySelector('.artifact-preview__reveal')!.textContent

    expect(type()).toBe('Exécutable')
    expect(bloque()).toBe('Exécution interdite · métadonnées uniquement')
    expect(poids()).toBe('2.0 Ko')
    expect(afficher()).toBe('Afficher le fichier')

    await langue('en')
    expect(type()).toBe('Executable')
    expect(bloque()).toBe('Execution forbidden · metadata only')
    expect(poids()).toBe('2.0 KB')
    expect(afficher()).toBe('Show the file')

    await langue('fr')
    expect(type()).toBe('Exécutable')
    expect(bloque()).toBe('Exécution interdite · métadonnées uniquement')
    expect(poids()).toBe('2.0 Ko')
    expect(afficher()).toBe('Afficher le fichier')
  })
})

describe('bouton de mise à jour — langue', () => {
  it('nomme la voie, le retard et les autres voies dans la langue choisie', async () => {
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        checkUpdate: vi.fn().mockResolvedValue({
          available: true,
          behind: 3,
          branch: 'feat/x',
          reference: 'origin/main',
          strategies: ['merge', 'rebase', 'switch-main']
        }),
        applyUpdate: vi.fn()
      }
    })
    const zone = await monter(<UpdateBanner />)
    const bouton = () => zone.querySelector('[data-testid="update-apply"]')!
    const autres = () => zone.querySelector('[data-testid="update-more"]')!

    expect(bouton().textContent).toContain('Fusionner origin/main')
    expect(bouton().getAttribute('aria-label')).toContain(
      '3 commit(s) à récupérer depuis origin/main · tu es sur feat/x'
    )
    expect(autres().getAttribute('aria-label')).toBe('Autres façons d’intégrer origin/main')

    await langue('en')
    expect(bouton().textContent).toContain('Merge origin/main')
    expect(bouton().getAttribute('aria-label')).toContain(
      '3 commit(s) to fetch from origin/main · you are on feat/x'
    )
    expect(bouton().getAttribute('aria-label')).toContain('Merges origin/main into your current')
    expect(autres().getAttribute('aria-label')).toBe('Other ways to integrate origin/main')

    await langue('fr')
    expect(bouton().textContent).toContain('Fusionner origin/main')
    expect(bouton().getAttribute('aria-label')).toContain(
      '3 commit(s) à récupérer depuis origin/main · tu es sur feat/x'
    )
    expect(autres().getAttribute('aria-label')).toBe('Autres façons d’intégrer origin/main')
  })
})

describe('textes hors composant — langue', () => {
  it('« il y a » et la cadence vidéo suivent la langue', () => {
    const maintenant = Date.parse('2026-09-25T10:00:00Z')
    expect(depuis('2026-09-25T09:59:40Z', maintenant)).toBe('à l’instant')
    expect(libelleCadence(30000 / 1001)).toBe('29,97')
    appliquerLangue('en')
    expect(depuis('2026-09-25T09:59:40Z', maintenant)).toBe('just now')
    expect(depuis('2026-09-25T08:00:00Z', maintenant)).toBe('2 hr. ago')
    expect(libelleCadence(30000 / 1001)).toBe('29.97')
  })

  it('les voies de mise à jour gardent le français de update-contract mot pour mot', () => {
    // La table reprend ces libellés pour les traduire : une retouche d'un seul côté se verrait ici.
    expect(TEXTES_FR['maj.voie.fast-forward']).toBe(UPDATE_STRATEGY_LABELS['fast-forward'])
    expect(TEXTES_FR['maj.voie.merge']).toBe(UPDATE_STRATEGY_LABELS.merge)
    expect(TEXTES_FR['maj.voie.rebase']).toBe(UPDATE_STRATEGY_LABELS.rebase)
    expect(TEXTES_FR['maj.voie.switch-main']).toBe(UPDATE_STRATEGY_LABELS['switch-main'])
    expect(TEXTES_FR['maj.aide.fast-forward']).toBe(UPDATE_STRATEGY_HINTS['fast-forward'])
    expect(TEXTES_FR['maj.aide.merge']).toBe(UPDATE_STRATEGY_HINTS.merge)
    expect(TEXTES_FR['maj.aide.rebase']).toBe(UPDATE_STRATEGY_HINTS.rebase)
    expect(TEXTES_FR['maj.aide.switch-main']).toBe(UPDATE_STRATEGY_HINTS['switch-main'])
  })
})
