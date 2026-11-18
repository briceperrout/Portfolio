// =====================================================================
//  RETRAITE PUBLIQUE — estimation simplifiée pour un salarié du privé,
//  un président de SASU (même régime) ou un indépendant affilié à la SSI
//  (micro-entrepreneur, gérant d'EURL : base alignée sur le régime général,
//  complémentaire RCI, trimestres validés selon le revenu).
//  Base (Assurance retraite) + complémentaire (Agirc-Arrco ou RCI), en euros
//  d'aujourd'hui. Hypothèses : une année travaillée = 4 trimestres, les
//  salaires passés suivent le profil de carrière, pas de période de
//  chômage, de maladie ou d'enfants (trimestres en plus non comptés).
//  Ne remplace pas le relevé officiel (info-retraite.fr).
// =====================================================================
import { facteurSalaire, carriereDe, hausseReelle, normaliserFoyer, simulerIndependant } from "./moteur.js";
import { decomposerSalaire, foyerFiscal, apresImpot, ABATTEMENT_AV, PRELEVEMENTS, PLAFONDS, impotBaremeIndexe, margeTranche, impotRachatAV, impotRetraitPEA, impotRetraitCTO, impotRetraitPER } from "./fiscal.js";

// Âge légal et trimestres requis selon l'année de naissance (réforme 2023,
// suspendue par la loi de financement de la Sécurité sociale pour 2026)
export function reglesGeneration(plan, annee) {
  const R = plan.retraitePublique ?? {};
  const table = [
    [1960, 62, 167], [1961, 62.25, 168], [1962, 62.5, 169], [1963, 62.75, 170], [1964, 62.75, 170],
    [1965, 63, 171], [1966, 63.25, 172], [1967, 63.5, 172], [1968, 63.75, 172],
  ];
  if (annee <= 1960) return { ageLegal: 62, trimestres: 167 };
  const t = table.find(([a]) => a === annee);
  if (t) return { ageLegal: t[1], trimestres: t[2] };
  return { ageLegal: R.ageLegal ?? 64, trimestres: R.trimestresRequis ?? 172 };
}
export const ageEnTexte = (a) => {
  const ans = Math.floor(a), mois = Math.round((a - ans) * 12);
  return mois ? `${ans} ans et ${mois} mois` : `${ans} ans`;
};

// Salaires nets mensuels de toute la carrière, en euros d'aujourd'hui
function salairesCarriere(plan, profilSaisi, ageDebut, ageArret, netAvantMensuel = null) {
  const infl = (plan.hypotheses?.inflation ?? 0) / 100;
  const p = normaliserFoyer(plan, { ...profilSaisi, foyer: { actif: false } });
  // Le salaire saisi est « net après impôt » : les droits à la retraite se calculent sur le brut
  const sSaisi = Number(p.salaireNetMensuel) || 0;
  const s0 = netAvantMensuel != null ? netAvantMensuel : decomposerSalaire(sSaisi, foyerFiscal(profilSaisi)).netAvant;
  const age = Math.round(p.age ?? 30);
  const c = carriereDe(plan, p);
  const out = [];
  for (let a = Math.round(ageDebut); a < Math.round(ageArret); a++) {
    let s;
    if (a >= age) s = (s0 * facteurSalaire(plan, p, a - age)) / Math.pow(1 + infl, a - age);
    else { s = s0; for (let k = a; k < age; k++) s /= 1 + hausseReelle(c, k) / 100; }  // années passées : on remonte la carrière
    out.push({ age: a, net: s });
  }
  return out;
}

export function estimerPension(plan, profilSaisi, { ageDebut, trimestresDeja = null, ageArret, ageDemande, trimestresEnfants = 0 }) {
  const R = plan.retraitePublique ?? {};
  const age = Math.round(profilSaisi.age ?? 30);
  const naissance = new Date().getFullYear() - age;
  const regles = reglesGeneration(plan, naissance);
  const debut = Math.max(14, Math.min(Number(ageDebut) || R.ageDebutCarriere || 22, ageArret));
  const PASS = R.pass ?? PLAFONDS.pass;
  // Indépendant : SASU (régime général, base = rémunération nette) ou SSI (EURL, micro : base = revenu cotisé)
  const ind = profilSaisi.statutPro === "independant" ? simulerIndependant(plan, profilSaisi, false) : null;
  const forme = ind ? profilSaisi.independant?.forme : null;
  const ssi = !!ind && forme !== "sasu";
  const RI = R.independants ?? {};
  const seuilTrim = (RI.smicHoraire ?? 12.02) * (RI.heuresParTrimestre ?? 150);
  const minEurl = forme === "eurl" ? ((RI.assietteMinRetraitePct ?? 11.5) / 100) * PASS : 0;
  const annees = salairesCarriere(plan, profilSaisi, debut, ageArret, !ind ? null : ssi ? ind.assietteRetraite / 12 : ind.remunerationNette / 12);
  // Revenu cotisé annuel d'une année (SSI) et trimestres validés cette année-là
  const revenuSsi = (netMensuel) => netMensuel * 12;
  const baseSsi = (netMensuel) => Math.max(revenuSsi(netMensuel), minEurl);
  const trimAnnee = (netMensuel) => (ssi ? Math.min(4, Math.floor(baseSsi(netMensuel) / seuilTrim)) : ind ? (netMensuel > 0 ? 4 : 0) : 4);
  // Trimestres : relevé saisi pour le passé, sinon 4 par année travaillée (selon le revenu pour un indépendant)
  const somme = (liste) => liste.reduce((t, x) => t + trimAnnee(x.net), 0);
  const passes = trimestresDeja != null && trimestresDeja !== "" ? Math.max(0, Number(trimestresDeja))
    : ind ? somme(annees.filter((x) => x.age < Math.min(age, ageArret))) : Math.max(0, 4 * (Math.min(age, ageArret) - debut));
  const futurs = ind ? somme(annees.filter((x) => x.age >= Math.max(age, debut))) : Math.max(0, 4 * (ageArret - Math.max(age, debut)));
  // Trimestres pour enfants (majoration de durée d'assurance : jusqu'à 8 par enfant, souvent pour la mère)
  const trimEnfants = Math.max(0, Math.round(Number(trimestresEnfants) || 0));
  const trimestres = Math.round(passes + futurs + trimEnfants);
  // Trimestres travaillés après l'âge légal (seuls ceux-là ouvrent droit à la surcote)
  const trimApresLegal = Math.max(0, Math.round((ageArret - regles.ageLegal) * 4));
  const enfants = Math.max(0, Math.round(Number(profilSaisi.enfants) || 0));
  const brut = (net) => (net * 12) / ((R.netSurBrutSalaire ?? 78) / 100);
  // Base : 25 meilleures années, plafonnées au PASS
  const plafonnes = annees.map((x) => Math.min(ssi ? baseSsi(x.net) : brut(x.net), PASS)).sort((a, b) => b - a);
  const meilleures = plafonnes.slice(0, 25);
  const sam = meilleures.length ? meilleures.reduce((t, x) => t + x, 0) / meilleures.length : 0;
  // Complémentaire : points achetés chaque année
  const pointsAnnee = (net) => {
    if (ssi) {
      const r = revenuSsi(net);
      return (((RI.rciTauxT1 ?? 7) * Math.min(r, PASS) + (RI.rciTauxT2 ?? 8) * Math.min(Math.max(0, r - PASS), ((RI.rciPlafondPASS ?? 4) - 1) * PASS)) / 100) / (RI.rciValeurAchat ?? 21.532);
    }
    const b = brut(net);
    return (Math.min(b, PASS) * (R.agircTauxT1 ?? 6.2) / 100 + Math.max(0, Math.min(b, 8 * PASS) - PASS) * (R.agircTauxT2 ?? 17) / 100) / (R.agircPrixAchat ?? 20.1877);
  };
  const points = annees.reduce((t, x) => t + pointsAnnee(x.net), 0);
  const valeurPoint = ssi ? RI.rciValeurPoint ?? 1.335 : R.agircValeurPoint ?? 1.4587;
  const calcul = (A) => {
    const a = Math.max(A, regles.ageLegal);
    const manque = Math.max(0, regles.trimestres - trimestres);
    const manqueAge = Math.max(0, Math.round(((R.ageTauxPlein ?? 67) - a) * 4));
    const decote = Math.min(manque, manqueAge, 20);
    const taux = (R.tauxPlein ?? 50) - decote * (R.decoteParTrimestre ?? 0.625);
    const prorata = Math.min(1, trimestres / regles.trimestres);
    // Surcote : +1,25 % par trimestre travaillé après l'âge légal au-delà de la durée requise (régime de base)
    const trimSurcote = decote === 0 ? Math.max(0, Math.min(trimApresLegal, trimestres - regles.trimestres)) : 0;
    const surcote = trimSurcote * (R.surcoteParTrimestre ?? 1.25);
    // Enfants : +10 % pour avoir eu ou élevé au moins 3 enfants (base, et complémentaire Agirc-Arrco)
    const majEnfants = enfants >= 3 ? (R.majorationTroisEnfants ?? 10) : 0;
    const baseBrute = sam * (taux / 100) * prorata * (1 + surcote / 100) * (1 + majEnfants / 100);
    // Complémentaire réduite elle aussi sans taux plein (approximation : même proportion que la base) ; plus de malus depuis décembre 2023
    const complBrute = points * valeurPoint * (taux / (R.tauxPlein ?? 50)) * (1 + majEnfants / 100);
    const net = ((baseBrute + complBrute) * (R.netSurBrutPension ?? 90)) / 100 / 12;
    return { age: a, taux, decote, prorata, base: (baseBrute * (R.netSurBrutPension ?? 90)) / 100 / 12, complementaire: (complBrute * (R.netSurBrutPension ?? 90)) / 100 / 12, net, apres: apresImpot(net), tauxPlein: decote === 0, surcote, trimSurcote, majEnfants };
  };
  // Âge de liquidation par défaut : on ne liquide pas en continuant de travailler (cumul emploi-retraite non modélisé),
  // donc le plus tardif de l'âge d'arrêt et de l'âge légal ; un âge de demande saisi prévaut.
  const ageDemandeEffectif = Number(ageDemande) > 0 ? Number(ageDemande) : Math.max(regles.ageLegal, Number(ageArret) || 0);
  // Année courante (indépendant) : trimestres validés et points de complémentaire
  const net0 = ind ? (ssi ? ind.assietteRetraite : ind.remunerationNette) / 12 : 0;
  const trimestresParAn = ind ? trimAnnee(net0) : 4;
  const alertes = [];
  if (ind) {
    if (ssi && trimestresParAn < 4) alertes.push(`Revenu inférieur à ${Math.round(4 * seuilTrim).toLocaleString("fr-FR")} €/an : moins de 4 trimestres validés par an.`);
    if (ind.dividendesBruts > 0) alertes.push("Les dividendes n'ouvrent aucun droit à la retraite.");
    if (forme === "microBnc") alertes.push("Professions libérales réglementées (CIPAV) non modélisées : estimation sur la base SSI.");
    if (forme?.startsWith("micro")) alertes.push("Trimestres micro estimés sur le revenu après abattement (l'URSSAF applique des seuils de chiffre d'affaires).");
    alertes.push("Carrière entière supposée sous le statut actuel ; saisissez vos trimestres déjà validés pour affiner.");
  }
  return {
    regime: ssi ? "ssi" : "general", libelleComplementaire: ssi ? "RCI" : "Agirc-Arrco", trimestresParAn,
    pointsParAn: ind ? pointsAnnee(net0) : null, alertes,
    naissance, regles, debut, trimestres, passes, futurs, trimEnfants, enfants, sam, points: Math.round(points),
    annees: annees.length, auLegal: calcul(regles.ageLegal), aTauxPlein: calcul(R.ageTauxPlein ?? 67),
    demande: calcul(ageDemandeEffectif),
  };
}

// =====================================================================
// Décumulation : ordre de retrait fiscalement optimal
// =====================================================================
export const STRATEGIES_DECUMULATION = ["transmettre", "consommer", "prorata"];

const EPS = 1e-6;
const gainRelatif = (valeur, prixDeRevient) => (valeur > 0 ? Math.max(0, 1 - prixDeRevient / valeur) : 0);
const nb = (x) => (Number.isFinite(Number(x)) ? Math.max(0, Number(x)) : 0);

// Copie profonde complète du registre (champs manquants = 0) : l'entrée n'est jamais mutée
function normaliserRegistre(r = {}) {
  const av = r.av ?? {};
  const comp = (c = {}) => ({ valeur: nb(c.valeur), primes: nb(c.primes) });
  return {
    livrets: { valeur: nb(r.livrets?.valeur) },
    av: { apres70: comp(av.apres70), avant70: comp(av.avant70), ancien8: !!av.ancien8 },
    pea: { valeur: nb(r.pea?.valeur), versements: nb(r.pea?.versements), ancien5: !!r.pea?.ancien5 },
    cto: { valeur: nb(r.cto?.valeur), base: nb(r.cto?.base) },
    per: { valeur: nb(r.per?.valeur), versementsDeduits: nb(r.per?.versementsDeduits) },
    autres: (Array.isArray(r.autres) ? r.autres : []).map((a) => ({ id: String(a.id ?? "autre"), valeur: nb(a.valeur), base: nb(a.base), taux: nb(a.taux) })),
  };
}

// Moteur d'une année de retraits : état privé, une instance par simulation
function moteurRetraits(registre, ctx) {
  const s = normaliserRegistre(registre);
  const parts = ctx.parts ?? 1;
  const P = ctx.prelevements ?? PRELEVEMENTS;
  const pfu = P.IR_PFU + P.PS_CAPITAL;
  const fisc = { parts, partsBase: ctx.partsBase ?? parts, indexation: ctx.indexation ?? 1 };
  let revenu = nb(ctx.revenuImposableAutre);
  let abat = s.av.ancien8 ? (ctx.couple ? ABATTEMENT_AV.couple : ABATTEMENT_AV.seul) : 0;
  const retraits = [];
  let brut = 0, impots = 0, nets = 0, abattementUtilise = 0;

  const poche = (cle) => {
    if (cle === "livrets") return { p: s.livrets, prix: null, type: "livrets" };
    if (cle === "av_apres70") return { p: s.av.apres70, prix: "primes", type: "av" };
    if (cle === "av_avant70") return { p: s.av.avant70, prix: "primes", type: "av" };
    if (cle === "pea") return { p: s.pea, prix: "versements", type: "pea" };
    if (cle === "cto") return { p: s.cto, prix: "base", type: "cto" };
    if (cle === "per") return { p: s.per, prix: "versementsDeduits", type: "per" };
    return { p: s.autres[Number(cle.slice(6))], prix: "base", type: "autre" };
  };
  const clesAutres = () => s.autres.map((_, i) => `autre:${i}`);

  // Fiscalité d'un retrait de m sur la poche, sans rien modifier
  const evaluer = (cle, m) => {
    const { p, type } = poche(cle);
    const v = p.valeur;
    if (type === "livrets") return { impot: 0, gainAbattu: 0, partVersements: 0 };
    if (type === "av") {
      const r = impotRachatAV({ montant: m, valeur: v, primes: p.primes, primesTotales: s.av.apres70.primes + s.av.avant70.primes, ancien8: s.av.ancien8, abattementRestant: abat }, P);
      return { impot: r.impot, gainAbattu: r.gainAbattu, partVersements: 0 };
    }
    if (type === "pea") return { impot: impotRetraitPEA({ montant: m, valeur: v, versements: p.versements, ancien5: p.ancien5 }, P).impot, gainAbattu: 0, partVersements: 0 };
    if (type === "cto") return { impot: impotRetraitCTO({ montant: m, valeur: v, base: p.base }, P).impot, gainAbattu: 0, partVersements: 0 };
    if (type === "per") {
      const r = impotRetraitPER({ montant: m, valeur: v, versementsDeduits: p.versementsDeduits, revenuImposableAutre: revenu, ...fisc }, P);
      return { impot: r.impot, gainAbattu: 0, partVersements: r.partVersements };
    }
    return { impot: (m * gainRelatif(v, p.base) * p.taux) / 100, gainAbattu: 0, partVersements: 0 };
  };

  // Retire réellement m de la poche (valeur et prix de revient réduits au prorata)
  const retirer = (cle, m, etape) => {
    const { p, prix, type } = poche(cle);
    const e = evaluer(cle, m);
    const v = p.valeur;
    const vide = m >= v - 1e-9;
    if (prix) p[prix] = vide ? 0 : p[prix] * (1 - m / v);
    p.valeur = vide ? 0 : v - m;
    abat = Math.max(0, abat - e.gainAbattu);
    abattementUtilise += e.gainAbattu;
    revenu += e.partVersements;
    brut += m; impots += e.impot; nets += m - e.impot;
    retraits.push({ id: type === "autre" ? p.id : cle, etape, montant: m, impot: e.impot });
    return m - e.impot;
  };

  // Montant à retirer pour obtenir `net`, borné par la valeur et par `limite`
  const montantPourNet = (cle, net, limite = Infinity) => {
    const { p, type } = poche(cle);
    const vmax = Math.min(p.valeur, limite);
    if (!(vmax > 1e-9) || !(net > 0)) return 0;
    const netMax = vmax - evaluer(cle, vmax).impot;
    if (netMax <= net) return vmax;
    if (type !== "av" && type !== "per") return net / (1 - evaluer(cle, vmax).impot / vmax); // taux linéaire
    let bas = 0, haut = vmax;
    for (let i = 0; i < 40; i++) {
      const mil = (bas + haut) / 2;
      if (mil - evaluer(cle, mil).impot >= net) haut = mil; else bas = mil;
    }
    return haut;
  };

  return {
    s, fisc, retraits, P, pfu,
    revenu: () => revenu,
    abattement: () => abat,
    valeur: (cle) => poche(cle).p.valeur,
    clesAutres,
    evaluer, retirer, montantPourNet,
    gain: (cle) => { const { p, prix } = poche(cle); return gainRelatif(p.valeur, prix ? p[prix] : p.valeur); },
    totaux: () => ({ brut, impots, nets, abattementUtilise }),
  };
}

// Plan de retraits d'une année pour obtenir `besoinNet` (net d'impôt) avec le moins d'impôt possible.
// strategie : 'transmettre' (AV avant 70 ans gardée pour la fin), 'consommer' (AV avant PER hors tranche),
// 'prorata' (référence : on retire au prorata de chaque poche, mêmes règles fiscales).
export function planifierRetraits(registre, besoinNet, ctx = {}, strategie = "transmettre") {
  const besoin = Math.max(0, Number(besoinNet) || 0);
  let m;
  let reste = besoin;

  if (strategie === "prorata") {
    const cles = ["livrets", "av_apres70", "av_avant70", "pea", "cto"];
    const depart = moteurRetraits(registre, ctx);
    // Comme dans les autres stratégies, l'or physique gardé n'est vendu qu'en dernier recours
    const estOr = (c) => c.startsWith("autre:") && depart.s.autres[Number(c.slice(6))].id === "orPhysique";
    const gardes = ctx.garderOr ? depart.clesAutres().filter(estOr) : [];
    const toutes = [...cles, ...depart.clesAutres().filter((c) => !gardes.includes(c)), "per"];
    const valeurs = toutes.map((c) => depart.valeur(c));
    const total = valeurs.reduce((t, v) => t + v, 0);
    const jouer = (M) => {
      const e = moteurRetraits(registre, ctx);
      toutes.forEach((c, i) => { if (valeurs[i] > 0 && total > 0) e.retirer(c, (M * valeurs[i]) / total, "prorata"); });
      return e;
    };
    let M = total;
    if (total > 0 && jouer(total).totaux().nets > besoin) {
      let bas = 0, haut = total;
      for (let i = 0; i < 40; i++) {
        const mil = (bas + haut) / 2;
        if (jouer(mil).totaux().nets >= besoin) haut = mil; else bas = mil;
      }
      M = haut;
    }
    m = total > 0 && besoin > 0 ? jouer(M) : moteurRetraits(registre, ctx);
    reste = besoin - m.totaux().nets;
    for (const c of gardes) {
      if (reste <= EPS) break;
      const montant = m.montantPourNet(c, reste);
      if (montant > 1e-9) reste -= m.retirer(c, montant, "prorata");
    }
  } else {
    m = moteurRetraits(registre, ctx);
    const etape = (cle, n, limite = Infinity) => {
      if (reste <= EPS) return;
      const montant = m.montantPourNet(cle, reste, limite);
      if (montant > 1e-9) reste -= m.retirer(cle, montant, n);
    };

    // Étape 0 : PER lissé, indépendant du besoin
    const per = m.s.per;
    if (per.valeur > 0) {
      const tmiCible = Math.max(impotBaremeIndexe(m.revenu(), m.fisc.parts, m.fisc.partsBase, m.fisc.indexation).tmi, 11);
      const annees = Math.max(1, Number(ctx.anneesRestantesPER) || 1);
      const partV = Math.min(1, per.versementsDeduits / per.valeur);
      const marge = margeTranche(m.revenu(), { ...m.fisc, tmiCible });
      const remplir = partV > 0 ? marge / partV : 0;
      const P = Math.min(per.valeur, Math.max(per.valeur / annees, remplir));
      const netP = m.retirer("per", P, 0);
      reste = Math.max(0, besoin - netP); // l'excédent éventuel devient surplus, réinvesti en CTO plus bas
    }

    // Réserve d'assurance-vie transmissible : en 'transmettre', seules les étapes 1 (purge) et 4 en tiennent compte ;
    // seule l'étape 6 (dernier recours) peut l'entamer
    const reserveAV = strategie === "transmettre" ? Math.max(0, nb(ctx.reserveTransmissionAV)) : 0;
    const limiteAV = (cle) => (cle === "av_avant70" ? Math.max(0, m.valeur("av_avant70") - reserveAV) : Infinity);
    // Étape 1 : purge de l'assurance-vie sous abattement
    if (m.s.av.ancien8) {
      for (const cle of ["av_apres70", "av_avant70"]) {
        const g = m.gain(cle);
        if (g > 0 && m.abattement() > 0) etape(cle, 1, Math.min(m.abattement() / g, limiteAV(cle)));
      }
    }
    // Étape 2 : livrets au-delà de la réserve
    etape("livrets", 2, Math.max(0, m.valeur("livrets") - nb(ctx.reserveLivrets)));
    // Étape 3 : poches imposables liquides, coût marginal croissant
    const taux = (cle) => (cle === "pea" ? (m.s.pea.ancien5 ? m.P.PS_CAPITAL + (m.P.PEA_IR ? m.P.IR_PFU : 0) : m.pfu) : cle === "cto" ? m.pfu : m.s.autres[Number(cle.slice(6))].taux);
    const gardeOr = (cle) => ctx.garderOr && cle.startsWith("autre:") && m.s.autres[Number(cle.slice(6))].id === "orPhysique";
    // ctx.ordreEtape3 : 'peaDabord' (défaut, tri par coût marginal, PEA prioritaire à égalité) ou 'ctoDabord'
    // (CTO et autres triés entre eux, PEA en dernier : utile quand l'épargne sera consommée en entier)
    const ctoDabord = ctx.ordreEtape3 === "ctoDabord";
    const parCout = (a, b) => taux(a) * m.gain(a) - taux(b) * m.gain(b);
    const liquides = ctoDabord
      ? [...["cto", ...m.clesAutres()].filter((c) => !gardeOr(c)).sort(parCout), "pea"]
      : ["pea", "cto", ...m.clesAutres()].filter((c) => !gardeOr(c)).sort(parCout);
    for (const cle of liquides) etape(cle, 3);
    // Étapes 4 à 6 : AV après 70 ans, PER hors tranche, AV avant 70 ans (ordre selon la stratégie)
    etape("av_apres70", 4);
    if (strategie === "consommer") { etape("av_avant70", 6); etape("per", 5); }
    else { etape("per", 5); etape("av_avant70", 6); }
    // Étape 7 : réserve de livrets, puis or physique
    etape("livrets", 7);
    for (const cle of m.clesAutres().filter(gardeOr)) etape(cle, 7);
  }

  const t = m.totaux();
  const insuffisant = reste > EPS;
  const net = insuffisant ? t.nets : Math.min(besoin, t.nets);
  const surplus = t.nets - net;
  if (surplus > 1e-9) { m.s.cto.valeur += surplus; m.s.cto.base += surplus; }
  return { net, brut: t.brut, impots: t.impots, surplus, insuffisant, retraits: m.retraits, abattementUtilise: t.abattementUtilise, registre: m.s };
}

// Impôt dû au décès sur les gains latents, hors droits de succession.
// - PEA : les gains restent soumis aux prélèvements sociaux (PS_CAPITAL) au décès, car le plan est clôturé.
// - AV (les deux compartiments) : les gains acquis supportent les prélèvements sociaux (PS_PATRIMOINE) au dénouement.
// - CTO et autres placements : les plus-values latentes sont purgées au décès (valeur d'actif réévaluée), donc 0.
// - PER : suit le régime successoral propre (hors périmètre ici), donc 0.
// - Livrets : aucun gain imposable, donc 0.
export function impotsAuDeces(registre, prelevements = PRELEVEMENTS) {
  const s = normaliserRegistre(registre);
  const gainPEA = Math.max(0, s.pea.valeur - s.pea.versements);
  const gainAV = Math.max(0, s.av.apres70.valeur - s.av.apres70.primes) + Math.max(0, s.av.avant70.valeur - s.av.avant70.primes);
  return (gainPEA * prelevements.PS_CAPITAL + gainAV * prelevements.PS_PATRIMOINE) / 100; // taux exprimés en %
}
