import { describe, expect, it } from 'vitest'
import { parseScoutSuggestions } from './scout-suggestions'

const SCOUT_OUTPUT = `3 jeux proposés :

A — Découverte/onboarding
\`Que peux-tu faire dans cette app ?\` · \`Crée ma première conversation\` · \`Montre-moi les vues disponibles\`

B — Pilotage-agents avancé (score le plus haut)
\`Mets le juge sur codex\` · \`Passe l'orchestrateur en Opus\` · \`Fan-out 3 agents sur ce sujet\`

C — Workflow quotidien
\`Quel est l'état des workflows ?\` · \`Reprends mon dernier RUN\``

describe('parseScoutSuggestions', () => {
  it('parse les groupes A/B/C + leurs chips depuis le markdown scout', () => {
    const groups = parseScoutSuggestions(SCOUT_OUTPUT)
    expect(groups).not.toBeNull()
    expect(groups).toHaveLength(3)
    expect(groups![0]).toMatchObject({ key: 'A', title: 'Découverte/onboarding' })
    expect(groups![0].items.map((i) => i.label)).toEqual([
      'Que peux-tu faire dans cette app ?',
      'Crée ma première conversation',
      'Montre-moi les vues disponibles'
    ])
  })

  it('extrait le sous-titre entre parenthèses', () => {
    const groups = parseScoutSuggestions(SCOUT_OUTPUT)!
    expect(groups[1]).toMatchObject({
      key: 'B',
      title: 'Pilotage-agents avancé',
      subtitle: 'score le plus haut'
    })
  })

  it('le label de chip EST le prompt (envoyé au clic)', () => {
    const groups = parseScoutSuggestions(SCOUT_OUTPUT)!
    expect(groups[2].items[0].label).toBe('Quel est l’état des workflows ?'.replace('’', "'"))
  })

  it('un seul groupe SANS amorce → null (anti-faux-positif)', () => {
    expect(parseScoutSuggestions('A — un truc\n`x` `y`')).toBeNull()
  })

  it('un seul groupe AVEC amorce + ≥2 items → accepté', () => {
    const g = parseScoutSuggestions('Voici des suggestions :\nA — Titre\n`x` · `y`')
    expect(g).not.toBeNull()
    expect(g![0].items).toHaveLength(2)
  })

  it('texte normal (prose sans chips) → null', () => {
    expect(parseScoutSuggestions('Voici mon analyse du problème.\nIl y a deux causes.')).toBeNull()
  })

  it('une réponse ordinaire (prose, diagramme, puces) → null, même avec amorce et ligne « G -- »', () => {
    // conv-1014 : cette réponse a été REMPLACÉE par un groupe « G » de 8 pastilles. « proposer »
    // passait pour l'amorce, la ligne mermaid « G -- oui --> » pour un titre de groupe, et chaque
    // nom de fichier entre accents graves des puces suivantes pour une pastille.
    const reponse = [
      'Je vérifie trois briques avant de proposer les étapes : copies, fusion, fichiers écrits.',
      '',
      '```mermaid',
      'flowchart TD',
      '  E3 --> G{"Gain au-delà du bruit ?"}',
      '  G -- oui --> E4["4. Une copie par sous-tâche + fusion contrôlée"]',
      '```',
      '',
      '**1. Reproduire le trou en rouge.**',
      '- Écrire un test dans `orchestrator.greedy.test.ts`.',
      '- Le plan JSON gagne un champ `fichiers` par sous-tâche.',
      '- On réutilise `worktree-manager.ts` (`merge --abort`).'
    ].join('\n')
    expect(parseScoutSuggestions(reponse)).toBeNull()
  })

  it('un message au format mais suivi de prose → null : rien du texte ne doit disparaître', () => {
    expect(
      parseScoutSuggestions(`${SCOUT_OUTPUT}\n\nJe recommande le jeu B, il couvre le plus de cas.`)
    ).toBeNull()
  })

  it('prose avec une seule inline-code fortuite → null (pas de faux array)', () => {
    expect(
      parseScoutSuggestions('Le fichier `os.ts` contient la logique.\nRegarde la ligne 42.')
    ).toBeNull()
  })
})
