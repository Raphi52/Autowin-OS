/*
 * LA PAGE DES SCENES 3D (`scene-3d.html`) : sa politique de securite est la frontiere qui isole le
 * code des blocs ```threejs (conv-299). Ce test relit la page CONSTRUITE, telle qu'elle sera servie.
 */
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import * as page from '../renderer/scene-3d/page-scene-3d.mjs'
import { NOM_PAGE_SCENE_3D } from './scene-3d'

const scriptsEnLigne = (html: string): string[] =>
  [...html.matchAll(/<script>([\s\S]*?)<\/script>/gu)].map((trouve) => trouve[1])

describe('page des scenes 3D', () => {
  it('porte le meme nom que celui du fil et du filtre de navigation', () => {
    expect(page.NOM_PAGE_SCENE_3D).toBe(NOM_PAGE_SCENE_3D)
  })

  it('ferme le reseau et n autorise QUE ses deux scripts, par leur empreinte', async () => {
    const html = await page.construirePageScene3d()
    const politique =
      /http-equiv="Content-Security-Policy" content="([^"]+)"/u.exec(html)?.[1] ?? ''
    const directives = Object.fromEntries(
      politique.split(';').map((directive) => {
        const [nom, ...valeurs] = directive.trim().split(/\s+/u)
        return [nom, valeurs.join(' ')]
      })
    )
    expect(directives['default-src']).toBe("'none'")
    expect(directives['connect-src']).toBe("'none'")
    expect(directives['frame-src']).toBe("'none'")
    expect(directives['child-src']).toBe("'none'")
    expect(directives['worker-src']).toBe("'none'")
    expect(directives['img-src']).toBe('data: blob:')
    // Pas de script en ligne libre : c'est ce qui empeche un cadre `srcdoc` imbrique, un
    // `<script>` injecte ou un `onerror` de s'executer (mesure du 2026-10-16).
    expect(directives['script-src']).not.toContain('unsafe-inline')
    expect(directives['script-src']).not.toMatch(/https?:|data:|blob:|\*/u)

    const scripts = scriptsEnLigne(html)
    expect(scripts).toHaveLength(2)
    for (const script of scripts) {
      const empreinte = `'sha256-${createHash('sha256').update(script, 'utf8').digest('base64')}'`
      expect(directives['script-src']).toContain(empreinte)
    }
    expect(scripts[0]).toContain('OrbitControls')
    // L'amorce refuse de tourner hors d'un cadre isole et coupe WebRTC.
    expect(scripts[1]).toContain("self.origin !== 'null'")
    expect(scripts[1]).toContain('RTCPeerConnection')
    expect(html).toContain('x-dns-prefetch-control')
  }, 30_000)
})
