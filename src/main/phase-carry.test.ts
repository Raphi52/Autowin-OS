import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  decouperSections,
  normaliserTitre,
  porterSortieDePhase,
  type PortageResultat
} from './phase-carry'

/** Ce que faisait l'ancien portage. Sert de TÉMOIN : on doit faire au moins aussi bien. */
function ancienPortage(texte: string, cap: number): string {
  return texte.length > cap
    ? `${texte.slice(0, cap)}\n…[tronqué — voir le fil des sous-agents]`
    : texte
}

const CAP = 2000

describe('normaliserTitre', () => {
  it('ignore accents et casse — `Défauts`, `defauts` et `DÉFAUTS` sont le même titre', () => {
    expect(normaliserTitre('Défauts')).toBe(normaliserTitre('defauts'))
    expect(normaliserTitre('DÉFAUTS')).toBe(normaliserTitre('Défauts'))
  })

  it('ne fusionne pas deux titres réellement différents', () => {
    expect(normaliserTitre('Besoin')).not.toBe(normaliserTitre('Verdict'))
  })
})

describe('decouperSections', () => {
  it('rend le corps de chaque section, titre exclu, et dit laquelle est porteuse', () => {
    const sections = decouperSections('## Besoin\nle vrai problème\n\n## Blabla\ndu bruit')
    expect(sections.map((s) => s.titre)).toEqual(['Besoin', 'Blabla'])
    expect(sections[0].corps).toBe('le vrai problème')
    expect(sections[0].porteuse).toBe(true)
    expect(sections[1].porteuse).toBe(false)
  })

  it('reconnaît un titre porteur QUALIFIÉ — « Besoin réel » compte comme un besoin', () => {
    expect(decouperSections('## Besoin réel\nx')[0].porteuse).toBe(true)
    expect(decouperSections('## Décision retenue\nx')[0].porteuse).toBe(true)
  })

  it('ne prend pas un titre qui CONTIENT le mot par hasard', () => {
    // « Contrainte-machin » n'est pas « Contraintes » : le préfixe doit être un MOT.
    expect(decouperSections('## Besoinseux\nx')[0].porteuse).toBe(false)
  })

  it('un texte sans aucun titre rend une liste vide', () => {
    expect(decouperSections('juste de la prose, aucun titre')).toEqual([])
  })
})

describe('sortie qui tient sous la borne', () => {
  it('passe ENTIÈRE, sans avis ni omission', () => {
    const r = porterSortieDePhase('court et complet', CAP)
    expect(r.voie).toBe('entier')
    expect(r.texte).toBe('court et complet')
    expect(r.coupes).toBe(0)
    expect(r.omises).toEqual([])
  })
})

describe('ÉTAGE 1 — la substance structurée passe entière là où le slice la coupait', () => {
  /** Un cadrage réaliste : la décision est À LA FIN, après un long préambule. */
  function cadrageRealiste(): string {
    return [
      '# Analyse',
      'préambule '.repeat(200), // ~2000 caractères de contexte AVANT toute section
      '## Besoin',
      'porter la substance, pas les 2000 premiers caractères',
      '## Décision',
      'option A — projection à deux étages',
      '## Blabla',
      'du remplissage qui ne porte rien ' + 'x'.repeat(500)
    ].join('\n')
  }

  it('transmet Besoin ET Décision, que l’ancien portage jetait tous les deux', () => {
    const texte = cadrageRealiste()
    expect(texte.length).toBeGreaterThan(CAP)

    const ancien = ancienPortage(texte, CAP)
    expect(ancien).not.toContain('option A')
    expect(ancien).not.toContain('porter la substance')

    const r = porterSortieDePhase(texte, CAP)
    expect(r.voie).toBe('sections')
    expect(r.texte).toContain('porter la substance')
    expect(r.texte).toContain('option A — projection à deux étages')
  })

  it('DIT ce qu’il n’a pas transmis, au lieu d’un « tronqué » muet', () => {
    const r = porterSortieDePhase(cadrageRealiste(), CAP)
    expect(r.omises).toContain('Blabla')
    expect(r.texte).toContain('non transmis')
    expect(r.texte).toContain('Blabla')
  })

  it('reste sous la borne — la projection ne devient jamais un prétexte à gonfler', () => {
    const r = porterSortieDePhase(cadrageRealiste(), CAP)
    expect(r.texte.length).toBeLessThanOrEqual(CAP)
  })

  it('annonce une section porteuse trop grosse pour rentrer, au lieu de la taire', () => {
    const texte = [
      '## Besoin',
      'a'.repeat(1500),
      '## Verdict',
      'b'.repeat(1500) // ne peut pas rentrer après le Besoin
    ].join('\n')
    const r = porterSortieDePhase(texte, CAP)
    expect(r.voie).toBe('sections')
    expect(r.omises).toContain('Verdict')
    expect(r.texte).toContain('Verdict')
    expect(r.texte.length).toBeLessThanOrEqual(CAP)
  })
})

describe('ÉTAGE 2 — sans aucune section, on garde les BORDS', () => {
  /** 44,8 % des sorties tronquées mesurées n'ont AUCUN titre : ce cas est la moitié du problème. */
  function proseLongue(): string {
    return `DÉBUT-REPÈRE ${'du raisonnement en prose '.repeat(300)} CONCLUSION-REPÈRE`
  }

  it('garde la tête ET la queue, là où l’ancien portage jetait la conclusion', () => {
    const texte = proseLongue()
    const ancien = ancienPortage(texte, CAP)
    expect(ancien).toContain('DÉBUT-REPÈRE')
    expect(ancien).not.toContain('CONCLUSION-REPÈRE') // le défaut, démontré

    const r = porterSortieDePhase(texte, CAP)
    expect(r.voie).toBe('tete-queue')
    expect(r.texte).toContain('DÉBUT-REPÈRE')
    expect(r.texte).toContain('CONCLUSION-REPÈRE') // le correctif, démontré
  })

  it('dit COMBIEN il a coupé', () => {
    const r = porterSortieDePhase(proseLongue(), CAP)
    expect(r.coupes).toBeGreaterThan(0)
    expect(r.texte).toContain('caractères coupés')
  })

  it('reste sous la borne — le volume porté ne dépasse pas celui d’avant', () => {
    const r = porterSortieDePhase(proseLongue(), CAP)
    expect(r.texte.length).toBeLessThanOrEqual(CAP)
  })

  it('retombe sur les bords quand les seules sections présentes ne portent RIEN', () => {
    const texte = `## Blabla\n${'x'.repeat(3000)}`
    const r = porterSortieDePhase(texte, CAP)
    expect(r.voie).toBe('tete-queue')
  })
})

describe('bornes et cas dégénérés', () => {
  it('un cap absurde rend le texte entier — ne rien porter serait pire que porter trop', () => {
    expect(porterSortieDePhase('abc', 0).voie).toBe('entier')
    expect(porterSortieDePhase('abc', -5).texte).toBe('abc')
    expect(porterSortieDePhase('abc', Number.NaN).texte).toBe('abc')
  })

  it('une sortie vide ne casse rien', () => {
    const r = porterSortieDePhase('', CAP)
    expect(r.texte).toBe('')
    expect(r.voie).toBe('entier')
  })

  it('la borne est respectée sur des caps serrés, quelle que soit la voie', () => {
    for (const cap of [40, 80, 150, 400]) {
      const avecSections: PortageResultat = porterSortieDePhase(
        `## Besoin\n${'a'.repeat(500)}\n## Blabla\n${'b'.repeat(500)}`,
        cap
      )
      expect(avecSections.texte.length).toBeLessThanOrEqual(cap)
      const sansSection = porterSortieDePhase('z'.repeat(500), cap)
      expect(sansSection.texte.length).toBeLessThanOrEqual(cap)
    }
  })
})

/**
 * GARDE STRUCTURELLE — le portage doit rester UN SEUL point de code.
 *
 * Le défaut n'était pas qu'un site soit mal écrit : c'était qu'il y en ait SIX, chacun refaisant son
 * `slice(0, PHASE_CONTEXT_CAP)` et son `…[tronqué]` muet. Corriger la transmission demandait donc six
 * corrections, avec cinq occasions d'en oublier une — et c'est exactement ce qui serait arrivé. Ce
 * test échoue si une SEPTIÈME découpe apparaît, ou si l'une des six revient.
 *
 * Même idiome que la garde de `provider-failure-diagnosis.test.ts` (« CHAQUE appel de provider porte
 * un contexte de rôle ») : on lit la SOURCE, parce que la propriété gardée est structurelle et
 * qu'aucun test de comportement ne la verrait.
 */
describe('garde structurelle — un seul point de portage', () => {
  const source = readFileSync(join(__dirname, 'orchestrator.ts'), 'utf8')

  /**
   * Découpe manuelle sur la borne du PORTAGE, hors commentaires.
   *
   * Volontairement CIBLÉE sur `PHASE_CONTEXT_CAP` : l'agrégat remis au juge a sa propre borne
   * (`JUDGE_PHASE_CAP`) et son propre consommateur — il est hors périmètre de ce chantier. Une garde
   * qui aurait attrapé TOUTE troncature du fichier aurait accusé un site légitime, et une garde qui
   * crie au loup finit débranchée.
   *
   * Les lignes de COMMENTAIRE sont ignorées : ce test s'est d'abord déclenché sur sa propre
   * documentation, qui cite le motif qu'elle interdit.
   */
  function decoupesManuelles(src: string): number[] {
    return src
      .split('\n')
      .map((ligne, i) => ({ ligne, n: i + 1 }))
      .filter(({ ligne }) => {
        const nu = ligne.trim()
        if (nu.startsWith('*') || nu.startsWith('//') || nu.startsWith('/*')) return false
        return /\.slice\(\s*0\s*,\s*PHASE_CONTEXT_CAP\s*\)/.test(ligne)
      })
      .map(({ n }) => n)
  }

  it('aucune découpe manuelle sur PHASE_CONTEXT_CAP ne subsiste dans l’orchestrateur', () => {
    const sites = decoupesManuelles(source)
    expect(sites, `découpes manuelles restantes (lignes) : ${sites.join(', ')}`).toEqual([])
  })

  it('le portage passe bien par la projection, et pas à côté', () => {
    expect(source).toContain("from './phase-carry'")
    expect(source).toContain('porterSortieDePhase(texte, PHASE_CONTEXT_CAP)')
    // Le point unique est réellement APPELÉ, et plus d'une fois : les six sites y convergent.
    const appels = source.split('porterVersPhaseSuivante(').length - 1
    expect(appels).toBeGreaterThanOrEqual(6)
  })

  it('la garde SAIT échouer — sinon elle ne prouve rien', () => {
    const sabote = `${source}\nconst x = texte.slice(0, PHASE_CONTEXT_CAP)\n`
    expect(decoupesManuelles(sabote).length).toBe(1)
  })
})
