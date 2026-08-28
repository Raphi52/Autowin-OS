import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  demarrerDetecteurDeGel,
  instrumenterAppelsSynchrones,
  instrumenterCanauxIpc,
  lireGels,
  marquerOperation,
  operationDeclaree,
  ouvrirOperation,
  pendantOperation
} from './gel-main'
import type { Gel } from '../shared/gel-detector'

// La pile d'operations est un etat de MODULE : sans remise a zero, un test en contamine un autre.
beforeEach(() => marquerOperation(''))

describe('detecteur de gel — un blocage REEL du main est capte et nomme', () => {
  it('attrape un blocage synchrone et lui attache l’operation declaree', async () => {
    const captures: Gel[] = []
    marquerOperation('test:blocage-synchrone')
    const arreter = demarrerDetecteurDeGel(
      mkdtempSync(join(tmpdir(), 'gel-')),
      20,
      (g) => captures.push(g),
      30
    )
    // BLOCAGE REEL de la boucle d'evenements — exactement ce que fait un `readFileSync` lent.
    const fin = Date.now() + 60
    while (Date.now() < fin) {
      /* on tient la boucle, sans await */
    }
    await new Promise((r) => setTimeout(r, 80))
    arreter()
    expect(captures.length).toBeGreaterThan(0)
    expect(captures[0]?.operation).toBe('test:blocage-synchrone')
    expect(captures[0]?.blocageMs).toBeGreaterThan(0)
  })

  it('ne bat pas a vide : une boucle libre ne journalise AUCUN gel', async () => {
    const captures: Gel[] = []
    const arreter = demarrerDetecteurDeGel(mkdtempSync(join(tmpdir(), 'gel-')), 20, (g) =>
      captures.push(g)
    )
    await new Promise((r) => setTimeout(r, 120))
    arreter()
    expect(captures).toEqual([])
  })
})

describe('lireGels — dire « pas de journal » plutot qu’un zero rassurant', () => {
  it('rend disponible=false quand aucun journal n’existe', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gel-'))
    expect(lireGels(dir).disponible).toBe(false)
  })

  it('agrege le journal reel et borne la fenetre aux derniers gels', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gel-'))
    writeFileSync(
      join(dir, 'gels.jsonl'),
      [
        JSON.stringify({ ts: 'a', blocageMs: 9000, operation: 'vieux' }),
        JSON.stringify({ ts: 'b', blocageMs: 1100, operation: 'snapshot' })
      ].join('\n'),
      'utf8'
    )
    const rapport = lireGels(dir, 1)
    expect(rapport.disponible).toBe(true)
    expect(rapport.gels).toBe(1)
    expect(rapport.parOperation[0]?.operation).toBe('snapshot')
  })
})

/**
 * REGRESSION du 2026-08-28 : la premiere version remettait 'inactif' des la fin de la lecture la
 * plus interne. Les quatre gels reellement captes (pire : 33 335 ms) sont donc tous ressortis sous
 * « inconnu » / « inactif » — l'instrument prouvait le gel sans jamais nommer le coupable.
 */
describe('pile d’operations — une operation imbriquee rend la main a celle qui l’ENGLOBE', () => {
  it('ne retombe pas dans le vide quand la lecture interne se termine', () => {
    const fermerExterne = ouvrirOperation('demarrage:coordinateur')
    pendantOperation('snapshot:runs', () => 'lu')
    expect(operationDeclaree()).toBe('demarrage:coordinateur')
    fermerExterne()
    expect(operationDeclaree()).toBe('inconnu')
  })

  it('depile meme quand l’operation JETTE', () => {
    const fermer = ouvrirOperation('englobante')
    expect(() =>
      pendantOperation('qui-jette', () => {
        throw new Error('boum')
      })
    ).toThrow('boum')
    expect(operationDeclaree()).toBe('englobante')
    fermer()
  })

  it('depile une operation ASYNCHRONE seulement quand sa promesse est reglee', async () => {
    let resoudre: () => void = () => {}
    const attente = new Promise<void>((r) => {
      resoudre = r
    })
    const promesse = pendantOperation('async:lente', () => attente)
    expect(operationDeclaree()).toBe('async:lente')
    resoudre()
    await promesse
    expect(operationDeclaree()).toBe('inconnu')
  })
})

describe('instrumenterCanauxIpc — une seule couture pour tous les canaux', () => {
  it('declare le canal pendant le handler, sans changer sa valeur', async () => {
    const enregistres = new Map<string, (...a: never[]) => unknown>()
    const faux = {
      handle: (canal: string, ecouteur: (...a: never[]) => unknown) => {
        enregistres.set(canal, ecouteur)
      }
    }
    instrumenterCanauxIpc(faux)
    let vuPendant = ''
    faux.handle('perf:gels', (() => {
      vuPendant = operationDeclaree()
      return 42
    }) as unknown as (...a: never[]) => unknown)
    const resultat = await (enregistres.get('perf:gels') as () => unknown)()
    expect(vuPendant).toBe('ipc:perf:gels')
    expect(resultat).toBe(42)
    expect(operationDeclaree()).toBe('inconnu')
  })
})

/**
 * ALIBI DU 2026-08-28 : `ipc:os:models:quotas` est ressorti treize fois en tete du journal des gels
 * alors que la lecture disque qu'on lui imputait coute 30 ms — il attendait un `fetch` reseau, et
 * une promesse en attente ne TIENT PAS la boucle d'evenements. Un handler async ne doit donc etre
 * declare que pendant son segment SYNCHRONE.
 */
describe('un handler ASYNC ne s’attribue pas les gels qui surviennent pendant son attente', () => {
  it('se depile des le premier await, pas au reglement de la promesse', async () => {
    const enregistres = new Map<string, (...a: never[]) => unknown>()
    const faux = {
      handle: (canal: string, ecouteur: (...a: never[]) => unknown) => {
        enregistres.set(canal, ecouteur)
      }
    }
    instrumenterCanauxIpc(faux)
    let resoudre: () => void = () => {}
    const reseau = new Promise<void>((r) => {
      resoudre = r
    })
    faux.handle('os:models:quotas', (async () => {
      await reseau
      return 'quotas'
    }) as unknown as (...a: never[]) => unknown)

    const promesse = (enregistres.get('os:models:quotas') as () => Promise<unknown>)()
    // Le handler EST en vol, mais il n'est qu'en ATTENTE : un gel survenu ici n'est pas le sien.
    expect(operationDeclaree()).toBe('inconnu')
    resoudre()
    expect(await promesse).toBe('quotas')
  })
})

describe('instrumenterAppelsSynchrones — la famille qui fige vraiment la fenetre se nomme', () => {
  it('declare le binaire et son premier argument pendant l’appel, sans changer le resultat', () => {
    let vuPendant = ''
    const faux: Record<string, unknown> = {
      execFileSync: (_bin: string, _args: string[]) => {
        vuPendant = operationDeclaree()
        return 'sortie git'
      }
    }
    instrumenterAppelsSynchrones(faux)
    const resultat = (faux.execFileSync as (b: string, a: string[]) => unknown)('git', [
      'for-each-ref',
      '--no-merged'
    ])
    expect(vuPendant).toBe('sync:git for-each-ref')
    expect(resultat).toBe('sortie git')
    expect(operationDeclaree()).toBe('inconnu')
  })

  it('depile meme quand le processus enfant JETTE', () => {
    const faux: Record<string, unknown> = {
      spawnSync: () => {
        throw new Error('ENOENT')
      }
    }
    instrumenterAppelsSynchrones(faux)
    expect(() => (faux.spawnSync as (b: string) => unknown)('git')).toThrow('ENOENT')
    expect(operationDeclaree()).toBe('inconnu')
  })
})
