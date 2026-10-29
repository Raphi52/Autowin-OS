/**
 * NAVIGATEUR INTÉGRÉ DU CHAT — textes et fonctions sans rendu du panneau (conv-1286, lot 3/5).
 *
 * À part de `NavigateurIntegre.tsx` parce que la vue chat les emploie aussi (bouton de l'en-tête,
 * liens du fil, bloc inséré dans la saisie) et qu'un fichier de composant n'exporte que des
 * composants (rechargement à chaud de l'interface, règle react-refresh du lint).
 */
import {
  normaliserUrlNavigateur,
  type AnnotationNavigateur,
  type ApiNavigateur
} from '../../../shared/navigateur'
import { langueCourante } from '../langue'

// ── Textes (FR/EN) ──────────────────────────────────────────────────────────────────────────────

/*
 * Les textes vivent ICI, pas dans `textes-ecrans/` : la table du chat est en cours d'édition par un
 * autre fil (conv-1286), et une nouvelle table imposerait de toucher son test commun.
 */
const TEXTES_FR = {
  titre: 'Navigateur',
  ouvrirPanneau: 'Navigateur intégré (Ctrl+Shift+B)',
  fermerPanneau: 'Fermer le navigateur (Ctrl+Shift+B)',
  onglets: 'Onglets du navigateur',
  nouvelOnglet: 'Nouvel onglet (Ctrl+T)',
  fermerOnglet: 'Fermer l’onglet {titre}',
  sansTitre: 'Nouvel onglet',
  reculer: 'Reculer',
  avancer: 'Avancer',
  recharger: 'Recharger',
  adresse: 'Adresse ou recherche',
  annoter: 'Annoter',
  annoterTitre: 'Annoter : cliquez un élément ou glissez une zone, puis commentez',
  choisir: 'Choisir',
  choisirTitre: 'Choisir un élément de la page pour le chat (Ctrl+Shift+S)',
  coteACote: 'Côte à côte',
  pleinCadre: 'Plein cadre',
  menu: 'Plus d’options',
  garderCookies: 'Garder les cookies',
  effacerDonnees: 'Effacer les données',
  ouvrirDefaut: 'Ouvrir dans le navigateur par défaut',
  liensIci: 'Ouvrir ici les liens du chat',
  agentPilote: 'L’agent pilote cet onglet',
  accordTitre: 'L’agent veut agir sur {origine}',
  accordUneFois: 'Autoriser une fois',
  accordToujours: 'Toujours',
  accordRefuser: 'Refuser',
  annotations: 'Annotations ({n})',
  supprimer: 'Supprimer l’annotation {n}',
  sansCommentaire: '(sans commentaire)',
  envoyer: 'Envoyer au chat',
  vide: 'Aucune page ouverte. Tapez une adresse ou cliquez +.',
  pageMasquee: 'Page masquée le temps du menu.',
  redimensionner: 'Redimensionner le navigateur'
} as const

export type CleNavigateur = keyof typeof TEXTES_FR

const TEXTES_EN: Record<CleNavigateur, string> = {
  titre: 'Browser',
  ouvrirPanneau: 'Built-in browser (Ctrl+Shift+B)',
  fermerPanneau: 'Close the browser (Ctrl+Shift+B)',
  onglets: 'Browser tabs',
  nouvelOnglet: 'New tab (Ctrl+T)',
  fermerOnglet: 'Close tab {titre}',
  sansTitre: 'New tab',
  reculer: 'Back',
  avancer: 'Forward',
  recharger: 'Reload',
  adresse: 'Address or search',
  annoter: 'Annotate',
  annoterTitre: 'Annotate: click an element or drag an area, then comment',
  choisir: 'Pick',
  choisirTitre: 'Pick an element of the page for the chat (Ctrl+Shift+S)',
  coteACote: 'Side by side',
  pleinCadre: 'Full frame',
  menu: 'More options',
  garderCookies: 'Keep cookies',
  effacerDonnees: 'Clear data',
  ouvrirDefaut: 'Open in the default browser',
  liensIci: 'Open chat links here',
  agentPilote: 'The agent is driving this tab',
  accordTitre: 'The agent wants to act on {origine}',
  accordUneFois: 'Allow once',
  accordToujours: 'Always',
  accordRefuser: 'Deny',
  annotations: 'Annotations ({n})',
  supprimer: 'Delete annotation {n}',
  sansCommentaire: '(no comment)',
  envoyer: 'Send to chat',
  vide: 'No page open. Type an address or click +.',
  pageMasquee: 'Page hidden while the menu is open.',
  redimensionner: 'Resize the browser'
}

/** Un texte du panneau dans la langue de l'interface ; exporté pour le bouton de l'en-tête du fil. */
export function texteNavigateur(
  cle: CleNavigateur,
  valeurs: Record<string, string | number> = {}
): string {
  const table = langueCourante() === 'en' ? TEXTES_EN : TEXTES_FR
  return table[cle].replace(/\{(\w+)\}/g, (brut, nom: string) =>
    nom in valeurs ? String(valeurs[nom]) : brut
  )
}

// ── Fonctions pures (testées seules) ───────────────────────────────────────────────────────────

const HOTES_LOCAUX = new Set(['localhost', '127.0.0.1', '[::1]'])

/**
 * Le lien cliqué dans le fil s'ouvre-t-il dans le panneau ? Rend l'adresse normalisée, ou `null`
 * pour garder le comportement actuel (navigateur du système). Un serveur local s'ouvre TOUJOURS ici
 * (c'est le cas d'usage : regarder ce que l'agent vient de lancer) ; le reste seulement si le
 * réglage « Ouvrir ici les liens du chat » est actif.
 */
export function lienAOuvrirDansLePanneau(
  href: string,
  ouvrirLiensDuChatIci: boolean
): string | null {
  if (!/^https?:\/\//i.test(href.trim())) return null
  const adresse = normaliserUrlNavigateur(href)
  if (!adresse) return null
  let hote: string
  try {
    hote = new URL(adresse).hostname.toLowerCase()
  } catch {
    return null
  }
  if (HOTES_LOCAUX.has(hote)) return adresse
  return ouvrirLiensDuChatIci ? adresse : null
}

/** Ce que l'utilisateur tape dans la barre d'adresse : une adresse chargeable, ou une recherche. */
export function adresseDeLaSaisie(saisie: string): string | null {
  const brut = saisie.trim()
  if (!brut) return null
  const ressembleAUneAdresse =
    !/\s/.test(brut) &&
    (/^[a-z][a-z0-9+.-]*:/i.test(brut) ||
      /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(brut) ||
      /^[^/]+\.[a-z0-9-]{2,}(:\d+)?(\/|$)/i.test(brut))
  if (ressembleAUneAdresse) {
    const adresse = normaliserUrlNavigateur(brut)
    if (adresse) return adresse
  }
  return `https://www.google.com/search?q=${encodeURIComponent(brut)}`
}

/** `data:image/png;base64,…` → fichier joignable ; `null` si l'adresse n'est pas une image base64. */
function fichierDeLaCapture(dataUrl: string, nom: string): File | null {
  const trouve = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i.exec(dataUrl)
  if (!trouve) return null
  const binaire = atob(trouve[2])
  const octets = new Uint8Array(binaire.length)
  for (let i = 0; i < binaire.length; i += 1) octets[i] = binaire.charCodeAt(i)
  return new File([octets], nom, { type: trouve[1] })
}

/**
 * Le bloc posé dans la saisie pour l'agent (n°, URL, sélecteur, extrait, styles, commentaire) et
 * les captures recadrées à joindre en images. Le bloc reste en français : c'est l'agent qui le lit,
 * comme la référence d'Alt+clic (conv-1038).
 */
export function blocPourLeChat(
  annotations: readonly AnnotationNavigateur[],
  choisi: boolean
): { texte: string; images: File[] } {
  const images: File[] = []
  const entete = choisi
    ? '[Navigateur intégré — élément choisi]'
    : `[Navigateur intégré — ${annotations.length} annotation${annotations.length > 1 ? 's' : ''}]`
  const lignes = [entete]
  annotations.forEach((annotation, index) => {
    const numero = index + 1
    lignes.push(`${numero}. ${annotation.url}`)
    lignes.push(`   Sélecteur : ${annotation.selecteur || '(aucun)'}`)
    if (annotation.texteElement) lignes.push(`   Extrait : « ${annotation.texteElement} »`)
    const s = annotation.styles
    lignes.push(
      `   Styles : police ${s.police} · taille ${s.taille} · couleur ${s.couleur} · fond ${s.fond} · ${s.marges}`
    )
    if (!choisi) lignes.push(`   Commentaire : ${annotation.commentaire || '(aucun)'}`)
    if (annotation.captureDataUrl) {
      // Nom UNIQUE par annotation : `addFiles` dédoublonne par nom, deux envois successifs de « n°1 »
      // ne doivent pas se manger l'un l'autre.
      const nom = `navigateur-${numero}-${annotation.id.slice(-8)}.png`
      const fichier = fichierDeLaCapture(annotation.captureDataUrl, nom)
      if (fichier) {
        images.push(fichier)
        lignes.push(`   Capture : ${nom} (jointe)`)
      }
    }
  })
  return { texte: lignes.join('\n'), images }
}

/** L'API du navigateur, absente dans les tests de la vue chat qui ne la simulent pas. */
export function apiNavigateur(): ApiNavigateur | undefined {
  return (window.api as { navigateur?: ApiNavigateur } | undefined)?.navigateur
}

export function zoomDeLaFenetre(): number {
  const lu = (window.api as { getZoomFactor?: () => number } | undefined)?.getZoomFactor?.()
  return typeof lu === 'number' && Number.isFinite(lu) && lu > 0 ? lu : 1
}
