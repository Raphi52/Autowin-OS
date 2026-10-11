/**
 * LOT 1 du chantier « outils de l'agent » (RUN.md outils-agent-1-2-4-6-7, conv-222).
 *
 * Pourquoi : un agent ne pouvait pas fermer l'application qu'il avait lancee dans SON bureau cache.
 * `hdesk-lancer.ps1` refuse une relance sur le meme identifiant tant que l'app vit (exit 5) et aucun
 * outil ne la fermait : l'agent tuait un processus a la main, avec le risque de viser une app de
 * l'utilisateur. `scripts/hdesk-fermer.ps1` ferme PAR BUREAU, jamais par nom.
 *
 * La preuve « jamais ton app » se fait avec un SECOND bureau cache (meme executable, autre fil) :
 * ouvrir l'app sur l'ecran reel de l'utilisateur pour la prouver violerait la regle qu'on teste.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  argumentsFermer,
  fermerBureauCacheSiOuvert,
  fermerHdesk,
  resultatFermeture,
  type DemandeFermeture
} from './hdesk-tv'

describe('argumentsFermer / resultatFermeture : ce que l app envoie au script, et ce qu elle en lit', () => {
  it('passe l identifiant, le fil et le delai, sans rien interpoler', () => {
    const args = argumentsFermer('C:\\app', {
      id: 'chat-conv-222',
      conversationId: 'conv-222',
      delaiDouxSecondes: 3
    })
    expect(args).toContain(join('C:\\app', 'scripts', 'hdesk-fermer.ps1'))
    expect(args.slice(args.indexOf('-Id'), args.indexOf('-Id') + 2)).toEqual([
      '-Id',
      'chat-conv-222'
    ])
    expect(args.slice(args.indexOf('-Conversation'), args.indexOf('-Conversation') + 2)).toEqual([
      '-Conversation',
      'conv-222'
    ])
    expect(args.slice(-2)).toEqual(['-DelaiDouxSecondes', '3'])
    expect(argumentsFermer('C:\\app', { id: 'x', conversationId: 'conv-1' })).not.toContain(
      '-DelaiDouxSecondes'
    )
  })
  it.each([
    ['identifiant vide', { id: '', conversationId: 'conv-1' }],
    ['identifiant qui injecte', { id: 'a;Stop-Process -Name explorer', conversationId: 'conv-1' }],
    ['fil absent', { id: 'chat-conv-1', conversationId: '' }],
    ['delai nul', { id: 'x', conversationId: 'conv-1', delaiDouxSecondes: 0 }],
    ['delai enorme', { id: 'x', conversationId: 'conv-1', delaiDouxSecondes: 999 }],
    ['delai non entier', { id: 'x', conversationId: 'conv-1', delaiDouxSecondes: 2.5 }]
  ])('refuse avant de lancer quoi que ce soit : %s', (_cas, demande) => {
    expect(() => argumentsFermer('C:\\app', demande)).toThrow()
  })
  it('lit la derniere ligne JSON et fait foi du code de sortie', () => {
    const r = resultatFermeture(
      'bruit\r\n{"id":"x","ferme":true,"forces":[12],"survivants":[]}\r\n',
      0
    )
    expect(r).toMatchObject({ ok: true, code: 0, ferme: true, forces: [12], survivants: [] })
    expect(resultatFermeture('{"ferme":false,"erreur":"autre conversation"}', 5)).toMatchObject({
      ok: false,
      code: 5
    })
    expect(resultatFermeture('', null).ok).toBe(false)
    expect(resultatFermeture('', null).erreur).toMatch(/aucun resultat lisible/)
  })
  it('fin de run : ne lance PowerShell que si le bureau a une fiche au registre', async () => {
    const registre = mkdtempSync(join(tmpdir(), 'hdesk-fermer-fiche-'))
    try {
      const appels: DemandeFermeture[] = []
      const faux = async (_r: string, d: DemandeFermeture) => (
        appels.push(d),
        { ok: true, code: 0 }
      )
      const d = { id: 'run-abc', conversationId: 'conv-222' }
      expect(await fermerBureauCacheSiOuvert('C:\\app', d, registre, faux)).toBeUndefined()
      expect(
        await fermerBureauCacheSiOuvert(
          'C:\\app',
          { id: 'a;b', conversationId: 'conv-222' },
          registre,
          faux
        )
      ).toBeUndefined()
      expect(appels).toEqual([])
      writeFileSync(join(registre, 'run-abc.json'), '{}', 'utf8')
      expect(await fermerBureauCacheSiOuvert('C:\\app', d, registre, faux)).toMatchObject({
        ok: true
      })
      expect(appels).toEqual([d])
    } finally {
      rmSync(registre, { recursive: true, force: true })
    }
  })
})

const POWERSHELL = join(
  process.env.SystemRoot ?? 'C:\\Windows',
  'System32',
  'WindowsPowerShell',
  'v1.0',
  'powershell.exe'
)
const SCRIPTS = join(process.cwd(), 'scripts')

type Sortie = Record<string, unknown> & { code: number | null }

function lancerPs(script: string, args: string[]): Sortie {
  const r = spawnSync(
    'powershell',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(SCRIPTS, script), ...args],
    {
      encoding: 'utf8',
      timeout: 90_000
    }
  )
  const ligne = String(r.stdout ?? '')
    .trim()
    .split(/\r?\n/)
    .reverse()
    .find((l) => l.trim().startsWith('{'))
  let json: Record<string, unknown> = {}
  try {
    json = ligne ? (JSON.parse(ligne) as Record<string, unknown>) : {}
  } catch {
    json = { brut: r.stdout }
  }
  return { ...json, code: r.status, stderr: String(r.stderr ?? '') }
}

function vivant(pid: unknown): boolean {
  if (typeof pid !== 'number') return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

describe.skipIf(process.platform !== 'win32')(
  'hdesk-fermer : fermer SON bureau cache, jamais une autre app',
  () => {
    const registre = mkdtempSync(join(tmpdir(), 'hdesk-fermer-reg-'))
    const fixtures = mkdtempSync(join(tmpdir(), 'hdesk-fermer-app-'))
    const docile = join(fixtures, 'fenetre.ps1')
    const tetue = join(fixtures, 'fenetre-tetue.ps1')
    const base = `kzf${process.pid}`
    const X = `${base}x`
    const Y = `${base}y`
    const T = `${base}t`

    const lancer = (id: string, conversation: string, fixture: string): Sortie =>
      lancerPs('hdesk-lancer.ps1', [
        '-Id',
        id,
        '-Executable',
        POWERSHELL,
        '-Arguments',
        `-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "${fixture}"`,
        '-Travail',
        'test hdesk-fermer',
        '-Conversation',
        conversation,
        '-Registre',
        registre,
        '-SurvieSecondes',
        '1'
      ])
    const fermer = (id: string, conversation: string, ...extra: string[]): Sortie =>
      lancerPs('hdesk-fermer.ps1', [
        '-Id',
        id,
        '-Conversation',
        conversation,
        '-Registre',
        registre,
        ...extra
      ])

    beforeAll(() => {
      // Une vraie fenetre, multi-instance, qui accepte WM_CLOSE (docile) ou l'annule (tetue).
      const fenetre = (tetu: boolean): string =>
        [
          'Add-Type -AssemblyName System.Windows.Forms',
          "$f = New-Object System.Windows.Forms.Form; $f.Text = 'hdesk-fermer test'",
          tetu ? '$f.Add_FormClosing({ param($s, $e) $e.Cancel = $true })' : '',
          '[void]$f.ShowDialog()'
        ].join('\n')
      writeFileSync(docile, fenetre(false), 'utf8')
      writeFileSync(tetue, fenetre(true), 'utf8')
    })

    afterAll(() => {
      // Filet : rien ne doit survivre au test, meme en echec.
      for (const id of [X, Y, T])
        spawnSync(
          'powershell',
          [
            '-NoProfile',
            '-File',
            join(SCRIPTS, 'hdesk-fermer.ps1'),
            '-Id',
            id,
            '-Conversation',
            id === Y ? 'conv-b' : 'conv-a',
            '-Registre',
            registre,
            '-DelaiDouxSecondes',
            '1'
          ],
          { timeout: 60_000 }
        )
      rmSync(registre, { recursive: true, force: true })
      rmSync(fixtures, { recursive: true, force: true })
    })

    it('ferme l app du bureau X, epargne la MEME app du bureau Y, et libere X pour une relance', () => {
      const x = lancer(X, 'conv-a', docile)
      const y = lancer(Y, 'conv-b', docile)
      expect(x.code, String(x.stderr)).toBe(0)
      expect(y.code, String(y.stderr)).toBe(0)
      expect(vivant(x.pid)).toBe(true)

      const r = fermer(X, 'conv-a')
      expect(r.code, JSON.stringify(r)).toBe(0)
      expect(r.ferme).toBe(true)
      expect(r.survivants).toEqual([])
      expect(vivant(x.pid)).toBe(false)
      expect(existsSync(join(registre, `${X}.json`))).toBe(false)
      // La meme app, dans un autre bureau : intacte.
      expect(vivant(y.pid)).toBe(true)
      // L'identifiant est libre : la relance passe (elle rendait 5 tant que l'app vivait).
      const relance = lancer(X, 'conv-a', docile)
      expect(relance.code, String(relance.stderr)).toBe(0)
      expect(fermer(X, 'conv-a').code).toBe(0)
    }, 120_000)

    it('refuse (exit 5) le bureau d une AUTRE conversation et n y touche pas', () => {
      const y = lancer(Y, 'conv-b', docile)
      // Y peut deja tourner depuis le test precedent : la relance rend alors 5, et la fiche porte le pid.
      const pidY = y.code === 0 ? y.pid : y.pidOccupant
      const r = fermer(Y, 'conv-a')
      expect(r.code, JSON.stringify(r)).toBe(5)
      expect(r.ferme).toBe(false)
      expect(String(r.erreur)).toMatch(/autre conversation/i)
      expect(vivant(pidY)).toBe(true)
      expect(fermer(Y, 'conv-b').code).toBe(0)
      expect(vivant(pidY)).toBe(false)
    }, 120_000)

    it('force apres le delai une app qui refuse de se fermer, et le dit', () => {
      const t = lancer(T, 'conv-a', tetue)
      expect(t.code, String(t.stderr)).toBe(0)
      const r = fermer(T, 'conv-a', '-DelaiDouxSecondes', '2')
      expect(r.code, JSON.stringify(r)).toBe(0)
      expect(r.forces as number[]).toContain(t.pid)
      expect(vivant(t.pid)).toBe(false)
    }, 120_000)

    it('rend « deja ferme » (exit 0) quand l app est morte, et retire la fiche', () => {
      const mort = spawnSync(POWERSHELL, ['-NoProfile', '-Command', 'exit 0'])
      const id = `${base}m`
      writeFileSync(
        join(registre, `${id}.json`),
        JSON.stringify({
          id,
          pid: mort.pid,
          executable: POWERSHELL,
          conversationId: 'conv-a',
          lanceLe: new Date().toISOString()
        }),
        'utf8'
      )
      const r = fermer(id, 'conv-a')
      expect(r.code, JSON.stringify(r)).toBe(0)
      expect(r.dejaFerme).toBe(true)
      expect(existsSync(join(registre, `${id}.json`))).toBe(false)
    }, 60_000)

    it('refuse un identifiant inconnu (exit 2) sans rien fermer', () => {
      const r = fermer(`${base}inconnu`, 'conv-a')
      expect(r.code).toBe(2)
      expect(r.ferme).toBe(false)
      expect(String(r.erreur)).toMatch(/aucun bureau/i)
    }, 60_000)

    it('la chaine de l outil (fermerHdesk) lance le vrai script et lit son refus', async () => {
      const r = await fermerHdesk(process.cwd(), { id: `${base}chaine`, conversationId: 'conv-a' })
      expect(r).toMatchObject({ ok: false, code: 2, ferme: false })
      expect(String(r.erreur)).toMatch(/aucun bureau/i)
    }, 60_000)

    it('refuse un identifiant absent ou invalide (exit non nul)', () => {
      const absent = lancerPs('hdesk-fermer.ps1', [
        '-Conversation',
        'conv-a',
        '-Registre',
        registre
      ])
      expect(absent.code).not.toBe(0)
      const invalide = lancerPs('hdesk-fermer.ps1', [
        '-Id',
        'a b;c',
        '-Conversation',
        'conv-a',
        '-Registre',
        registre
      ])
      expect(invalide.code).not.toBe(0)
    }, 60_000)
  }
)
