import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CARACTERES_MAX_RESULTAT_AFFICHE,
  formatOrchestrationOutcome,
  reconcileClosedOrchestrationText
} from './orchestration-outcome'

/**
 * LA COUPE DE LA BULLE NE TOMBE JAMAIS DANS UN TABLEAU (conv-339).
 *
 * Le /scout « humains ultra quali comme dans Cyberpunk » rendait un tableau de 9 pistes ; la bulle,
 * bornée à 4 000 caractères, en montrait une ligne et demie. Pour un scout, le tableau EST le
 * résultat. La fixture est la sortie RÉELLE de sa dernière étape scout (`run-f085fcccbb82-1.md`).
 */
const sortieScout = readFileSync(
  join(__dirname, '__fixtures__', 'scout-conv-339-sortie.md'),
  'utf8'
)
const lignesDuTableau = (texte: string): string[] =>
  texte.split('\n').filter((ligne) => /^\| *\d/u.test(ligne))
const issue = (result: string): Record<string, unknown> => ({
  status: 'succeeded',
  valid: true,
  gateBlocked: false,
  reused: false,
  runPath: 'C:/runs/conv-339/scout-workspace/RUN.md',
  result
})

describe('bulle bornée : jamais une ligne de tableau coupée, le tableau du scout entier', () => {
  it('la sortie réelle du scout de conv-339 montre ses 9 lignes, aucune coupée au milieu', () => {
    expect(sortieScout.length).toBeGreaterThan(CARACTERES_MAX_RESULTAT_AFFICHE)
    const attendues = lignesDuTableau(sortieScout)
    expect(attendues).toHaveLength(9)
    const texte = formatOrchestrationOutcome(true, issue(sortieScout))
    expect(lignesDuTableau(texte)).toEqual(attendues)
    // La coupe porte sur ce qui suit le tableau : elle reste DITE, et le bilan reste lisible.
    expect(texte).toContain('[tronqué')
    expect(texte).toContain('### Bilan de l')
    expect(texte).toContain('## Cible')
  })

  it('un autre tableau traversé par la coupe perd des lignes ENTIÈRES, jamais une demi-ligne', () => {
    const lignes = Array.from({ length: 40 }, (_, i) => `| ${i + 1} | ${'cellule '.repeat(12)}|`)
    const tableau = ['| # | Texte |', '|---|---|', ...lignes].join('\n')
    const result = `${'intro '.repeat(300)}\n\n${tableau}\n\n${'suite '.repeat(400)}FIN`
    const texte = formatOrchestrationOutcome(true, issue(result))
    const affichees = lignesDuTableau(texte)
    expect(affichees.length).toBeGreaterThan(0)
    expect(affichees.length).toBeLessThan(lignes.length)
    expect(affichees).toEqual(lignes.slice(0, affichees.length))
    expect(texte).not.toContain('FIN')
    expect(texte).toContain('[tronqué')
  })

  /*
   * LE TABLEAU DU SCOUT N'A PAS DE PLAFOND (conv-348, choix de l'utilisateur : « Toujours afficher le
   * tableau du scout en entier, quelle que soit sa longueur »). Le plafond à 3 × la borne coupait le
   * scout de conv-344 après 14 pistes sur 21 ; or la liste de choix sous la bulle se construit sur ce
   * texte (`chat-view-model.ts`, `candidatsDepuisScoutTable`) : les pistes 15 à 21 n'étaient ni lues
   * ni sélectionnables — dont la n°15, l'une des deux réponses à la question de départ du fil.
   */
  it('la sortie réelle du scout de conv-344 montre ses 21 lignes, au-delà de 3 fois la borne', () => {
    const sortie = readFileSync(join(__dirname, '__fixtures__', 'scout-conv-344-sortie.md'), 'utf8')
    expect(sortie.length).toBeGreaterThan(CARACTERES_MAX_RESULTAT_AFFICHE * 3)
    expect(lignesDuTableau(sortie)).toHaveLength(21)
    // Référence = le résultat APRÈS le filtre des affirmations de cycle de vie, qui passe AVANT la
    // borne : il réécrit la ligne 8 de cette sortie (« modification non commitée »). Ce test ne
    // mesure que la coupe ; il n'entérine pas cette réécriture.
    const issueReelle = issue(sortie) as Parameters<typeof reconcileClosedOrchestrationText>[1]
    const attendues = lignesDuTableau(reconcileClosedOrchestrationText(sortie, issueReelle))
    expect(attendues).toHaveLength(21)
    const texte = formatOrchestrationOutcome(true, issue(sortie))
    expect(lignesDuTableau(texte)).toEqual(attendues)
    expect(texte).toContain('### Bilan de l')
  })

  it('un tableau de scout plus long que 3 fois la borne reste entier, la suite seule est coupée', () => {
    const entete = '| # | Score | Type | Quoi | Pourquoi | Comment |\n|---|---|---|---|---|---|'
    const lignes = Array.from(
      { length: 10 },
      (_, i) => `| ${i + 1} | 60 | 🔧 fix | piste ${i + 1} | ${'raison '.repeat(300)}| \`a.ts:1\` |`
    )
    const result = `## Cible\nPiste 1.\n\n${entete}\n${lignes.join('\n')}\n\n${'suite '.repeat(800)}FIN`
    expect(result.length).toBeGreaterThan(CARACTERES_MAX_RESULTAT_AFFICHE * 3)
    const texte = formatOrchestrationOutcome(true, issue(result))
    expect(lignesDuTableau(texte)).toEqual(lignes)
    expect(texte).not.toContain('FIN')
    expect(texte).toContain('[tronqué')
  })

  it('jumeau : un tableau de scout APRÈS la coupe et plus long que 3 fois la borne reste entier', () => {
    const entete = '| # | Score | Type | Quoi | Pourquoi | Comment |\n|---|---|---|---|---|---|'
    const lignes = Array.from(
      { length: 10 },
      (_, i) => `| ${i + 1} | 60 | 🔧 fix | piste ${i + 1} | ${'raison '.repeat(300)}| \`a.ts:1\` |`
    )
    const result = `## Cible\n${'contexte '.repeat(600)}DEBUT-COUPE\n\n${entete}\n${lignes.join('\n')}\n\nFIN`
    const texte = formatOrchestrationOutcome(true, issue(result))
    expect(lignesDuTableau(texte)).toEqual(lignes)
    expect(texte).not.toContain('DEBUT-COUPE')
  })

  it('un tableau scout situé APRÈS la coupe reste affiché entier, le texte d’avant est coupé', () => {
    const avant = `## Cible\n${'contexte '.repeat(600)}DEBUT-COUPE`
    const tableau = lignesDuTableau(sortieScout)
    const entete =
      '| # | Score | Vu par | Type | Quoi | Pourquoi | Comment |\n|---|---|---|---|---|---|---|'
    const result = `${avant}\n\n${entete}\n${tableau.join('\n')}\n\nAPRES-TABLEAU`
    const texte = formatOrchestrationOutcome(true, issue(result))
    expect(lignesDuTableau(texte)).toEqual(tableau)
    expect(texte).not.toContain('DEBUT-COUPE')
    expect(texte).not.toContain('APRES-TABLEAU')
    // Chaque partie omise est comptée, et la somme est exacte : gardé + omis = le résultat entier.
    const omis = [...texte.matchAll(/\[(?:tronqué : )?(\d+) caractères/gu)].map((m) => Number(m[1]))
    expect(omis).toHaveLength(2)
    const tete = texte.slice(texte.indexOf('## Cible'), texte.indexOf('\n…['))
    const tableauAffiche = `${entete}\n${tableau.join('\n')}`
    expect(texte).toContain(tableauAffiche)
    expect(omis[0]! + omis[1]!).toBe(result.length - tete.length - tableauAffiche.length)
  })

  it('jumeau : une coupe qui tombe dans du texte simple reste à la borne, comme avant', () => {
    const tableau = '| # | Texte |\n|---|---|\n| 1 | court |'
    const result = `${tableau}\n\n${'mot '.repeat(2_000)}FIN`
    const texte = formatOrchestrationOutcome(true, issue(result))
    expect(texte).toContain('| 1 | court |')
    expect(texte).not.toContain('FIN')
    const corps = texte.slice(texte.indexOf(tableau))
    expect(corps.indexOf('…[tronqué')).toBeLessThanOrEqual(CARACTERES_MAX_RESULTAT_AFFICHE + 1)
  })
})
