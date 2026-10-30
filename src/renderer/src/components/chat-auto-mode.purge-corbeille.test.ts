import { describe, expect, it } from 'vitest'
import { deciderRelanceAuto, suiteAttendUneDonneeUtilisateur } from './chat-auto-mode'
import type { Msg } from './chat-view-types'

/*
 * LE MODE AUTO NE VIDE PAS LA CORBEILLE À LA PLACE DE L'UTILISATEUR (conv-1341, 2026-10-30).
 *
 * Une suite libre ne passe par aucun filtre destructeur, seule une option de question le fait. Or le
 * `/gc` écrit la purge dans ses suites quand il la propose : le 13/10, le mode auto a renvoyé « Purge
 * définitivement les 8 corbeilles gc » tout seul, et l'agent a refusé de l'exécuter. Une consigne n'a
 * pas suffi : les passes des 27, 28 et 30/10 ont toutes réécrit la purge dans leur rubrique Recommandé,
 * celle du 28/10 aussi dans une ligne de suite (conv-1047). Les phrases ci-dessous sont les leurs.
 * Aucune n'est partie sur ce fil. Le mode auto allumé, seul le gras de leur titre, que
 * `extractRecommendation` ne lit pas, aurait retenu celles des 27 et 30/10.
 *
 * Le refus reste ÉTROIT : ce fichier a déjà souffert de règles trop larges (conv-787). Un fil qui
 * travaille sur le code de la corbeille, ou qui supprime autre chose, garde son enchaînement.
 */
const humain = { role: 'user', content: '/gc passe quotidienne' } as Msg
const base = {
  actif: true,
  occupe: false,
  dernierTourTraite: null,
  dernierPromptEnvoye: null,
  brouillonPresent: false
}

const reponse = (texte: string): Msg =>
  ({ role: 'assistant', content: texte, parts: [{ kind: 'text', text: texte }] }) as unknown as Msg

const decider = (texte: string): ReturnType<typeof deciderRelanceAuto> =>
  deciderRelanceAuto({ ...base, fil: [humain, reponse(texte)] })

const parLaRecommandation = (suite: string): ReturnType<typeof deciderRelanceAuto> =>
  decider(`Bilan.\n\n👉 Recommandé : ${suite}`)

const parLaLigneDeSuite = (suite: string): ReturnType<typeof deciderRelanceAuto> =>
  decider(`Bilan.\n\nAUTOWIN_PROMPT_V1: [85] ${suite}`)

const REELLES = [
  'Purge la corbeille du 16/10',
  'Purge définitivement les 8 corbeilles gc du 21 au 28/09',
  'Purger `gc-corbeille/2026-10-16` (6,1 Mo de journaux, rien à mettre à l’abri).',
  'Purger la corbeille du 13/10 sauf la copie d’avant migration, qui sera mise à l’abri.',
  'Purge the 13/10 and 14/10 trash folders, but first move conversations.json.pre-remake.'
]

describe('mode auto — une purge de corbeille attend toujours l’utilisateur', () => {
  it.each(REELLES)('ne part jamais seule : %s', (suite) => {
    const arret = { action: 'arreter', raison: 'suite-attend-utilisateur' }
    expect(suiteAttendUneDonneeUtilisateur(suite)).toBe(true)
    expect(parLaRecommandation(suite)).toMatchObject(arret)
    expect(parLaLigneDeSuite(suite)).toMatchObject(arret)
  })

  it.each([
    'Oui, purge la corbeille du 16/10',
    'Vas-y, vide la corbeille du 16/10',
    'Lance la purge de la corbeille du 16/10',
    'Vider la corbeille',
    'Supprime gc-corbeille/2026-10-16',
    'Efface définitivement gc-corbeille/2026-10-16'
  ])('sous une autre forme non plus : %s', (suite) => {
    expect(suiteAttendUneDonneeUtilisateur(suite)).toBe(true)
  })

  it('une option de purge écartée ne repart pas par la recommandation', () => {
    const question = {
      role: 'assistant',
      content: 'Corbeille du 16/10',
      parts: [
        { kind: 'text', text: 'Bilan.\n\n👉 Recommandé : Purger `gc-corbeille/2026-10-16`.' },
        {
          kind: 'action',
          name: 'ask',
          ok: true,
          data: {
            question: 'Purger la corbeille du 16/10 ?',
            options: ['Oui, purge gc-corbeille/2026-10-16', 'Non, garde']
          }
        }
      ]
    } as unknown as Msg
    expect(deciderRelanceAuto({ ...base, fil: [humain, question] }).action).not.toBe('envoyer')
  })
})

describe('mode auto — ce qui n’est pas une purge de corbeille continue', () => {
  it.each([
    'Supprime ce doublon dans X.ts',
    'Supprime le bouton Corbeille du panneau',
    'Purge le cache du navigateur intégré',
    'Vide le champ de saisie après envoi',
    'Ajoute un test à scripts/gc-purger-corbeilles.mjs',
    'Implémente la purge automatique de la corbeille',
    'Relis le bilan de la corbeille du 16/10'
  ])('part toujours seule : %s', (suite) => {
    expect(suiteAttendUneDonneeUtilisateur(suite)).toBe(false)
    expect(parLaRecommandation(suite)).toMatchObject({ action: 'envoyer' })
    expect(parLaLigneDeSuite(suite)).toMatchObject({ action: 'envoyer' })
  })
})
