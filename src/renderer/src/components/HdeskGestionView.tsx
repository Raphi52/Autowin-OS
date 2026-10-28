/**
 * VUE « BUREAUX CACHÉS » (conv-951, 2026-10-16) : « j'aimerais une view dédiée pour gérer tous mes
 * Hdesk, pouvoir les fermer, les créer et tout ». Refonte conv-1002 (même jour, skill draft, 5 tours
 * de maquettes) : « Régie » → « Antenne + moniteurs » → « Antenne pilotable » → bandeau « Tu pilotes »
 * à hachures + rendu automatique, « en fonction du thème » (aucune couleur en dur : variables du thème).
 *
 * Un bureau À L'ANTENNE, en grand ; les autres en MONITEURS dessous (un clic = passer à l'antenne).
 * L'antenne est en mode REGARDER par défaut : un clic dans l'image ne fait rien. PILOTER envoie clics,
 * molette et frappe au bureau caché (mêmes canaux que la TV du fil, scripts/hdesk-act.ps1) sous un
 * bandeau qui le dit ; sans geste pendant `delaiPilotageMs`, la vue repasse seule en Regarder.
 * Échap ne sert PAS à sortir du pilotage : il part au bureau caché (hdesk-tv-touches.ts).
 * PAS DE JOURNAL DES GESTES ici (conv-1010, 2026-10-16) : « tes gestes je m'en fous de logger ça dans
 * mes bureaux cachés ». La liste « Tes gestes » et ses repères numérotés, ajoutés par conv-1002, ont
 * été retirés ; un geste refusé reste dit sur une seule ligne (hdesk-retour-geste).
 * Cas limites : aucun bureau -> état vide + Créer ; liste illisible -> erreur dite ; bureau sans fiche
 * -> « travail non relié », Fermer rend le refus ; antenne fermée -> l'antenne passe au premier bureau
 * et le pilotage s'arrête ; changer d'antenne -> retour en Regarder ; saisie de création invalide ->
 * refusée AVANT tout lancement ; identifiant occupé -> l'identifiant libre est proposé, jamais relancé.
 * REPRIS DE conv-344 (aperçu agrandi, écarté au profit de l'Antenne le 2026-10-19, conv-1023) : ce qui
 * ne dépend pas de la façon de montrer les bureaux — « Parcourir… » + identifiant proposé, « Récents /
 * Relancer », et le fil affiché par son titre, cliquable. Le journal des gestes de conv-344 reste dehors.
 * DISPOSITION « CONSOLE » (conv-1025, 2026-10-20, skill draft, proposition 1) : « implémente la 1 en
 * enlevant le mot multi color et le filtre télévision et en mettant un cadre en fonction du thème au
 * lieu du cadre rose sur le bureau sélectionné ». La liste des bureaux à gauche (le choisi porte le
 * cadre du choix du thème), l'aperçu à droite avec Regarder / Piloter : tout tient sans défiler. Plus
 * d'antenne géante ni de moniteurs ; « l'antenne » reste le nom interne du bureau choisi.
 */
import { useEffect, useRef, useState } from 'react'
import { Spinner } from './Spinner'
import type { GesteTv, ImageTv, ResultatGeste } from '../../../main/hdesk-tv'
import {
  CREATION_ATTENTE_MS,
  FIL_MANUEL,
  proposerIdentifiant,
  refusCreation,
  type BureauGere,
  type DemandeCreationBureau,
  type LancementRecent,
  type ResultatChoixExe,
  type ResultatCreationBureau,
  type ResultatFermetureGeree,
  type ResultatListeBureaux
} from '../../../shared/hdesk-gestion'
import { toucheTv } from './hdesk-tv-touches'
import { ViewTopBar } from './ViewTopBar'
import { formaterDate, formaterNombre, langueCourante } from '../langue'
import { riche } from '../textes'
import {
  traduireWorktreesEtBureaux,
  useTextesWorktreesEtBureaux
} from '../textes-ecrans/worktrees-et-bureaux'
import './ViewPage.css'
import './HdeskGestionView.css'

export interface HdeskGestionApi {
  hdeskGestionBureaux: () => Promise<ResultatListeBureaux>
  hdeskGestionFermer: (id: string) => Promise<ResultatFermetureGeree>
  hdeskGestionCreer: (demande: DemandeCreationBureau) => Promise<ResultatCreationBureau>
  /** « Parcourir… » : sélecteur natif filtré sur les .exe (conv-344). Absent = pas de bouton. */
  hdeskGestionChoisirExe?: () => Promise<ResultatChoixExe>
  /** Aperçu, bascule et gestes : mêmes canaux que la petite TV du chat. */
  hdeskTvImage?: (id: string) => Promise<ImageTv>
  hdeskTvBasculer?: (id: string) => Promise<{ ok: boolean; message?: string }>
  hdeskTvAct?: (geste: GesteTv) => Promise<ResultatGeste>
  /** Titres des fils (conv-344) : le fil s'affichait comme un identifiant brut. */
  conversations?: () => Promise<Array<{ id: string; title?: string }>>
}

interface Props {
  active: boolean
  api?: HdeskGestionApi
  /** Ouvre la conversation d'un fil (App.tsx : openTaskConversation). Absent = fil non cliquable. */
  onOpenConversation?: (target: { conversationId: string }) => void
  /** Cadence de la liste et de TOUS les aperçus, en Regarder. */
  intervalleMs?: number
  /** Cadence du bureau choisi seul, en Piloter (les autres ne sont plus capturés). */
  intervallePiloteMs?: number
  /** Sans geste pendant ce délai, la vue repasse seule en Regarder. */
  delaiPilotageMs?: number
}

type Formulaire = Required<DemandeCreationBureau>
const FORMULAIRE_VIDE: Formulaire = {
  id: '',
  executable: '',
  arguments: '',
  travail: '',
  conversationId: ''
}

/** « 20/10 10:53 » (pied du bureau choisi, maquette Console de conv-1025). */
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

/**
 * Moment court d'une ligne de liste : « 10:53 » le jour même, « hier », sinon « 18/10 ».
 * `reference` = l'instant de la dernière lecture de la liste (jamais l'horloge au rendu).
 */
const momentCourt = (iso: string | undefined, reference: number): string | null => {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  // Le jour sert seulement à COMPARER deux dates : n'importe quelle locale convient, pourvu que ce
  // soit la même des deux côtés.
  const jour = (t: Date): string => formaterDate(t, { dateStyle: 'short' })
  const ref = new Date(reference || d.getTime())
  if (jour(d) === jour(ref)) return formaterDate(d, { hour: '2-digit', minute: '2-digit' })
  const veille = new Date(ref)
  veille.setDate(ref.getDate() - 1)
  if (jour(d) === jour(veille))
    return traduireWorktreesEtBureaux('hdesk.moment.hier', langueCourante())
  return formaterDate(d, { day: '2-digit', month: '2-digit' })
}

const nomDeFichier = (chemin: string): string => chemin.split(/[\\/]/).pop() || chemin

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

/** Point de l'image affichée ramené aux pixels de la capture (même règle que la TV du fil). */
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
  intervalleMs = 4000,
  intervallePiloteMs = 1500,
  delaiPilotageMs = 60_000,
  onOpenConversation
}: Props): React.JSX.Element {
  const { t } = useTextesWorktreesEtBureaux()
  const cible = (): Partial<HdeskGestionApi> | undefined => cibleDe(api)
  const [liste, setListe] = useState<ResultatListeBureaux | null>(null)
  // Instant de la dernière lecture : référence de « 10:53 / hier » des lignes, posée hors rendu.
  const [luA, setLuA] = useState(0)
  const [titres, setTitres] = useState<Record<string, string>>({})
  const [images, setImages] = useState<Record<string, ImageTv>>({})
  const [enFermeture, setEnFermeture] = useState<ReadonlySet<string>>(new Set())
  const [retours, setRetours] = useState<Record<string, { ok: boolean; message: string }>>({})
  const [formOuvert, setFormOuvert] = useState(false)
  const [form, setForm] = useState<Formulaire>(FORMULAIRE_VIDE)
  const [creationEnCours, setCreationEnCours] = useState(false)
  const [retourCreation, setRetourCreation] = useState<ResultatCreationBureau | null>(null)
  // Identifiant tapé à la main : la proposition tirée du nom de l'appli ne l'écrase jamais (conv-344).
  const [idTouche, setIdTouche] = useState(false)
  // Antenne et pilotage : l'état pour le rendu, la référence pour la boucle de capture.
  const [antenneId, setAntenneId] = useState<string | null>(null)
  const [pilote, setPilote] = useState(false)
  const [echeance, setEcheance] = useState<number | null>(null)
  const [maintenant, setMaintenant] = useState(0)
  const [dernierClic, setDernierClic] = useState<{ id: string; x: number; y: number } | null>(null)
  const [texte, setTexte] = useState('')
  const [retourGeste, setRetourGeste] = useState<string | null>(null)
  const antenneRef = useRef<string | null>(null)
  const piloteRef = useRef(false)
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
    piloteRef.current = false
    setPilote(false)
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

    const tour = async (): Promise<void> => {
      if (typeof document !== 'undefined' && document.hidden) return
      const r = await a.hdeskGestionBureaux!().catch((e: unknown): ResultatListeBureaux => ({
        ok: false,
        message: String(e)
      }))
      if (!actif) return
      setListe(r)
      setLuA(Date.now())
      if (!r.ok) return
      // L'antenne survit tant que son bureau vit ; sinon elle passe au premier, sans pilotage.
      const ids = r.bureaux.map((b) => b.id)
      const avant = antenneRef.current
      const courant = avant && ids.includes(avant) ? avant : (ids[0] ?? null)
      if (courant !== avant) {
        antenneRef.current = courant
        setAntenneId(courant)
        piloteRef.current = false
        setPilote(false)
        setEcheance(null)
        setDernierClic(null)
      }
      if (!a.hdeskTvImage) return
      // Antenne d'abord. En Piloter, elle seule : c'est elle qu'on regarde au rythme des gestes.
      const ordre = piloteRef.current
        ? ids.filter((id) => id === courant)
        : [...ids.filter((id) => id === courant), ...ids.filter((id) => id !== courant)]
      // Aperçus l'un après l'autre : le processus de capture répond à une demande à la fois.
      for (const id of ordre) {
        const img = await a
          .hdeskTvImage(id)
          .catch((e: unknown): ImageTv => ({ statut: 'erreur', id, message: String(e) }))
        if (!actif) return
        setImages((prec) => ({ ...prec, [id]: img }))
      }
    }
    // Boucle SANS chevauchement, comme la TV : le tour suivant part quand le précédent est rendu.
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
      } else
        minuterie = setTimeout(
          () => void boucle(),
          piloteRef.current ? intervallePiloteMs : intervalleMs
        )
    }
    rafraichirRef.current = () => void boucle()
    void boucle()
    return () => {
      actif = false
      rafraichirRef.current = null
      if (minuterie) clearTimeout(minuterie)
    }
  }, [active, api, intervalleMs, intervallePiloteMs])

  // Titres des fils, relus à chaque ouverture de la vue (conv-344). Échec = l'identifiant reste affiché.
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

  /** Le fil par son titre ; un clic ouvre la conversation (conv-344). « manuel » ou absent : texte. */
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
    if (!pilote || echeance === null) return
    const minuterie = setInterval(() => {
      const t = Date.now()
      if (t >= echeance) {
        piloteRef.current = false
        setPilote(false)
        setEcheance(null)
        setDernierClic(null)
        setTexte('')
      } else setMaintenant(t)
    }, 1000)
    return () => clearInterval(minuterie)
  }, [pilote, echeance])

  /** Chaque geste repousse le retour automatique en Regarder. */
  const prolonger = (): void => {
    if (!piloteRef.current) return
    const t = Date.now()
    setMaintenant(t)
    setEcheance(t + delaiPilotageMs)
  }

  const piloter = (): void => {
    const t = Date.now()
    piloteRef.current = true
    setPilote(true)
    setMaintenant(t)
    setEcheance(t + delaiPilotageMs)
    setRetourGeste(null)
    // La cadence change (antenne seule, plus vite) : on relance la boucle tout de suite.
    rafraichirRef.current?.()
  }

  const choisir = (id: string): void => {
    if (id === antenneRef.current) return
    antenneRef.current = id
    setAntenneId(id)
    quitterPilotage()
    setRetourGeste(null)
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

  const cliquerImage = (e: React.MouseEvent<HTMLImageElement>): void => {
    const img = antenneId ? images[antenneId] : undefined
    if (!pilote || !imageVisible(img)) return
    const p = pointCapture(e, img)
    if (!p) return
    setDernierClic({ id: img.id, ...p })
    void envoyer({ id: img.id, ...p })
  }

  // Molette : 1 cran par tranche de 100 px de deltaY (bas = négatif, comme Windows).
  const molette = (e: React.WheelEvent<HTMLImageElement>): void => {
    const img = antenneId ? images[antenneId] : undefined
    if (!pilote || !imageVisible(img) || !e.deltaY) return
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
    if (!dernierClic || dernierClic.id !== antenneId || (!texte && !entree)) return
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
    // l'id (conv-1056) : l'entrée vide réserve seulement la place du retour.
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

  // Geste sur l'ÉCRAN RÉEL : confirmation explicite à chaque fois, même texte que la TV.
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

  // Création par le formulaire OU par « Relancer » (Récents, conv-344) : même chemin, même refus
  // avant tout lancement.
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

  const relancer = (r: LancementRecent): void =>
    void lancer({
      id: r.id,
      executable: r.executable,
      arguments: r.arguments,
      travail: r.travail,
      conversationId: r.conversationId
    })

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

  /** Contenu de l'écran du bureau choisi selon le statut de sa dernière capture. */
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
            onClick={cliquerImage}
            onWheel={molette}
          />
          {img.statut === 'uni' && <span className="hdesk-ecran-note">{t('hdesk.imageUnie')}</span>}
        </>
      )
    if (img?.statut === 'ferme') return <span>{t('hdesk.bureauFerme')}</span>
    if (img?.statut === 'erreur')
      return <span title={img.message}>{t('hdesk.apercuImpossible')}</span>
    return <span>{t('hdesk.capture')}</span>
  }

  /** Pastille d'une ligne : verte, orange (sans fil, image unie, aperçu en échec) ou éteinte. */
  const etatPoint = (b: BureauGere): string => {
    const statut = images[b.id]?.statut
    if (statut === 'ferme') return 'is-eteint'
    if (!b.conversationId || statut === 'uni' || statut === 'erreur') return 'is-alerte'
    return 'is-ok'
  }

  /** « notepad.exe · conv-1019 · 10:53 » ; un bureau sans fiche : « image unie · sans fil ». */
  const sousLigne = (b: BureauGere): string =>
    [
      b.executable ? nomDeFichier(b.executable) : null,
      images[b.id]?.statut === 'uni' ? t('hdesk.sousLigne.imageUnie') : null,
      b.conversationId ?? t('hdesk.sansFil'),
      momentCourt(b.lanceLe, luA)
    ]
      .filter(Boolean)
      .join(' · ')

  const bureaux = etatListe?.ok ? etatListe.bureaux : []
  const recents = etatListe?.ok ? (etatListe.recents ?? []) : []
  const antenne = bureaux.find((b) => b.id === antenneId) ?? bureaux[0]
  const imageAntenne = antenne ? images[antenne.id] : undefined
  const pilotable = Boolean(cible()?.hdeskTvAct) && imageVisible(imageAntenne)
  const restantMs = echeance === null ? delaiPilotageMs : Math.max(0, echeance - maintenant)
  const visePret = Boolean(antenne && dernierClic && dernierClic.id === antenne.id)
  const sansFil = bureaux.filter((b) => !b.conversationId).length
  const retoursOrphelins = Object.entries(retours).filter(([id]) => !antenne || id !== antenne.id)
  // Le compte à rebours reste un élément à part (`hdesk-compte-a-rebours`) au milieu de la phrase
  // traduite : on la coupe à l'endroit de `{duree}`.
  const [retourAvant = '', retourApres = ''] = t('hdesk.pilote.retour').split('{duree}')

  return (
    <section className="view-page hdesk-gestion-view" data-testid="hdesk-view" data-active={active}>
      <ViewTopBar
        eyebrow={t('hdesk.eyebrow')}
        title={t('hdesk.titre')}
        actions={
          <span className="hdesk-entete">
            {bureaux.length > 0 && (
              <span className="hdesk-stats" data-testid="hdesk-direct">
                <span>
                  {riche(
                    t(bureaux.length > 1 ? 'hdesk.stats.ouverts' : 'hdesk.stats.ouvert', {
                      n: bureaux.length
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
            <button
              type="button"
              className="btn btn-accent"
              data-testid="hdesk-nouveau"
              onClick={() => {
                setFormOuvert((o) => !o)
                setRetourCreation(null)
              }}
            >
              {formOuvert ? t('commun.annuler') : t('hdesk.nouveau')}
            </button>
          </span>
        }
      />

      {formOuvert && (
        <form className="hdesk-formulaire" data-testid="hdesk-formulaire" onSubmit={creer}>
          {/* L'application d'abord : l'identifiant se propose à partir d'elle (conv-344). */}
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
            {/* conv-344 : l'écran disait « 40 s » alors que l'application attend CREATION_ATTENTE_MS. */}
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
        <p className="hdesk-etat hdesk-retour is-erreur" role="alert" data-testid="hdesk-erreur">
          {t('hdesk.listeImpossible', { message: etatListe.message })}
        </p>
      ) : (
        <div className={`hdesk-console${antenne ? '' : ' is-vide'}`}>
          <nav className="hdesk-cote" aria-label={t('hdesk.titre')}>
            {antenne ? (
              <ul className="hdesk-liste" data-testid="hdesk-liste">
                {bureaux.map((b) => {
                  const choisi = b.id === antenne.id
                  const enCours = enFermeture.has(b.id)
                  return (
                    <li key={b.id} className={`hdesk-ligne-case${enCours ? ' is-fermeture' : ''}`}>
                      {/* Le bureau choisi porte LE CADRE DU CHOIX du thème (conv-1025), plus le
                          cadre --err ni l'étiquette « À l'antenne ». */}
                      <button
                        type="button"
                        className={`hdesk-ligne${choisi ? ' is-choisi' : ''}`}
                        data-testid={`hdesk-moniteur-${b.id}`}
                        aria-pressed={choisi}
                        title={b.executable ? `${b.travail}\n${b.executable}` : b.travail}
                        onClick={() => choisir(b.id)}
                      >
                        <i className={`hdesk-point ${etatPoint(b)}`} aria-hidden="true" />
                        <span className="hdesk-ligne-texte">
                          <b className={b.relie ? undefined : 'hdesk-non-relie'}>{b.travail}</b>
                          <span className="hdesk-ligne-sous">{sousLigne(b)}</span>
                        </span>
                      </button>
                      {/* LA CROIX (conv-1002) : « met des croix sur les ptites box en bas pour fermer
                          les hdesk ». Bouton FRÈRE de la ligne (un bouton ne peut pas en contenir un
                          autre) ; même fermeture que « Fermer », donc même confirmation. */}
                      <button
                        type="button"
                        className="hdesk-ligne-fermer"
                        data-testid={`hdesk-fermer-moniteur-${b.id}`}
                        aria-label={t('hdesk.ligne.fermer.aria', { travail: b.travail })}
                        title={enCours ? t('hdesk.fermeture') : t('hdesk.ligne.fermer.titre')}
                        disabled={enCours}
                        onClick={() => void fermer(b)}
                      >
                        <svg viewBox="0 0 12 12" aria-hidden="true">
                          <path d="M3 3l6 6M9 3l-6 6" />
                        </svg>
                      </button>
                    </li>
                  )
                })}
              </ul>
            ) : (
              <div className="hdesk-etat hdesk-vide" data-testid="hdesk-vide">
                <p>{t('hdesk.vide')}</p>
                {!formOuvert && (
                  <button type="button" className="btn" onClick={() => setFormOuvert(true)}>
                    {t('hdesk.creerUnBureau')}
                  </button>
                )}
              </div>
            )}

            {/* « Récents » (conv-344) : relancer un bureau fermé sans rien retaper — aussi quand plus
                aucun bureau n'est ouvert, c'est même là qu'il sert le plus. */}
            {recents.length > 0 && (
              <section
                className="hdesk-recents"
                data-testid="hdesk-recents"
                aria-label={t('hdesk.recents')}
              >
                <h3>{t('hdesk.recents')}</h3>
                <ul>
                  {recents.map((r) => (
                    <li
                      key={`${r.id}|${r.executable}|${r.arguments}`}
                      data-testid={`hdesk-recent-${r.id}`}
                      title={`${r.id} · ${r.executable}`}
                    >
                      <i className="hdesk-point is-eteint" aria-hidden="true" />
                      <span className="hdesk-ligne-texte">
                        <b>{r.travail}</b>
                        <span className="hdesk-ligne-sous">
                          {[nomDeFichier(r.executable), momentCourt(r.lanceLe, luA)]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      </span>
                      <button
                        type="button"
                        className="btn btn-sm hdesk-btn-discret"
                        data-testid={`hdesk-relancer-${r.id}`}
                        disabled={creationEnCours}
                        onClick={() => relancer(r)}
                      >
                        {t('hdesk.relancer')}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </nav>

          {antenne && (
            <article
              className="hdesk-detail"
              data-testid="hdesk-antenne"
              data-bureau={antenne.id}
              aria-label={t('hdesk.detail.aria', { travail: antenne.travail })}
            >
              <div
                className={`hdesk-barre${pilote ? ' is-pilote' : ''}`}
                data-testid="hdesk-bandeau"
              >
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
                    onClick={piloter}
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
                  data-testid={`hdesk-basculer-${antenne.id}`}
                  title={t('hdesk.afficher.titre')}
                  onClick={() => void basculer(antenne)}
                >
                  {t('hdesk.afficher')}
                </button>
                <button
                  type="button"
                  className="btn btn-sm hdesk-btn-danger"
                  data-testid={`hdesk-fermer-${antenne.id}`}
                  disabled={enFermeture.has(antenne.id)}
                  onClick={() => void fermer(antenne)}
                >
                  {enFermeture.has(antenne.id) ? t('hdesk.fermeture') : t('commun.fermer')}
                </button>
                {pilote && (
                  <span className="hdesk-jauge" aria-hidden="true">
                    <i style={{ width: `${(restantMs / delaiPilotageMs) * 100}%` }} />
                  </span>
                )}
              </div>

              {retours[antenne.id] && (
                <p
                  className={`hdesk-retour ${retours[antenne.id].ok ? 'is-ok' : 'is-erreur'}`}
                  role={retours[antenne.id].ok ? 'status' : 'alert'}
                  data-testid={`hdesk-retour-${antenne.id}`}
                >
                  {enFermeture.has(antenne.id) ? (
                    <>
                      <Spinner size={12} /> {t('hdesk.fermetureEnCours')}
                    </>
                  ) : (
                    retours[antenne.id].message
                  )}
                </p>
              )}

              {/* Plus de « TV » (conv-1025) : ni liseré irisé, ni lignes de balayage, ni reflet. En
                  Piloter, l'écran prend le cadre du choix du thème. */}
              <div className={`hdesk-ecran${pilote ? ' is-pilote' : ''}`} data-testid="hdesk-ecran">
                {ecran(antenne)}
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
                    if (!t || !dernierClic || dernierClic.id !== antenne.id) return
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
                <span title={t('hdesk.pied.id.titre')}>{antenne.id}</span>
                {antenne.conversationId ? (
                  <span>
                    {t('hdesk.pied.fil')} {fil(antenne)}
                  </span>
                ) : (
                  <span className="is-alerte">{t('hdesk.pied.sansFil')}</span>
                )}
                {antenne.lanceLe && (
                  <span>{t('hdesk.pied.lance', { quand: quand(antenne.lanceLe) })}</span>
                )}
                <span className="hdesk-espace" />
                <span className="hdesk-cadence">
                  <i className="hdesk-point is-ok" aria-hidden="true" />
                  {t('hdesk.cadence', {
                    duree: secondes(pilote ? intervallePiloteMs : intervalleMs)
                  })}
                </span>
              </p>
            </article>
          )}
        </div>
      )}
    </section>
  )
}
