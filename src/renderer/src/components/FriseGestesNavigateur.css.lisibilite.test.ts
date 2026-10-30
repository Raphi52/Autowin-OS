import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * LISIBILITÉ DE LA FRISE, calculée sur les couleurs réelles des thèmes (conv-1324, lot 3/3 de
 * conv-1286). Mesuré en vraie app (run11, style calculé) : en thème clair, le verbe d'un jalon actif
 * donnait 4,3:1 en `--gold` et 4,04:1 en `--err`, 3,91:1 sur NieR:Automata, pour un texte de 10,5 px.
 * Ces jetons tiennent 4,5:1 sur le fond de page, pas sur la surface du panneau, plus foncée.
 *
 * ENTRÉE QUI DOIT FAIRE ÉCHOUER CE TEST : remettre `color: var(--jalon)` sur le verbe, ou
 * `color: var(--gold)` sur le dernier bouton du bandeau.
 */
const css = readFileSync(new URL('./FriseGestesNavigateur.css', import.meta.url), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  ''
)
const dossier = new URL('../assets/', import.meta.url)

/**
 * Le bloc d'un thème, pour lire ses jetons et non ceux d'un autre. `base` : ce qu'il hérite sans le
 * redéclarer, comme NieR:Automata qui prend `--err` de la base claire.
 */
function jetons(
  fichier: string,
  debut: RegExp,
  base?: (nom: string) => string
): (nom: string) => string {
  const texte = readFileSync(new URL(fichier, dossier), 'utf8')
  const trouve = debut.exec(texte)
  if (!trouve) throw new Error(`bloc du thème introuvable dans ${fichier}`)
  const bloc = texte.slice(trouve.index)
  return (nom) => {
    const valeur = new RegExp(`${nom}:\\s*(#[0-9a-f]{6}|rgb\\([^)]*\\))`, 'i').exec(bloc)
    if (valeur) return valeur[1]
    if (base) return base(nom)
    throw new Error(`${nom} absent de ${fichier}`)
  }
}

/** `#rrggbb` ou `rgb(r, g, b)` : le fichier généré d'un thème écrit le second. */
function rgb(couleur: string): number[] {
  const canaux = /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/.exec(couleur)
  if (canaux) return canaux.slice(1).map(Number)
  return [1, 3, 5].map((i) => parseInt(couleur.slice(i, i + 2), 16))
}

function luminance(canaux: number[]): number {
  const [r, v, b] = canaux
    .map((c) => c / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * v + 0.0722 * b
}

function contraste(a: number[], b: number[]): number {
  const [clair, sombre] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (clair + 0.05) / (sombre + 0.05)
}

/** La part de la couleur d'accent dans le texte : 100 si la règle la prend pure. */
function partAccent(selecteur: string, variable: string): number {
  const debut = css.indexOf(selecteur)
  expect(debut, `règle ${selecteur} absente`).toBeGreaterThanOrEqual(0)
  const corps = css.slice(css.indexOf('{', debut), css.indexOf('}', debut))
  const couleur = /(?<![-\w])color:\s*([^;]+);/.exec(corps)?.[1].trim() ?? ''
  if (couleur === `var(${variable})`) return 100
  const melange = new RegExp(
    `^color-mix\\(in srgb, var\\(${variable}\\) (\\d+)%, var\\(--text\\)\\)$`
  ).exec(couleur)
  expect(melange, `couleur inattendue pour ${selecteur} : ${couleur}`).not.toBeNull()
  return Number(melange?.[1])
}

function melanger(accent: number[], texte: number[], part: number): number[] {
  return accent.map((c, i) => (c * part + texte[i] * (100 - part)) / 100)
}

const baseClaire = jetons('theme-modes.css', /:root\[data-(base|theme)=['"]clair['"]\]/)

// Surfaces du panneau mesurées en vraie app (style calculé, 17-contrastes.json, conv-1324) : ce sont
// elles qui comptent, pas le fond de page que les tests de thème mesurent déjà.
const THEMES = [
  {
    nom: 'clair',
    surface: [207, 214, 224],
    jeton: baseClaire
  },
  {
    nom: 'nier-automata',
    surface: [218, 212, 187],
    // Le fichier généré prime : c'est lui qui donne le 3,91:1 mesuré en vraie app sur `--err`.
    jeton: jetons(
      'theme-nier-automata.genere.css',
      /:root\[data-theme='nier-automata'\]\[data-base='clair'\]/,
      jetons('theme-nier-automata.css', /--text:/, baseClaire)
    )
  },
  {
    nom: 'ninja-claude',
    surface: [38, 38, 36],
    jeton: jetons('theme-ninja-claude.css', /:root\[data-theme='ninja-claude'\]/)
  }
]

describe('frise des gestes — texte coloré lisible sur la surface du panneau', () => {
  const partVerbe = partAccent('.navigateur-jalon.en-cours .navigateur-jalon-verbe', '--jalon')
  const partBouton = partAccent('.navigateur-pilotage-bouton:last-child', '--gold')

  describe.each(THEMES)('$nom', ({ surface, jeton }) => {
    const texte = rgb(jeton('--text'))

    it.each(['--cyan', '--gold', '--err'])(
      'verbe d’un jalon actif en %s : 4,5:1 au moins',
      (nom) => {
        const couleur = melanger(rgb(jeton(nom)), texte, partVerbe)
        expect(contraste(couleur, surface)).toBeGreaterThanOrEqual(4.5)
      }
    )

    it('dernier bouton du bandeau : 4,5:1 au moins', () => {
      const couleur = melanger(rgb(jeton('--gold')), texte, partBouton)
      expect(contraste(couleur, surface)).toBeGreaterThanOrEqual(4.5)
    })
  })

  it('un jalon prochain garde son verbe sans transparence : seul le point s’efface', () => {
    const corps = /\.navigateur-jalon\.prochain\s*\{([^}]*)\}/.exec(css)?.[1]
    expect(corps, 'règle .navigateur-jalon.prochain absente').toBeDefined()
    expect(corps).not.toMatch(/opacity/)
  })

  it('jumeau : la couleur reste dominante, un jalon garde sa teinte', () => {
    expect(partVerbe).toBeGreaterThanOrEqual(50)
    expect(partBouton).toBeGreaterThanOrEqual(50)
  })
})
