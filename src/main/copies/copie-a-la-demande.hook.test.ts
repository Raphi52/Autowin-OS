import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { scriptHookGardes } from '../../shared/garde-git-destructeur'
import { refusReglageProd } from '../prod/prod-run-guard'
import { armerCopieALaDemande, inscrireCopieALaDemande } from './copie-a-la-demande-app'

/*
 * LE VRAI SCRIPT DU CONTRÔLE, LE VRAI GUET DE L'APP. Rapport de défaut : la copie s'ouvrait au
 * début du tour, même pour « resume cette video ». Ici, le tour part sans copie ; la copie s'ouvre
 * à la première écriture dans le code du dépôt, une seule fois, et l'agent est renvoyé dedans.
 */
const nettoyer: Array<() => void> = []
afterEach(() => {
  for (const f of nettoyer.splice(0)) f()
})

function banc(conversationId: string) {
  const racine = realpathSync.native(mkdtempSync(join(tmpdir(), 'copie-demande-hook-')))
  nettoyer.push(() => rmSync(racine, { recursive: true, force: true }))
  const depot = join(racine, 'depot')
  mkdirSync(join(depot, 'src'), { recursive: true })
  writeFileSync(join(depot, '.gitignore'), '.autowin-data/\n', 'utf8')
  writeFileSync(join(depot, 'src', 'a.ts'), 'export const a = 1\n', 'utf8')
  spawnSync('git', ['init', '-q'], { cwd: depot })
  const lancement = join(racine, 'reglages')
  mkdirSync(lancement)
  const script = join(lancement, 'garde.mjs')
  writeFileSync(script, scriptHookGardes(refusReglageProd), 'utf8')
  const copie = join(depot, '.autowin-data', 'copies-de-taches', conversationId)
  let ouvertures = 0
  const retirer = inscrireCopieALaDemande(conversationId, {
    depot,
    ouvrir: async () => {
      ouvertures++
      mkdirSync(join(copie, 'src'), { recursive: true })
      return { ok: true, chemin: copie }
    }
  })
  nettoyer.push(retirer)
  const controle = (entree: Record<string, unknown>): Promise<string> =>
    new Promise((resolve) => {
      const enfant = spawn(process.execPath, [script])
      let sortie = ''
      enfant.stdout.on('data', (b) => (sortie += b))
      enfant.on('close', () => resolve(sortie))
      enfant.stdin.end(JSON.stringify({ cwd: depot, ...entree }))
    })
  return { depot, copie, lancement, controle, ouvertures: () => ouvertures }
}

const refus = (sortie: string): string | undefined =>
  sortie ? JSON.parse(sortie).hookSpecificOutput?.permissionDecisionReason : undefined

describe('le contrôle ouvre la copie juste avant la première écriture', () => {
  it('sans guet armé (le comportement d’avant), l’écriture dans le dossier partagé passait', async () => {
    const { depot, controle } = banc('conv-avant')
    const sortie = await controle({
      tool_name: 'Edit',
      tool_input: { file_path: join(depot, 'src', 'a.ts') }
    })
    expect(refus(sortie)).toBeUndefined()
  })

  it('une lecture n’ouvre rien ; la première écriture ouvre la copie une fois et renvoie l’agent dedans', async () => {
    const b = banc('conv-T')
    const arreter = await armerCopieALaDemande({
      dossier: b.lancement,
      conversationId: 'conv-T',
      cwd: b.depot,
      intervalleMs: 20
    })
    nettoyer.push(arreter)
    expect(
      refus(await b.controle({ tool_name: 'Bash', tool_input: { command: 'git status' } }))
    ).toBeUndefined()
    expect(
      refus(
        await b.controle({
          tool_name: 'Read',
          tool_input: { file_path: join(b.depot, 'src', 'a.ts') }
        })
      )
    ).toBeUndefined()
    expect(b.ouvertures()).toBe(0)

    const motif = refus(
      await b.controle({
        tool_name: 'Edit',
        tool_input: { file_path: join(b.depot, 'src', 'a.ts') }
      })
    )
    expect(motif).toContain('ouverte juste avant cette première modification')
    expect(motif).toContain(join(b.copie, 'src', 'a.ts'))
    expect(b.ouvertures()).toBe(1)

    // Le geste refait dans la copie passe ; une autre écriture dans le partagé est renvoyée, sans rouvrir.
    expect(
      refus(
        await b.controle({
          tool_name: 'Edit',
          tool_input: { file_path: join(b.copie, 'src', 'a.ts') }
        })
      )
    ).toBeUndefined()
    expect(
      refus(await b.controle({ tool_name: 'Bash', tool_input: { command: 'echo x > src/b.ts' } }))
    ).toContain(`cd "${b.copie}"`)
    expect(b.ouvertures()).toBe(1)
  })

  it('un second lancement du même tour connaît déjà la copie : aucune nouvelle ouverture', async () => {
    const b = banc('conv-U')
    nettoyer.push(
      await armerCopieALaDemande({
        dossier: b.lancement,
        conversationId: 'conv-U',
        cwd: b.depot,
        intervalleMs: 20
      })
    )
    await b.controle({
      tool_name: 'Write',
      tool_input: { file_path: join(b.depot, 'src', 'n.ts') }
    })
    const second = join(b.depot, '..', 'reglages-2')
    mkdirSync(second)
    writeFileSync(join(second, 'garde.mjs'), scriptHookGardes(refusReglageProd), 'utf8')
    nettoyer.push(
      await armerCopieALaDemande({ dossier: second, conversationId: 'conv-U', cwd: b.depot })
    )
    expect(existsSync(join(second, 'copie-ouverte.json'))).toBe(true)
    expect(b.ouvertures()).toBe(1)
  })

  it('un lancement qui travaille déjà ailleurs que dans le dépôt partagé n’est pas armé', async () => {
    const b = banc('conv-V')
    nettoyer.push(
      await armerCopieALaDemande({ dossier: b.lancement, conversationId: 'conv-V', cwd: b.copie })
    )
    expect(existsSync(join(b.lancement, 'copie-a-la-demande.json'))).toBe(false)
  })
})
