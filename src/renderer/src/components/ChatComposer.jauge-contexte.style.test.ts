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
    /*
     * La PROPRIETE, pas le reglage. Ce test figeait la valeur exacte du premier palier (0.16) ;
     * une retouche visuelle du 2026-09-04 l'a portee a 0.34 et le test est reste rouge des jours
     * durant, alors que le degrade faisait exactement ce qu'il promet. Un test qui interdit de
     * regler une teinte n'apporte rien et finit par etre ignore. Ce qui compte et qui est verifie
     * ici : trois paliers, une opacite qui MONTE, et une arrivee au blanc PUR.
     */
    const degrade = /linear-gradient\(\s*90deg,([^)]*\))*[^)]*\)/s.exec(regle)?.[0] ?? ''
    expect(degrade, 'aucun degrade horizontal trouve').not.toBe('')
    const alphas = [...degrade.matchAll(/rgba\(255, 255, 255, ([0-9.]+)\)/g)].map((m) => Number(m[1]))
    expect(alphas.length, 'au moins deux paliers gris avant le blanc').toBeGreaterThanOrEqual(2)
    for (let k = 1; k < alphas.length; k += 1) {
      expect(alphas[k], `palier ${k} doit etre plus clair que le precedent`).toBeGreaterThan(alphas[k - 1])
    }
    // Le dernier palier est le blanc PUR, et il est bien EN FIN de degrade.
    expect(degrade).toMatch(/#ffffff 100%/)
    expect(degrade.indexOf('#ffffff')).toBeGreaterThan(degrade.lastIndexOf('rgba('))
  })

  it('ne reintroduit aucune couleur de palier sur le filet', () => {
    // Choix utilisateur : le rouge alarmait a tort. Le filet reste blanc, quel que soit le palier.
    const paliers =
      /\.composer\[data-context-level='(?:tendu|critique)'\]::before\s*{([^}]*)}/g.exec(styles)
    expect(paliers).toBeNull()
  })
})
