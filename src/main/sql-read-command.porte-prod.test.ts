import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { chargerAutoriteProd, cheminAutoriteProd } from './store/prod-autorite-store'
import { buildSqlTargetCatalog } from './sql-read-catalog'
import { runSqlRead } from './sql-read-command'
import { PorteProd } from './prod-gate'
import { construireAutoriteProd } from './prod-guard'
import { CoffreAutorisationProd, definirPhrase } from './prod-passphrase'

/**
 * LE POINT DE PASSAGE, VU DEPUIS `sql_query`.
 *
 * Ce que ces tests prouvent, et qui n'était prouvé nulle part avant : un geste sur une base de
 * PRODUCTION sans jeton valide n'atteint JAMAIS le serveur. On ne vérifie donc pas seulement le
 * refus, mais le fait qu'aucun processus `sqlcmd` n'a été lancé — un refus qui se contenterait de
 * jeter le résultat après coup ne protégerait rien.
 *
 * Le garde est posé DANS `runSqlRead`, pas chez son appelant : c'est ce que ces tests fixent, puisque
 * l'appel se fait ici directement, sans passer par `commands.ts`.
 */
const CATALOGUE = buildSqlTargetCatalog([
  { server: 'SQL-PROD\\PROD', database: 'RIG_AMIENS' },
  { server: 'SQL-PROD\\PROD', database: 'RIG_MAQUETTE' }
])

const PHRASE = 'phrase-de-passe-de-reference'
const EMPREINTE = definirPhrase(PHRASE, 1_000)

const AUTORITE = construireAutoriteProd([
  { nature: 'base', nom: 'RIG_AMIENS', classe: 'prod', motif: 'greffe exploité' },
  { nature: 'base', nom: 'RIG_MAQUETTE', classe: 'non-prod' }
])

function montage(options: { phraseDefinie?: boolean } = {}) {
  const coffre = new CoffreAutorisationProd(EMPREINTE)
  const porteProd = new PorteProd({
    autorite: () => AUTORITE,
    coffre: () => coffre,
    phraseDefinie: () => true,
    niveau: () => (options.phraseDefinie === false ? 'aucun' : 'phrase')
  })
  /** Témoin d'exécution : s'il est appelé, c'est qu'une connexion a été tentée. */
  const lancer = vi.fn(() => {
    throw new Error('AUCUN processus sqlcmd ne devait être lancé')
  })
  return { coffre, porteProd, lancer }
}

function jetonPour(coffre: CoffreAutorisationProd, cible: string, operation: string): string {
  const ouverture = coffre.ouvrir(PHRASE, { cible, operation })
  if (!ouverture.accorde) throw new Error('ouverture attendue')
  return ouverture.jeton.valeur
}

describe('sql_query sur une base de PRODUCTION', () => {
  /** LE test demandé : production, pas de jeton, refus — et rien n'est exécuté. */
  it('REFUSE la requête sans jeton, et ne lance AUCUN processus', async () => {
    const { porteProd, lancer } = montage()
    const resultat = await runSqlRead(
      { server: 'SQL-PROD\\PROD', database: 'RIG_AMIENS', query: 'SELECT 1 AS n' },
      { catalog: CATALOGUE, porteProd, spawnFn: lancer as never, sqlcmdPath: 'sqlcmd' }
    )
    expect(resultat.ok).toBe(false)
    if (resultat.ok) return
    expect(resultat.reason).toContain('greffe exploité')
    expect(resultat.reason).toContain('phrase de passe')
    expect(lancer).not.toHaveBeenCalled()
  })

  it('REFUSE un jeton inventé par l’appelant', async () => {
    const { porteProd, lancer } = montage()
    const resultat = await runSqlRead(
      { server: 'SQL-PROD\\PROD', database: 'RIG_AMIENS', query: 'SELECT 1 AS n' },
      {
        catalog: CATALOGUE,
        porteProd,
        jetonProd: 'jeton-invente',
        spawnFn: lancer as never,
        sqlcmdPath: 'sqlcmd'
      }
    )
    expect(resultat.ok).toBe(false)
    expect(lancer).not.toHaveBeenCalled()
  })

  it('REFUSE un jeton obtenu pour une autre base', async () => {
    const { coffre, porteProd, lancer } = montage()
    const jeton = jetonPour(coffre, 'base:RIG_MAQUETTE', 'sql-read')
    const resultat = await runSqlRead(
      { server: 'SQL-PROD\\PROD', database: 'RIG_AMIENS', query: 'SELECT 1 AS n' },
      {
        catalog: CATALOGUE,
        porteProd,
        jetonProd: jeton,
        spawnFn: lancer as never,
        sqlcmdPath: 'sqlcmd'
      }
    )
    expect(resultat.ok).toBe(false)
    expect(lancer).not.toHaveBeenCalled()
  })

  /** Une base non déclarée n'est pas une base sûre : elle est traitée comme de la production. */
  it('REFUSE une base absente de la liste d’autorité', async () => {
    const { porteProd, lancer } = montage()
    const catalogue = buildSqlTargetCatalog([
      { server: 'SQL-PROD\\PROD', database: 'RIG_NON_DECLAREE' }
    ])
    const resultat = await runSqlRead(
      { server: 'SQL-PROD\\PROD', database: 'RIG_NON_DECLAREE', query: 'SELECT 1 AS n' },
      { catalog: catalogue, porteProd, spawnFn: lancer as never, sqlcmdPath: 'sqlcmd' }
    )
    expect(resultat.ok).toBe(false)
    if (resultat.ok) return
    expect(resultat.reason).toContain('non déclarée')
    expect(lancer).not.toHaveBeenCalled()
  })
})

describe('ce que la porte laisse passer', () => {
  /**
   * Une base déclarée HORS production ne demande rien. Le témoin est ATTEINT : la requête est partie,
   * et c'est la preuve que la porte n'a pas bloqué — l'erreur qui remonte est celle du faux
   * lancement, pas un refus.
   */
  it('laisse partir une requête sur une base déclarée hors production', async () => {
    const { porteProd, lancer } = montage()
    const resultat = await runSqlRead(
      { server: 'SQL-PROD\\PROD', database: 'RIG_MAQUETTE', query: 'SELECT 1 AS n' },
      { catalog: CATALOGUE, porteProd, spawnFn: lancer as never, sqlcmdPath: 'sqlcmd' }
    )
    expect(lancer).toHaveBeenCalled()
    expect(resultat.ok).toBe(false)
    if (resultat.ok) return
    expect(resultat.reason).not.toContain('phrase de passe')
  })

  it('laisse partir une requête de production munie du bon jeton', async () => {
    const { coffre, porteProd, lancer } = montage()
    const jeton = jetonPour(coffre, 'base:RIG_AMIENS', 'sql-read')
    await runSqlRead(
      { server: 'SQL-PROD\\PROD', database: 'RIG_AMIENS', query: 'SELECT 1 AS n' },
      {
        catalog: CATALOGUE,
        porteProd,
        jetonProd: jeton,
        spawnFn: lancer as never,
        sqlcmdPath: 'sqlcmd'
      }
    )
    expect(lancer).toHaveBeenCalled()
  })

  /**
   * SANS porte injectée, le comportement historique est INCHANGÉ. C'est ce qui permet d'installer la
   * protection sans casser les appels existants, et ce test le fige.
   */
  it('ne change rien quand aucune porte n’est fournie', async () => {
    const { lancer } = montage()
    await runSqlRead(
      { server: 'SQL-PROD\\PROD', database: 'RIG_AMIENS', query: 'SELECT 1 AS n' },
      { catalog: CATALOGUE, spawnFn: lancer as never, sqlcmdPath: 'sqlcmd' }
    )
    expect(lancer).toHaveBeenCalled()
  })

  /** Tant qu'aucune phrase n'est définie, la porte dort : `sql_query` fonctionne comme avant. */
  it('laisse tout passer tant qu’aucune phrase de passe n’est définie', async () => {
    const { porteProd, lancer } = montage({ phraseDefinie: false })
    await runSqlRead(
      { server: 'SQL-PROD\\PROD', database: 'RIG_AMIENS', query: 'SELECT 1 AS n' },
      { catalog: CATALOGUE, porteProd, spawnFn: lancer as never, sqlcmdPath: 'sqlcmd' }
    )
    expect(lancer).toHaveBeenCalled()
  })
})

/**
 * LA CHAÎNE ENTIÈRE, du FICHIER de déclaration jusqu'au refus de `sql_query`.
 *
 * Les tests précédents injectent une liste d'autorité construite en mémoire. Celui-ci part du
 * fichier réel, comme au démarrage : c'est le seul qui prouve que la déclaration écrite par un
 * humain produit bien le refus attendu, sans maillon simulé entre les deux.
 */
describe('du fichier de déclaration au refus', () => {
  const racines: string[] = []
  function racineNeuve(contenu?: string): string {
    const racine = mkdtempSync(join(tmpdir(), 'autowin-prod-chaine-'))
    racines.push(racine)
    if (contenu !== undefined) writeFileSync(cheminAutoriteProd(racine), contenu, 'utf8')
    return racine
  }

  function porteDepuis(racine: string) {
    const coffre = new CoffreAutorisationProd(EMPREINTE)
    return new PorteProd({
      autorite: () => chargerAutoriteProd(racine).autorite,
      coffre: () => coffre,
      phraseDefinie: () => true,
      niveau: () => 'phrase'
    })
  }

  it('refuse une base DÉCLARÉE production dans le fichier', async () => {
    const racine = racineNeuve(
      JSON.stringify([{ nature: 'base', nom: 'RIG_AMIENS', classe: 'prod', motif: 'greffe' }])
    )
    const lancer = vi.fn(() => {
      throw new Error('temoin de lancement')
    })
    const resultat = await runSqlRead(
      { server: 'SQL-PROD\\PROD', database: 'RIG_AMIENS', query: 'SELECT 1 AS n' },
      {
        catalog: CATALOGUE,
        porteProd: porteDepuis(racine),
        spawnFn: lancer as never,
        sqlcmdPath: 'sqlcmd'
      }
    )
    expect(resultat.ok).toBe(false)
    expect(lancer).not.toHaveBeenCalled()
  })

  it('laisse passer une base DÉCLARÉE hors production dans le fichier', async () => {
    const racine = racineNeuve(
      JSON.stringify([{ nature: 'base', nom: 'RIG_MAQUETTE', classe: 'non-prod' }])
    )
    const lancer = vi.fn(() => {
      throw new Error('temoin de lancement')
    })
    await runSqlRead(
      { server: 'SQL-PROD\\PROD', database: 'RIG_MAQUETTE', query: 'SELECT 1 AS n' },
      {
        catalog: CATALOGUE,
        porteProd: porteDepuis(racine),
        spawnFn: lancer as never,
        sqlcmdPath: 'sqlcmd'
      }
    )
    expect(lancer).toHaveBeenCalled()
  })

  /** Le cas demandé, vu de bout en bout : sans fichier, plus rien ne passe. */
  it('refuse TOUT quand le fichier de déclaration est absent', async () => {
    const lancer = vi.fn(() => {
      throw new Error('temoin de lancement')
    })
    const resultat = await runSqlRead(
      { server: 'SQL-PROD\\PROD', database: 'RIG_MAQUETTE', query: 'SELECT 1 AS n' },
      {
        catalog: CATALOGUE,
        porteProd: porteDepuis(racineNeuve()),
        spawnFn: lancer as never,
        sqlcmdPath: 'sqlcmd'
      }
    )
    expect(resultat.ok).toBe(false)
    if (resultat.ok) return
    expect(resultat.reason).toContain('non déclarée')
    expect(lancer).not.toHaveBeenCalled()
  })

  it('refuse TOUT quand le fichier de déclaration est illisible', async () => {
    const lancer = vi.fn(() => {
      throw new Error('temoin de lancement')
    })
    const resultat = await runSqlRead(
      { server: 'SQL-PROD\\PROD', database: 'RIG_MAQUETTE', query: 'SELECT 1 AS n' },
      {
        catalog: CATALOGUE,
        porteProd: porteDepuis(racineNeuve('{ pas du json')),
        spawnFn: lancer as never,
        sqlcmdPath: 'sqlcmd'
      }
    )
    expect(resultat.ok).toBe(false)
    expect(lancer).not.toHaveBeenCalled()
  })

  /** Une déclaration corrigée est prise en compte SANS redémarrage : la liste est relue. */
  it('prend en compte une correction du fichier sans redémarrer', async () => {
    const racine = racineNeuve('[]')
    const porte = porteDepuis(racine)
    expect(
      porte.verifier({ nature: 'base', nom: 'RIG_MAQUETTE', operation: 'sql-read' }).autorise
    ).toBe(false)
    writeFileSync(
      cheminAutoriteProd(racine),
      JSON.stringify([{ nature: 'base', nom: 'RIG_MAQUETTE', classe: 'non-prod' }]),
      'utf8'
    )
    expect(
      porte.verifier({ nature: 'base', nom: 'RIG_MAQUETTE', operation: 'sql-read' }).autorise
    ).toBe(true)
  })

  it('nettoie ses dossiers temporaires', () => {
    for (const racine of racines) rmSync(racine, { recursive: true, force: true })
    expect(racines.length).toBeGreaterThan(0)
  })
})

/**
 * LE CHAÎNON ÉCRAN : au refus, le geste n'est pas rendu au modèle — l'écran de saisie s'ouvre chez
 * l'utilisateur, et le geste est REJOUÉ avec le jeton obtenu, dans le même appel d'outil.
 */
describe('le refus ouvre l’écran de saisie et rejoue le geste', () => {
  function guichetQui(
    reponse: (demande: { cible: string; operation: string }) => string | undefined
  ) {
    const vues: { cible: string; operation: string; raison: string }[] = []
    return {
      vues,
      guichet: {
        demander: async (demande: { cible: string; operation: string; raison: string }) => {
          vues.push(demande)
          const valeur = reponse(demande)
          return valeur === undefined ? undefined : { type: 'jeton', valeur }
        }
      } as never
    }
  }

  it('demande l’autorisation avec la cible et l’opération exactes, puis EXÉCUTE', async () => {
    const { coffre, porteProd, lancer } = montage()
    const { guichet, vues } = guichetQui((d) => jetonPour(coffre, d.cible, d.operation))
    const resultat = await runSqlRead(
      { server: 'SQL-PROD\\PROD', database: 'RIG_AMIENS', query: 'SELECT 1 AS n' },
      {
        catalog: CATALOGUE,
        porteProd,
        guichetProd: guichet,
        spawnFn: lancer as never,
        sqlcmdPath: 'sqlcmd'
      }
    )
    expect(vues).toEqual([
      {
        cible: 'base:RIG_AMIENS',
        operation: 'sql-read',
        raison: 'Production déclarée : greffe exploité',
        niveau: 'phrase'
      }
    ])
    // Le geste est bien REPARTI : le témoin de lancement n'est atteint que si la porte a laissé
    // passer la reprise. C'est la preuve que le jeton saisi à l'écran débloque le geste refusé.
    expect(lancer).toHaveBeenCalled()
    expect(resultat.ok).toBe(false)
  })

  it('reste REFUSÉ si l’utilisateur annule, sans rien lancer', async () => {
    const { porteProd, lancer } = montage()
    const { guichet, vues } = guichetQui(() => undefined)
    const resultat = await runSqlRead(
      { server: 'SQL-PROD\\PROD', database: 'RIG_AMIENS', query: 'SELECT 1 AS n' },
      {
        catalog: CATALOGUE,
        porteProd,
        guichetProd: guichet,
        spawnFn: lancer as never,
        sqlcmdPath: 'sqlcmd'
      }
    )
    expect(vues).toHaveLength(1)
    expect(resultat.ok).toBe(false)
    expect(lancer).not.toHaveBeenCalled()
  })

  it('ne rejoue QU’UNE fois : un jeton qui ne convient pas ne rouvre pas l’écran', async () => {
    const { coffre, porteProd, lancer } = montage()
    const { guichet, vues } = guichetQui(() => jetonPour(coffre, 'base:RIG_MAQUETTE', 'sql-read'))
    const resultat = await runSqlRead(
      { server: 'SQL-PROD\\PROD', database: 'RIG_AMIENS', query: 'SELECT 1 AS n' },
      {
        catalog: CATALOGUE,
        porteProd,
        guichetProd: guichet,
        spawnFn: lancer as never,
        sqlcmdPath: 'sqlcmd'
      }
    )
    expect(vues).toHaveLength(1)
    expect(resultat.ok).toBe(false)
    expect(lancer).not.toHaveBeenCalled()
  })

  it('n’ouvre AUCUN écran pour une base non-prod', async () => {
    const { porteProd, lancer } = montage()
    const { guichet, vues } = guichetQui(() => 'jamais')
    await runSqlRead(
      { server: 'SQL-PROD\\PROD', database: 'RIG_MAQUETTE', query: 'SELECT 1 AS n' },
      {
        catalog: CATALOGUE,
        porteProd,
        guichetProd: guichet,
        spawnFn: lancer as never,
        sqlcmdPath: 'sqlcmd'
      }
    )
    expect(vues).toEqual([])
    expect(lancer).toHaveBeenCalled()
  })
})

/**
 * LE NIVEAU « CONFIRMATION » VU DEPUIS `sql_query` — le besoin réel : une requête sur une base de
 * production ouvre une fenêtre « continuer ? », et rien ne part tant qu'on n'a pas répondu.
 */
describe('confirmation avant toute requête sur une base de production', () => {
  function porteConfirmation() {
    const coffre = new CoffreAutorisationProd(EMPREINTE)
    return new PorteProd({
      autorite: () => AUTORITE,
      coffre: () => coffre,
      phraseDefinie: () => false,
      niveau: () => 'confirmation'
    })
  }

  it('DEMANDE une confirmation, puis exécute quand l’utilisateur continue', async () => {
    const lancer = vi.fn(() => {
      throw new Error('temoin de lancement')
    })
    const vues: { cible: string; niveau: string }[] = []
    const guichet = {
      demander: async (demande: { cible: string; niveau: string }) => {
        vues.push(demande)
        return { type: 'confirme' as const }
      }
    } as never
    await runSqlRead(
      { server: 'SQL-PROD\\PROD', database: 'RIG_AMIENS', query: 'SELECT 1 AS n' },
      {
        catalog: CATALOGUE,
        porteProd: porteConfirmation(),
        guichetProd: guichet,
        spawnFn: lancer as never,
        sqlcmdPath: 'sqlcmd'
      }
    )
    expect(vues).toHaveLength(1)
    expect(vues[0]?.niveau).toBe('confirmation')
    // Le témoin n'est atteint que si la porte a laissé repartir le geste après la confirmation.
    expect(lancer).toHaveBeenCalled()
  })

  it('n’exécute RIEN si l’utilisateur annule la confirmation', async () => {
    const lancer = vi.fn(() => {
      throw new Error('AUCUN processus ne devait être lancé')
    })
    const guichet = { demander: async () => undefined } as never
    const resultat = await runSqlRead(
      { server: 'SQL-PROD\\PROD', database: 'RIG_AMIENS', query: 'SELECT 1 AS n' },
      {
        catalog: CATALOGUE,
        porteProd: porteConfirmation(),
        guichetProd: guichet,
        spawnFn: lancer as never,
        sqlcmdPath: 'sqlcmd'
      }
    )
    expect(resultat.ok).toBe(false)
    if (resultat.ok) return
    expect(resultat.reason).toContain('Confirmation requise')
    expect(lancer).not.toHaveBeenCalled()
  })

  it('ne demande RIEN pour une base déclarée non-prod', async () => {
    const lancer = vi.fn(() => {
      throw new Error('temoin de lancement')
    })
    const vues: unknown[] = []
    const guichet = {
      demander: async (d: unknown) => {
        vues.push(d)
        return { type: 'confirme' as const }
      }
    } as never
    await runSqlRead(
      { server: 'SQL-PROD\\PROD', database: 'RIG_MAQUETTE', query: 'SELECT 1 AS n' },
      {
        catalog: CATALOGUE,
        porteProd: porteConfirmation(),
        guichetProd: guichet,
        spawnFn: lancer as never,
        sqlcmdPath: 'sqlcmd'
      }
    )
    expect(vues).toEqual([])
    expect(lancer).toHaveBeenCalled()
  })
})
