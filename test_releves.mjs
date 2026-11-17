// Tests de l'import de relevés (CSV / Excel) et du calcul du prix de revient — `node test_releves.mjs` (Node ≥ 18)
// ou import dynamique depuis un navigateur : `(await import("./test_releves.mjs")).terminer()` retourne { ok, echecs }.
// Aucun appel réseau, aucune dépendance : les fichiers .xlsx de test sont fabriqués ici (zip minimal + CompressionStream).
import {
  COMPTES_PRU, TAILLE_MAX_FICHIER, calculerPRU, detecterColonnes, idCompteDepuisLibelle, importerReleveTableau, lireFichierReleve,
  lireNombre, lireReleveColle, lireTableauCsv, lireXlsx, releveDepuisImport, etatReleve, comparerReleve,
} from "./moteur.js";

export const resultats = { ok: 0, echecs: [] };
const verifier = (condition, message) => { if (condition) resultats.ok++; else resultats.echecs.push(message); };
const egal = (a, b, message) => verifier(JSON.stringify(a) === JSON.stringify(b), `${message} — obtenu ${JSON.stringify(a)}, attendu ${JSON.stringify(b)}`);
const proche = (a, b, message, tol = 0.01) => verifier(typeof a === "number" && Math.abs(a - b) <= tol, `${message} — obtenu ${a}, attendu ${b}`);
const octets = (texte) => new TextEncoder().encode(texte);
const refuse = async (promesse, motif, message) => {
  try { await promesse; verifier(false, `${message} : aucune erreur levée`); } catch (e) { verifier(e.message.includes(motif), `${message} : message « ${e.message} »`); }
};

// ---------------------------------------------------------------- nombres
egal(lireNombre("12 345,67 €"), 12345.67, "français avec espace et €");
egal(lireNombre("12 345,67"), 12345.67, "espace insécable");
egal(lireNombre("1.234,56"), 1234.56, "point de milliers + virgule");
egal(lireNombre("1,234.56"), 1234.56, "virgule de milliers + point");
egal(lireNombre("12345.67"), 12345.67, "point décimal");
egal(lireNombre("1.234"), 1234, "1.234 = mille deux cent trente-quatre");
egal(lireNombre("(250,00)"), -250, "négatif entre parenthèses");
egal(lireNombre("−12,5"), -12.5, "signe moins typographique");
egal(lireNombre(42), 42, "nombre natif");
egal(lireNombre("Livret A"), null, "texte");
egal(lireNombre("15/01/2025"), null, "date");
egal(lireNombre(""), null, "vide");

// ---------------------------------------------------------------- comptes
egal(idCompteDepuisLibelle("PEA-PME Boursorama"), "peaPme", "PEA-PME");
egal(idCompteDepuisLibelle("PEA Trade Republic"), "pea", "PEA");
egal(idCompteDepuisLibelle("Compte-titres ordinaire"), "cto", "CTO");
egal(idCompteDepuisLibelle("Assurance-vie Linxea Spirit (fonds euros)"), "assuranceVie", "assurance-vie");
egal(idCompteDepuisLibelle("Assurance vie – unités de compte"), "assuranceVieUC", "assurance-vie UC");
egal(idCompteDepuisLibelle("PER individuel"), "per", "PER");
egal(idCompteDepuisLibelle("Opération diverse"), null, "libellé inconnu");
verifier(COMPTES_PRU.includes("peaPme") && COMPTES_PRU.length === 6, "peaPme dans COMPTES_PRU");

// ---------------------------------------------------------------- CSV
egal(lireTableauCsv("﻿A;B;C\r\n1;\"x;y\";3\r\n\r\n"), [["A", "B", "C"], ["1", "x;y", "3"]], "CSV point-virgule, BOM, guillemets, ligne vide");
egal(lireTableauCsv('Support,Valorisation\n"Fonds euro","12 345,67"\n"Mon ""PEA""","1,5"'), [["Support", "Valorisation"], ["Fonds euro", "12 345,67"], ['Mon "PEA"', "1,5"]], "CSV virgule, guillemets doublés");
egal(lireTableauCsv("Compte\tSolde\nPEA\t100"), [["Compte", "Solde"], ["PEA", "100"]], "CSV tabulation");
egal(lireTableauCsv("a;b\n\"ligne 1\nligne 2\";2").length, 2, "retour à la ligne dans une cellule");

// ---------------------------------------------------------------- détection des colonnes et import
const BOURSO = "Libellé;Solde;Versements cumulés\nPEA;31 250,40 €;27 000,00 €\nCompte-titres;5 000;4 200\nAssurance vie fonds euros;25 000;22 000\nLivret A;12 345,67;\nTOTAL;73 596,07;\nVirement salaire;1 800;";
let r = importerReleveTableau(lireTableauCsv(BOURSO));
verifier(r.ok, "BoursoBank : import");
egal(r.colonnes, { libelle: "Libellé", solde: "Solde", verse: "Versements cumulés" }, "BoursoBank : colonnes détectées");
egal(r.comptes.pea, { solde: 31250.4, verse: 27000 }, "BoursoBank : PEA");
egal(r.comptes.cto, { solde: 5000, verse: 4200 }, "BoursoBank : CTO");
egal(r.comptes.livretA, { solde: 12345.67, verse: null }, "BoursoBank : versement manquant = inconnu");
egal(r.ignores, ["TOTAL", "Virement salaire"], "BoursoBank : lignes ignorées");

const LINXEA = '"Support","Valorisation","Montant investi"\n"Assurance-vie Linxea Spirit (fonds euros)","10 000,00","9 000,00"\n"Assurance-vie Linxea Spirit (unités de compte)","20 500,50","18 000"\n"PER Linxea","8 000","7 500"';
r = importerReleveTableau(lireTableauCsv(LINXEA));
egal(r.colonnes.verse, "Montant investi", "Linxea : colonne du capital investi");
egal(r.comptes.assuranceVie, { solde: 10000, verse: 9000 }, "Linxea : fonds euros");
egal(r.comptes.assuranceVieUC, { solde: 20500.5, verse: 18000 }, "Linxea : UC");
egal(r.comptes.per, { solde: 8000, verse: 7500 }, "Linxea : PER");

const FORTUNEO = "Export du 15/01/2026\nCompte client 123456\n\nIntitulé du compte;Encours;Date\nPEA Fortuneo;18 000,00;15/01/2026\nPEA-PME Fortuneo;4 000,00;15/01/2026\nCTO Fortuneo;2 500,00;15/01/2026";
r = importerReleveTableau(lireTableauCsv(FORTUNEO));
verifier(r.ok && r.colonnes.solde === "Encours", "Fortuneo : en-tête après un préambule");
egal(Object.keys(r.comptes).sort(), ["cto", "pea", "peaPme"], "Fortuneo : comptes reconnus");
let rel = releveDepuisImport(r.comptes);
egal(rel.montants, { pea: 22000, cto: 2500 }, "PEA-PME comptabilisé avec le PEA dans les soldes");
egal(rel.pru.peaPme, { solde: 4000 }, "PEA-PME : solde conservé pour le PRU");

r = importerReleveTableau(lireTableauCsv("PEA;1 000,50\nLivret A;200"));
verifier(r.ok && r.devine, "sans en-tête : colonnes devinées");
egal(r.comptes.pea.solde, 1000.5, "sans en-tête : PEA");
verifier(!importerReleveTableau(lireTableauCsv("juste;du;texte\nrien;a;voir")).ok, "fichier inexploitable refusé");
egal(detecterColonnes([["Libellé", "Solde"]])?.colonnes, { libelle: 0, solde: 1, verse: null }, "detecterColonnes");

// ---------------------------------------------------------------- relevé collé (non-régression)
const colle = lireReleveColle("Livret A ; 12 345,67\nLDDS ; 8 100\nPEA Trade Republic ; 31 250,40 €\nPEA-PME ; 1 000\nAssurance vie fonds euros ; 25 000\nn'importe quoi");
egal(colle.montants, { livretA: 12345.67, ldds: 8100, pea: 32250.4, assuranceVie: 25000 }, "lireReleveColle (PEA-PME rangé avec le PEA)");
egal(colle.ignores, ["n'importe quoi"], "lireReleveColle : lignes ignorées");

// ---------------------------------------------------------------- fichiers : encodage, taille, formats
r = await lireFichierReleve("export.csv", octets(BOURSO));
egal(r.comptes.pea.solde, 31250.4, "lireFichierReleve CSV UTF-8");
r = await lireFichierReleve("export.csv", Uint8Array.from([..."Libell", 0xe9, ..." ;Solde\nPEA;100\n"].map((c) => (typeof c === "number" ? c : c.charCodeAt(0)))));
egal(r.colonnes.libelle, "Libellé", "lireFichierReleve CSV Windows-1252 (é = 0xE9)");
await refuse(lireFichierReleve("gros.csv", new Uint8Array(TAILLE_MAX_FICHIER + 1)), "2 Mo", "fichier de plus de 2 Mo");
await refuse(lireFichierReleve("vide.csv", new Uint8Array(0)), "vide", "fichier vide");
await refuse(lireFichierReleve("ancien.xls", octets("x")), ".xlsx", "ancien format .xls");
await refuse(lireFichierReleve("image.png", octets("x")), "Format non pris en charge", "extension inconnue");
await refuse(lireFichierReleve("faux.xlsx", octets("pas un zip")), "pas un classeur", "faux .xlsx");
await refuse(lireFichierReleve("vide.xlsx", Uint8Array.from([0x50, 0x4b, 0, 0, 0, 0])), "pas un classeur", ".xlsx tronqué");

// ---------------------------------------------------------------- .xlsx fabriqué sur place
const TABLE_CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = TABLE_CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
async function deflater(b) {
  const flux = new Blob([b]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(flux).arrayBuffer());
}
async function fabriquerZip(fichiers, { methode = 8 } = {}) {
  const locaux = [], centraux = []; let pos = 0;
  for (const [nom, texte] of Object.entries(fichiers)) {
    const brut = octets(texte), donnees = methode === 8 ? await deflater(brut) : brut, n = octets(nom);
    const loc = new Uint8Array(30 + n.length + donnees.length), v = new DataView(loc.buffer);
    v.setUint32(0, 0x04034b50, true); v.setUint16(4, 20, true); v.setUint16(8, methode, true); v.setUint32(14, crc32(brut), true);
    v.setUint32(18, donnees.length, true); v.setUint32(22, brut.length, true); v.setUint16(26, n.length, true);
    loc.set(n, 30); loc.set(donnees, 30 + n.length);
    const cen = new Uint8Array(46 + n.length), c = new DataView(cen.buffer);
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(10, methode, true); c.setUint32(16, crc32(brut), true);
    c.setUint32(20, donnees.length, true); c.setUint32(24, brut.length, true); c.setUint16(28, n.length, true); c.setUint32(42, pos, true);
    cen.set(n, 46);
    locaux.push(loc); centraux.push(cen); pos += loc.length;
  }
  const tailleCentral = centraux.reduce((s, x) => s + x.length, 0);
  const fin = new Uint8Array(22), f = new DataView(fin.buffer);
  f.setUint32(0, 0x06054b50, true); f.setUint16(8, centraux.length, true); f.setUint16(10, centraux.length, true); f.setUint32(12, tailleCentral, true); f.setUint32(16, pos, true);
  const out = new Uint8Array(pos + tailleCentral + 22); let p = 0;
  for (const part of [...locaux, ...centraux, fin]) { out.set(part, p); p += part.length; }
  return out;
}
const FICHIERS_XLSX = {
  "[Content_Types].xml": '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
  "xl/workbook.xml": '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Feuil" sheetId="1" r:id="rId7"/></sheets></workbook>',
  "xl/_rels/workbook.xml.rels": '<Relationships><Relationship Id="rId7" Type="x" Target="worksheets/sheet3.xml"/></Relationships>',
  "xl/sharedStrings.xml": '<sst><si><t>Libellé</t></si><si><t>Solde</t></si><si><t>Versements cumulés</t></si><si><t>PEA</t></si><si><r><t>Assurance </t></r><r><t>vie &amp; fonds euros</t></r></si></sst>',
  "xl/worksheets/sheet3.xml": '<worksheet><sheetData>'
    + '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>'
    + '<row r="2"><c r="A2" t="s"><v>3</v></c><c r="B2"><v>31250.4</v></c><c r="C2"><v>27000</v></c></row>'
    + '<row r="3"/>'
    + '<row r="4"><c r="A4" t="s"><v>4</v></c><c r="B4"><v>25000</v></c><c r="C4" s="2"/></row>'
    + '<row r="5"><c r="A5" t="inlineStr"><is><t>CTO</t></is></c><c r="B5"><v>5000</v></c><c r="D5"><v>1</v></c></row>'
    + '</sheetData></worksheet>',
};
for (const methode of [8, 0]) {
  const zip = await fabriquerZip(FICHIERS_XLSX, { methode });
  const lignes = await lireXlsx(zip);
  egal(lignes[0], ["Libellé", "Solde", "Versements cumulés"], `xlsx (méthode ${methode}) : en-têtes via chaînes partagées`);
  egal(lignes[1], ["PEA", 31250.4, 27000], `xlsx (méthode ${methode}) : nombres natifs`);
  egal(lignes[2][0], "Assurance vie & fonds euros", `xlsx (méthode ${methode}) : texte riche et entités XML`);
  egal(lignes[3], ["CTO", 5000, "", 1], `xlsx (méthode ${methode}) : texte en ligne, cellule vide, colonne D`);
  r = await lireFichierReleve("releve.XLSX", zip);
  egal(r.comptes, { pea: { solde: 31250.4, verse: 27000 }, assuranceVie: { solde: 25000, verse: null }, cto: { solde: 5000, verse: null } }, `xlsx (méthode ${methode}) : import complet`);
}
{ // archive piégée : une entrée qui annonce plus de 20 Mo décompressés
  const zip = await fabriquerZip(FICHIERS_XLSX, { methode: 0 });
  const v = new DataView(zip.buffer);
  let p = v.getUint32(zip.length - 22 + 16, true), modifiees = 0;
  for (let i = 0; i < Object.keys(FICHIERS_XLSX).length; i++) { // répertoire central : on gonfle la taille annoncée de « xl/workbook.xml »
    const nom = new TextDecoder().decode(zip.subarray(p + 46, p + 46 + v.getUint16(p + 28, true)));
    if (nom === "xl/workbook.xml") { v.setUint32(p + 24, 30 * 1024 * 1024, true); modifiees++; }
    p += 46 + v.getUint16(p + 28, true) + v.getUint16(p + 30, true) + v.getUint16(p + 32, true);
  }
  egal(modifiees, 1, "préparation de l'archive piégée");
  await refuse(lireXlsx(zip), "trop volumineux", "archive piégée (taille décompressée annoncée)");
}

// ---------------------------------------------------------------- prix de revient et plus-values latentes
const R = (date, placements, pru) => ({ date, placements, total: Object.values(placements).reduce((s, x) => s + x, 0), ...(pru ? { pru } : {}) });
const parId = (res) => Object.fromEntries(res.comptes.map((c) => [c.id, c]));
{ // capital estimé : solde initial + versements programmés
  const res = calculerPRU([R("2025-01", { pea: 10000 }), R("2025-07", { pea: 13500 })], { pea: 500 });
  const c = parId(res).pea;
  proche(c.verse, 13000, "PRU estimé : capital = 10 000 + 6 × 500"); proche(c.pv, 500, "PRU estimé : plus-value"); proche(c.pvPct, 3.846, "PRU estimé : %", 0.01);
  verifier(c.estime, "PRU estimé : marqué estimation");
  verifier(res.total.estime && res.total.complet, "total : estimé et complet");
}
{ // capital déclaré au dernier relevé
  const c = parId(calculerPRU([R("2025-01", { pea: 10000 }), R("2025-07", { pea: 13000 }, { pea: { verse: 11000 } })], { pea: 500 })).pea;
  proche(c.verse, 11000, "capital déclaré utilisé tel quel"); proche(c.pv, 2000, "plus-value déclarée"); proche(c.pvPct, 18.18, "% déclaré", 0.01); verifier(!c.estime, "capital déclaré : pas une estimation");
}
{ // capital déclaré au 1er relevé seulement : prolongé par les versements programmés
  const c = parId(calculerPRU([R("2025-01", { cto: 10000 }, { cto: { verse: 9000 } }), R("2025-07", { cto: 13000 })], { cto: 500 })).cto;
  proche(c.verse, 12000, "capital déclaré + 6 mois de versements"); proche(c.pv, 1000, "plus-value"); verifier(c.estime, "marqué estimation");
}
{ // un seul relevé sans capital : gain inconnu, jamais inventé
  const res = calculerPRU([R("2025-01", { pea: 10000 })], { pea: 500 });
  egal([res.comptes[0].pv, res.comptes[0].verse, res.total], [null, null, null], "un seul relevé non déclaré : plus-value inconnue");
}
{ // PEA et PEA-PME séparés ; moins-value ; comptes non concernés ignorés
  const res = calculerPRU([R("2025-03", { pea: 15000, livretA: 5000, per: 3000 }, { peaPme: { solde: 5000, verse: 6000 }, pea: { verse: 8000 }, per: { verse: 3500 } })]);
  const m = parId(res);
  egal(res.comptes.map((c) => c.id), ["pea", "peaPme", "per"], "comptes suivis : PEA, PEA-PME, PER (pas le Livret A)");
  proche(m.pea.solde, 10000, "PEA = placements.pea − solde PEA-PME"); proche(m.pea.pv, 2000, "PEA : plus-value");
  proche(m.peaPme.pv, -1000, "PEA-PME : moins-value"); proche(m.peaPme.pvPct, -16.67, "PEA-PME : %", 0.01);
  proche(m.per.pv, -500, "PER : moins-value");
  proche(res.total.pv, 500, "total des plus et moins-values"); verifier(res.total.complet && !res.total.estime, "total : complet, non estimé");
}
egal(calculerPRU([], {}), { comptes: [], total: null }, "aucun relevé");
egal(calculerPRU([R("2025-01", { pea: 0, livretA: 100 })], {}).comptes, [], "compte vide ignoré");

// ---- Relevé attendu / en retard (etatReleve)
egal(etatReleve([], 3, "2026-11"), { dernier: null, prochain: "2026-11", du: true, retardMois: 0 }, "etatReleve : aucun relevé");
egal(etatReleve(undefined, 3, "2026-11").du, true, "etatReleve : undefined");
egal(etatReleve([{ date: "2026-08" }], 3, "2026-11"), { dernier: "2026-08", prochain: "2026-11", du: true, retardMois: 0 }, "etatReleve : dû ce mois-ci");
egal(etatReleve([{ date: "2026-06" }], 3, "2026-11"), { dernier: "2026-06", prochain: "2026-09", du: true, retardMois: 2 }, "etatReleve : en retard de 2 mois");
egal(etatReleve([{ date: "2026-10" }], 3, "2026-11"), { dernier: "2026-10", prochain: "2027-01", du: false, retardMois: 0 }, "etatReleve : changement d'année, non dû");
egal(etatReleve([{ date: "2026-09" }, { date: "2025-01" }], 3, "2026-11").dernier, "2026-09", "etatReleve : relevés non triés");
egal(etatReleve([{ date: "2026-06" }], 0, "2026-11").prochain, "2026-09", "etatReleve : fréquence 0 → 3");
egal(etatReleve([{ date: "2026-06" }], NaN, "2026-11").prochain, "2026-09", "etatReleve : fréquence NaN → 3");

// ---- Comparaison d'un relevé en saisie (comparerReleve)
{
  const id = comparerReleve({ pea: 20000, livretA: 5000 }, { pea: 20000, livretA: 5000 });
  egal([id.nbAVerifier, id.ecartTotal, id.nbChanges], [0, 0, 0], "comparerReleve : montants identiques");
  const v = comparerReleve({ livretA: 10000 }, { livretA: 0 });
  egal([v.lignes[0].aVerifier, v.lignes[0].motif], [true, "compte vidé"], "comparerReleve : compte vidé");
  const b = comparerReleve({ pea: 20000 }, { pea: 9000 });
  egal([b.lignes[0].aVerifier, b.lignes[0].motif, b.lignes[0].ecartPct], [true, "variation de \u221255 %", -55], "comparerReleve : baisse de 55 %");
  const h = comparerReleve({ pea: 20000 }, { pea: 21000 });
  egal(h.lignes[0].aVerifier, false, "comparerReleve : hausse de 5 % sans alerte");
  const n = comparerReleve({}, { pea: 5000 });
  egal([n.lignes[0].ecartPct, n.lignes[0].aVerifier], [null, false], "comparerReleve : nouveau compte");
  const p = comparerReleve({ livret: 500 }, { livret: 0 });
  egal(p.lignes[0].aVerifier, false, "comparerReleve : petit livret vidé, sous le seuil");
  for (const x of [-5, "abc"]) {
    const i = comparerReleve({ pea: 100 }, { pea: x });
    egal([i.lignes[0].motif, i.lignes[0].apres, i.totalApres], ["montant invalide", 0, 0], `comparerReleve : montant invalide ${x}`);
  }
  const t = comparerReleve({ a: 1000, b: 5000, c: 200 }, { a: 1100, b: 4000, c: 200 });
  egal(t.lignes.map((l) => l.id), ["b", "a", "c"], "comparerReleve : tri par écart décroissant");
  egal([t.totalAvant, t.totalApres, t.ecartTotal, t.nbChanges], [6200, 5300, -900, 2], "comparerReleve : totaux");
}

export function terminer() {
  console.log(resultats.echecs.length ? `ÉCHECS (${resultats.echecs.length}) :\n- ${resultats.echecs.join("\n- ")}\n${resultats.ok} vérifications réussies.` : `OK : ${resultats.ok} vérifications réussies.`);
  return resultats;
}
if (typeof process !== "undefined" && process.argv?.[1]?.endsWith("test_releves.mjs")) { terminer(); if (resultats.echecs.length) process.exitCode = 1; }
