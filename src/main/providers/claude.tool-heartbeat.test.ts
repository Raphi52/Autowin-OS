import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Même harnais de spawn que claude.api-retry.test.ts : on rejoue une séquence stream-json arbitraire.
const spawnCapture = vi.hoisted(() => ({
  stdoutEvents: [] as Array<Record<string, unknown>>
}))
vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  spawn: () => {
    const child = new EventEmitter() as EventEmitter & Record<string, unknown>
    const stdout = new EventEmitter()
    child.stdout = stdout
    child.stderr = new EventEmitter()
    child.stdin = { end: (): void => {} }
    child.kill = (): boolean => true
    child.unref = (): void => {}
    child.exitCode = null
    setTimeout(() => {
      for (const event of spawnCapture.stdoutEvents.splice(0))
        stdout.emit('data', Buffer.from(`${JSON.stringify(event)}\n`))
      child.emit('close', 0)
    }, 0)
    return child
  }
}))

beforeEach(() => {
  spawnCapture.stdoutEvents = []
})

/**
 * Draine le canal STATUS — pas le raisonnement. Un battement d'outil ou de tache de fond n'est pas
 * une pensee du modele : depuis le 2026-09-01 il voyage dans `chunk.status`, affiche dans la meta du
 * tour, et le bloc « Reflexion » ne porte plus que du vrai `thinking` (constat utilisateur : ces
 * lignes techniques y passaient pour du raisonnement et polluaient la lecture).
 */
async function drainStatus(): Promise<string[]> {
  const { ClaudeCliAdapter } = await import('./claude')
  const gen = new ClaudeCliAdapter({ bin: 'claude' }).send([{ role: 'user', content: 'Salut' }])
  const statuts: string[] = []
  let step = await gen.next()
  while (!step.done) {
    if (step.value.status) statuts.push(step.value.status)
    step = await gen.next()
  }
  return statuts
}

const succes = {
  type: 'result',
  subtype: 'success',
  result: 'ok',
  session_id: 's',
  is_error: false,
  usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0 }
}

/**
 * UN OUTIL QUI TOURNE 15 MINUTES DOIT SE VOIR.
 *
 * Vécu le 2026-08-22 (run-f173a3f73600-1) : un sous-agent `build` lance `npx vitest run` sur toute
 * la suite, timeout 900 s. Le CLI émet un `tool_progress` toutes les 30 s — le flux était VIVANT,
 * mesuré à la seconde près sur `run-stdout/2e6b2eed-….stdout.jsonl`. Mais rien dans l'app ne lisait
 * ce type d'évènement : la carte du fil restait sur « 1 action en cours », muette. L'utilisateur en
 * a conclu un blocage et a réécrit sa demande. C'est le MÊME défaut que la surcharge API (529)
 * corrigée le 2026-08-05, sur un autre évènement muet.
 */
describe('ClaudeCliAdapter — un outil long donne signe de vie', () => {
  it('relaie le battement de progression avec l’outil et la durée', async () => {
    spawnCapture.stdoutEvents = [
      {
        type: 'tool_progress',
        tool_use_id: 'toolu_1-heartbeat-4',
        tool_name: 'Bash',
        elapsed_time_seconds: 150,
        heartbeat: true
      },
      succes
    ]
    const statuts = await drainStatus()

    expect(statuts).toHaveLength(1)
    expect(statuts[0]).toContain('Bash')
    expect(statuts[0]).toContain('2 min 30 s')
  })

  it('rend les secondes lisibles sous la minute', async () => {
    spawnCapture.stdoutEvents = [
      { type: 'tool_progress', tool_name: 'Bash', elapsed_time_seconds: 30, heartbeat: true },
      succes
    ]
    const statuts = await drainStatus()

    expect(statuts[0]).toContain('30 s')
    expect(statuts[0]).not.toContain('min')
  })

  it('nomme l’outil « outil » quand le CLI ne le dit pas', async () => {
    // Un battement sans `tool_name` reste un signe de vie : mieux vaut un libellé générique que
    // « undefined » affiché à l'utilisateur.
    spawnCapture.stdoutEvents = [
      { type: 'tool_progress', elapsed_time_seconds: 60, heartbeat: true },
      succes
    ]
    const statuts = await drainStatus()

    expect(statuts[0]).toContain('outil')
    expect(statuts[0]).not.toContain('undefined')
  })

  /*
   * « BASH EN COURS - 9 MIN » NE DIT RIEN. Mesure du 2026-09-04 (conv-288) : neuf minutes de
   * battements nus pendant un `vitest run` sur six suites. L'utilisateur voyait la machine tourner
   * sans pouvoir distinguer une suite de tests d'une boucle folle. La commande etait DEJA connue de
   * l'app — captee au `tool_use` — elle n'etait simplement pas relue au moment du battement.
   */
  it('nomme la COMMANDE qui tourne, pas seulement « Bash »', async () => {
    spawnCapture.stdoutEvents = [
      {
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              id: 'toolu_long',
              name: 'Bash',
              input: { command: 'cd "$(pwd)" && npx vitest run src/main/store' }
            }
          ]
        }
      },
      {
        type: 'tool_progress',
        tool_use_id: 'toolu_long',
        tool_name: 'Bash',
        elapsed_time_seconds: 540,
        heartbeat: true
      },
      succes
    ]
    const statuts = await drainStatus()

    const battement = statuts[statuts.length - 1]
    expect(battement).toContain('9 min')
    expect(battement).toContain('vitest run src/main/store')
    expect(battement).not.toContain('$(pwd)')
  })

  it('retombe sur le dernier appel ouvert quand le CLI n’attache pas l’id', async () => {
    spawnCapture.stdoutEvents = [
      {
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              id: 'toolu_sans_id',
              name: 'Bash',
              input: { command: 'npm run build' }
            }
          ]
        }
      },
      { type: 'tool_progress', tool_name: 'Bash', elapsed_time_seconds: 60, heartbeat: true },
      succes
    ]
    const statuts = await drainStatus()

    expect(statuts[statuts.length - 1]).toContain('npm run build')
  })

  it('ignore un tool_progress SANS durée : il n’apprend rien', async () => {
    spawnCapture.stdoutEvents = [
      { type: 'tool_progress', tool_name: 'Bash', heartbeat: true },
      succes
    ]

    expect(await drainStatus()).toHaveLength(0)
  })
})

/**
 * UNE TACHE DE FOND EST TOUT AUSSI MUETTE — et c'est le meme defaut, un cran plus loin.
 *
 * Le relais ci-dessus couvre l'outil de PREMIER PLAN, qui recoit un `tool_progress` toutes les 30 s.
 * Mais quand le sous-agent lance sa commande EN ARRIERE-PLAN, le CLI n'emet aucun `tool_progress` :
 * il emet `system/task_started` puis, a la fin seulement, `system/task_notification`.
 *
 * Mesure du 2026-08-22 sur `run-stdout/162bdf21-….stdout.jsonl`, run en cours au moment du signalement
 * de l'utilisateur (« ca reste bloque visuellement sur cette etape pendant tres longtemps ») : la
 * queue du journal ne contenait QUE `thinking_tokens`, `task_started` et `task_notification` — zero
 * `tool_progress`. Le flux etait VIVANT (+17 Ko en 40 s, mesure directe) et la carte figee. La
 * commande en cours etait `./node_modules/.bin/vitest run`, soit la suite complete : ~9 min mesurees
 * ce jour sur 713 fichiers.
 *
 * `task_started` / `task_notification` n'etaient traites NULLE PART dans le depot.
 */
describe('ClaudeCliAdapter — une tache de fond donne signe de vie', () => {
  it('annonce la tache de fond lancee, en disant QUELLE commande', async () => {
    spawnCapture.stdoutEvents = [
      {
        type: 'system',
        subtype: 'task_started',
        task_id: 'b6vl4y8jf',
        task_type: 'local_bash',
        description: 'cd "$(pwd)" && ./node_modules/.bin/vitest run 2>&1 | tail -6'
      },
      succes
    ]
    const statuts = await drainStatus()

    expect(statuts).toHaveLength(1)
    expect(statuts[0]).toContain('fond')
    // La commande, pas un libelle generique : « une tache tourne » ne dit pas s'il faut attendre
    // 3 secondes ou 9 minutes.
    expect(statuts[0]).toContain('vitest')
    // Le `cd "$(pwd)" &&` qui prefixe toutes les commandes n'apprend rien et mange la place.
    expect(statuts[0]).not.toContain('$(pwd)')
  })

  it('rend la commande ENTIERE, sans jamais la tronquer', async () => {
    // Demande explicite du 2026-09-01 : « met pas de nb max de caracteres par ligne, jveux tout
    // voir ». L'ancienne coupe a 70 caracteres remplacait la fin par « … », et c'est justement la
    // fin qui dit ce que la commande cherche.
    const commande = "ls /tmp/aos-pilot-sess-6irA6U/autowin-os | head -30; echo ---; find /tmp/aos-pilot-sess-6irA6U -name '*.ts' -newermt '-2 hours' | head -40"
    spawnCapture.stdoutEvents = [
      {
        type: 'system',
        subtype: 'task_started',
        task_id: 'longue',
        task_type: 'local_bash',
        description: `cd "$(pwd)" && ${commande}`
      },
      succes
    ]
    const statuts = await drainStatus()

    expect(statuts[0]).toContain(commande)
    expect(statuts[0]).not.toContain('…')
  })

  it('annonce la fin de la tache de fond', async () => {
    spawnCapture.stdoutEvents = [
      {
        type: 'system',
        subtype: 'task_notification',
        task_id: 'b6vl4y8jf',
        status: 'completed',
        summary: 'cd "$(pwd)" && npx eslint src/renderer/src/components/home-decor-scene.ts'
      },
      succes
    ]
    const statuts = await drainStatus()

    expect(statuts).toHaveLength(1)
    expect(statuts[0]).toContain('eslint')
  })

  it('sans description, dit quand meme qu une tache tourne — sans rien inventer', async () => {
    spawnCapture.stdoutEvents = [
      { type: 'system', subtype: 'task_started', task_id: 'x1', task_type: 'local_bash' },
      succes
    ]
    const statuts = await drainStatus()

    expect(statuts).toHaveLength(1)
    expect(statuts[0]).toContain('fond')
  })

  /*
   * UNE TACHE DE FOND TUEE A LA FIN DU TOUR NE REVIENDRA JAMAIS — il faut le DIRE dans la reponse.
   * Mesure conv-528, turnId 6dbf5a57-e142-46ca-bdf7-2ba66fc76dc9 : `task_started` a 1789370085871,
   * reponse « Le script tourne en fond. Je te rends le résultat dès qu'il se termine. », puis
   * `task_notification` status `stopped` a 1789370094489 et `done` 263 ms apres. Aucun resultat
   * n'est jamais revenu ; l'utilisateur a attendu 2 h 24 puis a lance /kaizen « cette conv a buggé ».
   */
  it('une tache de fond arretee ou encore ouverte a la fin du tour est signalee DANS la reponse', async () => {
    const { ClaudeCliAdapter } = await import('./claude')
    spawnCapture.stdoutEvents = [
      { type: 'system', subtype: 'task_started', task_id: 'k1', description: 'node salvage.mjs' },
      { type: 'system', subtype: 'task_started', task_id: 'k2', description: 'npx vitest run' },
      {
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'Le script tourne en fond. Je te rends le résultat.' }] }
      },
      { type: 'system', subtype: 'task_notification', task_id: 'k1', status: 'stopped', summary: 'node salvage.mjs' },
      succes
    ]
    const gen = new ClaudeCliAdapter({ bin: 'claude' }).send([{ role: 'user', content: 'Salut' }])
    let texte = ''
    let step = await gen.next()
    while (!step.done) {
      texte += step.value.delta ?? ''
      step = await gen.next()
    }
    expect(texte).toContain('node salvage.mjs')
    expect(texte).toContain('npx vitest run')
    expect(texte).toMatch(/ne reviendra pas/)
    // k1 a recu `stopped`, k2 aucune notification : le message ne doit pas dire « arretee » pour k2.
    expect(texte).toMatch(/arrêtée[^\n]*node salvage\.mjs/)
    expect(texte).toMatch(/pas terminée[^\n]*npx vitest run/)
    expect(texte).not.toMatch(/arrêtée[^\n]*npx vitest run/)
  })

  it('une tache de fond TERMINEE avant la fin du tour ne declenche aucun avertissement', async () => {
    const { ClaudeCliAdapter } = await import('./claude')
    spawnCapture.stdoutEvents = [
      { type: 'system', subtype: 'task_started', task_id: 'k3', description: 'npx eslint' },
      { type: 'system', subtype: 'task_notification', task_id: 'k3', status: 'completed', summary: 'npx eslint' },
      succes
    ]
    const gen = new ClaudeCliAdapter({ bin: 'claude' }).send([{ role: 'user', content: 'Salut' }])
    let texte = ''
    let step = await gen.next()
    while (!step.done) {
      texte += step.value.delta ?? ''
      step = await gen.next()
    }
    expect(texte).not.toMatch(/ne reviendra pas/)
  })

  it('une tache de fond en ECHEC le dit, au lieu de se taire', async () => {
    spawnCapture.stdoutEvents = [
      {
        type: 'system',
        subtype: 'task_notification',
        task_id: 'x2',
        status: 'failed',
        summary: 'npx vitest run'
      },
      succes
    ]
    const statuts = await drainStatus()

    expect(statuts[0]).toMatch(/échec|echec|failed/i)
  })
})

/*
 * UNE COMMANDE SHELL COUPEE EN FIN DE TOUR EST RELANCEE PAR L'APP, PAS PERDUE.
 *
 * Quand l'appelant (le tour de chat) annonce `relancerTachesDeFond`, la commande `local_bash` encore
 * ouverte part dans `tachesDeFondARelancer` et la reponse dit qu'elle REVIENDRA — au lieu de
 * « relance la demande ». Un agent ou une surveillance n'a qu'une phrase : jamais executee.
 */
describe('ClaudeCliAdapter — tache de fond coupee, relancee par l appelant', () => {
  async function envoyer(
    // Un tour de chat a toujours un dossier de travail (`dossierDeTravailDuTour`).
    options: { relancerTachesDeFond?: boolean; workspaceCwd?: string } = {
      relancerTachesDeFond: true,
      workspaceCwd: process.cwd()
    }
  ): Promise<{ texte: string; res: import('./types').SendResult }> {
    const { ClaudeCliAdapter } = await import('./claude')
    const gen = new ClaudeCliAdapter({ bin: 'claude' }).send(
      [{ role: 'user', content: 'Salut' }],
      options
    )
    let texte = ''
    let step = await gen.next()
    while (!step.done) {
      texte += step.value.delta ?? ''
      step = await gen.next()
    }
    return { texte, res: step.value }
  }
  // FORME REELLE (mesure du 2026-10-09) : l'appel `Bash` porte la commande, `task_started` porte une
  // PHRASE dans `description`, le lien `tool_use_id` et `is_backgrounded`.
  const bash = (id: string, commande: string): Array<Record<string, unknown>> => [
    {
      type: 'assistant',
      message: {
        content: [
          {
            type: 'tool_use',
            id: `toolu_${id}`,
            name: 'Bash',
            input: { command: commande, run_in_background: true }
          }
        ]
      }
    },
    {
      type: 'system',
      subtype: 'task_started',
      task_id: id,
      tool_use_id: `toolu_${id}`,
      is_backgrounded: true,
      task_type: 'local_bash',
      description: `Run ${id} in background`
    }
  ]

  it('cas 1 — aucune tache : ni liste ni avis', async () => {
    spawnCapture.stdoutEvents = [succes]
    const { texte, res } = await envoyer()
    expect(res.tachesDeFondARelancer).toBeUndefined()
    expect(texte).not.toMatch(/Tâche de fond/)
  })

  it('cas 2 — tache finie a temps : rien a relancer', async () => {
    spawnCapture.stdoutEvents = [
      ...bash('f1', 'npx eslint'),
      { type: 'system', subtype: 'task_notification', task_id: 'f1', status: 'completed' },
      succes
    ]
    const { res } = await envoyer()
    expect(res.tachesDeFondARelancer).toBeUndefined()
  })

  it('cas 3 — commande shell arretee : listee, sans « relance la demande »', async () => {
    spawnCapture.stdoutEvents = [
      ...bash('b1', './node_modules/.bin/vitest run 2>&1 | tail -6'),
      { type: 'system', subtype: 'task_notification', task_id: 'b1', status: 'stopped' },
      succes
    ]
    const { texte, res } = await envoyer()
    expect(res.tachesDeFondARelancer).toEqual([
      { id: 'b1', commande: './node_modules/.bin/vitest run 2>&1 | tail -6', cwd: expect.any(String) }
    ])
    expect(texte).not.toMatch(/relance la demande/)
    expect(texte).not.toMatch(/⚠️ Tâche de fond/)
    expect(texte).toMatch(/reviendra dans ce fil/)
  })

  it('jumeau du cas 3 — sans le drapeau de l appelant, l avis historique reste', async () => {
    spawnCapture.stdoutEvents = [...bash('b1', 'npx vitest run'), succes]
    const { texte, res } = await envoyer({})
    expect(res.tachesDeFondARelancer).toBeUndefined()
    expect(texte).toMatch(/relance la demande/)
  })

  it('cas 4 — commande vide : rien a relancer, avis historique garde', async () => {
    spawnCapture.stdoutEvents = [
      { type: 'system', subtype: 'task_started', task_id: 'v1', task_type: 'local_bash', description: '  ' },
      succes
    ]
    const { texte, res } = await envoyer()
    expect(res.tachesDeFondARelancer).toBeUndefined()
    expect(texte).toMatch(/relance la demande/)
  })

  it('cas 5 — un agent (pas local_bash) n est jamais execute', async () => {
    spawnCapture.stdoutEvents = [
      {
        type: 'system',
        subtype: 'task_started',
        task_id: 'a1',
        task_type: 'local_agent',
        description: 'Run the 6 bench replicas on reconstructed data'
      },
      succes
    ]
    const { texte, res } = await envoyer()
    expect(res.tachesDeFondARelancer).toBeUndefined()
    expect(texte).toMatch(/⚠️ Tâche de fond pas terminée[^\n]*Run the 6 bench/)
  })

  it('cas 6 — meme task_id signale deux fois, plus une seconde : chacune une seule fois', async () => {
    spawnCapture.stdoutEvents = [
      ...bash('d1', 'node a.mjs'),
      { type: 'system', subtype: 'task_notification', task_id: 'd1', status: 'stopped' },
      { type: 'system', subtype: 'task_notification', task_id: 'd1', status: 'stopped' },
      ...bash('d2', 'node b.mjs'),
      succes
    ]
    const { res } = await envoyer()
    expect(res.tachesDeFondARelancer?.map((t) => t.id)).toEqual(['d1', 'd2'])
  })

  it('melange shell + agent : le shell est relance, l agent garde son avis', async () => {
    spawnCapture.stdoutEvents = [
      ...bash('m1', 'node a.mjs'),
      { type: 'system', subtype: 'task_started', task_id: 'm2', task_type: 'local_agent', description: 'Explore' },
      succes
    ]
    const { texte, res } = await envoyer()
    expect(res.tachesDeFondARelancer?.map((t) => t.commande)).toEqual(['node a.mjs'])
    expect(texte).toMatch(/⚠️ Tâche de fond pas terminée[^\n]*Explore/)
    expect(texte).not.toMatch(/⚠️[^\n]*node a\.mjs/)
  })

  /*
   * FORME REELLE DU CLI (mesure du 2026-10-09, `run-stdout/790829d2-….stdout.jsonl` l.2287-2307) :
   * `description` est la PHRASE que le modele donne a l'outil (« Run app settings test and workspace
   * check in background »), pas la commande. La commande vit dans l'appel `Bash` que `tool_use_id`
   * designe. Executer `description` lancait `bash -c "Run app settings test…"`.
   */
  const COMMANDE_REELLE = 'cd "$(pwd)" && npx vitest run src/a.test.ts 2>&1 | tail -6'
  const appelBash = (id: string, input: Record<string, unknown>): Record<string, unknown> => ({
    type: 'assistant',
    message: { content: [{ type: 'tool_use', id, name: 'Bash', input }] }
  })
  const demarrageReel = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
    type: 'system',
    subtype: 'task_started',
    task_id: 'b19nec3ym',
    tool_use_id: 'toolu_fond',
    description: 'Run app settings test and workspace check in background',
    is_backgrounded: true,
    task_type: 'local_bash',
    ...extra
  })

  it('forme reelle : relance la commande de l’appel Bash, JAMAIS la phrase de `description`', async () => {
    spawnCapture.stdoutEvents = [
      appelBash('toolu_fond', { command: COMMANDE_REELLE, run_in_background: true }),
      demarrageReel(),
      { type: 'system', subtype: 'task_notification', task_id: 'b19nec3ym', status: 'stopped' },
      succes
    ]
    const { texte, res } = await envoyer()
    expect(res.tachesDeFondARelancer).toEqual([
      { id: 'b19nec3ym', commande: COMMANDE_REELLE, cwd: process.cwd() }
    ])
    expect(texte).toMatch(/reviendra dans ce fil/)
  })

  it('forme reelle : sans appel Bash relie, la phrase n’est jamais executee — avis historique garde', async () => {
    spawnCapture.stdoutEvents = [demarrageReel(), succes]
    const { texte, res } = await envoyer()
    expect(res.tachesDeFondARelancer).toBeUndefined()
    expect(texte).toMatch(/relance la demande/)
  })

  it('premier plan coupe en cours de tour : son resultat est arrive (Exit code 137), rien a relancer ni a signaler', async () => {
    // `bcdda33b-….stdout.jsonl` l.1647-1753 : `is_backgrounded: false`, `stopped`, puis tool_result.
    spawnCapture.stdoutEvents = [
      appelBash('toolu_fond', { command: COMMANDE_REELLE }),
      demarrageReel({ is_backgrounded: false }),
      { type: 'system', subtype: 'task_notification', task_id: 'b19nec3ym', status: 'stopped' },
      {
        type: 'user',
        message: {
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_fond',
              content: 'Exit code 137',
              is_error: true
            }
          ]
        }
      },
      succes
    ]
    const { texte, res } = await envoyer()
    expect(res.tachesDeFondARelancer).toBeUndefined()
    expect(texte).not.toMatch(/Tâche de fond/)
  })

  it('sans dossier du tour connu, rien ne part dans le dossier de l’app — avis historique garde', async () => {
    // L'app pose ce dossier global au demarrage : sans lui ni `workspaceCwd`, aucun dossier n'est connu.
    vi.stubEnv('AUTOWIN_OS_WORKSPACE', '')
    spawnCapture.stdoutEvents = [
      appelBash('toolu_fond', { command: COMMANDE_REELLE, run_in_background: true }),
      demarrageReel(),
      succes
    ]
    try {
      const { texte, res } = await envoyer({ relancerTachesDeFond: true, workspaceCwd: undefined })
      expect(res.tachesDeFondARelancer).toBeUndefined()
      expect(texte).toMatch(/relance la demande/)
    } finally {
      vi.unstubAllEnvs()
    }
  })
})

/**
 * UNE RAFALE DE LECTURES MUETTE PASSE POUR UNE APP MORTE.
 *
 * Mesure du 2026-08-31, run conv-9 (`scout-pour-trouver-les-causes-des-freeze-mth6zqy8-workspace`) :
 * un sous-agent `scout` a enchaine 52 appels d'outils (26 Read, 23 Grep, 3 Glob), TOUS reussis,
 * pendant 223 659 ms — et a produit ZERO texte. Le journal `causal-trace/conv-9.jsonl` montre un
 * SEUL trou ininterrompu de 224 s sans aucun evenement live, puis les 52 enregistrements d'un coup
 * en 12 ms a la toute fin. L'utilisateur a stoppe a 3 min 43 : son clic etait rationnel, rien ne
 * distinguait « travaille » de « mort ». Le run est parti rouge avec un livrable vide.
 *
 * Le battement `tool_progress` ci-dessus ne couvre PAS ce cas : le CLI ne l'emet que pour un outil
 * LONG (30 s de silence). Une rafale de lectures rapides n'en declenche aucun. L'app savait pourtant
 * que le sous-agent etait vivant — `watchdog.beat()` est nourri a chaque ligne de stdout, y compris
 * ces lignes-la (`claude.ts`, `consumeText`). Elle s'en servait pour le laisser tourner sans jamais
 * le dire a l'utilisateur.
 */
describe('ClaudeCliAdapter — une rafale d’outils rapides donne signe de vie', () => {
  const appelOutil = (
    id: string,
    name: string,
    input: Record<string, unknown>
  ): Record<string, unknown> => ({
    type: 'assistant',
    message: { content: [{ type: 'tool_use', id, name, input }] }
  })

  it('emet un signe de vie par appel d’outil, meme sans une ligne de texte', async () => {
    spawnCapture.stdoutEvents = [
      appelOutil('t1', 'Read', { file_path: 'src/main/index.ts' }),
      appelOutil('t2', 'Grep', { pattern: 'gels.jsonl' }),
      appelOutil('t3', 'Glob', { pattern: '**/*.ts' }),
      succes
    ]
    const reasoning = await drainStatus()

    expect(reasoning).toHaveLength(3)
    expect(reasoning[0]).toContain('Read')
    expect(reasoning[1]).toContain('Grep')
    expect(reasoning[2]).toContain('Glob')
  })

  it('nomme la CIBLE de l’outil, pas seulement l’outil — « Read » seul ne prouve pas l’avancement', async () => {
    spawnCapture.stdoutEvents = [
      appelOutil('t1', 'Read', { file_path: 'src/main/providers/claude.ts' }),
      succes
    ]
    const reasoning = await drainStatus()

    expect(reasoning[0]).toContain('claude.ts')
  })

  /*
   * UNE LIGNE, PAS TROIS. Le libelle partait avec de VRAIS retours a la ligne (`\n` + nom + `\n` +
   * cible) : dans le bloc « Reflexion » deplie, chaque appel d'outil ajoutait donc deux lignes vides,
   * et l'en-tete repliee recevait un texte multiligne. Constat du 2026-09-01.
   */
  it('tient sur UNE ligne — outil · cible, sans retour a la ligne', async () => {
    spawnCapture.stdoutEvents = [
      appelOutil('t1', 'Read', { file_path: 'src/main/index.ts' }),
      succes
    ]
    const reasoning = await drainStatus()

    expect(reasoning[0]).toBe('Read · src/main/index.ts')
    expect(reasoning[0]).not.toContain('\n')
  })

  /*
   * CONTROLE DISCRIMINANT — l'entree qui DOIT laisser le test a zero. Sans lui, un relais qui
   * pousse sur n'importe quel evenement passerait le test ci-dessus sans rien prouver.
   */
  it('ne relaie RIEN quand aucun outil n’est appele', async () => {
    spawnCapture.stdoutEvents = [
      { type: 'assistant', message: { content: [{ type: 'text', text: 'Voici la reponse.' }] } },
      succes
    ]
    const reasoning = await drainStatus()

    expect(reasoning).toHaveLength(0)
  })
})

/**
 * FIN D'ACTION — le bloc Actions (frise C3, conv-831, 2026-09-24) colore chaque action selon son
 * RESULTAT. Ce resultat n'existait que dans `executionEvidence` ; il voyage desormais aussi dans le
 * canal status, sous une forme que `thinking-block-corps.ts` replie sur la ligne de l'outil.
 */
describe('ClaudeCliAdapter — la fin d’une action dit si elle a échoué', () => {
  it('émet « outil échoué - durée » au résultat en erreur, « terminé » sinon', async () => {
    spawnCapture.stdoutEvents = [
      {
        type: 'assistant',
        message: {
          content: [
            { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'npm test' } },
            { type: 'tool_use', id: 't2', name: 'Read', input: { file_path: 'src/a.ts' } }
          ]
        }
      },
      {
        type: 'user',
        message: {
          content: [
            { type: 'tool_result', tool_use_id: 't1', is_error: true, content: '2 rouges' },
            { type: 'tool_result', tool_use_id: 't2', content: 'ok' }
          ]
        }
      },
      succes
    ]
    const statuts = await drainStatus()

    expect(statuts).toContain('Bash · npm test')
    expect(statuts.find((s) => s.startsWith('Bash échoué'))).toMatch(/^Bash échoué - \d+ s$/)
    expect(statuts.find((s) => s.startsWith('Read terminé'))).toMatch(/^Read terminé - \d+ s$/)
  })
})

/**
 * CE QU'UNE LECTURE A RENDU — mesure du 2026-09-27 (sonde `probe-think-brain.mts`) : un nœud `think`
 * lit des notes du Brain par `Read` et fouille le Brain par `Grep`. La preuve gardait les 20 000
 * DERNIERS caractères du résultat et rien du `Grep` (ni dossier, ni motif) : impossible de dire ce
 * qui avait été lu, ni combien.
 */
describe('ClaudeCliAdapter — une lecture garde sa longueur totale, une recherche son dossier et son motif', () => {
  it('outputChars = longueur ENTIÈRE du résultat ; Grep porte searchPath et pattern', async () => {
    spawnCapture.stdoutEvents = [
      {
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              id: 'r1',
              name: 'Read',
              input: { file_path: 'K:\\b\\knowledge\\a.md' }
            },
            {
              type: 'tool_use',
              id: 'g1',
              name: 'Grep',
              input: { pattern: 'Ult_Heure', path: 'K:\\b\\knowledge' }
            }
          ]
        }
      },
      {
        type: 'user',
        message: {
          content: [
            { type: 'tool_result', tool_use_id: 'r1', content: 'x'.repeat(25_000) },
            { type: 'tool_result', tool_use_id: 'g1', content: 'a.md:3: Ult_Heure' }
          ]
        }
      },
      succes
    ]
    const { ClaudeCliAdapter } = await import('./claude')
    const gen = new ClaudeCliAdapter({ bin: 'claude' }).send([{ role: 'user', content: 'Salut' }])
    let step = await gen.next()
    while (!step.done) step = await gen.next()
    // Les preuves voyagent dans la valeur FINALE du générateur (`return`), pas dans un morceau.
    const preuves = ((step.value as { executionEvidence?: Array<Record<string, unknown>> })
      .executionEvidence ?? []) as Array<Record<string, unknown>>
    const lecture = preuves.find((p) => p.type === 'Read')
    const recherche = preuves.find((p) => p.type === 'Grep')
    expect(lecture).toMatchObject({ path: 'K:\\b\\knowledge\\a.md', outputChars: 25_000 })
    expect(String(lecture?.stdout).length).toBe(20_000)
    expect(recherche).toMatchObject({
      searchPath: 'K:\\b\\knowledge',
      pattern: 'Ult_Heure',
      outputChars: 17
    })
    // La recherche ne devient PAS un fichier touché : aucun `path`/`paths` pour un Grep.
    expect(recherche?.path).toBeUndefined()
    expect(recherche?.paths).toBeUndefined()
  })
})
