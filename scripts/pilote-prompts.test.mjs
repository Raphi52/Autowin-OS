import { describe, it, expect } from 'vitest'
import {
  estRelance,
  nommeUneCible,
  estImperatif,
  lignesDeRubrique,
  ditRien,
  chantiersOuverts,
  profilStyle,
  analyser,
  citationsCode,
  ouvragesDuDocument,
  grosOeuvre
} from './pilote-prompts.mjs'

describe('sonde pilote — lecture du style reel', () => {
  it('ecarte les relances nues qui ne portent aucune demande', () => {
    for (const r of ['go', 'ok', 'reprend', 'vas-y', 'finis', 'oui'])
      expect(estRelance(r)).toBe(true)
    expect(estRelance('Pousse le commit 942f7f2a sur origin/main.')).toBe(false)
  })

  it('reconnait une cible nommee : fichier, commande, conversation, sha', () => {
    expect(nommeUneCible('corrige ChatView.tsx')).toBe(true)
    expect(nommeUneCible('lance `npm run scout:residus`')).toBe(true)
    expect(nommeUneCible('kaizen la conv-30')).toBe(true)
    expect(nommeUneCible('Pousse le commit 942f7f2a sur main')).toBe(true)
    expect(nommeUneCible('marche pas')).toBe(false)
  })

  it('reconnait l imperatif meme sans accents, comme il ecrit', () => {
    expect(estImperatif('enleve ce timeout pour de bon')).toBe(true)
    expect(estImperatif('Vérifie que les appels sont coherents')).toBe(true)
    expect(estImperatif('quand je click sur fusionner ca me reload l app')).toBe(false)
  })

  it('lit une rubrique de cloture et son arret sur « rien »', () => {
    const texte = [
      '✅ Fait — la garde est posee.',
      '📍 Maintenant — vert.',
      '⏳ Reste à faire',
      '- brancher la jauge',
      '👉 Recommandé : rien.'
    ].join('\n')
    expect(lignesDeRubrique(texte, 'Reste à faire')).toEqual(['- brancher la jauge'])
    expect(ditRien(lignesDeRubrique(texte, 'Recommandé'))).toBe(true)
  })

  it('ne retient comme chantier ouvert que du travail REEL', () => {
    const ouvert = {
      id: 'conv-1',
      messages: [
        { role: 'user', content: 'fais X' },
        {
          role: 'assistant',
          content: [
            '⏳ Reste à faire',
            '- brancher la jauge de volume',
            '👉 Recommandé',
            'AUTOWIN_PROMPT_V1: Lance /salvage.'
          ].join('\n')
        }
      ]
    }
    expect(chantiersOuverts(ouvert)).toEqual(['- brancher la jauge de volume'])

    const fini = {
      id: 'conv-2',
      messages: [{ role: 'assistant', content: '⏳ Reste à faire : rien.\n👉 Recommandé : rien.' }]
    }
    expect(chantiersOuverts(fini)).toEqual([])
  })

  it('profile le style sur les vraies demandes, pas sur les relances', () => {
    const p = profilStyle(['go', 'ok', 'corrige ChatView.tsx', 'enleve ce timeout'])
    expect(p.prompts).toBe(4)
    expect(p.relances).toBe(2)
    expect(p.pctImperatif).toBe(100)
    expect(p.pctCibleNommee).toBe(50)
    expect(p.ouverturesTop[0][0]).toMatch(/corrige|enleve/)
  })

  it('ignore les messages d orientation tapes pendant un tour', () => {
    const { style } = analyser([
      {
        id: 'conv-3',
        messages: [
          { role: 'user', content: 'corrige ChatView.tsx' },
          { role: 'user', content: 'non pas ca', orientation: true }
        ]
      }
    ])
    expect(style.prompts).toBe(1)
  })
})

describe('sonde pilote — le gros oeuvre du projet', () => {
  it('ne retient comme citation que du code, pas la prose entre accents graves', () => {
    expect(citationsCode('le verrou est `src/main/hermes-controls.ts` et `runHermes()`')).toEqual([
      'src/main/hermes-controls.ts'
    ])
    expect(citationsCode('lance `npm run scout:pilote`')).toEqual(['npm run scout:pilote'])
    expect(citationsCode('un mot `important` sans extension')).toEqual([])
  })

  it('decoupe un document en ouvrages : titre, but, restes ecrits, code cite', () => {
    const doc = [
      '# Plan de migration',
      '> But : tourner sans hermes.exe.',
      '',
      '## 2. Chantier 1 — Registre natif (VERROU)',
      'Le verrou vit dans `src/main/skill-registry.ts`.',
      '- [ ] brancher le registre natif',
      '- [x] cartographier les appels',
      '',
      '## Notes de lecture',
      'Voir `src/main/index.ts` au passage.'
    ].join(String.fromCharCode(10))
    const o = ouvragesDuDocument('docs/plan.md', doc)
    const titres = o.map((x) => x.titre)
    expect(titres).toContain('Plan de migration')
    expect(titres).toContain('Chantier 1 — Registre natif (VERROU)')
    // Section ordinaire SANS but ni case a cocher : ecartee, meme si elle cite du code.
    expect(titres).not.toContain('Notes de lecture')

    const chantier = o.find((x) => x.titre.startsWith('Chantier 1'))
    expect(chantier.designe).toBe(true)
    expect(chantier.restes).toEqual(['brancher le registre natif'])
    expect(chantier.citations).toEqual(['src/main/skill-registry.ts'])
    expect(o[0].but).toBe('tourner sans hermes.exe.')
  })

  it('classe l ouvrage par ecart mesure sur le depot reel, pas par ordre de lecture', () => {
    const ouvrages = grosOeuvre(process.cwd())
    expect(ouvrages.length).toBeGreaterThan(0)
    // Trie decroissant : c'est ce tri qui decide du chantier choisi par le mode.
    for (let i = 1; i < ouvrages.length; i++)
      expect(ouvrages[i - 1].ecart).toBeGreaterThanOrEqual(ouvrages[i].ecart)
    // Chaque objectif est TRACABLE : un document et une ligne, jamais une impression.
    for (const o of ouvrages) {
      expect(o.document.endsWith('.md')).toBe(true)
      expect(o.ligne).toBeGreaterThan(0)
    }
  })
})
