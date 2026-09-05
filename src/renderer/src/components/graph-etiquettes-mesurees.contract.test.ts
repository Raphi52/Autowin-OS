import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * LA BOUCLE D'ETIQUETTES DOIT PORTER SON NOM.
 *
 * Mesure du 2026-09-05 sur le Brain reel (862 noeuds, 17 themes) : l'ouverture de Memory n'ecrit
 * AUCUNE ligne dans `gels.jsonl`, meme avec le seuil d'ecriture abaisse a 150 ms. Les quatre blocs
 * deja instrumentes (`graph:visibilite`, `graph:layoutTree`, `graph:projection`, `graph:objets3d`)
 * sont donc innocentes : chacun coute moins de 150 ms.
 *
 * Le seul travail CONTINU de cette vue n'etait couvert par aucune sonde : `followCamera` rappelle
 * `syncThemeClusterLabels` a CHAQUE image tant que la vue est ouverte, et cette fonction lit la
 * geometrie (`offsetHeight`) puis ecrit `style.transform`, etiquette par etiquette — le va-et-vient
 * qui force le navigateur a recalculer la mise en page, soixante fois par seconde.
 *
 * On l'entoure du chronometre nomme deja existant : chaque passage reste sous le seuil d'ecriture,
 * mais il alimente le registre glissant, si bien qu'une tache longue survenant pendant cette boucle
 * ressort enfin sous `graph:etiquettes` au lieu de `renderer:longtask`.
 *
 * Contrat sur la SOURCE, et non sur le rendu : monter un graphe 3D complet en test couterait plus
 * cher que le defaut mesure, et le cablage est precisement ce qui doit ne jamais disparaitre.
 */
describe('la boucle d etiquettes du graphe est mesuree', () => {
  const source = readFileSync(join(__dirname, 'GraphView.tsx'), 'utf8')

  it('le rappel par image passe par le chronometre nomme du graphe', () => {
    expect(source).toMatch(/mesurerBlocGraphe\(\s*'graph:etiquettes'/u)
  })

  it('la boucle de suivi camera n appelle plus la synchro a nu', () => {
    const boucle = source.slice(source.indexOf('const followCamera'))
    const corps = boucle.slice(0, boucle.indexOf('requestAnimationFrame(followCamera)'))
    expect(corps).not.toMatch(/^\s*syncThemeClusterLabels\(\)\s*$/mu)
  })
})
