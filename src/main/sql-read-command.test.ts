import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { buildReadOnlyBatch, runSqlRead } from './sql-read-command'

/**
 * L'enveloppe d'exécution est la COUCHE 2 de la défense : même si une écriture franchissait le garde,
 * elle ne serait jamais validée. Une régression silencieuse ici annulerait cette protection sans que
 * rien ne le signale — d'où des tests sur le TEXTE de l'enveloppe, pas seulement sur le résultat.
 */
describe('buildReadOnlyBatch — l’enveloppe ne peut RIEN valider', () => {
  const batch = buildReadOnlyBatch('SELECT 1', 200)

  it('ouvre une transaction et l’ANNULE toujours', () => {
    expect(batch).toContain('BEGIN TRANSACTION')
    expect(batch).toContain('ROLLBACK TRANSACTION')
    expect(batch).not.toMatch(/\bCOMMIT\b/i)
  })

  it('borne les lignes, les verrous et l’isolation', () => {
    expect(batch).toContain('SET ROWCOUNT 200')
    expect(batch).toContain('SET LOCK_TIMEOUT')
    expect(batch).toContain('READ UNCOMMITTED')
  })

  it('demande du JSON, pour une sortie parsable sans ambiguïté', () => {
    expect(batch).toContain('FOR JSON PATH')
  })

  it('l’annulation vient APRÈS la requête (sinon elle ne protégerait rien)', () => {
    expect(batch.indexOf('BEGIN TRANSACTION')).toBeLessThan(batch.indexOf('SELECT 1'))
    expect(batch.indexOf('SELECT 1')).toBeLessThan(batch.indexOf('ROLLBACK TRANSACTION'))
  })
})

function fakeChild(): EventEmitter & {
  stdout: EventEmitter
  stderr: EventEmitter
  kill: () => void
} {
  const c = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter
    stderr: EventEmitter
    kill: () => void
  }
  c.stdout = new EventEmitter()
  c.stderr = new EventEmitter()
  c.kill = vi.fn()
  return c
}

const cible = { server: 'SQL-PROD\\PROD', database: 'RIG_AMIENS', query: 'SELECT 1 AS x' }

describe('runSqlRead — exécution', () => {
  it('n’exécute RIEN si le garde refuse', async () => {
    const spawnFn = vi.fn()
    const out = await runSqlRead(
      { ...cible, query: 'DELETE FROM T' },
      { spawnFn: spawnFn as never, sqlcmdPath: 'sqlcmd.exe' }
    )
    expect(out.ok).toBe(false)
    expect(spawnFn).not.toHaveBeenCalled()
  })

  it('appelle sqlcmd SANS shell, arguments en tableau', async () => {
    const child = fakeChild()
    const spawnFn = vi.fn(() => child)
    const p = runSqlRead(cible, { spawnFn: spawnFn as never, sqlcmdPath: 'C:\\bin\\sqlcmd.exe' })
    child.stdout.emit('data', '[{"x":1}]')
    child.emit('close', 0)
    await p

    const [bin, args, opts] = spawnFn.mock.calls[0] as unknown as [
      string,
      string[],
      { shell?: boolean }
    ]
    expect(bin).toBe('C:\\bin\\sqlcmd.exe')
    expect(opts.shell).toBe(false)
    expect(args).toContain('-E')
    expect(args[args.indexOf('-S') + 1]).toBe('SQL-PROD\\PROD')
    expect(args[args.indexOf('-d') + 1]).toBe('RIG_AMIENS')
  })

  it('rend les lignes parsées', async () => {
    const child = fakeChild()
    const p = runSqlRead(cible, { spawnFn: (() => child) as never, sqlcmdPath: 'sqlcmd.exe' })
    child.stdout.emit('data', '[{"valeur":"MORCA","synonyme":"MOSCE"}]')
    child.emit('close', 0)
    const out = await p

    expect(out.ok).toBe(true)
    if (out.ok) {
      expect(out.rows).toEqual([{ valeur: 'MORCA', synonyme: 'MOSCE' }])
      expect(out.rowCount).toBe(1)
      expect(out.truncated).toBe(false)
    }
  })

  it('recolle un JSON replié sur plusieurs lignes par sqlcmd', async () => {
    const child = fakeChild()
    const p = runSqlRead(cible, { spawnFn: (() => child) as never, sqlcmdPath: 'sqlcmd.exe' })
    child.stdout.emit('data', '[{"a":1},\n')
    child.stdout.emit('data', '{"a":2}]')
    child.emit('close', 0)
    const out = await p
    expect(out.ok).toBe(true)
    if (out.ok) expect(out.rowCount).toBe(2)
  })

  it('AUCUNE ligne est un succès, pas une erreur', async () => {
    const child = fakeChild()
    const p = runSqlRead(cible, { spawnFn: (() => child) as never, sqlcmdPath: 'sqlcmd.exe' })
    child.emit('close', 0)
    const out = await p

    expect(out.ok).toBe(true)
    if (out.ok) {
      expect(out.rows).toEqual([])
      expect(out.summary).toMatch(/aucune ligne/i)
    }
  })

  /**
   * On demande UNE ligne de plus que le plafond, uniquement pour savoir s'il y avait une suite. Cette
   * ligne de sonde ne doit jamais être rendue à l'agent.
   */
  it('signale la troncature quand il y a une ligne de PLUS que le plafond', async () => {
    const child = fakeChild()
    const p = runSqlRead(cible, {
      spawnFn: (() => child) as never,
      sqlcmdPath: 'sqlcmd.exe',
      maxRows: 2
    })
    child.stdout.emit('data', '[{"a":1},{"a":2},{"a":3}]')
    child.emit('close', 0)
    const out = await p
    expect(out.ok).toBe(true)
    if (out.ok) {
      expect(out.truncated).toBe(true)
      expect(out.summary).toMatch(/plafond/i)
      expect(out.rowCount).toBe(2) // la ligne de sonde n'est pas rendue
      expect(out.rows).toEqual([{ a: 1 }, { a: 2 }])
    }
  })

  it('un résultat COMPLET de exactement `maxRows` lignes n’est PAS tronqué', () => {
    // Régression (audit 2026-08-07) : `rows.length >= maxRows` annonçait tronqué un résultat
    // exhaustif, et l'agent affinait une requête déjà complète.
    const child = fakeChild()
    const p = runSqlRead(cible, {
      spawnFn: (() => child) as never,
      sqlcmdPath: 'sqlcmd.exe',
      maxRows: 2
    })
    child.stdout.emit('data', '[{"a":1},{"a":2}]')
    child.emit('close', 0)
    return p.then((out) => {
      expect(out.ok).toBe(true)
      if (out.ok) {
        expect(out.truncated).toBe(false)
        expect(out.rowCount).toBe(2)
      }
    })
  })

  it('demande une ligne de plus que le plafond au serveur', async () => {
    const child = fakeChild()
    const spawnFn = vi.fn(() => child)
    const p = runSqlRead(cible, {
      spawnFn: spawnFn as never,
      sqlcmdPath: 'sqlcmd.exe',
      maxRows: 200
    })
    child.emit('close', 0)
    await p
    const [, args] = spawnFn.mock.calls[0] as unknown as [string, string[]]
    expect(args[args.indexOf('-Q') + 1]).toContain('SET ROWCOUNT 201')
  })

  it('ignore un crochet présent dans un message sqlcmd avant le JSON', async () => {
    // Régression (audit 2026-08-07) : on repartait du PREMIER crochet, donc un message
    // d'information contenant « [ » rendait la réponse illisible.
    const child = fakeChild()
    const p = runSqlRead(cible, { spawnFn: (() => child) as never, sqlcmdPath: 'sqlcmd.exe' })
    child.stdout.emit('data', 'Changed database context to [RIG_AMIENS].\n[{"a":1}]')
    child.emit('close', 0)
    const out = await p
    expect(out.ok).toBe(true)
    if (out.ok) expect(out.rows).toEqual([{ a: 1 }])
  })

  /**
   * Régression (3ᵉ audit) : sans `-b`, sqlcmd sort en code 0 même sur « Invalid object name ». Le
   * message n'ayant ni `[` ni `{`, la commande rendait « la requête est valide et ne ramène rien ».
   * Un agent qui vérifie un état en base concluait « rien » sur une requête cassée — et pouvait agir
   * sur cette conclusion. Une erreur doit rester une erreur, quel que soit le code de sortie.
   */
  it('une erreur SQL en code 0 n’est PAS « aucune ligne »', async () => {
    const child = fakeChild()
    const p = runSqlRead(cible, { spawnFn: (() => child) as never, sqlcmdPath: 'sqlcmd.exe' })
    child.stdout.emit(
      'data',
      "Msg 208, Level 16, State 1, Server X, Line 6\nInvalid object name 'T'."
    )
    child.emit('close', 0)
    const out = await p
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.reason).toContain('Invalid object name')
  })

  it('demande à sqlcmd de sortir en erreur sur erreur SQL (-b)', async () => {
    const child = fakeChild()
    const spawnFn = vi.fn(() => child)
    const p = runSqlRead(cible, { spawnFn: spawnFn as never, sqlcmdPath: 'sqlcmd.exe' })
    child.emit('close', 0)
    await p
    const [, args] = spawnFn.mock.calls[0] as unknown as [string, string[]]
    expect(args).toContain('-b')
  })

  /**
   * Régression (3ᵉ audit) : la sortie était coupée à `MAX_OUTPUT_BYTES` sans que personne le sache.
   * Sur un JSON coupé, seul le DERNIER objet parsait, et l'agent recevait 1 ligne au lieu de N, avec
   * `truncated: false`. Un résultat FAUX présenté comme complet est pire qu'une erreur.
   */
  it('une sortie coupée au plafond d’octets est un REFUS, pas un résultat', async () => {
    const child = fakeChild()
    const p = runSqlRead(cible, { spawnFn: (() => child) as never, sqlcmdPath: 'sqlcmd.exe' })
    child.stdout.emit('data', '[' + '{"v":"' + 'x'.repeat(500_000) + '"},')
    child.stdout.emit('data', '{"v":1}]')
    child.emit('close', 0)
    const out = await p
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.reason).toMatch(/volumineu|plafond|coup/i)
  })

  it('remonte l’erreur SQL Server TELLE QUELLE', async () => {
    const child = fakeChild()
    const p = runSqlRead(cible, { spawnFn: (() => child) as never, sqlcmdPath: 'sqlcmd.exe' })
    child.stdout.emit('data', "Msg 208, Level 16 : Invalid object name 'TABLE_ABSENTE'.")
    child.emit('close', 1)
    const out = await p

    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.reason).toContain('TABLE_ABSENTE')
  })

  it('capacité non câblée → refus explicite, sans exception', async () => {
    const out = await runSqlRead(cible, {})
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.reason).toMatch(/indisponible|sqlcmd/i)
  })

  it('un spawn qui jette devient un refus lisible', async () => {
    const out = await runSqlRead(cible, {
      spawnFn: (() => {
        throw new Error('EPERM')
      }) as never,
      sqlcmdPath: 'sqlcmd.exe'
    })
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.reason).toContain('EPERM')
  })
})
