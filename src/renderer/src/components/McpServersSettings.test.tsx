// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { McpServersSettings } from './McpServersSettings'

;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const monte: Array<{ root: ReturnType<typeof createRoot>; el: HTMLDivElement }> = []
afterEach(async () => {
  for (const m of monte.splice(0)) {
    await act(async () => m.root.unmount())
    m.el.remove()
  }
})

const blender = {
  id: 'blender',
  nom: 'Blender',
  commande: 'uvx',
  args: ['blender-mcp'],
  env: {},
  actif: false
}

async function monter(api: Record<string, unknown>): Promise<HTMLDivElement> {
  ;(window as unknown as { api: unknown }).api = api
  const el = document.createElement('div')
  document.body.appendChild(el)
  const root = createRoot(el)
  monte.push({ root, el })
  await act(async () => root.render(createElement(McpServersSettings)))
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0))
  })
  return el
}

const q = (el: HTMLElement, id: string): HTMLElement =>
  el.querySelector(`[data-testid="${id}"]`) as HTMLElement

async function saisir(champ: HTMLElement, valeur: string): Promise<void> {
  const proto = Object.getPrototypeOf(champ)
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(champ, valeur)
  await act(async () => champ.dispatchEvent(new Event('input', { bubbles: true })))
}

async function cliquer(b: HTMLElement): Promise<void> {
  await act(async () => {
    b.click()
    await new Promise((r) => setTimeout(r, 0))
  })
}

describe('McpServersSettings', () => {
  it('liste les serveurs avec leur état, bascule et supprime par l’IPC', async () => {
    const mcpServersToggle = vi
      .fn()
      .mockResolvedValue({ ok: true, serveurs: [{ ...blender, actif: true }] })
    const mcpServersDelete = vi.fn().mockResolvedValue({ ok: true, serveurs: [] })
    const el = await monter({
      mcpServersList: vi.fn().mockResolvedValue({ ok: true, serveurs: [blender] }),
      mcpServersToggle,
      mcpServersDelete
    })
    expect(q(el, 'mcp-etat-blender').textContent).toMatch(/Inacti/)
    await cliquer(q(el, 'mcp-basculer-blender'))
    expect(mcpServersToggle).toHaveBeenCalledWith('blender', true)
    expect(q(el, 'mcp-etat-blender').textContent).toMatch(/^Acti/)
    await cliquer(q(el, 'mcp-supprimer-blender'))
    expect(mcpServersDelete).toHaveBeenCalledWith('blender')
    expect(q(el, 'mcp-vide')).not.toBeNull()
  })

  it('ajoute un serveur : arguments un par ligne, variables NOM=valeur', async () => {
    const mcpServersSave = vi.fn().mockImplementation(async (s) => ({ ok: true, serveurs: [s] }))
    const el = await monter({
      mcpServersList: vi.fn().mockResolvedValue({ ok: true, serveurs: [] }),
      mcpServersSave
    })
    await saisir(q(el, 'mcp-champ-id'), 'fs')
    await saisir(q(el, 'mcp-champ-commande'), 'npx')
    await saisir(q(el, 'mcp-champ-args'), '-y\n@mcp/fs\n')
    await saisir(q(el, 'mcp-champ-env'), 'RACINE=D:\\x=y')
    await cliquer(q(el, 'mcp-ajouter'))
    expect(mcpServersSave).toHaveBeenCalledWith({
      id: 'fs',
      nom: 'fs',
      commande: 'npx',
      args: ['-y', '@mcp/fs'],
      env: { RACINE: 'D:\\x=y' },
      actif: true
    })
    expect(q(el, 'mcp-serveur-fs')).not.toBeNull()
    expect((q(el, 'mcp-champ-id') as HTMLInputElement).value).toBe('')
  })

  // Entrée qui ferait échouer ce test si le contrôle était absent : « SANSEGAL » (pas de « = »).
  it('refuse une variable mal formée sans appeler l’IPC', async () => {
    const mcpServersSave = vi.fn()
    const el = await monter({
      mcpServersList: vi.fn().mockResolvedValue({ ok: true, serveurs: [] }),
      mcpServersSave
    })
    await saisir(q(el, 'mcp-champ-id'), 'fs')
    await saisir(q(el, 'mcp-champ-commande'), 'npx')
    await saisir(q(el, 'mcp-champ-env'), 'SANSEGAL')
    await cliquer(q(el, 'mcp-ajouter'))
    expect(mcpServersSave).not.toHaveBeenCalled()
    expect(q(el, 'mcp-erreur').textContent).toContain('SANSEGAL')
  })

  it('affiche le refus du registre (id réservé)', async () => {
    const el = await monter({
      mcpServersList: vi.fn().mockResolvedValue({ ok: true, serveurs: [] }),
      mcpServersSave: vi.fn().mockResolvedValue({ ok: false, erreur: 'id réservé « autowin »' })
    })
    await saisir(q(el, 'mcp-champ-id'), 'autowin')
    await saisir(q(el, 'mcp-champ-commande'), 'x')
    await cliquer(q(el, 'mcp-ajouter'))
    expect(q(el, 'mcp-erreur').textContent).toContain('autowin')
    expect((q(el, 'mcp-champ-id') as HTMLInputElement).value).toBe('autowin')
  })

  it('carte Blender : aide « Connect », ajout quand absent, grisée quand présent', async () => {
    const mcpServersSave = vi.fn().mockResolvedValue({ ok: true, serveurs: [blender] })
    const el = await monter({
      mcpServersList: vi.fn().mockResolvedValue({ ok: true, serveurs: [] }),
      mcpServersSave
    })
    expect(q(el, 'mcp-blender-aide').textContent).toMatch(/add-on.*Connect/s)
    const b = q(el, 'mcp-blender-ajouter') as HTMLButtonElement
    expect(b.disabled).toBe(false)
    await cliquer(b)
    expect(mcpServersSave).toHaveBeenCalledWith(blender)
    expect((q(el, 'mcp-blender-ajouter') as HTMLButtonElement).disabled).toBe(true)
  })

  it('IPC absente ou en échec : message, pas de plantage', async () => {
    const el = await monter({})
    expect(q(el, 'mcp-erreur')).not.toBeNull()
  })
})
