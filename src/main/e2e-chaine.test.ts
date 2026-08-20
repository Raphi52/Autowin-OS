import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AgentPilot, type PilotEvent } from './agent-pilot'
import { AppCommandBus } from './commands'
import { creerDepotJetable, demonterOs, monterOsReel, type DepotJetable } from './e2e-chaine.harness'
import type {
  ExecutionEvidence,
  Message,
  ProviderAdapter,
  SendOptions,
  SendResult,
  StreamChunk
} from './providers/types'

const CIBLE = 'cible.txt'
const AVANT = 'AVANT\n'
const APRES = 'APRES\n'

/**
 * Le provider simule — le SEUL point de simulation de toute la chaine.
 *
 * Sur un tour de chat (pas d'`options.execution`) il demande une orchestration. Sur une phase
 * d'execution il note ce qu'on lui a donne comme repertoire de travail : c'est cette valeur qui
 * prouve, ou non, que le coordinateur reel a fourni une copie isolee.
 */
class ProviderSimule implements ProviderAdapter {
  readonly id = 'e2e-chaine'
  readonly supportsExecution = true
  /** Tous les repertoires de travail recus en phase d'execution, dans l'ordre. */
  readonly cwdRecus: string[] = []
  /** Vrai si le registre a annonce le cwd comme exclusif a ce run. */
  readonly isolationAnnoncee: boolean[] = []
  toursDeChat = 0
  /** Ce que la copie contient juste apres notre ecriture — la mutation a-t-elle vraiment eu lieu ? */
  contenuLuDansLaCopie?: string
  /** Ce que la BASE contient pendant qu'on mute la copie — l'isolation est-elle reelle ? */
  contenuBasePendantMutation?: string

  constructor(private readonly depotBase: string) {}

  async auth(): Promise<boolean> {
    return true
  }

  // Le contrat impose un generateur ; cette simulation ne rend que sa valeur finale.
  // eslint-disable-next-line require-yield
  async *send(
    _messages: Message[],
    options: SendOptions = {}
  ): AsyncGenerator<StreamChunk, SendResult, void> {
    if (!options.execution) {
      this.toursDeChat += 1
      return this.fin(
        '<cmd>{"name":"orchestrate","args":{"task":"remplace AVANT par APRES dans cible.txt"}}</cmd>'
      )
    }
    this.cwdRecus.push(options.execution.cwd)
    this.isolationAnnoncee.push(options.execution.causallyIsolated === true)
    /**
     * LA mutation, faite pour de vrai dans le repertoire qu'on nous donne.
     *
     * Ecrire ici et non dans le depot de base est tout l'objet du test : si la chaine est branchee,
     * ce chemin est une copie isolee, et l'effet ne remonte a la base que par la fusion du run.
     */
    writeFileSync(join(options.execution.cwd, CIBLE), APRES, 'utf8')
    this.contenuLuDansLaCopie = readFileSync(join(options.execution.cwd, CIBLE), 'utf8')
    this.contenuBasePendantMutation = readFileSync(join(this.depotBase, CIBLE), 'utf8')
    return this.fin('VALIDE', [
      {
        type: 'file_change',
        kind: 'mutation',
        status: 'completed',
        ok: true,
        summary: `${CIBLE} passe a APRES`
      },
      {
        type: 'command_execution',
        kind: 'verification',
        status: 'completed',
        ok: true,
        summary: 'verification du contenu',
        command: 'verifier cible.txt',
        exitCode: 0
      }
    ])
  }

  private fin(text: string, executionEvidence?: ExecutionEvidence[]): SendResult {
    return {
      text,
      provider: this.id,
      systemInjected: false,
      ...(executionEvidence ? { executionEvidence } : {})
    }
  }
}

describe('e2e — du message de chat a la mutation prouvee', () => {
  let jetable: DepotJetable | undefined
  let osCourant: Awaited<ReturnType<typeof monterOsReel>> | undefined
  afterEach(async () => {
    await demonterOs(osCourant, jetable)
    jetable = undefined
    osCourant = undefined
  })

  it('un message de chat mute le depot, par une copie isolee, et l effet remonte', async () => {
    jetable = creerDepotJetable(CIBLE, AVANT)
    const provider = new ProviderSimule(jetable.depot)
    const os = await monterOsReel(jetable.depot, provider)
    osCourant = os

    const conversation = os.conversations.create({
      title: 'e2e chaine complete',
      provider: provider.id
    })
    const diffusions: unknown[] = []
    const bus = new AppCommandBus(os, (evenement) => void diffusions.push(evenement))
    bus.activeConversationId = conversation.id

    const evenements: PilotEvent[] = []
    await new AgentPilot(os.registry, os.roles, bus).chat(
      [{ role: 'user', content: 'Remplace AVANT par APRES dans cible.txt, verifie, puis dis-le.' }],
      (evenement) => void evenements.push(evenement),
      undefined,
      2,
      conversation.id
    )

    // Le tour conversationnel a bien eu lieu et a demande l'orchestration.
    expect(provider.toursDeChat).toBeGreaterThan(0)

    /**
     * LE controle qui a condamne la tentative precedente, exprime en assertion.
     *
     * Recevoir un `cwd` d'execution DISTINCT du depot de base n'est possible que si le coordinateur
     * reel a acquis une copie — donc si la chaine est reellement branchee.
     *
     * MESURE, et non raisonnement. La porte vivante est `beginAsync()`, PAS `begin()` : ce dernier
     * n'est appele que hors mutation, ou quand le prepare asynchrone du manager manque
     * (`run-worktree-coordinator.ts:456`). Une sonde posee dans `beginAsync()` s'affiche bien pendant
     * ce test — `isMutation = true` — et le sabotage de cette meme porte (retour `undefined` pour
     * tout run de mutation) fait tomber cette assertion : `cwdRecus` devient VIDE, les phases
     * d'execution ne partant meme plus. L'assertion discrimine donc ce qu'elle annonce.
     */
    expect(provider.cwdRecus.length).toBeGreaterThan(0)
    for (const cwd of provider.cwdRecus) expect(cwd).not.toBe(jetable.depot)

    /**
     * La mutation a REELLEMENT eu lieu : relue sur disque dans la copie, pas deduite de l'intention
     * du provider. Un test qui croit le producteur sur parole ne prouve pas un effet.
     */
    expect(provider.contenuLuDansLaCopie).toBe(APRES)

    /**
     * L'ISOLATION, mesuree au seul moment ou elle se voit : PENDANT la mutation.
     *
     * Une comparaison de chemins ne prouve rien — deux repertoires differents peuvent tres bien etre
     * le meme depot. Ce qui prouve l'isolation, c'est que la base porte encore l'etat d'AVANT alors
     * que la copie porte deja celui d'APRES, au meme instant.
     */
    expect(provider.contenuBasePendantMutation).toBe(AVANT)

    /**
     * Et l'effet REMONTE : le depot de base porte la valeur d'APRES a la fin du run. C'est ce que
     * l'utilisateur constate — le fichier a change dans SON depot, pas dans une copie qu'il ne voit pas.
     */
    expect(readFileSync(join(jetable.depot, CIBLE), 'utf8')).toBe(APRES)
  }, 180000)
})
