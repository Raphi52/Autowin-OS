import { describe, expect, it } from 'vitest'
import { sourceProcessPrincipal } from '../source-process-principal.test-helpers'
import { closingTurnDelivery, closingStreamId } from './turn-closing'

/**
 * LE TEXTE DE CLÔTURE DOIT ÊTRE LIVRÉ AU FIL LIVE, PAS SEULEMENT ÉCRIT SUR DISQUE.
 *
 * MESURÉ le 2026-08-17 dans `conv-1276` (tour « finis ça une bonne fois pour toutes ») : le message
 * persisté ne portait qu'UNE part de texte, de flux `<turnId>:closing`. L'utilisateur n'a vu que la
 * ligne « ⛔ Workflow BLOQUÉ par le gate » ; tout le reste n'est apparu qu'à l'envoi du message
 * suivant, qui relit le store. Le renderer, lui, ne reçoit que `done`, dont son réducteur jette le
 * texte — donc un texte porté par le seul `done` n'atteint JAMAIS le fil vivant.
 *
 * Distinct du défaut de défilement corrigé le même jour : là le texte était rendu mais hors champ,
 * ici il n'arrive pas du tout.
 */
describe('livraison du texte de clôture', () => {
  it('rend un événement durable ET un événement live, même flux et même texte', () => {
    const livraison = closingTurnDelivery('turn-9', '  ⛔ Workflow BLOQUÉ par le gate  ')

    expect(livraison?.durable).toEqual({
      kind: 'delta',
      streamId: closingStreamId('turn-9'),
      text: '⛔ Workflow BLOQUÉ par le gate'
    })
    // Le live n'est pas une option : sans lui, le fil reste muet jusqu'à la relecture du store.
    expect(livraison?.live).toEqual(livraison?.durable)
  })

  /**
   * Un tour qui a DEJA parle garde son texte final des lors qu'il dit quelque chose de NEUF — que
   * ce soit un verdict d'orchestration ou le compte-rendu d'un tour ordinaire. Le motif n'est plus
   * « l'outcome est distinct » mais « ce texte n'a pas encore ete affiche » : c'est le contenu qui
   * tranche, et c'est ce qui rend le bloc de cloture d'un tour bavard enfin visible (conv-471).
   */
  it('livre la clôture d’un tour qui a déjà parlé, car son texte est NEUF', () => {
    const livraison = closingTurnDelivery('turn-9', 'verdict final', 'préambule déjà diffusé')

    expect(livraison?.live.text).toBe('verdict final')
  })

  it('ne livre rien quand il n’y a rien à dire, ni quand le done ne fait que répéter le streamé', () => {
    expect(closingTurnDelivery('turn-9', '   ')).toBeUndefined()
    expect(
      closingTurnDelivery('turn-9', 'déjà dit en streaming', 'déjà dit en streaming')
    ).toBeUndefined()
  })

  /**
   * Le câblage, pas la logique : « calculé puis jeté à la frontière » est exactement le défaut vécu,
   * et aucun test de comportement sur cette fonction ne peut l'attraper.
   */
  it('le process principal livre l’événement live, il ne persiste pas seulement le durable', () => {
    // La ZONE du process principal, pas un chemin : ce cablage a quitte `index.ts` pour
    // `src/main/chat/` (mesure du 2026-09-02).
    const main = sourceProcessPrincipal()
    const usage = main.slice(main.indexOf('closingTurnDelivery('))
    expect(usage.length).toBeGreaterThan(0)
    const bloc = usage.slice(0, 1200)
    expect(bloc).toContain('livraison.durable')
    expect(bloc).toContain('livraison.live')
    expect(bloc).toContain('emitToLiveWindows')
  })
})

/**
 * REGRESSION 2026-09-09 : « le resultat de scout m'a ete rendu 2 fois ».
 *
 * Le modele ecrit lui-meme le compte-rendu d'orchestration en direct (agent-pilot rend la parole au
 * modele apres `orchestrate`), puis le `done` reprend ce meme texte. Avec un `outcome` non vide, la
 * clôture etait republiee telle quelle : le fil affichait deux fois le tableau du scout.
 */
describe('clôture d’orchestration déjà streamée', () => {
  it('ne republie rien quand le texte de clôture est exactement celui déjà streamé', () => {
    const texte = '✅ Workflow terminé · statut succeeded\n\n| # | Score |\n|---|---|\n| 1 | 78 |'
    expect(closingTurnDelivery('turn-1', texte, texte)).toBeUndefined()
  })

  it('ne republie QUE le reste quand la cloture prolonge le texte streame', () => {
    const streame = 'Workflow termine - statut succeeded'
    const livraison = closingTurnDelivery(
      'turn-2',
      `${streame}\n\nFait\n1. Le resultat demande a ete produit.`,
      streame
    )
    expect(livraison?.durable.text).toBe('Fait\n1. Le resultat demande a ete produit.')
  })

  it('publie tout quand rien n’a été streamé (tour muet après orchestration)', () => {
    const livraison = closingTurnDelivery('turn-3', 'compte-rendu', '')
    expect(livraison?.durable.text).toBe('compte-rendu')
  })
})
