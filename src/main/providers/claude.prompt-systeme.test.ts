/**
 * LE PROMPT SYSTÈME D'UN APPEL CLAUDE — audit du branchement (conv-1040, 2026-10-21).
 *
 * Au-delà de 4 000 caractères, il passe par un fichier temporaire `autowin-os-system-*`. Il était
 * écrit en SYNCHRONE, à chaque tour, alors que tout le reste de la préparation est passé en
 * asynchrone après des gels mesurés (jusqu'à 99 s sur le dossier de réglages voisin). Et il était
 * écrit HORS de la zone couverte par le nettoyage d'avant lancement : un échec à cet endroit
 * laissait derrière lui le dossier de réglages déjà créé, le sien, et la config MCP (qui porte un
 * jeton). Même famille : un échec d'écriture des RÉGLAGES abandonnait leur dossier déjà créé.
 */
import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isolerTemp, type TempIsole } from '../temp-isole.test-helpers'

const cap = vi.hoisted(() => ({
  /** Suffixe de fichier dont l'écriture échoue (disque plein, droits) ; absent = aucune panne. */
  panneSur: undefined as string | undefined,
  ecrituresSynchrones: [] as string[],
  lancements: 0
}))

const panne = (chemin: unknown): Error | undefined =>
  cap.panneSur && String(chemin).endsWith(cap.panneSur)
    ? Object.assign(new Error(`ENOSPC: disque plein, ${String(chemin)}`), { code: 'ENOSPC' })
    : undefined

vi.mock('node:fs', async (importOriginal) => {
  const vrai = await importOriginal<typeof import('node:fs')>()
  return {
    ...vrai,
    mkdtempSync: (prefixe: string, ...reste: unknown[]) => {
      cap.ecrituresSynchrones.push(`mkdtempSync ${prefixe}`)
      return (vrai.mkdtempSync as (...a: unknown[]) => string)(prefixe, ...reste)
    },
    writeFileSync: (chemin: unknown, ...reste: unknown[]) => {
      cap.ecrituresSynchrones.push(`writeFileSync ${String(chemin)}`)
      const erreur = panne(chemin)
      if (erreur) throw erreur
      return (vrai.writeFileSync as (...a: unknown[]) => void)(chemin, ...reste)
    }
  }
})

vi.mock('node:fs/promises', async (importOriginal) => {
  const vrai = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...vrai,
    writeFile: async (chemin: unknown, ...reste: unknown[]) => {
      const erreur = panne(chemin)
      if (erreur) throw erreur
      return (vrai.writeFile as (...a: unknown[]) => Promise<void>)(chemin, ...reste)
    }
  }
})

vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  spawn: () => {
    cap.lancements++
    const fils = new EventEmitter() as EventEmitter & Record<string, unknown>
    const stdout = new EventEmitter()
    fils.stdout = stdout
    fils.stderr = new EventEmitter()
    fils.stdin = { end: (): void => {} }
    fils.exitCode = null
    fils.kill = (): boolean => true
    fils.unref = (): void => {}
    setTimeout(() => {
      const resultat = {
        type: 'result',
        subtype: 'success',
        result: 'ok',
        session_id: 's',
        is_error: false,
        usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0 }
      }
      stdout.emit('data', Buffer.from(`${JSON.stringify(resultat)}\n`))
      fils.emit('close', 0)
    }, 0)
    return fils
  }
}))

let temp: TempIsole
let journalAvant: string | undefined
beforeEach(() => {
  temp = isolerTemp()
  journalAvant = process.env.AUTOWIN_RUN_JOURNAL_ROOT
  delete process.env.AUTOWIN_RUN_JOURNAL_ROOT
  cap.panneSur = undefined
  cap.ecrituresSynchrones = []
  cap.lancements = 0
})
afterEach(() => {
  temp.demonter()
  if (journalAvant === undefined) delete process.env.AUTOWIN_RUN_JOURNAL_ROOT
  else process.env.AUTOWIN_RUN_JOURNAL_ROOT = journalAvant
})

async function issueDeLAppel(system: string): Promise<string> {
  const { ClaudeCliAdapter } = await import('./claude')
  const gen = new ClaudeCliAdapter({ bin: 'claude' }).send([{ role: 'user', content: 'Salut' }], {
    system
  })
  try {
    let pas = await gen.next()
    while (!pas.done) pas = await gen.next()
    return 'rendu'
  } catch (error) {
    return `échec: ${(error as Error).message}`
  }
}

describe('prompt système long', () => {
  it('écrit SANS aucune entrée-sortie synchrone (ni dossier, ni fichier)', async () => {
    expect(await issueDeLAppel('S'.repeat(5_000))).toBe('rendu')
    expect(cap.lancements).toBe(1)
    expect(cap.ecrituresSynchrones.filter((e) => /autowin-os-system-|system\.md/.test(e))).toEqual(
      []
    )
  })

  it('son écriture échoue : l’appel échoue sans lancer le CLI ni laisser de temporaire', async () => {
    cap.panneSur = 'system.md'
    const avant = new Set(temp.lister())
    const issue = await issueDeLAppel('S'.repeat(5_000))
    expect(issue).toMatch(/^échec: ENOSPC/)
    expect(cap.lancements).toBe(0)
    expect(temp.lister().filter((nom) => !avant.has(nom))).toEqual([])
  })
})

describe('réglages de l’appel', () => {
  it('leur écriture échoue : l’appel continue sans eux et leur dossier ne reste pas', async () => {
    cap.panneSur = 'settings.json'
    const avant = new Set(temp.lister())
    expect(await issueDeLAppel('court')).toBe('rendu')
    expect(cap.lancements).toBe(1)
    expect(temp.lister().filter((nom) => !avant.has(nom))).toEqual([])
  })
})
