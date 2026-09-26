import { mkdtempSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { TraceStore } from './trace-store'
import type { TraceEventV1 } from './trace-event'

/**
 * LE PREMIER ÉVÉNEMENT D'UNE CONVERSATION NE DOIT PAS RELIRE TOUTE SA TRACE.
 *
 * Défaut mesuré le 2026-09-12 : `warmSequenceCursor` faisait un `readFileSync` sur le fichier
 * ENTIER — 18 Mo pour conv-439 — juste pour retrouver le dernier numéro d'événement. Sur le fil qui
 * dessine l'interface, cela a coûté 3,2 s à l'ouverture d'une trace.
 *
 * La borne figée ici : la mise en route ne lit que la QUEUE du fichier. Un retour au `readFileSync`
 * complet fait échouer le premier test — c'est ce qui garde le correctif.
 */
function event(sequence: number, content = 'x'.repeat(2_000)): TraceEventV1 {
  return {
    schema: 'autowin.trace/v1',
    id: `evt-${sequence}`,
    conversationId: 'conv-1',
    turnId: 'turn-1',
    parentId: sequence ? `evt-${sequence - 1}` : undefined,
    timestamp: new Date(1_000 + sequence).toISOString(),
    sequence,
    type: 'message',
    status: 'completed',
    actor: { id: 'human', kind: 'human', label: 'Vous' },
    recipient: { id: 'autowin', kind: 'system', label: 'Autowin OS' },
    channel: 'user',
    payloads: [{ kind: 'user-message', content }],
    observation: { boundary: 'renderer', fidelity: 'exact' }
  }
}

/** Fenêtre de queue du module : la borne doit rester du même ordre, pas du volume du fichier. */
const FENETRE_OCTETS = 64 * 1024

describe('TraceStore — mise en route bornée à la queue du fichier', () => {
  it('lit la QUEUE, pas le fichier entier, et rend quand même le bon numéro', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-trace-borne-'))
    const writer = new TraceStore(root)
    // ~1,5 Mo : plus de 20 fois la fenêtre. Avant le correctif, tout était relu.
    for (let index = 0; index < 700; index += 1) writer.append(event(index))
    const tailleFichier = statSync(join(root, 'conv-1.jsonl')).size
    expect(tailleFichier).toBeGreaterThan(1_000_000)

    const reader = new TraceStore(root)
    expect(reader.nextSequence('conv-1')).toBe(700)

    // LA BORNE : ce qui est lu ne dépend plus de la taille du fichier.
    expect(reader.sequenceScanBytes).toBeLessThanOrEqual(FENETRE_OCTETS)
    expect(reader.sequenceScanBytes).toBeLessThan(tailleFichier / 10)
  })

  it('élargit la fenêtre plutôt que de rendre un numéro faux sur un événement géant', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-trace-borne-geant-'))
    // Fichier écrit À LA MAIN, sans passer par un `TraceStore` : aucun compteur de séquence à côté,
    // aucune valeur gardée en mémoire. Le numéro rendu ne peut venir QUE de la lecture du fichier —
    // sinon ce test se contenterait de relire un raccourci et ne prouverait rien.
    writeFileSync(
      join(root, 'conv-1.jsonl'),
      `${JSON.stringify(event(0))}
${JSON.stringify(event(1, 'y'.repeat(400_000)))}
`,
      'utf8'
    )

    const reader = new TraceStore(root)
    // Le numéro reste JUSTE — cette règle prime sur l'économie de lecture.
    expect(reader.nextSequence('conv-1')).toBe(2)
    expect(reader.sequenceScanBytes).toBeGreaterThan(FENETRE_OCTETS)
  })

  it('retrouve le dernier numéro d’une grosse trace SANS compteur à côté', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-trace-borne-nu-'))
    // Même précaution : le fichier est la SEULE source de vérité disponible.
    const lignes: string[] = []
    for (let index = 0; index < 700; index += 1) lignes.push(JSON.stringify(event(index)))
    writeFileSync(join(root, 'conv-1.jsonl'), `${lignes.join('\n')}\n`, 'utf8')
    const tailleFichier = statSync(join(root, 'conv-1.jsonl')).size

    const reader = new TraceStore(root)
    expect(reader.nextSequence('conv-1')).toBe(700)
    expect(reader.sequenceScanBytes).toBeLessThanOrEqual(FENETRE_OCTETS)
    expect(tailleFichier).toBeGreaterThan(1_000_000)
  })

  it('reste incrémental après la mise en route : le décalage garde son sens', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-trace-borne-incr-'))
    const writer = new TraceStore(root)
    for (let index = 0; index < 400; index += 1) writer.append(event(index))

    const reader = new TraceStore(root)
    expect(reader.nextSequence('conv-1')).toBe(400)
    const apresMiseEnRoute = reader.sequenceScanBytes

    // Un append EXTERNE : seule la nouvelle ligne doit être scannée, pas la queue entière.
    writer.append(event(400))
    expect(reader.nextSequence('conv-1')).toBe(401)
    expect(reader.sequenceScanBytes - apresMiseEnRoute).toBeLessThan(4_000)
  })
})
