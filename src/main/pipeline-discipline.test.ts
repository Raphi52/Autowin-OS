// fix-ok: cause mesurée — la même règle vivait en double (constitution + consignes d'étape/style), redites relevées dans le prompt injecté ; fusion vers la constitution, tests rouges→verts dans phase-briefs/pipeline-discipline/response-style.test.ts
import { CONSTITUTION } from './constitution'
import { describe, expect, it } from 'vitest'
import { VUES_CONNUES } from '../../scripts/ui-capture.mjs'
import { PIPELINE_DISCIPLINE_INSTRUCTION } from './pipeline-discipline'

describe('discipline de pipeline canonique', () => {
  it('annonce la preuve UI dans une instance cachée par défaut (conv-526)', () => {
    expect(PIPELINE_DISCIPLINE_INSTRUCTION).toContain("PAR DÉFAUT il travaille dans une instance CACHÉE")
    expect(PIPELINE_DISCIPLINE_INSTRUCTION).toContain('--fenetre-reelle')
  })

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
    // Fusion 2026-09-18 : la partie générale vit dans « Autonomie » de la CONSTITUTION
    // (injectée avec ce bloc) ; ici ne reste que ce qui dépend de la phase.
    expect(CONSTITUTION).toMatch(/n'est PAS la tâche/)
    // Les motifs d'arrêt LÉGITIMES restent nommés : sans eux la consigne dirait « ne t'arrête
    // jamais », ce qui pousserait un agent à forcer une action destructrice.
    expect(CONSTITUTION).toMatch(/destructrice ou irréversible/)
    expect(CONSTITUTION).toMatch(/droit dont tu ne disposes pas/)
  })

  it('ne relâche AUCUNE exigence de preuve en levant le blocage', () => {
    // Le risque de cette consigne est qu'un agent lise « ne t'arrête pas » comme « passe outre la
    // preuve ». Elle doit dire l'inverse, explicitement.
    expect(CONSTITUTION).toMatch(/ne relâche AUCUNE preuve/)
    expect(PIPELINE_DISCIPLINE_INSTRUCTION).toMatch(/déguiser reste interdit|ne déguise JAMAIS/)
  })

  it('impose de vérifier que le rouge vient du dépôt, pas de l environnement du run', () => {
    expect(CONSTITUTION).toMatch(/vient du DÉPÔT et non de ton environnement/)
    expect(PIPELINE_DISCIPLINE_INSTRUCTION).not.toMatch(/vient du DÉPÔT et non de ton environnement/)
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

  /**
   * La consigne annoncait « Tu n'as PAS d'acces web » alors que `claude.ts` charge WebFetch et
   * WebSearch sur TOUTES les branches de spawn (`const OUTILS_WEB`, verrouille par
   * `providers/claude.web.test.ts`). Un agent qui croit ne pas avoir le web devine au lieu d'aller
   * lire : exactement le defaut que l'ouverture du web visait a supprimer.
   */
  it('ne nie pas une capacite reellement servie : le web', () => {
    expect(PIPELINE_DISCIPLINE_INSTRUCTION).not.toMatch(/n'as PAS d'accès web/i)
    expect(PIPELINE_DISCIPLINE_INSTRUCTION).toMatch(/WebFetch et WebSearch/)
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
      /échec du résultat que l'outillage de ta phase ne permet pas de réparer/
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

  /**
   * LA LISTE DES VUES ANNONCEE DOIT ETRE CELLE QUE LE HARNAIS ACCEPTE.
   *
   * Defaut mesure le 2026-09-09 : la consigne annoncait 8 vues (`chat, agent-studio, knowledge,
   * observatory, task-manager, worktree, tickets, settings`) la ou `scripts/ui-capture.mjs` en
   * accepte 10 — `accueil` et `tests` manquaient. Consequence directe et non theorique : le gate
   * `visual-proof-missing` (src/main/gates/hooks.ts) TUE un run qui touche `src/renderer/**` sans
   * capture lue, et un agent ne demande jamais une vue que son prompt ne nomme pas. Un run sur
   * l'Accueil etait donc condamne a un refus pour une preuve declaree hors de portee alors qu'elle
   * etait a portee — c'est exactement le reproche emis par le controle final de conv-46
   * (« aucune preuve visuelle, alors qu'elle etait possible »).
   *
   * La cause n'est pas « l'agent n'y a pas pense » : c'est une liste DUPLIQUEE en prose, qui a
   * deja derive une fois (cf. le commentaire de `VUES_CONNUES`, ligne 52 du harnais). Ce test est
   * le garde-fou : il croise le TEXTE injecte avec la source de verite executable, donc toute
   * vue ajoutee au harnais sans etre annoncee rend ce test rouge.
   */
  it('annonce EXACTEMENT les vues que le harnais de capture accepte', () => {
    const enumeration = PIPELINE_DISCIPLINE_INSTRUCTION.match(/vues\s*:\s*([^.]+)\./)
    expect(enumeration, 'la consigne doit enumerer les vues capturables').not.toBeNull()

    const annoncees = String(enumeration?.[1] ?? '')
      .split(',')
      .map((vue) => vue.trim())
      .filter(Boolean)

    // Egalite d'ENSEMBLE : ni vue manquante (preuve declaree hors de portee), ni vue inventee
    // (l'agent la demanderait et le harnais la refuserait).
    expect([...annoncees].sort()).toEqual([...VUES_CONNUES].sort())
  })
})

describe('fusion 2026-09-18 — chaque regle a un seul endroit', () => {
  it('LECTURE CIBLÉE renvoie au réflexe 11 au lieu de le redire', () => {
    expect(PIPELINE_DISCIPLINE_INSTRUCTION).toMatch(/LECTURE CIBLÉE : réflexes 6 et 11/)
    expect(PIPELINE_DISCIPLINE_INSTRUCTION).not.toMatch(/jamais un dump de l'arbre entier/)
    expect(CONSTITUTION).toMatch(/lecture CIBLÉE/)
    // Seul apport propre à la phase, gardé ici :
    expect(PIPELINE_DISCIPLINE_INSTRUCTION).toMatch(/scout DOIT survoler la cible/)
  })

  it('la preuve hors-modèle de BUILD renvoie au réflexe 2 sans le recopier', () => {
    expect(PIPELINE_DISCIPLINE_INSTRUCTION).toMatch(/4\. BUILD — .*réflexe 2/)
    expect(PIPELINE_DISCIPLINE_INSTRUCTION).not.toMatch(/4\. BUILD — .*test rouge→vert, exit-code, capture lue/)
  })

  it('n impose plus le mot « livrable » que le profil de réponse interdit', () => {
    expect(PIPELINE_DISCIPLINE_INSTRUCTION).not.toMatch(/livrable/i)
    expect(PIPELINE_DISCIPLINE_INSTRUCTION).toMatch(/RÉSULTAT : produis EXACTEMENT/)
  })
})
