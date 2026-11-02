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
 */
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { LIBELLES_STATUT } from '../renderer/src/components/carte-du-fil'
import type { StatutDemande } from '../shared/carte-des-besoins'
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
  role: 'besoin' | 'suite'
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

export function creerFichesDeDemande(deps: { racine: string; maintenant?: () => number }): {
  /** Range le tour qui vient de finir ; `null` = rien à ranger (question, tour sans demande). */
  noterTour: (tour: TourPourLaFiche) => Promise<LigneDeFiche | null>
  /** Une ligne par demande rangée, pour la mesure. */
  lignes: () => Promise<LigneDeFiche[]>
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
    lignes: () => enFile(async () => [...(await chargerIndex()).parMessage.values()]),
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
