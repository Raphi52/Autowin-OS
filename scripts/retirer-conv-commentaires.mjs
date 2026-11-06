#!/usr/bin/env node
/**
 * RETIRE LES MENTIONS « conv-NNN » DES COMMENTAIRES DU CODE.
 *
 * Pourquoi (2026-11-06) : le code de `src/` citait 14 411 fois une conversation. Ces renvois ne
 * disent rien à qui lit le code — ils pointent vers un fil que le lecteur n'ouvrira pas — et la
 * provenance d'une ligne vit déjà dans le message de son commit (`git blame` la retrouve).
 *
 * Ce que fait le script : il retire chaque mention des seuls COMMENTAIRES, en gardant le reste de
 * la phrase lisible (« mesuré sur conv-981 : » → « mesuré : », « (conv-12, 2026-10-12) » →
 * « (2026-10-12) », « (kaizen conv-854) » → rien). Il ne touche JAMAIS :
 *   - aux chaînes, gabarits et données (identifiants de test, textes envoyés au modèle) ;
 *   - à une mention citée comme exemple : entre accents graves, guillemets, ou collée à un chemin
 *     ou une extension (`conv-65.jsonl`, `runs\conv-1`) ;
 *   - aux fichiers modifiés et non commités (le travail d'un autre fil dans ce dossier partagé).
 * Garde-fou : un fichier n'est écrit que si son code SANS commentaires est identique avant et
 * après (impression TypeScript sans commentaires, ou CSS/HTML sans commentaires).
 *
 * Usage :
 *   node scripts/retirer-conv-commentaires.mjs [dossiers…]             simulation (défaut : src)
 *   node scripts/retirer-conv-commentaires.mjs --appliquer [dossiers…] écrit les fichiers
 *   node scripts/retirer-conv-commentaires.mjs --verifier [dossiers…]  code 1 s'il en reste
 *   --rapport <fichier.json>  écrit chaque ligne changée (avant/après) pour relecture
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'

const RACINE = fileURLToPath(new URL('..', import.meta.url))

/* Une mention LIBRE : ni collée à un mot, ni prise dans un chemin ou un nom de fichier. */
const MENTION = String.raw`(?<![\p{L}\p{N}_/\\.\-])conv-\d+(?:(?:→|->|–)\d+)?(?![\p{L}\p{N}_\-]|\.\p{L}|[/\\])`
const RE_MENTION = new RegExp(MENTION, 'u')
/* Passage à la ligne suivante d'un commentaire : saut, indentation, `//` ou ` *`. */
const SAUT = String.raw`[ \t]*\n[ \t]*(?:\/\/+|\*(?!\/))?[ \t]*`
const RE_SAUT = new RegExp(SAUT, 'gu')
/*
 * Plusieurs mentions qui se suivent forment UN renvoi : « conv-914 et conv-916 », « conv-1429 a
 * conv-1436 », y compris d'une ligne à l'autre. `\b` ne voit pas « à » : bornes en \p{L}.
 */
const ESP_L = String.raw`(?:${SAUT}|[ \t]*)`
const MOT_LISTE = String.raw`(?<!\p{L})(?:et|puis|ou|à|a)(?!\p{L})`
const SEP_LISTE = String.raw`${ESP_L}(?:,|/|\+|&|→|->|${MOT_LISTE})${ESP_L}`
/* « conv-879, 903, 904 et 906 » : les numéros nus qui suivent appartiennent au même renvoi. */
const NOMBRE_NU = String.raw`\d+(?=[ \t]*(?:[,;):]|\.(?!\d)|${MOT_LISTE}|\n|$))`
const GROUPE = String.raw`${MENTION}(?:${SEP_LISTE}(?:${MENTION}|${NOMBRE_NU}))*`

/** Retirer un renvoi sans fusionner deux lignes : ses sauts de ligne restent, entourés de trous. */
const trouQuiGardeLesLignes = (passage) => {
  const sauts = passage.match(RE_SAUT) ?? []
  return TROU + sauts.map((s) => s.replace(/^[ \t]*/u, '') + TROU).join('')
}

/* Marqueurs internes (zone privée Unicode) : un passage protégé masqué, et le trou laissé par un retrait. */
const MASQUE_DEBUT = String.fromCharCode(0xe000)
const MASQUE_FIN = String.fromCharCode(0xe001)
const TROU = String.fromCharCode(0xe002)

/* Début de ligne d'un commentaire : indentation, puis `//`, `/*`, `/**` ou le ` *` d'un bloc. */
const DEBUT_LIGNE = String.raw`(?:^|\n)[ \t]*(?:\/\/+|\/\*+|\*(?!\/))?[ \t]*`

const PREPOSITIONS = [
  'à',
  'au',
  'aux',
  'de',
  'du',
  'des',
  'sur',
  'dans',
  'en',
  'depuis',
  'par',
  'pour',
  'avant',
  'après',
  'apres',
  'via',
  'cf\\.',
  'cf',
  'voir',
  'chez',
  'selon',
  'vers',
  'entre',
  'lors de',
  'pendant'
]
/* L'espace entre la préposition et le renvoi peut passer à la ligne suivante du commentaire. */
const ESPACE_OU_LIGNE = String.raw`(?:[ \t]+|[ \t]*\n[ \t]*(?:\/\/+|\*(?!\/))?[ \t]*)`
const RE_PREPOSITION = new RegExp(
  String.raw`(^|[^\p{L}\p{N}_'’])(?:${PREPOSITIONS.join('|')})(${ESPACE_OU_LIGNE})(?:${GROUPE})`,
  'giu'
)
/* « n'existe que dans conv-253 » : sans son complément, la restriction perd son sens. */
const RE_QUE_PREPOSITION = new RegExp(
  String.raw`(\bque[ \t]+(?:dans|sur|par|chez|pour)[ \t]+)(${GROUPE})`,
  'giu'
)

/*
 * Une mention SUJET (« quand conv-891 a écrasé », « réel : conv-349 et conv-356 produisaient ») est
 * suivie d'un mot en minuscule : son verbe. Sauf un connecteur de liste, ou un mot qui QUALIFIE le
 * renvoi (« conv-1241 tour 6e6212f1 ») : là, le renvoi part et le qualificatif reste.
 */
const QUALIFIANTS =
  'tour|tours|lot|saisie|session|run|étape|etape|ts|commit|piste|capture|point|plan|turn|message|phase|bras'
const SUITE_DE_SUJET = String.raw`(?!(?:et|ou|puis|à|${QUALIFIANTS})(?!\p{L}))\p{Ll}`
const AVANT_SUJET = String.raw`(?:^|\n[ \t]*(?:\/\/+|\*(?!\/))?[ \t]*|[.!?(][ \t]*|[,:][ \t]+|[—–][ \t]+|(?<!\p{L})(?:quand|que|qu['’]|si|où|ou|et|mais|car|puis|lorsque|comme|dont|parce que)[ \t]+)`

/**
 * Masque les passages qui CITENT plutôt qu'ils ne renvoient : code entre accents graves, guillemets
 * français ou droits. Leur contenu est rendu tel quel à la fin.
 */
function masquer(texte) {
  const gardes = []
  const masque = texte.replace(/`[^`\n]*`|«[^«»]{0,400}»|"[^"\n]*"/g, (passage) => {
    gardes.push(passage)
    return `${MASQUE_DEBUT}${gardes.length - 1}${MASQUE_FIN}`
  })
  return {
    masque,
    rendre: (t) =>
      t.replace(new RegExp(`${MASQUE_DEBUT}(\\d+)${MASQUE_FIN}`, 'g'), (_, i) => gardes[Number(i)])
  }
}

const majuscule = (s) => s.replace(/^(\s*)(\p{Ll})/u, (_, e, l) => e + l.toUpperCase())

/** Une mention en position de sujet devient « un fil » (« des fils » pour une liste). */
function remplacerSujets(t) {
  // le groupe doit être ENTIER : dans « conv-1429 a conv-1436 », « a » relie deux renvois
  const re = new RegExp(
    `(${AVANT_SUJET})(${GROUPE})(?!${SEP_LISTE}${MENTION})(?=[ \\t]+${SUITE_DE_SUJET})`,
    'gu'
  )
  return t.replace(re, (_, avant, groupe, position) => {
    const plusieurs = (groupe.match(new RegExp(MENTION, 'gu')) ?? []).length > 1
    // une liste coupée en fin de ligne garde sa coupe ; l'espace qui suit le groupe sépare déjà
    const sauts = (groupe.match(RE_SAUT) ?? []).map((s) => s.replace(/[ \t]+$/u, ''))
    let nom = (plusieurs ? 'des fils' : 'un fil') + sauts.join('')
    // « que un fil » s'élide
    if (!plusieurs && /\b(qu)e[ \t]+$/iu.test(avant))
      return avant.replace(/\b(qu)e[ \t]+$/iu, "$1'") + nom
    if (debutDePhrase(avant, t.slice(0, position))) nom = majuscule(nom)
    return `${avant}${nom}`
  })
}

/**
 * Une tête de ligne n'est pas une tête de phrase : « le petit modèle a lu\n // conv-767 comme
 * nette » devenait « a lu\n // Un fil comme nette » (rejeu du 2026-11-06). La majuscule ne vient
 * qu'après « . ! ? », ou quand la ligne précédente finit une phrase ou ouvre le commentaire.
 */
function debutDePhrase(avant, precedent) {
  if (/[.!?][ \t]*$/u.test(avant)) return true
  if (!/(?:^|\n[ \t]*(?:\/\/+|\*(?!\/))?[ \t]*)$/u.test(avant)) return false
  const lignePrecedente = (precedent.split('\n').pop() ?? '')
    .replace(/^[ \t]*(?:\/\/+|\/\*+|\*(?!\/))?/u, '')
    .trim()
  return lignePrecedente === '' || /[.!?][»”"')\]]*$/u.test(lignePrecedente)
}

/** Retraits en ligne : préposition + renvoi, « depuis conv-X (date) », puis tout renvoi restant. */
function retirerEnLigne(t) {
  // « depuis conv-1171 (2026-10-27) » → « depuis le 2026-10-27 »
  t = t.replace(
    new RegExp(
      String.raw`\b(depuis|Depuis|DEPUIS)[ \t]+(?:${GROUPE})[ \t]*\((\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)(?:[ \t]*[,;:][ \t]*([^()]*))?\)`,
      'gu'
    ),
    (_, depuis, date, reste) => `${depuis} le ${date}${reste ? ` (${reste.trim()})` : ''}`
  )
  t = t.replace(
    RE_QUE_PREPOSITION,
    (_, avant, groupe) =>
      `${avant}${(groupe.match(new RegExp(MENTION, 'gu')) ?? []).length > 1 ? 'des fils' : 'un fil'}`
  )
  // la préposition d'abord : « de\n * conv-1405 n'en contient » n'est pas un sujet
  t = t.replace(
    RE_PREPOSITION,
    (tout, avant) => `${avant}${trouQuiGardeLesLignes(tout.slice(avant.length))}`
  )
  t = remplacerSujets(t)
  t = t.replace(new RegExp(GROUPE, 'gu'), trouQuiGardeLesLignes)
  return t
}

/** Découpe le contenu d'une parenthèse en éléments, séparateurs gardés. */
function elements(contenu) {
  const morceaux = contenu.split(/([ \t]*[,;][ \t]*)/u)
  const items = []
  for (let i = 0; i < morceaux.length; i += 2)
    items.push({ texte: morceaux[i], sep: morceaux[i - 1] })
  return items
}

/** Une parenthèse qui contient un renvoi garde ses autres éléments, ou disparaît. */
function traiterParentheses(t) {
  let avant
  do {
    avant = t
    // une parenthèse qui court sur plusieurs lignes passe par les retraits en ligne
    t = t.replace(/(^|[^\p{L}\p{N}_])\(([^()\n]*)\)/gu, (tout, gauche, contenu) => {
      if (!RE_MENTION.test(contenu)) return tout
      const gardes = []
      for (const item of elements(contenu)) {
        if (!RE_MENTION.test(item.texte)) {
          gardes.push(item)
          continue
        }
        const nettoye = nettoyerTrous(retirerEnLigne(item.texte)).trim()
        // un mot seul (« kaizen », « /draft », « Brain ») ne dit plus rien sans son renvoi
        if (!nettoye || /^[\p{L}/'’.-]+$/u.test(nettoye)) continue
        gardes.push({ texte: nettoye, sep: item.sep })
      }
      if (gardes.length === 0) return `${gauche}${TROU}`
      const corps = gardes
        .map((g, i) => (i === 0 ? g.texte.trimStart() : `${g.sep ?? ', '}${g.texte.trimStart()}`))
        .join('')
      return `${gauche}(${corps.trim()})`
    })
  } while (t !== avant)
  return t
}

/** Referme la phrase autour des trous : espaces, ponctuation orpheline, majuscule de début. */
function nettoyerTrous(t) {
  const X = TROU
  let avant
  do {
    avant = t
    t = t.replace(new RegExp(`${X}(?:[ \\t]*${X})+`, 'gu'), X)
    t = t.replace(new RegExp(`\\([ \\t]*${X}[ \\t]*\\)`, 'gu'), X)
    // « X — les trois cas visés — » : l'incise décrivait le renvoi retiré
    t = t.replace(new RegExp(`${X}[ \\t]*—[^—\\n]{1,60}—`, 'gu'), X)
    // « texte, X. » / « texte — X » en fin de phrase
    t = t.replace(new RegExp(`[ \\t]*[,;:—–][ \\t]*${X}(?=[ \\t]*(?:[.)!?;]|\\n|$))`, 'gu'), X)
    // « mais, X, le plan » → « mais, le plan » ; « fix-ok: X — mesure » → « fix-ok: mesure »
    t = t.replace(new RegExp(`([,;])[ \\t]*${X}[ \\t]*[,;]`, 'gu'), `$1${X}`)
    t = t.replace(new RegExp(`(:)[ \\t]*${X}[ \\t]*[—–,:;][ \\t]*`, 'gu'), `$1 ${X}`)
    // « PRÈS — X, tour » → « PRÈS, tour »
    t = t.replace(new RegExp(`[ \\t]*[—–][ \\t]*${X}[ \\t]*([,;])`, 'gu'), `${X}$1`)
    // « X (2026-10-12) : texte » en tête de ligne → « 2026-10-12 : texte »
    t = t.replace(
      new RegExp(`(${DEBUT_LIGNE})${X}[ \\t]*\\(([^()\\n]*)\\)[ \\t]*([:—–])`, 'gu'),
      `$1${X}$2 $3`
    )
    // « X : texte » / « X, texte » en début de ligne ou de phrase → « Texte »
    t = t.replace(
      new RegExp(
        `(${DEBUT_LIGNE}|[.!?][ \\t]+)${X}[ \\t]*[,:;—–][ \\t]*(?:${X}[ \\t]*[,:;—–]?[ \\t]*)*(\\p{L})?`,
        'gu'
      ),
      (_, debut, lettre) => `${debut}${X}${lettre ? lettre.toUpperCase() : ''}`
    )
    t = t.replace(new RegExp(`\\([ \\t]*${X}[ \\t]*[,;:][ \\t]*`, 'gu'), `(${X}`)
    t = t.replace(new RegExp(`[ \\t]*[,;][ \\t]*${X}[ \\t]*\\)`, 'gu'), `${X})`)
    // « (signale par\n//   X). UN canal » : la ponctuation orpheline remonte en fin de ligne précédente
    t = t.replace(
      new RegExp(`(\\S)(${SAUT})${X}[ \\t]*([.,;)]+)[ \\t]*`, 'gu'),
      (_, prec, saut, ponct) => {
        // « (mesuré le 14/08,\n// X). » → « (mesuré le 14/08). » ; « fin.\n// X. » → « fin. »
        if (/[,;:—–]/u.test(prec)) return `${ponct}${saut}${X}`
        if (/[.!?]/u.test(prec)) return `${prec}${ponct.replace(/[^)]/gu, '')}${saut}${X}`
        return `${prec}${ponct}${saut}${X}`
      }
    )
    // « /* X. Texte » en tête de commentaire
    t = t.replace(
      new RegExp(`^([ \\t]*(?:\\/\\/+|\\/\\*+)?[ \\t]*)${X}[ \\t]*[.,][ \\t]*(\\p{L})?`, 'u'),
      (_, debut, lettre) => `${debut}${X}${lettre ? lettre.toUpperCase() : ''}`
    )
    // espaces : aucun avant . , ) et fin de ligne ; un seul entre deux mots ; l'indentation reste
    t = t.replace(new RegExp(`(?<=[^\\s/*${X}])[ \\t]+${X}[ \\t]*(?=[.,)\\]]|\\n|$)`, 'gu'), X)
    t = t.replace(new RegExp(`(${DEBUT_LIGNE}|\\()${X}[ \\t]+`, 'gu'), `$1${X}`)
    t = t.replace(new RegExp(`(?<=[^\\s/*])[ \\t]+${X}[ \\t]+`, 'gu'), ` ${X}`)
  } while (t !== avant)
  return t.replaceAll(X, '')
}

/**
 * Nettoie le texte d'un commentaire (délimiteurs compris). Rend '' quand il ne reste plus rien.
 * Une ligne vidée par le retrait disparaît ; une ligne déjà vide (séparateur de paragraphe) reste.
 */
export function nettoyerCommentaire(original) {
  if (!new RegExp(MENTION, 'u').test(original)) return original
  const { masque, rendre } = masquer(original)
  if (!RE_MENTION.test(masque)) return original
  let t = traiterParentheses(masque)
  t = retirerEnLigne(t)
  t = rendre(nettoyerTrous(t))

  const lignesAvant = original.split('\n')
  const lignes = t.split('\n')
  const vide = (l) => /^[ \t]*(?:\/\/+|\/\*+|\*+\/?|\*\/)?[ \t]*$/u.test(l)
  const delims = (l) => /^[ \t]*(?:\/\*+|\*\/)[ \t]*$/u.test(l)
  const gardees =
    lignes.length === lignesAvant.length
      ? lignes.filter((l, i) => !(vide(l) && !vide(lignesAvant[i])) || delims(l))
      : lignes
  // un `/* … */` ou `/** … */` sur une ligne qui ne garde que ses délimiteurs
  const resultat = gardees.map((l) => l.replace(/^([ \t]*\/\*+)[ \t]*(\*\/)$/u, '$1 $2')).join('\n')
  const corps = resultat
    .replace(/^[ \t]*\/\*+|\*+\/[ \t]*$/gu, '')
    .split('\n')
    .map((l) => l.replace(/^[ \t]*(?:\/\/+|\*+)?/u, '').trim())
    .join('')
  return corps === '' ? '' : resultat
}

/* ---------- Repérage des commentaires ---------- */

const EXT_TS = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/u

function commentairesTs(chemin, texte) {
  const variante = /\.(?:tsx|jsx)$/u.test(chemin) || /\.(?:js|mjs|cjs)$/u.test(chemin)
  const kind = /\.tsx$/u.test(chemin)
    ? ts.ScriptKind.TSX
    : /\.(?:js|mjs|cjs|jsx)$/u.test(chemin)
      ? ts.ScriptKind.JSX
      : ts.ScriptKind.TS
  void variante
  const sf = ts.createSourceFile(chemin, texte, ts.ScriptTarget.Latest, true, kind)
  const plages = new Map()
  const textesJsx = []
  const ajouter = (rs) => {
    for (const r of rs ?? []) plages.set(r.pos, r)
  }
  const visiter = (n) => {
    if (n.kind === ts.SyntaxKind.JsxText) {
      textesJsx.push([n.pos, n.end])
      return
    }
    ajouter(ts.getLeadingCommentRanges(texte, n.pos))
    ajouter(ts.getTrailingCommentRanges(texte, n.end))
    for (const c of n.getChildren(sf)) visiter(c)
  }
  visiter(sf)
  const dansJsx = (r) => textesJsx.some(([a, b]) => r.pos >= a && r.pos < b)
  return {
    sf,
    plages: [...plages.values()]
      .filter((r) => !dansJsx(r))
      .map((r) => ({
        debut: r.pos,
        fin: r.end,
        ligne: r.kind === ts.SyntaxKind.SingleLineCommentTrivia
      }))
      .sort((a, b) => a.debut - b.debut)
  }
}

function commentairesBloc(texte, ouvre, ferme) {
  const plages = []
  let i = 0
  let quote = null
  while (i < texte.length) {
    const c = texte[i]
    if (quote) {
      if (c === '\\') i++
      else if (c === quote) quote = null
      i++
      continue
    }
    if (ouvre === '/*' && (c === '"' || c === "'")) {
      quote = c
      i++
      continue
    }
    if (texte.startsWith(ouvre, i)) {
      const fin = texte.indexOf(ferme, i + ouvre.length)
      if (fin < 0) break
      plages.push({ debut: i, fin: fin + ferme.length, ligne: false })
      i = fin + ferme.length
      continue
    }
    i++
  }
  return plages
}

/** Fusionne les `//` consécutifs (une phrase y court souvent sur plusieurs lignes). */
function blocs(texte, plages) {
  const res = []
  for (const p of plages) {
    const dernier = res[res.length - 1]
    if (
      dernier &&
      p.ligne &&
      dernier.ligne &&
      /^[ \t]*\r?\n[ \t]*$/u.test(texte.slice(dernier.fin, p.debut))
    ) {
      dernier.fin = p.fin
      continue
    }
    res.push({ ...p })
  }
  return res
}

/** Retire un commentaire devenu vide : sa ligne entière s'il était seul, ses accolades JSX. */
function retirerVide(texte, debut, fin) {
  let a = debut
  let b = fin
  const avant = texte.slice(0, a)
  const apres = texte.slice(b)
  const jsx = /\{[ \t]*$/u.exec(avant) && /^[ \t]*\}/u.exec(apres)
  if (jsx) {
    a = avant.lastIndexOf('{')
    b = b + apres.indexOf('}') + 1
  }
  const debutLigne = texte.lastIndexOf('\n', a - 1) + 1
  const finLigne = texte.indexOf('\n', b)
  const seulSurSaLigne =
    /^[ \t]*$/u.test(texte.slice(debutLigne, a)) &&
    /^[ \t]*\r?$/u.test(texte.slice(b, finLigne < 0 ? texte.length : finLigne))
  if (seulSurSaLigne) return [debutLigne, finLigne < 0 ? texte.length : finLigne + 1]
  while (a > 0 && /[ \t]/u.test(texte[a - 1])) a--
  return [a, b]
}

export function nettoyerTexte(chemin, texte) {
  let plages
  if (EXT_TS.test(chemin)) plages = commentairesTs(chemin, texte).plages
  else if (/\.css$/u.test(chemin)) plages = commentairesBloc(texte, '/*', '*/')
  else if (/\.html?$/u.test(chemin)) plages = commentairesBloc(texte, '<!--', '-->')
  else return { texte, retirees: 0, restantes: 0, lignes: [] }
  const crlf = texte.includes('\r\n')
  let sortie = texte
  let retirees = 0
  let restantes = 0
  const lignes = []
  for (const b of blocs(texte, plages).reverse()) {
    const brut = texte.slice(b.debut, b.fin)
    const avantMentions = (brut.match(new RegExp(MENTION, 'gu')) ?? []).length
    if (avantMentions === 0) continue
    const norm = crlf ? brut.replaceAll('\r\n', '\n') : brut
    let neuf = nettoyerCommentaire(norm)
    const apresMentions = (neuf.match(new RegExp(MENTION, 'gu')) ?? []).length
    retirees += avantMentions - apresMentions
    restantes += apresMentions
    if (neuf === norm) continue
    if (crlf) neuf = neuf.replaceAll('\n', '\r\n')
    lignes.push({ avant: brut, apres: neuf })
    if (neuf === '') {
      const [a, z] = retirerVide(sortie, b.debut, b.fin)
      sortie = sortie.slice(0, a) + sortie.slice(z)
    } else sortie = sortie.slice(0, b.debut) + neuf + sortie.slice(b.fin)
  }
  return { texte: sortie, retirees, restantes, lignes }
}

/** Le code sans ses commentaires doit être le même avant et après. */
export function codeInchange(chemin, avant, apres) {
  if (EXT_TS.test(chemin)) {
    const imprimer = (t) => {
      const kind = /\.tsx$/u.test(chemin)
        ? ts.ScriptKind.TSX
        : /\.(?:js|mjs|cjs|jsx)$/u.test(chemin)
          ? ts.ScriptKind.JSX
          : ts.ScriptKind.TS
      const sf = ts.createSourceFile(chemin, t, ts.ScriptTarget.Latest, true, kind)
      return ts.createPrinter({ removeComments: true }).printFile(sf)
    }
    return imprimer(avant) === imprimer(apres)
  }
  const [o, f] = /\.html?$/u.test(chemin) ? ['<!--', '-->'] : ['/*', '*/']
  const sans = (t) => {
    let r = t
    for (const p of commentairesBloc(t, o, f).reverse()) r = r.slice(0, p.debut) + r.slice(p.fin)
    return r.replace(/\s+/gu, '')
  }
  return sans(avant) === sans(apres)
}

function fichiersEnCoursAilleurs(dossiers) {
  const sortie = execFileSync('git', ['status', '--porcelain', '-z', '--', ...dossiers], {
    cwd: RACINE,
    encoding: 'utf8'
  })
  const res = new Set()
  const champs = sortie.split('\0')
  for (let i = 0; i < champs.length; i++) {
    const c = champs[i]
    if (!c) continue
    res.add(c.slice(3))
    if (c[0] === 'R' || c[0] === 'C') res.add(champs[++i])
  }
  return res
}

function principal() {
  const args = process.argv.slice(2)
  const appliquer = args.includes('--appliquer')
  const verifier = args.includes('--verifier')
  const iRapport = args.indexOf('--rapport')
  const rapport = iRapport >= 0 ? args[iRapport + 1] : null
  const dossiers = args.filter(
    (a, i) => !a.startsWith('--') && !(iRapport >= 0 && i === iRapport + 1)
  )
  const cibles = dossiers.length > 0 ? dossiers : ['src']
  const enCours = fichiersEnCoursAilleurs(cibles)
  const suivis = execFileSync('git', ['ls-files', '-z', '--', ...cibles], {
    cwd: RACINE,
    encoding: 'utf8'
  })
    .split('\0')
    .filter(Boolean)
  const bilan = { fichiers: 0, retirees: 0, restantesProtegees: 0, sautesEnCours: [], refuses: [] }
  const lignes = []
  for (const rel of suivis) {
    if (!/\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs|css|html?)$/u.test(rel)) continue
    const chemin = join(RACINE, rel)
    let texte
    try {
      texte = readFileSync(chemin, 'utf8')
    } catch {
      continue
    }
    if (!/conv-\d/u.test(texte)) continue
    const r = nettoyerTexte(rel, texte)
    bilan.restantesProtegees += r.restantes
    if (r.texte === texte) continue
    // un fichier en cours ailleurs n'est pas réécrit, mais la vérification le compte
    if (enCours.has(rel) && !verifier) {
      bilan.sautesEnCours.push({ fichier: rel, mentions: r.retirees })
      continue
    }
    if (!codeInchange(rel, texte, r.texte)) {
      bilan.refuses.push(rel)
      continue
    }
    bilan.fichiers++
    bilan.retirees += r.retirees
    for (const l of r.lignes) lignes.push({ fichier: rel, ...l })
    if (appliquer) writeFileSync(chemin, r.texte, 'utf8')
  }
  if (rapport) writeFileSync(rapport, JSON.stringify(lignes, null, 1), 'utf8')
  console.log(
    JSON.stringify(
      {
        mode: appliquer ? 'appliqué' : verifier ? 'vérification' : 'simulation',
        fichiersModifies: bilan.fichiers,
        mentionsRetirees: bilan.retirees,
        mentionsGardeesEnCitation: bilan.restantesProtegees,
        fichiersSautesCarEnCoursAilleurs: bilan.sautesEnCours,
        fichiersRefusesCodeChange: bilan.refuses
      },
      null,
      1
    )
  )
  if (verifier && bilan.retirees > 0) process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) principal()
