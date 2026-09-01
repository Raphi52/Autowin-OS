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
