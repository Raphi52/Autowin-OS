/**
 * NAVIGATEUR INTÉGRÉ DU CHAT — le panneau (conv-1286, lot 3/5, 2026-10-29).
 *
 * Un navigateur posé à côté du fil : onglets du fil actif, barre d'adresse, mode Annoter (élément ou
 * zone + commentaire, envoyés en lot au chat), Choisir un élément (un clic, inséré tout de suite dans
 * la saisie), carte d'accord par site quand l'agent veut écrire dans une page.
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
// fix-ok: cause mesurée (conv-1286) — une fonction exportée par ce fichier fait échouer `eslint`
// (react-refresh/only-export-components, code 1) : textes et outils vivent dans navigateur-integre-outils.ts.
import {
  adresseDeLaSaisie,
  apiNavigateur,
  texteNavigateur,
  zoomDeLaFenetre
} from './navigateur-integre-outils'
import './NavigateurIntegre.css'

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

  const racineRef = useRef<HTMLElement | null>(null)
  const zoneRef = useRef<HTMLDivElement | null>(null)
  const adresseRef = useRef<HTMLInputElement | null>(null)
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

  /*
   * LE CADRE DE LA PAGE. Mesuré sur la zone d'affichage, en pixels CSS du rendu, avec le zoom de la
   * fenêtre (le principal les convertit). Remesuré quand la zone change de taille, quand la fenêtre
   * change (zoom compris : il déclenche `resize`) et quand un VOISIN de gauche change de largeur —
   * le panneau glisse alors sans changer de taille, ce que l'observateur de la zone ne voit pas.
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
  }, [cadreVisible, pleinCadre, largeur])

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

  const mode = etat?.mode ?? null
  const onglets = etat?.onglets ?? []
  const demande = etat?.demandeAccord

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
        <div className="navigateur-onglets" role="tablist" aria-label={t('onglets')}>
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
                  className="navigateur-onglet-fermer"
                  aria-label={t('fermerOnglet', { titre })}
                  title={t('fermerOnglet', { titre })}
                  onClick={() => agir(apiNavigateur()?.fermerOnglet(onglet.id))}
                >
                  ×
                </button>
              </div>
            )
          })}
          <button
            type="button"
            className="navigateur-bouton navigateur-nouvel-onglet"
            aria-label={t('nouvelOnglet')}
            title={t('nouvelOnglet')}
            onClick={nouvelOnglet}
          >
            +
          </button>
          <button
            type="button"
            className="navigateur-bouton navigateur-fermer"
            aria-label={t('fermerPanneau')}
            title={t('fermerPanneau')}
            onClick={onFermer}
          >
            ×
          </button>
        </div>

        <div className="navigateur-barre">
          <button
            type="button"
            className="navigateur-bouton"
            aria-label={t('reculer')}
            title={t('reculer')}
            disabled={!ongletActif?.peutReculer}
            onClick={() => ongletActif && agir(apiNavigateur()?.reculer(ongletActif.id))}
          >
            ←
          </button>
          <button
            type="button"
            className="navigateur-bouton"
            aria-label={t('avancer')}
            title={t('avancer')}
            disabled={!ongletActif?.peutAvancer}
            onClick={() => ongletActif && agir(apiNavigateur()?.avancer(ongletActif.id))}
          >
            →
          </button>
          <button
            type="button"
            className="navigateur-bouton"
            aria-label={t('recharger')}
            title={t('recharger')}
            disabled={!ongletActif}
            onClick={() => ongletActif && agir(apiNavigateur()?.recharger(ongletActif.id))}
          >
            ↻
          </button>
          <form className="navigateur-adresse" onSubmit={charger}>
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
          </form>
          <button
            type="button"
            className={`navigateur-bouton navigateur-mode${mode === 'annoter' ? ' is-actif' : ''}`}
            aria-pressed={mode === 'annoter'}
            title={t('annoterTitre')}
            disabled={!ongletActif}
            onClick={() => basculerMode('annoter')}
          >
            {t('annoter')}
          </button>
          <button
            type="button"
            className={`navigateur-bouton navigateur-mode${mode === 'choisir' ? ' is-actif' : ''}`}
            aria-pressed={mode === 'choisir'}
            title={t('choisirTitre')}
            disabled={!ongletActif}
            onClick={() => basculerMode('choisir')}
          >
            {t('choisir')}
          </button>
          <button
            type="button"
            className="navigateur-bouton"
            aria-pressed={pleinCadre}
            title={pleinCadre ? t('coteACote') : t('pleinCadre')}
            onClick={() => setPleinCadre((v) => !v)}
          >
            {pleinCadre ? t('coteACote') : t('pleinCadre')}
          </button>
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
              ⋮
            </button>
            {menuOuvert && (
              <div className="navigateur-menu" role="menu">
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
        </div>

        {erreur && (
          <div className="navigateur-erreur" role="alert">
            {erreur}
          </div>
        )}
        {etat?.agentPilote && (
          <div className="navigateur-pilote" role="status" data-testid="navigateur-pilote">
            {t('agentPilote')}
          </div>
        )}
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
                className="btn"
                onClick={() => agir(apiNavigateur()?.repondreAccord(demande.origine, 'une-fois'))}
              >
                {t('accordUneFois')}
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => agir(apiNavigateur()?.repondreAccord(demande.origine, 'toujours'))}
              >
                {t('accordToujours')}
              </button>
              <button
                type="button"
                className="btn navigateur-accord-refuser"
                onClick={() => agir(apiNavigateur()?.repondreAccord(demande.origine, 'refuser'))}
              >
                {t('accordRefuser')}
              </button>
            </div>
          </div>
        )}

        <div ref={zoneRef} className="navigateur-zone" data-testid="navigateur-zone">
          {onglets.length === 0 ? (
            <p className="navigateur-vide">{t('vide')}</p>
          ) : menuOuvert ? (
            <p className="navigateur-vide">{t('pageMasquee')}</p>
          ) : null}
        </div>

        {annotations.length > 0 && (
          <div className="navigateur-annotations" data-testid="navigateur-annotations">
            <div className="navigateur-annotations-titre">
              {t('annotations', { n: annotations.length })}
            </div>
            <ol className="navigateur-annotations-liste">
              {annotations.map((annotation, index) => (
                <li key={annotation.id} className="navigateur-annotation">
                  <span className="navigateur-annotation-numero">{index + 1}</span>
                  <span className="navigateur-annotation-corps">
                    <span className="navigateur-annotation-extrait">
                      {annotation.texteElement || annotation.selecteur}
                    </span>
                    <span className="navigateur-annotation-commentaire">
                      {annotation.commentaire || t('sansCommentaire')}
                    </span>
                  </span>
                  <button
                    type="button"
                    className="navigateur-onglet-fermer"
                    aria-label={t('supprimer', { n: index + 1 })}
                    title={t('supprimer', { n: index + 1 })}
                    onClick={() => agir(apiNavigateur()?.supprimerAnnotation(annotation.id))}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ol>
            <button type="button" className="btn navigateur-envoyer" onClick={envoyerAuChat}>
              {t('envoyer')}
            </button>
          </div>
        )}
      </aside>
    </>
  )
}
