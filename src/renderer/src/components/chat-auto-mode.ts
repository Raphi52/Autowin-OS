/**
 * MODE AUTO du chat — renvoyer tout seul la suite proposée en fin de tour, jusqu'à ce que l'agent
 * dise qu'il ne reste RIEN à faire.
 *
 * Cadrage utilisateur (2026-09-02) : l'interrupteur vit dans la barre de gauche et reste ACTIF
 * jusqu'à désactivation, pas de remise à zéro au changement de fil.
 * Révision (2026-10-02, après conv-44) : la chaîne d'un fil s'arrête désormais toute seule quand le
 * quota hebdomadaire Claude atteint un seuil (80 % par défaut) OU après N tours automatiques
 * d'affilée sans message de l'utilisateur (6 par défaut) — seuils réglables, voir garde-fou 4.
 *
 * Chaque tour coûte de l'argent réel. Toute la décision vit donc ICI, pure et testable, plutôt que
 * noyée dans la vue : ce qui décide d'envoyer un tour payant doit pouvoir être lu d'un coup.
 *
 * Les garde-fous qui restent :
 * 1. ARRÊT SUR « RIEN » — la condition demandée. Elle se teste sur la rubrique « 👉 Recommandé »,
 *    JAMAIS sur le texte qui part dans le champ. Les deux diffèrent : le champ reçoit en priorité
 *    la ligne `AUTOWIN_PROMPT_V1`, et un modèle qui écrit « Recommandé — rien » PUIS un prompt
 *    quand même ferait tourner la boucle pour toujours si on testait le mauvais texte.
 * 2. UN TOUR TRAITÉ UNE SEULE FOIS — la décision porte une signature du tour ; le même tour ne peut
 *    pas déclencher deux envois, même si la vue se redessine dix fois.
 * 3. ANTI-BOUCLE — la même suite proposée deux fois d'affilée arrête tout.
 * 4. GARDE DE CHAÎNE — quota hebdomadaire Claude ou nombre de tours auto d'affilée (voir plus bas).
 */
import type { Msg, AsstMsg } from './chat-view-types'
import { langueCourante } from '../langue'
import { traduireChatFil } from '../textes-ecrans/chat-fil'
import type { ModelQuotaSnapshot } from '../../../shared/model-quotas'
import type { ChatPart } from './chat-view-model'
import {
  extrairePropositionsSuite,
  estPromptDePublication,
  publicationJamaisDemandee,
  signalFinExplicite,
  PROMPT_SALVAGE
} from '../../../shared/prompt-suivant'
import { extractRecommendation } from './markdown-recommandation'
import { parseAskDecision, promptDeLOption, promptDesOptions } from './ask-choices'
import {
  estCibleDestructrice,
  lireDecisionScout,
  normaliserPisteCible
} from '../../../shared/scout-cible-lecture'

/** Texte brut (avec la ligne technique du prompt) du DERNIER message de l'agent. */
export function texteDernierAssistant(fil: readonly Msg[]): string | null {
  const dernier = [...fil].reverse().find((m) => m.role === 'assistant') as AsstMsg | undefined
  if (!dernier) return null
  return (dernier.parts ?? [])
    .filter((p): p is Extract<ChatPart, { kind: 'text' }> => p.kind === 'text')
    .map((p) => p.text)
    .join('\n')
}

/**
 * LE TOUR AFFICHE EST-IL UN SCOUT ? Lu sur le pipeline REELLEMENT joue, pas sur le texte.
 *
 * Deriver ce signal du mot « scout » dans la demande serait faux dans les deux sens : « scout sur X »
 * peut router ailleurs, et un run lance autrement peut jouer un scout. Le bloc d'orchestration du
 * tour annonce les phases engagees dans l'ordre (`PipelineChoice.phase`) : on lit la DERNIERE.
 *
 * Pourquoi la derniere et pas « contient un scout » : un run `scout → frame → build` a DEJA choisi
 * sa cible et travaille dessus. Exiger de lui une ligne `CIBLE:` couperait une chaine saine.
 */
export function dernierTourEstUnScout(fil: readonly Msg[]): boolean {
  const dernier = [...fil].reverse().find((m) => m.role === 'assistant') as AsstMsg | undefined
  const phases = (dernier?.parts ?? []).flatMap((part) =>
    part.kind === 'action' ? (part.pipeline ?? []) : []
  )
  const derniereNommee = [...phases].reverse().find((choix) => choix.phase)?.phase
  return derniereNommee === 'scout'
}

/** La DERNIERE demande de l'utilisateur — ce a quoi le tour courant repond. */
export function texteDerniereDemande(fil: readonly Msg[]): string | null {
  const dernier = [...fil].reverse().find((m) => m.role === 'user') as
    Extract<Msg, { role: 'user' }> | undefined
  return dernier?.content ?? null
}

/**
 * Signature du tour courant. Deux redessins du MÊME tour la partagent ; un tour de plus la change.
 * Volontairement bâtie sur la longueur du fil et du texte : aucun identifiant n'est garanti présent
 * sur un message encore en cours de réception.
 */
export function signatureTour(fil: readonly Msg[]): string | null {
  const texte = texteDernierAssistant(fil)
  if (texte === null) return null
  return `${fil.length}::${texte.length}`
}

/**
 * « rien » posé SEUL sur sa ligne — MÊME EXIGENCE que pour « Fait » et « Reste à faire ».
 *
 * DÉFAUT VÉCU (« le mode auto se désactive tout seul ») : cette porte était la SEULE des trois à
 * accepter le mot n'importe où dans la phrase. Une recommandation bien réelle — « rien ne bloque,
 * lance le judge », « plus rien à vérifier ici, passe à X » — était lue comme une fin et coupait
 * l'interrupteur alors qu'une suite était proposée. Une suite qui existe n'est pas une fin.
 */
export function recommandationDitRien(recommandation: string | null): boolean {
  if (!recommandation) return false
  const lignes = recommandation.split(SAUT_ANCRAGE)
  return ligneNueDitRien(lignes) || lignes.some(estUneFinRedigee)
}

/**
 * UNE FIN ECRITE EN PHRASE, pas avec le mot nu (conv-787) : « Rien de plus sur ce sujet : le
 * comportement est retabli. » a ete RENVOYEE comme un ordre, un tour paye pour rien.
 *
 * On n'accepte que l'OUVERTURE de la ligne : « rien ne bloque, lance le judge » propose une vraie
 * suite et doit continuer a passer — d'ou l'absence de `ne`, `n'` et de tout verbe d'action ici.
 */
const OUVERTURE_DE_FIN =
  /^(?:(?:plus\s+)?rien\s+(?:de\s+plus|d'autre|a\s+(?:faire|ajouter|signaler|verifier|corriger))|aucune\s+(?:suite|action)(?:\s+\S+){0,2}\s*(?:necessaire|requise|prevue)?)\b|^rien\s*[:—–-]/
/** Ce qui transforme une fin annoncee en vraie suite : une action proposee sur la meme ligne. */
const OFFRE_DE_SUITE =
  /\b(?:tu\s+peux|on\s+peut|je\s+peux|passe|lance|relance|encha[iî]ne|envoie|dis-moi|donne-moi|regarde|clique|continue|reprends|v[eé]rifie|corrige)\b/u
function estUneFinRedigee(ligne: string): boolean {
  const nu = ligne
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’ʼ]/gu, "'")
    .replace(/^[\s>*•\-–—]+/u, '')
    .trim()
  if (!OUVERTURE_DE_FIN.test(nu)) return false
  // Une fin SUIVIE d'une offre reste une suite (mesure du 2026-09-12 : « rien d'autre : tu peux
  // m'envoyer un nom d'instance » avait ete pris pour une fin).
  return !OFFRE_DE_SUITE.test(nu)
}

/** Les quatre en-têtes du bloc de clôture : ils bornent la rubrique qu'on veut lire. */
const EN_TETES_CLOTURE =
  // `\**` en tête : les réponses réelles titrent en gras (« **✅ Fait** », conv-733).
  /^\s*\**\s*(?:✅|⚠️?|📍|⏳|👉)\s*\**\s*(Fait|Maintenant|Reste à faire|Recommandé)\b/u

/*
 * DÉFAUT CONNU DE LA LECTURE CI-DESSUS, LAISSÉ EN PLACE EXPRÈS (conv-1038, 2026-10-21).
 * `\b` ne connaît que les lettres ASCII : après le « é » final il ne voit aucune frontière, donc
 * l'intitulé « Recommandé » n'est JAMAIS reconnu (et « Recommandées » l'est, à tort). La rubrique
 * « Reste à faire » avale ainsi la recommandation qui la suit. Le corriger ici change les arrêts du
 * mode auto : sur les 2 970 clôtures du banc (`chat-auto-mode.corpus-reel.test.ts`), `reste-rien`
 * passe de 37 à 53 — « Reste : rien » suivi d'une vraie recommandation arrêterait la chaîne au lieu
 * de l'enchaîner. C'est un réglage du mode auto à trancher à part, pas un effet de bord du carnet.
 * La lecture EXACTE ci-dessous sert au carnet du fil ; le mode auto garde la sienne.
 * fix-ok: cause mesurée (conv-1038) — `/Recommandé\b/u.test('👉 Recommandé : x')` rend false : `\b` ne connaît que [A-Za-z0-9_], même avec `u` ; `(?![\p{L}\p{N}_])` borne le mot, rouge→vert dans chat-auto-mode.rubrique-bornee.test.ts.
 */
const EN_TETES_CLOTURE_EXACTS =
  /^\s*\**\s*(?:✅|⚠️?|📍|⏳|👉)\s*\**\s*(Fait|Maintenant|Reste à faire|Recommandé)(?![\p{L}\p{N}_])/u

/**
 * Contenu de la rubrique « ✅ Fait » : le reste de sa ligne d'en-tête ET les lignes qui la suivent,
 * jusqu'à la rubrique d'après. Précision utilisateur du 2026-09-02 : « dans le prompt il n'écrit
 * jamais le mot rien, mais il l'écrit souvent dans le bloc Fait ».
 */
function lignesDuBlocFait(texte: string): string[] {
  return lignesDeRubrique(texte, 'Fait')
}

/**
 * Les lignes d'UNE rubrique de clôture. Deux rubriques portent le mot « rien » — « ✅ Fait » et
 * « ⏳ Reste à faire » —, et la seconde est celle qu'Autowin écrit lui-même en fin de chaîne.
 * Exportée pour le carnet du fil (conv-1038), qui relit les quatre rubriques avec le MÊME découpage
 * (bornes, dernière clôture gagnante) mais la lecture `exacte` des intitulés — voir
 * `EN_TETES_CLOTURE_EXACTS` pour l'écart avec le mode auto, et pourquoi il n'est pas refermé ici.
 */
export function lignesDeRubrique(
  texte: string,
  rubrique: 'Fait' | 'Maintenant' | 'Reste à faire' | 'Recommandé',
  lecture: 'mode-auto' | 'exacte' = 'mode-auto'
): string[] {
  const enTetes = lecture === 'exacte' ? EN_TETES_CLOTURE_EXACTS : EN_TETES_CLOTURE
  const lignes = texte.split('\n')
  const sortie: string[] = []
  let dedans = false
  for (const brute of lignes) {
    const entete = brute.match(enTetes)
    if (entete) {
      dedans = entete[1] === rubrique
      if (dedans) {
        // PLUSIEURS CLOTURES DANS UN MESSAGE (sondage conv-787 : jusqu'a 3) — seule la DERNIERE dit
        // l'etat final. Les fusionner melangeait un « rien » ancien avec du travail encore listé.
        sortie.length = 0
        const reste = brute.replace(enTetes, '').replace(/^\s*\**\s*[:：—–-]?\s*/u, '')
        if (reste.trim()) sortie.push(reste)
      }
      continue
    }
    // BORNE BASSE (sondage conv-787) : sans elle, la rubrique avalait tout le texte qui suit quand
    // un message enchaine plusieurs etapes — jusqu'a un « ⚠️ » encore ouvert lu comme une fin.
    if (dedans && FIN_DE_RUBRIQUE.test(brute)) {
      dedans = false
      continue
    }
    if (dedans) sortie.push(brute)
  }
  return sortie
}

/** Ce qui ferme une rubrique de cloture autrement qu'une autre rubrique : une nouvelle section. */
const FIN_DE_RUBRIQUE =
  /^\s*(?:\[phase\s|#{1,6}\s|(?:---|___|\*\*\*)\s*$|AUTOWIN_(?:PROMPT|BESOIN)_V1\s*:|\*\*[^*]+\s*[:：]\*\*\s*$|```)/u

/**
 * « rien » posé SEUL sur une ligne (puce comprise) = la rubrique est vide. C'est le signal d'arrêt.
 *
 * On exige la ligne entière, pas le mot n'importe où : dans le bloc Fait, « rien de cassé » ou
 * « rien ne bloque » racontent un travail RÉUSSI — les prendre pour une fin couperait la boucle
 * alors qu'il reste tout à faire.
 */
export function blocFaitDitRien(texte: string): boolean {
  return ligneNueDitRien(lignesDuBlocFait(texte))
}

/**
 * FIN DE CHAÎNE D'AUTOWIN — « ⏳ Reste à faire : rien. »
 *
 * MESURE DU 2026-09-02 (journaux de la journée) : en rejouant la chaîne complète
 * scout → frame → terrain → build → clean → judge sur le texte que l'app produit VRAIMENT, le
 * dernier maillon rend « ⏳ Reste à faire : rien. » puis « 👉 Recommandé : passer à la prochaine
 * demande. ». Des quatre rubriques, c'était la SEULE que cette porte ne lisait pas : la boucle
 * envoyait donc « passer à la prochaine demande. » comme ordre — un tour PAYANT qui ne produit
 * rien, dans les 19,38 $/jour de rattrapage mesurés. Une chaîne finie éteint la boucle.
 *
 * Même exigence de précision que pour le bloc « Fait » : le mot doit être SEUL sur sa ligne.
 * « rien ne bloque le lancement de clean » raconte une suite POSSIBLE, pas une fin.
 */
function resteAFaireDitRien(texte: string): boolean {
  /*
   * SONDAGE conv-787 (2970 clotures reelles) : elargir cette porte aux fins ECRITES EN PHRASE, comme
   * on l'a fait pour « Recommande », a ete ESSAYE puis ANNULE. Cette rubrique n'est pas bornee par la
   * fin du message : quand plusieurs phases se suivent, elle avale la suite du texte, et une phrase
   * de fin trouvee la-dedans coupait des chaines qui portaient encore du travail (« ⚠️ Les 4 tickets
   * ne sont pas dans ta vue »). Le mot NU reste donc la seule condition ici.
   */
  const lignes = lignesDeRubrique(texte, 'Reste à faire')
  if (ligneNueDitRien(lignes)) return true
  /*
   * SONDAGE conv-787 (2970 clotures reelles) : une fin ECRITE en phrase ne vaut ici que si la
   * rubrique ENTIERE est cette fin. En acceptant UNE ligne parmi d'autres, la porte coupait des
   * clotures qui listaient encore du travail (« Verifier que SELECT … INTO est bien refuse »).
   */
  const contenu = lignes.filter((ligne) => ligne.trim() !== '')
  return contenu.length > 0 && contenu.every(estUneFinRedigee)
}

/**
 * LES FORMULATIONS EQUIVALENTES A « rien ».
 *
 * Demande utilisateur du 2026-09-11 (conv-468) : le modele avait cloture par « Aucune suite
 * necessaire. » — une fin de chaine explicite — et le mode auto avait continue, parce que seul le
 * mot `rien` nu etait reconnu. Le signal d'arret est le SENS de la ligne, pas un mot unique ;
 * l'exigence de ligne ENTIERE, elle, ne bouge pas (« aucune piste ne bloque » reste une suite).
 */
const LIGNES_DE_FIN = new Set([
  'rien',
  'rien a signaler',
  'rien a faire',
  'rien de plus',
  // Forme reellement ecrite le 2026-09-12, et qui a relance la chaine pour rien : « rien d'autre ».
  // Elle n'entre ici que NUE — « rien d'autre : envoie-moi X » reste une suite, comme
  // « rien a faire de plus sur X — enchaine sur Y » : une phrase qui propose quelque chose
  // n'est pas une fin, et c'est ce qui distingue cette porte d'une simple recherche de mot.
  "rien d'autre",
  'plus rien',
  'plus rien a faire',
  'aucune',
  'aucun',
  'aucune suite',
  'aucune suite necessaire',
  'aucune suite requise',
  'aucune action',
  'aucune action necessaire',
  'aucune action requise',
  'aucune suite prevue',
  'neant',
  'n/a',
  'terminé'.normalize('NFD').replace(/[̀-ͯ]/g, '')
])

function ligneNueDitRien(lignes: readonly string[]): boolean {
  return lignes.some((ligne) => {
    const nu = ligne
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      // L'apostrophe COURBE et l'apostrophe droite sont deux caracteres differents : sans cette
      // mise au meme format, « rien d’autre » et « rien d'autre » ne sont pas le meme texte, et
      // seule la moitie des fins ecrites serait reconnue (mesure du 2026-09-12).
      .replace(/[’ʼ]/gu, "'")
      .replace(/^[\s>*•\-–—]+/u, '')
      .replace(/[\s.;:!*`]+$/u, '')
      .trim()
    return LIGNES_DE_FIN.has(nu)
  })
}

/** Meme parade que prompt-suivant.ts : un saut de ligne ECRIT casse la compilation. */
const SAUT_ANCRAGE = String.fromCharCode(10)

/** Au-dela, l'ancrage noie le prompt qu'il accompagne : on le borne. */
const TACHE_ANCRAGE_MAX = 240

const borner = (texte: string, max = TACHE_ANCRAGE_MAX): string =>
  texte.length > max ? `${texte.slice(0, max).trimEnd()}…` : texte

/** « go », « ok », « continue »… : accepte une suite sans la nommer. Compare sur la forme repliee. */
const ACCORD_NU =
  /^(?:go|ok|okay|oki|oui|ouais|yes|vas[- ]?y|continue|continues|poursuis|reprends?|reprendre|fais[- ]le|d'?accord|dac|c'?est parti|on y va|valide|parfait|super|top|merci)$/

/** « 2 3 4 », « 1 », « 2 et 3 », « 2,4 » : un choix entre les options d'une question. */
const CHOIX_PAR_NUMEROS = /^\d{1,2}(?:\s*(?:[,;+&/]|\bet\b|\s)\s*\d{1,2})*$/

function replierAccord(texte: string): string {
  return texte
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’ʼ]/gu, "'")
    .replace(/[\s.!?;:]+$/u, '')
    .trim()
}

/** Les options designees par leurs numeros, dans la question posee JUSTE avant ce message. */
function optionsChoisies(fil: readonly Msg[], rang: number, choix: string): string | null {
  let question: AsstMsg | undefined
  for (let i = rang - 1; i >= 0 && !question; i--)
    if (fil[i].role === 'assistant') question = fil[i] as AsstMsg
  if (!question) return null
  const decisions = (question.parts ?? []).flatMap((part) => {
    if (part.kind === 'text') return []
    const d = parseAskDecision(part as { kind: string })
    return d ? [d] : []
  })
  const decision = decisions[decisions.length - 1]
  if (!decision) return null
  const numeros = [...choix.matchAll(/\d{1,2}/g)].map((m) => Number(m[0]))
  const options = numeros.map((n) => decision.options[n - 1])
  if (options.some((o) => !o)) return null
  return options.map((o) => promptDeLOption(o).trim()).join(' · ')
}

/**
 * LA DEMANDE D'ANCRAGE — la DERNIERE demande que l'utilisateur a faite LUI-MEME (conv-889,
 * 2026-09-30).
 *
 * REMPLACE « le PREMIER message du fil ». Demande utilisateur : « ancre le mode auto sur ma derniere
 * demande tapee a la main, pas sur le premier message du fil ». Constat sur conv-889 : parti de
 * « c'est quoi chatgpt dots », le fil a change de sujet plusieurs fois par des messages TAPES, et
 * chaque maillon automatique rappelait encore les Dots — l'ancre signalait une derive la ou
 * l'utilisateur avait lui-meme choisi le sujet. La derive a borner est celle que la machine produit
 * SANS lui, donc depuis sa derniere intervention.
 *
 * On remonte le fil depuis la fin, et on saute ce qui n'est pas une demande :
 *  - une ORIENTATION tapee pendant un tour : elle precise la demande en cours, elle n'en fonde pas ;
 *  - le tour de releve `PROMPT_NOUVELLE_CIBLE`, envoye sans ancre ;
 *  - un accord nu (« go », « ok », « continue ») : il accepte une suite, il ne la nomme pas.
 * Un choix par NUMEROS (« 2 3 4 ») est resolu en texte des options de la question qui le precede.
 *
 * UN ENVOI DU MODE AUTO porte l'ancre (voir `ancrerSurLaDemande`) : l'ancre qu'il porte EST la
 * reponse, et elle prime sur tout message plus ancien. Mesure conv-470 (saisie ts=1789159231523) :
 * lue sur la fenetre de messages CHARGEE, la tache devenait un maillon intermediaire des que la
 * fenetre ne commencait pas au debut du fil. Une ancre deja ecrite a ete calculee quand la fenetre
 * etait plus large : on la relit.
 */
export function derniereDemandeHumaine(fil: readonly Msg[]): string | null {
  for (let rang = fil.length - 1; rang >= 0; rang--) {
    const m = fil[rang]
    if (m.role !== 'user') continue
    const user = m as Extract<Msg, { role: 'user' }>
    if (user.orientation) continue
    const nu = (user.content ?? '').trim()
    if (!nu) continue
    const relue = ANCRE_DEJA_ECRITE.exec(nu)?.[1]?.trim()
    if (relue) return relue
    if (estUneReleve(nu)) continue
    if (ACCORD_NU.test(replierAccord(nu))) continue
    if (CHOIX_PAR_NUMEROS.test(nu)) {
      const resolu = optionsChoisies(fil, rang, nu)
      if (resolu) return borner(resolu)
      continue
    }
    return borner(nu)
  }
  return null
}

/**
 * CE QUE DEMANDE UN MESSAGE PRÉCIS du fil, lu avec les MÊMES règles que `derniereDemandeHumaine`,
 * mais sans remonter plus haut (conv-1059, carte du fil : une étape par demande, chacune titrée).
 * `accord` : « go », « ok »… accepte la suite proposée sans la nommer — l'appelant la retrouve dans
 * la clôture qui précède. `auto` : envoyé par le mode auto ; son texte est le prompt envoyé, SANS
 * l'ancrage qui le suit (l'ancrage cite une demande plus ancienne, pas celle de cette étape).
 */
export type LectureDemande = { genre: 'demande' | 'auto'; texte: string } | { genre: 'accord' }

/**
 * `max` : 240 caractères par défaut (l'ancrage du mode auto). La fiche du Board en demande bien plus,
 * pour montrer le message ENTIER (conv-1278, 2026-10-29).
 */
export function lectureDeLaDemande(
  fil: readonly Msg[],
  rang: number,
  max = TACHE_ANCRAGE_MAX
): LectureDemande | null {
  const m = fil[rang]
  if (!m || m.role !== 'user') return null
  const nu = ((m as Extract<Msg, { role: 'user' }>).content ?? '').trim()
  if (!nu) return null
  if (ANCRE_DEJA_ECRITE.test(nu))
    return {
      genre: 'auto',
      texte: borner(nu.slice(0, nu.search(/\(Mode auto — /u)).trim(), max)
    }
  if (estUneReleve(nu)) return { genre: 'auto', texte: borner(nu, max) }
  if (ACCORD_NU.test(replierAccord(nu))) return { genre: 'accord' }
  if (CHOIX_PAR_NUMEROS.test(nu)) {
    const resolu = optionsChoisies(fil, rang, nu)
    return { genre: 'demande', texte: borner(resolu ?? nu, max) }
  }
  return { genre: 'demande', texte: borner(nu, max) }
}

/**
 * Relit la demande citee par un ancrage precedent. Doit rester le miroir de `ancrerSurLaDemande`.
 * L'ancienne formule (« tâche initiale de ce fil », avant le 2026-09-30) reste lue : elle vit dans
 * les fils deja ecrits.
 */
const ANCRE_DEJA_ECRITE =
  /\(Mode auto — (?:tâche initiale de ce fil|dernière demande de l'utilisateur) : « ([\s\S]*?) »\./

/**
 * ANCRAGE ANTI-DERIVE — demande utilisateur du 2026-09-02 : « le mode auto doit pas trop trop
 * partir en couille par rapport a la tache initiale non plus ».
 *
 * La boucle renvoyait le prompt du DERNIER tour, et RIEN d'autre : chaque maillon etait redige a
 * partir du precedent, sans aucune trace de la demande de depart. Le seul garde-fou etait
 * `prompt-identique`, qui n'attrape qu'une repetition mot pour mot — une derive LENTE passait
 * librement (mesure sur conv-138 : partie de « juge la qualite de mon prompting », la chaine est
 * arrivee au shader du nuage d'accueil, six tours plus loin).
 *
 * Chaque envoi automatique porte donc la demande d'ancrage AVEC lui (depuis le 2026-09-30 : la
 * derniere demande de l'utilisateur, voir `derniereDemandeHumaine`), et l'ordre de s'arreter plutot
 * que de s'en eloigner. L'ancrage est ajoute au texte ENVOYE, jamais a la condition d'arret.
 */
export function ancrerSurLaDemande(texte: string, demande: string | null): string {
  if (!demande) return texte
  // La suite EST la demande (premier maillon) : l'ancrage ferait un doublon inutile.
  if (texte.trim() === demande.trim()) return texte
  /*
   * L'AUTEUR RÉEL EST DIT. Mesure conv-113 : saisie ts 1791317725882 envoyée seule après une simple
   * question ; le tour 27bdd9f2-d301-468f-9204-8b943e7e3c54 a vu l'écart puis a continué (« The user
   * explicitly sent the prompt… the user's real choice »). Un message au rôle utilisateur se lit
   * comme un choix de l'utilisateur tant que rien ne dit le contraire. La phrase vient APRÈS « ». » :
   * `ANCRE_DEJA_ECRITE` et `toursAutoDAffilee` relisent ainsi anciens et nouveaux fils à l'identique.
   */
  return [
    texte,
    '',
    `(Mode auto — dernière demande de l'utilisateur : « ${demande} ». Ce message n'a PAS été tapé par l'utilisateur : l'agent l'a écrit et le mode auto l'a envoyé seul. Si cette suite s'en éloigne, dis-le et`,
    'arrête la chaîne au lieu de dériver.)'
  ].join(SAUT_ANCRAGE)
}

export type RaisonArret =
  | 'inactif'
  | 'tour-en-cours'
  | 'deja-traite'
  | 'aucune-reponse'
  | 'brouillon'
  | 'fin-explicite'
  | 'recommandation-rien'
  | 'fait-rien'
  | 'reste-rien'
  | 'aucun-prompt'
  | 'prompt-identique'
  | 'chaine-finie'
  /* APRES UN SCOUT (conv-308) — types poses par le harnais, la logique reste a ecrire. */
  | 'scout-sans-cible'
  | 'cible-destructrice'
  /* MULTI-PISTES (`CIBLES:`) — des numeros seuls ne nomment rien hors du tableau. */
  | 'cibles-non-nommees'
  /* conv-751 — la suite parle a la place de l'utilisateur et annonce une donnee qu'il n'a pas donnee. */
  | 'suite-attend-utilisateur'
  /* conv-767 — la suite ne peut avancer qu'à un moment donné (heure, « demain », « quand X existe »). */
  | 'suite-differee'
  /* conv-42 — tour coupé avec une tâche de fond en vol, sans suite proposée : attente muette. */
  | 'tache-de-fond-coupee'
  /* conv-38 (2026-10-02) — garde-fou de la chaîne : quota hebdomadaire Claude, tours auto d'affilée. */
  | 'quota-hebdo'
  | 'tours-auto-max'
  /* conv-42 — tour coupé avec une tâche de fond en vol, sans suite proposée : attente muette. */
  | 'tache-de-fond-coupee'

export interface EntreeDecisionAuto {
  /** Le mode auto est-il armé ? */
  actif: boolean
  /** Un tour est en cours : on attend, on n'envoie pas. */
  occupe: boolean
  fil: readonly Msg[]
  /** Signature du dernier tour déjà traité par le mode auto (null = aucun). */
  dernierTourTraite: string | null
  /** Texte du dernier prompt envoyé automatiquement (anti-boucle). */
  dernierPromptEnvoye: string | null
  /** L'utilisateur a du texte dans le champ : on ne lui vole pas son tour, on PATIENTE. */
  brouillonPresent: boolean
  /**
   * FIN DE CHAINE : au lieu d'ETEINDRE l'interrupteur, demander a l'agent de PROPOSER une nouvelle
   * cible (demande utilisateur du 2026-09-05, conv-307 : « rien » ne doit plus couper le mode).
   *
   * Reserve au fil AFFICHE. Un fil d'arriere-plan garde l'ancien comportement : on cesse de le
   * suivre sans depenser un tour payant sur une conversation que personne ne regarde.
   */
  proposerNouvelleCible?: boolean
  /**
   * CE TOUR EST-IL UN SCOUT ? Un scout rend plusieurs pistes : sa suite ne part que si une ligne
   * `CIBLE:` nomme UNE piste (conv-308). Champ pose par le harnais de tests ; encore lu par
   * personne dans `deciderRelanceAuto` — c'est exactement ce que les tests rouges reclament.
   */
  tourEstUnScout?: boolean
  /**
   * LE DOSSIER DE TRAVAIL EST-IL UN DEPOT GIT ? Sans depot, aucune branche ni remise de cote a
   * trier : la suite n'est jamais reecrite en ordre de tri. Absent = `true`, l'ancien
   * comportement, pour ne jamais relacher le garde-fou par simple oubli d'appelant.
   */
  depotPresent?: boolean
  /**
   * RELANCES DIFFÉRÉES DÉJÀ PROGRAMMÉES D'AFFILÉE dans ce fil (conv-826 : « faudrait que le mode
   * auto gère ce cas au lieu de s'arrêter »). Au-delà de `MAX_RELANCES_DIFFEREES`, la chaîne se
   * met en pause : une attente qui ne finit jamais ne doit pas payer un tour toutes les 15 min.
   */
  relancesDifferees?: number
  /** Horloge injectable (tests). Absent = `Date.now()`. */
  maintenant?: number
  /** Quota hebdomadaire Claude utilisé, en % (null/absent = inconnu : ce seuil ne joue pas). */
  quotaHebdoPct?: number | null
  /**
   * Tours automatiques d'affilée comptés EN MÉMOIRE par la vue (secours : le fil chargé peut ne pas
   * montrer les ancres). La porte retient le plus grand de ce compte et de celui lu dans le fil.
   */
  toursAutoDAffilee?: number
  /** Seuils réglés par l'utilisateur. Absent = `SEUILS_CHAINE_DEFAUT`. */
  seuilsChaine?: SeuilsChaineAuto
}

/**
 * GARDE-FOU DE LA CHAÎNE ∞ (demande du 2026-10-02, conv-38). Mesure : conv-44 a consommé 226 M
 * tokens d'entrée en tours enchaînés juste avant le plafond hebdomadaire de Claude du 30/09. Rien
 * ne bornait une chaîne qui ne disait jamais « rien ». La chaîne s'arrête désormais quand le quota
 * hebdomadaire Claude atteint `quotaHebdoPct`, OU après `toursAutoMax` tours automatiques d'affilée
 * sans message de l'utilisateur.
 */
export interface SeuilsChaineAuto {
  quotaHebdoPct: number
  toursAutoMax: number
}
export const SEUILS_CHAINE_DEFAUT: SeuilsChaineAuto = { quotaHebdoPct: 80, toursAutoMax: 6 }
export const CLE_SEUILS_CHAINE_AUTO = 'autowin.chat.modeAuto.seuils'

/** Relit le réglage stocké ; une valeur absente ou illisible rend les défauts, une valeur absurde est bornée. */
export function lireSeuilsChaine(brut: string | null): SeuilsChaineAuto {
  if (!brut) return { ...SEUILS_CHAINE_DEFAUT }
  let lu: unknown
  try {
    lu = JSON.parse(brut)
  } catch {
    return { ...SEUILS_CHAINE_DEFAUT }
  }
  const r = (lu && typeof lu === 'object' ? lu : {}) as Record<string, unknown>
  const nombre = (v: unknown, min: number, max: number, defaut: number): number =>
    typeof v === 'number' && Number.isFinite(v)
      ? Math.min(max, Math.max(min, Math.round(v)))
      : defaut
  return {
    quotaHebdoPct: nombre(r.quotaHebdoPct, 1, 100, SEUILS_CHAINE_DEFAUT.quotaHebdoPct),
    toursAutoMax: nombre(r.toursAutoMax, 1, 1000, SEUILS_CHAINE_DEFAUT.toursAutoMax)
  }
}

/** Un message utilisateur envoyé PAR le mode auto (ancre posée par `ancrerSurLaDemande`, ou relève). */
function estEnvoiDuModeAuto(texte: string): boolean {
  const nu = texte.trim()
  return ANCRE_DEJA_ECRITE.test(nu) || estUneReleve(nu)
}

/** Les envois du mode auto depuis le dernier message ÉCRIT par l'utilisateur (orientations ignorées). */
function envoisAutoDepuisHumain(fil: readonly Msg[]): string[] {
  const envois: string[] = []
  for (let rang = fil.length - 1; rang >= 0; rang--) {
    const m = fil[rang]
    if (m.role !== 'user') continue
    const user = m as Extract<Msg, { role: 'user' }>
    if (user.orientation) continue
    const nu = (user.content ?? '').trim()
    if (!estEnvoiDuModeAuto(nu)) break
    envois.push(nu)
  }
  return envois
}

/** Tours automatiques envoyés depuis le dernier message ÉCRIT par l'utilisateur (orientations ignorées). */
export function toursAutoDAffilee(fil: readonly Msg[]): number {
  return envoisAutoDepuisHumain(fil).length
}

/**
 * Relèves (`PROMPT_NOUVELLE_CIBLE`) envoyées depuis le dernier message ÉCRIT par l'utilisateur.
 * Lu dans le FIL, pas en mémoire : le compte survit à un redémarrage, et repart de zéro de lui-même
 * dès que l'utilisateur écrit (ou clique une option), puisque la remontée s'arrête sur son message.
 */
export function relevesDepuisHumain(fil: readonly Msg[]): number {
  return envoisAutoDepuisHumain(fil).filter(estUneReleve).length
}

/** Le % utilisé de la fenêtre 7 j de Claude (le plus haut si plusieurs modèles), null si inconnu. */
export function quotaHebdoClaude(
  snapshot: Pick<ModelQuotaSnapshot, 'models'> | null | undefined
): number | null {
  let pire: number | null = null
  for (const model of snapshot?.models ?? []) {
    if (model?.provider !== 'claude') continue
    for (const w of model.windows ?? []) {
      if (w?.id !== 'seven-day' || w.limitKnown === false) continue
      if (!Number.isFinite(w.usedPercent)) continue
      pire = pire === null ? w.usedPercent : Math.max(pire, w.usedPercent)
    }
  }
  return pire
}

/** Le garde-fou seul : null = la chaîne peut continuer. Relu aussi par le minuteur des suites différées. */
export function arretChaineAuto(entree: {
  quotaHebdoPct?: number | null
  toursAutoDAffilee: number
  seuils?: SeuilsChaineAuto
}): { raison: RaisonArret; message: string } | null {
  // fix-ok: les messages promettaient une reprise que le code n'offre pas (« rallume ∞ » seul : compte de tours inchangé ; « reprendra quand le quota repassera sous le seuil » : ∞ éteint, rien ne le rallume) ; ils ne citent plus que les gestes réels.
  const seuils = entree.seuils ?? SEUILS_CHAINE_DEFAUT
  const quota = entree.quotaHebdoPct
  if (typeof quota === 'number' && Number.isFinite(quota) && quota >= seuils.quotaHebdoPct)
    return {
      raison: 'quota-hebdo',
      message: traduireChatFil('autoArret.quotaHebdo', langueCourante(), {
        quota: Math.round(quota),
        seuil: seuils.quotaHebdoPct
      })
    }
  if (entree.toursAutoDAffilee >= seuils.toursAutoMax)
    return {
      raison: 'tours-auto-max',
      message: traduireChatFil('autoArret.toursAutoMax', langueCourante(), {
        tours: entree.toursAutoDAffilee,
        seuil: seuils.toursAutoMax
      })
    }
  return null
}

export type DecisionAuto =
  | { action: 'envoyer'; texte: string; signature: string }
  /** Suite différée : elle part SEULE à `echeance` (ms epoch), pas maintenant. */
  | {
      action: 'programmer'
      texte: string
      signature: string
      echeance: number
      /** « quand fin.txt existe » : sondé (lecture seule) avant d'envoyer le tour. */
      fichier?: string
      /** « quand le tour de conv-N est terminé » : son état est sondé, gratuitement, avant le tour. */
      filAttendu?: string
    }
  | { action: 'attendre'; raison: RaisonArret }
  | { action: 'arreter'; raison: RaisonArret; message: string }

/**
 * SEUL « rien » ÉTEINT le mode. C'est la condition demandée, et la seule.
 *
 * DÉFAUT VÉCU le 2026-09-02 : « quand je change de conversation ça enlève le mode auto ». En
 * arrivant dans un autre fil, la boucle lisait sa DERNIÈRE réponse — souvent ancienne et sans
 * suite proposée — et s'éteignait comme si le travail était fini. Une absence de suite n'est pas
 * une fin : c'est juste « rien à envoyer sur CE tour ». On patiente, l'interrupteur reste allumé.
 */
// Lus à l'appel, dans la langue de l'interface (conv-1170) : chaque message est un accesseur.
const MESSAGES_ARRET: Record<string, string> = {
  get 'fin-explicite'() {
    return traduireChatFil('autoArret.finExplicite', langueCourante())
  },
  get 'recommandation-rien'() {
    return traduireChatFil('autoArret.recommandationRien', langueCourante())
  },
  get 'fait-rien'() {
    return traduireChatFil('autoArret.faitRien', langueCourante())
  },
  get 'reste-rien'() {
    return traduireChatFil('autoArret.resteRien', langueCourante())
  },
  get 'scout-sans-cible'() {
    return traduireChatFil('autoArret.scoutSansCible', langueCourante())
  },
  get 'cible-destructrice'() {
    return traduireChatFil('autoArret.cibleDestructrice', langueCourante())
  },
  get 'cibles-non-nommees'() {
    return traduireChatFil('autoArret.ciblesNonNommees', langueCourante())
  },
  get 'suite-attend-utilisateur'() {
    return traduireChatFil('autoArret.suiteAttendUtilisateur', langueCourante())
  },
  get 'suite-differee'() {
    return traduireChatFil('autoArret.suiteDifferee', langueCourante())
  },
  // conv-113, tour 27bdd9f2-d301-468f-9204-8b943e7e3c54 : « en pause » alors que ∞ venait d'être
  // ÉTEINT ; vu décoché ensuite, il a fait croire qu'il n'avait jamais été allumé.
  get 'tache-de-fond-coupee'() {
    return traduireChatFil('autoArret.tacheDeFondCoupee', langueCourante())
  }
}

/**
 * conv-42, tour 8268dddb-dfcc-4415-92d8-764b812603eb : l'agent lance 6 essais en arrière-plan, le
 * tour se termine, `providers/claude.ts` ajoute l'avis « Tâche de fond … à la fin de ce tour » et
 * aucune ligne AUTOWIN_PROMPT_V1 n'est écrite. Le mode auto attendait alors (`aucun-prompt`), 5
 * essais puis silence : « le mode auto stagne » sans un mot (saisie ts 1790932156905).
 */
const AVIS_TACHE_DE_FOND = /⚠️ Tâche de fond (pas terminée|arrêtée) à la fin de ce tour/

/**
 * UNE SUITE ECRITE A LA PLACE DE L'UTILISATEUR (« Voici les identifiants… », « je te donne… »).
 *
 * Mesure conv-751 : tour 4a4374c0-3f0c-4c42-82f0-ff6b03b76a27 propose « Voici les identifiants
 * Robux… : reporte-les » ; le mode auto l'envoie tel quel (saisie ts 1789993655768), SANS aucun
 * identifiant ; le tour 308ae1cf-9416-461f-a1ed-14775607df62 refuse d'inventer, ne propose rien, et
 * la chaine se tait (`aucun-prompt`) sans un mot. Seul l'utilisateur possede cette donnee : la suite
 * ne part pas seule, la pause est DITE.
 */
// Le verbe seul ne suffit pas : « Voici le message du bandeau : dis-moi… » (conv-787) est une suite
// ordinaire. Il faut qu'il porte une DONNEE que seul l'utilisateur detient.
const SUITE_PORTE_DONNEE_UTILISATEUR =
  /^\s*(?:voici|voil[aà]|je\s+te\s+(?:donne|colle|transmets|fournis|envoie))\s+(?:les|mes|le|la|l['’]|ma|nos|notre)\s*(?:\S+\s+){0,2}?(?:identifiants?|cl[ée]s?(?!\s+(?:de\s+(?:tri|cache|hachage)|primaires?|[ée]trang[eè]res?))|mots?\s+de\s+passe|tokens?|jetons?|secrets?|codes?\s+d['’]acc[eè]s|credentials?|logins?)(?![\p{L}])/iu
// Mesure conv-798 : saisie ts 1790170650709 « Lance webtest record sur l'adresse de ma webapp que je
// te donne : <adresse> » est partie SEULE, trou non rempli ; le tour suivant a dû redemander l'adresse,
// puis (tour 093342be-fc36-4489-864d-f091af4ec015) l'agent a DEVINÉ un projet au hasard sur D:.
// Un emplacement « : <mot> » en fin de ligne est une valeur que seul l'utilisateur peut écrire.
// « commande webtest record <url> qui … » (spécification, saisie ts 1790170354034) ne l'est pas.
const SUITE_A_TROU = /:\s*<[\p{L}][\p{L}\s_'’-]{0,30}>\s*$/mu
// Mesure conv-854 : saisies ts 1790329789299 et ts 1790331255647 (« J'ai saisi CE67N36QT et
// accepté, vérifie… ») sont parties SEULES, au nom de l'utilisateur, qui n'avait rien saisi. Les
// tours suivants ont vérifié une connexion jamais faite. Un geste de l'utilisateur affirmé en
// première personne en tête de suite est une donnée que seul lui détient.
const SUITE_AFFIRME_GESTE_UTILISATEUR =
  /^\s*j['’]ai\s+(?:bien\s+)?(?:saisi|valid[ée]|accept[ée]|tap[ée]|entr[ée]|confirm[ée]|autoris[ée]|approuv[ée])(?![\p{L}])/iu
// Mesuré le 2026-10-13 (passe /gc, relevée dans le Brain) et le 2026-10-28 (conv-1047) : le `/gc`
// propose la purge de ses corbeilles dans ses suites, et une suite libre ne passe par aucun filtre
// destructeur : celle du 13/10 est partie seule. Vider une corbeille ne se rattrape pas, seul
// l'utilisateur en décide.
//
// fix-ok: le refus listait des débuts de phrase, et le contrôle final du 31/10 a fait partir seules dans
// le vrai deciderRelanceAuto « Relance la purge… », « Confirme la purge… », « OK pour purger… »,
// « Continue : purge… ». Toute liste d'ouvertures laisse passer la suivante : la règle s'inverse. Une
// phrase qui vise la corbeille s'arrête, SAUF si sa clause annonce un travail par son premier verbe (le
// texte arrive ici sans accents ni capitales). « Ajoute un test à gc-purger-corbeilles.mjs » et
// « Supprime le bouton Corbeille » restent du travail ordinaire (règles trop larges, conv-787). La phrase
// se coupe en clauses, car « Vérifie la corbeille puis purge-la » commence par un travail. « pour » suivi
// d'un verbe coupe aussi : « Vérifie la corbeille pour la vider » annonce le geste. Les 4 verbes de lecture
// exclus ne font que garder « pour savoir ce qui reste » dans son travail.
// Coût mesuré le 31/10 sur 1 180 fils, 5 910 réponses et 7 306 suites distinctes, recommandations comprises :
// aucune décision ne change, et 3 suites s'arrêtent à tort (conv-504, conv-518, conv-1279).
const SUITE_DE_TRAVAIL = new RegExp(
  /^[\s`'"«*_>-]*(?:(?:puis|ensuite|then)\s+)?/.source +
    `(?:${[
      /(?:cherch|expliqu|analys|mesur|compar|regard|verifi|montr|list|resum|inspect)(?:e|er|ez)?/
        .source,
      /(?:diagnostiqu|examin|ajout|implement|corrig|document)(?:e|er|ez)?/.source,
      /reli(?:s|re)|li(?:s|re)|dis-moi|read|check|investigate|explain|find|show|add|fix/.source
    ].join('|')})\\b`,
  'u'
)
const CLAUSES =
  /[,;:.]\s+|\s[—–]\s|\s\(|\s(?:puis|ensuite|et|then|and|avant\s+de|plutot\s+que|before)\s|\savant\s+d['’]|\s(?:pour|afin\s+de)\s+(?!savoir\b|comprendre\b|voir\b|confirmer\b)(?=(?:(?:la|les?)\s+|l['’])?\p{L}+(?:er|ir|re)\b)/u
function uneClauseFait(geste: RegExp, nu: string): boolean {
  return nu.split(CLAUSES).some((clause) => geste.test(clause) && !SUITE_DE_TRAVAIL.test(clause))
}
// fix-ok: `uneClauseFait` juge chaque clause seule, et la cible se perd à la virgule : « Vérifie la
// corbeille, puis fais-la disparaître » et « Relis gc-purge-auto.json, puis crée-le » partaient seules (sonde
// du 31/10 : envoyer, 28 rouges). Lister les pronoms laisserait passer « puis libère la place » : comme pour
// les ouvertures, la règle s'inverse. Dès la clause qui nomme la cible, seul un travail annoncé continue.
function uneClauseFaitDepuisLaCible(cible: RegExp, nu: string, permise?: RegExp): boolean {
  const clauses = nu.split(CLAUSES)
  const depart = clauses.findIndex((clause) => cible.test(clause))
  return (
    depart >= 0 &&
    clauses.slice(depart).some((clause) => !SUITE_DE_TRAVAIL.test(clause) && !permise?.test(clause))
  )
}
// La forme en -ée dit un constat, pas un geste : « la copie n'a pas été effacée » (passe du 24/10).
// fix-ok: une sonde sur 285 formes en a fait partir 96 seules (31/10) : « jeter » manquait à VIDER, et
// « Supprime la corbeille » ou « Delete the trash » n'étaient lus nulle part hors de `gc-corbeille`.
const VIDER =
  /purg(?!ees?\b)\w*|vid(?:e|er|ez|ons)\b|empty\b|jett\w*|jet(?:er|ez|ons)\b|nettoi\w*|nettoy\w*|menage\b|clear\b|liber(?!ees?\b)\w*|disparaitr\w*/
    .source
const SUPPRIMER = [
  /(?:supprim|effac|detrui|enlev|elimin|debarrass|degag)(?!ees?\b)\w*/.source,
  /vir(?:e|er|ez)\b|delete\b|remove\b|erase\b|wipe\b|destroy\b|clean\b|rm\s+-/.source
].join('|')
// À part : « retire-la » est permis dans une passe (GESTE_DANS_UNE_PASSE), pas sur une corbeille.
const SUR_UNE_CORBEILLE = `${SUPPRIMER}|${/retir(?!ees?\b)\w*/.source}`
const GESTE_DE_VIDAGE = new RegExp(`\\b(?:${VIDER})`, 'u')
const GESTE_DE_SUPPRESSION = new RegExp(`\\b(?:${SUPPRIMER})`, 'u')
// Verbe et corbeille dans la même clause : « Supprime le doublon, puis vérifie la corbeille » reste du
// travail.
const RETRAIT_DE_CORBEILLE = new RegExp(
  `(?=.*\\b(?:corbeilles?|trash)\\b).*\\b(?:${SUR_UNE_CORBEILLE})`,
  'u'
)
// Un lieu n'est pas une cible (CORBEILLE_EN_DESTINATION), et « sans les restaurer » y reste permis
// (conv-1279). Seul un pronom renvoie alors à ce qu'il contient, quel que soit son verbe : « Relis les
// fichiers dans la corbeille, puis fais-les disparaître ». « dis-le-moi » ne renvoie à aucun geste.
const RENVOI_PAR_PRONOM = /-(?:la|les|le|en|y)(?![\p{L}-])|\b(?:it|them)\b/u
// Le mot désigne ici l'interface ou le code, pas la poubelle : « Supprime le bouton Corbeille ». Un mot
// oublié dans cette liste coûte une réponse à la main, jamais une purge : elle reste courte.
const CORBEILLE_SIMPLE_MOT = new RegExp(
  [
    /\b(?:bouton|button|icone|icon|onglet|tab|menu|lien|link|vue|view|section|colonne)\b/.source,
    /\b(?:libelle|label|mot|fonction|test|code|commentaire)\b/.source
  ]
    .map((mot) => `${mot}[^,;:.]{0,30}?\\b(?:corbeilles?|trash)\\b`)
    .join('|') + /|\b(?:corbeilles?|trash)\s+(?:button|icon|tab|menu|link|view)\b/.source,
  'gu'
)
// Les réponses de la question du `/gc` (skills/gc/SKILL.md) : aucune ne nomme la corbeille.
const REPONSE_DE_PURGE = /\bpurge\s+cette\s+fois\b|\bvide\s+seul\b|\bactiv\w*\s+(?:la\s+)?purge\b/u
const NOMME_UNE_CORBEILLE = /\b(?:corbeilles?|trash)\b/u
// Une corbeille VISÉE arrête la suite quel que soit le verbe : aucune liste ne tient (« Fais disparaître
// la corbeille », « La corbeille doit être vidée »). « Dans la corbeille » n'en vise aucune : y déplacer
// se rattrape, et y lire ne détruit rien. Mesuré le 31/10 : sans cette réserve, 7 suites réelles sur les
// 11 qui nomment une corbeille s'arrêtaient à tort (« Envoie aussi à la Corbeille… », conv-1167). Le
// retrait y reste lu à part : « Supprime les fichiers dans la corbeille » vide bien.
const CORBEILLE_EN_DESTINATION =
  /\b(?:dans|a|au|en|vers|into|to|in)\s+(?:(?:la|le|les|un|une|the)\s+)?(?:dossier\s+)?\.?(?:corbeilles?|trash)\b/gu
function suiteVideUneCorbeille(nu: string): boolean {
  const sansLeMot = nu.replace(CORBEILLE_SIMPLE_MOT, ' ')
  const visee = sansLeMot.replace(CORBEILLE_EN_DESTINATION, ' ')
  return (
    (NOMME_UNE_CORBEILLE.test(nu) && uneClauseFait(GESTE_DE_VIDAGE, nu)) ||
    (nu.includes('gc-corbeille') && uneClauseFait(GESTE_DE_SUPPRESSION, nu)) ||
    uneClauseFait(RETRAIT_DE_CORBEILLE, sansLeMot) ||
    (NOMME_UNE_CORBEILLE.test(sansLeMot) && uneClauseFait(RENVOI_PAR_PRONOM, sansLeMot)) ||
    uneClauseFaitDepuisLaCible(NOMME_UNE_CORBEILLE, visee) ||
    uneClauseFait(REPONSE_DE_PURGE, nu)
  )
}
// Les deux gestes qui autorisent le script. C'est le geste qui compte, pas le nom : « Ajoute un test à
// l'option --cette-fois » reste du travail. Retirer l'accord (« Supprime gc-purge-auto.json ») ne vide
// rien, et une valeur écrite dans ce fichier en pose un, quel que soit le verbe qui l'annonce.
//
// fix-ok: le retrait se lisait sur toute la phrase : « Supprime le bouton, puis crée gc-purge-auto.json »
// passait pour un retrait de l'accord alors qu'elle en pose un (sonde du 31/10 : envoyer). Il vaut donc
// pour sa clause seule, et le verbe doit viser le fichier de près : « pour créer » ne le vise pas.
const RETIRE_L_ACCORD =
  /^[\s`'"«*_>-]*(?:puis\s+)?(?:supprim|retir|effac|desactiv|remove|delete)\w*(?:-(?:le|la)\b|\s+(?:\S+\s+){0,3}?(?:\S*gc-purge-auto|fichier\s+d['’]accord))/u
const VALEUR_D_ACCORD = /\b(?:enabled|true)\b/u
const OPTION_CETTE_FOIS = /--cette-fois\b/u
const NOMME_L_ACCORD = /gc-purge-auto|fichier\s+d['’]accord/u
// Après le fichier d'accord, retirer l'accord ou relancer le `/gc` n'en pose aucun.
const NE_POSE_PAS_L_ACCORD = new RegExp(
  `${RETIRE_L_ACCORD.source}|^[^/]*lance\\w*\\s+(?:le\\s+)?/gc\\b`,
  'u'
)
function suiteAutoriseLaPurge(nu: string): boolean {
  if (uneClauseFaitDepuisLaCible(OPTION_CETTE_FOIS, nu)) return true
  if (!NOMME_L_ACCORD.test(nu)) return false
  return (
    uneClauseFaitDepuisLaCible(NOMME_L_ACCORD, nu, NE_POSE_PAS_L_ACCORD) ||
    nu
      .split(CLAUSES)
      .some((clause) => !RETIRE_L_ACCORD.test(clause) && VALEUR_D_ACCORD.test(clause))
  )
}
export function suiteAttendUneDonneeUtilisateur(suite: string): boolean {
  const nu = normaliserPisteCible(suite)
  return (
    SUITE_PORTE_DONNEE_UTILISATEUR.test(suite) ||
    SUITE_A_TROU.test(suite) ||
    SUITE_AFFIRME_GESTE_UTILISATEUR.test(suite) ||
    suiteVideUneCorbeille(nu) ||
    suiteAutoriseLaPurge(nu)
  )
}

/*
 * CE QU'UNE SUITE VEUT DIRE DÉPEND DE LA RÉPONSE QUI LA PORTE (conv-1341, 2026-10-30).
 *
 * « Purge both », texte réel de la question du 28/10 (conv-1047, message 11), ne nomme aucune corbeille :
 * lue seule, cette phrase ne se distingue pas de « Purge le cache du navigateur ». Toutes les passes
 * `/gc` de conv-1047 ont une rubrique « ## À purger » (format fixé par skills/gc/SKILL.md), et un fil de
 * code sur la corbeille n'a aucune raison d'en écrire une : c'est le contexte qui tranche.
 *
 * Dans une telle réponse, la règle est stricte, parce qu'elle ne coûte rien (conv-1341, 2026-10-31) : la
 * consigne y interdit toute suite de purge, et les 8 passes réelles n'ont proposé que 2 suites, dont une
 * purge. Seul un travail annoncé par son premier verbe, sans geste de purge, continue : la passe du 24/10
 * proposait « Cherche pourquoi … n'a pas été effacée, puis retire-la ». Tout le reste (« Oui, cette
 * fois », « Il faut purger les deux », « Proceed », « Non, garde ») répond à la place de l'utilisateur.
 */
const RUBRIQUE_A_PURGER = /^#{1,6}\s*a\s+purger\b/mu
// « retire-la » reste permis : c'est la suite réelle du 24/10, qui visait une copie temporaire.
const GESTE_DANS_UNE_PASSE = new RegExp(
  `\\b(?:${VIDER}|${SUPPRIMER}|cette[\\s-]+fois\\b|retir\\w*\\s+(?:les|tout)\\b)`,
  'u'
)
function suiteRepondALaPasseGc(suite: string, texteReponse: string): boolean {
  if (!RUBRIQUE_A_PURGER.test(normaliserPisteCible(texteReponse))) return false
  const nu = normaliserPisteCible(suite)
  return !SUITE_DE_TRAVAIL.test(nu) || GESTE_DANS_UNE_PASSE.test(nu)
}

/**
 * UNE SUITE QUI NE PEUT AVANCER QU'À UN MOMENT DONNÉ.
 *
 * Mesure conv-767 (2026-09-21, 20:59 → 21:04) : un tournoi programmé pour 01:05 ; la suite proposée
 * « Relis debut.txt, statut.txt et fin.txt de essais/t2c-2026-09-22… » est partie TROIS fois, chaque
 * fois pour constater « rien n'a encore démarré ». L'échéance n'était PAS dans le prompt : elle vivait
 * dans « 👉 Recommandé » (« Demain matin, relire… ») ou dans le prompt lui-même sous la forme
 * « Quand … fin.txt existe, … ». Les deux textes sont donc lus. Le mode auto ne sait pas attendre une
 * heure : relancer tout de suite ne peut que constater l'attente, à chaque fois payée.
 */
// fix-ok: la branche suite-differee de deciderRelanceAuto renvoyait arreter (mesure conv-826 : mode auto en pause sur « quand fin.txt existe ») ; elle renvoie maintenant programmer avec une echeance calculee.
const SUITE_DIFFEREE = new RegExp(
  [
    String.raw`\b(?:demain|ce\s+soir|cette\s+nuit|plus\s+tard)\b`,
    String.raw`\bdans\s+(?:\d+|quelques)\s*(?:min(?:utes?)?|h|heures?)\b`,
    // `\b` ignore « à » (hors ASCII) : on borne à gauche par un début de texte ou une espace.
    // `des` SANS accent est un article (« le calcul des 12 h de retention ») : seul `dès` compte.
    String.raw`(?:^|[\s(])(?:apr[eè]s|vers|dès|à|a)\s+\d{1,2}\s*(?:h|:)\s*\d{0,2}\b`,
    // Le point est permis : un nom de fichier (« fin.txt ») en porte un. La borne reste la ligne.
    String.raw`\bquand\b[^\n]{0,80}?\b(?:existe(?:ra)?|appara[iî]t(?:ra)?|sera\s+(?:apparu|fini|termin[ée]|pr[eê]t)|aura\s+fini)\b`
  ].join('|'),
  'iu'
)
export const MAX_RELANCES_DIFFEREES = 12
const MINUTE = 60_000
/** « quand X existe », « plus tard », « cette nuit » : aucune heure lisible — on revient voir. */
export const DELAI_SONDAGE_DIFFERE = 15 * MINUTE
/** « quand X existe » avec chemin lisible : sonde GRATUITE du fichier (fs:exists), pas un tour payé. */
export const DELAI_SONDAGE_FICHIER = 5 * MINUTE
export const DUREE_MAX_SONDAGE_FICHIER = 48 * 60 * MINUTE
const ECHEANCE_MAX = 24 * 60 * MINUTE

/**
 * QUAND relancer une suite différée (conv-826). Ordre : heure explicite (« à 01:05 ») → durée
 * (« dans 2 h », « après 1h ») → « demain » (8 h) / « ce soir » (19 h) → sinon on revient voir
 * toutes les 15 min. Toujours dans le futur (≥ 1 min), jamais au-delà de 24 h.
 */
export function echeanceSuiteDifferee(
  suite: string,
  recommandation: string | null,
  maintenant: number
): number {
  const texte = `${suite}\n${recommandation ?? ''}`
  const borne = (t: number): number =>
    Math.min(maintenant + ECHEANCE_MAX, Math.max(maintenant + MINUTE, t))
  const heure = /(?:^|[\s(])(?:apr[eè]s|vers|dès|à|a)\s+(\d{1,2})\s*(?:h|:)\s*(\d{2})(?!\d)/iu.exec(texte)
  if (heure) {
    const d = new Date(maintenant)
    d.setHours(Number(heure[1]), Number(heure[2]), 0, 0)
    if (d.getTime() <= maintenant) d.setDate(d.getDate() + 1)
    return borne(d.getTime())
  }
  const duree = /(?:^|[\s(])(?:dans|apr[eè]s)\s+(\d+|quelques)\s*(min(?:utes?)?|h|heures?)(?![\p{L}\d:])/iu.exec(texte)
  if (duree) {
    const enMinutes = /^min/i.test(duree[2])
    const n = duree[1].toLowerCase() === 'quelques' ? (enMinutes ? 10 : 2) : Number(duree[1])
    return borne(maintenant + n * (enMinutes ? MINUTE : 60 * MINUTE))
  }
  const aHeure = (h: number, jours: number): number => {
    const d = new Date(maintenant)
    d.setDate(d.getDate() + jours)
    d.setHours(h, 0, 0, 0)
    return d.getTime()
  }
  if (/\bdemain\b/iu.test(texte)) return borne(aHeure(8, 1))
  if (/\bce\s+soir\b/iu.test(texte) && aHeure(19, 0) > maintenant) return borne(aHeure(19, 0))
  return borne(maintenant + DELAI_SONDAGE_DIFFERE)
}

/**
 * LE FICHIER ATTENDU d'une suite « quand X existe » (conv-826) : le mode auto le sonde — lecture
 * seule, gratuite — avant de payer un tour. `null` = aucune condition de fichier lisible.
 */
export function fichierAttenduSuiteDifferee(
  suite: string,
  recommandation: string | null
): string | null {
  const m =
    /\bquand\b[^\n]{0,80}?[`"'«\s]([^\s`"'«»]*\.[A-Za-z0-9]{1,8})[`"'»]?\s+(?:existe(?:ra)?|appara[iî]t(?:ra)?|sera\s+(?:apparu|pr[eê]t))\b/iu.exec(
      `${suite}\n${recommandation ?? ''}`
    )
  return m ? m[1] : null
}

/**
 * LE FIL ATTENDU d'une suite « quand le tour de conv-N est terminé » (conv-1069). Mesuré sur
 * conv-1065 : la question « conv-N a-t-il fini ? » est partie 5 fois, dont 2 tours PAYÉS pour lire
 * « pas terminé », et la fin a été vue 51 min en retard. Le mode auto sonde désormais l'état du fil
 * — lecture gratuite (`pilotChatActive`, l'autorité du processus principal) — avant de payer un tour.
 * `null` = aucune condition de fin de fil lisible. `\b` ignore « é » : la fin est bornée par une lettre.
 */
const FIL_ATTENDU = new RegExp(
  [
    String.raw`\b(?:quand|d[eè]s\s+que|lorsque)\b[^\n]{0,60}?\b(conv-\d+)\b[^\n]{0,40}?\b(?:est|sera|a|aura)\s+(?:fini|termin[ée]e?|achev[ée]e?|clos)(?![\p{L}])`,
    String.raw`(?:^|[\s(])[àa]\s+la\s+fin\s+(?:du\s+tour\s+)?de\s+(conv-\d+)\b`
  ].join('|'),
  'iu'
)
export const DELAI_SONDAGE_FIL = MINUTE
export const DUREE_MAX_SONDAGE_FIL = 24 * 60 * MINUTE

export function filAttenduSuiteDifferee(
  suite: string,
  recommandation: string | null
): string | null {
  const m = FIL_ATTENDU.exec(`${suite}\n${recommandation ?? ''}`)
  return m ? (m[1] ?? m[2] ?? null) : null
}

export function suiteEstDifferee(suite: string, recommandation: string | null): boolean {
  return (
    SUITE_DIFFEREE.test(suite) ||
    (recommandation !== null && SUITE_DIFFEREE.test(recommandation)) ||
    filAttenduSuiteDifferee(suite, recommandation) !== null
  )
}

/**
 * Debut COMMUN a toutes les versions de la releve. Les fils et `dernierPromptEnvoye` gardent les
 * releves deja envoyees, dont celles au texte d'avant conv-996 (« …, et attends mon choix. ») :
 * les reconnaitre au texte complet les ferait oublier, et la releve repartirait en double.
 */
const DEBUT_RELEVE =
  'La chaîne de ce fil est terminée. Ne lance aucun chantier : propose-moi avec `ask` 2 à 10 ' +
  'nouvelles cibles concrètes issues de ce qui vient d’être fait'

/** Ce message est-il une releve du mode auto, quelle que soit la version de son texte ? */
export function estUneReleve(texte: string): boolean {
  return texte.trim().startsWith(DEBUT_RELEVE)
}

/**
 * LE TOUR DE RELEVE, envoye UNE SEULE FOIS par serie automatique quand la chaine est finie.
 *
 * Il ne fabrique aucune tache : il demande a l'agent de PROPOSER des cibles. La borne de cout est
 * `relevesDepuisHumain` : une releve deja presente dans le fil depuis le dernier message de
 * l'utilisateur rend `chaine-finie`, et la boucle patiente au lieu de repartir.
 * (`prompt-identique` ne la protege PAS : ce chemin rend la main avant lui, et la reponse
 * automatique a l'`ask` s'intercale entre deux releves.)
 *
 * ELLE NE PROMET PLUS D'ATTENDRE (conv-996, 2026-10-16). Elle finissait par « et attends mon
 * choix », alors que `reponseAutoAuDernierAsk` envoie SEULE l'option recommandee de l'`ask` qu'elle
 * demande. L'agent a pris cet envoi pour une derive et a refuse de l'executer ; l'utilisateur a
 * tranche : « trust le pouvoir du mode auto ». Le texte dit donc ce qui va se passer.
 */
export const PROMPT_NOUVELLE_CIBLE =
  `${DEBUT_RELEVE}. En mode auto, l’option recommandée (la première) partira seule comme ma ` +
  'réponse : rédige-la pour qu’elle s’exécute telle quelle. Seule une option destructrice ' +
  'attendra mon accord.'

/**
 * PREMIER PASSAGE DANS UN FIL : faut-il figer le tour deja affiche, ou le laisser partir ?
 *
 * Figer est le defaut, et c'est voulu : rouvrir une conversation de la veille ne doit pas relancer
 * un tour payant que personne n'a demande. Deux situations disent le CONTRAIRE, et elles ne sont
 * pas des « ouvertures » :
 *  - l'utilisateur vient d'allumer l'interrupteur EN VOYANT la suite proposee — c'est sa demande ;
 *  - l'agent a redemarre l'app LUI-MEME au milieu de la chaine (`restart_app` a pose une consigne
 *    de reprise sur le disque). Defaut vecu le 2026-09-05 (conv-303) : le repere de passage vit en
 *    memoire, le redemarrage l'efface, la boucle croit arriver dans le fil et saute le maillon
 *    suivant. L'interrupteur reste allume mais la chaine meurt en silence.
 *
 * Hors de ces deux cas — fermeture subie, simple rafraichissement — on fige, comme avant.
 */
export function premierPassageLaisseSortirLeTour(entree: {
  allumageManuel: boolean
  repriseApresRedemarrage: boolean
  /** Le tour attend un FICHIER (`attenteFichierAReprendre`) : sa surveillance est gratuite, on la reprend. */
  attenteFichier?: boolean
}): boolean {
  return entree.allumageManuel || entree.repriseApresRedemarrage || entree.attenteFichier === true
}

/**
 * REPRISE D'UNE ATTENTE DE FICHIER après un redémarrage (conv-826, 2026-09-26 — demande de
 * l'utilisateur : « après un redémarrage, ∞ reprend tout seul l'attente d'un fichier encore attendu »).
 *
 * Défaut vécu : la suite « Quand …/fin.txt existe, compare… » était surveillée par un minuteur de
 * l'écran. L'app a redémarré à 10:48 ; le minuteur est mort, et le premier passage a marqué le
 * tour « déjà traité ». fin.txt est apparu à 12:38:36 et rien n'est parti avant 15:57, ∞ affiché
 * allumé. Le gel du premier passage protège d'un tour PAYÉ que personne n'a demandé ; or une attente
 * de fichier ne coûte rien tant que le fichier manque, et n'envoie que la suite qu'on avait armée.
 *
 * Rend la décision `programmer` à reprendre, ou null. Bornes : seule une suite qui nomme un FICHIER
 * (une échéance horaire repaierait un tour) ; tour d'au plus `DUREE_MAX_SONDAGE_FICHIER`, mesuré depuis
 * la saisie qui l'a lancé — âge inconnu = pas de reprise, faute de pouvoir le borner.
 */
export function attenteFichierAReprendre(
  entree: Omit<EntreeDecisionAuto, 'dernierTourTraite' | 'dernierPromptEnvoye'>
): Extract<DecisionAuto, { action: 'programmer' }> | null {
  // Un message de l'utilisateur APRÈS la suite l'a annulée (même règle que le minuteur) : rien à reprendre.
  if (entree.fil[entree.fil.length - 1]?.role !== 'assistant') return null
  const decision = deciderRelanceAuto({ ...entree, dernierTourTraite: null, dernierPromptEnvoye: null })
  if (decision.action !== 'programmer' || !decision.fichier) return null
  const saisie = [...entree.fil].reverse().find((m) => m.role === 'user') as { ts?: number } | undefined
  if (typeof saisie?.ts !== 'number') return null
  if ((entree.maintenant ?? Date.now()) - saisie.ts > DUREE_MAX_SONDAGE_FICHIER) return null
  return decision
}

/** La dernière question de la dernière réponse, ou null. */
function dernierAsk(fil: readonly Msg[]): ReturnType<typeof parseAskDecision> {
  const dernier = [...fil].reverse().find((m) => m.role === 'assistant') as AsstMsg | undefined
  const decisions = (dernier?.parts ?? []).flatMap((part) => {
    if (part.kind === 'text') return []
    const d = parseAskDecision(part as { kind: string })
    return d ? [d] : []
  })
  return decisions[decisions.length - 1] ?? null
}

// fix-ok: suite identique au tour precedent (turnId 98ce00d9-2276-4a96-bb15-b66c622bfee8, saisie ts 1789970040849) = arret anti-boucle alors que le tour rapportait un travail dans « ✅ Fait » ; titres en gras non reconnus.
/**
 * QUESTION `ask` OUVERTE AU BOUT DU FIL — en mode auto, l'agent y repond SEUL (demande utilisateur
 * du 2026-09-21 : « le mode auto doit répondre seul aux ask »). On prend l'option marquee
 * `recommande`, sinon la PREMIERE (le contrat de `ask` place la recommandee en tete). Une reponse
 * destructrice ne part jamais seule : on rend null et la question attend l'humain. Dans une passe
 * `/gc`, un simple « Oui » à « Purger ? » l'est aussi : le mot destructeur est dans la question, pas
 * dans l'option (conv-1341, 2026-10-30, rouge mesuré : le mode auto répondait « Oui » seul). La question
 * de purge du `/gc` ne se répond pas du tout, même par « Non, garde » : skills/gc/SKILL.md le promet,
 * et le contrôle du 31/10 a fait partir ce « Non » recommandé ou coché en choix multiple.
 */
export function reponseAutoAuDernierAsk(fil: readonly Msg[]): string | null {
  const decision = dernierAsk(fil)
  if (!decision) return null
  const estLaQuestionDePurge = decision.options.some((o) =>
    REPONSE_DE_PURGE.test(normaliserPisteCible(promptDeLOption(o)))
  )
  if (estLaQuestionDePurge) return null
  const texteReponse = texteDernierAssistant(fil) ?? ''
  const sure = (o: (typeof decision.options)[number]): boolean => {
    const t = promptDeLOption(o).trim()
    return t !== '' && !estCibleDestructrice(t) && !suiteRepondALaPasseGc(t, texteReponse)
  }
  // CHOIX NON CONCURRENTS (`choixMultiple`) : on coche TOUTES les options sures — demande utilisateur
  // conv-787 : « par défaut tous les choix si pas concurrents sinon faire au mieux ».
  if (decision.choixMultiple) {
    const retenues = decision.options.filter(sure)
    return retenues.length > 0 ? promptDesOptions(retenues).trim() : null
  }
  // CHOIX CONCURRENTS : au mieux = la recommandee, sinon la premiere.
  const option = decision.options.find((o) => o.recommande) ?? decision.options[0]
  return sure(option) ? promptDeLOption(option).trim() : null
}

/** La SEULE porte qui autorise un envoi automatique. Tout le reste de la vue s'y plie. */
export function deciderRelanceAuto(entree: EntreeDecisionAuto): DecisionAuto {
  const decision = deciderSuiteAuto(entree)
  // Le garde-fou de la chaîne ne retient que ce qui PAIERAIT un tour : envoi immédiat ou programmé.
  if (decision.action !== 'envoyer' && decision.action !== 'programmer') return decision
  const arret = arretChaineAuto({
    quotaHebdoPct: entree.quotaHebdoPct,
    toursAutoDAffilee: Math.max(toursAutoDAffilee(entree.fil), entree.toursAutoDAffilee ?? 0),
    seuils: entree.seuilsChaine
  })
  return arret ? { action: 'arreter', ...arret } : decision
}

function deciderSuiteAuto(entree: EntreeDecisionAuto): DecisionAuto {
  if (!entree.actif) return { action: 'attendre', raison: 'inactif' }
  if (entree.occupe) return { action: 'attendre', raison: 'tour-en-cours' }
  const signature = signatureTour(entree.fil)
  if (signature === null) return { action: 'attendre', raison: 'aucune-reponse' }
  if (signature === entree.dernierTourTraite) return { action: 'attendre', raison: 'deja-traite' }
  // Le mode reste ARMÉ pendant que l'utilisateur écrit : on patiente, on ne se coupe pas.
  if (entree.brouillonPresent) return { action: 'attendre', raison: 'brouillon' }
  // Une question `ask` ouverte : le mode auto choisit l'option recommandee a la place de l'humain.
  const reponseAsk = reponseAutoAuDernierAsk(entree.fil)
  /*
   * La reponse choisie SEULE est ancree comme les autres envois automatiques. Sans ancre, elle se lirait
   * plus tard comme un choix de l'utilisateur, et l'option recommandee par l'agent deviendrait la
   * demande d'ancrage : la machine redefinirait elle-meme ce dont elle ne doit pas s'eloigner.
   */
  if (reponseAsk)
    return {
      action: 'envoyer',
      texte: ancrerSurLaDemande(reponseAsk, derniereDemandeHumaine(entree.fil)),
      signature
    }
  const texteReponse = texteDernierAssistant(entree.fil) ?? ''
  /*
   * APRES UN SCOUT — la porte lit la ligne `CIBLE:` AVANT tout le reste du raisonnement de suite.
   *
   * Defaut vecu : la rubrique « Recommande — enchaine sur le tableau ci-dessus » suffisait a lancer
   * un tour PAYANT sur une cible que personne n'avait choisie. Un scout rend une LISTE ; sans choix
   * nomme, le maillon suivant travaille sur tout, c'est-a-dire sur rien de precis.
   *
   * Elle est placee APRES les gardes d'entree (inactif / tour en cours / brouillon) : ces gardes
   * disent « pas maintenant », elles ne disent rien du contenu, et les inverser volerait son tour a
   * l'utilisateur en train d'ecrire.
   */
  const choixMulti = entree.tourEstUnScout
    ? lireCiblesScout(texteReponse)
    : { statut: 'absente' as const }
  if (choixMulti.statut === 'cible-destructrice' || choixMulti.statut === 'cibles-non-nommees') {
    const raison: RaisonArret = choixMulti.statut
    return { action: 'arreter', raison, message: MESSAGES_ARRET[raison] }
  }
  const choixScout =
    choixMulti.statut === 'cibles'
      ? undefined
      : entree.tourEstUnScout
        ? lireCibleScout(texteReponse)
        : undefined
  if (choixScout && choixScout.statut !== 'cible') {
    const raison: RaisonArret =
      choixScout.statut === 'cible-destructrice' ? 'cible-destructrice' : 'scout-sans-cible'
    return { action: 'arreter', raison, message: MESSAGES_ARRET[raison] }
  }
  /*
   * LES TROIS PORTES « RIEN » — elles disent toutes la MEME chose : ce fil n'a plus de suite.
   * Garde-fou 1 : la recommandation se lit sur la rubrique, pas sur le prompt. Garde-fou 1 bis : le
   * bloc « Fait » vide (c'est la que le mot tombe le plus souvent). Garde-fou 1 ter : « ⏳ Reste à
   * faire : rien », le texte qu'Autowin ecrit lui-meme apres le dernier maillon.
   */
  // Le signal EXPLICITE passe devant : les portes « rien » ne restent que pour les fils ecrits avant lui.
  const finDeChaine: RaisonArret | null = signalFinExplicite(texteReponse)
    ? 'fin-explicite'
    : recommandationDitRien(extractRecommendation(texteReponse))
    ? 'recommandation-rien'
    : blocFaitDitRien(texteReponse)
      ? 'fait-rien'
      : resteAFaireDitRien(texteReponse)
        ? 'reste-rien'
        : null
  if (finDeChaine) {
    // Fil d'arriere-plan : on cesse de le suivre, sans depenser un tour sur ce qu'on ne regarde pas.
    if (!entree.proposerNouvelleCible)
      return { action: 'arreter', raison: finDeChaine, message: MESSAGES_ARRET[finDeChaine] }
    /*
     * Deja demandee DANS CETTE SERIE : on PATIENTE, l'interrupteur reste allume. Le compte vient du
     * FIL, depuis le dernier message de l'utilisateur — pas du seul dernier envoi. Depuis 4399faa7
     * (21/09), la reponse automatique a la question `ask` s'intercale entre deux releves : comparer
     * au dernier envoi laissait repartir releve → ask → reponse auto → « rien » → releve, jusqu'au
     * plafond de tours d'affilee. `dernierPromptEnvoye` reste un secours si le fil ne la montre pas.
     */
    if (relevesDepuisHumain(entree.fil) >= 1 || estUneReleve(entree.dernierPromptEnvoye ?? ''))
      return { action: 'attendre', raison: 'chaine-finie' }
    /*
     * fix-ok: une passe `/gc` finit par AUTOWIN_FIN_V1 avec sa question de purge ouverte (consigne de
     * skills/gc/SKILL.md) : `dernierAsk` non nul veut dire ici que le mode auto a refusé d'y répondre,
     * et la relève partait quand même, tour payant par-dessus la question (sonde conv-1341 : `envoyer`).
     */
    if (dernierAsk(entree.fil))
      return {
        action: 'arreter',
        raison: 'suite-attend-utilisateur',
        message: MESSAGES_ARRET['suite-attend-utilisateur']
      }
    return { action: 'envoyer', texte: PROMPT_NOUVELLE_CIBLE, signature }
  }
  // Même garde qu'en affichage : si la demande de CE tour était déjà l'ordre de tri, la publication
  // proposée passe telle quelle — sinon le mode auto renvoie `/salvage` en boucle, à ses frais.
  const demandeDuTour = texteDerniereDemande(entree.fil) ?? undefined
  // Les suites AFFICHÉES en boutons, mieux notée en tête (gardes de publication déjà appliquées).
  const propositions = extrairePropositionsSuite(
    texteReponse,
    demandeDuTour,
    entree.depotPresent ?? true
  ).map((p) => p.texte)
  const brut = propositions[0] ?? extractRecommendation(texteReponse)
  const suite =
    brut && publicationJamaisDemandee(brut, demandeDuTour, entree.depotPresent ?? true)
      ? null
      : brut && estPromptDePublication(brut, demandeDuTour, entree.depotPresent ?? true)
        ? PROMPT_SALVAGE
        : brut
  // Pas de suite proposée : on ne fabrique rien et on ne s'éteint pas — on attend le tour suivant.
  if (!suite && AVIS_TACHE_DE_FOND.test(texteReponse))
    return {
      action: 'arreter',
      raison: 'tache-de-fond-coupee',
      message: MESSAGES_ARRET['tache-de-fond-coupee']
    }
  if (!suite) return { action: 'attendre', raison: 'aucun-prompt' }
  /*
   * fix-ok: une question dont la réponse recommandée est destructrice rendait null plus haut, et le code
   * passait à la suite libre : « la question attend l'humain » n'était pas tenu. Mesuré le 30/10 sur
   * les fils actifs : 14 questions de ce type sur 86 (38 sur 454 archives comprises), 9 envois évités
   * au rejeu, et « Oui, purge cette fois » envoyé seul par deciderRelanceAuto. `dernierAsk` non nul veut
   * dire ici que le mode auto a refusé d'y répondre : aucune suite proposée ne passe devant, pas plus
   * que la relève de fin de chaîne (même garde, plus haut).
   */
  if (
    dernierAsk(entree.fil) ||
    suiteAttendUneDonneeUtilisateur(suite) ||
    suiteRepondALaPasseGc(suite, texteReponse)
  )
    return {
      action: 'arreter',
      raison: 'suite-attend-utilisateur',
      message: MESSAGES_ARRET['suite-attend-utilisateur']
    }
  // conv-826 : une suite différée n'arrête plus la chaîne — elle est PROGRAMMÉE (voir plus bas).
  const recommandationDifferee = extractRecommendation(texteReponse)
  const differee = suiteEstDifferee(suite, recommandationDifferee)
  if (differee && (entree.relancesDifferees ?? 0) >= MAX_RELANCES_DIFFEREES)
    return {
      action: 'arreter',
      raison: 'suite-differee',
      message: MESSAGES_ARRET['suite-differee']
    }
  /*
   * L'ANCRAGE EST POSÉ AVANT la comparaison anti-boucle, et c'est délibéré : c'est le texte
   * RÉELLEMENT envoyé qui est mémorisé dans `dernierPromptEnvoye`. Comparer la suite NUE à un
   * précédent ancré ne serait jamais égal, et le garde-fou « deux fois la même suite » mourrait.
   */
  /*
   * LA CIBLE VOYAGE AVEC LA SUITE. Le prompt propose par un scout parle souvent du tableau (« la
   * ligne 1 », « le candidat ci-dessus ») : envoye seul, il arrive dans un tour qui n'a pas le
   * tableau sous les yeux. La cible NOMMEE est donc recopiee en tete de ce qui part.
   */
  /*
   * TOUTES LES SUITES AFFICHÉES PARTENT (conv-1125, 2026-10-23 : « le mode auto doit lancer toutes
   * les suggestions de préprompt pas une seule »). Avant, seule la mieux notée partait (conv-1005).
   * Elles partent dans UN SEUL message : un tour par suite ferait proposer de nouvelles suites dès
   * le premier, et deux chaînes se mêleraient. La mieux notée porte les gardes ci-dessus (pause,
   * suite différée) ; une secondaire qui attend une donnée de l'utilisateur ou un moment donné reste
   * de côté, puisqu'elle ne peut pas être faite maintenant.
   */
  const secondaires =
    suite === propositions[0]
      ? propositions
          .slice(1)
          .filter(
            (p) =>
              !suiteAttendUneDonneeUtilisateur(p) &&
              !suiteRepondALaPasseGc(p, texteReponse) &&
              !suiteEstDifferee(p, null)
          )
      : []
  const suites =
    secondaires.length === 0
      ? suite
      : [
          `Fais ces ${secondaires.length + 1} suites proposées, dans cet ordre :`,
          ...[suite, ...secondaires].map((s, i) => `${i + 1}. ${s}`)
        ].join(SAUT_ANCRAGE)
  const suiteCiblee =
    choixMulti.statut === 'cibles'
      ? `CIBLES RETENUES (traite-les ENSEMBLE, dans cet ordre) :
${choixMulti.cibles.map((c, i) => `${i + 1}. ${c}`).join(SAUT_ANCRAGE)}
${suites}`
      : choixScout
        ? `CIBLE RETENUE : ${choixScout.cible}
${suites}`
        : suites
  const texte = ancrerSurLaDemande(suiteCiblee, derniereDemandeHumaine(entree.fil))
  /*
   * DIFFÉRÉE : programmée AVANT le garde-fou « même suite » — « quand fin.txt existe » revient
   * forcément identique d'une vérification à l'autre. La borne est `MAX_RELANCES_DIFFEREES`.
   */
  if (differee) {
    const fichier = fichierAttenduSuiteDifferee(suite, recommandationDifferee)
    const filAttendu = fichier ? null : filAttenduSuiteDifferee(suite, recommandationDifferee)
    const maintenant = entree.maintenant ?? Date.now()
    return {
      action: 'programmer',
      texte,
      signature,
      // Chemin ou fil lisible : la première vérification est une sonde gratuite, donc on regarde tôt.
      echeance: fichier
        ? maintenant + DELAI_SONDAGE_FICHIER
        : filAttendu
          ? maintenant + DELAI_SONDAGE_FIL
          : echeanceSuiteDifferee(suite, recommandationDifferee, maintenant),
      ...(fichier ? { fichier } : {}),
      ...(filAttendu ? { filAttendu } : {})
    }
  }
  // La même suite deux fois d'affilée = boucle : on ne la renvoie pas, sans couper l'interrupteur.
  /*
   * MÊME SUITE ≠ BOUCLE quand le tour a TRAVAILLÉ. Mesuré conv-733, tour
   * 98ce00d9-2276-4a96-bb15-b66c622bfee8 (saisie ts 1789970040849) : audit à 100 points, point #93
   * fait et rapporté dans « ✅ Fait », suite proposée mot pour mot identique (« Traite le point
   * suivant… ») → la chaîne s'est tue alors qu'il restait ~7 points. Une boucle, c'est la même
   * suite SANS travail rapporté : c'est ce cas-là seul que le garde-fou retient.
   */
  if (
    entree.dernierPromptEnvoye &&
    texte.trim() === entree.dernierPromptEnvoye.trim() &&
    lignesDuBlocFait(texteReponse).every((l) => l.trim() === '')
  )
    return { action: 'attendre', raison: 'prompt-identique' }
  return { action: 'envoyer', texte, signature }
}

/**
 * APRES UN SCOUT — ce que le mode auto a le droit d'enchainer.
 *
 * Un scout rend plusieurs pistes. Sans regle, le maillon suivant repart sur le tableau entier et la
 * boucle depense un tour PAYANT sur une cible que personne n'a choisie. Cadrage du 2026-09-05
 * (conv-308) : la sortie porte une ligne `CIBLE:` ; pas de cible = fin de chaine ; une cible
 * destructrice ne part jamais toute seule.
 *
 * La porte lit la FORME (une cible nommee existe), jamais la qualite du choix : producteur et juge
 * sont le meme modele.
 */
export type { DecisionScout } from '../../../shared/scout-cible-lecture'

/**
 * LECTURE PARTAGEE — la grammaire de la ligne `CIBLE:` vit desormais dans
 * `shared/scout-cible-lecture.ts`, lue AUSSI par la garde de phase du pipeline (`main/scout-cible.ts`).
 * Elle etait ecrite deux fois, avec deux conclusions differentes sur `CIBLE: aucune`.
 */
export const lireCibleScout = lireDecisionScout

/**
 * MULTI-PISTES — la ligne `CIBLES:` d'un scout, quand plusieurs pistes se traitent ENSEMBLE.
 *
 * POURQUOI UN MOT-CLE DISTINCT et non plusieurs lignes `CIBLE:` : la regle en vigueur est « la
 * PREMIERE ligne `CIBLE:` fait foi » (cf. `lireCibleScout`). En ecrire plusieurs ne produirait donc
 * pas un choix multiple, mais un choix unique avec du bruit ignore en silence. Toucher a cette
 * regle changerait le comportement du mode auto sur TOUS les fils existants ; `CIBLES:` la laisse
 * intacte et s'ajoute a cote.
 *
 * ACTIF EN MODE AUTO SEULEMENT, par construction : le seul lecteur est `deciderRelanceAuto`, dont
 * la toute premiere porte est `if (!entree.actif)`. Aucun envoi automatique ne peut naitre d'ici
 * quand l'interrupteur est eteint.
 *
 * TROIS REFUS, tous de FORME (producteur et juge sont le meme modele — la qualite du choix ne se
 * verifie pas ici) :
 *  - aucune ligne `CIBLES:` -> `absente`, la lecture retombe sur `CIBLE:` : rien ne change pour
 *    l'existant ;
 *  - une piste destructrice, ne serait-ce qu'une seule -> le lot entier s'arrete. Un lot part d'un
 *    seul envoi : accepter le lot, c'est accepter sa piste la plus couteuse ;
 *  - des NUMEROS seuls (`CIBLES: 1, 3, 4`) -> refus nomme. Le tour suivant n'a pas le tableau sous
 *    les yeux : un numero n'y designe rien.
 */
export type DecisionScoutMulti =
  | { statut: 'cibles'; cibles: string[] }
  | { statut: 'absente' }
  | { statut: 'aucune-cible' }
  | { statut: 'cible-destructrice'; cible: string }
  | { statut: 'cibles-non-nommees' }

const LIGNE_CIBLES = /^\s*[>*_`\s]*cibles\s*[:：]\s*(.*?)\s*[*_`]*\s*$/iu

/** Une piste reduite a un numero (`3`, `#3`, `n°3`) ne nomme rien hors du tableau du scout. */
const PISTE_NUMERIQUE = /^(?:#|n[o°]\s*)?\d+$/iu

export function lireCiblesScout(texteScout: string): DecisionScoutMulti {
  for (const ligne of (texteScout ?? '').split(SAUT_ANCRAGE)) {
    const trouve = ligne.match(LIGNE_CIBLES)
    if (!trouve) continue
    // La PREMIERE ligne `CIBLES:` fait foi — meme regle que pour `CIBLE:`.
    const brut = trouve[1]!.replace(/^[\s*_`]+/u, '').trim()
    const nuLigne = normaliserPiste(brut)
    if (!brut || nuLigne === 'aucune' || nuLigne === 'rien' || nuLigne === 'aucune cible')
      return { statut: 'aucune-cible' }
    const pistes = brut
      .split(/\s*[,;·|]\s*|\s+\/\s+/u)
      .map((piste) => piste.replace(/^[\s*_`]+|[\s*_`]+$/gu, '').trim())
      .filter((piste) => piste.length > 0)
    if (pistes.length === 0) return { statut: 'aucune-cible' }
    const destructrice = pistes.find((piste) => estCibleDestructrice(piste))
    if (destructrice) return { statut: 'cible-destructrice', cible: destructrice }
    if (pistes.every((piste) => PISTE_NUMERIQUE.test(piste)))
      return { statut: 'cibles-non-nommees' }
    return { statut: 'cibles', cibles: pistes }
  }
  return { statut: 'absente' }
}

/** Meme normalisation que la lecture partagee de `CIBLE:`. */
const normaliserPiste = normaliserPisteCible
