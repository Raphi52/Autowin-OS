import { describe, expect, it } from 'vitest'
import { sourceProcessPrincipal } from './source-process-principal.test-helpers'

/**
 * CÂBLAGE de l'enchaînement auto du CHAT dans `runPilotChat` (closure locale de index.ts, que
 * l'exécution ne peut pas atteindre). Le comportement lui-même — quels fichiers partent, lesquels
 * restent — est joué sur de vrais dépôts git dans chat-turn-publication.test.ts.
 *
 * Avant conv-871 (2026-09-26), l'interrupteur « Enchaînement auto » ne publiait QUE les tâches
 * d'agent : 1 commit sur 64 poussé tout seul en deux jours, tout le travail du chat attendait un clic.
 */
const source = sourceProcessPrincipal()
const pilote = source.slice(source.indexOf('const tourCompteDesReception: typeof lancerTour'))
const corps = pilote.slice(0, pilote.indexOf('startupRecoverableChatCalls'))

describe('enchaînement auto du chat — câblage de fin de tour', () => {
  it('photographie l arbre AVANT le tour, seulement quand l interrupteur est actif', () => {
    expect(corps).toMatch(
      /os\.autoCloseEnabled\(\)\s*\?\s*await photographierDebutDeTour\(dossierDuTour\(conversationId\)\)/
    )
    expect(corps.indexOf('photographierDebutDeTour(')).toBeLessThan(
      corps.indexOf('await lancerTour(...args)')
    )
  })

  it('publie seulement un tour réussi et non arrêté, sans faire attendre la réponse', () => {
    const apres = corps.slice(corps.indexOf('await lancerTour(...args)'))
    expect(apres).toMatch(/if \(debutPublication && resultat\.ok && !resultat\.cancelled\)/)
    expect(apres).toMatch(/void os\s*\.publishChatTurn\(/)
    expect(apres).not.toMatch(/await os\s*\.publishChatTurn\(/)
    expect(apres).toContain('turnId: resultat.turnId')
  })

  // conv-1339 : la condition elle-même est jouée dans git-apres-fil.test.ts ; ici, qu'elle reçoive
  // le VRAI rapport de la publication, et qu'aucun tour ne parte hors de sa décision.
  it('passe le rapport de publication à la décision /git, sans lancer de tour hors d elle', () => {
    const apres = corps.slice(corps.indexOf('.publishChatTurn('))
    expect(apres).toMatch(/\.then\(\(rapport\) => \{\s*const decision = decisionGitApresFil\(\{/)
    expect(apres).toContain('accord: os.gitApresFilActif()')
    expect(apres).toContain('rapport\n')
    // conv-1544 : un lot de plan est rendu au chef (`filDeLaPasse`), le fil d'origine suit.
    expect(apres).toMatch(
      /if \(decision\.lancer\)\s*suiviGitApresFil\.file\?\.ajouter\(\s*filDeLaPasse\(\s*conversationId,[^;]*decision\.fichiers,\s*conversationId\s*\)/
    )
  })

  it('relit les travaux d’agents à chaque fin de run, sous le même accord (conv-1544)', () => {
    expect(source).toContain('os.onFinDeRun(balayerSansBruit)')
    const balayage = source.slice(source.indexOf('const balayerLesTravauxDAgents'))
    expect(balayage).toContain('if (!os.autoCloseEnabled() || !os.gitApresFilActif()) return')
    expect(balayage).toContain('dejaTentes: travauxTentes.lire()')
    expect(balayage).toMatch(/suiviGitApresFil\.file\?\.ajouterTravaux\(/)
  })

  it('range la passe /git dans la file, qui en lance une seule à la fois', () => {
    expect(source).toContain('suiviGitApresFil.file = new FileGitApresFil({')
    expect(source.match(/new FileGitApresFil\(/g)).toHaveLength(1)
    expect(source).not.toMatch(/runPrompt\([^)]*promptGitDuFil/)
  })
})
