import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('branchement runtime Auto-Kaizen', () => {
  const source = readFileSync(join(process.cwd(), 'src/main/index.ts'), 'utf8')

  it('observe les erreurs structurées du chat et de l’orchestration', () => {
    expect(source).toContain('incidentFromPilotEvent({')
    expect(source).toContain("e.type === 'orchestrate-step'")
    expect(source).toContain("e.type === 'orchestrate-end'")
    expect(source).toContain('reportAutoKaizen({')
  })

  it('n ouvre AUCUN incident sur un arret DELIBERE — les deux sites de signalement sont gardes', () => {
    // Rapporte par l utilisateur : couper un run auto-kaizen en declenchait un autre. Le chemin du tour
    // pilote etait deja protege par `signal.aborted` ; celui de l ORCHESTRATION ne l etait pas, un run
    // coupe finissant ROUGE et rouge valant incident. Ce test garde le CABLAGE : la memoire d arret peut
    // exister sans etre consultee, et le defaut reviendrait sans que rien ne rougisse.
    expect(source).toContain(
      'if (structuredIncident && !activeChatTurns.wasDeliberatelyStopped(conversationId))'
    )
    expect(source).toContain(
      'if (conversationId && !activeChatTurns.wasDeliberatelyStopped(conversationId))'
    )
    // Le chemin qui ne coupe QUE l orchestration doit marquer l intention lui aussi.
    expect(source).toContain('activeChatTurns.markDeliberateStop(conversationId)')
  })

  it('transforme la perte du replay et chaque diagnostic exploitable en incident', () => {
    expect(source).toContain('const recap = summarizeJournal(lignes)')
    expect(source).toContain('journal-replay-loss:')
    expect(source).toContain('for (const diagnostic of recap.diagnostics)')
    expect(source).toContain('journal-diagnostic:')
  })

  it('reprend périodiquement les transitions persistées', () => {
    expect(source).toContain("'auto-kaizen-incidents.json'")
    expect(source).toContain('autoKaizenSupervisor?.resumePending()')
    expect(source).toContain('autoKaizenResumeTimer.unref()')
  })

  it('rend le superviseur legacy activable dans un mode exclusif du Watchdog', () => {
    expect(source).toContain('legacyAutoKaizenSupervisorEnabled(process.env)')
    expect(source).toContain(
      'if (!AUTO_KAIZEN_SUPERVISOR_ENABLED) {\n    watchdogEngine = new WatchdogEngine('
    )
    expect(source).toContain(
      'if (!AUTO_KAIZEN_SUPERVISOR_ENABLED) {\n        const seeded = seedWatchdogTasks'
    )
  })

  it('crée les conversations Auto-Kaizen sans mode d’autorité', () => {
    expect(source).not.toContain('inheritAutoKaizenAuthority')
    expect(source).not.toContain('authorityMode')
  })
})
