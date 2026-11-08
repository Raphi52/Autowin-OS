/**
 * TITRE D'UN COMMIT AUTOMATIQUE — `type(zone): phrase (conv-NNN)`, la forme qu'exige AGENTS.md.
 *
 * La phrase dit CE QUI A CHANGÉ. Elle vient, dans l'ordre : de la 1re action du DERNIER bloc
 * « ✅ Fait » du tour ; sinon de la 1re ligne de la demande, si elle nomme un changement ; sinon des
 * fichiers publiés (« modifie … »). Une demande nomme un changement si elle porte un verbe de travail
 * (« ajoute », « corrige », « doit »…). La relance (« oui », « fais le », « vas-y, lance-le maintenant »)
 * et le rapport de symptôme (« je vois encore… », « quand … devrait… ») n'en portent pas : ils ne
 * deviennent jamais le titre. Le symptôme dit ce qui ne marche pas, il appelle une réparation. Sans
 * aucune source, REPLI sur l'ancien format : on n'invente pas un résumé.
 *
 * Le type suit la nature du changement : `test` ou `docs` si les fichiers ne sont que des tests ou du
 * Markdown, `fix` pour une réparation ou un symptôme, `refactor` pour un renommage ou un découpage,
 * `feat` par défaut.
 *
 * LANGUE : la réponse suit le réglage Settings · Interface, le message de commit suit la règle du
 * projet (français). Une réponse déclarée en anglais n'est donc JAMAIS recopiée : le titre vient de
 * la demande, sinon des fichiers.
 */

export interface EntreeTitreDeCommit {
  /** `conv-NNN` pour un tour de chat, l'identifiant du run sinon. */
  id: string
  demande: string
  /** Texte final du tour : son bloc « ✅ Fait » dit ce qui a été fait. */
  compteRendu?: string
  /**
   * Langue dans laquelle le tour a écrit `compteRendu` (réglage Settings · Interface). Seul le
   * français est recopié dans le titre ; absent = français, l'usage d'avant le réglage.
   */
  langueDuCompteRendu?: 'fr' | 'en'
  /** Chemins publiés (relatifs au dépôt) : ils donnent la zone et parfois le type. */
  fichiers?: readonly string[]
  /** Zone quand aucun fichier n'est connu. */
  zoneParDefaut?: string
  /** Texte de l'ancien format quand la demande est vide. */
  repli?: string
}

const LONGUEUR_PHRASE = 72
const MARQUE_FAIT = /✅\s*\**\s*Fait\b/gu
const ELEMENT_DE_LISTE = /^(?:\d+[.)]|[-*•])\s+(.+)$/u
const SUR_LA_LIGNE_DU_FAIT = /^✅\s*\**\s*Fait\**\s*[—:–-]\s*(.+)$/u
const COMMANDE_SLASH = /^\/([\w-]+)\s+/u
/** Un verbe de réparation : le reste est une évolution (`feat`). */
const REPARATION =
  /(?:^|[^\p{L}])(?:corrig|répar|repar|fix|bug|cass|plant|crash|erreur)|marche(?:it)? pas/iu
/** Un renommage ou un découpage : le comportement ne change pas. */
const REFACTORISATION =
  /(?:^|[^\p{L}])(?:refactor|renomm|découp|decoup|restructur|réorgan|reorgan)/iu
/**
 * Mots qui ne nomment aucun travail. Une phrase faite de ces seuls mots est une relance ; la forme
 * comparée est normalisée (minuscules, sans accent, sans apostrophe).
 */
const MOTS_DE_RELANCE = new Set([
  'oui',
  'ouais',
  'ok',
  'okay',
  'd',
  'accord',
  'go',
  'vazy',
  'vas-y',
  'vas',
  'y',
  'fais',
  'fais-le',
  'faites',
  'le',
  'la',
  'les',
  'lance',
  'lance-le',
  'allez',
  'continue',
  'continues',
  'poursuis',
  'stp',
  'svp',
  'merci',
  'bien',
  'bon',
  'super',
  'parfait',
  'top',
  'nickel',
  'c',
  'est',
  'ca',
  'encore',
  'non',
  'et',
  'yes',
  'yep',
  'valide',
  'valide-le'
])
/**
 * Un rapport de symptôme : ce que l'utilisateur voit ou attend, pas ce qui a changé. Appliqué à la
 * demande normalisée.
 */
const RAPPORT_DE_SYMPTOME =
  /^(?:je (?:vois|ne|n)\b|j ai\b|quand\b|pourquoi\b|il y a\b|y a\b|ca (?:ne|marche|fait|devrait|doit|affiche|reste|remonte|apparait)\b)/u
/**
 * Un verbe de travail (« ajoute », « corrige », « renomme »…) ou une obligation (« doit », « faut »).
 * C'est la preuve POSITIVE qu'une demande nomme un changement : une tournure hors de la liste des
 * relances (« vas-y, lance-le maintenant ») n'a aucun de ces verbes, donc aucun titre.
 * fix-ok: la liste fermée des relances laissait passer « vas-y, lance-le maintenant » ; un verbe de travail distingue une demande d'une relance.
 */
const VERBE_DE_CHANGEMENT =
  /(?:^|[^\p{L}])(?:ajout|enlev|retir|supprim|efface|cree|creer|corrig|repar|renomm|decoup|restructur|refactor|reorgan|deplac|modifi|chang|remplac|affich|masqu|ameliore|optimis|simplifi|nettoy|factoris|migr|implement|ajust|mettre|empech)|(?:^|[^\p{L}])(?:doit|doivent|faut|falloir|veux|voudrais|vouloir)(?!\p{L})/u
/** Interjection qui ouvre une relance (« oui, ajoute… ») : retirée avant de juger la demande. */
const INTERJECTION_INITIALE =
  /^(?:oui|ouais|ok|okay|yes|yep|go|vazy|vas-y|merci|bien|parfait|super|top|nickel|bon|stp|svp)\b[\s,!.;:]*/iu
const EST_UN_TEST = /\.(?:test|spec)\.[cm]?[jt]sx?$/u
/** Dossiers qui ne nomment aucune zone : `src/main` ne dit rien de ce qui a changé. */
const DOSSIERS_GENERIQUES = new Set([
  '',
  '.',
  'src',
  'main',
  'renderer',
  'components',
  'shared',
  'preload',
  'lib'
])

/** Chemin absolu Windows (`D:\…\x.ts`) : la consigne l'impose dans les réponses, pas dans un titre. */
const CHEMIN_ABSOLU = /[A-Za-z]:[\\/](?:[^\s\\/]+[\\/])*([^\s\\/]+)/gu

function sansMarkdown(texte: string): string {
  return texte
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1')
    .replace(CHEMIN_ABSOLU, '$1')
    .replace(/\*\*|__|`/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()
}

/** La 1re action du DERNIER « ✅ Fait » : une réponse relancée peut en porter deux. */
function premiereActionFaite(compteRendu: string | undefined): string | undefined {
  if (!compteRendu) return undefined
  const marques = [...compteRendu.matchAll(MARQUE_FAIT)]
  const derniere = marques.at(-1)
  if (derniere?.index === undefined) return undefined
  const [ligneDuFait = '', ...suite] = compteRendu.slice(derniere.index).split(/\r?\n/u)
  const premiere = suite.map((ligne) => ligne.trim()).find(Boolean)
  const element = premiere ? ELEMENT_DE_LISTE.exec(premiere)?.[1] : undefined
  return element ?? SUR_LA_LIGNE_DU_FAIT.exec(ligneDuFait.trim())?.[1]
}

/** Moins de trois mots (« vazy », « go », « corriges tout ») : la demande ne nomme pas le travail. */
function estElliptique(phrase: string): boolean {
  return phrase.split(/\s+/u).filter(Boolean).length < 3
}

/** Minuscules, sans accent ni apostrophe : la forme où les mots de relance se comparent. */
function normaliser(texte: string): string {
  return texte
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[’']/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
}

function estUneRelance(phrase: string): boolean {
  const mots = normaliser(phrase)
    .split(/[^\p{L}\p{N}-]+/u)
    .filter(Boolean)
  return mots.length > 0 && mots.every((mot) => MOTS_DE_RELANCE.has(mot))
}

/**
 * Le texte nomme-t-il un changement ? Il lui faut un verbe de travail, et il ne doit être ni une
 * relance ni un symptôme : une tournure qui porte un verbe (« je vois encore, il faut le corriger »)
 * reste donc exclue.
 */
function nommeUnChangement(texte: string): boolean {
  const forme = normaliser(texte)
  return (
    VERBE_DE_CHANGEMENT.test(forme) && !estUneRelance(texte) && !RAPPORT_DE_SYMPTOME.test(forme)
  )
}

/** Une demande qui décrit un changement à faire : assez longue, et elle nomme un changement. */
function demandeDecritUnChangement(demande: string): boolean {
  return !estElliptique(demande) && nommeUnChangement(demande)
}

/** Retire les interjections de tête (« oui, », « vas-y, ») sans jamais vider la demande. */
function sansInterjection(demande: string): string {
  let reste = demande
  let m = INTERJECTION_INITIALE.exec(reste)
  while (m && reste.length > m[0].length) {
    reste = reste.slice(m[0].length)
    m = INTERJECTION_INITIALE.exec(reste)
  }
  return reste
}

function borner(phrase: string): string {
  const propre = phrase.replace(/[\s.:;,]+$/u, '')
  if (propre.length <= LONGUEUR_PHRASE) return propre
  const coupe = propre.slice(0, LONGUEUR_PHRASE - 1)
  const espace = coupe.lastIndexOf(' ')
  return `${(espace > 20 ? coupe.slice(0, espace) : coupe).replace(/[\s.:;,]+$/u, '')}…`
}

function nomDeBase(chemin: string): string {
  const fichier = chemin.split(/[\\/]/u).pop() ?? chemin
  return fichier.split('.')[0] || fichier
}

function zoneDesFichiers(fichiers: readonly string[]): string | undefined {
  if (fichiers.length === 0) return undefined
  const sources = fichiers.filter((f) => !EST_UN_TEST.test(f))
  const retenus = sources.length > 0 ? sources : fichiers
  const noms = new Set(retenus.map(nomDeBase))
  if (noms.size === 1) return [...noms][0]
  const dossiers = retenus.map((f) => f.split(/[\\/]/u).slice(0, -1))
  const communs: string[] = []
  for (let i = 0; dossiers.every((d) => d[i] !== undefined && d[i] === dossiers[0]?.[i]); i++)
    communs.push(dossiers[0]?.[i] ?? '')
  const dernier = communs.at(-1) ?? ''
  return DOSSIERS_GENERIQUES.has(dernier) ? nomDeBase(retenus[0] ?? '') : dernier
}

/**
 * Ce que les fichiers publiés disent du travail. Une liste trop longue pour le titre perd d'abord
 * les tests, puis ses noms : un titre coupé en pleine phrase ne dit plus rien.
 */
function phraseDesFichiers(fichiers: readonly string[]): string {
  if (fichiers.length === 0) return ''
  const nom = (chemin: string): string => chemin.split(/[\\/]/u).pop() ?? chemin
  const sources = fichiers.filter((f) => !EST_UN_TEST.test(f))
  const tests = fichiers.length - sources.length
  const cites = (sources.length > 0 ? sources : fichiers).map(nom)
  const autres = cites.length - 3
  const liste =
    autres > 0
      ? `${cites.slice(0, 3).join(', ')} et ${autres} autre${autres > 1 ? 's' : ''}`
      : cites.join(', ')
  const sansTests = `modifie ${liste}`
  const avecTests =
    sources.length > 0 && tests > 0
      ? `${sansTests} et ${tests} fichier${tests > 1 ? 's' : ''} de test`
      : sansTests
  if (avecTests.length <= LONGUEUR_PHRASE) return avecTests
  if (sansTests.length <= LONGUEUR_PHRASE) return sansTests
  const nombre = sources.length > 0 ? sources.length : fichiers.length
  return `modifie ${nombre} fichier${nombre > 1 ? 's' : ''}`
}

function typeDuTravail(phrase: string, fichiers: readonly string[], symptome: boolean): string {
  if (fichiers.length > 0 && fichiers.every((f) => EST_UN_TEST.test(f))) return 'test'
  if (fichiers.length > 0 && fichiers.every((f) => f.toLowerCase().endsWith('.md'))) return 'docs'
  if (symptome || REPARATION.test(phrase)) return 'fix'
  return REFACTORISATION.test(phrase) ? 'refactor' : 'feat'
}

export function titreDeCommitAuto(entree: EntreeTitreDeCommit): string {
  const demande = (
    entree.demande
      .split(/\r?\n/u)
      .map((l) => l.trim())
      .find(Boolean) ?? ''
  ).replace(/\s+/gu, ' ')
  const commande = COMMANDE_SLASH.exec(demande)?.[1]
  const demandeSansCommande = demande.replace(COMMANDE_SLASH, '')
  const texteDemande = sansInterjection(demandeSansCommande)
  // fix-ok: une réponse en anglais ne fournit pas le titre : son « ✅ Fait » recopierait une phrase anglaise et un chemin Windows.
  const faite =
    entree.langueDuCompteRendu === 'en' ? undefined : premiereActionFaite(entree.compteRendu)
  const fichiers = entree.fichiers ?? []
  const symptome = RAPPORT_DE_SYMPTOME.test(normaliser(texteDemande))
  const phrase =
    (faite && !estUneRelance(faite) ? sansMarkdown(faite) : '') ||
    (demandeDecritUnChangement(texteDemande) ? sansMarkdown(texteDemande) : '') ||
    phraseDesFichiers(fichiers)
  if (!phrase) {
    // L'ancien format, à l'identique : sans « ✅ Fait » ni demande qui nomme un changement, rien ne dit le travail.
    const brute = sansInterjection(
      entree.demande.replace(/\s+/gu, ' ').trim().replace(COMMANDE_SLASH, '')
    )
    const tete =
      (brute && nommeUnChangement(brute) ? brute.slice(0, 100) : '') ||
      entree.repli ||
      'travail du chat'
    return `auto(${entree.id}): ${tete}`
  }
  const zone = zoneDesFichiers(fichiers) ?? commande ?? entree.zoneParDefaut ?? 'chat'
  return `${typeDuTravail(phrase, fichiers, symptome)}(${zone}): ${borner(phrase)} (${entree.id})`
}
