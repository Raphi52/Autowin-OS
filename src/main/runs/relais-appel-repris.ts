/**
 * UN TOUR REPRIS APRÈS REDÉMARRAGE MONTRE CE QUE SON MODÈLE FAIT (2026-11-04).
 *
 * Vécu, tour 7fa28264-f4bf-4631-ac72-09baf7994d0b : l'app a redémarré à 20:01:22, 12 s
 * après la 2e action du tour. Le CLI, lancé détaché, a continué seul (15 Mo de sortie en 20 min,
 * des dizaines d'actions et d'étapes, `run-stdout/addf0f1f-….stdout.jsonl`). Le main l'a bien
 * repris (`reprendreAppelChat`, `ipc/chat.ts`), mais n'a fait qu'ATTENDRE son reçu de fin
 * (`waitForRecoverableChatProviderExit`) : le journal du tour s'est arrêté à 20:01:10 et aucune
 * ligne des blocs Actions et Étapes n'est arrivée au fil. « il genere un truc depuis 15 mins j'ai
 * pas de visibilité ».
 *
 * Ce relais lit la sortie du CLI PENDANT l'attente et en tire les MÊMES lignes que le chemin direct
 * (`providers/claude.ts`, `handleEvent`) : `Outil · cible`, `Outil terminé|échoué - durée`, lignes
 * d'étapes (`claude-etapes.ts`), tâches de fond et battements d'outil long. Il ne relaie ni texte
 * ni raisonnement : le texte arrive par la reprise finale, qui le recompose depuis ce qui a déjà
 * été affiché (`streamedPrefixForProviderCall`) — un texte relayé ici et découpé autrement lui
 * ferait jeter la réponse.
 */
import { stat } from 'node:fs/promises'
import { bornerJournalDActions, cibleEntiereDe, statutComplet } from '../../shared/chat-turn'
import { ligneDErreurDAction } from '../../shared/erreur-d-action'
import { redactTrace } from '../../shared/trace-redact'
import { claudeCompteDuFil, withClaudeAccountEnv } from '../providers/claude-accounts'
import { estUnOutilDirectDuChat } from '../chat/chat-mcp'
import {
  dossierDesEtapes,
  estOutilDEtapes,
  etapesSurDisque,
  SuiviDesEtapes,
  type EtapeConnue
} from '../providers/claude-etapes'
import { claudeToolResultText } from '../providers/claude'
import { masquerSortie } from '../providers/sortie-masquee'
import { masquerValeurs } from '../app/coffre-cles'
import type { RecoverableChatProviderCall } from './chat-provider-recovery'
import { tailJsonLines } from './stdout-journal'
import { appendTurnEvent, readTurnJournal, type TurnJournalEvent } from './turn-journal'
import { dureeLisible } from '../../shared/duree-lisible'

/** Une ligne pour le bloc Actions : le libellé court, et la cible entière quand il l'a rognée. */
export interface LigneDAction {
  text: string
  target?: string
  /** Ligne d'avant le redémarrage, renvoyée à l'écran : déjà au journal du tour, ne s'y réécrit pas. */
  rejouee?: boolean
}

/** Même coupure que le chemin direct : le libellé tient sur une ligne de l'en-tête du bloc. */
const LONGUEUR_CIBLE = 120

/** Même préfixe retiré que `resumerCommandeDeFond` de `claude.ts`. */
function resumerCommandeDeFond(brut: string): string {
  return brut.replace(/^cd\s+"?\$\(pwd\)"?\s*&&\s*/i, '').trim()
}

/** L'immense majorité des lignes (fragments du flux, compte de pensée) : écartées sans les lire. */
function estDuBruit(ligne: string): boolean {
  return (
    ligne.startsWith('{"type":"stream_event"') ||
    ligne.startsWith('{"type":"system","subtype":"thinking_tokens"')
  )
}

type Objet = Record<string, unknown>

function objet(valeur: unknown): Objet | undefined {
  return valeur && typeof valeur === 'object' && !Array.isArray(valeur)
    ? (valeur as Objet)
    : undefined
}

/**
 * Le flux brut du CLI Claude (`stream-json`) → lignes du bloc Actions et du bloc Étapes.
 *
 * `enDirect` faux = RATTRAPAGE de ce qui était déjà écrit : l'heure de lecture n'est pas celle de
 * l'action, donc ni durée ni battement — « Bash terminé », jamais un « 0 s » inventé.
 */
export class LignesDuFluxClaude {
  private readonly outils = new Map<string, { nom: string; debut?: number }>()
  private readonly commandes = new Map<string, string>()
  private readonly surveillances = new Set<string>()
  private readonly appelsArret = new Map<string, string>()
  private readonly arretsDemandes = new Set<string>()
  private readonly chantiers = new Set<string>()
  private readonly etapes: SuiviDesEtapes
  private session: string | undefined

  constructor(
    lireEtapes: (session: string | undefined) => EtapeConnue[],
    private readonly maintenant: () => number = Date.now
  ) {
    this.etapes = new SuiviDesEtapes(() => lireEtapes(this.session))
  }

  recevoir(ligne: string, enDirect: boolean): LigneDAction[] {
    if (estDuBruit(ligne)) return []
    let o: Objet | undefined
    try {
      o = objet(JSON.parse(ligne))
    } catch {
      return []
    }
    if (!o) return []
    const type = o['type']
    if (type === 'system' && o['subtype'] === 'init' && typeof o['session_id'] === 'string') {
      this.session = o['session_id']
      return []
    }
    if (type === 'tool_progress') return enDirect ? this.battement(o) : []
    if (
      type === 'system' &&
      (o['subtype'] === 'task_started' || o['subtype'] === 'task_notification')
    )
      return this.tacheDeFond(o)
    if (type === 'assistant') return this.appels(o, enDirect)
    if (type === 'user') return this.resultats(o, enDirect)
    return []
  }

  private battement(o: Objet): LigneDAction[] {
    const ecoule = Number(o['elapsed_time_seconds'])
    if (!Number.isFinite(ecoule) || ecoule <= 0) return []
    const outil = typeof o['tool_name'] === 'string' && o['tool_name'] ? o['tool_name'] : 'outil'
    const id = typeof o['tool_use_id'] === 'string' ? o['tool_use_id'] : ''
    let cible = id ? (this.commandes.get(id) ?? '') : ''
    if (!cible)
      for (const [autre, appel] of this.outils)
        if (appel.nom === outil && this.commandes.get(autre)) cible = this.commandes.get(autre)!
    const detail = resumerCommandeDeFond(cible)
    return [
      {
        text: detail
          ? `${outil} en cours - ${dureeLisible(ecoule)} - ${detail}`
          : `${outil} en cours - ${dureeLisible(ecoule)}`,
        ...(detail ? { target: detail } : {})
      }
    ]
  }

  private tacheDeFond(o: Objet): LigneDAction[] {
    const demarre = o['subtype'] === 'task_started'
    const idTache = String(o['task_id'] ?? '')
    // Un gros chantier (`Workflow`) a ses propres lignes côté direct (`claude-chantier.ts`).
    if (demarre && o['task_type'] === 'local_workflow') this.chantiers.add(idTache)
    if (this.chantiers.has(idTache)) return []
    const commande = resumerCommandeDeFond(
      String((demarre ? o['description'] : o['summary']) ?? '').trim()
    )
    if (demarre)
      return [
        { text: commande ? `tache de fond en cours - ${commande}` : 'tache de fond en cours' }
      ]
    const statut = String(o['status'] ?? '').toLowerCase()
    const surveillance = this.surveillances.has(String(o['tool_use_id'] ?? ''))
    const arretVoulu = statut === 'stopped' && (surveillance || this.arretsDemandes.has(idTache))
    const issue =
      statut === 'completed' || arretVoulu
        ? 'terminee'
        : statut === 'failed'
          ? 'en echec'
          : statut || 'terminee'
    return [{ text: commande ? `tache de fond ${issue} - ${commande}` : `tache de fond ${issue}` }]
  }

  private appels(o: Objet, enDirect: boolean): LigneDAction[] {
    const contenu = objet(o['message'])?.['content']
    if (!Array.isArray(contenu)) return []
    const lignes: LigneDAction[] = []
    for (const brut of contenu) {
      const part = objet(brut)
      if (part?.['type'] !== 'tool_use') continue
      const id = typeof part['id'] === 'string' ? part['id'] : ''
      const nom = typeof part['name'] === 'string' ? part['name'] : ''
      if (!id || !nom) continue
      const entree = objet(part['input']) ?? {}
      if (estOutilDEtapes(nom)) {
        for (const ligne of this.etapes.appel(id, nom, entree)) lignes.push({ text: ligne })
        continue
      }
      const chemin = String(entree['file_path'] ?? '')
      const commande = String(entree['command'] ?? chemin)
      if (nom === 'Bash' && typeof entree['command'] === 'string')
        this.commandes.set(id, entree['command'])
      if (nom === 'Monitor') this.surveillances.add(id)
      if (nom === 'TaskStop') {
        const visee = String(entree['task_id'] ?? entree['shell_id'] ?? '')
        this.appelsArret.set(id, visee)
        this.arretsDemandes.add(visee)
      }
      this.outils.set(id, { nom, ...(enDirect ? { debut: this.maintenant() } : {}) })
      const cibleEntiere = chemin || commande || (this.appelsArret.get(id) ?? '')
      const cible = cibleEntiere.slice(0, LONGUEUR_CIBLE)
      lignes.push({
        text: `${nom}${cible ? ` · ${cible}` : ''}`,
        ...(cible.length < cibleEntiere.length ? { target: cibleEntiere } : {})
      })
    }
    // Un outil direct de l'app a déjà sa carte d'action : le chemin direct ne relaie pas sa ligne.
    return lignes.filter((ligne) => !estUnOutilDirectDuChat(ligne.text))
  }

  private resultats(o: Objet, enDirect: boolean): LigneDAction[] {
    const contenu = objet(o['message'])?.['content']
    if (!Array.isArray(contenu)) return []
    const parts = contenu.map(objet).filter((p): p is Objet => p?.['type'] === 'tool_result')
    const structure = parts.length === 1 ? o['tool_use_result'] : undefined
    const lignes: LigneDAction[] = []
    for (const part of parts) {
      const id = typeof part['tool_use_id'] === 'string' ? part['tool_use_id'] : ''
      if (!id) continue
      const enErreur = part['is_error'] === true
      const visee = this.appelsArret.get(id)
      if (visee !== undefined) {
        this.appelsArret.delete(id)
        if (enErreur) this.arretsDemandes.delete(visee)
      }
      const retour = claudeToolResultText(part['content'])
      const lignesEtapes = this.etapes.resultat(id, enErreur, structure, retour)
      if (lignesEtapes) {
        for (const ligne of lignesEtapes) lignes.push({ text: ligne })
        continue
      }
      const appel = this.outils.get(id)
      if (!appel) continue
      this.outils.delete(id)
      this.commandes.delete(id)
      const duree =
        enDirect && appel.debut !== undefined
          ? ` - ${dureeLisible((this.maintenant() - appel.debut) / 1000)}`
          : ''
      lignes.push({ text: `${appel.nom} ${enErreur ? 'échoué' : 'terminé'}${duree}` })
      const erreur = enErreur
        ? ligneDErreurDAction(appel.nom, String(redactTrace(retour)))
        : undefined
      if (erreur) lignes.push({ text: erreur })
    }
    // Un outil direct de l'app a déjà sa carte d'action : le chemin direct ne relaie pas sa ligne.
    return lignes.filter((ligne) => !estUnOutilDirectDuChat(ligne.text))
  }
}

/** Clé de comparaison : une ligne de fin se compare sans sa durée, que le rattrapage n'a pas. */
function cle(ligne: string): string {
  const fin = /^(.+?) (terminé|échoué)(?: - .*)?$/.exec(ligne)
  return fin ? `${fin[1]} ${fin[2]}` : ligne
}

/**
 * Ce qui est déjà au fil : lu dans le journal du tour, en avançant dans l'ordre.
 *
 * Le journal porte un PRÉFIXE du flux direct, plus des lignes que le rattrapage ne produit pas
 * (battements, nouvelles tentatives d'API) : on les saute. Dès qu'une ligne produite n'y est pas,
 * le rattrapage a dépassé ce que l'écran avait reçu, et tout ce qui suit est nouveau.
 */
export class DejaAuFil {
  private curseur = 0
  private depasse: boolean

  constructor(private readonly lignes: readonly string[]) {
    this.depasse = lignes.length === 0
  }

  contient(ligne: string): boolean {
    if (this.depasse) return false
    const cherchee = cle(ligne)
    for (let rang = this.curseur; rang < this.lignes.length; rang += 1) {
      if (cle(this.lignes[rang]) !== cherchee) continue
      this.curseur = rang + 1
      return true
    }
    this.depasse = true
    return false
  }
}

/** Les lignes du bloc Actions déjà écrites pour CET appel (après son `provider-journal`). */
export function lignesDejaAuFil(
  evenements: readonly TurnJournalEvent[],
  token: string
): LigneDAction[] {
  let lignes: LigneDAction[] = []
  for (const evenement of evenements) {
    if (evenement.kind === 'provider-journal') {
      lignes = evenement.token === token ? [] : lignes
      continue
    }
    if (evenement.kind !== 'provider-status' || typeof evenement.text !== 'string') continue
    const cible = cibleEntiereDe(evenement.data)
    lignes.push({ text: evenement.text, ...(cible ? { target: cible } : {}) })
  }
  return lignes
}

export interface RelaisAppelRepris {
  /** Lit ce qui reste, enregistre le journal d'actions complet, puis rend la main. */
  arreter(): Promise<void>
}

/** Une vague de lignes par 3 s au plus : chacune réécrit le journal d'actions entier du tour. */
const PAS_D_ENVOI_MS = 3_000

/**
 * Suit la sortie d'un appel de chat repris jusqu'à `arreter()`.
 *
 * ORDRE D'UNE VAGUE : le journal d'actions COMPLET d'abord (`enregistrer`), les lignes en direct
 * ensuite (`envoyer`). L'écran qui adopte le tour remplace son état direct par la copie enregistrée
 * (`adopterLeTourPersiste`) : enregistrée la première, elle contient déjà tout ce qu'il a reçu.
 */
export function relayerAppelRepris(options: {
  provider: string
  journalPath: string
  dejaAuFil: readonly LigneDAction[]
  /** Lignes déjà dans le journal d'actions ENREGISTRÉ du tour : l'écran les relit, on ne les renvoie pas. */
  dejaEnregistrees?: number
  lireEtapes: (session: string | undefined) => EtapeConnue[]
  /** Le journal d'actions complet du tour, lignes entières (`statutComplet`). */
  enregistrer: (lignes: string[]) => void
  envoyer: (lignes: LigneDAction[]) => void
  pasDEnvoiMs?: number
  pollMs?: number
}): RelaisAppelRepris {
  // Seul le flux `stream-json` de Claude est lu ici ; un autre fournisseur garde l'attente seule.
  if (options.provider !== 'claude') return { arreter: async () => undefined }
  const lecteur = new LignesDuFluxClaude(options.lireEtapes)
  // Ce relais relit `run-stdout/` sur le disque : sa sortie ne passe pas par la pompe du routeur qui
  // masque celle des moteurs (`sortie-masquee.ts`). Il masque donc lui-même, comme elle : une valeur
  // du coffre devient `[secret:NOM]`, au fil comme au journal du tour. Les lignes d'avant le
  // redémarrage aussi, car un relais plus ancien a pu les enregistrer en clair.
  const dejaAuFil = options.dejaAuFil.map((ligne) => masquerSortie(ligne))
  const deja = new DejaAuFil(dejaAuFil.map((ligne) => ligne.text))
  const journal = dejaAuFil.map((ligne) => statutComplet(ligne.text, ligne.target))
  // Les lignes d'avant le redémarrage partent aussi : l'écran relancé ne les a jamais reçues, sauf
  // celles qu'un relais précédent a déjà enregistrées (second redémarrage pendant le même tour).
  let enAttente: LigneDAction[] = dejaAuFil
    .slice(options.dejaEnregistrees ?? 0)
    .map((ligne) => ({ ...ligne, rejouee: true }))
  let fini = false
  let minuteur: ReturnType<typeof setTimeout> | undefined

  const vider = (): void => {
    minuteur = undefined
    if (enAttente.length === 0) return
    const vague = enAttente
    enAttente = []
    try {
      options.enregistrer(bornerJournalDActions(journal))
      options.envoyer(vague)
    } catch {
      /* relais best-effort : ne jamais casser la reprise pour une ligne d'affichage */
    }
  }
  const planifier = (): void => {
    if (minuteur || fini) return
    minuteur = setTimeout(vider, options.pasDEnvoiMs ?? PAS_D_ENVOI_MS)
    minuteur.unref?.()
  }
  if (enAttente.length > 0) planifier()

  let tailleInitiale = Number.POSITIVE_INFINITY
  let octetsLus = 0
  const suivi = stat(options.journalPath)
    .then(
      (etat) => (tailleInitiale = etat.size),
      () => (tailleInitiale = 0)
    )
    .then(() =>
      tailJsonLines(
        options.journalPath,
        (ligne) => {
          octetsLus += Buffer.byteLength(ligne, 'utf8') + 1
          try {
            // Masquée AVANT la lecture : le libellé est rogné à 120 caractères, et une valeur coupée
            // par ce rognage ne serait plus reconnue ensuite. La ligne produite l'est encore, pour une
            // valeur que l'échappement JSON aurait cachée dans la ligne brute.
            const lue = masquerValeurs(ligne)
            for (const brute of lecteur.recevoir(lue, octetsLus > tailleInitiale)) {
              const produite = masquerSortie(brute)
              if (deja.contient(produite.text)) continue
              journal.push(statutComplet(produite.text, produite.target))
              enAttente.push(produite)
            }
          } catch {
            /* une ligne illisible ne coupe jamais le suivi */
          }
          if (enAttente.length > 0) planifier()
        },
        { pollMs: options.pollMs ?? 250, isComplete: () => fini }
      )
    )
    .catch(() => undefined)

  return {
    arreter: async () => {
      fini = true
      await suivi
      if (minuteur) clearTimeout(minuteur)
      vider()
    }
  }
}

/** Ligne d'action telle que le fil la reçoit en direct (`pilot:event`, même forme qu'agent-pilot). */
export interface StatutRelaye {
  kind: 'provider-status'
  iteration: number
  text: string
  data?: { target: string }
  at: number
}

/**
 * Le relais branché sur un appel de chat repris : lignes déjà vues lues dans le journal du tour,
 * étapes lues dans le dossier du compte du fil, et chaque ligne nouvelle écrite au journal du tour
 * (une reprise suivante la saura déjà au fil) avant de partir à l'écran.
 */
export function relayerAppelChatRepris(
  call: Pick<
    RecoverableChatProviderCall,
    'conversationId' | 'turnId' | 'provider' | 'token' | 'journalPath' | 'iteration'
  >,
  deps: {
    racineJournaux: string
    /** Le journal d'actions déjà enregistré pour ce tour dans la conversation. */
    actionsEnregistrees: () => readonly string[] | undefined
    enregistrer: (lignes: string[]) => void
    versLeFil: (evenement: StatutRelaye) => void
  }
): RelaisAppelRepris {
  let dejaAuFil: LigneDAction[] = []
  try {
    dejaAuFil = lignesDejaAuFil(
      readTurnJournal(deps.racineJournaux, call.conversationId, call.turnId),
      call.token
    )
  } catch {
    /* journal illisible : tout ce que le CLI a écrit repart, au pire en double */
  }
  const env = withClaudeAccountEnv(process.env, claudeCompteDuFil(call.conversationId)?.env)
  return relayerAppelRepris({
    provider: call.provider,
    journalPath: call.journalPath,
    dejaAuFil,
    dejaEnregistrees: deps.actionsEnregistrees()?.length ?? 0,
    lireEtapes: (session) => (session ? etapesSurDisque(dossierDesEtapes(session, env)) : []),
    enregistrer: deps.enregistrer,
    envoyer: (lignes) => {
      for (const ligne of lignes) {
        const evenement: StatutRelaye = {
          kind: 'provider-status',
          iteration: call.iteration,
          text: ligne.text,
          ...(ligne.target ? { data: { target: ligne.target } } : {}),
          at: Date.now()
        }
        if (!ligne.rejouee)
          appendTurnEvent(deps.racineJournaux, call.conversationId, call.turnId, { ...evenement })
        deps.versLeFil(evenement)
      }
    }
  })
}
