// @vitest-environment happy-dom
/**
 * Balayage « croisement » des panneaux (conv-191, « go 6 ») : un seul reflet pour toute la page. Le script pose
 * la position visee des deux bandes sur les cinq panneaux ; le theme les peint, calees sur l ecran.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import postcss from 'postcss'
import { afterEach, describe, expect, it } from 'vitest'
import { ciblesDuBalai, installerBalaiDesPanneaux } from './panneaux-balai'

describe('ciblesDuBalai', () => {
  // Écran de 1000 × 600 : une bande à 135 deg qui passe par (x, y) coupe la mi-hauteur (300) à
  // l'abscisse x + y - 300, rendue en largeurs d'écran.
  it('fait passer la seconde bande sous le curseur et la premiere par le point oppose', () => {
    expect(ciblesDuBalai(100, 300, 1000, 600)).toEqual({ premiere: 0.9, seconde: 0.1 })
    expect(ciblesDuBalai(500, 300, 1000, 600)).toEqual({ premiere: 0.5, seconde: 0.5 })
  })
  it('tient compte de la hauteur du curseur, puisque les bandes sont en diagonale', () => {
    expect(ciblesDuBalai(500, 0, 1000, 600)).toEqual({ premiere: 0.8, seconde: 0.2 })
    expect(ciblesDuBalai(500, 600, 1000, 600)).toEqual({ premiere: 0.2, seconde: 0.8 })
  })
  it('borne le curseur a l’ecran et refuse une mesure inconnue', () => {
    expect(ciblesDuBalai(-50, -50, 1000, 600)).toEqual({ premiere: 1.3, seconde: -0.3 })
    expect(ciblesDuBalai(Number.NaN, 0, 1000, 600)).toBeNull()
    expect(ciblesDuBalai(10, 10, 0, 600)).toBeNull()
  })
})

describe('installerBalaiDesPanneaux', () => {
  let debrancher: (() => void) | null = null
  afterEach(() => {
    debrancher?.()
    debrancher = null
    document.body.innerHTML = ''
  })

  const monter = (): { panneaux: HTMLElement[]; texte: HTMLElement; ailleurs: HTMLElement } => {
    document.body.innerHTML = `
      <div class="cosmic-outline">
        <aside class="conv-pane"><span id="texte">fil</span></aside>
        <section class="chat"><div class="composer"><textarea></textarea></div></section>
      </div>
      <p id="ailleurs">hors panneau</p>`
    return {
      panneaux: [...document.querySelectorAll<HTMLElement>('.conv-pane, .chat, .composer')],
      texte: document.getElementById('texte')!,
      ailleurs: document.getElementById('ailleurs')!
    }
  }
  const bouger = (cible: Element, clientX: number, clientY: number): void => {
    cible.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX, clientY }))
  }
  const attendu = (x: number, y: number) =>
    ciblesDuBalai(x, y, window.innerWidth, window.innerHeight)!

  it('pose la meme position sur TOUS les panneaux, quel que soit celui sous la souris', () => {
    const { panneaux, texte } = monter()
    debrancher = installerBalaiDesPanneaux(window)
    bouger(texte, 150, 40)
    const { premiere, seconde } = attendu(150, 40)
    expect(panneaux).toHaveLength(3)
    for (const panneau of panneaux) {
      expect(panneau.style.getPropertyValue('--nv-balai-1'), panneau.className).toBe(
        String(premiere)
      )
      expect(panneau.style.getPropertyValue('--nv-balai-2'), panneau.className).toBe(
        String(seconde)
      )
    }
  })

  it('suit la souris partout, meme hors des panneaux', () => {
    const { panneaux, ailleurs } = monter()
    debrancher = installerBalaiDesPanneaux(window)
    bouger(ailleurs, 600, 500)
    for (const panneau of panneaux)
      expect(panneau.style.getPropertyValue('--nv-balai-2')).toBe(String(attendu(600, 500).seconde))
  })

  it('rend tous les panneaux a leur repos quand la souris quitte la fenetre', () => {
    const { panneaux, texte } = monter()
    debrancher = installerBalaiDesPanneaux(window)
    bouger(texte, 150, 40)
    document.documentElement.dispatchEvent(new MouseEvent('pointerleave'))
    for (const panneau of panneaux) {
      expect(panneau.style.getPropertyValue('--nv-balai-1')).toBe('')
      expect(panneau.style.getPropertyValue('--nv-balai-2')).toBe('')
    }
  })

  it('se debranche : plus aucune position posee ensuite', () => {
    const { panneaux, texte } = monter()
    installerBalaiDesPanneaux(window)()
    bouger(texte, 150, 40)
    expect(panneaux[0].style.getPropertyValue('--nv-balai-1')).toBe('')
  })
})

describe('theme Nebuleuse de verre : peinture du balayage', () => {
  // Chemin de fichier, pas `new URL` : sous happy-dom, `URL` est celle du navigateur simule, que
  // `readFileSync` refuse (« The URL must be of scheme file »).
  const css = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), 'assets/theme-nebuleuse-verre.css'),
    'utf8'
  )
  const racine = postcss.parse(css)
  const declarations = (selecteur: string, propriete: string): string[] => {
    const valeurs: string[] = []
    racine.walkRules((regle) => {
      if (regle.parent?.type === 'atrule') return
      if (!regle.selectors.some((s) => s.trim() === selecteur)) return
      regle.walkDecls(propriete, (d) => {
        valeurs.push(d.value)
      })
    })
    return valeurs
  }

  it('enregistre les deux positions en nombres non herites, au repos hors du panneau', () => {
    for (const nom of ['--nv-balai-1', '--nv-balai-2']) {
      const regle = racine.nodes.find(
        (n) => n.type === 'atrule' && n.name === 'property' && n.params === nom
      ) as postcss.AtRule
      expect(regle, nom).toBeTruthy()
      const decls = Object.fromEntries(
        (regle.nodes as postcss.Declaration[]).map((d) => [d.prop, d.value])
      )
      expect(decls).toEqual({ syntax: "'<number>'", inherits: 'false', 'initial-value': '-0.45' })
    }
  })

  it('peint les deux bandes sur les cinq panneaux, chacun avec son glissement', () => {
    const panneaux = [
      ":root[data-theme='nebuleuse-verre'] .cosmic-outline :is(.conv-pane, .runs-pane)",
      ":root[data-theme='nebuleuse-verre'] .cosmic-outline .chat::after",
      ":root[data-theme='nebuleuse-verre'] .theme-serious .rail",
      ":root[data-theme='nebuleuse-verre'] .cosmic-outline .chat > .composer"
    ]
    for (const selecteur of panneaux) {
      const fonds = declarations(selecteur, 'background').filter((v) =>
        v.includes('--nv-balai-bande')
      )
      expect(fonds, selecteur).toHaveLength(1)
      expect(fonds[0]).toContain('calc((1.5 - var(--nv-balai-1)) * 50%)')
      expect(fonds[0]).toContain('calc((1.5 - var(--nv-balai-2)) * 50%)')
      expect(
        declarations(selecteur, 'transition').some((v) => v.includes('var(--nv-balai-transition)')),
        selecteur
      ).toBe(true)
    }
  })

  it('montre UN satin pour toute la page : chaque panneau le cale sur l’ecran, apres ses bandes', () => {
    // conv-191 : « il faut un satin qui fait toute la page mais qui est visible que sur les cards ».
    const panneaux = [
      ":root[data-theme='nebuleuse-verre'] .cosmic-outline :is(.conv-pane, .runs-pane)",
      ":root[data-theme='nebuleuse-verre'] .cosmic-outline .chat::after",
      ":root[data-theme='nebuleuse-verre'] .theme-serious .rail",
      ":root[data-theme='nebuleuse-verre'] .cosmic-outline .chat > .composer"
    ]
    for (const selecteur of panneaux) {
      const fond = declarations(selecteur, 'background').find((v) =>
        v.includes('--nv-balai-bande')
      )!
      expect(fond, selecteur).toMatch(/var\(--nv-satin\) fixed(\s+padding-box)?(,|$)/)
      expect(fond.indexOf('--nv-balai-bande-2'), selecteur).toBeLessThan(
        fond.indexOf('var(--nv-satin)')
      )
      // « un seul reflet pour toute la page » : les deux bandes aussi sont calees sur l'ecran.
      for (const n of [1, 2])
        expect(fond, `${selecteur} bande ${n}`).toMatch(
          new RegExp(
            `var\\(--nv-balai-bande-${n}\\) calc\\(\\(1\\.5 - var\\(--nv-balai-${n}\\)\\) \\* 50%\\) 50% / 300% 300% no-repeat fixed`
          )
        )
    }
  })

  it('laisse le menu se replier : sa transition reprend largeur et marges', () => {
    const transitions = declarations(
      ":root[data-theme='nebuleuse-verre'] .theme-serious .rail",
      'transition'
    ).filter((v) => v.includes('--nv-balai'))
    expect(transitions[0]).toMatch(/width 180ms var\(--ease\)/)
    expect(transitions[0]).toMatch(/padding 180ms var\(--ease\)/)
  })

  it('fait reprendre au panneau peint du fil les positions posees sur le fil', () => {
    const selecteur = ":root[data-theme='nebuleuse-verre'] .cosmic-outline .chat::after"
    expect(declarations(selecteur, '--nv-balai-1')).toEqual(['inherit'])
    expect(declarations(selecteur, '--nv-balai-2')).toEqual(['inherit'])
  })

  it('reste gris : aucune teinte dans les bandes', () => {
    const bandes = declarations(":root[data-theme='nebuleuse-verre']", '--nv-balai-bande-1').concat(
      declarations(":root[data-theme='nebuleuse-verre']", '--nv-balai-bande-2')
    )
    expect(bandes.length).toBeGreaterThanOrEqual(2)
    for (const bande of bandes)
      for (const m of bande.matchAll(/rgba\((\d+), (\d+), (\d+)/g))
        expect(new Set([m[1], m[2], m[3]]).size).toBe(1)
  })

  it('s’efface quand Windows reduit les animations, sans casser le repli du menu', () => {
    let regle: postcss.Rule | undefined
    racine.walkAtRules('media', (media) => {
      if (!/prefers-reduced-motion:\s*reduce/.test(media.params)) return
      media.walkRules((r) => {
        if (
          r.selector.trim() === ":root[data-theme='nebuleuse-verre']" &&
          r.some((n) => n.type === 'decl' && n.prop === '--nv-balai-transition')
        )
          regle = r
      })
    })
    expect(regle).toBeTruthy()
    const decls = Object.fromEntries(
      (regle!.nodes as postcss.Declaration[]).map((d) => [d.prop, d.value])
    )
    expect(decls['--nv-balai-bande-1']).toBe('linear-gradient(transparent, transparent)')
    expect(decls['--nv-balai-bande-2']).toBe('linear-gradient(transparent, transparent)')
    expect(decls['--nv-balai-transition']).toBe('--nv-balai-1 0s, --nv-balai-2 0s')
  })
})
