import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * LES ÉTIQUETTES D'ACTION SONT UN DERNIER RECOURS — deux garanties qui ne valent qu'ENSEMBLE.
 *
 * Mesuré le 2026-08-15 sur les conversations de sonde : 36 sur 39 commençaient par
 * « [a exécuté …] », y compris quand la réponse en dessous était parfaitement rédigée. Verdict de
 * l'utilisateur : « c'est pas du tout l'expérience utilisateur que je veux offrir ».
 *
 * Mais les supprimer purement ferait revenir un défaut plus ancien et pire — la BULLE VIDE d'un tour
 * qui n'a fait qu'agir (conv-1141). D'où le couple, indissociable :
 *   · aucune étiquette quand une vraie réponse existe ;
 *   · jamais de bulle vide quand elle n'existe pas.
 *
 * Le test lit le SOURCE faute de pouvoir invoquer ce module (il construit toute l'application au
 * chargement). C'est un pis-aller assumé : il vérifie l'ORDRE des replis, pas leur effet. La mesure
 * sur l'app reste l'autorité.
 */
const source = readFileSync(join(__dirname, 'index.ts'), 'utf8')

describe('étiquettes d’action : dernier recours, jamais devant une vraie réponse', () => {
  it('les étiquettes ne sont PAS poussées dans le tampon du texte parlé', () => {
    // La faute d'origine : `spoken.push('[a exécuté …]')` les mêlait au texte du modèle.
    expect(source).not.toMatch(/spoken\.push\(`\[a exécuté/)
    expect(source).toMatch(/etiquettesAction\.push\(`\[a exécuté/)
  })

  it('chaque repli place les étiquettes en DERNIER, après le vrai texte', () => {
    const replis = source.split('\n').filter((l) => l.includes('etiquettesAction.join'))
    expect(replis.length).toBeGreaterThanOrEqual(4)
    for (const repli of replis) {
      // `spoken` (le vrai texte) doit être consulté AVANT les étiquettes, dans la même expression.
      expect(repli.indexOf('spoken.join')).toBeGreaterThan(0)
      expect(repli.indexOf('spoken.join')).toBeLessThan(repli.indexOf('etiquettesAction.join'))
    }
  })

  it('le filet anti-bulle-vide SUBSISTE : les étiquettes restent un repli, pas une suppression', () => {
    // Les retirer sans repli rouvrirait la bulle vide — le défaut que ce filet corrigeait.
    expect(source).toContain('etiquettesAction.join')
  })
})
