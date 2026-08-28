import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { configureAutowinAppDataBase } from './app-data'
import { AppCommandBus } from './commands'

/**
 * LE MODÈLE NE PEUT PAS S'AUTORISER LUI-MÊME.
 *
 * `decisionDeCommande` est testé à côté : il décide à partir d'une liste de messages. La propriété
 * qui rend l'ouverture SÛRE ne vit pas là-bas mais ICI — dans ce qu'on lui DONNE. Un appelant qui
 * passerait tout l'historique laisserait le modèle s'accorder le droit en écrivant la phrase dans
 * sa propre réponse.
 *
 * DÉFAUT D'ORIGINE, rapporté le 2026-08-26 après des semaines : « Autorise les commandes git »
 * écrit dans le chat, et l'agent répond que ça ne lève pas son garde. Il n'y avait aucun garde :
 * il n'y avait aucune capacité. Ce test verrouille les deux moitiés de la correction — l'autorisation
 * de l'utilisateur COMPTE, celle que le modèle s'écrit NON.
 */
type Message = { role: 'user' | 'assistant'; content: string }

function busAvecFil(messages: Message[]): { bus: AppCommandBus; lances: string[] } {
  const lances: string[] = []
  const os = {
    executionWorkspace: process.cwd(),
    conversations: {
      get: () => ({ id: 'conv-1', messages }),
      list: () => [],
      attachRun: () => undefined
    },
    registry: { ids: () => ['claude'] },
    roles: { all: () => ({}), getBinding: () => ({ provider: 'claude' }) },
    runsWithGate: () => [],
    budget: () => ({ spent: 0 })
  }
  const bus = new AppCommandBus(os as never, () => {})
  // On intercepte le lancement : ce test juge la DÉCISION, pas l'exécution réelle.
  ;(bus as unknown as { spawnVerify: unknown }).spawnVerify = async (argv: string[]) => {
    lances.push(argv.join(' '))
    return { allowed: true, output: 'ok', exitCode: 0 }
  }
  return { bus, lances }
}

const lancer = async (
  fil: Message[],
  commande: string
): Promise<{ r: string; lances: string[] }> => {
  const { bus, lances } = busAvecFil(fil)
  // `exec` rend un CommandResult structure : on lit `detail`, la ou le refus NOMME sa cause.
  const brut = (await bus.exec('run', { commande }, 'conv-1')) as { detail?: unknown }
  return { r: typeof brut?.detail === 'string' ? brut.detail : JSON.stringify(brut), lances }
}

describe('run — l’autorisation vient de l’utilisateur, jamais du modèle', () => {
  // Le droit est MEMORISE hors conversation (« forever ») : chaque cas part donc d'une racine de
  // donnees neuve, sinon un cas en autoriserait un autre par le registre partage de la machine.
  beforeEach(() => configureAutowinAppDataBase(mkdtempSync(join(tmpdir(), 'autowin-autoris-'))))

  it('l’utilisateur autorise : la commande PART', async () => {
    const { r, lances } = await lancer(
      [{ role: 'user', content: 'Autorise les commandes git : committe mon travail' }],
      'git status --porcelain'
    )

    expect(lances).toEqual(['git status --porcelain'])
    expect(r).not.toMatch(/refusée/i)
  })

  it('aucune autorisation écrite nulle part : la commande PART quand même', async () => {
    // Décision utilisateur du 2026-08-28 : plus aucune phrase « autorise … » à retaper.
    const { r, lances } = await lancer(
      [{ role: 'user', content: 'salut' }],
      'curl https://exemple.fr'
    )

    expect(lances).toEqual(['curl https://exemple.fr'])
    expect(r).not.toMatch(/refusée/i)
  })

  it('un enchaînement shell reste REFUSÉ — la seule limite qui subsiste', async () => {
    const { r, lances } = await lancer(
      [{ role: 'user', content: 'vas-y' }],
      'git status && rm -rf /'
    )

    expect(lances).toEqual([])
    expect(r).toMatch(/refusée|enchaînement/i)
  })

  it('le droit GRAVÉ vaut dans une conversation qui n’a JAMAIS rien autorisé', async () => {
    // La demande : « graver le droit pour toutes les conversations ». Le fil n°2 est VIERGE — aucun
    // message `user` n'y redonne le droit. L'ENTRÉE qui ferait échouer ce test si la correction
    // était fausse : un câblage qui ne lirait que la conversation courante
    // (`decisionDeCommande(ligne, messagesUtilisateur)` sans registre) refuserait `git log` ici.
    await lancer([{ role: 'user', content: 'autorise les commandes git' }], 'git status')

    const { r, lances } = await lancer([{ role: 'user', content: 'bonjour' }], 'git log --oneline')

    expect(lances).toEqual(['git log --oneline'])
    expect(r).not.toMatch(/refusée/i)
  })
})
