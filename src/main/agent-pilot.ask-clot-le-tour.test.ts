import { describe, expect, it, vi } from 'vitest'
import { AgentPilot, type PilotEvent } from './agent-pilot'
import type { PromptSnapshot } from './commands'

/**
 * LE PROBLÈME DE FOND, choisi par l'utilisateur après le défaut vécu dans `conv-1400`.
 *
 * `ask` ne suspendait rien : la commande rendait la question et le pilote enchaînait son itération
 * suivante. La conversation restait donc OCCUPÉE, et répondre passait par une DIRECTIVE — affichée
 * « ORIENTÉ », avec un composer bloqué sur « Orienter l'agent sans l'interrompre ». L'utilisateur
 * répondait à une question et le système enregistrait une orientation.
 *
 * Toute cette gymnastique n'existait que parce qu'un `ask` ne terminait pas le tour. L'agent vient de
 * dire qu'il lui manque une entrée : son tour est fini, c'est celui de l'utilisateur.
 *
 * On ne fait attendre PERSONNE — pas de run suspendu, pas de délai, pas d'échappatoire. C'est la
 * différence avec « suspendre » : le même résultat observable, sans état d'attente à surveiller.
 */

const snapshotForPrompt = async (): Promise<PromptSnapshot> => ({
  tab: 'chat',
  providers: [],
  runsBlocked: [],
  conversationsCount: 0
})

const ASK = '<cmd>{"name":"ask","args":{"question":"Je corrige ?","options":["Oui","Non"]}}</cmd>'
const LECTURE = '<cmd>{"name":"read_file","args":{"path":"src/a.ts"}}</cmd>'

const roles = {
  getBinding: () => ({ provider: 'codex', model: 'gpt-test', reasoningEffort: 'low' })
}

/** Un pilote dont on observe les appels au modèle et au bus. */
const piloter = async (
  reponses: string[],
  catalogue = ['ask', 'read_file', 'remember']
): Promise<{ appelsModele: number; evenements: PilotEvent[]; exec: ReturnType<typeof vi.fn> }> => {
  const restantes = [...reponses]
  let appelsModele = 0
  const registry = {
    send: vi.fn(async () => {
      appelsModele += 1
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
    catalog: () => catalogue.map((name) => ({ name, args: {}, description: name })),
    snapshotForPrompt,
    exec
  }
  const evenements: PilotEvent[] = []
  await new AgentPilot(registry as never, roles as never, bus as never).chat(
    [{ role: 'user', content: 'regarde src/a.ts puis dis-moi' }],
    (event) => evenements.push(event),
    undefined,
    4
  )
  return { appelsModele, evenements, exec }
}

describe('une question clôt le tour', () => {
  it('ne redemande RIEN au modèle après une question posée sur une lecture', async () => {
    // Une lecture précède la question : la garde « question sans lecture » n'a donc rien à redire,
    // et le tour doit se fermer là.
    const { appelsModele } = await piloter([LECTURE + ASK, 'Suite que personne ne doit voir.'])

    expect(appelsModele).toBe(1)
  })

  it('DIT quelque chose en se fermant — jamais de bulle vide', async () => {
    // Défaut connu (`conv-1141`) : un tour qui a agi sans rien dire laissait une bulle vide, et
    // l'utilisateur renvoyait le même prompt en boucle sans savoir ce qui ratait.
    const { evenements } = await piloter([LECTURE + ASK])

    const fin = evenements.filter((event) => event.kind === 'done')
    expect(fin).toHaveLength(1)
    expect(fin[0].kind === 'done' ? fin[0].text.trim() : '').not.toBe('')
  })

  it('exécute QUAND MÊME le travail de la même itération avant de fermer', async () => {
    // On clôt APRÈS le travail, on ne l'annule pas : le modèle peut poser une question et avoir
    // produit du travail utile dans le même souffle.
    const { exec } = await piloter([LECTURE + ASK])

    expect(exec.mock.calls.map((appel) => appel[0])).toContain('read_file')
    expect(exec.mock.calls.map((appel) => appel[0])).toContain('ask')
  })

  it('RELANCE au lieu de fermer quand la question arrive sans avoir rien lu', async () => {
    // L'ENTRÉE QUI DOIT FAIRE ÉCHOUER UNE CLÔTURE POSÉE TROP TÔT. La garde « question sans lecture »
    // vit dans la branche SANS commande : fermer sans la consulter la rendrait INATTEIGNABLE, et on
    // aurait échangé un défaut contre un autre.
    const { appelsModele } = await piloter([ASK, 'Bon, je lis d’abord.'])

    expect(appelsModele).toBeGreaterThan(1)
  })

  it('ne ferme pas un tour SANS question — le cas ordinaire est intact', async () => {
    const { appelsModele } = await piloter([LECTURE, 'Voici ce que dit le fichier.'])

    expect(appelsModele).toBe(2)
  })
})
