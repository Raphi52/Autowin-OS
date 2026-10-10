// @vitest-environment happy-dom
/**
 * La souris est la source de lumière des panneaux (conv-191, « go Ambiance implémente ») : le script
 * pose la position du curseur sur les cinq panneaux ; le thème Nébuleuse de verre peint une seule
 * lumière pour la page, calée sur l'écran, qui ne se voit qu'à travers les panneaux.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import postcss from 'postcss'
import { afterEach, describe, expect, it } from 'vitest'
import { installerLumiereDesPanneaux, positionDeLaLumiere } from './panneaux-lumiere'

describe('positionDeLaLumiere', () => {
  it('donne la position du curseur en fractions de l’ecran', () => {
    expect(positionDeLaLumiere(250, 150, 1000, 600)).toEqual({ x: 0.25, y: 0.25 })
    expect(positionDeLaLumiere(1000, 0, 1000, 600)).toEqual({ x: 1, y: 0 })
  })
  it('borne le curseur a l’ecran et refuse une mesure inconnue', () => {
    expect(positionDeLaLumiere(-50, 900, 1000, 600)).toEqual({ x: 0, y: 1 })
    expect(positionDeLaLumiere(Number.NaN, 0, 1000, 600)).toBeNull()
    expect(positionDeLaLumiere(10, 10, 0, 600)).toBeNull()
  })
})

describe('installerLumiereDesPanneaux', () => {
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
      <section class="view-page task-manager-view"><h1>Task Manager</h1></section>
      <div class="home-tile"><div class="home-tile__panel">tuile</div></div>
      <p id="ailleurs">hors panneau</p>`
    return {
      panneaux: [...document.querySelectorAll<HTMLElement>('.conv-pane, .chat, .composer, .view-page, .home-tile__panel')],
      texte: document.getElementById('texte')!,
      ailleurs: document.getElementById('ailleurs')!
    }
  }
  const bouger = (cible: Element, clientX: number, clientY: number): void => {
    cible.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX, clientY }))
  }
  const attendu = (x: number, y: number): { x: number; y: number } =>
    positionDeLaLumiere(x, y, window.innerWidth, window.innerHeight)!

  it('pose la meme position sur TOUS les panneaux, quel que soit celui sous la souris', () => {
    const { panneaux, texte } = monter()
    debrancher = installerLumiereDesPanneaux(window)
    bouger(texte, 150, 40)
    // Les panneaux du Chat, le cadre de page des autres vues et les tuiles de l'Accueil (conv-211).
    expect(panneaux).toHaveLength(5)
    for (const panneau of panneaux) {
      expect(panneau.style.getPropertyValue('--nv-lumiere-x'), panneau.className).toBe(
        String(attendu(150, 40).x)
      )
      expect(panneau.style.getPropertyValue('--nv-lumiere-y'), panneau.className).toBe(
        String(attendu(150, 40).y)
      )
    }
  })

  it('suit la souris partout, meme hors des panneaux', () => {
    const { panneaux, ailleurs } = monter()
    debrancher = installerLumiereDesPanneaux(window)
    bouger(ailleurs, 600, 500)
    for (const panneau of panneaux)
      expect(panneau.style.getPropertyValue('--nv-lumiere-x')).toBe(String(attendu(600, 500).x))
  })

  it('eteint la lumiere de tous les panneaux quand la souris quitte la fenetre', () => {
    const { panneaux, texte } = monter()
    debrancher = installerLumiereDesPanneaux(window)
    bouger(texte, 150, 40)
    document.documentElement.dispatchEvent(new MouseEvent('pointerleave'))
    for (const panneau of panneaux) {
      expect(panneau.style.getPropertyValue('--nv-lumiere-x')).toBe('')
      expect(panneau.style.getPropertyValue('--nv-lumiere-y')).toBe('')
    }
  })

  it('se debranche : plus aucune position posee ensuite', () => {
    const { panneaux, texte } = monter()
    installerLumiereDesPanneaux(window)()
    bouger(texte, 150, 40)
    expect(panneaux[0].style.getPropertyValue('--nv-lumiere-x')).toBe('')
  })
})

describe('theme Nebuleuse de verre : la lumiere de la souris', () => {
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
  const PANNEAUX = [
    ":root[data-theme='nebuleuse-verre'] .cosmic-outline :is(.conv-pane, .runs-pane)",
    ":root[data-theme='nebuleuse-verre'] .cosmic-outline .chat::after",
    ":root[data-theme='nebuleuse-verre'] .theme-serious .rail",
    ":root[data-theme='nebuleuse-verre'] .cosmic-outline .chat > .composer",
    // Le cadre de page des autres vues et les panneaux de l'Accueil, alignes sur le Chat (conv-211).
    ":root[data-theme='nebuleuse-verre'] .view-page",
    ":root[data-theme='nebuleuse-verre'] :is(.home-tile__panel, .home-view__masthead)"
  ]
  const fondAvecLumiere = (selecteur: string): string =>
    declarations(selecteur, 'background').find((v) => v.includes('--nv-lumiere-x'))!

  it('enregistre la position en nombres non herites, au repos hors de l’ecran a gauche', () => {
    const attendus = { '--nv-lumiere-x': '-0.6', '--nv-lumiere-y': '0.5' }
    for (const [nom, repos] of Object.entries(attendus)) {
      const regle = racine.nodes.find(
        (n) => n.type === 'atrule' && n.name === 'property' && n.params === nom
      ) as postcss.AtRule
      expect(regle, nom).toBeTruthy()
      const decls = Object.fromEntries(
        (regle.nodes as postcss.Declaration[]).map((d) => [d.prop, d.value])
      )
      expect(decls).toEqual({ syntax: "'<number>'", inherits: 'false', 'initial-value': repos })
    }
  })

  it('peint UNE lumiere centree sur la souris, calee sur l’ecran, sur chaque panneau', () => {
    for (const selecteur of PANNEAUX) {
      const fond = fondAvecLumiere(selecteur)
      expect(fond, selecteur).toBeTruthy()
      expect(fond.match(/radial-gradient/g), selecteur).toHaveLength(1)
      expect(fond).toMatch(
        /radial-gradient\(\s*circle var\(--nv-lumiere-rayon\) at calc\(var\(--nv-lumiere-x\) \* 100%\) calc\(var\(--nv-lumiere-y\) \* 100%\),\s*var\(--nv-lumiere-couleur\),\s*rgba\(255, 255, 255, 0\)\s*\)\s*fixed/
      )
      expect(fond, selecteur).not.toMatch(/nv-balai/)
      expect(
        declarations(selecteur, 'transition').some((v) =>
          v.includes('var(--nv-lumiere-transition)')
        ),
        selecteur
      ).toBe(true)
    }
  })

  it('pose la lumiere SUR le satin de la page, lui aussi cale sur l’ecran', () => {
    for (const selecteur of PANNEAUX) {
      const fond = fondAvecLumiere(selecteur)
      expect(fond, selecteur).toMatch(/var\(--nv-satin\) fixed(\s+padding-box)?(,|$)/)
      expect(fond.indexOf('radial-gradient'), selecteur).toBeLessThan(
        fond.indexOf('var(--nv-satin)')
      )
    }
  })

  it('garde la lumiere grise, large et douce (Ambiance)', () => {
    const racineTheme = ":root[data-theme='nebuleuse-verre']"
    expect(declarations(racineTheme, '--nv-lumiere-couleur')).toContain('rgba(255, 255, 255, 0.13)')
    expect(declarations(racineTheme, '--nv-lumiere-rayon')).toContain('58vw')
    expect(declarations(racineTheme, '--nv-lumiere-transition')).toContain(
      '--nv-lumiere-x 0.6s ease-out, --nv-lumiere-y 0.6s ease-out'
    )
  })

  it('laisse le menu se replier : sa transition reprend largeur et marges', () => {
    const transitions = declarations(
      ":root[data-theme='nebuleuse-verre'] .theme-serious .rail",
      'transition'
    ).filter((v) => v.includes('--nv-lumiere'))
    expect(transitions[0]).toMatch(/width 180ms var\(--ease\)/)
    expect(transitions[0]).toMatch(/padding 180ms var\(--ease\)/)
  })

  it('fait reprendre au panneau peint du fil la position posee sur le fil', () => {
    const selecteur = ":root[data-theme='nebuleuse-verre'] .cosmic-outline .chat::after"
    expect(declarations(selecteur, '--nv-lumiere-x')).toEqual(['inherit'])
    expect(declarations(selecteur, '--nv-lumiere-y')).toEqual(['inherit'])
  })

  it('s’eteint quand Windows reduit les animations, sans casser le repli du menu', () => {
    let regle: postcss.Rule | undefined
    racine.walkAtRules('media', (media) => {
      if (!/prefers-reduced-motion:\s*reduce/.test(media.params)) return
      media.walkRules((r) => {
        if (
          r.selector.trim() === ":root[data-theme='nebuleuse-verre']" &&
          r.some((n) => n.type === 'decl' && n.prop === '--nv-lumiere-transition')
        )
          regle = r
      })
    })
    expect(regle).toBeTruthy()
    const decls = Object.fromEntries(
      (regle!.nodes as postcss.Declaration[]).map((d) => [d.prop, d.value])
    )
    expect(decls['--nv-lumiere-couleur']).toBe('transparent')
    expect(decls['--nv-lumiere-transition']).toBe('--nv-lumiere-x 0s, --nv-lumiere-y 0s')
  })
})
