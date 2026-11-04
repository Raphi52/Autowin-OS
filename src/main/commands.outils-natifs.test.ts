import { describe, expect, it, vi } from 'vitest'
import { AppCommandBus, CATALOG } from './commands'
import { parseDesktopActions } from './desktop-control'
import { outilsPublies, type SchemaArgument } from './skill-node-mcp'
import { ConversationStore } from './store/conversations'
import { parseTaskInput } from './task-manager/task-manager-ipc'
import { TaskStore } from './task-manager/task-store'
import { lirePlanDeLots } from '../shared/plan-de-lots'
import { APP_DESTINATIONS } from '../shared/navigation'
import { sourceProcessPrincipal } from './source-process-principal.test-helpers'

/*
 * LES OUTILS DU CHAT RATTRAPENT LES OUTILS NATIFS DE CLAUDE (conv-1370, lot 6, 2026-10-31).
 *
 * Comparaison sur 53 outils et le journal du 22 au 31/10 : tout partait en `string`, 20 arguments
 * étaient exigés à tort, `get_state` rendait 187 000 caractères sans moyen de rétrécir, une tâche se
 * créait sans pouvoir se modifier ni se supprimer, et `conversation_read` ne remontait pas plus haut
 * que ses N derniers messages.
 *
 * La règle qui traverse ce fichier : un argument publié en vrai type reste accepté en texte, parce
 * que le chemin `<cmd>` envoie encore du texte ; et une forme inattendue est REFUSÉE, jamais ignorée.
 * Le schéma est lu sur ce que le modèle reçoit vraiment (`outilsPublies`), pas sur le catalogue brut.
 */

const os = {
  executionWorkspace: process.cwd(),
  conversations: { get: () => undefined, list: () => [] },
  registry: { ids: () => ['claude'] },
  roles: { all: () => ({}), getBinding: () => ({ provider: 'claude' }) },
  runsWithGate: async () => [],
  budget: () => ({ spent: 0 })
}

const nouveauBus = (surcharge: Record<string, unknown> = {}): AppCommandBus =>
  new AppCommandBus({ ...os, ...surcharge } as never, () => undefined)

type Publie = { type: 'object'; properties: Record<string, SchemaArgument>; required: string[] }

function schemaDe(nom: string): Publie {
  const bus = nouveauBus()
  const outils = outilsPublies(
    { exec: bus.exec.bind(bus) as never, catalogue: () => bus.catalog() },
    { outils: CATALOG.map((c) => c.name), refus: () => '' }
  )
  const outil = outils.find((o) => o.name === nom)
  if (!outil) throw new Error(`outil non publié : ${nom}`)
  return outil.inputSchema as Publie
}

const specDe = (nom: string): (typeof CATALOG)[number] | undefined =>
  CATALOG.find((c) => c.name === nom)

describe('(a) get_state : réponse courte et arguments pour rétrécir', () => {
  const titre = (i: number): string =>
    `Conversation ${i} : un titre de longueur réaliste pour un fil de travail du dépôt`
  const conversations = Array.from({ length: 1190 }, (_, i) => ({
    id: `conv-${i}`,
    title: titre(i),
    provider: 'claude',
    updatedAt: 1000 + i,
    messages: [{ role: 'user', content: 'demande', ts: 1000 + i }]
  }))
  const travaux = [{ agentId: 'run-1', date: '2026-10-31', fichiers: ['src/a.ts'] }]
  const busEtat = (): AppCommandBus =>
    nouveauBus({
      conversations: { get: () => undefined, list: () => conversations },
      travauxNonPubliesBornes: () => travaux
    })

  it('rend moins de 8 000 caractères sur 1 190 conversations, travauxNonPublies compris', async () => {
    const r = await busEtat().exec('get_state', {})
    expect(r.ok).toBe(true)
    const data = r.data as { travauxNonPublies: unknown; conversations: Array<{ id: string }> }
    expect(JSON.stringify(data).length).toBeLessThan(8000)
    expect(data.travauxNonPublies).toEqual(travaux)
    expect(data.conversations).toHaveLength(20)
    expect(data.conversations[0].id).toBe('conv-1189')
  })

  it('`sections: tout` rend l’état entier, pour qui en a vraiment besoin', async () => {
    const r = await busEtat().exec('get_state', { sections: 'tout' })
    expect((r.data as { conversations: unknown[] }).conversations).toHaveLength(1190)
  })

  it('accepte `limite` en nombre comme en texte', async () => {
    for (const limite of [5, '5']) {
      const r = await busEtat().exec('get_state', { limite })
      expect((r.data as { conversations: unknown[] }).conversations).toHaveLength(5)
    }
  })

  it('filtre par titre ou identifiant, sans tenir compte de la casse', async () => {
    const r = await busEtat().exec('get_state', { conversation: 'CONV-1189' })
    const data = r.data as { conversations: Array<{ id: string }> }
    expect(data.conversations.map((c) => c.id)).toEqual(['conv-1189'])
  })

  it('une section inconnue est une ERREUR de l’outil, avec les valeurs valides', async () => {
    const r = await busEtat().exec('get_state', { sections: 'nimporte' })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('nimporte')
    expect(r.error).toContain('travauxNonPublies')
  })

  it('publie les trois arguments, tous facultatifs, et `limite` en entier', () => {
    const schema = schemaDe('get_state')
    expect(Object.keys(schema.properties).sort()).toEqual(['conversation', 'limite', 'sections'])
    expect(schema.required).toEqual([])
    expect(schema.properties.limite).toMatchObject({ type: 'integer', minimum: 1, maximum: 200 })
  })

  it('la description garde les deux promesses que l’agent lit encore', () => {
    const description = specDe('get_state')?.description ?? ''
    expect(description).toContain('lastUserMessageAt')
    expect(description).toContain('travauxNonPublies')
    expect(description).toContain('sections')
  })
})

describe('(b) task_update et task_delete : l’agent peut modifier et supprimer', () => {
  const tache = {
    title: 'Veille du matin',
    prompt: 'Résume les nouveautés.',
    enabled: true,
    mode: 'active-only',
    destination: { kind: 'existing', conversationId: 'conv-1' },
    schedule: {
      startDate: '2099-01-01',
      time: '09:00',
      timeZone: 'Europe/Paris',
      recurrence: { unit: 'none', interval: 1 }
    }
  }

  function banc(): { bus: AppCommandBus; store: TaskStore; id: string; refresh: () => void } {
    const store = new TaskStore()
    const refresh = vi.fn(async () => {})
    const bus = nouveauBus()
    bus.taskManager = {
      create: (i) => store.create(i),
      list: () => store.listTasks(),
      get: (id) => store.getTask(id),
      update: (id, i) => store.update(id, i),
      remove: (id) => store.remove(id),
      refresh,
      onChanged: () => undefined
    }
    return { bus, store, id: store.create(parseTaskInput(tache)).id, refresh }
  }

  it('task_delete est destructif, task_update ne l’est pas', () => {
    expect(specDe('task_delete')?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: false
    })
    expect(specDe('task_update')?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false
    })
  })

  it('task_update modifie, `patch` en objet comme en texte JSON', async () => {
    const { bus, store, id, refresh } = banc()

    const objet = await bus.exec('task_update', { id, patch: { title: 'Nouveau titre' } })
    expect(objet.data).toMatchObject({ ok: true, task: { id, title: 'Nouveau titre' } })

    const texte = await bus.exec('task_update', { id, patch: '{"enabled":false}' })
    expect(texte.data).toMatchObject({ ok: true })
    expect(store.getTask(id)).toMatchObject({ title: 'Nouveau titre', enabled: false })
    expect(refresh).toHaveBeenCalledTimes(2)
  })

  it('task_delete supprime ; un identifiant inconnu cite les plus proches', async () => {
    const { bus, store, id } = banc()

    const inconnu = await bus.exec('task_delete', { id: `${id}x` })
    expect(inconnu.data).toMatchObject({ ok: false })
    expect((inconnu.data as { reason: string }).reason).toContain(id)
    expect(store.getTask(id)).toBeDefined()

    const ok = await bus.exec('task_delete', { id })
    expect(ok.data).toMatchObject({ ok: true, id, title: tache.title })
    expect(store.getTask(id)).toBeUndefined()
  })

  it('index.ts branche les trois gestes de l’écran sur bus.taskManager', () => {
    const source = sourceProcessPrincipal()
    const debut = source.indexOf('bus.taskManager = {')
    const zone = source.slice(debut, source.indexOf('}', debut))
    expect(zone).toContain('get: (id) => scheduledTasks.getTask(id)')
    expect(zone).toContain('update: (id, input) => scheduledTasks.update(id, input)')
    expect(zone).toContain('remove: (id) => scheduledTasks.remove(id)')
  })

  // conv-1372 : le `.map` retirait annotations et types pour les étapes de workflow.
  it('le catalogue d’un nœud de workflow garde annotations et types', () => {
    const source = sourceProcessPrincipal()
    const debut = source.indexOf('catalogue: () =>')
    const zone = source.slice(debut, source.indexOf('amorcerRegistreOutils()', debut))
    expect(zone).toContain('OUTILS_NOEUD_SKILL')
    expect(zone).not.toContain('.map(')
  })

  // Le chef a tranché (conv-1370) : un `verify` rejoué après une coupure lancerait deux suites.
  it('verify n’est plus rejouable d’office', () => {
    expect(specDe('verify')?.annotations?.idempotentHint).toBe(false)
  })
})

describe('(c) les arguments facultatifs ne sont plus exigés', () => {
  const FAUX_OBLIGATOIRES: Record<string, string[]> = {
    desktop_observe: ['display'],
    chat_send: ['conversationId', 'provider', 'model', 'role'],
    ecrire_a_un_fil: ['nature'],
    plan_de_lots: ['action', 'plan', 'lot', 'decision'],
    create_conversation: ['title'],
    retrospective: ['page'],
    conversation_search: ['limite', 'extraits'],
    conversation_read: ['derniers'],
    attach_run: ['conversationId'],
    marquer_travail_trie: ['oublier'],
    navigateur_agir: ['texte', 'touche', 'crans']
  }
  const VRAIS_OBLIGATOIRES: Record<string, string[]> = {
    desktop_observe: ['ecran_utilisateur'],
    chat_send: ['message'],
    ecrire_a_un_fil: ['destinataire', 'texte'],
    plan_de_lots: [],
    create_conversation: ['category'],
    retrospective: ['id'],
    conversation_search: ['terme'],
    conversation_read: ['id'],
    attach_run: ['path'],
    marquer_travail_trie: ['agentId'],
    navigateur_agir: ['action']
  }

  it.each(Object.keys(FAUX_OBLIGATOIRES))('%s : `required` est exact', (outil) => {
    const schema = schemaDe(outil)
    for (const nom of FAUX_OBLIGATOIRES[outil]) expect(schema.properties).toHaveProperty(nom)
    expect(schema.required.sort()).toEqual([...VRAIS_OBLIGATOIRES[outil]].sort())
  })

  it('remember : seuls titre, fait, type et source sont exigés', () => {
    // `scope` est rempli depuis le projet (`rememberFact`), `portee` vaut `equipe` par défaut, et
    // `runId` se déduit de la dernière issue du tour : les trois suivent la même règle.
    expect(schemaDe('remember').required.sort()).toEqual(['fact', 'source', 'title', 'type'])
    expect(specDe('remember')?.args.runId.toLowerCase()).not.toContain('obligatoire')
  })

  it('aucune déclaration ne nomme un argument absent d’`args` : il ne serait jamais publié', () => {
    for (const spec of CATALOG) {
      const noms = Object.keys(spec.args)
      for (const nom of Object.keys(spec.argsTypes ?? {})) {
        expect(noms, `${spec.name}.argsTypes.${nom}`).toContain(nom)
      }
      for (const nom of spec.argsFacultatifs ?? []) {
        expect(noms, `${spec.name}.argsFacultatifs.${nom}`).toContain(nom)
      }
    }
  })
})

describe('(d) les vrais types sont publiés', () => {
  const TYPES: Array<[string, string, Partial<SchemaArgument>]> = [
    ['task_create', 'task', { type: 'object' }],
    ['task_update', 'patch', { type: 'object' }],
    ['plan_de_lots', 'plan', { type: 'object' }],
    ['plan_de_lots', 'lot', { type: 'integer', minimum: 1 }],
    ['desktop_act', 'actions', { type: 'array' }],
    ['remove_conversations', 'ids', { type: 'array', items: { type: 'string' } }],
    ['marquer_travaux_tries', 'ids', { type: 'array', items: { type: 'string' } }],
    ['proprietaire_fichier', 'chemins', { type: 'array', items: { type: 'string' } }],
    ['ecrire_a_un_fil', 'texte', { type: 'string', maxLength: 2000 }],
    ['marquer_travail_trie', 'oublier', { type: 'boolean' }],
    ['bureau_cache_agir', 'x', { type: 'integer', minimum: 0, maximum: 32767 }],
    ['bureau_cache_agir', 'y', { type: 'integer', minimum: 0, maximum: 32767 }],
    ['bureau_cache_agir', 'entree', { type: 'boolean' }],
    ['bureau_cache_agir', 'sansClic', { type: 'boolean' }],
    ['bureau_cache_agir', 'molette', { type: 'integer', minimum: -20, maximum: 20 }],
    ['navigateur_agir', 'ref', { type: 'integer', minimum: 0 }],
    ['navigateur_agir', 'x', { type: 'number' }],
    ['navigateur_agir', 'y', { type: 'number' }],
    ['navigateur_agir', 'crans', { type: 'integer', minimum: -20, maximum: 20 }],
    ['conversation_read', 'derniers', { type: 'integer', minimum: 1, maximum: 200 }],
    ['conversation_search', 'limite', { type: 'integer', minimum: 1, maximum: 50 }],
    ['conversation_search', 'extraits', { type: 'integer', minimum: 1, maximum: 20 }]
  ]

  it.each(TYPES)('%s.%s', (outil, argument, attendu) => {
    const publie = schemaDe(outil).properties[argument]
    expect(publie).toMatchObject(attendu)
    // Le texte d'aide de `args` part avec le type : il n'est pas à recopier.
    expect(publie.description).toBe(specDe(outil)?.args[argument])
  })

  describe('la forme d’une tâche, d’après sa validation réelle', () => {
    const tache = (): SchemaArgument => schemaDe('task_create').properties.task
    const base = {
      title: 't',
      prompt: 'p',
      enabled: true,
      mode: 'windows',
      destination: { kind: 'existing', conversationId: 'conv-1' }
    }

    it('task exige ce que `parseTaskInput` exige', () => {
      expect([...(tache().required ?? [])].sort()).toEqual(
        ['destination', 'enabled', 'mode', 'prompt', 'title'].sort()
      )
    })

    // 4 échecs sur 12 du journal venaient d'ici : `guards` absent, « watchdog.guards: objet attendu ».
    it('watchdog.guards est exigé, et décrit champ par champ', () => {
      const watchdog = tache().properties?.watchdog
      expect(watchdog?.required).toEqual(expect.arrayContaining(['source', 'guards']))
      const guards = watchdog?.properties?.guards
      expect(guards?.type).toBe('object')
      expect(guards?.description).toContain('{}')
      expect(Object.keys(guards?.properties ?? {}).sort()).toEqual(
        [
          'dedupWindowMs',
          'maxChainDepth',
          'maxKnownCostUsdPerDay',
          'maxPerRoot',
          'maxTriggersPerDay',
          'maxTriggersPerHour',
          'maxUnpricedCallsPerDay'
        ].sort()
      )
      const sansGardes = { source: { kind: 'app-event', events: ['task-failed'] } }
      expect(() => parseTaskInput({ ...base, watchdog: sansGardes })).toThrow('watchdog.guards')
      expect(() =>
        parseTaskInput({ ...base, watchdog: { ...sansGardes, guards: {} } })
      ).not.toThrow()
    })

    it('chaque événement publié passe la validation', () => {
      const source = tache().properties?.watchdog?.properties?.source
      const evenements = source?.properties?.events?.items?.enum ?? []
      expect(evenements).toContain('chat-turn-done')
      for (const evenement of evenements) {
        const watchdog = {
          source: { kind: 'app-event', events: [evenement], conversationId: 'conv-1' },
          guards: {}
        }
        expect(parseTaskInput({ ...base, watchdog }).watchdog?.source).toMatchObject({
          events: [evenement]
        })
      }
    })

    it('chaque type de surveillance publié passe la validation', () => {
      const source = tache().properties?.watchdog?.properties?.source
      expect(source?.required).toEqual(['kind'])
      const exemples: Record<string, Record<string, unknown>> = {
        'file-match': { kind: 'file-match', path: 'a.log', pattern: 'x' },
        'app-event': { kind: 'app-event', events: ['task-failed'] },
        'outlook-mail': { kind: 'outlook-mail' }
      }
      expect([...(source?.properties?.kind?.enum ?? [])].sort()).toEqual(
        Object.keys(exemples).sort()
      )
      for (const exemple of Object.values(exemples)) {
        expect(() =>
          parseTaskInput({ ...base, watchdog: { source: exemple, guards: {} } })
        ).not.toThrow()
      }
    })

    it('une récurrence publiée passe la validation, unité par unité', () => {
      const recurrence = tache().properties?.schedule?.properties?.recurrence
      expect(recurrence?.required).toEqual(['unit', 'interval'])
      for (const unit of recurrence?.properties?.unit?.enum ?? []) {
        const schedule = {
          startDate: '2099-01-01',
          time: '09:00',
          timeZone: 'Europe/Paris',
          recurrence: { unit, interval: 1 }
        }
        expect(() => parseTaskInput({ ...base, schedule })).not.toThrow()
      }
    })

    it('patch n’exige rien : on ne passe que ce qui change', () => {
      const patch = schemaDe('task_update').properties.patch
      expect(patch.required ?? []).toEqual([])
      expect(patch.properties?.watchdog?.required).toEqual(
        expect.arrayContaining(['source', 'guards'])
      )
    })
  })

  it('plan_de_lots.plan n’exige que `lots` : « ajouter » n’a ni titre ni contexte', () => {
    const plan = schemaDe('plan_de_lots').properties.plan
    expect(plan.required).toEqual(['lots'])
    expect(plan.properties?.lots?.items?.required).toEqual(['demande'])
  })

  describe('chaque commande accepte toujours aussi le texte', () => {
    it('task_create', async () => {
      const store = new TaskStore()
      const bus = nouveauBus()
      bus.taskManager = {
        create: (i) => store.create(i),
        list: () => store.listTasks(),
        refresh: async () => undefined,
        onChanged: () => undefined
      }
      const task = {
        title: 't',
        prompt: 'p',
        enabled: true,
        mode: 'windows',
        destination: { kind: 'existing', conversationId: 'conv-1' },
        schedule: {
          startDate: '2099-01-01',
          time: '09:00',
          timeZone: 'Europe/Paris',
          recurrence: { unit: 'none', interval: 1 }
        }
      }
      expect((await bus.exec('task_create', { task })).data).toMatchObject({ ok: true })
      const texte = await bus.exec('task_create', { task: JSON.stringify(task) })
      expect(texte.data).toMatchObject({ ok: true })
      expect(store.listTasks()).toHaveLength(2)
    })

    it('plan_de_lots : le plan et le numéro de lot', async () => {
      const plan = { lots: [{ demande: 'a' }, { demande: 'b' }] }
      expect(lirePlanDeLots(plan)).toMatchObject({ ok: true })
      expect(lirePlanDeLots(JSON.stringify(plan))).toMatchObject({ ok: true })
      const bus = nouveauBus()
      const outil = vi.fn(async () => ({ ok: true }))
      bus.plansDeLots = { outil, lancerParOrdre: vi.fn() } as never
      await bus.exec('plan_de_lots', { action: 'relancer', lot: '2' }, 'conv-1')
      expect(outil).toHaveBeenCalledWith('conv-1', { action: 'relancer', lot: '2' })
    })

    it('desktop_act', () => {
      const gestes = [{ type: 'click', x: 500, y: 320 }]
      expect(parseDesktopActions(gestes)).toHaveLength(1)
      expect(parseDesktopActions(JSON.stringify(gestes))).toHaveLength(1)
    })

    it('remove_conversations', async () => {
      const conversations = new ConversationStore(() => 1)
      const a = conversations.create({ title: 'a', provider: 'claude' })
      const b = conversations.create({ title: 'b', provider: 'claude' })
      const bus = nouveauBus({ conversations })
      const texte = await bus.exec('remove_conversations', { ids: JSON.stringify([a.id]) })
      expect(texte.data).toMatchObject({ removed: [a.id] })
      const liste = await bus.exec('remove_conversations', { ids: [b.id] })
      expect(liste.data).toMatchObject({ removed: [b.id] })
    })

    it('marquer_travaux_tries', async () => {
      const bus = nouveauBus({
        worktrees: { marquerTravailTrie: () => true, shaTravailTrie: () => 'sha' }
      })
      for (const ids of [['a'], '["a"]']) {
        expect((await bus.exec('marquer_travaux_tries', { ids })).data).toMatchObject({ count: 1 })
      }
    })

    it('proprietaire_fichier', async () => {
      const bus = nouveauBus()
      for (const chemins of [['package.json'], '["package.json"]', 'package.json']) {
        const r = await bus.exec('proprietaire_fichier', { chemins })
        expect((r.data as { fichiers: unknown[] }).fichiers).toHaveLength(1)
      }
    })

    // Défaut réel : `a.oublier === true` ne voyait pas le « true » du texte. L'appel MARQUAIT le
    // travail au lieu de l'oublier, sans rien dire — l'inverse du geste demandé.
    it('marquer_travail_trie : `oublier` en texte oublie, il ne marque pas', async () => {
      const marquer = vi.fn(() => true)
      const oublier = vi.fn(() => true)
      const bus = nouveauBus({
        worktrees: { marquerTravailTrie: marquer, oublierTravailTrie: oublier }
      })
      for (const valeur of [true, 'true']) {
        expect(
          (await bus.exec('marquer_travail_trie', { agentId: 'a', oublier: valeur })).data
        ).toEqual({ agentId: 'a', trie: false, oublie: true })
      }
      expect(marquer).not.toHaveBeenCalled()
      await bus.exec('marquer_travail_trie', { agentId: 'a', oublier: 'false' })
      expect(marquer).toHaveBeenCalledTimes(1)
    })

    it('marquer_travail_trie : une valeur ni vraie ni fausse est refusée, rien n’est marqué', async () => {
      const marquer = vi.fn(() => true)
      const bus = nouveauBus({ worktrees: { marquerTravailTrie: marquer } })
      const r = await bus.exec('marquer_travail_trie', { agentId: 'a', oublier: 'oui' })
      expect(r.ok).toBe(false)
      expect(r.error).toContain('oublier')
      expect(marquer).not.toHaveBeenCalled()
    })

    function busBureau(): { bus: AppCommandBus; agir: ReturnType<typeof vi.fn> } {
      const bus = nouveauBus()
      const agir = vi.fn(async () => ({ ok: true }))
      bus.agirBureauCache = agir as never
      bus.ficheBureauCache = (() => ({ conversationId: 'conv-1' })) as never
      return { bus, agir }
    }

    it('bureau_cache_agir : vrais types et texte donnent le même geste', async () => {
      const attendu = { id: 'chat-conv-1', x: 10, y: 20, molette: -3, entree: true, sansClic: true }
      const { bus, agir } = busBureau()
      await bus.exec(
        'bureau_cache_agir',
        { x: 10, y: 20, molette: -3, entree: true, sansClic: true },
        'conv-1'
      )
      await bus.exec(
        'bureau_cache_agir',
        { x: '10', y: '20', molette: '-3', entree: 'true', sansClic: 'true' },
        'conv-1'
      )
      expect(agir).toHaveBeenNthCalledWith(1, attendu)
      expect(agir).toHaveBeenNthCalledWith(2, attendu)
    })

    it('bureau_cache_agir : `false` en texte vaut faux, une autre forme est refusée', async () => {
      const { bus, agir } = busBureau()
      await bus.exec('bureau_cache_agir', { x: 1, y: 2, entree: 'false' }, 'conv-1')
      expect(agir).toHaveBeenCalledWith({ id: 'chat-conv-1', x: 1, y: 2 })
      agir.mockClear()
      const r = await bus.exec('bureau_cache_agir', { x: 1, y: 2, sansClic: 'oui' }, 'conv-1')
      expect(r.ok).toBe(false)
      expect(r.error).toContain('sansClic')
      expect(agir).not.toHaveBeenCalled()
    })

    it('navigateur_agir : vrais types et texte donnent le même geste', async () => {
      const agir = vi.fn(async () => ({ ok: true, message: 'fait' }))
      const bus = nouveauBus()
      bus.navigateur = (() => ({ agir, etat: () => ({ ongletActif: 'o' }) })) as never
      await bus.exec('navigateur_agir', { action: 'defiler', ref: 3, crans: 2 }, 'conv-1')
      await bus.exec('navigateur_agir', { action: 'defiler', ref: '3', crans: '2' }, 'conv-1')
      const attendu = { type: 'defiler', dy: 200, cible: { ref: 3 } }
      expect(agir.mock.calls[0].slice(0, 2)).toEqual(['conv-1', attendu])
      expect(agir.mock.calls[1].slice(0, 2)).toEqual(['conv-1', attendu])
    })
  })
})

describe('(e) les descriptions disent ce que l’outil fait vraiment', () => {
  it('remove_conversation dit qu’elle est irréversible et ce qui disparaît', () => {
    const description = specDe('remove_conversation')?.description ?? ''
    expect(description.toLowerCase()).toMatch(/irr[eé]versible/)
    for (const mot of ['artefacts', 'trace causale', 'prompts']) {
      expect(description).toContain(mot)
    }
    expect(description).toContain('remove_conversations')
  })

  it('navigate énumère les vues possibles, nom et libellé', () => {
    const description = specDe('navigate')?.description ?? ''
    for (const { id, label } of APP_DESTINATIONS) {
      expect(description).toContain(id)
      expect(description).toContain(label)
    }
  })

  it('load_graph dit qu’il change la vue et ne rend pas le savoir', () => {
    const description = specDe('load_graph')?.description ?? ''
    expect(description.length).toBeGreaterThan(80)
    expect(description).toContain('brain_query')
  })

  it('attach_run dit ce qu’attacher change, et qu’il ne lance rien', () => {
    const description = specDe('attach_run')?.description ?? ''
    expect(description.length).toBeGreaterThan(80)
    expect(description).toContain('retrospective')
    expect(description.toLowerCase()).toContain('ne lance')
  })
})

describe('(f) conversation_read remonte le fil et lit un message en entier', () => {
  function busConversation(contenus: string[]): AppCommandBus {
    const conversation = {
      id: 'conv-1',
      title: 'fil',
      provider: 'claude',
      createdAt: 1,
      updatedAt: 2,
      messages: contenus.map((content, ts) => ({ role: 'assistant', content, ts }))
    }
    return nouveauBus({
      conversations: {
        get: (id: string) => (id === 'conv-1' ? conversation : undefined),
        list: () => [conversation]
      }
    })
  }
  const cinquante = Array.from({ length: 50 }, (_, i) => `message ${i}`)
  type Lecture = {
    messages: Array<{ text: string; position: number; tronque?: boolean; suite?: string }>
    restentAvant: number
    restentApres: number
    note: string
  }
  const lire = async (bus: AppCommandBus, args: Record<string, unknown>): Promise<Lecture> =>
    (await bus.exec('conversation_read', { id: 'conv-1', ...args })).data as Lecture

  it('chaque message porte sa position, et le résultat dit combien restent', async () => {
    const data = await lire(busConversation(cinquante), {})
    expect(data.messages).toHaveLength(20)
    expect(data.messages[0]).toMatchObject({ position: 30, text: 'message 30' })
    expect(data.messages.at(-1)).toMatchObject({ position: 49 })
    expect(data.restentAvant).toBe(30)
    expect(data.restentApres).toBe(0)
    expect(data.note).toContain('avant: 30')
  })

  it('`avant` remonte plus haut que les N derniers, en nombre comme en texte', async () => {
    for (const avant of [30, '30']) {
      const data = await lire(busConversation(cinquante), { avant, derniers: 10 })
      expect(data.messages.map((m) => m.position)).toEqual(
        Array.from({ length: 10 }, (_, i) => 20 + i)
      )
      expect(data.restentAvant).toBe(20)
      expect(data.restentApres).toBe(20)
    }
  })

  it('remonter pas à pas finit par tout rendre, sans trou ni doublon', async () => {
    const bus = busConversation(cinquante)
    const lus: number[] = []
    let avant: number | undefined
    // Boucle bornée : sur un résultat sans `restentAvant`, une boucle libre ne finirait jamais.
    for (let appel = 0; appel < 10; appel++) {
      const data = await lire(bus, { derniers: 15, ...(avant === undefined ? {} : { avant }) })
      lus.unshift(...data.messages.map((m) => m.position))
      if (data.restentAvant === 0) break
      avant = data.restentAvant
    }
    expect(lus).toEqual(Array.from({ length: 50 }, (_, i) => i))
  })

  it('un message coupé dit comment lire sa suite, et la suite le recompose en entier', async () => {
    const long = Array.from({ length: 50_000 }, (_, i) => String(i % 10)).join('')
    const bus = busConversation(['court', long])
    const data = await lire(bus, {})
    const coupe = data.messages[1]
    expect(coupe.tronque).toBe(true)
    expect(coupe.suite).toContain('message: 1')
    expect(coupe.suite).toContain('depuis: 4000')

    let recompose = ''
    let depuis: number | undefined = 0
    let appels = 0
    while (depuis !== undefined && appels++ < 20) {
      const r = (await bus.exec('conversation_read', { id: 'conv-1', message: 1, depuis }))
        .data as { text: string; suite?: number; resteCaracteres: number; longueurReelle: number }
      expect(r.longueurReelle).toBe(long.length)
      recompose += r.text
      expect(r.resteCaracteres).toBe(long.length - recompose.length)
      depuis = r.suite
    }
    expect(recompose).toBe(long)
  })

  it('une position hors du fil est un échec qui dit les bornes', async () => {
    const r = await busConversation(cinquante).exec('conversation_read', {
      id: 'conv-1',
      message: 50
    })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('50 message')
  })

  it.each([
    [{ avant: 'abc' }, 'avant'],
    [{ avant: -1 }, 'avant'],
    [{ derniers: 'beaucoup' }, 'derniers'],
    [{ message: 'x' }, 'message'],
    [{ depuis: 10 }, 'depuis'],
    [{ message: 0, avant: 3 }, 'avant']
  ])('une forme inattendue est refusée, jamais ignorée : %j', async (args, nom) => {
    const r = await busConversation(cinquante).exec('conversation_read', { id: 'conv-1', ...args })
    expect(r.ok).toBe(false)
    expect(r.error).toContain(nom)
  })

  it('publie `avant`, `message` et `depuis`, entiers et facultatifs', () => {
    const schema = schemaDe('conversation_read')
    for (const nom of ['avant', 'message', 'depuis']) {
      expect(schema.properties[nom]).toMatchObject({ type: 'integer', minimum: 0 })
    }
    expect(schema.required).toEqual(['id'])
  })
})

describe('(f) conversation_search dit ce qui reste et sait continuer', () => {
  function busCorpus(n: number): AppCommandBus {
    let horloge = 1000
    const conversations = new ConversationStore(() => horloge++)
    for (let i = 0; i < n; i++) {
      const c = conversations.create({ title: `Fil ${i}`, provider: 'claude' })
      conversations.append(c.id, { role: 'user', content: 'le code couleur de la pastille' })
    }
    return nouveauBus({ conversations })
  }
  type Recherche = {
    conversations: Array<{ id: string }>
    restantes: number
    note: string
  }
  const chercher = async (bus: AppCommandBus, args: Record<string, unknown>): Promise<Recherche> =>
    (await bus.exec('conversation_search', { terme: 'pastille', ...args })).data as Recherche

  it('la coupe est dite, et `decalage` rend la suite sans doublon', async () => {
    const bus = busCorpus(12)
    const premiere = await chercher(bus, { limite: 5 })
    expect(premiere.conversations).toHaveLength(5)
    expect(premiere.restantes).toBe(7)
    expect(premiere.note).toContain('decalage: 5')

    for (const decalage of [5, '5']) {
      const seconde = await chercher(bus, { limite: 5, decalage })
      expect(seconde.conversations).toHaveLength(5)
      expect(seconde.restantes).toBe(2)
      const ids = new Set([...premiere.conversations, ...seconde.conversations].map((c) => c.id))
      expect(ids.size).toBe(10)
    }
  })

  it('tout rendu : rien ne reste', async () => {
    const data = await chercher(busCorpus(3), {})
    expect(data.conversations).toHaveLength(3)
    expect(data.restantes).toBe(0)
    expect(data.note).not.toContain('decalage')
  })

  it('une forme inattendue est refusée, jamais ignorée', async () => {
    for (const args of [{ limite: 'dix' }, { extraits: 'x' }, { decalage: -1 }]) {
      const r = await busCorpus(1).exec('conversation_search', { terme: 'pastille', ...args })
      expect(r.ok).toBe(false)
    }
  })

  it('publie `decalage` en entier facultatif', () => {
    const schema = schemaDe('conversation_search')
    expect(schema.properties.decalage).toMatchObject({ type: 'integer', minimum: 0 })
    expect(schema.required).toEqual(['terme'])
  })
})
