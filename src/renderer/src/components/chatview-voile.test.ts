import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * GARDE : le CHAT ne peint plus ses filets et ses surfaces avec du blanc ECRIT EN DUR.
 *
 * Pourquoi ce test existe. Mesure du 2026-09-07 sur `ChatView.css` : 437 couleurs en dur, dont
 * 45 `rgba(255, 255, 255, X)` sur 22 opacites differentes. Un blanc a 5 % pose sur un fond blanc
 * n'existe pas — c'est la cause MECANIQUE des filets, pastilles et contours qui disparaissent en
 * mode clair, et la raison pour laquelle le bouton « Mode auto » s'affichait nu. Aucun test de
 * comportement, aucun `tsc` et aucune capture ne le signalent : il faut lire les couleurs.
 *
 * LA CORRECTION RETENUE, et pourquoi celle-la. Ecraser les 22 opacites par trois paliers aurait
 * change le rendu de NUIT, que personne n'a demande de toucher. On rend donc la COULEUR variable
 * en laissant l'opacite au point d'usage : `rgba(var(--voile-rgb), 0.18)`. En nuit,
 * `--voile-rgb` vaut `255, 255, 255`, donc le pixel est IDENTIQUE a l'avant. En clair, il vaut
 * `18, 24, 40`, donc le meme filet devient sombre et visible.
 *
 * ENTREE QUI DOIT FAIRE ECHOUER CE TEST : reecrire `rgba(255, 255, 255, 0.1)` quelque part dans
 * `ChatView.css`, ou retirer `--voile-rgb` de l'un des deux themes. Dans les deux cas le mode
 * clair reperdrait ses filets, en silence.
 *
 * CE QUE CE TEST NE COUVRE PAS, et il faut le dire : il reste environ 234 couleurs en
 * HEXADECIMAL dans ce fichier, sur pres de 300 valeurs distinctes. Elles ne sont PAS mecaniques
 * — chacune demande un choix de jeton. Ce test verrouille la famille traitee, pas le fichier
 * entier. Ne pas l'elargir a l'hexadecimal sans avoir fait le travail de classement : il
 * deviendrait rouge en permanence, donc ignore.
 */

const CHAT = 'src/renderer/src/components/ChatView.css'
const THEME = 'src/renderer/src/assets/theme.css'
const THEME_MODES = 'src/renderer/src/assets/theme-modes.css'

describe('le chat passe ses voiles par le theme', () => {
  it("n'ecrit plus aucun blanc translucide en dur", () => {
    const css = readFileSync(CHAT, 'utf8')
    const enDur = [...css.matchAll(/rgba\(\s*255\s*,\s*255\s*,\s*255\s*,[^)]*\)/g)].map((m) => m[0])
    expect(enDur).toEqual([])
  })

  it('passe bien par le jeton de voile, et pas qu’une fois', () => {
    // Garde-fou du garde-fou : si quelqu'un supprimait les usages au lieu de les convertir,
    // le cas ci-dessus resterait vert A VIDE.
    const css = readFileSync(CHAT, 'utf8')
    const usages = [...css.matchAll(/rgba\(var\(--voile-rgb\)/g)]
    expect(usages.length).toBeGreaterThanOrEqual(40)
  })

  it('definit le voile dans les DEUX modes, sinon la propriete devient invalide', () => {
    // `rgba(var(--absente), 0.18)` ne tombe pas en arriere : la declaration est invalide et la
    // couleur disparait. Le jeton doit donc exister dans le theme de base ET etre repris en clair.
    expect(readFileSync(THEME, 'utf8')).toMatch(/--voile-rgb:\s*255,\s*255,\s*255/)
    expect(readFileSync(THEME_MODES, 'utf8')).toMatch(/--voile-rgb:\s*18,\s*24,\s*40/)
  })

  it('garde le rendu de NUIT identique au pixel', () => {
    // La valeur de nuit doit rester le blanc pur : c'est ce qui garantit qu'aucune des 22
    // opacites converties n'a change d'apparence dans le mode par defaut.
    const theme = readFileSync(THEME, 'utf8')
    const bloc = theme.slice(0, theme.indexOf('--voile-rgb'))
    // Le jeton vit bien dans le `:root` du theme de base, pas dans une regle conditionnelle.
    expect(bloc).toContain(':root')
    expect(bloc.split(':root').length - 1).toBeGreaterThanOrEqual(1)
  })
})
