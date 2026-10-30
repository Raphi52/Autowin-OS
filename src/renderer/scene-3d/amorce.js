/*
 * AMORCE DE LA PAGE `scene-3d.html` — le seul script, avec le moteur three.js, que la page a le
 * droit d'executer (sa politique de securite n'autorise QUE ces deux scripts, par leur empreinte).
 *
 * Elle recoit le code d'un bloc ```threejs du fil, envoye par le cadre parent (`Bloc3D.tsx`), et
 * l'execute par `eval` DANS cette page. C'est voulu : une page qui n'accepte aucun script en ligne
 * empeche le code de la scene d'en fabriquer un ailleurs (cadre imbrique `srcdoc`, balise
 * `<script>` injectee, attribut `onerror`). Mesure du 2026-10-16 : avec `'unsafe-inline'`, un
 * cadre `srcdoc` imbrique retrouvait un `RTCPeerConnection` intact ; avec les empreintes, il ne
 * s'execute plus.
 *
 * Messages echanges avec le parent, tous `{ type: 'autowin-scene-3d', ... }` :
 *   page -> parent : `{ etat: 'pret' }`, puis `{ etat: 'lancee' }` ou `{ etat: 'erreur', message }` ;
 *     en mode page, aussi `{ etat: 'hauteur', hauteur }` a chaque changement de taille du contenu,
 *     et (conv-1304) `alerte`/`avertissement` { message }, `stockage` { donnees }, `lien` { href },
 *     `defiler` { y } et `copier` { texte, demande } — ce dernier attend une reponse ; `pong`
 *     { ping } (signe de vie), `touchee` (premier geste de l'utilisateur), `echap` (touche Echap
 *     dans le cadre, que le fil ne voit pas) et `ressources` { demande, moteur, graphiques } ;
 *   parent -> page : `{ code }` (scene) OU `{ page: { html, style, theme, stockage } }` (page
 *     interactive), accepte UNE seule fois ; puis `{ theme }` autant de fois que le theme de l'app
 *     change, `{ reponse, ok, message }` pour chaque `demande`, `{ ping }` et `{ ressources }`.
 *   Le format de chaque message de la page est lu par `lireMessagePage` (page-interactive.ts).
 *
 * MODE PAGE (bloc ```html-interactif, conv-1292, 2026-10-29 : « des pages visuelles avec du
 * JavaScript », comme les reponses visuelles de T3 Code). Meme page, meme politique, meme
 * isolement que les scenes : seule la FORME du contenu change. Les `<script>` du HTML ne
 * s'executeraient pas (la politique n'en accepte aucun en ligne) : l'amorce les lit et les passe a
 * `eval`, comme le code d'une scene. Les attributs `onclick`... deviennent des gestionnaires par
 * `new Function` pour la meme raison.
 */
/* eslint-disable @typescript-eslint/explicit-function-return-type -- JavaScript pose tel quel dans
   la page (son empreinte est calculee sur ce texte) : aucune annotation de type n'y a sa place. */
;(() => {
  'use strict'
  const TYPE = 'autowin-scene-3d'
  const parentWindow = window.parent

  const signaler = (contenu) => {
    try {
      parentWindow.postMessage(Object.assign({ type: TYPE }, contenu), '*')
    } catch {
      /* parent disparu : rien a prevenir */
    }
  }

  const afficherErreur = (message) => {
    const texte = String(message || 'Erreur inconnue')
    let cadre = document.getElementById('autowin-scene-3d-erreur')
    if (!cadre) {
      cadre = document.createElement('pre')
      cadre.id = 'autowin-scene-3d-erreur'
      document.body.appendChild(cadre)
    }
    cadre.textContent = texte
    signaler({ etat: 'erreur', message: texte })
  }

  // 1. GARDE : ce code n'a de sens que dans le fil, dans un cadre ISOLE (origine opaque, `sandbox`
  // sans `allow-same-origin`). Ouverte seule, ou dans un cadre non isole, la page aurait l'origine
  // de l'app — elle refuse alors de faire quoi que ce soit.
  if (self.origin !== 'null' || parentWindow === window) {
    document.body.textContent =
      'Scène 3D refusée : cette page ne s’exécute que dans un bloc isolé du fil d’Autowin.'
    return
  }

  // 2. PAS DE WEBRTC. La politique de securite coupe fetch, XHR, WebSocket, images et polices
  // externes, mais pas WebRTC, qui peut joindre un serveur sans passer par elle.
  const RTC = [
    'RTCPeerConnection',
    'webkitRTCPeerConnection',
    'RTCDataChannel',
    'RTCIceCandidate',
    'RTCSessionDescription',
    'RTCRtpSender',
    'RTCRtpReceiver',
    'RTCRtpTransceiver',
    'RTCIceTransport',
    'RTCDtlsTransport',
    'RTCSctpTransport',
    'RTCCertificate'
  ]
  for (const nom of RTC) {
    try {
      Object.defineProperty(window, nom, { value: undefined, configurable: false, writable: false })
    } catch {
      /* deja absent */
    }
  }

  // MOTEUR A LA DEMANDE (conv-1304, voir page-scene-3d.mjs) : three.js est pose en TEXTE dans la
  // page, evalue seulement quand il sert — toujours pour une scene, pour une page si elle nomme
  // `THREE`. Le bloc est retire des sa lecture : le code du modele ne le retrouve pas dans le DOM.
  // Son texte reste dans cette fermeture une fois evalue : « Enregistrer en .html » le redemande.
  const blocMoteur = document.getElementById('autowin-moteur-3d')
  let texteMoteur = blocMoteur ? blocMoteur.textContent || '' : ''
  if (blocMoteur) blocMoteur.remove()
  let moteurCharge = false
  const chargerMoteur = () => {
    if (!texteMoteur || moteurCharge) return
    moteurCharge = true
    ;(0, eval)(`${texteMoteur}\n//# sourceURL=three.js`)
  }

  // Boite a outils de graphiques (conv-1304, graphiques.js) : meme recette, evaluee au premier
  // `autowin.graphique`. Une page qui ne dessine rien ne paie rien.
  const blocGraphiques = document.getElementById('autowin-graphiques')
  const texteGraphiques = blocGraphiques ? blocGraphiques.textContent || '' : ''
  if (blocGraphiques) blocGraphiques.remove()
  let creerGraphique = null
  const graphique = (cible, options) => {
    if (!creerGraphique) {
      creerGraphique = (0, eval)(`${texteGraphiques}\n//# sourceURL=graphiques.js`)
    }
    return creerGraphique(cible, options)
  }

  // Numeros de ligne : en mode page, les scripts du bloc sont concatenes dans UN eval (`page.js`) ;
  // un « ligne 57 » de cet eval ne dit rien a qui lit le bloc. `lancerPage` remplace cette
  // traduction par la table « ligne de l'eval -> ligne du bloc » (conv-1304, 2026-10-30).
  let ligneDuBloc = (ligne) => ligne
  const SOURCE_PAGE = 'page.js'
  const traduireLignes = (texte) =>
    String(texte).replace(/page\.js:(\d+)(?::\d+)?/gu, (tout, ligne) => {
      const dansLeBloc = ligneDuBloc(Number(ligne))
      return dansLeBloc === null ? tout : `ligne ${dansLeBloc} du bloc`
    })

  window.addEventListener('error', (event) => {
    // Une notification de taille reportee au cadre suivant, pas un plantage : le navigateur la leve
    // des qu'un ResizeObserver change la mise en page. Le fil affichait « La page a plante » pour
    // une page qui marchait (banc de autowin.graphique, conv-1304).
    if (/^ResizeObserver loop/u.test(String(event.message))) return
    let ou = ''
    if (event.lineno) {
      const dansLaPage = modePage && String(event.filename || '').endsWith(SOURCE_PAGE)
      const ligne = dansLaPage ? ligneDuBloc(event.lineno) : event.lineno
      ou = dansLaPage && ligne !== null ? ` (ligne ${ligne} du bloc)` : ` (ligne ${event.lineno})`
    }
    afficherErreur(`${event.message || event.error}${ou}`)
  })
  window.addEventListener('unhandledrejection', (event) => {
    afficherErreur(`Promesse rejetée : ${decrireErreur(event.reason)}`)
  })

  // En mode page, une erreur se dit en UNE ligne : son message et la ligne du bloc ou elle est
  // levee. Mesure dans l'app (conv-1304) : la pile brute ajoutait « at eval (<anonymous>) », qui
  // ne dit rien a qui lit le bloc. Les scenes gardent leurs trois lignes de pile.
  const decrireErreur = (erreur) => {
    const pile = erreur && erreur.stack ? String(erreur.stack).split('\n') : []
    if (pile.length === 0) return traduireLignes(String(erreur))
    if (modePage) {
      const cadre = pile.slice(1).find((ligne) => /page\.js:\d+/u.test(ligne))
      const ligne = cadre ? ligneDuBloc(Number(/page\.js:(\d+)/u.exec(cadre)[1])) : null
      return ligne === null ? pile[0] : `${pile[0]} (ligne ${ligne} du bloc)`
    }
    return traduireLignes(pile.slice(0, 3).join('\n'))
  }

  // 3. MODE PAGE — le theme de l'app arrive en variables CSS : le cadre a une origine opaque, les
  // variables du fil ne le traversent pas. Seuls des noms `--xxx` et des valeurs courtes passent.
  let modePage = false
  const appliquerTheme = (theme) => {
    if (!theme || typeof theme !== 'object') return
    const racine = document.documentElement
    const variables = theme.variables && typeof theme.variables === 'object' ? theme.variables : {}
    for (const [nom, valeur] of Object.entries(variables)) {
      if (!/^--[a-z0-9-]{1,40}$/iu.test(nom) || typeof valeur !== 'string') continue
      if (valeur.length > 400) continue
      racine.style.setProperty(nom, valeur)
    }
    if (typeof theme.colorScheme === 'string' && /^[a-z ]{1,20}$/iu.test(theme.colorScheme)) {
      racine.style.colorScheme = theme.colorScheme
    }
  }

  // `onclick="..."` : la politique refuse les gestionnaires en ligne. Ils sont recompiles (autorise
  // par 'unsafe-eval', comme le code d'une scene) et poses en propriete. L'attribut est retire
  // AVANT : le retirer apres remettrait la propriete a null.
  // Ils se compilent DANS LA PORTEE DES SCRIPTS de la page (`compilerDansLesScripts`, pose par le
  // code evalue) : les `const`/`let` d'un script evalue restent privees a cet eval, et un
  // `new Function` ne les voyait pas. Mesure de scripts/html-interactif-apercu.mjs (conv-1292,
  // 2026-10-29) : `const valeurs = []` + `onclick="valeurs.push(1)"` levait « valeurs is not
  // defined » au clic, la ou un navigateur ordinaire les partage. `new Function` reste le repli si
  // les scripts n'ont pas pu demarrer, et sert a signaler une faute de syntaxe des la pose.
  const CLE_COMPILATEUR = '__autowinCompilerGestionnaire'
  let compilerDansLesScripts = null
  const convertirGestionnaires = (racine) => {
    if (!racine || racine.nodeType !== 1) return
    const elements = [racine, ...racine.querySelectorAll('*')]
    for (const element of elements) {
      for (const attribut of [...element.attributes]) {
        const nom = attribut.name.toLowerCase()
        if (!/^on[a-z]+$/u.test(nom)) continue
        const source = attribut.value
        element.removeAttribute(attribut.name)
        let repli
        try {
          repli = new Function('event', source)
        } catch (erreur) {
          afficherErreur(`${nom} : ${decrireErreur(erreur)}`)
          continue
        }
        let compile = null
        element[nom] = function (event) {
          if (!compile) {
            const compilateur = compilerDansLesScripts || window[CLE_COMPILATEUR]
            compile = typeof compilateur === 'function' ? compilateur(source) : repli
          }
          // L'erreur dit QUEL attribut de QUEL element a leve (conv-1304) : la pile d'un
          // gestionnaire recompile ne pointe sur aucune ligne du bloc. Signalee ici, elle ne
          // remonte pas : sinon le fil la recevrait deux fois.
          try {
            return compile.call(this, event)
          } catch (erreur) {
            // Le message seul : la pile d'un gestionnaire recompile ne montre que l'amorce.
            const message =
              erreur && erreur.name ? `${erreur.name}: ${erreur.message}` : String(erreur)
            afficherErreur(`${nom} de ${decrireElement(this)} : ${message}`)
            return undefined
          }
        }
      }
    }
  }

  const decrireElement = (element) => {
    if (!element || element.nodeType !== 1) return 'la page'
    const id = element.id ? `#${element.id}` : ''
    const texte = (element.textContent || '').trim().replace(/\s+/gu, ' ').slice(0, 30)
    return `<${element.tagName.toLowerCase()}${id}>${texte ? ` « ${texte} »` : ''}`
  }

  // 3 bis. COMPATIBILITE DU MODE PAGE (conv-1304, 2026-10-30 : « rends la feature ultra mature »).
  // Banc `.autowin-tmp/conv-1304/banc-motifs.html` passe par html-interactif-apercu.mjs : dans le
  // cadre isole (origine opaque, sans `allow-modals`, presse-papiers ferme par `allow`),
  // localStorage, sessionStorage et document.cookie levaient SecurityError, alert/confirm etaient
  // ignores sans un mot, navigator.clipboard.writeText rendait NotAllowedError et un lien externe ne
  // faisait rien. Ce sont des gestes qu'un modele ecrit sans y penser : la page plantait ou restait
  // muette. Chacun est remplace ici par un equivalent sur, sans rien ouvrir de plus au cadre :
  //   - stockage EN MEMOIRE (localStorage garde par le fil le temps de la session de l'app) ;
  //   - alert -> message affiche sous la page ; confirm/prompt/print -> refus SIGNALE ;
  //   - copie et liens -> DEMANDES au fil, qui ne les execute qu'apres un vrai clic de
  //     l'utilisateur (activation transmise par le cadre au fil, BlocHtmlInteractif.tsx).
  const MAX_STOCKAGE = 2_000_000
  const MAX_TEXTE = 1_000_000
  // Bouton de choix : son ancre (= ANCRE_PROMPT de bouton-prompt-html.ts) et la longueur maximale
  // du message pose dans la saisie (= MAX_TEXTE_SAISIE de page-interactive.ts).
  const ANCRE_PROMPT = '#autowin-prompt'
  const MAX_SAISIE = 4000
  let remplirSaisie = () => false
  let numeroDemande = 0
  const demandesEnAttente = new Map()
  const demanderAuParent = (contenu, delai = 4000) =>
    new Promise((resoudre, rejeter) => {
      numeroDemande += 1
      const demande = numeroDemande
      const minuterie = setTimeout(() => {
        demandesEnAttente.delete(demande)
        rejeter(new DOMException('Le fil n’a pas répondu', 'NotAllowedError'))
      }, delai)
      demandesEnAttente.set(demande, { resoudre, rejeter, minuterie })
      signaler(Object.assign({ demande }, contenu))
    })
  const recevoirReponse = (donnees) => {
    const attente = demandesEnAttente.get(donnees.reponse)
    if (!attente) return
    demandesEnAttente.delete(donnees.reponse)
    clearTimeout(attente.minuterie)
    if (donnees.ok === true) attente.resoudre(undefined)
    else attente.rejeter(new DOMException(String(donnees.message || 'Refusé'), 'NotAllowedError'))
  }
  const avertir = (message) => signaler({ etat: 'avertissement', message: String(message) })

  const poser = (cible, nom, descripteur) => {
    try {
      Object.defineProperty(cible, nom, Object.assign({ configurable: true }, descripteur))
    } catch {
      /* propriete figee : la page garde le comportement du navigateur */
    }
  }

  /** Un `Storage` en memoire, avec l'acces par propriete (`localStorage.x = '1'`) d'un vrai. */
  const creerStockage = (initial, surChangement) => {
    const donnees = new Map()
    if (initial && typeof initial === 'object') {
      for (const [cle, valeur] of Object.entries(initial)) {
        if (typeof valeur === 'string') donnees.set(cle, valeur)
      }
    }
    let taille = 0
    for (const [cle, valeur] of donnees) taille += cle.length + valeur.length
    const changer = () => surChangement && surChangement(donnees)
    const api = {
      get length() {
        return donnees.size
      },
      key(rang) {
        const cle = [...donnees.keys()][Number(rang)]
        return cle === undefined ? null : cle
      },
      getItem(cle) {
        const valeur = donnees.get(String(cle))
        return valeur === undefined ? null : valeur
      },
      setItem(cle, valeur) {
        const k = String(cle)
        const v = String(valeur)
        const avant = donnees.get(k)
        const nouvelle =
          taille - (avant === undefined ? 0 : k.length + avant.length) + k.length + v.length
        if (nouvelle > MAX_STOCKAGE) {
          throw new DOMException('Stockage de la page plein', 'QuotaExceededError')
        }
        taille = nouvelle
        donnees.set(k, v)
        changer()
      },
      removeItem(cle) {
        const k = String(cle)
        const avant = donnees.get(k)
        if (avant === undefined) return
        taille -= k.length + avant.length
        donnees.delete(k)
        changer()
      },
      clear() {
        if (donnees.size === 0) return
        donnees.clear()
        taille = 0
        changer()
      }
    }
    return new Proxy(api, {
      get(cible, nom) {
        if (typeof nom === 'symbol' || nom in cible) return Reflect.get(cible, nom)
        return donnees.get(nom)
      },
      set(cible, nom, valeur) {
        if (typeof nom === 'symbol' || nom in cible) return false
        cible.setItem(nom, valeur)
        return true
      },
      deleteProperty(cible, nom) {
        if (typeof nom !== 'symbol') cible.removeItem(nom)
        return true
      },
      has(cible, nom) {
        return nom in cible || (typeof nom === 'string' && donnees.has(nom))
      },
      ownKeys() {
        return [...donnees.keys()]
      },
      getOwnPropertyDescriptor(cible, nom) {
        if (typeof nom !== 'string' || !donnees.has(nom)) return undefined
        return { value: donnees.get(nom), enumerable: true, configurable: true, writable: true }
      }
    })
  }

  const installerCompatibilite = (page) => {
    let envoi = null
    const persister = (donnees) => {
      clearTimeout(envoi)
      envoi = setTimeout(() => {
        signaler({ etat: 'stockage', donnees: Object.fromEntries(donnees) })
      }, 150)
    }
    poser(window, 'localStorage', { value: creerStockage(page.stockage, persister) })
    poser(window, 'sessionStorage', { value: creerStockage(null, null) })
    const biscuits = new Map()
    poser(document, 'cookie', {
      get: () => [...biscuits].map(([nom, valeur]) => `${nom}=${valeur}`).join('; '),
      set: (texte) => {
        const [paire, ...attributs] = String(texte).split(';')
        const egal = paire.indexOf('=')
        const nom = (egal < 0 ? '' : paire.slice(0, egal)).trim()
        const valeur = (egal < 0 ? paire : paire.slice(egal + 1)).trim()
        const perime = attributs.some((attribut) => {
          const [cle, val = ''] = attribut.split('=')
          const c = cle.trim().toLowerCase()
          if (c === 'max-age') return Number(val) <= 0
          if (c === 'expires') return Date.parse(val) <= Date.now()
          return false
        })
        if (perime) biscuits.delete(nom)
        else biscuits.set(nom, valeur)
      }
    })

    poser(window, 'alert', {
      value: (message) => {
        signaler({ etat: 'alerte', message: String(message === undefined ? '' : message) })
      }
    })
    poser(window, 'confirm', {
      value: (message) => {
        avertir(`confirm() n’existe pas dans le fil : la page a reçu « non » (${String(message)})`)
        return false
      }
    })
    poser(window, 'prompt', {
      value: (message) => {
        avertir(`prompt() n’existe pas dans le fil : la page a reçu « rien » (${String(message)})`)
        return null
      }
    })
    poser(window, 'print', { value: () => avertir('print() n’existe pas dans le fil') })

    const ouvrirLien = (adresse) => {
      let url
      try {
        url = new URL(String(adresse))
      } catch {
        avertir(`Lien ignoré, adresse relative ou invalide : ${String(adresse).slice(0, 200)}`)
        return
      }
      if (url.protocol === 'javascript:') return
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        avertir(`Lien ignoré, seuls http et https s’ouvrent : ${url.href.slice(0, 200)}`)
        return
      }
      signaler({ etat: 'lien', href: url.href })
    }
    poser(window, 'open', {
      value: (adresse) => {
        if (adresse !== undefined && adresse !== '') ouvrirLien(adresse)
        return null
      }
    })

    // BOUTONS DE CHOIX (conv-1304, 2026-10-30) : un lien `#autowin-prompt` d'une page interactive
    // REMPLIT la zone de saisie du fil avec son libelle, sans rien envoyer — dans un bloc
    // ```html-render, le meme lien envoie (bouton-prompt-html.ts), mais aucun script n'y tourne. Ici
    // le code de la page pourrait faire dire au bouton autre chose que ce qu'on lit : l'utilisateur
    // relit donc le message dans sa saisie et l'envoie lui-meme. `autowin.remplirSaisie(texte)` fait
    // le meme geste pour un message compose par la page (cases cochees, reglages). Le fil n'accepte
    // la demande que juste apres un vrai clic de l'utilisateur (BlocHtmlInteractif.tsx).
    const remplir = (texte) => {
      const t = String(texte === undefined || texte === null ? '' : texte)
        .replace(/\s+/gu, ' ')
        .trim()
      if (!t) return false
      if (t.length > MAX_SAISIE) {
        avertir(`Message trop long pour la saisie (${t.length} caractères, ${MAX_SAISIE} au plus)`)
        return false
      }
      signaler({ etat: 'prompt', texte: t })
      return true
    }
    remplirSaisie = remplir
    const autowin = window.autowin && typeof window.autowin === 'object' ? window.autowin : {}
    autowin.remplirSaisie = remplir
    autowin.graphique = graphique
    poser(window, 'autowin', { value: autowin, writable: true })

    // Le fil ne voit rien de ce qui se passe dans le cadre : ni le premier geste, qui protege la page
    // de la liberation hors ecran (conv-1304), ni Echap, qui ferme la vue agrandie.
    const geste = () => {
      document.removeEventListener('pointerdown', geste, true)
      signaler({ etat: 'touchee' })
    }
    document.addEventListener('pointerdown', geste, true)
    document.addEventListener(
      'keydown',
      (event) => {
        if (event.key === 'Escape') signaler({ etat: 'echap' })
        else geste()
      },
      true
    )
    // Phase de BULLE : un gestionnaire de la page qui appelle preventDefault garde la main.
    document.addEventListener('click', (event) => {
      if (event.defaultPrevented || event.button !== 0) return
      const cible = event.target
      const lien = cible && cible.nodeType === 1 ? cible.closest('a[href]') : null
      if (!lien) return
      const href = lien.getAttribute('href') || ''
      event.preventDefault()
      if (href === ANCRE_PROMPT) {
        remplirSaisie(lien.textContent)
        return
      }
      if (href.startsWith('#')) {
        // Le cadre prend la hauteur de son contenu, il ne defile jamais : c'est le FIL qui doit
        // amener l'ancre a l'ecran.
        const nom = decodeURIComponent(href.slice(1))
        const ancre = nom
          ? document.getElementById(nom) || document.getElementsByName(nom)[0]
          : null
        const y = ancre ? ancre.getBoundingClientRect().top + window.scrollY : 0
        signaler({ etat: 'defiler', y: Math.max(0, Math.round(y)) })
        return
      }
      if (lien.hasAttribute('download')) {
        avertir('Téléchargement impossible depuis le fil : propose plutôt un bouton « Copier »')
        return
      }
      ouvrirLien(href)
    })

    // Formulaire sans `preventDefault` : son envoi viserait la page elle-meme, refuse plus loin
    // (politique `form-action 'none'`, filtre de navigation de la fenetre). On l'arrete ICI, en
    // bulle (les gestionnaires de la page ont deja tourne) : la page reste telle quelle, sans
    // tentative de navigation ni message de refus dans la console.
    document.addEventListener('submit', (event) => {
      if (!event.defaultPrevented) event.preventDefault()
    })

    const ecrire = (texte) => {
      const t = String(texte)
      if (t.length > MAX_TEXTE) {
        return Promise.reject(
          new DOMException('Texte trop long pour le presse-papiers', 'DataError')
        )
      }
      return demanderAuParent({ etat: 'copier', texte: t })
    }
    const pressePapiers = navigator.clipboard
    if (pressePapiers) {
      poser(pressePapiers, 'writeText', { value: ecrire })
      poser(pressePapiers, 'write', {
        value: async (elements) => {
          for (const element of elements || []) {
            if (element && element.types && element.types.includes('text/plain')) {
              const blob = await element.getType('text/plain')
              return ecrire(await blob.text())
            }
          }
          throw new DOMException('Seul le texte se copie depuis le fil', 'NotAllowedError')
        }
      })
    }
    // L'ancienne recette « textarea + select() + execCommand('copy') » : meme demande au fil.
    const executerCommande = document.execCommand.bind(document)
    poser(document, 'execCommand', {
      value: (commande, ...reste) => {
        if (String(commande).toLowerCase() !== 'copy') return executerCommande(commande, ...reste)
        const actif = document.activeElement
        const champ =
          actif && typeof actif.selectionStart === 'number' && typeof actif.value === 'string'
            ? actif.value.slice(actif.selectionStart, actif.selectionEnd)
            : ''
        const texte = champ || String(window.getSelection() || '')
        if (!texte) return false
        ecrire(texte).catch((erreur) => avertir(`Copie refusée : ${erreur.message}`))
        return true
      }
    })
  }

  const TYPES_EXECUTABLES = new Set(['', 'text/javascript', 'application/javascript', 'module'])

  const lancerPage = (page) => {
    modePage = true
    const racine = document.documentElement
    racine.setAttribute('data-mode', 'page')
    appliquerTheme(page.theme)
    // Le moteur 3D seulement si la page le nomme ; sinon sa source est lachee tout de suite.
    if (/\b(?:THREE|OrbitControls)\b/u.test(page.html)) {
      try {
        chargerMoteur()
      } catch (erreur) {
        afficherErreur(`Moteur 3D : ${decrireErreur(erreur)}`)
      }
    } else {
      texteMoteur = ''
    }
    if (typeof page.style === 'string') {
      const base = document.createElement('style')
      base.textContent = page.style
      document.head.appendChild(base)
    }
    installerCompatibilite(page)
    const doc = new DOMParser().parseFromString(page.html, 'text/html')
    // Les scripts sont lus AVANT de deplacer le contenu, dans l'ordre du document. Un script
    // externe ne peut pas se charger (aucun reseau) : on le dit au lieu d'une page muette.
    const codes = []
    // Ligne du bloc ou commence chaque script : le texte d'un <script> est brut (aucune entite
    // decodee), il se retrouve tel quel dans le bloc.
    const debuts = []
    let curseur = 0
    for (const script of doc.querySelectorAll('script')) {
      const type = (script.getAttribute('type') || '').trim().toLowerCase()
      if (!TYPES_EXECUTABLES.has(type)) continue
      if (script.hasAttribute('src')) {
        afficherErreur(`Script externe ignoré, aucun réseau : ${script.getAttribute('src')}`)
      } else {
        const code = script.textContent || ''
        const position = code ? page.html.indexOf(code, curseur) : -1
        if (position >= 0) curseur = position + code.length
        debuts.push(position < 0 ? null : page.html.slice(0, position).split('\n').length)
        codes.push(code)
      }
      script.remove()
    }
    // Table « ligne de l'eval -> ligne du bloc » : le script k commence a la ligne `depart` de
    // l'eval (le premier a la ligne 1, chacun suivi de la ligne `;` qui les separe).
    const tranches = []
    let depart = 1
    codes.forEach((code, rang) => {
      const lignes = code.split('\n').length
      tranches.push({ depart, lignes, debut: debuts[rang] })
      depart += lignes + 1
    })
    ligneDuBloc = (ligne) => {
      const tranche = tranches.find((t) => ligne >= t.depart && ligne < t.depart + t.lignes)
      return tranche && tranche.debut !== null ? tranche.debut + (ligne - tranche.depart) : null
    }
    // Ni redirection, ni base, ni feuille externe : rien de cela ne sert une page du fil.
    for (const inutile of doc.querySelectorAll('meta, base, link, title')) inutile.remove()
    for (const style of doc.head.querySelectorAll('style')) document.head.appendChild(style)
    for (const noeud of [...doc.body.childNodes]) document.body.appendChild(noeud)
    for (const enfant of document.body.children) convertirGestionnaires(enfant)
    new MutationObserver((changements) => {
      for (const changement of changements) changement.addedNodes.forEach(convertirGestionnaires)
    }).observe(document.body, { childList: true, subtree: true })

    // La hauteur du CONTENU, pas celle du cadre : `scrollHeight` de la racine ne descend jamais
    // sous la hauteur du cadre, une page qui retrecit garderait sa place vide.
    let derniere = -1
    const mesurer = () => {
      const hauteur = Math.ceil(
        Math.max(racine.getBoundingClientRect().height, document.body.scrollHeight)
      )
      if (hauteur === derniere) return
      derniere = hauteur
      signaler({ etat: 'hauteur', hauteur })
    }
    const observateur = new ResizeObserver(mesurer)
    observateur.observe(racine)
    observateur.observe(document.body)

    // UN seul eval pour tous les scripts : un `const` du premier reste visible du second, comme
    // dans une vraie page (chaque eval indirect aurait sa propre portee lexicale).
    // Le compilateur des `onclick` est pose EN TETE, sur la premiere ligne (les numeros de ligne
    // des erreurs ne bougent pas) : sa fermeture est la portee de cet eval, ou vivront les
    // `const`/`let` des scripts, et il existe meme si un script leve plus bas.
    const compilateur =
      `window[${JSON.stringify(CLE_COMPILATEUR)}] = (source) => ` +
      "eval('(function (event) {\\n' + source + '\\n})');"
    try {
      if (codes.length > 0) {
        try {
          ;(0, eval)(`${compilateur} ${codes.join('\n;\n')}\n//# sourceURL=${SOURCE_PAGE}`)
        } finally {
          compilerDansLesScripts = window[CLE_COMPILATEUR] || null
          delete window[CLE_COMPILATEUR]
        }
      }
      // Le document est deja charge : sans ces deux evenements, un script qui attend
      // `DOMContentLoaded` ou `load` ne demarrerait jamais.
      document.dispatchEvent(new Event('DOMContentLoaded'))
      window.dispatchEvent(new Event('load'))
      signaler({ etat: 'lancee' })
    } catch (erreur) {
      afficherErreur(decrireErreur(erreur))
    }
    mesurer()
  }

  // 4. LE CODE DE LA SCENE OU LA PAGE, une seule fois, et seulement depuis le cadre parent.
  let recu = false
  window.addEventListener('message', (event) => {
    if (event.source !== parentWindow) return
    const donnees = event.data
    if (!donnees || donnees.type !== TYPE) return
    // Signe de vie (conv-1304) : une page en boucle infinie ne peut plus repondre, le fil le voit.
    if (typeof donnees.ping === 'number') {
      signaler({ etat: 'pong', ping: donnees.ping })
      return
    }
    // « Enregistrer en .html » : le fil n'a ni le moteur ni la boite a outils, poses dans cette page.
    if (typeof donnees.ressources === 'number') {
      signaler({
        etat: 'ressources',
        demande: donnees.ressources,
        moteur: moteurCharge ? texteMoteur : '',
        graphiques: texteGraphiques
      })
      return
    }
    if (modePage && typeof donnees.reponse === 'number') {
      recevoirReponse(donnees)
      return
    }
    if (modePage && donnees.theme) {
      appliquerTheme(donnees.theme)
      // Un dessin (canvas, couleurs lues une fois) ne suit pas seul un changement de theme : la
      // page peut ecouter `aw-theme` pour se redessiner (conv-1304).
      window.dispatchEvent(new Event('aw-theme'))
      return
    }
    if (recu) return
    if (donnees.page && typeof donnees.page.html === 'string') {
      recu = true
      lancerPage(donnees.page)
      return
    }
    if (typeof donnees.code !== 'string') return
    recu = true
    try {
      chargerMoteur()
      ;(0, eval)(`${donnees.code}\n//# sourceURL=scene-3d.js`)
      signaler({ etat: 'lancee' })
    } catch (erreur) {
      afficherErreur(decrireErreur(erreur))
    }
  })

  signaler({ etat: 'pret' })
})()
