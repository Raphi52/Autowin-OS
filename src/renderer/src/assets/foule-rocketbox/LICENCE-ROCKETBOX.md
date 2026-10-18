# Foule du fond d'Accueil — Microsoft Rocketbox

Les personnes (`*.glb` sauf `marches.glb`), leurs textures (`*.webp`) et les marches capturées
(`marches.glb`) de ce dossier viennent de la bibliothèque **Microsoft Rocketbox**,
https://github.com/microsoft/Microsoft-Rocketbox (dossiers `Assets/Avatars` et `Assets/Animations`),
publiée sous la licence MIT ci-dessous.

Modifications faites pour Autowin OS (conv-312, 2026-10-17) :
- FBX convertis en glTF binaire : géométrie indexée, attributs d'éclairage spéculaire retirés, échelle
  0,01 (centimètres → mètres), aucune image intégrée ;
- textures TGA 2048² réduites et ré-encodées en WebP : couleur et cheveux en 1024², reliefs en 512² ;
- marches : pistes d'échelle, de pas (« Footsteps ») et du visage retirées, clés redondantes fusionnées.

Personnes : Male_Adult_04, 07, 09, 10, 12, 17, 18, 20 ; Female_Adult_04, 07, 11, 12, 13 ;
Business_Male_01, Business_Female_04, Security_Female_01 ; les figurants du deal et du fumeur,
Male_Adult_11, 06 et 05 ; et le taggeur du mur tagué, Male_Adult_16 (2026-10-18).
Marches : m/f_walk_neutral_01, m/f_walk_neutral_02, m/f_walk_slow_01, m/f_walk_fast_01.
Gestes (`gestes.glb`, ramenés à 10 images/s, sans les doigts ni le visage) : m_cell_phone_textmessage,
m_gestic_talk_cool, m_gestic_listen_nervous_01, m_documents_take, m_idle_look_around_02,
m_drink_drinking, m_work_mid, m_wave_01.

---

MIT License

Copyright (c) 2020 Microsoft

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
