import { describe, expect, it } from 'vitest'
import {
  conversationPretendueInaccessible,
  correctionConversationLisible,
  correctionOutilsPresents,
  outilsFaussementAbsents
} from './outil-pretendu-absent'

const CATALOGUE = ['edit_file', 'verify', 'orchestrate', 'read_file', 'brain_query']

describe('outilsFaussementAbsents — les phrases REELLES de la conversation du 20/08', () => {
  it('attrape « edit_file n’existe pas dans le catalogue »', () => {
    const texte =
      "`edit_file` n'existe pas dans le catalogue réellement disponible de cette session " +
      '(outils présents : lecture, recherche, shell).'
    expect(outilsFaussementAbsents(texte, CATALOGUE)).toEqual(['edit_file'])
  })

  it('attrape « verify non disponible non plus »', () => {
    expect(outilsFaussementAbsents('`verify` non disponible non plus', CATALOGUE)).toEqual([
      'verify'
    ])
  })

  it('attrape les deux dans la même phrase, telle qu’elle a été écrite', () => {
    const texte =
      "`edit_file` n'existe pas dans le catalogue réellement disponible de cette session. " +
      '`verify` non disponible non plus, donc je ne pourrais pas produire la preuve.'
    expect(outilsFaussementAbsents(texte, CATALOGUE).sort()).toEqual(['edit_file', 'verify'])
  })

  it('tolère quelques mots entre le nom et la négation', () => {
    const texte = "L'outil `brain_query` annoncé n'est pas exposé dans ce run"
    expect(outilsFaussementAbsents(texte, CATALOGUE)).toEqual(['brain_query'])
  })

  it('attrape la formule anglaise du runtime', () => {
    expect(outilsFaussementAbsents('brain_query: No such tool available', CATALOGUE)).toEqual([
      'brain_query'
    ])
  })
})

describe('outilsFaussementAbsents — la précision avant la couverture', () => {
  it('NE déclenche PAS quand la négation porte sur autre chose', () => {
    // Le cas voisin le plus proche de la frontière : la phrase est VRAIE.
    const texte = "j'ai `edit_file`, mais `git apply` n'est pas disponible"
    expect(outilsFaussementAbsents(texte, CATALOGUE)).toEqual([])
  })

  it('NE déclenche PAS sur un outil réellement hors du catalogue du tour', () => {
    // Un sous-agent orchestré n'a pas `brain_query` : le dire est honnête, pas un défaut.
    const restreint = ['read_file']
    expect(outilsFaussementAbsents("`brain_query` n'est pas exposé", restreint)).toEqual([])
  })

  it('NE déclenche PAS sur un nom qui n’est qu’un fragment', () => {
    expect(outilsFaussementAbsents("verifyPath n'existe pas", CATALOGUE)).toEqual([])
    expect(outilsFaussementAbsents("mon_edit_file n'existe pas", CATALOGUE)).toEqual([])
  })

  it('NE déclenche PAS quand la négation est trop loin du nom', () => {
    const texte =
      "`edit_file` sert à remplacer un extrait unique dans un bureau isolé, et le réseau n'est pas disponible"
    expect(outilsFaussementAbsents(texte, CATALOGUE)).toEqual([])
  })

  it('NE déclenche PAS sur un usage normal de l’outil', () => {
    expect(outilsFaussementAbsents("j'appelle `edit_file` puis `verify`", CATALOGUE)).toEqual([])
    expect(outilsFaussementAbsents('', CATALOGUE)).toEqual([])
    expect(outilsFaussementAbsents(undefined, CATALOGUE)).toEqual([])
    expect(outilsFaussementAbsents("`edit_file` n'existe pas", [])).toEqual([])
  })

  it('ne signale un outil qu’une fois, même répété', () => {
    const texte = "`edit_file` n'existe pas. Je répète : `edit_file` non disponible."
    expect(outilsFaussementAbsents(texte, CATALOGUE)).toEqual(['edit_file'])
  })
})

describe('correctionOutilsPresents', () => {
  it('nomme les outils et dit que la tentative n’a pas eu lieu', () => {
    const message = correctionOutilsPresents(['edit_file', 'verify'])
    expect(message).toContain('`edit_file`')
    expect(message).toContain('`verify`')
    expect(message).toContain("Tu ne l'as pas essayé")
    // Elle doit couper court à la réclamation de droits shell, qui est la spirale observée.
    expect(message).toContain('aucun droit shell')
  })

  it('accorde le verbe au singulier pour un seul outil', () => {
    expect(correctionOutilsPresents(['verify'])).toContain('`verify` est dans le catalogue')
  })
})

const AVEC_LECTURE = [...CATALOGUE, 'conversation_read']

describe('conversationPretendueInaccessible — la phrase RÉELLE du 21/08', () => {
  it('attrape « n’existe dans mon contexte qu’à travers … »', () => {
    const texte =
      "Le scout aux 8 candidats n'existe dans mon contexte qu'à travers le tableau de vérification du frame."
    expect(conversationPretendueInaccessible(texte, AVEC_LECTURE)).toBe('conversation_read')
  })

  it('attrape la formule que la description de l’outil interdit nommément', () => {
    expect(
      conversationPretendueInaccessible('je ne peux pas citer cette conversation', AVEC_LECTURE)
    ).toBe('conversation_read')
  })

  it('attrape « je n’ai pas accès à cette conversation » et « hors de mon contexte »', () => {
    expect(
      conversationPretendueInaccessible("je n'ai pas accès à cette conversation", AVEC_LECTURE)
    ).toBe('conversation_read')
    expect(
      conversationPretendueInaccessible(
        'ce tour est hors de mon contexte, conversation perdue',
        AVEC_LECTURE
      )
    ).toBe('conversation_read')
  })
})

describe('conversationPretendueInaccessible — la précision avant la couverture', () => {
  it('se TAIT si l’outil n’est pas au catalogue : la phrase est alors VRAIE', () => {
    const texte = 'je ne peux pas citer cette conversation'
    expect(conversationPretendueInaccessible(texte, CATALOGUE)).toBeNull()
  })

  it('ne déclenche PAS sur un refus d’accès qui n’a rien à voir', () => {
    // La grande majorite des refus d'acces sont VRAIS : un serveur, un secret, un droit.
    expect(
      conversationPretendueInaccessible("je n'ai pas accès au serveur de production", AVEC_LECTURE)
    ).toBeNull()
    expect(
      conversationPretendueInaccessible(
        "je n'ai pas accès à ce fichier hors du dépôt",
        AVEC_LECTURE
      )
    ).toBeNull()
  })

  it('ne déclenche PAS quand on PARLE d’une conversation sans nier l’accès', () => {
    expect(
      conversationPretendueInaccessible('cette conversation est longue, je résume', AVEC_LECTURE)
    ).toBeNull()
    expect(
      conversationPretendueInaccessible(
        "j'ai lu la conversation conv-1291 avec conversation_read",
        AVEC_LECTURE
      )
    ).toBeNull()
  })

  it('ne déclenche pas sur un texte vide ou absent', () => {
    expect(conversationPretendueInaccessible('', AVEC_LECTURE)).toBeNull()
    expect(conversationPretendueInaccessible(undefined, AVEC_LECTURE)).toBeNull()
    expect(
      conversationPretendueInaccessible(
        { t: 'je ne peux pas citer cette conversation' },
        AVEC_LECTURE
      )
    ).toBeNull()
  })
})

describe('correctionConversationLisible', () => {
  it('cite l’instruction que l’outil porte déjà, au lieu d’inventer une règle', () => {
    const message = correctionConversationLisible('conversation_read')
    expect(message).toContain('conversation_read')
    expect(message).toContain('Ne réponds JAMAIS')
    // Et elle laisse une issue honnête : un résultat vide se DIT, il ne se refuse pas.
    expect(message).toMatch(/c.est une réponse, pas un refus/u)
  })
})
