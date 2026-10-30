/**
 * BANC DE LA REQUÊTE des notes Brain proches (src/main/brain-titres-du-tour.ts), sur le Brain VIVANT.
 *
 * Pourquoi (conv-1303, 2026-10-30) : `scripts/banc-notes-proches-usage.mjs` a montré que le TRI n'est
 * pas en cause — sur 75 notes ouvertes hors du bloc, 57 n'étaient même pas parmi les candidats, et 54
 * de ces 57 ont été trouvées par l'agent avec SA PROPRE recherche `brain_query`, formulée en
 * mots-clés (« préférences visuelles design linéaire anti-motifs »). Ce banc-ci change donc la
 * REQUÊTE : il rejoue plusieurs formulations par tour réel sur le Brain vivant, applique le tri de
 * production (`selectionnerTitres`) et compte les notes que l'agent a RÉELLEMENT ouvertes dans ce
 * tour (`brain_read`, turn-journals). Lecture seule, aucun appel au modèle ; ~4 recherches Brain
 * par tour (même chemin que `scripts/sonde-titres-brain.mts`).
 *
 * Résultat du 30/10 (825 tours du 22 au 30/10, ~1 900 recherches en 5 min) : notes ouvertes couvertes
 * 54/153 par le message entier rejoué, 25 par ses mots-clés, 23 par les mots-clés + le 1er ou le
 * précédent message du fil, 59 par l'union message + mots-clés pour 35 % de lignes en plus ; 1 seule
 * des 57 notes manquées rattrapée. La requête de production RESTE le message entier. Ces 57 notes,
 * l'agent les a trouvées par sa recherche `brain_query` reformulée par sens : rejouée, elle les met
 * dans sa liste longue 67 fois sur 75, dans un bloc de 3 lignes 20 fois seulement.
 *
 * Limites : le Brain a grandi depuis les tours rejoués (la requête d'origine est donc AUSSI rejouée
 * aujourd'hui, c'est elle la référence) ; une note ouverte parce qu'elle était dans le bloc d'origine
 * avantage la requête d'origine.
 *
 * Usage : npx tsx scripts/banc-notes-proches-requete.mts [depuis-ISO] [--limite N] [--detail fichier.json]
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { retrieveBrainContext, type BrainRetrievalResult } from '../src/main/brain-retrieval'
import { brainCorpusForWorkspace, scopeBrainRetrieval } from '../src/main/brain-corpus-scope'
import { POINT_TITRES_DU_TOUR, selectionnerTitres } from '../src/main/brain-titres-du-tour'
import { replierComplet } from '../src/shared/mots'

const args = process.argv.slice(2)
const option = (nom: string): string | undefined => {
  const i = args.indexOf(nom)
  return i >= 0 ? args[i + 1] : undefined
}
const depuis = args.find((a) => /^\d{4}-\d\d-\d\d/.test(a)) ?? '2026-10-22T08'
const limite = Number(option('--limite') ?? Infinity)
const detail = option('--detail')
const donnees = join('.autowin-data', 'autowin-os')
const spool = join(donnees, 'brain-trace-spool')
const journaux = join(donnees, 'turn-journals')
const norm = (p: unknown): string =>
  String(p ?? '')
    .split(String.fromCharCode(92))
    .join('/')

interface Trace {
  id?: string
  timestamp: string
  conversationId: string
  turnId?: string
  query: string
  navigation?: { candidates: { rank: number; path: string; denseCos: number; retained: boolean }[] }
}

function traces(): Trace[] {
  const vues = new Set<string>()
  const sortie: Trace[] = []
  for (const f of [
    'events.archive.1.jsonl',
    'events.archive.jsonl',
    'events.previous.jsonl',
    'events.jsonl'
  ]) {
    const chemin = join(spool, f)
    if (!existsSync(chemin)) continue
    for (const ligne of readFileSync(chemin, 'utf8').split('\n')) {
      if (!ligne.includes(POINT_TITRES_DU_TOUR)) continue
      try {
        const t = JSON.parse(ligne) as Trace
        const cle = t.id ?? `${t.timestamp}${t.conversationId}`
        if (vues.has(cle)) continue
        vues.add(cle)
        sortie.push(t)
      } catch {
        // ligne partielle
      }
    }
  }
  return sortie
}

/** Ce que le journal d'un tour dit : son début, le message de l'utilisateur, les notes ouvertes. */
interface Tour {
  debut: number
  message?: string
  ouvertes: Set<string>
}
const parFil = new Map<string, Map<string, Tour>>()
function toursDuFil(conversationId: string): Map<string, Tour> {
  const deja = parFil.get(conversationId)
  if (deja) return deja
  const tours = new Map<string, Tour>()
  const dossier = join(journaux, conversationId)
  for (const nom of existsSync(dossier) ? readdirSync(dossier) : []) {
    if (!nom.endsWith('.jsonl')) continue
    const tour: Tour = { debut: Infinity, ouvertes: new Set() }
    for (const ligne of readFileSync(join(dossier, nom), 'utf8').split('\n')) {
      if (tour.debut === Infinity) {
        const at = /"at":(\d+)/.exec(ligne)?.[1]
        if (at) tour.debut = Number(at)
      }
      const estUser = ligne.startsWith('{"kind":"user"')
      const estLecture = ligne.includes('"name":"brain_read"') && ligne.includes('"kind":"command"')
      if (!estUser && !estLecture) continue
      try {
        const e = JSON.parse(ligne) as { text?: string; args?: { path?: string } }
        if (estLecture) tour.ouvertes.add(norm(e.args?.path))
        else if (tour.message === undefined) {
          const m = [
            ...(e.text ?? '').matchAll(/<message_utilisateur>([\s\S]*?)<\/message_utilisateur>/g)
          ].pop()
          if (m) tour.message = m[1]
        }
      } catch {
        // ligne partielle
      }
    }
    tours.set(nom.slice(0, -'.jsonl'.length), tour)
  }
  parFil.set(conversationId, tours)
  return tours
}

function dossiersDesFils(): Map<string, string> {
  const fichier = join(donnees, 'conversations.json')
  const parId = new Map<string, string>()
  const ranger = (c: { id?: string; projectPath?: string }): void => {
    if (c?.id && c.projectPath && !parId.has(c.id)) parId.set(c.id, c.projectPath)
  }
  try {
    for (const c of JSON.parse(readFileSync(fichier, 'utf8'))) ranger(c)
  } catch {
    // snapshot illisible : corpus par défaut
  }
  const archive = `${fichier}.archive`
  for (const nom of existsSync(archive) ? readdirSync(archive) : []) {
    if (!nom.endsWith('.json')) continue
    try {
      ranger(JSON.parse(readFileSync(join(archive, nom), 'utf8')))
    } catch {
      // archive abîmée
    }
  }
  return parId
}

/**
 * Mots sans sujet propre, comparés repliés (sans accent, minuscules) : outils de la phrase, verbes
 * passe-partout du chat et abréviations tapées vite. Les retirer laisse les mots qui portent le sujet.
 */
const MOTS_SANS_SUJET = new Set(
  `les des une est sont pas plus moins que qui quoi quand comment pourquoi dont cet cette ces cela
  ceci celui celle ceux celles ils elle elles nous vous leur leurs mon mes ton tes son ses notre nos
  votre vos moi toi lui eux par pour sur sous dans avec sans entre chez vers comme mais donc car
  alors puis apres avant aussi encore deja toujours jamais tres trop bien tout tous toute toutes rien
  chose choses truc trucs faire fait fais faut faudrait peut peux veux veut voudrais aimerais
  pourrais dois doit voir etre avoir ont ete etait sera serait suis etes avons avez font quel quelle
  quels quelles meme memes autre autres ici maintenant oui non merci stp svp bon bonne juste
  vraiment aux suite genre paske pcq tjrs bcp mtn jsp dis dire mets met donne cas fois
  the and that this with from have has what how why when where which who are was were not but for
  you your our can could would should will just like into than then them they there these those its`
    .split(/\s+/)
    .filter(Boolean)
)

/**
 * La requête en MOTS-CLÉS : le message sans ses liens, sans les mots sans sujet, sans doublon,
 * dans l'ordre où ils viennent. Les mots gardent leurs accents (le score dense les lit) ; les noms
 * de fichiers, identifiants et `conv-NNN` restent entiers.
 */
function motsClesDeRequete(message: string, maximum = 24): string {
  const vus = new Set<string>()
  const gardes: string[] = []
  const morceaux = message
    .replace(/https?:\/\/\S+/g, ' ')
    .split(/[^\p{L}\p{N}_./-]+/u)
    .map((brut) => brut.replace(/^[._/-]+|[._/-]+$/g, ''))
    // « fais-le », « est-ce » se coupent ; un identifiant (`conv-1303`, `a-b.ts`) reste entier.
    .flatMap((brut) => (/[\d._/]/.test(brut) ? [brut] : brut.split('-')))
  for (const mot of morceaux) {
    const replie = replierComplet(mot)
    if (!/\p{L}/u.test(mot)) continue
    if (replie.length < 3 && !/\d/.test(mot)) continue
    if (MOTS_SANS_SUJET.has(replie) || vus.has(replie)) continue
    vus.add(replie)
    gardes.push(mot)
    if (gardes.length >= maximum) break
  }
  return gardes.join(' ')
}

const VARIANTES = [
  'message entier (actuel)',
  'mots-clés du message',
  'mots-clés + 1er message du fil',
  'mots-clés + message précédent'
] as const
type Variante = (typeof VARIANTES)[number]

const joindre = (...parties: string[]): string => motsClesDeRequete(parties.join('\n'), 32)

const dossiers = dossiersDesFils()
const cas = traces()
  .filter((t) => t.timestamp >= depuis && t.turnId && t.navigation?.candidates?.length)
  .slice(0, limite)
  .map((t) => {
    const tours = toursDuFil(t.conversationId)
    const tour = tours.get(t.turnId!)
    const message = tour?.message ?? t.query
    const avant = [...tours.values()]
      .filter((x) => x.message && x.debut < (tour?.debut ?? Date.parse(t.timestamp)))
      .sort((a, b) => a.debut - b.debut)
    const premier = avant[0]?.message ?? ''
    const precedent = avant.at(-1)?.message ?? ''
    const requetes: Record<Variante, string> = {
      'message entier (actuel)': message.trim().slice(0, 2_000),
      'mots-clés du message': motsClesDeRequete(message),
      'mots-clés + 1er message du fil': joindre(message, premier),
      'mots-clés + message précédent': joindre(message, precedent)
    }
    return {
      t,
      ouvertes: tour?.ouvertes ?? new Set<string>(),
      messageRetrouve: Boolean(tour?.message),
      origine: selectionnerTitres({
        context: '',
        status: 'found',
        navigation: t.navigation as never
      }).map((x) => x.path),
      corpus: brainCorpusForWorkspace(dossiers.get(t.conversationId) ?? process.cwd()),
      requetes
    }
  })

// Recherches dédoublonnées (même requête, même corpus = même réponse), 4 en même temps.
const memo = new Map<string, Promise<BrainRetrievalResult>>()
const enFile: (() => Promise<void>)[] = []
function chercher(requete: string, corpus: string[] | undefined): Promise<BrainRetrievalResult> {
  const cle = `${JSON.stringify(corpus ?? null)}\n${requete}`
  const deja = memo.get(cle)
  if (deja) return deja
  const promesse = new Promise<BrainRetrievalResult>((resoudre) => {
    enFile.push(async () => {
      resoudre(
        requete.trim()
          ? await retrieveBrainContext(requete, {
              ...(corpus ? { corpus } : {}),
              mode: 'candidates',
              timeoutMs: 8_000
            })
          : { context: '', status: 'empty' }
      )
    })
  })
  memo.set(cle, promesse)
  return promesse
}
const travailleurs = async (n: number): Promise<void> => {
  await Promise.all(
    Array.from({ length: n }, async () => {
      for (let tache = enFile.shift(); tache; tache = enFile.shift()) await tache()
    })
  )
}

const servi = new Map<string, Record<Variante, string[]>>()
const indisponibles: Record<string, number> = {}
const promesses = cas.map(async (c) => {
  const parVariante = {} as Record<Variante, string[]>
  for (const v of VARIANTES) {
    const brut = await chercher(c.requetes[v], c.corpus)
    if (brut.status === 'unavailable') indisponibles[v] = (indisponibles[v] ?? 0) + 1
    parVariante[v] = selectionnerTitres(scopeBrainRetrieval(brut, c.corpus)).map((x) => x.path)
  }
  servi.set(c.t.id ?? `${c.t.timestamp}${c.t.conversationId}`, parVariante)
})
const debut = Date.now()
await Promise.all([travailleurs(4), ...promesses])

const totalOuvertures = cas.reduce((n, c) => n + c.ouvertes.size, 0)
const manquees = cas.flatMap((c) =>
  [...c.ouvertes].filter(
    (o) => !c.origine.includes(o) && !c.t.navigation!.candidates.some((x) => norm(x.path) === o)
  )
)
console.log(
  `tours rejoués : ${cas.length} depuis ${depuis} (message complet retrouvé : ${cas.filter((c) => c.messageRetrouve).length}) — ${memo.size} recherches en ${Math.round((Date.now() - debut) / 1000)} s`
)
console.log(
  `ouvertures : ${totalOuvertures}, dont absentes des candidats d'origine : ${manquees.length}`
)
const ligne = (nom: string, servies: (c: (typeof cas)[number]) => string[]): void => {
  let lignes = 0
  let couvertes = 0
  let rattrapees = 0
  let jamaisLues = 0
  let blocs = 0
  for (const c of cas) {
    const s = servies(c)
    lignes += s.length
    if (s.length) blocs++
    for (const o of c.ouvertes) {
      if (!s.includes(o)) continue
      couvertes++
      if (!c.origine.includes(o) && !c.t.navigation!.candidates.some((x) => norm(x.path) === o))
        rattrapees++
    }
    if (!s.some((x) => c.ouvertes.has(x))) jamaisLues += s.length
  }
  console.log(
    `${nom.padEnd(36)} lignes/tour ${(lignes / Math.max(1, cas.length)).toFixed(2)} | tours avec bloc ${blocs} | ouvertures couvertes ${couvertes}/${totalOuvertures} (dont manquées rattrapées ${rattrapees}/${manquees.length}) | lignes jamais lues ${jamaisLues}`
  )
}
ligne('bloc d’origine (Brain de l’époque)', (c) => c.origine)
const cleDe = (c: (typeof cas)[number]): string => c.t.id ?? `${c.t.timestamp}${c.t.conversationId}`
for (const v of VARIANTES) ligne(v, (c) => servi.get(cleDe(c))![v])
ligne('union actuel + mots-clés (≤ 3)', (c) => {
  const s = servi.get(cleDe(c))!
  return [...new Set([...s['message entier (actuel)'], ...s['mots-clés du message']])].slice(0, 3)
})
if (Object.keys(indisponibles).length) console.log('recherches sans réponse :', indisponibles)
if (detail) {
  writeFileSync(
    detail,
    JSON.stringify(
      cas.map((c) => ({
        conversationId: c.t.conversationId,
        turnId: c.t.turnId,
        ouvertes: [...c.ouvertes],
        origine: c.origine,
        requetes: c.requetes,
        servies: servi.get(cleDe(c))
      })),
      null,
      1
    )
  )
  console.log(`détail : ${detail}`)
}
