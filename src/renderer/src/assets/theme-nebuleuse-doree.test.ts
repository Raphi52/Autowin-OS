import { readFileSync } from 'node:fs'
import postcss from 'postcss'
import { describe, expect, it } from 'vitest'
import { THEMES, baseDuTheme } from '../theme-mode'

/**
 * Theme « Nebuleuse doree » (conv-139, 2026-10-10) : Nebuleuse de verre en or et noir. Ses deux
 * feuilles sont DERIVEES par scripts/theme-nebuleuse-verre.mjs nebuleuse-doree.
 */
const lire = (fichier: string): string => readFileSync(new URL(fichier, import.meta.url), 'utf8')
const PREFIXE = ":root[data-theme='nebuleuse-doree']"

function selecteursHorsTheme(css: string): string[] {
  const fautifs: string[] = []
  postcss.parse(css).walkRules((regle) => {
    if (regle.parent?.type === 'atrule' && /keyframes/i.test((regle.parent as postcss.AtRule).name))
      return
    for (const s of regle.selectors) if (!s.trim().startsWith(PREFIXE)) fautifs.push(s)
  })
  return fautifs
}

describe('theme Nebuleuse doree', () => {
  it('est propose dans la liste des themes, en base sombre', () => {
    expect(THEMES.find((t) => t.id === 'nebuleuse-doree')?.libelle).toBe('Nébuleuse dorée')
    expect(baseDuTheme('nebuleuse-doree')).toBe('sombre')
  })

  it('charge la couche generee AVANT la feuille principale', () => {
    const app = lire('../App.tsx')
    const genere = app.indexOf("import './assets/theme-nebuleuse-doree.genere.css'")
    const main = app.indexOf("import './assets/theme-nebuleuse-doree.css'")
    expect(genere).toBeGreaterThan(-1)
    expect(main).toBeGreaterThan(genere)
  })

  it('ne peint rien hors du theme', () => {
    expect(selecteursHorsTheme(lire('./theme-nebuleuse-doree.css'))).toEqual([])
    expect(selecteursHorsTheme(lire('./theme-nebuleuse-doree.genere.css'))).toEqual([])
  })

  it('ne garde ni le rose ni le violet de Nebuleuse de verre', () => {
    for (const f of ['./theme-nebuleuse-doree.css', './theme-nebuleuse-doree.genere.css']) {
      expect(lire(f)).not.toMatch(/#ff3d9a|#7b5cff|255, 61, 154|123, 92, 255|14, 11, 32/i)
    }
  })

  it('donne a la zone de saisie le degrade or clair -> noir et garde les couleurs d etat', () => {
    const main = lire('./theme-nebuleuse-doree.css')
    expect(main).toContain('linear-gradient(315deg, rgba(240, 207, 122, 0.42), rgba(10, 8, 6, 0.92) 58%)')
    // Le vert d'etat = LE vert des themes Nebuleuse, « bien flashy » (conv-197).
    expect(main).toContain('--ok: #00ff55')
    expect(main).toContain('--warn: #ffb547')
  })

  /**
   * Nebuleuse doree garde SA saisie (degrade or -> noir, bord blanc fin, pastille d'envoi en
   * degrade or) quand Nebuleuse de verre passe a la sienne (conv-155) ; seule la forme du bouton
   * suit, parce que la regle « coin pince = bulle de message seulement » vaut pour les deux.
   */
  it('garde sa propre saisie et son envoi degrade, sans coin pince hors des bulles', () => {
    const main = lire('./theme-nebuleuse-doree.css')
    expect(main).toContain('--nv-saisie-bord: var(--nv-bord);')
    expect(main).toContain('--nv-envoi-fond: var(--nv-degrade);')
    expect(main).toContain('--nv-envoi-vide-fond: var(--nv-degrade);')
    const coinsInegaux: string[] = []
    postcss.parse(main).walkDecls('border-radius', (decl) => {
      const coins = decl.value.includes('(') ? [decl.value] : decl.value.split('/')[0].trim().split(/\s+/)
      if (new Set(coins).size < 2) return
      const regle = decl.parent as postcss.Rule
      if (regle.selectors.every((s) => /\.msg\.user \.msg-body$/.test(s.trim()))) return
      coinsInegaux.push(`${regle.selector} -> ${decl.value}`)
    })
    expect(coinsInegaux).toEqual([])
  })

  it('est a jour avec sa source : regenerer ne change rien', async () => {
    const { genererMainDoree } = await import('../../../../scripts/theme-nebuleuse-verre.mjs')
    expect(genererMainDoree()).toBe(lire('./theme-nebuleuse-doree.css'))
  })

  /**
   * Le fond « liseré · halo haut » (conv-159) appartient a Nebuleuse de verre seule. Sans le bloc
   * FOND-PROPRE de la derivation, la doree heritait d'un filet BLEU en haut et d'un halo or en bas
   * (mesure du 2026-10-10 : la derivation sortait #8ccaff et rgba(47, 139, 255, ...)).
   */
  it('garde ses deux nappes or : le fond de Nebuleuse de verre ne passe pas dans la doree', async () => {
    const { genererMainDoree } = await import('../../../../scripts/theme-nebuleuse-verre.mjs')
    const derivee = genererMainDoree()
    expect(derivee).not.toMatch(/#8ccaff|47, 139, 255|FOND-PROPRE|liseré · halo haut/)
    expect(derivee).toContain(
      'radial-gradient(70vw 60vh at 96% 100%, rgba(228, 182, 67, 0.42), transparent 70%)'
    )
    expect(derivee).toContain(
      'radial-gradient(60vw 55vh at 0% 0%, rgba(227, 181, 63, 0.12), transparent 70%), #0a0a0a;'
    )
  })

  /**
   * LES BANDEAUX DU HAUT DU CHAT SONT EN PERLE D'OR (conv-179, 2026-10-10). La regle est ecrite
   * dans theme-nebuleuse-verre.css, hors du bloc RELIEF-PERLE : la derivation la garde telle quelle
   * (or et blanc ne sont pas recolores). Le jeton --warn du theme reste l'ambre des etats.
   */
  it('peint les bandeaux du haut du chat en perle d or, sans toucher l ambre d etat', () => {
    const main = lire('./theme-nebuleuse-doree.css')
    const valeurs: string[] = []
    postcss.parse(main).walkRules((regle) => {
      if (!regle.selectors.some((s) => s.trim() === `${PREFIXE} .chat-workflow-notice`)) return
      regle.walkDecls('--warn', (decl) => {
        valeurs.push(decl.value)
      })
    })
    expect(valeurs).toEqual(['#e2b65a'])
    expect(main).toContain('--warn: #ffb547')
  })
})
