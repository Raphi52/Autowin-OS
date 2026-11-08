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
    const passage = corps.indexOf('await passerLeFilDansSaCopie(conversationId, args[1])')
    expect(passage).toBeGreaterThan(-1)
    expect(passage).toBeLessThan(corps.indexOf('photographierDebutDeTour(dossierDuTour('))
    expect(passage).toBeLessThan(corps.indexOf('photographierLeCode({ dossier: dossierDuTour('))
    expect(passage).toBeLessThan(corps.indexOf('await lancerTour(...args)'))
  })

  it('après la bascule par chemin cité, qui prime', () => {
    expect(corps.indexOf('alignerDossierSurLaDemande(conversationId')).toBeLessThan(
      corps.indexOf('await passerLeFilDansSaCopie(conversationId, args[1])')
    )
  })

  it('jamais pour un tour repris après un redémarrage : il a commencé avant', () => {
    expect(corps).toContain(
      'if (args[4] === undefined) await passerLeFilDansSaCopie(conversationId, args[1])'
    )
  })

  it('une question seule n’ouvre pas de copie : la décision lit la dernière demande du tour', () => {
    const passage = source.slice(source.indexOf('const passerLeFilDansSaCopie = async ('))
    const bloc = passage.slice(0, passage.indexOf('const tourCompteDesReception'))
    expect(bloc).toContain('questionSeule: estUneQuestionSansAction(')
    expect(bloc).toContain("[...messages].reverse().find((m) => m.role === 'user')?.content")
  })

  it('relit le réglage à chaque tour, et ne vise que le dépôt d’Autowin', () => {
    const passage = source.slice(source.indexOf('const passerLeFilDansSaCopie = async ('))
    const bloc = passage.slice(0, passage.indexOf('const tourCompteDesReception'))
    expect(bloc).toContain('actif: lireReglageCopieParFil(reglageCopieParFil())')
    expect(bloc).toContain('depotPartage: estDepotAutowin(depot) ? depot : null')
    // La copie s'ouvre sous `copies-de-fil/<fil>`, plus parmi les essais (`retours-de-tour`).
    expect(bloc).toContain('dossierDesCopies: dossierDesCopiesDeFil()')
    expect(source).toContain('join(ensureAutowinAppData(appDataRoot), DOSSIER_DES_COPIES_DE_FIL)')
  })

  it('met une copie déjà là à jour avec main, après le passage et jamais une copie neuve', () => {
    const passage = source.slice(source.indexOf('const passerLeFilDansSaCopie = async ('))
    const bloc = passage.slice(0, passage.indexOf('const tourCompteDesReception'))
    const miseAJour = bloc.indexOf('await mettreLaCopieDuFilAJour(')
    expect(miseAJour).toBeGreaterThan(bloc.indexOf('await preparerLeDossierDuTour('))
    expect(bloc).toContain("if (!copie || issue === 'ouverte') return")
    expect(bloc.slice(miseAJour)).toContain('if (ligne) annoncer(ligne)')
  })
})

/**
 * LE MÉNAGE DES COPIES DE FIL (effet joué dans menage-des-copies-de-fil.test.ts). Ici, seul le
 * branchement : une copie retirée doit faire revenir son fil AVANT le refus « dossier disparu », sans
 * quoi le tour suivant d'un fil endormi serait refusé ; et le ménage ne voit un tour en cours que par
 * la sonde qui compte aussi la préparation.
 */
describe('le ménage des copies de fil', () => {
  it('fait revenir le fil dont la copie a disparu AVANT le refus du dossier disparu', () => {
    const retour = corps.indexOf('revenirSiSaCopieADisparu(os.conversations.get(conversationId)')
    expect(retour).toBeGreaterThan(-1)
    expect(retour).toBeLessThan(corps.indexOf('refuserTourSiDossierDisparu('))
    expect(corps.slice(retour - 80, retour)).toContain('args[4] === undefined')
  })

  it('passe toutes les heures, sur le dépôt d’Autowin, sans toucher un fil en cours', () => {
    const passe = source.slice(source.indexOf('const passeDuMenageDesCopies = (): void => {'))
    const bloc = passe.slice(0, passe.indexOf('setInterval(passeDuMenageDesCopies'))
    expect(bloc).toContain('if (!estDepotAutowin(depot)) return')
    expect(bloc).toContain('tourEnCours: (id) => activeChatTurns.isInFlight(id)')
    expect(bloc).toContain('os.conversations.revenirDeLaCopie(id)')
    // Les copies d'aujourd'hui ET celles d'avant (`retours-de-tour/essai__…`).
    expect(bloc).toContain('dossierDesCopiesDeFil: dossierDesCopiesDeFil()')
    expect(bloc).toContain('dossierDesRetours: dossierDesRetours()')
    expect(source).toContain('setInterval(passeDuMenageDesCopies, 60 * 60 * 1_000).unref()')
  })
})

/**
 * LE MÉNAGE APRÈS LA FIN D'UN TOUR. Le calme qui retire une copie propre est court (le coût de la
 * rouvrir) : le balayage horaire seul garderait la copie jusqu'à l'heure suivante. Chaque fin de tour
 * replanifie donc une passe, une fois la publication du tour et son bloc git posés.
 */
describe('le ménage après la fin d’un tour', () => {
  it('se replanifie une fois le bloc git du tour posé, pour que le calme soit atteint', () => {
    expect(corps).toContain('.finally(planifierLeMenageDesCopies)')
    expect(corps.indexOf('.finally(planifierLeMenageDesCopies)')).toBeGreaterThan(
      corps.indexOf("console.warn('[bloc git du tour] non posé :', error)")
    )
  })

  it('la minuterie repart du délai de calme, sans passe en double', () => {
    const debut = source.indexOf('const planifierLeMenageDesCopies = (): void => {')
    expect(debut).toBeGreaterThan(-1)
    const bloc = source.slice(debut, source.indexOf('\n  }\n', debut))
    expect(bloc).toContain('if (minuterieDuMenage) clearTimeout(minuterieDuMenage)')
    expect(bloc).toContain('}, CALME_AVANT_MENAGE_MS)')
    expect(bloc).toContain('passeDuMenageDesCopies()')
  })
})

/**
 * LE FIL D'UN LOT s'ouvre dans le DÉPÔT de son chef, jamais dans la copie personnelle du chef :
 * la règle est jouée dans bascule-dossier-conversation.test.ts (`dossierDuFilOuvertPar`), ici
 * seulement son branchement dans la création du fil, fonction locale de `registerChatIpc`.
 */
describe('le fil d’un lot de plan', () => {
  it('reçoit le dépôt du chef, pas sa copie', () => {
    const debut = source.indexOf('creerFil: (chef, titre) => {')
    expect(debut).toBeGreaterThan(-1)
    const bloc = source.slice(debut, source.indexOf('}).id', debut))
    expect(bloc).toContain('const source = os.conversations.get(chef)')
    expect(bloc).toContain('dossierDuFilOuvertPar(source)')
    expect(bloc).not.toContain('source.projectPath')
  })
})
