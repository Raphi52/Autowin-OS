// @vitest-environment happy-dom
/**
 * LE RUN.md D'UN COLLÈGUE DANS SA CARTE. ENTRÉES QUI DOIVENT FAIRE ÉCHOUER : une lecture
 * avec le préfixe du poste resté dans le nom ; un contenu non montré ; une fiche absente sans message.
 */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { RunMdDuCollegue } from './RiviereDuProjet'

describe('RunMdDuCollegue', () => {
  beforeAll(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  })

  const monter = async (lire: (p: string, f: string) => Promise<string | null>) => {
    const el = document.createElement('div')
    document.body.append(el)
    const root = createRoot(el)
    await act(async () =>
      root.render(
        createElement(RunMdDuCollegue, { poste: 'dudzik', fiche: 'dudzik/conv-7/slug/RUN.md', lire })
      )
    )
    await act(async () => el.querySelector('button')?.click())
    return el
  }

  it('lit la fiche sans le préfixe du poste et en montre le corps', async () => {
    const lire = vi.fn(async () => 'status: prouve\nsession: conv-7\n\n## Besoin\nfaire X')
    const el = await monter(lire)
    expect(lire).toHaveBeenCalledWith('dudzik', 'conv-7/slug/RUN.md')
    const texte = el.querySelector('[data-testid="riviere-fiche-runmd-texte"]')?.textContent
    expect(texte).toContain('## Besoin')
    expect(texte).not.toContain('status:')
  })

  it('une fiche pas encore recopiée le dit', async () => {
    const el = await monter(async () => null)
    expect(el.querySelector('[data-testid="riviere-fiche-runmd-absent"]')).not.toBeNull()
  })
})
