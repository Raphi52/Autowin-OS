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

/**
 * GARDE-FOU DE CADENCE (2026-09-08) — mesure sur le Brain reel (952 noeuds, 30 themes) : la fenetre
 * de Memory mourait a l'infini (100 % de processeur, memoire +25 Mo/4 s) et le dernier bloc ENTRE
 * avant la mort etait toujours `graph:etiquettes`, rejoue 2 894 fois. La boucle par image doit donc
 * rester CONDITIONNELLE : sans pose nouvelle, aucun placement, donc aucune lecture de geometrie.
 */
describe('la boucle d etiquettes ne travaille que si la pose a change', () => {
  const source = readFileSync(join(__dirname, 'GraphView.tsx'), 'utf8')
  const boucle = source.slice(source.indexOf('const followCamera'))
  const corps = boucle.slice(0, boucle.indexOf('frame = requestAnimationFrame(followCamera)'))

  it('le rappel par image est garde par la signature de pose', () => {
    expect(corps).toMatch(/doitResynchroniser\(/u)
    expect(corps).toMatch(/signatureCamera\(/u)
  })

  it('la mesure des etiquettes est conservee au lieu d etre relue a chaque image', () => {
    expect(source).toMatch(/taillesEtiquettesRef\.current\.get\(/u)
  })
})
