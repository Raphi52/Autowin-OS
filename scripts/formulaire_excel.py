"""Fabrique le classeur Excel de compilation d'un questionnaire (conv-1968) : une ligne par personne
interrogée, une colonne par question, tiré du même JSON que scripts/formulaire_pdf.py.

Usage : python -I scripts/formulaire_excel.py questionnaire.json sortie.xlsx [--lignes 50]
Sortie : une ligne JSON {sortie, colonnes, lignes}.

Colonnes, dans l'ordre :
  - un champ d'identification par colonne (« Date » au format jj/mm/aaaa) ;
  - une colonne par question, numérotée comme dans le PDF. Une question à plusieurs réponses en prend une
    par réponse : "parties" -> une par partie ; "choix" -> une par choix, avec une liste déroulante de ses
    options (Oui / Non…), plus une pour "champ".
Le tableau est un vrai tableau Excel (filtres, lignes alternées), en-tête figé, texte renvoyé à la ligne.
"""
import json
import math
import os
import sys

from openpyxl import Workbook
from openpyxl.styles import Alignment
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.worksheet.table import Table, TableStyleInfo

LARGEUR_IDENTITE, LARGEUR_CHOIX, LARGEUR_CHAMP, LARGEUR_QUESTION = 16, 16, 28, 45
COLONNES_FIGEES = 4      # les premières colonnes d'identification restent visibles en défilant


def colonnes(spec):
    """Rend la liste des colonnes : {entete, largeur, options (liste déroulante) ou None, date}."""
    resultat = []
    for champ in (spec.get('identification') or {}).get('champs', []):
        resultat.append({'entete': champ, 'largeur': LARGEUR_IDENTITE, 'options': None,
                         'date': champ.strip().lower() == 'date'})
    numero = 0
    for section in spec.get('sections', []):
        for q in section.get('questions', []):
            numero += 1
            texte = f"{numero}. {q['texte']}"
            if 'parties' in q:
                for partie in q['parties']:
                    resultat.append({'entete': f"{texte} — {partie.get('libelle', '')}".rstrip(' —'),
                                     'largeur': LARGEUR_QUESTION, 'options': None, 'date': False})
            elif 'choix' in q:
                for choix in q['choix']:
                    resultat.append({'entete': f"{numero}. {choix['libelle']}", 'largeur': LARGEUR_CHOIX,
                                     'options': list(choix['options']), 'date': False})
                if q.get('champ'):
                    resultat.append({'entete': f"{numero}. {q['champ']}", 'largeur': LARGEUR_CHAMP,
                                     'options': None, 'date': False})
            else:
                resultat.append({'entete': texte, 'largeur': LARGEUR_QUESTION, 'options': None, 'date': False})
    entetes = [c['entete'] for c in resultat]
    doublons = sorted({e for e in entetes if entetes.count(e) > 1})
    if doublons:
        raise ValueError(f'colonnes en double (un tableau Excel les refuse) : {doublons}')
    return resultat


def construire(spec, lignes=50):
    cols = colonnes(spec)
    if not cols:
        raise ValueError('questionnaire sans identification ni question : aucune colonne à créer')
    classeur = Workbook()
    feuille = classeur.active
    feuille.title = 'Réponses'
    haut = Alignment(wrap_text=True, vertical='top')
    for rang, colonne in enumerate(cols, start=1):
        lettre = get_column_letter(rang)
        cellule = feuille.cell(row=1, column=rang, value=colonne['entete'])
        cellule.alignment = haut
        feuille.column_dimensions[lettre].width = colonne['largeur']
        for ligne in range(2, lignes + 2):
            donnee = feuille.cell(row=ligne, column=rang)
            donnee.alignment = haut
            if colonne['date']:
                donnee.number_format = 'DD/MM/YYYY'
        if colonne['options']:
            # Une liste déroulante par colonne de choix ; une valeur hors liste reste permise mais signalée.
            liste = DataValidation(type='list', formula1='"' + ','.join(colonne['options']) + '"',
                                   allow_blank=True, showErrorMessage=True, errorStyle='warning')
            liste.add(f'{lettre}2:{lettre}{lignes + 1}')
            feuille.add_data_validation(liste)
    # Hauteur d'en-tête : assez de lignes pour l'en-tête le plus long une fois renvoyé à la ligne.
    lignes_entete = max(math.ceil(len(c['entete']) / max(c['largeur'] - 2, 1)) for c in cols)
    feuille.row_dimensions[1].height = 15 * max(lignes_entete, 1) + 4
    tableau = Table(displayName='Reponses', ref=f'A1:{get_column_letter(len(cols))}{lignes + 1}')
    tableau.tableStyleInfo = TableStyleInfo(name='TableStyleMedium2', showRowStripes=True)
    feuille.add_table(tableau)
    figees = min(COLONNES_FIGEES, len((spec.get('identification') or {}).get('champs', [])))
    feuille.freeze_panes = feuille.cell(row=2, column=figees + 1)
    return classeur


def main(argv):
    arguments = argv[1:]
    lignes = 50
    if '--lignes' in arguments:
        i = arguments.index('--lignes')
        lignes = int(arguments[i + 1])
        del arguments[i:i + 2]
    if len(arguments) != 2:
        print('Usage : python -I scripts/formulaire_excel.py questionnaire.json sortie.xlsx [--lignes 50]',
              file=sys.stderr)
        return 2
    source, sortie = arguments
    with open(source, encoding='utf-8') as fh:
        spec = json.load(fh)
    classeur = construire(spec, lignes)
    classeur.save(sortie)
    nombre = classeur.active.max_column
    print(json.dumps({'sortie': os.path.abspath(sortie), 'colonnes': nombre, 'lignes': lignes},
                     ensure_ascii=False))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
