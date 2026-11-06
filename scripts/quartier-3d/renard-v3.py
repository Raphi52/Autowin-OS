# Sculpture du RENARD en feutrine (conv-1448, lot 1 du plan de conv-1446), d'après la référence choisie par l'utilisateur
# (D:\AutoWinOS\.autowin-tmp\conv-1446\out2\renard.webp) : renard roux, museau et joues blancs, veste turquoise ouverte sur
# un plastron crème, bandoulière et sacoche de cuir, pattes et mains brun foncé, queue en panache au bout blanc.
# Copie de conv-1421/gen/d3/tanuki.py (qui, lancé avec 26000, redonne b3d/tanuki-hd.json octet pour octet) : MÊME squelette
# (OS), mêmes poids aux articulations, même semelle au sol — seules les formes et les couleurs changent. Toutes les poses
# du tanuki s'appliquent donc telles quelles, et les pieds tombent au même point d'ancrage.
# v3 (conv-1558, « bring the fox, panda and red panda up to v3 quality ») : mêmes formes et mêmes couleurs, grille FIN fois
# plus fine, et le canal G dit la matière au rendu (pelage et longueur du poil, feutre du visage, tissu, cuir, perles).
# Usage : FIN=3 python -I renard-v3.py 1500000 b3d/renard-v3-hd.json   (fabriquer-atlas.sh avec ANIMAL=renard)
import base64, gzip, json, os, sys
import numpy as np
from skimage.measure import marching_cubes
import fast_simplification

CIBLE = int(sys.argv[1]) if len(sys.argv) > 1 else 3200    # sommets au total
SORTIE = sys.argv[2] if len(sys.argv) > 2 else 'b3d/renard-hd.json'
# v3 (conv-1558) : FIN affine la grille de chaque partie (3 pour l'atlas, avec 1 500 000 sommets), comme tanuki-v3.py.
FIN = float(os.environ.get('FIN', 1))
# Le canal G dit la MATIÈRE au rendu (sprite-atlas-v3.py) : G < .11 pelage, G y code la longueur du poil (1 - 8·G) ;
# .12 feutre ras (visage peint) ; .25 tissu tissé ; .5 mat (cuir, bois, traits) ; 1 perle (yeux, nez).
G_FEUTRE, G_TISSU, G_MAT, G_PERLE = .12, .25, .5, 1.0


def g_poil(f):
    """Longueur relative du poil (0,14 à 1) → valeur du canal G. Seule la queue prend 1 (G = 0) : queue-effilee.py la
    reconnaît à ce zéro."""
    return (1 - np.clip(f, .14, 1)) / 8


def cst(g):
    return lambda P: np.full(len(P), g)


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


def smin(a, b, k):
    h = np.clip(.5 + .5 * (b - a) / k, 0, 1)
    return b * (1 - h) + a * h - k * h * (1 - h)


def smax(a, b, k):
    return -smin(-a, -b, k)


def bosses(P, a=.0035):
    # La laine feutrée n'est jamais lisse : de petites bosses irrégulières, à la main.
    x, y, z = P[..., 0], P[..., 1], P[..., 2]
    return a * (np.sin(x * 61 + y * 23) * np.sin(y * 57 + z * 31) + .6 * np.sin(z * 83 + x * 37) * np.sin(y * 71 - x * 19))


def tache(P, f=38.0):
    x, y, z = P[..., 0], P[..., 1], P[..., 2]
    n = np.sin(x * f + 1.3 * np.sin(y * f * .7)) * np.sin(y * f * 1.1 + 1.7 * np.sin(z * f * .8)) * np.sin(z * f * .9 + 1.1 * np.sin(x * f * .6))
    return n


C = dict(
    gris=(.60, .54, .48), grisF=(.40, .34, .29), creme=(.93, .86, .74), noir=(.035, .03, .03), oreille=(.95, .86, .77),
    orange=(.88, .36, .07), orangeC=(.97, .55, .14), orangeF=(.70, .22, .04), bleu=(.20, .34, .46), blanc=(.95, .93, .88),
    paille=(.70, .55, .30), pailleF=(.46, .34, .16), laque=(.05, .04, .04), patte=(.07, .055, .05), chaussette=(.94, .90, .82),
)


def mel(a, b, t):
    t = np.clip(t, 0, 1)[..., None]
    return np.array(a) * (1 - t) + np.array(b) * t



C = dict(
    roux=(.87, .32, .15), rouxF=(.66, .19, .07), rouxC=(.96, .47, .24), creme=(.96, .89, .76), noir=(.035, .03, .03),
    brun=(.30, .12, .07), brunF=(.17, .065, .04),
    turq=(.10, .56, .54), turqF=(.05, .38, .38), turqC=(.24, .70, .66),
    cuir=(.58, .36, .17), cuirF=(.36, .2, .09),
)


# --- Parties du renard : même squelette, mêmes articulations que le tanuki, autre bête et autre costume -----------------
def d_museau(P):
    # Le museau effilé pointe vers l'avant ; la truffe se pose au bout.
    return cap(P, (0, .684, .09), (0, .668, .222), .072, .03)


def d_joue(P, s):
    # Les joues en touffes : la fourrure part en pointe sur les côtés, sous les yeux.
    d = ell(P, (s * .118, .662, .045), (.08, .055, .07))
    return smin(d, cap(P, (s * .14, .656, .035), (s * .228, .62, .0), .045, .008), .03)


def d_tete(P):
    d = ell(P, (0, .728, 0), (.165, .15, .158))
    for s in (-1, 1):
        d = smin(d, d_joue(P, s), .04)
    d = smin(d, d_museau(P), .05)
    d = smin(d, ell(P, (0, .615, .0), (.105, .05, .1)), .04)   # sous le menton
    return d + bosses(P)


def c_tete(P):
    n = tache(P) * .5 + .5
    o = mel(C['roux'], C['rouxF'], n * .75)
    x, y, z = P[:, 0], P[:, 1], P[:, 2]
    # Le masque blanc : le dessous du museau, les joues jusqu'aux touffes, le menton. Le dessus du museau reste roux.
    ligne = .668 + .46 * np.clip(np.abs(x) - .012, 0, .1)
    k = np.minimum((ligne - y) * 70, (z + .03) * 30)
    return mel(o, C['creme'], k + .05 * (n - .5))


def _oreille_q(P):
    # L'oreille est aplatie d'avant en arrière : on la sculpte dans un espace étiré en profondeur.
    Q = P.copy()
    Q[:, 2] = -.03 + (P[:, 2] + .03) * 2.4
    return Q


def d_oreille(P, s):
    Q = _oreille_q(P)
    # La pointe reste à la hauteur de l'oreille du tanuki (≈ 1,0) : plus haut, elle sort de la case vue de dos (pinceau, marteau).
    d = cap(Q, (s * .1, .84, -.03), (s * .162, .978, -.04), .072, .005) / 1.5
    # Le creux de l'oreille, tourné vers l'avant.
    d = smax(d, -ell(P, (s * .113, .9, .006), (.034, .075, .016)), .01)
    return d + bosses(P, .0022)


def c_oreille(s):
    def f(P):
        n = tache(P) * .5 + .5
        o = mel(C['roux'], C['rouxF'], n * .8)
        # La pointe et le bord sont brun foncé, l'intérieur crème.
        o = mel(o, C['brunF'], (P[:, 1] - .955) * 30)
        k = 1.0 - L((P - np.array([s * .113, .9, .02])) / np.array([.043, .088, .05]))
        return mel(o, C['creme'], k * 14)
    return f


def d_torse(P):
    d = ell(P, (0, .405, 0), (.152, .135, .125))
    d = smin(d, cap(P, (0, .42, -.005), (0, .56, -.012), .128, .098), .05)
    d = smin(d, ell(P, (0, .335, 0), (.162, .05, .138)), .03)    # basque de la veste
    # Le col montant de la veste, derrière la nuque.
    d = smin(d, ell(P, (0, .585, -.055), (.112, .05, .062)), .03)
    return d + bosses(P)


def col(P):
    a = cap(P, (-.082, .587, .068), (.022, .452, .128), .016, .022)
    b = cap(P, (.082, .587, .068), (-.022, .452, .128), .016, .022)
    return np.minimum(a, b)


def d_torse2(P):
    return smin(d_torse(P), col(P), .012)


def tissu(P):
    n = tache(P, 46) * .5 + .5
    n2 = tache(P * 1.7 + 3, 58) * .5 + .5
    o = mel(C['turqF'], C['turq'], .35 + n * 1.1)
    return mel(o, C['turqC'], (n2 - .7) * 4)


# La bandoulière : de l'épaule droite à la hanche gauche, devant comme derrière (un plan qui contient l'axe avant-arrière).
B0 = np.array([-.10, .56, 0.])
BN = np.array([.25, .27, 0.]) / np.hypot(.25, .27)


def bande(P):
    return np.clip((.0135 - np.abs(((P - B0) * BN).sum(-1))) * 400, 0, 1)


def c_torse(P):
    o = tissu(P)
    # Le plastron de fourrure crème dans le V de la veste ouverte.
    v = (P[:, 1] - .452) * .56 - np.abs(P[:, 0])
    n = tache(P * 2.3, 70)
    o = np.where(((v + .006 * n)[..., None] > 0) & (P[:, 2:3] > .05), mel(C['creme'], (.9, .8, .66), n * .5 + .5), o)
    k = col(P)
    o = mel(o, C['turqF'], (.012 - k) * 240)
    return mel(o, C['cuirF'], bande(P))


def d_ceinture(P):
    # L'ourlet de la veste, à la taille : il tient la jonction avec les jambes comme la ceinture du tanuki.
    q = np.sqrt((P[:, 0] / .166) ** 2 + (P[:, 2] / .141) ** 2) * .15
    d = np.sqrt((q - .15) ** 2 + ((P[:, 1] - .318) * .68) ** 2) - .024
    return d + bosses(P, .002)


def c_ceinture(P):
    return mel(tissu(P), C['turqF'], .55)


def fourrure(P):
    n = tache(P) * .5 + .5
    return mel(C['roux'], C['rouxF'], n * .8)


def d_jambe(P, s):
    d = ell(P, (s * .087, .208, .0), (.112, .118, .118))
    d = smin(d, ell(P, (s * .03, .265, 0), (.11, .06, .115)), .03)
    d = smax(d, .092 - P[:, 1], .012)
    return d + bosses(P)


def c_jambe(P):
    # Les pattes rousses, brun foncé vers le bas, comme des chaussettes.
    return mel(fourrure(P), C['brun'], (.145 - P[:, 1]) * 40)


def d_chaussette(P, s):
    return cap(P, (s * .09, .118, 0), (s * .09, .048, .004), .05, .044) + bosses(P, .0015)


def d_pied(P, s):
    # Une patte brune, arrondie, posée à plat : la semelle touche le sol exactement comme celle du tanuki.
    d = ell(P, (s * .09, .036, .036), (.05, .036, .082))
    d = np.minimum(d, ell(P, (s * .09, .0135, .04), (.054, .0135, .094)))
    return d


def c_pied(s):
    def f(P):
        n = tache(P, 60) * .5 + .5
        return mel(C['brunF'], C['brun'], n)
    return f


def d_manche(P, s):
    d = cap(P, (s * .118, .535, -.005), (s * .178, .432, .0), .068, .082)
    d = smin(d, cap(P, (s * .178, .432, .0), (s * .226, .338, .012), .082, .098), .025)
    d = smax(d, ((P[:, 0] - s * .226) * s * .35 + (.325 - P[:, 1])), .012)
    return d + bosses(P)


def c_manche(s):
    def f(P):
        # Un revers plus sombre au bout de la manche.
        r = (P[:, 0] - s * .226) * s * .35 + (.325 - P[:, 1])
        return mel(tissu(P), C['turqF'], (r + .03) * 60)
    return f


def d_patte(P, s):
    d = cap(P, (s * .205, .365, .01), (s * .228, .315, .018), .04)
    return smin(d, ell(P, (s * .236, .295, .022), (.042, .046, .044)), .02) + bosses(P, .002)


def c_patte(s):
    def f(P):
        n = tache(P, 60) * .5 + .5
        return mel(C['brunF'], C['brun'], n)
    return f


# La queue en panache : plus épaisse que celle du tanuki, aussi longue (elle doit tenir dans la même case).
QP = np.array([[0, .275, -.11], [0, .265, -.222], [0, .302, -.328], [0, .372, -.398]])
QR = [.05, .086, .082, .014]


def d_queue(P):
    d = cap(P, QP[0], QP[1], QR[0], QR[1])
    d = smin(d, cap(P, QP[1], QP[2], QR[1], QR[2]), .02)
    d = smin(d, cap(P, QP[2], QP[3], QR[2], QR[3]), .03)
    return d + bosses(P, .004)


def c_queue(P):
    # Rousse, le bout blanc.
    t = (-P[:, 2] - .11) / .3
    n = tache(P) * .04
    return mel(fourrure(P), C['creme'], (t + n - .87) * 30)


# La sacoche de cuir, sur la hanche gauche, juste devant la main : elle suit un peu la cuisse quand il marche.
SAC = np.array([.2, .2, .086])


def d_sac(P):
    q = np.abs(P - SAC) - np.array([.02, .04, .046])
    d = L(np.maximum(q, 0)) + np.minimum(q.max(-1), 0) - .013
    return d + bosses(P, .0012)


def c_sac(P):
    n = tache(P, 70) * .5 + .5
    o = mel(C['cuir'], C['cuirF'], n * .5)
    # Le rabat, plus sombre, sur le haut.
    return mel(o, C['cuirF'], (P[:, 1] - .215) * 60)


def uni(c):
    return lambda P: np.tile(np.array(c), (len(P), 1))


def perle(P, l):
    d = 1e9
    for c, r in l:
        d = np.minimum(d, ell(P, c, r))
    return d


YEUX = [((.079, .748, .1405), (.024, .025, .02)), ((-.079, .748, .1405), (.024, .025, .02))]
NEZ = [((0, .672, .246), (.025, .019, .018))]

PARTIES = [
    dict(n='tete', b=((-.26, .57, -.2), (.26, .9, .29)), d=d_tete, c=c_tete, pas=.0105, gl=0, part=.25),
    dict(n='oG', b=((.0, .77, -.1), (.23, 1.06, .05)), d=lambda P: d_oreille(P, 1), c=c_oreille(1), pas=.0075, gl=0, part=.045),
    dict(n='oD', b=((-.23, .77, -.1), (.0, 1.06, .05)), d=lambda P: d_oreille(P, -1), c=c_oreille(-1), pas=.0075, gl=0, part=.045),
    dict(n='yeux', b=((-.11, .71, .11), (.11, .78, .17)), d=lambda P: perle(P, YEUX), c=uni(C['noir']), pas=.0045, gl=1, part=.02),
    dict(n='nez', b=((-.04, .64, .21), (.04, .71, .28)), d=lambda P: perle(P, NEZ), c=uni(C['noir']), pas=.0045, gl=1, part=.012),
    dict(n='torse', b=((-.19, .25, -.16), (.19, .66, .17)), d=d_torse2, c=c_torse, pas=.0105, gl=0, part=.2),
    dict(n='ceinture', b=((-.19, .25, -.17), (.19, .37, .19)), d=d_ceinture, c=c_ceinture, pas=.0075, gl=0, part=.06),
    dict(n='jG', b=((-.04, .07, -.14), (.21, .34, .14)), d=lambda P: d_jambe(P, 1), c=c_jambe, pas=.0105, gl=0, part=.075),
    dict(n='jD', b=((-.21, .07, -.14), (.04, .34, .14)), d=lambda P: d_jambe(P, -1), c=c_jambe, pas=.0105, gl=0, part=.075),
    dict(n='cG', b=((.02, .03, -.07), (.16, .14, .07)), d=lambda P: d_chaussette(P, 1), c=c_pied(1), pas=.01, gl=0, part=.012),
    dict(n='cD', b=((-.16, .03, -.07), (-.02, .14, .07)), d=lambda P: d_chaussette(P, -1), c=c_pied(-1), pas=.01, gl=0, part=.012),
    dict(n='pG', b=((.02, -.01, -.08), (.16, .09, .15)), d=lambda P: d_pied(P, 1), c=c_pied(1), pas=.0055, gl=0, part=.028),
    dict(n='pD', b=((-.16, -.01, -.08), (-.02, .09, .15)), d=lambda P: d_pied(P, -1), c=c_pied(-1), pas=.0055, gl=0, part=.028),
    dict(n='mG', b=((.03, .3, -.13), (.34, .63, .14)), d=lambda P: d_manche(P, 1), c=c_manche(1), pas=.0095, gl=0, part=.05),
    dict(n='mD', b=((-.34, .3, -.13), (-.03, .63, .14)), d=lambda P: d_manche(P, -1), c=c_manche(-1), pas=.0095, gl=0, part=.05),
    dict(n='aG', b=((.14, .23, -.05), (.3, .4, .08)), d=lambda P: d_patte(P, 1), c=c_patte(1), pas=.0075, gl=0, part=.012),
    dict(n='aD', b=((-.3, .23, -.05), (-.14, .4, .08)), d=lambda P: d_patte(P, -1), c=c_patte(-1), pas=.0075, gl=0, part=.012),
    dict(n='queue', b=((-.12, .15, -.47), (.12, .42, -.05)), d=d_queue, c=c_queue, pas=.0095, gl=0, part=.06),
    dict(n='sac', b=((.14, .12, .01), (.26, .28, .16)), d=d_sac, c=c_sac, pas=.006, gl=0, part=.015),
]

OS = [('hanches', -1, 0, .3, 0), ('buste', 0, 0, .37, 0), ('tete', 1, 0, .6, 0), ('oG', 2, .095, .85, -.03), ('oD', 2, -.095, .85, -.03),
      ('epG', 1, .122, .535, 0), ('coG', 5, .178, .432, 0), ('epD', 1, -.122, .535, 0), ('coD', 7, -.178, .432, 0),
      ('cuG', 0, .087, .28, 0), ('tiG', 9, .09, .185, 0), ('piG', 10, .09, .068, 0), ('cuD', 0, -.087, .28, 0), ('tiD', 12, -.09, .185, 0), ('piD', 13, -.09, .068, 0),
      ('q1', 0, 0, .275, -.11), ('q2', 15, 0, .258, -.235), ('q3', 16, 0, .262, -.33)]
IO = {o[0]: i for i, o in enumerate(OS)}


def fondu(v, a, b):
    return np.clip((v - a) / (b - a), 0, 1)


def poids(n, P):
    N = len(P)
    a = np.zeros(N, int); b = np.zeros(N, int); w = np.ones(N)    # w = poids de a
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
        # Le haut du pantalon reste à la taille, le bas suit le genou.
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
        # L'épaule ne décolle pas du buste.
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


# --- Matières v3 du renard (conv-1558) : pelage, feutre du visage, tissu de la veste, cuir ---------------------------
def g_tete(P):
    # Feutre ras sur le blanc peint du museau et du menton : les traits s'y lisent (leçon du tanuki v3, où la fourrure
    # noyait la bouche). Poil court sur le devant, long sur le crâne et dans les touffes des joues, qui font sa silhouette.
    c = c_tete(P)
    peint = (P[:, 2] > .03) & (c.mean(1) > .72) & (np.abs(P[:, 0]) < .1) & (P[:, 1] > .6)
    touffe = np.clip((np.abs(P[:, 0]) - .13) * 12, 0, 1) * (P[:, 1] < .69)
    f = np.where(P[:, 2] > .08, .3, .7) + .25 * touffe
    return np.where(peint, G_FEUTRE, g_poil(np.minimum(f, .9)))


def g_oreille(s):
    # Le dedans crème reste ras, le dos et la pointe brune portent le poil.
    def f(P):
        k = 1.0 - L((P - np.array([s * .113, .9, .02])) / np.array([.043, .088, .05]))
        return np.where(k > .05, G_FEUTRE, g_poil(.45))
    return f


def g_torse(P):
    # Le plastron crème dans le V de la veste est du pelage ; la bandoulière, du cuir ; le reste, le tissu de la veste.
    v = (P[:, 1] - .452) * .56 - np.abs(P[:, 0])
    n = tache(P * 2.3, 70)
    g = np.where((v + .006 * n > 0) & (P[:, 2] > .05), g_poil(.5), G_TISSU)
    return np.where(bande(P) > .5, G_MAT, g)


# Les pieds restent ras : un poil qui retombe sous la semelle passerait sous la ligne de sol de la case.
MATIERE = dict(tete=g_tete, oG=g_oreille(1), oD=g_oreille(-1), yeux=cst(G_PERLE), nez=cst(G_PERLE), torse=g_torse,
               ceinture=cst(G_TISSU), jG=cst(g_poil(.3)), jD=cst(g_poil(.3)), cG=cst(g_poil(.25)), cD=cst(g_poil(.25)),
               pG=cst(G_FEUTRE), pD=cst(G_FEUTRE), mG=cst(G_TISSU), mD=cst(G_TISSU), aG=cst(g_poil(.4)),
               aD=cst(g_poil(.4)), queue=cst(g_poil(1)), sac=cst(G_MAT))


def sculpte(p):
    (x0, y0, z0), (x1, y1, z1) = p['b']
    st = p['pas'] / FIN
    xs = np.arange(x0, x1, st); ys = np.arange(y0, y1, st); zs = np.arange(z0, z1, st)
    X, Y, Z = np.meshgrid(xs, ys, zs, indexing='ij')
    G = np.stack([X, Y, Z], -1)
    v = p['d'](G.reshape(-1, 3)).reshape(X.shape)
    V, F, _, _ = marching_cubes(v, 0, spacing=(st, st, st))
    V = V + np.array([x0, y0, z0])
    # Le sens des faces de marching_cubes convient déjà à un champ négatif dedans.
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




def poids_r(n, P):
    # La sacoche : à moitié portée par la cuisse gauche, à moitié par le bassin.
    if n == 'sac':
        N = len(P)
        return np.full(N, IO['cuG']), np.full(N, IO['hanches']), np.full(N, .6)
    return poids(n, P)


def bouche():
    # Le sourire : de petits tubes sous la truffe, trop fins pour le champ de distance. Pas de moustaches chez le renard.
    V, F = [], []

    def tube(a, b, r):
        a = np.array(a, float); b = np.array(b, float)
        d = b - a; d /= np.linalg.norm(d)
        u = np.cross(d, [0, 1, 0.3]); u /= np.linalg.norm(u)
        w = np.cross(d, u)
        n0 = len(V)
        for c in (a, b):
            for k in range(3):
                t = k * 2 * np.pi / 3
                V.append(c + r * (np.cos(t) * u + np.sin(t) * w))
        for k in range(3):
            q = (k + 1) % 3
            F.extend([[n0 + k, n0 + q, n0 + 3 + q], [n0 + k, n0 + 3 + q, n0 + 3 + k]])

    tube((0, .656, .247), (0, .641, .238), .0032)
    for s in (-1, 1):
        tube((0, .641, .238), (s * .016, .642, .231), .0032)
        tube((s * .016, .642, .231), (s * .027, .649, .218), .0032)
    return np.array(V), np.array(F)


Vs, Ns, Cs, Gs, Fs, Ba, Bb, Bw = [], [], [], [], [], [], [], []
n0 = 0
for p in PARTIES:
    V, F = sculpte(p)
    N = normales(p['d'], V)
    c = p['c'](V)
    # Occlusion : la marionnette s'assombrit dans ses creux (col, sous le menton, entre les jambes).
    ao = np.zeros(len(V))
    for i, h in enumerate((.012, .026, .05, .08)):
        ao += np.clip((h - toutes(V + N * h)) / h, 0, 1) * (.5 ** i)
    ao = 1 - np.clip(ao * .55, 0, .72)
    c = np.clip(c, 0, 1) * ao[..., None]
    a, b, w = poids_r(p['n'], V)
    Vs.append(V); Ns.append(N); Cs.append(c); Gs.append(MATIERE[p['n']](V)); Fs.append(F + n0); Ba.append(a); Bb.append(b); Bw.append(w)
    n0 += len(V)
    print(p['n'], len(V), len(F))
V, F = bouche()
Vs.append(V)
n = V - V.mean(0)
Ns.append(n / L(n)[..., None]); Cs.append(np.tile(np.array(C['noir']), (len(V), 1))); Gs.append(np.full(len(V), G_MAT)); Fs.append(F + n0)
Ba.append(np.full(len(V), IO['tete'])); Bb.append(np.full(len(V), IO['tete'])); Bw.append(np.ones(len(V)))
V = np.vstack(Vs); N = np.vstack(Ns); Co = np.vstack(Cs); G = np.concatenate(Gs); F = np.vstack(Fs); Ba = np.concatenate(Ba); Bb = np.concatenate(Bb); Bw = np.concatenate(Bw)
print('total', len(V), 'sommets', len(F), 'triangles', V.min(0), V.max(0))

ech = 32000 / 1.1
pos = np.round(V * ech).astype(np.int16)
nor = np.round(N * 127).astype(np.int8)
col8 = np.round(np.clip(Co, 0, 1) * 255).astype(np.uint8)
# Plans séparés : la compression y gagne beaucoup.
buf = b''.join([pos[:, i].tobytes() for i in range(3)] + [nor[:, i].tobytes() for i in range(3)] + [col8[:, i].tobytes() for i in range(3)] +
               [np.uint8(np.round(G * 255)).tobytes(), np.uint8(Ba).tobytes(), np.uint8(Bb).tobytes(), np.uint8(np.round(Bw * 255)).tobytes()])
ind = F.reshape(-1).astype(np.int32)
I32 = len(V) > 65535   # v3 : au-delà de 65 535 sommets, index 32 bits (marionnette.js lit le drapeau i32)
dif = np.diff(ind, prepend=0).astype(np.int32 if I32 else np.int16)
buf2 = dif.tobytes()
z = gzip.compress(buf + buf2, 9, mtime=0)
meta = dict(nv=len(V), ni=len(ind), ech=ech, i32=I32, os=[dict(n=o[0], p=o[1], x=o[2], y=o[3], z=o[4]) for o in OS], d=base64.b64encode(z).decode())
with open(SORTIE, 'w', encoding='utf8', newline='') as f:
    json.dump(meta, f)
print('brut', len(buf) + len(buf2), 'gzip', len(z), 'base64', len(meta['d']))
