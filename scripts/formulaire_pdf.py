"""Fabrique un formulaire PDF A4 qui se remplit à l'écran (champs) ou à la main (cadres imprimés) (conv-1968).

Né d'une grille d'entretien utilisateurs (refonte d'un logiciel) : le questionnaire vit dans un JSON et le PDF
se régénère quand une question change, au lieu de refaire la mise en page à la main.

Usage : python -I scripts/formulaire_pdf.py questionnaire.json sortie.pdf
Sortie : une ligne JSON {sortie, pages, champs}.

Questionnaire JSON (seul "titre" est obligatoire) :
{
  "titre": "...", "sousTitre": "...", "consigne": "...", "piedDePage": "...",
  "identification": {"titre": "...", "champs": ["Nom", "Prénom", "Poste"]},       # deux colonnes
  "sections": [{"titre": "...", "note": "(facultatif)", "questions": [
    {"texte": "...", "aide": "en italique", "lignes": 4},                           # cadre libre
    {"texte": "...", "liste": 5, "colonnes": [["Tâche", 0.7], ["Fréquence", 0.3]]}, # lignes numérotées
    {"texte": "...", "parties": [{"libelle": "...", "lignes": 3}]},                 # cadres titrés
    {"texte": "...", "choix": [{"libelle": "...", "options": ["Oui", "Non"]}], "champ": "Contact"}
  ]}]
}
Les questions sont numérotées en continu d'une section à l'autre ; une question ne se coupe jamais entre
deux pages, et une section part avec sa première question. Les espaces insécables (avant « ? » ou « : »)
ne coupent jamais une ligne.
"""
import json
import os
import re
import sys
import unicodedata

import pymupdf

LARGEUR, HAUTEUR = pymupdf.paper_size('a4')
MARGE_G = MARGE_D = 48
MARGE_HAUT = 46
MARGE_BAS = 58
ENCRE = (0.13, 0.15, 0.19)
ACCENT = (0.10, 0.29, 0.52)
DISCRET = (0.42, 0.45, 0.50)
CADRE = (0.62, 0.65, 0.70)
LIGNE = 18        # hauteur d'une ligne d'écriture dans un cadre, en points
RETRAIT = 20      # décalage des réponses sous le numéro de question
INTERLIGNE = 1.32
APRES_QUESTION = 14

# Helvetica intégrée à PyMuPDF, et non Arial de Windows : avec Arial embarquée, le texte du PDF se relisait
# faux (espace -> insécable, tiret -> tiret conditionnel, « · » -> U+A78F, glyphes partagés), ce qui cassait la
# recherche et le copier-coller. Helvetica relit juste, accents compris, et ne dépend pas du poste.
POLICES = {'normal': 'helv', 'gras': 'hebo', 'italique': 'heit'}


def charger_polices():
    return {cle: pymupdf.Font(nom) for cle, nom in POLICES.items()}


def couper(texte, police, taille, largeur):
    """Coupe aux seules espaces ordinaires : str.split() sans argument couperait aussi aux insécables."""
    lignes, courante = [], ''
    for mot in texte.split(' '):
        if not mot:
            continue
        essai = f'{courante} {mot}' if courante else mot
        if courante and police.text_length(essai, fontsize=taille) > largeur:
            lignes.append(courante)
            courante = mot
        else:
            courante = essai
    if courante:
        lignes.append(courante)
    return lignes or ['']


class Formulaire:
    def __init__(self, spec):
        self.spec = spec
        self.doc = pymupdf.open()
        self.polices = charger_polices()
        self.page = None
        self.y = 0.0
        self.noms = {}
        self.numero = 0

    # --- mise en page -------------------------------------------------------------------------------
    def nouvelle_page(self):
        self.page = self.doc.new_page(width=LARGEUR, height=HAUTEUR)
        self.y = MARGE_HAUT

    def reserver(self, hauteur):
        if hauteur > HAUTEUR - MARGE_HAUT - MARGE_BAS:
            raise ValueError(f'bloc de {hauteur:.0f} pt plus haut qu\'une page : réduis ses "lignes"')
        if self.page is None or self.y + hauteur > HAUTEUR - MARGE_BAS:
            self.nouvelle_page()

    def ecrire(self, x, y, lignes, police, taille, couleur, interligne=INTERLIGNE):
        ecrivain = pymupdf.TextWriter(self.page.rect)
        for i, ligne in enumerate(lignes):
            ecrivain.append((x, y + taille * (0.82 + i * interligne)), ligne, font=self.polices[police],
                            fontsize=taille)
        ecrivain.write_text(self.page, color=couleur)

    def nom_champ(self, libelle):
        base = unicodedata.normalize('NFKD', libelle).encode('ascii', 'ignore').decode()
        base = re.sub(r'[^A-Za-z0-9]+', '_', base).strip('_')[:40] or 'champ'
        rang = self.noms.get(base, 0) + 1
        self.noms[base] = rang
        return base if rang == 1 else f'{base}_{rang}'

    # --- champs -------------------------------------------------------------------------------------
    def champ_texte(self, rect, nom, infobulle, multiligne):
        # Le cadre est dessiné sur la page (il s'imprime vide) ; le champ, transparent, se pose dessus.
        self.page.draw_rect(rect, color=CADRE, width=0.7)
        champ = pymupdf.Widget()
        champ.field_type = pymupdf.PDF_WIDGET_TYPE_TEXT
        champ.field_name = self.nom_champ(nom)
        champ.field_label = infobulle
        champ.rect = rect
        champ.text_font = 'Helv'
        champ.text_fontsize = 10
        champ.text_color = ENCRE
        champ.border_width = 0
        champ.border_color = None
        champ.fill_color = None
        if multiligne:
            champ.field_flags |= pymupdf.PDF_TX_FIELD_IS_MULTILINE
        self.page.add_widget(champ)

    def case(self, x, y, nom, infobulle):
        rect = pymupdf.Rect(x, y, x + 10, y + 10)
        self.page.draw_rect(rect, color=DISCRET, width=0.8)
        champ = pymupdf.Widget()
        champ.field_type = pymupdf.PDF_WIDGET_TYPE_CHECKBOX
        champ.field_name = self.nom_champ(nom)
        champ.field_label = infobulle
        champ.rect = rect
        champ.border_width = 0
        champ.border_color = None
        champ.fill_color = None
        champ.text_color = ENCRE
        champ.field_value = False
        self.page.add_widget(champ)

    # --- blocs --------------------------------------------------------------------------------------
    def entete(self):
        self.nouvelle_page()
        largeur = LARGEUR - MARGE_G - MARGE_D
        for cle, police, taille, couleur, interligne, avant in (
                ('titre', 'gras', 20, ACCENT, 1.2, 0), ('sousTitre', 'normal', 11, DISCRET, INTERLIGNE, 4),
                ('consigne', 'italique', 9, DISCRET, INTERLIGNE, 3)):
            if not self.spec.get(cle):
                continue
            lignes = couper(self.spec[cle], self.polices[police], taille, largeur)
            self.y += avant
            self.ecrire(MARGE_G, self.y, lignes, police, taille, couleur, interligne)
            self.y += taille * interligne * len(lignes)
        self.y += 8
        self.page.draw_line((MARGE_G, self.y), (LARGEUR - MARGE_D, self.y), color=ACCENT, width=1.2)
        self.y += 16

    def titre_section(self, titre, note, hauteur_suivante):
        hauteur = 12 * INTERLIGNE + 13
        self.reserver(hauteur + hauteur_suivante)
        self.ecrire(MARGE_G, self.y, [titre], 'gras', 12, ACCENT)
        if note:
            decalage = self.polices['gras'].text_length(titre, fontsize=12) + 6
            self.ecrire(MARGE_G + decalage, self.y + 2.5, [note], 'italique', 9, DISCRET)
        self.y += 12 * INTERLIGNE + 3
        self.page.draw_line((MARGE_G, self.y), (LARGEUR - MARGE_D, self.y), color=CADRE, width=0.5)
        self.y += 10

    def identification(self, bloc):
        champs = bloc.get('champs', [])
        rangee = 9 * INTERLIGNE + 3 + 22 + 9
        self.titre_section(bloc.get('titre', 'Identification'), bloc.get('note'), rangee)
        ecart = 16
        colonne = (LARGEUR - MARGE_G - MARGE_D - ecart) / 2
        for debut in range(0, len(champs), 2):
            self.reserver(rangee)
            for rang, libelle in enumerate(champs[debut:debut + 2]):
                x = MARGE_G + rang * (colonne + ecart)
                self.ecrire(x, self.y, [libelle], 'gras', 9, DISCRET)
                haut = self.y + 9 * INTERLIGNE + 3
                self.champ_texte(pymupdf.Rect(x, haut, x + colonne, haut + 22), libelle, libelle, False)
            self.y += rangee
        self.y += 8

    def question(self, q, dessiner):
        """Pose la question à self.y et rend sa hauteur ; dessiner=False ne fait que mesurer."""
        x = MARGE_G + RETRAIT
        largeur = LARGEUR - MARGE_D - x
        prefixe = f'Q{self.numero}'
        y = self.y
        lignes = couper(q['texte'], self.polices['gras'], 10.5, largeur)
        if dessiner:
            self.ecrire(MARGE_G, y, [f'{self.numero}.'], 'gras', 10.5, ACCENT)
            self.ecrire(x, y, lignes, 'gras', 10.5, ENCRE)
        y += 10.5 * INTERLIGNE * len(lignes)
        if q.get('aide'):
            aide = couper(q['aide'], self.polices['italique'], 9, largeur)
            if dessiner:
                self.ecrire(x, y + 1, aide, 'italique', 9, DISCRET)
            y += 1 + 9 * INTERLIGNE * len(aide)
        y += 5
        if 'liste' in q:
            y = self.zone_liste(q, prefixe, x, largeur, y, dessiner)
        elif 'choix' in q:
            y = self.zone_choix(q, prefixe, x, largeur, y, dessiner)
        elif 'parties' in q:
            for partie in q['parties']:
                y = self.zone_libre(partie.get('libelle'), partie.get('lignes', 3), f"{prefixe} {partie.get('libelle', '')}",
                                    q['texte'], x, largeur, y, dessiner)
        else:
            y = self.zone_libre(None, q.get('lignes', 4), prefixe, q['texte'], x, largeur, y, dessiner)
        return y - self.y + APRES_QUESTION

    def zone_libre(self, libelle, lignes, nom, infobulle, x, largeur, y, dessiner):
        if libelle:
            if dessiner:
                self.ecrire(x, y, [libelle], 'gras', 9, DISCRET)
            y += 9 * INTERLIGNE + 2
        hauteur = lignes * LIGNE + 6
        if dessiner:
            self.champ_texte(pymupdf.Rect(x, y, x + largeur, y + hauteur), nom, infobulle, lignes > 1)
        return y + hauteur + 6

    def zone_liste(self, q, prefixe, x, largeur, y, dessiner):
        colonnes = q.get('colonnes') or [[None, 1]]
        total = sum(part for _, part in colonnes)
        numero, ecart = 14, 8
        utile = largeur - numero
        # Chaque en-tête passe à la ligne dans la largeur de SA colonne, au lieu de déborder sur la marge.
        entetes = [couper(libelle, self.polices['gras'], 9, utile * part / total - ecart) if libelle else []
                   for libelle, part in colonnes]
        hauteur_entete = max(len(lignes) for lignes in entetes)
        if hauteur_entete:
            if dessiner:
                cx = x + numero
                for lignes, (_, part) in zip(entetes, colonnes):
                    self.ecrire(cx, y, lignes, 'gras', 9, DISCRET)
                    cx += utile * part / total
            y += 9 * INTERLIGNE * hauteur_entete + 2
        for rang in range(1, int(q['liste']) + 1):
            if dessiner:
                self.ecrire(x, y + 5, [str(rang)], 'normal', 9, DISCRET)
                cx = x + numero
                for i, (libelle, part) in enumerate(colonnes):
                    large = utile * part / total - (0 if i == len(colonnes) - 1 else ecart)
                    self.champ_texte(pymupdf.Rect(cx, y, cx + large, y + 20),
                                     f"{prefixe} {libelle or 'ligne'} {rang}", f"{q['texte']} ({rang})", False)
                    cx += utile * part / total
            y += 24
        return y + 2

    def zone_choix(self, q, prefixe, x, largeur, y, dessiner):
        police = self.polices['normal']
        debut_options = x + max(police.text_length(c['libelle'], fontsize=10) for c in q['choix']) + 16
        for choix in q['choix']:
            if dessiner:
                self.ecrire(x, y, [choix['libelle']], 'normal', 10, ENCRE)
                ox = debut_options
                for option in choix['options']:
                    self.case(ox, y + 0.5, f"{prefixe} {choix['libelle']} {option}", f"{choix['libelle']} : {option}")
                    self.ecrire(ox + 14, y, [option], 'normal', 10, ENCRE)
                    ox += 14 + police.text_length(option, fontsize=10) + 18
            y += 19
        if q.get('champ'):
            y = self.zone_libre(q['champ'], 1, f"{prefixe} {q['champ']}", q['champ'], x, largeur, y + 3, dessiner)
        return y

    def pieds_de_page(self):
        total = len(self.doc)
        police = self.polices['normal']
        for rang, page in enumerate(self.doc, start=1):
            texte = ' · '.join(filter(None, [self.spec.get('piedDePage'), f'page {rang} / {total}']))
            ecrivain = pymupdf.TextWriter(page.rect)
            x = (LARGEUR - police.text_length(texte, fontsize=8)) / 2
            ecrivain.append((x, HAUTEUR - 28), texte, font=police, fontsize=8)
            ecrivain.write_text(page, color=DISCRET)


def construire(spec):
    formulaire = Formulaire(spec)
    formulaire.entete()
    if spec.get('identification'):
        formulaire.identification(spec['identification'])
    for section in spec.get('sections', []):
        questions = section.get('questions', [])
        formulaire.numero += 1
        premiere = formulaire.question(questions[0], dessiner=False) if questions else 0
        formulaire.numero -= 1
        formulaire.titre_section(section['titre'], section.get('note'), premiere)
        for q in questions:
            formulaire.numero += 1
            hauteur = formulaire.question(q, dessiner=False)
            formulaire.reserver(hauteur)
            formulaire.question(q, dessiner=True)
            formulaire.y += hauteur
    formulaire.pieds_de_page()
    formulaire.doc.subset_fonts()
    return formulaire.doc


def main(argv):
    if len(argv) != 3:
        print('Usage : python -I scripts/formulaire_pdf.py questionnaire.json sortie.pdf', file=sys.stderr)
        return 2
    with open(argv[1], encoding='utf-8') as fh:
        spec = json.load(fh)
    doc = construire(spec)
    champs = sum(1 for page in doc for _ in page.widgets())
    pages = len(doc)
    doc.save(argv[2], garbage=3, deflate=True)
    doc.close()
    print(json.dumps({'sortie': os.path.abspath(argv[2]), 'pages': pages, 'champs': champs}, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
