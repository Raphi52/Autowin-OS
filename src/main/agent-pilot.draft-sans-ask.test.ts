import { describe, expect, it, vi } from 'vitest'
import { AgentPilot, type PilotEvent } from './agent-pilot'
import type { PromptSnapshot } from './commands'
import { askFaitChoisirUneProposition, boucleDraftEnCours } from './draft-choix-par-boutons'

/**
 * /draft : LE CHOIX SE FAIT PAR LES BOUTONS DU BLOC, JAMAIS PAR `ask`.
 *
 * Demande de l'utilisateur, saisie ts 1792224829875 (conv-302, 2026-10-17) : « faut un bouton pour
 * prompter au lieu du bloc ask ». Le carrousel et ses boutons ont été livrés, et la procédure dit
 * « ne pose PAS de bloc ask sous le carrousel ». Pourtant, le même jour, quatre tours /draft ont fini
 * par un `ask` SANS aucun bloc de choix (journal des tours, aucun ```html-render ni #autowin-prompt) :
 *   - conv-310, tour c7d72274-db73-49bd-93fe-435f6647863a (appel modèle : procédure draft présente) ;
 *   - conv-310, tour 40cbea6c-99bf-405f-8ad6-1e709913766a (réponse « 1 et 3 » au tour précédent) ;
 *   - conv-311, tour 4c898868-7bfa-4535-8300-c2802e61cf10 ;
 *   - conv-312, tour 938a67c1-78bc-4bc5-addf-865167663f44, puis saisie ts 1792247730596 :
 *     « je vois pas le block draft pour faire mon choix ».
 * La règle écrite ne suffisait pas : c'est le pilote qui doit refuser.
 */

const snapshotForPrompt = async (): Promise<PromptSnapshot> => ({
  tab: 'chat',
  providers: [],
  runsBlocked: [],
  conversationsCount: 0
})

const LECTURE = '<cmd>{"name":"read_file","args":{"path":"src/a.ts"}}</cmd>'
const ask = (options: string[]): string =>
  `<cmd>${JSON.stringify({ name: 'ask', args: { question: 'Laquelle ?', options } })}</cmd>`

// Options RELEVÉES dans les tours fautifs (journal des tours de conv-312 et conv-310).
const ASK_CONV_312 = ask([
  'Mélanger la 5 · Scènes de rue et la 4 · Contre-jour (recommandé)',
  'Affiner la 1 · Citadins',
  'Affiner la 2 · Noir néon',
  'Affiner la 3 · Pluie battante'
])
const ASK_CONV_310 = ask([
  '1 · Flaques miroir',
  '4 · Look cinéma',
  '2 · Lumière volumique',
  'Aucun : propose 6 autres moyens'
])
// Une question de CADRAGE, que la procédure exige (étape 1 : technique cible) : elle reste permise.
const ASK_CADRAGE = ask(['Web (Electron)', 'WinForms', 'WPF'])

const roles = {
  getBinding: () => ({ provider: 'codex', model: 'gpt-test', reasoningEffort: 'low' })
}

const piloter = async (
  historique: Array<{ role: 'user' | 'assistant'; content: string }>,
  reponses: string[]
): Promise<{
  appelsModele: number
  envois: string[]
  evenements: PilotEvent[]
  exec: ReturnType<typeof vi.fn>
}> => {
  const restantes = [...reponses]
  let appelsModele = 0
  const envois: string[] = []
  const registry = {
    send: vi.fn(async (_role: unknown, messages: Array<{ content: unknown }>) => {
      appelsModele += 1
      envois.push(JSON.stringify(messages))
      return { text: restantes.shift() ?? 'Fini.', provider: 'codex' }
    }),
    describePrompt: () => ({
      provider: 'codex',
      transport: 'fixture',
      messages: [],
      options: {},
      limitation: 'test'
    })
  }
  const exec = vi.fn().mockResolvedValue({ ok: true, data: { ok: true } })
  const bus = {
    catalog: () =>
      ['ask', 'read_file', 'remember'].map((name) => ({ name, args: {}, description: name })),
    snapshotForPrompt,
    exec
  }
  const evenements: PilotEvent[] = []
  await new AgentPilot(registry as never, roles as never, bus as never).chat(
    historique as never,
    (event) => evenements.push(event),
    undefined,
    4
  )
  return { appelsModele, envois, evenements, exec }
}

const askExecute = (exec: ReturnType<typeof vi.fn>): boolean =>
  exec.mock.calls.some((appel) => appel[0] === 'ask')

describe('/draft : le choix passe par les boutons du bloc, jamais par `ask`', () => {
  it('refuse le `ask` qui fait choisir entre les propositions (tour 938a67c1, conv-312)', async () => {
    const { exec, appelsModele, envois } = await piloter(
      [{ role: 'user', content: "/draft les humains les plus realiste possible pour le fond decran d'accueil" }],
      [LECTURE + ASK_CONV_312, 'Voici le carrousel.']
    )

    expect(askExecute(exec)).toBe(false)
    // Le tour CONTINUE : le modèle reçoit le refus et doit poser le bloc de choix.
    expect(appelsModele).toBeGreaterThan(1)
    expect(envois.at(-1)).toMatch(/draft-carrousel\.mjs/)
  })

  it('refuse aussi sur la réponse libre au tour /draft (« 1 et 3 », tour 40cbea6c, conv-310)', async () => {
    const { exec } = await piloter(
      [
        { role: 'user', content: "/draft des moyens de rendre le fond d'écran de l'acceuil magnifique" },
        { role: 'assistant', content: 'Six moyens.' },
        { role: 'user', content: '1 et 3' }
      ],
      [LECTURE + ASK_CONV_310, 'Voici le carrousel.']
    )

    expect(askExecute(exec)).toBe(false)
  })

  it('refuse encore après plusieurs réponses libres et sur /draft en pleine phrase (conv-1284)', async () => {
    const { exec, appelsModele } = await piloter(
      [
        { role: 'user', content: 'ok balec /draft comment adapter la vue chat' },
        { role: 'assistant', content: 'Six pistes.' },
        { role: 'user', content: 'la 2' },
        { role: 'assistant', content: 'Variantes de la 2.' },
        { role: 'user', content: 'plus sobre' },
        { role: 'assistant', content: 'Variantes.' },
        { role: 'user', content: 'encore' }
      ],
      [LECTURE + ASK_CONV_310, 'Voici le carrousel.']
    )

    expect(askExecute(exec)).toBe(false)
    expect(appelsModele).toBeGreaterThan(1)
  })

  it('refuse après un clic sur un bouton du carrousel (« Affiner la 2 · … »)', async () => {
    const { exec } = await piloter(
      [{ role: 'user', content: 'Affiner la 2 · Noir néon' }],
      [LECTURE + ASK_CONV_312, 'Voici le carrousel.']
    )

    expect(askExecute(exec)).toBe(false)
  })

  it('LAISSE PASSER une question de cadrage pendant /draft (technique cible)', async () => {
    const { exec, appelsModele } = await piloter(
      [{ role: 'user', content: '/draft un écran de réglages pour mon appli' }],
      [LECTURE + ASK_CADRAGE]
    )

    expect(askExecute(exec)).toBe(true)
    expect(appelsModele).toBe(1)
  })

  it('LAISSE PASSER `ask` hors /draft, même avec des options numérotées', async () => {
    const { exec } = await piloter(
      [{ role: 'user', content: 'regarde src/a.ts et propose-moi des pistes' }],
      [LECTURE + ASK_CONV_310]
    )

    expect(askExecute(exec)).toBe(true)
  })

  it('LAISSE PASSER `ask` une fois l’implémentation ordonnée (« Implémenter la 1 · … »)', async () => {
    const { exec } = await piloter(
      [
        { role: 'user', content: '/draft des boutons a chanfrin' },
        { role: 'assistant', content: 'Six directions.' },
        { role: 'user', content: 'Implémenter la 1 · Platine' }
      ],
      [LECTURE + ASK_CONV_310]
    )

    expect(askExecute(exec)).toBe(true)
  })
})

describe('les deux signaux, isolés', () => {
  it('boucleDraftEnCours : /draft invoqué, clic du carrousel, réponse directe ; pas après « Implémenter »', () => {
    expect(boucleDraftEnCours([{ role: 'user', content: 'x' }], 'draft')).toBe(true)
    expect(boucleDraftEnCours([{ role: 'user', content: 'Aucune : propose 6 autres directions' }], undefined)).toBe(true)
    expect(
      boucleDraftEnCours(
        [
          { role: 'user', content: '/Draft des effets pour le texte' },
          { role: 'assistant', content: '…' },
          { role: 'user', content: '1+3+4' }
        ],
        undefined
      )
    ).toBe(true)
    expect(
      boucleDraftEnCours(
        [
          { role: 'user', content: '/draft x' },
          { role: 'user', content: 'implémente la 2' }
        ],
        undefined
      )
    ).toBe(false)
    expect(boucleDraftEnCours([{ role: 'user', content: 'corrige le bug' }], undefined)).toBe(false)
  })

  it('askFaitChoisirUneProposition : les quatre `ask` relevés oui, le cadrage non', () => {
    const options = (cmd: string): unknown => JSON.parse(cmd.slice(5, -6)).args
    expect(askFaitChoisirUneProposition(options(ASK_CONV_312))).toBe(true)
    expect(askFaitChoisirUneProposition(options(ASK_CONV_310))).toBe(true)
    expect(
      askFaitChoisirUneProposition({
        options: [{ libelle: 'Affiner la 7 · Tout' }, { libelle: 'Affiner la 1 · Dépotoir' }]
      })
    ).toBe(true)
    expect(askFaitChoisirUneProposition(options(ASK_CADRAGE))).toBe(false)
  })
})
