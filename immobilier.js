// =====================================================================
//  PRIX DE L'IMMOBILIER — estimation par département, commune (ou
//  arrondissement) et surface, à partir des ventes réellement
//  enregistrées (DVF, DGFiP) de juillet 2024 à juin 2026 : moyenne des
//  prix médians au m² de chaque mois, pondérée par le nombre de ventes.
//  Le fichier prix-m2.json n'est chargé qu'à la première estimation.
//  Alsace-Moselle (57, 67, 68) et Mayotte ne sont pas couverts par DVF.
//  Codes postaux : API Découpage administratif (geo.api.gouv.fr).
//  Loyers : « Carte des loyers » 2025 du ministère du Logement (loyers
//  d'annonce charges comprises au m², par commune ou groupe de communes).
// =====================================================================

export const DEPARTEMENTS = [
  ["01", "Ain"], ["02", "Aisne"], ["03", "Allier"], ["04", "Alpes-de-Haute-Provence"], ["05", "Hautes-Alpes"], ["06", "Alpes-Maritimes"],
  ["07", "Ardèche"], ["08", "Ardennes"], ["09", "Ariège"], ["10", "Aube"], ["11", "Aude"], ["12", "Aveyron"], ["13", "Bouches-du-Rhône"],
  ["14", "Calvados"], ["15", "Cantal"], ["16", "Charente"], ["17", "Charente-Maritime"], ["18", "Cher"], ["19", "Corrèze"],
  ["2A", "Corse-du-Sud"], ["2B", "Haute-Corse"], ["21", "Côte-d'Or"], ["22", "Côtes-d'Armor"], ["23", "Creuse"], ["24", "Dordogne"],
  ["25", "Doubs"], ["26", "Drôme"], ["27", "Eure"], ["28", "Eure-et-Loir"], ["29", "Finistère"], ["30", "Gard"], ["31", "Haute-Garonne"],
  ["32", "Gers"], ["33", "Gironde"], ["34", "Hérault"], ["35", "Ille-et-Vilaine"], ["36", "Indre"], ["37", "Indre-et-Loire"], ["38", "Isère"],
  ["39", "Jura"], ["40", "Landes"], ["41", "Loir-et-Cher"], ["42", "Loire"], ["43", "Haute-Loire"], ["44", "Loire-Atlantique"], ["45", "Loiret"],
  ["46", "Lot"], ["47", "Lot-et-Garonne"], ["48", "Lozère"], ["49", "Maine-et-Loire"], ["50", "Manche"], ["51", "Marne"], ["52", "Haute-Marne"],
  ["53", "Mayenne"], ["54", "Meurthe-et-Moselle"], ["55", "Meuse"], ["56", "Morbihan"], ["57", "Moselle"], ["58", "Nièvre"], ["59", "Nord"],
  ["60", "Oise"], ["61", "Orne"], ["62", "Pas-de-Calais"], ["63", "Puy-de-Dôme"], ["64", "Pyrénées-Atlantiques"], ["65", "Hautes-Pyrénées"],
  ["66", "Pyrénées-Orientales"], ["67", "Bas-Rhin"], ["68", "Haut-Rhin"], ["69", "Rhône"], ["70", "Haute-Saône"], ["71", "Saône-et-Loire"],
  ["72", "Sarthe"], ["73", "Savoie"], ["74", "Haute-Savoie"], ["75", "Paris"], ["76", "Seine-Maritime"], ["77", "Seine-et-Marne"],
  ["78", "Yvelines"], ["79", "Deux-Sèvres"], ["80", "Somme"], ["81", "Tarn"], ["82", "Tarn-et-Garonne"], ["83", "Var"], ["84", "Vaucluse"],
  ["85", "Vendée"], ["86", "Vienne"], ["87", "Haute-Vienne"], ["88", "Vosges"], ["89", "Yonne"], ["90", "Territoire de Belfort"],
  ["91", "Essonne"], ["92", "Hauts-de-Seine"], ["93", "Seine-Saint-Denis"], ["94", "Val-de-Marne"], ["95", "Val-d'Oise"],
  ["971", "Guadeloupe"], ["972", "Martinique"], ["973", "Guyane"], ["974", "La Réunion"], ["976", "Mayotte"],
];

let donnees = null, promesse = null;
export function chargerPrix() {
  if (donnees) return Promise.resolve(donnees);
  promesse ??= fetch("prix-m2.json").then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
    .then((d) => {
      // Index de recherche : [nom normalisé, code INSEE], trié par nom
      d.index = Object.entries(d.communes).map(([code, c]) => [normaliser(c[0]), code]).sort((a, b) => a[0].localeCompare(b[0], "fr"));
      donnees = d; return d;
    })
    .catch((e) => { promesse = null; throw e; });
  return promesse;
}
export const prixCharges = () => donnees;

// Recherche sans accents ni tirets : « st etienne » trouve « Saint-Étienne »
export const normaliser = (t) => String(t ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[-'’]/g, " ").replace(/\bst\b/g, "saint").replace(/\bste\b/g, "sainte").replace(/\s+/g, " ").trim();
const codesPostaux = (c) => (c?.[4] ? c[4].split(" ") : []);
// Libellé affiché : nom et code postal (le ou les premiers s'il y en a plusieurs)
export function libelleCommune(code) {
  const c = donnees?.communes?.[code]; if (!c) return "";
  const cp = codesPostaux(c);
  return cp.length ? `${c[0]} (${cp.slice(0, 2).join(", ")}${cp.length > 2 ? "…" : ""})` : c[0];
}
// Communes qui commencent par le texte tapé (nom, un mot du nom, ou code postal), dans le département choisi s'il y en a un
export function chercherCommunes(texte, departement = null, max = 40) {
  if (!donnees) return [];
  const q = normaliser(texte);
  if (!q) return [];
  const chiffres = /^\d{2,5}$/.test(q);
  const res = [];
  for (const [nom, code] of donnees.index) {
    const c = donnees.communes[code];
    if (departement && c[1] !== departement) continue;
    let score = -1;
    if (chiffres) { if (codesPostaux(c).some((cp) => cp.startsWith(q))) score = 0; }
    else if (nom.startsWith(q)) score = 0;
    else if (nom.includes(" " + q)) score = 1;
    if (score >= 0) res.push([score, code]);
    if (res.length > 400) break;
  }
  return res.sort((a, b) => a[0] - b[0]).slice(0, max).map(([, code]) => ({ code, libelle: libelleCommune(code), dep: donnees.communes[code][1] }));
}
// Code INSEE de la commune choisie (anciens profils : « Nantes (44109) »)
export function codeCommune(lieu) {
  if (lieu?.codeInsee && donnees?.communes?.[lieu.codeInsee]) return lieu.codeInsee;
  const m = String(lieu?.commune ?? "").match(/^(.*)\((\d[\dAB]\d{3})\)\s*$/);
  if (m && donnees?.communes?.[m[2]] && normaliser(donnees.communes[m[2]][0]) === normaliser(m[1])) return m[2];
  return null;
}

// Estimation : prix au m² de la commune si connu, sinon celui du département
export function estimer(lieu) {
  if (!donnees || !lieu?.departement) return null;
  const type = lieu.typeLogement === "maison" ? "maison" : "appartement";
  const i = type === "maison" ? 3 : 2;
  const code = codeCommune(lieu);
  const c = code ? donnees.communes[code] : null;
  const d = donnees.departements[lieu.departement];
  let m2 = c?.[i] ?? null, echelle = "commune";
  if (!m2) { m2 = d?.[type === "maison" ? 2 : 1] ?? null; echelle = "departement"; }
  if (!m2) return { introuvable: true, type };
  const surface = Number(lieu.surface) || 0;
  return { m2, echelle, type, surface, prix: surface > 0 ? Math.round((m2 * surface) / 1000) * 1000 : null, commune: c?.[0] ?? null };
}

// Loyer au m² (charges comprises, annonces) pour la commune, sinon le département.
// Appartement : 1-2 pièces sous 45 m², 3 pièces et plus au-delà.
export function estimerLoyer(lieu, surfaceParDefaut = null) {
  if (!donnees || !lieu?.departement) return null;
  const maison = lieu.typeLogement === "maison";
  const code = codeCommune(lieu);
  const c = code ? donnees.communes[code] : null;
  const surface = Number(lieu.surface) || Number(surfaceParDefaut) || 0;
  let m2 = null, fourchette = null, echelle = "commune";
  if (c) {
    m2 = maison ? c[8] : (surface > 0 ? (surface < 45 ? c[6] : c[7]) : null) ?? c[5];
    fourchette = maison ? c[10] : c[9];
    if (!c[11]) echelle = "groupe";
  }
  if (!m2) { const d = donnees.departements[lieu.departement]; m2 = d?.[maison ? 4 : 3] ?? null; echelle = "departement"; fourchette = null; }
  if (!m2) return null;
  const cc = surface > 0 ? m2 * surface : null;
  return { m2, fourchette, echelle, surface, maison, commune: c?.[0] ?? null,
    chargesComprises: cc ? Math.round(cc / 10) * 10 : null,
    horsCharges: cc ? Math.round((cc * 0.9) / 10) * 10 : null };
}
