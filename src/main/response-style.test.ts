import { describe, expect, it } from 'vitest'
import { CONCISE_STRUCTURED_RESPONSE_INSTRUCTION } from './response-style'

describe('concise structured response policy', () => {
  it('requires the exact compact closing block for substantial work', () => {
    const headings = ['✅ Fait', '📍 Maintenant', '⏳ Reste à faire', '👉 Recommandé']
    const positions = headings.map((heading) =>
      CONCISE_STRUCTURED_RESPONSE_INSTRUCTION.indexOf(heading)
    )

    expect(positions.every((position) => position >= 0)).toBe(true)
    expect(positions).toEqual([...positions].sort((left, right) => left - right))
    expect(CONCISE_STRUCTURED_RESPONSE_INSTRUCTION).toMatch(
      /contenu.*(?:factuel|actions, preuves, limites et suites réelles)/iu
    )
    expect(CONCISE_STRUCTURED_RESPONSE_INSTRUCTION).toMatch(
      /une seule (?:prochaine )?action|une seule recommandation/iu
    )
    expect(CONCISE_STRUCTURED_RESPONSE_INSTRUCTION).toMatch(
      /(?:sans|absence de|supprime).*(?:répétition|répéter)/iu
    )
    expect(CONCISE_STRUCTURED_RESPONSE_INSTRUCTION).toMatch(/format strict.*prioritaire/iu)
    expect(CONCISE_STRUCTURED_RESPONSE_INSTRUCTION).not.toMatch(/rubrique vide.*masqu/iu)
  })

  it('does not impose a closing block on trivial conversational answers', () => {
    expect(CONCISE_STRUCTURED_RESPONSE_INSTRUCTION).toMatch(
      /réponse conversationnelle triviale.*aucun bloc/iu
    )
  })
})

/**
 * PARLER SIMPLEMENT — demande explicite de l'utilisateur, mesuree le 2026-09-01.
 *
 * Ses mots : « les termes employes sont trop pousses », « faut simplifier un max, que l'humain
 * comprenne vite ». Le cout n'est pas cosmetique : il decode du jargon a chaque reponse, sur chaque
 * tache. Sans ces assertions, la clause se ferait effacer au premier remaniement du profil, et le
 * defaut reviendrait sans que personne ne le voie.
 */
describe('profil de reponse — langage simple', () => {
  const consigne = CONCISE_STRUCTURED_RESPONSE_INSTRUCTION

  it('exige de traduire le vocabulaire de mecanique interne', () => {
    expect(consigne).toMatch(/jargon|terme de mécanique|mécanique interne/iu)
    // Les mots les plus coûteux sont NOMMÉS : une consigne abstraite ne se déclenche sur rien.
    for (const mot of ['gate', 'livrable', 'worktree', 'scope', 'verdict', 'token']) {
      expect(consigne.toLowerCase()).toContain(mot)
    }
  })

  it('demande de dire ce qui s’est passe, pas le nom des rouages', () => {
    expect(consigne).toMatch(/rouages|ce que ça change|ce qui s'est passé/iu)
  })

  it('garde le droit de nommer une CIBLE technique — un chemin ne se paraphrase pas', () => {
    expect(consigne).toMatch(/chemin de fichier|commande|identifiant/iu)
  })

  it('interdit d’acheter la simplicite avec de l’imprecision', () => {
    // Le risque de cette regle, et la raison pour laquelle elle est testee : « simple » ne doit
    // jamais devenir « vague ». Un echec adouci serait pire que le jargon qu'on retire.
    expect(consigne).toMatch(/jamais sur la preuve|ne veut pas dire arrondir|exacte/iu)
  })
})

describe('prompt suivant prérempli dans le composer', () => {
  it('demande la ligne technique, APRÈS les rubriques, et dit qu’elle est invisible', () => {
    const consigne = CONCISE_STRUCTURED_RESPONSE_INSTRUCTION
    expect(consigne).toContain('AUTOWIN_PROMPT_V1:')
    // La ligne vient après la rubrique Recommandé : sinon elle s'insère dans le bloc lu par l'humain.
    expect(consigne.indexOf('AUTOWIN_PROMPT_V1:')).toBeGreaterThan(
      consigne.indexOf('👉 Recommandé')
    )
    // Le modèle doit savoir que la ligne n'est pas affichée, sinon il l'annonce ou la commente.
    expect(consigne).toMatch(/invisible|jamais affich|retir/iu)
  })

  it('exige un prompt à la DEUXIÈME personne, pas une redite de la recommandation', () => {
    expect(CONCISE_STRUCTURED_RESPONSE_INSTRUCTION).toMatch(
      /deuxième personne|impératif|comme si (?:tu|l'utilisateur)|que l'utilisateur (?:taperait|écrirait)/iu
    )
    expect(CONCISE_STRUCTURED_RESPONSE_INSTRUCTION).toMatch(
      /pas (?:une )?(?:simple )?(?:copie|redite|reformulation)/iu
    )
  })
})

/**
 * AGIR PLUTOT QUE RECOMMANDER.
 *
 * Defaut mesure le 2026-08-27 dans conv-1422, trois tours d'affilee. Le profil rendait le bloc de
 * cloture OBLIGATOIRE sur tout travail substantiel, « 👉 Recommandé » y contient « une seule
 * prochaine action », et `AUTOWIN_PROMPT_V1` la reecrit a l'imperatif pour que l'utilisateur la
 * renvoie. Rien n'indiquait quand cette action doit simplement etre FAITE. Le tour 3 s'est donc
 * clos sur « Diagnostique les branches ... puis dis-moi lesquelles je peux supprimer » : un
 * diagnostic en LECTURE SEULE, a un SHA connu, deja execute deux fois dans le meme fil. Sur
 * 13 679 caracteres produits, 11 118 (81 %) etaient de la mise en forme.
 *
 * CES ASSERTIONS PORTENT SUR LE LIVRABLE LUI-MEME. Le livrable EST ce texte de consigne : verifier
 * qu'une regle y figure n'est pas un proxy, contrairement a un test qui lirait le source d'un
 * module pour deviner son comportement. Leur limite est reelle et declaree : elles prouvent que la
 * consigne est ECRITE et qu'elle atteint les points d'injection, jamais que le modele y obeit —
 * seule une execution reelle le montre.
 */
describe('agir plutot que recommander — la cloture ne sert pas a rendre le travail', () => {
  const consigne = CONCISE_STRUCTURED_RESPONSE_INSTRUCTION

  it('pose la regle AVANT la rubrique Recommandé, la ou la decision se prend', () => {
    const regle = consigne.search(/AGIR PLUT[ÔO]T QUE RECOMMANDER/u)
    expect(regle).toBeGreaterThanOrEqual(0)
    expect(regle).toBeLessThan(consigne.indexOf('👉 Recommandé'))
  })

  it('ordonne d EXECUTER l action sure, bornee et reversible au lieu de l ecrire', () => {
    expect(consigne).toMatch(/ex[ée]cute-la|fais-la|EX[ÉE]CUTE/u)
    expect(consigne).toMatch(/s[ûu]re|born[ée]e|r[ée]versible/u)
  })

  it('reserve « Recommandé » a ce que l agent ne peut PAS faire lui-meme', () => {
    expect(consigne).toMatch(/destructe?/iu)
    expect(consigne).toMatch(/hors p[ée]rim[èe]tre/iu)
    expect(consigne).toMatch(/d[ée]cision qui appartient|appartient [àa] l'utilisateur/iu)
  })

  it('nomme les actes qui ne se recommandent JAMAIS : lecture seule, diagnostic, verification', () => {
    expect(consigne).toMatch(/lecture seule/iu)
    expect(consigne).toMatch(/diagnostic/iu)
    expect(consigne).toMatch(/v[ée]rification/iu)
  })

  it('interdit la question dont l agent prendrait lui-meme l option recommandee', () => {
    expect(consigne).toMatch(/ne pose pas.*question|ne demande pas/iu)
    expect(consigne).toMatch(/tu prendrais de toute fa/iu)
  })
})

/**
 * RELANCE SANS CIBLE.
 *
 * Defaut mesure le 2026-08-31 (conv-5). Le tour precedent s'etait clos sur « 👉 Recommandé :
 * corriger l'include de tsconfig.node.json ». L'utilisateur a repondu « go ». L'agent a lu ce
 * « go » comme une demande VIDE — « go sans cible » — et a substitue sa propre idee du plus utile
 * (lancer la suite de tests complete) au lieu d'executer la recommandation qu'il venait lui-meme
 * d'ecrire. Le profil imposait la rubrique et son prompt prerempli, mais ne disait NULLE PART ce
 * qu'un simple accord doit declencher : la boucle « je recommande / tu acceptes » n'etait pas
 * fermee. Un accord est un ORDRE, et son objet est la derniere recommandation.
 *
 * Ces assertions portent sur le livrable lui-meme (le texte de consigne) : elles prouvent que la
 * regle est ECRITE et injectee, jamais que le modele y obeit.
 */
describe('relance sans cible — un accord execute la derniere recommandation', () => {
  const consigne = CONCISE_STRUCTURED_RESPONSE_INSTRUCTION

  it('nomme les formes courtes d accord qui declenchent la regle', () => {
    expect(consigne).toMatch(/«\s*go\s*»/iu)
    expect(consigne).toMatch(/vas-y|continue|ok/iu)
  })

  it('ordonne d executer la rubrique Recommandé plutot que d inventer une action', () => {
    expect(consigne).toMatch(/RELANCE SANS CIBLE/u)
    expect(consigne).toMatch(/n['’]invente|ne substitue|sans inventer/iu)
  })

  it('traite le cas ou la derniere recommandation est « rien » : demander une cible', () => {
    expect(consigne).toMatch(/derni[èe]re recommandation est «\s*rien\s*»/iu)
  })

  /**
   * Defaut mesure le 2026-09-02 (conv-122). Tour 2 : « et kaizen doit pouvoir editer les skills
   * les tools le code autowin les fichiers.md le brain bref faut lui lister ses leviers » ->
   * annulation par l'utilisateur apres 93 s, 0 token, message affiche « Tour annule avant toute
   * reponse — rien n'a ete execute » (causal-trace/conv-122.jsonl, sequence 8-9). Tour 3 : « go ».
   * L'agent a applique la regle a la LETTRE — la derniere rubrique « Recommandé » ecrite datait du
   * tour 1 — et est parti sur le tri de conv-124, laissant la demande annulee sans reponse. Cout
   * pour l'utilisateur : il a re-tape sa phrase MOT POUR MOT dans une nouvelle conversation
   * (conv-123, 09:03:38Z) pour l'obtenir. Le paragraphe ne prevoyait pas le tour interrompu.
   */
  it('traite le tour INTERROMPU : la relance reprend la demande abandonnee', () => {
    expect(consigne).toMatch(/interrompu|annul[ée]/iu)
    expect(consigne).toMatch(/reprend/iu)
  })
})

/**
 * LANGAGE SIMPLE.
 *
 * Demande de l'utilisateur du 2026-09-01 (conv-30) : « les termes employés sont trop poussés »,
 * puis, apres levee d'ambiguite, « je parlais uniquement des réponses du model, faut simplifier un
 * max, que l'humain comprenne vite ». Le profil imposait deja « phrases courtes » et « supprime le
 * verbiage » — donc la LONGUEUR — mais rien sur le VOCABULAIRE. Un texte court en jargon reste
 * illisible : « ⛔ Bloqué : gate refuse le livrable, verdict a-verifier » fait 8 mots et n'apprend
 * rien a qui ne connait pas la mecanique.
 *
 * Le garde-fou qui compte est le DERNIER : simplifier ne doit jamais servir a effacer une reserve
 * ou un echec. Sans lui, cette regle entre en collision frontale avec le reflexe 2 (aucun « fait »
 * sans preuve) et fabrique des faux verts polis.
 *
 * Ces assertions portent sur le livrable lui-meme (ce texte de consigne) : elles prouvent que la
 * regle est ECRITE et injectee, jamais que le modele y obeit.
 */
describe('langage simple — le vocabulaire, pas seulement la longueur', () => {
  const consigne = CONCISE_STRUCTURED_RESPONSE_INSTRUCTION

  it('pose la regle et nomme les termes de mecanique a traduire', () => {
    expect(consigne).toMatch(/LANGAGE SIMPLE/u)
    for (const jargon of ['gate', 'worktree', 'livrable', 'verdict', 'provider']) {
      expect(consigne).toContain(jargon)
    }
  })

  it('donne des remplacements CONCRETS, pas seulement l ordre de simplifier', () => {
    expect(consigne).toMatch(/contr[ôo]le final/iu)
    expect(consigne).toMatch(/copie de travail/iu)
    expect(consigne).toMatch(/mod[èe]le IA/iu)
  })

  it('exempte les noms de fichier, de commande et de branche — ce sont des adresses', () => {
    expect(consigne).toMatch(/nom de fichier.*reste tel quel|adresse, pas du jargon/iu)
  })

  it('interdit de simplifier au prix de la verite : reserves et echecs restent dits', () => {
    expect(consigne).toMatch(/DIRE VRAI PRIME SUR SIMPLIFIER/u)
    expect(consigne).toMatch(/ne supprime jamais une r[ée]serve/iu)
    expect(consigne).toMatch(/[ée]chec/iu)
  })

  it('place la regle AVANT le bloc de cloture, la ou le ton se decide', () => {
    expect(consigne.indexOf('LANGAGE SIMPLE')).toBeLessThan(consigne.indexOf('✅ Fait'))
  })
})
