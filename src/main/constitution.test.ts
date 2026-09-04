import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { CONSTITUTION } from './constitution'
import { PIPELINE_DISCIPLINE_INSTRUCTION } from './pipeline-discipline'

const SOURCE_CONSTITUTION = readFileSync(new URL('./constitution.ts', import.meta.url), 'utf8')

describe('CONSTITUTION (source unique du soul)', () => {
  it('reste portable entre providers et machines', () => {
    expect(CONSTITUTION).not.toMatch(/[A-Z]:\\Users\\|\/Users\/|~\/[.]claude|[.]brain/i)
    expect(CONSTITUTION).not.toMatch(/Hermes Agent|Claude Code/i)
    expect(CONSTITUTION).toContain('provider-neutral')
    // La section descriptive « Portabilité des capacités » a été retirée du texte INJECTÉ : son
    // seul contenu opérant vit dans la discipline de phase, qui est le bloc outillage.
    expect(PIPELINE_DISCIPLINE_INSTRUCTION).toContain('capacités réellement disponibles')
    expect(PIPELINE_DISCIPLINE_INSTRUCTION).toMatch(/n'invente jamais un outil/iu)
  })

  it('looks beyond the immediate request instead of stopping at minimum compliance', () => {
    expect(CONSTITUTION).toContain("inférer la destination probable de l'utilisateur")
    expect(CONSTITUTION).toContain('regarder un à deux coups plus loin')
    expect(CONSTITUTION).toContain("Le minimum conforme n'est pas une condition d'arrêt")
    expect(CONSTITUTION).toContain("n'autorise ni extension silencieuse du périmètre ni mutation non demandée")
    expect(CONSTITUTION).toContain("signal explicite de l'utilisateur ou d'un artefact observé")
    expect(CONSTITUTION).toContain('une seule extension concrète à forte valeur, en une phrase')
    expect(CONSTITUTION).toContain('sans lancer de nouvel outil ni de recherche supplémentaire')
    expect(CONSTITUTION).toContain('Une demande explicitement bornée')
    expect(CONSTITUTION).toContain("Un artefact peut confirmer un état, jamais définir à lui seul l'intention utilisateur")
    expect(CONSTITUTION).toContain('sécurité, accès, données personnelles ou secrets')
  })

  it("porte le mandat d'autonomie : une seule passe jusqu'au vert, sans relâcher la preuve", () => {
    expect(CONSTITUTION).toContain("Autonomie — une seule passe jusqu'au vert")
    expect(CONSTITUTION).toContain('un résultat VÉRIFIÉ ou un blocage NOMMÉ')
    expect(CONSTITUTION).toContain("plan sans exécution — est un ÉCHEC")
    expect(CONSTITUTION).toContain("se FABRIQUE ou se contourne toi-même si c'est sûr, borné et réversible")
    expect(CONSTITUTION).toContain('TOUTES traitées dans la passe')
    expect(CONSTITUTION).toContain('FAUX vert')
  })

  it("interdit de REMPLACER en silence la tâche énoncée", () => {
    expect(CONSTITUTION).toContain('la tâche ÉNONCÉE ne se REMPLACE pas en cours de route')
    expect(CONSTITUTION).toContain("l'énoncé reçu reste la cible jusqu'au bout")
    expect(CONSTITUTION).toContain('STOP et le DIRE')
    expect(CONSTITUTION).toContain('rend TOUT le résultat hors-sujet')
  })

  it("étend l'anti-pansement aux correctifs de COMPORTEMENT, cause localisée exigée", () => {
    expect(CONSTITUTION).toContain('forme comportementale de la rustine')
    expect(CONSTITUTION).toContain("tant que la cause n'est pas LOCALISÉE")
    expect(CONSTITUTION).toContain("« L'agent n'a pas pensé à X » n'est pas une cause")
    expect(CONSTITUTION).toContain('se choisit sur la CAUSE dès la PREMIÈRE fois')
    expect(CONSTITUTION).toContain('attendre une récidive')
  })

  it('annonce un nombre de réflexes ÉGAL à celui réellement listé, et la limite honnête', () => {
    const derniere = [...CONSTITUTION.matchAll(/^(\d+)\. /gmu)]
      .map((m) => Number(m[1]))
      .reduce((max, n) => Math.max(max, n), 0)

    expect(derniere).toBeGreaterThan(0)
    expect(CONSTITUTION).toContain(`Les ${derniere} réflexes`)
    expect(CONSTITUTION).not.toContain('Les 13 réflexes')
    expect(CONSTITUTION).toContain('La limite honnête')
  })

  it('rend Kaizen explicite et AUTONOME, garde-fou par réversibilité et non par accord humain', () => {
    expect(CONSTITUTION).toContain('éditions précises APPLIQUÉES directement')
    expect(CONSTITUTION).toContain('commit dédié')
    expect(CONSTITUTION).not.toContain('attente d’un accord humain')
  })

  it('se termine par un saut de ligne pour une concaténation sûre dans les prompts système', () => {
    expect(CONSTITUTION.endsWith('\n')).toBe(true)
  })

  /**
   * SYMPTOME NU — demande utilisateur du 2026-09-02, saisie ts=1788375433820 :
   * « je vais toujours faire que de lister des symptomes […] c'est a toi de t'adapter pour pas
   * perdre trop de temps et de token pour faire symptome -> fix ». Elle annule la preference
   * inverse posee a ts=1788351936324 (reclamer « je fais X, je vois Y, j'attendais Z »).
   */
  it('traite un symptome NU comme un rapport de bug complet, sans formulaire a remplir', () => {
    expect(CONSTITUTION).toContain('SYMPTÔME-HARD-GATE')
    expect(CONSTITUTION).toContain('est un rapport de bug COMPLET, pas un formulaire à faire remplir')
    expect(CONSTITUTION).toContain('la localisation est TON travail')
    expect(CONSTITUTION).toContain("Ne renvoie JAMAIS l'utilisateur décrire")
    expect(CONSTITUTION).toContain('APRÈS deux tentatives de localisation distinctes')
    // L'ancrage reste TRAÇABLE dans le fichier (commentaire), mais n'est plus PAYÉ à chaque
    // injection : c'est un justificatif pour un humain, pas un point de décision pour l'agent.
    expect(CONSTITUTION).not.toContain('ts=1788375433820')
    expect(SOURCE_CONSTITUTION).toContain('ts=1788375433820')
    expect(SOURCE_CONSTITUTION).toContain('ts=1788351936324')
  })
})
