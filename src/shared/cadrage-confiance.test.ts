import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  hypothesesDuCadrage,
  noteHypothesesPourJuge,
  PLAFOND_HYPOTHESES
} from './cadrage-confiance'

const cadrage = `## Besoin
Le bloc ask doit devenir lisible d'un coup d'œil.
- Hypothèse : le contrat de donnée peut changer sans casser les conversations persistées.
- [ ] DoD : un test rend une ligne par réponse.

## Contraintes
HARD : thème sombre existant.

## Confiance
- Le composant vit dans src/renderer/src/components/ask-choices.ts — VÉRIFIÉ (lu, ligne 20)
- L'utilisateur veut éviter les pilules côte à côte — DE L'UTILISATEUR
- Le sanitizeur refuse les contrôles dans le HTML du modèle — NON VÉRIFIÉ
- NON VÉRIFIÉ : aucune autre vue ne réutilise SuggestionGrid pour un choix
`

describe('hypothesesDuCadrage — ne remonte que ce que le cadrage a DÉCLARÉ non vérifié', () => {
  it('retient les affirmations NON VÉRIFIÉ et laisse celles qui portent une autorité', () => {
    const trouvees = hypothesesDuCadrage(cadrage)
    expect(trouvees.map((h) => h.source)).toEqual(['besoin', 'confiance', 'confiance'])
    expect(trouvees[1].affirmation).toBe(
      'Le sanitizeur refuse les contrôles dans le HTML du modèle'
    )
    // Le VÉRIFIÉ et le DE L'UTILISATEUR ne sont jamais repris.
    const texte = trouvees.map((h) => h.affirmation).join(' | ')
    expect(texte).not.toContain('ask-choices.ts')
    expect(texte).not.toContain('pilules')
  })

  it('retire l’étiquette, la puce et la ponctuation orpheline', () => {
    const trouvees = hypothesesDuCadrage('## Confiance\n- NON VÉRIFIÉ : le port 8765 est libre\n')
    expect(trouvees).toEqual([{ affirmation: 'le port 8765 est libre', source: 'confiance' }])
  })

  it('« NON VÉRIFIÉ » ne compte JAMAIS comme vérifié — l’inversion du signal', () => {
    // Le piège : chercher `VÉRIFIÉ` seul matcherait l'intérieur de « NON VÉRIFIÉ ».
    expect(hypothesesDuCadrage('## Confiance\n- la clé existe — NON VERIFIE\n')).toHaveLength(1)
    expect(hypothesesDuCadrage('## Confiance\n- la clé existe — VÉRIFIÉ (grep)\n')).toHaveLength(0)
  })

  it('accepte les variantes qu’un modèle écrit vraiment', () => {
    for (const etiquette of ['NON VÉRIFIÉ', 'non verifie', 'NON-VÉRIFIÉE', 'Non Vérifiés']) {
      expect(hypothesesDuCadrage(`## Confiance\n- x — ${etiquette}\n`)).toHaveLength(1)
    }
  })

  it('ne lit que les sections Besoin et Confiance', () => {
    const ailleurs = '## Options\n- NON VÉRIFIÉ : une option scorée\n'
    expect(hypothesesDuCadrage(ailleurs)).toEqual([])
  })

  it('pas de section, pas d’étiquette ⇒ liste vide, jamais une hypothèse fabriquée', () => {
    expect(hypothesesDuCadrage('un cadrage en prose, sans section ni étiquette')).toEqual([])
    expect(hypothesesDuCadrage('')).toEqual([])
    expect(hypothesesDuCadrage(undefined)).toEqual([])
    expect(hypothesesDuCadrage({ texte: 'x' })).toEqual([])
  })

  it('dédoublonne et plafonne', () => {
    const repetee = [
      '## Confiance',
      ...Array.from({ length: 9 }, (_, i) => `- item ${i} — NON VÉRIFIÉ`)
    ].join('\n')
    expect(hypothesesDuCadrage(repetee)).toHaveLength(PLAFOND_HYPOTHESES)
    const doublon = '## Confiance\n- la clé existe — NON VÉRIFIÉ\n- La Clé Existe — NON VÉRIFIÉ\n'
    expect(hypothesesDuCadrage(doublon)).toHaveLength(1)
  })

  it('une hypothèse de ## Besoin est reprise sans son mot d’annonce', () => {
    const trouvees = hypothesesDuCadrage(
      '## Besoin\n- Hypothèse : le store est vide au premier lancement\n'
    )
    expect(trouvees).toEqual([
      { affirmation: 'le store est vide au premier lancement', source: 'besoin' }
    ])
  })
})

describe('noteHypothesesPourJuge — le juge doit CONFRONTER, pas encaisser un postulat', () => {
  const hypotheses = [
    { affirmation: 'le sanitizeur refuse les contrôles', source: 'confiance' as const },
    { affirmation: 'le store est vide au premier lancement', source: 'besoin' as const }
  ]

  it('nomme chaque supposition', () => {
    const note = noteHypothesesPourJuge(hypotheses)
    expect(note).toContain('- le sanitizeur refuse les contrôles')
    expect(note).toContain('- le store est vide au premier lancement')
  })

  it('demande une VÉRIFICATION, sans conclure à la place du juge', () => {
    const note = noteHypothesesPourJuge(hypotheses)
    expect(note).toMatch(/verifie-la avec tes outils/u)
    // Le piège : remettre au juge une conclusion déjà tirée revient à lui faire tamponner un
    // postulat. La note doit dire l'inverse, explicitement.
    expect(note).toMatch(/ne conclus\s+pas qu'une supposition est fausse/u)
  })

  it('impose de dire une supposition non tranchable, jamais de la taire', () => {
    expect(noteHypothesesPourJuge(hypotheses)).toMatch(/objection, jamais en silence/u)
  })

  it('aucune supposition ⇒ note vide : rien n’est ajouté au prompt pour rien', () => {
    expect(noteHypothesesPourJuge([])).toBe('')
  })
})

/*
 * LE TEXTE REEL, copie du run `run-f7293debbd3b-1` (store live, 20/08). Le lecteur travaillait ligne
 * par ligne et rendait « | Etat vert/rouge actuel de la suite | — non executable... | » : illisible,
 * vu par l'utilisateur dans l'application. Cette fixture est la forme que le modele emet vraiment.
 */
const CONFIANCE_EN_TABLEAU = `## Confiance

| Affirmation | Statut |
|---|---|
| \`workflowIssues\` accepte déjà \`skillsConnues\` (défaut \`[]\`) | VÉRIFIÉ — \`workflow-executability.ts:54-69\` lu |
| Les 3 appelants l'appellent à 1 argument | VÉRIFIÉ — grep : \`WorkflowProfilesView.tsx:432\` |
| État vert/rouge actuel de la suite | NON VÉRIFIÉ — non exécutable en FRAME ; premier geste de BUILD (baseline) |
| Le run \`briques-workflows-skills-libres\` est la source de cet état | NON VÉRIFIÉ — hypothèse H1, sans impact sur le périmètre |

Aucun choix d'approche n'est engagé.
`

describe('hypothesesDuCadrage — la forme TABLEAU, celle que le modèle émet vraiment', () => {
  it('rend l’affirmation seule, sans barres verticales ni fragment de cellule', () => {
    const trouvees = hypothesesDuCadrage(CONFIANCE_EN_TABLEAU)
    expect(trouvees).toHaveLength(2)
    expect(trouvees[0].affirmation).toBe('État vert/rouge actuel de la suite')
    expect(trouvees[1].affirmation).toBe(
      'Le run briques-workflows-skills-libres est la source de cet état'
    )
    for (const hypothese of trouvees) {
      expect(hypothese.affirmation).not.toContain('|')
      expect(hypothese.affirmation).not.toContain('`')
      expect(hypothese.affirmation).not.toMatch(/VÉRIFIÉ/u)
    }
  })

  it('met la RAISON du modèle dans la justification — pas une phrase toute faite', () => {
    const trouvees = hypothesesDuCadrage(CONFIANCE_EN_TABLEAU)
    expect(trouvees[0].justification).toBe(
      'non exécutable en FRAME ; premier geste de BUILD (baseline)'
    )
    expect(trouvees[1].justification).toBe('hypothèse H1, sans impact sur le périmètre')
    // Deux lignes, deux raisons DIFFERENTES : un dépliable identique partout n'apprendrait rien.
    expect(trouvees[0].justification).not.toBe(trouvees[1].justification)
  })

  it('écarte l’en-tête et la ligne de séparation du tableau', () => {
    const trouvees = hypothesesDuCadrage(CONFIANCE_EN_TABLEAU)
    const textes = trouvees.map((h) => h.affirmation).join(' | ')
    expect(textes).not.toContain('Affirmation')
    expect(textes).not.toContain('Statut')
    expect(textes).not.toMatch(/^-+$/u)
  })

  it('ne reprend AUCUNE ligne vérifiée du tableau', () => {
    const trouvees = hypothesesDuCadrage(CONFIANCE_EN_TABLEAU)
    const textes = trouvees.map((h) => h.affirmation).join(' | ')
    expect(textes).not.toContain('workflowIssues')
    expect(textes).not.toContain('3 appelants')
  })

  it('un tableau sans colonne de raison ne fabrique pas de justification vide', () => {
    const sansRaison = [
      '## Confiance',
      '| Affirmation | Statut |',
      '|---|---|',
      '| le port est libre | NON VÉRIFIÉ |'
    ].join('\n')
    const trouvees = hypothesesDuCadrage(sansRaison)
    expect(trouvees).toEqual([{ affirmation: 'le port est libre', source: 'confiance' }])
  })
})

describe('le module ne contient aucun caractere de controle', () => {
  /*
   * Dix fois le meme piege dans la journee du 20/08 : un `` destine a une frontiere de mot,
   * ecrit a travers une couche d'echappement, arrive en CARACTERE BACKSPACE (0x08) dans le source.
   * Le regex exige alors un backspace litteral et ne matche jamais — invisible au typecheck, a
   * eslint et a la relecture, puisque le caractere ne s'affiche pas. Ce test le voit.
   */
  it('aucun 0x08 ni autre caractere invisible dans le source', () => {
    const source = readFileSync('src/shared/cadrage-confiance.ts', 'utf8')
    const invisibles = [...source].filter((c) => {
      const code = c.codePointAt(0) ?? 0
      return code < 32 && c !== String.fromCharCode(10) && c !== String.fromCharCode(13)
    })
    expect(invisibles.map((c) => (c.codePointAt(0) ?? 0).toString(16))).toEqual([])
  })
})
