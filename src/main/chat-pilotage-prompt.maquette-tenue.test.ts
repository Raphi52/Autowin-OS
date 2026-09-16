import { describe, expect, it } from 'vitest'
import { REGLES_VISUELLES } from './chat-pilotage-prompt'

/**
 * DEFAUT VECU (conv-605, 2026-09-16) : le chat a propose trois maquettes d'un pas de frise dans un
 * bloc html-render, l'utilisateur a repondu « A » (saisie ts=1789565236876), et le tour
 * d'application (turnId 4b057aa5-ec6d-4e90-a68d-30bbb7b1f17d) a ecrit « en CSS seul (pas de
 * changement de balisage) ». La maquette choisie montrait une coche ; le balisage reel affiche le
 * MOT « OK », qu'aucune regle CSS ne peut remplacer. L'utilisateur a donc recu autre chose que ce
 * qu'il avait choisi, sans que l'ecart lui soit dit : « j'ai choisi un truc ou yavais une tick et
 * ca m'a mis un truc ou yavais ecrit ok ».
 */
describe('maquette montree = maquette tenue', () => {
  it('impose le contenu reel dans la maquette et l ecart dit a la livraison', () => {
    const prompt = REGLES_VISUELLES
    expect(prompt).toContain('MAQUETTE MONTRÉE = MAQUETTE TENUE')
    expect(prompt).toContain('libellés et glyphes EXACTS')
    expect(prompt).toContain('en CSS seul')
    expect(prompt).toContain('dis dans la MÊME phrase ce que la maquette choisie avait')
  })
})
