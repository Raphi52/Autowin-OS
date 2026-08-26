import { describe, expect, it } from 'vitest'
import { buildChatPilotagePrompt } from './chat-pilotage-prompt'

/**
 * Garde de la regle « 2 bis » (piege mesure le 2026-08-25, conv-1404) : `edit_file` verifie le
 * bureau apres CHAQUE edition, donc une balise ENGLOBANTE doit etre convertie ouverture ET
 * fermeture dans le MEME appel. La regle vit dans une chaine de prompt : rien d'autre qu'un test
 * n'empeche sa disparition silencieuse lors d'une reecriture du bloc « FACE A UN BLOCAGE ».
 *
 * Entree qui DOIT faire echouer ce test si la regle etait fausse ou absente : un prompt ou le
 * paragraphe « 2 bis » a ete supprime, ou ou le decoupage « ouverture maintenant, fermeture apres »
 * n'est plus declare impossible. Verifie en rouge avant d'etre fige : la suppression du paragraphe
 * dans chat-pilotage-prompt.ts fait tomber les quatre assertions ci-dessous.
 */
describe('chat-pilotage-prompt — regle 2 bis (edition atomique des balises englobantes)', () => {
  it('enonce la regle, sa cause et son interdit', () => {
    const prompt = buildChatPilotagePrompt([])
    // 1. La regle est numerotee 2 bis, entre le « CHERCHE » (2) et le « ESSAIE » (3).
    expect(prompt).toContain('2 bis.')
    // 2. La CAUSE est nommee : la verification apres chaque edition refuse l'etat intermediaire.
    expect(prompt).toMatch(/apres CHAQUE edition[\s\S]{0,120}REFUSE/u)
    // 3. Le REMEDE est nomme : ouverture et fermeture dans le meme appel.
    expect(prompt).toMatch(/ouverture ET sa fermeture correspondante tiennent dans le MEME appel/u)
    // 4. Le contre-exemple est explicitement declare impossible (garde-fou inverse).
    expect(prompt).toContain('structurellement impossible')
  })

  /*
   * LA SECONDE FORME DU MEME PIEGE, et c'est celle qui a produit le vrai rouge de conv-1404.
   *
   * La regle ne couvrait que la balise ENGLOBANTE — un construit coupe en deux moities. Or l'echec
   * mesure ce jour-la etait d'une autre forme : `<SubAgentText/>` a ete CABLE dans le rendu avant
   * que le composant existe. Rien n'etait « coupe en deux » ; c'est l'ORDRE de deux editions
   * distinctes qui rendait la premiere non compilable. Dix tests sont tombes, et l'agent a conclu
   * que son changement etait mauvais alors qu'il ne l'etait pas.
   *
   * Entree qui DOIT faire echouer ce test si la regle etait absente : un prompt ou l'ordre
   * « definir d'abord, cabler ensuite » n'est plus enonce. Verifie en rouge avant d'etre fige.
   */
  it('couvre AUSSI le symbole reference avant d etre defini, et donne l ordre', () => {
    const prompt = buildChatPilotagePrompt([])
    // La forme est nommee : une reference vers ce qui n'existe pas encore.
    expect(prompt).toMatch(/reference[\s\S]{0,160}n'existe pas encore/u)
    // L'ORDRE est donne, pas seulement l'interdit : definir avant de cabler.
    expect(prompt).toMatch(/DEFINIR[\s\S]{0,80}CABLER/u)
  })

  it('garde la regle a sa place dans le bloc « FACE A UN BLOCAGE »', () => {
    const prompt = buildChatPilotagePrompt([])
    const blocage = prompt.indexOf('FACE A UN BLOCAGE')
    const regle = prompt.indexOf('2 bis.')
    const essaie = prompt.indexOf('3. ESSAIE')
    expect(blocage).toBeGreaterThanOrEqual(0)
    expect(regle).toBeGreaterThan(blocage)
    expect(essaie).toBeGreaterThan(regle)
  })
})
