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
   * Mesure du 2026-08-20 : sur 8 candidats repris a la main par l'utilisateur, DEUX etaient deja
   * corriges. La cause n'etait pas la negligence mais un piege de lecture — un COMMENTAIRE qui
   * raconte la cause passee se lit comme un defaut vivant, alors que le code au-dessus etait repare
   * et que son test existait. Le cout : un cycle scout + un cycle frame, et un message ecrit a la
   * main pour rien.
   *
   * CE TEST NE PROUVE PAS QUE LE SCOUT OBEIT — une regle dans un prompt n'est pas un garde-fou. Il
   * garantit seulement qu'on ne la retire pas en silence.
   */
  it("le brief scout exige de ROUVRIR l'ancrage et de prouver que le defaut est ouvert", () => {
    const scout = PHASE_BRIEFS.scout
    expect(scout).toContain('ANCRAGE ROUVERT')
    expect(scout).toMatch(/ouvre son ancrage file:line/iu)
    // Le piege nomme, pas seulement la consigne : une regle sans son motif se perd a la relecture.
    expect(scout).toMatch(/commentaire n.est pas un defaut/iu)
    // Et la conclusion actionnable : le silence plutot qu'un candidat mort.
    expect(scout).toMatch(/ne le liste pas/iu)
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

  /*
   * LES DEUX SOURCES DE CONSIGNE DU SCOUT NE DOIVENT PAS DIVERGER.
   *
   * Mesure du 21/08 : la regle « ancrage rouvert » a ete posee la veille dans le brief IN-APP, et le
   * `skills/scout/SKILL.md` du kit — modifie le meme jour par une autre session — n'en disait RIEN.
   * Un scout lance par le kit ne recevait donc pas la regle ; un scout in-app la recevait. C'est le
   * motif que ce depot collectionne : une capacite presente d'un cote, absente de l'autre, sans que
   * rien ne le signale.
   *
   * Ce test ne prouve pas que le scout OBEIT — une regle dans un prompt n'est pas un garde-fou. Il
   * garantit que la regle ne disparait pas d'UNE des deux sources en silence.
   */
  it('la règle d’ancrage rouvert existe DANS LES DEUX sources de consigne du scout', () => {
    const brief = PHASE_BRIEFS.scout
    const kit = readFileSync('skills/scout/SKILL.md', 'utf8')

    expect(brief).toContain('ANCRAGE ROUVERT')
    expect(kit).toContain('ANCHOR REOPENED')

    // Le MOTIF doit voyager avec la consigne, sinon elle se fait retirer a la premiere relecture.
    for (const source of [brief, kit]) {
      expect(source).toMatch(/commentaire n.est pas un defaut|comment is not a defect/iu)
      expect(source).toMatch(/ne le liste pas|do not list it/iu)
    }
  })

  /*
   * LA CLOTURE NEGATIVE, DANS LES DEUX SOURCES AUSSI.
   *
   * Mesure du 21/08 : sur 8 hypotheses de scout, 6 sont mortes du MEME defaut — un FAIT vrai (un grep
   * rend une absence reelle) suivi d'une CONSEQUENCE jamais verifiee (« donc rien ne fait X »). Les 2
   * survivantes portaient une affirmation POSITIVE et directement observable.
   *
   * La regle ne s'invente pas : le reflexe 10 de la constitution l'enonce deja pour les declarations
   * de BLOCAGE (enumerer / balayer / nommer ce qui a ete teste). Elle est ici RACCORDEE au Why d'un
   * candidat, qui est l'affirmation miroir. Ce test garde le raccord, pas l'obeissance.
   */
  it('la clôture négative existe DANS LES DEUX sources, avec ses trois couches', () => {
    const brief = PHASE_BRIEFS.scout
    const kit = readFileSync('skills/scout/SKILL.md', 'utf8')

    expect(brief).toContain('CLOTURE NEGATIVE')
    expect(kit).toContain('NEGATIVE CLOSURE')

    for (const source of [brief, kit]) {
      // Les mots du reflexe 10, pas une paraphrase : c'est ce qui rend le raccord reconnaissable.
      expect(source).toMatch(/ENUMERE|ENUMERATE/u)
      expect(source).toMatch(/BALAYE|SWEEP/u)
      expect(source).toMatch(/chemins FERMES|CLOSED paths/u)
      // Les TROIS couches nommees : sans elles, un grep peut encore passer pour un balayage.
      expect(source).toMatch(/TROIS couches|THREE deliberate layers/u)
      expect(source).toMatch(/SKILL\.md/u)
      expect(source).toMatch(/briefs in-app|in-app briefs/u)
      expect(source).toMatch(/ENGENDRES|GENERATED/u)
      // Et l'issue honnete : un balayage incomplet se DIT.
      expect(source).toMatch(/non epuises|not exhausted/u)
    }
  })

  /*
   * LE SCORE DOIT MESURER LA PREUVE, PAS LA CERTITUDE.
   *
   * Mesure du 21/08 : sur mes candidats de scout, 84 et 82 sont alles aux deux qui etaient FAUX, 66 a
   * un vrai. La confiance etait la plus haute exactement la ou la verification etait la plus faible —
   * un score non contraint classe donc la shortlist au ressenti.
   *
   * L'idiome n'est PAS invente : le SKILL.md plafonnait deja l'impact d'un candidat web sur une
   * premisse non verifiee (« impact-CAPPED — never 🟢 on an unverified premise »). La doctrine est
   * ELARGIE a tout Why deductif, pas dupliquee.
   */
  it('le plafond de preuve existe DANS LES DEUX sources, avec sa valeur et sa condition', () => {
    const brief = PHASE_BRIEFS.scout
    const kit = readFileSync('skills/scout/SKILL.md', 'utf8')

    expect(brief).toContain('PLAFOND DE PREUVE')
    expect(kit).toContain('PROOF CEILING')

    for (const source of [brief, kit]) {
      // La valeur du plafond, sinon la regle n'est pas actionnable.
      expect(source).toMatch(/50/u)
      // Ce qui declenche le plafond : une DEDUCTION, pas une observation directe.
      expect(source).toMatch(/DEDUCTION/u)
      // Et la sortie du plafond : nommer les chemins fermes.
      expect(source).toMatch(/chemins fermes|closed paths/iu)
    }
  })

  /*
   * La consigne scout est bornee a 3000 caracteres par le premier test de ce fichier. A 2897, il ne
   * reste que ~100 caracteres : la prochaine clause devra CONDENSER, pas ajouter. Ce test rend cette
   * marge VISIBLE au lieu de la laisser decouvrir par un rouge.
   */
  it('la consigne scout garde une marge annoncee sous son plafond', () => {
    const restant = 3000 - PHASE_BRIEFS.scout.length
    expect(restant).toBeGreaterThan(0)
    // Si ce test tombe, ce n'est pas un bug : c'est le signal qu'il faut condenser avant d'ajouter.
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
