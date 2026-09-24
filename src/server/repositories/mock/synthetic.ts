/**
 * Deterministic synthetic dataset (Spec §23.2, §23.9) shaped like ousadb:
 *   - terms      ≈ tblOUSA rows (Fall/Spring/Summer 2015–2027, isCurrent = Fall 2026, wasCurrent = Spring 2026)
 *   - students   ≈ tblStudent joined with VIEW_OURM membership and STATS clearance actions
 * Seeded PRNG so every run, test and screenshot sees the same data. No real students.
 */
import type { PostalAddress, StudentRow, TermMetadata, TransactionRow } from "../types";

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const LAST = ["Anderson","Brooks","Carter","Diaz","Ellis","Foster","Garcia","Hughes","Ingram","Jenkins","Kim","Lopez","Morgan","Nguyen","Owens","Patel","Quinn","Reyes","Sullivan","Turner","Underwood","Vargas","Walsh","Xu","Young","Zimmerman"];
const FIRST = ["Avery","Blake","Casey","Dana","Eli","Frankie","Gray","Harper","Indira","Jordan","Kai","Logan","Micah","Noor","Oakley","Parker","Quinn","Riley","Sage","Tatum","Uma","Val","Wren","Xavier","Yara","Zion"];

/** Observed class codes on staging with rough weights (FINDINGS §8.2). */
const CLASS_CODES: Array<[string, number]> = [
  ["FR", 26], ["SO", 17], ["SR", 20], ["JR", 17], ["FF", 8], ["GR", 5], ["AE", 3], ["AD", 1], ["EM", 0.3], ["DI", 0.2], ["XX", 1], ["", 0.5],
];

/** Observed ClearedBy codes (FINDINGS §4). "sa" = automatic clearance. */
const OPERATORS: Array<[string, number]> = [["HSMITH", 29], ["sa", 28], ["DSHARPE", 24], ["KCLARK", 16], ["GCALDWELL", 4], ["KJOSEPH", 2], ["ZZ9", 0.5]];

function pick<T>(rnd: () => number, weighted: Array<[T, number]>): T {
  const total = weighted.reduce((s, [, w]) => s + w, 0);
  let r = rnd() * total;
  for (const [v, w] of weighted) if ((r -= w) <= 0) return v;
  return weighted[weighted.length - 1][0];
}

export function generateTerms(): TermMetadata[] {
  const rows: TermMetadata[] = [];
  let id = 1;
  for (let y = 2015; y <= 2027; y++) {
    const spring: TermMetadata = {
      id: id++, semesterName: `Spring ${y}`, tradName: `SP${y}`, leapName: `LS${y}`, yearCode: String(y),
      semesterBegins: new Date(`${y}-01-02T00:00:00-06:00`), semesterEnds: new Date(`${y}-05-12T00:00:00-05:00`),
      isCurrent: false, wasCurrent: y === 2026,
      census: y <= 2026 ? 1990 - (y - 2015) * 60 : 0, financiallyCleared: y <= 2026 ? 1760 - (y - 2015) * 50 : 0,
      dropClassesDate: new Date(`${y}-01-07T00:00:00-06:00`), worksheetFolder: `W:\\${y} Spring\\Worksheets`,
    };
    rows.push(spring);
    if (y <= 2026) {
      rows.push({
        id: id++, semesterName: `Fall ${y}`, tradName: `FA${y}`, leapName: `LF${y}`, yearCode: String(y),
        semesterBegins: new Date(`${y}-06-17T00:00:00-05:00`), semesterEnds: new Date(`${y}-12-31T00:00:00-06:00`),
        isCurrent: y === 2026, wasCurrent: false,
        census: y === 2026 ? 1186 : 1989 - (y - 2015) * 65, financiallyCleared: y === 2026 ? 1012 : 1761 - (y - 2015) * 55,
        dropClassesDate: new Date(`${y}-08-14T00:00:00-05:00`), worksheetFolder: `W:\\${y} Fall\\Worksheets`,
      });
    }
  }
  return rows;
}

/** Bio Spec 1.3 fields that are not part of StudentRow (the aggregate screens never need them). */
export interface SyntheticBio {
  dob: string;
  cnp: number;
  phone: string;
  address: PostalAddress;
  clearedOn: string | null;
}

export interface SyntheticDataset {
  terms: TermMetadata[];
  students: StudentRow[];
  bios: Map<string, SyntheticBio>;
  charges: number;
  credits: number;
  afterDropDate: boolean;
}

export function generateSyntheticDataset(seed = 20260917): SyntheticDataset {
  const rnd = mulberry32(seed);
  const terms = generateTerms();
  const current = terms.find((t) => t.isCurrent)!;
  const previous = terms.find((t) => t.wasCurrent)!;
  const students: StudentRow[] = [];
  const sprintStart = new Date("2026-07-06T00:00:00-05:00");
  let charges = 0;
  let credits = 0;

  // Cohorts sized to resemble staging (FINDINGS §8.1/§8.6b):
  //   1,188 enrolled (LastCleared = current): ~996 cleared, ~192 not cleared (73 with balance > 0)
  //   ~25 cleared this term but not enrolled (reconciliation line)
  //   ~360 rolled-to-previous with flag = 1 (DNR candidates), 111 with balance > 0
  //   plus a long tail of old / never-cleared records
  const cohorts: Array<["enrolledCleared" | "enrolledNotCleared" | "clearedNotEnrolled" | "dnr" | "old", number]> = [
    ["enrolledCleared", 996], ["enrolledNotCleared", 192], ["clearedNotEnrolled", 25], ["dnr", 360], ["old", 900],
  ];

  let i = 0;
  for (const [cohort, size] of cohorts) {
    for (let k = 0; k < size; k++, i++) {
      const idnumber = String(100000 + i);
      const classificationCode = pick(rnd, CLASS_CODES);
      const isIncomingTransfer = ["FR", "FF", "SO", "JR", "SR"].includes(classificationCode) && rnd() < 0.1;
      const tuition = 9000 + Math.round(rnd() * 6000);
      const aid = Math.round(tuition * (0.3 + rnd() * 0.5));

      let status: StudentRow["status"] = "Not Cleared";
      let lastCleared: string | null = null;
      let clearedBy: string | null = null;
      let clearedAt: Date | null = null;
      let enrolledCurrentTerm = false;
      let accountBalance = 0;

      const clearanceEvent = () => {
        clearedBy = pick(rnd, OPERATORS);
        clearedAt = new Date(sprintStart.getTime() + Math.floor(Math.pow(rnd(), 0.7) * 50) * 86400000 + Math.floor(8 + rnd() * 9) * 3600000);
      };

      switch (cohort) {
        case "enrolledCleared":
          enrolledCurrentTerm = true; status = "Cleared"; lastCleared = rnd() < 0.05 ? current.leapName : current.tradName;
          clearanceEvent();
          accountBalance = rnd() < 0.35 ? -Math.round(rnd() * 1800 * 100) / 100 : rnd() < 0.5 ? 0 : Math.round(rnd() * 400 * 100) / 100;
          charges += tuition; credits += aid;
          break;
        case "enrolledNotCleared":
          enrolledCurrentTerm = true; status = "Not Cleared"; lastCleared = current.tradName;
          // 73 of 192 owe money (A-1: DNC = positive balance)
          accountBalance = k < 73 ? Math.round((500 + rnd() * 7500) * 100) / 100 : rnd() < 0.5 ? 0 : -Math.round(rnd() * 900 * 100) / 100;
          charges += tuition; credits += Math.round(aid * 0.6);
          break;
        case "clearedNotEnrolled":
          enrolledCurrentTerm = false; status = "Cleared"; lastCleared = current.tradName; clearanceEvent();
          accountBalance = Math.round(rnd() * 600 * 100) / 100;
          break;
        case "dnr":
          enrolledCurrentTerm = false; status = "Cleared"; lastCleared = rnd() < 0.08 ? previous.leapName : previous.tradName;
          accountBalance = k < 111 ? Math.round((100 + rnd() * 4000) * 100) / 100 : rnd() < 0.6 ? 0 : -Math.round(rnd() * 500 * 100) / 100;
          break;
        case "old":
          enrolledCurrentTerm = false; status = rnd() < 0.5 ? "Cleared" : "Not Cleared";
          lastCleared = rnd() < 0.5 ? "XX0000" : `${rnd() < 0.5 ? "FA" : "SP"}${2015 + Math.floor(rnd() * 10)}`;
          accountBalance = rnd() < 0.1 ? Math.round(rnd() * 3000 * 100) / 100 : rnd() < 0.3 ? -Math.round(rnd() * 800 * 100) / 100 : 0;
          break;
      }

      students.push({
        idnumber,
        lastName: LAST[Math.floor(rnd() * LAST.length)],
        firstName: FIRST[Math.floor(rnd() * FIRST.length)],
        middleName: rnd() < 0.6 ? String.fromCharCode(65 + Math.floor(rnd() * 26)) : null,
        pid: String(700000000 + Math.floor(rnd() * 99999999)),
        email: `student${idnumber}@example.edu`,
        classificationCode,
        isIncomingTransfer,
        status,
        accountBalance,
        lastCleared,
        clearedBy,
        clearedAt,
        enrolledCurrentTerm,
      });
    }
  }

  const bios = new Map<string, SyntheticBio>();
  for (const s of students) bios.set(s.idnumber, generateBio(s));

  return { terms, students, bios, charges, credits, afterDropDate: true };
}

const STREETS = ["Oak St", "Maple Ave", "Cedar Ln", "Pine Rd", "Elm Ct", "Birch Way", "Willow Dr", "Spruce Blvd"];
const CITIES: Array<[string, string, string]> = [
  ["Jackson", "MS", "39201"], ["Memphis", "TN", "38103"], ["Mobile", "AL", "36602"],
  ["Baton Rouge", "LA", "70801"], ["Little Rock", "AR", "72201"], ["Atlanta", "GA", "30303"],
];

/** Deterministic per-student PRNG so a profile looks the same on every run, test and screenshot. */
function studentRnd(idnumber: string, salt: number): () => number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < idnumber.length; i++) {
    h ^= idnumber.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return mulberry32(h >>> 0);
}

/** Bio Spec 1.3 fields. No real people: names, addresses and identifiers are all synthetic. */
function generateBio(s: StudentRow): SyntheticBio {
  const rnd = studentRnd(s.idnumber, 11);
  const year = 1992 + Math.floor(rnd() * 16);
  const month = 1 + Math.floor(rnd() * 12);
  const day = 1 + Math.floor(rnd() * 28);
  const [city, stateCode, zipCode] = CITIES[Math.floor(rnd() * CITIES.length)];
  return {
    dob: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    cnp: Math.round(rnd() * 250000) / 100,
    phone: `(${200 + Math.floor(rnd() * 700)}) ${200 + Math.floor(rnd() * 700)}-${String(Math.floor(rnd() * 10000)).padStart(4, "0")}`,
    address: {
      address: `${100 + Math.floor(rnd() * 9800)} ${STREETS[Math.floor(rnd() * STREETS.length)]}`,
      city,
      stateCode,
      zipCode,
      country: "US",
    },
    clearedOn: s.clearedAt ? s.clearedAt.toISOString().slice(0, 10) : null,
  };
}

/**
 * Synthetic trans_hist for one student (Bio Spec 2). Shaped like the real thing: tuition charges
 * (`CG`) each term, financial aid (`FA`) and payments (`RC`) against them, the odd incidental
 * (`BN`) and refund (`IV`). The running total is closed out with a final adjustment so the sum of
 * the recordset equals tblStudent.AccountBalance — the reconciliation the payment analysis claims
 * on screen is therefore exercised by the mock, not only by staging.
 *
 * `scope` mirrors the two sources in D-1: `current` is this term only (jadi.dbo.trans_hist),
 * `global` is the whole history (the TMSEPRD linked server).
 */
export function generateTransactions(s: StudentRow, scope: "current" | "global", termStart: Date, now: Date = new Date()): TransactionRow[] {
  const rnd = studentRnd(s.idnumber, scope === "current" ? 23 : 29);
  const rows: TransactionRow[] = [];
  const years = scope === "current" ? 1 : 1 + Math.floor(rnd() * 5);
  const push = (postedOn: Date, description: string, amount: number, sourceCode: string) => {
    if (postedOn > now) return;
    rows.push({ postedOn: postedOn.toISOString().slice(0, 10), description, amount: Math.round(amount * 100) / 100, sourceCode });
  };

  for (let y = years - 1; y >= 0; y--) {
    const base = new Date(termStart.getTime() - y * 365 * 86400000);
    const tuition = 4200 + Math.round(rnd() * 3200);
    push(base, "Tuition and fees", tuition, "CG");
    if (rnd() < 0.85) push(new Date(base.getTime() + 8 * 86400000), "Pell Grant", -Math.round(tuition * (0.25 + rnd() * 0.4)), "FA");
    if (rnd() < 0.6) push(new Date(base.getTime() + 15 * 86400000), "Institutional scholarship", -Math.round(tuition * (0.1 + rnd() * 0.25)), "FA");
    if (rnd() < 0.75) push(new Date(base.getTime() + 24 * 86400000), "Payment received", -Math.round(200 + rnd() * 900), "RC");
    if (rnd() < 0.3) push(new Date(base.getTime() + 33 * 86400000), "Payroll deduction", -Math.round(60 + rnd() * 240), "LB");
    if (rnd() < 0.35) push(new Date(base.getTime() + 40 * 86400000), "Parking / library fine", Math.round(15 + rnd() * 120), "BN");
    if (rnd() < 0.12) push(new Date(base.getTime() + 52 * 86400000), "Refund issued", Math.round(80 + rnd() * 400), "IV");
    if (rnd() < 0.1) push(new Date(base.getTime() + 60 * 86400000), "Adjustment", Math.round((rnd() - 0.5) * 300), "MS");
  }

  // Close the account out to the authoritative balance (A-18) with one dated line, so the card's
  // "totals reconcile with the balance" claim is true of the mock as well as of staging.
  const net = Math.round(rows.reduce((t, r) => t + r.amount, 0) * 100) / 100;
  const delta = Math.round((s.accountBalance - net) * 100) / 100;
  if (Math.abs(delta) >= 0.01 && scope === "global") {
    const at = new Date(Math.min(now.getTime(), termStart.getTime() + 70 * 86400000));
    rows.push({
      postedOn: at.toISOString().slice(0, 10),
      description: delta > 0 ? "Balance forward" : "Credit applied",
      amount: delta,
      sourceCode: delta > 0 ? "CG" : "RC",
    });
  }
  return rows.sort((a, b) => b.postedOn.localeCompare(a.postedOn));
}
