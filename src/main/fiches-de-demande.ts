/**
 * LES RUN.md LÉGERS — une fiche par nouvelle demande (conv-1418, 2026-11-01).
 *
 * Demande : « fais écrire par l'app un RUN.md léger à chaque nouvelle demande, à la fin du tour et
 * sans appel au modèle, avec les suites ajoutées au même fichier ». Mesuré le même jour : 33 fils
 * sur 330 avaient un RUN.md, parce que seul un run lancé en créait un.
 *
 * TROIS CHOIX, CHACUN CONTRE UN PIÈGE :
 *  - Un dossier À PART, `demandes/`, jamais `runs/` : sept lecteurs parcourent `runs/<fil>/` (tableau
 *    des runs, clôture des runs ouverts, nettoyage, mémoire des runs, contrat du fil, Kaizen…) et
 *    prendraient une fiche pour un vrai run, ouvert ou bloqué.
 *  - L'état vient de `demandesDuFil`, le calcul du Board : jamais un avis de l'agent. Le classement
 *    nouvelle demande / suite vient de la ligne `AUTOWIN_BESOIN_V1` déjà relevée par le journal.
 *  - Le texte s'AJOUTE en fin de fichier ; seules `status:` et `maj:` de l'en-tête sont réécrites.
 *    Rien ne relit donc le texte de l'utilisateur, qui peut contenir n'importe quel titre Markdown.
 *
 * `index.jsonl` (une ligne par tour, sans aucun texte) dit quelle fiche porte quel message. C'est la
 * liste courte qui évite d'ouvrir chaque RUN.md, et ce que `ecarts-des-fiches.ts` compare au Board.
 *
 * Tout passe par une seule file : deux fins de tour simultanées peuvent viser la même fiche
 * (`suite conv-NNN`). FAIL-OPEN : un échec ne touche jamais la réponse (appelant, `index.ts`).
 *
 * UNE BRANCHE DU FIL (« façon 1/3 », « revenir à ce tour ») recopie ses demandes sous des identifiants
 * neufs, et aucun tour ne finit dessus dans la branche : sans `rattacherLaBranche`, elles restaient
 * sans fiche (les 3 seuls « sans fiche » de `ecarts.json`, conv-1425 à 1427 — conv-1441). Une ligne
 * `copie` les fait pointer sur la fiche d'origine, sans rien écrire dans son RUN.md.
 */
import { appendFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { LIBELLES_STATUT } from '../renderer/src/components/carte-du-fil'
import { STATUTS_DEMANDE, type StatutDemande } from '../shared/carte-des-besoins'
import type { FicheDeDemande, FichesDesDemandes } from '../shared/fiche-de-demande'
import type { LigneBesoin } from '../shared/ligne-besoin'
import { demandesDuFil, type ConversationPourLaCarte } from './carte-des-besoins'
import { supprimerArbre } from './fs-supprimer'
import { cleDuJournal, type EvenementDuJournal } from './journal-des-besoins'
import { slugify } from './runs/conv-runs'

export const DOSSIER_DES_FICHES = 'demandes'
export const INDEX_DES_FICHES = 'index.jsonl'

/** `declare` : l'agent l'a dit. `deduit` : sa ligne manque (9 % des tours) ou ne trouve pas de fiche. */
export type ClassementDeLaFiche = 'declare' | 'deduit'

export interface LigneDeFiche {
  v: 1
  ts: number
  /** Le RUN.md, relatif à `demandes/`, toujours avec des `/`. */
  fiche: string
  conversationId: string
  messageId: string
  /** Heure du message de l'utilisateur : le Board n'est comparé qu'à partir de la première. */
  demandeLe?: number
  /** `copie` : la demande recopiée dans une branche du fil, qui pointe sur la fiche d'origine. */
  role: 'besoin' | 'suite' | 'copie'
  classement: ClassementDeLaFiche
  etat: StatutDemande
  constat: string
}

interface RetraitDuFil {
  v: 1
  ts: number
  retraitDuFil: string
}

export interface IndexDesFiches {
  parMessage: Map<string, LigneDeFiche>
  /** La dernière fiche que chaque fil a nourrie : c'est là que sa prochaine suite s'ajoute. */
  ficheDuFil: Map<string, string>
}

export interface TourPourLaFiche {
  evenement: Pick<
    EvenementDuJournal,
    'conversationId' | 'messageId' | 'demandeLe' | 'demandeur' | 'besoin'
  >
  conversation: ConversationPourLaCarte | undefined
}

/** Un identifiant de fil devient un nom de dossier : rien qui puisse sortir de `demandes/`. */
const FIL_LISIBLE = /^[\w-]+$/u

function appliquer(index: IndexDesFiches, ligne: LigneDeFiche | RetraitDuFil): void {
  if ('retraitDuFil' in ligne) {
    const fil = ligne.retraitDuFil
    const partie = (l: LigneDeFiche): boolean =>
      l.conversationId === fil || l.fiche.startsWith(`${fil}/`)
    for (const [cle, l] of index.parMessage) if (partie(l)) index.parMessage.delete(cle)
    index.ficheDuFil.delete(fil)
    for (const [autre, fiche] of index.ficheDuFil)
      if (fiche.startsWith(`${fil}/`)) index.ficheDuFil.delete(autre)
    return
  }
  index.parMessage.set(cleDuJournal(ligne.conversationId, ligne.messageId), ligne)
  // Une copie rattachée APRÈS coup (branche née avant conv-1441) ne détourne pas la suite d'une
  // branche qui a déjà sa propre fiche ; tant qu'elle n'en a pas, la dernière copie l'emporte.
  if (ligne.role === 'copie') {
    const fil = ligne.conversationId
    for (const autre of index.parMessage.values())
      if (autre.conversationId === fil && autre.role !== 'copie') return
  }
  index.ficheDuFil.set(ligne.conversationId, ligne.fiche)
}

function estLigne(valeur: unknown): valeur is LigneDeFiche | RetraitDuFil {
  if (!valeur || typeof valeur !== 'object') return false
  const l = valeur as Partial<LigneDeFiche & RetraitDuFil>
  if (l.v !== 1) return false
  return (
    typeof l.retraitDuFil === 'string' ||
    (typeof l.fiche === 'string' &&
      typeof l.conversationId === 'string' &&
      typeof l.messageId === 'string')
  )
}

/** Relit l'index ligne à ligne ; une ligne abîmée (écriture coupée) est sautée, pas fatale. */
export function lireIndexDesFiches(texte: string): IndexDesFiches {
  const index: IndexDesFiches = { parMessage: new Map(), ficheDuFil: new Map() }
  for (const ligne of texte.split('\n')) {
    if (!ligne.trim()) continue
    try {
      const valeur: unknown = JSON.parse(ligne)
      if (estLigne(valeur)) appliquer(index, valeur)
    } catch {
      // Écriture coupée par un arrêt brutal : les lignes suivantes restent bonnes.
    }
  }
  return index
}

/**
 * Où ranger une demande pas encore rangée. Une suite sans fiche (fil plus ancien que ce module) et
 * une ligne de besoin absente ne sont jamais perdues : elles ouvrent ou rejoignent une fiche, marquée
 * `deduit` pour que la mesure les compte.
 */
export function placerLaDemande(
  besoin: LigneBesoin | null,
  conversationId: string,
  index: Pick<IndexDesFiches, 'ficheDuFil'>
): { fiche?: string; classement: ClassementDeLaFiche } {
  if (besoin?.nature === 'nouveau') return { classement: 'declare' }
  const visee = besoin?.de ? index.ficheDuFil.get(besoin.de) : undefined
  const fiche = visee ?? index.ficheDuFil.get(conversationId)
  if (!fiche) return { classement: 'deduit' }
  const annoncee = besoin?.nature === 'suite' && (!besoin.de || visee !== undefined)
  return { fiche, classement: annoncee ? 'declare' : 'deduit' }
}

/** Ce que `fork()` du store note sur une branche : le fil et le message d'où elle part. */
export type BranchePourLaFiche = ConversationPourLaCarte & {
  forkedFrom?: { conversationId: string; messageId: string }
}

/**
 * Les messages qu'une branche a recopiés de sa source : identifiant dans la branche → dans la source.
 * `fork()` recopie dans l'ordre jusqu'au message d'origine inclus et ne change que les identifiants :
 * chaque paire a donc le même rôle, la même heure et le même texte. Au moindre écart (fil réécrit
 * depuis), rien n'est apparié : une demande sans fiche vaut mieux qu'une fiche fausse.
 */
export function messagesRecopies(
  branche: BranchePourLaFiche,
  source: ConversationPourLaCarte
): Map<string, string> {
  const aucun = new Map<string, string>()
  const origine = branche.forkedFrom
  if (!origine || origine.conversationId !== source.id) return aucun
  const coupe = source.messages.findIndex((message) => message.messageId === origine.messageId)
  if (coupe < 0 || branche.messages.length <= coupe) return aucun
  const paires = new Map<string, string>()
  for (let rang = 0; rang <= coupe; rang += 1) {
    const dansLaSource = source.messages[rang]
    const dansLaBranche = branche.messages[rang]
    if (
      !dansLaSource ||
      !dansLaBranche ||
      dansLaSource.role !== dansLaBranche.role ||
      dansLaSource.ts !== dansLaBranche.ts ||
      (dansLaSource.content ?? '') !== (dansLaBranche.content ?? '')
    )
      return aucun
    if (dansLaSource.messageId && dansLaBranche.messageId)
      paires.set(dansLaBranche.messageId, dansLaSource.messageId)
  }
  return paires
}

const horodatage = (ms: number): string =>
  `${new Date(ms).toISOString().slice(0, 16).replace('T', ' ')} UTC`

const uneLigne = (texte: string): string => texte.replace(/\s+/gu, ' ').trim()

const ligneDeResultat = (quand: number, etat: StatutDemande, constat: string): string =>
  `\nRésultat (${horodatage(quand)}) : ${LIBELLES_STATUT[etat]} — ${uneLigne(constat)}\n`

export function ficheNeuve(entree: {
  conversationId: string
  messageId: string
  demandeur?: string
  dossier?: string
  classement: ClassementDeLaFiche
  texte: string
  etat: StatutDemande
  constat: string
  quand: number
}): string {
  const iso = new Date(entree.quand).toISOString()
  return `${[
    `status: ${entree.etat}`,
    `session: ${entree.conversationId}`,
    'regime: leger',
    `demande: ${entree.messageId}`,
    ...(entree.demandeur ? [`demandeur: ${uneLigne(entree.demandeur)}`] : []),
    ...(entree.dossier ? [`dossier: ${uneLigne(entree.dossier)}`] : []),
    `classement: ${entree.classement}`,
    `cree: ${iso}`,
    `maj: ${iso}`,
    '',
    '## Besoin',
    entree.texte
  ].join('\n')}\n${ligneDeResultat(entree.quand, entree.etat, entree.constat)}`
}

/** Réécrit l'état dans l'en-tête seul : le texte de l'utilisateur commence après la première ligne vide. */
export function ficheMiseAJour(texte: string, etat: StatutDemande, quand: number): string {
  const fin = texte.indexOf('\n\n')
  if (fin < 0) return texte
  const entete = texte
    .slice(0, fin)
    .replace(/^status: .*$/mu, `status: ${etat}`)
    .replace(/^maj: .*$/mu, `maj: ${new Date(quand).toISOString()}`)
  return `${entete}${texte.slice(fin)}`
}

/**
 * L'état et le titre d'une fiche, lus sur son RUN.md (conv-1441) : l'état de l'EN-TÊTE seul — un
 * texte d'utilisateur qui écrit « status: » plus bas ne compte pas —, le titre = la première ligne
 * non vide sous `## Besoin`.
 */
export function resumeDeLaFiche(texte: string): { statut?: StatutDemande; titre: string } {
  const fin = texte.indexOf('\n\n')
  const entete = fin < 0 ? texte : texte.slice(0, fin)
  const lu = /^status: (.+)$/mu.exec(entete)?.[1]?.trim()
  const statut = STATUTS_DEMANDE.find((s) => s === lu)
  const titreDuBesoin = '\n## Besoin\n'
  const debut = texte.indexOf(titreDuBesoin)
  const besoin = debut < 0 ? '' : texte.slice(debut + titreDuBesoin.length)
  const titre = uneLigne(besoin.split('\n').find((ligne) => ligne.trim()) ?? '').slice(0, 120)
  return { ...(statut ? { statut } : {}), titre }
}

export function creerFichesDeDemande(deps: { racine: string; maintenant?: () => number }): {
  /** Range le tour qui vient de finir ; `null` = rien à ranger (question, tour sans demande). */
  noterTour: (tour: TourPourLaFiche) => Promise<LigneDeFiche | null>
  /**
   * Fait pointer les demandes recopiées dans une branche sur la fiche de leur original. Rend le
   * nombre de lignes ajoutées ; rejouée, elle n'ajoute rien.
   */
  rattacherLaBranche: (entree: {
    branche: BranchePourLaFiche
    source: ConversationPourLaCarte
  }) => Promise<number>
  /** Une ligne par demande rangée, pour la mesure. */
  lignes: () => Promise<LigneDeFiche[]>
  /**
   * Les fiches qu'un fil a nourries, la plus récente d'abord : les siennes, et celle d'un autre fil
   * quand il y a rangé une suite (un lot de chantier). Le panneau RUN.md du fil les liste (conv-1441).
   */
  fichesDuFil: (conversationId: string) => Promise<FicheDeDemande[]>
  /** La fiche de chaque demande rangée : le lien des post-it du Board (conv-1441). */
  fichesDesDemandes: () => Promise<FichesDesDemandes>
  /**
   * La même chose pour le calcul du Board (conv-1456), sous la clé du journal (`cleDuJournal`) et
   * relative à `demandes/` : c'est elle qui fait le post-it. Aucun RUN.md n'est ouvert.
   */
  fichesParDemande: () => Promise<Map<string, string>>
  /** Un fil supprimé emporte ses fiches, comme ses autres fichiers. */
  retirerLeFil: (conversationId: string) => Promise<void>
} {
  const dossier = join(deps.racine, DOSSIER_DES_FICHES)
  const cheminIndex = join(dossier, INDEX_DES_FICHES)
  const maintenant = deps.maintenant ?? Date.now
  let memoire: IndexDesFiches | null = null
  let file: Promise<unknown> = Promise.resolve()

  function enFile<T>(travail: () => Promise<T>): Promise<T> {
    const tour = file.then(travail)
    file = tour.catch(() => undefined)
    return tour
  }

  async function chargerIndex(): Promise<IndexDesFiches> {
    if (memoire) return memoire
    let texte = ''
    try {
      texte = await readFile(cheminIndex, 'utf8')
    } catch (erreur) {
      // Absent avant la toute première fiche. Toute autre panne remonte : repartir d'un index vide
      // ferait croire que chaque suite n'a pas de fiche.
      if ((erreur as NodeJS.ErrnoException).code !== 'ENOENT') throw erreur
    }
    memoire = lireIndexDesFiches(texte)
    return memoire
  }

  async function enregistrer(
    index: IndexDesFiches,
    ligne: LigneDeFiche | RetraitDuFil
  ): Promise<void> {
    await mkdir(dossier, { recursive: true })
    await appendFile(cheminIndex, `${JSON.stringify(ligne)}\n`, 'utf8')
    appliquer(index, ligne)
  }

  /** Ajoute à une fiche existante ; `false` = son RUN.md a disparu du disque. */
  async function ajouter(
    fiche: string,
    ajout: string,
    etat: StatutDemande,
    quand: number
  ): Promise<boolean> {
    const chemin = join(dossier, fiche)
    let texte: string
    try {
      texte = await readFile(chemin, 'utf8')
    } catch (erreur) {
      if ((erreur as NodeJS.ErrnoException).code === 'ENOENT') return false
      throw erreur
    }
    await writeFile(chemin, `${ficheMiseAJour(texte, etat, quand)}${ajout}`, 'utf8')
    return true
  }

  return {
    async noterTour({ evenement, conversation }) {
      const { conversationId, messageId } = evenement
      if (!FIL_LISIBLE.test(conversationId)) return null
      // Hors de la file : l'état dit ce que le fil montre à la fin de CE tour.
      const demande = conversation
        ? demandesDuFil(conversation).find((d) => d.messageId === messageId)
        : undefined
      // Ni compactage ni consigne interne : ce que le Board ne montre pas n'a pas de fiche.
      if (!demande) return null
      return enFile(async () => {
        const index = await chargerIndex()
        const deja = index.parMessage.get(cleDuJournal(conversationId, messageId))
        const quand = maintenant()
        const demandeLe = evenement.demandeLe ?? demande.debut
        const commun = {
          v: 1 as const,
          ts: quand,
          conversationId,
          messageId,
          ...(demandeLe === undefined ? {} : { demandeLe }),
          etat: demande.statut,
          constat: demande.constat
        }
        const resultat = ligneDeResultat(quand, demande.statut, demande.constat)

        // Reprise ou continuation du MÊME message : on met l'état à jour, sans refaire de bloc.
        if (deja) {
          if (deja.etat === demande.statut && deja.constat === demande.constat) return deja
          await ajouter(deja.fiche, resultat, demande.statut, quand)
          const ligne: LigneDeFiche = { ...deja, ...commun }
          await enregistrer(index, ligne)
          return ligne
        }

        // Une question n'est pas une tâche : le Board la montre, elle n'ouvre pas de fiche.
        if (evenement.besoin?.nature === 'aucun') return null

        const texte = demande.texte ?? demande.titre
        const place = placerLaDemande(evenement.besoin, conversationId, index)
        if (place.fiche) {
          const bloc = `\n## Suite (${horodatage(quand)}, ${conversationId})\n${texte}\n${resultat}`
          if (await ajouter(place.fiche, bloc, demande.statut, quand)) {
            const ligne: LigneDeFiche = {
              ...commun,
              fiche: place.fiche,
              role: 'suite',
              classement: place.classement
            }
            await enregistrer(index, ligne)
            return ligne
          }
        }

        const fiche = `${conversationId}/${slugify(texte)}-${quand.toString(36)}/RUN.md`
        // Une fiche disparue du disque : sa suite repart sur une neuve, marquée déduite.
        const classement = place.fiche ? 'deduit' : place.classement
        const chemin = join(dossier, fiche)
        await mkdir(dirname(chemin), { recursive: true })
        await writeFile(
          chemin,
          ficheNeuve({
            conversationId,
            messageId,
            ...(evenement.demandeur?.nom ? { demandeur: evenement.demandeur.nom } : {}),
            ...(evenement.demandeur?.dossier ? { dossier: evenement.demandeur.dossier } : {}),
            classement,
            texte,
            etat: demande.statut,
            constat: demande.constat,
            quand
          }),
          'utf8'
        )
        const ligne: LigneDeFiche = { ...commun, fiche, role: 'besoin', classement }
        await enregistrer(index, ligne)
        return ligne
      })
    },
    async rattacherLaBranche({ branche, source }) {
      if (!FIL_LISIBLE.test(branche.id)) return 0
      const paires = messagesRecopies(branche, source)
      if (paires.size === 0) return 0
      return enFile(async () => {
        const index = await chargerIndex()
        // Le calcul du Board seulement s'il y a quelque chose à pointer : au démarrage, toutes les
        // branches passent ici, et presque toutes viennent de fils sans fiche.
        const aPointer = [...paires].some(
          ([dansLaBranche, dansLaSource]) =>
            index.parMessage.has(cleDuJournal(source.id, dansLaSource)) &&
            !index.parMessage.has(cleDuJournal(branche.id, dansLaBranche))
        )
        if (!aPointer) return 0
        const recopiees = demandesDuFil(branche).filter(
          (demande) => demande.messageId !== undefined && paires.has(demande.messageId)
        )
        let ajoutees = 0
        for (const demande of recopiees) {
          const messageId = demande.messageId as string
          if (index.parMessage.has(cleDuJournal(branche.id, messageId))) continue
          const original = index.parMessage.get(
            cleDuJournal(source.id, paires.get(messageId) as string)
          )
          // L'original n'a pas de fiche (plus ancien que ce module, ou une question) : rien à pointer.
          if (!original) continue
          const demandeLe = demande.debut ?? original.demandeLe
          await enregistrer(index, {
            v: 1,
            ts: maintenant(),
            fiche: original.fiche,
            conversationId: branche.id,
            messageId,
            ...(demandeLe === undefined ? {} : { demandeLe }),
            role: 'copie',
            classement: original.classement,
            etat: demande.statut,
            constat: demande.constat
          })
          ajoutees += 1
        }
        return ajoutees
      })
    },
    lignes: () => enFile(async () => [...(await chargerIndex()).parMessage.values()]),
    fichesDuFil(conversationId) {
      return enFile(async () => {
        if (!FIL_LISIBLE.test(conversationId)) return []
        const parFiche = new Map<string, LigneDeFiche[]>()
        for (const ligne of (await chargerIndex()).parMessage.values()) {
          const deja = parFiche.get(ligne.fiche)
          if (deja) deja.push(ligne)
          else parFiche.set(ligne.fiche, [ligne])
        }
        const fiches: FicheDeDemande[] = []
        for (const [fiche, lignes] of parFiche) {
          if (!lignes.some((ligne) => ligne.conversationId === conversationId)) continue
          const chemin = join(dossier, fiche)
          let texte: string
          let maj: number
          try {
            ;[texte, maj] = await Promise.all([
              readFile(chemin, 'utf8'),
              stat(chemin).then((s) => s.mtimeMs)
            ])
          } catch (erreur) {
            // Effacée à la main : l'index la nomme encore, le panneau ne la montre plus.
            if ((erreur as NodeJS.ErrnoException).code === 'ENOENT') continue
            throw erreur
          }
          const resume = resumeDeLaFiche(texte)
          const derniere = lignes.reduce((a, b) => (b.ts > a.ts ? b : a))
          fiches.push({
            chemin,
            conversationId: fiche.split('/')[0] ?? conversationId,
            titre: resume.titre,
            statut: resume.statut ?? derniere.etat,
            maj,
            // Une copie dans une branche n'est pas une demande de plus : c'est la même, ailleurs.
            demandes: lignes.filter((ligne) => ligne.role !== 'copie').length
          })
        }
        return fiches.sort((a, b) => b.maj - a.maj)
      })
    },
    fichesDesDemandes() {
      return enFile(async () => {
        const carte: FichesDesDemandes = {}
        for (const ligne of (await chargerIndex()).parMessage.values()) {
          const duFil = (carte[ligne.conversationId] ??= {})
          duFil[ligne.messageId] = join(dossier, ligne.fiche)
        }
        return carte
      })
    },
    fichesParDemande() {
      return enFile(async () => {
        const parDemande = new Map<string, string>()
        for (const [cle, ligne] of (await chargerIndex()).parMessage)
          parDemande.set(cle, ligne.fiche)
        return parDemande
      })
    },
    retirerLeFil(conversationId) {
      return enFile(async () => {
        if (!FIL_LISIBLE.test(conversationId)) return
        const index = await chargerIndex()
        supprimerArbre(join(dossier, conversationId))
        await enregistrer(index, { v: 1, ts: maintenant(), retraitDuFil: conversationId })
      })
    }
  }
}
