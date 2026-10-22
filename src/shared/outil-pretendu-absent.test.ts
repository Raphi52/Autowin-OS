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

  it('NE déclenche PAS sur le nom commun « un run » (phrase réelle, conv-1092)', () => {
    // Texte exact relu dans le journal : apostrophe DROITE (la typographique ne déclenchait rien).
    const texte = "Le déclencheur « une question avant un run payant ambigu » n'existe pas encore."
    expect(outilsFaussementAbsents(texte, [...CATALOGUE, 'run'])).toEqual([])
    expect(outilsFaussementAbsents("le run n'est pas disponible", [...CATALOGUE, 'run'])).toEqual(
      []
    )
  })

  it('attrape toujours l’outil cité, même après un déterminant (jumeau du cas précédent)', () => {
    const avecRun = [...CATALOGUE, 'run']
    expect(outilsFaussementAbsents("le `run` n'est pas disponible", avecRun)).toEqual(['run'])
    expect(outilsFaussementAbsents("run n'est pas disponible ici", avecRun)).toEqual(['run'])
    expect(outilsFaussementAbsents("l'outil `run` n'existe pas", avecRun)).toEqual(['run'])
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

  it('ne déclenche PAS sur une ligne de journal à venir (phrase RÉELLE de conv-1089, 2026-10-22)', () => {
    // Bloc exact du tour 2425d493 : la négation parle d'une ligne de journal pas encore écrite ; le seul
    // « conversation » du texte est la clé JSON `conversationId`, trois puces plus haut.
    const texte =
      '**Point 1 — `besoins.jsonl` dans l\'app réelle**\n- L\'app a redémarré à 18:39:05, sur un processus principal construit à 18:39:04 qui contient le journal.\n- Au début de ce tour, le fichier n\'existait pas encore. Aucun tour ne s\'était terminé normalement : les reprises de conv-1056 et conv-1074 ont échoué (« copie durable absente »), et celui-ci tournait encore.\n- Pour le prouver sans attendre, j\'ai envoyé une question simple dans un fil de test, **conv-1095**. Sa ligne est arrivée **8 s** après l\'envoi (email masqué) :\n  `{"conversationId":"conv-1095","messageId":"message-conv-1095-1","demandeur":{"nom":"Raph","email":"(masqué)","dossier":"D:\\\\AutoWinOS"},"besoin":{"nature":"aucun"}}`\n- **Demandeur non nul**, et **besoin non nul** : `aucun` est le bon classement pour une question.\n- ⚠️ **Pas encore vérifié** : la ligne de conv-1089. Elle s\'écrit à la fin de ce tour-ci, que je ne peux pas relire de l\'intérieur.'
    expect(conversationPretendueInaccessible(texte, AVEC_LECTURE)).toBeNull()
  })

  it('attrape toujours la négation quand la MÊME phrase parle d’une conversation ou d’un tour passé', () => {
    expect(
      conversationPretendueInaccessible(
        'Résumé fait. Je ne peux pas relire la conversation conv-1291, elle est trop ancienne.',
        AVEC_LECTURE
      )
    ).toBe('conversation_read')
    expect(
      conversationPretendueInaccessible(
        'Je ne peux pas relire ce tour passé : je repars de zéro.',
        AVEC_LECTURE
      )
    ).toBe('conversation_read')
  })

  it('ne déclenche PAS sur une négation CITÉE entre guillemets ou accents graves (conv-1089)', () => {
    // Paragraphe exact de la réponse à la relance (tour 2425d493) : la négation y est citée pour
    // expliquer la garde, elle n'affirme rien. Deux de ses phrases relançaient encore.
    const texte =
      "**Pourquoi la relance s'est déclenchée** : la garde `src/shared/outil-pretendu-absent.ts` a pris ma phrase « que je ne peux pas relire de l'intérieur » pour un refus de lire une conversation. Elle se déclenche sur « je ne peux pas relire » (ligne 218) dès qu'un mot comme « conversation » apparaît à proximité (ligne 226), même quand la phrase parle d'autre chose. C'est la deuxième relance à tort vue aujourd'hui, après celle sur « 2 + 2 » dans conv-1095. Je n'y touche pas, car ce n'est pas l'objet de cette demande."
    expect(conversationPretendueInaccessible(texte, AVEC_LECTURE)).toBeNull()
    expect(
      conversationPretendueInaccessible(
        'La description de l’outil interdit `je ne peux pas citer cette conversation`.',
        AVEC_LECTURE
      )
    ).toBeNull()
  })

  it('attrape toujours une négation HORS des guillemets, même si la conversation y est citée', () => {
    expect(
      conversationPretendueInaccessible(
        'Je ne peux pas citer « la conversation d’hier », elle est trop longue.',
        AVEC_LECTURE
      )
    ).toBe('conversation_read')
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

/**
 * TROISIEME FORME DU MEME DEFAUT : le TABLEAU de capacites.
 *
 * Mesure conv-650, turnId 6a3498c3-8d01-4928-a4ae-9b97c7495af8 (2026-09-17). L'agent n'ecrit
 * aucune des phrases surveillees : il dresse un tableau markdown « Capacite | Disponible ? » et
 * coche `edit_file` / `create_file` a **non**. La garde ne voyait rien, l'utilisateur a redemande
 * quatre fois (saisies ts 1789639857023, 1789639927623, 1789640030803, 1789640116782) et le tour
 * s'est termine sur un script PowerShell a coller a la main.
 */
describe('un tableau de capacites qui coche « non » vaut declaration d’absence', () => {
  const catalogue = ['edit_file', 'create_file', 'verify']

  it('detecte la ligne de tableau qui declare l’outil indisponible', () => {
    const texte = [
      '| Capacité | Disponible ? | Ce que ça permettrait |',
      '|---|---|---|',
      '| `edit_file` / `create_file` | **non** | écrire le patch |'
    ].join('\n')
    expect(outilsFaussementAbsents(texte, catalogue)).toEqual(
      expect.arrayContaining(['edit_file', 'create_file'])
    )
  })

  it('ne declenche PAS sur une ligne qui declare l’outil disponible', () => {
    const texte = '| `verify` | **oui** | rejouer la vérification |'
    expect(outilsFaussementAbsents(texte, catalogue)).toEqual([])
  })

  it('ne declenche PAS sur un tableau de constats ou l’outil est un mot d’une commande citee (bulletin maintenance 2026-10-03/04)', () => {
    // Faux positif mesure deux jours de suite : « aucune » est l'ACTION proposee, et `run` n'est
    // qu'un mot de la commande `npm run typecheck` citee en preuve — aucun outil n'est nie.
    const texte = [
      '| Axe | Constat | Preuve | Statut vs hier | Action proposée |',
      '|---|---|---|---|---|',
      '| Bugs | Typage **vert**, lint **0 erreur** | `npm run typecheck` exit 0 · `eslint` exit 0 | toujours là (vert) | aucune |'
    ].join('\n')
    expect(outilsFaussementAbsents(texte, [...catalogue, 'run'])).toEqual([])
  })

  it('ne declenche PAS sur une prose ordinaire contenant « non »', () => {
    const texte = 'J’ai utilisé `edit_file`, non sans mal, et la vérification passe.'
    expect(outilsFaussementAbsents(texte, catalogue)).toEqual([])
  })
})
