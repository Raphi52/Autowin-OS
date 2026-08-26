import { describe, expect, it } from 'vitest'
import { natureDeLEchec } from './verify-echec-nature'
import { verifyTimeoutOutcome } from './verify-command'

/**
 * DISTINGUER « TON CODE NE COMPILE PAS » DE « UN TEST ÉCHOUE ».
 *
 * DÉFAUT VÉCU le 2026-08-25 (conv-1404). Un tour a édité `WorkflowsPanel.tsx` pour remplacer un
 * `<details>/<summary>` par des `<div>`, et a laissé des balises fermantes qui ne correspondaient
 * plus. La vérification du bureau a donc échoué sur une erreur de TRANSFORMATION esbuild — du code
 * illisible, pas un test rouge. Le message rendu à l'agent était générique : « Vérification du
 * bureau échouée (vitest related …) ». Il a lu ça comme « ma modification casse un test », a
 * re-tenté une correction de CONTENU, et a reproduit exactement la même faute de balises. Huit
 * fois, jusqu'à ce que le budget d'appels coupe le tour à 12.
 *
 * Les deux natures appellent des gestes OPPOSÉS : un test rouge se corrige en changeant la logique,
 * une erreur de syntaxe se corrige en relisant les balises autour de la ligne fautive. Les
 * confondre, c'est garantir la boucle.
 */
describe('natureDeLEchec', () => {
  const sortieEsbuild = [
    '⎯⎯⎯ Unhandled Error ⎯⎯⎯',
    'Error: Transform failed with 2 errors:',
    '/w/src/renderer/src/components/WorkflowsPanel.tsx:203:18: ERROR: Unexpected closing "div" tag does not match opening "summary" tag',
    '/w/src/renderer/src/components/WorkflowsPanel.tsx:273:16: ERROR: Unexpected closing "div" tag does not match opening "details" tag'
  ].join('\n')

  it('reconnaît une erreur de transformation et la NOMME comme telle', () => {
    const nature = natureDeLEchec(sortieEsbuild)

    expect(nature.nature).toBe('syntaxe')
    // Le geste attendu doit être DIT : sans ça, l'agent retente une correction de logique.
    expect(nature.consigne).toContain('ne compile pas')
    expect(nature.consigne).not.toContain('test')
  })

  it('rend les emplacements fautifs, pas seulement le fait qu’il y en a', () => {
    const nature = natureDeLEchec(sortieEsbuild)

    expect(nature.consigne).toContain('WorkflowsPanel.tsx:203')
    expect(nature.consigne).toContain('WorkflowsPanel.tsx:273')
    expect(nature.consigne).toContain('summary')
  })

  it('un vrai test rouge reste un test rouge — aucune reclassification abusive', () => {
    const rouge = [
      '× ChatView > affiche le badge',
      'AssertionError: expected 1 to be 2',
      'Tests  1 failed | 6 passed (7)'
    ].join('\n')

    expect(natureDeLEchec(rouge).nature).toBe('tests')
  })

  it('une sortie qu’on ne sait pas classer n’est pas devinée', () => {
    expect(natureDeLEchec('quelque chose a mal tourné').nature).toBe('inconnue')
  })

  it('le mot « error » d’un test qui teste une erreur ne bascule pas en syntaxe', () => {
    // Piège réel : un test nommé « rend une ERROR lisible » contient le mot, sans être un échec
    // de transformation. Seul le marqueur esbuild fait foi.
    const rouge = '× rend une ERROR lisible\nTests  1 failed (1)'

    expect(natureDeLEchec(rouge).nature).toBe('tests')
  })

  /**
   * UN PLAFOND N'EST NI UNE FAUTE DE LOGIQUE NI UNE FAUTE DE SYNTAXE.
   *
   * DÉFAUT VÉCU le 2026-08-26 (conv-1410). Deux `edit_file` sur `home-decor-scene.ts` ont été
   * refusés après 600 s exactement : la suite GLOBALE a été jouée, coupée au plafond, donc rien
   * n'était prouvé. Mais la sortie de plafond embarque « ce que la suite avait écrit avant d'être
   * coupée » — donc des lignes `× …`. `MARQUEUR_TESTS` a matché, et la consigne rendue en TÊTE
   * disait « le code compile, mais un test échoue — corrige la logique », juste au-dessus de la
   * phrase « rien n'est prouvé ». Contradiction en deux lignes : l'agent est parti corriger une
   * logique intacte, et les deux éditions ont été perdues avec le bureau.
   */
  const sortiePlafond = [
    "vérification arrêtée après 600 s (plafond) — rien n'est prouvé, la suite n'a pas rendu son verdict.",
    'Ne relance pas la même commande : donne-lui une cible.',
    '',
    "Ce que la suite avait écrit avant d'être coupée :",
    '× la reprise persiste sa trace dans le RUN.md de la conversation (panneau Juges) 14ms',
    '× edit_file — le verdict juge l’ÉDITION, pas l’état général du dépôt 1503ms'
  ].join('\n')

  it('une vérification coupée au plafond n’est PAS classée « tests »', () => {
    expect(natureDeLEchec(sortiePlafond).nature).toBe('timeout')
  })

  it('la consigne d’un plafond ne demande NI logique NI syntaxe', () => {
    const { consigne } = natureDeLEchec(sortiePlafond)

    expect(consigne).not.toContain('corrige la logique')
    expect(consigne).not.toContain('ne compile pas')
    // Ce qu'il faut DIRE : aucun verdict n'a été rendu, donc il n'y a rien à corriger.
    expect(consigne).toContain('aucun verdict')
  })

  it('une faute de compilation visible dans une sortie coupée reste « syntaxe »', () => {
    // Un plafond n'efface pas un code qui ne compile pas : la faute est réelle et actionnable.
    const melange = [
      sortiePlafond,
      'Error: Transform failed with 1 error:',
      '/w/src/a.tsx:1:2: ERROR: Unterminated string literal'
    ].join('\n')

    expect(natureDeLEchec(melange).nature).toBe('syntaxe')
  })

  it('reconnaît la sortie RÉELLE du plafond, pas seulement une phrase recopiée', () => {
    // GARDE ANTI-DÉRIVE : le marqueur et le message vivent dans deux fonctions. Sans ce test, une
    // reformulation du message rebasculerait silencieusement les plafonds en « tests » — le défaut
    // de conv-1410 reviendrait sans qu'aucun test ne bouge.
    const reelle = verifyTimeoutOutcome('npm run test:unit', 600_000, '× un test 14ms')

    expect(natureDeLEchec(reelle.output).nature).toBe('timeout')
  })
})
