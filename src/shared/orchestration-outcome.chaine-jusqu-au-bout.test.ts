import { describe, expect, it } from 'vitest'
import { formatOrchestrationOutcome } from './orchestration-outcome'

/**
 * LA CLOTURE DOIT NOMMER LA SUITE JUSQU'AU BOUT DE LA CHAINE — pas seulement apres une analyse.
 *
 * MESURE DU 2026-09-02 (journee entiere, `.autowin-data/<profil>/activity/conv-*.jsonl`) : les
 * tours de rattrapage « kaizen … » ont coute 19,38 $ sur 156,51 $, et deux d'entre eux disent la
 * meme chose — « j'etais en mode auto et t'as pas enchaine le workflow » (conv-131, 12:05 puis
 * 12:15, 6,66 $ a eux deux pour 0,11 $ de travail utile).
 *
 * REJOUE LE DEFAUT, mesure sur la chaine complete : le mode auto renvoie la ligne
 * « 👉 Recommande » de ce bloc. Or `deliveredClosingBlock` ne calculait la suite que pour un run
 * d'ANALYSE. Consequences constatees en rejouant scout → frame → terrain → build → clean → judge :
 *
 *   build  → « Reste a faire : rien. » et « passer a la prochaine demande. »  ⇒ la chaine QUITTE
 *            le pipeline a build : clean et judge ne sont jamais joues.
 *   judge  → « Reste a faire : la suite du pipeline. » et « lancer la phase suivante. »  ⇒ un ordre
 *            sans phase, renvoye en boucle alors que la chaine est FINIE.
 *
 * Ce n'est pas le modele qui derape : ce texte vient d'Autowin. Un gabarit se corrige sans appel.
 */
const livre = (phases: string[]): Parameters<typeof formatOrchestrationOutcome>[1] => ({
  status: 'succeeded',
  valid: true,
  gateBlocked: false,
  reused: false,
  result: 'Le travail de la phase.',
  phaseOutputs: phases.map((phase) => ({ phase, text: `livrable ${phase}` }))
})

describe('une phase de MUTATION nomme aussi ce qui reste', () => {
  it('un build seul envoie vers clean, pas vers « la prochaine demande »', () => {
    const texte = formatOrchestrationOutcome(true, livre(['build']))
    expect(texte).toContain('Reste à faire : clean → judge.')
    expect(texte).toContain('Recommandé : lancer clean.')
    expect(texte).not.toContain('Reste à faire : rien')
  })

  it('un clean seul envoie vers judge', () => {
    const texte = formatOrchestrationOutcome(true, livre(['clean']))
    expect(texte).toContain('Reste à faire : judge.')
    expect(texte).toContain('Recommandé : lancer judge.')
  })
})

describe('la fin de chaîne est une FIN, pas une phase de plus', () => {
  it('après judge, plus aucune phase n’est recommandée', () => {
    const texte = formatOrchestrationOutcome(true, livre(['judge']))
    expect(texte).toContain('Reste à faire : rien.')
    expect(texte).toContain('passer à la prochaine demande')
    expect(texte).not.toContain('lancer la phase suivante')
    expect(texte).not.toContain('la suite du pipeline')
  })

  it('un pipeline complet reste une fin', () => {
    const texte = formatOrchestrationOutcome(true, livre(['frame', 'build', 'clean', 'judge']))
    expect(texte).toContain('Reste à faire : rien.')
  })
})
