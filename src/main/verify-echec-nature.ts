/**
 * DE QUELLE NATURE EST L'ECHEC D'UNE VERIFICATION DE BUREAU ?
 *
 * DEFAUT VECU le 2026-08-25 (conv-1404). Un tour a edite `WorkflowsPanel.tsx` pour remplacer un
 * `<details>/<summary>` par des `<div>`, en laissant des balises fermantes qui ne correspondaient
 * plus. La verification du bureau a echoue sur une erreur de TRANSFORMATION esbuild -- du code qui
 * ne compile pas, pas un test rouge. Mais le message rendu a l'agent etait generique :
 * « Verification du bureau echouee (vitest related ...) ». Il l'a lu comme « ma modification casse
 * un test », a retente une correction de CONTENU, et a reproduit la meme faute de balises. HUIT
 * fois, jusqu'a ce que le budget d'appels coupe le tour a 12 -- travail perdu, demande perdue.
 *
 * Les deux natures appellent des gestes OPPOSES : un test rouge se corrige en changeant la logique ;
 * une erreur de syntaxe se corrige en RELISANT les balises autour de la ligne fautive. Les
 * confondre garantit la boucle, et aucun plafond ne repare ca -- il ne fait que deplacer le mur.
 *
 * Ce module ne classe QUE ce qu'il reconnait avec un marqueur non ambigu. `inconnue` est une
 * reponse legitime : deviner une nature ferait pire que le message generique qu'on remplace.
 */

import { VERIFY_PLAFOND_MARQUEUR } from './verify-command'

export type NatureEchec = 'syntaxe' | 'tests' | 'timeout' | 'inconnue'

export interface EchecClasse {
  nature: NatureEchec
  /** Le geste attendu, DIT a l'agent. Vide quand la nature est inconnue : on n'invente pas. */
  consigne: string
}

/**
 * Marqueur esbuild/vite, seul juge de la nature « syntaxe ».
 *
 * Delibrement etroit : le mot « error » seul ne suffit PAS. Un test qui verifie qu'une erreur est
 * lisible contient le mot sans etre un echec de transformation, et le reclasser enverrait l'agent
 * relire des balises la ou un test attend une correction de logique.
 */
const MARQUEUR_TRANSFORMATION = /Transform failed|Failed to parse source|Expression expected|Unexpected closing|Unterminated/i

/** `chemin.tsx:203:18: ERROR: <ce qui cloche>` — l'emplacement exact, celui qu'il faut relire. */
const EMPLACEMENT = /([\w.@-]+\.(?:mts|cts|tsx|ts|jsx|js)):(\d+):(\d+):\s*(?:ERROR:\s*)?(.+)/g

const MARQUEUR_TESTS = /Tests\s+\d+\s+failed|AssertionError|✕|×\s|FAIL\s/

/**
 * CausalHypothesis (verifiee, conv-1410) : une sortie de PLAFOND contient « ce que la suite avait
 * ecrit avant d'etre coupee », donc des lignes `× …`. `MARQUEUR_TESTS` matchait, et la consigne
 * rendue en TETE disait « corrige la logique » juste au-dessus de « rien n'est prouve ». Les deux
 * `edit_file` du 26/08 sur `home-decor-scene.ts` sont partis dans cette contradiction et ont ete
 * perdus avec leur bureau.
 *
 * Un plafond est une TROISIEME nature, et la seule dont le geste n'est pas une correction : il n'y
 * a rien a corriger tant qu'aucun verdict n'a ete rendu. Le marqueur vit dans `verify-command`, a
 * cote de la phrase qu'il reconnait, pour que les deux ne derivent pas.
 */
const MARQUEUR_PLAFOND = VERIFY_PLAFOND_MARQUEUR

function emplacements(sortie: string): string[] {
  const trouves: string[] = []
  for (const [, fichier, ligne, , detail] of sortie.matchAll(EMPLACEMENT)) {
    const propre = detail.trim()
    trouves.push(`${fichier}:${ligne} — ${propre}`)
    // Au-dela, la consigne cesse d'etre lisible : les premieres suffisent a localiser la faute.
    if (trouves.length >= 4) break
  }
  return trouves
}

export function natureDeLEchec(sortie: string): EchecClasse {
  if (MARQUEUR_TRANSFORMATION.test(sortie)) {
    const ou = emplacements(sortie)
    const localisation = ou.length
      ? ` Emplacements : ${ou.join(' · ')}.`
      : ''
    return {
      nature: 'syntaxe',
      consigne:
        `Ton edition a produit du code qui ne compile pas — rien n'a ete execute.` +
        `${localisation}` +
        ` Relis le fichier autour de ces lignes et equilibre les balises avant de re-editer :` +
        ` reprendre la meme edition reproduira la meme faute.`
    }
  }
  /*
   * APRES la syntaxe, AVANT les tests. Une faute de compilation visible dans une sortie coupee est
   * reelle et actionnable — le plafond ne l'efface pas. Les coches d'une sortie coupee, elles, ne
   * prouvent rien : la suite n'est pas allee au bout, et les rouges deja tombes peuvent tout autant
   * appartenir a une base deja rouge qu'a l'edition.
   */
  if (MARQUEUR_PLAFOND.test(sortie))
    return {
      nature: 'timeout',
      consigne:
        `La verification a ete coupee au plafond : aucun verdict n'a ete rendu, donc il n'y a` +
        ` rien a corriger — ni la logique, ni la syntaxe. Les rouges visibles ci-dessous sont` +
        ` partiels et peuvent appartenir a la base. Reduis la PORTEE au lieu de re-editer.`
    }
  if (MARQUEUR_TESTS.test(sortie))
    return {
      nature: 'tests',
      consigne: `Le code compile, mais un test echoue — corrige la logique, pas la syntaxe.`
    }
  return { nature: 'inconnue', consigne: '' }
}
