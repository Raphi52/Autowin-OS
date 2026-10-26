import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  REPERES_GARDES_EN_FRANCAIS,
  blocLangueDeReponse,
  ecrireLangueReglee,
  langueReglageFile,
  lireLangueReglee
} from './langue-reglage'
import { extraireBilan } from '../shared/bilan-d-etape'
import { casLimitesEnumeres } from './frame-cas-limites'
import { leconRefuseeParLeJuge, objectionsDuJuge } from './objections-juge'
import { lireVerdictJuge } from './orchestrator'
import { lireGrilleClean } from './grille-clean'
import { titresBriefingManquants } from './think-briefing'
import { demoteUnvalidatedSuccessClaims } from '../shared/orchestration-outcome'
import { recommandationDitRien } from '../renderer/src/components/chat-auto-mode'
import { extractRecommendation } from '../renderer/src/components/markdown-recommandation'
import { splitFinalSummary } from '../renderer/src/components/markdown-cloture'
import { lireDecisionScoutTexte } from './scout-cible'
import { carteDuFil } from '../renderer/src/components/carte-du-fil'
import type { Msg } from '../renderer/src/components/chat-view-types'
import { readModelChoice } from './workflow-walk'
import { hypothesesDuCadrage } from '../shared/cadrage-confiance'
import { enteteCasLimitesManquants } from './frame-cas-limites'
import { decideRemember } from './brain-remember'
import { messageDuRun } from '../shared/message-du-run'
import { lireLigneBesoin } from '../shared/ligne-besoin'

/**
 * ENTRÉE QUI DOIT FAIRE ÉCHOUER CE TEST (conv-1146) : une consigne d'anglais qui oublie de garder
 * « Bilan de l’étape » en français (l'app ne retrouverait plus le bilan des étapes), un bloc non vide
 * en français (la consigne de tous les postes changerait), ou une valeur inconnue qui écraserait un
 * choix valable.
 */
describe('langue de réponse choisie dans Settings · Interface (conv-1146)', () => {
  let racine: string
  beforeEach(() => {
    racine = mkdtempSync(join(tmpdir(), 'langue-reglage-'))
  })
  afterEach(() => rmSync(racine, { recursive: true, force: true }))

  it('rien d’enregistré : français, et aucun bloc dans la consigne', () => {
    expect(lireLangueReglee({ racine })).toBe('fr')
    expect(blocLangueDeReponse({ racine })).toBe('')
  })

  it('fichier abîmé, vide ou langue inconnue : français, sans erreur', () => {
    const fichier = langueReglageFile({ racine })
    for (const contenu of [
      '{pas du json',
      '',
      '{"langue":"de"}',
      '{"langue":""}',
      '"en"',
      'null'
    ]) {
      writeFileSync(fichier, contenu, 'utf8')
      expect(lireLangueReglee({ racine })).toBe('fr')
      expect(blocLangueDeReponse({ racine })).toBe('')
    }
  })

  it('l’anglais choisi est mémorisé ; redire la même langue n’écrit rien', () => {
    expect(ecrireLangueReglee('en', { racine })).toBe(true)
    expect(lireLangueReglee({ racine })).toBe('en')
    const avant = statSync(langueReglageFile({ racine })).mtimeMs
    expect(ecrireLangueReglee('en', { racine })).toBe(false)
    expect(statSync(langueReglageFile({ racine })).mtimeMs).toBe(avant)
    expect(ecrireLangueReglee('fr', { racine })).toBe(true)
    expect(lireLangueReglee({ racine })).toBe('fr')
  })

  it('refuse une valeur hors liste sans écraser le choix enregistré', () => {
    ecrireLangueReglee('en', { racine })
    for (const valeur of ['de', '', 42, null, undefined, { langue: 'en' }]) {
      expect(() => ecrireLangueReglee(valeur, { racine })).toThrow(/Langue invalide/)
    }
    expect(JSON.parse(readFileSync(langueReglageFile({ racine }), 'utf8'))).toEqual({
      langue: 'en'
    })
  })

  it('en anglais : la consigne demande l’anglais ET garde les repères lus par l’app', () => {
    ecrireLangueReglee('en', { racine })
    const bloc = blocLangueDeReponse({ racine })
    expect(bloc).toMatch(/EN ANGLAIS/)
    expect(bloc).toContain('English')
    for (const repere of REPERES_GARDES_EN_FRANCAIS) expect(bloc).toContain(repere)
    // Le repère gardé est EXACTEMENT celui que l'app sait lire : un bilan écrit avec lui est retrouvé.
    const reponse = `Done.\n\n${REPERES_GARDES_EN_FRANCAIS[0]}\n- Verdict : done — it works.\n`
    expect(extraireBilan(reponse)?.bilan).toContain('Verdict : done')
    // Le bloc ne doit pas ouvrir une fausse section au milieu de sa propre ligne de titre.
    expect(bloc.split('\n=== ').length).toBe(2)
    // Stable d'un tour à l'autre : même fichier, même texte.
    expect(blocLangueDeReponse({ racine })).toBe(bloc)
  })

  /*
   * LE JUGE ET LE CADRAGE REÇOIVENT AUSSI LA CONSIGNE D'ANGLAIS (orchestrator.ts, juste avant le choix
   * du modèle du juge) : leurs repères lus mot pour mot doivent être nommés comme gardés (objection du
   * juge, conv-1146, réparation 2). Liste écrite ICI, à part de `REPERES_GARDES_EN_FRANCAIS`, pour que
   * l'oubli d'un repère dans la consigne fasse échouer ce test. Sources : `orchestrator.ts`
   * (VALIDE, DEFAUT:), `objections-juge.ts` (OBJECTIONS:, MAJEUR:, MINEUR:, OK:, aucune, QUESTIONS AU
   * BUILD:), `phase-briefs.ts` (SCORE:, ## Confiance, VÉRIFIÉ, NON VÉRIFIÉ), `frame-cas-limites.ts`.
   */
  const REPERES_DU_JUGE_ET_DU_CADRAGE = [
    'VALIDE',
    'DEFAUT:',
    'SCORE:',
    'OBJECTIONS:',
    'MAJEUR:',
    'MINEUR:',
    'OK:',
    'aucune',
    'QUESTIONS AU BUILD:',
    '## Confiance',
    'VÉRIFIÉ',
    'NON VÉRIFIÉ',
    '### Cas limites d’entrée'
  ]

  it('en anglais : les repères du juge et du cadrage sont nommés comme gardés en français', () => {
    ecrireLangueReglee('en', { racine })
    const bloc = blocLangueDeReponse({ racine })
    for (const repere of REPERES_DU_JUGE_ET_DU_CADRAGE) expect(bloc).toContain(`\`${repere}\``)
  })

  it('un juge qui répond en anglais AVEC les repères gardés reste lu correctement par l’app', () => {
    // Approbation : « VALIDE » gardé est lu comme un accord ; traduit en « VALID », il serait un refus.
    const lignes = (...l: string[]): string => l.join('\n')
    expect(lireVerdictJuge(lignes('VALIDE', 'Every criterion is met, proofs were rerun.'))).toBe(
      true
    )
    expect(lireVerdictJuge(lignes('VALID', 'Every criterion is met, proofs were rerun.'))).toBe(
      false
    )
    // Refus : MAJEUR et MINEUR bloquent, OK passe (conv-844) ; « aucune » gardé vaut une liste vide.
    const refus = lignes(
      'DEFAUT: the chat body is still in French',
      'SCORE: 40',
      'OBJECTIONS:',
      '- MAJEUR: the thread list is not translated',
      '- MINEUR: a typo in Settings',
      '- OK: tests pass'
    )
    expect(lireVerdictJuge(refus)).toBe(false)
    expect(objectionsDuJuge(refus)).toEqual([
      'the thread list is not translated',
      'a typo in Settings'
    ])
    expect(objectionsDuJuge(lignes('VALIDE', 'SCORE: 95', 'OBJECTIONS:', '- aucune'))).toEqual([])
    // Le même vide traduit (« none ») deviendrait une objection qui bloque : d'où le repère gardé.
    expect(objectionsDuJuge(lignes('VALIDE', 'SCORE: 95', 'OBJECTIONS:', '- none'))).toEqual([
      'none'
    ])
    // Cadrage : la rubrique gardée est retrouvée avec ses cas.
    const cadrage = lignes(
      '## Besoin',
      'A language switch.',
      '### Cas limites d’entrée',
      '- nothing saved → French',
      '- unknown value → French',
      '- storage refused → French',
      '## Contraintes',
      '- none'
    )
    expect(casLimitesEnumeres(cadrage)).toHaveLength(3)
  })

  /*
   * LES AUTRES REPÈRES LUS MOT POUR MOT (objection du juge, conv-1146, réparation 3) : la phrase
   * générale « les titres imposés restent en français » ne garde que ce qu'elle NOMME. Liste écrite
   * ICI, à part de `REPERES_GARDES_EN_FRANCAIS`, pour que l'oubli d'un seul fasse échouer ce test.
   * Sources : rubriques de fin du chat (`agent-pilot.ts`, lues par `shared/orchestration-outcome.ts`,
   * `components/markdown-cloture.ts` et `components/chat-auto-mode.ts`, où « rien » seul éteint le
   * mode auto) ; ligne de grille du ménage (`grille-clean.ts`) ; six titres du briefing `think`
   * (`think-briefing.ts`, `skills/think/SKILL.md` §5).
   */
  const REPERES_DES_CLOTURES_GRILLE_ET_BRIEFING = [
    '✅ Fait',
    '📍 Maintenant',
    '⏳ Reste à faire',
    '👉 Recommandé',
    'rien',
    'Grille :',
    '❌ restants',
    '## Localisation',
    '## Cartographie',
    '## Décisions',
    '## Constats',
    '## Contraintes',
    '## Trous'
  ]

  it('en anglais : les rubriques de fin, la grille et les titres du briefing sont gardés', () => {
    ecrireLangueReglee('en', { racine })
    const bloc = blocLangueDeReponse({ racine })
    for (const repere of REPERES_DES_CLOTURES_GRILLE_ET_BRIEFING) {
      expect(bloc).toContain(`\`${repere}\``)
    }
  })

  it('une réponse en anglais AVEC ces repères gardés reste lue correctement par l’app', () => {
    const lignes = (...l: string[]): string => l.join('\n')
    // Fin du chat : « ✅ Fait » gardé est rétrogradé quand le contrôle refuse ; « ✅ Done » passerait.
    const fait = '✅ Fait : the language switch works.'
    expect(demoteUnvalidatedSuccessClaims(fait, { gateBlocked: true })).toContain('AUTO-DÉCLARÉ')
    const done = '✅ Done: the language switch works.'
    expect(demoteUnvalidatedSuccessClaims(done, { gateBlocked: true })).toBe(done)
    // « 👉 Recommandé : rien » gardé éteint le mode auto ; traduit, la rubrique n'est même plus trouvée.
    const cloture = lignes(
      '✅ Fait',
      '1. Settings is translated.',
      '📍 Maintenant : the switch is live.',
      '⏳ Reste à faire : the other screens.',
      '👉 Recommandé : rien'
    )
    expect(recommandationDitRien(extractRecommendation(cloture))).toBe(true)
    expect(splitFinalSummary(cloture)).not.toBeNull()
    const traduite = lignes(
      '✅ Done',
      '1. Settings is translated.',
      '📍 Now: the switch is live.',
      '⏳ Still to do: the other screens.',
      '👉 Recommended: nothing'
    )
    expect(recommandationDitRien(extractRecommendation(traduite))).toBe(false)
    expect(splitFinalSummary(traduite)).toBeNull()
    // Ménage : la grille gardée bloque sur son ❌ restant ; « remaining » ne serait plus lue du tout.
    expect(lireGrilleClean('Grille : 10 ✅ · 1 ❌ restants · 1 sans objet')?.restants).toBe(1)
    expect(lireGrilleClean('Grid: 10 ✅ · 1 ❌ remaining · 1 not applicable')).toBeUndefined()
    // Briefing : les six titres gardés sont tous reconnus ; traduits, aucun ne l'est.
    const briefing = lignes(
      '## Localisation',
      'Settings · Interface.',
      '## Cartographie',
      'No translation library.',
      '## Décisions',
      'French by default.',
      '## Constats',
      'Tests expect French labels.',
      '## Contraintes',
      'No npm install while the app runs.',
      '## Trous',
      'Exact string count unknown.'
    )
    expect(titresBriefingManquants(briefing)).toEqual([])
    const briefingTraduit = briefing
      .replace('## Localisation', '## Location')
      .replace('## Cartographie', '## Mapping')
      .replace('## Constats', '## Findings')
      .replace('## Trous', '## Gaps')
    expect(titresBriefingManquants(briefingTraduit)).toEqual([
      'localisation',
      'cartographie',
      'constats',
      'trous'
    ])
  })

  /*
   * LES DERNIERS REPÈRES LUS MOT POUR MOT (objection du juge, conv-1146, réparation 4), et ceux
   * qu'un BALAYAGE de tous les lecteurs a trouvés au même passage, pour cesser de les découvrir un
   * par un. Méthode : chaque expression régulière à mot français de `src/main`, `src/shared` et
   * `src/renderer/src` (hors tests : 264 le 2026-10-26), gardée si elle lit une réponse d'agent ET
   * qu'une consigne impose le mot. Sources : scout (`phase-briefs.ts`, lu par `scout-cible.ts`,
   * `shared/scout-cible-lecture.ts`, `chat-auto-mode.ts`) ; blocage (`response-style.ts`, lu par
   * `carte-du-fil.ts`, `agent-pilot.ts`) ; `SUITE: fin` (`workflow-walk.ts`) ; leçon refusée
   * (`objections-juge.ts`) ; `DE L'UTILISATEUR` et `Hypothèse :` (`shared/cadrage-confiance.ts`) ;
   * dispense des cas limites (`frame-cas-limites.ts`) ; corps d'une leçon d'échec
   * (`brain-remember.ts`) ; « aucune suite » (`carte-du-fil.ts`, `chat-auto-mode.ts`) ; « aucun
   * reste » (`shared/message-du-run.ts`) ; valeurs de la ligne de besoin (`chat-pilotage-prompt.ts`,
   * lues par `shared/ligne-besoin.ts`).
   */
  const REPERES_DE_LA_REPARATION_4 = [
    '## Cible',
    'CIBLE:',
    'CIBLES:',
    '⛔ Bloqué',
    '⚠️ Non résolu',
    'SUITE: fin',
    'OK: leçon refusée',
    "DE L'UTILISATEUR",
    'Hypothèse :',
    'Cas limites : sans objet',
    'Tentative:',
    'Symptôme:',
    'Cause (prouvée):',
    'Cause (hypothèse):',
    'Prochaine stratégie:',
    'aucune suite',
    'aucun reste',
    'nouveau',
    'suite',
    'aucun'
  ]

  it('en anglais : cible du scout, blocage, fin, leçon, cadrage et ligne de besoin sont gardés', () => {
    ecrireLangueReglee('en', { racine })
    const bloc = blocLangueDeReponse({ racine })
    for (const repere of REPERES_DE_LA_REPARATION_4) expect(bloc).toContain(`\`${repere}\``)
  })

  it('ces repères gardés sont lus par l’app ; traduits, ils ne le sont plus', () => {
    const lignes = (...l: string[]): string => l.join('\n')
    // Scout : la piste engagée est lue ; « ## Target » fait croire qu'aucune ne l'est.
    const piste = 'Track 1 — the language switch, highest impact.'
    expect(lireDecisionScoutTexte(lignes('## Cible', piste)).statut).toBe('cible')
    expect(lireDecisionScoutTexte(lignes('## Target', piste)).statut).toBe('aucune-cible')
    expect(lireDecisionScoutTexte('CIBLE: translate Settings').statut).toBe('cible')
    expect(lireDecisionScoutTexte('TARGET: translate Settings').statut).toBe('aucune-cible')
    expect(lireDecisionScoutTexte('CIBLES: translate Settings, translate the chat').statut).toBe(
      'cible'
    )
    // Blocage déclaré : l'étape du fil passe en refusé ; « ⛔ Blocked » ne l'y met pas.
    const etape = (texte: string): string =>
      carteDuFil({
        fil: [
          { role: 'user', content: 'a', ts: 1, messageId: 'u1' },
          {
            role: 'assistant',
            status: 'completed',
            done: true,
            debutDuTour: 2,
            parts: [{ kind: 'text', text: texte }]
          }
        ] as unknown as Msg[]
      }).etapes[0]!.statut
    expect(etape('⛔ Bloqué : the IPC bridge is missing.')).toBe('refuse')
    expect(etape('⚠️ Non résolu : the IPC bridge is missing.')).toBe('refuse')
    expect(etape('⛔ Blocked: the IPC bridge is missing.')).not.toBe('refuse')
    // `SUITE: fin` arrête le travail ; « SUITE: end » serait une étape inconnue.
    expect(readModelChoice('Done.\nSUITE: fin')).toEqual({ kind: 'stop' })
    expect(readModelChoice('Done.\nSUITE: end')).toEqual({ kind: 'phase', phase: 'end' })
    // Leçon refusée par le juge : gardée, elle n'est pas enregistrée ; traduite, elle le serait.
    const juge = (puce: string): string => lignes('VALIDE', 'SCORE: 90', 'OBJECTIONS:', puce)
    expect(leconRefuseeParLeJuge(juge('- OK: leçon refusée — not backed by proofs'))).toBe(true)
    expect(leconRefuseeParLeJuge(juge('- OK: lesson refused — not backed by proofs'))).toBe(false)
    // Cadrage : l'hypothèse annoncée remonte au juge ; ce que dit l'utilisateur n'en est pas une.
    const besoin = (annonce: string): number =>
      hypothesesDuCadrage(lignes('## Besoin', 'A switch.', '', `${annonce} French by default.`))
        .length
    expect(besoin('**Hypothèse** :')).toBe(1)
    expect(besoin('**Assumption**:')).toBe(0)
    const confiance = (etiquette: string): string[] =>
      hypothesesDuCadrage(
        lignes('## Confiance', '- Non vérifié :', `  - French is the default : ${etiquette}`)
      ).map((h) => h.affirmation)
    expect(confiance("DE L'UTILISATEUR")).toEqual([])
    expect(confiance('FROM THE USER')).toHaveLength(1)
    // Cas limites dispensés : le cadrage passe ; « Edge cases: not applicable » est refusé.
    const cadrage = (dispense: string): string | undefined =>
      enteteCasLimitesManquants(
        lignes('## Besoin', 'Add a `--port` flag.', `${dispense} — the flag is read-only.`)
      )
    expect(cadrage('Cas limites : sans objet')).toBeUndefined()
    expect(cadrage('Edge cases: not applicable')).toMatch(/Cadrage incomplet/)
    // Leçon d'échec : les quatre rubriques gardées passent ; traduites, la leçon est refusée.
    const lecon = (corps: string): string | undefined => {
      const decision = decideRemember({
        title: 'English switch',
        body: corps,
        type: 'lesson',
        learningOutcome: 'failure',
        scope: 'autowin-os',
        source: 'git:src/main/langue-reglage.ts@85d86866'
      })
      return decision.allowed ? undefined : decision.reason
    }
    const corps =
      'Tentative: kept every marker. Symptôme: none was lost. Cause (prouvée): the list. ' +
      'Prochaine stratégie: sweep the readers.'
    expect(lecon(corps) ?? '').not.toMatch(/incomplète/)
    const traduit = corps
      .replace('Tentative:', 'Attempt:')
      .replace('Symptôme:', 'Symptom:')
      .replace('Cause (prouvée):', 'Cause (proven):')
      .replace('Prochaine stratégie:', 'Next strategy:')
    expect(lecon(traduit)).toMatch(/incomplète/)
    // « aucune suite » n'ajoute pas d'étape à venir et éteint le mode auto ; « no next step », non.
    expect(recommandationDitRien('aucune suite : le travail est livré')).toBe(true)
    expect(recommandationDitRien('no next step: the work is delivered')).toBe(false)
    // « aucun reste » ne s'ajoute pas au résumé du run ; « nothing left » s'y ajouterait.
    const resume = (reste: string): string | undefined =>
      messageDuRun([
        {
          phase: 'build',
          text: lignes(
            '### Bilan de l’étape',
            '- Verdict : fait — the switch works.',
            `- Reste à faire : ${reste}`,
            '- Question : Publish now? → Yes | No'
          )
        }
      ])?.resume
    expect(resume('aucun reste')).toBe('the switch works.')
    expect(resume('nothing left')).toContain('nothing left')
    // Ligne de besoin : les trois valeurs gardées sont lues ; « new » ne range rien.
    expect(lireLigneBesoin('Done.\nAUTOWIN_BESOIN_V1: nouveau')).toEqual({ nature: 'nouveau' })
    expect(lireLigneBesoin('Done.\nAUTOWIN_BESOIN_V1: suite')).toEqual({ nature: 'suite' })
    expect(lireLigneBesoin('Done.\nAUTOWIN_BESOIN_V1: aucun')).toEqual({ nature: 'aucun' })
    expect(lireLigneBesoin('Done.\nAUTOWIN_BESOIN_V1: new')).toBeNull()
  })
})
