// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('./Markdown', () => ({
  Markdown: ({ text }: { text: string }) => createElement('span', null, text),
  extractRecommendation: (): string | null => null
}))

const { chatApi, conversation, installRafShim, mountChat } = await import('./ChatView.harness')
type Harness = Awaited<ReturnType<typeof mountChat>>

const styles = readFileSync('src/renderer/src/components/ChatView.css', 'utf8')

/**
 * DÉFAUT VÉCU (conv-118, 2026-10-06) : « l'icône est trop haut dans 90 % des cas quand je la
 * regarde avec Ctrl+molette ». Le ∞ était un CARACTÈRE de police, recentré par un
 * `translateY(-2px)` réglé à l'œil au zoom 100 %. Or la police place ce caractère à une hauteur
 * qui SAUTE avec le zoom (2,2 px trop bas à 100 %, ~1,3 px à 150-300 %) : aucun décalage fixe ne
 * tient. Mesuré dans Electron sur les 26 crans du zoom de l'app (50-300 %) : trop haut sur 21/26
 * avec le décalage ; un tracé SVG centré par la géométrie reste à ±0,6 px sur 26/26.
 */
describe('rond du mode auto — le ∞ est un tracé centré, pas un caractère décalé à la main', () => {
  beforeAll(installRafShim)
  let h: Harness | null = null
  afterEach(async () => {
    await h?.unmount()
    h = null
    window.localStorage.clear()
    vi.restoreAllMocks()
  })

  it('le bouton dessine un SVG, sans caractère ∞ dans le texte', async () => {
    h = await mountChat(
      chatApi({
        conversations: vi.fn().mockResolvedValue([conversation('A', [])]),
        conversation: vi.fn(async (id: string) => conversation(id, []))
      })
    )
    const bouton = document.querySelector('[data-testid="composer-auto-toggle"]')
    expect(bouton).not.toBeNull()
    expect(bouton?.querySelector('svg path')).not.toBeNull()
    expect(bouton?.textContent ?? '').not.toContain('∞')
  })

  it('aucun décalage vertical réglé à la main sur le contenu du rond', () => {
    const regles = [...styles.matchAll(/\.composer-auto\s*>\s*[^{]*\{([^}]*)\}/g)].map((m) => m[1])
    expect(regles.length).toBeGreaterThan(0)
    for (const corps of regles) expect(corps).not.toMatch(/translateY|translate\(/)
  })
})
