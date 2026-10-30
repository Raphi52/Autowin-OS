/*
 * LA PAGE DES SCENES 3D (`scene-3d.html`) : sa politique de securite est la frontiere qui isole le
 * code des blocs ```threejs (conv-299). Ce test relit la page CONSTRUITE, telle qu'elle sera servie.
 */
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import * as page from '../renderer/scene-3d/page-scene-3d.mjs'
import { NOM_PAGE_INTERACTIVE, NOM_PAGE_SCENE_3D } from './scene-3d'

// `<script>` sans type seulement : ceux que le navigateur EXECUTE.
const scriptsEnLigne = (html: string): string[] =>
  [...html.matchAll(/<script>([\s\S]*?)<\/script>/gu)].map((trouve) => trouve[1])

describe('page des scenes 3D', () => {
  it('porte le meme nom que celui du fil et du filtre de navigation', () => {
    expect(page.NOM_PAGE_SCENE_3D).toBe(NOM_PAGE_SCENE_3D)
    expect(page.NOM_PAGE_INTERACTIVE).toBe(NOM_PAGE_INTERACTIVE)
  })

  // conv-1304 : la jumelle sans moteur — meme amorce, meme politique, et pas un octet de three.js.
  it('construit la page interactive SANS le moteur, avec la meme amorce et la meme politique', async () => {
    const [avec, sans] = await Promise.all([
      page.construirePageScene3d(),
      page.construirePageScene3d({ avecMoteur: false })
    ])
    const politique = (html: string): string | undefined =>
      /http-equiv="Content-Security-Policy" content="([^"]+)"/u.exec(html)?.[1]
    expect(politique(sans)).toBe(politique(avec))
    expect(scriptsEnLigne(sans)).toEqual(scriptsEnLigne(avec))
    expect(sans).not.toContain(page.ID_MOTEUR_3D + '"')
    expect(sans).not.toContain('WebGLRenderer')
    expect(avec).toContain('WebGLRenderer')
    // Le gain : la page sans moteur pese moins d'un dixieme de l'autre.
    expect(sans.length * 10).toBeLessThan(avec.length)
  }, 30_000)

  it('ferme le reseau et n autorise QUE son amorce, par son empreinte', async () => {
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

    // Moteur a la demande (conv-1304) : un seul script execute, l'amorce. Le moteur est du TEXTE
    // que l'amorce evalue quand il sert ; il n'a pas besoin d'empreinte et n'en a pas.
    const scripts = scriptsEnLigne(html)
    expect(scripts).toHaveLength(1)
    const empreinte = `'sha256-${createHash('sha256').update(scripts[0], 'utf8').digest('base64')}'`
    expect(directives['script-src']).toBe(`${empreinte} 'unsafe-eval'`)
    const moteur = new RegExp(
      `<script type="text/plain" id="${page.ID_MOTEUR_3D}">([\\s\\S]*?)</script>`,
      'u'
    ).exec(html)?.[1]
    expect(moteur).toContain('OrbitControls')
    // Le moteur precede l'amorce : elle le lit avant que la page du modele n'existe.
    expect(html.indexOf(page.ID_MOTEUR_3D)).toBeLessThan(html.indexOf(scripts[0]))
    // L'amorce refuse de tourner hors d'un cadre isole et coupe WebRTC.
    expect(scripts[0]).toContain("self.origin !== 'null'")
    expect(scripts[0]).toContain('RTCPeerConnection')
    expect(scripts[0]).toContain(page.ID_MOTEUR_3D)
    expect(html).toContain('x-dns-prefetch-control')
  }, 30_000)
})
