import { describe, expect, it } from 'vitest'
import { CLASSES_PAGES_HTML } from '../../shared/classes-pages-html'
import { chargerSkillPourLeModele } from '../commands/skill-charger-command'
import {
  REGLES_ECRAN_UTILISATEUR,
  REGLES_VISUELLES,
  SKILL_MISE_EN_FORME,
  buildChatPilotagePrompt,
  tourTouchantAuVisuel
} from './chat-pilotage-prompt'

/**
 * MESURE (2026-09-16, trace prompt-observability) : le prompt systeme du chat pesait
 * 16 982 tokens envoyes a CHAQUE tour — constitution 4 004, pilotage 10 942, style 2 037. Dans le
 * pilotage, 1 874 tokens ne servent qu'aux tours qui touchent a l'interface ou capturent un ecran
 * (preuve visuelle, bureau cache, bissection, maquette tenue). Sur une question de code ou une
 * discussion, ils occupent la fenetre pour rien.
 *
 * Ce test tient les DEUX bouts : le corps du pilotage ne les porte plus, et le bloc extrait les
 * porte toujours en entier — sinon « alleger » voudrait dire « perdre une regle ».
 */
describe('regles visuelles conditionnelles', () => {
  it('sort les regles de travail visuel du corps du pilotage', () => {
    const prompt = buildChatPilotagePrompt([])
    expect(prompt).not.toContain('PREUVE VISUELLE FRONT')
    expect(prompt).not.toContain('BISSECTION VISUELLE')
    expect(prompt).not.toContain("ECRAN DE L'UTILISATEUR = SON ESPACE")
    expect(prompt).not.toContain('MAQUETTE MONTRÉE = MAQUETTE TENUE')
    expect(prompt).not.toContain('OBSERVE A LA TAILLE')
  })

  it('garde dans le bloc extrait chacune des regles deplacees', () => {
    for (const regle of ['MAQUETTE MONTRÉE = MAQUETTE TENUE', 'PREUVE VISUELLE FRONT']) {
      expect(REGLES_VISUELLES).toContain(regle)
    }
    // kaizen : les regles de l'ecran de l'utilisateur ont quitte le bloc CONDITIONNEL pour
    // un bloc servi a chaque tour — elles ne sont pas perdues, elles sont ailleurs.
    // « Erreur du bureau caché » a quitté ce bloc (revue 2026-11-06) : description de l'outil.
    for (const regle of ["ECRAN DE L'UTILISATEUR = SON ESPACE"]) {
      expect(REGLES_VISUELLES).not.toContain(regle)
      expect(REGLES_ECRAN_UTILISATEUR).toContain(regle)
    }
  })

  /**
   * Ce qui regit la FORME de TOUTE reponse reste inconditionnel : le bloc html-render, les
   * diagrammes mermaid et les controles natifs servent aussi a expliquer un bug de base de donnees.
   * L'utilisateur veut ces blocs SPONTANEMENT : le declencheur de chacun, la direction et les
   * classes restent donc dans le corps servi a chaque tour.
   */
  it('laisse les regles de FORME de reponse dans le corps inconditionnel', () => {
    const prompt = buildChatPilotagePrompt([])
    expect(prompt).toContain('EXPRESSION VISUELLE')
    expect(prompt).toContain('DIAGRAMMES')
    expect(prompt).toContain('INTERACTIF SANS JAVASCRIPT')
    for (const bloc of [
      '```html-render',
      '```aw-tableau',
      '```aw-comparaison',
      '```aw-etapes',
      '```mermaid',
      '```html-interactif'
    ])
      expect(prompt).toContain(bloc)
    expect(prompt).toContain('« transparence totale »')
    for (const { classe } of CLASSES_PAGES_HTML) expect(prompt).toContain(classe)
  })

  /**
   * Le DETAIL des formats (JSON des blocs, page interactive et son apercu, types de diagrammes) ne
   * passe pas par ce bloc conditionnel : il dependrait d'un mot du message, alors que c'est le choix
   * de format du MODELE qui le demande. Il part par `skill_charger`, que la consigne nomme, et
   * n'entre dans aucun bloc systeme — le systeme reste identique d'un tour a l'autre.
   */
  it('sert le detail des formats par skill_charger, jamais dans un bloc systeme', () => {
    const prompt = buildChatPilotagePrompt([])
    expect(prompt).toContain(`\`skill_charger\` (${SKILL_MISE_EN_FORME})`)
    const detail = chargerSkillPourLeModele({ nom: SKILL_MISE_EN_FORME }).procedure
    for (const marque of ['"colonnes"', 'html-interactif-apercu', 'sankey-beta', '<meter>']) {
      expect(detail).toContain(marque)
      expect(prompt).not.toContain(marque)
      expect(REGLES_VISUELLES).not.toContain(marque)
    }
  })

  it('reconnait un tour qui touche a l interface ou a une capture', () => {
    for (const message of [
      'le bouton de la sidebar est mal aligné',
      'fais une capture de l écran',
      'change la couleur du titre en or',
      'ouvre ContosoV3 et regarde la fenêtre',
      'refais l icône de l app',
      'le CSS du tableau déborde',
      'montre-moi une maquette du menu',
      // Tour 287a8f1e-0b71-48d5-a38e-fbb3e756cd43 : les images n'ouvraient pas le bloc
      'analyse cette image',
      'que vois-tu sur cette photo ?',
      'lis rendu.png et dis-moi ce qui cloche'
    ]) {
      expect(tourTouchantAuVisuel(message)).toBe(true)
    }
  })

  it('se declenche sur une image jointe meme sans mot visuel, et nomme la procedure look', () => {
    expect(tourTouchantAuVisuel('et ça ?', true)).toBe(true)
    expect(tourTouchantAuVisuel('et ça ?')).toBe(false)
    expect(REGLES_VISUELLES).toContain('skills/look/SKILL.md')
  })

  it('ne le declenche pas sur un tour sans rapport avec l ecran', () => {
    for (const message of [
      'pourquoi la requête SQL renvoie deux lignes ?',
      'commit et push sur main',
      'combien de tests dans le dépôt ?',
      'retiens que le client impose une facture mensuelle',
      // FAUX POSITIF VECU (tour de reprise du 2026-09-16 a 16:51) : cette consigne
      // ne parlait que de tailles de blocs de prompt, et le mot « style » a suffi a servir les
      // 3 966 caracteres du bloc visuel. Trace : prompt-observability/conv-614.jsonl.
      'compare les blocs a la reference : constitution 15349, pilotage 42882, style 8142',
      'lis le dernier enregistrement de la trace et rapporte les tailles en caracteres'
    ]) {
      expect(tourTouchantAuVisuel(message)).toBe(false)
    }
  })

  /**
   * Le bloc doit rester un SUFFIXE : on mesure ici qu'il pese assez pour valoir la peine, et qu'il
   * ne s'est pas mis a contenir la moitie du pilotage par derive. Mesure du 2026-09-16 : 3 966
   * caracteres, soit ~1 000 tokens economises sur tout tour qui ne touche ni a l'interface ni a
   * une capture.
   */
  it('pese une part utile mais minoritaire du pilotage', () => {
    const corps = buildChatPilotagePrompt([]).length
    // 2 993 caracteres apres le depart des regles de l'ecran (2026-09-26).
    expect(REGLES_VISUELLES.length).toBeGreaterThan(2500)
    expect(REGLES_VISUELLES.length).toBeLessThan(corps / 2)
  })
})
