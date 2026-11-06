import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildBehaviourComposition, type InfluencerField } from './behaviour-composition'
import { RoleModelConfig } from '../profil/roles'
import { CONSTITUTION } from '../consignes/constitution'

const build = (budgetUsd: number | null = null): ReturnType<typeof buildBehaviourComposition> =>
  buildBehaviourComposition(new RoleModelConfig(), {}, undefined, budgetUsd)

const allFields = (c: ReturnType<typeof buildBehaviourComposition>): InfluencerField[] => [
  ...c.cockpit.systemPrompt,
  ...c.cockpit.retrievedContext,
  ...c.cockpit.turnContext,
  ...c.cockpit.modelSelection,
  ...c.orchestrated.systemPrompt.flatMap((p) => p.blocks),
  ...c.orchestrated.injectedContext,
  ...c.orchestrated.modelSelection,
  ...c.orchestrated.topology,
  ...c.orchestrated.regime,
  ...c.orchestrated.guardrails,
  ...c.direct.systemPrompt,
  ...c.direct.modelSelection
]

/**
 * La ligne qui DÉCLARE le symbole cité par `fichier.ts#nom` (fonction, constante, classe, ou
 * fonction nommée locale) ou `fichier.ts#Classe.methode`, vide s'il n'est pas déclaré là.
 *
 * Une méthode ne compte qu'indentée d'un cran sous sa classe : un simple appel `resolve(...)` dans
 * le corps d'une autre méthode ne doit pas passer pour la déclaration.
 */
const declarationCitee = (source: string): string => {
  const [, fichier, symbole] =
    /^(src\/[\w./-]+\.tsx?)#([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?)$/u.exec(source) ?? []
  if (!fichier || !symbole) return ''
  const lignes = readFileSync(new URL(`../../../${fichier}`, import.meta.url), 'utf8').split(
    /\r?\n/u
  )
  const [premier, membre] = symbole.split('.')
  const motifs = membre
    ? [
        new RegExp(`^(?:export\\s+)?(?:abstract\\s+)?class\\s+${premier}\\b`, 'u'),
        new RegExp(
          `^ {2}(?:(?:private|public|protected|static|async|readonly|override)\\s+)*${membre}\\s*[(<]`,
          'u'
        )
      ]
    : [
        new RegExp(
          `^(?:export\\s+)?(?:(?:async\\s+)?function\\*?\\s+${premier}\\s*[(<]|(?:const|let)\\s+${premier}\\s*[=:]|(?:abstract\\s+)?class\\s+${premier}\\b)|^\\s+(?:const|let)\\s+${premier}\\s*=\\s*(?:async\\s*)?\\(`,
          'u'
        )
      ]
  let depart = 0
  for (const motif of motifs) {
    const trouvee = lignes.findIndex((ligne, n) => n >= depart && motif.test(ligne))
    if (trouvee < 0) return ''
    depart = trouvee + 1
  }
  return lignes[depart - 1] ?? ''
}

describe('buildBehaviourComposition — COMPLÉTUDE', () => {
  it('couvre les 7 phases orchestrées, chacune avec ≥1 bloc de system prompt', () => {
    const c = build()
    const phases = c.orchestrated.systemPrompt.map((p) => p.phase)
    expect(phases).toEqual(['scout', 'frame', 'terrain', 'build', 'clean', 'judge', 'kaizen'])
    for (const p of c.orchestrated.systemPrompt) expect(p.blocks.length).toBeGreaterThan(0)
  })

  it('peuple chaque catégorie A-E (aucune vide)', () => {
    const c = build()
    expect(c.orchestrated.injectedContext.length).toBeGreaterThan(0) // B
    expect(c.orchestrated.modelSelection.length).toBeGreaterThan(0) // C
    expect(c.orchestrated.topology.length).toBeGreaterThan(0) // C2
    expect(c.orchestrated.regime.length).toBeGreaterThan(0) // D
    expect(c.orchestrated.guardrails.length).toBeGreaterThan(0) // E
    expect(c.direct.systemPrompt.length).toBeGreaterThan(0)
  })

  it('trace CHAQUE influenceur à un symbole déclaré dans le fichier cité', () => {
    for (const f of allFields(build())) {
      expect(f.source, `champ "${f.label}" : source sans fichier#nom`).toMatch(/\.ts#[\w$.]+$/u)
      expect(
        declarationCitee(f.source),
        `champ "${f.label}" : ${f.source} n'est déclaré nulle part`
      ).not.toBe('')
      expect(f.label.length).toBeGreaterThan(0)
      expect(f.value.length).toBeGreaterThan(0)
    }
  })

  it('refuse un nom absent, un ancien fichier:ligne, et un appel pris pour une méthode', () => {
    expect(declarationCitee('src/main/juge/agregat-juge.ts#agregerPhasesPourLeJuge')).toMatch(
      /export function agregerPhasesPourLeJuge\(/u
    )
    expect(declarationCitee('src/main/juge/agregat-juge.ts#fonctionQuiNExistePas')).toBe('')
    expect(declarationCitee('src/main/juge/agregat-juge.ts:113')).toBe('')
    // `executerLesCommandes` est APPELÉE dans AgentPilot.chat, mais déclarée ailleurs.
    expect(
      declarationCitee('src/main/agent-pilot/agent-pilot.ts#AgentPilot.executerLesCommandes')
    ).toBe('')
  })

  it('reflète les influenceurs clés : Brain, redirection exécution, régime, circuit-breaker, constitution', () => {
    const labels = allFields(build()).map((f) => f.label.toLowerCase())
    expect(labels.some((l) => l.includes('brain'))).toBe(true)
    expect(labels.some((l) => l.includes('redirection'))).toBe(true)
    expect(labels.some((l) => l.includes('régime') || l.includes('regime'))).toBe(true)
    expect(labels.some((l) => l.includes('circuit-breaker'))).toBe(true)
    expect(labels.some((l) => l.includes('constitution'))).toBe(true)
  })

  it('décrit le RAG Brain du chat cockpit visible, seule connaissance récupérée', () => {
    const cockpit = build().cockpit
    expect(cockpit.retrievedContext.map(({ label }) => label)).toEqual(['Brain signé'])
    expect(JSON.stringify(cockpit)).toContain('dernier message utilisateur')
    // Le repli à vide en cas de panne reste décrit.
    expect(JSON.stringify(cockpit)).toContain('une panne dégrade ce bloc à vide')
  })

  it('décrit tous les influenceurs variables du cockpit', () => {
    const blob = JSON.stringify(build().cockpit)
    for (const token of [
      'catalogue vivant',
      'snapshot courant',
      'historique complet',
      'pièces jointes',
      'exécutées directement',
      'directives',
      '12 itérations'
    ]) {
      expect(blob).toContain(token)
    }
  })

  it('reflète les panels vivants et la règle de quorum', () => {
    const c = buildBehaviourComposition(
      new RoleModelConfig(),
      {},
      {
        panels: {
          scout: [
            {
              slotId: 's1',
              provider: 'codex',
              modelId: 'codex:gpt-5.6',
              reasoningEffort: 'high'
            }
          ],
          frame: [],
          terrain: [
            {
              slotId: 't1',
              provider: 'claude',
              modelId: 'claude:sonnet',
              reasoningEffort: 'medium'
            }
          ],
          judge: [
            {
              slotId: 'j1',
              provider: 'claude',
              modelId: 'claude:opus',
              reasoningEffort: 'high'
            },
            {
              slotId: 'j2',
              provider: 'codex',
              modelId: 'codex:gpt-5.6',
              reasoningEffort: 'medium'
            }
          ]
        }
      }
    )
    const blob = JSON.stringify(c.orchestrated.topology)
    expect(blob).toContain('codex/codex:gpt-5.6/high')
    expect(blob).toContain('claude/claude:sonnet/medium')
    expect(blob).toContain('claude/claude:opus/high')
    expect(blob).toContain('quorum')
  })

  it('distingue provider explicite et binding de rôle dans os.chat', () => {
    const direct = JSON.stringify(build().direct)
    expect(direct).toContain('Sans provider explicite')
    expect(direct).toContain('options modèle/effort vides')
    expect(direct).toContain('binding du rôle est alors ignoré')
  })

  it('le juge n’injecte PAS la discipline de pipeline', () => {
    const judge = build().orchestrated.systemPrompt.find((p) => p.phase === 'judge')!
    expect(judge.blocks.some((b) => b.label === 'discipline')).toBe(false)
    const build_ = build().orchestrated.systemPrompt.find((p) => p.phase === 'build')!
    expect(build_.blocks.some((b) => b.label === 'discipline')).toBe(true)
  })
})

describe('buildBehaviourComposition — EXCLUSIVITÉ (aucun non-influenceur)', () => {
  const forbidden = ['capabilit', 'graph_report', 'listclaudehooks', 'hookevents']

  it('ne mentionne AUCUN non-influenceur connu', () => {
    const blob = JSON.stringify(build()).toLowerCase()
    for (const token of forbidden) {
      expect(blob.includes(token), `non-influenceur "${token}" présent`).toBe(false)
    }
  })

  it('n’expose PAS le rôle scout scalaire dans la sélection de modèle (jamais lu par l’orchestrateur)', () => {
    const modelLabels = build().orchestrated.modelSelection.map((f) => f.label.toLowerCase())
    expect(modelLabels.some((l) => l.includes('scout'))).toBe(false)
  })
})

describe('buildBehaviourComposition — valeurs volatiles = RÈGLE, pas figées', () => {
  it('cap circuit-breaker : absence explicite ou valeur persistée', () => {
    expect(JSON.stringify(build())).toContain('aucune limite')
    const withCap = build(5)
    const cb = withCap.orchestrated.guardrails.find((f) => f.label === 'circuit-breaker coût')!
    expect(cb.value).toContain('5')
  })
})

describe('buildBehaviourComposition — le libellé constitution cite le VRAI nombre de réflexes', () => {
  it('le nombre annoncé est celui du titre de la CONSTITUTION (pas un chiffre figé qui dérive)', () => {
    const attendu = /## Les (\d+) réflexes/.exec(CONSTITUTION)?.[1]
    expect(attendu).toBeTruthy()
    const libelles = allFields(build())
      .filter((f) => f.label === 'constitution')
      .map((f) => f.value)
      .filter((v) => v.includes('réflexes'))
    expect(libelles.length).toBeGreaterThan(0)
    for (const v of libelles) expect(v).toContain(`${attendu} réflexes`)
  })
})

describe("buildBehaviourComposition — l'effort par étape affiché suit la règle (conv-955)", () => {
  const catalogue = [
    {
      id: 'claude/claude-opus-5-5',
      provider: 'claude',
      model: 'claude-opus-5-5',
      label: 'Opus 5.5',
      reasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'] as const,
      defaultReasoningEffort: 'medium' as const
    }
  ].map((m) => ({ ...m, reasoningEfforts: [...m.reasoningEfforts] }))
  const roleXhigh = {
    provider: 'claude',
    model: 'claude-opus-5-5',
    reasoningEffort: 'xhigh' as const
  }
  const champ = (c: ReturnType<typeof buildBehaviourComposition>, role: string): string =>
    c.orchestrated.modelSelection.find((f) => f.label === `rôle ${role}`)?.value ?? ''

  it('sous-agents : clean annonce high|medium|low selon la difficulté, build reste xhigh', () => {
    const roles = new RoleModelConfig({ subagent: roleXhigh, judge: roleXhigh }, catalogue)
    const valeur = champ(buildBehaviourComposition(roles, {}, undefined, null), 'subagent')
    expect(valeur).toContain('clean:claude-opus-5-5/high|medium|low')
    expect(valeur).toContain('frame:claude-opus-5-5/xhigh|high|medium')
    expect(valeur).toContain('build:claude-opus-5-5/xhigh,')
    expect(valeur).toContain('(difficile|standard|triviale)')
  })

  it('le juge garde son réglage partout', () => {
    const roles = new RoleModelConfig({ subagent: roleXhigh, judge: roleXhigh }, catalogue)
    const valeur = champ(buildBehaviourComposition(roles, {}, undefined, null), 'judge')
    expect(valeur).toContain('clean:claude-opus-5-5/xhigh,')
    expect(valeur).not.toContain('|')
  })

  it('sans catalogue, rien de calculé : le réglage du rôle est affiché tel quel', () => {
    const roles = new RoleModelConfig({ subagent: roleXhigh })
    const valeur = champ(buildBehaviourComposition(roles, {}, undefined, null), 'subagent')
    expect(valeur).toContain('clean:claude-opus-5-5/xhigh,')
    expect(valeur).not.toContain('triviale')
  })
})

/**
 * PORTAGE ET AGRÉGAT DU JUGE : la valeur affichée et la fonction citée sont celles du code.
 *
 * Mesuré le 2026-11-05 : « portage phase→phase » affichait « tronquée à 2000 caractères » avec la
 * source `orchestrator.ts:844`, alors que `porterVersPhaseSuivante` ne coupe plus rien depuis le
 * 2026-09-27 et vit dans `orchestrator-contrats.ts`. Entrées qui rendent ce test rouge : le mot
 * « tronquée » remis dans la valeur, ou une source qui ne nomme plus la fonction là où elle est déclarée.
 */
describe('buildBehaviourComposition — portage et agrégat du juge (conv-1582)', () => {
  const champ = (label: string): InfluencerField => {
    const trouve = build().orchestrated.injectedContext.find((f) => f.label === label)
    expect(trouve, label).toBeDefined()
    return trouve!
  }

  it('le portage phase→phase est annoncé ENTIER et cite porterVersPhaseSuivante', () => {
    const portage = champ('portage phase→phase')
    expect(portage.value).not.toMatch(/tronqu|2000/iu)
    expect(portage.value).toMatch(/entière/iu)
    expect(declarationCitee(portage.source)).toMatch(/export function porterVersPhaseSuivante\(/u)
  })

  it("l'agrégat du juge cite la fonction qui le borne", () => {
    const agregat = champ('agrégat juge')
    expect(agregat.value).toMatch(/6000/u)
    expect(agregat.value).toMatch(/60 000/u)
    expect(declarationCitee(agregat.source)).toMatch(/export function agregerPhasesPourLeJuge\(/u)
  })
})
