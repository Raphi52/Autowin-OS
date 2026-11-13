import { describe, expect, it } from 'vitest'
import type { Msg } from './chat-view-types'
import { deciderRelanceAuto, suiteEstPassive } from './chat-auto-mode'

const agent = (t: string): Msg =>
  ({ role: 'assistant', content: t, parts: [{ kind: 'text', text: t }] }) as unknown as Msg
const humain = (t: string): Msg => ({ role: 'user', content: t }) as Msg
const base = {
  actif: true,
  occupe: false,
  dernierTourTraite: null,
  dernierPromptEnvoye: null,
  brouillonPresent: false
}
const cloture = (suite: string): string =>
  `✅ Fait\n1. Lots lancés.\n📍 Maintenant\n- ils tournent\n⏳ Reste à faire\n- attendre leur fin\n👉 Recommandé\n- ${suite}\n\nAUTOWIN_PROMPT_V1: [85] ${suite}`

/*
 * UNE SUITE QUI DIT « NE FAIS RIEN » N'EST PAS UNE SUITE. Recopiées des envois réels (fil d'un chef
 * de plan, 31/10 07:14 ; fil des pages interactives, 30/10 09:52) : chacune a payé un tour dont la
 * réponse a été « je ne fais rien de plus ici ». Ce qu'elles attendent arrive SANS le mode auto (le
 * réveil du plan, le redémarrage de l'app) : il patiente, armé, et lit la clôture du tour suivant.
 */
const VECUES = [
  "attendre le prochain réveil du plan, aucune action de ta part n'est nécessaire.",
  "Laisser le redémarrage partir seul, sans geste de ta part. Je ne propose pas d'autre point d'étape : chaque relance ici le retarderait d'un tour."
]

describe('suite passive — aucun tour payé pour attendre', () => {
  it('reconnaît les suites vécues', () => {
    for (const suite of VECUES) expect(suiteEstPassive(suite)).toBe(true)
  })

  it('le mode auto patiente, armé, au lieu d’envoyer', () => {
    for (const suite of VECUES)
      expect(deciderRelanceAuto({ ...base, fil: [humain('go'), agent(cloture(suite))] })).toEqual({
        action: 'attendre',
        raison: 'suite-passive'
      })
  })

  // JUMEAUX : une attente SUIVIE d'une action, ou une action qui exclut un geste précis, reste une suite.
  it('laisse passer une attente suivie d’un vrai travail', () => {
    for (const suite of [
      'attendre la fin du build, puis lancer le judge',
      'Laisse tourner le banc et relis ses résultats à la fin',
      'Corrige le test, sans aucune action sur la base de production',
      'Lance le build sans geste destructeur'
    ])
      expect(suiteEstPassive(suite)).toBe(false)
  })
})
