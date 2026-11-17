import { decomposerSalaire, foyerFiscal, revenuImposableSalaires, microEntreprise, remunerationSociete, optimiserRemuneration, plafondPERIndependant } from "./fiscal.js";
import { projetLocatifDe } from "./locatif.js";
// =====================================================================
//  MOTEUR — applique PLAN à un profil. Aucune valeur financière ici.
//  Allocation : 1 sécurité → 2 paliers → 3 âge → 4 apport → 5 comptes
//  Puis : rééquilibrage progressif des placements existants,
//         âge idéal d'achat de la résidence principale.
// =====================================================================

const FORMAT_EUR = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const FORMAT_NB = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });
const eur = (x) => FORMAT_EUR.format(x);
const pct = (x) => `${FORMAT_NB.format(Math.round(x * 10) / 10)} %`;
const somme = (o) => Object.values(o ?? {}).reduce((s, x) => s + (Number(x) || 0), 0);

// ------------------------------------------------------------- foyer
// Ramène un couple à un profil « foyer » : âge de référence, salaires
// additionnés, PEA cumulés, plafond PER du foyer. Sans couple : inchangé.
// Hausse annuelle du salaire du foyer sur les 10 prochaines années (en %) :
// déduite du « salaire dans 10 ans » saisi, sinon l'hypothèse du plan.
// Évolution de carrière : hausse du salaire AU-DESSUS de l'inflation, selon l'âge
export function carriereDe(plan, profil) {
  const C = plan.carrieres ?? {};
  return C[profil.carriere] ?? C[C.defaut] ?? { phases: [[99, 0]] };
}
export function hausseReelle(carriere, age) {
  for (const [jusqua, reel] of carriere.phases ?? []) if (age < jusqua) return reel;
  return 0;
}
// Salaire dans y ans / salaire d'aujourd'hui, inflation comprise
export function facteurCarriere(plan, profil, y, age0 = profil.agePrincipal ?? profil.age ?? 30) {
  const infl = (plan.hypotheses?.inflation ?? 0) / 100, c = carriereDe(plan, profil);
  let f = 1;
  for (let k = 0; k < y; k++) f *= 1 + infl + hausseReelle(c, age0 + k) / 100;
  return f;
}
// Avec un « salaire dans 10 ans » saisi : hausse du foyer sur 10 ans qui y mène
function hausseSur10Ans(plan, p, c) {
  if (!(p.salaireDans10Ans > 0)) return null;
  const s = p.salaireNetMensuel ?? 0, cs = c ? c.salaireNetMensuel ?? 0 : 0;
  const t0 = s + cs, t10 = p.salaireDans10Ans + cs * facteurCarriere(plan, p, 10, c?.age ?? p.age);
  return t0 > 0 && t10 > 0 ? (Math.pow(t10 / t0, 0.1) - 1) * 100 : null;
}
// Salaire dans y ans / salaire d'aujourd'hui : profil de carrière, ou salaire espéré dans 10 ans puis carrière
export function facteurSalaire(plan, profil, y) {
  const age0 = profil.agePrincipal ?? profil.age ?? 30;
  if (profil.hausseSalaire10 == null) return facteurCarriere(plan, profil, y, age0);
  const g1 = profil.hausseSalaire10 / 100;
  return y <= 10 ? Math.pow(1 + g1, y) : Math.pow(1 + g1, 10) * facteurCarriere(plan, profil, y - 10, age0 + 10);
}

export function normaliserFoyer(plan, p) {
  if (p._foyer) return p;
  // Concubinage, calcul « pour toi seul » : ton salaire, ton épargne, tes placements (impôts séparés de toute façon)
  if (p.foyer?.actif && p.foyer.statut === "concubin" && p.foyer.vue === "moi") return normaliserFoyer(plan, { ...p, foyer: { ...p.foyer, actif: false } });
  const c = p.foyer?.actif ? p.conjoint ?? {} : null;
  if (!c) return { ...p, _foyer: true, personnes: 1, couple: false, agePrincipal: p.age, ageEmprunteur: p.age, peaPrincipal: p.pea, hausseSalaire10: hausseSur10Ans(plan, p, null), jeune: (p.age ?? 99) <= 25 };
  const age1 = p.age ?? 0, age2 = c.age > 0 ? c.age : age1;
  const ageRef = plan.foyer?.ageReference === "plus-age" ? Math.max(age1, age2) : Math.round((age1 + age2) / 2);
  const peas = [p.pea, c.pea].filter((x) => x?.ouvert);
  const dates = peas.map((x) => x.dateOuverture).filter(Boolean).sort();
  const marie = p.foyer.statut !== "concubin";
  const estimPER = (sal) => plafondPEREstime(plan, sal);
  const perPrincipal = plafondPERIndependantDe(plan, p) ?? estimPER(p.salaireNetMensuel);
  return {
    ...p, _foyer: true, personnes: 2, couple: true, marie, hausseSalaire10: hausseSur10Ans(plan, p, c), jeune: age1 <= 25 || age2 <= 25,
    age: ageRef, agePrincipal: age1, ageConjoint: age2, ageEmprunteur: Math.max(age1, age2),
    salaireNetMensuel: (p.salaireNetMensuel ?? 0) + (c.salaireNetMensuel ?? 0),
    // Concubinage : chacun a son budget, le foyer épargne la somme des deux. Mariés : épargne et dépenses saisies pour le foyer.
    ...(marie ? {} : { epargneMensuelle: (p.epargneMensuelle ?? 0) + (Number(c.epargneMensuelle) || 0), depensesMensuelles: (p.depensesMensuelles ?? 0) + (Number(c.depensesMensuelles) || 0) }),
    peaPrincipal: p.pea,
    pea: { ouvert: peas.length > 0, versements: peas.reduce((s, x) => s + (x.versements ?? 0), 0), dateOuverture: dates[dates.length - 1], etablissement: p.pea?.etablissement },
    // Marié ou pacsé : plafonds PER mutualisables ; concubinage : seul celui de la personne qui verse
    plafondPEREstime: marie ? perPrincipal + estimPER(c.salaireNetMensuel) : perPrincipal,
  };
}

// ------------------------------------------------------------- outils
export function capitalDe(profil) {
  return profil.placements ? somme(profil.placements) : profil.capital ?? 0;
}

// ------------------------------------------------------------- allocation en 3 familles (niveau Débutant)
// Simple regroupement d'affichage des classes d'actifs de l'allocation cible : il ne change aucun calcul.
export const FAMILLES_ALLOCATION = [
  { id: "abri", libelle: "À l'abri", classes: ["securite", "projet"] },
  { id: "prudent", libelle: "Prudent", classes: ["prudent", "or"] },
  { id: "dynamique", libelle: "Dynamique", classes: ["bourse", "bitcoin", "scpi"] },
];
/** [{ id, libelle, classes, montant, part }] : montant = somme des classes de la famille, part = % du total de l'allocation. */
export function grouperAllocation(alloc) {
  const total = FAMILLES_ALLOCATION.reduce((t, f) => t + f.classes.reduce((s, c) => s + (Number(alloc?.[c]) || 0), 0), 0);
  return FAMILLES_ALLOCATION.map((f) => {
    const montant = f.classes.reduce((s, c) => s + (Number(alloc?.[c]) || 0), 0);
    return { ...f, montant, part: total > 0 ? (100 * montant) / total : 0 };
  });
}

// ------------------------------------------------------------- placements regroupés (niveau Débutant)
// Le débutant saisit 4 montants ; le détail compte par compte en découle. « autres » est trop hétérogène : lecture seule.
export const GROUPES_PLACEMENTS = {
  livrets: ["livretA", "ldds", "lep", "livretJeune", "livretBancaire"],
  assuranceVie: ["assuranceVie", "assuranceVieUC"],
  bourse: ["pea", "cto"],
  autres: ["per", "scpi", "orPhysique", "plateformeCrypto", "coldWallet", "epargneSalariale", "pel"],
};
const GROUPES_MODIFIABLES = ["livrets", "assuranceVie", "bourse"];
const TOLERANCE_GROUPE = 1; // € : écart d'arrondi toléré entre le détail saisi et la répartition automatique

/** Somme des comptes d'un groupe (0 si le groupe est inconnu). */
export function totalGroupe(placements, groupe) {
  return (GROUPES_PLACEMENTS[groupe] ?? []).reduce((s, id) => s + (Number(placements?.[id]) || 0), 0);
}

// Couple (calcul à deux) : les plafonds « par personne » sont doublés, comme dans repartirEnEnveloppes
const nbPersonnes = (profil) => (profil?.foyer?.actif && !(profil.foyer.statut === "concubin" && profil.foyer.vue === "moi") ? 2 : 1);
const plafondCompte = (plan, id, personnes) => { const e = plan.enveloppes?.[id]; return e?.plafond == null ? Infinity : e.plafond * (e.parPersonne ? personnes : 1); };

/**
 * Répartition automatique et prudente d'un montant dans un groupe, sans muter `placements`.
 * - livrets : Livret A jusqu'à son plafond, puis LDDS, puis livret bancaire (LEP et Livret Jeune : conditions d'éligibilité, jamais automatiques) ;
 * - assuranceVie : tout en fonds euros ; - bourse : PEA jusqu'à son plafond de versements, le surplus en compte-titres.
 * Les autres comptes du groupe sont remis à 0 ; un montant négatif ou invalide vaut 0. Groupe « autres » ou inconnu : copie inchangée.
 */
export function repartirGroupe(plan, groupe, montant, placements = {}, profil = {}) {
  const r = { ...placements };
  if (!GROUPES_MODIFIABLES.includes(groupe)) return r;
  const m = Number.isFinite(Number(montant)) ? Math.max(0, Math.round(Number(montant))) : 0;
  const n = nbPersonnes(profil);
  for (const id of GROUPES_PLACEMENTS[groupe]) r[id] = 0;
  if (groupe === "livrets") {
    r.livretA = Math.min(m, plafondCompte(plan, "livretA", n));
    r.ldds = Math.min(m - r.livretA, plafondCompte(plan, "ldds", n));
    r.livretBancaire = m - r.livretA - r.ldds;
  } else if (groupe === "assuranceVie") {
    r.assuranceVie = m;
  } else {
    r.pea = Math.min(m, plafondCompte(plan, "pea", n));
    r.cto = m - r.pea;
  }
  return r;
}

/**
 * Vrai si le détail du groupe saisi compte par compte s'écarte de la répartition automatique de son total :
 * la case débutant est alors en lecture seule. Un détail identique à ce que produirait le débutant (Livret A plein + LDDS) reste modifiable.
 */
export function groupePersonnalise(plan, placements, groupe, profil = {}) {
  if (!GROUPES_MODIFIABLES.includes(groupe)) return false;
  const auto = repartirGroupe(plan, groupe, totalGroupe(placements, groupe), placements, profil);
  return GROUPES_PLACEMENTS[groupe].some((id) => Math.abs((Number(placements?.[id]) || 0) - auto[id]) > TOLERANCE_GROUPE);
}

/**
 * Nouveaux `pea` et `assuranceVie` du profil après une répartition (null = inchangé) :
 * - un PEA ou une assurance-vie apparaît quand il n'y avait pas de contrat ouvert ;
 * - un PEA ouvert dont les versements égalaient le solde avant la saisie (`placementsAvant`) garde cette égalité (saisie chiffre par chiffre) ;
 * - sinon un contrat déjà ouvert garde ses versements et sa date.
 */
export function contratsApresRepartition(profil, placements, aujourdhui = new Date(), placementsAvant = null) {
  const pea = Number(placements?.pea) || 0, av = (Number(placements?.assuranceVie) || 0) + (Number(placements?.assuranceVieUC) || 0);
  const mois = `${aujourdhui.getFullYear()}-${String(aujourdhui.getMonth() + 1).padStart(2, "0")}`;
  const versements = Math.round(Number(profil?.pea?.versements) || 0);
  let nouveauPea = null;
  if (pea > 0 && !profil?.pea?.ouvert) nouveauPea = { ...(profil?.pea ?? {}), ouvert: true, versements: Math.round(pea), dateOuverture: profil?.pea?.dateOuverture || mois, etablissement: profil?.pea?.etablissement ?? "" };
  else if (profil?.pea?.ouvert && placementsAvant && versements === Math.round(Number(placementsAvant.pea) || 0) && versements !== Math.round(pea)) nouveauPea = { ...profil.pea, versements: Math.round(pea) };
  return { pea: nouveauPea, assuranceVie: av > 0 && !profil?.assuranceVie?.ouverte ? { ...(profil?.assuranceVie ?? {}), ouverte: true } : null };
}

/**
 * Capital de la Découverte : 6 mois de dépenses en épargne de précaution (Livret A, puis LDDS, puis livret bancaire),
 * le reste en PEA jusqu'à son plafond de versements, puis en compte-titres. Montants arrondis à l'euro.
 */
export function repartirCapitalPrudent(plan, capital, depensesMensuelles) {
  const cap = Math.max(0, Number(capital) || 0), dep = Number(depensesMensuelles) || 0;
  const precaution = Math.min(cap, 6 * (dep > 0 ? dep : 1000));
  const livretA = Math.min(precaution, plan.enveloppes.livretA.plafond);
  const ldds = Math.min(precaution - livretA, plan.enveloppes.ldds.plafond);
  const livretBancaire = precaution - livretA - ldds;
  const reste = cap - precaution;
  const pea = Math.min(reste, plan.enveloppes.pea.plafond);
  const cto = reste - pea;
  const r = { livretA, ldds, livretBancaire, pea, cto };
  for (const k of Object.keys(r)) r[k] = Math.round(r[k]);
  return r;
}

export function profilRisque(plan, profil) {
  const P = plan.profilsRisque ?? {};
  const id = P[profil.profilRisque] ? profil.profilRisque : P.defaut;
  return { id, ...(P[id] ?? {}) };
}
export const resideEnFrance = (profil) => !profil.pays || profil.pays === "FR";
export function paysDe(plan, profil) {
  const P = plan.residence?.pays ?? {};
  const p = P[profil.pays] ?? P.AUTRE ?? {};
  const taux = profil.pays === "AUTRE" && profil.impotGainsPays != null && profil.impotGainsPays !== "" ? Number(profil.impotGainsPays) : p.impotGains;
  return { ...p, code: profil.pays, impotGains: taux ?? 0 };
}
// Un compte peut-il recevoir de l'argent neuf ? (LEP sous conditions, PEL existant seulement, comptes réservés aux résidents)
export function accepteArgentNeuf(plan, profil, id) {
  const e = plan.enveloppes[id] ?? {};
  if (e.nouveauxVersements === false) return false;
  if (e.condition && !profil[e.condition]) return false;
  if (!resideEnFrance(profil) && (plan.residence?.reserveesFrance ?? []).includes(id)) return false;
  if (id === "per" && profil.refusPER) return false;  // le proche a choisi de ne pas avoir de PER
  return true;
}

export function ciblesInterpolees(paliers, capital) {
  const ps = [...paliers].sort((a, b) => a.capital - b.capital);
  if (capital <= ps[0].capital) return { ...ps[0].cibles };
  const dernier = ps[ps.length - 1];
  if (capital >= dernier.capital) return { ...dernier.cibles };
  const i = ps.findIndex((p) => p.capital > capital);
  const a = ps[i - 1], b = ps[i];
  const t = (capital - a.capital) / (b.capital - a.capital);
  const res = {};
  for (const c of new Set([...Object.keys(a.cibles), ...Object.keys(b.cibles)])) {
    res[c] = (a.cibles[c] ?? 0) * (1 - t) + (b.cibles[c] ?? 0) * t;
  }
  return res;
}

export function montantSecurite(plan, profil) {
  const s = plan.securite;
  const C = profil.capital;
  const mois = Math.max(s.moisDepenses ?? 0, s.moisDepensesSelonStatut?.[profil.statutPro] ?? 0);
  let m = Math.max(s.minimum ?? 0, ((s.pourcentCapital ?? 0) / 100) * C, mois * (profil.depensesMensuelles ?? 0));
  if (s.plafond != null) m = Math.min(m, s.plafond);
  if (s.plafondPourcentCapital != null) m = Math.min(m, (s.plafondPourcentCapital / 100) * C);
  return Math.min(m, C);
}

export function partApportAProteger(plan, objectif) {
  const a = plan.apport;
  if (objectif.imperatif && objectif.horizonAnnees <= (a.horizonImperatifMax ?? 0)) return a.partSiImperatif ?? 100;
  return a.protection.find((x) => objectif.horizonAnnees <= (x.horizonMaxAnnees ?? Infinity))?.part ?? 0;
}

function retirerAuProrata(alloc, montant, poids) {
  let reste = montant;
  for (let tour = 0; tour < 10 && reste > 0.01; tour++) {
    const base = Object.entries(poids).map(([c, w]) => [c, (alloc[c] ?? 0) * w]).filter(([, x]) => x > 0);
    const total = base.reduce((s, [, x]) => s + x, 0);
    if (total === 0) break;
    let retire = 0;
    for (const [c, x] of base) {
      const r = Math.min(alloc[c], (reste * x) / total);
      alloc[c] -= r;
      retire += r;
    }
    reste -= retire;
  }
  return montant - reste;
}

function retirerDansLOrdre(alloc, montant, ordre, planchers = {}) {
  let reste = montant;
  for (const c of ordre) {
    const r = Math.max(0, Math.min((alloc[c] ?? 0) - (planchers[c] ?? 0), reste));
    alloc[c] -= r;
    reste -= r;
  }
  return montant - reste;
}

const entrees = (plan, c) =>
  (plan.remplissage[c] ?? []).map((e) => (typeof e === "string" ? { id: e, max: Infinity } : { id: e.id, max: e.max ?? Infinity }));

// Comptes dont on ne peut rien retirer pour l'instant (ex. PEA de moins de 5 ans)
export function comptesBloques(plan, profil) {
  const bloque = {};
  for (const [e, ans] of Object.entries(plan.reequilibrage?.sansRetraitAvantAnnees ?? {})) {
    if (!((profil.placements?.[e] ?? 0) > 0)) continue;
    const age = anneesDepuis(profil[e]?.dateOuverture);
    bloque[e] = age == null || age < ans;
  }
  if ((profil.placements?.per ?? 0) > 0 && (profil.age ?? 0) < (plan.hypotheses?.ageRetraite ?? 64)) bloque.per = true;
  if ((profil.placements?.pel ?? 0) > 0) bloque.pel = true; // pas de retrait partiel : un retrait clôture le PEL
  if ((profil.placements?.epargneSalariale ?? 0) > 0) bloque.epargneSalariale = true; // PEE 5 ans, PER d'entreprise jusqu'à la retraite
  // Comptes qu'on ne vend jamais (l'or physique) : ce qu'on a est gardé
  for (const e of plan.reequilibrage?.jamaisVendre ?? []) if ((profil.placements?.[e] ?? 0) > 0) bloque[e] = true;
  return bloque;
}
// Montant minimum à garder par classe à cause des comptes bloqués
function planchersDe(plan, profil, bloque) {
  const pl = {};
  for (const [e, b] of Object.entries(bloque)) {
    if (!b) continue;
    const c = Object.keys(plan.classes).find((k) => entrees(plan, k).some((x) => x.id === e));
    if (c) pl[c] = (pl[c] ?? 0) + (profil.placements?.[e] ?? 0);
  }
  return pl;
}

function anneesDepuis(aaaaMm) {
  if (!aaaaMm) return null;
  const [a, m] = aaaaMm.split("-").map(Number);
  const now = new Date();
  return (now.getFullYear() - a) + (now.getMonth() + 1 - (m || 1)) / 12;
}

// ------------------------------------------------------------- 1 → 4 : classes
export function allocationCible(plan, profil, { rapide = false } = {}) {
  const C = profil.capital;
  const etapes = [];
  if (rapide) etapes.push = () => 0;
  const alloc = Object.fromEntries(Object.keys(plan.classes).map((c) => [c, 0]));

  alloc.securite = montantSecurite(plan, profil);
  etapes.push(`Épargne de sécurité : ${eur(alloc.securite)} (le plus grand entre le minimum, ${plan.securite.pourcentCapital} % du capital et les mois de dépenses).`);

  const R = profilRisque(plan, profil);
  const cibles = ciblesInterpolees(plan.paliers, C);
  for (const [c, k] of Object.entries(R.multiplicateurs ?? {})) if (c in cibles && k != null) cibles[c] *= k;
  let disponible = C - alloc.securite;
  for (const [c, x] of Object.entries(cibles)) {
    if (c === plan.classeReste || !(c in alloc)) continue;
    const m = Math.min((x / 100) * C, disponible);
    alloc[c] += m;
    disponible -= m;
  }
  alloc[plan.classeReste] += disponible;
  if (R.libelle) etapes.push(`Profil de risque : ${R.libelle}.`);
  etapes.push(`Palier pour ${eur(C)} : ` + Object.entries(cibles).filter(([c, x]) => x > 0 && plan.classes[c]).map(([c, x]) => `${plan.classes[c].libelle} ${pct(x)}`).join(", ") + `, le reste en ${plan.classes[plan.classeReste].libelle}.`);

  const a = plan.age;
  const debut = a.ageDebut + (R.decalageAge ?? 0);
  const pointsAge = Math.min(Math.max(0, (profil.age - debut) * a.pointsParAn), a.maxPoints);
  const points = Math.min(100, pointsAge + (R.partPrudente ?? 0));
  if (points > 0) {
    const bascule = retirerAuProrata(alloc, (points / 100) * C, a.vitesseRelative);
    alloc.prudent += bascule;
    const detail = [R.partPrudente > 0 ? `${pct(R.partPrudente)} pour le profil ${R.libelle?.toLowerCase()}` : "", pointsAge > 0 ? `${pct(pointsAge)} pour l'âge (${profil.age} ans, à partir de ${debut} ans)` : ""].filter(Boolean).join(" + ");
    etapes.push(`${detail} : ${eur(bascule)} basculés vers ${plan.classes.prudent.libelle}.`);
  }

  const obj = profil.objectifApport;
  if (obj?.montant > 0) {
    const part = partApportAProteger(plan, obj);
    const pris = retirerDansLOrdre(alloc, (obj.montant * part) / 100, plan.apport.prelevementSur, profil.planchers);
    alloc.projet += pris;
    etapes.push(`Apport à protéger dès maintenant : ${eur(obj.montant)} (achat ${obj.imperatif ? "impératif " : ""}dans ${obj.horizonAnnees} an(s)), ${part} % protégé, soit ${eur(pris)} mis à l'abri.`);
  }
  return { capital: C, alloc, etapes };
}

// ------------------------------------------------------------- 5 : comptes
// Répartit chaque classe sur les comptes. L'argent déjà placé sur un compte
// autorisé pour la classe y reste (passe 1) ; le reste suit l'ordre du plan.
export function repartirEnEnveloppes(plan, alloc, placements = {}, profil = {}) {
  const existant = { ...placements };
  const capacite = {};
  const n = profil.personnes ?? 1;
  for (const [id, e] of Object.entries(plan.enveloppes)) {
    const deja = placements[id] ?? 0;
    const plafond = e.plafond == null ? null : e.plafond * (e.parPersonne ? n : 1);
    if (!accepteArgentNeuf(plan, profil, id)) capacite[id] = deja;
    else if (id === "pea" && plafond != null) {
      const verse = profil.pea?.versements ?? deja;
      capacite[id] = deja + Math.max(0, plafond - verse);
    } else capacite[id] = Math.max(plafond ?? Infinity, deja);
  }
  const classes = Object.keys(plan.classes);
  const reste = Object.fromEntries(classes.map((c) => [c, alloc[c] ?? 0]));
  const utilise = Object.fromEntries(classes.map((c) => [c, new Map()]));
  const lignes = [];
  const placer = (c, e, m, source) => {
    const l = lignes.find((x) => x.classe === c && x.enveloppe === e.id);
    if (l) l.montant += m; else lignes.push({ classe: c, enveloppe: e.id, montant: m });
    utilise[c].set(e.id, (utilise[c].get(e.id) ?? 0) + m);
    capacite[e.id] -= m; reste[c] -= m;
    if (source) existant[source] -= m;
  };
  const borne = (c, e) => Math.min(reste[c], capacite[e.id] ?? 0, e.max - (utilise[c].get(e.id) ?? 0));

  // 1. L'argent déjà placé reste sur son compte
  for (const c of classes) for (const e of entrees(plan, c)) {
    const m = Math.min(borne(c, e), existant[e.id] ?? 0);
    if (m > 0.005) placer(c, e, m, e.id);
  }
  // 2. Arbitrages dans le même contrat (ex. fonds euros → unités de compte)
  if (plan.reequilibrage?.arbitrageInterne) for (const c of classes) for (const e of entrees(plan, c)) {
    const src = plan.enveloppes[e.id]?.arbitrageDepuis;
    if (!src) continue;
    const m = Math.min(borne(c, e), existant[src] ?? 0);
    if (m > 0.005) placer(c, e, m, src);
  }
  // 3. L'argent neuf suit l'ordre du plan
  for (const c of classes) for (const e of entrees(plan, c)) {
    const m = borne(c, e);
    if (m > 0.005) placer(c, e, m);
  }
  for (const c of classes) if (reste[c] > 0.5) lignes.push({ classe: c, enveloppe: null, montant: reste[c] });
  return lignes;
}

const parEnveloppe = (lignes, filtre = () => true) =>
  lignes.reduce((o, l) => (l.enveloppe && filtre(l) ? ((o[l.enveloppe] = (o[l.enveloppe] ?? 0) + l.montant), o) : o), {});

// Répartition ACTUELLE par classe : l'existant sert d'abord les cibles,
// le surplus d'un compte va à la première classe qui l'utilise.
export function actuelParClasse(plan, alloc, placements) {
  const existant = { ...placements };
  const res = Object.fromEntries(Object.keys(plan.classes).map((c) => [c, 0]));
  for (const c of Object.keys(plan.classes)) {
    let reste = alloc[c] ?? 0;
    for (const e of entrees(plan, c)) {
      const m = Math.min(reste, existant[e.id] ?? 0);
      res[c] += m; existant[e.id] = (existant[e.id] ?? 0) - m; reste -= m;
    }
  }
  // Surplus d'un compte : rattaché à la classe pour laquelle ce compte vient en premier
  for (const [id, m] of Object.entries(existant)) {
    if (m <= 0.005) continue;
    let meilleure = null, rang = Infinity;
    for (const k of Object.keys(plan.classes)) {
      const i = entrees(plan, k).findIndex((e) => e.id === id);
      if (i >= 0 && i < rang) { rang = i; meilleure = k; }
    }
    if (meilleure) res[meilleure] += m;
  }
  return res;
}

// ------------------------------------------------------------- achat de la résidence principale
function mensualiteParEuro(tauxAnnuel, assuranceAnnuelle, annees) {
  const i = tauxAnnuel / 100 / 12, n = annees * 12;
  const credit = i === 0 ? 1 / n : i / (1 - Math.pow(1 + i, -n));
  return credit + assuranceAnnuelle / 100 / 12;
}

// Charges du propriétaire occupant, en euros annuels de l'année d'achat (taxe foncière, copropriété non récupérable, entretien)
export function chargesProprietaire(plan, { prix, typeLogement = "appartement", surface = null, loyerMarcheMensuel = null, chargesCoproMensuelles = null }) {
  const c = plan.achatRP.chargesProprietaire;
  const type = typeLogement === "maison" ? "maison" : "appartement";
  const prixOk = Math.max(0, Number(prix) || 0);
  const sourceLoyer = Number(loyerMarcheMensuel) > 0 ? "marche" : "defaut";
  const loyerMarcheRetenu = sourceLoyer === "marche" ? Number(loyerMarcheMensuel) : (prixOk * c.rendementLocatifBrutDefaut) / 100 / 12;
  const taxeFonciere = loyerMarcheRetenu * c.taxeFonciereMoisDeLoyer;
  const copro = chargesCoproMensuelles != null && Number.isFinite(Number(chargesCoproMensuelles))
    ? Math.max(0, Number(chargesCoproMensuelles)) * 12
    : type === "appartement" ? (Number(surface) > 0 ? Number(surface) : c.surfaceDefaut) * c.coproNonRecuperableM2An : 0;
  const entretien = (prixOk * (c.entretienPctValeur[type] ?? 0)) / 100;
  const totalAnnuel = taxeFonciere + copro + entretien;
  return { taxeFonciere, copro, entretien, totalAnnuel, totalMensuel: totalAnnuel / 12, loyerMarcheRetenu, sourceLoyer };
}

// Prêt à taux zéro : montant, durées et mensualité de remboursement (barèmes dans plan.achatRP.ptz)
export function pretTauxZero(plan, { coutOperation, pretTotal, zone, tranche, typeOperation, personnes = 1, travauxPctCout = 0 }) {
  const P = plan.achatRP.ptz;
  const raisons = [];
  const z = String(zone ?? "").toUpperCase().replace(/\s/g, "");
  const zoneN = z === "ABIS" ? "A" : z;
  const t = Math.round(Number(tranche));
  const quotites = P.quotites[typeOperation];
  if (!quotites) raisons.push("Type d'opération non reconnu.");
  if (!(P.plafondOperationUnePersonne[zoneN] > 0)) raisons.push("Zone non reconnue (A, B1, B2 ou C).");
  if (!(t >= 1 && t <= P.tranches.length)) raisons.push("Tranche de revenus hors barème (1 à 4).");
  if (typeOperation === "ancienTravaux") {
    if (P.plafondOperationUnePersonne[zoneN] > 0 && !P.zonesAncien.includes(zoneN)) raisons.push(`Logement ancien avec travaux : réservé aux zones ${P.zonesAncien.join(" et ")}.`);
    if ((Number(travauxPctCout) || 0) < P.travauxMinPctCout) raisons.push(`Travaux inférieurs à ${P.travauxMinPctCout} % du coût de l'opération.`);
  }
  const nul = { eligible: false, montant: 0, quotite: 0, plafondOperation: 0, differe: 0, remboursement: 0, duree: 0, mensualiteRemboursement: 0, raisons };
  if (raisons.length) return nul;
  const quotite = quotites[t - 1];
  const foyer = P.coefficientsFoyer[Math.min(Math.max(1, Math.round(Number(personnes) || 1)), P.coefficientsFoyer.length) - 1];
  const plafondOperation = P.plafondOperationUnePersonne[zoneN] * foyer;
  const base = Math.min(Math.max(0, Number(coutOperation) || 0), plafondOperation);
  const montant = Math.floor(Math.min((quotite * base) / 100, Math.max(0, Number(pretTotal) || 0) / 2));
  const { differe, remboursement } = P.tranches[t - 1];
  if (!(montant > 0)) return { ...nul, quotite, plafondOperation, differe, remboursement, duree: differe + remboursement, raisons: ["Montant du prêt nul."] };
  return { eligible: true, montant, quotite, plafondOperation, differe, remboursement, duree: differe + remboursement, mensualiteRemboursement: montant / (remboursement * 12), raisons };
}

// Lissage : la banque ajuste sa mensualité pour que le total (banque + PTZ) reste constant pendant le prêt
export function lisserPTZ({ pretBancaire, tauxAnnuel, dureeMois, ptz, differeMois, remboursementMois, assuranceAnnuelle = 0 }) {
  const B = Math.max(0, Number(pretBancaire) || 0), n = Math.max(0, Math.round(dureeMois));
  const i = tauxAnnuel / 100 / 12;
  const a = (k) => (i > 0 ? (1 - Math.pow(1 + i, -k)) / i : k);
  const Z = Math.max(0, Number(ptz) || 0);
  const d = Math.max(0, Math.round(differeMois)), r = Math.max(0, Math.round(remboursementMois));
  const p = r > 0 ? Z / r : 0;
  const e = d + r, e2 = Math.min(e, n);
  const assMois = (B * assuranceAnnuelle) / 100 / 12;
  const classique = n > 0 ? B / a(n) : 0;
  let M = n > 0 ? (B + p * (a(e2) - a(d))) / a(n) : 0;
  const lissageImpossible = M - p < 0;
  if (lissageImpossible) M = classique;
  const bancaireParMois = (m) => {
    if (m < 1 || m > n) return 0;
    if (lissageImpossible) return classique;
    return m > d && m <= e2 ? M - p : M;
  };
  const ptzParMois = (m) => (m > d && m <= e ? p : 0);
  const total = Math.max(n, e);
  const soldeBanque = [B], soldePTZ = [Z];
  for (let m = 1; m <= total; m++) {
    const prec = soldeBanque[m - 1];
    soldeBanque.push(m >= n ? 0 : Math.max(0, prec * (1 + i) - bancaireParMois(m)));
    soldePTZ.push(m >= e ? 0 : Math.max(0, soldePTZ[m - 1] - ptzParMois(m)));
  }
  const mensualitesAnnuelles = [];
  for (let k = 0; k * 12 < total; k++) {
    let s = 0;
    for (let m = k * 12 + 1; m <= Math.min(total, k * 12 + 12); m++) s += bancaireParMois(m) + ptzParMois(m) + (m <= n ? assMois : 0);
    mensualitesAnnuelles.push(s / 12);
  }
  const restantDu = (k) => {
    const m = Math.min(total, Math.max(0, Math.round((k + 1) * 12)));
    return (soldeBanque[m] ?? 0) + (soldePTZ[m] ?? 0);
  };
  return { mensualiteLissee: M, mensualitesAnnuelles, bancaireParMois, ptzParMois, restantDu, lissageImpossible };
}

export function financement(plan, prix, type, ageAchat, salaire, autresCredits = 0, ptzSaisie = null) {
  const a = plan.achatRP;
  const duree = Math.min(a.dureeMaxAnnees, a.ageMaxFinPret - ageAchat);
  const frais = (prix * (a.fraisNotairePourcent[type] ?? 0)) / 100;
  const cout = prix + frais;
  if (duree < 1) return { duree: 0, frais, cout, pretMax: 0, apportRequis: cout, mensualiteMax: 0, mensualites: [], ptz: null };
  if (!(salaire * a.tauxEndettementMax / 100 - autresCredits > 0)) return { duree, frais, cout, pretMax: 0, apportRequis: cout, pret: 0, mensualite: 0, mensualiteMax: 0, mensualites: [], ptz: null };
  const parEuro = mensualiteParEuro(a.tauxCredit, a.tauxAssuranceEmprunteur, duree);
  const mensualiteMax = Math.max(0, (salaire * a.tauxEndettementMax) / 100 - autresCredits);
  const pretMax = mensualiteMax / parEuro;
  const apportMin = Math.max(frais, (cout * (a.apportMinPourcentCout ?? 0)) / 100);
  const apportRequis = Math.min(cout, Math.max(apportMin, cout - pretMax));
  const pret = cout - apportRequis;
  const mensualite = pret * parEuro;
  const base = { duree, frais, cout, pretMax, apportRequis, pret, mensualite, mensualiteMax };
  const ptz = ptzSaisie && pret > 0 ? pretTauxZero(plan, { coutOperation: cout, pretTotal: pret, ...ptzSaisie }) : null;
  if (!ptz?.eligible) return { ...base, mensualites: Array.from({ length: duree }, () => mensualite), ptz: null };
  const pretBancaire = pret - ptz.montant;
  const L = lisserPTZ({ pretBancaire, tauxAnnuel: a.tauxCredit, dureeMois: duree * 12, ptz: ptz.montant, differeMois: ptz.differe * 12, remboursementMois: ptz.remboursement * 12, assuranceAnnuelle: a.tauxAssuranceEmprunteur });
  const assurance = (pretBancaire * a.tauxAssuranceEmprunteur) / 100 / 12;
  return { ...base, mensualite: L.mensualiteLissee + assurance, ptz, pretBancaire, mensualites: L.mensualitesAnnuelles, restantDu: L.restantDu, lissageImpossible: L.lissageImpossible };
}

// Salaire net AVANT impôt du foyer (les banques raisonnent avant impôt), à partir du net après impôt du foyer.
// Marié ou pacsé : une seule déclaration, avec les parts des enfants. Concubins : chacun sa déclaration
// (les enfants comptés sur la tienne), chaque salaire remonté séparément.
export function netAvantFoyer(profil, salaireFoyer = profil.salaireNetMensuel) {
  const ff = foyerFiscal(profil);
  const s = Math.max(0, Number(salaireFoyer) || 0);
  if (!profil.couple || ff.commun) return decomposerSalaire(s, { parts: ff.parts, partsBase: ff.partsBase }).netAvant;
  const tot0 = Math.max(0, Number(profil.salaireNetMensuel) || 0);
  const partC = tot0 > 0 ? Math.min(1, Math.max(0, Number(profil.conjoint?.salaireNetMensuel) || 0) / tot0) : 0.5;
  return decomposerSalaire(s * (1 - partC), { parts: ff.parts, partsBase: 1 }).netAvant + decomposerSalaire(s * partC, { parts: 1 }).netAvant;
}

// Règle bancaire (HCSF, 35 %) pour l'année y : revenus = salaire net avant impôt + 70 % des loyers perçus ;
// charges = crédits à la consommation + crédit du logement actuel + crédit du projet locatif.
// sansLogementActuel : le logement actuel est revendu pour l'achat (son crédit disparaît).
export function banqueDe(plan, profil, { sansLogementActuel = false } = {}) {
  const inflB = (plan.hypotheses?.inflation ?? 0) / 100;
  const LG = profil.proprietaire ? profil.logement ?? {} : {};
  const partLg = (LG.part > 0 ? Math.min(100, LG.part) : 100) / 100;
  const loue = !!profil.proprietaire && LG.usage === "loue";
  const ansCreditEx = Math.max(1, (Number(LG.finCredit) || new Date().getFullYear()) - new Date().getFullYear());
  const credits = Math.max(0, profil.creditsMensuels ?? 0);
  const PL = projetLocatifDe(plan, profil);
  const max = plan.achatRP?.tauxEndettementMax ?? 35;
  // avecLocatif : compter le projet locatif une fois acheté. Par défaut, seulement si la banque l'accepte
  // à sa date (sans résidence achetée avant : dans ce cas-là, il ne pèse pas sur l'achat de la résidence).
  const calc = (y, salaire = (profil.salaireNetMensuel ?? 0) * facteurSalaire(plan, profil, y), { avecLocatif = locatifAccepte } = {}) => {
    const salaireAvant = netAvantFoyer(profil, salaire);
    let loyers70 = 0, mensLogement = 0, mensLocatif = 0;
    if (loue) loyers70 += 0.7 * (Number(LG.loyerPercu) || 0) * partLg * Math.pow(1 + inflB, y);
    if (profil.proprietaire && !sansLogementActuel && Number(LG.mensualite) > 0 && Number(LG.creditRestant) > 0 && y < ansCreditEx) mensLogement = Number(LG.mensualite);
    if (avecLocatif && PL && y >= PL.annees) {
      loyers70 += 0.7 * (Number(profil.projetLocatif.loyer) || 0) * Math.pow(1 + inflB, y);
      if (y - PL.annees < PL.duree) mensLocatif = PL.mensualite;
    }
    return { revenus: salaireAvant + loyers70, charges: credits + mensLogement + mensLocatif, salaireAvant, loyers70, conso: credits, mensLogement, mensLocatif };
  };
  let locatifAccepte = false;
  if (PL) { const B = calc(PL.annees, undefined, { avecLocatif: true }); locatifAccepte = B.charges <= (max / 100) * B.revenus + 0.5; }
  calc.locatifAccepte = locatifAccepte;
  calc.max = max;
  return calc;
}

// Le projet locatif passe-t-il la règle des banques à sa date ? (mensualiteRP : crédit de la résidence déjà acheté)
export function locatifFinancable(plan, profil, { mensualiteRP = 0, sansLogementActuel = false } = {}) {
  const PL = projetLocatifDe(plan, profil);
  if (!PL) return null;
  const b = banqueDe(plan, profil, { sansLogementActuel });
  const B = b(PL.annees, undefined, { avecLocatif: true });
  const charges = B.charges + mensualiteRP;
  return { ok: charges <= (b.max / 100) * B.revenus + 0.5, taux: B.revenus > 0 ? (100 * charges) / B.revenus : null, max: b.max };
}

// Taux d'endettement aujourd'hui, à l'achat du bien locatif et à l'achat de la résidence principale
export function endettementBancaire(plan, profil) {
  const max = plan.achatRP?.tauxEndettementMax ?? 35;
  const b = banqueDe(plan, profil);
  const age0 = profil.agePrincipal ?? profil.age ?? 30;
  const taux = (B) => (B.revenus > 0 ? (100 * B.charges) / B.revenus : null);
  const lignes = [];
  const B0 = b(0);
  lignes.push({ cle: "aujourdhui", libelle: "Aujourd'hui", age: age0, ...B0, taux: taux(B0) });
  // Résidence principale d'abord : son crédit compte ensuite si le bien locatif est acheté après
  let rp = null, pRP = null;
  try { rp = achatResidence(plan, profil); } catch (e) { rp = null; }
  if (rp) {
    const choix = rp.imperatif && rp.horizon ? rp.horizon : rp.choisi && !rp.choisi.horsLimite ? rp.choisi : rp.ideal;
    pRP = choix ? rp.serie.find((x) => x.annees === choix.annees) : null;
    if (pRP && pRP.duree >= 1) {
      const B = { revenus: pRP.banqueRevenus, charges: pRP.banqueCharges + pRP.mensualite, salaireAvant: pRP.banqueSalaireAvant, loyers70: pRP.banqueLoyers70, mensRP: pRP.mensualite };
      lignes.push({ cle: "rp", libelle: `Après l'achat de ta résidence (${pRP.age} ans)`, age: pRP.age, ...B, taux: taux(B) });
    } else { pRP = null; lignes.push({ cle: "rp", libelle: "Achat de ta résidence", introuvable: true, age: Infinity }); }
  }
  const PL = projetLocatifDe(plan, profil);
  if (PL) {
    const B = b(PL.annees, undefined, { avecLocatif: true });
    if (pRP && pRP.annees <= PL.annees && PL.annees - pRP.annees < pRP.duree) { B.mensRP = pRP.mensualite; B.charges += pRP.mensualite; }
    lignes.push({ cle: "locatif", libelle: `Après l'achat du bien locatif (${PL.age} ans)`, age: PL.age, ...B, taux: taux(B) });
  }
  lignes.sort((x, y) => (x.cle === "aujourdhui" ? -1 : y.cle === "aujourdhui" ? 1 : x.age - y.age));
  return { max, lignes };
}

export function achatResidence(plan, profil) {
  const pr = profil.projetRP;
  if (!pr?.actif || !(pr.prix > 0)) return null;
  const a = plan.achatRP, h = plan.hypotheses;
  const ptzSaisie = pr.ptz?.actif ? { zone: pr.ptz.zone, tranche: pr.ptz.tranche, typeOperation: pr.ptz.typeOperation, personnes: pr.ptz.personnes, travauxPctCout: pr.ptz.travauxPctCout } : null;
  const C = capitalDe(profil);
  const securite = montantSecurite(plan, { ...profil, capital: C });
  const livrets = (a.enveloppesApport ?? []).reduce((s, id) => s + (profil.placements?.[id] ?? 0), 0);
  const surplus = Math.max(0, livrets - securite);
  const r = (h.rendements.securite ?? 0) / 100;
  const epargneApport = (profil.epargneMensuelle * (a.partEpargneVersApport ?? 100)) / 100;

  const aide = Math.max(0, pr.aideFamiliale ?? 0);
  const credits = Math.max(0, profil.creditsMensuels ?? 0);
  // Autres placements vendables pour l'apport (bourse, assurance-vie…) : tout sauf la sécurité et les comptes bloqués
  const bloque0 = comptesBloques(plan, profil);
  const bloqueTotal0 = Object.entries(bloque0).reduce((s2, [e, b2]) => s2 + (b2 ? profil.placements?.[e] ?? 0 : 0), 0);
  const mobilisable0 = Math.max(0, C - securite - bloqueTotal0);
  const autresPlacements = Math.max(0, mobilisable0 - surplus);
  // Revente du logement actuel pour financer le nouveau : produit net (ta part de la valeur moins le crédit restant) à chaque âge
  const LG = profil.proprietaire ? profil.logement ?? {} : {};
  const vendre = !!LG.vendrePourAchat && (LG.usage ?? "rp") === "rp" && Number(LG.valeur) > 0;
  const valeurPart = vendre ? Number(LG.valeur) * (LG.part > 0 ? Math.min(100, LG.part) : 100) / 100 : 0;
  const creditEx = vendre ? Math.max(0, Number(LG.creditRestant) || 0) : 0;
  const ansCreditEx = Math.max(1, (Number(LG.finCredit) || new Date().getFullYear()) - new Date().getFullYear());
  const venteA = (y) => (vendre ? Math.max(0, valeurPart * Math.pow(1 + (h.valorisationImmobiliere ?? 0) / 100, y) - Math.max(0, creditEx - (creditEx / ansCreditEx) * y)) : 0);
  // Règle bancaire (HCSF, 35 %) : revenus = salaire net avant impôt + 70 % des loyers perçus ; charges = tous les crédits en cours
  const banque = banqueDe(plan, profil, { sansLogementActuel: vendre });
  const serie = [];
  let apport = surplus, ideal = null;
  const ageEmp = profil.ageEmprunteur ?? profil.age, agePers = profil.agePrincipal ?? profil.age;
  for (let y = 0; ageEmp + y < a.ageMaxFinPret && y <= 40; y++) {
    const salaire = profil.salaireNetMensuel * facteurSalaire(plan, profil, y);
    const B = banque(y, salaire);
    const f = financement(plan, pr.prix, pr.type, ageEmp + y, B.revenus, B.charges, ptzSaisie);
    const vente = venteA(y);
    const point = { annees: y, age: agePers + y, salaire, apport: apport + aide + vente, aide, vente, autresPlacements, ...f,
      banqueRevenus: B.revenus, banqueCharges: B.charges, banqueSalaireAvant: B.salaireAvant, banqueLoyers70: B.loyers70, faisable: apport + aide + vente >= f.apportRequis && f.duree >= 1 && f.pretMax + apport + aide + vente >= f.cout };
    serie.push(point);
    if (point.faisable && !ideal) ideal = point;
    const ep = epargneApport * (h.epargneSuitLeSalaire ? facteurSalaire(plan, profil, y) : 1);
    apport = apport * (1 + r) + 12 * ep * (1 + r / 2);
  }

  // Achat à horizon fixé (impératif) : l'apport vient de l'épargne future,
  // complétée par des placements mis à l'abri dès maintenant.
  let horizon = null;
  if (pr.imperatif) {
    const H = Math.max(0, Math.round(pr.horizonAnnees ?? 0));
    const p = serie[H];
    if (p) {
      const bloque = comptesBloques(plan, profil);
      const bloqueTotal = Object.entries(bloque).reduce((s2, [e, b2]) => s2 + (b2 ? profil.placements?.[e] ?? 0 : 0), 0);
      const apportFutur = Math.max(0, p.apport - surplus);
      const besoin = Math.max(0, p.apportRequis - apportFutur);
      const mobilisable = Math.max(0, C - securite - bloqueTotal);
      const aProteger = Math.min(besoin, mobilisable);
      const apportMax = apportFutur + mobilisable;
      let prixMax = null;
      if (besoin > mobilisable) {
        let bas = 0, haut = pr.prix * 3;
        for (let k = 0; k < 40; k++) {
          const mil = (bas + haut) / 2;
          const BH = banque(H, p.salaire);
          if (apportMax >= financement(plan, mil, pr.type, ageEmp + H, BH.revenus, BH.charges, ptzSaisie).apportRequis) bas = mil; else haut = mil;
        }
        prixMax = bas;
      }
      horizon = { ...p, apportFutur, besoin, mobilisable, bloqueTotal, aProtegerMaintenant: aProteger,
        prisSurPlacements: Math.max(0, aProteger - surplus), manque: Math.max(0, besoin - mobilisable), prixMax };
    }
  }
  // Âge d'achat choisi à la main (pour comparer avec l'âge idéal)
  let choisi = null;
  if (!pr.imperatif && pr.ageChoisi > 0) {
    const p = serie.find((x) => x.age === Math.round(pr.ageChoisi));
    choisi = p ? diagnosticAchat(plan, p) : { age: Math.round(pr.ageChoisi), horsLimite: true };
  }
  return { surplus, securite, livrets, epargneApport, aide, credits, serie, ideal, horizon, choisi, prix: pr.prix, type: pr.type, imperatif: !!pr.imperatif };
}

// Ce qui coince (ou pas) pour un achat à un âge donné
export function diagnosticAchat(plan, p) {
  const manqueApport = Math.max(0, p.apportRequis - p.apport);
  const tropTard = !(p.duree >= 1);
  // En vendant aussi les autres placements (valeur d'aujourd'hui, sans compter leur croissance)
  const aVendre = Math.min(manqueApport, p.autresPlacements ?? 0);
  const manqueTotal = Math.max(0, manqueApport - (p.autresPlacements ?? 0));
  // La banque ne prête pas plus que ce que permet le taux d'endettement : le reste doit venir de l'apport
  const limiteParEndettement = p.pretMax + 0.5 < p.cout - Math.max(p.frais, (p.cout * (plan.achatRP.apportMinPourcentCout ?? 0)) / 100);
  return { ...p, manqueApport, aVendre, manqueTotal, tropTard, limiteParEndettement, ok: !tropTard && manqueApport < 0.5, okAvecPlacements: !tropTard && manqueTotal < 0.5 };
}

// Objectif d'apport utilisé par l'allocation (seulement si achat impératif)
export function objectifDepuisProjet(plan, profil, achat) {
  if (!achat?.imperatif || !achat.horizon) return null;
  return { montant: achat.horizon.aProtegerMaintenant, horizonAnnees: achat.horizon.annees, imperatif: true };
}

// ------------------------------------------------------------- rééquilibrage progressif
const ciblesComptes = (plan, profil, placements) => {
  const { alloc } = allocationCible(plan, profil);
  const lignes = repartirEnEnveloppes(plan, alloc, placements, profil);
  const prio = plan.flux.priorites ?? [];
  return { total: parEnveloppe(lignes), prio: parEnveloppe(lignes, (l) => prio.includes(l.classe)) };
};

export function reequilibrage(plan, profil) {
  const R = plan.reequilibrage ?? { dureeMois: 12, toleranceEuros: 500 };
  const envs = Object.keys(plan.enveloppes);
  const h = Object.fromEntries(envs.map((e) => [e, profil.placements?.[e] ?? 0]));
  const S = profil.epargneMensuelle ?? 0;
  const tol = R.toleranceEuros ?? 0;
  const bloque0 = comptesBloques(plan, profil);
  let peaVerse = profil.pea?.versements ?? h.pea ?? 0;
  const capital0 = somme(h);
  const cible0 = ciblesComptes(plan, { ...profil, capital: capital0 }, h).total;
  const exces0 = Object.fromEntries(envs.map((e) => [e, Math.max(0, h[e] - (cible0[e] ?? 0))]));
  // Ventes groupées : une vente par an, et aucune pour un petit excédent (on arrête juste d'alimenter)
  const groupees = new Set(R.venteGroupee ?? []);
  const venteMin = R.venteMinimum ?? 1000, venteUnique = R.venteUniqueJusqua ?? 5000;
  // Ce qui peut être transféré (et non vendu) vers un compte de la même classe
  const transferable = Object.fromEntries(Object.entries(plan.enveloppes).filter(([, ed]) => ed.transfertDepuis).map(([dest, ed]) => [ed.transfertDepuis, { vers: dest, montant: Math.min(exces0[ed.transfertDepuis] ?? 0, Math.max(0, (cible0[dest] ?? 0) - h[dest])) }]));
  const aVendre0 = (e) => Math.max(0, exces0[e] - (transferable[e]?.montant ?? 0));
  const petitExces = Object.fromEntries(envs.filter((e) => groupees.has(e) && exces0[e] > tol && aVendre0(e) < venteMin && !(transferable[e]?.montant > tol)).map((e) => [e, true]));
  const bloque = { ...bloque0, ...petitExces };
  // Durée : choisie dans le profil, sinon automatique. En automatique, on ne
  // déplace pas chaque mois plus que l'épargne du mois (12 mois au moins,
  // dureeMaxMois au plus), pour éviter des mouvements brusques.
  const aDeplacer = envs.reduce((t, e) => t + (bloque[e] || exces0[e] <= tol ? 0 : exces0[e]), 0);
  const dureeMin = Math.max(1, R.dureeMois ?? 12), dureeMax = Math.max(dureeMin, R.dureeMaxMois ?? 60);
  const choix = Number(profil.rythmeReequilibrage) || 0;
  const auto = Math.min(dureeMax, Math.max(dureeMin, Math.ceil(aDeplacer / Math.max(S, 100) / 6) * 6));
  const duree = choix > 0 ? choix : auto;
  // Nombre de ventes pour un excédent : une seule jusqu'à venteUnique, sinon une par an sur la durée (sans passer sous venteMin)
  const nbVentesDe = (montant) => (montant <= venteUnique ? 1 : Math.max(1, Math.min(Math.round(duree / 12), Math.floor(montant / venteMin))));
  const nbVentes = Math.max(1, Math.round(duree / 12)); // une vente par an sur la durée (une seule pour un petit montant)

  let mois1 = null, moisEquilibre = null;
  for (let m = 0; m < 120; m++) {
    const cap = somme(h) + S;
    const p = { ...profil, capital: cap, pea: { ...profil.pea, versements: peaVerse } };
    const c = ciblesComptes(plan, p, h);
    const manqueP = Object.fromEntries(envs.map((e) => [e, Math.max(0, (c.prio[e] ?? 0) - h[e])]));
    let urgence = Math.max(0, somme(manqueP) - S); // la sécurité / l'apport qui manque et que l'épargne ne couvre pas

    // Arbitrages internes, étalés comme les autres transferts
    const arbitrages = [];
    // et transferts entre comptes d'une même classe (bitcoins de la plateforme vers le cold wallet : pas une vente)
    for (const [dest, ed] of Object.entries(plan.enveloppes)) {
      const transfert = !ed.arbitrageDepuis && !!ed.transfertDepuis;
      const src = ed.arbitrageDepuis ?? ed.transfertDepuis;
      if (!src || (transfert ? bloque0[src] : bloque[src] || !R.arbitrageInterne)) continue;
      const exces = h[src] - (c.total[src] ?? 0), manque = (c.total[dest] ?? 0) - h[dest];
      if (exces <= tol || manque <= 0) continue;
      const a = transfert ? (m % 12 === 0 ? Math.min(exces, manque) : 0) : Math.min(exces, manque, (exces0[src] > 0 ? exces0[src] : exces) / duree);
      if (a <= 0.5) continue;
      h[src] -= a; h[dest] += a; arbitrages.push({ de: src, vers: dest, montant: a, transfert });
    }

    const retraits = {};
    for (const e of envs) {
      const exces = h[e] - (c.total[e] ?? 0);
      if (exces <= tol || bloque[e]) continue;
      // le rythme mensuel inclut ce qui a déjà été arbitré depuis ce compte
      const dejaArbitre = arbitrages.filter((x) => x.de === e).reduce((s2, x) => s2 + x.montant, 0);
      let r = groupees.has(e)
        ? (m % 12 === 0 ? Math.min(exces, Math.max(venteMin, (exces0[e] > 0 ? exces0[e] : exces) / nbVentesDe(exces0[e] > 0 ? exces0[e] : exces))) : 0)
        : Math.max(0, Math.min(exces, (exces0[e] > 0 ? exces0[e] : exces) / duree - dejaArbitre));
      if (urgence > 0) { const u = Math.min(exces - r, urgence); r += u; urgence -= u; }
      if (r <= 0.5) continue;
      retraits[e] = r; h[e] -= r;
    }
    let dispo = S + somme(retraits);

    const versements = {};
    for (const e of envs) {
      const v = Math.min(dispo, manqueP[e]);
      if (v > 0) { versements[e] = v; dispo -= v; }
    }
    // On n'ouvre pas une nouvelle ligne pour quelques euros (cible sous la tolérance)
    const manques = Object.fromEntries(envs.map((e) => {
      const cible = c.total[e] ?? 0;
      const m = Math.max(0, cible - h[e] - (versements[e] ?? 0));
      return [e, h[e] < 0.5 && cible < tol ? 0 : m];
    }));
    const totalManques = somme(manques);
    if (totalManques > 0 && dispo > 0) {
      const part = Math.min(1, dispo / totalManques);
      for (const e of envs) if (manques[e] > 0) { const v = manques[e] * part; versements[e] = (versements[e] ?? 0) + v; dispo -= v; }
    }
    if (dispo > 0.5) {
      const e = envs.reduce((best, x) => ((c.total[x] ?? 0) - h[x] > (c.total[best] ?? 0) - h[best] ? x : best), envs[0]);
      versements[e] = (versements[e] ?? 0) + dispo;
    }
    for (const [e, v] of Object.entries(versements)) h[e] += v;
    if (versements.pea) peaVerse += versements.pea;

    if (m === 0) mois1 = { retraits, versements, arbitrages, groupees: [...groupees].filter((e) => retraits[e] > 0), nbVentesPar: Object.fromEntries([...groupees].map((e) => [e, nbVentesDe(exces0[e] ?? 0)])) };
    const ecartMax = Math.max(...envs.map((e) => (bloque[e] ? Math.max(0, (c.total[e] ?? 0) - h[e]) : Math.abs((c.total[e] ?? 0) - h[e]))));
    if (ecartMax <= tol) { moisEquilibre = m + 1; break; }
  }

  // Tableau par compte (cible pour le capital d'aujourd'hui)
  const comptes = envs.filter((e) => (profil.placements?.[e] ?? 0) > 0.5 || (cible0[e] ?? 0) > 0.5).map((e) => {
    const actuel = profil.placements?.[e] ?? 0, cible = cible0[e] ?? 0, ecart = cible - actuel;
    let statut, texte;
    if (Math.abs(ecart) <= tol) { statut = "ok"; texte = "À l'équilibre"; }
    else if (ecart > 0) { statut = "alimenter"; texte = "À alimenter avec l'épargne du mois"; }
    else if (petitExces[e]) { statut = "garder"; texte = `Léger excédent (${eur(-ecart)}) : pas de vente pour si peu, les frais coûteraient plus que l'écart. On arrête de l'alimenter, et l'épargne des autres comptes rééquilibre`; }
    else if (bloque[e]) { statut = "garder"; texte = `Excédent conservé (${RAISON_BLOCAGE[e] ?? "retrait impossible pour l'instant"}) : on arrête de l'alimenter`; }
    else if (transferable[e]?.montant > tol) {
      statut = "reduire";
      const t = transferable[e], reste = Math.max(0, -ecart - t.montant);
      texte = `${eur(t.montant)} à transférer vers « ${plan.enveloppes[t.vers].libelle} », en une fois : ce n'est pas une vente, donc pas d'impôt, seulement les frais de retrait de la plateforme${reste > venteMin ? `. Le reste (${eur(reste)}) est à vendre en une vente groupée par an` : reste > tol ? `. Le petit reste (${eur(reste)}) est gardé, sans vente` : ""}`;
    }
    else if (groupees.has(e)) {
      statut = "reduire";
      const n = nbVentesDe(-ecart);
      texte = n === 1 ? `À réduire de ${eur(-ecart)}, en une seule vente cette année (une vente groupée limite les frais : 1 € sur ${eur(-ecart)} est négligeable)`
        : `À réduire de ${eur(-ecart)} en ${n} ventes d'environ ${eur(-ecart / n)}, une par an (une vente groupée par an limite les frais)`;
    }
    else {
      statut = "reduire";
      const vers = R.arbitrageInterne && Object.entries(plan.enveloppes).find(([, x]) => x.arbitrageDepuis === e && (cible0[e] ?? 0) >= 0)?.[0];
      const arb = vers && (cible0[vers] ?? 0) > (profil.placements?.[vers] ?? 0) + tol;
      texte = `À réduire d'environ ${eur(-ecart / duree)} par mois pendant ${dureeTexte(duree)}${arb ? `, en partie par arbitrage vers « ${plan.enveloppes[vers].libelle} »` : ""}`;
    }
    return { enveloppe: e, actuel, cible, ecart, statut, texte };
  });
  return { comptes, mois1, moisEquilibre, bloque, duree, dureeAuto: auto, aDeplacer, automatique: !(choix > 0) };
}

export const dureeTexte = (m) => (m % 12 === 0 ? `${m / 12} an${m > 12 ? "s" : ""}` : m > 12 ? `${m} mois (${String(Math.round(m / 6) / 2).replace(".", ",")} ans)` : `${m} mois`);
const RAISON_BLOCAGE = { orPhysique: "on garde l'or physique, on n'en revend pas", epargneSalariale: "bloquée 5 ans (PEE) ou jusqu'à la retraite (PER d'entreprise)", pea: "pas de retrait avant 5 ans", per: "bloqué jusqu'à la retraite", pel: "un retrait clôturerait le PEL" };

// ------------------------------------------------------------- notes sur les mouvements
const NOTE_RETRAIT = {
  cto: "Vente : plus-value imposable",
  orPhysique: "Revente : fiscalité de l'or à prévoir",
  plateformeCrypto: "Vente : plus-value imposable",
  coldWallet: "Vente : plus-value imposable",
  assuranceVie: "Rachat partiel : seuls les gains sont imposés",
  assuranceVieUC: "Rachat partiel : seuls les gains sont imposés",
  pea: "Retrait possible sans clôture (PEA de plus de 5 ans)",
  scpi: "Revente de parts : délai et frais possibles",
};
export function mouvementsDuMois(plan, profil, mois1) {
  const seuils = plan.flux.seuilsAchat ?? {};
  const classeDe = (e) => Object.keys(plan.classes).find((c) => entrees(plan, c).some((x) => x.id === e));
  const out = [];
  for (const a of mois1?.arbitrages ?? []) if (a.montant > 0.5) out.push({ sens: "arbitrage", enveloppe: a.de, vers: a.vers, montant: a.montant, transfert: !!a.transfert, note: a.transfert ? "Transfert vers ton propre portefeuille, en une fois : ce n'est pas une vente, donc pas d'impôt ; seulement les frais de retrait de la plateforme" : "Dans le même contrat : sans impôt, l'ancienneté est conservée" });
  for (const [e, v] of Object.entries(mois1?.retraits ?? {})) if (v > 0.5) {
    const groupe = mois1.groupees?.includes(e);
    const n = [NOTE_RETRAIT[e], groupe ? `Vente unique pour cette année${(mois1.nbVentesPar?.[e] ?? 1) > 1 ? ", la suivante dans 12 mois" : ""} : pas de petites ventes chaque mois, pour limiter les frais` : ""].filter(Boolean).join(". ");
    out.push({ sens: "retrait", enveloppe: e, montant: v, note: n, annuel: groupe });
  }
  for (const [e, v] of Object.entries(mois1?.versements ?? {})) {
    if (v <= 0.5) continue;
    const c = classeDe(e); let note = "";
    if (seuils[c]) note = v >= seuils[c] ? `Acheter pour ${eur(v)}` : `Mettre de côté sur le livret jusqu'à ${eur(seuils[c])}, puis acheter`;
    out.push({ sens: "versement", enveloppe: e, montant: v, note });
  }
  return out;
}

// Ce qu'il faut acheter avec un versement destiné à la bourse
const COMPTES_BOURSE = ["pea", "cto", "assuranceVieUC", "per"];
function noterETF(plan, mouvements) {
  const L = (plan.investissementBourse ?? []).filter((x) => x.part > 0);
  if (!L.length) return mouvements;
  for (const m of mouvements) {
    if (m.sens !== "versement" || !COMPTES_BOURSE.includes(m.enveloppe)) continue;
    const t = L.map((x) => `${eur((m.montant * x.part) / 100)} en ${x.nom}`).join(", ");
    m.note = m.note ? `${m.note}. Acheter ${t}` : `Acheter ${t}`;
  }
  return mouvements;
}

// Bitcoin : on n'achète que sous le seuil (record moins X %)
export const usd = (v) => `${Math.round(v).toLocaleString("fr-FR")} $`;
export function seuilAchatBitcoin(plan) {
  const b = plan.bitcoin;
  if (!(b?.recordDollars > 0) || b.baisseMinPourAcheter == null) return null;
  return b.recordDollars * (1 - b.baisseMinPourAcheter / 100);
}
function noterBitcoin(plan, mouvements) {
  const s = seuilAchatBitcoin(plan);
  if (!s) return mouvements;
  for (const m of mouvements) {
    if (m.sens !== "versement" || !["plateformeCrypto", "coldWallet"].includes(m.enveloppe)) continue;
    const t = `Acheter seulement si le bitcoin vaut moins de ${usd(s)} ; sinon, garder ce montant sur le livret en attendant`;
    m.note = m.note ? `${m.note}. ${t}` : t;
  }
  return mouvements;
}

// ------------------------------------------------------------- LEP
// Revenu fiscal de référence estimé (salaire net avant impôt − 10 %) et plafond du foyer selon ses parts.
// Le LEP est personnel : en concubinage, seuls tes revenus et ta déclaration comptent.
export function lepEstime(plan, profil) {
  const lep = plan.lep; if (!lep) return null;
  const ff = foyerFiscal(profil);
  const parDemi = (lep.seuilRFRCouple - lep.seuilRFR1Part) / 2;
  const seuil = lep.seuilRFR1Part + parDemi * (ff.parts - 1) * 2;
  const rfr = revenuImposableSalaires(profil);
  return { seuil, rfr, parts: ff.parts, probable: rfr <= seuil * 1.1, etonnant: rfr > seuil * 1.15 };
}

// ------------------------------------------------------------- PER
// Plafond PER estimé : 10 % des revenus d'activité de l'an passé (net avant impôt, moins 10 % de frais),
// entre le plancher et le plafond de l'année ; sans les plafonds non utilisés des années passées
export function plafondPEREstime(plan, salaireNetApresImpot) {
  const netAvant = decomposerSalaire(Number(salaireNetApresImpot) || 0).netAvant;
  return Math.min(plan.per?.plafondMax ?? Infinity, Math.max(plan.per?.plafondMin ?? 0, 0.1 * 0.9 * netAvant * 12));
}

// Indépendant : simulation selon la forme choisie dans le profil (micro, SASU ou EURL à l'IS).
// Renvoie null si le profil n'est pas celui d'un indépendant ou si la forme n'est pas renseignée.
const FORMES_MICRO = { microBnc: "bnc", microBicServices: "bicServices", microBicVente: "bicVente" };
export function simulerIndependant(plan, profil, optimiser = true) {
  const I = profil?.independant;
  if (profil?.statutPro !== "independant" || !I?.forme) return null;
  const ff = foyerFiscal(profil);
  const autres = ff.commun && ff.autresMensuels > 0 ? decomposerSalaire(ff.autresMensuels).netAvant * 12 * 0.9 : 0;
  const pass = plan.retraitePublique?.pass ?? 48060, passN1 = (plan.per?.plafondMin ?? 4710) * 10;
  const commun = { autresRevenusImposables: autres, parts: ff.parts, partsBase: ff.partsBase };
  let resultat, formePER, optimisation = null;
  if (FORMES_MICRO[I.forme]) {
    resultat = microEntreprise({ ca: Number(I.ca) || 0, activite: FORMES_MICRO[I.forme], versementLiberatoire: !!I.vl, ...commun });
    formePER = "micro";
  } else if (I.forme === "sasu" || I.forme === "eurl") {
    const saisie = {
      forme: I.forme, resultatAvantRemuneration: Number(I.resultat) || 0, capitalEtCCA: Number(I.capital) || 0,
      tauxDistribution: I.distribution === "" || I.distribution == null ? 100 : Number(I.distribution), ...commun,
    };
    resultat = remunerationSociete({ ...saisie, remunerationNette: Number(I.remunerationNette) || 0 });
    if (optimiser) optimisation = optimiserRemuneration(saisie);
    formePER = I.forme;
  } else return null;
  const plafondPER = plafondPERIndependant({ forme: formePER, revenuPro: resultat.revenuProPER, pass, passN1 });
  return { ...resultat, plafondPER, optimisation };
}
// Plafond PER d'un indépendant (null pour un salarié : le calcul habituel s'applique)
function plafondPERIndependantDe(plan, profil) {
  return simulerIndependant(plan, profil, false)?.plafondPER.plafond ?? null;
}

export function tmiDe(profil) {
  return profil.tmi === "" || profil.tmi == null ? null : Number(profil.tmi);
}
export function conseilPER(plan, profil, mouvements = []) {
  const R = plan.per;
  if (!R) return null;
  const tmi = tmiDe(profil);
  const salaireAn = (profil.salaireNetMensuel ?? 0) * 12;
  const plafondEstime = !(profil.plafondPER > 0);
  const plafond = !plafondEstime ? profil.plafondPER : profil.plafondPEREstime ?? plafondPERIndependantDe(plan, profil) ?? plafondPEREstime(plan, profil.salaireNetMensuel);
  const base = { tmi, plafond, plafondEstime, mensuel: 0, annuel: 0, economie: 0 };
  if (!resideEnFrance(profil)) return { ...base, actif: false, raison: "non-resident" };
  if (tmi == null) return { ...base, actif: false, raison: "tmi-inconnue" };
  if (tmi < R.tmiMin) return { ...base, actif: false, raison: "tmi-faible" };
  if ((profil.age ?? 0) >= 70) return { ...base, actif: false, raison: "age" };
  const seuils = Object.keys(R.partEpargneSelonTMI ?? {}).map(Number).filter((k) => k <= tmi).sort((a, b) => b - a);
  const part = seuils.length ? R.partEpargneSelonTMI[seuils[0]] : 0;
  // Épargne de long terme du mois : tout ce qui ne va pas sur les livrets (sécurité, apport)
  const fluxLongTerme = mouvements.filter((m) => m.sens === "versement" && !LIVRETS.includes(m.enveloppe)).reduce((s2, m) => s2 + m.montant, 0);
  const mensuel = Math.min(((profil.epargneMensuelle ?? 0) * part) / 100, plafond / 12, fluxLongTerme);
  // PER refusé : on n'en verse pas, mais on indique ce qu'il aurait fait gagner
  if (profil.refusPER) return { ...base, part, actif: false, raison: "refus", economiePossible: (mensuel * 12 * tmi) / 100 };
  return { ...base, part, mensuel, annuel: mensuel * 12, economie: (mensuel * 12 * tmi) / 100, actif: mensuel > 0.5, raison: mensuel > 0.5 ? null : "pas-de-flux-bourse" };
}
// Épargne salariale : accès déclaré dans le profil (« ? » = pas encore renseigné)
export const accesEpargneSalariale = (profil) => profil.abondement?.acces ?? (profil.abondement?.actif ? (profil.abondement.plan === "pee" ? "pee" : "per") : "?");
// Intéressement et participation placés chaque année sur le plan (montant moyen saisi)
export function interessementPlace(profil) {
  const A = profil.abondement ?? {}, acces = accesEpargneSalariale(profil);
  return acces !== "non" && acces !== "?" && A.placer !== false ? Math.max(0, Number(A.interessement) || 0) : 0;
}
// Abondement de l'employeur : verser assez pour toucher tout l'abondement, avant tout autre placement en bourse
export function conseilAbondement(plan, profil, mouvements = []) {
  const A = profil.abondement, R = plan.abondement ?? {};
  if (!A?.actif || A.acces === "non" || !(Number(A.taux) > 0)) return null;
  const surPER = A.acces === "pee" ? false : A.acces === "per" ? true : A.plan !== "pee";
  const plafondLegal = surPER ? R.plafondPERCollectif ?? 7689.6 : R.plafondPEE ?? 3844.8;
  const plafond = Math.min(plafondLegal, Number(A.plafond) > 0 ? Number(A.plafond) : plafondLegal);
  const taux = Math.min(Number(A.taux), R.tauxMax ?? 300);
  // L'intéressement placé peut lui aussi être abondé (selon le règlement) : il réduit ce qu'il faut verser
  const inter = A.surInteressement ? interessementPlace(profil) : 0;
  const versementAn = Math.max(0, plafond / (taux / 100) - inter);
  const flux = mouvements.filter((m) => m.sens === "versement" && !LIVRETS.includes(m.enveloppe)).reduce((t, m) => t + m.montant, 0);
  const mensuel = Math.min(versementAn / 12, flux);
  const abondementAn = Math.min(plafond, ((mensuel * 12 + inter) * taux) / 100);
  if (!(abondementAn > 0.5)) return null;
  return { surPER, taux, plafond, versementAn, mensuel, annuel: mensuel * 12, interessement: inter, abondementAn, net: abondementAn * (1 - (R.prelevements ?? 9.7) / 100), complet: mensuel * 12 >= versementAn - 1 };
}
function appliquerAbondement(mouvements, ab) {
  if (!(ab?.mensuel > 0.5)) return mouvements;
  let reste = ab.mensuel;
  for (const e of ["cto", "pea", "assuranceVieUC"]) {
    const m = mouvements.find((x) => x.sens === "versement" && x.enveloppe === e);
    if (!m || reste <= 0) continue;
    const r = Math.min(m.montant, reste); m.montant -= r; reste -= r;
  }
  const autres = mouvements.filter((x) => x.sens === "versement" && !LIVRETS.includes(x.enveloppe) && x.montant > 0);
  const total = autres.reduce((t, x) => t + x.montant, 0);
  if (reste > 0 && total > 0) { const k = Math.min(1, reste / total); for (const x of autres) x.montant -= x.montant * k; }
  const out = mouvements.filter((m) => m.montant > 0.5);
  out.unshift({ sens: "versement", enveloppe: "epargneSalariale", montant: ab.mensuel, note: `Ton employeur ajoute environ ${eur(ab.abondementAn / 12)} par mois (abondement de ${ab.taux} %). Choisir des fonds actions monde dans la liste de l'entreprise` });
  return out;
}

// Prend le versement PER sur l'épargne de long terme : d'abord la bourse (CTO, PEA, AV en unités de compte), puis le reste au prorata
const LIVRETS = ["lep", "livretJeune", "livretA", "ldds", "livretBancaire", "pel"];
function appliquerPER(mouvements, per, plan) {
  if (!per?.actif) return mouvements;
  let reste = per.mensuel;
  for (const e of ["cto", "pea", "assuranceVieUC"]) {
    const m = mouvements.find((x) => x.sens === "versement" && x.enveloppe === e);
    if (!m || reste <= 0) continue;
    const r = Math.min(m.montant, reste);
    m.montant -= r; reste -= r;
  }
  const autres = mouvements.filter((x) => x.sens === "versement" && !LIVRETS.includes(x.enveloppe) && x.enveloppe !== "epargneSalariale" && x.montant > 0);
  const total = autres.reduce((s2, x) => s2 + x.montant, 0);
  if (reste > 0 && total > 0) { const k = Math.min(1, reste / total); for (const x of autres) x.montant -= x.montant * k; }
  const out = mouvements.filter((m) => m.montant > 0.5);
  out.push({ sens: "versement", enveloppe: "per", montant: per.mensuel, note: `Déductible : environ ${eur(per.economie)} d'impôt en moins par an (tranche à ${per.tmi} %)` });
  return out;
}

// ------------------------------------------------------------- consignes
export function consignes(plan, profil, { alloc, lignes, reeq, achat, per, abondement }) {
  const out = [];
  // Épargne salariale : abondement (argent offert, à prendre avant tout le reste), intéressement, accès
  const A = profil.abondement ?? {}, acces = accesEpargneSalariale(profil);
  const tmiN = Number(profil.tmi) || 0;
  const lieuES = acces === "pee" ? "ton PEE" : acces === "per" ? "ton PER d'entreprise" : "ton PEE ou ton PER d'entreprise";
  if (abondement) {
    const ou = abondement.surPER ? "ton PER d'entreprise (PERECO)" : "ton PEE";
    const parInter = abondement.interessement > 0 && abondement.mensuel > 0.5 ? ` Ton intéressement placé (${eur(abondement.interessement)} par an) compte déjà pour l'abondement.` : "";
    const tete = abondement.mensuel > 0.5
      ? `Abondement : verse ${eur(abondement.mensuel)} par mois sur ${ou}. Ton employeur ajoute ${eur(abondement.abondementAn / 12)} par mois, soit ${eur(abondement.abondementAn)} par an`
      : `Abondement : en plaçant ton intéressement sur ${ou}, ton employeur ajoute ${eur(abondement.abondementAn)} par an`;
    out.push({ niveau: "action", fiche: "epargne-salariale", texte: `${tete} (${eur(abondement.net)} après CSG et CRDS, sans impôt sur le revenu). C'est de l'argent offert : un rendement immédiat de ${Math.round(abondement.taux)} % avant même d'investir.${abondement.mensuel > 0.5 ? " À faire avant tout autre placement en bourse." : " Ton intéressement suffit à le toucher en entier : pas besoin de verser en plus."}${parInter}${abondement.complet ? "" : ` Pour toucher tout l'abondement (${eur(abondement.plafond)} par an), il faudrait verser ${eur(abondement.versementAn / 12)} par mois.`}${abondement.surPER ? " Tes versements volontaires y sont aussi déductibles de ton revenu, comme sur un PER individuel." : " L'argent est bloqué 5 ans (sauf achat de la résidence principale et quelques autres cas)."} Choisis le fonds d'actions monde aux frais les plus bas.` });
  }
  const inter = Math.max(0, Number(A.interessement) || 0);
  if (acces === "?" && !["independant", "etudiant", "retraite"].includes(profil.statutPro)) {
    out.push({ niveau: "action", fiche: "epargne-salariale", texte: "Épargne salariale : vérifie si ton entreprise propose un PEE ou un PER d'entreprise (ex-PERCO), et si elle ajoute de l'argent à tes versements (abondement). C'est souvent le meilleur placement auquel tu as droit, et c'est obligatoire dans les entreprises d'au moins 50 salariés. Regarde ton livret d'épargne salariale, ta fiche de paie ou demande aux RH, puis indique-le dans « Mon profil », bloc « Ton employeur »." });
  } else if (acces !== "non" && acces !== "?" && inter > 0) {
    const gain = (inter * tmiN) / 100;
    out.push(A.placer !== false
      ? { niveau: "action", fiche: "epargne-salariale", texte: `Intéressement et participation (environ ${eur(inter)} par an) : à chaque avis, tu as 15 jours pour choisir. Place-les sur ${abondement?.interessement > 0 ? (abondement.surPER ? "ton PER d'entreprise" : "ton PEE") : lieuES}${gain > 0.5 ? ` : environ ${eur(gain)} d'impôt sur le revenu en moins chaque année (tranche à ${tmiN} %)` : " : pas d'impôt sur le revenu"}, seulement 9,7 % de CSG et CRDS. Sans réponse, l'intéressement part sur le PEE et la moitié de la participation sur le PER d'entreprise.` }
      : { niveau: "info", fiche: "epargne-salariale", texte: `Tu reçois ton intéressement et ta participation (environ ${eur(inter)} par an) : ils sont imposés comme ton salaire.${gain > 0.5 ? ` Les placer sur ${lieuES} t'éviterait environ ${eur(gain)} d'impôt par an.` : ""} Le plan ne les compte pas dans ton épargne.` });
  }
  if ((acces === "per" || acces === "les2") && per?.actif) {
    out.push({ niveau: "info", fiche: "epargne-salariale", texte: "Tu as un PER d'entreprise : tes versements volontaires y sont déductibles exactement comme sur un PER individuel (même plafond). Si ses fonds sont bons et ses frais bas (souvent payés par l'employeur), tu peux y faire le versement PER du plan au lieu d'ouvrir un PER individuel." });
  }
  if (acces !== "non" && acces !== "?" && !abondement) {
    out.push({ niveau: "info", fiche: "epargne-salariale", texte: `Sans abondement, ${lieuES} sert surtout à placer l'intéressement et la participation sans impôt sur le revenu. Pour tes versements, le PEA fait aussi bien, avec plus de choix et sans blocage.` });
  }
  if ((profil.placements?.epargneSalariale ?? 0) > 0) {
    out.push({ niveau: "info", fiche: "epargne-salariale", texte: "Ton épargne salariale : vérifie dans ton espace en ligne sur quels fonds elle est placée. Le fonds monétaire, souvent choisi par défaut, ne rapporte presque rien à long terme ; pour l'argent de long terme, un fonds d'actions monde aux frais bas. Le changement (arbitrage) est en général gratuit." });
  }
  const peaPlafond = plan.enveloppes.pea?.plafond;
  const bourseCible = alloc.bourse > 0;

  const E = plan.etablissements ?? {};
  const France = resideEnFrance(profil);
  if (!France) {
    const P = paysDe(plan, profil);
    out.push({ niveau: "alerte", fiche: "etranger", texte: `Résidence fiscale : ${P.libelle ?? "hors de France"}. Les comptes réservés aux résidents français (${(plan.residence?.reserveesFrance ?? []).map((e) => plan.enveloppes[e]?.libelle?.split(" (")[0] ?? e).join(", ")}) ne reçoivent plus d'argent neuf ; ceux déjà ouverts sont conservés. Gains imposés dans le pays de résidence, environ ${pct(P.impotGains)} dans le plan (approximation à vérifier sur place).` });
    if (P.equivalents) out.push({ niveau: "info", fiche: "etranger", texte: `Équivalents locaux à étudier : ${P.equivalents}.` });
  }
  if (alloc.bourse > 0.5 && (plan.investissementBourse ?? []).length) {
    out.push({ niveau: "action", fiche: "pea", texte: `Part bourse : acheter ${plan.investissementBourse.map((x) => `${pct(x.part)} ${x.nom}`).join(" et ")}, chaque mois, sur ${France ? "le PEA en priorité" : "le compte-titres ou l'assurance-vie"}.` });
  }
  const lep = plan.lep;
  const LE = France && lep && (profil.salaireNetMensuel ?? 0) > 0 ? lepEstime(plan, profil) : null;
  if (LE && profil.eligibleLEP && LE.etonnant) out.push({ niveau: "alerte", fiche: "lep", texte: `« Éligible au LEP » est coché, mais c'est étonnant : avec ton salaire, ton revenu fiscal de référence serait d'environ ${eur(LE.rfr)}, au-dessus du plafond de ${eur(LE.seuil)} pour ton foyer (${String(LE.parts).replace(".", ",")} part${LE.parts > 1 ? "s" : ""}). Le LEP se juge sur l'avis d'impôt d'une des deux années précédentes : si tes revenus étaient plus bas, c'est possible ; sinon, la banque refusera l'ouverture. Vérifie ton avis d'impôt ou décoche la case.` });
  if (LE && !profil.eligibleLEP) {
    const seuil = LE.seuil;
    if (LE.probable) out.push({ niveau: "info", fiche: "lep", texte: `Tu as peut-être droit au LEP (2,5 %, sans impôt) : revenu fiscal de référence au plus ${eur(seuil)} pour ton foyer (le tien serait d'environ ${eur(LE.rfr)}). Vérifie sur ton avis d'impôt et coche « Éligible au LEP » si c'est le cas.` });
  }
  if (France && profil.eligibleLEP && plan.enveloppes.lep) {
    const n = profil.personnes ?? 1;
    const place = Math.max(0, plan.enveloppes.lep.plafond * n - (profil.placements?.lep ?? 0));
    const sources = ["livretBancaire", "ldds", "livretA"].filter((e) => (profil.placements?.[e] ?? 0) > 0);
    const dispo = sources.reduce((t, e) => t + (profil.placements?.[e] ?? 0), 0);
    const m = Math.min(place, dispo);
    if (m > 0.5) out.push({ niveau: "action", fiche: "lep", texte: `LEP : y transférer ${eur(m)} depuis ${sources.map((e) => plan.enveloppes[e].libelle.split(" (")[0]).join(", ")} (dans cet ordre). Il rapporte plus que les autres livrets, sans impôt, et reste disponible à tout moment.` });
  }
  // Livret Jeune (12 à 25 ans)
  if (France && plan.enveloppes.livretJeune) {
    const lj = profil.placements?.livretJeune ?? 0;
    const agePers = profil.agePrincipal ?? profil.age;
    if (profil.jeune && lj <= 0) out.push({ niveau: "action", fiche: "livret-jeune", texte: `Livret Jeune : tu y as droit jusqu'à 25 ans. L'ouvrir et le remplir avant le Livret A : ${eur(plan.enveloppes.livretJeune.plafond)} au plus, sans impôt, à un taux jamais inférieur à celui du Livret A (souvent 2 à 4 % selon la banque).` });
    if (lj > 0 && agePers >= 25) out.push({ niveau: "info", fiche: "livret-jeune", texte: `Livret Jeune : il est fermé au plus tard à la fin de l'année de tes 25 ans. L'argent revient alors sur ton compte : le placer sur le Livret A ou le LDDS.` });
  }
  // Plafonds de garantie (faillite d'une banque ou d'un assureur)
  const G = plan.garanties ?? {};
  const pl = profil.placements ?? {};
  const n = profil.personnes ?? 1;
  const av = (pl.assuranceVie ?? 0) + (pl.assuranceVieUC ?? 0);
  if (G.assuranceParAssureur && av > G.assuranceParAssureur * n) out.push({ niveau: "alerte", fiche: "risques", texte: `Assurance-vie : ${eur(av)}. La garantie en cas de faillite de l'assureur est de ${eur(G.assuranceParAssureur)} par personne et par assureur : si tout est chez le même assureur, verser la suite sur un contrat d'un autre assureur.` });
  const depots = (pl.livretBancaire ?? 0) + (pl.pel ?? 0);
  if (G.depotsParBanque && depots > G.depotsParBanque * n) out.push({ niveau: "alerte", fiche: "risques", texte: `Livret bancaire et PEL : ${eur(depots)}. La garantie en cas de faillite est de ${eur(G.depotsParBanque)} par personne et par banque (compte courant compris) : répartir entre plusieurs banques.` });
  // Logement déjà détenu
  if (profil.proprietaire) {
    const L = profil.logement ?? {};
    const part = L.part > 0 ? Math.min(100, L.part) : 100;
    if (!(L.valeur > 0)) out.push({ niveau: "info", fiche: "residence", texte: "Propriétaire : indique la valeur estimée de ton logement dans « Mon profil » (l'estimation par lieu et surface peut t'aider) pour qu'il compte dans ton patrimoine." });
    if (L.origine === "heritage" || L.origine === "donation") out.push({ niveau: "info", fiche: "residence", texte: `Logement reçu par ${L.origine === "heritage" ? "héritage" : "donation"} : en cas de vente, la plus-value se calcule à partir de la valeur indiquée dans ${L.origine === "heritage" ? "la déclaration de succession" : "l'acte de donation"}. Garde bien ce document.` });
    if (part < 100) out.push({ niveau: "info", fiche: "residence", texte: `Logement détenu à ${part} % (indivision) : le louer ou le gérer demande en principe l'accord des propriétaires qui détiennent au moins deux tiers des parts, et le vendre l'accord de tous. Chacun peut demander à sortir de l'indivision.` });
    if ((L.usage ?? "rp") !== "rp") out.push({ niveau: "info", fiche: "residence", texte: "Ce logement n'est pas ta résidence principale : sa plus-value à la revente sera imposée (19 % d'impôt plus les prélèvements sociaux, avec un abattement qui augmente avec la durée de détention : plus d'impôt après 22 ans, plus de prélèvements sociaux après 30 ans)." });
  }
  if ((profil.placements?.pel ?? 0) > 0) out.push({ niveau: "info", fiche: "pel", texte: "PEL : le garder pour l'achat de la résidence principale (il est compté dans l'apport). Un retrait le clôture : ne pas y toucher avant l'achat, et ne plus l'alimenter au-delà du minimum de 540 € par an." });
  if (bourseCible && peaPlafond && France) {
    const reco = E.pea?.recommande;
    const peaP = profil.peaPrincipal ?? profil.pea;
    if (!peaP?.ouvert) {
      out.push({ niveau: "action", fiche: "pea", video: reco === "Trade Republic" ? "ouverture" : null, texte: `Ouvrir un PEA${profil.couple ? " à ton nom" : ""}${reco ? ` chez ${reco}` : ""} dès maintenant, même avec un petit versement : le délai de 5 ans de l'avantage fiscal démarre à l'ouverture.` });
    } else {
      const etab = peaP.etablissement;
      const ou = etab === "Banque traditionnelle" ? "dans une banque traditionnelle" : etab === "Autre courtier en ligne" ? "chez un autre courtier en ligne" : `chez ${etab}`;
      if (!etab) out.push({ niveau: "info", fiche: "pea", texte: "Indique dans quel établissement est ton PEA pour savoir s'il faut le garder ou le transférer." });
      else if (reco && !(E.pea.aConserver ?? []).includes(etab)) {
        out.push({ niveau: "action", fiche: "pea", video: reco === "Trade Republic" ? "transfert" : null, texte: `PEA ${ou} : le transférer chez ${reco}. L'ancienneté est conservée ; pendant le transfert (souvent 1 à 4 mois), laisser l'épargne prévue pour la bourse sur le livret.` });
        if (etab === "Banque traditionnelle") out.push({ niveau: "action", fiche: "pea", texte: "Avant le transfert, vendre dans le PEA les fonds « maison » de la banque (non transférables) : aucun impôt tant que l'argent reste dans le PEA." });
      } else out.push({ niveau: "info", fiche: "pea", texte: `PEA ${ou} : à conserver.` });
      const v = peaP.versements ?? 0;
      const taux = (100 * v) / peaPlafond;
      out.push({ niveau: taux >= 90 ? "alerte" : "info", fiche: "pea", texte: `PEA : ${eur(v)} versés sur ${eur(peaPlafond)} (${pct(taux)}). Reste ${eur(Math.max(0, peaPlafond - v))} de versements possibles.` });
      const age = anneesDepuis(peaP.dateOuverture);
      if (age != null) {
        const [an, mois] = peaP.dateOuverture.split("-").map(Number);
        const date = new Date(an + 5, (mois || 1) - 1, 1).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
        out.push({ niveau: "info", fiche: "pea", texte: age >= 5
          ? "PEA de plus de 5 ans : gains exonérés d'impôt sur le revenu (prélèvements sociaux dus), retraits possibles sans clôture."
          : `Avantage fiscal du PEA acquis en ${date}. Aucun retrait avant : il clôturerait le PEA.` });
      }
    }
  }
  // Couple : PEA du conjoint, plafonds doublés, abattements
  if (profil.couple) {
    const c = profil.conjoint ?? {}, nom = c.prenom || "ton conjoint";
    const reco = E.pea?.recommande;
    if (bourseCible && peaPlafond && France) {
      if (!c.pea?.ouvert) out.push({ niveau: "action", fiche: "pea", texte: `Ouvrir aussi un PEA au nom de ${nom}${reco ? ` chez ${reco}` : ""} : le plafond du foyer passe à 2 × ${eur(peaPlafond)} et son délai de 5 ans commence.` });
      else {
        const etab = c.pea.etablissement;
        if (etab && reco && !(E.pea.aConserver ?? []).includes(etab)) out.push({ niveau: "action", fiche: "pea", texte: `PEA de ${nom} ${etab === "Banque traditionnelle" ? "dans une banque traditionnelle" : `chez ${etab}`} : le transférer chez ${reco} (l'ancienneté est conservée).` });
        const a = anneesDepuis(c.pea.dateOuverture);
        if (a != null && a < 5) out.push({ niveau: "info", fiche: "pea", texte: `PEA de ${nom} : aucun retrait avant ses 5 ans.` });
      }
    }
    out.push({ niveau: "info", fiche: "livrets", texte: "En couple, chacun peut avoir son Livret A et son LDDS : le plan compte des plafonds doublés pour le foyer." });
    if (!profil.marie && per?.actif) out.push({ niveau: "info", fiche: "per", texte: `En concubinage, chacun a son propre plafond PER : les versements conseillés se font au nom de la personne dont la tranche d'imposition est indiquée.` });
  }

  // Assurance-vie : type de contrat
  const avDetenue = (profil.placements?.assuranceVie ?? 0) + (profil.placements?.assuranceVieUC ?? 0) > 0;
  const avCible = lignes.some((l) => (l.enveloppe === "assuranceVie" || l.enveloppe === "assuranceVieUC") && l.montant > 0.5);
  const recoAV = E.assuranceVie?.recommande;
  if (!avDetenue && avCible) {
    out.push({ niveau: "action", fiche: "assurance-vie", texte: `Ouvrir une assurance-vie en ligne en gestion libre${recoAV ? ` (par exemple ${recoAV})` : ""} : 0 % de frais sur versement et des frais de gestion autour de 0,5 % par an.` });
  } else if (avDetenue) {
    const type = profil.assuranceVie?.type;
    if (!type) out.push({ niveau: "info", fiche: "assurance-vie", texte: "Indique le type de ton contrat d'assurance-vie pour vérifier ses frais." });
    else if (type === "Gestion pilotée en ligne") out.push({ niveau: "info", fiche: "assurance-vie", texte: "Gestion pilotée : c'est le gestionnaire qui choisit la répartition, pas ton plan, et les frais sont plus élevés. Pour suivre le plan, préférer la gestion libre." });
    else if (!(E.assuranceVie?.aConserver ?? []).includes(type)) out.push({ niveau: "action", fiche: "assurance-vie", texte: `Ton assurance-vie actuelle (${type.toLowerCase()}) : la garder pour son ancienneté, mais ne plus l'alimenter s'il prend des frais sur versement. Ouvrir un contrat en ligne${recoAV ? ` (par exemple ${recoAV})` : ""} pour les nouveaux versements.` });
  }
  if (avDetenue && profil.assuranceVie?.dateOuverture) {
    const age = anneesDepuis(profil.assuranceVie.dateOuverture);
    if (age != null && age < 8) out.push({ niveau: "info", fiche: "assurance-vie", texte: `Assurance-vie de moins de 8 ans : en cas de rachat, fiscalité moins favorable qu'après ${Math.ceil(8 - age)} an(s) supplémentaires.` });
    if (profil.couple && profil.marie) out.push({ niveau: "info", fiche: "assurance-vie", texte: "Couple marié ou pacsé : après 8 ans, l'abattement sur les gains retirés est de 9 200 € par an au lieu de 4 600 €." });
  }

  const etape = plan.remplissage.bitcoin?.find((e) => typeof e === "object" && e.max != null);
  const surPlateforme = profil.placements?.plateformeCrypto ?? 0;
  // Ne transférer que le bitcoin que le plan garde (le reste sera vendu par le rééquilibrage)
  const aTransferer = etape ? Math.min(surPlateforme, alloc.bitcoin ?? 0) - etape.max : 0;
  if (etape && aTransferer > 0.5) {
    out.push({ niveau: "action", fiche: "bitcoin", texte: `Bitcoin : ${eur(surPlateforme)} sur la plateforme. En garder au plus ${eur(etape.max)} et transférer ${eur(aTransferer)} sur un portefeuille matériel (cold wallet).` });
  }

  const seuilBtc = seuilAchatBitcoin(plan);
  if (seuilBtc && (alloc.bitcoin ?? 0) > 0.5) {
    const b = plan.bitcoin;
    out.push({ niveau: "action", fiche: "bitcoin", texte: `Bitcoin : acheter un petit montant chaque mois (DCA), mais seulement quand son cours est au moins ${b.baisseMinPourAcheter} % sous son record (${usd(b.recordDollars)}${b.dateRecord ? ` le ${new Date(b.dateRecord + "T12:00").toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}` : ""}), soit sous ${usd(seuilBtc)}. Au-dessus, l'argent prévu pour le bitcoin attend sur le livret. Vérifie le cours en dollars avant chaque achat (ton appli l'affiche souvent en euros : regarde aussi le cours BTC/USD).` });
  }
  for (const [c, seuil] of Object.entries(plan.flux.seuilsAchat ?? {})) {
    if (alloc[c] > 0) out.push({ niveau: "info", fiche: c, texte: `${plan.classes[c].libelle} : l'épargne destinée à cette classe s'accumule sur le livret et on achète par tranche de ${eur(seuil)}.` });
  }

  if (reeq) {
    const lib = (e) => plan.enveloppes[e]?.libelle ?? e;
    const duree = reeq.duree ?? plan.reequilibrage?.dureeMois ?? 12;
    const reduire = reeq.comptes.filter((x) => x.statut === "reduire");
    const alimenter = reeq.comptes.filter((x) => x.statut === "alimenter");
    const garder = reeq.comptes.filter((x) => x.statut === "garder");
    if (reduire.length) out.push({ niveau: "action", texte: `Comptes à réduire progressivement sur ${dureeTexte(duree)} : ${reduire.map((x) => `${lib(x.enveloppe)} (−${eur(-x.ecart)}, environ ${eur(-x.ecart / duree)} par mois)`).join(" ; ")}.` });
    if (alimenter.length) out.push({ niveau: "action", texte: `Comptes à alimenter avec l'épargne du mois : ${alimenter.map((x) => `${lib(x.enveloppe)} (+${eur(x.ecart)})`).join(" ; ")}.` });
    if (garder.length) out.push({ niveau: "info", texte: `Comptes au-dessus de leur cible mais conservés : ${garder.map((x) => `${lib(x.enveloppe)} (${RAISON_BLOCAGE[x.enveloppe] ?? "retrait impossible"})`).join(" ; ")}. On arrête simplement de les alimenter.` });
  }

  if (achat?.aide > 0) out.push({ niveau: "info", fiche: "residence", texte: `Aide familiale de ${eur(achat.aide)} comptée dans l'apport. Un don en argent à un enfant peut être exonéré : 100 000 € par parent tous les 15 ans, plus 31 865 € (don familial, donateur de moins de 80 ans) ; jusqu'au 31 décembre 2026, 100 000 € de plus pour l'achat d'un logement neuf. À déclarer aux impôts.` });
  if (achat && !achat.ideal && !achat.imperatif && achat.serie.length) out.push({ niveau: "alerte", fiche: "residence", texte: `Bien à ${eur(achat.prix)} hors de portée avant ${plan.achatRP.ageMaxFinPret - 1} ans avec ces revenus. Leviers : une aide familiale, un prix plus bas, un achat à deux, ou des revenus plus élevés.` });
  const ch = achat?.choisi;
  if (ch) {
    if (ch.horsLimite || ch.tropTard) out.push({ niveau: "alerte", fiche: "residence", texte: `Achat à ${ch.age} ans : trop tard pour emprunter avec les règles du plan (prêt remboursé avant ${plan.achatRP.ageMaxFinPret} ans).` });
    else if (ch.okAvecPlacements && !ch.ok) out.push({ niveau: "info", fiche: "residence", texte: `Achat à ${ch.age} ans : finançable en vendant environ ${eur(ch.aVendre)} de tes autres placements (bourse, assurance-vie…) en plus des livrets, de l'épargne mise de côté${ch.aide > 0 ? ` et de l'aide familiale (${eur(ch.aide)})` : ""}.` });
    else if (!ch.ok) out.push({ niveau: "alerte", fiche: "residence", texte: `Achat à ${ch.age} ans : budget dépassé. Il manquerait environ ${eur(ch.manqueTotal)} d'apport, même en vendant tes autres placements (${eur(ch.apport)} de livrets, d'épargne${ch.aide > 0 ? ` et d'aide familiale` : ""} et ${eur(ch.aVendre)} de placements, pour ${eur(ch.apportRequis)} nécessaires)${ch.limiteParEndettement ? `, car la banque ne prêterait que ${eur(ch.pretMax)} : la mensualité ne doit pas dépasser ${eur(ch.mensualiteMax)}, soit ${plan.achatRP.tauxEndettementMax} % des revenus` : ""}.${achat.ideal ? ` Âge idéal : ${achat.ideal.age} ans.` : ""}` });
    else out.push({ niveau: "info", fiche: "residence", texte: `Achat à ${ch.age} ans : finançable (apport ${eur(ch.apportRequis)}, prêt de ${eur(ch.pret)} sur ${ch.duree} ans, ${eur(ch.mensualite)} par mois).` });
  }
  if (achat?.imperatif && achat.horizon) {
    const hz = achat.horizon;
    if (hz.manque > 0.5) out.push({ niveau: "alerte", texte: `Achat impératif dans ${hz.annees} an(s) : même en mettant tous les placements mobilisables à l'abri, il manquera environ ${eur(hz.manque)} d'apport. Prix finançable à cette date : ${eur(hz.prixMax)}.` });
    else if (hz.prisSurPlacements > 0.5) out.push({ niveau: "action", fiche: "livrets", texte: `Achat impératif dans ${hz.annees} an(s) : mettre ${eur(hz.prisSurPlacements)} de placements à l'abri en plus des livrets. Le reste de l'apport viendra de l'épargne.` });
    else out.push({ niveau: "info", fiche: "livrets", texte: `Achat impératif dans ${hz.annees} an(s) : les livrets et l'épargne à venir suffisent pour l'apport.` });
    if (hz.bloqueTotal > 0.5) out.push({ niveau: "info", fiche: "pea", texte: `${eur(hz.bloqueTotal)} sur le PEA ne sont pas comptés dans l'apport : un retrait avant 5 ans clôturerait le PEA.` });
  }

  // PER

  if (per) {
    const reco = E.per?.recommande;
    const aUnPER = (profil.placements?.per ?? 0) > 0;
    if (per.raison === "non-resident") { if (aUnPER) out.push({ niveau: "info", fiche: "per", texte: "PER : hors de France, les versements ne sont plus déductibles. Le conserver, sans l'alimenter." }); }
    else if (per.raison === "tmi-inconnue") out.push({ niveau: "info", fiche: "per", texte: "Indique ta tranche marginale d'imposition (sur l'avis d'impôt) pour savoir si un PER est intéressant." });
    else if (per.raison === "refus") out.push({ niveau: "info", fiche: "per", texte: `Pas de PER, comme tu l'as choisi : l'épargne qui y serait allée reste en bourse (PEA, compte-titres, assurance-vie), disponible.${per.economiePossible > 0.5 ? ` Pour information, avec ta tranche à ${per.tmi} %, un PER ferait économiser environ ${eur(per.economiePossible)} d'impôt par an, en échange d'un argent bloqué jusqu'à la retraite (sauf achat de la résidence principale).` : ""}${aUnPER ? " Ton PER actuel est conservé, sans nouveaux versements." : ""}` });
    else if (per.raison === "tmi-faible") out.push({ niveau: "info", fiche: "per", texte: `Tranche d'imposition à ${per.tmi} % : l'avantage du PER est faible${aUnPER ? ", ne pas l'alimenter en priorité" : ", pas de PER pour l'instant"}.` });
    else if (per.raison === "age") out.push({ niveau: "info", fiche: "per", texte: "À partir de 70 ans, les versements sur un PER ne sont plus déductibles." });
    else if (per.actif) out.push({ niveau: "action", fiche: "per", texte: `${aUnPER ? "Verser" : `Ouvrir un PER${reco ? ` (par exemple ${reco})` : ""} et verser`} ${eur(per.mensuel)} par mois, soit ${eur(per.annuel)} par an : environ ${eur(per.economie)} d'impôt en moins chaque année. Plafond de déduction${per.plafondEstime ? " estimé" : ""}${profil.couple && profil.marie ? " du foyer" : ""} : ${eur(per.plafond)} par an. C'est comme si l'État payait ${per.tmi} % de chaque versement.` });
    else if (per.raison === "pas-de-flux-bourse") out.push({ niveau: "info", fiche: "per", texte: "PER intéressant pour ta tranche d'imposition, mais ce mois-ci l'épargne va d'abord à la sécurité et à l'apport : on commencera ensuite." });
  }

  for (const l of lignes) if (!l.enveloppe) out.push({ niveau: "alerte", texte: `${plan.classes[l.classe].libelle} : ${eur(l.montant)} sans compte disponible. Ajoute un compte dans le plan.` });
  return out;
}

// ------------------------------------------------------------- tout calculer
export function analyser(plan, profilSaisi) {
  const C = capitalDe(profilSaisi);
  const base = { ...normaliserFoyer(plan, profilSaisi), capital: C };
  const achat = achatResidence(plan, base);
  const planchers = planchersDe(plan, base, comptesBloques(plan, base));
  const profil = { ...base, planchers, objectifApport: objectifDepuisProjet(plan, base, achat) };
  const { alloc, etapes } = allocationCible(plan, profil);
  const lignes = repartirEnEnveloppes(plan, alloc, profil.placements, profil);
  const actuel = actuelParClasse(plan, alloc, profil.placements ?? {});
  const reeq = reequilibrage(plan, profil);
  const abondement = conseilAbondement(plan, profil, mouvementsDuMois(plan, profil, reeq.mois1));
  const base0 = appliquerAbondement(mouvementsDuMois(plan, profil, reeq.mois1), abondement);
  const per0 = conseilPER(plan, profil, base0);
  // L'abondement voyage avec le conseil PER jusqu'à la projection
  const per = per0 ? { ...per0, abondement } : abondement ? { actif: false, abondement } : null;
  const mouvements = noterBitcoin(plan, noterETF(plan, appliquerPER(base0, per0, plan)));
  const cons = consignes(plan, profil, { alloc, lignes, reeq, achat, per: per0, abondement });
  return { profil, capital: C, alloc, etapes, lignes, actuel, reeq, mouvements, achat, per, abondement, consignes: cons };
}

export { eur, pct };

// ================================================================ Import de relevés (CSV / Excel) et prix de revient
// Fonctions pures : aucune dépendance au DOM, aucun appel réseau. Le fichier est lu localement par app.js et ne quitte jamais le navigateur.

export const TAILLE_MAX_FICHIER = 2 * 1024 * 1024; // 2 Mo
const TAILLE_MAX_XML = 20 * 1024 * 1024; // garde-fou contre les archives piégées (zip bomb)
const LIGNES_MAX = 5000;
const COLONNES_MAX = 100;

// Comptes suivis en prix de revient (PRU) : ceux dont le gain latent a un sens fiscal (PEA, PEA-PME, CTO, assurance-vie, PER)
export const COMPTES_PRU = ["pea", "peaPme", "cto", "assuranceVie", "assuranceVieUC", "per"];
// Le PEA-PME n'a pas d'enveloppe propre dans le plan (plafond commun de 225 000 € avec le PEA) : son solde est compté dans « pea »
export const ENVELOPPE_DE_COMPTE = { peaPme: "pea" };

// Mots-clés des comptes (texte sans accents, minuscules). L'ordre compte : le premier compte reconnu l'emporte (peaPme avant pea).
export const MOTS_COMPTES = [
  ["livretJeune", ["livret jeune"]], ["livretA", ["livret a", "livreta"]], ["ldds", ["ldds", "developpement durable"]], ["lep", ["lep", "epargne populaire"]],
  ["pel", ["pel", "plan epargne logement", "plan d'epargne logement"]], ["livretBancaire", ["super livret", "livret bancaire", "compte sur livret", "csl", "livret+", "livret plus"]],
  ["epargneSalariale", ["pee", "perco", "pereco", "percol", "epargne salariale", "amundi ee", "natixis", "esalia", "epsor"]],
  ["assuranceVieUC", ["unites de compte", "unite de compte", "uc"]], ["assuranceVie", ["assurance vie", "assurance-vie", "fonds euro", "fonds euros", "fonds en euros"]],
  ["peaPme", ["pea pme", "pea-pme", "pea/pme", "peapme"]],
  ["pea", ["pea"]], ["cto", ["compte titres", "compte-titres", "cto"]], ["per", ["per"]], ["scpi", ["scpi"]], ["orPhysique", ["or physique", "lingot", "lingots", "napoleon", "pieces d'or", "or"]],
  ["coldWallet", ["ledger", "trezor", "cold wallet", "portefeuille materiel"]], ["plateformeCrypto", ["bitcoin", "crypto", "coinbase", "binance", "kraken", "bitstack", "bitpanda", "btc"]],
];

const normaliserTexte = (t) => " " + String(t ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[’‘]/g, "'") + " ";
const echapperRegexp = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Identifiant du compte (clé de MOTS_COMPTES) d'après un libellé libre, ou null
export function idCompteDepuisLibelle(libelle) {
  const t = normaliserTexte(libelle);
  const trouve = MOTS_COMPTES.find(([, mots]) => mots.some((m) => new RegExp(`(^|[^a-z0-9+])${echapperRegexp(m)}([^a-z0-9]|$)`).test(t)));
  return trouve ? trouve[0] : null;
}

// Nombre à la française ou à l'anglaise : « 12 345,67 € », « 1.234,56 », « 1,234.56 », « (250) » ; null si ce n'est pas un nombre
export function lireNombre(valeur) {
  if (typeof valeur === "number") return Number.isFinite(valeur) ? valeur : null;
  let s = String(valeur ?? "").replace(/[\s  €$£%]/g, "").replace(/[−–—]/g, "-").replace(/^\((.*)\)$/, "-$1");
  if (!/^[-+]?\d[\d.,]*$/.test(s)) return null;
  const virgule = s.lastIndexOf(","), point = s.lastIndexOf(".");
  if (virgule >= 0 && point >= 0) s = virgule > point ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  else if (virgule >= 0) s = (s.match(/,/g).length > 1 ? s.replace(/,/g, "") : s.replace(",", "."));
  else if (point >= 0 && (s.match(/\./g).length > 1 || /^[-+]?\d{1,3}\.\d{3}$/.test(s))) s = s.replace(/\./g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// Relevé collé en texte : une ligne par compte, nom puis montant (séparateurs ; , tabulation ou espaces)
export function lireReleveColle(texte) {
  const montants = {}, ignores = [];
  for (const brut of String(texte).split(/\r?\n/)) {
    const ligne = brut.trim(); if (!ligne) continue;
    // Montant : le dernier nombre de la ligne (12 345,67 · 12345.67 · 1.234,56 · 12 345 €)
    const nombres = ligne.match(/-?\d[\d\s  .]*(?:,\d+)?/g);
    if (!nombres) { ignores.push(ligne); continue; }
    const brutN = nombres[nombres.length - 1];
    let n = brutN.replace(/[\s  ]/g, "");
    if (/,\d+$/.test(n)) n = n.replace(/\./g, "").replace(",", ".");
    else if (/^\d{1,3}(\.\d{3})+$/.test(n)) n = n.replace(/\./g, "");
    const v = Number(n);
    const id = idCompteDepuisLibelle(ligne.slice(0, ligne.lastIndexOf(brutN)));
    if (!id || !isFinite(v)) { ignores.push(ligne); continue; }
    const env = ENVELOPPE_DE_COMPTE[id] ?? id;
    montants[env] = Math.round(((montants[env] ?? 0) + Math.max(0, v)) * 100) / 100;
  }
  return { montants, ignores };
}

// ---- CSV
function separateurCsv(texte) {
  const lignes = texte.split(/\r?\n/).filter((l) => l.trim()).slice(0, 10);
  const score = { ";": 0, "\t": 0, ",": 0 };
  for (const l of lignes) {
    let guillemets = false;
    for (const c of l) { if (c === '"') guillemets = !guillemets; else if (!guillemets && c in score) score[c]++; }
  }
  return [";", "\t", ","].reduce((m, c) => (score[c] > score[m] ? c : m), ";");
}

export function lireTableauCsv(texte) {
  const t = String(texte).replace(/^﻿/, "");
  const sep = separateurCsv(t);
  const lignes = [];
  let ligne = [], cellule = "", guillemets = false;
  const finCellule = () => { ligne.push(cellule.trim()); cellule = ""; };
  const finLigne = () => { finCellule(); if (ligne.some((c) => c !== "")) lignes.push(ligne.slice(0, COLONNES_MAX)); ligne = []; };
  for (let i = 0; i < t.length && lignes.length < LIGNES_MAX; i++) {
    const c = t[i];
    if (guillemets) {
      if (c === '"') { if (t[i + 1] === '"') { cellule += '"'; i++; } else guillemets = false; } else cellule += c;
    } else if (c === '"') guillemets = true;
    else if (c === sep) finCellule();
    else if (c === "\n") finLigne();
    else if (c !== "\r") cellule += c;
  }
  if (cellule !== "" || ligne.length) finLigne();
  return lignes;
}

// ---- Détection des colonnes : Libellé, Solde (valorisation), Versements cumulés (capital investi)
const RE_COLONNES = {
  verse: /(verse|versement|investi|prix de revient|\bpru\b|apport|depose|cumul)/,
  solde: /(solde|valorisation|encours|valeur (actuelle|totale|de marche|liquidative)|^valeur$|montant|total|estimation|capital actuel|patrimoine)/,
  libelle: /(libelle|compte|support|designation|produit|intitule|\bnom\b|contrat|enveloppe|etablissement|titre|ligne)/,
};

export function detecterColonnes(lignes) {
  for (let i = 0; i < Math.min(15, lignes.length); i++) {
    const cols = {};
    lignes[i].forEach((cellule, j) => {
      const t = normaliserTexte(cellule).trim();
      if (!t || lireNombre(t) !== null) return;
      const role = RE_COLONNES.verse.test(t) ? "verse" : RE_COLONNES.solde.test(t) ? "solde" : RE_COLONNES.libelle.test(t) ? "libelle" : null;
      if (role && cols[role] === undefined) cols[role] = j;
    });
    if (cols.libelle !== undefined && cols.solde !== undefined) return { ligneEntetes: i, colonnes: { libelle: cols.libelle, solde: cols.solde, verse: cols.verse ?? null }, devine: false };
  }
  // Sans en-tête reconnu : première colonne de texte = libellé, dernier nombre de la première ligne de données = solde
  const premiere = lignes.find((l) => l.some((c) => lireNombre(c) !== null));
  if (!premiere) return null;
  const libelle = premiere.findIndex((c) => c && lireNombre(c) === null);
  let solde = -1; premiere.forEach((c, j) => { if (lireNombre(c) !== null) solde = j; });
  if (libelle < 0 || solde < 0) return null;
  return { ligneEntetes: -1, colonnes: { libelle, solde, verse: null }, devine: true };
}

// Lignes de tableau → comptes reconnus { id: { solde, verse|null } } et lignes ignorées
export function importerReleveTableau(lignes) {
  const det = detecterColonnes(lignes);
  if (!det) return { ok: false, erreur: "Aucune colonne « libellé » et « solde » reconnue dans ce fichier." };
  const { colonnes: c } = det;
  const entetes = det.ligneEntetes >= 0 ? lignes[det.ligneEntetes] : [];
  const comptes = {}, ignores = [];
  for (const ligne of lignes.slice(det.ligneEntetes + 1)) {
    const libelle = String(ligne[c.libelle] ?? "").trim();
    const solde = lireNombre(ligne[c.solde]);
    const id = idCompteDepuisLibelle(libelle);
    if (!id || solde === null) { if (ignores.length < 50) ignores.push(libelle || ligne.join(" ; ")); continue; }
    const verse = c.verse === null ? null : lireNombre(ligne[c.verse]);
    const cpt = (comptes[id] ??= { solde: 0, verse: 0, versePartiel: false });
    cpt.solde += Math.max(0, solde);
    if (verse === null) cpt.versePartiel = true; else cpt.verse += Math.max(0, verse);
  }
  const arrondi = (x) => Math.round(x * 100) / 100;
  for (const id of Object.keys(comptes)) {
    const cpt = comptes[id];
    comptes[id] = { solde: arrondi(cpt.solde), verse: c.verse === null || cpt.versePartiel ? null : arrondi(cpt.verse) };
  }
  return {
    ok: true, comptes, ignores, devine: det.devine,
    colonnes: { libelle: entetes[c.libelle] ?? `colonne ${c.libelle + 1}`, solde: entetes[c.solde] ?? `colonne ${c.solde + 1}`, verse: c.verse === null ? null : (entetes[c.verse] ?? `colonne ${c.verse + 1}`) },
  };
}

// Comptes importés → montants pour les enveloppes du plan + capital versé déclaré (pour le PRU)
export function releveDepuisImport(comptes) {
  const montants = {}, pru = {};
  for (const [id, { solde, verse }] of Object.entries(comptes ?? {})) {
    const env = ENVELOPPE_DE_COMPTE[id] ?? id;
    montants[env] = Math.round(((montants[env] ?? 0) + solde) * 100) / 100;
    if (!COMPTES_PRU.includes(id)) continue;
    const entree = {};
    if (verse !== null && verse !== undefined) entree.verse = verse;
    if (id === "peaPme") entree.solde = solde;
    if (Object.keys(entree).length) pru[id] = entree;
  }
  return { montants, pru };
}

// ---- Excel (.xlsx) : archive zip de XML, lue sans dépendance avec DecompressionStream
async function inflaterBrut(octets, tailleMax) {
  const lecteur = new Blob([octets]).stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader();
  const morceaux = []; let total = 0;
  for (;;) {
    const { done, value } = await lecteur.read();
    if (done) break;
    total += value.length;
    if (total > tailleMax) { await lecteur.cancel(); throw new Error("Classeur Excel trop volumineux une fois décompressé."); }
    morceaux.push(value);
  }
  const out = new Uint8Array(total); let p = 0;
  for (const m of morceaux) { out.set(m, p); p += m.length; }
  return out;
}

function entreesZip(buf) {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const invalide = () => new Error("Ce fichier n'est pas un classeur .xlsx valide.");
  let fin = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) if (v.getUint32(i, true) === 0x06054b50) { fin = i; break; }
  if (fin < 0) throw invalide();
  const n = v.getUint16(fin + 10, true);
  let p = v.getUint32(fin + 16, true);
  if (n > 1000 || n === 0xffff || p === 0xffffffff) throw new Error("Classeur Excel non pris en charge (zip64).");
  const entrees = new Map();
  for (let i = 0; i < n; i++) {
    if (p + 46 > buf.length || v.getUint32(p, true) !== 0x02014b50) throw invalide();
    const lNom = v.getUint16(p + 28, true), lExtra = v.getUint16(p + 30, true), lCom = v.getUint16(p + 32, true);
    const nom = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + lNom));
    entrees.set(nom, { chiffre: !!(v.getUint16(p + 8, true) & 1), methode: v.getUint16(p + 10, true), taille: v.getUint32(p + 20, true), tailleOrig: v.getUint32(p + 24, true), local: v.getUint32(p + 42, true) });
    p += 46 + lNom + lExtra + lCom;
  }
  return entrees;
}

async function lireEntreeZip(buf, entrees, nom) {
  const e = entrees.get(nom);
  if (!e) return null;
  if (e.chiffre || (e.methode !== 0 && e.methode !== 8)) throw new Error("Classeur Excel protégé ou non pris en charge.");
  if (e.tailleOrig > TAILLE_MAX_XML) throw new Error("Classeur Excel trop volumineux une fois décompressé.");
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (e.local + 30 > buf.length || v.getUint32(e.local, true) !== 0x04034b50) throw new Error("Ce fichier n'est pas un classeur .xlsx valide.");
  const debut = e.local + 30 + v.getUint16(e.local + 26, true) + v.getUint16(e.local + 28, true);
  const donnees = buf.subarray(debut, debut + e.taille);
  const brut = e.methode === 0 ? donnees : await inflaterBrut(donnees, TAILLE_MAX_XML);
  return new TextDecoder().decode(brut);
}

const decoderXml = (s) => s.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const attributXml = (balise, nom) => balise.match(new RegExp(`\\b${nom}="([^"]*)"`))?.[1];
const textesXml = (xml) => [...xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "").matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => decoderXml(m[1])).join("");
const indexColonne = (ref) => [...ref.replace(/\d+$/, "")].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;

// Première feuille d'un classeur .xlsx → tableau de lignes (texte ou nombres)
export async function lireXlsx(octets) {
  const buf = octets instanceof Uint8Array ? octets : new Uint8Array(octets);
  const entrees = entreesZip(buf);
  const classeur = await lireEntreeZip(buf, entrees, "xl/workbook.xml");
  if (classeur === null) throw new Error("Ce fichier n'est pas un classeur .xlsx valide.");
  let chemin = "xl/worksheets/sheet1.xml";
  const idFeuille = attributXml(classeur.match(/<sheet\b[^>]*>/)?.[0] ?? "", "r:id");
  const rels = await lireEntreeZip(buf, entrees, "xl/_rels/workbook.xml.rels");
  if (idFeuille && rels) {
    for (const [balise] of rels.matchAll(/<Relationship\b[^>]*>/g)) {
      if (attributXml(balise, "Id") === idFeuille) {
        const cible = attributXml(balise, "Target") ?? "";
        chemin = cible.startsWith("/") ? cible.slice(1) : `xl/${cible}`;
      }
    }
  }
  const feuille = await lireEntreeZip(buf, entrees, chemin);
  if (feuille === null) throw new Error("Aucune feuille lisible dans ce classeur.");
  const partages = [];
  const xmlPartages = await lireEntreeZip(buf, entrees, "xl/sharedStrings.xml");
  if (xmlPartages) for (const m of xmlPartages.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) partages.push(textesXml(m[1]));
  const lignes = [];
  for (const [, , corpsLigne] of feuille.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    if (!corpsLigne) continue;
    const ligne = [];
    for (const [, attrs, corps = ""] of corpsLigne.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = attributXml(attrs, "r"), type = attributXml(attrs, "t");
      const j = ref ? indexColonne(ref) : ligne.length;
      if (j < 0 || j >= COLONNES_MAX) continue;
      const v = corps.match(/<v\b[^>]*>([\s\S]*?)<\/v>/)?.[1];
      let valeur = "";
      if (type === "s") valeur = partages[Number(v)] ?? "";
      else if (type === "inlineStr") valeur = textesXml(corps);
      else if (type === "str" || type === "b") valeur = decoderXml(v ?? "");
      else if (type !== "e" && v !== undefined && v !== "") valeur = Number.isFinite(Number(v)) ? Number(v) : decoderXml(v);
      while (ligne.length < j) ligne.push("");
      ligne[j] = typeof valeur === "string" ? valeur.trim() : valeur;
    }
    if (ligne.some((c) => c !== "")) lignes.push(ligne);
    if (lignes.length >= LIGNES_MAX) break;
  }
  return lignes;
}

// Fichier d'export (octets + nom) → comptes reconnus. Lève une Error au message lisible par l'utilisateur.
export async function lireFichierReleve(nom, octets) {
  const buf = octets instanceof Uint8Array ? octets : new Uint8Array(octets);
  if (buf.length > TAILLE_MAX_FICHIER) throw new Error("Fichier trop volumineux : 2 Mo maximum.");
  if (!buf.length) throw new Error("Le fichier est vide.");
  const ext = String(nom).toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
  let lignes;
  if (ext === "xls") throw new Error("Ancien format Excel (.xls) non pris en charge : enregistre le fichier en .xlsx ou en .csv.");
  if (ext === "xlsx") {
    if (buf[0] !== 0x50 || buf[1] !== 0x4b) throw new Error("Ce fichier n'est pas un classeur .xlsx valide.");
    lignes = await lireXlsx(buf);
  } else if (["csv", "tsv", "txt", ""].includes(ext)) {
    let texte;
    try { texte = new TextDecoder("utf-8", { fatal: true }).decode(buf); } catch { texte = new TextDecoder("windows-1252").decode(buf); }
    lignes = lireTableauCsv(texte);
  } else throw new Error("Format non pris en charge : utilise un fichier .csv ou .xlsx.");
  const r = importerReleveTableau(lignes);
  if (!r.ok) throw new Error(r.erreur);
  return r;
}

// ---- Prix de revient (PRU) et plus-values latentes
export const ecartMois = (a, b) => { const [y1, m1] = a.split("-").map(Number), [y2, m2] = b.split("-").map(Number); return (y2 - y1) * 12 + (m2 - m1); };

function soldeDuCompte(releve, id) {
  const pl = releve.placements ?? {}, peaPme = Number(releve.pru?.peaPme?.solde) || 0;
  if (id === "peaPme") return peaPme;
  if (id === "pea") return Math.max(0, (Number(pl.pea) || 0) - peaPme);
  return Number(pl[id]) || 0;
}

// Capital versé et gain latent par compte.
//  - capital déclaré (colonne « versements cumulés » du fichier) : utilisé tel quel au dernier relevé qui le donne ;
//  - sinon estimé : solde du premier relevé (gain supposé nul à cette date) + versements programmés du plan × mois écoulés.
// versementsMensuels : { idCompte: euros par mois } d'après le plan. Gain avant impôt et prélèvements sociaux.
export function calculerPRU(releves, versementsMensuels = {}) {
  const liste = (releves ?? []).filter((r) => r?.date).slice().sort((a, b) => a.date.localeCompare(b.date));
  if (!liste.length) return { comptes: [], total: null };
  const der = liste.length - 1;
  const comptes = [];
  for (const id of COMPTES_PRU) {
    const solde = soldeDuCompte(liste[der], id);
    if (solde <= 0.5) continue;
    let k = -1;
    for (let i = der; i >= 0; i--) if (liste[i].pru?.[id]?.verse != null && Number.isFinite(Number(liste[i].pru[id].verse))) { k = i; break; }
    const declare = k >= 0;
    if (!declare) k = 0;
    let verse = declare ? Math.max(0, Number(liste[k].pru[id].verse)) : soldeDuCompte(liste[0], id);
    const estime = !declare || k < der;
    if (estime) verse += Math.max(0, Number(versementsMensuels[id]) || 0) * Math.max(0, ecartMois(liste[k].date, liste[der].date));
    const connu = verse > 0.5 && (declare || der > 0);
    const pv = connu ? solde - verse : null;
    comptes.push({ id, solde, verse: connu ? verse : null, pv, pvPct: connu ? (100 * pv) / verse : null, estime, depuis: liste[k].date });
  }
  const connus = comptes.filter((c) => c.pv !== null);
  const total = connus.length ? (() => {
    const solde = connus.reduce((s, c) => s + c.solde, 0), verse = connus.reduce((s, c) => s + c.verse, 0);
    return { solde, verse, pv: solde - verse, pvPct: verse > 0 ? (100 * (solde - verse)) / verse : null, complet: connus.length === comptes.length, estime: connus.some((c) => c.estime) };
  })() : null;
  return { comptes, total };
}
