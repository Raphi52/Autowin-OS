import { describe, expect, it } from 'vitest'
import { sourceProcessPrincipal } from '../app/source-process-principal.test-helpers'

/**
 * LE BRANCHEMENT DE « UNE COPIE PAR FIL » dans le tour du chat. L'effet est joué pour de vrai dans
 * bascule-dossier-conversation.test.ts (décision et annonce), photo-du-code.test.ts (copie, base,
 * dépendances) et agent-pilot.session-resume.test.ts (pas de reprise de session après le passage).
 * Ici, seul l'ORDRE, qu'aucune exécution n'atteint : `tourCompteDesReception` est une fonction
 * locale de `registerChatIpc`. Un passage placé après la lecture du dossier du tour ferait partir
 * la photo de début de tour, donc la porte, dans le dossier partagé.
 * fix-ok: cause mesurée — la 2e édition ajoute le contrôle du dossier des copies, la 3e n'est que la
 * mise en forme signalée par `npx prettier --check`.
 */
const source = sourceProcessPrincipal()
const pilote = source.slice(source.indexOf('const tourCompteDesReception: typeof lancerTour'))
const corps = pilote.slice(0, pilote.indexOf('startupRecoverableChatCalls'))

describe('une copie par fil — au début du tour', () => {
  it('passe le fil dans sa copie AVANT toute lecture du dossier du tour', () => {
    const passage = corps.indexOf('await passerLeFilDansSaCopie(conversationId)')
    expect(passage).toBeGreaterThan(-1)
    expect(passage).toBeLessThan(corps.indexOf('photographierDebutDeTour(dossierDuTour('))
    expect(passage).toBeLessThan(corps.indexOf('photographierLeCode({ dossier: dossierDuTour('))
    expect(passage).toBeLessThan(corps.indexOf('await lancerTour(...args)'))
  })

  it('après la bascule par chemin cité, qui prime', () => {
    expect(corps.indexOf('alignerDossierSurLaDemande(conversationId')).toBeLessThan(
      corps.indexOf('await passerLeFilDansSaCopie(conversationId)')
    )
  })

  it('jamais pour un tour repris après un redémarrage : il a commencé avant', () => {
    expect(corps).toContain(
      'if (args[4] === undefined) await passerLeFilDansSaCopie(conversationId)'
    )
  })

  it('relit le réglage à chaque tour, et ne vise que le dépôt d’Autowin', () => {
    const passage = source.slice(source.indexOf('const passerLeFilDansSaCopie = async ('))
    const bloc = passage.slice(0, passage.indexOf('const tourCompteDesReception'))
    expect(bloc).toContain('actif: lireReglageCopieParFil(reglageCopieParFil())')
    expect(bloc).toContain('depotPartage: estDepotAutowin(depot) ? depot : null')
    expect(bloc).toContain('dossierDesRetours: dossierDesRetours()')
    // Le même dossier que les essais : « Garder » ne reconnaît une copie que directement dedans.
    expect(source).toContain(
      "const dossierDesRetours = (): string => join(ensureAutowinAppData(appDataRoot), 'retours-de-tour')"
    )
  })
})
