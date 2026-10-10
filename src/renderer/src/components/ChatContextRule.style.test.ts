import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const styles = readFileSync(new URL('./ChatView.css', import.meta.url), 'utf8')
const verre = readFileSync(new URL('../assets/theme-nebuleuse-verre.css', import.meta.url), 'utf8')

/**
 * LE FILET DE CONTEXTE DOIT ETRE PROGRESSIF, PAS DEGRESSIF (demande utilisateur du 2026-09-04).
 *
 * Deux implementations rendent la MEME longueur de barre et se confondent sur une capture :
 * porter `width: var(--context-fill)` recomprime le degrade a chaque tour, donc la teinte du bord
 * ne bouge jamais et le remplissage se relit comme une decroissance ; caler le degrade sur la
 * largeur TOTALE et DECOUPER le surplus donne a chaque point une teinte fixe, si bien que la barre
 * s'eclaircit reellement a mesure que le fil se remplit. Seul le CSS distingue les deux — d'ou ce
 * test, qui echoue si l'un est remplace par l'autre.
 *
 * Depuis conv-179 (2026-10-10) la jauge est le separateur sous l'en-tete du chat
 * (`.chat-context-rule`, ChatContextRule.tsx), et non plus le filet au-dessus du champ.
 */
describe('jauge de contexte sous l en-tete — degrade progressif', () => {
  const regle = /\.chat-context-rule::before\s*{([^}]*)}/s.exec(styles)?.[1] ?? ''

  it('cale le degrade sur la largeur TOTALE et decoupe le surplus', () => {
    expect(regle).not.toBe('')
    expect(regle).toMatch(/clip-path:\s*inset\(0 calc\(100% - var\(--context-fill, 0%\)\) 0 0\);/)
    // La largeur ne porte PAS le remplissage : c'est exactement la forme degressive a exclure.
    expect(regle).not.toMatch(/width:\s*var\(--context-fill/)
  })

  it('va du gris vers le blanc PUR, dans ce sens (themes sans regle propre)', () => {
    /*
     * La PROPRIETE, pas le reglage : des paliers dont l'opacite MONTE, puis une arrivee au voile a
     * pleine puissance (blanc pur en sombre ; il s'inverse sur les themes clairs, 2026-09-09).
     * Les canaux sont lus par `var(--voile-rgb)` (conv-334, 2026-09-07), pas en blanc ecrit en dur.
     */
    const degrade = /linear-gradient\(\s*90deg,([^)]*\))*[^)]*\)/s.exec(regle)?.[0] ?? ''
    expect(degrade, 'aucun degrade horizontal trouve').not.toBe('')
    const alphas = [...degrade.matchAll(/rgba\((?:255, 255, 255|var\(--voile-rgb\)), ([0-9.]+)\)/g)].map(
      (m) => Number(m[1])
    )
    expect(alphas.length, 'au moins deux paliers gris avant le blanc').toBeGreaterThanOrEqual(2)
    for (let k = 1; k < alphas.length; k += 1) {
      expect(alphas[k], `palier ${k} doit etre plus clair que le precedent`).toBeGreaterThan(alphas[k - 1])
    }
    expect(degrade).toMatch(/rgba\(var\(--voile-rgb\), 1\) 100%/)
    expect(alphas[alphas.length - 1]).toBe(1)
  })

  it('ne reintroduit aucune couleur de palier sur le filet', () => {
    // Choix utilisateur : le rouge alarmait a tort. Le filet ne change pas de teinte avec le palier.
    expect(styles).not.toMatch(/\.chat-context-rule\[data-context-level='(?:tendu|critique)'\]/)
    expect(verre).not.toMatch(/\.chat-context-rule\[data-context-level='(?:tendu|critique)'\]/)
  })

  it('se pose SUR le filet du bas de l en-tete, qui la porte', () => {
    expect(/\.chat-head\s*{[^}]*position:\s*relative;/s.test(styles)).toBe(true)
    const racine = /\.chat-context-rule\s*{([^}]*)}/s.exec(styles)?.[1] ?? ''
    expect(racine).toMatch(/position:\s*absolute;/)
    expect(racine).toMatch(/bottom:\s*-\d+px;/)
  })
})

/**
 * « BLANCHE SUR GRIS, CA SERA PLUS DISCRET » (conv-189, 2026-10-10) : l'or de conv-179 a ete juge
 * « trop orange », puis abandonne. Dans Nebuleuse de verre -- et Nebuleuse doree, qui en est
 * derivee --, le remplissage est BLANC uni sur un rail GRIS, sans aucune teinte d'or.
 */
describe('jauge de contexte blanche sur gris, Nebuleuse de verre', () => {
  const PREFIXE = ":root[data-theme='nebuleuse-verre']"
  const bloc = (selecteur: string): string => {
    const echappe = selecteur.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    // TOUTES les regles du selecteur, groupees comprises : le trait commun (`::after, ::before`)
    // et le remplissage propre a `::before` sont deux regles distinctes.
    return [...verre.matchAll(new RegExp(`(?:^|\\n)${echappe}\\s*[{,]([^}]*)}`, 'g'))]
      .map((m) => m[1])
      .join('\n')
  }

  it('remplit en blanc uni, sans degrade ni or', () => {
    const remplissage = bloc(`${PREFIXE} .chat-context-rule::before`)
    expect(remplissage).toMatch(/background-image:\s*none;/)
    expect(remplissage).toMatch(/background-color:\s*#ffffff;/)
    expect(remplissage).not.toMatch(/#a27326|#d4a94f|#e9c069|#f6dc96|226, 182, 90/i)
  })

  it('pose le remplissage sur un rail gris, plus sur un rail d or', () => {
    const rail = bloc(`${PREFIXE} .chat-context-rule::after`)
    expect(rail).toMatch(/background:\s*rgba\(255, 255, 255, 0\.\d+\);/)
    expect(rail).not.toMatch(/226, 182, 90/)
  })
})

/**
 * LE MOT « contexte » AU BOUT DE LA JAUGE (conv-189, 2026-10-10 : « qu'il y ait ecrit contexte au
 * bout de la jauge, pas tout a droite mais a droite de la jauge qui progresse »). Le mot suit la
 * POINTE du remplissage (`--context-fill`), pas le bord droit, et le rail reprend apres lui.
 */
describe('mot « contexte » au bout du remplissage', () => {
  const plat = (s: string): string => s.replace(/\s+/g, ' ')
  const libelle = plat(/\.chat-context-rule-libelle\s*{([^}]*)}/s.exec(styles)?.[1] ?? '')
  const rail = plat(/\.chat-context-rule::after\s*{([^}]*)}/s.exec(styles)?.[1] ?? '')

  it('se cale sur la pointe du remplissage, borne au bord droit', () => {
    expect(libelle).toContain('position: absolute;')
    expect(libelle).toContain('left: min(var(--context-fill, 0%), 100% - var(--context-libelle-largeur));')
    // Jamais colle au bord droit : c'est exactement ce que l'utilisateur a exclu.
    expect(libelle).not.toMatch(/(?:^|[ ;])right:/)
  })

  it('pose le mot dans une capsule NOIRE opaque, lisible sur le texte blanc du fil', () => {
    // conv-189 : « le texte contexte doit etre dans une capsule noire pour etre visible par-dessus
    // du texte blanc du chat ». Noir en dur : le voile s'inverse sur les themes clairs.
    expect(libelle).toContain('background: #000000;')
    expect(libelle).toContain('border-radius: 999px;')
    expect(libelle).toMatch(/(?:^|[ ;])color: rgba\(255, 255, 255, 0\.\d+\);/)
  })

  it('coupe le rail : le trait gris reprend apres le mot', () => {
    expect(rail).toContain(
      'left: calc( min(var(--context-fill, 0%), 100% - var(--context-libelle-largeur)) + var(--context-libelle-largeur) );'
    )
  })
})

describe('placement : sous l en-tete du chat, plus au-dessus du champ', () => {
  const vue = readFileSync(new URL('./ChatView.tsx', import.meta.url), 'utf8')
  const composer = readFileSync(new URL('./ChatComposer.tsx', import.meta.url), 'utf8')

  it('est rendue DANS l en-tete du chat, en dernier, sur son filet du bas', () => {
    const debut = vue.indexOf('<header className="chat-head')
    const fin = vue.indexOf('</header>', debut)
    const jaugeIci = vue.indexOf('<ChatContextRule', debut)
    expect(debut).toBeGreaterThan(-1)
    expect(jaugeIci).toBeGreaterThan(debut)
    expect(jaugeIci).toBeLessThan(fin)
    expect(vue.match(/<ChatContextRule\b/g)).toHaveLength(1)
  })

  it('a quitte le champ de saisie : plus aucune jauge sur le composer', () => {
    expect(composer).not.toMatch(/contextRatio|contextPanelNode|data-context-level|--context-fill/)
    expect(vue).not.toMatch(/contextRatio=|contextPanelNode=/)
  })
})
