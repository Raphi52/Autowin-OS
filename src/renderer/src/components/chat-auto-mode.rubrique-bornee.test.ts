import { describe, expect, it } from 'vitest'
import type { Msg } from './chat-view-types'
import { deciderRelanceAuto } from './chat-auto-mode'

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
