import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { SendOptions, SendResult } from '../providers/types'
import { argumentsMcpNoeudSkill } from '../providers/claude'
import {
  etapeQuiRecoitLesOutilsDuLot,
  lanceurDuLot,
  registreAvecOutilsDuLot
} from './outils-du-lot'

const specs = [
  { name: 'ecrire_a_un_fil', description: 'écrire', args: {} },
  { name: 'proprietaire_fichier', description: 'à qui est ce fichier', args: {} },
  { name: 'orchestrate', description: 'lancer un run', args: {} }
]

describe('lanceurDuLot — l’outil d’une étape de lot', () => {
  const appels: Array<{ name: string; fil: string }> = []
  const deps = {
    estUnLot: (fil: string) => fil === 'conv-lot',
    exec: async (name: string, _args: Record<string, unknown>, fil: string) => {
      appels.push({ name, fil })
      return { ok: true }
    },
    catalogue: () => specs
  }

  it('rien pour un fil hors plan ou sans fil', () => {
    expect(lanceurDuLot('conv-seul', deps)).toBeUndefined()
    expect(lanceurDuLot(undefined, deps)).toBeUndefined()
  })

  it('signe le message du fil du lot et refuse toute autre commande', async () => {
    appels.length = 0
    const lanceur = lanceurDuLot('conv-lot', deps)!
    await lanceur.exec('ecrire_a_un_fil', { destinataire: 'conv-chef', texte: '?' })
    const refus = await lanceur.exec('orchestrate', { task: 'x' })
    expect(appels).toEqual([{ name: 'ecrire_a_un_fil', fil: 'conv-lot' }])
    expect(refus.ok).toBe(false)
    expect(lanceur.catalogue!().map((s) => s.name)).toEqual([
      'ecrire_a_un_fil',
      'proprietaire_fichier'
    ])
  })

  /*
   * Plan-d314ed3a, lots 8 et 10 (14/11/2026) : la demande du lot dit « note-la avec plan_de_lots
   * (action « noter ») », mais l'étape du build n'avait pas l'outil ; la décision passait par un
   * message au chef, qui devait la noter à sa place. Seuls les gestes d'un lot passent.
   */
  it('plan_de_lots : « noter » et « etat » passent, signés du lot ; un geste de chef est refusé', async () => {
    appels.length = 0
    const lanceur = lanceurDuLot('conv-lot', {
      ...deps,
      catalogue: () => [...specs, { name: 'plan_de_lots', description: 'plan', args: {} }]
    })!
    expect((await lanceur.exec('plan_de_lots', { action: 'noter', decision: 'd' })).ok).toBe(true)
    expect((await lanceur.exec('plan_de_lots', {})).ok).toBe(true)
    const valider = await lanceur.exec('plan_de_lots', { action: 'valider', lot: 1 })
    const deposer = await lanceur.exec('plan_de_lots', { plan: { lots: [] } })
    expect(appels).toEqual([
      { name: 'plan_de_lots', fil: 'conv-lot' },
      { name: 'plan_de_lots', fil: 'conv-lot' }
    ])
    expect(valider).toMatchObject({ ok: false, error: expect.stringMatching(/« noter »/) })
    expect(deposer.ok).toBe(false)
    expect(lanceur.catalogue!().map((s) => s.name)).toContain('plan_de_lots')
  })

  it('proprietaire_fichier répond depuis la copie de l’étape, qui ne se dénonce pas elle-même', async () => {
    // Par le bus, la commande lirait le dossier du FIL du lot : la copie du run y serait une copie
    // parmi d'autres, et l'agent lirait son propre travail comme celui d'un autre run.
    appels.length = 0
    const ws = mkdtempSync(join(tmpdir(), 'autowin-lot-proprio-'))
    const git = (cwd: string, ...args: string[]): void => {
      execFileSync('git', args, { cwd })
    }
    git(ws, 'init', '-q', '-b', 'main')
    git(ws, 'config', 'user.email', 't@t')
    git(ws, 'config', 'user.name', 't')
    mkdirSync(join(ws, 'src'))
    writeFileSync(join(ws, 'src/a.ts'), 'export const a = 1\n')
    git(ws, 'add', '.')
    git(ws, 'commit', '-q', '-m', 'init')
    const copies = mkdtempSync(join(tmpdir(), 'autowin-lot-copies-'))
    const copieDeLEtape = join(copies, 'agent__run-etape-1')
    const autreRun = join(copies, 'agent__run-voisin-1')
    git(ws, 'worktree', 'add', '-q', '--detach', copieDeLEtape)
    git(ws, 'worktree', 'add', '-q', '--detach', autreRun)
    writeFileSync(join(copieDeLEtape, 'src/a.ts'), 'export const a = 2 // étape\n')
    writeFileSync(join(autreRun, 'src/a.ts'), 'export const a = 3 // voisin\n')

    const lanceur = lanceurDuLot('conv-lot', deps, copieDeLEtape)!
    const r = await lanceur.exec('proprietaire_fichier', { chemins: ['src/a.ts'] })

    expect(r.ok).toBe(true)
    const [fichier] = (r.data as { fichiers: Array<Record<string, unknown>> }).fichiers
    expect(fichier?.copiesDeRun).toEqual([{ run: 'run-voisin-1', etat: 'non commité' }])
    expect(String(fichier?.resume)).toContain('cette copie (run-etape-1)')
    // Lu sur place, jamais renvoyé au bus du fil.
    expect(appels).toEqual([])
  })
})

describe('etapeQuiRecoitLesOutilsDuLot — quels envois portent l’outil', () => {
  const envoi = (phaseAppelante: string, extra: Partial<SendOptions> = {}): SendOptions =>
    ({
      execution: { cwd: 'C:\\ws', sandbox: 'full-access', phaseAppelante },
      ...extra
    }) as SendOptions

  it('une étape build sur claude ou codex, oui', () => {
    expect(etapeQuiRecoitLesOutilsDuLot('claude', envoi('build'))).toBe(true)
    expect(etapeQuiRecoitLesOutilsDuLot('codex', envoi('frame'))).toBe(true)
  })

  it('le juge, un nœud skill, un envoi hors étape ou un fournisseur sans outils natifs, non', () => {
    expect(etapeQuiRecoitLesOutilsDuLot('claude', envoi('judge'))).toBe(false)
    expect(etapeQuiRecoitLesOutilsDuLot('claude', envoi('think'))).toBe(false)
    expect(
      etapeQuiRecoitLesOutilsDuLot(
        'claude',
        envoi('build', { skillNodeTools: { mcpConfig: '{}', allowedTools: [] } })
      )
    ).toBe(false)
    expect(etapeQuiRecoitLesOutilsDuLot('claude', {})).toBe(false)
    expect(etapeQuiRecoitLesOutilsDuLot('gemini', envoi('build'))).toBe(false)
  })
})

describe('registreAvecOutilsDuLot — le registre du run', () => {
  const resultat: SendResult = { text: 'ok', provider: 'claude', systemInjected: false }

  it('laisse passer tel quel l’envoi du juge, et le serveur est fermé après une étape', async () => {
    const vus: SendOptions[] = []
    const registre = {
      send: async (_id: string, _m: unknown[], opts: SendOptions = {}) => {
        vus.push(opts)
        return resultat
      },
      ids: () => ['claude']
    }
    const lanceur = { exec: async () => ({ ok: true }), catalogue: () => specs }
    const details: string[] = []
    const dossiers: Array<string | undefined> = []
    const enveloppe = registreAvecOutilsDuLot(
      registre,
      (dossier) => {
        dossiers.push(dossier)
        return lanceur
      },
      (s) => {
        if (s.detail) details.push(s.detail)
      }
    )
    const judge = { execution: { cwd: 'C:\\ws', sandbox: 'read-only', phaseAppelante: 'judge' } }
    const build = { execution: { cwd: 'C:\\ws', sandbox: 'full-access', phaseAppelante: 'build' } }
    await enveloppe.send('claude', [], judge as SendOptions)
    await enveloppe.send('claude', [], build as SendOptions)
    expect(vus[0]?.skillNodeTools).toBeUndefined()
    expect(vus[1]?.skillNodeTools?.allowedTools).toEqual([
      'mcp__autowin__ecrire_a_un_fil',
      'mcp__autowin__proprietaire_fichier'
    ])
    // Le lanceur reçoit le dossier de l'étape : proprietaire_fichier y répond.
    expect(dossiers).toEqual(['C:\\ws'])
    // Les autres méthodes du registre restent celles du registre.
    expect(enveloppe.ids()).toEqual(['claude'])
    const serveur = JSON.parse(vus[1]!.skillNodeTools!.mcpConfig).mcpServers.autowin
    await expect(
      fetch(serveur.url, { method: 'POST', headers: serveur.headers, body: '{}' })
    ).rejects.toThrow()
    expect(details.some((d) => d.includes('outils du lot servis à build'))).toBe(true)
  })
})

describe('argumentsMcpNoeudSkill — une étape de lot ne reçoit pas les serveurs de l’utilisateur', () => {
  const serveurUtilisateur = {
    id: 'perso',
    nom: 'perso',
    commande: 'node',
    args: [],
    env: {},
    actif: true
  }
  const config = JSON.stringify({
    mcpServers: { autowin: { type: 'http', url: 'http://127.0.0.1:1' } }
  })

  it('sansServeursUtilisateur : seul le serveur d’Autowin, et --strict-mcp-config', () => {
    const args = argumentsMcpNoeudSkill(
      {
        skillNodeTools: {
          mcpConfig: config,
          allowedTools: ['mcp__autowin__ecrire_a_un_fil'],
          sansServeursUtilisateur: true
        }
      },
      [serveurUtilisateur] as never
    )
    expect(args.strict).toEqual(['--strict-mcp-config'])
    expect(args.autorises).toEqual(['mcp__autowin__ecrire_a_un_fil'])
    expect(JSON.parse(args.mcp[1]!).mcpServers).not.toHaveProperty('perso')
  })

  it('sans le drapeau, la fusion des serveurs de l’utilisateur reste celle d’avant', () => {
    const args = argumentsMcpNoeudSkill(
      { skillNodeTools: { mcpConfig: config, allowedTools: ['mcp__autowin__x'] } },
      [serveurUtilisateur] as never
    )
    expect(JSON.parse(args.mcp[1]!).mcpServers).toHaveProperty('perso')
  })
})
