# Tanuki v3 (conv-1558, 2026-11-05) — « améliore tout » : forme, oreille de profil, fourrure, tissu et coupe du kimono,
# expressions. Repart de tanuki-hd.py avec la direction C figée (masque, joues, oreilles courtes, yeux 1,12).
# Même squelette, mêmes os, même format de sortie : pose-b3d.mjs et mario.js le lisent sans changement.
#
# Le canal G (un octet par sommet) dit maintenant la MATIÈRE au rendu (sprite-v3.py) :
#   G < .11  : laine avec fourrure, et G code la LONGUEUR du poil : longueur = 1 - 8·G (visage ras, favoris longs)
#   G = .25  : tissu (kimono, obi, pantalon, chaussettes) — tissé, sans poil
#   G = .5   : mat sans poil (traits du visage, moustaches, sandales)
#   G = 1    : perle brillante à la couleur du sommet (yeux, nez, reflets)
# Usage : EXPR=doux|joie|surpris|endormi FIN=3 python -I tanuki-v3.py <sommets> <sortie.json>   (atlas : 1500000)
import base64, gzip, json, os, sys
# Bibliothèques : l'environnement épinglé de requirements-sculpture.txt (environnements.sh), plus de dossier vendu dans .autowin-tmp.
import numpy as np
from skimage.measure import marching_cubes
import fast_simplification

CIBLE = int(sys.argv[1]) if len(sys.argv) > 1 else 3200
SORTIE = sys.argv[2] if len(sys.argv) > 2 else 'tanuki.json'
FIN = float(os.environ.get('FIN', 1))
EXPR = os.environ.get('EXPR', 'doux')
OEIL = 1.12 * (1.2 if EXPR == 'surpris' else 1)
YEUX_OUVERTS = EXPR in ('doux', 'surpris')

G_TISSU, G_MAT, G_PERLE = .25, .5, 1.0


def g_poil(f):
    """Longueur relative du poil (0,25 à 1) → valeur du canal G."""
    return (1 - np.clip(f, .14, 1)) / 8


def L(v):
    return np.sqrt((v * v).sum(-1))


def ell(P, c, r):
    c = np.array(c, float); r = np.array(r, float)
    k0 = L((P - c) / r); k1 = L((P - c) / (r * r))
    return k0 * (k0 - 1) / np.maximum(k1, 1e-9)


def cap(P, a, b, ra, rb=None):
    rb = ra if rb is None else rb
    a = np.array(a, float); b = np.array(b, float)
    pa = P - a; ba = b - a
    t = np.clip((pa * ba).sum(-1) / (ba * ba).sum(), 0, 1)
    return L(pa - t[..., None] * ba) - (ra + (rb - ra) * t)


def rbox(P, c, h, r):
    q = np.abs(P - np.array(c, float)) - (np.array(h, float) - r)
    return L(np.maximum(q, 0)) + np.minimum(q.max(-1), 0) - r


def smin(a, b, k):
    h = np.clip(.5 + .5 * (b - a) / k, 0, 1)
    return b * (1 - h) + a * h - k * h * (1 - h)


def smax(a, b, k):
    return -smin(-a, -b, k)


def bosses(P, a=.0035):
    x, y, z = P[..., 0], P[..., 1], P[..., 2]
    return a * (np.sin(x * 61 + y * 23) * np.sin(y * 57 + z * 31) + .6 * np.sin(z * 83 + x * 37) * np.sin(y * 71 - x * 19))


def tache(P, f=38.0):
    x, y, z = P[..., 0], P[..., 1], P[..., 2]
    return np.sin(x * f + 1.3 * np.sin(y * f * .7)) * np.sin(y * f * 1.1 + 1.7 * np.sin(z * f * .8)) * np.sin(z * f * .9 + 1.1 * np.sin(x * f * .6))


C = dict(
    gris=(.60, .54, .48), grisF=(.40, .34, .29), creme=(.93, .86, .74), noir=(.012, .011, .012), oreille=(.95, .86, .77),
    orange=(.86, .34, .07), orangeF=(.66, .21, .045), bleu=(.17, .30, .44), blanc=(.95, .93, .88), fleur=(.98, .90, .70),
    coeur=(.93, .62, .16), rouille=(.50, .17, .06), rouilleF=(.36, .11, .04),
    paille=(.70, .55, .30), pailleF=(.46, .34, .16), laque=(.05, .04, .04), patte=(.07, .055, .05), chaussette=(.94, .90, .82),
    masque=(.20, .15, .12), joue=(.97, .55, .52), trait=(.10, .065, .05), bouche=(.36, .07, .08), langue=(.88, .42, .46),
    reflet=(1., 1., 1.),
)


def mel(a, b, t):
    t = np.clip(t, 0, 1)[..., None]
    return np.array(a) * (1 - t) + np.array(b) * t


def vers_surface(fd, x, y, z0=-.02, z1=.32, iters=26):
    """Le point de la surface de `fd` devant (x, y) : bissection sur z, de l'intérieur vers l'avant."""
    x = np.atleast_1d(np.asarray(x, float)); y = np.atleast_1d(np.asarray(y, float))
    a = np.full(len(x), z0); b = np.full(len(x), z1)
    for _ in range(iters):
        m = (a + b) / 2
        dedans = fd(np.stack([x, y, m], -1)) < 0
        a = np.where(dedans, m, a); b = np.where(dedans, b, m)
    return (a + b) / 2


# --- Tête : crâne plus lisse (la fourrure fait le grain), favoris en touffe sous les yeux -----------------------------
def d_tete_lisse(P):
    d = ell(P, (0, .725, 0), (.168, .152, .162))
    for s in (-1, 1):
        d = smin(d, ell(P, (s * .088, .682, .05), (.098, .088, .1)), .05)
        # Les favoris : le tanuki a des joues en touffe qui débordent sous les yeux, c'est sa silhouette de face.
        d = smin(d, ell(P, (s * .142, .652, .04), (.072, .052, .068)), .035)
    d = smin(d, ell(P, (0, .674, .128), (.085, .07, .08)), .05)
    d = smin(d, ell(P, (0, .615, .0), (.105, .05, .1)), .04)
    return d


def d_tete(P):
    return d_tete_lisse(P) + bosses(P, .0012)


def zones_visage(P):
    n = tache(P) * .5 + .5
    k = np.zeros(len(P))
    for s in (-1, 1):
        k = np.maximum(k, 1.15 - L((P - np.array([s * .08, .748, .148])) / np.array([.062, .06, .08])))
        k = np.maximum(k, 1.2 - L((P - np.array([s * .09, .668, .10])) / np.array([.105, .085, .11])))
        k = np.maximum(k, 1.1 - L((P - np.array([s * .175, .645, .05])) / np.array([.07, .05, .07])))   # bout des favoris
    k = np.maximum(k, 1.25 - L((P - np.array([0, .67, .15])) / np.array([.1, .082, .1])))
    m = np.zeros(len(P))
    for s in (-1, 1):
        q = P - np.array([s * .1, .727, .128])
        a = q[:, 0] * s * .766 - q[:, 1] * .643
        b = q[:, 0] * s * .643 + q[:, 1] * .766
        m = np.maximum(m, 1 - np.sqrt((a / .064) ** 2 + (b / .027) ** 2 + (q[:, 2] / .07) ** 2))
    return n, np.clip((k + .04 * (n - .5)) * 12, 0, 1), np.clip((m + .05 * (n - .5)) * 9, 0, 1)


def c_tete(P):
    n, creme, masque = zones_visage(P)
    r = mel(mel(C['gris'], C['grisF'], n * .9), C['creme'], creme)
    r = mel(r, C['masque'], masque)
    j = np.zeros(len(P))
    for s in (-1, 1):
        j = np.maximum(j, 1 - L((P - np.array([s * .122, .672, .112])) / np.array([.036, .026, .045])))
    return mel(r, C['joue'], j * (4 if EXPR == 'joie' else 3))


G_FEUTRE = .12   # laine feutrée SANS poil : le visage d'une peluche, où les traits doivent se lire


def g_tete(P):
    # Feutrine rase là où le visage est PEINT (crème du museau et des yeux, masque sombre), poil court autour, poil
    # long sur le crâne et les favoris. La fourrure noyait la bouche et les sourcils (essai2-tete-poil3), puis un
    # ovale ras dessinait un trou net et une tonsure sur le front (essai4) : la zone suit maintenant la peinture.
    _, creme, masque = zones_visage(P)
    devant = P[:, 2] > .07
    peint = devant & (np.maximum(creme, masque) > .55) & (P[:, 1] > .628) & (np.abs(P[:, 0]) < .15)
    fav = np.clip(1 - L(np.stack([np.abs(P[:, 0]) - .17, P[:, 1] - .65, P[:, 2] - .04], -1) / np.array([.07, .05, .08])), 0, 1)
    bord = np.maximum(creme, masque)
    f = np.where(devant, .16 + .5 * (1 - bord), .75) + .3 * fav
    f = np.where(P[:, 1] < .645, np.minimum(f, .34 + .3 * fav), f)
    return np.where(peint, G_FEUTRE, g_poil(f))


# --- Oreilles : rondes ET épaisses — la fine oreille d'avant se lisait comme une corne de profil -----------------------
def d_oreille(P, s):
    d = ell(P, (s * .122, .852, -.03), (.06, .05, .058))
    d = smin(d, ell(P, (s * .1, .818, -.03), (.066, .042, .062)), .03)
    d = smax(d, -ell(P, (s * .122, .856, .026), (.04, .034, .03)), .012)
    return d + bosses(P, .001)


def c_oreille(s):
    def f(P):
        n = tache(P) * .5 + .5
        o = mel(mel(C['gris'], C['grisF'], n), C['masque'], .55)
        k = 1.0 - L((P - np.array([s * .122, .856, .03])) / np.array([.048, .042, .05]))
        return mel(o, C['oreille'], k * 16)
    return f


def g_oreille(s):
    # Le dedans de l'oreille reste ras et clair, le dos porte le poil.
    def f(P):
        k = 1.0 - L((P - np.array([s * .122, .856, .03])) / np.array([.048, .042, .05]))
        return np.where(k > .05, G_FEUTRE, g_poil(.5))
    return f


# --- Kimono : il TOMBE des épaules à l'ourlet, col croisé gauche sur droite, manches carrées, obi large ------------
Y_EPAULE, Y_OURLET = .585, .255


def rayons_corps(y):
    t = np.clip((Y_EPAULE - y) / (Y_EPAULE - Y_OURLET), 0, 1)
    return .118 + .055 * t ** 1.3, .106 + .038 * t ** 1.3, t


def d_corps_lisse(P):
    rx, rz, t = rayons_corps(P[:, 1])
    q = np.sqrt((P[:, 0] / rx) ** 2 + (P[:, 2] / rz) ** 2)
    d = (q - 1) * np.minimum(rx, rz)
    d = smax(d, np.maximum(P[:, 1] - Y_EPAULE, Y_OURLET - P[:, 1]), .035)
    d = smin(d, ell(P, (0, .545, -.005), (.15, .055, .118)), .04)          # épaules tombantes
    d = smin(d, ell(P, (0, .588, -.058), (.108, .045, .058)), .03)        # col montant derrière la nuque
    return d


def plis(P, base):
    # Plis verticaux qui se creusent vers l'ourlet : le tissu tombe, il ne gonfle pas.
    _, _, t = rayons_corps(P[:, 1])
    a = np.arctan2(P[:, 0], P[:, 2])
    return base + .0036 * t ** 1.6 * np.sin(a * 9 + .8 * np.sin(a * 3)) * np.clip((.36 - P[:, 1]) / .05, .25, 1)


def d_corps(P):
    return plis(P, d_corps_lisse(P))


def chemin_col(points, decale, n=10):
    """Une bande de col posée sur le kimono : polyligne (x, y) projetée sur la surface, soulevée de `decale`."""
    xy = []
    for (x0, y0), (x1, y1) in zip(points[:-1], points[1:]):
        for u in np.linspace(0, 1, n, endpoint=False):
            xy.append((x0 + (x1 - x0) * u, y0 + (y1 - y0) * u))
    xy.append(points[-1])
    xy = np.array(xy)
    z = vers_surface(d_corps_lisse, xy[:, 0], xy[:, 1], -.05, .3)
    return np.stack([xy[:, 0], xy[:, 1], z + decale], -1)


# Gauche (côté +x, celui du personnage) par-dessus droite : le pan du dessus part de l'épaule +x vers la hanche -x.
COL_DESSUS = chemin_col([(.074, .592), (.03, .52), (-.03, .44), (-.055, .36)], .002)
COL_DESSOUS = chemin_col([(-.074, .592), (-.03, .52), (-.006, .486)], .001)
JUBAN_DESSUS = chemin_col([(.05, .596), (.012, .53), (-.02, .47)], .002)
JUBAN_DESSOUS = chemin_col([(-.05, .596), (-.014, .53), (-.004, .51)], .001)
NUQUE = np.array([(-.074, .592, .03), (-.07, .612, -.03), (0, .622, -.07), (.07, .612, -.03), (.074, .592, .03)])


def poly(P, pts, r):
    d = 1e9
    for a, b in zip(pts[:-1], pts[1:]):
        d = np.minimum(d, cap(P, a, b, r))
    return d


def col(P):
    return np.minimum(np.minimum(poly(P, COL_DESSUS, .012), poly(P, COL_DESSOUS, .0115)), poly(P, NUQUE, .014))


def juban(P):
    return np.minimum(poly(P, JUBAN_DESSUS, .009), poly(P, JUBAN_DESSOUS, .009))


def d_torse(P):
    return smin(smin(d_corps(P), col(P), .006), juban(P), .004)


def motif(P):
    """Fleurs de prunier (ume) à cinq pétales, en quinconce, posées sur le tissu en coordonnées de cylindre."""
    a = np.arctan2(P[:, 0], P[:, 2])
    u = a * np.maximum(np.sqrt(P[:, 0] ** 2 + P[:, 2] ** 2), .05)
    v = P[:, 1]
    sp = .072
    rang = np.floor(v / sp)
    u2 = u + (rang % 2) * sp / 2
    cu = np.round(u2 / sp) * sp - u2
    cv = (rang + .5) * sp - v
    r = np.sqrt(cu ** 2 + cv ** 2)
    th = np.arctan2(cv, cu) + rang * .7
    petale = np.clip((.0155 * (.7 + .3 * np.cos(5 * th)) - r) * 900, 0, 1)
    coeur = np.clip((.0042 - r) * 1500, 0, 1)
    return petale, coeur


def tissu_orange(P):
    n = tache(P * 1.3, 52) * .5 + .5
    o = mel(C['orangeF'], C['orange'], .7 + (n - .5) * .35)
    pe, co = motif(P)
    o = mel(o, C['fleur'], pe)
    return mel(o, C['coeur'], co)


def c_torse(P):
    o = tissu_orange(P)
    # Le V au-dessus du croisement : l'encolure du juban blanc.
    def cote(p0, p1, ref):
        s = (p1[0] - p0[0]) * (P[:, 1] - p0[1]) - (p1[1] - p0[1]) * (P[:, 0] - p0[0])
        sr = (p1[0] - p0[0]) * (ref[1] - p0[1]) - (p1[1] - p0[1]) * (ref[0] - p0[0])
        return s * np.sign(sr)
    v = (cote(COL_DESSUS[0], COL_DESSUS[-1], (0, .6)) > 0) & (cote(COL_DESSOUS[0], COL_DESSOUS[-1], (0, .6)) > 0) & (P[:, 2] > .02)
    o = np.where(v[..., None], np.array(C['blanc']), o)
    # La couture du pan du dessus, qui reprend sous l'obi jusqu'à l'ourlet.
    cou = np.abs(P[:, 0] - (-.064 - (.30 - P[:, 1]) * .25)) < .0025
    o = np.where((cou & (P[:, 1] < .30) & (P[:, 2] > 0))[..., None], np.array(C['orangeF']) * .8, o)
    o = mel(o, C['blanc'], (.004 - juban(P)) * 400)
    return mel(o, C['bleu'], (.004 - col(P)) * 300)


def d_ceinture(P):
    rx, rz, _ = rayons_corps(P[:, 1])
    q = np.sqrt((P[:, 0] / (rx + .012)) ** 2 + (P[:, 2] / (rz + .012)) ** 2)
    e = (q - 1) * np.minimum(rx + .012, rz + .012)
    bande = smax(np.abs(e + .005) - .011, np.abs(P[:, 1] - .338) - .038, .006)
    corde = np.sqrt((e - .004) ** 2 + (P[:, 1] - .336) ** 2) - .0048
    zf = .157
    noeud_av = ell(P, (.0, .336, zf), (.012, .011, .009))
    # Le nœud du dos (musubi) : deux boucles aplaties et un cœur serré.
    zd = -.152
    noeud = ell(P, (0, .345, zd - .012), (.024, .03, .018))
    for s in (-1, 1):
        noeud = smin(noeud, ell(P, (s * .055, .352, zd - .016), (.05, .034, .016)), .012)
        noeud = smin(noeud, ell(P, (s * .03, .3, zd - .012), (.022, .045, .012)), .01)   # les pans qui tombent
    d = np.minimum(np.minimum(bande, corde), np.minimum(noeud_av, noeud))
    return d + bosses(P, .0006)


def c_ceinture(P):
    n = np.sin(P[:, 1] * 420 + np.arctan2(P[:, 0], P[:, 2]) * 5) * .5 + .5
    o = mel(C['blanc'], (.84, .80, .72), n * .35)
    rx, rz, _ = rayons_corps(P[:, 1])
    q = np.sqrt((P[:, 0] / (rx + .012)) ** 2 + (P[:, 2] / (rz + .012)) ** 2)
    e = (q - 1) * np.minimum(rx + .012, rz + .012)
    corde = np.sqrt((e - .004) ** 2 + (P[:, 1] - .336) ** 2) - .0048
    corde = np.minimum(corde, ell(P, (.0, .336, .157), (.012, .011, .009)))
    return mel(o, C['bleu'], (.0025 - corde) * 500)


def d_jambe(P, s):
    # Pantalon droit qui s'évase à peine, à plis, resserré à la cheville : il ne fait plus deux ballons.
    d = cap(P, (s * .082, .29, 0), (s * .088, .128, .004), .088, .08)
    d = smin(d, ell(P, (s * .03, .27, 0), (.1, .05, .104)), .03)
    d = smin(d, cap(P, (s * .089, .118, .004), (s * .09, .1, .004), .062, .058), .02)
    d = smax(d, .092 - P[:, 1], .01)
    a = np.arctan2(P[:, 0] - s * .084, P[:, 2])
    return d + .0024 * np.sin(a * 7) * np.clip((.27 - P[:, 1]) / .1, 0, 1) + bosses(P, .0006)


def c_jambe(P):
    n = tache(P * 1.2, 60) * .5 + .5
    return mel(C['rouilleF'], C['rouille'], .55 + (n - .5) * .5)


def d_chaussette(P, s):
    return cap(P, (s * .09, .118, 0), (s * .09, .048, .004), .05, .044) + bosses(P, .0008)


def d_pied(P, s):
    d = ell(P, (s * .09, .04, .03), (.046, .034, .074))
    d = np.minimum(d, ell(P, (s * .09, .0135, .036), (.056, .0135, .098)))
    d = np.minimum(d, cap(P, (s * .048, .036, .05), (s * .132, .036, .05), .009))
    d = np.minimum(d, cap(P, (s * .09, .05, .09), (s * .048, .036, .05), .008))
    d = np.minimum(d, cap(P, (s * .09, .05, .09), (s * .132, .036, .05), .008))
    return d


def c_pied(s):
    def f(P):
        o = np.tile(np.array(C['chaussette']), (len(P), 1))
        semelle = P[:, 1] < .029
        n = np.sin(P[:, 2] * 340) * .5 + .5
        o = np.where(semelle[..., None], mel(C['paille'], C['pailleF'], n), o)
        lanier = (np.minimum(cap(P, (s * .048, .036, .05), (s * .132, .036, .05), .009),
                             np.minimum(cap(P, (s * .09, .05, .09), (s * .048, .036, .05), .008), cap(P, (s * .09, .05, .09), (s * .132, .036, .05), .008))) < .004)
        return np.where(lanier[..., None], np.array(C['laque']), o)
    return f


def g_pied(P):
    # La sandale est mate ; la chaussette (tabi) est du tissu.
    return np.where(P[:, 1] < .029, G_MAT, G_TISSU)


def d_manche(P, s):
    d = cap(P, (s * .118, .535, -.005), (s * .178, .432, .0), .058, .064)
    d = smin(d, cap(P, (s * .178, .432, .0), (s * .226, .338, .012), .064, .07), .02)
    # La poche du tamoto, qui pend sous le bras : plate de face, large de profil, aux coins arrondis.
    d = smin(d, rbox(P, (s * .198, .385, -.004), (.05, .088, .072), .028), .03)
    d = smax(d, ((P[:, 0] - s * .226) * s * .35 + (.325 - P[:, 1])), .01)
    # Deux plis qui tombent dans la poche.
    return d + .0025 * np.sin(P[:, 2] * 70 + P[:, 0] * 20) * np.clip((.42 - P[:, 1]) / .08, 0, 1)


def d_patte(P, s):
    d = cap(P, (s * .205, .365, .01), (s * .228, .315, .018), .04)
    return smin(d, ell(P, (s * .236, .295, .022), (.042, .046, .044)), .02) + bosses(P, .0012)


def c_patte(s):
    def f(P):
        return mel(C['patte'], C['chaussette'], (P[:, 1] - .335) * 60)
    return f


QP = np.array([[0, .275, -.11], [0, .255, -.24], [0, .262, -.33], [0, .30, -.415]])
QR = [.05, .074, .068, .03]


def d_queue(P):
    d = cap(P, QP[0], QP[1], QR[0], QR[1])
    d = smin(d, cap(P, QP[1], QP[2], QR[1], QR[2]), .02)
    d = smin(d, cap(P, QP[2], QP[3], QR[2], QR[3]), .02)
    return d + bosses(P, .0012)


def c_queue(P):
    t = (-P[:, 2] - .11) / .305
    n = tache(P) * .03
    a = (t + n < .34) | ((t + n > .47) & (t + n < .68)) | (t + n > .8)
    return np.where(a[..., None], np.array(C['patte']) + .03 * tache(P)[..., None] ** 2, np.array(C['chaussette']))


def uni(c):
    return lambda P: np.tile(np.array(c), (len(P), 1))


def cst(g):
    return lambda P: np.full(len(P), g)


def perle(P, l):
    d = 1e9
    for c, r in l:
        d = np.minimum(d, ell(P, c, r))
    return d


R_OEIL = (.024 * OEIL, .025 * OEIL, .02 * OEIL)
YEUX = [((s * .079, .748, .1405), R_OEIL) for s in (1, -1)]
NEZ = [((0, .7, .206), (.0285, .0215, .0185))]


def reflets():
    # Le reflet blanc peint dans l'œil, en haut à gauche pour les deux yeux : c'est lui qui donne le regard.
    l = []
    for s in (1, -1):
        cx, cy, cz = s * .079, .748, .1405
        dx, dy = -.36 * R_OEIL[0], .38 * R_OEIL[1]
        z = cz + R_OEIL[2] * np.sqrt(max(1 - (dx / R_OEIL[0]) ** 2 - (dy / R_OEIL[1]) ** 2, 0))
        k = 1.25 if EXPR == 'surpris' else 1
        l.append(((cx + dx, cy + dy, z), (.0075 * k, .0075 * k, .0032)))
        l.append(((cx + .3 * R_OEIL[0], cy - .32 * R_OEIL[1], z - .0035), (.0032 * k, .0032 * k, .0022)))
    l.append(((-.009, .708, .222), (.0065, .004, .003)))     # le nez brille aussi
    return l


PARTIES = [
    dict(n='tete', b=((-.25, .56, -.2), (.25, .92, .25)), d=d_tete, c=c_tete, g=g_tete, pas=.0105, part=.25),
    dict(n='oG', b=((.03, .76, -.1), (.2, .95, .04)), d=lambda P: d_oreille(P, 1), c=c_oreille(1), g=g_oreille(1), pas=.0085, part=.045),
    dict(n='oD', b=((-.2, .76, -.1), (-.03, .95, .04)), d=lambda P: d_oreille(P, -1), c=c_oreille(-1), g=g_oreille(-1), pas=.0085, part=.045),
    dict(n='nez', b=((-.04, .67, .18), (.04, .73, .23)), d=lambda P: perle(P, NEZ), c=uni(C['noir']), g=cst(G_PERLE), pas=.0045, part=.012),
    dict(n='torse', b=((-.2, .24, -.17), (.2, .67, .18)), d=d_torse, c=c_torse, g=cst(G_TISSU), pas=.0105, part=.22),
    dict(n='ceinture', b=((-.2, .27, -.22), (.2, .41, .2)), d=d_ceinture, c=c_ceinture, g=cst(G_TISSU), pas=.0065, part=.08),
    dict(n='jG', b=((-.04, .07, -.14), (.21, .34, .14)), d=lambda P: d_jambe(P, 1), c=c_jambe, g=cst(G_TISSU), pas=.0105, part=.065),
    dict(n='jD', b=((-.21, .07, -.14), (.04, .34, .14)), d=lambda P: d_jambe(P, -1), c=c_jambe, g=cst(G_TISSU), pas=.0105, part=.065),
    dict(n='cG', b=((.02, .03, -.07), (.16, .14, .07)), d=lambda P: d_chaussette(P, 1), c=uni(C['chaussette']), g=cst(G_TISSU), pas=.01, part=.012),
    dict(n='cD', b=((-.16, .03, -.07), (-.02, .14, .07)), d=lambda P: d_chaussette(P, -1), c=uni(C['chaussette']), g=cst(G_TISSU), pas=.01, part=.012),
    dict(n='pG', b=((.02, -.01, -.08), (.16, .09, .15)), d=lambda P: d_pied(P, 1), c=c_pied(1), g=g_pied, pas=.0055, part=.032),
    dict(n='pD', b=((-.16, -.01, -.08), (-.02, .09, .15)), d=lambda P: d_pied(P, -1), c=c_pied(-1), g=g_pied, pas=.0055, part=.032),
    dict(n='mG', b=((.03, .28, -.13), (.31, .63, .13)), d=lambda P: d_manche(P, 1), c=tissu_orange, g=cst(G_TISSU), pas=.0095, part=.06),
    dict(n='mD', b=((-.31, .28, -.13), (-.03, .63, .13)), d=lambda P: d_manche(P, -1), c=tissu_orange, g=cst(G_TISSU), pas=.0095, part=.06),
    dict(n='aG', b=((.14, .23, -.05), (.3, .4, .08)), d=lambda P: d_patte(P, 1), c=c_patte(1), g=cst(g_poil(.4)), pas=.0075, part=.012),
    dict(n='aD', b=((-.3, .23, -.05), (-.14, .4, .08)), d=lambda P: d_patte(P, -1), c=c_patte(-1), g=cst(g_poil(.4)), pas=.0075, part=.012),
    dict(n='queue', b=((-.11, .14, -.48), (.11, .38, -.05)), d=d_queue, c=c_queue, g=cst(g_poil(1)), pas=.0095, part=.05),
]
if YEUX_OUVERTS:
    PARTIES.insert(3, dict(n='yeux', b=((-.12, .7, .1), (.12, .8, .18)), d=lambda P: perle(P, YEUX), c=uni(C['noir']), g=cst(G_PERLE), pas=.0045, part=.02))
    for k, s in enumerate((1, -1)):
        PARTIES.insert(4 + k, dict(n='yeux', b=((s * .079 - .03, .72, .14), (s * .079 + .03, .78, .18)), d=(lambda kk: lambda P: perle(P, reflets()[2 * kk:2 * kk + 2]))(k), c=uni(C['reflet']), g=cst(G_PERLE), pas=.0018, part=.003))
PARTIES.append(dict(n='nez', b=((-.03, .69, .2), (.02, .725, .235)), d=lambda P: perle(P, reflets()[4:]), c=uni(C['reflet']), g=cst(G_PERLE), pas=.0016, part=.002))
if EXPR == 'joie':
    # Bouche ouverte en D sous le nez, langue rose au fond.
    def d_bouche(P):
        z = vers_surface(d_tete_lisse, np.array([0.]), np.array([.648]))[0]
        return smax(ell(P, (0, .648, z - .002), (.026, .017, .009)), P[:, 1] - .657, .004)

    def c_bouche(P):
        return mel(C['bouche'], C['langue'], (.641 - P[:, 1]) * 260)
    PARTIES.append(dict(n='nez', b=((-.035, .625, .18), (.035, .665, .225)), d=d_bouche, c=c_bouche, g=cst(G_MAT), pas=.0022, part=.006))
if EXPR == 'surpris':
    def d_bouche(P):
        z = vers_surface(d_tete_lisse, np.array([0.]), np.array([.645]))[0]
        return ell(P, (0, .645, z - .001), (.0105, .013, .006))
    PARTIES.append(dict(n='nez', b=((-.02, .625, .18), (.02, .665, .225)), d=d_bouche, c=uni(C['bouche']), g=cst(G_MAT), pas=.0018, part=.003))

# Os : (nom, parent, x, y, z) — inchangés : mario.js les nomme.
OS = [('hanches', -1, 0, .3, 0), ('buste', 0, 0, .37, 0), ('tete', 1, 0, .6, 0), ('oG', 2, .095, .85, -.03), ('oD', 2, -.095, .85, -.03),
      ('epG', 1, .122, .535, 0), ('coG', 5, .178, .432, 0), ('epD', 1, -.122, .535, 0), ('coD', 7, -.178, .432, 0),
      ('cuG', 0, .087, .28, 0), ('tiG', 9, .09, .185, 0), ('piG', 10, .09, .068, 0), ('cuD', 0, -.087, .28, 0), ('tiD', 12, -.09, .185, 0), ('piD', 13, -.09, .068, 0),
      ('q1', 0, 0, .275, -.11), ('q2', 15, 0, .258, -.235), ('q3', 16, 0, .262, -.33)]
IO = {o[0]: i for i, o in enumerate(OS)}


def fondu(v, a, b):
    return np.clip((v - a) / (b - a), 0, 1)


def poids(n, P):
    N = len(P)
    a = np.zeros(N, int); b = np.zeros(N, int); w = np.ones(N)
    y = P[:, 1]

    def deux(ba, bb, t):
        a[:] = IO[ba]; b[:] = IO[bb]; w[:] = 1 - t

    if n in ('tete', 'yeux', 'nez', 'mo'):
        a[:] = b[:] = IO['tete']
    elif n in ('oG', 'oD'):
        deux('tete', n, fondu(y, .84, .885))
    elif n == 'torse':
        deux('hanches', 'buste', fondu(y, .35, .43))
    elif n == 'ceinture':
        a[:] = b[:] = IO['hanches']
    elif n in ('jG', 'jD'):
        s = n[1]
        t = fondu(y, .135, .2)
        a[:] = IO['ti' + s]; b[:] = IO['cu' + s]; w[:] = 1 - t
        hh = fondu(y, .25, .31)
        a[hh > 0] = IO['cu' + s]; b[hh > 0] = IO['hanches']; w[hh > 0] = 1 - hh[hh > 0]
    elif n in ('cG', 'cD'):
        s = n[1]
        deux('pi' + s, 'ti' + s, fondu(y, .06, .1))
    elif n in ('pG', 'pD'):
        a[:] = b[:] = IO['pi' + n[1]]
    elif n in ('mG', 'mD'):
        s = n[1]
        q = np.array([.178 if s == 'G' else -.178, .432, 0])
        v = np.array([.056 if s == 'G' else -.056, -.103, 0]); v /= np.linalg.norm(v)
        t = fondu(((P - q) * v).sum(-1), -.03, .03)
        a[:] = IO['ep' + s]; b[:] = IO['co' + s]; w[:] = 1 - t
        h = fondu(y, .52, .565) * fondu(np.abs(P[:, 0]), .165, .1)
        o = h > 0
        b[o] = IO['buste']; a[o] = IO['ep' + s]; w[o] = 1 - h[o]
    elif n in ('aG', 'aD'):
        a[:] = b[:] = IO['co' + n[1]]
    elif n == 'queue':
        z = -P[:, 2]
        t1 = fondu(z, .19, .26); t2 = fondu(z, .3, .36)
        a[:] = IO['q1']; b[:] = IO['q2']; w[:] = 1 - t1
        o = t2 > 0
        a[o] = IO['q2']; b[o] = IO['q3']; w[o] = 1 - t2[o]
    return a, b, w


def sculpte(p):
    (x0, y0, z0), (x1, y1, z1) = p['b']
    st = p['pas'] / FIN
    xs = np.arange(x0, x1, st); ys = np.arange(y0, y1, st); zs = np.arange(z0, z1, st)
    X, Y, Z = np.meshgrid(xs, ys, zs, indexing='ij')
    G = np.stack([X, Y, Z], -1)
    v = p['d'](G.reshape(-1, 3)).reshape(X.shape)
    V, F, _, _ = marching_cubes(v, 0, spacing=(st, st, st))
    V = V + np.array([x0, y0, z0])
    but = max(40, int(CIBLE * p['part']))
    if len(V) > but:
        V, F = fast_simplification.simplify(V.astype(np.float32), F.astype(np.int32), target_count=but * 2)
    return V.astype(float), F


def normales(fd, P, e=.0035):
    n = np.zeros_like(P)
    for i in range(3):
        d = np.zeros(3); d[i] = e
        n[:, i] = fd(P + d) - fd(P - d)
    return n / np.maximum(L(n)[..., None], 1e-9)


def toutes(P):
    d = 1e9
    for p in PARTIES:
        d = np.minimum(d, p['d'](P))
    return d


# --- Les traits : moustaches, bouche, sourcils, yeux fermés — de fins tubes posés sur la peau --------------------------
def traits():
    V, F, N = [], [], []

    def tube(a, b, r, cotes=6):
        a = np.array(a, float); b = np.array(b, float)
        d = b - a; d /= np.linalg.norm(d)
        u = np.cross(d, [0, 1, 0.3]); u /= np.linalg.norm(u)
        w = np.cross(d, u)
        n0 = len(V)
        for c in (a, b):
            for k in range(cotes):
                t = k * 2 * np.pi / cotes
                e = np.cos(t) * u + np.sin(t) * w
                V.append(c + r * e); N.append(e)
        for k in range(cotes):
            q = (k + 1) % cotes
            F.extend([[n0 + k, n0 + q, n0 + cotes + q], [n0 + k, n0 + cotes + q, n0 + cotes + k]])

    def sur_peau(xs, ys, h=.0026):
        z = vers_surface(d_tete_lisse, np.array(xs), np.array(ys))
        return np.stack([xs, ys, z + h], -1)

    def courbe(xs, ys, r, h=.0022):
        p = sur_peau(np.array(xs, float), np.array(ys, float), h)
        for a, b in zip(p[:-1], p[1:]):
            tube(a, b, r)

    u = np.linspace(0, 1, 9)
    for s in (-1, 1):
        # Moustaches : trois par joue, qui sortent des favoris en s'écartant.
        for dy, dz, y2 in ((.012, 0, .72), (-.008, -.01, .69), (-.026, -.02, .655)):
            tube((s * .118, .682 + dy, .118 + dz), (s * .262, y2, .05 + dz), .0022, 5)
        cx = s * .079
        # Sourcils : petit arc au-dessus de l'œil, selon l'expression.
        haut = {'doux': .79, 'joie': .794, 'surpris': .806, 'endormi': .784}[EXPR]
        arc = {'doux': .004, 'joie': .006, 'surpris': .009, 'endormi': .0015}[EXPR]
        pente = {'doux': 0, 'joie': .002, 'surpris': 0, 'endormi': -.004}[EXPR]
        xs = cx + s * (u - .5) * .036
        courbe(xs, haut + arc * np.sin(u * np.pi) + pente * (2 * u - 1), .0034)
        if not YEUX_OUVERTS:
            t = np.linspace(0, np.pi, 11)
            ex = cx + .021 * np.cos(t)
            ey = .745 + (.011 * np.sin(t) if EXPR == 'joie' else -.007 * np.sin(t) + .004)
            courbe(ex, ey, .0042, .003)
    # Bouche en ω : le petit trait sous le nez, puis deux arcs qui remontent.
    if EXPR == 'joie':
        courbe(np.array([0., 0.]), np.array([.688, .658]), .0032)
    elif EXPR == 'surpris':
        courbe(np.array([0., 0.]), np.array([.688, .662]), .0032)
    else:
        courbe(np.array([0., 0.]), np.array([.688, .664]), .0032)
        larg = .03 if EXPR == 'doux' else .022
        for s in (-1, 1):
            t = np.linspace(0, 1, 9)
            courbe(s * t * larg, .664 - .011 * np.sin(t * np.pi) + .006 * t, .0032)
    return np.array(V), np.array(F), np.array(N)


Vs, Ns, Cs, Gs, Fs, Ba, Bb, Bw = [], [], [], [], [], [], [], []
n0 = 0
for p in PARTIES:
    V, F = sculpte(p)
    N = normales(p['d'], V)
    c = p['c'](V)
    ao = np.zeros(len(V))
    for i, h in enumerate((.012, .026, .05, .08)):
        ao += np.clip((h - toutes(V + N * h)) / h, 0, 1) * (.5 ** i)
    ao = 1 - np.clip(ao * .55, 0, .72)
    c = np.clip(c, 0, 1) * ao[..., None]
    a, b, w = poids(p['n'], V)
    Vs.append(V); Ns.append(N); Cs.append(c); Gs.append(p['g'](V)); Fs.append(F + n0); Ba.append(a); Bb.append(b); Bw.append(w)
    n0 += len(V)
    print(p['n'], len(V), len(F))
V, F, N = traits()
Vs.append(V); Ns.append(N); Cs.append(np.tile(np.array(C['trait']), (len(V), 1))); Gs.append(np.full(len(V), G_MAT)); Fs.append(F + n0)
Ba.append(np.full(len(V), IO['tete'])); Bb.append(np.full(len(V), IO['tete'])); Bw.append(np.ones(len(V)))
V = np.vstack(Vs); N = np.vstack(Ns); Co = np.vstack(Cs); G = np.concatenate(Gs); F = np.vstack(Fs); Ba = np.concatenate(Ba); Bb = np.concatenate(Bb); Bw = np.concatenate(Bw)
print('total', len(V), 'sommets', len(F), 'triangles', V.min(0), V.max(0))

ech = 32000 / 1.1
pos = np.round(V * ech).astype(np.int16)
nor = np.round(N * 127).astype(np.int8)
col8 = np.round(np.clip(Co, 0, 1) * 255).astype(np.uint8)
buf = b''.join([pos[:, i].tobytes() for i in range(3)] + [nor[:, i].tobytes() for i in range(3)] + [col8[:, i].tobytes() for i in range(3)] +
               [np.uint8(np.round(G * 255)).tobytes(), np.uint8(Ba).tobytes(), np.uint8(Bb).tobytes(), np.uint8(np.round(Bw * 255)).tobytes()])
ind = F.reshape(-1).astype(np.int32)
I32 = len(V) > 65535
dif = np.diff(ind, prepend=0).astype(np.int32 if I32 else np.int16)
z = gzip.compress(buf + dif.tobytes(), 9, mtime=0)
meta = dict(nv=len(V), ni=len(ind), ech=ech, i32=I32, os=[dict(n=o[0], p=o[1], x=o[2], y=o[3], z=o[4]) for o in OS], d=base64.b64encode(z).decode())
with open(SORTIE, 'w', encoding='utf8', newline='') as f:
    json.dump(meta, f)
print('brut', len(buf) + len(dif) * 4, 'gzip', len(z))
