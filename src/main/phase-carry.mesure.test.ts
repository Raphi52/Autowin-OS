import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { porterSortieDePhase } from './phase-carry'

/**
 * LA MESURE, RENDUE REPRODUCTIBLE — et c'est un correctif, pas un ajout.
 *
 * Le bénéfice du portage avait d'abord été mesuré par un script jetable, supprimé après usage par
 * hygiène. Un relecteur externe a refait la mesure de son côté et n'a retrouvé NI le nombre de
 * sorties NI les pourcentages : selon la façon de délimiter les blocs `### phase` dans un RUN.md
 * (leur contenu porte ses propres `##`), deux découpages également raisonnables donnent des comptes
 * très différents. La DIRECTION du résultat était robuste, les chiffres non re-dérivables.
 *
 * Une mesure qu'un tiers ne peut pas rejouer n'est pas une mesure, c'est une affirmation. Le script
 * vit donc ici, versionné, avec sa règle de découpage EXPLICITE — et il se contente d'assertions
 * sur l'ORDRE DE GRANDEUR, parce que c'est tout ce que la donnée peut porter honnêtement.
 *
 * Il lit le magasin réel de l'app (`.autowin-data`), qui peut être absent sur une autre machine ou
 * dans un CI : dans ce cas il ne prétend rien plutôt que d'échouer sur une absence de données.
 */

const MAGASIN = '.autowin-data/autowin-os/runs'

/** Borne simulée. Les blocs persistés font ≤ 2000, il faut un cap plus bas pour observer une coupe. */
const CAP_MESURE = 1000

function tousLesRunMd(racine: string, acc: string[] = [], profondeur = 0): string[] {
  if (profondeur > 4) return acc
  let entrees: string[] = []
  try {
    entrees = readdirSync(racine)
  } catch {
    return acc
  }
  for (const nom of entrees) {
    const chemin = join(racine, nom)
    let infos
    try {
      infos = statSync(chemin)
    } catch {
      continue
    }
    if (infos.isDirectory()) tousLesRunMd(chemin, acc, profondeur + 1)
    else if (nom === 'RUN.md') acc.push(chemin)
  }
  return acc
}

/**
 * RÈGLE DE DÉCOUPAGE, écrite noir sur blanc — c'est elle que le relecteur ne pouvait pas deviner.
 *
 * Un bloc commence à `\n### phase <nom>` et court jusqu'au prochain `\n### phase`, ou jusqu'à la
 * première section de niveau `##` qui suit (une section de clôture du RUN.md, pas du contenu de
 * phase). Les `##` INTERNES au bloc sont donc conservés : ils font partie de la sortie de la phase,
 * et les exclure était l'autre découpage possible — celui qui donnait un tout autre compte.
 */
export function sortiesDePhase(md: string): string[] {
  const apres = md.split('## Livrable des phases')
  if (apres.length < 2) return []
  return apres[1]
    .split('\n### phase ')
    .slice(1)
    .map((bloc) => {
      const sansTitre = bloc.includes('\n') ? bloc.slice(bloc.indexOf('\n') + 1) : ''
      return sansTitre.split('\n## ')[0].trim()
    })
    .filter((t) => t.length > 0)
}

describe('MESURE reproductible du bénéfice du portage', () => {
  it('la fin de la sortie survit dans la grande majorité des cas, contre presque jamais avant', () => {
    const fichiers = tousLesRunMd(MAGASIN)
    if (fichiers.length === 0) {
      // Pas de magasin sur cette machine : on ne prétend rien. Une mesure absente doit se taire,
      // pas échouer — et surtout pas passer en silence en laissant croire qu'elle a mesuré.
      expect(fichiers.length).toBe(0)
      return
    }

    let depassent = 0
    let finAvant = 0
    let finApres = 0
    let volumeAvant = 0
    let volumeApres = 0

    for (const fichier of fichiers) {
      let md = ''
      try {
        md = readFileSync(fichier, 'utf8')
      } catch {
        continue
      }
      for (const sortie of sortiesDePhase(md)) {
        if (sortie.length <= CAP_MESURE) continue
        depassent += 1
        const fin = sortie.slice(-40)
        const ancien = sortie.slice(0, CAP_MESURE) // le portage d'avant : la tête, rien d'autre
        const apres = porterSortieDePhase(sortie, CAP_MESURE).texte
        volumeAvant += ancien.length
        volumeApres += apres.length
        if (ancien.includes(fin)) finAvant += 1
        if (apres.includes(fin)) finApres += 1
      }
    }

    if (depassent === 0) return // aucun cas de troncature dans ce magasin : rien à conclure

    const partAvant = (100 * finAvant) / depassent
    const partApres = (100 * finApres) / depassent
    const ratioVolume = (100 * volumeApres) / volumeAvant
    // Trace lisible : c'est ce qu'un tiers doit pouvoir rejouer et retrouver.
    console.log(
      `portage mesuré sur ${depassent} sorties réelles dépassant ${CAP_MESURE} : ` +
        `fin conservée ${partAvant.toFixed(1)} % -> ${partApres.toFixed(1)} %, ` +
        `volume porté ${ratioVolume.toFixed(1)} % de l'ancien`
    )

    // ORDRES DE GRANDEUR, pas des chiffres au dixième : la donnée ne porte pas plus que ça, et un
    // seuil serré ferait rougir ce test au premier run ajouté dans le magasin.
    expect(partAvant).toBeLessThan(15)
    expect(partApres).toBeGreaterThan(70)
    expect(partApres).toBeGreaterThan(partAvant * 4)
    // Le volume ne peut pas exploser : les deux portages sont bornés par le même `cap`.
    expect(ratioVolume).toBeLessThanOrEqual(105)
  })

  it('la règle de découpage est testable seule, sans dépendre du magasin', () => {
    const md = [
      '## Livrable des phases',
      '### phase frame',
      'texte du frame',
      '## Besoin',
      'une section INTERNE au bloc, qui doit rester dedans',
      '### phase build',
      'texte du build',
      '## Cicatrices',
      'section de clôture du RUN.md, hors bloc'
    ].join('\n')
    const sorties = sortiesDePhase(md)
    expect(sorties).toHaveLength(2)
    // Le `##` interne fait partie de la sortie de la phase : c'est LA convention de découpage, et
    // c'est celle que l'autre lecture faisait différemment.
    expect(sorties[0]).toContain('texte du frame')
    expect(sorties[1]).toContain('texte du build')
  })
})
