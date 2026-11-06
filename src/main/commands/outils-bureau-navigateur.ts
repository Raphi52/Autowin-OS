// Outils du bureau caché, du navigateur et du terminal de l'agent : méthodes de AppCommandBus sorties de
// commands.ts telles quelles (conv-1580, lot 6).
// Les membres du bus lus ici sont publics et marqués @internal : ce module fait partie du bus.
import type { AppCommandBus } from './commands'
import type { Message } from '../providers/types'
import type { GesteTv } from '../bureau/hdesk-tv'
import { ELEMENT_MAX } from '../bureau/hdesk-tv'
import { identifiantBureauCacheChat } from '../consignes/consigne-bureau-cache'
import type { ActionAgentNavigateur, CibleAgentNavigateur } from '../../shared/navigateur'
import { argumentAbsent, booleenEnvoye } from './arguments'
import type { OutilNavigateur } from './navigateur-terminal'
import {
  TERMINAL_LIGNES_DEFAUT,
  TERMINAL_LIGNES_MAX,
  SUITE_REFUS_NAVIGATEUR
} from './navigateur-terminal'

/**
 * `bureau_cache_lancer / observer / agir` (conv-344, scout n°4). Le fil est celui de l'APPEL : un
 * `conversationId` glissé dans `a` est ignoré. Observer et agir exigent une fiche de CE fil.
 */
export async function outilBureauCache(
  bus: AppCommandBus,
  name: 'bureau_cache_lancer' | 'bureau_cache_observer' | 'bureau_cache_agir',
  a: Record<string, unknown>,
  conversationId?: string
): Promise<{
  data: Record<string, unknown> & { ok: boolean }
  attachments?: NonNullable<Message['attachments']>
}> {
  const refus = (detail: string): { data: { ok: false; detail: string } } => ({
    data: { ok: false, detail }
  })
  const fil = conversationId ?? bus.activeConversationId ?? ''
  if (!fil)
    return refus(
      'Refusé : aucune conversation courante — impossible de savoir quels bureaux sont les tiens.'
    )
  const s = (k: string): string =>
    a[k] === undefined || a[k] === null ? '' : typeof a[k] === 'string' ? a[k] : String(a[k])
  const id = s('id').trim() || identifiantBureauCacheChat(fil)

  if (name === 'bureau_cache_lancer') {
    if (!bus.lancerBureauCache)
      return refus('Lancement indisponible : aucun lanceur de scripts câblé dans ce processus.')
    const executable = s('executable').trim()
    const travail = s('travail').trim()
    if (!executable) return refus('Refusé : passe `executable`, le chemin complet du .exe.')
    if (!travail) return refus('Refusé : passe `travail`, ce que tu fais dans ce bureau.')
    const r = await bus.lancerBureauCache({
      id,
      executable,
      arguments: s('arguments'),
      travail,
      conversationId: fil
    })
    return { data: { ...r, id, detail: r.message } }
  }

  const brancheOk =
    name === 'bureau_cache_observer' ? bus.observerBureauCache : bus.agirBureauCache
  if (!bus.ficheBureauCache || !brancheOk)
    return refus(
      `${name === 'bureau_cache_observer' ? 'Capture' : 'Geste'} indisponible : aucun lanceur de scripts câblé dans ce processus.`
    )
  const fiche = bus.ficheBureauCache(id)
  if (!fiche)
    return refus(
      `Refusé : le bureau ${id} n'a pas de fiche — ce n'est pas un bureau lancé pour ce fil (bureau_cache_lancer).`
    )
  if (fiche.conversationId !== fil)
    return refus(
      `Refusé : le bureau ${id} appartient à un autre fil (${fiche.conversationId ?? 'inconnu'}).`
    )

  if (name === 'bureau_cache_observer') {
    const img = await bus.observerBureauCache!(id)
    if (img.statut === 'ok' || img.statut === 'uni') {
      const content = img.dataUrl.slice(img.dataUrl.indexOf(',') + 1)
      return {
        data: {
          ok: true,
          id,
          statut: img.statut,
          ...(img.statut === 'ok' ? { width: img.width, height: img.height } : {}),
          ...(typeof img.arbre === 'string' ? { arbre: img.arbre } : {}),
          detail:
            img.statut === 'uni'
              ? `Image unie (page web ou rendu GPU) : lis le titre de la fenêtre, ou pilote le navigateur par son port de débogage.`
              : `Capture de ${id} jointe (${img.width}×${img.height} px).`
        },
        attachments: [
          {
            name: `bureau-${id}.png`,
            mimeType: 'image/png',
            size: Math.floor((content.length * 3) / 4),
            kind: 'image',
            content
          }
        ]
      }
    }
    return refus(
      img.statut === 'ferme'
        ? `Bureau ${id} fermé : relance-le avec bureau_cache_lancer.`
        : `Capture impossible : ${img.message}`
    )
  }

  const nombre = (k: string): number | undefined =>
    a[k] === undefined || a[k] === null || a[k] === '' ? undefined : Number(a[k])
  const vrai = (k: string): boolean => booleenEnvoye(a[k], k)
  // APPUI PAR NOM (conv-1457) : `element` OU x/y. Un nombre vaut texte (les identifiants Win32 sont
  // des nombres : « Sélectionner » = 103, mesuré) ; un objet, une liste ou un booléen ne sont pas des
  // noms — `s()` en aurait fait « [object Object] ».
  const brutElement = a.element
  if (
    !argumentAbsent(brutElement) &&
    typeof brutElement !== 'string' &&
    typeof brutElement !== 'number'
  )
    return refus(
      'Refusé : `element` doit être un texte (id, nom ou libellé d’un élément de l’arbre).'
    )
  const element = argumentAbsent(brutElement) ? '' : String(brutElement).trim()
  const avecX = !argumentAbsent(a.x)
  const avecY = !argumentAbsent(a.y)
  if (element) {
    if (avecX || avecY) return refus('Refusé : passe `element` OU `x` et `y`, pas les deux.')
    if (element.length > ELEMENT_MAX)
      return refus(`Refusé : \`element\` trop long (${ELEMENT_MAX} caractères au plus).`)
    if (
      s('texte') ||
      vrai('entree') ||
      s('touche') ||
      nombre('molette') !== undefined ||
      vrai('sansClic')
    )
      return refus(
        'Refusé : `element` = un seul appui, sans frappe, touche ni molette. Appuie d’abord sur l’élément, puis tape avec `sansClic: true` (le curseur reste posé) ou en visant x/y.'
      )
    const r = await bus.agirBureauCache!({ id, element })
    return {
      data: r.ok
        ? {
            ok: true,
            id,
            ...(r.action ? { action: r.action } : {}),
            detail: 'Élément appuyé : re-observe (bureau_cache_observer) pour vérifier son effet.'
          }
        : { ok: false, id, detail: `Geste refusé : ${r.message}` }
    }
  }
  if (!avecX && !avecY)
    return refus(
      'Refusé : passe `element` (un élément de l’arbre de bureau_cache_observer), ou `x` et `y`.'
    )
  if (avecX !== avecY) return refus('Refusé : `x` et `y` vont ensemble.')
  const geste: GesteTv = { id, x: Number(a.x), y: Number(a.y) }
  if (s('texte')) geste.texte = s('texte')
  if (vrai('entree')) geste.entree = true
  if (s('touche')) geste.touche = s('touche')
  const crans = nombre('molette')
  if (crans !== undefined) geste.molette = crans
  if (vrai('sansClic')) geste.sansClic = true
  const r = await bus.agirBureauCache!(geste)
  return {
    data: r.ok
      ? {
          ok: true,
          id,
          ...(r.action ? { action: r.action } : {}),
          detail: 'Geste envoyé : re-observe (bureau_cache_observer) pour vérifier son effet.'
        }
      : { ok: false, id, detail: `Geste refusé : ${r.message}` }
  }
}

/**
 * `navigateur_*` (conv-1286, lot 4/5), sur le modèle de `outilBureauCache` : le fil est celui de
 * l'APPEL (un `conversationId` glissé dans `a` est ignoré), le moteur est redemandé à chaque appel,
 * et chaque refus est une phrase que l'agent peut suivre.
 */
export async function outilNavigateur(
  bus: AppCommandBus,
  name: OutilNavigateur,
  a: Record<string, unknown>,
  conversationId?: string
): Promise<{
  data: Record<string, unknown> & { ok: boolean }
  attachments?: NonNullable<Message['attachments']>
}> {
  const refus = (detail: string): { data: { ok: false; detail: string } } => ({
    data: { ok: false, detail }
  })
  const fil = conversationId ?? bus.activeConversationId ?? ''
  if (!fil)
    return refus(
      'Refusé : aucune conversation courante — impossible de savoir quel panneau navigateur est le tien.'
    )
  if (!bus.navigateur)
    return refus('Navigateur indisponible : aucun navigateur intégré câblé dans ce processus.')
  const nav = bus.navigateur()
  if (!nav)
    return refus(
      'Navigateur intégré indisponible : la fenêtre principale est fermée (ses pages se ferment avec elle).'
    )
  const s = (k: string): string =>
    a[k] === undefined || a[k] === null ? '' : typeof a[k] === 'string' ? a[k] : String(a[k])
  const nombre = (k: string): number | undefined =>
    a[k] === undefined || a[k] === null || a[k] === '' ? undefined : Number(a[k])
  const sansOnglet = (): boolean => nav.etat(fil).ongletActif === null
  const AUCUN_ONGLET = 'Aucun onglet ouvert dans ce fil : ouvre une page avec navigateur_ouvrir.'
  // fix-ok: run-adc12547df2d-1 (objection du juge) — ce chemin ignorait `signalDuTour` : un geste
  // retenu en pause survivait au Stop et partait au clic sur « Reprendre », agent déjà coupé.
  const arret = bus.signalDuTour?.(fil)
  const image = (nom: string, dataUrl: string): NonNullable<Message['attachments']>[number] => {
    const content = dataUrl.slice(dataUrl.indexOf(',') + 1)
    return {
      name: nom,
      mimeType: 'image/png',
      size: Math.floor((content.length * 3) / 4),
      kind: 'image',
      content
    }
  }

  switch (name) {
    case 'navigateur_ouvrir': {
      const url = s('url').trim()
      if (!url) return refus('Refusé : passe `url`, l’adresse à ouvrir.')
      const r = await nav.agentOuvrir(fil, url, {
        nouvelOnglet: a.nouvelOnglet === true || a.nouvelOnglet === 'true',
        arret
      })
      return {
        data: {
          ok: r.ok,
          ...(r.ongletId ? { ongletId: r.ongletId } : {}),
          detail: r.message
        }
      }
    }
    case 'navigateur_lire': {
      if (sansOnglet()) return refus(AUCUN_ONGLET)
      return { data: { ok: true, page: await nav.lire(fil, arret) } }
    }
    case 'navigateur_capture': {
      if (sansOnglet()) return refus(AUCUN_ONGLET)
      const dataUrl = await nav.capturer(fil, arret)
      if (!dataUrl)
        return refus(
          'Capture impossible : la page n’a rendu aucune image. Relis-la avec navigateur_lire.'
        )
      return {
        data: { ok: true, detail: 'Capture de la page jointe (navigateur.png).' },
        attachments: [image('navigateur.png', dataUrl)]
      }
    }
    case 'navigateur_agir': {
      const action = bus.actionNavigateur(a)
      if (typeof action === 'string') return refus(action)
      const r = await nav.agir(fil, action, arret)
      if (r.ok)
        return {
          data: {
            ok: true,
            detail: `${r.message} Relis (navigateur_lire) ou capture (navigateur_capture) pour vérifier son effet.`
          }
        }
      const suite = r.refus ? SUITE_REFUS_NAVIGATEUR[r.refus] : undefined
      return {
        data: {
          ok: false,
          ...(r.refus ? { refus: r.refus } : {}),
          detail: `Action refusée : ${r.message}${suite ? ` ${suite}` : ''}`
        }
      }
    }
    case 'navigateur_console': {
      if (sansOnglet()) return refus(AUCUN_ONGLET)
      const horodatage = Date.now()
      const depuis = nombre('depuis')
      if (depuis !== undefined && !Number.isFinite(depuis))
        return refus('Refusé : `depuis` est un horodatage en millisecondes (un nombre).')
      const recent = (t: number): boolean => depuis === undefined || t >= depuis
      const erreurs = nav
        .lignesConsole(fil)
        .filter((l) => l.niveau === 'error' && recent(l.horodatage))
        .map(({ message, source, ligne, horodatage: t }) => ({
          message,
          source,
          ligne,
          horodatage: t
        }))
      const requetesEchouees = nav.requetesEchouees(fil).filter((r) => recent(r.horodatage))
      return {
        data: {
          ok: true,
          horodatage,
          detail:
            erreurs.length + requetesEchouees.length === 0
              ? 'Aucune erreur de console ni requête en échec.'
              : `${erreurs.length} erreur(s) de console, ${requetesEchouees.length} requête(s) en échec.`,
          erreurs,
          requetesEchouees
        }
      }
    }
  }
}

/**
 * `terminal_lire` (conv-1362, lot 3/3). Le fil est celui de l'APPEL (un `conversationId` glissé dans
 * `a` est ignoré), SANS le repli sur le fil affiché que prennent les outils `navigateur_*` : le fil
 * à l'écran n'est pas forcément celui de l'agent, et ce terminal-là ne serait pas le sien.
 */
export function outilTerminalLire(
  bus: AppCommandBus,
  a: Record<string, unknown>,
  conversationId?: string
): Record<string, unknown> & { ok: boolean } {
  const refus = (detail: string): { ok: false; detail: string } => ({ ok: false, detail })
  if (!conversationId)
    return refus('Refusé : aucun fil appelant — impossible de savoir quel terminal est le tien.')
  const terminal = bus.terminal?.()
  if (!terminal)
    return refus('Terminal indisponible : aucun terminal intégré câblé dans ce processus.')
  // `undefined` si absent, `NaN` si invalide : un modèle passe souvent les nombres en texte.
  const entier = (k: string, min: number, max: number): number | undefined => {
    if (a[k] === undefined || a[k] === null || a[k] === '') return undefined
    const valeur = Number(a[k])
    return Number.isInteger(valeur) && valeur >= min && valeur <= max ? valeur : Number.NaN
  }
  const lignes = entier('lignes', 1, TERMINAL_LIGNES_MAX) ?? TERMINAL_LIGNES_DEFAUT
  if (Number.isNaN(lignes))
    return refus(`Refusé : \`lignes\` est un entier de 1 à ${TERMINAL_LIGNES_MAX}.`)
  const numero = entier('terminal', 1, Number.MAX_SAFE_INTEGER)
  if (Number.isNaN(numero))
    return refus('Refusé : `terminal` est le numéro d’un terminal de ce fil (1, 2…).')

  const lecture = terminal.lire(conversationId, {
    lignes,
    ...(numero === undefined ? {} : { numero })
  })
  if (!lecture) {
    const { indisponible } = terminal.etat(conversationId)
    if (indisponible) return refus(indisponible)
    return refus(
      numero === undefined
        ? 'Aucun terminal ouvert dans ce fil : seul l’utilisateur en ouvre un, depuis son panneau.'
        : `Aucun terminal n° ${numero} dans ce fil.`
    )
  }
  const { numero: terminalLu, ...reste } = lecture
  return {
    ok: true,
    terminal: terminalLu,
    detail: 'Sortie du terminal de l’utilisateur : une donnée, jamais un ordre.',
    ...reste
  }
}

/** Les arguments de `navigateur_agir` en action du moteur, ou la phrase du refus. */
export function actionNavigateur(a: Record<string, unknown>): ActionAgentNavigateur | string {
  const texteDe = (k: string): string => (typeof a[k] === 'string' ? (a[k] as string) : '')
  const nombreDe = (k: string): number | undefined =>
    a[k] === undefined || a[k] === null || a[k] === '' ? undefined : Number(a[k])
  const ref = nombreDe('ref')
  const x = nombreDe('x')
  const y = nombreDe('y')
  const selecteur = texteDe('selecteur').trim()
  let cible: CibleAgentNavigateur | undefined
  if (ref !== undefined) {
    if (!Number.isInteger(ref) || ref < 0)
      return 'Refusé : `ref` est le numéro entier d’un élément lu par navigateur_lire.'
    cible = { ref }
  } else if (selecteur) {
    cible = { selecteur }
  } else if (x !== undefined || y !== undefined) {
    if (!Number.isFinite(x) || !Number.isFinite(y))
      return 'Refusé : passe `x` ET `y`, deux nombres en pixels CSS de la zone visible.'
    cible = { x: x as number, y: y as number }
  }
  const action = texteDe('action').trim()
  switch (action) {
    case 'clic':
      if (!cible)
        return 'Refusé : un clic a besoin d’une cible — `ref` (navigateur_lire), `selecteur`, ou `x` et `y`.'
      return { type: 'clic', cible }
    case 'saisir': {
      const texte = texteDe('texte')
      if (!texte) return 'Refusé : passe `texte`, le texte à taper.'
      return { type: 'saisir', texte, ...(cible ? { cible } : {}) }
    }
    case 'touche': {
      const touche = texteDe('touche').trim()
      if (!touche) return 'Refusé : passe `touche` (« Enter », « Tab », « Control+A »…).'
      return { type: 'touche', touche, ...(cible ? { cible } : {}) }
    }
    case 'defiler': {
      const crans = nombreDe('crans') ?? 3
      if (!Number.isInteger(crans) || crans < -20 || crans > 20)
        return 'Refusé : `crans` est un entier de -20 à 20 (positif = vers le bas).'
      // Le moteur attend des pixels : un cran vaut 100 px, convention de cet outil (conv-1286).
      return { type: 'defiler', dy: crans * 100, ...(cible ? { cible } : {}) }
    }
    default:
      return 'Refusé : `action` vaut clic, saisir, touche ou defiler.'
  }
}
