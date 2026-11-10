import { describe, expect, it, vi } from 'vitest'
import { AgentPilot } from './agent-pilot'
import type { PromptSnapshot } from '../commands/commands'
import {
  arretAuControleRelancable,
  CONSIGNE_RELANCE_APRES_ARRET
} from '../../shared/orchestration-outcome'

/**
 * APRÈS UN ARRÊT AU CONTRÔLE FINAL, LE CHAT LIT LA CAUSE ET RELANCE LUI-MÊME, UNE FOIS.
 *
 * Cas réel (10/11/2026, run judge-panda-as-fait-lancer-commande-mwasivzu) : le run s'arrête au
 * contrôle final, le chat reçoit « aucune autre orchestration ne sera acceptée dans ce tour » et le
 * tour finit sur « 👉 Recommandé : reprendre le travail arrêté ». L'utilisateur devait relancer à la
 * main, à chaque arrêt. L'issue ci-dessous est celle de ce run, motifs mot pour mot.
 */
const ARRET_REEL = {
  status: 'failed',
  valid: false,
  gateBlocked: true,
  reused: false,
  runPath: 'C:/runs/fil/RUN.md',
  result: '',
  gateReasons: [
    "Échec déjà déclaré : ce travail s'est lui-même terminé en échec, ce contrôle ne fait que le relayer.",
    'Promis mais pas fait : « Mutation demandee produite avec une preuve executable ».',
    'hook done-without-proof: aucune preuve d’exécution ok — green refusé'
  ]
}

const LIVRE = {
  status: 'succeeded',
  valid: true,
  gateBlocked: false,
  reused: false,
  runPath: 'C:/runs/fil/RUN-2.md',
  result: 'Verdict rendu.'
}

const BLOCAGE_D_INTEGRATION = {
  ...ARRET_REEL,
  gateReasons: [
    'intégration locale non terminée',
    'blocage d’intégration: base-dirty — cause: des fichiers non committés'
  ]
}

const snapshotForPrompt = async (): Promise<PromptSnapshot> => ({
  tab: 'chat',
  providers: [],
  runsBlocked: [],
  conversationsCount: 0
})

const ORCHESTRATE = (tache: string): string =>
  `<cmd>{"name":"orchestrate","args":{"task":"${tache}"}}</cmd>`

const DEMANDE_NOMMEE = "judge le panda que t'as fait"
const DEMANDE_LIBRE = 'range les copies de travail sous une racine unique'

function pilote(demande: string, issues: unknown[], reponses: string[]) {
  const recus: string[] = []
  const finales: string[] = []
  const send = vi.fn(async (...envoi: unknown[]) => {
    // Tout ce qui part au modèle, quelle que soit la forme de l'appel.
    recus.push(JSON.stringify(envoi))
    return { text: reponses.shift() ?? '', provider: 'codex' }
  })
  const registry = {
    send,
    describePrompt: () => ({
      provider: 'codex',
      transport: 'fixture',
      messages: [],
      options: {},
      limitation: 'test'
    })
  }
  const exec = vi.fn(async (nom: string) => {
    void nom
    return { ok: true, data: issues.shift() ?? LIVRE }
  })
  const bus = {
    catalog: () => [{ name: 'orchestrate', args: {}, description: 'workflow complet' }],
    snapshotForPrompt,
    exec
  }
  return {
    recus,
    finales,
    lancements: () => exec.mock.calls.filter((call) => call[0] === 'orchestrate').length,
    run: () =>
      new AgentPilot(
        registry as never,
        { getBinding: () => ({ provider: 'codex', model: 'gpt-test' }) } as never,
        bus as never
        // maxIter fini : le harnais est borné, pas le produit.
      ).chat(
        [{ role: 'user', content: demande }],
        (e: { kind: string; text?: string }) => {
          if (e.kind === 'done') finales.push(e.text ?? '')
        },
        undefined,
        6
      )
  }
}

describe('phase nommée (lancée sans le modèle) arrêtée au contrôle final', () => {
  it('rejoue le cas réel : le tour ne se clôt pas, le chat lit la cause et relance', async () => {
    const p = pilote(
      DEMANDE_NOMMEE,
      [ARRET_REEL, LIVRE],
      [ORCHESTRATE('relis le panda, sans rien modifier'), 'Verdict rendu.']
    )
    await p.run()
    expect(p.lancements()).toBe(2)
    // Le modèle, jamais appelé avant, reçoit la cause et l'ordre de relancer.
    expect(p.recus[0] ?? '').toContain('Mutation demandee produite avec une preuve executable')
    expect(p.recus[0] ?? '').toContain(CONSIGNE_RELANCE_APRES_ARRET)
    // Une seule clôture, et ce n'est plus le texte tout fait de l'arrêt.
    expect(p.finales).toHaveLength(1)
    expect(p.finales[0]).not.toContain('reprendre le travail arrêté')
  })

  it('une seule relance : un second arrêt clôt le tour, sans troisième run', async () => {
    const p = pilote(
      DEMANDE_NOMMEE,
      [ARRET_REEL, ARRET_REEL, LIVRE],
      [ORCHESTRATE('b'), ORCHESTRATE('c'), 'Arrêté deux fois, cause nommée.']
    )
    await p.run()
    expect(p.lancements()).toBe(2)
  })

  it('contrôle négatif : un travail livré clôt le tour sans appeler le modèle', async () => {
    const p = pilote(DEMANDE_NOMMEE, [LIVRE], ['ne doit pas être appelé'])
    await p.run()
    expect(p.lancements()).toBe(1)
    expect(p.recus).toHaveLength(0)
  })

  it('contrôle négatif : un blocage d’intégration garde la clôture d’avant', async () => {
    const p = pilote(DEMANDE_NOMMEE, [BLOCAGE_D_INTEGRATION], ['ne doit pas être appelé'])
    await p.run()
    expect(p.lancements()).toBe(1)
    expect(p.recus).toHaveLength(0)
  })
})

describe('travail lancé par le modèle du chat, arrêté au contrôle final', () => {
  it('le chat reçoit la cause et relance une tâche corrigée', async () => {
    const p = pilote(
      DEMANDE_LIBRE,
      [ARRET_REEL, LIVRE],
      [
        ORCHESTRATE('range les copies'),
        ORCHESTRATE('range les copies, avec le test demandé'),
        'Livré.'
      ]
    )
    await p.run()
    expect(p.lancements()).toBe(2)
    const apresLArret = p.recus[1] ?? ''
    expect(apresLArret).toContain(CONSIGNE_RELANCE_APRES_ARRET)
    expect(apresLArret).not.toContain('aucune autre orchestration ne sera acceptée')
  })

  it('une seule relance : le second arrêt remet le verrou', async () => {
    const p = pilote(
      DEMANDE_LIBRE,
      [ARRET_REEL, ARRET_REEL, LIVRE],
      [ORCHESTRATE('a'), ORCHESTRATE('b'), ORCHESTRATE('c'), 'Arrêté deux fois, cause nommée.']
    )
    await p.run()
    expect(p.lancements()).toBe(2)
    expect(p.recus[2] ?? '').toContain('aucune autre orchestration ne sera acceptée')
  })

  it('contrôle négatif : un blocage d’intégration ne rend pas de relance', async () => {
    const p = pilote(
      DEMANDE_LIBRE,
      [BLOCAGE_D_INTEGRATION, LIVRE],
      [ORCHESTRATE('a'), ORCHESTRATE('b'), 'En attente d’intégration.']
    )
    await p.run()
    expect(p.lancements()).toBe(1)
  })

  it('la règle pure : arrêt du contrôle oui ; travail livré ou blocage d’intégration non', () => {
    expect(arretAuControleRelancable(ARRET_REEL)).toBe(true)
    expect(arretAuControleRelancable(LIVRE)).toBe(false)
    expect(arretAuControleRelancable(BLOCAGE_D_INTEGRATION)).toBe(false)
  })
})
