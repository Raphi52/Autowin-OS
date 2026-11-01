/**
 * SCRIPTS DE PAGE du navigateur intégré (conv-1286, lot 1/5, 2026-10-29).
 *
 * Ce fichier ne contient que des SOURCES JavaScript, jouées dans la page par
 * `webContents.executeJavaScriptInIsolatedWorld` (voir `navigateur-integre.ts`). Rien ici ne
 * s'exécute dans le processus principal.
 *
 * POURQUOI UN MONDE ISOLÉ : la page voit le même DOM, mais pas nos variables ni nos fonctions.
 * Elle ne peut donc ni lire la file des messages, ni remplacer `querySelectorAll` pour tromper
 * l'instantané, ni fausser la garde « champ de mot de passe ».
 *
 * POURQUOI UNE CHAÎNE ET PAS `fonction.toString()` : le compilateur peut réécrire une fonction
 * (aides `__name`, transpilation) ; sa source n'est alors plus jouable seule dans la page. Une
 * chaîne brute (`String.raw`) part telle quelle. Elle est testée en vrai DOM
 * (`navigateur-page-script.test.ts`, happy-dom).
 *
 * CANAL DE RETOUR VERS LE PRINCIPAL (élément choisi, sortie du mode) :
 *   1. la page range chaque message dans `window.__awNav.file` (monde isolé, invisible de la page) ;
 *   2. elle émet `console.debug(PING_NAVIGATEUR)` — un simple signal, SANS donnée ;
 *   3. le principal voit ce signal par l'événement `console-message` et vide la file en jouant
 *      `appelPage('prendre', [])` dans le même monde isolé.
 * Une page qui imiterait le signal ne gagne rien : elle déclenche une lecture d'une file qu'elle ne
 * peut pas remplir. Si le signal se perdait, le principal vide aussi la file à intervalle régulier
 * tant qu'un mode est actif.
 */

/** Monde isolé de nos scripts (0 = page, 999 = preload d'Electron : on prend un autre). */
export const MONDE_ISOLE_NAVIGATEUR = 1286

/** Le signal « file non vide » ; le principal le retire de la console qu'il garde. */
export const PING_NAVIGATEUR = '__aw-nav:ping'

/**
 * Version du noyau : un noyau plus ancien déjà posé dans la page est remplacé. 2 = aperçu du geste
 * suivant (`surligner` en pointillés, pas-à-pas de conv-1286, 2026-10-30). 3 = fonction Annoter
 * retirée (conv-1306, 2026-10-30). 4 = Choisir n'envoie plus le clic du choix à la page (conv-1306).
 * 5 = le cadre suit sa cible (conv-1324).
 */
const VERSION_NOYAU = 5

/** Les points d'entrée du noyau joignables par `appelPage`. */
export type MethodePage =
  | 'instantane'
  | 'localiser'
  | 'focus'
  | 'surligner'
  | 'retirerSurbrillance'
  | 'activerMode'
  | 'prendre'

/** Ce que rend `localiser` : où cliquer, et ce qu'est l'élément visé. */
export interface LocalisationPage {
  trouve: boolean
  /** Centre de la cible, en pixels CSS de la fenêtre de la page. */
  x?: number
  y?: number
  rect?: { x: number; y: number; largeur: number; hauteur: number }
  /** Champ de mot de passe ou de code à usage unique : l'agent n'y tape jamais. */
  secret?: boolean
  /** La cible est un cadre intégré : son contenu n'est pas vérifiable d'ici. */
  cadreIntegre?: boolean
  description?: string
}

/** Ce que rend `focus` : l'élément qui recevrait une saisie. */
export interface FocusPage {
  /** Aucun élément n'a le focus : une saisie n'irait nulle part. */
  aucun: boolean
  secret: boolean
  cadreIntegre: boolean
  description: string
  /**
   * Où surligner une frappe sans cible : le champ actif, ou toute la fenêtre quand rien n'a le
   * focus (la touche va alors à la page). Ajouté sur objection du juge (conv-1287).
   */
  rect?: { x: number; y: number; largeur: number; hauteur: number }
}

/** Message rangé par la page dans sa file, relu par le principal. */
export type MessagePage =
  | {
      type: 'choisi'
      selecteur: string
      texteElement: string
      styles: { police: string; taille: string; couleur: string; fond: string; marges: string }
      rect: { x: number; y: number; largeur: number; hauteur: number }
    }
  | { type: 'mode-quitte' }

/*
 * LE NOYAU. Idempotent : rejoué à chaque appel, il ne se réinstalle que s'il manque ou a changé de
 * version. Écrit en JavaScript sans dépendance, pour tourner dans n'importe quelle page.
 */
const NOYAU = String.raw`(function () {
  var V = __VERSION__;
  if (window.__awNav && window.__awNav.version === V) return;
  if (window.__awNav && window.__awNav.quitterMode) { try { window.__awNav.quitterMode(false); } catch (e) {} }
  var nav = { version: V, file: [], mode: null, hote: null, calque: null, ecoutes: [] };
  window.__awNav = nav;
  var PING = '__PING__';
  var SELECTEUR_INTERACTIF = 'a[href],button,input:not([type="hidden"]),select,textarea,summary,' +
    '[role="button"],[role="link"],[role="checkbox"],[role="radio"],[role="tab"],[role="menuitem"],' +
    '[role="option"],[role="switch"],[role="textbox"],[role="combobox"],[role="searchbox"],' +
    '[contenteditable=""],[contenteditable="true"],[tabindex]:not([tabindex="-1"])';

  function signaler(message) {
    nav.file.push(message);
    if (nav.file.length > 100) nav.file.shift();
    try { console.debug(PING); } catch (e) {}
  }
  function borne(t, n) {
    t = (t == null ? '' : String(t)).replace(/\s+/g, ' ').trim();
    return t.length > n ? t.slice(0, n - 1) + '…' : t;
  }
  function echapper(s) {
    if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(s);
    return String(s).replace(/([^a-zA-Z0-9_-])/g, '\\$1');
  }
  function estVisible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    if (el.closest && el.closest('[hidden]')) return false;
    var cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse') return false;
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }
  function typeChamp(el) {
    return String((el && (el.getAttribute('type') || el.type)) || '').toLowerCase();
  }
  function estChampSecret(el) {
    if (!el || !el.tagName) return false;
    var ac = String(el.getAttribute('autocomplete') || '').toLowerCase().split(/\s+/);
    if (ac.indexOf('current-password') >= 0 || ac.indexOf('new-password') >= 0 || ac.indexOf('one-time-code') >= 0) return true;
    return el.tagName.toLowerCase() === 'input' && (typeChamp(el) === 'password' || String(el.type || '').toLowerCase() === 'password');
  }
  function estCadre(el) {
    return !!el && !!el.tagName && /^(iframe|frame|object|embed)$/i.test(el.tagName);
  }
  function roleDe(el) {
    var r = el.getAttribute('role');
    if (r) return r;
    var tag = el.tagName.toLowerCase();
    if (tag === 'a') return 'link';
    if (tag === 'button' || tag === 'summary') return 'button';
    if (tag === 'select') return 'combobox';
    if (tag === 'textarea') return 'textbox';
    if (tag === 'input') {
      var t = typeChamp(el) || 'text';
      if (estChampSecret(el)) return 'password';
      if (t === 'checkbox' || t === 'radio') return t;
      if (t === 'submit' || t === 'button' || t === 'reset' || t === 'image') return 'button';
      if (t === 'range') return 'slider';
      if (t === 'search') return 'searchbox';
      return 'textbox';
    }
    if (el.isContentEditable || el.getAttribute('contenteditable') === '' || el.getAttribute('contenteditable') === 'true') return 'textbox';
    return tag;
  }
  function nomDe(el) {
    var n = el.getAttribute('aria-label');
    if (!n) {
      var lb = el.getAttribute('aria-labelledby');
      if (lb) n = lb.split(/\s+/).map(function (id) { var x = document.getElementById(id); return x ? x.textContent : ''; }).join(' ');
    }
    if (!n && el.labels && el.labels.length) n = el.labels[0].textContent;
    if (!n && el.id) { var l = document.querySelector('label[for="' + echapper(el.id) + '"]'); if (l) n = l.textContent; }
    if (!n && el.tagName.toLowerCase() !== 'input' && el.tagName.toLowerCase() !== 'textarea' && el.tagName.toLowerCase() !== 'select') n = el.innerText || el.textContent;
    if (!n) n = el.getAttribute('placeholder') || el.getAttribute('title') || el.getAttribute('alt') || '';
    if (!n && el.tagName.toLowerCase() === 'input' && /^(submit|button|reset)$/.test(typeChamp(el))) n = el.value;
    return borne(n, 120);
  }
  function valeurDe(el) {
    if (estChampSecret(el)) return undefined;
    var tag = el.tagName.toLowerCase();
    if (tag === 'input') {
      var t = typeChamp(el);
      if (t === 'checkbox' || t === 'radio') return el.checked ? 'coché' : 'non coché';
      if (t === 'submit' || t === 'button' || t === 'reset' || t === 'image' || t === 'file') return undefined;
      return borne(el.value, 200);
    }
    if (tag === 'textarea') return borne(el.value, 200);
    if (tag === 'select') { var o = el.options && el.options[el.selectedIndex]; return o ? borne(o.textContent, 200) : ''; }
    return undefined;
  }
  function selecteurDe(el) {
    if (!el || el.nodeType !== 1) return '';
    if (el.id) { var parId = '#' + echapper(el.id); try { if (document.querySelectorAll(parId).length === 1) return parId; } catch (e) {} }
    var parties = [];
    var n = el;
    while (n && n.nodeType === 1 && n !== document.documentElement && parties.length < 12) {
      if (n !== el && n.id) {
        var id = '#' + echapper(n.id);
        try { if (document.querySelectorAll(id).length === 1) { parties.unshift(id); break; } } catch (e) {}
      }
      var tag = n.tagName.toLowerCase();
      var parent = n.parentElement;
      var rang = 1, total = 0;
      if (parent) {
        for (var i = 0; i < parent.children.length; i++) {
          var c = parent.children[i];
          if (c.tagName === n.tagName) { total++; if (c === n) rang = total; }
        }
      }
      parties.unshift(total > 1 ? tag + ':nth-of-type(' + rang + ')' : tag);
      n = parent;
    }
    return parties.join(' > ');
  }
  function fondEffectif(el) {
    var n = el;
    while (n && n.nodeType === 1) {
      var f = getComputedStyle(n).backgroundColor;
      if (f && f !== 'transparent' && !/^rgba\([^)]*,\s*0\)$/.test(f)) return f;
      n = n.parentElement;
    }
    return 'transparent';
  }
  function rectDe(el) {
    var r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, largeur: r.width, hauteur: r.height };
  }
  function decrire(el) {
    var cs = el ? getComputedStyle(el) : null;
    var texte = el ? (el.innerText || el.textContent || el.getAttribute('aria-label') || el.getAttribute('alt') || '') : '';
    return {
      selecteur: el ? selecteurDe(el) : '',
      texteElement: estChampSecret(el) ? '' : borne(texte, 300),
      styles: {
        police: cs ? borne(cs.fontFamily, 200) : '',
        taille: cs ? cs.fontSize : '',
        couleur: cs ? cs.color : '',
        fond: el ? fondEffectif(el) : '',
        marges: cs ? 'marge ' + [cs.marginTop, cs.marginRight, cs.marginBottom, cs.marginLeft].join(' ') +
          ' · retrait ' + [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].join(' ') : ''
      },
      rect: el ? rectDe(el) : { x: 0, y: 0, largeur: 0, hauteur: 0 }
    };
  }
  function assigner(cible, source) { for (var k in source) cible[k] = source[k]; return cible; }

  /* --- Le calque : un hôte à racine FERMÉE, que la page ne peut ni lire ni styler. --- */
  function calqueDe() {
    if (nav.hote && nav.hote.isConnected) return nav.calque;
    var hote = document.createElement('aw-nav-calque');
    hote.setAttribute('style', 'all: initial; position: fixed; left: 0; top: 0; width: 0; height: 0; z-index: 2147483647; pointer-events: none;');
    var racine = hote.attachShadow({ mode: 'closed' });
    var style = document.createElement('style');
    style.textContent = [
      '* { box-sizing: border-box; font-family: system-ui, sans-serif; }',
      '.surbrillance { position: fixed; border: 3px solid #f59e0b; border-radius: 4px; box-shadow: 0 0 0 4px rgba(245,158,11,.35); pointer-events: none; transition: all .15s; }',
      '.etiquette { position: absolute; left: -3px; top: -24px; background: #f59e0b; color: #111; font-size: 12px; padding: 2px 6px; border-radius: 4px; white-space: nowrap; }',
      '.surbrillance.prochain { border-style: dashed; box-shadow: none; }',
      '.survol { position: fixed; border: 2px solid #3b82f6; background: rgba(59,130,246,.12); pointer-events: none; }'
    ].join('\n');
    racine.appendChild(style);
    (document.documentElement || document.body).appendChild(hote);
    nav.hote = hote;
    nav.calque = racine;
    return racine;
  }
  function placer(div, r) {
    div.style.left = r.x + 'px';
    div.style.top = r.y + 'px';
    div.style.width = r.largeur + 'px';
    div.style.height = r.hauteur + 'px';
  }
  function retirer(el) { if (el && el.parentNode) el.parentNode.removeChild(el); }

  /* --- Instantané : éléments interactifs visibles, numérotés par data-aw-ref. --- */
  nav.instantane = function (max, maxTexte) {
    var anciens = document.querySelectorAll('[data-aw-ref]');
    for (var i = 0; i < anciens.length; i++) anciens[i].removeAttribute('data-aw-ref');
    var els = document.querySelectorAll(SELECTEUR_INTERACTIF);
    var elements = [];
    var ref = 0;
    for (var j = 0; j < els.length && elements.length < max; j++) {
      var el = els[j];
      if (el.disabled || !estVisible(el)) continue;
      ref++;
      el.setAttribute('data-aw-ref', String(ref));
      var e = { ref: ref, role: roleDe(el), nom: nomDe(el) };
      var v = valeurDe(el);
      if (v !== undefined) e.valeur = v;
      elements.push(e);
    }
    var corps = document.body;
    var texte = corps ? String(corps.innerText || corps.textContent || '') : '';
    if (texte.length > maxTexte) texte = texte.slice(0, maxTexte);
    return { url: String(location.href), titre: String(document.title || ''), texte: texte, elements: elements };
  };

  /* --- Cible d'une action de l'agent. --- */
  function trouver(cible) {
    if (!cible) {
      var a = document.activeElement;
      while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement;
      return a && a !== document.body && a !== document.documentElement ? a : null;
    }
    if (typeof cible.ref === 'number') return document.querySelector('[data-aw-ref="' + cible.ref + '"]');
    if (typeof cible.selecteur === 'string') { try { return document.querySelector(cible.selecteur); } catch (e) { return null; } }
    if (typeof cible.x === 'number' && typeof cible.y === 'number') return document.elementFromPoint(cible.x, cible.y);
    return null;
  }
  nav.localiser = function (cible, options) {
    var el = trouver(cible);
    nav.vise = el;
    if (!el) return { trouve: false };
    var parPoint = !!cible && typeof cible.x === 'number';
    if (!parPoint && typeof el.scrollIntoView === 'function') {
      try { el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }); } catch (e) { el.scrollIntoView(); }
    }
    if (options && options.focaliser && typeof el.focus === 'function') el.focus();
    if (options && options.selectionner) {
      if (typeof el.select === 'function') el.select();
      else if (window.getSelection && document.createRange) {
        var plage = document.createRange();
        plage.selectNodeContents(el);
        var sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(plage);
      }
    }
    var r = rectDe(el);
    return {
      trouve: true,
      x: parPoint ? cible.x : r.x + r.largeur / 2,
      y: parPoint ? cible.y : r.y + r.hauteur / 2,
      rect: r,
      secret: estChampSecret(el),
      cadreIntegre: estCadre(el),
      description: roleDe(el) + ' « ' + nomDe(el) + ' »'
    };
  };
  nav.focus = function () {
    var a = trouver(null);
    nav.vise = a;
    if (!a) return { aucun: true, secret: false, cadreIntegre: false, description: 'page', rect: { x: 0, y: 0, largeur: window.innerWidth, hauteur: window.innerHeight } };
    return { aucun: false, secret: estChampSecret(a), cadreIntegre: estCadre(a), description: roleDe(a) + ' « ' + nomDe(a) + ' »', rect: rectDe(a) };
  };

  /*
   * --- Surbrillance de la cible, avant chaque action de l'agent. ---
   * options.prochain : le geste ATTEND un ordre de l'utilisateur (fil en pause) ; même cadre, en
   * pointillés, étiquette « prochain · … » — il voit ce qui partira au « Pas suivant ».
   */
  nav.surligner = function (rect, libelle, options) {
    nav.retirerSurbrillance();
    var prochain = !!(options && options.prochain);
    var calque = calqueDe();
    var div = document.createElement('div');
    div.className = prochain ? 'surbrillance prochain' : 'surbrillance';
    placer(div, rect);
    if (libelle) {
      var et = document.createElement('div');
      et.className = 'etiquette';
      et.textContent = borne(prochain ? 'prochain · ' + libelle : libelle, 80);
      div.appendChild(et);
    }
    calque.appendChild(div);
    nav.surbrillance = div;
    suivreCible(div);
    return true;
  };
  /*
   * Le cadre suit l'élément visé (conv-1324, mesuré en vraie app). Il est en position fixe : en pause,
   * l'utilisateur fait défiler pour regarder la page, la cible part et le cadre désigne autre chose.
   * Écoute en capture : le défilement d'un bloc intérieur ne remonte pas. Une cible retirée de la page
   * ne se mesure plus (rectangle nul) : le cadre reste où il était.
   * fix-ok: conv-1324 (mesuré en vraie app, D:/tmp/lot3/run8.txt) — cause : le cadre est en position
   * fixe et n'était placé qu'une fois ; après un défilement de 200 px, il restait à y=125 alors que sa
   * cible était passée à y=-75, et il désignait un autre élément.
   */
  function suivreCible(div) {
    var el = nav.vise;
    if (!el) return;
    var suivre = function () { if (el.isConnected) placer(div, rectDe(el)); };
    window.addEventListener('scroll', suivre, true);
    window.addEventListener('resize', suivre);
    nav.arreterSuivi = function () {
      window.removeEventListener('scroll', suivre, true);
      window.removeEventListener('resize', suivre);
      nav.arreterSuivi = null;
    };
  }
  nav.retirerSurbrillance = function () {
    if (nav.arreterSuivi) nav.arreterSuivi();
    retirer(nav.surbrillance);
    nav.surbrillance = null;
    return true;
  };

  /* --- Mode Choisir. --- */
  function ecouter(type, fn) { window.addEventListener(type, fn, true); nav.ecoutes.push([type, fn]); }
  function bloquer(e) { e.preventDefault(); e.stopPropagation(); if (e.stopImmediatePropagation) e.stopImmediatePropagation(); }
  function elementSous(x, y) {
    var el = document.elementFromPoint(x, y);
    return el && el !== nav.hote ? el : null;
  }
  nav.quitterMode = function (signalerSortie) {
    nav.ecoutes.forEach(function (x) { window.removeEventListener(x[0], x[1], true); });
    nav.ecoutes = [];
    retirer(nav.survol); nav.survol = null;
    var etait = nav.mode;
    nav.mode = null;
    if (signalerSortie && etait) signaler({ type: 'mode-quitte' });
    return true;
  };
  nav.activerMode = function (mode) {
    // Rejoué après chaque chargement : un mode déjà en place reste tel quel.
    if (mode && nav.mode === mode) return true;
    nav.quitterMode(false);
    if (mode !== 'choisir') return true;
    nav.mode = mode;
    var calque = calqueDe();
    var depart = null;
    function survoler(e) {
      if (depart) return;
      var el = e.target && e.target.nodeType === 1 ? e.target : null;
      if (!el || el === nav.hote) return;
      if (!nav.survol) { nav.survol = document.createElement('div'); nav.survol.className = 'survol'; calque.appendChild(nav.survol); }
      placer(nav.survol, rectDe(el));
    }
    function appuyer(e) {
      bloquer(e);
      depart = { x: e.clientX, y: e.clientY };
    }
    function relacher(e) {
      bloquer(e);
      if (!depart) return;
      var el = e.target && e.target.nodeType === 1 && e.target !== nav.hote ? e.target : elementSous(e.clientX, e.clientY);
      depart = null;
      signaler(assigner({ type: 'choisi' }, decrire(el)));
      nav.quitterMode(false);
      avalerFinDuGeste();
    }
    /*
     * Le « click » (et, au bouton droit, « auxclick » et « contextmenu ») part APRÈS « pointerup »,
     * dans la même séquence d'entrée : quitter le mode retirait nos écoutes avant lui, et la page le
     * recevait — choisir « Payer » le déclenchait (mesuré à la vraie souris dans Electron, conv-1306,
     * 2026-10-30, navigateur-page-script.choisir.reel.test.ts). Une dernière garde, hors du mode,
     * avale donc ces clics de fin de geste. Elle part au geste SUIVANT (appui ou touche) : un vrai clic
     * ou un clic au clavier (Entrée, Espace) commence toujours par l'un des deux, et passe donc. Les
     * clics de la page elle-même (non « isTrusted ») passent aussi.
     */
    function avalerFinDuGeste() {
      var types = ['click', 'auxclick', 'contextmenu'];
      function avaler(e) { if (e.isTrusted) bloquer(e); }
      function finir() {
        types.forEach(function (t) { window.removeEventListener(t, avaler, true); });
        window.removeEventListener('pointerdown', finir, true);
        window.removeEventListener('keydown', finir, true);
      }
      types.forEach(function (t) { window.addEventListener(t, avaler, true); });
      window.addEventListener('pointerdown', finir, true);
      window.addEventListener('keydown', finir, true);
    }
    function touche(e) {
      if (e.key !== 'Escape') return;
      bloquer(e);
      nav.quitterMode(true);
    }
    /*
     * Événements POINTEUR et non souris : annuler « pointerdown » supprime les « mousedown »/« mouseup »
     * de compatibilité (spécification Pointer Events). Un « mouseup » n'arriverait donc jamais.
     * Les événements souris, eux, sont avalés pour que la page ne réagisse pas pendant le mode.
     */
    ecouter('pointermove', survoler);
    ecouter('pointerdown', appuyer);
    ecouter('pointerup', relacher);
    ecouter('mousedown', bloquer);
    ecouter('mouseup', bloquer);
    ecouter('click', bloquer);
    ecouter('dblclick', bloquer);
    ecouter('auxclick', bloquer);
    ecouter('contextmenu', bloquer);
    ecouter('keydown', touche);
    return true;
  };

  nav.prendre = function () { var f = nav.file; nav.file = []; return f; };
  nav.appeler = function (methode, args) {
    var fn = nav[methode];
    if (typeof fn !== 'function') throw new Error('méthode de page inconnue : ' + methode);
    return fn.apply(null, args || []);
  };
})()`
  .replace('__VERSION__', String(VERSION_NOYAU))
  .replace('__PING__', PING_NAVIGATEUR)

/** La source du noyau seule (installation sans appel), exposée pour les tests. */
export const SOURCE_NOYAU_NAVIGATEUR = NOYAU

const MARQUE_APPEL = '/*aw-appel*/'

/**
 * Source complète d'un appel : le noyau (idempotent), puis UN appel dont la valeur est rendue par
 * `executeJavaScriptInIsolatedWorld`. Les arguments passent par JSON : aucune chaîne de la page ou de
 * l'agent n'est jamais collée telle quelle dans le code joué.
 */
export function appelPage(methode: MethodePage, args: unknown[]): string {
  return `${NOYAU};\n${MARQUE_APPEL}window.__awNav.appeler(${JSON.stringify(methode)}, ${JSON.stringify(args)});`
}

/** Relit la méthode et les arguments d'une source produite par `appelPage` (tests, diagnostic). */
export function decoderAppelPage(source: string): { methode: MethodePage; args: unknown[] } | null {
  const debut = source.indexOf(MARQUE_APPEL, NOYAU.length)
  if (debut < 0) return null
  const appel = source.slice(debut + MARQUE_APPEL.length)
  const m = /^window\.__awNav\.appeler\(("(?:[^"\\]|\\.)*"), ([\s\S]*)\);$/.exec(appel)
  if (!m) return null
  return { methode: JSON.parse(m[1]) as MethodePage, args: JSON.parse(m[2]) as unknown[] }
}
