#!/usr/bin/env node
/**
 * TROUVER LE SCRIPT QUI FAIT DÉJÀ LE GESTE, avant d'en écrire un : recherche par mots dans l'en-tête des scripts.
 *
 * Pourquoi : `scripts/` compte environ 200 scripts à plat, sans index. Un agent qui avait besoin d'un
 * geste ne trouvait l'outil existant que s'il devinait le bon mot pour son grep, et réécrivait sinon
 * le sien. Mesuré le 20/11 sur 30 jours de sessions :
 * 106 écritures de scripts dans `scripts/` ; 205 scripts ajoutés et 149 retirés en 60 jours.
 *
 * LE CONTRAT QUI REND CE CATALOGUE JUSTE : la PREMIÈRE ligne du commentaire d'en-tête d'un script dit ce
 * qu'il fait (`descriptionDuScript`). Rien d'autre n'est tenu à jour à la main : le catalogue se lit en
 * direct sur le disque. `scripts/trouver-script.test.mjs` refuse un script de `scripts/` sans
 * description, sinon il serait introuvable.
 *
 * Usage, depuis le dépôt Autowin :
 *   node scripts/trouver-script.mjs <mots…>       les scripts les plus proches (8 par défaut, --max N)
 *   node scripts/trouver-script.mjs --tout        le catalogue complet, rangé par famille de préfixe
 *   node scripts/trouver-script.mjs --sans-description   ceux qui manquent à la règle (code 1 s'il y en a)
 *   … --json                                      la même chose en JSON
 *
 * Cherche dans `scripts/`, `skills/<nom>/` et `entreprise/<nom>/scripts/` (ce dernier ignoré par git,
 * propre au poste). Lecture seule. Code 0 = réponse rendue (même vide), 2 = commande refusée.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

/**
 * CE QU'EST UN SCRIPT, une seule définition pour ce catalogue et pour le ménage du `/gc`
 * (`gc-scripts-inutilises.mjs`) : tout fichier de code qui se lance ou s'importe, compagnons C# et
 * VBS compris, hors déclarations de types (`.d.mts`). Le `/gc` ne regardait que six extensions : les
 * scripts `.ts`, `.cs` et `.vbs` ne pouvaient jamais lui paraître inutilisés.
 */
const EXT_SCRIPT = /\.(mjs|cjs|js|mts|ts|ps1|psm1|py|sh|cs|vbs|cmd|bat)$/i
const DECLARATION_DE_TYPES = /\.d\.m?ts$/i
export const estUnTest = (nom) =>
  /\.test\.|\.selftest\.|_test\.py$|^test_.*\.py$|^conftest\.py$/i.test(nom)
/** Un fichier de code de `scripts/`, tests compris. */
export const estDuCode = (nom) => EXT_SCRIPT.test(nom) && !DECLARATION_DE_TYPES.test(nom)
export const estUnScript = (nom) => estDuCode(nom) && !estUnTest(nom)
const DOSSIERS_IGNORES = new Set([
  'node_modules',
  '__pycache__',
  'fixtures',
  '__fixtures__',
  'archives',
  '.git'
])

/** Lignes d'outillage, jamais une description : marqueurs de lint, de typage, d'encodage, de garde. */
const LIGNE_OUTILLAGE =
  /^(eslint|@ts-|prettier-|fix-ok:|-\*-|coding[:=]|requires\b|@echo\b|pylint:|type:\s*ignore|noqa)/i

/** Lignes qu'on saute AVANT l'en-tête : shebang, encodage, directives. */
const LIGNE_PREAMBULE =
  /^(#!|@echo\b|#\s*-\*-|#\s*requires\b|'use strict'|"use strict"|\/\/\s*@ts-|\/\/\s*eslint|\/\*\s*eslint[^*]*\*\/$|setlocal\b)/i

/**
 * Les importations, qu'un script JS, Python ou C# pose d'usage AVANT son commentaire d'en-tête.
 * Une importation sur plusieurs lignes (`import {` … `} from '…'`) se saute jusqu'à sa fermeture.
 */
const IMPORTATION =
  /^(import\b|export\s+\*\s+from\b|from\s+\S+\s+import\b|using\s+[\w.]+\s*;|(const|let|var)\s+[\w{}\s,]+=\s*require\()/

/** Un bloc de commentaire ouvert : son marqueur de fin. */
const FIN_DE_BLOC = { '/*': '*/', '<#': '#>', '"""': '"""', "'''": "'''" }

/** L'indice de la première ligne après le préambule et les importations. */
function debutDeLEntete(lignes) {
  let i = 0
  while (i < lignes.length) {
    const l = lignes[i].trim()
    if (l === '' || LIGNE_PREAMBULE.test(l)) i++
    else if (IMPORTATION.test(l)) {
      // `import {` sans `}` sur la même ligne : la liste continue jusqu'à la ligne qui la ferme.
      if (l.includes('{') && !l.includes('}'))
        while (i < lignes.length && !lignes[i].includes('}')) i++
      i++
    } else break
  }
  return i
}

/**
 * Le commentaire d'en-tête d'un fichier : les commentaires qui précèdent tout code (préambule et
 * importations mis à part), rendus en lignes sans marqueurs. Vide si le fichier commence par du code
 * — c'est exactement le cas que la règle refuse : une phrase posée plus bas, au milieu du code, ne se
 * lit pas comme la description du script.
 */
export function enteteDuScript(nom, texte) {
  const lignes = String(texte)
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
  const ext = (nom.match(/\.([a-z0-9]+)$/i)?.[1] ?? '').toLowerCase()
  const diese = ['ps1', 'psm1', 'py', 'sh'].includes(ext)
  const sortie = []
  let i = debutDeLEntete(lignes)
  let bloc = null
  /** Ouvre un bloc à `debut` sur la ligne `l` ; le referme aussitôt si sa fin est sur la même ligne. */
  const ouvrir = (debut, reste) => {
    const fin = FIN_DE_BLOC[debut]
    const k = reste.indexOf(fin)
    sortie.push((k >= 0 ? reste.slice(0, k) : reste).replace(/^\*+\s?/, '').trim())
    bloc = k >= 0 ? null : debut
  }
  for (; i < lignes.length; i++) {
    const l = lignes[i].trim()
    if (bloc) {
      const k = l.indexOf(FIN_DE_BLOC[bloc])
      sortie.push((k >= 0 ? l.slice(0, k) : l).replace(/^\*\s?/, '').trim())
      if (k >= 0) bloc = null
      continue
    }
    if (l === '') {
      if (sortie.length) sortie.push('')
      continue
    }
    if (!diese && l.startsWith('/*')) ouvrir('/*', l.slice(2))
    else if (diese && l.startsWith('<#')) ouvrir('<#', l.slice(2))
    else if (ext === 'py' && /^[rRuU]?("""|''')/.test(l)) {
      const guillemets = l.includes('"""') ? '"""' : "'''"
      ouvrir(guillemets, l.slice(l.indexOf(guillemets) + 3))
    } else if (!diese && l.startsWith('//')) sortie.push(l.replace(/^\/\/+\s?/, '').trim())
    else if (diese && l.startsWith('#')) sortie.push(l.replace(/^#+\s?/, '').trim())
    else if (ext === 'vbs' && (l.startsWith("'") || /^rem\b/i.test(l))) {
      sortie.push(l.replace(/^('|rem\b)\s?/i, '').trim())
    } else if ((ext === 'cmd' || ext === 'bat') && (/^rem\b/i.test(l) || l.startsWith('::'))) {
      sortie.push(l.replace(/^(rem\b|::)\s?/i, '').trim())
    } else break // premier code : l'en-tête est fini
  }
  while (sortie.length && sortie[sortie.length - 1] === '') sortie.pop()
  return sortie
}

/** Un mot-clé d'aide PowerShell (`.SYNOPSIS`) annonce la description sur la ligne suivante. */
const MOT_CLE_AIDE = /^\.(synopsis|description|notes|example|parameter)\b/i

/** Une phrase finie : un point, ou une parenthèse, un guillemet, un code fermés après lui. */
const PHRASE_FINIE = /[.!?…][)»"'`]*$/
/** Une ligne qui ouvre autre chose qu'une suite de phrase : un élément de liste. */
const LIGNE_NEUVE = /^([-*•]\s|\d+[.)]\s)/
/** Une ligne d'usage ou de commande n'est jamais la suite de la description. */
const COMMANDE_EN_TETE = /^(usage|utilisation)\b|^(node|powershell|pwsh|python|npx)\s/i
/** Au-delà, la description serait un paragraphe : le catalogue l'affiche de toute façon coupée. */
const DESCRIPTION_MAX = 220

/**
 * La description d'un script : la première ligne parlante de son en-tête (au moins 15 caractères,
 * ni marqueur d'outillage ni mot-clé d'aide), prolongée par les lignes suivantes tant que sa phrase
 * n'est pas finie — sinon « Prépare un brouillon de courrier qu'Outlook ouvre, prêt à envoyer : »
 * s'arrêterait sur ses deux-points. `''` quand il n'en a pas.
 */
export function descriptionDuScript(nom, texte) {
  const entete = enteteDuScript(nom, texte)
  for (let i = 0; i < entete.length; i++) {
    let l = entete[i].replace(/^[-=*#\s]+/, '').trim()
    if (l.length < 15 || LIGNE_OUTILLAGE.test(l) || MOT_CLE_AIDE.test(l)) continue
    for (
      let j = i + 1;
      j < entete.length && !PHRASE_FINIE.test(l) && l.length < DESCRIPTION_MAX;
      j++
    ) {
      const suite = entete[j].trim()
      if (
        !suite ||
        LIGNE_NEUVE.test(suite) ||
        MOT_CLE_AIDE.test(suite) ||
        COMMANDE_EN_TETE.test(suite)
      )
        break
      l = `${l} ${suite}`
    }
    return l
  }
  return ''
}

const COMMANDE = /\b(node|powershell|pwsh|python|py|npx|bash|cscript|wscript)\b/i

/** La ligne d'usage de l'en-tête, s'il en donne une : `Usage : node …`, ou la ligne qui suit `Usage`. */
export function usageDuScript(nom, texte) {
  const entete = enteteDuScript(nom, texte)
  for (let i = 0; i < entete.length; i++) {
    const m = entete[i].match(/^(usage|utilisation|lancement)\b[^:]*:\s*(.*)$/i)
    if (!m) continue
    if (COMMANDE.test(m[2])) return m[2].trim()
    const suivante = entete.slice(i + 1).find((l) => l.trim() !== '')
    if (suivante && COMMANDE.test(suivante)) return suivante.trim()
  }
  return ''
}

function lister(dossier, recursif, acc = []) {
  let entrees
  try {
    entrees = readdirSync(dossier, { withFileTypes: true })
  } catch {
    return acc // dossier absent ou illisible : rien à y chercher
  }
  for (const e of entrees) {
    if (DOSSIERS_IGNORES.has(e.name)) continue
    const p = join(dossier, e.name)
    if (e.isDirectory() && recursif) lister(p, recursif, acc)
    else if (e.isFile() && estUnScript(e.name)) acc.push(p)
  }
  return acc
}

/** Les dossiers de scripts du dépôt : `scripts/`, chaque `skills/<nom>/`, chaque `entreprise/<nom>/scripts/`. */
export function dossiersDeScripts(depot) {
  const dossiers = [{ chemin: join(depot, 'scripts'), recursif: false }]
  for (const parent of ['skills', 'entreprise']) {
    const racine = join(depot, parent)
    if (!existsSync(racine)) continue
    for (const e of readdirSync(racine, { withFileTypes: true })) {
      if (!e.isDirectory()) continue
      const d = parent === 'skills' ? join(racine, e.name) : join(racine, e.name, 'scripts')
      if (existsSync(d)) dossiers.push({ chemin: d, recursif: parent === 'entreprise' })
    }
  }
  return dossiers
}

/**
 * `voisin` est-il un test de `base` ? `x.test.mjs`, `x_test.py`, et les tests par aspect que le dépôt
 * range à côté (`ui-capture.cadrage.test.mjs`, `hdesk-act.sansclic.test.ps1`).
 */
export function estSonTest(base, voisin) {
  return (
    voisin === `${base}_test.py` ||
    (voisin.startsWith(`${base}.`) && /\.test\.[a-z0-9]+$/i.test(voisin))
  )
}

/** Chaque script du dépôt, avec sa description, son usage et la présence d'un test à côté. */
export function listerScripts(depot) {
  const scripts = []
  for (const { chemin, recursif } of dossiersDeScripts(depot)) {
    let voisins = []
    try {
      voisins = readdirSync(chemin)
    } catch {
      // dossier illisible : ses scripts ne seront pas listés non plus
    }
    for (const p of lister(chemin, recursif)) {
      let texte
      try {
        texte = readFileSync(p, 'utf8')
      } catch {
        continue // supprimé entre la liste et la lecture (autre fil) : il n'est plus à proposer
      }
      const nom = p.split(/[\\/]/).pop()
      const base = nom.replace(/\.[^.]+$/, '')
      scripts.push({
        chemin: relative(depot, p).split('\\').join('/'),
        nom,
        description: descriptionDuScript(nom, texte),
        usage: usageDuScript(nom, texte),
        entete: enteteDuScript(nom, texte).join(' '),
        teste: voisins.some((v) => estSonTest(base, v))
      })
    }
  }
  return scripts.sort((a, b) => a.chemin.localeCompare(b.chemin))
}

/** Minuscules sans accents, ponctuation en espaces : « Écran » et « ecran » se trouvent l'un l'autre. */
export function normaliser(texte) {
  return String(texte)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** La racine d'un mot, pour ses variantes : « captures », « capturer » → « captu ». */
function racineDuMot(mot) {
  return mot.length >= 6 ? mot.slice(0, mot.length - 2) : mot
}

/**
 * Les scripts qui répondent aux mots, du plus proche au plus lointain. Un mot dans le NOM pèse plus
 * qu'un mot dans la description, qui pèse plus qu'un mot dans le reste de l'en-tête ; un script qui
 * répond à PLUS de mots passe devant un script qui répond plus fort à un seul.
 */
export function chercher(scripts, requete) {
  const mots = [
    ...new Set(
      normaliser(requete)
        .split(' ')
        .filter((m) => m.length >= 2)
    )
  ]
  if (!mots.length) return []
  const resultats = []
  for (const s of scripts) {
    const nom = ` ${normaliser(s.nom)} `
    const description = ` ${normaliser(s.description)} `
    const entete = ` ${normaliser(s.entete)} `
    let score = 0
    let touches = 0
    for (const mot of mots) {
      const r = racineDuMot(mot)
      // Un mot court (`ui`, `pdf`) doit commencer un mot ; un mot long peut se trouver au milieu
      // d'un nom composé (`capture` dans `ui-capture`, déjà séparé, ou `hdesk` dans `hdeskact`).
      const dans = (h) => h.includes(` ${r}`) || (r.length >= 5 && h.includes(r))
      const points = dans(nom) ? 5 : dans(description) ? 3 : dans(entete) ? 1 : 0
      if (points) touches++
      score += points
    }
    if (score > 0) resultats.push({ ...s, score: score + touches * 6 })
  }
  return resultats.sort((a, b) => b.score - a.score || a.chemin.localeCompare(b.chemin))
}

/** Famille d'un script = son préfixe (`hdesk-act.ps1` → `hdesk`). Les familles d'un seul vont dans « autres ». */
export function parFamille(scripts) {
  const familles = new Map()
  for (const s of scripts) {
    const famille = s.chemin.startsWith('scripts/')
      ? s.nom.split(/[-_.]/)[0].toLowerCase()
      : s.chemin.split('/').slice(0, 2).join('/')
    if (!familles.has(famille)) familles.set(famille, [])
    familles.get(famille).push(s)
  }
  const autres = []
  const rangees = []
  for (const [famille, membres] of familles) {
    if (membres.length === 1 && !famille.includes('/')) autres.push(...membres)
    else rangees.push([famille, membres])
  }
  rangees.sort((a, b) => a[0].localeCompare(b[0]))
  if (autres.length) rangees.push(['autres', autres])
  return rangees
}

function couper(texte, max) {
  return texte.length > max ? `${texte.slice(0, max - 1)}…` : texte
}

export const RAPPEL_PLACE =
  'Rien ne fait ce geste ? Un script pour CE travail seulement va dans `.autowin-tmp/<id du fil>/` ' +
  "(ignoré par git, purgé par /gc après 7 jours) ; un outil que d'autres demandes rappelleront va dans " +
  "`scripts/`, avec sa description en première ligne d'en-tête et son test."

/** Ce que ferait la commande : `{ code, sortie }`, sans rien écrire sur la console (testable). */
export function executer(argv, depotParDefaut) {
  let options
  try {
    options = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        tout: { type: 'boolean', default: false },
        'sans-description': { type: 'boolean', default: false },
        json: { type: 'boolean', default: false },
        max: { type: 'string', default: '8' },
        depot: { type: 'string' }
      }
    })
  } catch (erreur) {
    return { code: 2, sortie: `Commande refusée : ${erreur.message}` }
  }
  const { values, positionals } = options
  const max = Number(values.max)
  if (!Number.isInteger(max) || max < 1)
    return { code: 2, sortie: 'Commande refusée : --max attend un entier positif.' }
  const scripts = listerScripts(resolve(values.depot ?? depotParDefaut))
  const sansEntete = ({ entete: _entete, ...s }) => s

  if (values['sans-description']) {
    const sans = scripts.filter((s) => s.chemin.startsWith('scripts/') && !s.description)
    const lignes = values.json
      ? [
          JSON.stringify(
            sans.map((s) => s.chemin),
            null,
            2
          )
        ]
      : sans.length
        ? [
            `${sans.length} script(s) sans description en première ligne d'en-tête :`,
            ...sans.map((s) => `  ${s.chemin}`)
          ]
        : [`Les ${scripts.length} scripts ont une description.`]
    return { code: sans.length ? 1 : 0, sortie: lignes.join('\n') }
  }

  if (values.tout || !positionals.length) {
    if (values.json) return { code: 0, sortie: JSON.stringify(scripts.map(sansEntete), null, 2) }
    const lignes = [
      `${scripts.length} scripts — node scripts/trouver-script.mjs <mots> pour chercher.`,
      ''
    ]
    for (const [famille, membres] of parFamille(scripts)) {
      lignes.push(`${famille} (${membres.length})`)
      for (const s of membres)
        lignes.push(`  ${s.chemin} — ${couper(s.description || '(sans description)', 110)}`)
    }
    return { code: 0, sortie: lignes.join('\n') }
  }

  const requete = positionals.join(' ')
  const trouves = chercher(scripts, requete).slice(0, max)
  if (values.json) return { code: 0, sortie: JSON.stringify(trouves.map(sansEntete), null, 2) }
  if (!trouves.length)
    return { code: 0, sortie: `Aucun script ne parle de « ${requete} ».\n${RAPPEL_PLACE}` }
  const lignes = []
  for (const s of trouves) {
    lignes.push(
      `${s.chemin}${s.teste ? ' · testé' : ''} — ${couper(s.description || '(sans description)', 160)}`
    )
    if (s.usage) lignes.push(`    ${couper(s.usage, 160)}`)
  }
  lignes.push('', `Lis l'en-tête du script retenu avant de l'appeler. ${RAPPEL_PLACE}`)
  return { code: 0, sortie: lignes.join('\n') }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { code, sortie } = executer(
    process.argv.slice(2),
    join(dirname(fileURLToPath(import.meta.url)), '..')
  )
  ;(code === 2 ? console.error : console.log)(sortie)
  process.exitCode = code
}
