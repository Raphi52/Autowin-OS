#!/usr/bin/env node
/**
 * Relevé des RATÉS d'une journée ou d'une période, matière première du kaizen.
 *
 * Pourquoi : `/kaizen` sait auditer un fil, mais rien ne dit LESQUELS ont mal tourné, ni quelle cause
 * revient de l'un à l'autre. Ce relevé croise cinq traces que l'app écrit déjà, sans appel de modèle,
 * classe les fils par gravité et compte les causes d'arrêt qui reviennent : la maintenance du matin
 * (skills/maintenance/SKILL.md) et `/kaizen hier` ne dépensent ainsi leur budget que sur la cause
 * qui coûte le plus, au lieu de traiter dix ratés isolés.
 *
 *   node scripts/kaizen-veille.mjs                         # hier (heure de Paris)
 *   node scripts/kaizen-veille.mjs --jour 2026-11-07 --json
 *   node scripts/kaizen-veille.mjs --depuis 2026-11-03 [--jusqu-a 2026-11-07]
 *   node scripts/kaizen-veille.mjs --donnees <dossier autowin-os>
 *
 * Signaux (poids entre crochets) :
 *   recadrage  [3] l'utilisateur a corrigé ou relancé (« marche pas », « toujours », « pk », « non »…)
 *   refus      [3] une demande refusée (demandes/index.jsonl, etat « refuse ») ; sa raison est lue
 *                  dans la fiche RUN.md (« Résultat (…) : refusé — <raison> ») pour compter les causes
 *   rouge      [2] un verdict rouge du juge (trust.jsonl)
 *   sansPreuve [1] une demande close sans preuve (etat « sans-preuve »)
 *   cout       [1] coût du fil au-dessus de 3× la médiane de la période (cost.jsonl)
 *   interruptions  PAS un signal : un refus « échec : Fan-out … aucun modèle n'a produit de sortie » dont
 *                  l'erreur COMPLÈTE est une limite d'usage ou un arrêt voulu (Stop, arreter_un_fil)
 *                  n'a aucun défaut à corriger. La fiche coupe la raison avant la vraie cause : on
 *                  relit l'erreur entière dans le journal de tour (turn-journals/<conv>/*.jsonl,
 *                  événement « outcome ») et on la juge avec `interruptionSansDefaut()` de
 *                  src/shared/arret-par-stop.ts, chargée telle quelle (voir chargerLesOutils).
 * Les gels de l'app (gels.jsonl, ≥ 2 s) n'ont pas de fil : ils sont comptés à part.
 *
 * Gestes répétés, eux aussi à part : le MÊME texte court tapé au moins 5 fois sur les 7 jours qui
 * finissent la période (« /git », « reprend »). Les signaux ci-dessus se lisent fil par fil et ne
 * voient pas un geste refait dans dix fils ; c'est pourtant ce geste-là qu'un outil peut supprimer.
 * Les envois du mode auto n'en sont pas : l'agent les écrit lui-même, l'utilisateur n'a rien tapé.
 * Ni recadrage ni geste ne s'affiche sans passer par `redigerTexte` (src/shared/trace-redact.ts) :
 * une clé collée dans le chat ressortirait sinon en clair dans la maintenance et le kaizen.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ZONE = 'Europe/Paris'
export const POIDS = { recadrage: 3, refus: 3, rouge: 2, sansPreuve: 1, cout: 1 }

/**
 * Formules par lesquelles l'utilisateur dit qu'un tour a raté. Volontairement étroites : un faux
 * positif envoie le kaizen sur un fil sain, ce qui coûte plus cher qu'un raté manqué un jour.
 */
const RECADRAGES = [
  /\b(?:ça|ca|ce|sa)\s+(?:ne\s+)?marche\s+(?:pas|toujours|plus)\b/i,
  /\bmarche\s+pas\b/i,
  /\btoujours\s+pas\b/i,
  /\bc['’]?est\s+(?:pas|faux|nul|cass[ée])\b/i,
  /\bpas\s+(?:ça|ca)\b/i,
  /\bj['’]?(?:ai|avais)\s+(?:dit|demand[ée])\b/i,
  /\btu\s+(?:as|a)\s+(?:oubli[ée]|cass[ée]|pas)\b/i,
  /\bpourquoi\b|\bpk\b|\bpq\b/i,
  /\b(?:trop\s+long|arr[êe]te)\b/i,
  /\b(?:encore|re)\s*(?:rat[ée]|cass[ée]|bloqu[ée])\b/i,
  /^\s*non\b/i,
  /\bbug(?:ue|gé|ge)?\b/i
]

export function estRecadrage(texte) {
  const t = String(texte ?? '').slice(0, 600)
  if (t.trim().length < 2) return false
  return RECADRAGES.some((r) => r.test(t))
}

/** Jour civil à Paris (AAAA-MM-JJ) d'un instant en millisecondes ou ISO. */
export function jourParis(instant) {
  const d = new Date(typeof instant === 'number' ? instant : Date.parse(instant))
  if (Number.isNaN(d.getTime())) return undefined
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(d)
}

export function hier(maintenant = Date.now()) {
  return jourParis(maintenant - 24 * 3600 * 1000)
}

/** Le jour civil `n` jours avant ou après `jour` (AAAA-MM-JJ), sans dépendre du fuseau. */
function decalerLeJour(jour, n) {
  return new Date(Date.parse(`${jour}T12:00:00Z`) + n * 24 * 3600 * 1000).toISOString().slice(0, 10)
}

/**
 * Seuils du signal « geste répété ». Au-delà de 120 signes, un texte identique est un modèle envoyé
 * par un bouton ou un plan, pas un geste tapé : il n'y a rien à automatiser de plus.
 */
export const GESTE = { fois: 5, jours: 7, longueurMax: 120 }

/**
 * Forme comparable d'une saisie : « /git », « /Git. » et « /git » sont le même geste, comme
 * « /check conv-1790 » et « /check conv-1812 » (le numéro du fil change, pas le geste).
 * `undefined` pour un texte trop long pour être un geste.
 */
export function formeDuGeste(texte) {
  const t = String(texte ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!t || t.length > GESTE.longueurMax) return undefined
  const forme = t
    .toLowerCase()
    .replace(/\bconv-\d+\b/g, 'conv-#')
    .replace(/[\s.!?…]+$/, '')
  return forme || undefined
}

/** Un envoi du mode auto : marqué à l'envoi (`origine`), ou signé dans son texte avant ce marquage. */
function envoiAutomatique(saisie, estEnvoiAuto) {
  return saisie.origine === 'mode-auto' || Boolean(estEnvoiAuto?.(saisie.texte))
}

/**
 * Raison d'un refus sans ce qui la rend unique (coût, espaces) : deux refus pour la même cause
 * doivent tomber dans la même case, sinon rien ne « revient ».
 */
export function normaliserCause(raison) {
  return String(raison ?? '')
    .replace(/\s*·\s*[\d\s.,]+\s*\$.*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100)
}

const LIGNE_DE_REFUS = /^Résultat \((\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}) UTC\) : refusé — (.+)$/gm

/** Raisons de refus écrites dans une fiche RUN.md, avec le jour de Paris de chacune. */
export function refusDeLaFiche(texte) {
  const sortie = []
  for (const m of String(texte ?? '').matchAll(LIGNE_DE_REFUS)) {
    const instant = Date.parse(`${m[1]}T${m[2]}:00Z`)
    sortie.push({ jour: jourParis(instant), instant, cause: normaliserCause(m[3]) })
  }
  return sortie
}

function lignesJson(chemin) {
  if (!existsSync(chemin)) return []
  const sortie = []
  for (const l of readFileSync(chemin, 'utf8').split('\n')) {
    if (!l.trim()) continue
    try {
      sortie.push(JSON.parse(l))
    } catch {
      // une ligne coupée par une écriture en cours : les autres restent lisibles
    }
  }
  return sortie
}

function mediane(valeurs) {
  if (!valeurs.length) return 0
  const v = [...valeurs].sort((a, b) => a - b)
  const m = Math.floor(v.length / 2)
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2
}

/** Seule la raison d'un « Fan-out … aucun modèle » est coupée avant la vraie cause. */
const REFUS_SANS_SORTIE = /aucun modèle n['’]a produit de sortie/

function motifDInterruption(refus, conversationId, { lireErreur, classer }) {
  if (!lireErreur || !classer || !REFUS_SANS_SORTIE.test(refus.cause)) return undefined
  const debut = espaces(refus.cause.replace(/^échec : /, ''))
  const erreur = lireErreur({ conversationId, instant: refus.instant, debut })
  return erreur ? classer(erreur) : undefined
}

/**
 * Calcule le relevé d'une période (bornes incluses, AAAA-MM-JJ de Paris) à partir des lignes déjà
 * lues. Pur, pour être testé sans disque : `lireFiche(chemin relatif)` rend le texte d'un RUN.md.
 * @param {{du:string, au:string}} periode
 * @param {{saisies:any[], demandes:any[], verdicts:any[], couts:any[], gels:any[]}} traces
 * @param {(fiche:string) => string | undefined} [lireFiche]
 * @param {{lireErreur?:(refus:{conversationId:string, instant:number}) => string | undefined,
 *          classer?:(erreur:string) => string | undefined,
 *          estEnvoiAuto?:(texte:string) => boolean,
 *          rediger?:(texte:string) => string}} [outils]
 *   `lireErreur` rend l'erreur COMPLÈTE d'un refus (la fiche la coupe) ; `classer` dit si c'est une
 *   interruption sans défaut (`interruptionSansDefaut`). Sans eux, aucun refus n'est reclassé.
 *   `estEnvoiAuto` reconnaît un envoi du mode auto antérieur au champ `origine` ; `rediger` masque
 *   les secrets d'un texte tapé avant qu'il ne sorte du relevé (identité par défaut, pour les tests).
 */
export function releverLaPeriode(periode, traces, lireFiche = () => undefined, outils = {}) {
  const { du, au } = periode
  const { estEnvoiAuto, rediger = (t) => t } = outils
  const dans = (instant) => {
    const j = jourParis(instant)
    return Boolean(j) && j >= du && j <= au
  }
  const fils = new Map()
  const fil = (id) => {
    if (!fils.has(id))
      fils.set(id, {
        conversationId: id,
        score: 0,
        recadrage: [],
        refus: [],
        rouge: 0,
        sansPreuve: 0,
        coutUsd: 0,
        cout: false,
        saisies: 0
      })
    return fils.get(id)
  }

  for (const s of traces.saisies) {
    if (!dans(s.ts) || !s.conversationId || s.conversationId === 'nouvelle-conversation') continue
    const f = fil(s.conversationId)
    f.saisies++
    // Le texte d'un envoi du mode auto cite la demande et ses consignes (« pourquoi », « j'ai
    // demandé ») : le prendre pour un recadrage comptait l'agent comme l'utilisateur qui le corrige.
    if (!envoiAutomatique(s, estEnvoiAuto) && estRecadrage(s.texte))
      f.recadrage.push(rediger(String(s.texte).replace(/\s+/g, ' ').slice(0, 140)))
  }

  // Les 7 jours qui finissent la période, ou toute la période si elle est plus longue : un relevé
  // d'une seule journée ne verrait jamais un geste refait 5 fois dans la semaine.
  const gestesDu = [du, decalerLeJour(au, 1 - GESTE.jours)].sort()[0]
  const gestes = new Map()
  for (const s of traces.saisies) {
    if (typeof s.texte !== 'string' || envoiAutomatique(s, estEnvoiAuto)) continue
    const jour = jourParis(s.ts)
    const forme = formeDuGeste(s.texte)
    if (!jour || jour < gestesDu || jour > au || !forme) continue
    const g = gestes.get(forme) ?? { geste: rediger(forme), fois: 0, fils: new Set() }
    g.fois++
    if (s.conversationId && s.conversationId !== 'nouvelle-conversation')
      g.fils.add(s.conversationId)
    gestes.set(forme, g)
  }

  // Une demande a plusieurs lignes au fil de sa vie : seul son DERNIER état compte.
  const dernierEtat = new Map()
  for (const d of traces.demandes) {
    if (!d.messageId || !dans(d.demandeLe ?? d.ts)) continue
    const avant = dernierEtat.get(d.messageId)
    if (!avant || (d.ts ?? 0) >= (avant.ts ?? 0)) dernierEtat.set(d.messageId, d)
  }
  // fix-ok: la fiche RUN.md coupe la raison à ~140 signes, avant « You've hit your 5-hour limit » ;
  // la cause réelle n'est lisible que dans l'événement « outcome » du journal de tour.
  const fichesRefusees = new Map()
  for (const d of dernierEtat.values()) {
    if (d.etat === 'refuse' && d.fiche) fichesRefusees.set(d.fiche, d.conversationId)
  }

  // Une fiche porte TOUTE la vie d'une demande : on n'y compte que les refus datés de la période.
  // Un refus dont l'erreur complète est une interruption sans défaut n'est pas une cause de refus.
  const analyses = new Map()
  for (const [fiche, conversationId] of fichesRefusees) {
    const lus = refusDeLaFiche(lireFiche(fiche)).filter((r) => r.jour >= du && r.jour <= au)
    analyses.set(
      fiche,
      lus.map((r) => ({ ...r, motif: motifDInterruption(r, conversationId, outils) }))
    )
  }

  for (const d of dernierEtat.values()) {
    if (d.etat === 'refuse') {
      const lignes = d.fiche ? analyses.get(d.fiche) : undefined
      // Rien à compter si TOUS les refus de la fiche sont des interruptions.
      if (lignes?.length && lignes.every((r) => r.motif)) continue
      fil(d.conversationId).refus.push(String(d.constat ?? '').slice(0, 140))
    } else if (d.etat === 'sans-preuve') fil(d.conversationId).sansPreuve++
  }

  const causes = new Map()
  const interrompus = new Map()
  const compter = (cause, conversationId, dans = causes) => {
    const c = dans.get(cause) ?? { cause, fois: 0, fils: new Set() }
    c.fois++
    c.fils.add(conversationId)
    dans.set(cause, c)
  }
  for (const [fiche, conversationId] of fichesRefusees) {
    const lignes = analyses.get(fiche)
    if (!lignes.length) compter('raison non écrite dans la fiche', conversationId)
    for (const r of lignes) {
      if (r.motif) compter(r.motif, conversationId, interrompus)
      else compter(r.cause, conversationId)
    }
  }

  for (const v of traces.verdicts) {
    if (v.verdict === 'red' && v.conversationId && dans(v.ts)) fil(v.conversationId).rouge++
  }

  const coutParFil = new Map()
  for (const c of traces.couts) {
    if (!c.conversationId || !dans(c.ts)) continue
    coutParFil.set(
      c.conversationId,
      (coutParFil.get(c.conversationId) ?? 0) + (Number(c.costUsd) || 0)
    )
  }
  const seuilCout = 3 * mediane([...coutParFil.values()].filter((x) => x > 0))
  for (const [id, usd] of coutParFil) {
    const f = fils.get(id)
    if (f) f.coutUsd = usd
    if (seuilCout > 0 && usd > seuilCout) {
      fil(id).coutUsd = usd
      fil(id).cout = true
    }
  }

  for (const f of fils.values()) {
    f.score =
      POIDS.recadrage * f.recadrage.length +
      POIDS.refus * f.refus.length +
      POIDS.rouge * f.rouge +
      POIDS.sansPreuve * f.sansPreuve +
      (f.cout ? POIDS.cout : 0)
  }

  const gels = traces.gels.filter((g) => dans(g.ts) && (g.blocageMs ?? 0) >= 2000)
  const classes = [...fils.values()]
    .filter((f) => f.score > 0)
    .sort((a, b) => b.score - a.score || b.coutUsd - a.coutUsd)
  return {
    du,
    au,
    filsActifs: [...fils.values()].filter((f) => f.saisies > 0).length,
    totaux: {
      recadrages: classes.reduce((n, f) => n + f.recadrage.length, 0),
      refus: classes.reduce((n, f) => n + f.refus.length, 0),
      rouges: classes.reduce((n, f) => n + f.rouge, 0),
      sansPreuve: classes.reduce((n, f) => n + f.sansPreuve, 0),
      interruptions: [...interrompus.values()].reduce((n, c) => n + c.fois, 0),
      gels: gels.length,
      gelMaxMs: gels.reduce((m, g) => Math.max(m, g.blocageMs ?? 0), 0)
    },
    gestesDu,
    // Classés par nombre de frappes : un geste refait cinq fois dans un même fil coûte autant de
    // gestes à l'utilisateur que cinq fois dans cinq fils.
    gestes: [...gestes.values()]
      .filter((g) => g.fois >= GESTE.fois)
      .map((g) => ({ geste: g.geste, fois: g.fois, fils: [...g.fils] }))
      .sort((a, b) => b.fois - a.fois || b.fils.length - a.fils.length),
    // Une cause vue dans plusieurs fils passe devant une cause répétée dans un seul.
    causes: [...causes.values()]
      .map((c) => ({ cause: c.cause, fois: c.fois, fils: [...c.fils] }))
      .sort((a, b) => b.fils.length - a.fils.length || b.fois - a.fois),
    // Hors des causes de refus : ni limite d'usage ni arrêt voulu ne laisse un défaut à corriger.
    interruptions: [...interrompus.values()]
      .map((c) => ({ motif: c.cause, fois: c.fois, fils: [...c.fils] }))
      .sort((a, b) => b.fois - a.fois),
    fils: classes
  }
}

export function releverLaJournee(jour, traces, lireFiche, outils) {
  return releverLaPeriode({ du: jour, au: jour }, traces, lireFiche, outils)
}

export function lireTraces(dossier) {
  return {
    saisies: lignesJson(join(dossier, 'saisies-utilisateur.jsonl')),
    demandes: lignesJson(join(dossier, 'demandes', 'index.jsonl')),
    verdicts: lignesJson(join(dossier, 'trust.jsonl')),
    couts: lignesJson(join(dossier, 'cost.jsonl')),
    gels: lignesJson(join(dossier, 'gels.jsonl'))
  }
}

export function lecteurDeFiches(dossier) {
  return (fiche) => {
    const chemin = join(dossier, 'demandes', fiche)
    return existsSync(chemin) ? readFileSync(chemin, 'utf8') : undefined
  }
}

const espaces = (t) => String(t).replace(/\s+/g, ' ').trim()

/**
 * L'erreur complète d'un refus : le journal de tour du fil (`turn-journals/<conv>/<tour>.jsonl`)
 * l'écrit en entier, dans son événement « outcome » (`error`) ou dans le résultat en échec de
 * l'orchestration (`data`). La fiche, elle, la tronque, avant la cause réelle.
 *
 * L'heure ne suffit pas à retrouver le bon événement (une reprise note le refus des heures après
 * l'erreur) : on garde ceux qui COMMENCENT comme la raison de la fiche (`debut`), puis le plus
 * proche de l'instant du refus.
 */
export function lecteurDErreurs(dossier) {
  return ({ conversationId, instant, debut }) => {
    const rep = join(dossier, 'turn-journals', conversationId)
    if (!existsSync(rep) || !debut) return undefined
    let meilleur
    for (const nom of readdirSync(rep)) {
      if (!nom.endsWith('.jsonl')) continue
      for (const l of readFileSync(join(rep, nom), 'utf8').split('\n')) {
        const sortie = l.includes('"kind":"outcome"')
        if (!sortie && !(l.includes('"ok":false') && l.includes('"kind":"result"'))) continue
        try {
          const e = JSON.parse(l)
          const texte = sortie ? e.error : e.data
          if (typeof texte !== 'string' || !espaces(texte).startsWith(debut)) continue
          const ecart = Math.abs((e.at ?? 0) - instant)
          if (!meilleur || ecart < meilleur.ecart) meilleur = { ecart, texte }
        } catch {
          // une ligne coupée par une écriture en cours : les autres restent lisibles
        }
      }
    }
    return meilleur?.texte
  }
}

/**
 * Trois fonctions de l'app, en TypeScript dans src/shared, que `node` seul ne lit pas (ni ce format
 * ni ses imports sans extension) : `interruptionSansDefaut` (arret-par-stop.ts),
 * `estUnEnvoiDuModeAuto` (envoi-du-mode-auto.ts) et `redigerTexte` (trace-redact.ts). Plutôt que de
 * recopier leurs motifs (la copie dériverait), on COMPILE les vrais fichiers avec esbuild, déjà dans
 * le dépôt, et on les importe. Rend `{}` si la compilation échoue : le relevé marche, sans reclasser
 * ni reconnaître les anciens envois du mode auto, et `principal` masque alors les textes tapés.
 */
export async function chargerLesOutils(
  racine = join(dirname(fileURLToPath(import.meta.url)), '..')
) {
  try {
    const { build } = await import('esbuild')
    const partage = (fichier) => JSON.stringify(`./src/shared/${fichier}`)
    const { outputFiles } = await build({
      stdin: {
        contents: [
          `export { interruptionSansDefaut } from ${partage('arret-par-stop.ts')}`,
          `export { estUnEnvoiDuModeAuto } from ${partage('envoi-du-mode-auto.ts')}`,
          `export { redigerTexte } from ${partage('trace-redact.ts')}`
        ].join('\n'),
        resolveDir: racine,
        loader: 'js'
      },
      bundle: true,
      write: false,
      format: 'esm',
      platform: 'node',
      logLevel: 'silent'
    })
    const code = Buffer.from(outputFiles[0].text).toString('base64')
    const module = await import(`data:text/javascript;base64,${code}`)
    return {
      classer: module.interruptionSansDefaut,
      estEnvoiAuto: module.estUnEnvoiDuModeAuto,
      rediger: module.redigerTexte
    }
  } catch (e) {
    console.error(`Outils de src/shared non chargés (interruptions non reclassées) : ${e.message}`)
    return {}
  }
}

function lisible(r, top) {
  const t = r.totaux
  const l = [
    `Ratés ${r.du === r.au ? `du ${r.du}` : `du ${r.du} au ${r.au}`} — ${r.filsActifs} fils actifs`,
    `recadrages ${t.recadrages} · refus ${t.refus} · juge rouge ${t.rouges} · sans preuve ${t.sansPreuve} · interruptions ${t.interruptions} · gels ≥2 s ${t.gels}${t.gels ? ` (max ${(t.gelMaxMs / 1000).toFixed(1)} s)` : ''}`,
    ''
  ]
  if (r.causes.length) {
    l.push('Causes de refus qui reviennent :')
    for (const c of r.causes.slice(0, 5))
      l.push(
        `  ${c.fois}× dans ${c.fils.length} fil(s) — ${c.cause}  (${c.fils.slice(0, 4).join(', ')})`
      )
    l.push('')
  }
  if (r.interruptions.length) {
    l.push('Interruptions (limite d’usage, arrêt voulu : rien à corriger, hors des causes) :')
    for (const c of r.interruptions)
      l.push(`  ${c.fois}× dans ${c.fils.length} fil(s) — ${c.motif}  (${c.fils.join(', ')})`)
    l.push('')
  }
  if (r.gestes.length) {
    l.push(
      `Gestes répétés (≥ ${GESTE.fois} fois du ${r.gestesDu} au ${r.au}, envois du mode auto exclus) :`
    )
    for (const g of r.gestes.slice(0, top))
      l.push(
        `  ${g.fois}× dans ${g.fils.length} fil(s) — « ${g.geste} »  (${g.fils.slice(0, 4).join(', ')})`
      )
    l.push('')
  }
  for (const f of r.fils.slice(0, top)) {
    const parts = []
    if (f.recadrage.length) parts.push(`${f.recadrage.length} recadrage(s)`)
    if (f.refus.length) parts.push(`${f.refus.length} refus`)
    if (f.rouge) parts.push(`${f.rouge} rouge(s)`)
    if (f.sansPreuve) parts.push(`${f.sansPreuve} sans preuve`)
    if (f.cout) parts.push(`coût ${f.coutUsd.toFixed(2)} $`)
    l.push(`[${String(f.score).padStart(2)}] ${f.conversationId} — ${parts.join(' · ')}`)
    for (const q of f.recadrage.slice(0, 2)) l.push(`      « ${q} »`)
  }
  if (!r.fils.length) l.push('Aucun raté relevé.')
  return l.join('\n')
}

async function principal(argv) {
  const arg = (nom) => {
    const i = argv.indexOf(nom)
    return i >= 0 ? argv[i + 1] : undefined
  }
  const ici = dirname(fileURLToPath(import.meta.url))
  const dossier = resolve(
    arg('--donnees') ??
      process.env.AUTOWIN_DONNEES ??
      join(ici, '..', '.autowin-data', 'autowin-os')
  )
  if (!existsSync(join(dossier, 'saisies-utilisateur.jsonl'))) {
    console.error(`Dossier de données introuvable ou vide : ${dossier} (option --donnees)`)
    return 2
  }
  const jour = arg('--jour')
  const au = jour ?? arg('--jusqu-a') ?? hier()
  const du = jour ?? arg('--depuis') ?? au
  if (!/^\d{4}-\d{2}-\d{2}$/.test(du) || !/^\d{4}-\d{2}-\d{2}$/.test(au) || du > au) {
    console.error(`Période invalide : du ${du} au ${au} (format AAAA-MM-JJ)`)
    return 2
  }
  const top = Number(arg('--top') ?? 10)
  const { classer, estEnvoiAuto, rediger } = await chargerLesOutils()
  const r = releverLaPeriode({ du, au }, lireTraces(dossier), lecteurDeFiches(dossier), {
    lireErreur: lecteurDErreurs(dossier),
    classer,
    estEnvoiAuto,
    // Sans la rédaction de l'app, aucun texte tapé ne sort : mieux vaut un relevé muet qu'une clé.
    rediger: rediger ?? (() => '[texte masqué : redigerTexte non chargé]')
  })
  console.log(
    argv.includes('--json')
      ? JSON.stringify({ ...r, fils: r.fils.slice(0, top) }, null, 2)
      : lisible(r, top)
  )
  return 0
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await principal(process.argv.slice(2))
}
