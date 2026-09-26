import { describe, expect, it } from 'vitest'
import {
  extrairePromptSuivant,
  retirerLignePromptSuivant,
  estPromptDePublication,
  PROMPT_SALVAGE
} from './prompt-suivant'

const LIGNE = 'AUTOWIN_PROMPT_V1: Lance le terrain sur le build du pari.'

describe('extraction du prompt suivant', () => {
  it('lit le prompt émis en fin de tour', () => {
    expect(extrairePromptSuivant(`travail fait\n${LIGNE}`)).toBe(
      'Lance le terrain sur le build du pari.'
    )
  })

  it('rend null quand aucun prompt n’a été émis', () => {
    expect(extrairePromptSuivant('👉 **Recommandé** — passer en terrain')).toBeNull()
  })

  it('retient le DERNIER prompt si le modèle en émet deux', () => {
    expect(
      extrairePromptSuivant('AUTOWIN_PROMPT_V1: le premier\nAUTOWIN_PROMPT_V1: le second')
    ).toBe('le second')
  })

  it('IGNORE un marqueur cité dans un bloc de code — un exemple n’est pas une consigne', () => {
    const texte = 'Format :\n```\nAUTOWIN_PROMPT_V1: ceci est un exemple\n```\nfin'
    expect(extrairePromptSuivant(texte)).toBeNull()
  })

  it('refuse un prompt vide ou réduit à de la ponctuation', () => {
    expect(extrairePromptSuivant('AUTOWIN_PROMPT_V1:    ')).toBeNull()
    expect(extrairePromptSuivant('AUTOWIN_PROMPT_V1: —')).toBeNull()
  })

  it('borne un prompt délirant plutôt que de remplir le composer d’un pavé', () => {
    const long = 'a'.repeat(1200)
    const lu = extrairePromptSuivant(`AUTOWIN_PROMPT_V1: ${long}`)
    expect(lu).not.toBeNull()
    expect((lu as string).length).toBeLessThanOrEqual(600)
  })

  it('retire le gras et les accents graves du markdown, un composer n’est pas du markdown', () => {
    expect(extrairePromptSuivant('AUTOWIN_PROMPT_V1: relance **`npm test`** ici')).toBe(
      'relance npm test ici'
    )
  })

  it('ne jette pas sur une entrée absente', () => {
    expect(extrairePromptSuivant(undefined)).toBeNull()
    expect(extrairePromptSuivant('')).toBeNull()
  })
})

describe('retrait de la ligne technique de l’affichage', () => {
  it('retire la ligne et rien d’autre', () => {
    expect(retirerLignePromptSuivant(`avant\n${LIGNE}\napres`)).toBe('avant\napres')
  })

  it('retire aussi une ligne PARTIELLE pendant le streaming — pas de clignotement', () => {
    expect(retirerLignePromptSuivant('texte\nAUTOWIN_PROMPT_V1: Lance le ter')).toBe('texte')
  })

  it('retire même le marqueur seul, encore sans ses deux-points', () => {
    expect(retirerLignePromptSuivant('texte\nAUTOWIN_PROMPT_V')).toBe('texte')
  })

  it('laisse intact un texte qui n’en porte pas', () => {
    expect(retirerLignePromptSuivant('rien a retirer')).toBe('rien a retirer')
  })

  it('PRÉSERVE la ligne citée dans un bloc de code : c’est de la documentation, pas du bruit', () => {
    const texte = 'Format :\n```\nAUTOWIN_PROMPT_V1: exemple\n```\nfin'
    expect(retirerLignePromptSuivant(texte)).toBe(texte)
  })

  it('CRLF : ne laisse pas de « \\r\\n » en fin, et garde l’alignement des autres lignes', () => {
    expect(retirerLignePromptSuivant(`fin\r\n${LIGNE}\r\n`)).toBe('fin')
    expect(retirerLignePromptSuivant(`avant\r\n${LIGNE}\r\napres\r\n`)).toBe('avant\r\napres\r\n')
  })

  it('ne laisse pas une ligne vide en fin de texte à la place de la ligne retirée', () => {
    expect(retirerLignePromptSuivant(`fin du travail\n${LIGNE}`)).toBe('fin du travail')
  })
})

describe('publication → /salvage', () => {
  it('réécrit un prompt de publication en /salvage', () => {
    expect(
      extrairePromptSuivant('AUTOWIN_PROMPT_V1: Commit et push les deux corrections sur main.')
    ).toBe(PROMPT_SALVAGE)
    expect(extrairePromptSuivant('AUTOWIN_PROMPT_V1: Ouvre une pull request pour ce lot.')).toBe(
      PROMPT_SALVAGE
    )
  })
  it('laisse intact un prompt qui ne publie rien', () => {
    expect(extrairePromptSuivant('AUTOWIN_PROMPT_V1: Lance le terrain sur X.')).toBe(
      'Lance le terrain sur X.'
    )
  })

  /*
   * Vecu le 2026-09-03 (conv-210) : le tri venait d'etre TERMINE dans le tour, et la suite utile
   * etait de restaurer un fichier precis. Le garde-fou a quand meme tout remplace par `/salvage`,
   * effacant la seule cible que le tour avait identifiee.
   */
  it("ne reecrit pas quand publier n'est que la SUITE d'un autre acte", () => {
    const prompt =
      'Restaure skills/arena/SKILL.md pour recuperer la journalisation des 4 bras, puis publie le curseur de volume.'
    expect(extrairePromptSuivant(`AUTOWIN_PROMPT_V1: ${prompt}`)).toBe(prompt)
  })

  it('ne reecrit pas un prompt qui EST deja un ordre de tri', () => {
    const prompt = 'Lance /salvage sur les 2 travaux ChatComposer.tsx avant de publier.'
    expect(extrairePromptSuivant(`AUTOWIN_PROMPT_V1: ${prompt}`)).toBe(prompt)
  })

  it("reecrit toujours quand publier EST l'acte principal, meme suivi d'une suite", () => {
    expect(
      extrairePromptSuivant('AUTOWIN_PROMPT_V1: Publie le lot sur main, puis relance les tests.')
    ).toBe(PROMPT_SALVAGE)
  })
})

describe('toutes les formes de « publier »', () => {
  const formes = [
    'Publie ce lot sur main.',
    'Publication des deux commits.',
    'Ce travail est publié, enchaîne dessus.',
    'Déploie la version.',
    'Fais la mise en ligne.',
    'Prépare la release.',
    'Fusionne la branche dans main.'
  ]
  for (const forme of formes) {
    it(`réécrit « ${forme} » en /salvage`, () => {
      expect(extrairePromptSuivant(`AUTOWIN_PROMPT_V1: ${forme}`)).toBe(PROMPT_SALVAGE)
    })
  }
  it('ne se déclenche pas sur un prompt sans acte de publication', () => {
    expect(
      extrairePromptSuivant('AUTOWIN_PROMPT_V1: Relis le journal des gels et résume-le.')
    ).toBe('Relis le journal des gels et résume-le.')
  })
})

/*
 * VECU LE 2026-09-11 (conv-467). Un tour qui corrige le comptage du budget termine par
 * « …sans créer de doublon avec les lignes déjà PRÉSENTES ». L'utilisateur n'a vu AUCUN prompt
 * dans son champ de saisie.
 *
 * Cause : l'alternative `\bPR\b` du detecteur d'actes de publication. En JavaScript, `\b` est une
 * frontiere ASCII — `é` n'est pas un caractere de mot. Le « pr » de « présentes » est donc encadre
 * de deux frontieres et matche le sigle « PR » (pull request). Le prompt a ete classe publication,
 * puis SUPPRIME par la regle « publication jamais demandee ».
 *
 * Le francais est plein de « pr » suivis d'un accent : présentes, prêt, prévois, prépare.
 */
describe('frontieres de mots — un accent ne coupe pas un mot', () => {
  const PROMPT_SANS_PUBLICATION =
    'Écris un script de rattrapage qui rejoue les événements chat-usage dans cost.jsonl, sans créer de doublon avec les lignes déjà présentes.'

  it('« présentes » ne fait pas passer un prompt pour une pull request', () => {
    expect(estPromptDePublication(PROMPT_SANS_PUBLICATION)).toBe(false)
  })

  it.each(['prépare le terrain', 'prêt à relire', 'prévois un test de reprise'])(
    'ni %s',
    (prompt) => {
      expect(estPromptDePublication(prompt)).toBe(false)
    }
  )

  it('le prompt survit donc jusqu au champ de saisie', () => {
    expect(
      extrairePromptSuivant(
        `bilan\n\nAUTOWIN_PROMPT_V1: ${PROMPT_SANS_PUBLICATION}`,
        'Corrige ce defaut du comptage de budget'
      )
    ).toBe(PROMPT_SANS_PUBLICATION)
  })

  it('mais le VRAI sigle PR reste detecte', () => {
    expect(estPromptDePublication('Ouvre la PR sur main')).toBe(true)
    expect(estPromptDePublication('ouvre une pull request')).toBe(true)
  })
})

describe('dossier de travail sans depot git', () => {
  // Mesure des saisies des 09 et 10/09/2026 : trois relances de l'utilisateur pour le meme motif
  // (« j'ai pas de git arrete de me casser les couilles pour publier ») sur un dossier sans `.git`.
  it('ne reecrit plus une suite de publication en ordre de tri quand il n’y a aucun depot', () => {
    expect(estPromptDePublication('Commit et push la correction sur main', undefined, false)).toBe(
      false
    )
    expect(estPromptDePublication('Ouvre une pull request', 'corrige le bouton', false)).toBe(false)
  })

  it('garde le garde-fou quand le depot existe, et quand l’appelant ne sait pas', () => {
    expect(estPromptDePublication('Commit et push la correction sur main', undefined, true)).toBe(
      true
    )
    expect(estPromptDePublication('Commit et push la correction sur main')).toBe(true)
  })
})
