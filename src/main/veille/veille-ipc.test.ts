import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { registerVeilleIpc } from './veille-ipc'
import { ecrireStockVeille, type StockVeille } from './candidats-store'
import type { IpcMainInvokeEvent } from 'electron'

/**
 * Le canal « veille:generer » : la vue DÉCLENCHE une passe, elle n'écrit jamais un candidat.
 * Nés avec le bouton « En générer plus » (demande utilisateur du 2026-08-13).
 */
function harnais(genererInterne?: () => Promise<unknown>): {
  appeler: (canal: string) => unknown
} {
  const handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>()
  registerVeilleIpc({
    ipc: { handle: (canal, listener) => handlers.set(canal, listener) },
    assertTrusted: () => {},
    chemin: 'C:/inexistant/stock.json',
    ...(genererInterne ? { genererInterne } : {})
  })
  return { appeler: (canal) => handlers.get(canal)!({} as IpcMainInvokeEvent) }
}

describe('veille:generer', () => {
  it('non câblé → une erreur NOMMÉE, pas un canal qui répond du vide', () => {
    const { appeler } = harnais()
    expect(() => appeler('veille:generer')).toThrow(/non câblée/)
  })

  it('délègue à la passe interne et rend son résultat', async () => {
    const generer = vi.fn(async () => ({ retenus: 2 }))
    const { appeler } = harnais(generer)
    await expect(appeler('veille:generer')).resolves.toEqual({ retenus: 2 })
    expect(generer).toHaveBeenCalledTimes(1)
  })

  it('deux clics pendant une génération ne paient qu’UN scout', async () => {
    let resoudre!: (v: unknown) => void
    const generer = vi.fn(() => new Promise((r) => (resoudre = r)))
    const { appeler } = harnais(generer)
    const premier = appeler('veille:generer') as Promise<unknown>
    const second = appeler('veille:generer') as Promise<unknown>
    resoudre({ retenus: 1 })
    await expect(premier).resolves.toEqual({ retenus: 1 })
    await expect(second).resolves.toEqual({ retenus: 1 })
    expect(generer).toHaveBeenCalledTimes(1)
  })

  it('après la fin d’une génération, un nouveau clic relance', async () => {
    const generer = vi.fn(async () => ({ retenus: 0 }))
    const { appeler } = harnais(generer)
    await appeler('veille:generer')
    await appeler('veille:generer')
    expect(generer).toHaveBeenCalledTimes(2)
  })
})

/**
 * Servir le stock = re-vérifier, AU MOMENT de servir, que chaque correction ancrée dans le code cite
 * encore une ligne présente dans son fichier. Sinon le candidat sort « périmé » — sans que le stock
 * sur disque soit réécrit : si la ligne revient (correctif annulé), le ticket redevient actif seul.
 */
describe('veille:snapshot et veille:marquer — candidats périmés', () => {
  const LIGNE = "return diverged ? ['rebase', 'merge'] : ['fast-forward']"
  const dossiers: string[] = []
  const dossierTemporaire = (prefixe: string): string => {
    const dossier = mkdtempSync(join(tmpdir(), prefixe))
    dossiers.push(dossier)
    return dossier
  }
  afterEach(() => {
    for (const dossier of dossiers.splice(0)) rmSync(dossier, { recursive: true, force: true })
  })

  function preparer(contenuFichier: string | undefined): {
    appeler: (canal: string, ...args: unknown[]) => unknown
    stockSurDisque: () => string
  } {
    const dossier = dossierTemporaire('veille-perime-')
    const depot = join(dossier, 'depot')
    mkdirSync(join(depot, 'src', 'shared'), { recursive: true })
    if (contenuFichier !== undefined) {
      writeFileSync(join(depot, 'src', 'shared', 'update-contract.ts'), contenuFichier, 'utf8')
    }
    const chemin = join(dossier, 'veille-candidats.json')
    const base = {
      concurrent: 'Autowin OS',
      dateSource: '2026-09-16',
      prompt: 'Corrige ce defaut',
      vuLe: '2026-09-22T11:40:03.153Z'
    }
    ecrireStockVeille(
      {
        candidats: [
          {
            ...base,
            id: 'corr',
            titre: 'La mise à jour propose d’abord rebaser',
            url: 'src/shared/update-contract.ts:52',
            citation: LIGNE,
            type: 'correction',
            statut: 'nouveau'
          },
          {
            ...base,
            id: 'evasion',
            titre: 'Ancrage qui sort du dépôt',
            url: 'src/../../veille-candidats.json:1',
            citation: 'ligne introuvable ici',
            type: 'correction',
            statut: 'nouveau'
          }
        ],
        echecs: []
      },
      chemin
    )
    const handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>()
    registerVeilleIpc({
      ipc: { handle: (canal, listener) => handlers.set(canal, listener) },
      assertTrusted: () => {},
      chemin,
      racineDepot: depot
    })
    return {
      appeler: (canal, ...args) => handlers.get(canal)!({} as IpcMainInvokeEvent, ...args),
      stockSurDisque: () => readFileSync(chemin, 'utf8')
    }
  }

  const statutDe = (stock: unknown, id: string): string | undefined =>
    (stock as StockVeille).candidats.find((c) => c.id === id)?.statut

  it('ligne disparue du fichier → servi « perime », stock disque INCHANGÉ', () => {
    const { appeler, stockSurDisque } = preparer(
      'const choix = diverged\n  ? ["rebase", "merge"]\n'
    )
    const avant = stockSurDisque()
    expect(statutDe(appeler('veille:snapshot'), 'corr')).toBe('perime')
    expect(stockSurDisque()).toBe(avant)
  })

  it('ligne toujours présente → servi avec son statut', () => {
    const { appeler } = preparer(`function f() {\n  ${LIGNE}\n}\n`)
    expect(statutDe(appeler('veille:snapshot'), 'corr')).toBe('nouveau')
  })

  it('un ancrage qui SORT du dépôt n’est jamais lu : état inconnu, candidat non déclassé', () => {
    const { appeler } = preparer(LIGNE)
    expect(statutDe(appeler('veille:snapshot'), 'evasion')).toBe('nouveau')
  })

  it('marquer rend aussi le stock re-vérifié, et garde le marquage humain sur disque', () => {
    const { appeler, stockSurDisque } = preparer('// corrigé\n')
    const rendu = appeler('veille:marquer', 'corr', 'ecarte')
    expect(statutDe(rendu, 'corr')).toBe('perime')
    expect(JSON.parse(stockSurDisque()).candidats[0].statut).toBe('ecarte')
  })

  it('« perime » n’est pas un marquage humain : refusé par veille:marquer', () => {
    const { appeler } = preparer(LIGNE)
    expect(() => appeler('veille:marquer', 'corr', 'perime')).toThrow(
      /marquage de candidat invalide/
    )
  })

  it('sans racine de dépôt, aucune re-vérification : le stock est servi tel quel', () => {
    const dossier = dossierTemporaire('veille-sans-racine-')
    const chemin = join(dossier, 'veille-candidats.json')
    ecrireStockVeille(
      {
        candidats: [
          {
            id: 'corr',
            concurrent: 'Autowin OS',
            titre: 't',
            url: 'src/shared/update-contract.ts:52',
            dateSource: '2026-09-16',
            citation: LIGNE,
            type: 'correction',
            prompt: 'p',
            vuLe: '2026-09-22T11:40:03.153Z',
            statut: 'nouveau'
          }
        ],
        echecs: []
      },
      chemin
    )
    const handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>()
    registerVeilleIpc({
      ipc: { handle: (canal, listener) => handlers.set(canal, listener) },
      assertTrusted: () => {},
      chemin,
      racineDepot: join(dossier, 'depot-inexistant')
    })
    expect(statutDe(handlers.get('veille:snapshot')!({} as IpcMainInvokeEvent), 'corr')).toBe(
      'nouveau'
    )
  })
})
