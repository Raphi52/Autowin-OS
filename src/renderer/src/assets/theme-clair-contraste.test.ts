import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * LISIBILITÉ DU MODE CLAIR, mesurée et non supposée.
 *
 * Le piège d'un mode clair fabriqué à partir d'un thème de nuit : on inverse les fonds et on
 * garde les accents. Or le jaune `#e9bd4e` et le rose `#ef3f91` du mode sombre tombent sous
 * 3:1 sur blanc — un titre jaune pâle sur fond blanc devient illisible. Ce test CALCULE le
 * contraste réel (formule WCAG 2.1) des couleurs déclarées pour `:root[data-theme='clair']`.
 *
 * ENTRÉE QUI DOIT FAIRE ÉCHOUER CE TEST : recopier telle quelle une couleur du mode sombre
 * dans le bloc clair.
 */
const css = readFileSync('src/renderer/src/assets/theme-modes.css', 'utf8')
/*
 * LE SELECTEUR EST CHERCHE, PAS RECOPIE. Mesure du 2026-09-07 (conv-334) : le commit 640f92ea
 * a renomme `:root[data-theme='clair']` en `:root[data-base='clair']` — les surcharges claires
 * visent desormais la BASE du theme. Ce test citait l'ancien nom en dur : `indexOf` rendait -1,
 * `slice(-1)` gardait UN caractere, et la garde jetait « Variable --bg-0 absente du mode clair »
 * au lieu de mesurer le moindre contraste. Une garde qui ne trouve plus sa cible ne protege rien.
 */
const debutClair = /:root\[data-(base|theme)=['"]clair['"]\]/.exec(css)
if (!debutClair) throw new Error('bloc du mode clair introuvable dans theme-modes.css')
const blocClair = css.slice(debutClair.index)

function hex(variable: string): string {
  const trouve = new RegExp(`${variable}:\\s*(#[0-9a-f]{6})`, 'i').exec(blocClair)
  if (!trouve) throw new Error(`Variable ${variable} absente du mode clair`)
  return trouve[1]
}

function luminance(couleur: string): number {
  const canaux = [1, 3, 5].map((i) => parseInt(couleur.slice(i, i + 2), 16) / 255)
  const [r, v, b] = canaux.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * v + 0.0722 * b
}

function contraste(a: string, b: string): number {
  const [clair, sombre] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (clair + 0.05) / (sombre + 0.05)
}

describe('mode clair — contraste des couleurs sur le fond de page', () => {
  const fond = hex('--bg-0')

  it('le texte courant dépasse largement le seuil AA (4,5:1)', () => {
    expect(contraste(hex('--text'), fond)).toBeGreaterThanOrEqual(4.5)
  })

  it('le texte secondaire reste au seuil AA', () => {
    expect(contraste(hex('--text-dim'), fond)).toBeGreaterThanOrEqual(4.5)
  })

  it('le texte discret tient au moins le seuil des grands textes (3:1)', () => {
    expect(contraste(hex('--text-faint'), fond)).toBeGreaterThanOrEqual(3)
  })

  it.each(['--gold', '--rose', '--cyan', '--ok', '--err', '--violet'])(
    '%s reste lisible sur fond clair',
    (variable) => {
      expect(contraste(hex(variable), fond)).toBeGreaterThanOrEqual(3)
    }
  )
})

/**
 * LES ÉTAGES D'ACTION EN MODE CLAIR. Signalé à l'écran (capture du 2026-09-16) : le nom de
 * l'outil (« edit_file ») s'affichait en gris pâle sur la carte bleutée d'une action en cours.
 * Cause : `cosmic-outline.css` peint `.activity-step` en `#b9cbdd`, un bleu-gris prévu pour le
 * fond noir, et aucune surcharge claire ne le reprenait.
 *
 * ENTRÉE QUI DOIT FAIRE ÉCHOUER CE TEST : retirer la surcharge claire de `.activity-step`.
 */
describe('mode clair — étages d’action (le nom de l’outil)', () => {
  it('le texte des étages est repeint pour le fond clair et tient le seuil AA', () => {
    const regle = /:root\[data-base='clair'\] \.cosmic-outline \.activity-step \{([^}]*)\}/.exec(
      blocClair
    )
    expect(regle, 'surcharge claire de .activity-step absente').toBeTruthy()
    const couleur = /color:\s*(#[0-9a-f]{6})/i.exec(regle![1])
    expect(couleur, 'la surcharge doit fixer une couleur de texte').toBeTruthy()
    expect(contraste(couleur![1], hex('--bg-0'))).toBeGreaterThanOrEqual(4.5)
  })
})

/**
 * VIGNETTE DE PIÈCE JOINTE. Signalé avec capture le 2026-09-16 : « lorsque je copie une image,
 * le fond de la vignette est tout noir ». Cause : `ChatView.css` peint `.attachment-chip` en
 * `rgba(8, 19, 28, 0.94)` EN DUR — une plaque noire posée dans un champ de saisie blanc.
 *
 * ENTRÉE QUI DOIT FAIRE ÉCHOUER CE TEST : retirer la surcharge claire de `.attachment-chip`.
 */
describe('mode clair — vignette de pièce jointe du champ de saisie', () => {
  it('la pastille a un fond clair, et son texte y reste lisible', () => {
    const regle = /:root\[data-base='clair'\] \.attachment-chip \{([^}]*)\}/.exec(blocClair)
    expect(regle, 'surcharge claire de .attachment-chip absente').toBeTruthy()
    const fond = /background:\s*(#[0-9a-f]{6})/i.exec(regle![1])
    expect(fond, 'la surcharge doit fixer un fond opaque clair').toBeTruthy()
    expect(contraste(hex('--text-dim'), fond![1])).toBeGreaterThanOrEqual(4.5)
  })
})

/**
 * LA BANDE DU HAUT (onglets de vues + boutons de fenêtre). Signalé avec capture le 2026-09-21 :
 * « on ne voit pas bien les boutons en haut à gauche en mode clair », puis « c'est TOUT le haut
 * qui n'est pas visible ».
 *
 * Cause : le voile ivoire qui lave la galaxie en mode clair était posé sur `.home-view::after`,
 * un calque `absolute` INTÉRIEUR à la vue Accueil. La bande de 28 px et les marges de la coque
 * n'étaient pas couvertes, et le décor y restait noir opaque (`FOND_DECOR`) sous du texte sombre.
 * Il est passé sur `.decor-de-fond::after`, qui est `fixed inset: 0`.
 *
 * ENTRÉE QUI DOIT FAIRE ÉCHOUER CE TEST : remettre le voile sur un calque intérieur à une vue —
 * la bande du haut redeviendrait noire sous du texte sombre, sans que rien ne le signale.
 */
describe('mode clair — le voile couvre TOUTE la surface du décor', () => {
  it('le voile est posé sur le décor lui-même, pas sur une vue', () => {
    const regle = /:root\[data-base='clair'\] \.decor-de-fond::after \{([^}]*)\}/.exec(css)
    expect(regle, 'voile clair absent du décor').toBeTruthy()
    expect(regle![1], 'le voile doit être fixe et couvrir toute la fenêtre').toMatch(
      /position:\s*fixed/
    )
    expect(regle![1]).toMatch(/inset:\s*0/)
  })

  it('les boutons de fenêtre suivent le fond lavé et non le décor sombre', () => {
    // Windows peint ces symboles hors de la page : la seule prise est ce jeton, lu par theme-mode.ts.
    expect(contraste(hex('--titlebar-symbol'), hex('--bg-0'))).toBeGreaterThanOrEqual(4.5)
  })
})
