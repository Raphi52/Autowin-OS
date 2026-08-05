import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  AutoKaizenSupervisor,
  type AutoKaizenLimits,
  type AutoKaizenRuntime
} from './auto-kaizen-supervisor'

/**
 * Un incident ACTIF n'avait aucune horloge de garde. Mesuré le 2026-08-05 sur l'état vivant :
 * 3 incidents en `fix-running`, dont la racine `ak-3efcb695ece3f71a` depuis 2,2 h, aucun chemin de code
 * ne les faisant sortir de cet état après un crash ou une fermeture de l'app.
 *
 * Deux conséquences, et la seconde est la plus grave :
 *   (a) l'incident reste actif pour toujours ;
 *   (b) `fix-running` comptant dans ACTIVE_STATUSES, chaque incident bloqué confisque une part du
 *       budget `maxActive` — 10 bloqués gèlent tout le système par `active-limit`, en silence.
 */
describe('Auto-Kaizen — horloge de garde sur un incident actif', () => {
  const roots: string[] = []
  const notifications: string[] = []
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
    notifications.length = 0
  })

  const MINUTE = 60_000

  /**
   * Fabrique un superviseur dont l'horloge est PILOTÉE par le test (pas de sommeil réel), et dont
   * l'état de départ est écrit sur disque — c'est le scénario réel : l'app redémarre et relit un
   * snapshot où des incidents étaient actifs au moment du crash.
   */
  function supervisor(options: {
    incidents?: Array<Record<string, unknown>>
    now: () => number
    limits?: Partial<AutoKaizenLimits>
  }) {
    const root = mkdtempSync(join(tmpdir(), 'autowin-watchdog-'))
    roots.push(root)
    const path = join(root, 'auto-kaizen-incidents.json')
    if (options.incidents) {
      writeFileSync(
        path,
        JSON.stringify({ schemaVersion: 1, incidents: options.incidents }, null, 2),
        'utf8'
      )
    }
    let next = 1
    const conversations: string[] = []
    const runtime: AutoKaizenRuntime = {
      createConversation() {
        const id = `conv-wd-${next++}`
        conversations.push(id)
        return { id }
      },
      appendSourceUpdate(_conversationId, text) {
        notifications.push(text)
      },
      async runAnalysis(conversationId) {
        return { ok: true, turnId: `${conversationId}:a`, text: 'cause' }
      },
      async runFix(conversationId) {
        return {
          ok: true,
          turnId: `${conversationId}:f`,
          text: 'ok',
          verification: { complete: true, evidence: 'vert' }
        }
      }
    }
    const sup = new AutoKaizenSupervisor({
      path,
      runtime,
      now: options.now,
      limits: options.limits
    })
    return { sup, path, conversations }
  }

  /** Un incident tel qu'il est persisté, figé dans un statut actif. */
  function incidentActif(id: string, updatedAt: number, status = 'fix-running') {
    return {
      id,
      dedupeKey: id,
      correlationKey: `akc-${id}`,
      eventKeys: [id],
      rootIncidentId: id,
      depth: 0,
      sourceConversationId: 'conv-source',
      kind: 'orchestration-error',
      summary: `incident ${id}`,
      detail: `detail propre a ${id}`,
      status,
      occurrenceCount: 1,
      severity: 'warning',
      lastSeenAt: updatedAt,
      detectedAt: updatedAt,
      updatedAt
    }
  }

  it('un incident actif sans progression depuis trop longtemps est clos, pas relancé', () => {
    const maintenant = 10_000_000
    const { sup, path, conversations } = supervisor({
      incidents: [incidentActif('ak-bloque', maintenant - 180 * MINUTE)],
      now: () => maintenant
    })

    sup.resumePending()

    const persiste = JSON.parse(readFileSync(path, 'utf8')).incidents
    const bloque = persiste.find((i: { id: string }) => i.id === 'ak-bloque')
    // Terminal : ni actif, ni ressuscitable au prochain démarrage.
    expect(bloque.status).toBe('failed')
    expect(String(bloque.error ?? '')).toMatch(/garde|progression/i)
    // Et surtout : PAS relancé. C'était le comportement d'avant — resumePending le re-processait.
    expect(conversations).toHaveLength(0)
  })

  it('un incident actif RÉCENT est repris normalement, pas fauché par la garde', () => {
    const maintenant = 10_000_000
    const { sup, path } = supervisor({
      incidents: [incidentActif('ak-frais', maintenant - 2 * MINUTE)],
      now: () => maintenant
    })

    sup.resumePending()

    const frais = JSON.parse(readFileSync(path, 'utf8')).incidents.find(
      (i: { id: string }) => i.id === 'ak-frais'
    )
    // Qu'un incident actif récent soit REPRIS au redémarrage est le but même de resumePending —
    // ce n'est pas un défaut. Ce que la garde ne doit jamais faire, c'est le déclarer abandonné.
    expect(frais.status).not.toBe('failed')
    expect(String(frais.error ?? '')).not.toMatch(/garde/i)
  })

  it('le blocage progressif du budget est levé : 10 incidents figés ne gèlent plus le système', () => {
    const maintenant = 10_000_000
    // maxActive = 10 par défaut. Dix incidents figés confisquaient TOUT le budget, définitivement.
    const figes = Array.from({ length: 10 }, (_, n) =>
      incidentActif(`ak-fige-${n}`, maintenant - 180 * MINUTE)
    )
    const { sup } = supervisor({ incidents: figes, now: () => maintenant })

    sup.resumePending()

    // Une demande neuve, légitime, doit pouvoir passer.
    const neuf = sup.report({
      dedupeKey: 'demande-neuve',
      sourceConversationId: 'conv-neuf',
      kind: 'orchestration-error',
      summary: 'une demande neuve arrive',
      detail: 'cause entierement distincte des dix figees'
    })
    expect(neuf.suppressionReason).not.toBe('active-limit')
    expect(neuf.status).not.toBe('suppressed')
  })

  it('un incident réellement en cours DANS ce processus n’est jamais fauché, même vieux', async () => {
    let horloge = 10_000_000
    const { sup } = supervisor({ now: () => horloge })
    // Un incident lancé pour de vrai : sa promesse est en vol, le superviseur le sait.
    const enCours = sup.report({
      dedupeKey: 'en-cours',
      sourceConversationId: 'conv-vivant',
      kind: 'orchestration-error',
      summary: 'travail vivant',
      detail: 'une cause bien a elle'
    })
    // Le temps passe largement au-delà du seuil pendant que le travail tourne.
    horloge += 300 * MINUTE
    sup.resumePending()
    expect(enCours.status).not.toBe('failed')
    await sup.drain()
  })
})
