#!/usr/bin/env node
/**
 * poids-du-contexte — QUOI remplit le contexte que chaque étape d'un agent Claude relit ?
 *
 * Une étape (un appel au modèle) relit TOUT le contexte : consignes, outils, puis chaque sortie
 * d'outil et chaque réponse déjà entrées. Un bloc entré tôt se paie donc à chaque étape suivante.
 * Ce script mesure, sur les sorties brutes enregistrées (`run-stdout/*.stdout.jsonl`), la part de
 * chaque type de contenu (Read, Bash, Grep, outils Autowin, texte, réflexion…) dans ce contexte
 * relu : taille du bloc × nombre d'étapes qui le relisent. C'est la méthode du test de JetBrains
 * (https://blog.jetbrains.com/ai/2026/07/rtk-claude-code-token-savings/) : calculer le gain
 * MAXIMAL d'une prise avant de la payer — rtk promettait −80 % et a coûté +7,6 %.
 *
 * Calibrage : la taille réelle de ce qui entre entre deux étapes est connue (écart des compteurs
 * `input + cache_creation + cache_read` du modèle). Elle est répartie sur les blocs visibles de
 * l'intervalle au prorata de leurs caractères : les rappels invisibles ajoutés par le CLI ou les
 * hooks se retrouvent donc dans le bloc qu'ils accompagnent. La réflexion est comptée : mesuré le
 * 2026-11-08 sur 80 sessions, la compter rend le même rapport caractères/token (1,74) que les
 * intervalles sans réflexion (1,90) ; l'exclure le fait tomber à 1,27.
 *
 * Dollars : au prix officiel du modèle de chaque session (`PRIX`). Un bloc est écrit en mémoire
 * de relecture (cache) à sa première lecture, puis relu au prix de relecture à chaque étape
 * suivante ; le socle prend le partage réel de sa première étape. Ce que le modèle écrit (sortie)
 * forme sa propre ligne. Contrôle : sur les sessions non reprises, le calcul retrouve la facture
 * du CLI (mesuré le 2026-11-08 : Opus et Sonnet à l'identique, Haiku à 0,2 % près).
 *
 * Lecture seule. Usage :
 *   node scripts/poids-du-contexte.mjs [--data <dossier>] [--derniers N | --tous]
 *        [--depuis YYYY-MM-DD] [--seuil-lignes 350] [--json]
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const SOCLE = 'socle de départ'
export const COMPACTION = 'résumé de compaction'

/** Rangement d'un outil dans un type de contenu. */
export function categorieOutil(nom) {
  const n = String(nom || '')
  if (n === 'Read') return 'Read'
  if (/^(Bash|PowerShell|Monitor|BashOutput|KillShell|KillBash)$/.test(n))
    return 'Bash / PowerShell'
  if (/^(Grep|Glob)$/.test(n)) return 'Grep / Glob'
  if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(n)) return 'Edit / Write'
  if (n.startsWith('mcp__autowin__')) return 'outils Autowin'
  if (n.startsWith('mcp__')) return 'autres outils MCP'
  if (/^(Task|Agent)$/.test(n)) return 'sous-agents'
  if (/^(WebFetch|WebSearch)$/.test(n)) return 'Web'
  return 'autres outils'
}

/**
 * Ce que fait une commande du terminal, d'après son premier mot utile (après `cd …&&`, `timeout N`).
 * Mesuré le 2026-11-08 sur 490 sessions : grep 923, sed 819, cat 230 appels — le terminal sert
 * surtout à LIRE, et une prise qui ne viserait que l'outil Read en raterait l'essentiel.
 */
const commandeUtile = (commande) =>
  String(commande || '')
    .trim()
    .replace(/^(cd\s+("[^"]*"|'[^']*'|[^;&|]+)\s*(&&|;)\s*)+/, '')
    .replace(/^timeout\s+\d+\s+/, '')

export function familleCommande(commande) {
  const c = commandeUtile(commande)
  const mot = c.split(/\s+/)[0] || ''
  if (
    /^(cat|head|tail|nl|less|more|type|Get-Content|gc)$/i.test(mot) ||
    /^sed\s+-n\b/.test(c) ||
    /^awk\b/.test(c)
  )
    return 'lecture de fichier'
  if (/^(grep|rg|find|ls|dir|Select-String|Get-ChildItem|wc|tree)$/i.test(mot)) return 'recherche'
  if (/^git$/.test(mot)) return 'git'
  if (
    /^(npx|npm|pnpm|yarn|vitest|tsc|eslint)$/.test(mot) ||
    /^node\s+\S*(vitest|tsc|eslint)/.test(c)
  )
    return 'tests et build'
  return 'autres'
}

/**
 * Lecture ENTIÈRE par le terminal : `cat fichier` ou `Get-Content fichier`, sans tube ni coupe
 * (`-TotalCount`, `-Head`, `-Tail` de PowerShell lisent un passage).
 */
export function lectureEntiereParCommande(commande) {
  const c = commandeUtile(commande)
  return (
    /^(cat|type|Get-Content|gc)$/i.test(c.split(/\s+/)[0] || '') &&
    !/[|]/.test(c) &&
    !/\s-(TotalCount|Head|Tail|First|Last)\b/i.test(c)
  )
}

const texteDuResultat = (contenu) => {
  if (typeof contenu === 'string') return { texte: contenu, images: 0 }
  let texte = ''
  let images = 0
  for (const c of Array.isArray(contenu) ? contenu : []) {
    if (c && c.type === 'text') texte += c.text || ''
    else if (c && c.type === 'image') images++
  }
  return { texte, images }
}

// Une image compte pour environ 1 600 tokens (doc Anthropic, image de 1092×1092) ; ramenée en
// caractères au rapport mesuré, pour entrer dans le même prorata que le texte.
const CARACTERES_PAR_IMAGE = 1600 * 1.9

/**
 * Prix en dollars par million de tokens : entrée, écriture en mémoire de relecture 5 min et 1 h,
 * relecture, sortie. Recopiés de https://platform.claude.com/docs/en/about-claude/pricing, lu le
 * 2026-11-08. La relecture n'y vaut pas toujours ×0,1 de l'entrée : ×0,05 chez Opus et Sonnet 5.5.
 * Haiku 5.5 paie ×5 sur toute requête dont le contexte dépasse 100 000 tokens, mémoire comprise.
 * Un modèle absent d'ici n'a pas de dollars : ses sessions restent comptées en tokens.
 */
export const PRIX = {
  'claude-opus-5-5': [4, 5, 8, 0.2, 20],
  'claude-opus-5': [5, 6.25, 10, 0.5, 25],
  'claude-sonnet-5-5': [2, 2.5, 4, 0.1, 10],
  'claude-sonnet-5': [2, 2.5, 4, 0.2, 10],
  'claude-haiku-5-5': [0.1, 0.125, 0.2, 0.01, 0.5],
  'claude-fable-5-1': [10, 12.5, 20, 0.25, 50],
  'claude-fable-5': [10, 12.5, 20, 1, 50]
}
const SEUIL_LONG_HAIKU = 100000

const prixDuModele = (modele) => {
  const nom = String(modele || '').replace(/\[.*\]$/, '')
  const p = PRIX[nom] || PRIX[nom.replace(/-\d{8}$/, '')]
  if (!p) return undefined
  const [entree, ecriture5, ecriture1h, relecture, sortie] = p.map((x) => x / 1e6)
  const long = nom.startsWith('claude-haiku-5-5')
  return {
    entree,
    ecriture5,
    ecriture1h,
    relecture,
    sortie,
    multiplicateur: (ctx) => (long && ctx > SEUIL_LONG_HAIKU ? 5 : 1)
  }
}

/**
 * Analyse UNE session (les lignes brutes d'un fichier stdout). Rend `undefined` si le fichier n'est
 * pas une session Claude (Codex, Grok, prompt brut…) ou n'a aucune étape.
 * Seule la chaîne principale compte : un sous-agent a son propre contexte.
 */
export function analyserSession(lignes) {
  const etapes = [] // { id, ctx, uneHeure }
  const blocs = [] // { categorie, outil, car, tokens, debut, fin, lignes, entier }
  const appels = new Map() // tool_use_id → { nom, input }
  let enAttente = [] // blocs entrés depuis la dernière étape, pas encore calibrés
  let vivants = [] // blocs encore dans le contexte
  let compactions = 0
  let retrecissements = 0
  let session = false
  let debutMs
  let finMs
  let modele
  let factureLocale
  let sortie = 0

  const fermer = (bs, fin) => {
    for (const b of bs) if (b.fin === undefined) b.fin = fin
  }

  for (const l of lignes) {
    if (!l || l[0] !== '{' || l.startsWith('{"type":"stream_event')) continue
    let j
    try {
      j = JSON.parse(l)
    } catch {
      continue
    }
    if (j.type === 'system' && j.subtype === 'init') session = true
    // Le bilan du CLI en fin de session. Ses tokens ET son coût (`modelUsage`, `total_cost_usd`)
    // sont CUMULÉS sur toute la conversation reprise (mesuré le 2026-11-08 : 72 M tokens relus au
    // bilan pour 459 000 dans ce passage) : ils ne mesurent pas la session. Seule la sortie
    // (`usage`) est locale. Quand la session n'a PAS été reprise, bilan et passage coïncident :
    // son coût devient le contrôle indépendant du calcul en dollars ci-dessous.
    if (j.type === 'result' && j.usage) {
      sortie = j.usage.output_tokens || 0
      const bilan = Object.values(j.modelUsage || {})
      if (
        bilan.length === 1 &&
        typeof bilan[0].costUSD === 'number' &&
        bilan[0].cacheReadInputTokens === j.usage.cache_read_input_tokens &&
        bilan[0].outputTokens === j.usage.output_tokens
      )
        factureLocale = bilan[0].costUSD
    }
    if (j.parent_tool_use_id) continue
    const quand = j.timestamp ? Date.parse(j.timestamp) : NaN
    if (Number.isFinite(quand)) {
      if (!(quand >= debutMs)) debutMs = quand
      if (!(quand <= finMs)) finMs = quand
    }
    if (j.type === 'assistant' && j.message && j.message.usage) {
      const m = j.message
      const u = m.usage
      if (!modele && m.model && m.model !== '<synthetic>') modele = m.model
      if (!etapes.length || etapes[etapes.length - 1].id !== m.id) {
        const ctx =
          (u.input_tokens || 0) +
          (u.cache_creation_input_tokens || 0) +
          (u.cache_read_input_tokens || 0)
        const cc = u.cache_creation || {}
        const uneHeureTokens = cc.ephemeral_1h_input_tokens || 0
        const uneHeure = uneHeureTokens > 0
        const k = etapes.length
        if (k === 0) {
          const socle = {
            categorie: SOCLE,
            outil: '',
            car: 0,
            tokens: ctx,
            debut: 0,
            entreeReelle: true
          }
          blocs.push(socle)
          vivants = [socle]
        } else {
          const delta = ctx - etapes[k - 1].ctx
          // Le contexte a fondu : le CLI a résumé l'historique. Les anciens blocs ne sont plus relus.
          if (delta < 0 && ctx < etapes[k - 1].ctx * 0.8) {
            compactions++
            fermer(vivants, k - 1)
            for (const b of enAttente) b.fin = k - 1
            const resume = {
              categorie: COMPACTION,
              outil: '',
              car: 0,
              tokens: ctx,
              debut: k,
              entreeReelle: true
            }
            blocs.push(resume)
            vivants = [resume]
            enAttente = []
          } else {
            // Un contexte qui rétrécit sans être résumé (effacement côté API) : compté pour être vu.
            if (delta < 0) retrecissements++
            const car = enAttente.reduce((s, b) => s + b.car, 0)
            const reel = Math.max(0, delta)
            if (car > 0) {
              for (const b of enAttente) b.tokens = (reel * b.car) / car
            } else if (reel > 0) {
              const b = { categorie: 'non attribué', outil: '', car: 0, tokens: reel, debut: k }
              blocs.push(b)
              enAttente.push(b)
            }
            for (const b of enAttente) b.debut = k
            vivants.push(...enAttente)
            enAttente = []
          }
        }
        etapes.push({
          id: m.id,
          ctx,
          uneHeure,
          entree: u.input_tokens || 0,
          ecriture1h: uneHeureTokens,
          ecriture5: Math.max(0, (u.cache_creation_input_tokens || 0) - uneHeureTokens),
          relecture: u.cache_read_input_tokens || 0
        })
      }
      for (const c of m.content || []) {
        let b
        if (c.type === 'text')
          b = { categorie: "texte de l'agent", outil: '', car: (c.text || '').length }
        else if (c.type === 'thinking')
          b = { categorie: 'réflexion', outil: '', car: (c.thinking || '').length }
        else if (c.type === 'tool_use') {
          appels.set(c.id, { nom: c.name, input: c.input || {} })
          b = {
            categorie: categorieOutil(c.name),
            outil: c.name,
            car: JSON.stringify(c.input || {}).length + String(c.name || '').length
          }
          if (b.categorie === 'Bash / PowerShell')
            b.famille = familleCommande(c.input && c.input.command)
        }
        if (b && b.car > 0) {
          b.tokens = 0
          blocs.push(b)
          enAttente.push(b)
        }
      }
    } else if (j.type === 'user' && j.message) {
      const contenu = j.message.content
      if (typeof contenu === 'string') {
        const b = { categorie: 'autres messages', outil: '', car: contenu.length, tokens: 0 }
        blocs.push(b)
        enAttente.push(b)
        continue
      }
      for (const c of Array.isArray(contenu) ? contenu : []) {
        let b
        if (c.type === 'tool_result') {
          const appel = appels.get(c.tool_use_id) || { nom: '', input: {} }
          const { texte, images } = texteDuResultat(c.content)
          b = {
            categorie: categorieOutil(appel.nom),
            outil: appel.nom,
            car: texte.length + images * CARACTERES_PAR_IMAGE,
            sortie: true
          }
          const lignesRendues = texte ? texte.split('\n').length : 0
          if (appel.nom === 'Read' && !c.is_error) {
            b.lecture = 'Read'
            b.lignes = lignesRendues
            b.entier = appel.input.offset === undefined && appel.input.limit === undefined
          } else if (b.categorie === 'Bash / PowerShell') {
            b.famille = familleCommande(appel.input.command)
            b.lignes = lignesRendues
            if (b.famille === 'lecture de fichier' && !c.is_error) {
              b.lecture = 'terminal'
              b.entier = lectureEntiereParCommande(appel.input.command)
            }
          }
        } else if (c.type === 'text')
          b = { categorie: 'autres messages', outil: '', car: (c.text || '').length }
        if (b && b.car > 0) {
          b.tokens = 0
          blocs.push(b)
          enAttente.push(b)
        }
      }
    }
  }
  if (!session || !etapes.length) return undefined
  const derniere = etapes.length - 1
  fermer(vivants, derniere)
  // Ce qui est entré après la dernière étape n'a été relu par personne.
  const relus = blocs.filter(
    (b) => b.debut !== undefined && b.fin !== undefined && b.fin >= b.debut
  )
  for (const b of relus) b.relectures = b.fin - b.debut + 1
  const contexteRelu = etapes.reduce((s, e) => s + e.ctx, 0)

  // DOLLARS, au prix du modèle de la session. Ce que chaque étape a payé pour lire se calcule
  // exactement depuis ses compteurs ; un bloc, lui, est écrit en mémoire à sa première lecture
  // puis relu au prix de relecture — sauf le socle et le résumé, qui prennent le partage réel
  // de leur étape (une partie y est déjà en mémoire depuis les sessions d'avant).
  const prix = prixDuModele(modele)
  let etapesUsd
  let sortieUsd
  if (prix) {
    const mult = etapes.map((e) => prix.multiplicateur(e.ctx))
    const payeEtape = etapes.map(
      (e, k) =>
        (e.entree * prix.entree +
          e.ecriture5 * prix.ecriture5 +
          e.ecriture1h * prix.ecriture1h +
          e.relecture * prix.relecture) *
        mult[k]
    )
    etapesUsd = payeEtape.reduce((s, x) => s + x, 0)
    // Relectures cumulées : multRelu[k] = somme des multiplicateurs des étapes 0..k-1.
    const multRelu = [0]
    for (const m of mult) multRelu.push(multRelu[multRelu.length - 1] + m)
    const ecriture = etapes.some((e) => e.uneHeure) ? prix.ecriture1h : prix.ecriture5
    for (const b of relus) {
      const premiere = b.entreeReelle ? payeEtape[b.debut] : b.tokens * ecriture * mult[b.debut]
      const suivantes = b.tokens * prix.relecture * (multRelu[b.fin + 1] - multRelu[b.debut + 1])
      b.usd = premiere + suivantes
    }
    // Les tokens écrits par le modèle ne sont comptés qu'au total de la session : leur palier
    // Haiku est pris à la moyenne des étapes.
    const multMoyen = mult.reduce((s, m) => s + m, 0) / mult.length
    sortieUsd = sortie * prix.sortie * multMoyen
  }
  return {
    etapes: etapes.length,
    compactions,
    retrecissements,
    contexteRelu,
    debutMs,
    finMs,
    modele,
    // Facturé par le CLI pour une session non reprise : contrôle de etapesUsd + sortieUsd.
    factureLocale,
    sortie,
    etapesUsd,
    sortieUsd,
    blocs: relus
  }
}

const quantile = (valeurs, f) => {
  const trie = [...valeurs].sort((x, y) => x - y)
  return trie.length ? trie[Math.min(trie.length - 1, Math.floor(trie.length * f))] : 0
}

export const SORTIE = 'écrit par le modèle (sortie)'

/** Agrège des sessions analysées en un tableau par type de contenu, plus le détail des lectures. */
export function agreger(sessions, seuilLignes = 350) {
  const parType = new Map()
  const parOutil = new Map()
  const parFamille = new Map()
  const modeles = {}
  let relu = 0
  let mesureRelu = 0
  let etapes = 0
  let compactions = 0
  let retrecissements = 0
  let sansPrix = 0
  let usdBlocs = 0
  let usdEtapes = 0
  let usdSortie = 0
  let sortieTokens = 0
  const grille = {}
  let debutMs
  let finMs
  const vide = () => ({
    total: 0,
    entieres: 0,
    grosses: 0,
    usdGrosses: 0,
    usdToutes: 0,
    lignes: []
  })
  const lectures = { Read: vide(), terminal: vide() }
  const sortiesLongues = { nombre: 0, usd: 0 }
  const socles = []
  const cumuler = (m, cle, entres, r, usd) => {
    const x = m.get(cle) || { nom: cle, entres: 0, relu: 0, usd: 0 }
    x.entres += entres
    x.relu += r
    x.usd += usd
    m.set(cle, x)
  }
  for (const s of sessions) {
    etapes += s.etapes
    compactions += s.compactions
    retrecissements += s.retrecissements || 0
    mesureRelu += s.contexteRelu
    modeles[s.modele || '?'] = (modeles[s.modele || '?'] || 0) + 1
    const socle = s.blocs.find((b) => b.categorie === SOCLE)
    if (socle) socles.push(socle.tokens)
    if (s.debutMs !== undefined && !(s.debutMs >= debutMs)) debutMs = s.debutMs
    if (s.finMs !== undefined && !(s.finMs <= finMs)) finMs = s.finMs
    const avecPrix = s.etapesUsd !== undefined
    if (avecPrix) {
      usdEtapes += s.etapesUsd
      usdSortie += s.sortieUsd
      sortieTokens += s.sortie
    } else sansPrix++
    if (avecPrix && typeof s.factureLocale === 'number') {
      const x = grille[s.modele] || { calcule: 0, facture: 0, sessions: 0 }
      x.calcule += s.etapesUsd + s.sortieUsd
      x.facture += s.factureLocale
      x.sessions++
      grille[s.modele] = x
    }
    for (const b of s.blocs) {
      const r = b.tokens * b.relectures
      const usd = avecPrix ? b.usd : 0
      relu += r
      usdBlocs += usd
      cumuler(parType, b.categorie, b.tokens, r, usd)
      if (b.outil) cumuler(parOutil, b.outil, b.tokens, r, usd)
      if (b.famille) cumuler(parFamille, b.famille, b.tokens, r, usd)
      if (b.sortie && b.famille && b.lignes > seuilLignes) {
        sortiesLongues.nombre++
        sortiesLongues.usd += usd
      }
      const l = b.lecture && lectures[b.lecture]
      if (l) {
        l.total++
        l.lignes.push(b.lignes)
        l.usdToutes += usd
        if (b.entier) l.entieres++
        if (b.entier && b.lignes > seuilLignes) {
          l.grosses++
          l.usdGrosses += usd
        }
      }
    }
  }
  if (usdSortie > 0) cumuler(parType, SORTIE, sortieTokens, 0, usdSortie)
  const usd = usdBlocs + usdSortie
  const part = (x) => (usd ? x / usd : 0)
  const parts = (m) =>
    [...m.values()]
      .map((x) => ({ ...x, partRelu: relu ? x.relu / relu : 0, partUsd: part(x.usd) }))
      .sort((x, y) => y.usd - x.usd || y.relu - x.relu)
  const resume = (l) => ({
    total: l.total,
    entieres: l.entieres,
    grosses: l.grosses,
    partUsdGrosses: part(l.usdGrosses),
    partUsdToutes: part(l.usdToutes),
    medianeLignes: quantile(l.lignes, 0.5),
    p90Lignes: quantile(l.lignes, 0.9)
  })
  return {
    sessions: sessions.length,
    modeles,
    etapes,
    compactions,
    retrecissements,
    debut: debutMs !== undefined ? new Date(debutMs).toISOString() : undefined,
    fin: finMs !== undefined ? new Date(finMs).toISOString() : undefined,
    relu,
    // Contrôle de la répartition : somme des contextes relus d'après les compteurs du modèle.
    // L'égalité découle de la construction (chaque écart est réparti en entier) : elle prouve
    // qu'aucun bloc n'est perdu ni compté deux fois, pas que la répartition par type est juste.
    mesureRelu,
    usd,
    // Contrôles des dollars : (1) les blocs se partagent ce que les étapes ont payé pour lire ;
    // (2) sur les sessions non reprises, le calcul retrouve ce que le CLI a facturé.
    controleUsd: {
      blocs: usdBlocs,
      etapes: usdEtapes,
      grille,
      sansPrix
    },
    seuilLignes,
    socle: { mediane: quantile(socles, 0.5), p90: quantile(socles, 0.9) },
    types: parts(parType),
    outils: parts(parOutil),
    terminal: parts(parFamille),
    lectures: { Read: resume(lectures.Read), terminal: resume(lectures.terminal) },
    sortiesLongues: { nombre: sortiesLongues.nombre, partUsd: part(sortiesLongues.usd) }
  }
}

const pct = (x) => `${(x * 100).toFixed(1).replace('.', ',')} %`
const milliers = (x) => Math.round(x).toLocaleString('fr-FR')
const dollars = (x) => `${x.toFixed(2).replace('.', ',')} $`
const jour = (iso) => (iso ? iso.slice(0, 16).replace('T', ' ') : '?')
const ecart = (a, b) => (b ? pct(Math.abs(a - b) / b) : '?')

/** Rapport Markdown, lisible sans connaître la mécanique. */
export function rapport(a) {
  const l = []
  const n = a.seuilLignes
  const c = a.controleUsd
  const modeles = Object.entries(a.modeles)
    .sort((x, y) => y[1] - x[1])
    .map(([m, k]) => `${m} ${k}`)
    .join(', ')
  const grilleTexte = Object.entries(c.grille)
    .map(
      ([m, g]) =>
        `${m} (${g.sessions} sessions) ${dollars(g.calcule)} pour ${dollars(g.facture)}, écart ${ecart(g.calcule, g.facture)}`
    )
    .join(', ')
  l.push(`# Ce qui remplit le contexte relu — ${a.sessions} sessions, ${milliers(a.etapes)} étapes`)
  l.push('')
  l.push(`Période : du ${jour(a.debut)} au ${jour(a.fin)} (UTC). Modèles : ${modeles}.`)
  l.push(
    `Socle de départ (consignes, définitions d'outils, historique repris, message) : médiane **${milliers(a.socle.mediane)} tokens** par session, 9 sur 10 sous ${milliers(a.socle.p90)}.`
  )
  l.push(
    `Contexte relu : **${milliers(a.relu)} tokens** (compteurs du modèle : ${milliers(a.mesureRelu)}). Compactions : ${a.compactions}, rétrécissements sans résumé : ${a.retrecissements}.`
  )
  l.push(
    `Coût calculé : **${dollars(a.usd)}**. Contrôles : sur les sessions non reprises, le calcul retrouve la facture du CLI — ${grilleTexte || 'aucune session'} ; les blocs se partagent ${dollars(c.blocs)} des ${dollars(c.etapes)} payés pour lire (écart ${ecart(c.blocs, c.etapes)}).${c.sansPrix ? ` ${c.sansPrix} sessions d'un modèle sans prix connu : comptées en tokens seulement.` : ''}`
  )
  l.push('')
  l.push('| Type de contenu | Tokens entrés | Tokens relus | Part relue | Part des dollars |')
  l.push('|---|---:|---:|---:|---:|')
  for (const t of a.types) {
    l.push(
      `| ${t.nom} | ${milliers(t.entres)} | ${milliers(t.relu)} | ${pct(t.partRelu)} | **${pct(t.partUsd)}** |`
    )
  }
  l.push('')
  l.push('## Le terminal, par usage (appel et sortie)')
  l.push('')
  for (const f of a.terminal) l.push(`- ${f.nom} : **${pct(f.partUsd)}** des dollars`)
  l.push('')
  l.push('## Outils qui coûtent le plus')
  l.push('')
  for (const o of a.outils.slice(0, 8)) l.push(`- \`${o.nom}\` : ${pct(o.partUsd)}`)
  l.push('')
  l.push('## Lectures de fichier')
  l.push('')
  const sources = [
    ['outil Read', a.lectures.Read],
    ['terminal (cat, sed -n, head…)', a.lectures.terminal]
  ]
  for (const [nom, r] of sources) {
    l.push(
      `- ${nom} : ${r.total} lectures (${pct(r.partUsdToutes)} des dollars), ${r.entieres} du fichier entier ; lignes rendues : médiane ${r.medianeLignes}, 9 sur 10 sous ${r.p90Lignes}. Entières de plus de ${n} lignes : **${r.grosses}**, ${pct(r.partUsdGrosses)} des dollars.`
    )
  }
  l.push(
    `- Sorties de terminal de plus de ${n} lignes, tous usages : **${a.sortiesLongues.nombre}**, ${pct(a.sortiesLongues.partUsd)} des dollars.`
  )
  l.push('')
  l.push('## Gain maximal par prise (méthode JetBrains : part des dollars × réduction promise)')
  l.push('')
  const partDe = (nom) => (a.types.find((t) => t.nom === nom) || { partUsd: 0 }).partUsd
  const { Read, terminal } = a.lectures
  const bas = (Read.partUsdGrosses + terminal.partUsdGrosses) * 0.9
  const haut = (Read.partUsdToutes + terminal.partUsdToutes) * 0.9
  l.push(
    `- Confier à un lecteur moins cher les grosses lectures (−90 %, shunt) : **${pct(bas)}** pour les lectures entières de plus de ${n} lignes, **${pct(haut)}** au plus si TOUTES les lectures passaient par lui — avant le coût du lecteur et des étapes en plus. Les lectures des tours précédents d'un fil repris sont dans le socle, hors de ce compte.`
  )
  l.push(
    `- Compresser de 70 % toutes les sorties du terminal (rtk) : au plus **${pct(partDe('Bash / PowerShell') * 0.7)}**.`
  )
  l.push(
    `- Raccourcir de 65 % le texte de l'agent (caveman) : au plus **${pct(partDe("texte de l'agent") * 0.65)}** relu, plus sa part de la sortie.`
  )
  l.push(
    `- Alléger de 30 % le socle de départ (consignes, outils, historique repris) : au plus **${pct(partDe(SOCLE) * 0.3)}**.`
  )
  return l.join('\n')
}

function fichiersDeSortie(dossier, { derniers, depuisMs }) {
  let fichiers = []
  try {
    fichiers = fs
      .readdirSync(dossier)
      .filter((f) => f.endsWith('.stdout.jsonl'))
      .map((f) => {
        const p = path.join(dossier, f)
        return { p, t: fs.statSync(p).mtimeMs }
      })
  } catch {
    return []
  }
  if (depuisMs) fichiers = fichiers.filter((f) => f.t >= depuisMs)
  fichiers.sort((a, b) => b.t - a.t)
  return (derniers ? fichiers.slice(0, derniers) : fichiers).map((f) => f.p)
}

async function principal() {
  const args = process.argv.slice(2)
  const opt = (nom, defaut) => {
    const i = args.indexOf(nom)
    return i >= 0 && args[i + 1] ? args[i + 1] : defaut
  }
  const data = path.resolve(opt('--data', 'D:/AutoWinOS/.autowin-data/autowin-os'))
  const depuis = opt('--depuis', '')
  const depuisMs = depuis ? Date.parse(`${depuis}T00:00:00`) : 0
  if (depuis && !Number.isFinite(depuisMs)) {
    console.error(`--depuis attend une date YYYY-MM-DD, reçu : ${depuis}`)
    process.exit(2)
  }
  const derniers = args.includes('--tous') ? 0 : Number(opt('--derniers', '300'))
  const seuil = Number(opt('--seuil-lignes', '350'))
  const fichiers = fichiersDeSortie(path.join(data, 'run-stdout'), { derniers, depuisMs })
  const sessions = []
  for (const f of fichiers) {
    let texte
    try {
      texte = fs.readFileSync(f, 'utf8')
    } catch {
      continue
    }
    const s = analyserSession(texte.split('\n'))
    if (s) sessions.push(s)
  }
  if (!sessions.length) {
    console.error(
      `Aucune session Claude lisible dans ${path.join(data, 'run-stdout')} (${fichiers.length} fichiers lus).`
    )
    process.exit(1)
  }
  const a = agreger(sessions, seuil)
  console.log(args.includes('--json') ? JSON.stringify(a, null, 2) : rapport(a))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await principal()
