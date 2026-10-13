/**
 * Lit les affirmations NON VERIFIEES sur lesquelles un cadrage (phase FRAME) repose.
 *
 * POURQUOI. Le brief de FRAME impose deja une section `## Confiance` ou chaque affirmation porteuse
 * est etiquetee VERIFIE / DE L'UTILISATEUR / NON VERIFIE, et impose d'ecrire dans `## Besoin` toute
 * hypothese qu'on ne pouvait pas resoudre. Mesure du 20/08 : AUCUN code ne lisait cette section.
 * Elle etait donc produite a chaque run et jamais montree — l'utilisateur decouvrait le malentendu
 * a la fin, dans un livrable deja construit dessus.
 *
 * CE QUE CE MODULE NE FAIT PAS. Il ne suspend rien et ne devine rien. Il ne lit que des etiquettes
 * DECLAREES : pas de section, pas d'etiquette, pas d'hypothese ⇒ liste vide, jamais une hypothese
 * fabriquee. Le run continue dans tous les cas ; ce qui change, c'est que l'hypothese devient
 * VISIBLE et contestable tot, au lieu d'etre enfouie dans le cadrage.
 */

export type SourceHypothese = 'confiance' | 'besoin'

export interface HypotheseDeCadrage {
  /** L'affirmation, etiquette retiree. */
  affirmation: string
  source: SourceHypothese
  /**
   * Ce que le cadrage a ecrit APRES l'etiquette, dans ses propres mots — « non executable en FRAME ;
   * premier geste de BUILD », « hypothese H1, sans impact sur le perimetre ». C'est la seule chose
   * qui merite d'etre depliee : la generalite « le travail repose dessus » est vraie de toutes les
   * lignes et n'apprend donc rien (defaut vecu le 20/08, un deroulant identique partout).
   */
  justification?: string
}

/** Au-dela, la liste cesse d'etre lisible et redevient le mur de texte qu'on veut eviter. */
export const PLAFOND_HYPOTHESES = 5
/*
 * 600 et non plus 240 (conv-536, 2026-09-24) : une hypothese reelle du cadrage (menu SURVBOD) faisait
 * ~300 caracteres et s'affichait coupee au milieu d'un mot (« avant la c »). Le plafond ne sert qu'a
 * borner un texte aberrant ; il coupe desormais sur un mot, avec une ellipse visible.
 */
const PLAFOND_AFFIRMATION = 600

function couper(texte: string, plafond: number): string {
  if (texte.length <= plafond) return texte
  const bord = texte.lastIndexOf(' ', plafond - 1)
  return `${texte.slice(0, bord > plafond / 2 ? bord : plafond - 1).trimEnd()}…`
}
/** La justification est une phrase du modele, pas un titre : elle a droit a plus de place. */
const PLAFOND_JUSTIFICATION = 400

/*
 * L'etiquette est cherchee telle qu'un modele l'ecrit : accents optionnels, tiret ou espace entre
 * `NON` et `VERIFIE`, pluriel possible. Un `\bVERIFIE\b` seul serait un piege — il matcherait
 * l'interieur de « NON VERIFIE » et inverserait exactement le signal ; on ne cherche donc jamais
 * `VERIFIE` seul.
 *
 * La fin de l'etiquette se ferme par `(?!\p{L})` et NON par `\b` : `\b` s'appuie sur `\w`, qui est
 * ASCII, donc apres le `É` final de « NON VÉRIFIÉ » la frontiere n'existe pas et l'etiquette la plus
 * courante ne matchait JAMAIS. Mesure du 20/08 : cinq tests rouges sur ce seul caractere.
 */
const ETIQUETTE_NON_VERIFIE = /\bNON\s*[- ]?\s*V[EÉ]RIFI[EÉ]E?S?(?!\p{L})/iu
const ETIQUETTE_NON_VERIFIE_G = new RegExp(ETIQUETTE_NON_VERIFIE.source, 'giu')
/*
 * Etiquette VERIFIE positive : toute forme NON VERIFIE est retiree AVANT, donc « NON VÉRIFIÉ » ne
 * peut jamais etre lu comme une preuve.
 */
const ETIQUETTE_VERIFIE = /(?<!\p{L})V[EÉ]RIFI[EÉ]E?S?(?!\p{L})/iu
const ETIQUETTE_UTILISATEUR = /\bDE\s+L['’]UTILISATEUR\b/iu

/*
 * Une puce Markdown est un marqueur SUIVI D'UN BLANC. L'ancien motif acceptait `*` sans blanc et
 * mangeait donc la premiere etoile d'un gras en tete de ligne : « **Non vérifié** » devenait
 * « *Non vérifié** », puis « * ** » une fois l'etiquette retiree — exactement ce que l'utilisateur
 * lisait a l'ecran (conv-919, 2026-10-13).
 */
const PREFIXE_PUCE = /^(\s*)(?:[-*•+]|\d+[.)])\s+/u
const CASE_A_COCHER = /^\[[ xX]\]/u
const BORD_DEBUT = /^[\s:;,.—–→-]+/u
/** « Hypothèse : x » en tete d'affirmation : le mot d'annonce n'apprend rien a celui qui lit la liste. */
const ANNONCE_HYPOTHESE = /^hypoth[eè]ses?\b[^:]{0,40}:\s*/iu
/** « Aucune affirmation ne reste non vérifiée » dit qu'il n'y a RIEN a supposer : ce n'est pas une supposition. */
const CONSTAT_D_ABSENCE = /^(?:aucune?|rien|nulle?)\b/iu
const BORD_FIN = /[\s:;,(—–-]+$/u
/** Une fin de phrase suivie d'une nouvelle phrase (majuscule ou guillemet). */
const FIN_DE_PHRASE = /[.!?…](?=\s+[«"\p{Lu}])/u

function titreDeSection(ligne: string): { niveau: number; titre: string } | null {
  const titre = /^\s{0,3}(#{1,6})\s+(.+?)\s*$/u.exec(ligne)
  return titre ? { niveau: titre[1].length, titre: titre[2] } : null
}

/**
 * Le texte tel que l'utilisateur le LIRA : le bloc affiche du texte brut, pas du Markdown.
 *
 * Le cadrage met ses etiquettes en gras (`**NON VÉRIFIÉ**`, `**Non vérifié :**`). Retirer
 * l'etiquette en laissant les etoiles affichait « ** ** », « **** — dépend… », « ** :** ». On
 * retire donc l'emphase AVANT de lire quoi que ce soit ; le code entre accents graves garde son
 * contenu tel quel (un `__init__` n'est pas un gras).
 */
function texteBrut(ligne: string): string {
  return ligne
    .split(/(`[^`]*`)/u)
    .map((morceau, index) =>
      index % 2 === 1
        ? morceau.slice(1, -1)
        : morceau
            .replace(/\*\*|__/gu, '')
            .replace(/(?<![\p{L}\p{N}*])\*(?=\S)([^*\n]*?\S)\*(?![\p{L}\p{N}*])/gu, '$1')
            .replace(/`/gu, '')
    )
    .join('')
}

/** Retire la ponctuation laissee orpheline aux deux bouts par l'etiquette retiree. */
function bords(texte: string): string {
  return texte
    .replace(/\((?:\s*)\)/gu, ' ')
    .replace(/\s{2,}/gu, ' ')
    .replace(BORD_DEBUT, '')
    .replace(BORD_FIN, '')
    .trim()
}

/**
 * L'etiquette NON VERIFIE APPOSEE sur la ligne — jamais celle qui y est seulement CITEE.
 * « les deux « non vérifié » sont hors périmètre » parle de l'etiquette, il ne la porte pas.
 */
function etiquetteNonVerifie(texte: string): { debut: number; fin: number } | null {
  for (const m of texte.matchAll(ETIQUETTE_NON_VERIFIE_G)) {
    const debut = m.index ?? 0
    const fin = debut + m[0].length
    const avant = texte.slice(0, debut).trimEnd().slice(-1)
    const apres = texte.slice(fin).trimStart().charAt(0)
    if (/[«"“]/u.test(avant) && /[»"”]/u.test(apres)) continue
    return { debut, fin }
  }
  return null
}

function portUneAutorite(texte: string): boolean {
  return (
    ETIQUETTE_VERIFIE.test(texte.replace(ETIQUETTE_NON_VERIFIE_G, ' ')) ||
    ETIQUETTE_UTILISATEUR.test(texte)
  )
}

/** La raison ecrite apres l'etiquette, sans la parenthese qui l'enveloppait. */
function raison(texte: string): string | undefined {
  const propre = bords(bords(texte).replace(/^\(([^()]*)\)/u, '$1'))
  return propre ? couper(propre, PLAFOND_JUSTIFICATION) : undefined
}

type Lecture =
  | { genre: 'hypothese'; affirmation: string; justification?: string }
  | { genre: 'entete'; justification?: string }

/**
 * Une affirmation lisible d'un coup : sa PREMIERE phrase. Ce qui suit (« À contrôler pendant
 * l'écriture du code », « Si c'est l'inverse, dis-le ») est la raison, et va dans le depliable.
 */
function hypothese(texte: string, justification?: string): Lecture | null {
  let affirmation = bords(bords(texte).replace(ANNONCE_HYPOTHESE, ''))
  let suite = justification
  if (!suite) {
    const fin = FIN_DE_PHRASE.exec(affirmation)
    if (fin && fin.index >= 12) {
      suite = raison(affirmation.slice(fin.index + 1))
      affirmation = affirmation.slice(0, fin.index + 1).trim()
    }
  }
  if (!affirmation) return null
  return {
    genre: 'hypothese',
    affirmation: couper(affirmation, PLAFOND_AFFIRMATION),
    ...(suite && { justification: suite })
  }
}

/**
 * Une ligne qui porte l'etiquette NON VERIFIE, sous ses trois formes reelles :
 *   « x — NON VÉRIFIÉ, raison »                       → l'affirmation est AVANT l'etiquette ;
 *   « NON VÉRIFIÉ : x » / « NON VÉRIFIÉ, raison : x » → elle est APRES ;
 *   « **NON VÉRIFIÉ, sans incidence :** » seul        → c'est un EN-TETE : les puces qui suivent
 *     sont les affirmations. Forme la plus frequente des cadrages recents ; l'ancien lecteur
 *     affichait l'en-tete lui-meme (« * , sans incidence sur la suite :** ») et ignorait la liste.
 */
function lireLigneEtiquetee(brut: string): Lecture | null {
  const etiquette = etiquetteNonVerifie(brut)
  if (!etiquette) return null
  const avant = bords(brut.slice(0, etiquette.debut))
  const apres = brut.slice(etiquette.fin)
  if (avant) return hypothese(avant, raison(apres))
  const qualifiee = /^\s*[,(]\s*([^:]{0,100}?)\)?\s*:(.*)$/su.exec(apres)
  if (qualifiee) {
    const qualificatif = raison(qualifiee[1])
    return bords(qualifiee[2])
      ? hypothese(qualifiee[2], qualificatif)
      : { genre: 'entete', ...(qualificatif && { justification: qualificatif }) }
  }
  return bords(apres) ? hypothese(apres) : { genre: 'entete' }
}

/** La raison d'une cellule etiquetee : ce qui suit l'etiquette, ou la cellule entiere si elle la porte au milieu. */
function raisonDeCellule(cellule: string): string | undefined {
  const etiquette = etiquetteNonVerifie(cellule)
  if (!etiquette) return raison(cellule)
  return bords(cellule.slice(0, etiquette.debut))
    ? raison(cellule)
    : raison(cellule.slice(etiquette.fin))
}

/**
 * Une ligne de TABLEAU markdown, decoupee en cellules (en texte brut) — ou `null` si ce n'en est
 * pas une.
 *
 * C'est la forme reellement emise, mesuree le 20/08 sur le run `run-f7293debbd3b-1` :
 *
 *   | Affirmation | Statut |
 *   |---|---|
 *   | Etat vert/rouge actuel de la suite | NON VERIFIE - non executable en FRAME ; premier geste... |
 *
 * Le lecteur travaillait ligne par ligne : il ramassait la ligne ENTIERE, barres comprises, et
 * rendait « | Etat vert/rouge actuel de la suite | - non executable... | » — illisible. La ligne de
 * separation et la ligne d'en-tete sont ecartees : ni l'une ni l'autre n'est une affirmation.
 */
function cellulesDeTableau(ligne: string): string[] | null {
  if (!ligne.startsWith('|')) return null
  const cellules = ligne
    .replace(/^\|/u, '')
    .replace(/\|\s*$/u, '')
    .split('|')
    .map((cellule) => cellule.trim())
  if (cellules.length < 2) return null
  // `|---|---|` : une ligne faite de tirets et de deux-points n'affirme rien.
  if (cellules.every((cellule) => /^:?-{2,}:?$/u.test(cellule))) return null
  return cellules.map((cellule) => texteBrut(cellule).trim())
}

/**
 * Dit si une citation `chemin:ligne` d'une ligne VERIFIE est INTROUVABLE (fichier absent ou ligne
 * au-dela de sa fin). Injecte par l'appelant : ce module partage n'a pas acces au disque.
 */
export type CitationIntrouvable = (chemin: string, ligne?: number) => boolean

/** `src/a.ts:12`, `SKILL.md:64-68` : un chemin a extension, suivi ou non d'un numero de ligne. */
const CITATION = /([\w./-]+\.(?:md|tsx?|m?js|json|ps1|ya?ml))(?::(\d+))?/giu

/**
 * SKILL.md (frame) exige pour chaque VERIFIE un fichier:ligne reellement lu, et rappelle que la
 * certitude declaree par le modele ne prouve rien. Mesure du 2026-10-02 : aucun code ne controlait
 * ces citations. Une ligne VERIFIE dont une citation est introuvable est donc RECLASSEE en
 * hypothese : elle suit le circuit deja en place vers le juge.
 */
function citationsIntrouvables(ligne: string, introuvable: CitationIntrouvable): string[] {
  const sansNon = ligne.replace(ETIQUETTE_NON_VERIFIE_G, ' ')
  if (!ETIQUETTE_VERIFIE.test(sansNon)) return []
  const manquantes: string[] = []
  for (const m of sansNon.matchAll(CITATION)) {
    const numero = m[2] ? Number(m[2]) : undefined
    if (introuvable(m[1], numero)) manquantes.push(m[2] ? `${m[1]}:${m[2]}` : m[1])
  }
  return manquantes
}

/** Une liste ouverte par un en-tete (« **Non vérifié :** », « **Hypothèses (corrige-moi) :** »). */
interface ListeOuverte {
  justification?: string
  /** Retrait de l'en-tete s'il est lui-meme une puce, -1 sinon : ses items sont plus a droite. */
  retraitEntete: number
  /** Retrait du premier item : une puce plus a droite est un DETAIL de l'item, pas une affirmation. */
  retraitItems?: number
  items: number
}

/**
 * Les hypotheses porteuses d'un cadrage, dans l'ordre du texte.
 *
 * Deux sources, par conception distinctes : la section `## Confiance` (les affirmations que le
 * modele a lui-meme marquees NON VERIFIE) et les lignes de `## Besoin` qui s'annoncent comme des
 * hypotheses. Une ligne ETIQUETEE verifiee ou attribuee a l'utilisateur n'est jamais reprise : elle
 * a une autorite, contrairement a une deduction.
 */
export function hypothesesDuCadrage(
  texte: unknown,
  options: { citationIntrouvable?: CitationIntrouvable } = {}
): HypotheseDeCadrage[] {
  if (typeof texte !== 'string' || !texte.trim()) return []
  const trouvees: HypotheseDeCadrage[] = []
  const vues = new Set<string>()
  let sectionCourante: SourceHypothese | null = null
  let niveauSection = 0
  let liste: ListeOuverte | null = null

  const retenir = (lecture: Lecture | null, source: SourceHypothese): void => {
    if (!lecture || lecture.genre !== 'hypothese') return
    const cle = lecture.affirmation.toLowerCase()
    if (vues.has(cle)) return
    vues.add(cle)
    trouvees.push({
      affirmation: lecture.affirmation,
      source,
      ...(lecture.justification && { justification: lecture.justification })
    })
  }

  for (const ligneBrute of texte.split(/\r?\n/u)) {
    if (trouvees.length >= PLAFOND_HYPOTHESES) break
    const titre = titreDeSection(ligneBrute)
    if (titre !== null) {
      // Un sous-titre (« ### Non vérifié ») RESTE dans sa section ; il ouvre ou ferme une liste.
      if (sectionCourante && titre.niveau > niveauSection) {
        const lecture = lireLigneEtiquetee(texteBrut(titre.titre))
        liste =
          lecture?.genre === 'entete'
            ? { justification: lecture.justification, retraitEntete: -1, items: 0 }
            : null
        continue
      }
      const nom = titre.titre.toLowerCase()
      sectionCourante = nom.includes('confiance')
        ? 'confiance'
        : nom.includes('besoin')
          ? 'besoin'
          : null
      niveauSection = titre.niveau
      liste = null
      continue
    }
    if (!sectionCourante) continue
    if (!ligneBrute.trim()) {
      // Une ligne vide ferme une liste deja remplie ; entre l'en-tete et son premier item, non.
      if (liste?.items) liste = null
      continue
    }

    const puce = PREFIXE_PUCE.exec(ligneBrute)
    const retrait = puce ? puce[1].replace(/\t/gu, '    ').length : -1
    const brut = texteBrut(puce ? ligneBrute.slice(puce[0].length) : ligneBrute).trim()

    if (liste) {
      const estItem =
        puce !== null &&
        retrait > liste.retraitEntete &&
        (liste.retraitItems === undefined || retrait >= liste.retraitItems)
      if (estItem) {
        liste.retraitItems ??= retrait
        if (retrait > liste.retraitItems || CASE_A_COCHER.test(brut)) continue
        liste.items++
        const lecture = etiquetteNonVerifie(brut)
          ? lireLigneEtiquetee(brut)
          : portUneAutorite(brut)
            ? null
            : hypothese(brut)
        if (lecture?.genre === 'hypothese') {
          retenir(
            { ...lecture, justification: lecture.justification ?? liste.justification },
            sectionCourante
          )
        }
        continue
      }
      liste = null
    }

    const cellules = cellulesDeTableau(ligneBrute.trim())
    const manquantes =
      sectionCourante === 'confiance' && options.citationIntrouvable
        ? citationsIntrouvables(cellules ? cellules.join(' | ') : brut, options.citationIntrouvable)
        : []

    if (manquantes.length) {
      const sansEtiquette = cellules
        ? cellules[0]
        : brut.replace(new RegExp(ETIQUETTE_VERIFIE.source, 'giu'), ' ')
      retenir(
        hypothese(
          sansEtiquette,
          `marquée VÉRIFIÉ mais citation introuvable : ${manquantes.join(', ')}`
        ),
        sectionCourante
      )
    } else if (cellules) {
      // Forme TABLEAU : l'affirmation est la premiere cellule, l'etiquette et sa raison vivent dans
      // une autre. Une ligne d'en-tete (« Affirmation | Statut ») ne porte aucune etiquette.
      const etiquetee = cellules.find((cellule) => etiquetteNonVerifie(cellule))
      if (!etiquetee) continue
      const premiere = cellules[0] === etiquetee ? '' : bords(cellules[0])
      retenir(
        premiere ? hypothese(premiere, raisonDeCellule(etiquetee)) : lireLigneEtiquetee(etiquetee),
        sectionCourante
      )
    } else if (sectionCourante === 'confiance') {
      /*
       * SEULE l'etiquette NON VERIFIE explicite compte. Une ligne SANS etiquette n'est pas reprise :
       * remonter tout ce qui n'est pas marque verifie ferait de chaque phrase de la section une
       * hypothese, et le bloc redeviendrait le mur de texte qu'on cherche a supprimer. Une
       * affirmation deja VERIFIE ou tenue DE L'UTILISATEUR porte son autorite, on la laisse.
       */
      if (CONSTAT_D_ABSENCE.test(brut)) continue
      const lecture = lireLigneEtiquetee(brut)
      if (lecture?.genre === 'entete') {
        liste = { justification: lecture.justification, retraitEntete: retrait, items: 0 }
        continue
      }
      retenir(lecture, sectionCourante)
    } else {
      /*
       * `## Besoin` : « Hypothèse : x », « Hypothèse écrite : x », « Hypothèse annoncée (à corriger
       * si faux) : x » — le mot d'annonce ET son qualificatif partent, jusqu'aux deux-points.
       * L'ancien lecteur ne retirait que le mot et affichait « écrite : … ». Un en-tete seul,
       * « **Hypothèses (corrige-moi) :** », ouvre une liste dont chaque puce est une hypothese.
       */
      const annonce = /^hypoth[eè]ses?\b([^:]{0,140}):(.*)$/isu.exec(brut)
      if (annonce) {
        if (bords(annonce[2])) retenir(hypothese(annonce[2]), sectionCourante)
        else liste = { retraitEntete: retrait, items: 0 }
      } else if (/^hypoth[eè]se\b/iu.test(brut)) {
        retenir(hypothese(brut.replace(/^hypoth[eè]se\b/iu, '')), sectionCourante)
      }
    }
  }
  return trouvees.slice(0, PLAFOND_HYPOTHESES)
}

/**
 * L'amorce posee dans le composer quand l'utilisateur conteste une supposition.
 *
 * Elle se termine OUVERTE, par des deux-points : corriger demande de dire ce qui est vrai, et un
 * clic ne le sait pas. Le modele ne recoit donc jamais un verdict vide « c'est faux » sans la
 * suite ; c'est l'utilisateur qui complete.
 */
export function amorceDeCorrection(hypothese: HypotheseDeCadrage): string {
  return `Correction du cadrage — « ${hypothese.affirmation} » est faux. En réalité : `
}

/**
 * La note remise au JUGE : les suppositions que le cadrage a portees sans les verifier.
 *
 * POURQUOI LE JUGE ET PAS SEULEMENT L'UTILISATEUR. Un livrable peut etre impeccable et reposer sur
 * une supposition fausse : le juge le validait alors en silence, parce que rien dans son prompt ne
 * nommait ce sur quoi le travail repose. La note ne cree aucune nouvelle source — elle rappelle ce
 * que le cadrage a lui-meme etiquete.
 *
 * CE QUE LA NOTE NE FAIT PAS : elle n'affirme pas que ces suppositions sont fausses. Remettre au
 * juge une conclusion deja tiree revient a lui faire tamponner un postulat au lieu de l'auditer. Il
 * lui est demande de VERIFIER celles dont le livrable depend, et de conclure sur ce qu'il a lu.
 */
export function noteHypothesesPourJuge(hypotheses: readonly HypotheseDeCadrage[]): string {
  if (!hypotheses.length) return ''
  const lignes = hypotheses.map((hypothese) => `- ${hypothese.affirmation}`).join('\n')
  return (
    `SUPPOSITIONS DU CADRAGE — le cadrage a lui-meme etiquete ces affirmations comme NON VERIFIEES, ` +
    `et le livrable peut reposer dessus :\n${lignes}\n` +
    `Pour chacune dont le livrable DEPEND : verifie-la avec tes outils de lecture et dis ce que tu as lu. ` +
    `Une supposition que ta lecture CONTREDIT est un defaut, meme si le reste du livrable est impeccable. ` +
    `Une supposition que tu ne peux pas trancher se dit en objection, jamais en silence — et ne conclus ` +
    `pas qu'une supposition est fausse du seul fait qu'elle figure ici.\n`
  )
}
