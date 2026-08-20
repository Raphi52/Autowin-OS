import { describe, expect, it } from 'vitest'
import { hypothesesDuCadrage, PLAFOND_HYPOTHESES } from './cadrage-confiance'

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
