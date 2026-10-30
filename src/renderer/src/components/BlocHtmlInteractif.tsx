/**
 * BLOC ```html-interactif DU FIL — une page HTML dont les scripts TOURNENT (graphique qu'on survole,
 * calculateur, filtre, simulation). Demande conv-1292, 2026-10-29 : « pages visuelles avec du
 * JavaScript », ce que T3 Code fait et que le ```html-render (rendu dans la page de l'app, sans
 * script) ne peut pas faire.
 *
 * Le HTML ne tourne JAMAIS dans la page de l'app : il part dans une page isolee de l'app
 * (`page-interactive.html`, ou `scene-3d.html` si la page nomme le moteur 3D : `pageIsoleePour`),
 * dans un cadre `sandbox="allow-scripts"` sans `allow-same-origin`. Meme isolement que Bloc3D.tsx —
 * origine opaque, aucun reseau, ni `window.api` ni le DOM de l'app — et meme filtre de navigation
 * de la fenetre : aucune nouvelle page n'est ouverte a l'app.
 *
 * Contrairement a une scene, le cadre n'a pas de hauteur fixe : il prend la hauteur que la page lui
 * signale et se pose sans bord sur le fond du fil, comme un ```html-render. Il est monte a sa
 * premiere apparition a l'ecran.
 *
 * LIBERATION (conv-1304, 2026-10-30). Une page qui fait de la 3D tient un contexte WebGL — Chromium
 * en retire au-dela d'une quinzaine — et une animation qui tourne pour rien : elle n'est montee que
 * pres de l'ecran, comme une scene (Bloc3D.tsx). Une page sans 3D (~5 Mo) est liberee plus loin, et
 * seulement si l'utilisateur ne l'a pas touchee : la demonter perdrait ce qu'il y a saisi, que la
 * page n'a pas forcement sauvegarde. Son localStorage, garde par le fil, survit au demontage.
 *
 * MATURITE (conv-1304, 2026-10-30) : une barre discrete sous la page (voir le code, relancer,
 * copier le code, agrandir, enregistrer), les avis de la page empiles sans doublon (erreur avec sa
 * ligne DANS LE BLOC et bouton « Corriger », alerte, avertissement), l'avis d'une page figee, et les
 * demandes de la page — copie, lien, ancre, stockage — servies par le fil apres validation
 * (`lireMessagePage`).
 */
import { useContext, useEffect, useMemo, useRef, useState } from 'react'
import { TYPE_MESSAGE_SCENE_3D } from '../../../shared/scene-3d'
import { useTextesArtefactsEtBandeaux } from '../textes-ecrans/artefacts-et-bandeaux'
import {
  DELAI_RESSOURCES_MS,
  HAUTEUR_INITIALE_PAGE,
  PERIODE_SIGNE_DE_VIE_MS,
  SANDBOX_PAGE_INTERACTIVE,
  SEUIL_PAGE_FIGEE_MS,
  STYLE_PAGE_INTERACTIVE,
  ajouterAvis,
  chargerStockageDeLaPage,
  defilerLeFilVers,
  empreintePage,
  extraitDeLErreur,
  gesteRecentDeLUtilisateur,
  lireMessagePage,
  lireThemePourPage,
  nomFichierDePage,
  pageIsoleePour,
  pageUtiliseLeMoteur3d,
  reponseALaPage,
  retenirStockageDeLaPage,
  titreDePage,
  type AvisPage
} from './page-interactive'
import { pageAutonome, type RessourcesPage } from './page-autonome'
import { RemplirSaisieDuFil } from './saisie-du-fil'
import './BlocHtmlInteractif.css'

/** Monte a cette distance de l'ecran, pour que la page soit prete quand elle arrive. */
const MARGE_VISIBILITE = '300px 0px'
/** Une page sans 3D n'est liberee qu'au-dela : un petit defilement ne doit pas la relancer. */
const MARGE_LIBERATION = '1500px 0px'

/**
 * `scrollMargin` et non le seul `rootMargin` : le fil defile dans son propre conteneur, et
 * `rootMargin` n'agit que sur la fenetre. Le cadre etait donc monte et libere a ras de l'ecran.
 * L'option existe dans Chromium mais pas encore dans le type de TypeScript.
 */
const marges = (marge: string): IntersectionObserverInit =>
  ({ rootMargin: marge, scrollMargin: marge }) as IntersectionObserverInit

/**
 * Un lien de la page s'ouvre PAR LE FIL, comme un lien du Markdown : une ancre posee dans le bloc
 * puis cliquee passe par le clic des liens du fil (navigateur integre selon le reglage) puis par
 * `setWindowOpenHandler` (http/https seulement). Aucun chemin d'ouverture propre a la page.
 */
function ouvrirParLeFil(hote: HTMLElement, href: string): void {
  const ancre = document.createElement('a')
  ancre.href = href
  ancre.target = '_blank'
  ancre.rel = 'noopener noreferrer'
  ancre.hidden = true
  hote.appendChild(ancre)
  ancre.click()
  ancre.remove()
}

/**
 * Le fichier part par le telechargement de Chromium, donc par la boite « Enregistrer sous » de
 * Windows. Ancre posee HORS du fil : le clic des liens du Markdown ne doit pas la voir.
 */
function telecharger(contenu: string, nom: string): void {
  const adresse = URL.createObjectURL(new Blob([contenu], { type: 'text/html;charset=utf-8' }))
  const ancre = document.createElement('a')
  ancre.href = adresse
  ancre.download = nom
  ancre.hidden = true
  document.body.appendChild(ancre)
  ancre.click()
  ancre.remove()
  window.setTimeout(() => URL.revokeObjectURL(adresse), 60_000)
}

export function BlocHtmlInteractif({ html }: { html: string }): React.JSX.Element {
  const { t } = useTextesArtefactsEtBandeaux()
  // Boutons de choix `#autowin-prompt` (conv-1304) : ils REMPLISSENT la saisie, jamais n'envoient.
  const remplirSaisie = useContext(RemplirSaisieDuFil)
  const hoteRef = useRef<HTMLElement>(null)
  const cadreRef = useRef<HTMLIFrameElement>(null)
  const [monte, setMonte] = useState(() => typeof IntersectionObserver === 'undefined')
  const [hauteur, setHauteur] = useState(HAUTEUR_INITIALE_PAGE)
  const [avis, setAvis] = useState<AvisPage[]>([])
  // Barre du bloc (conv-1304) : voir le code, relancer la page, copier son code. Le cadre reste
  // monte quand on lit le code : ce que l'utilisateur a fait dans la page n'est pas perdu.
  const [voirCode, setVoirCode] = useState(false)
  const [version, setVersion] = useState(0)
  const [codeCopie, setCodeCopie] = useState(false)
  const [agrandi, setAgrandi] = useState(false)
  const [figee, setFigee] = useState(false)
  const cle = useMemo(() => empreintePage(html), [html])
  const avec3d = useMemo(() => pageUtiliseLeMoteur3d(html), [html])
  // Ce que le fil sait de la page, lu par ses minuteries et ses observateurs.
  const prochRef = useRef(true)
  const toucheeRef = useRef(false)
  const agrandiRef = useRef(false)
  const dernierSigneRef = useRef<number | null>(null)
  const ressourcesRef = useRef<{ demande: number; minuterie: number } | null>(null)
  const numeroDemandeRef = useRef(0)

  useEffect(() => {
    const hote = hoteRef.current
    if (!hote || typeof IntersectionObserver === 'undefined') return
    const visible = (entrees: IntersectionObserverEntry[]): boolean =>
      entrees.some((entree) => entree.isIntersecting)
    const proche = new IntersectionObserver((entrees) => {
      prochRef.current = visible(entrees)
      if (prochRef.current) setMonte(true)
      else if (avec3d) setMonte(false)
    }, marges(MARGE_VISIBILITE))
    proche.observe(hote)
    const loin = avec3d
      ? null
      : new IntersectionObserver((entrees) => {
          if (!visible(entrees) && !toucheeRef.current && !agrandiRef.current) setMonte(false)
        }, marges(MARGE_LIBERATION))
    loin?.observe(hote)
    return () => {
      proche.disconnect()
      loin?.disconnect()
    }
  }, [avec3d])

  // Signe de vie : seulement pour une page montree et une fenetre visible. Une minuterie retardee
  // (veille du poste, app occupee) ne prouve rien contre la page : elle remet le compteur a zero.
  useEffect(() => {
    if (!monte) return
    let tic = performance.now()
    const minuterie = window.setInterval(() => {
      const maintenant = performance.now()
      const retard = maintenant - tic > PERIODE_SIGNE_DE_VIE_MS * 2
      tic = maintenant
      const cadre = cadreRef.current?.contentWindow
      const dernier = dernierSigneRef.current
      if (dernier === null) return
      if (!cadre || retard || !prochRef.current || document.visibilityState !== 'visible') {
        dernierSigneRef.current = maintenant
        return
      }
      cadre.postMessage({ type: TYPE_MESSAGE_SCENE_3D, ping: Math.round(maintenant) }, '*')
      if (maintenant - dernier > SEUIL_PAGE_FIGEE_MS) setFigee(true)
    }, PERIODE_SIGNE_DE_VIE_MS)
    return () => {
      window.clearInterval(minuterie)
      dernierSigneRef.current = null
    }
  }, [monte, version])

  const enregistrerAvec = (ressources: RessourcesPage): void => {
    const hote = hoteRef.current
    if (!hote) return
    telecharger(
      pageAutonome({
        html,
        style: STYLE_PAGE_INTERACTIVE,
        theme: lireThemePourPage(hote),
        titre: titreDePage(html) || t('pageInteractive.cadre'),
        ressources
      }),
      nomFichierDePage(html)
    )
  }

  useEffect(() => {
    if (!monte) return
    const ecouter = (event: MessageEvent): void => {
      const cadre = cadreRef.current?.contentWindow
      const hote = hoteRef.current
      // Seul NOTRE cadre parle a ce bloc, meme si un autre imite le format.
      if (!cadre || !hote || event.source !== cadre) return
      const message = lireMessagePage(event.data)
      if (!message) return
      switch (message.etat) {
        case 'pret':
          // Une page relancee ou remontee repart de zero : ses avis d'avant ne valent plus.
          setAvis([])
          setFigee(false)
          dernierSigneRef.current = performance.now()
          chargerStockageDeLaPage(cle, (stockage) => {
            // La page a pu etre relancee pendant la lecture du disque : ce cadre n'existe plus.
            if (cadreRef.current?.contentWindow !== cadre) return
            // Origine opaque : aucune cible plus precise que '*'. Le destinataire est fixe par la
            // reference du cadre, pas par l'origine.
            cadre.postMessage(
              {
                type: TYPE_MESSAGE_SCENE_3D,
                page: {
                  html,
                  style: STYLE_PAGE_INTERACTIVE,
                  theme: lireThemePourPage(hote),
                  stockage
                }
              },
              '*'
            )
          })
          break
        case 'pong':
          dernierSigneRef.current = performance.now()
          setFigee(false)
          break
        case 'touchee':
          toucheeRef.current = true
          break
        case 'echap':
          if (agrandiRef.current) hote.hidePopover?.()
          break
        case 'ressources': {
          const attendue = ressourcesRef.current
          if (!attendue || attendue.demande !== message.demande) break
          window.clearTimeout(attendue.minuterie)
          ressourcesRef.current = null
          enregistrerAvec(message)
          break
        }
        case 'hauteur':
          setHauteur(message.hauteur)
          break
        case 'erreur':
        case 'alerte':
        case 'avertissement':
          setAvis((courants) =>
            ajouterAvis(courants, { ton: message.etat, message: message.message })
          )
          break
        case 'stockage':
          retenirStockageDeLaPage(cle, message.donnees)
          break
        case 'defiler':
          defilerLeFilVers(hote, message.y)
          break
        // Copie et lien : seulement juste apres un VRAI clic de l'utilisateur dans la page (le
        // clic dans le cadre active aussi le fil). Une page qui le tente seule est refusee.
        case 'lien':
          if (gesteRecentDeLUtilisateur()) ouvrirParLeFil(hote, message.href)
          else
            setAvis((courants) =>
              ajouterAvis(courants, {
                ton: 'avertissement',
                message: t('pageInteractive.lienSansClic', { adresse: message.href })
              })
            )
          break
        case 'copier': {
          const repondre = (ok: boolean, motif?: string): void =>
            cadre.postMessage(reponseALaPage(message.demande, ok, motif), '*')
          if (!gesteRecentDeLUtilisateur() || !navigator.clipboard) {
            repondre(false, t('pageInteractive.copieSansClic'))
            break
          }
          navigator.clipboard.writeText(message.texte).then(
            () => repondre(true),
            (erreur: unknown) => repondre(false, String(erreur))
          )
          break
        }
        // Bouton de choix : le texte va dans la saisie, l'utilisateur le relit et l'envoie
        // lui-meme. Meme garde que la copie : une page qui le tente seule ne touche pas a la saisie
        // (elle ecraserait ce que l'utilisateur est en train d'ecrire).
        case 'prompt':
          if (!gesteRecentDeLUtilisateur())
            setAvis((courants) =>
              ajouterAvis(courants, {
                ton: 'avertissement',
                message: t('pageInteractive.saisieSansClic')
              })
            )
          else if (remplirSaisie) remplirSaisie(message.texte)
          else
            setAvis((courants) =>
              ajouterAvis(courants, {
                ton: 'avertissement',
                message: t('pageInteractive.saisieAbsente', { texte: message.texte })
              })
            )
          break
        default:
          break
      }
    }
    window.addEventListener('message', ecouter)
    return () => window.removeEventListener('message', ecouter)
    // `enregistrerAvec` ne lit que `html` et `t`, deja dans les dependances.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monte, html, cle, version, t, remplirSaisie])

  // Vue agrandie : le bloc passe dans la couche superieure du navigateur (`popover`) SANS bouger
  // dans la page. Le deplacer rechargerait le cadre et perdrait ce que l'utilisateur y a fait. Le
  // navigateur gere Echap et le clic a cote : on suit son etat au lieu d'en tenir un second.
  useEffect(() => {
    const hote = hoteRef.current
    if (!hote) return
    const suivre = (event: Event): void => {
      const ouvert = (event as ToggleEvent).newState === 'open'
      agrandiRef.current = ouvert
      setAgrandi(ouvert)
    }
    hote.addEventListener('toggle', suivre)
    return () => hote.removeEventListener('toggle', suivre)
  }, [])

  const basculerAgrandi = (): void => {
    const hote = hoteRef.current
    if (!hote) return
    if (agrandi) hote.hidePopover?.()
    else hote.showPopover?.()
  }

  const relancer = (): void => {
    setAvis([])
    setVoirCode(false)
    setFigee(false)
    toucheeRef.current = false
    dernierSigneRef.current = null
    setVersion((valeur) => valeur + 1)
  }

  const copierLeCode = (): void => {
    void navigator.clipboard?.writeText(html).then(() => {
      setCodeCopie(true)
      window.setTimeout(() => setCodeCopie(false), 1500)
    })
  }

  // Le moteur 3D et la boite a outils vivent dans la page isolee : c'est elle qui les rend. Une page
  // figee ne repond pas : on le dit au lieu d'un bouton mort.
  const enregistrer = (): void => {
    const cadre = cadreRef.current?.contentWindow
    if (!cadre) return
    if (ressourcesRef.current) window.clearTimeout(ressourcesRef.current.minuterie)
    numeroDemandeRef.current += 1
    const demande = numeroDemandeRef.current
    const minuterie = window.setTimeout(() => {
      ressourcesRef.current = null
      setAvis((courants) =>
        ajouterAvis(courants, {
          ton: 'avertissement',
          message: t('pageInteractive.enregistrementImpossible')
        })
      )
    }, DELAI_RESSOURCES_MS)
    ressourcesRef.current = { demande, minuterie }
    cadre.postMessage({ type: TYPE_MESSAGE_SCENE_3D, ressources: demande }, '*')
  }

  // « Corriger » : un clic DANS LE FIL (pas dans la page), qui pose dans la saisie de quoi corriger
  // sans rien recopier. L'utilisateur relit et envoie, comme un bouton de choix.
  const demanderCorrection = (probleme: string): void => {
    const extrait = extraitDeLErreur(html, probleme)
    const titre = titreDePage(html)
    remplirSaisie?.(
      t('pageInteractive.corrigerMessage', {
        page: titre ? ` « ${titre} »` : '',
        probleme,
        extrait: extrait
          ? t('pageInteractive.corrigerExtrait', { ligne: extrait.ligne, code: extrait.code })
          : ''
      })
    )
  }

  // Changement de theme (attributs de la racine, theme-mode.ts) : la page suit sans se recharger.
  useEffect(() => {
    if (!monte || typeof MutationObserver === 'undefined') return
    const observateur = new MutationObserver(() => {
      const cadre = cadreRef.current?.contentWindow
      const hote = hoteRef.current
      if (!cadre || !hote) return
      cadre.postMessage({ type: TYPE_MESSAGE_SCENE_3D, theme: lireThemePourPage(hote) }, '*')
    })
    observateur.observe(document.documentElement, { attributes: true })
    return () => observateur.disconnect()
  }, [monte])

  const boutonCorriger = (probleme: string): React.JSX.Element | null =>
    remplirSaisie ? (
      <button
        type="button"
        className="bloc-html-interactif__corriger"
        data-action="html-interactif-corriger"
        onClick={() => demanderCorrection(probleme)}
      >
        {t('pageInteractive.corriger')}
      </button>
    ) : null

  return (
    <section
      ref={hoteRef}
      className="bloc-html-interactif"
      data-testid="chat-inline-html-interactif"
      data-agrandi={agrandi ? 'oui' : undefined}
      popover="auto"
    >
      {monte ? (
        <iframe
          key={version}
          ref={cadreRef}
          className="bloc-html-interactif__cadre"
          data-testid="html-interactif-cadre"
          title={t('pageInteractive.cadre')}
          // Masque, pas demonte, pendant la lecture du code : la page garde son etat.
          hidden={voirCode}
          // Agrandie, la page prend la hauteur de la vue et defile dans son cadre.
          style={agrandi ? undefined : { height: `${hauteur}px` }}
          // Une des deux pages isolees de l'app, les seules adresses que le filtre de navigation de
          // la fenetre accepte pour un cadre (isSceneFrameUrl). `allow-forms` en plus : voir
          // SANDBOX_PAGE_INTERACTIVE.
          src={pageIsoleePour(html)}
          sandbox={SANDBOX_PAGE_INTERACTIVE}
          referrerPolicy="no-referrer"
          allow="camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'; fullscreen 'none'; xr-spatial-tracking 'none'"
        />
      ) : (
        <div
          className="bloc-html-interactif__cadre"
          style={{ height: `${hauteur}px` }}
          aria-hidden="true"
        />
      )}
      {voirCode && (
        <pre className="md-code bloc-html-interactif__code" data-testid="html-interactif-code">
          <code>{html}</code>
        </pre>
      )}
      {figee && (
        <p className="bloc-html-interactif__figee" role="alert" data-testid="html-interactif-figee">
          {t('pageInteractive.figee')}
          <button
            type="button"
            className="bloc-html-interactif__corriger"
            data-action="html-interactif-relancer-figee"
            onClick={relancer}
          >
            {t('pageInteractive.relancer')}
          </button>
          {boutonCorriger(t('pageInteractive.problemeFigee'))}
        </p>
      )}
      {avis.length > 0 && (
        <ul className="bloc-html-interactif__avis" data-testid="html-interactif-avis">
          {avis.map((un, rang) => (
            <li
              key={`${un.ton}-${rang}`}
              className={`bloc-html-interactif__avis-${un.ton}`}
              role={un.ton === 'erreur' ? 'alert' : 'status'}
              data-testid={un.ton === 'erreur' ? 'html-interactif-erreur' : undefined}
            >
              {un.ton === 'erreur'
                ? t('pageInteractive.plantee', {
                    message: un.message || t('scene.erreurInconnue')
                  })
                : un.ton === 'alerte'
                  ? t('pageInteractive.alerte', { message: un.message })
                  : un.message}
              {un.fois > 1 && <span className="bloc-html-interactif__fois"> ×{un.fois}</span>}
              {un.ton === 'erreur' && boutonCorriger(un.message || t('scene.erreurInconnue'))}
              {un.ton === 'alerte' && (
                <button
                  type="button"
                  className="bloc-html-interactif__fermer"
                  aria-label={t('pageInteractive.fermerAlerte')}
                  onClick={() => setAvis((courants) => courants.filter((_, i) => i !== rang))}
                >
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <div
        className="bloc-html-interactif__barre"
        role="toolbar"
        aria-label={t('pageInteractive.barre')}
      >
        <button
          type="button"
          data-action="html-interactif-code"
          aria-pressed={voirCode}
          onClick={() => setVoirCode((valeur) => !valeur)}
        >
          {/* Identiques dans les deux langues : laisses en dur (artefacts-et-bandeaux.ts). */}
          {voirCode ? 'Page' : 'Code'}
        </button>
        <button type="button" data-action="html-interactif-relancer" onClick={relancer}>
          {t('pageInteractive.relancer')}
        </button>
        <button
          type="button"
          data-action="html-interactif-copier"
          data-copie={codeCopie ? 'oui' : undefined}
          onClick={copierLeCode}
        >
          {codeCopie ? t('pageInteractive.codeCopie') : t('pageInteractive.copierCode')}
        </button>
        <button type="button" data-action="html-interactif-agrandir" onClick={basculerAgrandi}>
          {agrandi ? t('pageInteractive.reduire') : t('pageInteractive.agrandir')}
        </button>
        <button type="button" data-action="html-interactif-enregistrer" onClick={enregistrer}>
          {t('pageInteractive.enregistrer')}
        </button>
      </div>
    </section>
  )
}
