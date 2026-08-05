import { describe, expect, it } from 'vitest'
import { PIPELINE_DISCIPLINE_INSTRUCTION } from './pipeline-discipline'

describe('discipline de pipeline canonique', () => {
  it('nomme les six phases dans l ordre et reste autonome', () => {
    const phases = ['SCOUT', 'FRAME', 'TERRAIN', 'BUILD', 'CLEAN', 'JUDGE']
    const positions = phases.map((phase) => PIPELINE_DISCIPLINE_INSTRUCTION.indexOf(phase))

    expect(positions.every((position) => position >= 0)).toBe(true)
    expect(positions).toEqual([...positions].sort((a, b) => a - b))
    expect(PIPELINE_DISCIPLINE_INSTRUCTION).not.toMatch(
      /~\/[.]claude|Audit\/workspaces|fingerprint[.]py/i
    )
    expect(PIPELINE_DISCIPLINE_INSTRUCTION).toContain('capacités réellement disponibles')
  })

  /**
   * Principe d'Autowin, énoncé par l'utilisateur le 2026-08-04 : « en UN prompt, on a un truc en
   * prod, parfait ». Un agent avait rendu la main sur « baseline rouge, 48 fichiers, remake
   * impossible » et proposé un choix voie A / voie B — alors que la suite était VERTE dans le
   * dépôt réel (3479/3479, exit 0) : le rouge venait de son environnement d'exécution. Deux fautes
   * en une : il a attribué une panne d'environnement au produit, et il s'est arrêté sur un
   * obstacle réparable. La consigne vit ici parce que ce bloc est injecté à TOUS les agents.
   */
  it('distingue un obstacle de chemin d un vrai blocage, et impose de le réparer', () => {
    expect(PIPELINE_DISCIPLINE_INSTRUCTION).toMatch(/OBSTACLE ≠ BLOCAGE/)
    expect(PIPELINE_DISCIPLINE_INSTRUCTION).toMatch(/RÉPARE-LE et poursuis/)
    // Les motifs d'arrêt LÉGITIMES restent nommés : sans eux la consigne dirait « ne t'arrête
    // jamais », ce qui pousserait un agent à forcer une action destructrice.
    expect(PIPELINE_DISCIPLINE_INSTRUCTION).toMatch(/destructrice ou irréversible/)
    expect(PIPELINE_DISCIPLINE_INSTRUCTION).toMatch(/droit dont tu ne disposes pas/)
  })

  it('ne relâche AUCUNE exigence de preuve en levant le blocage', () => {
    // Le risque de cette consigne est qu'un agent lise « ne t'arrête pas » comme « passe outre la
    // preuve ». Elle doit dire l'inverse, explicitement.
    expect(PIPELINE_DISCIPLINE_INSTRUCTION).toMatch(/relâche AUCUNE exigence de preuve/)
    expect(PIPELINE_DISCIPLINE_INSTRUCTION).toMatch(/déguiser reste interdit|ne déguise JAMAIS/)
  })

  it('impose de vérifier que le rouge vient du dépôt, pas de l environnement du run', () => {
    expect(PIPELINE_DISCIPLINE_INSTRUCTION).toMatch(/vient du DÉPÔT et non de ton environnement/)
  })
})
