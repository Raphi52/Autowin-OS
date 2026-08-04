import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  AutoKaizenSupervisor,
  correlationKeyForIncident,
  incidentFromPilotEvent,
  isNonActionableWall,
  type AutoKaizenLimits,
  type AutoKaizenRuntime
} from './auto-kaizen-supervisor'

/**
 * Régression de la cascade observée le 2026-08-04 : 2924 incidents en 3 h 09 (930/h pour un budget
 * de 50/h), tous issus d'UNE cause externe — le quota codex épuisé jusqu'au 8 août. Chaque échec de
 * quota créait un incident, dont le run kaizen rappelait codex, échouait sur le même quota, et
 * engendrait le suivant. Les chiffres cités ici viennent du snapshot réel conservé en
 * `auto-kaizen-incidents.FRENZY-2026-08-04.json.bak`.
 */
describe('Auto-Kaizen — la cascade du 2026-08-04 ne peut plus se reproduire', () => {
  const roots: string[] = []
  /** Ce qui est remonté à l'utilisateur : un mur neutralisé doit rester VISIBLE, pas être avalé. */
  const notifications: string[] = []
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
    notifications.length = 0
  })

  function supervisor(limits?: Partial<AutoKaizenLimits>) {
    const root = mkdtempSync(join(tmpdir(), 'autowin-frenzy-'))
    roots.push(root)
    let next = 1
    const runtime: AutoKaizenRuntime = {
      createConversation() {
        return { id: `conv-frenzy-${next++}` }
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
    return new AutoKaizenSupervisor({
      path: join(root, 'auto-kaizen-incidents.json'),
      runtime,
      limits
    })
  }

  const quotaDetail =
    'Phase kaizen — le rôle subagent est bindé sur codex (gpt-5.6-sol) : codex exec échec\n' +
    'exit-code=1\nsignal=none\n' +
    'last-event={"type":"turn.failed","error":{"message":"You\'ve hit your usage limit. ' +
    'Visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at ' +
    'Aug 8th, 2026 7:20 AM"}}'

  it('un quota externe épuisé n’est PAS un défaut réparable : aucun run kaizen ne part', () => {
    const sup = supervisor()
    const incident = sup.report({
      dedupeKey: 'orchestration-step:run-a:1',
      sourceConversationId: 'conv-100',
      kind: 'provider-error',
      summary: 'exec a échoué',
      detail: quotaDetail
    })
    // Le mur est externe (quota rétabli le 8 août) : le réparer par du code est impossible.
    expect(incident.status).toBe('suppressed')
    expect(incident.suppressionReason).toBe('non-actionable')
    // Neutralisé n'est pas étouffé : l'utilisateur doit voir passer la cause.
    expect(notifications.join('\n')).toContain('non-actionable')
  })

  it('un HTTP 429 usage_limit_reached est traité comme le même mur externe', () => {
    const sup = supervisor()
    const incident = sup.report({
      dedupeKey: 'step:run-b:1',
      sourceConversationId: 'conv-101',
      kind: 'provider-error',
      summary: 'orchestrate a échoué',
      detail:
        'codex responses HTTP 429 — {"error":{"type":"usage_limit_reached",' +
        '"message":"The usage limit has been reached","plan_type":"pro","resets_at":1786166419}}'
    })
    expect(incident.status).toBe('suppressed')
    expect(incident.suppressionReason).toBe('non-actionable')
  })

  it('une VRAIE erreur de provider reste actionnable (le garde ne noie pas le signal)', () => {
    const sup = supervisor()
    const incident = sup.report({
      dedupeKey: 'step:run-c:1',
      sourceConversationId: 'conv-102',
      kind: 'provider-error',
      summary: 'exec a échoué',
      detail: 'codex exec échec (1): TypeError: cannot read property "id" of undefined'
    })
    expect(incident.status).not.toBe('suppressed')
  })

  it('la MÊME cause dans deux conversations différentes fusionne (mesuré : 1172 incidents pour 1 cause)', () => {
    const base = {
      kind: 'orchestration-step-failed',
      summary: 'exec a échoué',
      detail: 'codex exec échec (1): TypeError: cannot read property "id" of undefined'
    }
    // Seule la conversation source diffère — c'était l'unique raison de la non-fusion.
    const a = correlationKeyForIncident({
      ...base,
      dedupeKey: 'step:run-a:1',
      sourceConversationId: 'conv-116'
    })
    const b = correlationKeyForIncident({
      ...base,
      dedupeKey: 'step:run-b:7',
      sourceConversationId: 'conv-114'
    })
    expect(a).toBe(b)

    const sup = supervisor()
    const first = sup.report({
      ...base,
      dedupeKey: 'step:run-a:1',
      sourceConversationId: 'conv-116'
    })
    const second = sup.report({
      ...base,
      dedupeKey: 'step:run-b:7',
      sourceConversationId: 'conv-114'
    })
    expect(second.id).toBe(first.id)
    expect(second.occurrenceCount).toBe(2)
  })

  it('les jetons volatils du detail ne fragmentent plus la clé (1233 singletons mesurés)', () => {
    const key = (detail: string) =>
      correlationKeyForIncident({
        dedupeKey: 'k',
        sourceConversationId: 'conv-1',
        kind: 'orchestration-error',
        summary: 'RUN en échec',
        detail
      })
    // Chemins de workspace : le slug de run et le n° de conversation varient à chaque occurrence.
    expect(
      key(
        'RUN en échec : C:\\Users\\x\\AppData\\Roaming\\autowin-os\\runs\\conv-110\\kaizen-analyse-msefqwq5-workspace\\RUN.md'
      )
    ).toBe(
      key(
        'RUN en échec : C:\\Users\\x\\AppData\\Roaming\\autowin-os\\runs\\conv-111\\kaizen-analyse-msefqyqp-workspace\\RUN.md'
      )
    )
    // Horodatages epoch et compte-à-rebours de reset.
    expect(key('reset {"resets_at":1786166419,"resets_in_seconds":312}')).toBe(
      key('reset {"resets_at":1786170000,"resets_in_seconds":41}')
    )
  })

  it('la cascade est bornée en LARGEUR, pas seulement en profondeur (8→11→104→681 mesuré)', () => {
    const sup = supervisor({ maxPerRoot: 3, maxActive: 100, maxPerHour: 100, maxDepth: 5 })
    const root = sup.report({
      dedupeKey: 'racine',
      sourceConversationId: 'conv-200',
      kind: 'orchestration-error',
      summary: 'racine',
      detail: 'échec racine unique'
    })
    const enfants = Array.from({ length: 6 }, (_, n) =>
      sup.report({
        dedupeKey: `enfant-${n}`,
        sourceConversationId: `conv-30${n}`,
        kind: 'orchestration-error',
        summary: `enfant ${n}`,
        detail: `cause distincte numero ${n} sans jeton commun ${'x'.repeat(n)}`,
        lineage: { rootIncidentId: root.id, parentIncidentId: root.id, depth: 1 }
      })
    )
    const bornes = enfants.filter((i) => i.suppressionReason === 'breadth-limit')
    expect(bornes.length).toBeGreaterThan(0)
  })

  it('un incident borné en largeur ne ressuscite PAS au redémarrage', () => {
    const sup = supervisor({ maxPerRoot: 1, maxActive: 100, maxPerHour: 100, maxDepth: 5 })
    const root = sup.report({
      dedupeKey: 'r2',
      sourceConversationId: 'conv-400',
      kind: 'orchestration-error',
      summary: 'racine 2',
      detail: 'racine deux'
    })
    const borne = sup.report({
      dedupeKey: 'e2',
      sourceConversationId: 'conv-401',
      kind: 'orchestration-error',
      summary: 'enfant borne',
      detail: 'cause enfant tout autre',
      lineage: { rootIncidentId: root.id, parentIncidentId: root.id, depth: 1 }
    })
    expect(borne.suppressionReason).toBe('breadth-limit')
    sup.resumePending()
    // resumePending ne réarme que ce qui peut légitimement repartir : sinon la frenzy repart au boot
    // (348 relances étaient armées dans le snapshot réel).
    expect(borne.status).toBe('suppressed')
  })

  it('un évènement pilote porteur du mur de quota est neutralisé, quel que soit son kind', () => {
    // Le `kind` attribué par le pilote n'est délibérément PAS contraint ici : cette zone est en cours
    // de réécriture par un autre chantier, et le garde ne doit pas dépendre de l'étiquette. Ce qui
    // compte est que le mur soit reconnu sur la PREUVE (le texte de l'erreur), puis neutralisé.
    const event = incidentFromPilotEvent({
      kind: 'result',
      name: 'exec',
      ok: false,
      data: {
        message: "You've hit your usage limit. Visit https://chatgpt.com/codex/settings/usage"
      }
    })
    expect(event).toBeDefined()
    expect(isNonActionableWall(event!.summary, event!.detail)).toBe(true)

    const sup = supervisor()
    const incident = sup.report({
      dedupeKey: 'pilote:1',
      sourceConversationId: 'conv-500',
      ...event!
    })
    expect(incident.status).toBe('suppressed')
    expect(incident.suppressionReason).toBe('non-actionable')
  })
})
