// Mappe le département (2 premiers chiffres du code postal) vers le nom de région
// = nom du groupe salon_groups. Permet d'auto-classer un salon créé à l'unité dans
// sa vraie région sans choix manuel.
import db from './db.js';

const DEPT_TO_REGION = {
  // Île-de-France
  '75':'ile-de-france','77':'ile-de-france','78':'ile-de-france','91':'ile-de-france','92':'ile-de-france','93':'ile-de-france','94':'ile-de-france','95':'ile-de-france',
  // Centre-Val de Loire
  '18':'centre-val-de-loire','28':'centre-val-de-loire','36':'centre-val-de-loire','37':'centre-val-de-loire','41':'centre-val-de-loire','45':'centre-val-de-loire',
  // Bourgogne-Franche-Comté
  '21':'Bourgogne-Franche-Comté','25':'Bourgogne-Franche-Comté','39':'Bourgogne-Franche-Comté','58':'Bourgogne-Franche-Comté','70':'Bourgogne-Franche-Comté','71':'Bourgogne-Franche-Comté','89':'Bourgogne-Franche-Comté','90':'Bourgogne-Franche-Comté',
  // Normandie
  '14':'normandie','27':'normandie','50':'normandie','61':'normandie','76':'normandie',
  // Hauts-de-France
  '02':'hauts-de-france','59':'hauts-de-france','60':'hauts-de-france','62':'hauts-de-france','80':'hauts-de-france',
  // Grand Est
  '08':'grand-est','10':'grand-est','51':'grand-est','52':'grand-est','54':'grand-est','55':'grand-est','57':'grand-est','67':'grand-est','68':'grand-est','88':'grand-est',
  // Pays de la Loire
  '44':'pays-de-la-loire','49':'pays-de-la-loire','53':'pays-de-la-loire','72':'pays-de-la-loire','85':'pays-de-la-loire',
  // Bretagne (groupe nommé "bretagne-cotes-darmor")
  '22':'bretagne-cotes-darmor','29':'bretagne-cotes-darmor','35':'bretagne-cotes-darmor','56':'bretagne-cotes-darmor',
  // Nouvelle-Aquitaine
  '16':'nouvelle-aquitaine','17':'nouvelle-aquitaine','19':'nouvelle-aquitaine','23':'nouvelle-aquitaine','24':'nouvelle-aquitaine','33':'nouvelle-aquitaine','40':'nouvelle-aquitaine','47':'nouvelle-aquitaine','64':'nouvelle-aquitaine','79':'nouvelle-aquitaine','86':'nouvelle-aquitaine','87':'nouvelle-aquitaine',
  // Occitanie
  '09':'occitanie','11':'occitanie','12':'occitanie','30':'occitanie','31':'occitanie','32':'occitanie','34':'occitanie','46':'occitanie','48':'occitanie','65':'occitanie','66':'occitanie','81':'occitanie','82':'occitanie',
  // Auvergne-Rhône-Alpes
  '01':'auvergne-rhone-alpes','03':'auvergne-rhone-alpes','07':'auvergne-rhone-alpes','15':'auvergne-rhone-alpes','26':'auvergne-rhone-alpes','38':'auvergne-rhone-alpes','42':'auvergne-rhone-alpes','43':'auvergne-rhone-alpes','63':'auvergne-rhone-alpes','69':'auvergne-rhone-alpes','73':'auvergne-rhone-alpes','74':'auvergne-rhone-alpes',
  // Provence-Alpes-Côte d'Azur
  '04':'paca','05':'paca','06':'paca','13':'paca','83':'paca','84':'paca',
  // Corse (20xxx, 2A/2B)
  '20':'corse','2a':'corse','2b':'corse',
};

export function regionNameForPostalCode(codePostal) {
  if (!codePostal) return null;
  const cp = String(codePostal).trim().toLowerCase();
  return DEPT_TO_REGION[cp.slice(0, 2)] || null;
}

// Renvoie l'id du groupe salon_groups correspondant à la région du code postal (ou null).
export function regionGroupIdForPostalCode(codePostal) {
  const region = regionNameForPostalCode(codePostal);
  if (!region) return null;
  const g = db.prepare('SELECT id FROM salon_groups WHERE name = ? COLLATE NOCASE').get(region);
  return g ? g.id : null;
}
