// =====================================================================
//  CENTRE D'ALERTES PROACTIVES (phase 1) — pur, aucun DOM, aucun accès au stockage.
//  Trois détecteurs : livrets au plafond, dérive d'allocation, approche des 70 ans
//  (assurance-vie, art. 990 I / 757 B). Calcul local à l'ouverture et après chaque
//  changement du plan : aucun cron, aucune notification système (local-first).
//  La date est injectée (`aujourdhui`) ; ni `plan` ni `profil` ne sont jamais modifiés.
//  Les plafonds et abattements viennent de fiscal.js (fiscalite/2026.js), jamais codés ici.
// =====================================================================

import { PLAFONDS, AV_DECES, MARCHE, PLUS_VALUES } from "./fiscal.js";
import { analyser, reequilibrage, eur, pct, equilibreContributions } from "./moteur.js";
import { prevuA, moisEntre } from "./projection.js";

// Réglage d'interface (pas une règle fiscale) : écart maximal toléré entre l'allocation actuelle et la cible, en part du patrimoine
export const SEUIL_DERIVE = 0.05;

// Seuil applicatif (non réglementaire) : écart mensuel entre ce que paie un conjoint et sa part proportionnelle aux revenus
export const SEUIL_DESEQUILIBRE = { euros: 150, part: 0.10 };

const RANG_NIVEAU = { alerte: 0, action: 1, info: 2 };
const LIVRETS = ["livretA", "ldds", "lep"];
const FICHE_AV = "assurance-vie";

const solde = (profil, id) => Number(profil?.placements?.[id]) || 0;
const libelle = (plan, id) => plan?.enveloppes?.[id]?.libelle ?? id;
const annee = (d) => d.getFullYear();
const moisCle = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const pluriel = (n, mot) => `${n} ${mot}${n > 1 ? "s" : ""}`;
// Plafonds « par personne » doublés pour un foyer à deux, comme dans moteur.js
const nbPersonnes = (profil) => (profil?.foyer?.actif && !(profil.foyer.statut === "concubin" && profil.foyer.vue === "moi") ? 2 : 1);

// Enveloppe vers laquelle le plan oriente les prochains versements : la plus alimentée au premier mois du plan
// (hors le livret plein), sinon la suivante dans l'ordre de remplissage des enveloppes.
function enveloppeSuivante(plan, id, analyse) {
  const versements = Object.entries(analyse?.reeq?.mois1?.versements ?? {}).filter(([e, v]) => e !== id && v > 0.5).sort((a, b) => b[1] - a[1]);
  if (versements.length) return libelle(plan, versements[0][0]);
  const ordre = Object.keys(plan?.enveloppes ?? {});
  const suivante = ordre.slice(ordre.indexOf(id) + 1).find((e) => plan.enveloppes[e]?.nouveauxVersements !== false);
  return suivante ? libelle(plan, suivante) : null;
}

/** Livrets (Livret A, LDDS, LEP s'il est présent) dont le solde atteint le plafond. `analyse` : résultat d'analyser(), facultatif. */
export function livretsPleins(plan, profil, aujourdhui = new Date(), analyse = null) {
  const out = [];
  const personnes = nbPersonnes(profil);
  for (const compte of LIVRETS) {
    const plafond = (Number(PLAFONDS[compte]) || 0) * personnes;
    const s = solde(profil, compte);
    if (plafond <= 0 || s < plafond) continue;
    const nom = libelle(plan, compte).replace(/ \(.*\)$/, "");
    const suite = enveloppeSuivante(plan, compte, analyse);
    const excedent = s - plafond;
    // Aucun versement mensuel n'est programmé par compte dans le profil (seule l'épargne mensuelle globale existe) :
    // l'alerte est donc informative ; le plan oriente les prochains versements ailleurs.
    out.push({
      id: `livret-${compte}`,
      cle: `${compte}:${annee(aujourdhui)}`,
      niveau: "info",
      min: null,
      titre: `${nom} au plafond`,
      texte: `Le plafond de ${eur(plafond)} est atteint : tout nouveau versement est refusé. Les intérêts capitalisés au-delà du plafond restent acquis et rémunérés${excedent > 0.5 ? ` (excédent actuel : ${eur(excedent)})` : ""}. Le plan oriente les prochains versements vers ${suite ? `« ${suite} »` : "une autre enveloppe"}.`,
      vue: "reequilibrage",
      fiche: plan?.enveloppes?.[compte]?.fiche,
    });
  }
  return out;
}

/** Écart entre la répartition actuelle par enveloppe et la cible du plan (ecart = cible − actuel, en euros). */
export function derive(plan, profil, aujourdhui = new Date(), analyse = null) {
  const reeq = analyse?.reeq ?? reequilibrage(plan, profil);
  const comptes = reeq?.comptes ?? [];
  const total = comptes.reduce((s, c) => s + (Number(c.actuel) || 0), 0);
  if (!(total > 0)) return [];
  const pts = (c) => (-c.ecart / total) * 100; // > 0 : surpondéré ; < 0 : sous-pondéré
  const ecartMax = Math.max(...comptes.map((c) => Math.abs(c.ecart)));
  if (ecartMax / total < SEUIL_DERIVE) return [];
  const haut = comptes.reduce((a, c) => (pts(c) > pts(a) ? c : a), comptes[0]);
  const bas = comptes.reduce((a, c) => (pts(c) < pts(a) ? c : a), comptes[0]);
  const signe = (x) => `${x >= 0 ? "+" : "−"}${Math.abs(Math.round(x))} pts`;
  const morceaux = [];
  if (pts(haut) >= 0.5) morceaux.push(`${libelle(plan, haut.enveloppe)} ${signe(pts(haut))}`);
  if (pts(bas) <= -0.5) morceaux.push(`${libelle(plan, bas.enveloppe)} ${signe(pts(bas))}`);
  const sansVente = (reeq.aDeplacer ?? 0) <= 0.5 && !Object.keys(reeq.mois1?.retraits ?? {}).length;
  const duree = reeq.moisEquilibre != null
    ? ` Équilibre retrouvé en ~${reeq.moisEquilibre} mois${sansVente ? " en orientant vos prochains versements, sans rien vendre" : " avec les versements et les arbitrages du plan"}.`
    : "";
  // Un compte surpondéré qui ne peut pas être réduit (bloqué) rend l'écart plus durable : alerte, avec l'explication du moteur
  const bloque = haut.statut === "garder" && pts(haut) / 100 >= SEUIL_DERIVE;
  return [{
    id: "derive",
    cle: `derive:${moisCle(aujourdhui)}`,
    niveau: bloque ? "alerte" : "action",
    min: "intermediaire",
    titre: "Votre répartition s'écarte de la cible",
    texte: `${morceaux.join(", ")}.${duree}${bloque && haut.texte ? ` ${libelle(plan, haut.enveloppe)} : ${haut.texte}.` : ""}`.trim(),
    vue: "reequilibrage",
  }];
}

/** Fenêtre de quelques années avant 70 ans : primes d'assurance-vie sous l'art. 990 I (assuré, puis conjoint s'il existe). */
export function av70(profil) {
  const pivot = Number(AV_DECES.AGE_PIVOT);
  const out = [];
  const regarder = (age, id, sujet) => {
    if (!Number.isFinite(age) || !(age >= pivot - 4 && age < pivot)) return;
    const reste = Math.max(1, Math.round(pivot - age));
    out.push({
      id,
      cle: `${id}:${age}`,
      niveau: "info",
      min: "intermediaire",
      titre: `Assurance-vie : la limite des ${pivot} ans approche${id === "av70" ? "" : " (conjoint)"}`,
      texte: `${sujet} Il reste environ ${pluriel(reste, "an")} pour verser sous l'article 990 I : abattement de ${eur(AV_DECES.ABATTEMENT_990I)} par bénéficiaire sur les capitaux issus des primes versées avant ${pivot} ans. Après ${pivot} ans, l'article 757 B s'applique : abattement global de ${eur(AV_DECES.ABATTEMENT_757B)} sur les primes, mais les gains restent exonérés de droits.`,
      fiche: FICHE_AV,
    });
  };
  regarder(Number(profil?.age), "av70", `Vous avez environ ${Math.round(Number(profil?.age))} ans.`);
  if (profil?.foyer?.actif && profil.conjoint?.age != null) regarder(Number(profil.conjoint.age), "av70-conjoint", `Votre conjoint a environ ${Math.round(Number(profil.conjoint.age))} ans.`);
  return out;
}

// ------------------------------------------------------------- dernier jour de cession (CTO)
const iso = (d) => d.toISOString().slice(0, 10);
const jourOuvre = (d) => d.getUTCDay() % 6 !== 0 && !MARCHE.feriesBourseDecembre.includes(iso(d).slice(5));
/**
 * Dernier jour où passer un ordre pour qu'il soit réglé avant le 31/12 : le dernier jour ouvré de l'année,
 * moins `MARCHE.reglementJoursOuvres` jours ouvrés. Calcul en UTC ; retour « AAAA-MM-JJ ».
 */
export function dernierJourCession(annee) {
  const d = new Date(Date.UTC(annee, 11, 31));
  while (!jourOuvre(d)) d.setUTCDate(d.getUTCDate() - 1);
  for (let n = MARCHE.reglementJoursOuvres; n > 0;) { d.setUTCDate(d.getUTCDate() - 1); if (jourOuvre(d)) n--; }
  return iso(d);
}

/** Compte-titres : du 1er décembre au dernier jour de cession, rappel pour matérialiser une moins-value latente. */
export function fenetreCTO(profil, aujourdhui = new Date()) {
  if (!(solde(profil, "cto") > 0)) return [];
  const an = aujourdhui.getUTCFullYear(), jour = iso(aujourdhui), limite = dernierJourCession(an);
  if (jour < `${an}-12-01` || jour > limite) return [];
  const [, mm, jj] = limite.split("-");
  const date = `${jj}/${mm}`;
  return [{
    id: "cto-cession",
    cle: `cto:${an}`,
    niveau: "action",
    min: "intermediaire",
    titre: `CTO : dernier jour pour vendre en ${an} : ${date}`,
    texte: `Pour qu'une moins-value latente compte sur ${an}, l'ordre doit être exécuté au plus tard le ${date}, puisque le règlement intervient ${MARCHE.reglementJoursOuvres} jours ouvrés après. Elle s'impute sur les plus-values de même nature de l'année, puis se reporte ${PLUS_VALUES.reportMoinsValuesAns} ans. Ce n'est utile que si vous avez réalisé ou prévoyez des plus-values. Le PEA n'est pas concerné. Racheter aussitôt est en principe admis en France, mais une opération à but uniquement fiscal peut être contestée.`,
    fiche: "cto",
  }];
}

// ------------------------------------------------------------- bilan mensuel (relevés du Suivi)
const moisEnLettres = (aaaamm) => { const [y, m] = aaaamm.split("-").map(Number); return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" }); };
/**
 * Invite à saisir le relevé du mois quand le Suivi est utilisé (au moins un relevé) et que le dernier relevé est antérieur au mois courant.
 * `reference` = suivi.reference ({ date, points }) : l'écart réel / prévu est calculé comme dans l'onglet Suivi (prevuA, moisEntre).
 */
export function bilanMensuel(releves, reference, aujourdhui = new Date()) {
  if (!Array.isArray(releves) || !releves.length) return [];
  const der = releves[releves.length - 1];
  const mois = iso(aujourdhui).slice(0, 7);
  if (!der?.date || der.date >= mois) return [];
  let ecartTexte = "";
  const p = reference?.points?.length ? prevuA(reference, moisEntre(reference.date, der.date)) : null;
  if (p) {
    const ecart = der.total - p.c;
    const signe = ecart >= 0 ? "+" : "−";
    ecartTexte = `Au dernier relevé (${moisEnLettres(der.date)}), vous étiez à ${eur(der.total)} pour ${eur(p.c)} prévus par le plan : écart de ${signe}${eur(Math.abs(ecart))} (${signe}${pct(Math.abs((100 * ecart) / (p.c || 1)))}). `;
  }
  return [{
    id: "bilan-mensuel",
    cle: `bilan:${mois}`,
    niveau: "action",
    min: null,
    titre: `Relevé de ${new Date(Date.UTC(0, Number(mois.slice(5)) - 1, 1)).toLocaleDateString("fr-FR", { month: "long", timeZone: "UTC" })} à saisir`,
    texte: `${ecartTexte}Saisissez le relevé du mois dans le Suivi pour garder la comparaison avec le plan à jour.`,
    vue: "suivi",
  }];
}

// ------------------------------------------------------------- charges du foyer déséquilibrées
/** Un conjoint paie nettement plus que sa part proportionnelle aux revenus, alors que l'épargne reste personnelle (concubinage, PACS, séparation de biens). */
export function desequilibre(profil, plan) {
  const res = equilibreContributions(profil, plan);
  if (!(res?.disponible && res.separatif && Math.abs(res.ecart) >= Math.max(SEUIL_DESEQUILIBRE.euros, SEUIL_DESEQUILIBRE.part * res.D))) return [];
  const prenom = profil?.conjoint?.prenom?.trim();
  const sujet = res.surcontributeur === "B" ? `${prenom || "Ton conjoint"} paie` : "Tu paies";
  return [{
    id: "desequilibre",
    cle: `desequilibre:${Math.round(Math.abs(res.ecart) / 50) * 50}`,
    niveau: "action",
    min: "intermediaire",
    titre: "Charges du foyer déséquilibrées",
    texte: `${sujet} ${eur(Math.abs(res.ecart))} par mois de plus que la répartition proportionnelle aux revenus. Un virement d'équilibrage de ${eur(res.virementMensuel)} par mois rétablirait l'équilibre ; sans cela, le manque à gagner atteint ${eur(res.manqueAGagner)} sur ${res.horizonAns} ans.`,
    vue: "mon-profil",
  }];
}

/**
 * Toutes les alertes, de la plus grave à la moins grave (alerte > action > info), puis dans l'ordre des détecteurs.
 * Un détecteur qui échoue est ignoré. `analyse` (facultatif) : résultat d'analyser() déjà calculé (sinon calculé ici) ; `releves` et `reference` : le Suivi du profil.
 */
export function detecterAlertes(plan, profil, { aujourdhui = new Date(), analyse, releves = null, reference = null } = {}) {
  let A = analyse ?? null;
  if (!A) { try { A = analyser(plan, profil); } catch { A = null; } }
  const detecteurs = [
    () => livretsPleins(plan, profil, aujourdhui, A),
    () => derive(plan, profil, aujourdhui, A),
    () => av70(profil),
    () => fenetreCTO(profil, aujourdhui),
    () => bilanMensuel(releves, reference, aujourdhui),
    () => desequilibre(profil, plan),
  ];
  const toutes = [];
  for (const d of detecteurs) {
    try { toutes.push(...d()); } catch { /* un détecteur défaillant n'empêche pas les autres */ }
  }
  return toutes.map((a, i) => ({ a, i })).sort((x, y) => RANG_NIVEAU[x.a.niveau] - RANG_NIVEAU[y.a.niveau] || x.i - y.i).map((x) => x.a);
}
