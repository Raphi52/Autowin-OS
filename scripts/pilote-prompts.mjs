#!/usr/bin/env node
/**
 * SONDE PILOTE — LECTURE SEULE. Fabrique la matiere d'un mode qui ecrit les prompts A LA PLACE de
 * l'utilisateur pour travailler sur Autowin OS en autonomie.
 *
 * TROIS sorties, et aucune n'est estimee : tout vient du depot et du corpus reellement stockes.
 *
 * 0. LE GROS OEUVRE — l'ouvrage que le PROJET declare (docs de direction), classe par l'ECART
 *    encore mesurable dans le code. C'est LUI qui decide de quoi on parle : les prompts disent
 *    des gestes, ils ne disent pas l'ouvrage.
 * 1. LE STYLE — comment l'utilisateur formule VRAIMENT ses demandes (longueur, mode imperatif,
 *    presence d'une cible nommee, ouvertures les plus frequentes). Un mode qui prompte a sa place
 *    sans ce profil produit des consignes de robot, que la machine execute ensuite a la lettre.
 * 2. LES CHANTIERS OUVERTS — ce que les fins de tour ont laisse en « Reste a faire » ou en
 *    « Recommande » sans jamais y revenir. C'est le vivier de la prochaine demande.
 *
 * Usage : node scripts/pilote-prompts.mjs [--top N] [--json] [--data <dir>]
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/** Relances nues : elles ne portent aucune cible, donc elles ne fondent pas le style. */
const RELANCES = new Set([
  'go',
  'ok',
  'oui',
  'non',
  'reprend',
  'reprends',
  'continue',
  'vas-y',
  'vasy',
  'finis',
  'reprend pardon',
  'marche pas',
  'rien',
  'stop'
])

export function estRelance(texte) {
  const nu = texte.trim().toLowerCase()
  return RELANCES.has(nu) || nu.length <= 3
}

/** Une demande NOMME sa cible quand elle cite un chemin, un symbole, une commande ou un conv-N. */
export function nommeUneCible(texte) {
  return /[\w-]+\.(ts|tsx|mjs|js|json|md|ps1)\b|\bconv-\d+\b|`[^`]+`|\bnpm run [\w:-]+|\b[0-9a-f]{7,10}\b/i.test(
    texte
  )
}

const VERBES =
  /^(fais|fait|met|mets|ajoute|corrige|enleve|supprime|remplace|cree|lance|commite?|commit|pousse|push|verifie|analyse|diagnostique|trouve|rends|reduis|greffe|affiche|classe|renomme|repare|nettoie|teste|change|passe|attaque|donne|montre|explique|simplifie|debloque|fusionne|salvage|kaizen)\b/i

export function estImperatif(texte) {
  const nu = texte
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
  return VERBES.test(nu)
}

/** Les rubriques de cloture, memes en-tetes que le mode auto du chat. */
const EN_TETES =
  /^\s*(?:✅|⚠️?|📍|⏳|👉)\s*\**\s*(Fait|Maintenant|Reste à faire|Recommandé)(?!\p{L})/u

export function lignesDeRubrique(texte, rubrique) {
  const sortie = []
  let dedans = false
  for (const brute of String(texte ?? '').split('\n')) {
    const e = brute.match(EN_TETES)
    if (e) {
      dedans = e[1] === rubrique
      if (dedans) {
        const reste = brute.replace(EN_TETES, '').replace(/^\s*\**\s*[:：—–-]?\s*/u, '')
        if (reste.trim()) sortie.push(reste.trim())
      }
      continue
    }
    if (dedans && brute.trim()) sortie.push(brute.trim())
  }
  return sortie
}

export function ditRien(lignes) {
  return lignes.some((l) => {
    const nu = l
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/^[\s>*•\-–—]+/u, '')
      .replace(/[\s.;:!*`]+$/u, '')
      .trim()
    return nu === 'rien' || nu === 'rien a signaler' || nu === 'rien a faire'
  })
}

/** Un chantier reste OUVERT si la derniere reponse du fil laisse du reste-a-faire non nul. */
export function chantiersOuverts(conv) {
  let dernier = null
  for (const m of conv.messages ?? [])
    if (m.role === 'assistant' && typeof m.content === 'string') dernier = m.content
  if (!dernier) return []
  const reste = lignesDeRubrique(dernier, 'Reste à faire')
  const reco = lignesDeRubrique(dernier, 'Recommandé')
  if (ditRien(reste) && ditRien(reco)) return []
  return [...reste, ...reco]
    .filter(
      (l) =>
        l.length > 8 &&
        !l.startsWith('(') &&
        !l.startsWith('AUTOWIN_PROMPT_V1') &&
        !EN_TETES.test(l) &&
        !ditRien([l]) &&
        // « rien sur ce sujet », « rien a enchainer » : une fin de chaine, pas un chantier.
        !/^[\s>*•\-–—]*rien\b/i.test(l.normalize('NFD').replace(/[\u0300-\u036f]/g, ''))
    )
    .slice(0, 4)
}

export function medianeLongueur(prompts) {
  if (!prompts.length) return 0
  const t = prompts.map((p) => p.length).sort((a, b) => a - b)
  return t[Math.floor(t.length / 2)]
}

export function profilStyle(prompts) {
  const vrais = prompts.filter((p) => !estRelance(p))
  const pct = (n) => (vrais.length ? Math.round((n / vrais.length) * 100) : 0)
  const ouvertures = new Map()
  for (const p of vrais) {
    const mot = p
      .trim()
      .split(/\s+/)[0]
      .toLowerCase()
      .replace(/[^\p{L}'-]/gu, '')
    if (mot.length > 1) ouvertures.set(mot, (ouvertures.get(mot) ?? 0) + 1)
  }
  return {
    prompts: prompts.length,
    relances: prompts.length - vrais.length,
    medianeCaracteres: medianeLongueur(vrais),
    pctCourts: pct(vrais.filter((p) => p.length <= 80).length),
    pctImperatif: pct(vrais.filter(estImperatif).length),
    pctCibleNommee: pct(vrais.filter(nommeUneCible).length),
    ouverturesTop: [...ouvertures.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
  }
}

/* ------------------------------------------------------------------------ *
 * AXE 2 — LE GROS OEUVRE
 *
 * Demande utilisateur du 2026-09-03 : « faut surtout que ca analyse le gros oeuvre que j'essaye
 * d'accomplir pour creer la skill (pas base que sur mes prompts) ». Les prompts disent des GESTES ;
 * ils ne disent pas l'OUVRAGE. Un mode qui ne lit que les prompts recopie donc la journee d'hier au
 * lieu de faire avancer le projet.
 *
 * La source de l'ouvrage, ce sont les documents de direction du depot (`docs/*.md`, `README.md`,
 * `ONBOARDING.md`, `RUN.md`, `resources/kit-*.md`) : ils declarent des CHANTIERS, un BUT, une
 * definition de « fini ». Et l'ECART se mesure : un chantier qui cite encore des fichiers PRESENTS
 * dans le depot n'est pas termine. Rien n'est devine — chaque objectif porte son fichier, sa ligne,
 * et les preuves de code qui le tiennent encore ouvert.
 * ------------------------------------------------------------------------ */

/** Les documents qui portent une intention de projet, par ordre d'autorite. */
const DOCS_DIRECTION = ['README.md', 'ONBOARDING.md', 'RUN.md', 'docs', 'resources']

/** N'importe quel titre de section : c'est le decoupage brut du document. */
const TITRE_SECTION = /^#{1,4}\s+(?:\d+\.\s*)?(.+?)\s*$/

/** Un titre qui se DESIGNE lui-meme comme un ouvrage : il pese plus qu'une section ordinaire. */
const MOT_OUVRAGE =
  /^(?:chantier|objectif|etape|étape|phase|migration|refonte|plan|but|cible|promesse|socle)\b/i

/** Une ligne de but explicite (« > But : … », « Objectif : … »). */
const LIGNE_BUT = /^\s*>?\s*(?:but|objectif|promesse|cible)\s*[:：]\s*(.+)$/i

/** Une case a cocher non faite : le seul reste-a-faire ECRIT par l'auteur du document. */
const CASE_OUVERTE = /^\s*[-*]\s*\[ \]\s*(.+)$/

/** Les artefacts que le texte CITE en dur : `chemin.ts`, `symbole()`, `npm run x`. */
export function citationsCode(texte) {
  const sortie = new Set()
  for (const m of String(texte).matchAll(/`([^`]{2,80})`/g)) {
    const brut = m[1].trim()
    if (/\.(ts|tsx|mjs|js|json|md|ps1|css)\b/.test(brut) || /^npm run [\w:-]+$/.test(brut))
      sortie.add(brut)
  }
  return [...sortie]
}

/** Le chemin de depot cite existe-t-il encore ? C'est la preuve qu'un chantier reste ouvert. */
function cheminEncorePresent(racine, citation) {
  const nu = citation.replace(/[`()]/g, '').split(':')[0].trim()
  if (!/\.(ts|tsx|mjs|js|json|md|ps1|css)$/.test(nu)) return false
  if (existsSync(join(racine, nu))) return nu
  // Le document cite souvent un chemin RELATIF a src/ (« providers/claude.ts »).
  for (const prefixe of ['src', 'src/main', 'src/renderer/src', 'scripts', 'skills'])
    if (existsSync(join(racine, prefixe, nu))) return `${prefixe}/${nu}`
  return false
}

/** Decoupe UN document en ouvrages : titre, but, restes ecrits, artefacts cites. */
export function ouvragesDuDocument(chemin, contenu) {
  const lignes = contenu.split('\n')
  const ouvrages = []
  let courant = null
  /*
   * Deux portes, et c'est deliberе : un titre qui se DESIGNE comme un ouvrage (« Chantier 1 »,
   * « Objectif », « La promesse de fond ») suffit des qu'il cite du code ; une section ordinaire
   * ne compte que si son auteur y a ecrit un BUT ou une case a cocher non faite. Sans cette
   * seconde condition, chaque titre contenant un chemin entre accents graves deviendrait un
   * « objectif » et noierait l'ouvrage reel.
   */
  const pousser = () => {
    if (!courant) return
    const matiere = courant.but || courant.restes.length > 0
    if (courant.designe ? matiere || courant.citations.length > 0 : matiere) ouvrages.push(courant)
  }
  lignes.forEach((ligne, i) => {
    const titre = ligne.match(TITRE_SECTION)
    if (titre) {
      pousser()
      const nu = titre[1]
        .replace(/[*_#`]/g, '')
        .replace(/^(?:la|le|les|l')\s+/i, '')
        .trim()
      courant = {
        document: chemin,
        ligne: i + 1,
        designe: MOT_OUVRAGE.test(nu),
        titre: nu.replace(/\s+/g, ' ').slice(0, 120),
        but: null,
        restes: [],
        citations: []
      }
      return
    }
    if (!courant) return
    const but = ligne.match(LIGNE_BUT)
    if (but && !courant.but) courant.but = but[1].trim().slice(0, 200)
    const cas = ligne.match(CASE_OUVERTE)
    if (cas) courant.restes.push(cas[1].trim().slice(0, 160))
    for (const c of citationsCode(ligne))
      if (!courant.citations.includes(c)) courant.citations.push(c)
  })
  pousser()
  return ouvrages
}

function fichiersMarkdown(racine) {
  const sortie = []
  const visiter = (rel, profondeur) => {
    const abs = join(racine, rel)
    if (!existsSync(abs)) return
    const st = readdirSync(abs, { withFileTypes: true })
    for (const e of st) {
      const enfant = `${rel}/${e.name}`
      if (e.isDirectory() && profondeur < 2) visiter(enfant, profondeur + 1)
      else if (e.isFile() && e.name.endsWith('.md')) sortie.push(enfant)
    }
  }
  for (const cible of DOCS_DIRECTION) {
    const abs = join(racine, cible)
    if (!existsSync(abs)) continue
    if (cible.endsWith('.md')) sortie.push(cible)
    else visiter(cible, 0)
  }
  return sortie
}

/**
 * LE GROS OEUVRE, classe par ECART MESURE : un ouvrage dont les fichiers cites existent encore
 * pese plus qu'un ouvrage dont plus rien n'est trouvable (celui-la est probablement fait).
 */
export function grosOeuvre(racine) {
  const ouvrages = []
  for (const doc of fichiersMarkdown(racine)) {
    let contenu = ''
    try {
      contenu = readFileSync(join(racine, doc), 'utf8')
    } catch {
      continue
    }
    for (const o of ouvragesDuDocument(doc, contenu)) {
      const presents = o.citations.map((c) => cheminEncorePresent(racine, c)).filter(Boolean)
      ouvrages.push({
        ...o,
        presents,
        // Un ouvrage NOMME par son auteur pese plus qu'une section deduite : +5.
        ecart: presents.length * 2 + o.restes.length * 3 + (o.designe ? 5 : 0)
      })
    }
  }
  return ouvrages.sort((a, b) => b.ecart - a.ecart)
}

export function racineDonnees(arg) {
  if (arg) return arg
  const base = join(process.cwd(), '.autowin-data')
  if (!existsSync(base)) return base
  const dossiers = readdirSync(base, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(base, d.name, 'conversations.json')))
    .map((d) => join(base, d.name))
  return dossiers[0] ?? base
}

export function lireCorpus(dir) {
  const fichier = join(dir, 'conversations.json')
  if (!existsSync(fichier)) return { conversations: [], fichier }
  const brut = JSON.parse(readFileSync(fichier, 'utf8'))
  const conversations = Array.isArray(brut) ? brut : (brut.conversations ?? [])
  return { conversations, fichier }
}

export function analyser(conversations) {
  const prompts = []
  const chantiers = []
  for (const c of conversations) {
    for (const m of c.messages ?? []) {
      if (m.role === 'user' && typeof m.content === 'string' && !m.orientation && m.content.trim())
        prompts.push(m.content.trim())
    }
    for (const ligne of chantiersOuverts(c))
      chantiers.push({
        conversation: c.id ?? '?',
        titre: String(c.title ?? '').slice(0, 60),
        ligne
      })
  }
  return { style: profilStyle(prompts), chantiers, prompts }
}
