// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ExecutionWorkspaceSettings } from './ExecutionWorkspaceSettings'
import { BrainSettings } from './BrainSettings'
import { appliquerLangue } from '../langue'
import type { BrainReglageState } from '../../../shared/preload-contracts'
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

/**
 * LES DEUX AUTRES PANNEAUX DE LA PAGE DIAGNOSTIC SUIVENT LA LANGUE (conv-1146, objection du juge,
 * réparation 3) : la page était annoncée traduite alors que « Dossier de travail » et « Brain »
 * restaient en français. Entrée qui doit faire échouer ce test : un libellé, un placeholder, un
 * aria-label ou un message d'erreur local laissé en dur, ou un panneau qui ne se redessine pas quand
 * la langue change. Chaque état est monté avec TOUTES ses branches visibles.
 */
const mounted: Array<{ root: ReturnType<typeof createRoot>; container: HTMLDivElement }> = []
afterEach(async () => {
  for (const item of mounted.splice(0)) {
    await act(async () => item.root.unmount())
    item.container.remove()
  }
  act(() => appliquerLangue('fr'))
})

async function monter(
  composant: () => React.JSX.Element,
  api: Record<string, unknown>
): Promise<HTMLDivElement> {
  Object.defineProperty(window, 'api', { configurable: true, value: api })
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  mounted.push({ root, container })
  await act(async () => root.render(createElement(composant)))
  await act(async () => undefined)
  return container
}

/** Tout ce que l'utilisateur lit ou entend : texte, aria-label, placeholder. */
function toutLeTexte(c: HTMLElement): string {
  const attributs = [...c.querySelectorAll('[aria-label], [placeholder]')].flatMap((el) => [
    el.getAttribute('aria-label') ?? '',
    el.getAttribute('placeholder') ?? ''
  ])
  return [c.textContent ?? '', ...attributs].join(' | ')
}

/** Des mots qui ne s'écrivent qu'en français : un seul suffit à prouver un reste non traduit. */
const MOTS_FRANCAIS =
  /\b(?:Dossier|dossier|Changer|Actif|Choisi|Revenir|Redémarre|dépôt|Dépôt|Enregistrer|Enregistrement|Choisir|lit|dépose|commande|tant qu|Arrête|Impossible|Réessaie|vide)\b/u

const workspace = {
  path: 'D:/AutoWinOS',
  chosen: 'D:/Autre',
  isGitRepo: false,
  restartRequired: true
}

const brain = (partiel: Partial<BrainReglageState> = {}): BrainReglageState => ({
  actif: 'D:\\Brain-actif',
  effectif: 'D:\\Brain-choisi',
  choisi: { chemin: 'D:\\Brain-choisi' },
  estUnDepot: false,
  redemarrageNecessaire: true,
  serveurRacine: 'C:\\ancien',
  serveurSurUnAutreDossier: true,
  ...partiel
})

describe('Diagnostic · panneaux Dossier de travail et Brain en anglais (conv-1146)', () => {
  it('Dossier de travail : toutes ses branches passent en anglais', async () => {
    act(() => appliquerLangue('en'))
    const c = await monter(ExecutionWorkspaceSettings, {
      executionWorkspace: vi.fn().mockResolvedValue(workspace)
    })
    const texte = toutLeTexte(c)
    expect(texte).toContain('Working folder')
    expect(texte).toContain('Change folder')
    expect(texte).toContain('Back to automatic detection')
    expect(texte).toContain('Restart Autowin')
    expect(texte).toContain('D:/AutoWinOS')
    expect(texte).not.toMatch(MOTS_FRANCAIS)
  })

  it('Dossier de travail : ses erreurs locales passent en anglais', async () => {
    act(() => appliquerLangue('en'))
    const c = await monter(ExecutionWorkspaceSettings, {
      executionWorkspace: vi.fn().mockRejectedValue(new Error('x'))
    })
    expect(c.querySelector('[role="alert"]')?.textContent).toBe(
      'Could not read the working folder.'
    )
  })

  it('Brain : toutes ses branches passent en anglais, simple dossier ou dépôt', async () => {
    act(() => appliquerLangue('en'))
    for (const estUnDepot of [false, true]) {
      const c = await monter(BrainSettings, {
        brainReglage: vi.fn().mockResolvedValue(brain({ estUnDepot }))
      })
      const texte = toutLeTexte(c)
      expect(texte).toContain('Brain folder')
      expect(texte).toContain(estUnDepot ? 'git repository' : 'plain folder, no git command')
      expect(texte).toContain('Back to automatic detection')
      expect(texte).toContain('Restart Autowin')
      expect(texte).toContain('C:\\ancien')
      expect(texte).not.toMatch(MOTS_FRANCAIS)
    }
  })

  it('Brain : son erreur locale passe en anglais ; celle du moteur est rendue telle quelle', async () => {
    act(() => appliquerLangue('en'))
    const c = await monter(BrainSettings, {
      brainReglage: vi.fn().mockRejectedValue(new Error('x'))
    })
    expect(c.querySelector('[data-testid="brain-reglage-erreur"]')?.textContent).toBe(
      'Could not read the Brain setting.'
    )
    const d = await monter(BrainSettings, {
      brainReglage: vi.fn().mockResolvedValue(brain({ erreur: 'Dossier introuvable : D:\\x' }))
    })
    expect(d.querySelector('[data-testid="brain-reglage-erreur"]')?.textContent).toBe(
      'Dossier introuvable : D:\\x'
    )
  })

  it('changer de langue redessine les deux panneaux, sans les remonter', async () => {
    const ew = await monter(ExecutionWorkspaceSettings, {
      executionWorkspace: vi.fn().mockResolvedValue(workspace)
    })
    const br = await monter(BrainSettings, {
      brainReglage: vi.fn().mockResolvedValue(brain())
    })
    expect(ew.textContent).toContain('Dossier de travail')
    expect(br.textContent).toContain('Dossier du Brain')
    act(() => appliquerLangue('en'))
    expect(ew.textContent).toContain('Working folder')
    expect(br.textContent).toContain('Brain folder')
    act(() => appliquerLangue('fr'))
    expect(ew.textContent).toContain('Dossier de travail')
    expect(br.textContent).toContain('Dossier du Brain')
  })
})
