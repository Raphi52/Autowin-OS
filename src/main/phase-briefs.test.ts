import { describe, expect, it } from 'vitest'
import { PHASE_BRIEFS, phaseBrief } from './phase-briefs'
import { PIPELINE_PHASES } from './skill-pipeline'

describe('phase-briefs (consignes courtes in-app)', () => {
  it('couvre les 6 phases avec un brief non vide et COURT', () => {
    for (const phase of PIPELINE_PHASES) {
      const b = PHASE_BRIEFS[phase]
      expect(b, phase).toBeTruthy()
      // Consigne = ~1-2k, jamais le pavé de 8-22k du SKILL.md brut.
      expect(b.length, phase).toBeGreaterThan(150)
      expect(b.length, phase).toBeLessThan(3000)
    }
  })
  it('le brief scout impose la colonne Score (table Score | Type | What | Why | How, tri décroissant)', () => {
    const scout = PHASE_BRIEFS.scout
    expect(scout).toContain('Score')
    // Colonnes dans l'ordre attendu, Score en tête.
    expect(scout).toMatch(/Score\b[^\n]*Type[^\n]*What[^\n]*Why[^\n]*How/)
    // Score agrégé /100 + tri décroissant explicites.
    expect(scout).toMatch(/\/100/)
    expect(scout).toMatch(/d[ée]croissant/i)
  })

  // Defaut vecu le 2026-08-18 (conv-1293) : le modele a rempli la colonne Score avec « 🟢 ».
  // Le brief disait « un seul nombre par ligne » — assez faible pour qu'une pastille passe.
  it('le brief scout exige un ENTIER dans Score, pas une pastille', () => {
    const scout = PHASE_BRIEFS.scout
    expect(scout).toMatch(/ENTIER/)
    expect(scout).toMatch(/en chiffres/)
    expect(scout).toMatch(/Jamais une pastille/)
  })

  it('le brief frame exige un inventaire de confiance ADOSSÉ À DES PREUVES, pas un ressenti', () => {
    const frame = PHASE_BRIEFS.frame

    // La section est un livrable, pas une suggestion.
    expect(frame).toContain('## Confiance')
    // Les trois états d'une affirmation, dont celui qui oblige à nommer sa source.
    expect(frame).toMatch(/VÉRIFIÉ/)
    expect(frame).toMatch(/NON VÉRIFIÉ/)
    // Le cœur : une affirmation vérifiée NOMME l'artefact ouvert — le garde-fou anti-hallucination.
    expect(frame).toMatch(/NOMME l'artefact/)
    // Et l'obligation de RÉSOUDRE, pas seulement de signaler.
    expect(frame).toMatch(/RÉSOUS/)
    expect(frame).toMatch(/jamais un fait silencieux/)
  })

  it('phaseBrief enveloppe la consigne avec un en-tête de phase', () => {
    expect(phaseBrief('scout')).toContain('=== CONSIGNE SCOUT ===')
    expect(phaseBrief('scout')).toContain('SCOUT')
  })

  it('les phases d analyse savent que la lecture seule est leur contrat normal', () => {
    for (const phase of ['scout', 'frame', 'terrain'] as const) {
      expect(PHASE_BRIEFS[phase], phase).toMatch(/lecture seule/i)
      expect(PHASE_BRIEFS[phase], phase).toMatch(/pas un blocage/i)
      expect(PHASE_BRIEFS[phase], phase).toMatch(/tu n'es pas BUILD/i)
    }
  })

  // Defaut vecu le 2026-08-17 (conv-1286) : 21 tours utilisateur pour une demande d'un tour. BUILD a
  // rendu la main trois fois sur des blocages qu'il s'etait inventes — « vazy » declare
  // « n'identifie aucun dossier cible » alors que le tour precedent nommait l'action, un id de run
  // absent du depot traite comme un mur, et « reessaye en boucle » interprete comme une reecriture du
  // moteur de retry au lieu d'une reprise de la tache. Le brief autorisait « si bloque, dis bloque »
  // sans jamais borner QUAND un blocage est legitime.
  it('le brief build borne le droit de se declarer bloque', () => {
    const build = PHASE_BRIEFS.build

    // Une demande elliptique herite de l'intention du tour precedent, elle ne la redemande pas.
    expect(build).toMatch(/ELLIPTIQUE/)
    expect(build).toMatch(/RECOMMANDATION du tour pr[ée]c[ée]dent/)
    // Interdiction de rendre la main sur une question derivable.
    expect(build).toMatch(/Ne termine JAMAIS un tour sur une question/)
    expect(build).toMatch(/[ÉE]CRIS l'hypoth[èe]se/)
    // « Introuvable » et « un outil a echoue » ne sont pas des murs.
    expect(build).toMatch(/"Introuvable" n'est pas "bloqu[ée]"/)
    expect(build).toMatch(/n'est pas un mur/)
    // Un blocage exige l'inventaire de ce qui a ete reellement sonde.
    expect(build).toMatch(/[ÉE]NUM[ÈE]RE l'espace atteignable/)
    expect(build).toMatch(/NOMME ce qui a [ée]t[ée] sond[ée]/)
  })

  it('kaizen couvre les mécanismes propres à Autowin et reste en proposition', () => {
    const brief = phaseBrief('kaizen')
    expect(brief).toContain('conversation')
    expect(brief).toContain('worktree')
    expect(brief).toContain('RAG')
    expect(brief).toContain('coût')
    expect(brief).toMatch(/ne modifie|lecture seule/i)
  })
  it('ne contient pas de renvois kit qui pendouillent (ENGINE Ch., [[fiche]], → autre-skill)', () => {
    for (const phase of PIPELINE_PHASES) {
      expect(PHASE_BRIEFS[phase], phase).not.toMatch(/ENGINE Ch\.|\[\[|→ `\w+`/)
    }
  })
})
