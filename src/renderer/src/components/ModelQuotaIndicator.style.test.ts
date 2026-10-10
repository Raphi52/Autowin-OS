import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const component = readFileSync(new URL('./ModelQuotaIndicator.tsx', import.meta.url), 'utf8')
const styles = readFileSync(new URL('./ModelQuotaIndicator.css', import.meta.url), 'utf8')

describe('barre de quota cliquable', () => {
  it('rend une barre pilotée par le pourcentage restant, et plus aucune roue', () => {
    expect(component).toContain('model-quota-bar')
    expect(component).toContain('model-quota-bar-fill')
    expect(component).toContain("'--quota-fill': `${remaining ?? 0}%`")
    // La roue est SUPPRIMÉE : plus de SVG ni d'arc, ni dans le composant ni dans les styles.
    expect(component).not.toContain('model-quota-wheel')
    expect(component).not.toContain('pathLength')
    expect(component).not.toContain('--quota-angle')
    expect(styles).not.toContain('model-quota-wheel')
  })

  /**
   * REFERENCE RECALEE le 2026-09-04 : ces assertions decrivaient encore le premier degre
   * (#ef4444 / #f59e0b / #facc15), remplace depuis par le degrade A PALIERS demande par
   * l'utilisateur (commit e7e233b2, conv-240 : « le degrade passait au vert des 62 %, et une seule
   * teinte ambre servait d'orange ET de jaune »). Elles etaient donc ROUGES tout en protegeant une
   * version abandonnee : un garde-fou qui refuse la barre reelle ne garde plus rien. Les quatre
   * teintes et l'ORDRE restent verrouilles — seules les valeurs suivent le CSS servi.
   */
  it('garde le dégradé rouge → orange → jaune → vert dans ce sens, calé sur la barre entière', () => {
    // Paliers PLATS (deux arrets par teinte) : chaque couleur tient une plage lisible au lieu de
    // fondre dans la suivante. Retirer un palier ou reordonner les teintes fait echouer ceci.
    // Les teintes sont des VARIABLES (conv-197) : la pastille lit les memes que la barre, et un
    // theme les change en un seul endroit. Leurs valeurs de base restent verrouillees ci-dessous.
    expect(styles).toMatch(
      /\.model-quota-bar-fill\s*{[^}]*linear-gradient\(\s*90deg,\s*var\(--quota-rouge\) 0%,\s*var\(--quota-rouge\) 12%,\s*var\(--quota-orange\) 30%,\s*var\(--quota-orange\) 42%,\s*var\(--quota-jaune\) 56%,\s*var\(--quota-jaune\) 68%,\s*var\(--quota-vert\) 86%,\s*var\(--quota-vert\) 100%\s*\);/s
    )
    expect(styles).toMatch(
      /\.model-quota-trigger\s*{[^}]*--quota-rouge: #b8201a;\s*--quota-orange: #e0641e;\s*--quota-jaune: #efc023;\s*--quota-vert: #35d07f;/s
    )
    // Le vert n'arrive qu'a 86 % : le defaut nomme en conv-240 etait un basculement au vert des
    // 62 %, qui faisait passer un quota entame pour sain.
    expect(styles).not.toMatch(/var\(--quota-vert\) (?:[0-7]\d|8[0-5])%/)
    // Le restant DÉCOUPE le dégradé au lieu de le compresser : à 10 % restant il ne reste que du
    // rouge, alors qu'une largeur portée par l'élément laisserait du vert au bord droit.
    expect(styles).toMatch(
      /\.model-quota-bar-fill\s*{[^}]*clip-path:\s*inset\(0 calc\(100% - var\(--quota-fill, 0%\)\) 0 0\);/s
    )
  })

  /**
   * DEFAUT SIGNALE LE 2026-09-04 (capture utilisateur) : a 100 %, la pastille du chiffre restait
   * plafonnee a `100% - 22px`, donc un bout de barre verte depassait a sa droite. Le retrait est
   * desormais PROPORTIONNEL au restant : nul a 0 %, egal a la largeur de la pastille a 100 %.
   */
  it('centre la pastille sur la fin du remplissage sans deborder a 100 %', () => {
    expect(component).toContain("'--quota-ratio': `${(remaining ?? 0) / 100}`")
    // La pastille se pose AU BOUT de la ligne : la barre reserve 22 px a sa droite et le bord
    // GAUCHE de la pastille tombe sur la fin du remplissage (aucun retrait).
    expect(styles).toMatch(
      /\.model-quota-bar-value\s*{[^}]*left:\s*calc\(var\(--quota-ratio, 0\) \* \(100% - 22px\)\);/s
    )
    expect(styles).toMatch(/\.model-quota-bar-value\s*{[^}]*--quota-retrait:\s*0px;/s)
    expect(styles).toMatch(/\.model-quota-bar\s*{[^}]*margin-right:\s*22px;/s)
    expect(styles).toMatch(
      /\.model-quota-bar-value\s*{[^}]*transform:\s*translate\(calc\(-1 \* var\(--quota-retrait, 0px\)\), -50%\);/s
    )
    // L'ancien plafond fixe ne doit plus exister : c'est LUI qui laissait le bout de barre nu.
    expect(styles).not.toContain('calc(100% - 22px)')
  })

  it('conserve les quatre états de couleur du nombre', () => {
    // Teintes SERVIES par la barre actuelle (cf. `.model-quota-trigger.is-*` dans le CSS).
    const stateColors = {
      healthy: '#35d07f',
      warning: '#f0a020',
      critical: '#b8201a',
      unknown: '#687782'
    }
    for (const [level, color] of Object.entries(stateColors)) {
      expect(styles).toMatch(
        new RegExp(`\\.model-quota-trigger\\.is-${level}\\s*{[^}]*--quota-color:\\s*${color};`, 's')
      )
    }
    expect(styles).toContain('--quota-color, #35d07f')
    expect(styles).toMatch(
      /\.model-quota-meter i\s*{[^}]*linear-gradient\(90deg,\s*#b8201a 0%,\s*#f0a020 45%,\s*#35d07f 100%\);/s
    )
  })

  it('conserve le popover existant, désormais ouvert par la barre', () => {
    expect(component).toContain('model-quota-popover')
    expect(component).toContain('Quotas fournisseurs')
  })

  /**
   * POPUP INVISIBLE AU CLIC (2026-10-10). Rendue dans <body> par un portail, la popup n'avait plus
   * de z-index : `#root` (`z-index: 1`, theme.css) la recouvrait entierement. Elle s'ouvrait donc
   * sous l'app. Retirer la classe ou le z-index fait echouer ceci.
   */
  it('peint la popup rendue dans <body> au-dessus de l’app', () => {
    expect(component).toMatch(/className="model-quota-popover is-flottant"/)
    expect(component).toContain('document.body')
    const bloc = styles.match(/\.model-quota-popover\.is-flottant\s*{([^}]*)}/s)
    expect(bloc, 'regle .model-quota-popover.is-flottant absente').not.toBeNull()
    const z = Number(bloc?.[1].match(/z-index:\s*(\d+)/)?.[1] ?? 0)
    // Au-dessus de #root (1) ; le menu Orchestrateur, autre popup du composer, est a 9000.
    expect(z).toBeGreaterThanOrEqual(9000)
  })

  /**
   * BULLE TRANSPARENTE AU SURVOL (2026-10-10, « elle devrait avoir un fond noir »). Le fond venait
   * du jeton `--surface-panel`, qui vaut un verre a 4,5 % dans le theme Nebuleuse de verre. La
   * bulle porte desormais un noir opaque en dur, repris tel quel par les themes generes.
   */
  it('donne à la bulle de survol un fond noir opaque, indépendant des jetons de panneau', () => {
    // Commentaires retires : celui de la regle CITE le jeton abandonne pour expliquer le choix.
    const bloc = (styles.match(/\.model-quota-tip\s*{([^}]*)}/s)?.[1] ?? '').replace(
      /\/\*[\s\S]*?\*\//g,
      ''
    )
    expect(bloc).not.toContain('--surface-panel')
    const fond = bloc.match(/background:\s*rgba\(0, 0, 0, (0?\.\d+|1)\)/)
    expect(fond, 'fond noir rgba(0, 0, 0, a) absent').not.toBeNull()
    expect(Number(fond?.[1])).toBeGreaterThanOrEqual(0.9)
    for (const theme of ['nebuleuse-verre', 'nebuleuse-doree']) {
      const genere = readFileSync(
        new URL(`../assets/theme-${theme}.genere.css`, import.meta.url),
        'utf8'
      )
      const regle = genere.match(
        new RegExp(`:root\\[data-theme='${theme}'\\] \\.model-quota-tip\\s*{([^}]*)}`, 's')
      )?.[1]
      expect(regle, `bulle absente du theme genere ${theme}`).toBeDefined()
      expect(regle).not.toContain('--surface-panel')
    }
  })
})
