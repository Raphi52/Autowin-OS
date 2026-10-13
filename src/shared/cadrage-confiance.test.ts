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

describe('hypothesesDuCadrage — texte réel du cadrage SURVBOD (conv-536)', () => {
  const ligne =
    "- `SURVBOD` est déclaré comme processus exécutable dans le menu : **NON VÉRIFIÉ** (c'est en base). Risque : l'accueil afficherait « ne peut pas être directement exécuté » (`FORM_ACCUEIL.cs:1631`). Je le contrôle avec une requête en lecture seule avant la capture finale, ou tu me le confirmes."
  it('ne laisse pas « ** ** » et ne perd rien : l’affirmation, puis la raison entière', () => {
    const [h] = hypothesesDuCadrage(`## Confiance\n${ligne}`)
    expect(h.affirmation).toBe('SURVBOD est déclaré comme processus exécutable dans le menu')
    expect(h.justification?.startsWith("c'est en base. Risque :")).toBe(true)
    expect(h.justification?.endsWith('ou tu me le confirmes.')).toBe(true)
    expect(`${h.affirmation} ${h.justification}`).not.toContain('*')
  })
  it('un texte aberrant est coupé sur un mot, avec une ellipse', () => {
    const [h] = hypothesesDuCadrage(`## Confiance\n- ${'mot '.repeat(300)}NON VÉRIFIÉ`)
    expect(h.affirmation.endsWith('mot…')).toBe(true)
  })
})

describe('citations des lignes VÉRIFIÉ', () => {
  const cadrage = (statut: string): string =>
    ['## Confiance', '| Affirmation | Statut |', '|---|---|', `| le hook existe | ${statut} |`].join('\n')
  const introuvable = (chemin: string): boolean => chemin === 'src/fantome.ts'

  it('reclasse en supposition un VÉRIFIÉ qui cite un fichier inexistant', () => {
    const trouvees = hypothesesDuCadrage(cadrage('VÉRIFIÉ — src/fantome.ts:12'), {
      citationIntrouvable: introuvable
    })
    expect(trouvees).toEqual([
      {
        affirmation: 'le hook existe',
        source: 'confiance',
        justification: 'marquée VÉRIFIÉ mais citation introuvable : src/fantome.ts:12'
      }
    ])
  })

  it('laisse intact un VÉRIFIÉ dont la citation existe', () => {
    expect(
      hypothesesDuCadrage(cadrage('VÉRIFIÉ — src/reel.ts:3'), { citationIntrouvable: introuvable })
    ).toEqual([])
  })

  it('sans contrôleur fourni, le comportement reste celui d’avant', () => {
    expect(hypothesesDuCadrage(cadrage('VÉRIFIÉ — src/fantome.ts:12'))).toEqual([])
  })
})

/*
 * TEXTES REELS des cadrages du 2026-10-13 (run-state live, conv-914 / conv-916). Rejoues sur
 * l'ancien lecteur, 3 cadrages sur 3 affichaient un debris au lieu d'une phrase : « * ** » (la
 * capture envoyee par l'utilisateur, conv-919 : « les phrases écrites ici ont jamais aucun sens »),
 * « * , sans incidence sur la suite :** », « ** :** ». Deux causes : le `*` d'un gras en tete de
 * ligne lu comme une puce, et un EN-TETE « **Non vérifié :** » pris pour une affirmation alors que
 * les affirmations sont les puces qui le suivent.
 */
describe('hypothesesDuCadrage — l’étiquette en EN-TÊTE de liste (forme des cadrages récents)', () => {
  const sansDebris = (h: { affirmation: string; justification?: string }): void => {
    for (const texte of [h.affirmation, h.justification ?? '']) {
      expect(texte).not.toMatch(/\*|`|^[\s:;,.—–-]|NON V[EÉ]RIFI/u)
    }
  }

  it('« **Non vérifié** » seul : ce sont les puces suivantes qui s’affichent, pas « * ** »', () => {
    const trouvees = hypothesesDuCadrage(
      [
        '## Confiance',
        '**Vérifié**',
        '- GitHub : réponse HTTP 200 et `"visibility": "public"`.',
        '',
        '**Non vérifié**',
        '- Un usage de `graph_navigation.py` hors du dépôt, par une tâche planifiée.',
        '',
        '## Options'
      ].join('\n')
    )
    expect(trouvees).toEqual([
      {
        affirmation: 'Un usage de graph_navigation.py hors du dépôt, par une tâche planifiée.',
        source: 'confiance'
      }
    ])
  })

  it('« **NON VÉRIFIÉ, sans incidence sur la suite :** » — le qualificatif devient la raison', () => {
    const trouvees = hypothesesDuCadrage(
      [
        '## Confiance',
        '- 1 juge sur 8 lance un test.',
        '',
        '**NON VÉRIFIÉ, sans incidence sur la suite :**',
        '- les 4 versions et 23 192 caractères de conv-914 ;',
        '- les 3 min 49 de conv-911 ;',
        "- l'ordre entre la fusion (`endAsync`, l.2308) et `learn`, lu en partie seulement ; H2 n'y touche pas.",
        '',
        '## Options'
      ].join('\n')
    )
    expect(trouvees.map((h) => h.affirmation)).toEqual([
      'les 4 versions et 23 192 caractères de conv-914',
      'les 3 min 49 de conv-911',
      "l'ordre entre la fusion (endAsync, l.2308) et learn, lu en partie seulement ; H2 n'y touche pas."
    ])
    for (const h of trouvees) {
      expect(h.justification).toBe('sans incidence sur la suite')
      sansDebris(h)
    }
  })

  it('la liste se ferme sur la ligne suivante qui n’est pas une puce', () => {
    const trouvees = hypothesesDuCadrage(
      [
        '## Confiance',
        '**Non vérifié, à régler pendant la construction :**',
        '- Les tests qui vérifient le texte `D:/GIT/ContosoApp` (`commands.test.ts`).',
        "- L'usage de `graph_navigation.py` en dehors du dépôt.",
        '**Vérifié :**',
        '- Des tests importent déjà des fichiers de `scripts/`.'
      ].join('\n')
    )
    expect(trouvees.map((h) => h.affirmation)).toEqual([
      'Les tests qui vérifient le texte D:/GIT/ContosoApp (commands.test.ts).',
      "L'usage de graph_navigation.py en dehors du dépôt."
    ])
    expect(trouvees[0].justification).toBe('à régler pendant la construction')
  })

  it('en-tête lui-même en puce : seuls ses sous-items sont lus, pas leurs détails', () => {
    const trouvees = hypothesesDuCadrage(
      [
        '## Confiance',
        '- **Non vérifié :**',
        "  - Quels de ces fichiers tournent sur le fil principal pendant l'utilisation.",
        '    - détail technique sous l’item',
        '- **Vérifié :** le fichier existe.'
      ].join('\n')
    )
    expect(trouvees.map((h) => h.affirmation)).toEqual([
      "Quels de ces fichiers tournent sur le fil principal pendant l'utilisation."
    ])
  })

  it('« **Non vérifié :** x. Suite » — la première phrase, la suite en raison', () => {
    const [h] = hypothesesDuCadrage(
      "## Confiance\n**Non vérifié :** que la mosaïque lise la règle par la liste. À contrôler pendant l'écriture du code ; ce n'est pas bloquant.\n"
    )
    expect(h).toEqual({
      affirmation: 'que la mosaïque lise la règle par la liste.',
      source: 'confiance',
      justification: "À contrôler pendant l'écriture du code ; ce n'est pas bloquant."
    })
  })

  it('étiquette en gras au milieu : l’affirmation avant, la raison après, sans « — , »', () => {
    const [h] = hypothesesDuCadrage(
      '## Confiance\n- Le mode auto exécute la suite sans validation humaine — **NON VÉRIFIÉ**, code inaccessible ici ; posé en hypothèse.\n'
    )
    expect(h).toEqual({
      affirmation: 'Le mode auto exécute la suite sans validation humaine',
      source: 'confiance',
      justification: 'code inaccessible ici ; posé en hypothèse.'
    })
  })

  it('« x : NON VÉRIFIÉ. Suite » ne laisse plus « : . »', () => {
    const [h] = hypothesesDuCadrage(
      "## Confiance\n- Test à deux comptes réels : **NON VÉRIFIÉ**. Il faut une place publiée, et c'est le risque principal pour la suite.\n"
    )
    expect(h.affirmation).toBe('Test à deux comptes réels')
    expect(h.justification).toBe(
      "Il faut une place publiée, et c'est le risque principal pour la suite."
    )
  })

  it('une étiquette CITÉE ou un constat d’absence n’est pas une supposition', () => {
    expect(
      hypothesesDuCadrage(
        '## Confiance\nAucune affirmation porteuse ne reste non vérifiée : les deux « non vérifié » sont hors périmètre et hors DoD.\n'
      )
    ).toEqual([])
    expect(
      hypothesesDuCadrage('## Confiance\n- Le mot « NON VÉRIFIÉ » apparaît dans la consigne.\n')
    ).toEqual([])
  })

  it('un sous-titre « ### Non vérifié » reste dans la section Confiance', () => {
    const trouvees = hypothesesDuCadrage(
      [
        '## Confiance',
        '### Vérifié',
        '- le hook existe',
        '### Non vérifié',
        '- le port 8765 est libre'
      ].join('\n')
    )
    expect(trouvees).toEqual([{ affirmation: 'le port 8765 est libre', source: 'confiance' }])
  })
})

describe('hypothesesDuCadrage — ## Besoin : l’annonce part, la liste annoncée est lue', () => {
  it('« Hypothèse écrite : x » ne s’affiche plus « écrite : x »', () => {
    const [h] = hypothesesDuCadrage(
      "## Besoin\n- **Hypothèse écrite** : tu veux la voix **sortante**, pas un simple habillage visuel. Si c'est l'inverse, dis-le, ça change la cible.\n"
    )
    expect(h).toEqual({
      affirmation: 'tu veux la voix sortante, pas un simple habillage visuel.',
      source: 'besoin',
      justification: "Si c'est l'inverse, dis-le, ça change la cible."
    })
  })

  it('« **Hypothèses (corrige-moi) :** » — chaque puce est une hypothèse', () => {
    const trouvees = hypothesesDuCadrage(
      [
        '## Besoin',
        "**Hors périmètre :** l'historique git.",
        '',
        '**Hypothèses (corrige-moi) :**',
        '- « chemin perso » couvre `prenom.nom` et « Prénom NOM ».',
        "- `Raphi52` reste, puisque c'est le nom du dépôt public lui-même.",
        '',
        '**Critères de réussite à vérifier :**',
        '- [ ] Chaque motif interdit donne **0** résultat.'
      ].join('\n')
    )
    expect(trouvees).toEqual([
      {
        affirmation: '« chemin perso » couvre prenom.nom et « Prénom NOM ».',
        source: 'besoin'
      },
      {
        affirmation: "Raphi52 reste, puisque c'est le nom du dépôt public lui-même.",
        source: 'besoin'
      }
    ])
  })

  it('« **Hypothèse** : x » en Confiance ne garde pas son mot d’annonce', () => {
    const [h] = hypothesesDuCadrage(
      '## Confiance\n- **Hypothèse** : les skills scout produisent bien une ligne CIBLE — NON VÉRIFIÉ sur des sorties réelles.\n'
    )
    expect(h.affirmation).toBe('les skills scout produisent bien une ligne CIBLE')
    expect(h.justification).toBe('sur des sorties réelles.')
  })
})
