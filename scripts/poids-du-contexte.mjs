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
 * l'intervalle : la réflexion à ses tokens exacts (lus en fin de message), le reste au prorata des
 * caractères — les rappels invisibles ajoutés par le CLI ou les hooks se retrouvent donc dans le
 * bloc qu'ils accompagnent.
 *
 * Dollars : au prix officiel du modèle de chaque session (`PRIX`). Un bloc est écrit en mémoire
 * de relecture (cache) à sa première lecture, puis relu au prix de relecture à chaque étape
 * suivante ; le socle prend le partage réel de sa première étape. Ce que le modèle écrit (sortie)
 * forme sa propre ligne. Contrôle : sur chaque session qui a un bilan, le calcul retrouve la facture
 * du CLI (mesuré le 2026-11-08 sur 95 % des dollars : écart de 0,0 à 0,4 % selon le modèle).
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
// caractères au rapport mesuré hors réflexion (1,9 par token), pour entrer dans le même prorata.
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
  const bilans = [] // { local, cumul } de chaque `result`
  let sortie = 0
  let finsOrphelines = 0
  let lignesIllisibles = 0
  let reflexionsPlafonnees = 0

  const fermer = (bs, fin) => {
    for (const b of bs) if (b.fin === undefined) b.fin = fin
  }

  for (const l of lignes) {
    if (!l || l[0] !== '{') continue
    // Du flux, seule la fin de message compte : elle porte la sortie EXACTE de l'étape et sa part
    // de réflexion (mesuré le 2026-11-08 : leur somme égale le total du bilan dans 503 sessions sur
    // 504 ; les événements `assistant`, eux, n'en portent qu'un début). Elle se rattache à son étape
    // par l'identifiant du message, jamais par sa place.
    if (l.startsWith('{"type":"stream_event')) {
      if (!l.includes('"message_delta"')) continue
      try {
        const e = JSON.parse(l)
        if (e.parent_tool_use_id || !e.event || e.event.type !== 'message_delta' || !e.event.usage)
          continue
        const etape = etapes.length ? etapes[etapes.length - 1] : undefined
        if (!etape || etape.id !== e.api_message_id) {
          finsOrphelines++
          continue
        }
        etape.sortie = e.event.usage.output_tokens || 0
        const detail = e.event.usage.output_tokens_details || {}
        etape.reflexion = Math.min(etape.sortie, detail.thinking_tokens || 0)
      } catch {
        finsOrphelines++
      }
      continue
    }
    let j
    try {
      j = JSON.parse(l)
    } catch {
      // Souvent la dernière ligne d'un processus tué : comptée, jamais devinée.
      lignesIllisibles++
      continue
    }
    if (j.type === 'system' && j.subtype === 'init') session = true
    // Le bilan du CLI (un par tour, parfois plusieurs par fichier). `modelUsage` et
    // `total_cost_usd` sont CUMULÉS sur toute la conversation reprise (mesuré le 2026-11-08 :
    // 72 M tokens relus au bilan pour 459 000 dans ce passage) ; `model_usage_since_last_result`
    // est LOCAL au tour. Son coût est le contrôle indépendant du calcul en dollars ci-dessous, et
    // l'écart entre les deux dit si le fil a été repris.
    if (j.type === 'result' && j.usage) {
      sortie += j.usage.output_tokens || 0
      bilans.push({ local: j.model_usage_since_last_result || {}, cumul: j.modelUsage || {} })
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
            const reel = Math.max(0, delta)
            // La réflexion de l'étape d'avant pèse ses tokens EXACTS, lus en fin de message : le texte
            // enregistré n'en est qu'un résumé. Mesuré le 2026-11-08 sur 5 809 intervalles : ainsi
            // comptée, le reste retombe à 1,92 caractère par token, comme les intervalles sans
            // réflexion (1,88) ; comptée par son résumé, il tombe à 1,70. Le reste se répartit au
            // prorata des caractères.
            const precedente = etapes[k - 1]
            let aPartager = enAttente
            let reste = reel
            if (precedente.reflexion !== undefined) {
              const pensees = enAttente.filter((b) => b.categorie === 'réflexion')
              aPartager = enAttente.filter((b) => b.categorie !== 'réflexion')
              // Une réflexion plus grosse que l'écart réel ne laisse rien aux autres blocs : comptée.
              if (precedente.reflexion > reel) reflexionsPlafonnees++
              const exacte = Math.min(precedente.reflexion, reel)
              if (exacte > 0 && !pensees.length) {
                const b = { categorie: 'réflexion', outil: '', car: 0, tokens: 0 }
                blocs.push(b)
                enAttente.push(b)
                pensees.push(b)
              }
              const carPensees = pensees.reduce((s, b) => s + b.car, 0)
              for (const b of pensees)
                b.tokens = carPensees ? (exacte * b.car) / carPensees : exacte / pensees.length
              reste = reel - exacte
            }
            const car = aPartager.reduce((s, b) => s + b.car, 0)
            if (car > 0) {
              for (const b of aPartager) b.tokens = (reste * b.car) / car
            } else if (reste > 0) {
              const b = { categorie: 'non attribué', outil: '', car: 0, tokens: reste }
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
          b.etape = etapes.length - 1
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
  const sortieParType = {}
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
    // SORTIE, étape par étape, au palier de son étape. La réflexion y a son compte EXACT (fin de
    // message) ; le reste se partage entre texte et appels d'outils au prorata des caractères —
    // une ESTIMATION. Ce qu'aucune fin de message n'a porté (étape coupée) reste « non attribuée »,
    // pris sur le total du bilan au palier moyen.
    const ajouter = (type, usd) => {
      if (usd > 0) sortieParType[type] = (sortieParType[type] || 0) + usd
    }
    const parEtape = new Map()
    for (const b of blocs) {
      if (b.etape === undefined || b.categorie === 'réflexion') continue
      const x = parEtape.get(b.etape) || []
      x.push(b)
      parEtape.set(b.etape, x)
    }
    sortieUsd = 0
    let sortieLue = 0
    etapes.forEach((e, k) => {
      if (e.sortie === undefined) return
      sortieLue += e.sortie
      const prixEtape = prix.sortie * mult[k]
      sortieUsd += e.sortie * prixEtape
      ajouter('réflexion', (e.reflexion || 0) * prixEtape)
      const reste = (e.sortie - (e.reflexion || 0)) * prixEtape
      const ecrits = parEtape.get(k) || []
      const car = ecrits.reduce((s, b) => s + b.car, 0)
      if (!car) return ajouter('non attribuée', reste)
      for (const b of ecrits)
        ajouter(
          b.categorie === "texte de l'agent" ? b.categorie : "appels d'outils",
          (reste * b.car) / car
        )
    })
    const multMoyen = mult.reduce((s, m) => s + m, 0) / mult.length
    const manquante = Math.max(0, sortie - sortieLue) * prix.sortie * multMoyen
    sortieUsd += manquante
    ajouter('non attribuée', manquante)
  }

  // Le contrôle et la reprise, lus sur les bilans : coût LOCAL du modèle de la session (le seul que
  // ce calcul couvre ; les autres modèles du bilan sont des appels annexes du CLI), et reprise quand
  // le cumul du premier tour dépasse déjà son coût local.
  let factureLocale
  let annexesUsd = 0
  let reprise
  // Un bilan sans coût local pour ce modèle (autre CLI, autre nom) ne contrôle rien : la facture
  // reste inconnue plutôt que de valoir 0. La reprise compare TOUS les modèles : un tour d'avant
  // joué sur un autre modèle reste de l'historique.
  const coutDe = (u) => (u && typeof u.costUSD === 'number' ? u.costUSD : undefined)
  const somme = (usage) => Object.values(usage || {}).reduce((s, u) => s + (coutDe(u) ?? 0), 0)
  if (modele && bilans.some((b) => coutDe(b.local[modele]) !== undefined)) {
    factureLocale = 0
    for (const { local } of bilans)
      for (const [m, u] of Object.entries(local)) {
        if (coutDe(u) === undefined) continue
        if (m === modele) factureLocale += u.costUSD
        else annexesUsd += u.costUSD
      }
    const premier = bilans[0]
    if (Object.keys(premier.local).length && Object.keys(premier.cumul).length)
      reprise = somme(premier.cumul) - somme(premier.local) > 1e-6
  }
  return {
    etapes: etapes.length,
    compactions,
    retrecissements,
    contexteRelu,
    debutMs,
    finMs,
    modele,
    // Facturé par le CLI pour ce passage, au modèle de la session : contrôle de etapesUsd + sortieUsd.
    factureLocale,
    annexesUsd,
    // true : le fil a été repris, son socle porte l'historique des tours d'avant ; undefined : inconnu.
    reprise,
    sortie: Math.max(
      sortie,
      etapes.reduce((s, e) => s + (e.sortie || 0), 0)
    ),
    etapesSansFin: etapes.filter((e) => e.sortie === undefined).length,
    finsOrphelines,
    lignesIllisibles,
    reflexionsPlafonnees,
    etapesUsd,
    sortieUsd,
    sortieParType,
    blocs: relus
  }
}

const quantile = (valeurs, f) => {
  const trie = [...valeurs].sort((x, y) => x - y)
  return trie.length ? trie[Math.min(trie.length - 1, Math.floor(trie.length * f))] : 0
}

export const SORTIE = 'écrit par le modèle'

const lecturesVides = () => ({
  total: 0,
  entieres: 0,
  grosses: 0,
  usdGrosses: 0,
  usdToutes: 0,
  lignes: []
})

/** Les lectures de fichier d'un ensemble de sessions, et leur part des dollars de cet ensemble. */
function mesurerLectures(sessions, seuilLignes) {
  const l = { Read: lecturesVides(), terminal: lecturesVides() }
  let usd = 0
  for (const s of sessions) {
    if (s.etapesUsd === undefined) continue
    usd += s.etapesUsd + s.sortieUsd
    for (const b of s.blocs) {
      const x = b.lecture && l[b.lecture]
      if (!x) continue
      x.total++
      x.lignes.push(b.lignes)
      x.usdToutes += b.usd
      if (b.entier) x.entieres++
      if (b.entier && b.lignes > seuilLignes) {
        x.grosses++
        x.usdGrosses += b.usd
      }
    }
  }
  const resume = (x) => ({
    total: x.total,
    entieres: x.entieres,
    grosses: x.grosses,
    partUsdGrosses: usd ? x.usdGrosses / usd : 0,
    partUsdToutes: usd ? x.usdToutes / usd : 0,
    medianeLignes: quantile(x.lignes, 0.5),
    p90Lignes: quantile(x.lignes, 0.9)
  })
  return { sessions: sessions.length, usd, Read: resume(l.Read), terminal: resume(l.terminal) }
}

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
  let annexes = 0
  let etapesSansFin = 0
  let finsOrphelines = 0
  let lignesIllisibles = 0
  let reflexionsPlafonnees = 0
  let usdBlocs = 0
  let usdEtapes = 0
  let usdSortie = 0
  const grille = {}
  let debutMs
  let finMs
  const sortiesLongues = { nombre: 0, usd: 0 }
  const socles = { reprises: [], nonReprises: [], inconnues: [] }
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
    if (socle) {
      const rang =
        s.reprise === true ? 'reprises' : s.reprise === false ? 'nonReprises' : 'inconnues'
      socles[rang].push(socle.tokens)
    }
    if (s.debutMs !== undefined && !(s.debutMs >= debutMs)) debutMs = s.debutMs
    if (s.finMs !== undefined && !(s.finMs <= finMs)) finMs = s.finMs
    const avecPrix = s.etapesUsd !== undefined
    if (avecPrix) {
      usdEtapes += s.etapesUsd
      usdSortie += s.sortieUsd
      for (const [type, usd] of Object.entries(s.sortieParType || {}))
        cumuler(parType, `${SORTIE} — ${type}`, 0, 0, usd)
    } else sansPrix++
    annexes += s.annexesUsd || 0
    etapesSansFin += s.etapesSansFin || 0
    finsOrphelines += s.finsOrphelines || 0
    lignesIllisibles += s.lignesIllisibles || 0
    reflexionsPlafonnees += s.reflexionsPlafonnees || 0
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
    }
  }
  const usd = usdBlocs + usdSortie
  const part = (x) => (usd ? x / usd : 0)
  const parts = (m) =>
    [...m.values()]
      .map((x) => ({ ...x, partRelu: relu ? x.relu / relu : 0, partUsd: part(x.usd) }))
      .sort((x, y) => y.usd - x.usd || y.relu - x.relu)
  const controle = Object.values(grille).reduce((s, g) => s + g.calcule, 0)
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
    // (2) sur les sessions qui ont un bilan, le calcul retrouve ce que le CLI a facturé — `partControlee`
    // dit quelle part des dollars ce second contrôle couvre.
    controleUsd: {
      blocs: usdBlocs,
      etapes: usdEtapes,
      grille,
      partControlee: part(controle),
      annexes,
      etapesSansFin,
      finsOrphelines,
      lignesIllisibles,
      reflexionsPlafonnees,
      sansPrix
    },
    seuilLignes,
    socle: {
      mediane: quantile([...socles.reprises, ...socles.nonReprises, ...socles.inconnues], 0.5),
      nonReprises: {
        nombre: socles.nonReprises.length,
        mediane: quantile(socles.nonReprises, 0.5)
      },
      reprises: { nombre: socles.reprises.length, mediane: quantile(socles.reprises, 0.5) }
    },
    types: parts(parType),
    outils: parts(parOutil),
    terminal: parts(parFamille),
    lectures: mesurerLectures(sessions, seuilLignes),
    // Les seules sessions où TOUTES les lectures sont visibles : sans reprise, le socle ne porte
    // aucune lecture d'un tour d'avant. C'est là que le plafond d'une prise sur les lectures se lit.
    lecturesNonReprises: mesurerLectures(
      sessions.filter((s) => s.reprise === false),
      seuilLignes
    ),
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
  const heures = a.debut && a.fin ? (Date.parse(a.fin) - Date.parse(a.debut)) / 3600000 : 0
  l.push(`# Ce qui remplit le contexte relu — ${a.sessions} sessions, ${milliers(a.etapes)} étapes`)
  l.push('')
  l.push(`Période : du ${jour(a.debut)} au ${jour(a.fin)} (UTC). Modèles : ${modeles}.`)
  if (heures < 72)
    l.push(
      `**Échantillon court** (${Math.round(heures)} h, ce que \`run-stdout\` garde encore) : les parts dépendent des tâches de cette période ; relancer sur d'autres jours avant de généraliser.`
    )
  l.push(
    `Socle de départ (consignes, définitions d'outils, historique repris, message) : médiane **${milliers(a.socle.mediane)} tokens** — ${milliers(a.socle.nonReprises.mediane)} sur les ${a.socle.nonReprises.nombre} sessions neuves, ${milliers(a.socle.reprises.mediane)} sur les ${a.socle.reprises.nombre} fils repris (l'écart est l'historique).`
  )
  l.push(
    `Contexte relu : **${milliers(a.relu)} tokens** (compteurs du modèle : ${milliers(a.mesureRelu)}). Compactions : ${a.compactions}, rétrécissements sans résumé : ${a.retrecissements}.`
  )
  l.push(
    `Coût calculé : **${dollars(a.usd)}**. Contrôles : sur les sessions qui ont un bilan (${pct(c.partControlee)} des dollars), le calcul retrouve la facture du CLI — ${grilleTexte || 'aucune session'} ; les blocs se partagent ${dollars(c.blocs)} des ${dollars(c.etapes)} payés pour lire (écart ${ecart(c.blocs, c.etapes)}).${c.sansPrix ? ` ${c.sansPrix} sessions d'un modèle sans prix connu : comptées en tokens seulement.` : ''} Hors calcul : ${dollars(c.annexes)} d'appels annexes du CLI à un autre modèle. Étapes sans fin de message : ${c.etapesSansFin} ; fins de message sans étape : ${c.finsOrphelines} ; lignes illisibles : ${c.lignesIllisibles} ; réflexions plus grosses que l'écart réel : ${c.reflexionsPlafonnees}.`
  )
  l.push('')
  l.push('| Type de contenu | Tokens entrés | Tokens relus | Part relue | Part des dollars |')
  l.push('|---|---:|---:|---:|---:|')
  for (const t of a.types) {
    const entres = t.nom.startsWith(SORTIE) ? '—' : milliers(t.entres)
    const relus = t.nom.startsWith(SORTIE) ? '—' : milliers(t.relu)
    l.push(`| ${t.nom} | ${entres} | ${relus} | ${pct(t.partRelu)} | **${pct(t.partUsd)}** |`)
  }
  l.push('')
  l.push(
    `Ce que le modèle écrit : la réflexion est comptée exactement ; le partage du reste entre texte et appels d'outils est une **estimation** au prorata des caractères.`
  )
  l.push('')
  l.push('## Le terminal, par usage (appel et sortie relus)')
  l.push('')
  for (const f of a.terminal) l.push(`- ${f.nom} : **${pct(f.partUsd)}** des dollars`)
  l.push('')
  l.push('## Outils qui coûtent le plus (relus)')
  l.push('')
  for (const o of a.outils.slice(0, 8)) l.push(`- \`${o.nom}\` : ${pct(o.partUsd)}`)
  l.push('')
  l.push('## Lectures de fichier')
  l.push('')
  const ligneLectures = (nom, r) =>
    `- ${nom} : ${r.total} lectures (${pct(r.partUsdToutes)} des dollars), ${r.entieres} du fichier entier ; lignes rendues : médiane ${r.medianeLignes}, 9 sur 10 sous ${r.p90Lignes}. Entières de plus de ${n} lignes : **${r.grosses}**, ${pct(r.partUsdGrosses)} des dollars.`
  l.push(ligneLectures('outil Read', a.lectures.Read))
  l.push(ligneLectures('terminal (cat, sed -n, head…)', a.lectures.terminal))
  l.push(
    `- Sorties de terminal de plus de ${n} lignes, tous usages : **${a.sortiesLongues.nombre}**, ${pct(a.sortiesLongues.partUsd)} des dollars.`
  )
  l.push('')
  l.push('## Gain maximal par prise (méthode JetBrains : part des dollars × réduction promise)')
  l.push('')
  const partDe = (nom) => (a.types.find((t) => t.nom === nom) || { partUsd: 0 }).partUsd
  const shunt = (x) => ({
    bas: (x.Read.partUsdGrosses + x.terminal.partUsdGrosses) * 0.9,
    haut: (x.Read.partUsdToutes + x.terminal.partUsdToutes) * 0.9
  })
  const tout = shunt(a.lectures)
  const neuves = shunt(a.lecturesNonReprises)
  l.push(
    `- Confier à un lecteur moins cher les grosses lectures (−90 %, shunt), avant le coût du lecteur et des étapes en plus :`
  )
  l.push(
    `  - sur les ${a.lecturesNonReprises.sessions} sessions neuves, où toutes les lectures sont visibles : **${pct(neuves.bas)}** pour les lectures entières de plus de ${n} lignes, **${pct(neuves.haut)}** au plus si TOUTES les lectures passaient par lui ;`
  )
  l.push(
    `  - sur toutes les sessions : au moins ${pct(tout.bas)} et ${pct(tout.haut)} (les lectures des tours d'avant d'un fil repris sont dans le socle, hors de ce compte).`
  )
  l.push(
    `- Compresser de 70 % toutes les sorties du terminal (rtk) : au plus **${pct(partDe('Bash / PowerShell') * 0.7)}**.`
  )
  l.push(
    `- Raccourcir de 65 % le texte de l'agent (caveman) : au plus **${pct((partDe("texte de l'agent") + partDe(`${SORTIE} — texte de l'agent`)) * 0.65)}** (relu et écrit).`
  )
  l.push(
    `- Écrire 15 % de code en moins (Ponytail) : au plus **${pct((partDe('Edit / Write') + partDe(`${SORTIE} — appels d'outils`)) * 0.15)}** (appels d'édition relus et tous les appels écrits — majorant).`
  )
  l.push(
    `- Alléger de 30 % le socle de départ : au plus **${pct(partDe(SOCLE) * 0.3)}** — consignes et outils d'un côté, historique repris de l'autre : deux leviers différents.`
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
