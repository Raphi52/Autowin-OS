/**
 * VUE « BUREAUX CACHÉS » (2026-10-16) : « j'aimerais une view dédiée pour gérer tous mes
 * Hdesk, pouvoir les fermer, les créer et tout ». Refonte (même jour, skill draft, 5 tours
 * de maquettes) : « Régie » → « Antenne + moniteurs » → « Antenne pilotable » → bandeau « Tu pilotes »
 * à hachures + rendu automatique, « en fonction du thème » (aucune couleur en dur : variables du thème).
 *
 * Un bureau À L'ANTENNE, en grand ; les autres en MONITEURS dessous (un clic = passer à l'antenne).
 * L'antenne est en mode REGARDER par défaut : un clic dans l'image ne fait rien. PILOTER envoie clics,
 * molette et frappe au bureau caché (scripts/hdesk-act.ps1) sous un
 * bandeau qui le dit ; sans geste pendant `delaiPilotageMs`, la vue repasse seule en Regarder.
 * Échap ne sert PAS à sortir du pilotage : il part au bureau caché (hdesk-tv-touches.ts).
 * PAS DE JOURNAL DES GESTES ici (2026-10-16) : « tes gestes je m'en fous de logger ça dans
 * mes bureaux cachés ». La liste « Tes gestes » et ses repères numérotés, ajoutés, ont
 * été retirés ; un geste refusé reste dit sur une seule ligne (hdesk-retour-geste).
 * Cas limites : aucun bureau -> état vide + Créer ; liste illisible -> erreur dite ; bureau sans fiche
 * -> « travail non relié », Fermer rend le refus ; bureau piloté fermé ou plus à l'écran -> le pilotage
 * s'arrête ; piloter un autre bureau -> le premier repasse en Regarder ; saisie de création invalide ->
 * refusée AVANT tout lancement ; identifiant occupé -> l'identifiant libre est proposé, jamais relancé.
 * REPRIS (aperçu agrandi, écarté au profit de l'Antenne le 2026-10-19) : ce qui
 * ne dépend pas de la façon de montrer les bureaux — « Parcourir… » + identifiant proposé, « Récents /
 * Relancer », et le fil affiché par son titre, cliquable. Le journal des gestes reste dehors.
 * DISPOSITION « CONSOLE » (2026-10-20, skill draft, proposition 1) : « implémente la 1 en
 * enlevant le mot multi color et le filtre télévision et en mettant un cadre en fonction du thème au
 * lieu du cadre rose sur le bureau sélectionné ». La liste des bureaux à gauche (le choisi porte le
 * cadre du choix du thème), l'aperçu à droite avec Regarder / Piloter : tout tient sans défiler. Plus
 * d'antenne géante ni de moniteurs ; « l'antenne » reste le nom interne du bureau choisi.
 * UN PANNEAU DU CHAT (2026-10-31) : « refonte de la vue hdesk, ça devient un icône à côté de
 * celui du navigateur et ça ouvre un right panel comme le navigateur ». Plus d'écran dans le menu : même
 * gabarit que NavigateurIntegre (poignée, plein cadre, croix), et mêmes classes pour ses boutons et sa
 * poignée, pour que les deux panneaux ne divergent pas. Tous les bureaux restent listés, quel que soit
 * le fil ; celui du fil affiché est simplement choisi d'abord.
 * Largeur retenue sur ce poste, comme le navigateur ; plein cadre remplace la grande image de l'ancien
 * écran.
 * IL REMPLACE LE BLOC DU FIL (même jour) : « ça doit s'ouvrir quand le chat lance une action
 * hdesk, ça remplace le bloc qui s'affichait dans le chat ». ChatView l'ouvre quand le fil lance un
 * bureau (guet-bureaux-du-fil.ts). Les images gardent la cadence de ce bloc, 0,5 s : à 4 s, on ne verrait
 * plus l'agent travailler.
 * PLUS DE LISTE (même jour) : « la tv doit prendre toute la largeur, il doit pouvoir y avoir
 * plusieurs hdesk en même temps pour les super convs et la liste elle sert à rien enlève la ». Un écran
 * par bureau, pleine largeur, tous à l'image en même temps : ceux du fil affiché et de sa super conv.
 * Sans bureau choisi, « l'antenne » n'existe plus : seul le bureau en Piloter se distingue, et il n'y en
 * a qu'un. « Tous les bureaux » garde l'accès aux autres fils et aux bureaux sans fil (
 * « gérer tous mes Hdesk »).
 * PLUS DE « RÉCENTS » (même jour) : d'abord repliés sous les écrans, puis retirés à la
 * demande de l'utilisateur. Un bureau fermé se rouvre par « Nouveau bureau ». Le moteur rend encore
 * cette liste (lireRecents, hdesk-gestion.ts) : ce panneau ne la lit plus.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Spinner } from './Spinner'
import type { GesteTv, ImageTv, ResultatGeste } from '../../../main/bureau/hdesk-tv'
import {
  CREATION_ATTENTE_MS,
  FIL_MANUEL,
  proposerIdentifiant,
  refusCreation,
  type BureauGere,
  type DemandeCreationBureau,
  type ResultatChoixExe,
  type ResultatCreationBureau,
  type ResultatFermetureGeree,
  type ResultatListeBureaux
} from '../../../shared/hdesk-gestion'
import { toucheTv } from './hdesk-tv-touches'
import { formaterDate, formaterNombre } from '../langue'
import { riche } from '../textes'
import { useTextesWorktreesEtBureaux } from '../textes-ecrans/worktrees-et-bureaux'
// La poignée et les boutons ronds sont ceux du navigateur ; `lisere-dessus` vient de ViewPage.css.
import './NavigateurIntegre.css'
import './ViewPage.css'
import './HdeskGestionView.css'

export interface HdeskGestionApi {
  hdeskGestionBureaux: () => Promise<ResultatListeBureaux>
  hdeskGestionFermer: (id: string) => Promise<ResultatFermetureGeree>
  hdeskGestionCreer: (demande: DemandeCreationBureau) => Promise<ResultatCreationBureau>
  /** « Parcourir… » : sélecteur natif filtré sur les .exe. Absent = pas de bouton. */
  hdeskGestionChoisirExe?: () => Promise<ResultatChoixExe>
  /** Aperçu, bascule et gestes. */
  hdeskTvImage?: (id: string) => Promise<ImageTv>
  hdeskTvBasculer?: (id: string) => Promise<{ ok: boolean; message?: string }>
  hdeskTvAct?: (geste: GesteTv) => Promise<ResultatGeste>
  /** Titres des fils : le fil s'affichait comme un identifiant brut. */
  conversations?: () => Promise<Array<{ id: string; title?: string }>>
}

interface Props {
  active: boolean
  api?: HdeskGestionApi
  /** Les fils dont on montre les bureaux : celui affiché et sa super conv. Vide = tous les bureaux. */
  fils?: readonly string[]
  /** La croix du panneau. Absent = pas de croix. */
  onFermer?: () => void
  /** Ouvre la conversation d'un fil (ChatView.tsx). Absent = fil non cliquable. */
  onOpenConversation?: (target: { conversationId: string }) => void
  /** Cadence de la liste des bureaux. */
  intervalleMs?: number
  /** Pause entre deux séries d'images : les bureaux à l'écran y passent l'un après l'autre. */
  intervalleImageMs?: number
  /** Sans geste pendant ce délai, la vue repasse seule en Regarder. */
  delaiPilotageMs?: number
}

const CLE_LARGEUR = 'autowin.chat.bureauxLargeur'
/** Les bornes du navigateur : les deux panneaux occupent la même place à côté du fil. */
const LARGEUR = { min: 320, defaut: 520, max: 1600 } as const

function largeurMemorisee(): number {
  const lue = Number(window.localStorage.getItem(CLE_LARGEUR))
  const valeur = Number.isFinite(lue) && lue > 0 ? lue : LARGEUR.defaut
  return Math.min(LARGEUR.max, Math.max(LARGEUR.min, valeur))
}

type Formulaire = Required<DemandeCreationBureau>
const FORMULAIRE_VIDE: Formulaire = {
  id: '',
  executable: '',
  arguments: '',
  travail: '',
  conversationId: ''
}

const AUCUN_FIL: readonly string[] = []

/**
 * Hors du composant : les écrans sont rendus par une fonction appelée au rendu, et la règle de lint
 * `react-hooks/purity` prend alors l'horloge des gestes pour un appel pendant le rendu. Elle n'est lue
 * que dans les gestes.
 */
const heureDuGeste = (): number => Date.now()

/** Les bureaux à l'écran : ceux des fils demandés, ou tous. */
const bureauxMontres = (
  bureaux: readonly BureauGere[],
  fils: readonly string[],
  tous: boolean
): BureauGere[] =>
  tous || fils.length === 0
    ? [...bureaux]
    : bureaux.filter((b) => b.conversationId && fils.includes(b.conversationId))

/** « 20/10 10:53 » (pied d'un bureau, maquette Console). */
const quand = (iso: string): string => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? iso
    : formaterDate(d, {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      })
}

const secondes = (ms: number): string =>
  `${formaterNombre(ms / 1000, { maximumFractionDigits: 1 })} s`

const minutesSecondes = (ms: number): string => {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** La prop `api` (tests) ou le pont réel. */
const cibleDe = (api?: HdeskGestionApi): Partial<HdeskGestionApi> | undefined =>
  api ?? (window as unknown as { api?: Partial<HdeskGestionApi> }).api

const imageVisible = (img?: ImageTv): img is Extract<ImageTv, { statut: 'ok' | 'uni' }> =>
  img?.statut === 'ok' || img?.statut === 'uni'

/** Point de l'image affichée ramené aux pixels de la capture. */
function pointCapture(
  e: React.MouseEvent<HTMLImageElement>,
  img: Extract<ImageTv, { statut: 'ok' | 'uni' }>
): { x: number; y: number } | null {
  // Une capture unie (page web) ne porte pas sa taille : on prend celle de l'image reçue.
  const largeur = img.statut === 'ok' ? img.width : e.currentTarget.naturalWidth
  const hauteur = img.statut === 'ok' ? img.height : e.currentTarget.naturalHeight
  const rect = e.currentTarget.getBoundingClientRect()
  if (!rect.width || !rect.height || !largeur || !hauteur) return null
  return {
    x: Math.round(((e.clientX - rect.left) * largeur) / rect.width),
    y: Math.round(((e.clientY - rect.top) * hauteur) / rect.height)
  }
}

export function HdeskGestionView({
  active,
  api,
  fils = AUCUN_FIL,
  onFermer,
  intervalleMs = 4000,
  // 500 ms : la boucle ne se chevauche pas, donc la cadence réelle = max(500, durée capture).
  intervalleImageMs = 500,
  delaiPilotageMs = 60_000,
  onOpenConversation
}: Props): React.JSX.Element {
  const { t } = useTextesWorktreesEtBureaux()
  const cible = (): Partial<HdeskGestionApi> | undefined => cibleDe(api)
  const [liste, setListe] = useState<ResultatListeBureaux | null>(null)
  const [titres, setTitres] = useState<Record<string, string>>({})
  const [images, setImages] = useState<Record<string, ImageTv>>({})
  const [enFermeture, setEnFermeture] = useState<ReadonlySet<string>>(new Set())
  const [retours, setRetours] = useState<Record<string, { ok: boolean; message: string }>>({})
  const [formOuvert, setFormOuvert] = useState(false)
  const [form, setForm] = useState<Formulaire>(FORMULAIRE_VIDE)
  const [creationEnCours, setCreationEnCours] = useState(false)
  const [retourCreation, setRetourCreation] = useState<ResultatCreationBureau | null>(null)
  // Identifiant tapé à la main : la proposition tirée du nom de l'appli ne l'écrase jamais.
  const [idTouche, setIdTouche] = useState(false)
  // Le bureau en main : l'état pour le rendu, la référence pour la boucle de capture.
  const [piloteId, setPiloteId] = useState<string | null>(null)
  const [tous, setTous] = useState(false)
  const [echeance, setEcheance] = useState<number | null>(null)
  const [maintenant, setMaintenant] = useState(0)
  const [dernierClic, setDernierClic] = useState<{ id: string; x: number; y: number } | null>(null)
  const [texte, setTexte] = useState('')
  const [retourGeste, setRetourGeste] = useState<string | null>(null)
  const [pleinCadre, setPleinCadre] = useState(false)
  const [largeur, setLargeur] = useState(largeurMemorisee)
  const piloteRef = useRef<string | null>(null)
  const listeLueRef = useRef<readonly BureauGere[]>([])
  // La clé et pas le tableau : ChatView peut rendre un tableau neuf aux mêmes fils.
  const cleFils = fils.join('\n')
  const filsStables = useMemo(() => (cleFils ? cleFils.split('\n') : AUCUN_FIL), [cleFils])
  const porteeRef = useRef({ fils: filsStables, tous })
  const rafraichirRef = useRef<(() => void) | null>(null)
  // File des gestes : un geste attend la fin du précédent, sinon deux hdesk-act se chevauchent.
  const fileRef = useRef<Promise<void>>(Promise.resolve())
  // fix-ok: pont absent = fait DÉRIVÉ du rendu, pas un état posé dans l'effet (lint 2026-10-16 :
  // setState synchrone dans un effet, rendus en cascade).
  const indisponible = !cibleDe(api)?.hdeskGestionBureaux
  const etatListe: ResultatListeBureaux | null = indisponible
    ? { ok: false, message: t('hdesk.indisponible') }
    : liste

  const quitterPilotage = (): void => {
    piloteRef.current = null
    setPiloteId(null)
    setEcheance(null)
    setDernierClic(null)
    setTexte('')
  }

  useEffect(() => {
    if (!active) return
    const a = cibleDe(api)
    if (!a?.hdeskGestionBureaux) return
    let actif = true
    let minuterie: ReturnType<typeof setTimeout> | null = null
    let enCours = false
    let encore = false
    // Au premier tour, puis toutes les `intervalleMs`, ou tout de suite après un geste ou une fermeture.
    let listeDue = true
    let derniereListe = 0

    const tour = async (): Promise<void> => {
      if (typeof document !== 'undefined' && document.hidden) return
      const instant = Date.now()
      if (listeDue || instant - derniereListe >= intervalleMs) {
        listeDue = false
        derniereListe = instant
        const r = await a.hdeskGestionBureaux!().catch((e: unknown): ResultatListeBureaux => ({
          ok: false,
          message: String(e)
        }))
        if (!actif) return
        setListe(r)
        if (!r.ok) return
        listeLueRef.current = r.bureaux
      }
      const { fils: filsMontres, tous: tousMontres } = porteeRef.current
      const ids = bureauxMontres(listeLueRef.current, filsMontres, tousMontres).map((b) => b.id)
      // Le bureau en main s'est fermé ou n'est plus à l'écran : on ne pilote plus rien d'invisible.
      if (piloteRef.current && !ids.includes(piloteRef.current)) {
        piloteRef.current = null
        setPiloteId(null)
        setEcheance(null)
        setDernierClic(null)
      }
      if (!a.hdeskTvImage) return
      const enMain = piloteRef.current
      // Le bureau en main d'abord : c'est lui qu'on regarde au rythme des gestes. Les images passent
      // l'une après l'autre : le processus de capture répond à une demande à la fois.
      for (const id of enMain ? [enMain, ...ids.filter((i) => i !== enMain)] : ids) {
        const img = await a
          .hdeskTvImage(id)
          .catch((e: unknown): ImageTv => ({ statut: 'erreur', id, message: String(e) }))
        if (!actif) return
        setImages((prec) => ({ ...prec, [id]: img }))
      }
    }
    // Boucle SANS chevauchement : le tour suivant part quand le précédent est rendu.
    const boucle = async (): Promise<void> => {
      if (enCours) {
        encore = true
        return
      }
      enCours = true
      if (minuterie) clearTimeout(minuterie)
      minuterie = null
      await tour()
      enCours = false
      if (!actif) return
      if (encore) {
        encore = false
        void boucle()
      } else minuterie = setTimeout(() => void boucle(), intervalleImageMs)
    }
    rafraichirRef.current = () => {
      listeDue = true
      void boucle()
    }
    void boucle()
    return () => {
      actif = false
      rafraichirRef.current = null
      if (minuterie) clearTimeout(minuterie)
    }
  }, [active, api, intervalleMs, intervalleImageMs])

  // Ce qui change les bureaux à l'écran ne doit pas attendre la prochaine série d'images.
  useEffect(() => {
    // Au montage, rien n'a changé : le premier tour part déjà, un second doublerait la liste.
    if (porteeRef.current.fils === filsStables && porteeRef.current.tous === tous) return
    porteeRef.current = { fils: filsStables, tous }
    rafraichirRef.current?.()
  }, [filsStables, tous])

  // Titres des fils, relus à chaque ouverture de la vue. Échec = l'identifiant reste affiché.
  useEffect(() => {
    if (!active) return
    const lire = cibleDe(api)?.conversations
    if (!lire) return
    let actif = true
    lire()
      .then((convs) => {
        if (!actif || !Array.isArray(convs)) return
        setTitres(
          Object.fromEntries(
            convs
              .filter((c) => typeof c?.id === 'string' && typeof c.title === 'string' && c.title)
              .map((c) => [c.id, c.title as string])
          )
        )
      })
      .catch(() => undefined)
    return () => {
      actif = false
    }
  }, [active, api])

  /** Le fil par son titre ; un clic ouvre la conversation. « manuel » ou absent : texte. */
  const fil = (b: BureauGere): React.JSX.Element | string => {
    const id = b.conversationId
    if (!id) return t('hdesk.fil.aucun')
    if (id === FIL_MANUEL || !onOpenConversation) return id
    return (
      <button
        type="button"
        className="hdesk-lien"
        data-testid={`hdesk-fil-${b.id}`}
        title={id}
        onClick={() => onOpenConversation({ conversationId: id })}
      >
        {titres[id] ?? id}
      </button>
    )
  }

  // Compte à rebours du pilotage : l'horloge n'avance que dans le rappel, jamais au rendu.
  useEffect(() => {
    if (!piloteId || echeance === null) return
    const minuterie = setInterval(() => {
      const t = Date.now()
      if (t >= echeance) {
        piloteRef.current = null
        setPiloteId(null)
        setEcheance(null)
        setDernierClic(null)
        setTexte('')
      } else setMaintenant(t)
    }, 1000)
    return () => clearInterval(minuterie)
  }, [piloteId, echeance])

  function commencerRedimensionnement(event: React.PointerEvent<HTMLDivElement>): void {
    event.preventDefault()
    const departX = event.clientX
    const depart = largeur
    let derniere = depart
    const bouger = (mouvement: PointerEvent): void => {
      derniere = Math.min(LARGEUR.max, Math.max(LARGEUR.min, depart + departX - mouvement.clientX))
      setLargeur(derniere)
    }
    const lacher = (): void => {
      window.localStorage.setItem(CLE_LARGEUR, String(derniere))
      window.removeEventListener('pointermove', bouger)
      window.removeEventListener('pointerup', lacher)
    }
    window.addEventListener('pointermove', bouger)
    window.addEventListener('pointerup', lacher)
  }

  /** Chaque geste repousse le retour automatique en Regarder. */
  const prolonger = (): void => {
    if (!piloteRef.current) return
    const t = heureDuGeste()
    setMaintenant(t)
    setEcheance(t + delaiPilotageMs)
  }

  const piloter = (id: string): void => {
    const t = heureDuGeste()
    if (piloteRef.current !== id) {
      setDernierClic(null)
      setTexte('')
    }
    piloteRef.current = id
    setPiloteId(id)
    setMaintenant(t)
    setEcheance(t + delaiPilotageMs)
    setRetourGeste(null)
    // Le bureau en main passe devant les autres : on relance la boucle tout de suite.
    rafraichirRef.current?.()
  }

  const envoyer = (geste: GesteTv): Promise<void> => {
    const agir = cible()?.hdeskTvAct
    if (!agir) return Promise.resolve()
    prolonger()
    fileRef.current = fileRef.current.then(async () => {
      const r = await agir(geste).catch((e: unknown) => ({
        ok: false as const,
        message: String(e)
      }))
      setRetourGeste(r.ok ? null : t('hdesk.actionRefusee', { message: r.message }))
      // Rafraîchir tout de suite : sans cela l'effet du geste n'apparaît qu'au tour suivant.
      rafraichirRef.current?.()
    })
    return fileRef.current
  }

  // L'écran visé et pas seulement le bureau en main : ses coordonnées ne valent que pour SON image.
  const cliquerImage = (e: React.MouseEvent<HTMLImageElement>, id: string): void => {
    const img = images[id]
    if (id !== piloteId || !imageVisible(img)) return
    const p = pointCapture(e, img)
    if (!p) return
    setDernierClic({ id: img.id, ...p })
    void envoyer({ id: img.id, ...p })
  }

  // Molette : 1 cran par tranche de 100 px de deltaY (bas = négatif, comme Windows).
  const molette = (e: React.WheelEvent<HTMLImageElement>, id: string): void => {
    const img = images[id]
    if (id !== piloteId || !imageVisible(img) || !e.deltaY) return
    const p = pointCapture(e, img)
    if (!p) return
    const crans = Math.max(
      -20,
      Math.min(20, -Math.sign(e.deltaY) * Math.max(1, Math.round(Math.abs(e.deltaY) / 100)))
    )
    void envoyer({ id: img.id, ...p, molette: crans })
  }

  // La frappe vise le dernier point cliqué SANS recliquer (un reclic déplacerait le curseur).
  const taper = (entree: boolean): void => {
    if (!dernierClic || dernierClic.id !== piloteId || (!texte && !entree)) return
    void envoyer({ ...dernierClic, texte, entree, sansClic: true })
    setTexte('')
  }

  const fermer = async (b: BureauGere): Promise<void> => {
    const f = cible()?.hdeskGestionFermer
    if (!f || enFermeture.has(b.id)) return
    const ok = window.confirm(t('hdesk.fermer.confirmation', { travail: b.travail }))
    if (!ok) return
    setEnFermeture((prec) => new Set(prec).add(b.id))
    // Le libellé d'attente est rendu dans le JSX, AVEC son spinner, tant que `enFermeture` porte
    // l'id : l'entrée vide réserve seulement la place du retour.
    setRetours((prec) => ({ ...prec, [b.id]: { ok: true, message: '' } }))
    const r = await f(b.id).catch((e: unknown): ResultatFermetureGeree => ({
      ok: false,
      code: null,
      message: String(e)
    }))
    setEnFermeture((prec) => {
      const suite = new Set(prec)
      suite.delete(b.id)
      return suite
    })
    setRetours((prec) => ({
      ...prec,
      [b.id]: {
        ok: r.ok,
        message: r.ok ? r.message : t('hdesk.fermetureRefusee', { message: r.message })
      }
    }))
    rafraichirRef.current?.()
  }

  // Geste sur l'ÉCRAN RÉEL : confirmation explicite à chaque fois.
  const basculer = async (b: BureauGere): Promise<void> => {
    const f = cible()?.hdeskTvBasculer
    if (!f) return
    const ok = window.confirm(t('hdesk.basculer.confirmation'))
    if (!ok) return
    const r = await f(b.id).catch((e: unknown) => ({ ok: false, message: String(e) }))
    setRetours((prec) => ({
      ...prec,
      [b.id]: {
        ok: r.ok,
        message: r.ok
          ? t('hdesk.ecranBascule')
          : t('hdesk.basculeRefusee', { message: r.message ?? '' })
      }
    }))
  }

  const lancer = async (demande: DemandeCreationBureau): Promise<void> => {
    if (creationEnCours) return
    const refus = refusCreation(demande)
    if (refus) {
      setRetourCreation({ ok: false, code: null, message: refus })
      return
    }
    const f = cible()?.hdeskGestionCreer
    if (!f) return
    setCreationEnCours(true)
    setRetourCreation(null)
    const r = await f({ ...demande }).catch((err: unknown): ResultatCreationBureau => ({
      ok: false,
      code: null,
      message: String(err)
    }))
    setCreationEnCours(false)
    setRetourCreation(r)
    if (r.ok) {
      setForm(FORMULAIRE_VIDE)
      setIdTouche(false)
      setFormOuvert(false)
      rafraichirRef.current?.()
    }
  }

  const creer = (e: React.FormEvent): void => {
    e.preventDefault()
    void lancer(form)
  }

  // Identifiants déjà vivants : la proposition les contourne (le lanceur reste juge, exit 5).
  const idsVivants = etatListe?.ok ? etatListe.bureaux.map((b) => b.id) : []
  const changerExecutable = (chemin: string): void =>
    setForm((prec) => ({
      ...prec,
      executable: chemin,
      ...(!idTouche && chemin.trim() ? { id: proposerIdentifiant(chemin, idsVivants) } : {})
    }))

  const parcourir = async (): Promise<void> => {
    const f = cible()?.hdeskGestionChoisirExe
    if (!f) return
    const r = await f().catch((e: unknown): ResultatChoixExe => ({ ok: false, message: String(e) }))
    if (r.ok) changerExecutable(r.chemin)
    else if (r.message) setRetourCreation({ ok: false, code: null, message: r.message })
  }

  const champ = (cle: keyof Formulaire, libelle: string, aide: string): React.JSX.Element => (
    <label className="hdesk-champ">
      <span>{libelle}</span>
      <input
        data-testid={`hdesk-champ-${cle}`}
        value={form[cle]}
        placeholder={aide}
        onChange={(e) => {
          const v = e.target.value
          if (cle === 'executable') return changerExecutable(v)
          if (cle === 'id') setIdTouche(v.trim() !== '')
          setForm((prec) => ({ ...prec, [cle]: v }))
        }}
      />
    </label>
  )

  /** Contenu de l'écran d'un bureau selon le statut de sa dernière capture. */
  const ecran = (b: BureauGere): React.JSX.Element => {
    const img = images[b.id]
    if (imageVisible(img))
      return (
        <>
          <img
            src={img.dataUrl}
            alt={t('hdesk.apercu.alt', { id: b.id })}
            data-testid="hdesk-antenne-image"
            className={img.statut === 'uni' ? 'is-uni' : undefined}
            onClick={(e) => cliquerImage(e, b.id)}
            onWheel={(e) => molette(e, b.id)}
          />
          {img.statut === 'uni' && <span className="hdesk-ecran-note">{t('hdesk.imageUnie')}</span>}
        </>
      )
    if (img?.statut === 'ferme') return <span>{t('hdesk.bureauFerme')}</span>
    if (img?.statut === 'erreur')
      return <span title={img.message}>{t('hdesk.apercuImpossible')}</span>
    return <span>{t('hdesk.capture')}</span>
  }

  const bureaux = etatListe?.ok ? etatListe.bureaux : []
  const montres = bureauxMontres(bureaux, filsStables, tous)
  const restantMs = echeance === null ? delaiPilotageMs : Math.max(0, echeance - maintenant)
  const sansFil = montres.filter((b) => !b.conversationId).length
  const retoursOrphelins = Object.entries(retours).filter(
    ([id]) => !montres.some((b) => b.id === id)
  )
  // Le compte à rebours reste un élément à part (`hdesk-compte-a-rebours`) au milieu de la phrase
  // traduite : on la coupe à l'endroit de `{duree}`.
  const [retourAvant = '', retourApres = ''] = t('hdesk.pilote.retour').split('{duree}')

  /** L'écran d'un bureau : sa barre, son image, sa frappe en Piloter, son pied. */
  const tele = (b: BureauGere): React.JSX.Element => {
    const pilote = piloteId === b.id
    const pilotable = Boolean(cible()?.hdeskTvAct) && imageVisible(images[b.id])
    const visePret = pilote && dernierClic?.id === b.id
    return (
      <article
        key={b.id}
        className="hdesk-detail"
        data-testid="hdesk-antenne"
        data-bureau={b.id}
        aria-label={t('hdesk.detail.aria', { travail: b.travail })}
      >
        <div className={`hdesk-barre${pilote ? ' is-pilote' : ''}`} data-testid="hdesk-bandeau">
          <b
            className={`hdesk-tele-titre${b.relie ? '' : ' hdesk-non-relie'}`}
            title={b.executable ? `${b.travail}\n${b.executable}` : b.travail}
          >
            {b.travail}
          </b>
          <span className="hdesk-mode" role="group" aria-label={t('hdesk.mode.aria')}>
            <button
              type="button"
              data-testid="hdesk-regarder"
              aria-pressed={!pilote}
              onClick={quitterPilotage}
            >
              {t('hdesk.regarder')}
            </button>
            <button
              type="button"
              data-testid="hdesk-piloter"
              aria-pressed={pilote}
              disabled={!pilotable}
              title={pilotable ? undefined : t('hdesk.piloter.indisponible')}
              onClick={() => piloter(b.id)}
            >
              {t('hdesk.piloter')}
            </button>
          </span>
          {pilote ? (
            <span className="hdesk-barre-etat">
              <strong>{t('hdesk.pilote.titre')}</strong> {retourAvant}
              <b data-testid="hdesk-compte-a-rebours">{minutesSecondes(restantMs)}</b>
              {retourApres}
            </span>
          ) : (
            <span className="hdesk-barre-etat" title={t('hdesk.lectureSeule.titre')}>
              {t('hdesk.lectureSeule')}
            </span>
          )}
          <span className="hdesk-espace" />
          <button
            type="button"
            className="btn btn-sm"
            data-testid={`hdesk-basculer-${b.id}`}
            title={t('hdesk.afficher.titre')}
            onClick={() => void basculer(b)}
          >
            {t('hdesk.afficher')}
          </button>
          <button
            type="button"
            className="btn btn-sm hdesk-btn-danger"
            data-testid={`hdesk-fermer-${b.id}`}
            disabled={enFermeture.has(b.id)}
            onClick={() => void fermer(b)}
          >
            {enFermeture.has(b.id) ? t('hdesk.fermeture') : t('commun.fermer')}
          </button>
          {pilote && (
            <span className="hdesk-jauge" aria-hidden="true">
              <i style={{ width: `${(restantMs / delaiPilotageMs) * 100}%` }} />
            </span>
          )}
        </div>

        {retours[b.id] && (
          <p
            className={`hdesk-retour ${retours[b.id].ok ? 'is-ok' : 'is-erreur'}`}
            role={retours[b.id].ok ? 'status' : 'alert'}
            data-testid={`hdesk-retour-${b.id}`}
          >
            {enFermeture.has(b.id) ? (
              <>
                <Spinner size={12} /> {t('hdesk.fermetureEnCours')}
              </>
            ) : (
              retours[b.id].message
            )}
          </p>
        )}

        {/* Ni liseré irisé, ni lignes de balayage, ni reflet. En Piloter, l'écran prend
            le cadre du choix du thème. */}
        <div className={`hdesk-ecran${pilote ? ' is-pilote' : ''}`} data-testid="hdesk-ecran">
          {ecran(b)}
        </div>

        {pilote && (
          <form
            className="hdesk-dock"
            data-testid="hdesk-saisie"
            onSubmit={(e) => {
              e.preventDefault()
              taper(true)
            }}
            // La frappe destinée au bureau caché ne doit pas déclencher les raccourcis de l'app.
            onKeyDown={(e) => {
              e.stopPropagation()
              const t = toucheTv(e, !texte)
              if (!t || !dernierClic || dernierClic.id !== b.id) return
              // Touche spéciale : le texte en cours part d'abord, la touche ensuite.
              e.preventDefault()
              if (texte) {
                void envoyer({ ...dernierClic, texte, sansClic: true })
                setTexte('')
              }
              void envoyer({ ...dernierClic, touche: t, sansClic: true })
            }}
          >
            {visePret && dernierClic && (
              <span className="hdesk-vise" title={t('hdesk.vise.titre')}>
                ({dernierClic.x}, {dernierClic.y})
              </span>
            )}
            <input
              data-testid="hdesk-texte"
              value={texte}
              onChange={(e) => setTexte(e.target.value)}
              disabled={!visePret}
              placeholder={visePret ? t('hdesk.texte.pret') : t('hdesk.texte.viser')}
            />
            <button
              type="button"
              className="btn btn-sm btn-accent"
              data-testid="hdesk-taper"
              disabled={!visePret || !texte}
              onClick={() => taper(false)}
            >
              {t('hdesk.taper')}
            </button>
          </form>
        )}
        {retourGeste && (
          <p className="hdesk-retour is-erreur" role="alert" data-testid="hdesk-retour-geste">
            {retourGeste}
          </p>
        )}

        <p className="hdesk-pied" data-testid="hdesk-pied">
          <span title={t('hdesk.pied.id.titre')}>{b.id}</span>
          {b.conversationId ? (
            <span className="hdesk-pied-fil">
              {t('hdesk.pied.fil')} {fil(b)}
            </span>
          ) : (
            <span className="is-alerte">{t('hdesk.pied.sansFil')}</span>
          )}
          {b.lanceLe && <span>{t('hdesk.pied.lance', { quand: quand(b.lanceLe) })}</span>}
          <span className="hdesk-espace" />
          <span className="hdesk-cadence">
            <i className="hdesk-point is-ok" aria-hidden="true" />
            {t('hdesk.cadence', {
              duree: secondes(intervalleImageMs)
            })}
          </span>
        </p>
      </article>
    )
  }

  return (
    <>
      {!pleinCadre && (
        <div
          className="navigateur-redimensionneur"
          role="separator"
          aria-orientation="vertical"
          aria-label={t('hdesk.panneau.redimensionner')}
          aria-valuemin={LARGEUR.min}
          aria-valuemax={LARGEUR.max}
          aria-valuenow={largeur}
          onPointerDown={commencerRedimensionnement}
        />
      )}
      <aside
        className={`lisere-dessus hdesk-gestion-view${pleinCadre ? ' is-plein-cadre' : ''}`}
        style={pleinCadre ? undefined : { width: `${largeur}px` }}
        aria-label={t('hdesk.titre')}
        data-testid="hdesk-view"
        data-active={active}
      >
        <div className="hdesk-panneau-tete">
          <h2>{t('hdesk.titre')}</h2>
          {montres.length > 0 && (
            <span className="hdesk-stats" data-testid="hdesk-direct">
              <span>
                {riche(
                  t(montres.length > 1 ? 'hdesk.stats.ouverts' : 'hdesk.stats.ouvert', {
                    n: montres.length
                  }),
                  'b'
                )}
              </span>
              {sansFil > 0 && (
                <span className="is-alerte">
                  {riche(t('hdesk.stats.sansFil', { n: sansFil }), 'b')}
                </span>
              )}
            </span>
          )}
          {/* Sans liste, le seul chemin vers les bureaux des autres fils et ceux sans fil. */}
          {filsStables.length > 0 && (tous || bureaux.length > montres.length) && (
            <button
              type="button"
              className="btn btn-sm hdesk-btn-discret"
              data-testid="hdesk-tous"
              aria-pressed={tous}
              onClick={() => setTous((v) => !v)}
            >
              {tous ? t('hdesk.portee.fil') : t('hdesk.portee.tous', { n: bureaux.length })}
            </button>
          )}
          <span className="hdesk-espace" />
          <button
            type="button"
            className="btn btn-sm btn-accent"
            data-testid="hdesk-nouveau"
            onClick={() => {
              setFormOuvert((o) => !o)
              setRetourCreation(null)
            }}
          >
            {formOuvert ? t('commun.annuler') : t('hdesk.nouveau')}
          </button>
          <button
            type="button"
            className="navigateur-bouton"
            data-testid="hdesk-panneau-plein-cadre"
            aria-pressed={pleinCadre}
            aria-label={t(pleinCadre ? 'hdesk.panneau.coteACote' : 'hdesk.panneau.pleinCadre')}
            title={t(pleinCadre ? 'hdesk.panneau.coteACote' : 'hdesk.panneau.pleinCadre')}
            onClick={() => setPleinCadre((v) => !v)}
          >
            <svg className="navigateur-icone" viewBox="0 0 16 16" aria-hidden="true">
              {pleinCadre ? (
                <path d="M6 3.5V6H3.5M10 3.5V6h2.5M12.5 10H10v2.5M3.5 10H6v2.5" />
              ) : (
                <path d="M3.5 6V3.5H6M10 3.5h2.5V6M12.5 10v2.5H10M6 12.5H3.5V10" />
              )}
            </svg>
          </button>
          {onFermer && (
            <button
              type="button"
              className="navigateur-bouton"
              data-testid="hdesk-panneau-fermer"
              aria-label={t('hdesk.panneau.fermer')}
              title={t('hdesk.panneau.fermer')}
              onClick={onFermer}
            >
              <svg className="navigateur-icone" viewBox="0 0 16 16" aria-hidden="true">
                <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
              </svg>
            </button>
          )}
        </div>

        <div className="hdesk-panneau-corps">
          {formOuvert && (
            <form className="hdesk-formulaire" data-testid="hdesk-formulaire" onSubmit={creer}>
              {/* L'application d'abord : l'identifiant se propose à partir d'elle. */}
              <div className="hdesk-champ-exe">
                {champ('executable', t('hdesk.champ.executable'), t('hdesk.champ.executable.aide'))}
                {cible()?.hdeskGestionChoisirExe && (
                  <button
                    type="button"
                    className="btn btn-sm"
                    data-testid="hdesk-parcourir"
                    onClick={() => void parcourir()}
                  >
                    {t('hdesk.parcourir')}
                  </button>
                )}
              </div>
              {champ('id', t('hdesk.champ.id'), t('hdesk.champ.id.aide'))}
              {champ('arguments', t('hdesk.champ.arguments'), t('hdesk.champ.arguments.aide'))}
              {champ('travail', t('hdesk.champ.travail'), t('hdesk.champ.travail.aide'))}
              {/* `FIL_MANUEL` reste tel quel : c'est la valeur que le code compare quand on la tape. */}
              {champ('conversationId', t('hdesk.champ.fil'), FIL_MANUEL)}
              <button
                type="submit"
                className="btn btn-accent"
                data-testid="hdesk-creer"
                disabled={creationEnCours}
              >
                {/* L'écran disait « 40 s » alors que l'application attend CREATION_ATTENTE_MS. */}
                {creationEnCours
                  ? t('hdesk.creation', { secondes: Math.round(CREATION_ATTENTE_MS / 1000) })
                  : t('hdesk.creer')}
              </button>
            </form>
          )}

          {retourCreation && (
            <div
              className={`hdesk-retour ${retourCreation.ok ? 'is-ok' : 'is-erreur'}`}
              data-testid="hdesk-retour-creation"
              role={retourCreation.ok ? 'status' : 'alert'}
            >
              {retourCreation.ok
                ? retourCreation.message
                : t('hdesk.creationRefusee', { message: retourCreation.message })}
              {!retourCreation.ok && retourCreation.idLibre && (
                <button
                  type="button"
                  className="btn btn-sm"
                  data-testid="hdesk-id-libre"
                  onClick={() => {
                    setForm((prec) => ({ ...prec, id: retourCreation.idLibre! }))
                    setFormOuvert(true)
                  }}
                >
                  {t('hdesk.utiliserId', { id: retourCreation.idLibre })}
                </button>
              )}
            </div>
          )}

          {retoursOrphelins.map(([id, r]) => (
            <p
              key={id}
              className={`hdesk-retour ${r.ok ? 'is-ok' : 'is-erreur'}`}
              role={r.ok ? 'status' : 'alert'}
              data-testid={`hdesk-retour-${id}`}
            >
              {t('hdesk.retour.prefixe', { id })}{' '}
              {enFermeture.has(id) ? (
                <>
                  <Spinner size={12} /> {t('hdesk.fermetureEnCours')}
                </>
              ) : (
                r.message
              )}
            </p>
          ))}

          {etatListe === null ? (
            <p className="hdesk-etat">
              <Spinner size={12} /> {t('hdesk.lectureBureaux')}
            </p>
          ) : !etatListe.ok ? (
            <p
              className="hdesk-etat hdesk-retour is-erreur"
              role="alert"
              data-testid="hdesk-erreur"
            >
              {t('hdesk.listeImpossible', { message: etatListe.message })}
            </p>
          ) : montres.length > 0 ? (
            <div className="hdesk-teles" data-testid="hdesk-teles">
              {montres.map((b) => tele(b))}
            </div>
          ) : (
            <div className="hdesk-etat hdesk-vide" data-testid="hdesk-vide">
              <p>{t(bureaux.length > 0 ? 'hdesk.vide.fil' : 'hdesk.vide')}</p>
              {!formOuvert && (
                <button type="button" className="btn" onClick={() => setFormOuvert(true)}>
                  {t('hdesk.creerUnBureau')}
                </button>
              )}
            </div>
          )}
        </div>
      </aside>
    </>
  )
}
