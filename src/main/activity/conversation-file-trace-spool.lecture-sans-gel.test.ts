import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { supprimerArbre } from '../fichiers/fs-supprimer'
import {
  appendConversationFileTrace,
  attendreEcrituresDesTraces,
  readConversationTurnFileMutations,
  readCurrentPathOwners,
  type ConversationFileTrace
} from './conversation-file-trace-spool'

/**
 * GELS MESURÉS le 06/11/2026 : une centaine de gels de 30 à 58 s de la fenêtre. Profil CPU pris
 * pendant l'un d'eux : `readCurrentPathGenerations` à 96 %, appelée par `proprietaire_fichier` et la
 * publication auto. Chaque chemin d'une trace était cherché parmi tous ses chemins (chemins²), sur
 * les 52 Mo du journal relus à chaque appel ; une trace de 2 344 chemins suffisait. Rejoué sur une
 * copie du vrai journal : 43 s par appel avant, 25 ms après.
 */
const racines: string[] = []
afterEach(async () => {
  await attendreEcrituresDesTraces()
  for (const racine of racines.splice(0)) supprimerArbre(racine)
})

function racineJetable(): string {
  const racine = mkdtempSync(join(tmpdir(), 'autowin-trace-lecture-'))
  racines.push(racine)
  return racine
}

function ligne(trace: ConversationFileTrace): string {
  return `${JSON.stringify(trace)}\n`
}

/** Écriture `src/p.ts` : base `avant` (null = création), état `apres`. */
function ecriture(
  conversationId: string,
  avant: string | null,
  apres: string,
  timestamp: string
): ConversationFileTrace {
  return {
    timestamp,
    conversationId,
    turnId: `tour-${conversationId}`,
    workspaceRoot: 'C:/depot',
    source: 'edit_file',
    paths: ['src/p.ts'],
    pathFingerprints: { 'src/p.ts': `empreinte-${apres}` },
    pathBaseFingerprints: { 'src/p.ts': avant === null ? null : `empreinte-${avant}` },
    pathGenerationMarkers: { 'src/p.ts': `marqueur-${apres}` },
    pathBaseGenerationMarkers: { 'src/p.ts': avant === null ? null : `marqueur-${avant}` }
  }
}

const proprietairesDeP = (racine: string): string[] =>
  readCurrentPathOwners('C:/depot', ['src/p.ts'], racine)[0]!.map((o) => o.conversationId)

describe('journal des traces de fichiers — lire sans tenir la fenêtre', () => {
  it('une trace de 3 000 chemins s’écrit et se relit en moins de 2 s', async () => {
    const racine = racineJetable()
    const chemins = Array.from({ length: 3_000 }, (_, i) => `src/dossier-${i % 50}/fichier-${i}.ts`)
    const parChemin = <T>(valeur: (i: number) => T): Record<string, T> =>
      Object.fromEntries(chemins.map((chemin, i) => [chemin, valeur(i)]))

    const debut = performance.now()
    expect(
      appendConversationFileTrace(
        {
          timestamp: new Date().toISOString(),
          conversationId: 'conv-gros-lot',
          turnId: 'tour-1',
          workspaceRoot: 'C:/depot',
          source: 'subagent',
          paths: chemins,
          pathFingerprints: parChemin((i) => `apres-${i}`),
          pathBaseFingerprints: parChemin(() => null),
          pathGenerationMarkers: parChemin((i) => `marqueur-${i}`),
          pathBaseGenerationMarkers: parChemin(() => null),
          pathLineFingerprints: parChemin((i) => [`ligne-${i}`])
        },
        racine
      )
    ).toBe('appended')
    const proprietaires = readCurrentPathOwners('C:/depot', [chemins[2_999]!], racine)
    const mutations = readConversationTurnFileMutations('conv-gros-lot', 'tour-1', racine)
    const dureeMs = performance.now() - debut

    expect(proprietaires[0]!.map((o) => o.fingerprint)).toEqual(['apres-2999'])
    expect(mutations.paths).toHaveLength(3_000)
    expect(Object.keys(mutations.lineFingerprintsByPath)).toHaveLength(3_000)
    expect(dureeMs, `écrire puis relire 3 000 chemins : ${Math.round(dureeMs)} ms`).toBeLessThan(
      2_000
    )
  })

  it('une lecture ne modifie jamais le résumé gardé de l’archive', () => {
    const racine = racineJetable()
    const spool = join(racine, 'conversation-file-trace-spool')
    mkdirSync(spool, { recursive: true })
    writeFileSync(
      join(spool, 'events.archive.jsonl'),
      ligne(ecriture('conv-a', null, 'v1', '2026-11-06T08:00:00.000Z'))
    )
    // Le journal courant prolonge l'état de l'archive : conv-a et conv-b se partagent le fichier.
    writeFileSync(
      join(spool, 'events.jsonl'),
      ligne(ecriture('conv-b', 'v1', 'v2', '2026-11-06T08:01:00.000Z'))
    )
    expect(proprietairesDeP(racine)).toEqual(['conv-a', 'conv-b'])

    // Le journal courant ne touche plus `src/p.ts` : seul l'auteur de l'archive reste.
    writeFileSync(join(spool, 'events.jsonl'), '')
    expect(proprietairesDeP(racine)).toEqual(['conv-a'])
  })

  it('une archive qui change est relue', () => {
    const racine = racineJetable()
    const spool = join(racine, 'conversation-file-trace-spool')
    mkdirSync(spool, { recursive: true })
    const archive = join(spool, 'events.archive.jsonl')
    writeFileSync(archive, ligne(ecriture('conv-a', null, 'v1', '2026-11-06T08:00:00.000Z')))
    expect(proprietairesDeP(racine)).toEqual(['conv-a'])

    // Rotation : une réécriture sans base révoque conv-a.
    appendFileSync(archive, ligne(ecriture('conv-c', null, 'v3', '2026-11-06T08:02:00.000Z')))
    expect(proprietairesDeP(racine)).toEqual(['conv-c'])
  })

  it('un doublon rangé dans l’archive reste un doublon', () => {
    const racine = racineJetable()
    const spool = join(racine, 'conversation-file-trace-spool')
    mkdirSync(spool, { recursive: true })
    writeFileSync(
      join(spool, 'events.archive.jsonl'),
      ligne({ ...ecriture('conv-a', null, 'v1', '2026-11-06T08:00:00.000Z'), eventId: 'pub:1' })
    )
    expect(
      appendConversationFileTrace(
        { ...ecriture('conv-a', null, 'v1', '2026-11-06T08:05:00.000Z'), eventId: 'pub:1' },
        racine
      )
    ).toBe('duplicate')
  })
})
