import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { CostAggregator } from './dashboards/cost'
import { reservesMineuresDuScout, resultatAvecReservesDuJuge } from './objections-juge'
import { Orchestrator } from './orchestrator'
import { ProviderRegistry } from './providers/registry'
import type { Message, ProviderAdapter, SendOptions, SendResult, StreamChunk } from './providers/types'
import { RoleModelConfig } from './roles'
import { TrustLedger } from './trust/ledger'
import { makeTestWorktrees } from './orchestrator.test-helpers'

/**
 * CAS RÉEL conv-976, tour a0d81c84 (2026-10-15, run `scout-nouvelles-ameliorations-induites-mv9ia9nw`).
 *
 * Un `/scout` nommé a payé 7 juges et 6 nouveaux passages de scout (23 min, ~8,8 $). Seul le 1er
 * verdict portait un MAJEUR ; les verdicts 2 à 6 ne portaient QUE des MINEUR (« 10 fichiers » au
 * lieu de 22, « cinq vérifications » au lieu de six…) et ont chacun relancé scout + juge (~5,6 $).
 * Décision utilisateur (conv-977) : sur un `/scout` nommé, des MINEUR seuls deviennent des RÉSERVES
 * ajoutées au résultat ; un MAJEUR bloque toujours, et le build garde le blocage sur MINEUR.
 *
 * Les verdicts ci-dessous sont des extraits des verdicts RÉELS (`causal-trace/conv-976.jsonl`).
 */
const VERDICT_1_MAJEUR = `DEFAUT: la piste 5 est mal justifiée, et le texte qu'envoie le même bouton, qui demande encore « terrain », a été oublié

SCORE: 70

OBJECTIONS:
- MAJEUR: la piste 5 est réfutée. Elle affirme que l'infobulle « cadrage → terrain → build… » est fausse « depuis que le Chantier fait frame → build ». Or \`src/renderer/src/components/veille-candidats-message.ts:158-163\` dit l'inverse.
- MINEUR: un fichier a été oublié. Le texte envoyé par ce même bouton, à \`veille-candidats-message.ts:191-192\`, demande encore « le PIPELINE complet — cadrage, terrain, build, nettoyage, jugement ».
- OK: la piste 1 tient. J'ai lu \`pipeline-discipline.ts:17\` : « 3. TERRAIN — écris un SOP spécifique… ».
- OK: la tâche ne désigne aucun fichier précis à modifier. C'est une recherche de pistes en lecture seule.`

const RESERVE_10_FICHIERS =
  'dans la note « Corrections faites », la phrase « 10 fichiers sont modifiés » est fausse. `git status --short | wc -l` donne 22.'

const VERDICT_2_MINEUR_SEUL = `DEFAUT: une correction annoncée remplace une erreur par une autre. Le résultat dit « 10 fichiers sont modifiés », alors qu'il y en a 22.

SCORE: 88

OBJECTIONS:
- OK: l'ancienne objection sur la piste 5 est corrigée. C'est ce que confirme \`veille-candidats-message.ts:158-163\`.
- OK: l'ancienne objection sur le fichier oublié est corrigée. \`veille-candidats-message.ts\` figure dans la piste 1.
- MINEUR: ${RESERVE_10_FICHIERS}
- OK: piste 1 tenue. \`task-regime.ts:29\` contient bien \`critical: ['scout','frame','terrain','build','clean']\`.`

/** Les verdicts 3 à 6 du cas réel : encore des MINEUR seuls, que l'ancien code payait un par un. */
const VERDICT_3_MINEUR_SEUL = `DEFAUT: une piste importante manque — après un \`/frame\`, l'app recommande encore « lancer terrain »

SCORE: 74

OBJECTIONS:
- MINEUR: une piste forte manque. \`src/shared/portee-de-phase.ts:51-58\` calcule « ce qui reste à faire » à partir de l'ordre de \`PIPELINE_PHASES\`.
- OK: pistes 1 à 3 tenues.`

const VERDICT_FINAL_VALIDE = 'VALIDE\n\nSCORE: 90\n\nOBJECTIONS:\n- OK: l’objection précédente est corrigée.'

const RACINE_SANS_BUNDLE = mkdtempSync(`${tmpdir()}/autowin-scout-reserves-`)
let cwdSpy: ReturnType<typeof vi.spyOn>
const bornePrecedente = process.env.AUTOWIN_REPARATION_BORNEE
beforeAll(() => {
  // La mesure de code périmé reste active : on lui donne une racine vide (même précaution que
  // orchestrator.memoire-juge.test.ts), sinon elle coupe la boucle avant toute réparation.
  cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(RACINE_SANS_BUNDLE)
  // Le VRAI mode de production (conv-844) : « jusqu'au vert », sans plafond — celui de conv-976.
  delete process.env.AUTOWIN_REPARATION_BORNEE
})
afterAll(() => {
  cwdSpy.mockRestore()
  if (bornePrecedente === undefined) delete process.env.AUTOWIN_REPARATION_BORNEE
  else process.env.AUTOWIN_REPARATION_BORNEE = bornePrecedente
})

/** Rend les verdicts dans l'ordre donné (le dernier se répète), et une sortie de phase ailleurs. */
class JugeSequenceProvider implements ProviderAdapter {
  readonly id = 'sequence'
  readonly supportsExecution = true
  readonly verdictsRendus: string[] = []
  readonly phasesJouees: string[] = []
  constructor(private readonly verdicts: string[]) {}

  async auth(): Promise<boolean> {
    return true
  }

  // eslint-disable-next-line require-yield
  async *send(messages: Message[], options: SendOptions = {}): AsyncGenerator<StreamChunk, SendResult, void> {
    const systemInjected = Boolean(options.system)
    const usage = { inputTokens: 4, outputTokens: 2, costUsd: 0.001 }
    if ((options.model ?? '').startsWith('juge')) {
      // Frein de test : l'ancien code paierait les 7 juges du cas réel ; on échoue vite au-delà.
      if (this.verdictsRendus.length >= 8) throw new Error('boucle juge-réparation non arrêtée')
      const text = this.verdicts[Math.min(this.verdictsRendus.length, this.verdicts.length - 1)]
      this.verdictsRendus.push(text)
      return { text, provider: this.id, usage, systemInjected }
    }
    const contenu = `${options.system ?? ''}\n${messages.map((m) => String(m.content ?? '')).join('\n')}`
    if (/phase SCOUT/u.test(contenu)) {
      this.phasesJouees.push('scout')
      return {
        text:
          '## Cible\nSuites du retrait de terrain\n\n| Score | Type | What | Why | How |\n|---|---|---|---|---|\n' +
          '| 1 | 82 | 🔧 fix | task-regime garde terrain | le mode critique le rejoue | task-regime.ts:29 |',
        provider: this.id,
        usage,
        systemInjected
      }
    }
    this.phasesJouees.push('autre')
    return {
      text: 'travail fait',
      provider: this.id,
      usage,
      systemInjected,
      executionEvidence: [
        { type: 'file_change', kind: 'mutation', status: 'completed', ok: true, summary: 'mutation simulée' },
        { type: 'command_execution', kind: 'verification', status: 'completed', ok: true, summary: 'tests simulés' }
      ]
    }
  }
}

function orchestrateur(provider: JugeSequenceProvider, phases: Array<'scout' | 'build'>): Orchestrator {
  return new Orchestrator({
    registry: new ProviderRegistry().register(provider),
    roles: new RoleModelConfig({
      orchestrator: { provider: provider.id, model: 'orch' },
      subagent: { provider: provider.id, model: 'ouvrier' },
      judge: { provider: provider.id, model: 'juge-1' }
    }),
    cost: new CostAggregator(),
    trust: new TrustLedger(),
    executionWorkspace: 'C:\\ws',
    worktrees: makeTestWorktrees('C:\\ws'),
    classifyPhases: () => phases
  })
}

describe('conv-976 : un /scout nommé garde les MINEUR seuls comme réserves au lieu de relancer scout + juge', () => {
  it('rejoue le cas réel : MAJEUR → une réparation ; MINEUR seuls → clôture avec réserves, 2 juges au lieu de 7', async () => {
    const provider = new JugeSequenceProvider([
      VERDICT_1_MAJEUR,
      VERDICT_2_MINEUR_SEUL,
      VERDICT_3_MINEUR_SEUL,
      VERDICT_3_MINEUR_SEUL,
      VERDICT_3_MINEUR_SEUL,
      VERDICT_3_MINEUR_SEUL,
      VERDICT_FINAL_VALIDE
    ])
    const resultat = await orchestrateur(provider, ['scout']).run(
      '/scout des nouvelles améliorations induites de ce changement'
    )

    // Le MAJEUR du 1er juge bloque toujours : UNE réparation, rejouée en scout.
    expect(provider.verdictsRendus).toEqual([VERDICT_1_MAJEUR, VERDICT_2_MINEUR_SEUL])
    expect(resultat.phaseOutputs.filter((p) => p.phase === 'scout')).toHaveLength(2)
    expect(resultat.phaseOutputs.map((p) => p.phase)).not.toContain('build')
    // Le 2e verdict ne porte que des MINEUR : la clôture passe, sans 3e passage.
    expect(resultat.valid).toBe(true)
    expect(resultat.gateBlocked).toBe(false)
    expect(resultat.trace.filter((s) => /^Réparation \d/u.test(s.detail ?? ''))).toHaveLength(1)
    // La réserve n'est pas perdue : elle est AJOUTÉE au résultat rendu à l'utilisateur.
    expect(resultat.result).toContain('Réserves du juge')
    expect(resultat.result).toContain('« 10 fichiers sont modifiés » est fausse')
    // Le MINEUR du verdict 1 a été traité par la réparation : il ne revient pas en réserve.
    expect(resultat.result).not.toContain('un fichier a été oublié')
    // Les puces OK ne sont pas des réserves.
    expect(resultat.result).not.toContain('piste 1 tenue')
    // La trace dit pourquoi la boucle s'est arrêtée là.
    expect(resultat.trace.some((s) => /réserves? mineures? du juge gardées? dans le résultat/iu.test(s.detail ?? ''))).toBe(true)
  })

  it('le build garde le blocage : un MINEUR seul relance une réparation', async () => {
    const provider = new JugeSequenceProvider([VERDICT_2_MINEUR_SEUL, VERDICT_FINAL_VALIDE])
    const resultat = await orchestrateur(provider, ['build']).run('/build corrige le compte de fichiers modifiés')

    expect(provider.verdictsRendus).toEqual([VERDICT_2_MINEUR_SEUL, VERDICT_FINAL_VALIDE])
    expect(resultat.trace.filter((s) => /^Réparation \d/u.test(s.detail ?? ''))).toHaveLength(1)
    expect(resultat.result).not.toContain('Réserves du juge')
  })
})

describe('reservesMineuresDuScout — la règle pure', () => {
  it('rend les MINEUR d’un /scout nommé quand aucune objection n’est MAJEUR', () => {
    expect(reservesMineuresDuScout('scout', VERDICT_2_MINEUR_SEUL)).toEqual([RESERVE_10_FICHIERS])
  })

  it('un MAJEUR présent bloque : aucune réserve, la réparation part', () => {
    expect(reservesMineuresDuScout('scout', VERDICT_1_MAJEUR)).toEqual([])
  })

  it('hors /scout nommé (build, aucune phase nommée) : aucune réserve', () => {
    expect(reservesMineuresDuScout('build', VERDICT_2_MINEUR_SEUL)).toEqual([])
    expect(reservesMineuresDuScout(undefined, VERDICT_2_MINEUR_SEUL)).toEqual([])
  })

  it('un refus sans objection étiquetée MINEUR reste un refus', () => {
    // DEFAUT sans section OBJECTIONS : rien ne dit que le défaut est mineur.
    expect(reservesMineuresDuScout('scout', 'DEFAUT: liste non vérifiée\n\nSCORE: 35')).toEqual([])
    // Puce NON étiquetée : elle compte comme MAJEUR (règle existante), donc pas de réserve.
    expect(reservesMineuresDuScout('scout', 'DEFAUT: x\n\nOBJECTIONS:\n- la piste 2 cite un fichier absent')).toEqual([])
    // MINEUR + puce nue : la puce nue bloque, la règle ne relâche rien.
    expect(
      reservesMineuresDuScout('scout', 'DEFAUT: x\n\nOBJECTIONS:\n- MINEUR: un compte faux\n- une citation inventée')
    ).toEqual([])
  })

  it('un VALIDE qui porte des MINEUR sur un /scout les rend aussi en réserves', () => {
    expect(reservesMineuresDuScout('scout', 'VALIDE\n\nSCORE: 86\n\nOBJECTIONS:\n- MINEUR: compte faux\n- OK: le reste tient')).toEqual([
      'compte faux'
    ])
  })

  it('le résultat porte les réserves en section dédiée, et reste intact sans réserve', () => {
    expect(resultatAvecReservesDuJuge('liste', [])).toBe('liste')
    const texte = resultatAvecReservesDuJuge('liste', ['compte faux', 'piste manquante'])
    expect(texte.startsWith('liste\n\n')).toBe(true)
    expect(texte).toMatch(/Réserves du juge/u)
    expect(texte).toContain('- compte faux')
    expect(texte).toContain('- piste manquante')
  })
})
