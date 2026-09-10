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
    /*
     * LE PALIER EST LU PAR SON OPACITE, PAS PAR SES CANAUX. Mesure du 2026-09-07 (conv-334) :
     * le passage aux themes a remplace `rgba(255, 255, 255, X)` par `rgba(var(--voile-rgb), X)` —
     * c'est ce qui permet au filet de s'inverser en mode clair. Le test cherchait le blanc ECRIT
     * EN TOUTES LETTRES : il ne trouvait plus AUCUN palier et refusait un degrade qui fait
     * pourtant exactement ce qu'il promet (0.34 -> 0.55 -> blanc pur). La propriete verifiee reste
     * la meme : des paliers dont l'opacite MONTE, puis une arrivee au blanc pur en fin de course.
     */
    const alphas = [...degrade.matchAll(/rgba\((?:255, 255, 255|var\(--voile-rgb\)), ([0-9.]+)\)/g)].map(
      (m) => Number(m[1])
    )
    expect(alphas.length, 'au moins deux paliers gris avant le blanc').toBeGreaterThanOrEqual(2)
    for (let k = 1; k < alphas.length; k += 1) {
      expect(alphas[k], `palier ${k} doit etre plus clair que le precedent`).toBeGreaterThan(alphas[k - 1])
    }
    /*
     * LE BOUT PLEIN PASSE PAR UN JETON. Suite de la meme correction : `#ffffff` etait fige ici,
     * donc le bout de la jauge restait BLANC sur une page claire -- invisible, alors que les deux
     * paliers d'avant, eux, s'inversaient bien avec `--voile-rgb`. Le jeton `--chat-jauge-plein`
     * vaut exactement `#ffffff` en nuit (verifie ci-dessous) et devient sombre en mode clair.
     * La propriete exigee est la meme : arrivee au blanc PUR, en FIN de degrade.
     */
    expect(degrade).toMatch(/var\(--chat-jauge-plein\) 100%/)
    expect(degrade.indexOf('--chat-jauge-plein')).toBeGreaterThan(degrade.lastIndexOf('rgba('))
    const theme = readFileSync(new URL('../assets/theme.css', import.meta.url), 'utf8')
    expect(theme).toMatch(/--chat-jauge-plein:\s*#ffffff;/)
  })

  it('ne reintroduit aucune couleur de palier sur le filet', () => {
    // Choix utilisateur : le rouge alarmait a tort. Le filet reste blanc, quel que soit le palier.
    const paliers =
      /\.composer\[data-context-level='(?:tendu|critique)'\]::before\s*{([^}]*)}/g.exec(styles)
    expect(paliers).toBeNull()
  })
})
