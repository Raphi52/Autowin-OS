import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
// fix-ok: adaptation à la nouvelle direction de l'utilisateur (l'autorité du périmètre devient
// COMMUN_RIG.dbo.GREFFE, GRF_IS_EXPLOIT = 1) — refactor demandé, pas un correctif à l'aveugle.
// L'exécution de sqlcmd vit désormais dans `sqlcmd-runner`, d'où provient `OutputFileAccess`.
import { buildReadOnlyBatch, runSqlRead, type SqlReadCommandDeps } from './sql-read-command'
import { buildSqlTargetCatalog } from './sql-read-catalog'
import type { OutputFileAccess } from './sqlcmd-runner'

/** Catalogue de test : la cible est autorisée, pour que ces tests portent sur l'EXÉCUTION. */
const CATALOGUE = buildSqlTargetCatalog([{ server: 'SQL-PROD\\PROD', database: 'RIG_AMIENS' }])

/**
 * L'enveloppe d'exécution est la COUCHE 2 de la défense : même si une écriture franchissait la garde,
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

  /**
   * La garde traite `"…"` comme un identifiant délimité. Sans ce `SET`, QUOTED_IDENTIFIER est OFF sous
   * `sqlcmd -Q` (mesuré : `SESSIONPROPERTY` = 0) et `"…"` serait une CHAÎNE : la garde raisonnerait sur
   * une prémisse fausse (4ᵉ audit).
   */
  it('aligne QUOTED_IDENTIFIER sur le modèle de la garde', () => {
    expect(batch).toContain('SET QUOTED_IDENTIFIER ON')
  })

  it('l’annulation vient APRÈS la requête (sinon elle ne protégerait rien)', () => {
    expect(batch.indexOf('BEGIN TRANSACTION')).toBeLessThan(batch.indexOf('SELECT 1'))
    expect(batch.indexOf('SELECT 1')).toBeLessThan(batch.indexOf('ROLLBACK TRANSACTION'))
  })
})

function fakeChild(): EventEmitter & {
  stdout: PassThrough
  stderr: PassThrough
  kill: () => void
} {
  const c = new EventEmitter() as EventEmitter & {
    stdout: PassThrough
    stderr: PassThrough
    kill: () => void
  }
  c.stdout = new PassThrough()
  c.stderr = new PassThrough()
  c.kill = vi.fn()
  return c
}

/**
 * Le résultat de sqlcmd arrive par un FICHIER, pas par le pipe — c'est le seul chemin qui produise de
 * l'UTF-8 (`-o` + `-f 65001`), mesuré le 2026-08-07. Ce double simule donc le fichier, et permet en
 * plus de vérifier qu'il est bien SUPPRIMÉ : il contient des données de greffe.
 */
function fakeFile(contenu: string | Buffer): OutputFileAccess & { removed: () => boolean } {
  const octets = Buffer.isBuffer(contenu) ? contenu : Buffer.from(contenu, 'utf8')
  let supprime = false
  return {
    size: () => octets.length,
    read: () => octets.toString('utf8'),
    remove: () => {
      supprime = true
    },
    removed: () => supprime
  }
}

const cible = { server: 'SQL-PROD\\PROD', database: 'RIG_AMIENS', query: 'SELECT 1 AS x' }

/** Monte le décor complet : un fils simulé, un fichier de sortie simulé, un chemin déterministe. */
function lancer(
  contenuFichier: string | Buffer,
  code = 0,
  extra: Partial<SqlReadCommandDeps> = {}
): {
  resultat: ReturnType<typeof runSqlRead>
  fichier: ReturnType<typeof fakeFile>
  args: string[]
} {
  const child = fakeChild()
  const spawnFn = vi.fn(() => child)
  const fichier = fakeFile(contenuFichier)
  const resultat = runSqlRead(cible, {
    spawnFn: spawnFn as never,
    // Variante de sqlcmd INJECTÉE : sans cela, les drapeaux dépendraient du binaire réellement
    // installé sur la machine de test. Par défaut on simule le sqlcmd HISTORIQUE (celui dont
    // l'aide annonce `-f <codepage>`), qui est le contrat historique de ces tests.
    spawnSyncFn: (() => ({ stdout: '  -f <codepage>\n  -o <fichier>\n', stderr: '' })) as never,
    sqlcmdPath: 'sqlcmd.exe',
    catalog: CATALOGUE,
    outputFile: fichier,
    outputPath: 'T:\\sortie.json',
    ...extra
  })
  child.emit('close', code)
  const [, args] = spawnFn.mock.calls[0] as unknown as [string, string[]]
  return { resultat, fichier, args }
}

describe('runSqlRead — invocation de sqlcmd', () => {
  it('n’exécute RIEN si la garde refuse', async () => {
    const spawnFn = vi.fn()
    const out = await runSqlRead(
      { ...cible, query: 'DELETE FROM T' },
      { spawnFn: spawnFn as never, sqlcmdPath: 'sqlcmd.exe', catalog: CATALOGUE }
    )
    expect(out.ok).toBe(false)
    expect(spawnFn).not.toHaveBeenCalled()
  })

  it('appelle sqlcmd SANS shell, arguments en tableau', async () => {
    const child = fakeChild()
    const spawnFn = vi.fn(() => child)
    const p = runSqlRead(cible, {
      spawnFn: spawnFn as never,
      sqlcmdPath: 'C:\\bin\\sqlcmd.exe',
      catalog: CATALOGUE,
      outputFile: fakeFile('[{"x":1}]'),
      outputPath: 'T:\\sortie.json'
    })
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

  /**
   * Ces quatre drapeaux sont chacun la conclusion d'un audit. Les tester nommément, c'est empêcher
   * qu'une simplification future les retire sans que rien ne le signale.
   */
  it('passe les drapeaux issus des audits', async () => {
    const { resultat, args } = lancer('[{"x":1}]')
    await resultat
    expect(args).toContain('-X') // désactive les commandes sqlcmd `:!!` (2ᵉ audit)
    expect(args).toContain('-x') // désactive la substitution $(…) (2ᵉ audit)
    expect(args).toContain('-b') // code de sortie ≠ 0 sur erreur SQL (3ᵉ audit)
    expect(args[args.indexOf('-f') + 1]).toBe('65001') // UTF-8 dans le fichier (4ᵉ audit)
    expect(args[args.indexOf('-o') + 1]).toBe('T:\\sortie.json')
  })

  it('demande une ligne de plus que le plafond au serveur', async () => {
    const { resultat, args } = lancer('', 0, { maxRows: 200 })
    await resultat
    expect(args[args.indexOf('-Q') + 1]).toContain('SET ROWCOUNT 201')
  })

  it('capacité non câblée → refus explicite, sans exception', async () => {
    const out = await runSqlRead(cible, { catalog: CATALOGUE })
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.reason).toMatch(/indisponible|sqlcmd/i)
  })

  it('un spawn qui jette devient un refus lisible', async () => {
    const out = await runSqlRead(cible, {
      spawnFn: (() => {
        throw new Error('EPERM')
      }) as never,
      sqlcmdPath: 'sqlcmd.exe',
      catalog: CATALOGUE
    })
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.reason).toContain('EPERM')
  })
})

describe('runSqlRead — lecture du résultat', () => {
  it('rend les lignes parsées', async () => {
    const out = await lancer('[{"valeur":"MORCA","synonyme":"MOSCE"}]').resultat
    expect(out.ok).toBe(true)
    if (out.ok) {
      expect(out.rows).toEqual([{ valeur: 'MORCA', synonyme: 'MOSCE' }])
      expect(out.rowCount).toBe(1)
      expect(out.truncated).toBe(false)
    }
  })

  it('recolle un JSON replié sur plusieurs lignes par sqlcmd', async () => {
    const out = await lancer('[{"a":1},\n{"a":2}]').resultat
    expect(out.ok).toBe(true)
    if (out.ok) expect(out.rowCount).toBe(2)
  })

  it('AUCUNE ligne est un succès, pas une erreur', async () => {
    const out = await lancer('').resultat
    expect(out.ok).toBe(true)
    if (out.ok) {
      expect(out.rows).toEqual([])
      expect(out.summary).toMatch(/aucune ligne/i)
    }
  })

  it('ignore un crochet présent dans un message sqlcmd avant le JSON', async () => {
    // Régression (3ᵉ audit) : on repartait du PREMIER crochet, donc un message d'information
    // contenant « [ » rendait la réponse illisible.
    const out = await lancer('Changed database context to [RIG_AMIENS].\n[{"a":1}]').resultat
    expect(out.ok).toBe(true)
    if (out.ok) expect(out.rows).toEqual([{ a: 1 }])
  })

  /**
   * `-f 65001` fait précéder le contenu d'un BOM UTF-8. Il n'appartient pas au résultat, et un JSON
   * qui commence par un BOM ne parse pas.
   */
  it('retire le BOM que produit -f 65001', async () => {
    const out = await lancer(Buffer.from('\uFEFF[{"a":1}]', 'utf8')).resultat
    expect(out.ok).toBe(true)
    if (out.ok) expect(out.rows).toEqual([{ a: 1 }])
  })

  /**
   * LE défaut le plus grave du 4ᵉ audit, et le seul que la preuve réelle ait tranché contre le
   * raisonnement : sqlcmd écrit la codepage OEM (CP850) sur le pipe, `é` = 0x82. Lu en UTF-8, cela
   * rendait un U+FFFD par accent — dans un JSON PARFAITEMENT VALIDE. Les libellés de greffe
   * arrivaient corrompus à l'agent, sans aucune trace. Seul `-o` + `-f 65001` produit de l'UTF-8.
   */
  it('rend les accents intacts, sans caractère de remplacement', async () => {
    const reel = '[{"v":"Adjonction d\'activité de l\'établissement principal"}]'
    const out = await lancer(Buffer.from(reel, 'utf8')).resultat
    expect(out.ok).toBe(true)
    if (out.ok) {
      expect(out.rows).toEqual([{ v: "Adjonction d'activité de l'établissement principal" }])
      expect(JSON.stringify(out.rows)).not.toContain('\uFFFD')
    }
  })

  /**
   * Le fichier contient des données de greffe : il ne doit jamais rester sur le disque, quel que soit
   * le chemin de sortie.
   */
  it('supprime le fichier de sortie, en succès comme en échec', async () => {
    const succes = lancer('[{"a":1}]')
    await succes.resultat
    expect(succes.fichier.removed()).toBe(true)

    const echec = lancer('Msg 208, Level 16, State 1\nInvalid object name.', 1)
    await echec.resultat
    expect(echec.fichier.removed()).toBe(true)
  })
})

describe('runSqlRead — erreurs et plafonds', () => {
  it('remonte l’erreur SQL Server TELLE QUELLE', async () => {
    const out = await lancer(
      "Msg 208, Level 16, State 1, Server X, Line 7\nInvalid object name 'TABLE_ABSENTE'.",
      1
    ).resultat
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.reason).toContain('TABLE_ABSENTE')
  })

  /**
   * Régression (3ᵉ audit) : sans `-b`, sqlcmd sort en code 0 même sur « Invalid object name ». Le
   * message n'ayant ni `[` ni `{`, la commande rendait « la requête est valide et ne ramène rien ».
   * Un agent qui vérifie un état en base concluait « rien » sur une requête cassée. `-b` est passé,
   * mais on détecte AUSSI le message : on ne dépend pas d'un seul signal.
   */
  it('une erreur SQL en code 0 n’est PAS « aucune ligne »', async () => {
    const out = await lancer(
      "Msg 208, Level 16, State 1, Server X, Line 7\nInvalid object name 'T'.",
      0
    ).resultat
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.reason).toContain('Invalid object name')
  })

  /**
   * Régression (4ᵉ audit) : une erreur d'EXÉCUTION survient après que SQL Server a déjà écrit une
   * partie du JSON, donc le message est à la FIN. `slice(0, 6)` ne regardait que le DÉBUT : l'agent
   * recevait « Requête refusée par SQL Server : [{"v":"AAAA… » — un refus sans motif, plus 12 ko de
   * JSON brut qui polluaient son contexte.
   */
  it('extrait le message SQL même quand il arrive APRÈS du JSON partiel', async () => {
    const jsonPartiel = Array.from({ length: 8 }, () => '{"v":"' + 'A'.repeat(2000) + '"},').join(
      '\n'
    )
    const out = await lancer(
      '[' +
        jsonPartiel +
        '\nMsg 8134, Level 16, State 1, Server X, Line 7\nDivide by zero error encountered.',
      1
    ).resultat
    expect(out.ok).toBe(false)
    if (!out.ok) {
      expect(out.reason).toContain('Msg 8134')
      expect(out.reason).toContain('Divide by zero')
      expect(out.reason).not.toContain('AAAA') // le JSON brut ne pollue pas le contexte
      expect(out.reason.length).toBeLessThan(600)
    }
  })

  /**
   * `FOR JSON PATH` est ajouté inconditionnellement, donc `SELECT COUNT(*)` — la requête la plus
   * naturelle qu'un agent écrive — échoue avec `Msg 13605`. L'erreur est exacte mais opaque : on y
   * ajoute la marche à suivre, pour que l'agent se corrige du premier coup.
   */
  it('explique quoi faire quand FOR JSON exige des alias', async () => {
    for (const msg of [
      'Msg 13605, Level 16, State 1, Server X, Line 7\nColumn expressions must be named.',
      'Msg 13601, Level 16, State 1, Server X, Line 7\nProperty name conflict.'
    ]) {
      const out = await lancer(msg, 1).resultat
      expect(out.ok).toBe(false)
      if (!out.ok) expect(out.reason).toMatch(/alias/i)
    }
  })

  /**
   * Symétrique du défaut précédent : sqlcmd replie le JSON tous les 2033 caractères, à une position
   * ARBITRAIRE dans la donnée. Une valeur contenant « Msg 208, Level 16 » juste après un pli
   * ressemblait à une erreur. Un résultat qui parse avec un code 0 n'est jamais un refus.
   */
  it('une donnée qui RESSEMBLE à un message SQL n’est pas une erreur', async () => {
    const out = await lancer('[{"libelle":"\nMsg 208, Level 16, State 1 dans un libelle"}]')
      .resultat
    expect(out.ok).toBe(true)
    if (out.ok) expect(out.rowCount).toBe(1)
  })

  /**
   * Régression (3ᵉ et 4ᵉ audits) : la sortie était coupée sans que personne le sache, et un JSON
   * coupé se reparsait partiellement en 1 ligne au lieu de N, avec `truncated: false`. Un résultat
   * FAUX présenté comme complet est pire qu'une erreur. Le plafond porte désormais sur la TAILLE du
   * fichier, contrôlée AVANT lecture — donc le résultat démesuré n'entre jamais en mémoire.
   */
  it('un résultat au-delà du plafond d’octets est un REFUS, pas un résultat', async () => {
    const enorme = '[' + '{"v":"' + 'x'.repeat(500_000) + '"}' + ']'
    const { resultat, fichier } = lancer(enorme)
    const out = await resultat
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.reason).toMatch(/volumineu/i)
    expect(fichier.removed()).toBe(true)
  })

  /**
   * On demande UNE ligne de plus que le plafond, uniquement pour savoir s'il y avait une suite. Cette
   * ligne de sonde ne doit jamais être rendue à l'agent.
   */
  it('signale la troncature quand il y a une ligne de PLUS que le plafond', async () => {
    const out = await lancer('[{"a":1},{"a":2},{"a":3}]', 0, { maxRows: 2 }).resultat
    expect(out.ok).toBe(true)
    if (out.ok) {
      expect(out.truncated).toBe(true)
      expect(out.summary).toMatch(/plafond/i)
      expect(out.rowCount).toBe(2) // la ligne de sonde n'est pas rendue
      expect(out.rows).toEqual([{ a: 1 }, { a: 2 }])
    }
  })

  it('un résultat COMPLET de exactement `maxRows` lignes n’est PAS tronqué', async () => {
    // Régression (3ᵉ audit) : `rows.length >= maxRows` annonçait tronqué un résultat exhaustif, et
    // l'agent affinait une requête déjà complète.
    const out = await lancer('[{"a":1},{"a":2}]', 0, { maxRows: 2 }).resultat
    expect(out.ok).toBe(true)
    if (out.ok) {
      expect(out.truncated).toBe(false)
      expect(out.rowCount).toBe(2)
    }
  })

  it('un fichier de sortie illisible devient un refus, pas une exception', async () => {
    const child = fakeChild()
    const p = runSqlRead(cible, {
      spawnFn: (() => child) as never,
      sqlcmdPath: 'sqlcmd.exe',
      catalog: CATALOGUE,
      outputPath: 'T:\\sortie.json',
      outputFile: {
        size: () => 10,
        read: () => {
          throw new Error('ENOENT')
        },
        remove: () => {}
      }
    })
    child.emit('close', 0)
    const out = await p
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.reason).toContain('ENOENT')
  })
})
