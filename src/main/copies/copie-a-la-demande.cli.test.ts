import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { VARIABLE_COPIE_A_LA_DEMANDE } from '../../shared/copie-a-la-demande'
import { armerCopieALaDemandeDuCli, inscrireCopieALaDemande } from './copie-a-la-demande-app'

/*
 * CODEX, GROK ET AGY OUVRENT AUSSI LEUR COPIE À LA PREMIÈRE ÉCRITURE. Avant, seul Claude le faisait :
 * avec les trois autres, la copie s'ouvrait au début du tour dès que la demande semblait toucher au
 * code. Ici tourne le VRAI script que nomment leurs réglages personnels
 * (`scripts/garde-ecriture-hors-copie.mjs`), avec l'entrée que chaque CLI lui envoie, face au vrai
 * guet de l'app.
 */
const SCRIPT = resolve(process.cwd(), 'scripts', 'garde-ecriture-hors-copie.mjs')

const nettoyer: Array<() => void> = []
afterEach(() => {
  for (const f of nettoyer.splice(0)) f()
})

async function banc(conversationId: string, armer = true) {
  const racine = realpathSync.native(mkdtempSync(join(tmpdir(), 'copie-demande-cli-')))
  nettoyer.push(() => rmSync(racine, { recursive: true, force: true }))
  const depot = join(racine, 'depot')
  mkdirSync(join(depot, 'src'), { recursive: true })
  writeFileSync(join(depot, '.gitignore'), '.autowin-data/\n', 'utf8')
  writeFileSync(join(depot, 'src', 'a.ts'), 'export const a = 1\n', 'utf8')
  spawnSync('git', ['init', '-q'], { cwd: depot })
  const copie = join(depot, '.autowin-data', 'copies-de-taches', conversationId)
  let ouvertures = 0
  nettoyer.push(
    inscrireCopieALaDemande(conversationId, {
      depot,
      ouvrir: async () => {
        ouvertures++
        mkdirSync(join(copie, 'src'), { recursive: true })
        return { ok: true, chemin: copie }
      }
    })
  )
  const lancement = armer
    ? await armerCopieALaDemandeDuCli({ conversationId, cwd: depot, intervalleMs: 20 })
    : { env: {}, arreter: (): void => undefined }
  nettoyer.push(lancement.arreter)
  const controle = (entree: Record<string, unknown>): Promise<Record<string, unknown>> =>
    new Promise((resolvePromise) => {
      const enfant = spawn(process.execPath, [SCRIPT], {
        env: { ...process.env, ...lancement.env }
      })
      let sortie = ''
      enfant.stdout.on('data', (b) => (sortie += b))
      enfant.on('close', () => resolvePromise(sortie ? JSON.parse(sortie) : {}))
      enfant.stdin.end(JSON.stringify(entree))
    })
  return { depot, copie, lancement, controle, ouvertures: () => ouvertures }
}

const refus = (sortie: Record<string, unknown>): string | undefined =>
  (sortie.hookSpecificOutput as { permissionDecisionReason?: string } | undefined)
    ?.permissionDecisionReason

describe('le contrôle personnel de Codex, Grok et agy ouvre la copie à la première écriture', () => {
  it('sans lancement armé (le comportement d’avant), l’écriture dans le dossier partagé passait', async () => {
    const b = await banc('conv-avant', false)
    expect(b.lancement.env).toEqual({})
    const sortie = await b.controle({
      tool_name: 'apply_patch',
      tool_input: { command: '*** Begin Patch\n*** Update File: src/a.ts\n*** End Patch' },
      cwd: b.depot
    })
    expect(sortie).toEqual({})
    expect(b.ouvertures()).toBe(0)
  })

  it('Codex : une lecture n’ouvre rien ; son premier correctif ouvre la copie une fois et l’y renvoie', async () => {
    const b = await banc('conv-codex')
    expect(
      await b.controle({ tool_name: 'Bash', tool_input: { command: 'git status' }, cwd: b.depot })
    ).toEqual({})
    expect(b.ouvertures()).toBe(0)

    const motif = refus(
      await b.controle({
        tool_name: 'apply_patch',
        tool_input: {
          command:
            '*** Begin Patch\n*** Update File: src/a.ts\n@@\n-export const a = 1\n+export const a = 2\n*** End Patch'
        },
        cwd: b.depot
      })
    )
    expect(motif).toContain('ouverte juste avant cette première modification')
    expect(motif).toContain(join(b.copie, 'src', 'a.ts'))
    expect(b.ouvertures()).toBe(1)

    // Le correctif refait dans la copie passe ; une commande qui écrit dans le partagé est renvoyée.
    expect(
      await b.controle({
        tool_name: 'apply_patch',
        tool_input: {
          command: `*** Begin Patch\n*** Update File: ${join(b.copie, 'src', 'a.ts')}\n*** End Patch`
        },
        cwd: b.depot
      })
    ).toEqual({})
    expect(
      refus(
        await b.controle({
          tool_name: 'Bash',
          tool_input: { command: ['bash', '-lc', 'echo x > src/b.ts'] },
          cwd: b.depot
        })
      )
    ).toContain(`cd "${b.copie}"`)
    expect(b.ouvertures()).toBe(1)
  })

  it('Grok : ses noms d’outils et ses clés (toolName, toolInput)', async () => {
    const b = await banc('conv-grok')
    expect(
      await b.controle({
        toolName: 'run_terminal_command',
        toolInput: { command: 'cat src/a.ts' },
        cwd: b.depot
      })
    ).toEqual({})
    expect(b.ouvertures()).toBe(0)
    const motif = refus(
      await b.controle({
        toolName: 'search_replace',
        toolInput: { file_path: join(b.depot, 'src', 'a.ts') },
        cwd: b.depot
      })
    )
    expect(motif).toContain(join(b.copie, 'src', 'a.ts'))
    expect(b.ouvertures()).toBe(1)
  })

  it('agy : son entrée (toolCall) et son refus (decision, reason)', async () => {
    const b = await banc('conv-agy')
    expect(
      await b.controle({
        toolCall: { name: 'read_file', args: { Path: join(b.depot, 'src', 'a.ts') } },
        hookEventName: 'PreToolUse',
        cwd: b.depot
      })
    ).toEqual({})
    expect(b.ouvertures()).toBe(0)
    const ecriture = await b.controle({
      toolCall: { name: 'write_file', args: { Path: join(b.depot, 'src', 'n.ts'), Content: 'x' } },
      hookEventName: 'PreToolUse',
      cwd: b.depot
    })
    expect(ecriture.decision).toBe('deny')
    expect(ecriture.reason).toContain(join(b.copie, 'src', 'n.ts'))
    expect(b.ouvertures()).toBe(1)
    const commande = await b.controle({
      toolCall: { name: 'run_command', args: { CommandLine: 'echo fini > c.txt' } },
      hookEventName: 'PreToolUse',
      cwd: b.depot
    })
    expect(commande.decision).toBe('deny')
    expect(commande.reason).toContain(`cd "${b.copie}"`)
    expect(b.ouvertures()).toBe(1)
  })

  it('le dossier du lancement part avec lui, et un fil sans inscription ne reçoit rien', async () => {
    const b = await banc('conv-fin')
    const conf = b.lancement.env[VARIABLE_COPIE_A_LA_DEMANDE]
    expect(existsSync(conf)).toBe(true)
    b.lancement.arreter()
    await expect.poll(() => existsSync(dirname(conf))).toBe(false)
    expect(
      (await armerCopieALaDemandeDuCli({ conversationId: 'conv-inconnu', cwd: b.depot })).env
    ).toEqual({})
    // Déjà dans sa copie : rien à ouvrir, donc rien à désigner au contrôle.
    expect(
      (await armerCopieALaDemandeDuCli({ conversationId: 'conv-fin', cwd: b.copie })).env
    ).toEqual({})
  })
})
