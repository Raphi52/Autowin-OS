import { readFileSync } from 'node:fs'
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
  // Mesure du 2026-08-18 : le brief INTERDISAIT la pastille en l'AFFICHANT, et l'historique de la
  // conversation active portait 16 lignes a pastille pour 0 chiffree. Un exemple negatif ancre le
  // motif qu'il pretend bannir ; le modele recopie ce qu'il voit. Le brief ne montre donc plus AUCUNE
  // pastille, et porte une ligne d'exemple CHIFFREE a imiter.
  it('ne montre aucune pastille de couleur, et donne un exemple chiffre', () => {
    const scout = PHASE_BRIEFS.scout
    for (const pastille of ['🟢', '🟡', '🔴']) {
      expect(scout, 'le brief ne doit pas afficher ' + pastille).not.toContain(pastille)
    }
    // Les emojis de TYPE restent : eux sont voulus dans la colonne Type.
    expect(scout).toContain('🔧')
    // Une ligne d'exemple avec un vrai nombre, que le modele peut imiter.
    expect(scout).toMatch(/\|\s*\d{2}\s*\|/)
  })

  it('le brief scout exige un ENTIER dans Score, pas une pastille', () => {
    const scout = PHASE_BRIEFS.scout
    expect(scout).toMatch(/ENTIER/)
    expect(scout).toMatch(/en chiffres/)
    // La formulation NEGATIVE (« jamais une pastille ») a ete remplacee le 2026-08-18 par la raison
    // positive : elle disait quoi eviter en MONTRANT ce qu'il fallait eviter, ce qui ancrait le motif.
    expect(scout).toMatch(/TRIABLE/)
  })

  /*
   * LA PREUVE AVANT LA LISTE, DANS LES DEUX SENS — un seul bloc, quatre exigences.
   *
   * Mesure des 20 et 21/08 : sur 8 hypotheses de scout, SIX sont mortes du meme defaut — un FAIT vrai
   * (un grep rend une absence reelle) suivi d'une CONSEQUENCE jamais verifiee. Les 2 survivantes
   * portaient une affirmation POSITIVE et directement observable. Et le SCORE classait a l'envers :
   * 84 et 82 aux deux candidats FAUX, 66 a un vrai.
   *
   * Le bloc a ete UNIFIE plutot qu'empile : le cas « defaut absent » et le cas « defaut deja corrige »
   * sont la MEME regle dans les deux sens, donc les dire ensemble couvre plus en ecrivant moins — les
   * deux sources ont RETRECI (brief 1528 -> 1252, kit 1772 -> 1422) en gagnant une exigence.
   *
   * Aucune des quatre n'est inventee : (1) vivait deja dans le brief sans etre dans le kit, (2) est le
   * reflexe 10 de la constitution raccorde au Why, (4) elargit le plafonnement que le kit appliquait
   * deja au seul candidat web. Ce test garde le RACCORD dans les deux sources, jamais l'obeissance.
   */
  it('la preuve avant la liste existe DANS LES DEUX sources, dans les deux sens', () => {
    const brief = PHASE_BRIEFS.scout
    const kit = readFileSync('skills/scout/SKILL.md', 'utf8')

    for (const source of [brief, kit]) {
      // Le fait : rouvrir l'ancrage, et le piege du commentaire qui raconte une cause passee.
      expect(source).toMatch(/ANCRAGE ROUVERT|ANCHOR REOPENED/u)
      expect(source).toMatch(/COMMENTAIRE|COMMENT/u)
      // La deduction : les mots du reflexe 10, et les TROIS couches.
      expect(source).toMatch(/ENUMERE|ENUMERATE/u)
      expect(source).toMatch(/BALAYE|SWEEP/u)
      expect(source).toMatch(/chemins FERMES|CLOSED paths/u)
      expect(source).toMatch(/TROIS|THREE/u)
      expect(source).toMatch(/non epuises|not exhausted/u)
      // Le SENS INVERSE : ecarter est une conclusion, donc une preuve.
      expect(source).toMatch(/SENS INVERSE|REVERSE DIRECTION/u)
      expect(source).toMatch(/ECARTER|DISCARD/iu)
      // Le classement : un Why deductif est plafonne, et la valeur est dite.
      expect(source).toMatch(/PLAFOND DE PREUVE|PROOF CEILING/u)
      expect(source).toMatch(/DEDUCTIF|DEDUCTIVE/iu)
      expect(source).toMatch(/50/u)
    }
  })

  /*
   * La consigne scout est bornee a 3000 caracteres par le premier test de ce fichier. L'unification a
   * ramene la marge de 103 a ~380 caracteres : ce test la rend VISIBLE avec son chiffre exact, au lieu
   * de laisser la limite se decouvrir par un rouge opaque sur le fichier le plus edite de la journee.
   */
  it('la consigne scout garde une marge annoncee sous son plafond', () => {
    const restant = 3000 - PHASE_BRIEFS.scout.length
    expect(restant).toBeGreaterThan(0)
    // Si ce test tombe, ce n'est pas un bug : c'est le signal qu'il faut CONDENSER avant d'ajouter.
    expect(
      restant,
      `marge restante sous le plafond de 3000 : ${restant} caracteres`
    ).toBeGreaterThan(60)
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

  // conv-1302 : 4 runs juges 96/100 sur un AUTRE fichier que la cible ancree par l'utilisateur.
  // Le gate ne bloque que le miss TOTAL ; la couverture partielle, c'est le juge qui la releve.
  it('le brief juge exige la matrice cible demandee -> fichier modifie -> preuve DoD', () => {
    const juge = PHASE_BRIEFS.judge
    expect(juge).toMatch(/cible\s+demandee\s*->\s*fichier\s+modifie\s*->\s*preuve\s+DoD/i)
    expect(juge).toMatch(/chemin:ligne/)
    // `every` : TOUTE cible ancree non couverte doit etre signalee, pas seulement le miss total.
    expect(juge).toMatch(/TOUTE cible ancree non couverte/)
    expect(juge).toMatch(/couverture partielle/i)
  })
})
