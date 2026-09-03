#!/usr/bin/env node
/**
 * arena-protocole-check — controle DETERMINISTE du protocole d'un banc /arena.
 *
 * Pourquoi : au banc du 2026-09-02 (conv-126), des etapes obligatoires de `skills/arena/SKILL.md`
 * ont saute SANS que rien ne le dise (aucune section `## Candidats scoutes`, aucune ligne
 * Discrimination, critere sans cas limite). Le seul controle disponible etait un agent qui se
 * relit — donc aucune preuve (`skills/judge/SKILL.md:25`, `skills/arena/SKILL.md:156`).
 * Ici : du code, sur les fichiers du banc, en LECTURE SEULE.
 *
 * Usage : node scripts/arena-protocole-check.mjs --run <RUN.md> --bench <dossier-du-banc> [--json]
 * Exit 0 = protocole tenu · 1 = au moins un point RATE · 2 = entrees illisibles.
 *
 * Ce script ne tranche QUE ce qui se lit. Les points de jugement (X vraiment casse-premisse ?
 * un bras a-t-il reformule la tache ? qualite reelle ? reproductible ?) sont listes tels quels :
 * aucun script ne les tranchera, et pretendre le contraire serait un faux vert.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

const BRAS = ['a', 'b', 'c', 'x']
/** Mots qui marquent un cas HORS chemin heureux dans le libelle d'une assertion. */
const MOTS_CAS_LIMITE =
  /absurd|invalid|vide|zero|zéro|borne|limite|erreur|refus|plantage|stack|hors|farfelu|20\d\d-1[3-9]|2099/i

const lire = (f) => (existsSync(f) ? readFileSync(f, 'utf8') : null)
const nombre = (cell) => Number(String(cell).replace(/[*\s]/g, '').replace(',', '.'))
const lireJson = (f) => {
  const t = lire(f)
  if (t === null) return null
  try {
    return JSON.parse(t)
  } catch {
    return null
  }
}

/** Les lignes de tableau Markdown d'un bloc (separateurs retires). */
function lignesTableau(bloc) {
  return bloc
    .split('\n')
    .filter((l) => l.trim().startsWith('|') && !/^\|[\s:|-]+\|$/.test(l.trim()))
    .map((l) =>
      l
        .trim()
        .split('|')
        .slice(1, -1)
        .map((c) => c.trim())
    )
}

function section(md, titre) {
  const i = md.indexOf(titre)
  if (i < 0) return null
  const reste = md.slice(i + titre.length)
  const fin = reste.search(/\n##\s/)
  return fin < 0 ? reste : reste.slice(0, fin)
}

/** Le script de lancement du banc, quel que soit son nom. */
function scriptLancement(bench) {
  if (!existsSync(bench)) return null
  const f = readdirSync(bench).find((n) => /^lance.*\.(sh|ps1|bat|mjs|js)$/i.test(n))
  return f
    ? { chemin: path.join(bench, f), texte: readFileSync(path.join(bench, f), 'utf8') }
    : null
}

export function verifierProtocole({ run, bench }) {
  const md = lire(run)
  if (md === null) return { erreur: `RUN.md introuvable : ${run}` }
  const points = []
  const ajoute = (id, nom, fn) => {
    try {
      const d = fn()
      points.push({ id, nom, ok: d === true, detail: d === true ? 'ok' : String(d) })
    } catch (e) {
      points.push({ id, nom, ok: false, detail: `controle en erreur : ${e.message}` })
    }
  }
  const sorties = Object.fromEntries(
    BRAS.map((b) => [b, lireJson(path.join(bench, `out-${b}.json`))])
  )
  const lancement = scriptLancement(bench)

  ajoute('P1', 'Candidats scoutes ecrits sur disque : >=6 lignes, B/C/X marques', () => {
    const bloc = section(md, '## Candidats scoutés') ?? section(md, '## Candidats scoutes')
    if (bloc === null) return 'section `## Candidats scoutés` absente du RUN.md'
    const candidats = lignesTableau(bloc).filter((l) => !/^candidat$/i.test(l[0]))
    if (candidats.length < 6) return `${candidats.length} candidat(s) listes, 6 minimum`
    const retenus = new Set(
      candidats.map((l) => l[l.length - 1].toUpperCase()).filter((v) => ['B', 'C', 'X'].includes(v))
    )
    const manque = ['B', 'C', 'X'].filter((v) => !retenus.has(v))
    if (manque.length) return `aucune ligne marquee ${manque.join(', ')}`
    /*
     * L'ORDRE FAIT PARTIE DE LA REGLE — objection du juge, conv-158 (2026-09-03, turnId
     * e0697674-fb4a-4f79-a6a0-565be7e07998) : le tableau des candidats avait ete ecrit APRES la
     * commande de lancement, et P1 passait quand meme parce qu'il ne testait que la presence. Un
     * scoutage redige apres coup ne choisit plus rien : il justifie. Le test est lisible sans
     * jugement — position du titre de section contre premiere mention du lancement dans le RUN.md.
     */
    const titre = ['## Candidats scoutés', '## Candidats scoutes']
      .map((t) => md.indexOf(t))
      .find((i) => i >= 0)
    const ancres = [lancement ? path.basename(lancement.chemin) : null, 'claude -p'].filter(Boolean)
    const lancementPos = ancres.map((a) => md.indexOf(a)).filter((i) => i >= 0)
    if (lancementPos.length && Math.min(...lancementPos) < titre) {
      return 'candidats ecrits APRES le lancement : le scoutage ne choisit plus, il justifie'
    }
    return true
  })

  ajoute('P2', 'Rouge du critere CONSTATE avant lancement, sortie COLLEE dans le RUN.md', () => {
    if (!/rouge/i.test(md)) return 'aucune mention de rouge constate'
    // La skill demande la sortie COLLEE (commande + code != 0 + assertions en echec), pas une
    // affirmation en prose. Seul un bloc de code distingue l_une de l_autre de facon lisible.
    const blocs = [...md.matchAll(/```[^\n]*\n([\s\S]*?)```/g)].map((m) => m[1])
    const rouge = blocs.find((b) =>
      /(RATE|FAIL|NON ATTEINT|échec|echec)|(code (?:de sortie|retour)|exit(?: code)?)\s*[:=]?\s*[1-9]/i.test(
        b
      )
    )
    return rouge
      ? true
      : 'mention de rouge en prose, aucune sortie collee (bloc de code avec code != 0 ou assertions en echec)'
  })

  ajoute('P3', 'Critere : >=3 assertions dont >=2 cas limites', () => {
    const critere = lire(path.join(bench, 'check.mjs'))
    if (critere === null) return `aucun critere executable dans ${bench} (check.mjs attendu)`
    const libelles = [...critere.matchAll(/check\(\s*['"`]([^'"`]+)['"`]/g)].map((m) => m[1])
    if (libelles.length < 3) return `${libelles.length} assertion(s), 3 minimum`
    const limites = libelles.filter((l) => MOTS_CAS_LIMITE.test(l))
    return limites.length >= 2
      ? true
      : `${limites.length} cas limite sur ${libelles.length} assertions, 2 minimum — critere chemin heureux`
  })

  ajoute('P4', 'Quatre bras A/B/C/X reellement lances (prompt + sortie)', () => {
    const manque = []
    for (const b of BRAS) {
      if (!existsSync(path.join(bench, `prompt-${b}.txt`))) manque.push(`prompt-${b}.txt`)
      if (!sorties[b]) manque.push(`out-${b}.json`)
    }
    return manque.length ? `manquant ou illisible : ${manque.join(', ')}` : true
  })

  ajoute('P5', 'Enonce IDENTIQUE mot pour mot dans les quatre prompts', () => {
    const tache = lire(path.join(bench, 'tache.txt'))
    if (tache === null) return 'tache.txt absent : rien ne prouve un enonce commun'
    const attendu = tache.trim()
    if (!attendu) return 'tache.txt vide'
    const divergents = BRAS.filter(
      (b) => !(lire(path.join(bench, `prompt-${b}.txt`)) ?? '').includes(attendu)
    )
    return divergents.length ? `enonce absent ou modifie dans : ${divergents.join(', ')}` : true
  })

  ajoute('P6', 'Une copie de travail DISTINCTE par bras', () => {
    if (!lancement) return 'aucun script de lancement trouve dans le banc'
    const cds = [...lancement.texte.matchAll(/cd\s+"?([^"\n|&;]+)"?/g)].map((m) => m[1].trim())
    if (!cds.length) return 'aucun changement de dossier : les bras ont pu ecrire au meme endroit'
    const boucle = /for\s+(\w+)\s+in\s+a\s+b\s+c\s+x/i.exec(lancement.texte)
    if (boucle && cds.some((c) => c.includes(boucle[1]))) return true
    const distincts = new Set(cds)
    return distincts.size >= 4 ? true : `${distincts.size} dossier(s) distinct(s) pour 4 bras`
  })

  ajoute('P7', 'Les quatre bras partent EN MEME TEMPS (arriere-plan + attente)', () => {
    if (!lancement) return 'aucun script de lancement trouve dans le banc'
    const t = lancement.texte
    const parallele = /&\s*$/m.test(t) || /Start-Job|Start-Process|Promise\.all/i.test(t)
    const attente = /^\s*wait\s*$/m.test(t) || /Wait-Job|Promise\.all/i.test(t)
    return parallele && attente
      ? true
      : 'lancement sequentiel : le 2e bras profite du travail du 1er (SKILL.md, pieges)'
  })

  ajoute('P8', 'Chaque $ du tableau == total_cost_usd du bras (aucun chiffre estime)', () => {
    const lignes = lignesTableau(md)
    const entete = lignes.find((l) => /^bras$/i.test(l[0]) && l.some((c) => c.includes('$')))
    if (!entete) return 'tableau au format impose absent : rien a confronter'
    const iCout = entete.findIndex((c) => c.includes('$'))
    const ecarts = []
    for (const b of BRAS) {
      const ligne = lignes
        .filter((l) => new RegExp(`^\\*{0,2}${b}\\*{0,2}( |$|\\()`, 'i').test(l[0]))
        .pop()
      if (!ligne) {
        ecarts.push(`${b}: absent du tableau`)
        continue
      }
      const dit = nombre(ligne[iCout])
      const mesure = sorties[b]?.total_cost_usd
      if (!Number.isFinite(dit)) ecarts.push(`${b}: cout illisible "${ligne[iCout]}"`)
      else if (!Number.isFinite(mesure))
        ecarts.push(`${b}: aucun total_cost_usd dans out-${b}.json`)
      else if (Math.abs(dit - mesure) > 0.001)
        ecarts.push(`${b}: tableau ${ligne[iCout]} vs journal ${mesure.toFixed(4)}`)
    }
    return ecarts.length ? ecarts.join(' ; ') : true
  })

  ajoute('P9', 'Le juge est un appel DISTINCT des quatre bras', () => {
    const juge = lireJson(path.join(bench, 'out-judge.json'))
    if (!juge) return 'out-judge.json absent : le producteur a pu se juger lui-meme'
    if (!juge.session_id) return 'out-judge.json sans session_id : appel non attribuable'
    const sessions = BRAS.map((b) => sorties[b]?.session_id)
    const i = sessions.indexOf(juge.session_id)
    return i >= 0 ? `le juge partage la session du bras ${BRAS[i]}` : true
  })

  ajoute('P10', 'Tableau de sortie au format impose (8 colonnes)', () => {
    const attendues = ['bras', 'workflow', 'critère', '$', 'min', 'tours', 'défauts', 'verdict']
    const entete = lignesTableau(md).find((l) => /^bras$/i.test(l[0]))
    if (!entete) return 'aucune ligne d_entete commencant par `bras`'
    const manque = attendues.filter((a) => !entete.some((c) => c.toLowerCase().includes(a)))
    return manque.length ? `colonnes manquantes : ${manque.join(', ')}` : true
  })

  ajoute('P11', 'Ligne Discrimination presente, et 4/4 declare NON DISCRIMINANT', () => {
    if (!/discrimin/i.test(md))
      return 'aucune ligne Discrimination : on ne sait pas si le banc departage'
    const m =
      /discrimin\w*[^\n]{0,60}?([0-4])\s*\/\s*4|([0-4])\s*\/\s*4[^\n]{0,60}?discrimin/i.exec(md)
    const n = m ? Number(m[1] ?? m[2]) : null
    if (n === null) return 'mention Discrimination sans compte n/4'
    if (n === 4 && !/NON DISCRIMINANT/i.test(md))
      return '4/4 bras ont passe le critere sans mention NON DISCRIMINANT : le gagnant est une piste, pas une mesure'
    return true
  })

  ajoute('P12', 'Lecon retenue avec ses chiffres mesures', () => {
    if (!/AUTOWIN_LESSON_V1|remember/i.test(md))
      return 'aucune lecon ecrite (AUTOWIN_LESSON_V1 / remember)'
    return /\d+[.,]\d+\s*\\?\$|\\?\$\s*\d+[.,]\d+/.test(md)
      ? true
      : 'lecon sans chiffre mesure ($ ou minutes)'
  })

  ajoute('P13', 'Copies de travail perdantes retirees du disque', () => {
    if (!lancement) return 'aucun script de lancement trouve dans le banc'
    const racines = [...lancement.texte.matchAll(/["']([A-Za-z]:[\\/][^"'\n]*?)["']/g)]
      .map((m) => m[1])
      .filter((p) => !path.resolve(p).startsWith(path.resolve(bench)))
    const restantes = racines.filter((p) => existsSync(p) && statSync(p).isDirectory())
    return restantes.length ? `encore sur disque : ${restantes.join(', ')}` : true
  })

  const jugements = [
    'X est-il VRAIMENT une premisse cassee, ou une variante de B ? (lecture humaine des workflows)',
    'Un bras a-t-il reformule la tache malgre un enonce identique ? (lecture des livrables)',
    'Qualite reelle des livrables et dette laissee — dimension 2 de la grille du juge.',
    'Reproductibilite hors de cette tache : un seul banc = un seul point de mesure.'
  ]
  return { points, jugements, ok: points.every((p) => p.ok) }
}

const estCLI = process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))
if (estCLI) {
  const arg = (n) => {
    const i = process.argv.indexOf(n)
    return i > 0 ? process.argv[i + 1] : undefined
  }
  const run = arg('--run')
  const bench = arg('--bench')
  if (!run || !bench) {
    console.error(
      'Usage : node scripts/arena-protocole-check.mjs --run <RUN.md> --bench <dossier> [--json]'
    )
    process.exit(2)
  }
  const res = verifierProtocole({ run, bench })
  if (res.erreur) {
    console.error(res.erreur)
    process.exit(2)
  }
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(res, null, 2))
  } else {
    for (const p of res.points)
      console.log(`${p.ok ? 'OK  ' : 'RATE'} ${p.id} ${p.nom} — ${p.detail}`)
    console.log('\nNON MECANISABLE (jugement humain, aucun script ne tranche) :')
    for (const j of res.jugements) console.log(`  - ${j}`)
    console.log(res.ok ? '\nPROTOCOLE TENU' : '\nPROTOCOLE NON TENU')
  }
  process.exit(res.ok ? 0 : 1)
}
