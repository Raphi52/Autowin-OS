import { describe, expect, it } from 'vitest'
import type { Msg } from './chat-view-types'
import { deciderRelanceAuto, lignesDeRubrique } from './chat-auto-mode'

/*
 * BORNAGE DE LA RUBRIQUE « ⏳ Reste à faire » (conv-787, sondage sur 2970 clotures reelles).
 *
 * Trois defauts mesures, corriges ensemble : la rubrique debordait sur le texte des etapes
 * suivantes ; une seule ligne de fin suffisait a arreter une rubrique qui listait encore du
 * travail ; et plusieurs clotures dans un meme message voyaient leurs rubriques fusionnees.
 */
const humain = { role: 'user', content: 'go' } as Msg
const agent = (t: string): Msg =>
  ({ role: 'assistant', content: t, parts: [{ kind: 'text', text: t }] }) as unknown as Msg
const base = {
  actif: true,
  occupe: false,
  dernierTourTraite: null,
  dernierPromptEnvoye: null,
  brouillonPresent: false
}
const decision = (t: string): ReturnType<typeof deciderRelanceAuto> =>
  deciderRelanceAuto({ ...base, fil: [humain, agent(t)] })

describe('rubrique « Reste à faire » — bornée à elle-même', () => {
  it('ne déborde plus sur l’étape suivante du message', () => {
    const t =
      '⏳ Reste à faire\n- Brancher la vue Tickets\n👉 Recommandé\n- lance le banc\n\n[phase learn]\nRien de plus à dire sur ce point.'
    expect(decision(t)).not.toMatchObject({ raison: 'reste-rien' })
  })
  it('n’arrête pas quand une ligne de fin côtoie du vrai travail', () => {
    const t =
      '⏳ Reste à faire\n- Aucune suite nécessaire côté code\n- Vérifier que SELECT … INTO est refusé\n👉 Recommandé\n- lance le test'
    expect(decision(t)).not.toMatchObject({ raison: 'reste-rien' })
  })
  it('arrête quand la rubrique ENTIÈRE est une fin', () => {
    expect(
      decision('⏳ Reste à faire\n- Aucune suite nécessaire.\n👉 Recommandé\n- lance X')
    ).toMatchObject({
      action: 'arreter',
      raison: 'reste-rien'
    })
  })
  /*
   * L'INTITULÉ « Recommandé » N'ÉTAIT JAMAIS RECONNU (conv-1038, 2026-10-21) : l'expression des
   * intitulés finit par \b, qui ne connaît que les lettres SANS accent — après le « é » final,
   * aucune frontière de mot. La rubrique « Reste à faire » avale donc « 👉 Recommandé » et sa suite.
   * La lecture EXACTE (celle du carnet du fil) la borne. Entrées qui font échouer une version fausse :
   * l'intitulé suivi d'un deux-points, l'intitulé NU, et un mot qui le PROLONGE (« Recommandées »).
   */
  it('lecture exacte : s’arrête à l’intitulé « Recommandé », accent final compris', () => {
    const lire = (t: string, r: 'Reste à faire' | 'Recommandé'): string[] =>
      lignesDeRubrique(t, r, 'exacte')
    expect(lire('⏳ Reste à faire\n- a\n👉 Recommandé : b', 'Reste à faire')).toEqual(['- a'])
    expect(lire('⏳ Reste à faire\n- a\n👉 Recommandé\n- b', 'Reste à faire')).toEqual(['- a'])
    expect(lire('⏳ Reste à faire\n- a\n👉 Recommandé : b', 'Recommandé')).toEqual(['b'])
  })
  it('lecture exacte : un mot qui PROLONGE l’intitulé n’en est pas un', () => {
    expect(
      lignesDeRubrique('⏳ Reste à faire\n- a\n👉 Recommandées : b', 'Reste à faire', 'exacte')
    ).toEqual(['- a', '👉 Recommandées : b'])
  })
  /*
   * CARACTÉRISATION, PAS UN SOUHAIT : la lecture du mode auto garde le défaut tant que son réglage
   * n'est pas tranché (la corriger fait passer reste-rien de 37 à 53 sur le banc réel). Le jour où
   * on la corrige, ce test doit rougir et être réécrit EN MÊME TEMPS que les bornes du banc.
   */
  it('lecture du mode auto : inchangée, la recommandation reste dans « Reste à faire »', () => {
    expect(lignesDeRubrique('⏳ Reste à faire\n- a\n👉 Recommandé : b', 'Reste à faire')).toEqual([
      '- a',
      '👉 Recommandé : b'
    ])
  })
  it('sur plusieurs clôtures dans un message, seule la DERNIÈRE compte', () => {
    const t =
      '⏳ Reste à faire : rien.\n👉 Recommandé : suite.\n\n[phase build]\n⏳ Reste à faire\n- Brancher la vue Tickets\n👉 Recommandé\n- lance le banc'
    expect(decision(t)).not.toMatchObject({ raison: 'reste-rien' })
  })
})

/*
 * PORTE « ✅ Fait » — remesuree apres le bornage (conv-787) : 1 arret sur 2970 clotures reelles, et
 * c'est le bon. Le tour concerne n'avait RIEN produit (« ✅ Fait — rien », un travail anterieur
 * occupait la place). Ses autres lignes sont des CONSTATS (« Aucun fichier modifie », « Rien n'est
 * publie ») qui ne doivent pas arreter la chaine : cette porte reste volontairement au mot NU.
 */
describe('porte « Fait » — mesurée, inchangée', () => {
  it('arrête seulement quand le tour n’a rien produit', () => {
    expect(
      decision('✅ Fait\n- rien\n⏳ Reste à faire\n- tout\n👉 Recommandé\n- lance X')
    ).toMatchObject({
      action: 'arreter',
      raison: 'fait-rien'
    })
  })
  it('ne prend pas un constat pour une fin', () => {
    for (const ligne of [
      'Aucun fichier modifié.',
      'Rien n’est publié.',
      'Aucune branche supprimée.'
    ])
      expect(decision(`✅ Fait\n- ${ligne}\n👉 Recommandé\n- lance le banc`)).not.toMatchObject({
        raison: 'fait-rien'
      })
  })
})
