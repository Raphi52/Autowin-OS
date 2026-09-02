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
    expect(PIPELINE_DISCIPLINE_INSTRUCTION).toMatch(/répare-le et poursuis/i)
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

  /**
   * Première rédaction RÉFUTÉE par l'audit : elle ordonnait à TOUTE phase de réparer l'obstacle,
   * alors que la ligne OUTILLAGE RÉEL du même bloc dit qu'une phase de lecture seule n'a ni Bash ni
   * Edit ni Write. Un scout recevait donc l'ordre de rendre une baseline verte sans aucun outil de
   * mutation — poussé vers un blocage muet ou un vert non prouvé. Et la phase JUDGE recevait deux
   * ordres opposés : « dis bloqué en cas d'échec » et « ne rends pas la main ».
   */
  it('ne demande de réparer QU aux phases outillées, et laisse une issue aux autres', () => {
    expect(PIPELINE_DISCIPLINE_INSTRUCTION).toMatch(/SI TA PHASE DISPOSE DES OUTILS DE MUTATION/)
    expect(PIPELINE_DISCIPLINE_INSTRUCTION).toMatch(/SI TA PHASE EST EN LECTURE SEULE/)
    // L'issue de la lecture seule : nommer l'obstacle dans le livrable, ni réparer ni taire.
    // Mais Bash lui reste ouvert (conv-155, tour 20f856a2-8dd5-4e78-b98b-f7c7319afd12 : un juge
    // sans shell a note du texte au lieu de lancer les tests) : la consigne doit dire que toute
    // phase peut EXECUTER, et que seule l'ECRITURE de fichiers distingue build/clean.
    expect(PIPELINE_DISCIPLINE_INSTRUCTION).toMatch(
      /TOUTES les phases disposent de Read, Grep, Glob ET Bash/
    )
    expect(PIPELINE_DISCIPLINE_INSTRUCTION).not.toMatch(/Read\/Grep\/Glob uniquement/)
    expect(PIPELINE_DISCIPLINE_INSTRUCTION).toMatch(/tu NOMMES l'obstacle/)
  })

  it('ne transforme pas le contrat read-only de scout frame terrain en faux blocage', () => {
    expect(PIPELINE_DISCIPLINE_INSTRUCTION).toMatch(
      /absence de Write\/Edit n'est ni un obstacle ni un droit manquant/i
    )
    expect(PIPELINE_DISCIPLINE_INSTRUCTION).toMatch(/ne la mentionne pas comme un blocage/i)
  })

  it('reconcilie la regle avec la phase JUDGE au lieu de la contredire', () => {
    // Le « bloqué » de JUDGE doit rester un cas de rendu de main EXPLICITEMENT autorisé.
    expect(PIPELINE_DISCIPLINE_INSTRUCTION).toMatch(
      /échec du livrable que l'outillage de ta phase ne permet pas de réparer/
    )
    expect(PIPELINE_DISCIPLINE_INSTRUCTION).toMatch(/JUDGE dit « bloqué », et il reste obligatoire/)
  })

  /**
   * Mesure du 2026-08-28 (chantier « spinner », conv-1507 puis conv-1498) : le prompt annoncait un
   * harnais de capture FIXE comme LA preuve UI. Le producteur s'en est servi, l'a cite, et a
   * declare correcte une animation qui ne bougeait pas — une image immobile ne peut pas dire si ce
   * qu'elle montre tourne. L'utilisateur a du le signaler lui-meme.
   *
   * Un outil que le prompt ne nomme pas n'est jamais appele : le gate `motion-proof` serait un mur
   * sans porte si l'instrument qui le leve n'etait pas annonce ici.
   */
  it('annonce l instrument qui prouve le MOUVEMENT, pas seulement la capture fixe', () => {
    expect(PIPELINE_DISCIPLINE_INSTRUCTION).toContain('--motion')
    // Et il doit dire POURQUOI, sinon il sera lu comme une option decorative.
    expect(PIPELINE_DISCIPLINE_INSTRUCTION).toMatch(/capture fixe ne (?:peut|prouve)/i)
  })
})
