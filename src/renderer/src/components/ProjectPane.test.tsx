// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProjectPane } from './ProjectPane'

const listProjectDir = vi.fn()
const readProjectFile = vi.fn()
const writeProjectFile = vi.fn()

let host: HTMLDivElement
let root: Root

function q<T extends Element>(testid: string): T {
  const el = host.querySelector(`[data-testid="${testid}"]`)
  if (!el) throw new Error(`introuvable : ${testid}`)
  return el as unknown as T
}

async function clic(testid: string): Promise<void> {
  await act(async () => {
    q<HTMLElement>(testid).dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

/** Saisie dans un textarea contrôlé par React (le setter natif, sinon React ignore la valeur). */
async function saisir(testid: string, valeur: string): Promise<void> {
  const zone = q<HTMLTextAreaElement>(testid)
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set
  await act(async () => {
    setter?.call(zone, valeur)
    zone.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

beforeEach(() => {
  listProjectDir.mockReset()
  readProjectFile.mockReset()
  writeProjectFile.mockReset()
  ;(window as unknown as { api: unknown }).api = {
    listProjectDir,
    readProjectFile,
    writeProjectFile
  }
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div')
  document.body.appendChild(host)
})

afterEach(() => {
  act(() => root?.unmount())
  host.remove()
})

async function monter(): Promise<void> {
  await act(async () => {
    root = createRoot(host)
    root.render(<ProjectPane />)
  })
}

describe('ProjectPane', () => {
  /**
   * CHANGER DE CWD CHANGE LE CONTENU. Demande du 2026-09-24 : l'onglet lisait toujours le dossier
   * global et ne se rechargeait jamais. Il transmet la conversation (le principal en deduit le CWD)
   * et relit la racine quand ce CWD change.
   */
  it('relit l’arbre de la conversation quand son CWD change', async () => {
    listProjectDir.mockImplementation(async () => ({
      ok: true,
      path: '',
      entries: [{ name: 'x.ts', path: 'x.ts', kind: 'file' }]
    }))
    await act(async () => {
      root = createRoot(host)
      root.render(<ProjectPane conversationId="conv-1" racine="D:/A" />)
    })
    expect(listProjectDir).toHaveBeenLastCalledWith('', 'conv-1')
    const avant = listProjectDir.mock.calls.length
    await act(async () => {
      root.render(<ProjectPane conversationId="conv-1" racine="D:/B" />)
    })
    expect(listProjectDir.mock.calls.length).toBe(avant + 1)
    expect(listProjectDir).toHaveBeenLastCalledWith('', 'conv-1')
  })


  /**
   * EDITEUR DANS L'ARBRE, ET CROIX POUR LE FERMER. Demande de l'utilisateur du 2026-09-12 :
   * l'editeur ne doit plus etre un bloc fixe sous l'arbre mais s'inserer JUSTE SOUS la ligne du
   * fichier ouvert, et se refermer par une croix. Les deux points sont verifies par la POSITION
   * reelle dans le DOM (frere immediat du noeud), pas par une simple presence.
   */
  it('insere l’editeur juste sous le noeud ouvert, et la croix le referme', async () => {
    listProjectDir.mockResolvedValue({
      ok: true,
      path: '',
      entries: [
        { name: 'a.ts', path: 'a.ts', kind: 'file' },
        { name: 'b.ts', path: 'b.ts', kind: 'file' }
      ]
    })
    readProjectFile.mockResolvedValue({ ok: true, path: 'a.ts', content: 'const a = 1' })
    await monter()
    expect(host.querySelector('[data-testid="pp-editeur"]')).toBeNull()

    await clic('pp-noeud-a.ts')
    const editeur = q<HTMLElement>('pp-editeur')
    // Frere IMMEDIAT du noeud clique : c'est ce qui prouve « juste sous l'element selectionne ».
    expect(q<HTMLElement>('pp-noeud-a.ts').nextElementSibling).toBe(editeur)
    // Et il est bien DANS l'arbre, pas dans un bloc a part sous celui-ci.
    expect(host.querySelector('[role="tree"]')?.contains(editeur)).toBe(true)

    await clic('pp-fermer')
    expect(host.querySelector('[data-testid="pp-editeur"]')).toBeNull()
    expect(host.querySelector('[data-testid="pp-zone"]')).toBeNull()
  })

  it('déplie un dossier et ouvre un fichier dans l’éditeur', async () => {
    listProjectDir.mockImplementation(async (path: string) =>
      path === ''
        ? { ok: true, path: '', entries: [{ name: 'src', path: 'src', kind: 'dir' }] }
        : { ok: true, path: 'src', entries: [{ name: 'a.ts', path: 'src/a.ts', kind: 'file' }] }
    )
    readProjectFile.mockResolvedValue({ ok: true, path: 'src/a.ts', content: 'const a = 1' })
    await monter()

    await clic('pp-noeud-src')
    await clic('pp-noeud-src/a.ts')

    expect(q<HTMLTextAreaElement>('pp-zone').value).toBe('const a = 1')
    expect(q<HTMLButtonElement>('pp-enregistrer').disabled).toBe(true)
  })

  it('enregistre le fichier modifié par le canal d’écriture', async () => {
    listProjectDir.mockResolvedValue({
      ok: true,
      path: '',
      entries: [{ name: 'a.ts', path: 'a.ts', kind: 'file' }]
    })
    readProjectFile.mockResolvedValue({ ok: true, path: 'a.ts', content: 'x' })
    writeProjectFile.mockResolvedValue({ ok: true, path: 'a.ts' })
    await monter()

    await clic('pp-noeud-a.ts')
    await saisir('pp-zone', 'y')
    expect(q<HTMLButtonElement>('pp-enregistrer').disabled).toBe(false)
    await clic('pp-enregistrer')

    expect(writeProjectFile).toHaveBeenCalledWith('a.ts', 'y', undefined)
    expect(host.textContent).toContain('Enregistré')
  })

  it('affiche le refus du canal au lieu de prétendre avoir enregistré', async () => {
    listProjectDir.mockResolvedValue({
      ok: true,
      path: '',
      entries: [{ name: 'a.ts', path: 'a.ts', kind: 'file' }]
    })
    readProjectFile.mockResolvedValue({ ok: true, path: 'a.ts', content: 'x' })
    writeProjectFile.mockResolvedValue({ ok: false, reason: 'hors-racine' })
    await monter()

    await clic('pp-noeud-a.ts')
    await saisir('pp-zone', 'y')
    await clic('pp-enregistrer')

    expect(host.querySelector('[role="alert"]')?.textContent).toBe('Écriture refusée : hors-racine')
    expect(host.textContent).not.toContain('Enregistré')
  })
})
