import { describe, expect, it } from 'vitest'
import { exigeUneConclusion } from './chat-turn-messages'

/**
 * LA GARDE DE CLOTURE NE DOIT PAS SE LAISSER TROMPER PAR DEUX MOTS FRANCAIS ORDINAIRES.
 *
 * Mesure conv-44 (2026-09-01), mots de l'utilisateur : « t'as terminé sans me donner le bloc de
 * cloture ». Le tour AVAIT agi et ne portait AUCUNE rubrique — mais `exigeUneConclusion` cherchait
 * `\bfait\b` d'un cote et `recommand` de l'autre, N'IMPORTE OU dans le texte. La phrase de prose
 * « Ma RECOMMANDation du tour precedent etait a cote » + « Je depose le FAIT » suffisait donc a
 * faire croire a un bloc de cloture complet : la garde rendait `false` et le tour se cloturait nu.
 *
 * « fait » et « recommandation » sont des mots courants du francais : les chercher en vrac garantit
 * le faux negatif. Une rubrique se reconnait a sa POSITION (un debut de ligne) ou a son EMOJI,
 * jamais a la simple presence de ses lettres au milieu d'une phrase.
 */
describe('exigeUneConclusion — mots courants vs vraies rubriques', () => {
  it('de la prose contenant « fait » et « recommandation » ne vaut PAS un bloc de cloture', () => {
    const prose =
      "L'historique de `main` confirme ce que tu dis : que des commits directs, aucun message " +
      'de fusion de demande d’intégration. Ma recommandation du tour précédent était donc à côté.\n\n' +
      'Je dépose le fait pour ne plus te le refaire dire.'
    expect(exigeUneConclusion(true, prose)).toBe(true)
  })

  it('une phrase qui parle de ce qui « reste à faire » sans rubrique ne clot pas non plus', () => {
    const prose = 'Le correctif est fait, je te dirai ce qui reste à faire quand j’aurai regardé.'
    expect(exigeUneConclusion(true, prose)).toBe(true)
  })

  it('les vraies rubriques, elles, closent le tour', () => {
    const bloc =
      'Poussé.\n\n## ✅ Fait\n- branche envoyée\n\n## 📍 Maintenant\n- à jour\n\n' +
      '## ⏳ Reste à faire\n- rien\n\n## 👉 Recommandé\n- rien'
    expect(exigeUneConclusion(true, bloc)).toBe(false)
  })

  it('les rubriques sans emoji, en debut de ligne, closent aussi', () => {
    const bloc = 'Livré.\n\nFait : la garde mord.\nReste à faire : rien.\nRecommandé : rien.'
    expect(exigeUneConclusion(true, bloc)).toBe(false)
  })

  it('un tour qui n’a rien fait n’a toujours aucune ceremonie a porter', () => {
    expect(exigeUneConclusion(false, 'Oui, c’est bien ça.')).toBe(false)
  })
})
