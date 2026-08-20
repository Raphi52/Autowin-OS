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
 * Ce que l'app ÉCRIT dans le RUN.md, et donc la borne à laquelle un bloc s'arrête forcément.
 *
 * `populateConvRunSections` (`runs/conv-runs.ts`) écrit `### phase <nom>\n${p.text.slice(0, 2000)}`
 * par phase, joints par une ligne vide. Au-delà de 2000 caractères, ce qu'on lit dans un bloc
 * n'appartient donc PLUS à la sortie de phase : c'est la suite du document.
 */
const BORNE_ECRITURE = 2000

/**
 * RÈGLE DE DÉCOUPAGE, écrite noir sur blanc — c'est elle que le relecteur ne pouvait pas deviner.
 *
 * Un bloc commence après `\n### phase <nom>\n` et court jusqu'au prochain `\n### phase `, borné à
 * `BORNE_ECRITURE` puisque c'est tout ce que l'app a pu écrire. Les titres `##` INTERNES sont
 * CONSERVÉS : ils font partie de la sortie de la phase, et un RUN.md réel en contient (une sortie de
 * build porte son propre `## Défauts`).
 *
 * CE COMMENTAIRE DISAIT DÉJÀ CELA, ET LE CODE FAISAIT L'INVERSE. Il coupait à
 * `split('\n## ')[0]`, donc au PREMIER titre interne — amputant précisément les sorties
 * STRUCTURÉES, celles que l'étage 1 du portage existe pour servir. Mesuré sur un RUN.md réel : une
 * sous-tâche de 2001 caractères n'en rendait que 768. Un relecteur externe l'a trouvé ; le test
 * unitaire de cette fonction ne pouvait pas, il n'assertait qu'un `toContain` sur la première ligne.
 *
 * IMPRÉCISION RÉSIDUELLE, ASSUMÉE : pour le DERNIER bloc, rien ne distingue syntaxiquement un `##`
 * interne à la sortie d'un `##` de clôture du RUN.md — les deux s'écrivent pareil. Un dernier bloc
 * peut donc embarquer le début de la section suivante. C'est une propriété de la DONNÉE, pas du
 * code : le RUN.md est un rendu LOSSY des sorties de phase. C'est exactement l'ambiguïté qui faisait
 * qu'un relecteur retrouvait 200 ou 1028 sorties selon sa lecture. On la borne (`BORNE_ECRITURE`) et
 * on la déclare, au lieu de prétendre à une règle propre qui n'existe pas.
 */
export function sortiesDePhase(md: string): string[] {
  const apres = md.split('## Livrable des phases')
  if (apres.length < 2) return []
  return apres[1]
    .split('\n### phase ')
    .slice(1)
    .map((bloc) => {
      const sansTitre = bloc.includes('\n') ? bloc.slice(bloc.indexOf('\n') + 1) : ''
      return sansTitre.slice(0, BORNE_ECRITURE).trim()
    })
    .filter((t) => t.length > 0)
}

describe('MESURE reproductible du bénéfice du portage', () => {
  it('la fin de la sortie survit dans la grande majorité des cas, contre presque jamais avant', (ctx) => {
    const fichiers = tousLesRunMd(MAGASIN)
    if (fichiers.length === 0) {
      // SAUTÉ, pas vert. Ce test passait en SILENCE quand le magasin est absent (machine tierce, CI)
      // — donc il comptait comme une preuve en n'ayant rien mesuré. C'est exactement le faux vert
      // que ce chantier passe sa journée à traquer, et il était dans mon propre test.
      ctx.skip()
      return
    }

    let depassent = 0
    let finAvant = 0
    let finApres = 0
    let volumeAvant = 0
    let volumeApres = 0
    // Répartition des voies : elle DIT si l'étage 1 (sections) sert réellement, ou si la moitié du
    // module ne se déclenche jamais. Une mesure qui ne la publie pas laisse la question ouverte.
    let voieSections = 0
    let voieBords = 0

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
        const porte = porterSortieDePhase(sortie, CAP_MESURE)
        volumeAvant += ancien.length
        volumeApres += porte.texte.length
        if (ancien.includes(fin)) finAvant += 1
        if (porte.texte.includes(fin)) finApres += 1
        if (porte.voie === 'sections') voieSections += 1
        if (porte.voie === 'tete-queue') voieBords += 1
      }
    }

    // Magasin présent mais aucune sortie ne dépasse le cap : rien à conclure, et on le dit en
    // SAUTANT plutôt qu'en rendant un vert qui ne repose sur rien.
    if (depassent === 0) {
      ctx.skip()
      return
    }

    const partAvant = (100 * finAvant) / depassent
    const partApres = (100 * finApres) / depassent
    const ratioVolume = (100 * volumeApres) / volumeAvant
    // Trace lisible : c'est ce qu'un tiers doit pouvoir rejouer et retrouver.
    console.log(
      `portage mesuré sur ${depassent} sorties réelles dépassant ${CAP_MESURE} : ` +
        `fin conservée ${partAvant.toFixed(1)} % -> ${partApres.toFixed(1)} %, ` +
        `volume porté ${ratioVolume.toFixed(1)} % de l'ancien, ` +
        `voies sections/bords ${voieSections}/${voieBords}`
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
    expect(sorties[0]).toContain('texte du frame')
    expect(sorties[1]).toContain('texte du build')

    // L'ASSERTION QUI MANQUAIT. Ce test n'avait qu'un `toContain` sur la première ligne de chaque
    // bloc — donc il passait aussi bien avec un découpage qui coupait au premier `##` interne
    // qu'avec un qui les gardait, alors que ce fichier existe PRÉCISÉMENT pour départager ces deux
    // lectures. Un test incapable de distinguer les deux hypothèses qu'il prétend arbitrer ne prouve
    // rien : c'est comme ça qu'un commentaire a pu affirmer le contraire du code pendant un cycle.
    expect(sorties[0]).toContain('## Besoin')
    expect(sorties[0]).toContain('une section INTERNE au bloc, qui doit rester dedans')
  })

  it("la règle est bornée par ce que l'app a pu ÉCRIRE, pas par un titre rencontré", () => {
    // Un bloc unique dont le corps dépasse largement la borne d'écriture : tout ce qui suit les
    // 2000 premiers caractères n'appartient pas à la sortie de phase, c'est la suite du document.
    const md = `## Livrable des phases\n### phase build\n${'a'.repeat(2500)}`
    const [sortie] = sortiesDePhase(md)
    expect(sortie.length).toBeLessThanOrEqual(2000)
  })
})
