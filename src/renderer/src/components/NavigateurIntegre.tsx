/**
 * NAVIGATEUR INTÉGRÉ DU CHAT — le panneau (conv-1286, lot 3/5, 2026-10-29).
 *
 * Un navigateur posé à côté du fil : la barre d'adresse, les onglets toujours visibles juste dessous,
 * Choisir un élément (un clic, inséré tout de suite dans la saisie), barre d'accord par site quand
 * l'agent veut écrire dans une page. Le bouton Annoter est retiré (conv-1306, 2026-10-30) : le
 * principal garde ce mode, plus rien ne l'allume ici ; celles déjà posées restent listées et envoyables.
 *
 * LE CADRE DE PAGE (/draft de conv-1306, « Cadre de page ») : la page prend un cadre ambre quand
 * l'agent pilote OU attend un accord, avec sa bande en haut et la barre d'accord au pied. La bande
 * est TOUJOURS là (titre de l'onglet au repos, en entier : l'onglet, lui, le coupe) : une bande qui
 * apparaît ferait sauter la page à chaque action de l'agent, juste après qu'il a repéré sa cible.
 *
 * LA PAGE N'EST PAS DANS LE DOM : c'est une vue Electron posée PAR-DESSUS la fenêtre, au cadre que
 * ce panneau mesure (`poserCadre`). Tout ce qui doit passer au-dessus d'elle — menu ⋮, aperçu
 * d'image, autre onglet de l'app, glissement de la poignée — doit donc la RETIRER (`poserCadre(null)`) :
 * sinon la page recouvre le menu ou continue de flotter sur un autre écran.
 *
 * Contrat : `src/shared/navigateur.ts` ; API : `window.api.navigateur` (`src/preload/index.d.ts`).
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type {
  AnnotationNavigateur,
  EtatNavigateur,
  ModeNavigateur,
  RectNavigateur,
  ReglagesNavigateur
} from '../../../shared/navigateur'
import { useLangue } from '../langue'
import { FriseGestesNavigateur } from './FriseGestesNavigateur'
// fix-ok: cause mesurée (conv-1286) — une fonction exportée par ce fichier fait échouer `eslint`
// (react-refresh/only-export-components, code 1) : textes et outils vivent dans navigateur-integre-outils.ts.
import {
  adresseDeLaSaisie,
  apiNavigateur,
  decouperAdresse,
  texteNavigateur,
  DUREE_BANDEAU_APRES_GESTE_MS,
  gestesDeLOnglet,
  LIBELLE_ORDRE,
  ORDRES_DU_PILOTAGE,
  rangDuGeste,
  zoomDeLaFenetre
} from './navigateur-integre-outils'
import './NavigateurIntegre.css'

// ── Icônes ──────────────────────────────────────────────────────────────────────────────────────

/** Tracés de la maquette Nacre (conv-1306) : trait fin, couleur du texte qui les porte. */
const TRACES = {
  reculer: <path d="M10 3.5L5.5 8l4.5 4.5" />,
  avancer: <path d="M6 3.5L10.5 8 6 12.5" />,
  recharger: (
    <>
      <path d="M12.6 9.2A4.8 4.8 0 1 1 11.4 4.4" />
      <path d="M12 2.4v2.8H9.2" />
    </>
  ),
  cadenas: (
    <>
      <rect x="4" y="7.2" width="8" height="6" rx="1.6" />
      <path d="M5.8 7.2V5.4a2.2 2.2 0 0 1 4.4 0v1.8" />
    </>
  ),
  globe: (
    <>
      <circle cx="8" cy="8" r="5.2" />
      <path d="M2.8 8h10.4M8 2.8c2.2 2 2.2 8.4 0 10.4M8 2.8c-2.2 2-2.2 8.4 0 10.4" />
    </>
  ),
  plus: <path d="M8 3.5v9M3.5 8h9" />,
  fermer: <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />,
  menu: (
    <>
      <circle cx="8" cy="3.6" r="1.1" fill="currentColor" />
      <circle cx="8" cy="8" r="1.1" fill="currentColor" />
      <circle cx="8" cy="12.4" r="1.1" fill="currentColor" />
    </>
  ),
  choisir: <path d="M4 3l8.2 3.9-3.6 1.3-1.4 3.7z" />
} as const

function Icone({ nom }: { nom: keyof typeof TRACES }): React.JSX.Element {
  return (
    <svg className="navigateur-icone" viewBox="0 0 16 16" aria-hidden="true">
      {TRACES[nom]}
    </svg>
  )
}

// ── Composant ───────────────────────────────────────────────────────────────────────────────────

const CLE_LARGEUR = 'autowin.chat.navigateurLargeur'
const LARGEUR = { min: 320, defaut: 520, max: 1600 } as const

function largeurMemorisee(): number {
  const lue = Number(window.localStorage.getItem(CLE_LARGEUR))
  const valeur = Number.isFinite(lue) && lue > 0 ? lue : LARGEUR.defaut
  return Math.min(LARGEUR.max, Math.max(LARGEUR.min, valeur))
}

export interface PropsNavigateurIntegre {
  conversationId: string
  /**
   * Faux quand le panneau ne doit pas montrer la page : vue chat pas à l'écran (autre onglet de
   * l'app) ou surcouche ouverte au-dessus (aperçu d'image). La page native est alors retirée.
   */
  visible: boolean
  onFermer: () => void
  /** « Envoyer au chat » : les annotations du fil, dans l'ordre. */
  onEnvoyerAuChat: (annotations: AnnotationNavigateur[]) => void
  /** « Choisir un élément » : l'élément cliqué, à insérer tout de suite. */
  onElementChoisi: (annotation: AnnotationNavigateur) => void
  /** Les réglages lus ou changés ici (la vue chat en a besoin pour ses liens). */
  onReglages?: (reglages: ReglagesNavigateur) => void
}

export function NavigateurIntegre({
  conversationId,
  visible,
  onFermer,
  onEnvoyerAuChat,
  onElementChoisi,
  onReglages
}: PropsNavigateurIntegre): React.JSX.Element {
  useLangue()
  const t = texteNavigateur
  const [etat, setEtat] = useState<EtatNavigateur | null>(null)
  const [annotations, setAnnotations] = useState<AnnotationNavigateur[]>([])
  const [reglages, setReglages] = useState<ReglagesNavigateur | null>(null)
  const [saisie, setSaisie] = useState('')
  const [menuOuvert, setMenuOuvert] = useState(false)
  const [pleinCadre, setPleinCadre] = useState(false)
  const [largeur, setLargeur] = useState(largeurMemorisee)
  const [redimensionnement, setRedimensionnement] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)
  // L'heure n'avance que par `recevoir` et la minuterie du bandeau : relue au rendu, elle le rendrait
  // impur (react-hooks/purity) et personne ne redessinerait le panneau à l'échéance.
  const [maintenant, setMaintenant] = useState(0)

  const racineRef = useRef<HTMLElement | null>(null)
  const zoneRef = useRef<HTMLDivElement | null>(null)
  const adresseRef = useRef<HTMLInputElement | null>(null)
  const listeOngletsRef = useRef<HTMLDivElement | null>(null)
  const etatRef = useRef<EtatNavigateur | null>(null)
  const annotationsRef = useRef<AnnotationNavigateur[]>([])
  const dernierCadreRef = useRef<string | null>(null)
  // Les rappels du parent changent à chaque rendu de la vue chat : lus par ref, ils ne relancent
  // pas l'abonnement à l'état. Mis à jour après le rendu (une ref ne s'écrit pas pendant).
  const rappelsRef = useRef({ onEnvoyerAuChat, onElementChoisi, onReglages })
  useLayoutEffect(() => {
    rappelsRef.current = { onEnvoyerAuChat, onElementChoisi, onReglages }
  })

  const ongletActif = etat?.onglets.find((onglet) => onglet.id === etat.ongletActif) ?? null
  const cadreVisible = visible && !menuOuvert && !redimensionnement
  // Tout ce qui, en s'ouvrant, peut DÉPLACER la page sans changer sa taille : voir le cadre plus bas.
  const disposition = [Boolean(erreur), Boolean(etat?.demandeAccord), annotations.length > 0].join()

  function agir(promesse: Promise<unknown> | undefined): void {
    setErreur(null)
    void promesse?.catch((raison: unknown) => {
      setErreur(raison instanceof Error ? raison.message : String(raison))
    })
  }

  // Annotations relues quand leur nombre bouge ; celles nées d'un « Choisir » partent dans la saisie.
  async function relireAnnotations(livrerChoix: boolean): Promise<void> {
    const api = apiNavigateur()
    if (!api) return
    const connues = new Set(annotationsRef.current.map((a) => a.id))
    let liste = await api.annotations(conversationId)
    if (livrerChoix) {
      const choisies = liste.filter((a) => !connues.has(a.id) && !a.commentaire)
      for (const choisie of choisies) {
        rappelsRef.current.onElementChoisi(choisie)
        void api.supprimerAnnotation(choisie.id)
      }
      if (choisies.length > 0) {
        // Le composer est caché en plein cadre : on revient côte à côte pour montrer l'insertion.
        setPleinCadre(false)
        const parties = new Set(choisies.map((a) => a.id))
        liste = liste.filter((a) => !parties.has(a.id))
      }
    }
    annotationsRef.current = liste
    setAnnotations(liste)
  }

  // État du fil : relu à l'ouverture, puis poussé par le processus principal à chaque changement.
  // Un autre fil = un autre montage (`key` posée par la vue chat) : rien à remettre à zéro ici.
  useEffect(() => {
    const api = apiNavigateur()
    if (!api) return
    let vivant = true
    const recevoir = (suivant: EtatNavigateur): void => {
      if (!vivant || suivant.conversationId !== conversationId) return
      const precedent = etatRef.current
      etatRef.current = suivant
      setEtat(suivant)
      setMaintenant(Date.now())
      const avant = precedent ? precedent.nombreAnnotations : annotationsRef.current.length
      if (suivant.nombreAnnotations !== avant || !precedent) {
        const enChoix = suivant.mode === 'choisir' || precedent?.mode === 'choisir'
        void relireAnnotations(enChoix && suivant.nombreAnnotations > avant)
      }
    }
    const desabonner = api.surEtat(recevoir)
    void api.etat(conversationId).then(recevoir)
    return () => {
      vivant = false
      desabonner()
    }
    // `relireAnnotations` ne lit que des refs et `conversationId`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId])

  // Le fil à l'écran côté principal : seul l'onglet actif de CE fil peut être visible.
  useEffect(() => {
    const api = apiNavigateur()
    if (!api) return
    void api.afficherFil(conversationId)
    return () => {
      void api.afficherFil(null)
    }
  }, [conversationId])

  // Réglages (cookies, liens du chat), lus une fois.
  useEffect(() => {
    const api = apiNavigateur()
    if (!api) return
    let vivant = true
    void api.reglages.lire().then((lus) => {
      if (!vivant) return
      setReglages(lus)
      rappelsRef.current.onReglages?.(lus)
    })
    return () => {
      vivant = false
    }
  }, [])

  // La barre d'adresse suit l'onglet actif, sauf pendant que l'utilisateur y tape.
  const urlActive = ongletActif?.url ?? ''
  useEffect(() => {
    if (document.activeElement === adresseRef.current) return
    setSaisie(urlActive === 'about:blank' ? '' : urlActive)
  }, [urlActive, ongletActif?.id])

  // Rien n'est poussé quand les 20 s s'écoulent : sans cette minuterie, le bandeau resterait affiché
  // jusqu'au prochain changement du fil. `finBandeau` et non `Date.now()` : une minuterie peut partir
  // une milliseconde trop tôt, et le bandeau ne se retirerait alors jamais.
  const gestesOnglet = gestesDeLOnglet(etat?.gestes ?? [], etat?.ongletActif ?? null)
  const dernierGeste = gestesOnglet.at(-1)
  const finBandeau = dernierGeste ? dernierGeste.debut + DUREE_BANDEAU_APRES_GESTE_MS : null
  useEffect(() => {
    if (finBandeau === null) return
    const minuterie = setTimeout(
      () => setMaintenant(finBandeau),
      Math.max(0, finBandeau - Date.now())
    )
    return () => clearTimeout(minuterie)
  }, [finBandeau])

  /*
   * LE CADRE DE LA PAGE. Mesuré sur la zone d'affichage, en pixels CSS du rendu, avec le zoom de la
   * fenêtre (le principal les convertit). Remesuré quand la zone change de taille, quand la fenêtre
   * change (zoom compris : il déclenche `resize`) et quand un VOISIN de gauche change de largeur —
   * le panneau glisse alors sans changer de taille, ce que l'observateur de la zone ne voit pas.
   * Même trou en hauteur : une rangée qui s'ouvre au-dessus pendant qu'une autre se ferme dessous
   * déplace la zone à taille égale, d'où `disposition`.
   */
  useEffect(() => {
    const api = apiNavigateur()
    if (!api) return
    const poser = (rect: RectNavigateur | null): void => {
      const zoom = zoomDeLaFenetre()
      const cle = JSON.stringify([rect, zoom])
      if (cle === dernierCadreRef.current) return
      dernierCadreRef.current = cle
      void api.poserCadre(rect, zoom)
    }
    const zone = zoneRef.current
    if (!cadreVisible || !zone) {
      poser(null)
      return
    }
    const mesurer = (): void => {
      const r = zone.getBoundingClientRect()
      poser({
        x: Math.round(r.left),
        y: Math.round(r.top),
        largeur: Math.round(r.width),
        hauteur: Math.round(r.height)
      })
    }
    mesurer()
    const observateur = typeof ResizeObserver === 'function' ? new ResizeObserver(mesurer) : null
    observateur?.observe(zone)
    let voisin = racineRef.current?.previousElementSibling ?? null
    while (voisin) {
      observateur?.observe(voisin)
      voisin = voisin.previousElementSibling
    }
    window.addEventListener('resize', mesurer)
    return () => {
      observateur?.disconnect()
      window.removeEventListener('resize', mesurer)
    }
  }, [cadreVisible, pleinCadre, largeur, disposition])

  // Panneau démonté (fermé, mosaïque) : la page native ne doit pas rester à flotter sur le chat.
  useEffect(() => {
    return () => {
      dernierCadreRef.current = null
      void apiNavigateur()?.poserCadre(null, zoomDeLaFenetre())
    }
  }, [])

  // Raccourcis du panneau, seulement quand il est à l'écran.
  const raccourcisRef = useRef({ nouvelOnglet: () => {}, basculerChoisir: () => {} })
  useLayoutEffect(() => {
    raccourcisRef.current = {
      nouvelOnglet: () => nouvelOnglet(),
      basculerChoisir: () => basculerMode('choisir')
    }
  })
  useEffect(() => {
    if (!visible) return
    const surTouche = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return
      const touche = event.key.toLowerCase()
      if (!event.shiftKey && touche === 't') {
        event.preventDefault()
        raccourcisRef.current.nouvelOnglet()
      } else if (event.shiftKey && touche === 's') {
        event.preventDefault()
        raccourcisRef.current.basculerChoisir()
      }
    }
    document.addEventListener('keydown', surTouche)
    return () => document.removeEventListener('keydown', surTouche)
  }, [visible])

  // Menu ⋮ : Échap ou clic ailleurs le ferme (et rend la page).
  useEffect(() => {
    if (!menuOuvert) return
    const surTouche = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setMenuOuvert(false)
    }
    const surClic = (event: MouseEvent): void => {
      const cible = event.target as Node | null
      if (cible && racineRef.current?.querySelector('.navigateur-menu-zone')?.contains(cible))
        return
      setMenuOuvert(false)
    }
    document.addEventListener('keydown', surTouche)
    document.addEventListener('mousedown', surClic)
    return () => {
      document.removeEventListener('keydown', surTouche)
      document.removeEventListener('mousedown', surClic)
    }
  }, [menuOuvert])

  // Trop d'onglets pour la rangée : elle défile, et l'onglet actif doit rester à l'écran (un onglet
  // ouvert par l'agent naît au bout, hors de vue).
  useEffect(() => {
    listeOngletsRef.current
      ?.querySelector('.navigateur-onglet.is-actif')
      ?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [etat?.ongletActif, etat?.onglets.length])

  function nouvelOnglet(): void {
    agir(apiNavigateur()?.ouvrir(conversationId, 'about:blank'))
    requestAnimationFrame(() => adresseRef.current?.focus())
  }

  function basculerMode(mode: Exclude<ModeNavigateur, null>): void {
    const actuel = etatRef.current?.mode ?? null
    agir(apiNavigateur()?.basculerMode(actuel === mode ? null : mode))
  }

  function charger(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const adresse = adresseDeLaSaisie(saisie)
    const api = apiNavigateur()
    if (!adresse || !api) return
    adresseRef.current?.blur()
    agir(ongletActif ? api.naviguer(ongletActif.id, adresse) : api.ouvrir(conversationId, adresse))
  }

  function changerReglages(partiel: Partial<ReglagesNavigateur>): void {
    const api = apiNavigateur()
    if (!api) return
    setErreur(null)
    void api.reglages
      .ecrire(partiel)
      .then((ecrits) => {
        setReglages(ecrits)
        rappelsRef.current.onReglages?.(ecrits)
      })
      .catch((raison: unknown) =>
        setErreur(raison instanceof Error ? raison.message : String(raison))
      )
  }

  function envoyerAuChat(): void {
    const api = apiNavigateur()
    const lot = annotationsRef.current
    if (!api || lot.length === 0) return
    rappelsRef.current.onEnvoyerAuChat(lot)
    annotationsRef.current = []
    setAnnotations([])
    setPleinCadre(false)
    agir(api.viderAnnotations(conversationId))
  }

  function commencerRedimensionnement(event: React.PointerEvent<HTMLDivElement>): void {
    event.preventDefault()
    const departX = event.clientX
    const depart = largeur
    let derniere = depart
    // La page native mange les mouvements de souris qui passent sur elle : on la retire le temps du
    // glissement, sinon la poignée « décroche » dès qu'on tire vers la droite.
    setRedimensionnement(true)
    const bouger = (mouvement: PointerEvent): void => {
      derniere = Math.min(LARGEUR.max, Math.max(LARGEUR.min, depart + departX - mouvement.clientX))
      setLargeur(derniere)
    }
    const lacher = (): void => {
      window.localStorage.setItem(CLE_LARGEUR, String(derniere))
      setRedimensionnement(false)
      window.removeEventListener('pointermove', bouger)
      window.removeEventListener('pointerup', lacher)
    }
    window.addEventListener('pointermove', bouger)
    window.addEventListener('pointerup', lacher)
  }

  const pilotage = etat?.pilotage ?? 'libre'
  const rang = rangDuGeste(gestesOnglet)
  // Un geste pas fini garde le bandeau au-delà des 20 s : une question d'accord dure jusqu'à 120 s, et
  // « Reprendre la main » doit rester à portée pendant qu'elle attend.
  const gesteEnCours = dernierGeste?.etat === 'en-cours' || dernierGeste?.etat === 'prochain'
  const bandeauVisible =
    Boolean(etat?.agentPilote) ||
    pilotage !== 'libre' ||
    gesteEnCours ||
    (finBandeau !== null && maintenant < finBandeau)

  const mode = etat?.mode ?? null
  const onglets = etat?.onglets ?? []
  const demande = etat?.demandeAccord
  const adresseLue = decouperAdresse(saisie)
  const chiffre = decouperAdresse(urlActive)?.chiffre ?? false
  const titreActif = ongletActif
    ? ongletActif.titre && ongletActif.titre !== 'about:blank'
      ? ongletActif.titre
      : t('sansTitre')
    : ''

  return (
    <>
      {!pleinCadre && (
        <div
          className="navigateur-redimensionneur"
          role="separator"
          aria-orientation="vertical"
          aria-label={t('redimensionner')}
          aria-valuemin={LARGEUR.min}
          aria-valuemax={LARGEUR.max}
          aria-valuenow={largeur}
          onPointerDown={commencerRedimensionnement}
        />
      )}
      <aside
        ref={racineRef}
        className={`lisere-dessus navigateur-panneau${pleinCadre ? ' is-plein-cadre' : ''}`}
        style={pleinCadre ? undefined : { width: `${largeur}px` }}
        aria-label={t('titre')}
        data-testid="navigateur-panneau"
      >
        <div className="navigateur-barre">
          <button
            type="button"
            className="navigateur-bouton"
            aria-label={t('reculer')}
            title={t('reculer')}
            disabled={!ongletActif?.peutReculer}
            onClick={() => ongletActif && agir(apiNavigateur()?.reculer(ongletActif.id))}
          >
            <Icone nom="reculer" />
          </button>
          <button
            type="button"
            className="navigateur-bouton"
            aria-label={t('avancer')}
            title={t('avancer')}
            disabled={!ongletActif?.peutAvancer}
            onClick={() => ongletActif && agir(apiNavigateur()?.avancer(ongletActif.id))}
          >
            <Icone nom="avancer" />
          </button>
          <button
            type="button"
            className="navigateur-bouton"
            aria-label={t('recharger')}
            title={t('recharger')}
            disabled={!ongletActif}
            onClick={() => ongletActif && agir(apiNavigateur()?.recharger(ongletActif.id))}
          >
            <Icone nom="recharger" />
          </button>
          <div className="navigateur-capsule">
            <div className="navigateur-capsule-interieur">
              <span className="navigateur-site">
                {ongletActif?.chargement ? (
                  <span className="spinner" aria-hidden="true" />
                ) : (
                  <Icone nom={chiffre ? 'cadenas' : 'globe'} />
                )}
              </span>
              <form
                className={`navigateur-adresse${adresseLue ? ' a-une-vue' : ''}`}
                onSubmit={charger}
              >
                <input
                  ref={adresseRef}
                  type="text"
                  className="navigateur-adresse-champ"
                  aria-label={t('adresse')}
                  placeholder={t('adresse')}
                  value={saisie}
                  spellCheck={false}
                  onChange={(event) => setSaisie(event.target.value)}
                  onFocus={(event) => event.currentTarget.select()}
                />
                {adresseLue && (
                  <span className="navigateur-adresse-vue" aria-hidden="true">
                    <b>{adresseLue.site}</b>
                    {adresseLue.suite}
                  </span>
                )}
              </form>
            </div>
          </div>
          <div className="navigateur-bascule">
            <button
              type="button"
              className={`navigateur-mode${mode === 'choisir' ? ' is-actif' : ''}`}
              aria-label={t('choisir')}
              aria-pressed={mode === 'choisir'}
              title={t('choisirTitre')}
              disabled={!ongletActif}
              onClick={() => basculerMode('choisir')}
            >
              <Icone nom="choisir" />
              <span className="navigateur-mode-libelle">{t('choisir')}</span>
            </button>
          </div>
          <div className="navigateur-menu-zone">
            <button
              type="button"
              className="navigateur-bouton"
              aria-label={t('menu')}
              title={t('menu')}
              aria-haspopup="menu"
              aria-expanded={menuOuvert}
              onClick={() => setMenuOuvert((v) => !v)}
            >
              <Icone nom="menu" />
            </button>
            {menuOuvert && (
              <div className="navigateur-menu" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOuvert(false)
                    setPleinCadre((v) => !v)
                  }}
                >
                  <span className="navigateur-coche" aria-hidden="true" />
                  {pleinCadre ? t('coteACote') : t('pleinCadre')}
                </button>
                <button
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={reglages?.garderCookies ?? false}
                  onClick={() => changerReglages({ garderCookies: !reglages?.garderCookies })}
                >
                  <span className="navigateur-coche" aria-hidden="true">
                    {reglages?.garderCookies ? '✓' : ''}
                  </span>
                  {t('garderCookies')}
                </button>
                <button
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={reglages?.ouvrirLiensDuChatIci ?? false}
                  onClick={() =>
                    changerReglages({ ouvrirLiensDuChatIci: !reglages?.ouvrirLiensDuChatIci })
                  }
                >
                  <span className="navigateur-coche" aria-hidden="true">
                    {reglages?.ouvrirLiensDuChatIci ? '✓' : ''}
                  </span>
                  {t('liensIci')}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  disabled={!ongletActif || ongletActif.url === 'about:blank'}
                  onClick={() => {
                    setMenuOuvert(false)
                    if (ongletActif)
                      agir(apiNavigateur()?.ouvrirDansNavigateurParDefaut(ongletActif.url))
                  }}
                >
                  <span className="navigateur-coche" aria-hidden="true" />
                  {t('ouvrirDefaut')}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="navigateur-menu-danger"
                  onClick={() => {
                    setMenuOuvert(false)
                    agir(apiNavigateur()?.effacerDonnees())
                  }}
                >
                  <span className="navigateur-coche" aria-hidden="true" />
                  {t('effacerDonnees')}
                </button>
              </div>
            )}
          </div>
          {/* LA CROIX QUITTE LA BARRE D'ADRESSE (conv-1317, 2026-10-30 : « pas dans la barre d'url la
              crois dans la barre d'url enleve la ») : dans la capsule, elle semblait effacer
              l'adresse. Au bout de la rangée, elle ferme le panneau, sans doute possible. */}
          <button
            type="button"
            className="navigateur-petit-fermer"
            aria-label={t('fermerPanneau')}
            title={t('fermerPanneau')}
            onClick={onFermer}
          >
            <Icone nom="fermer" />
          </button>
        </div>
        {/* TOUJOURS VISIBLES, juste sous l'adresse (conv-1306, 2026-10-30 : repliés dans un compteur, on
            ne les trouvait pas). Le « + » reste hors de ce qui défile : quand les onglets débordent, il
            reste à portée. Pas de barre de défilement : la molette verticale fait défiler la rangée. */}
        <div className="navigateur-onglets">
          <div
            ref={listeOngletsRef}
            className="navigateur-onglets-liste"
            role="tablist"
            aria-label={t('onglets')}
            onWheel={(event) => {
              event.currentTarget.scrollLeft += event.deltaY
            }}
          >
            {onglets.map((onglet) => {
              const titre =
                onglet.titre && onglet.titre !== 'about:blank' ? onglet.titre : t('sansTitre')
              const actif = onglet.id === etat?.ongletActif
              return (
                <div key={onglet.id} className={`navigateur-onglet${actif ? ' is-actif' : ''}`}>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={actif}
                    className="navigateur-onglet-titre"
                    title={onglet.url}
                    onClick={() => agir(apiNavigateur()?.activerOnglet(onglet.id))}
                  >
                    {onglet.chargement && <span className="spinner" aria-hidden="true" />}
                    <span className="navigateur-onglet-libelle">{titre}</span>
                  </button>
                  <button
                    type="button"
                    className="navigateur-petit-fermer"
                    aria-label={t('fermerOnglet', { titre })}
                    title={t('fermerOnglet', { titre })}
                    onClick={() => agir(apiNavigateur()?.fermerOnglet(onglet.id))}
                  >
                    <Icone nom="fermer" />
                  </button>
                </div>
              )
            })}
          </div>
          <button
            type="button"
            className="navigateur-bouton"
            aria-label={t('nouvelOnglet')}
            title={t('nouvelOnglet')}
            onClick={nouvelOnglet}
          >
            <Icone nom="plus" />
          </button>
        </div>
        {bandeauVisible && (
          <div
            className={`navigateur-pilotage${pilotage === 'main' ? ' is-main' : ''}`}
            data-testid="navigateur-pilotage"
          >
            <span className="navigateur-pilotage-texte" role="status">
              {pilotage === 'main' ? t('tuAsLaMain') : t('agentPilote')}
              {pilotage === 'pause' && (
                <span className="navigateur-pilotage-pause">
                  {` ${rang ? t('enPauseGeste', rang) : t('enPause')}`}
                </span>
              )}
            </span>
            <span className="navigateur-pilotage-boutons">
              {ORDRES_DU_PILOTAGE[pilotage].map((ordre) => (
                <button
                  key={ordre}
                  type="button"
                  className="navigateur-pilotage-bouton"
                  onClick={() => agir(apiNavigateur()?.piloter(conversationId, ordre))}
                >
                  {t(LIBELLE_ORDRE[ordre])}
                </button>
              ))}
            </span>
          </div>
        )}
        <FriseGestesNavigateur
          gestes={etat?.gestes ?? []}
          ongletActif={etat?.ongletActif ?? null}
        />

        {erreur && (
          <div className="navigateur-erreur" role="alert">
            {erreur}
          </div>
        )}
        <div className={`navigateur-cadre${etat?.agentPilote || demande ? ' is-agent' : ''}`}>
          <div className="navigateur-cadre-tete">
            {/* « L'agent pilote » vit dans le bandeau du pas-à-pas, toujours visible tant qu'il pilote :
                le répéter ici l'affichait deux fois (conv-1286). */}
            {demande ? (
              <span role="status">{t('agentAttend')}</span>
            ) : (
              <span title={ongletActif?.url}>{titreActif}</span>
            )}
          </div>
          <div ref={zoneRef} className="navigateur-zone" data-testid="navigateur-zone">
            {onglets.length === 0 ? (
              <p className="navigateur-vide">{t('vide')}</p>
            ) : menuOuvert ? (
              <p className="navigateur-vide">{t('pageMasquee')}</p>
            ) : null}
          </div>
          {demande && (
            <div
              className="navigateur-accord"
              role="group"
              aria-label={t('accordTitre', { origine: demande.origine })}
            >
              <div className="navigateur-accord-texte">
                <strong>{t('accordTitre', { origine: demande.origine })}</strong>
                <span>{demande.action}</span>
              </div>
              <div className="navigateur-accord-boutons">
                <button
                  type="button"
                  className="navigateur-pilule navigateur-pilule-gel"
                  onClick={() => agir(apiNavigateur()?.repondreAccord(demande.origine, 'une-fois'))}
                >
                  {t('accordUneFois')}
                </button>
                <button
                  type="button"
                  className="navigateur-pilule"
                  onClick={() => agir(apiNavigateur()?.repondreAccord(demande.origine, 'toujours'))}
                >
                  {t('accordToujours')}
                </button>
                <button
                  type="button"
                  className="navigateur-pilule navigateur-accord-refuser"
                  onClick={() => agir(apiNavigateur()?.repondreAccord(demande.origine, 'refuser'))}
                >
                  {t('accordRefuser')}
                </button>
              </div>
            </div>
          )}
        </div>

        {annotations.length > 0 && (
          <div className="navigateur-annotations" data-testid="navigateur-annotations">
            <span className="navigateur-annotations-titre">
              {t('annotations', { n: annotations.length })}
            </span>
            <ol className="navigateur-annotations-liste">
              {annotations.map((annotation, index) => {
                const commentaire = annotation.commentaire || t('sansCommentaire')
                return (
                  <li key={annotation.id} className="navigateur-annotation" title={commentaire}>
                    <span className="navigateur-annotation-numero">{index + 1}</span>
                    <span className="navigateur-annotation-extrait">
                      {annotation.texteElement || annotation.selecteur}
                    </span>
                    {/* Le commentaire se lit au survol ; caché à l'œil, pas aux lecteurs d'écran. */}
                    <span className="navigateur-annotation-commentaire">{commentaire}</span>
                    <button
                      type="button"
                      className="navigateur-petit-fermer"
                      aria-label={t('supprimer', { n: index + 1 })}
                      title={t('supprimer', { n: index + 1 })}
                      onClick={() => agir(apiNavigateur()?.supprimerAnnotation(annotation.id))}
                    >
                      <Icone nom="fermer" />
                    </button>
                  </li>
                )
              })}
            </ol>
            <button
              type="button"
              className="navigateur-pilule navigateur-pilule-gel navigateur-envoyer"
              onClick={envoyerAuChat}
            >
              {t('envoyer')}
            </button>
          </div>
        )}
      </aside>
    </>
  )
}
