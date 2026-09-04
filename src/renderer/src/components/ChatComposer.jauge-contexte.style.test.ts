import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const styles = readFileSync(new URL('./ChatView.css', import.meta.url), 'utf8')

/**
 * LE FILET DE CONTEXTE DOIT ETRE PROGRESSIF, PAS DEGRESSIF (demande utilisateur du 2026-09-04).
 *
 * Deux implementations rendent la MEME longueur de barre et se confondent sur une capture :
 * porter `width: var(--context-fill)` recomprime le degrade a chaque tour, donc la teinte du bord
 * ne bouge jamais et le remplissage se relit comme une decroissance ; caler le degrade sur la
 * largeur TOTALE et DECOUPER le surplus donne a chaque point une teinte fixe, si bien que la barre
 * s'eclaircit reellement a mesure que le fil se remplit. Seul le CSS distingue les deux — d'ou ce
 * test, qui echoue si l'un est remplace par l'autre.
 */
describe('jauge de contexte du composer — degrade progressif', () => {
  const regle = /\.composer\[data-context-level\]::before\s*{([^}]*)}/s.exec(styles)?.[1] ?? ''

  it('cale le degrade sur la largeur TOTALE et decoupe le surplus', () => {
    expect(regle).not.toBe('')
    expect(regle).toMatch(/clip-path:\s*inset\(0 calc\(100% - var\(--context-fill, 0%\)\) 0 0\);/)
    // La largeur ne porte PAS le remplissage : c'est exactement la forme degressive a exclure.
    expect(regle).not.toMatch(/width:\s*var\(--context-fill/)
  })

  it('va du gris vers le blanc PUR, dans ce sens', () => {
    expect(regle).toMatch(
      /linear-gradient\(\s*90deg,\s*rgba\(255, 255, 255, 0\.16\) 0%,\s*rgba\(255, 255, 255, 0\.55\) 45%,\s*#ffffff 100%\s*\)/s
    )
  })

  it('ne reintroduit aucune couleur de palier sur le filet', () => {
    // Choix utilisateur : le rouge alarmait a tort. Le filet reste blanc, quel que soit le palier.
    const paliers =
      /\.composer\[data-context-level='(?:tendu|critique)'\]::before\s*{([^}]*)}/g.exec(styles)
    expect(paliers).toBeNull()
  })
})
