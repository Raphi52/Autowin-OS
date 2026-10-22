import { beforeEach, describe, expect, it } from 'vitest'
import { decouperMarkdownSansReprise, oublierRepriseMarkdown } from './markdown-blocs'

/**
 * BLOCS DE DONNEES DANS LE DECOUPAGE DU FIL (conv-1074, 2026-10-22).
 *
 * Une fence ```aw-tableau / ```aw-comparaison / ```aw-etapes FERMEE et lisible devient un bloc
 * `donnees`, que l'app met en page. Tout le reste reste du code, lisible et copiable : une fence
 * encore ouverte (streaming), un JSON invalide, une autre langue.
 * Entree qui ferait echouer une mauvaise correction : la fence NON fermee — la rendre en tableau a
 * chaque lot de texte recu ferait clignoter le fil et planterait sur un JSON a moitie ecrit.
 */
const TABLEAU = '{"colonnes":["A","B"],"lignes":[["1","2"]]}'

beforeEach(() => oublierRepriseMarkdown())

describe('découpage : les blocs de données', () => {
  it('une fence aw-tableau fermée et lisible devient un bloc de données, avec ses données lues', () => {
    const blocs = decouperMarkdownSansReprise(
      `Voici :\n\n\`\`\`aw-tableau\n${TABLEAU}\n\`\`\`\n\nFin.`
    )
    const donnees = blocs.find((bloc) => bloc.kind === 'donnees')
    expect(donnees?.donnees).toMatchObject({ forme: 'aw-tableau', colonnes: ['A', 'B'] })
    expect(blocs.map((bloc) => bloc.kind)).toEqual(['text', 'donnees', 'text'])
  })

  it('les trois formes sont reconnues', () => {
    for (const [langue, json] of [
      ['aw-tableau', TABLEAU],
      ['aw-comparaison', '{"options":[{"nom":"A","points":[]},{"nom":"B","points":[]}]}'],
      ['aw-etapes', '{"etapes":[{"titre":"x"}]}']
    ]) {
      const blocs = decouperMarkdownSansReprise(`\`\`\`${langue}\n${json}\n\`\`\``)
      expect(blocs[0]?.kind, langue).toBe('donnees')
    }
  })

  it('jumeau : une fence encore OUVERTE (streaming) reste du code', () => {
    const blocs = decouperMarkdownSansReprise(`\`\`\`aw-tableau\n${TABLEAU}`)
    expect(blocs[0]?.kind).toBe('code')
  })

  it('jumeau : un JSON illisible reste du code, sa source visible', () => {
    const blocs = decouperMarkdownSansReprise('```aw-tableau\n{colonnes: [A]}\n```')
    expect(blocs[0]).toMatchObject({ kind: 'code', content: '{colonnes: [A]}' })
  })

  it('jumeau : un bloc ```json reste du code', () => {
    expect(decouperMarkdownSansReprise(`\`\`\`json\n${TABLEAU}\n\`\`\``)[0]?.kind).toBe('code')
  })
})
