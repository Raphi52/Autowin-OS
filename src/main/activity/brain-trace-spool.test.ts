import {
  appendFileSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  appendBrainTrace,
  brainSpoolRoot,
  brainTraceSpoolHealth,
  latestBrainTraceId,
  readBrainTraces
} from './brain-trace-spool'

describe('perte de trace Brain observable', () => {
  const roots: string[] = []

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  })

  it('compte la trace perdue quand l ecriture echoue, sans jeter', () => {
    // Un fichier en guise de base : la creation du dossier de spool echoue forcement.
    const fauxBase = join(mkdtempSync(join(tmpdir(), 'autowin-brain-perte-')), 'base')
    roots.push(fauxBase)
    writeFileSync(fauxBase, 'pas un dossier', 'utf8')
    const avant = brainTraceSpoolHealth().tracesPerdues

    const rendu = appendBrainTrace(
      {
        timestamp: '2026-08-19T09:00:00.000Z',
        conversationId: 'conv-perdue',
        turnId: 'turn-perdu',
        query: 'trace condamnee',
        injectedChars: 7
      },
      fauxBase
    )

    expect(rendu).toBeUndefined()
    const sante = brainTraceSpoolHealth()
    expect(sante.tracesPerdues).toBe(avant + 1)
    expect(sante.enBonneSante).toBe(false)
    expect(sante.derniereErreur).toBeTruthy()
  })

  it('ne signale aucun incident en marche normale', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-brain-nominal-'))
    roots.push(root)
    const avant = brainTraceSpoolHealth().tracesPerdues

    const rendu = appendBrainTrace(
      {
        timestamp: '2026-08-19T09:01:00.000Z',
        conversationId: 'conv-saine',
        turnId: 'turn-sain',
        query: 'trace ecrite',
        injectedChars: 42
      },
      root
    )

    expect(rendu?.id).toBeTruthy()
    expect(readBrainTraces('conv-saine', root)).toHaveLength(1)
    expect(brainTraceSpoolHealth().tracesPerdues).toBe(avant)
  })
})

describe('brain trace spool causal identity', () => {
  const roots: string[] = []

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  })

  it('persists the explicit turn and retrieval timestamp', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-brain-trace-'))
    roots.push(root)
    appendBrainTrace(
      {
        timestamp: '2026-07-24T10:11:12.000Z',
        conversationId: 'conv-1',
        turnId: 'turn-7',
        query: 'Pourquoi le cache ?',
        injectedChars: 842,
        navigation: {
          query: 'Pourquoi le cache ?',
          minDense: 0.42,
          candidates: [
            { rank: 1, path: 'knowledge/cache.md', type: 'domain', denseCos: 0.81, retained: true }
          ]
        }
      },
      root
    )

    expect(readBrainTraces('conv-1', root)).toMatchObject([
      {
        id: expect.any(String),
        timestamp: '2026-07-24T10:11:12.000Z',
        conversationId: 'conv-1',
        turnId: 'turn-7',
        injectedChars: 842
      }
    ])
    expect(latestBrainTraceId('conv-1', 'turn-7', root)).toBe(readBrainTraces('conv-1', root)[0].id)
  })

  it('keeps historical traces without a turn id readable but unlinked', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-brain-trace-legacy-'))
    roots.push(root)
    const spool = brainSpoolRoot(root)
    writeFileSync(
      join(spool, 'events.jsonl'),
      `${JSON.stringify({
        timestamp: '2026-07-23T10:00:00.000Z',
        conversationId: 'conv-legacy',
        query: 'legacy',
        injectedChars: 12
      })}\n`,
      'utf8'
    )

    expect(readBrainTraces('conv-legacy', root)[0]).not.toHaveProperty('turnId')
  })

  it('isole les appels automatiques et explicites par conversation', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-brain-trace-scope-'))
    roots.push(root)
    appendBrainTrace(
      {
        timestamp: '2026-07-30T10:00:00.000Z',
        conversationId: 'conv-a',
        turnId: 'turn-1',
        kind: 'automatic',
        query: 'contexte automatique',
        found: true,
        injectedChars: 120
      },
      root
    )
    appendBrainTrace(
      {
        timestamp: '2026-07-30T10:01:00.000Z',
        conversationId: 'conv-a',
        kind: 'query',
        query: 'question explicite',
        found: false,
        injectedChars: 0
      },
      root
    )
    appendBrainTrace(
      {
        timestamp: '2026-07-30T10:02:00.000Z',
        conversationId: 'conv-b',
        kind: 'query',
        query: 'étranger',
        found: true,
        injectedChars: 42
      },
      root
    )

    expect(readBrainTraces('conv-a', root).map(({ kind, query }) => ({ kind, query }))).toEqual([
      { kind: 'query', query: 'question explicite' },
      { kind: 'automatic', query: 'contexte automatique' }
    ])
  })

  it('conserve un appel Brain après trois rotations', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-brain-rotations-'))
    roots.push(root)
    appendBrainTrace(
      {
        timestamp: '2026-07-30T10:00:00.000Z',
        conversationId: 'conv-durable',
        turnId: 'turn-durable',
        kind: 'automatic',
        query: 'appel durable',
        found: false,
        status: 'empty',
        injectedChars: 0
      },
      root
    )
    const current = join(brainSpoolRoot(root), 'events.jsonl')
    for (let index = 0; index < 3; index += 1) {
      appendFileSync(current, `${'x'.repeat(2 * 1024 * 1024 + 1)}\n`, 'utf8')
      appendBrainTrace(
        {
          timestamp: `2026-07-30T10:0${index + 1}:00.000Z`,
          conversationId: `conv-rotation-${index}`,
          kind: 'query',
          query: `rotation ${index}`,
          found: false,
          status: 'empty',
          injectedChars: 0
        },
        root
      )
    }

    expect(readBrainTraces('conv-durable', root)).toEqual([
      expect.objectContaining({ turnId: 'turn-durable', query: 'appel durable' })
    ])
  })

  it('borne la taille totale du spool apres de nombreuses rotations', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-brain-retention-'))
    roots.push(root)
    const spool = brainSpoolRoot(root)
    const current = join(spool, 'events.jsonl')

    for (let index = 0; index < 12; index += 1) {
      appendFileSync(current, `${'x'.repeat(2 * 1024 * 1024 + 1)}\n`, 'utf8')
      appendBrainTrace(
        {
          timestamp: `2026-07-30T11:${String(index).padStart(2, '0')}:00.000Z`,
          conversationId: `conv-${index}`,
          kind: 'query',
          query: `rotation ${index}`,
          injectedChars: 0
        },
        root
      )
    }

    const totalBytes = readdirSync(spool).reduce(
      (total, name) => total + statSync(join(spool, name)).size,
      0
    )
    expect(totalBytes).toBeLessThanOrEqual(13 * 1024 * 1024)
    expect(readBrainTraces(undefined, root).length).toBeLessThanOrEqual(6)
  })

  it('borne une entree geante et redige aussi navigation.query avant toute persistance', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-brain-entry-bound-'))
    roots.push(root)
    const secret = 'sk-secret-navigation'
    appendBrainTrace(
      {
        timestamp: '2026-08-08T12:00:00.000Z',
        conversationId: 'conv-large',
        query: `token=${secret}${'x'.repeat(20 * 1024 * 1024)}`,
        injectedChars: 0,
        navigation: {
          query: `token=${secret}`,
          minDense: 0.1,
          candidates: []
        }
      },
      root
    )

    const current = join(brainSpoolRoot(root), 'events.jsonl')
    const persisted = readFileSync(current, 'utf8')
    expect(statSync(current).size).toBeLessThanOrEqual(2 * 1024 * 1024)
    expect(persisted).not.toContain(secret)
    expect(readBrainTraces('conv-large', root)).toHaveLength(1)
  })
})

/**
 * LA PERTE D'UNE TRACE BRAIN EST DESORMAIS COMPTEE — le test que la livraison n'a pas eu le temps
 * d'ecrire.
 *
 * L'application a livre elle-meme le correctif de production, en deux commits (`0ff050a0`,
 * `b16d4620`) : compteur, accesseur `brainTraceSpoolHealth()`, puis cablage du `catch`. Son tour a
 * ensuite ete coupe par son budget de duree — 45 min en regime `standard`
 * (`execution-quote.ts`) — parce que chaque `edit_file` paie une suite COMPLETE en verification
 * (~8 min mesurees), soit cinq editions au maximum, reprises comprises. Elle s'est arretee juste
 * avant les tests.
 *
 * Et sa verification etait passee : la suite entiere est verte quand le code neuf n'est teste par
 * personne. Un correctif sans preuve rouge->vert franchit donc sa porte sans etre vu — c'est ce
 * trou-la que ces deux tests ferment.
 */
describe('brainTraceSpoolHealth — une trace perdue laisse une marque', () => {
  // `roots` du premier describe lui est LOCAL : ce bloc tient son propre nettoyage.
  const racines: string[] = []
  afterEach(() => {
    for (const r of racines.splice(0)) rmSync(r, { recursive: true, force: true })
  })

  it('compte la perte et nomme sa cause quand l’ecriture est impossible', () => {
    const avant = brainTraceSpoolHealth()
    // Un FICHIER a la place du dossier du spool : l'ecriture echoue de facon deterministe sur toutes
    // les plateformes, sans manipuler de permissions.
    const racine = mkdtempSync(join(tmpdir(), 'autowin-brain-perte-'))
    racines.push(racine)
    writeFileSync(join(racine, 'brain-trace-spool'), 'pas un dossier', 'utf8')

    const rendu = appendBrainTrace(
      {
        timestamp: '2026-08-19T12:00:00.000Z',
        conversationId: 'conv-perte',
        turnId: 'turn-1',
        query: 'trace qui ne pourra pas s’ecrire',
        injectedChars: 10
      },
      racine
    )

    // Le tracage ne casse JAMAIS l'action tracee : il rend `undefined`, il ne jette pas.
    expect(rendu).toBeUndefined()
    const apres = brainTraceSpoolHealth()
    expect(apres.tracesPerdues).toBe(avant.tracesPerdues + 1)
    expect(apres.derniereErreur).toBeTruthy()
    expect(apres.enBonneSante).toBe(false)
  })

  it('CONTRE-EXEMPLE — une ecriture qui REUSSIT ne compte aucune perte', () => {
    const avant = brainTraceSpoolHealth()
    const racine = mkdtempSync(join(tmpdir(), 'autowin-brain-ok-'))
    racines.push(racine)

    const rendu = appendBrainTrace(
      {
        timestamp: '2026-08-19T12:00:01.000Z',
        conversationId: 'conv-ok',
        turnId: 'turn-1',
        query: 'trace nominale',
        injectedChars: 5
      },
      racine
    )

    expect(rendu).toBeTruthy()
    expect(brainTraceSpoolHealth().tracesPerdues).toBe(avant.tracesPerdues)
  })
})

import { vi } from 'vitest'

// Journal des relectures INTEGRALES de fichier faites par le code de production. `readFileSync` sur
// l'archive est precisement le cout que la rotation ne doit plus payer : on le compte au lieu de le
// supposer. Le reste de `node:fs` passe tel quel.
const journalFs = vi.hoisted(() => ({ lecturesIntegrales: [] as string[] }))
vi.mock('node:fs', async (importOriginal) => {
  const reel = (await importOriginal()) as typeof import('node:fs')
  return Object.assign({}, reel, {
    default: reel,
    readFileSync: (chemin: unknown, ...reste: unknown[]) => {
      journalFs.lecturesIntegrales.push(String(chemin))
      return (reel.readFileSync as unknown as (...a: unknown[]) => unknown)(chemin, ...reste)
    }
  })
})

/**
 * ROTATION D'ARCHIVE — AJOUT EN FIN DE FICHIER, PAS RELECTURE NI REECRITURE INTEGRALE.
 *
 * `appendBoundedArchive` rechargeait TOUTE l'archive (plafond 8 Mo), y concatenait le segment
 * (jusqu'a 2 Mo), tronquait, puis reecrivait le fichier entier : jusqu'a 10 Mo lus et 8 Mo reecrits
 * pour ajouter quelques kilo-octets, sur le thread principal. Ces tests verrouillent le COUT sans
 * lacher les deux proprietes existantes : plafond ARCHIVE_MAX_BYTES respecte, et aucune ligne JSONL
 * partielle en tete apres une coupe. Le contre-exemple garde l'exigence inverse : sous le plafond,
 * l'archive conserve TOUT son contenu.
 */
describe('rotation de l’archive Brain — cout borne, proprietes conservees', () => {
  const racines: string[] = []
  afterEach(() => {
    for (const r of racines.splice(0)) rmSync(r, { recursive: true, force: true })
  })

  /** Une ligne JSONL valide d’environ `taille` octets, marquee par `tag`. */
  function ligne(tag: string, taille: number): string {
    return (
      JSON.stringify({ tag, bourrage: 'x'.repeat(Math.max(1, taille - tag.length - 40)) }) + '\n'
    )
  }

  /** Spool pret a tourner : `events.jsonl` au plafond, segment precedent present, archive donnee. */
  function spoolPretARotation(
    prefixe: string,
    archive: string,
    segment: string
  ): { racine: string; cheminArchive: string } {
    const racine = mkdtempSync(join(tmpdir(), prefixe))
    racines.push(racine)
    const spool = brainSpoolRoot(racine)
    writeFileSync(join(spool, 'events.jsonl'), ligne('courant', 2 * 1024 * 1024), 'utf8')
    writeFileSync(join(spool, 'events.previous.jsonl'), segment, 'utf8')
    writeFileSync(join(spool, 'events.archive.jsonl'), archive, 'utf8')
    return { racine, cheminArchive: join(spool, 'events.archive.jsonl') }
  }

  /** Declenche une rotation reelle et exige qu’aucune trace ne soit perdue au passage. */
  function tourner(racine: string): void {
    const avant = brainTraceSpoolHealth()
    const rendu = appendBrainTrace(
      {
        timestamp: '2026-08-19T13:00:00.000Z',
        conversationId: 'conv-rotation',
        turnId: 'turn-1',
        query: 'trace qui declenche la rotation',
        injectedChars: 1
      },
      racine
    )
    expect(rendu).toBeTruthy()
    expect(brainTraceSpoolHealth().tracesPerdues).toBe(avant.tracesPerdues)
  }

  it('CONTRE-EXEMPLE — sous le plafond : tout est conserve, sans relire l’archive', () => {
    const segment = ligne('neuf', 4096)
    // 1 Mo : franchement SOUS le seuil de rotation (moitie de ARCHIVE_MAX_BYTES). Le fixture d'origine
    // valait 4 Mo, soit exactement le seuil : il exigeait donc qu'aucune rotation n'ait lieu au moment
    // meme ou l'anneau doit tourner. Le dimensionnement de l'anneau est bon ; c'est le fixture qui
    // decrivait une intention anterieure.
    const archive = ligne('ancien', 1024 * 1024)
    const cible = spoolPretARotation('autowin-brain-archive-append-', archive, segment)

    journalFs.lecturesIntegrales.length = 0
    tourner(cible.racine)
    // RELEVE AVANT que le test lise l'archive : le mock compte TOUTES les lectures, y compris les
    // siennes. Mesurer le cout de la rotation exige de figer le journal a la fin de la rotation.
    const lecturesPendantRotation = [...journalFs.lecturesIntegrales]

    expect(lecturesPendantRotation.filter((chemin) => chemin === cible.cheminArchive)).toEqual([])
    const apres = readFileSync(cible.cheminArchive, 'utf8')
    expect(apres).toBe(archive + segment)
    expect(statSync(cible.cheminArchive).size).toBe(
      Buffer.byteLength(archive, 'utf8') + Buffer.byteLength(segment, 'utf8')
    )
  })

  it('au-dessus du plafond : taille bornee, aucune ligne partielle, segment conserve', () => {
    const anciennes: string[] = []
    for (let i = 0; i < 8; i += 1) anciennes.push(ligne(`ancien-${i}`, 1024 * 1024))
    const segment = ligne('segment-neuf', 2 * 1024 * 1024)
    const cible = spoolPretARotation('autowin-brain-archive-cap-', anciennes.join(''), segment)

    journalFs.lecturesIntegrales.length = 0
    tourner(cible.racine)
    // Meme raison que ci-dessus : le journal est fige avant les lectures du test.
    const lecturesPendantRotation = [...journalFs.lecturesIntegrales]

    const contenu = readFileSync(cible.cheminArchive, 'utf8')
    // Propriete 1 : le plafond tient.
    expect(statSync(cible.cheminArchive).size).toBeLessThanOrEqual(8 * 1024 * 1024)
    // Propriete 2 : aucune ligne JSONL partielle ne subsiste, ni en tete ni ailleurs.
    for (const l of contenu.split('\n').filter((x) => x.trim())) {
      expect(() => JSON.parse(l)).not.toThrow()
    }
    // Le neuf survit, le plus ancien est bien celui qui a ete sacrifie.
    expect(contenu).toContain('"tag":"segment-neuf"')
    expect(contenu).not.toContain('"tag":"ancien-0"')
    // Cout : meme la coupe ne relit pas l’archive entiere.
    expect(lecturesPendantRotation.filter((chemin) => chemin === cible.cheminArchive)).toEqual([])
  })
})
