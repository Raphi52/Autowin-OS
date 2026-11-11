import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { ConversationStore } from '../store/conversations'
import { attendreEcrituresJournal, readTurnJournal } from '../runs/turn-journal'
import {
  createRunPilotChat,
  type DirectChatRecovery,
  type RunPilotChatDeps
} from './run-pilot-chat'

/**
 * LE JOURNAL D'UN VRAI TOUR ÉCRIT LA PENSÉE PAR RAFALE, À SA PLACE ENTRE LES GESTES.
 *
 * Mesuré le 2026-11-02 sur les journaux * : 355 683 lignes `reasoning-step` (55 % du poids),
 * une par paquet reçu du modèle. Le regroupement vit dans `journalDuPiloteRegroupe` ; ce test prouve
 * son BRANCHEMENT dans le tour : vrai stockage, vrai journal fichier, faux modèle qui pense en
 * miettes, agit, puis repense.
 *
 * Ce qui ferait échouer une version fausse : 5 lignes de pensée au lieu de 2 (pas de tampon), ou la
 * première rafale écrite APRÈS la commande (tampon vidé après l'écriture durable, ou à la fin).
 */
vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
  app: { getPath: () => '', isPackaged: false, getVersion: () => '0.0.0' }
}))
// Les événements « pilot:event » envoyés à l'écran en direct : le test du décodage lit leur genre.
// fix-ok: sous le genre reasoning, le décodage rejoindrait la pensée générale à l'écran : il part donc sous look-decode.
const direct = vi.hoisted(() => ({ evenements: [] as Array<{ kind: string; text?: string }> }))
vi.mock('../app/renderer-emit', () => ({
  emitToLiveWindows: (
    _fenetres: unknown,
    canal: string,
    charge: { kind: string; text?: string }
  ) => {
    if (canal === 'pilot:event') direct.evenements.push(charge)
    return undefined
  }
}))

/** Un objet qui accepte tout appel et rend un autre objet du même genre (dépendances non observées). */
function souple(): never {
  const fn = (): unknown => souple()
  return new Proxy(fn, {
    get: (_cible, cle) => {
      if (cle === 'then') return undefined
      if (cle === Symbol.iterator) return () => [][Symbol.iterator]()
      if (cle === Symbol.toPrimitive) return () => ''
      return souple()
    },
    apply: () => souple()
  }) as never
}

const avecRepli = <T extends object>(propres: T): T =>
  new Proxy(propres, {
    get: (cible, cle) => (cle in cible ? cible[cle as keyof T] : souple())
  })

describe('tour de chat — la pensée regroupée dans le journal fichier', () => {
  it('deux rafales, chacune à sa place autour de la commande', async () => {
    let t = 1000
    const store = new ConversationStore(() => t++)
    const fil = store.create({ title: 'J', provider: 'codex' })
    const racine = mkdtempSync(join(tmpdir(), 'autowin-journal-raisonnement-'))
    try {
      const pilot = {
        chat: vi.fn(async (_messages: unknown, surEvenement: (e: unknown) => void) => {
          for (const morceau of ['Je ', 'lis ', 'le fichier'])
            surEvenement({ kind: 'reasoning', text: morceau, iteration: 0 })
          surEvenement({
            kind: 'command',
            actionId: 'a1',
            name: 'read_file',
            args: { path: 'x' },
            iteration: 0
          })
          surEvenement({
            kind: 'result',
            actionId: 'a1',
            name: 'read_file',
            ok: true,
            iteration: 0
          })
          for (const morceau of ['Je ', 'conclus'])
            surEvenement({ kind: 'reasoning', text: morceau, iteration: 1 })
          surEvenement({ kind: 'delta', streamId: '1:0', text: 'Fini.', iteration: 1 })
          surEvenement({ kind: 'done', text: 'Fini.' })
          return { text: 'Fini.' }
        })
      }
      const os = avecRepli({
        waitUntilReady: async () => {},
        roles: { bindingDesPetitesTaches: () => ({ provider: 'claude', model: 'claude-haiku-5-5' }), routageChatLectureSeuleActif: () => false, getBinding: () => ({ provider: 'codex', model: 'modele-test' }) },
        conversations: store,
        executionSupervisor: { currentSignal: () => undefined },
        runChatTurn: async (_contenu: string, _signal: AbortSignal, lancer: () => unknown) =>
          lancer()
      })
      const deps = avecRepli({
        os,
        pilot,
        pendingDirectives: new Map<string, string[]>(),
        turnJournalRoot: racine,
        isolatedTestInstance: false,
        broadcast: vi.fn(),
        drainPendingDirectives: () => [],
        notifyWatchdogWorkflowIncident: vi.fn(),
        watchdogEngine: () => undefined
      }) as unknown as RunPilotChatDeps

      const resultat = await createRunPilotChat(deps)(
        undefined,
        [{ role: 'user', content: 'lis le fichier x' }],
        fil.id
      )
      await attendreEcrituresJournal()
      const journal = readTurnJournal(racine, fil.id, String(resultat.turnId))

      const pensees = journal.filter((e) => e.kind === 'reasoning-step')
      expect(pensees.map((e) => [e.iteration, e.text, e.fragments])).toEqual([
        [0, 'Je lis le fichier', 3],
        [1, 'Je conclus', 2]
      ])
      // Chaque rafale à sa place : la première AVANT la commande, la seconde après le résultat.
      const rang = (predicat: (e: (typeof journal)[number]) => boolean): number =>
        journal.findIndex(predicat)
      const rangCommande = rang((e) => e.kind === 'command')
      const rangResultat = rang((e) => e.kind === 'result')
      expect(rang((e) => e.kind === 'reasoning-step' && e.iteration === 0)).toBeLessThan(
        rangCommande
      )
      expect(rang((e) => e.kind === 'reasoning-step' && e.iteration === 1)).toBeGreaterThan(
        rangResultat
      )
      // Le texte entier de la pensée reste écrit à la clôture, avant la fin du tour.
      const cloture = journal.find((e) => e.kind === 'reasoning')
      expect(cloture?.text).toBe('Je lis le fichierJe conclus')
      expect(rang((e) => e.kind === 'reasoning-step' && e.iteration === 1)).toBeLessThan(
        rang((e) => e.kind === 'done')
      )
    } finally {
      rmSync(racine, { recursive: true, force: true })
    }
  })

  /**
   * Joue UN tour avec un faux pilote scripté (`chat` émet les événements voulus), puis rend le message
   * de réponse tel que le fil le range. Même montage que le test ci-dessus.
   */
  async function reponseDuTour(
    chat: (
      surEvenement: (e: unknown) => void,
      store: ConversationStore,
      filId: string
    ) => Promise<unknown>
  ) {
    let t = 1000
    const store = new ConversationStore(() => t++)
    const fil = store.create({ title: 'Décodage', provider: 'codex' })
    const racine = mkdtempSync(join(tmpdir(), 'autowin-look-decode-'))
    const broadcast = vi.fn()
    try {
      const pilot = {
        chat: vi.fn(async (_messages: unknown, surEvenement: (e: unknown) => void) =>
          chat(surEvenement, store, fil.id)
        )
      }
      const os = avecRepli({
        waitUntilReady: async () => {},
        roles: {
          bindingDesPetitesTaches: () => ({ provider: 'claude', model: 'claude-haiku-5-5' }),
          routageChatLectureSeuleActif: () => false,
          getBinding: () => ({ provider: 'codex', model: 'modele-test' })
        },
        conversations: store,
        executionSupervisor: { currentSignal: () => undefined },
        runChatTurn: async (_contenu: string, _signal: AbortSignal, lancer: () => unknown) =>
          lancer()
      })
      const deps = avecRepli({
        os,
        pilot,
        pendingDirectives: new Map<string, string[]>(),
        turnJournalRoot: racine,
        isolatedTestInstance: false,
        broadcast,
        drainPendingDirectives: () => [],
        notifyWatchdogWorkflowIncident: vi.fn(),
        watchdogEngine: () => undefined
      }) as unknown as RunPilotChatDeps
      // Un tour qui échoue peut rejeter sa promesse : le test lit ce que le fil a écrit, et rend l'erreur
      // à part, pour qu'un échec de la fin de tour ne passe pas inaperçu.
      const issue = await createRunPilotChat(deps)(
        undefined,
        [{ role: 'user', content: 'regarde cette image' }],
        fil.id
      ).then(
        () => ({ rejete: false, cause: undefined as unknown }),
        (cause: unknown) => ({ rejete: true, cause })
      )
      await attendreEcrituresJournal()
      const reponse = store.get(fil.id)?.messages.find((m) => m.role === 'assistant')
      // Le journal se relit AVANT la suppression du dossier temporaire.
      const journal = reponse?.turnId ? readTurnJournal(racine, fil.id, reponse.turnId) : []
      const diffusions = broadcast.mock.calls.map((appel) => appel[0])
      return { reponse, journal, ...issue, diffusions }
    } finally {
      rmSync(racine, { recursive: true, force: true })
    }
  }

  /**
   * Joue un tour COUPÉ, puis sa REPRISE : même fil, même journal, même turnId. L'essai coupé s'arrête à la
   * fin, sans `done` ni erreur. La reprise reçoit le `recovery` que construit `src/main/ipc/chat.ts` pour un appel
   * interrompu (son `providerCall`), SANS action réglée : l'appel repris ne réémet pas la commande déjà passée,
   * seul le journal du tour la garde.
   */
  async function reprendreLeTour(
    essaiCoupe: (surEvenement: (e: unknown) => void) => Promise<unknown>,
    essaiRepris: (surEvenement: (e: unknown) => void) => Promise<unknown>
  ) {
    let t = 1000
    const store = new ConversationStore(() => t++)
    const fil = store.create({ title: 'Reprise', provider: 'codex' })
    const racine = mkdtempSync(join(tmpdir(), 'autowin-look-reprise-'))
    const essais = [essaiCoupe, essaiRepris]
    try {
      const pilot = {
        chat: vi.fn(async (_messages: unknown, surEvenement: (e: unknown) => void) => {
          const essai = essais.shift()
          if (!essai) throw new Error('faux pilote : plus aucun essai scripté')
          return essai(surEvenement)
        })
      }
      const os = avecRepli({
        waitUntilReady: async () => {},
        roles: {
          bindingDesPetitesTaches: () => ({ provider: 'claude', model: 'claude-haiku-5-5' }),
          routageChatLectureSeuleActif: () => false,
          getBinding: () => ({ provider: 'codex', model: 'modele-test' })
        },
        conversations: store,
        executionSupervisor: { currentSignal: () => undefined },
        runChatTurn: async (_contenu: string, _signal: AbortSignal, lancer: () => unknown) =>
          lancer()
      })
      const deps = avecRepli({
        os,
        pilot,
        pendingDirectives: new Map<string, string[]>(),
        turnJournalRoot: racine,
        isolatedTestInstance: false,
        broadcast: vi.fn(),
        drainPendingDirectives: () => [],
        notifyWatchdogWorkflowIncident: vi.fn(),
        watchdogEngine: () => undefined
      }) as unknown as RunPilotChatDeps
      const tour = createRunPilotChat(deps)
      const messages = [{ role: 'user' as const, content: 'regarde cette image' }]
      // La coupure ne lève pas d'erreur : c'est le scénario. L'état du fil, lu ensuite, dit si elle a eu lieu.
      // fix-ok: l'essai coupé rend `{ text: '' }` sans erreur ni done ; les deux tests de reprise comptent exactement deux appels au faux pilote, donc aucune relance ne s'y ajoute.
      // Le tour se termine sans erreur ni `done`, comme un tour dont l'application s'est fermée.
      await tour(undefined, messages, fil.id)
      await attendreEcrituresJournal()
      const coupe = store.get(fil.id)?.messages.find((m) => m.role === 'assistant')
      const turnId = String(coupe?.turnId)
      const journalCoupe = readTurnJournal(racine, fil.id, turnId)
      const recovery = {
        turnId,
        call: { provider: 'codex', token: 'appel-coupe' },
        providerCall: {
          iteration: 1,
          attempt: 1,
          streamId: 'reprise-1',
          streamedPrefix: '',
          result: { text: '' }
        }
      } as unknown as DirectChatRecovery
      await tour(undefined, messages, fil.id, undefined, recovery)
      await attendreEcrituresJournal()
      const reponse = store.get(fil.id)?.messages.find((m) => m.role === 'assistant')
      // Le journal se relit AVANT la suppression du dossier temporaire.
      const journal = readTurnJournal(racine, fil.id, turnId)
      return { coupe, journalCoupe, reponse, journal, appels: pilot.chat.mock.calls.length }
    } finally {
      rmSync(racine, { recursive: true, force: true })
    }
  }

  it('après le chargement de la skill look, le raisonnement va dans lookDecode et jamais dans reasoning', async () => {
    const { reponse } = await reponseDuTour(async (surEvenement) => {
      surEvenement({ kind: 'reasoning', text: 'Je regarde la capture.', iteration: 0 })
      surEvenement({
        kind: 'command',
        actionId: 'a1',
        name: 'skill_charger',
        args: { nom: 'look' },
        iteration: 0
      })
      surEvenement({
        kind: 'result',
        actionId: 'a1',
        name: 'skill_charger',
        ok: true,
        iteration: 0
      })
      for (const morceau of ['Le cadre ', 'montre '])
        surEvenement({ kind: 'reasoning', text: morceau, iteration: 1 })
      // Une action entre deux pensées de décodage : la première rafale part au tour à ce moment-là.
      surEvenement({
        kind: 'command',
        actionId: 'a2',
        name: 'read_file',
        args: { path: 'x' },
        iteration: 1
      })
      surEvenement({ kind: 'result', actionId: 'a2', name: 'read_file', ok: true, iteration: 1 })
      // La dernière pensée n'est suivie d'aucun autre événement : elle part à la clôture du tour.
      surEvenement({ kind: 'reasoning', text: 'Paris.', iteration: 2 })
      surEvenement({ kind: 'done', text: '' })
      return { text: '' }
    })
    expect(reponse?.lookDecode).toBe('Le cadre montre Paris.')
    expect(reponse?.reasoning).toBe('Je regarde la capture.')
  })

  it('sans skill look, le raisonnement reste dans reasoning et lookDecode reste absent', async () => {
    const { reponse } = await reponseDuTour(async (surEvenement) => {
      for (const morceau of ['Je lis ', 'le fichier'])
        surEvenement({ kind: 'reasoning', text: morceau, iteration: 0 })
      // Une autre skill que look : son chargement ne doit ouvrir aucun décodage.
      surEvenement({
        kind: 'command',
        actionId: 'a1',
        name: 'skill_charger',
        args: { nom: 'docx' },
        iteration: 0
      })
      surEvenement({
        kind: 'result',
        actionId: 'a1',
        name: 'skill_charger',
        ok: true,
        iteration: 0
      })
      for (const morceau of ['Je ', 'conclus'])
        surEvenement({ kind: 'reasoning', text: morceau, iteration: 1 })
      surEvenement({ kind: 'delta', streamId: '1:0', text: 'Fini.', iteration: 1 })
      surEvenement({ kind: 'done', text: 'Fini.' })
      return { text: 'Fini.' }
    })
    expect(reponse?.reasoning).toBe('Je lis le fichierJe conclus')
    expect(reponse?.lookDecode).toBeUndefined()
  })

  it('un tour en erreur pendant le décodage garde la fin du décodage (sans reprise)', async () => {
    const { reponse } = await reponseDuTour(async (surEvenement) => {
      // Le nom « /look » doit se lire comme « look » : même normalisation que le chargeur de skills.
      surEvenement({
        kind: 'command',
        actionId: 'a1',
        name: 'skill_charger',
        args: { nom: '/look' },
        iteration: 0
      })
      surEvenement({ kind: 'reasoning', text: 'Le cadre montre Paris.', iteration: 0 })
      throw new Error('coupure du fournisseur')
    })
    expect(reponse?.lookDecode).toBe('Le cadre montre Paris.')
    expect(reponse?.status).toBe('failed')
  })

  // fix-ok: un tour rendu sans done ni erreur ne passe par aucun autre vidage : ce test garde celui du finally.
  it('un tour rendu sans done ni erreur garde la fin du décodage', async () => {
    const { reponse } = await reponseDuTour(async (surEvenement) => {
      surEvenement({
        kind: 'command',
        actionId: 'a1',
        name: 'skill_charger',
        args: { nom: 'look' },
        iteration: 0
      })
      surEvenement({ kind: 'reasoning', text: 'Le cadre montre Paris.', iteration: 0 })
      // Aucun `done`, aucune erreur : le pilote rend simplement la main. Ni le routage du `done`
      // ni le `catch` ne tournent, donc la pensée en attente ne part qu'au `finally`.
      return { text: '' }
    })
    expect(reponse?.lookDecode).toBe('Le cadre montre Paris.')
    expect(reponse?.reasoning).toBeUndefined()
  })

  it('un message de tour retiré pendant la pensée ne fait pas échouer la fin du tour', async () => {
    const { rejete, cause, diffusions } = await reponseDuTour(
      async (surEvenement, store, filId) => {
        surEvenement({
          kind: 'command',
          actionId: 'a1',
          name: 'skill_charger',
          args: { nom: 'look' },
          iteration: 0
        })
        surEvenement({ kind: 'reasoning', text: 'Le cadre montre Paris.', iteration: 0 })
        // Le message du tour disparaît pendant la pensée : rien ne reste où écrire la fin.
        const conversation = store.get(filId)
        if (conversation)
          conversation.messages = conversation.messages.filter((m) => m.role !== 'assistant')
        return { text: '' }
      }
    )
    // Sans garde, la fin de tour lève avant le retrait du tour actif.
    expect(cause).toBeUndefined()
    expect(rejete).toBe(false)
    expect(diffusions).toContainEqual({ type: 'refresh', scope: 'conversations' })
  })

  it('le direct reçoit le décodage sous le genre look-decode, jamais sous reasoning', async () => {
    direct.evenements.length = 0
    await reponseDuTour(async (surEvenement) => {
      surEvenement({ kind: 'reasoning', text: 'Je regarde.', iteration: 0 })
      surEvenement({
        kind: 'command',
        actionId: 'a1',
        name: 'skill_charger',
        args: { nom: 'look' },
        iteration: 0
      })
      surEvenement({ kind: 'reasoning', text: 'Le cadre montre Paris.', iteration: 1 })
      surEvenement({ kind: 'done', text: '' })
      return { text: '' }
    })
    const pensees = direct.evenements
      .filter((e) => e.kind === 'reasoning' || e.kind === 'look-decode')
      .map((e) => [e.kind, e.text])
    expect(pensees).toEqual([
      ['reasoning', 'Je regarde.'],
      ['look-decode', 'Le cadre montre Paris.']
    ])
  })

  it('le décodage ne rentre jamais dans le journal de tour, car kaizen relit ce journal et le rend au modèle', async () => {
    const { journal } = await reponseDuTour(async (surEvenement) => {
      surEvenement({ kind: 'reasoning', text: 'Je regarde la capture.', iteration: 0 })
      surEvenement({
        kind: 'command',
        actionId: 'a1',
        name: 'skill_charger',
        args: { nom: 'look' },
        iteration: 0
      })
      surEvenement({
        kind: 'result',
        actionId: 'a1',
        name: 'skill_charger',
        ok: true,
        iteration: 0
      })
      for (const morceau of ['Le cadre ', 'montre '])
        surEvenement({ kind: 'reasoning', text: morceau, iteration: 1 })
      surEvenement({ kind: 'reasoning', text: 'Paris.', iteration: 2 })
      surEvenement({ kind: 'done', text: '' })
      return { text: '' }
    })
    // La pensée générale et la commande qui ouvre le décodage restent dans le journal : il n'est pas vide.
    expect(journal.filter((e) => e.kind === 'reasoning-step').map((e) => e.text)).toEqual([
      'Je regarde la capture.'
    ])
    expect(journal.find((e) => e.kind === 'reasoning')?.text).toBe('Je regarde la capture.')
    expect(journal.some((e) => e.kind === 'command' && e.name === 'skill_charger')).toBe(true)
    // Aucune ligne ne porte le texte du décodage, quel que soit son genre.
    const ecrit = JSON.stringify(journal)
    expect(ecrit).not.toContain('Le cadre')
    expect(ecrit).not.toContain('Paris.')
  })

  it('une reprise simulée (faux fournisseur, recovery fabriqué) d’un essai resté sans done en plein décodage continue le décodage, sans rien remettre dans la pensée générale', async () => {
    const { journalCoupe, reponse, journal, appels } = await reprendreLeTour(
      async (surEvenement) => {
        surEvenement({
          kind: 'command',
          actionId: 'a1',
          name: 'skill_charger',
          args: { nom: 'look' },
          iteration: 0
        })
        surEvenement({
          kind: 'result',
          actionId: 'a1',
          name: 'skill_charger',
          ok: true,
          iteration: 0
        })
        surEvenement({ kind: 'reasoning', text: 'Le cadre montre ', iteration: 1 })
        return { text: '' }
      },
      async (surEvenement) => {
        surEvenement({ kind: 'reasoning', text: 'Paris.', iteration: 1 })
        surEvenement({ kind: 'done', text: '' })
        return { text: '' }
      }
    )
    // L'essai coupé ne clôt pas le tour, et la commande qui ouvre le décodage est dans son journal.
    expect(journalCoupe.some((e) => e.kind === 'done')).toBe(false)
    expect(journalCoupe.some((e) => e.kind === 'command' && e.name === 'skill_charger')).toBe(true)
    // Exactement deux appels : l'essai coupé et sa reprise, aucun appel en plus.
    expect(appels).toBe(2)
    expect(reponse?.lookDecode).toBe('Le cadre montre Paris.')
    expect(reponse?.reasoning).toBeUndefined()
    // La suite du décodage ne rentre pas non plus dans le journal de tour.
    expect(journal.filter((e) => e.kind === 'reasoning-step')).toEqual([])
  })

  it('une reprise simulée (faux fournisseur, recovery fabriqué) d’un essai resté sans done hors décodage garde la pensée dans le raisonnement général', async () => {
    const { reponse, appels } = await reprendreLeTour(
      async (surEvenement) => {
        surEvenement({
          kind: 'command',
          actionId: 'a1',
          name: 'skill_charger',
          args: { nom: 'pdf' },
          iteration: 0
        })
        surEvenement({ kind: 'reasoning', text: 'Je lis ', iteration: 1 })
        // Une action après la pensée la verse au fil avant la coupure, comme dans un vrai tour qui agit.
        surEvenement({
          kind: 'command',
          actionId: 'a2',
          name: 'read_file',
          args: { path: 'x' },
          iteration: 1
        })
        surEvenement({ kind: 'result', actionId: 'a2', name: 'read_file', ok: true, iteration: 1 })
        return { text: '' }
      },
      async (surEvenement) => {
        surEvenement({ kind: 'reasoning', text: 'le fichier.', iteration: 1 })
        surEvenement({ kind: 'done', text: '' })
        return { text: '' }
      }
    )
    // Jumeau du cas précédent : une autre skill ne doit ouvrir aucun décodage à la reprise.
    expect(appels).toBe(2)
    expect(reponse?.reasoning).toBe('Je lis le fichier.')
    expect(reponse?.lookDecode).toBeUndefined()
  })

  it('une commande qui passe au milieu du décodage écrit au fil la pensée déjà reçue, sans attendre la clôture', async () => {
    let auFilAvantLaSuite: string | undefined
    const { reponse } = await reponseDuTour(async (surEvenement, store, filId) => {
      surEvenement({
        kind: 'command',
        actionId: 'a1',
        name: 'skill_charger',
        args: { nom: 'look' },
        iteration: 0
      })
      surEvenement({ kind: 'reasoning', text: 'Le cadre ', iteration: 1 })
      surEvenement({
        kind: 'command',
        actionId: 'a2',
        name: 'read_file',
        args: { path: 'x' },
        iteration: 1
      })
      // La commande a fermé la rafale : la pensée reçue jusque-là est déjà au fil, pas seulement à la clôture.
      auFilAvantLaSuite = store.get(filId)?.messages.find((m) => m.role === 'assistant')?.lookDecode
      surEvenement({ kind: 'result', actionId: 'a2', name: 'read_file', ok: true, iteration: 1 })
      surEvenement({ kind: 'reasoning', text: 'montre Paris.', iteration: 2 })
      surEvenement({ kind: 'done', text: '' })
      return { text: '' }
    })
    expect(auFilAvantLaSuite).toBe('Le cadre ')
    expect(reponse?.lookDecode).toBe('Le cadre montre Paris.')
  })

  it('le nom LOOK en majuscules ouvre aussi le décodage', async () => {
    const { reponse } = await reponseDuTour(async (surEvenement) => {
      surEvenement({
        kind: 'command',
        actionId: 'a1',
        name: 'skill_charger',
        args: { nom: 'LOOK' },
        iteration: 0
      })
      surEvenement({ kind: 'reasoning', text: 'Le cadre montre Paris.', iteration: 0 })
      surEvenement({ kind: 'done', text: '' })
      return { text: '' }
    })
    expect(reponse?.lookDecode).toBe('Le cadre montre Paris.')
    expect(reponse?.reasoning).toBeUndefined()
  })

  it('une reprise simulée dont la suite commence par un espace garde cet espace', async () => {
    const { reponse } = await reprendreLeTour(
      async (surEvenement) => {
        surEvenement({
          kind: 'command',
          actionId: 'a1',
          name: 'skill_charger',
          args: { nom: 'look' },
          iteration: 0
        })
        surEvenement({
          kind: 'result',
          actionId: 'a1',
          name: 'skill_charger',
          ok: true,
          iteration: 0
        })
        surEvenement({ kind: 'reasoning', text: 'Le cadre montre', iteration: 1 })
        return { text: '' }
      },
      async (surEvenement) => {
        surEvenement({ kind: 'reasoning', text: ' Paris.', iteration: 1 })
        surEvenement({ kind: 'done', text: '' })
        return { text: '' }
      }
    )
    // Le texte écrit avant la coupure finit sur « montre » : l'espace qui suit appartient à la suite.
    expect(reponse?.lookDecode).toBe('Le cadre montre Paris.')
  })

  it('une reprise simulée dont l’essai coupé n’a rien écrit de décodage perd l’espace de tête, comme un décodage neuf', async () => {
    const { reponse } = await reprendreLeTour(
      async (surEvenement) => {
        surEvenement({
          kind: 'command',
          actionId: 'a1',
          name: 'skill_charger',
          args: { nom: 'look' },
          iteration: 0
        })
        surEvenement({
          kind: 'result',
          actionId: 'a1',
          name: 'skill_charger',
          ok: true,
          iteration: 0
        })
        return { text: '' }
      },
      async (surEvenement) => {
        surEvenement({ kind: 'reasoning', text: '  Le cadre montre Paris.', iteration: 1 })
        surEvenement({ kind: 'done', text: '' })
        return { text: '' }
      }
    )
    expect(reponse?.lookDecode).toBe('Le cadre montre Paris.')
  })

  it('un décodage neuf perd ses espaces de tête', async () => {
    const { reponse } = await reponseDuTour(async (surEvenement) => {
      surEvenement({
        kind: 'command',
        actionId: 'a1',
        name: 'skill_charger',
        args: { nom: 'look' },
        iteration: 0
      })
      surEvenement({ kind: 'reasoning', text: '  Le cadre montre Paris.', iteration: 0 })
      surEvenement({ kind: 'done', text: '' })
      return { text: '' }
    })
    expect(reponse?.lookDecode).toBe('Le cadre montre Paris.')
  })
})
