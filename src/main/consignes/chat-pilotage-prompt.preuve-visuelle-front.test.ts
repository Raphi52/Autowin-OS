import { describe, expect, it } from 'vitest'
import { REGLES_ECRAN_UTILISATEUR, REGLES_VISUELLES } from './chat-pilotage-prompt'

/**
 * DEFAUT VECU : l'utilisateur a demande de VOIR la capture qui sert a valider une modif
 * front. Le canal a ete cable (agent-pilot republie les pieces jointes image en artefact), mais
 * RIEN dans le prompt n'obligeait a observer avant de dire « valide » — donc aucune image n'arrivait
 * jamais, canal ou pas. Le tuyau sans l'obligation ne montre rien.
 */
describe('preuve visuelle des modifications front', () => {
  it('impose une capture LUE et MONTREE avant tout verdict sur une modification visible', () => {
    const prompt = REGLES_VISUELLES
    expect(prompt).toContain('PREUVE VISUELLE FRONT')
    expect(prompt).toContain('desktop_observe')
    expect(prompt).toContain('avant de dire « fait »')
    expect(prompt).toContain('nomme dans ta clôture ce que la capture MONTRE')
  })

  /**
   * DEFAUT VECU (18/11/2026) : la liste des thèmes d'une app WebView2 a été « testée » par
   * `hdesk-act.ps1 -X -Y -Touches "28,0D"` — clic, flèche bas, Entrée d'un seul geste : la liste
   * s'ouvre et se referme avant la capture. Ses lignes (texte clair sur blanc) étaient illisibles,
   * et l'utilisateur l'a découvert seul. Le modèle de geste injecté collait justement clic et touches.
   */
  it('exige la liste ou le menu OUVERT, et n enseigne plus clic + flèches d un seul geste', () => {
    expect(REGLES_VISUELLES).toContain('se capture OUVERT (clic seul, puis capture)')
    const modeleDeClic = REGLES_ECRAN_UTILISATEUR.match(
      /hdesk-act\.ps1 -InstanceId <id> -X <x> -Y <y>[^`]*`/
    )
    expect(modeleDeClic?.[0]).toBeDefined()
    expect(modeleDeClic?.[0]).not.toContain('-Touches')
    expect(REGLES_ECRAN_UTILISATEUR).toContain('`-SansClic -Touches "28x15,0D"`')
  })
})
