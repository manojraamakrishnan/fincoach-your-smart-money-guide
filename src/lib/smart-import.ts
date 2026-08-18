import * as XLSX from "xlsx";

export type FieldKey =
  | "ignore"
  | "date"
  | "description"
  | "amount"
  | "debit"
  | "credit"
  | "type"
  | "method";

export const FIELD_LABELS: Record<FieldKey, string> = {
  ignore: "Ignore",
  date: "Transaction date",
  description: "Description / merchant",
  amount: "Amount (single column)",
  debit: "Debit / withdrawal",
  credit: "Credit / deposit",
  type: "Dr / Cr indicator",
  method: "Payment method",
};

export type ParsedSheet = {
  headers: string[];
  rows: string[][];
};

export type Mapping = Record<number, FieldKey>;

export type NormalizedRow = {
  index: number;
  transaction_date: string; // ISO
  merchant_raw: string;
  amount: number;
  transaction_type: "Debit" | "Credit";
  payment_method: string;
};

export type RowResult =
  | { status: "valid"; row: NormalizedRow; raw: string[] }
  | { status: "duplicate"; row: NormalizedRow; raw: string[]; reason: string }
  | { status: "review"; raw: string[]; index: number; reason: string };

/* ---------------- file parsing ---------------- */

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') inQuotes = false;
      else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function pickHeaderRow(matrix: string[][]): number {
  let best = 0;
  let bestScore = -1;
  const limit = Math.min(matrix.length, 15);
  for (let i = 0; i < limit; i++) {
    const cells = matrix[i].map((c) => (c ?? "").toString().trim());
    const filled = cells.filter((c) => c.length > 0).length;
    if (filled < 2) continue;
    const texty = cells.filter((c) => c.length > 0 && !/^-?[\d.,₹()\s]+$/.test(c)).length;
    const known = cells.filter((c) => guessField(c) !== null).length;
    const score = filled + texty + known * 3;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

function matrixToSheet(matrix: string[][]): ParsedSheet {
  const cleaned = matrix.filter((r) => r.some((c) => (c ?? "").toString().trim().length > 0));
  if (cleaned.length === 0) return { headers: [], rows: [] };
  const hIdx = pickHeaderRow(cleaned);
  const headersRaw = cleaned[hIdx].map((c) => (c ?? "").toString().trim());
  const width = Math.max(...cleaned.map((r) => r.length));
  const headers = Array.from({ length: width }, (_, i) => headersRaw[i] || `Column ${i + 1}`);
  const rows = cleaned
    .slice(hIdx + 1)
    .map((r) => Array.from({ length: width }, (_, i) => (r[i] ?? "").toString().trim()));
  return { headers, rows };
}

export async function parseFile(file: File): Promise<ParsedSheet> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".csv") || name.endsWith(".txt")) {
    const text = await file.text();
    const matrix = text
      .replace(/\r\n/g, "\n")
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map(parseCsvLine);
    return matrixToSheet(matrix);
  }
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    raw: false,
    defval: "",
    blankrows: false,
  }) as unknown as string[][];
  return matrixToSheet(matrix.map((r) => r.map((c) => (c ?? "").toString())));
}

/* ---------------- column detection ---------------- */

const PATTERNS: Array<{ field: FieldKey; re: RegExp }> = [
  { field: "debit", re: /^(debit|withdrawal|withdrawl|dr\s*amount|debit\s*amt|paid\s*out|money\s*out|withdrawal\s*amt|withdrawal\s*\(dr\))/i },
  { field: "credit", re: /^(credit|deposit|cr\s*amount|credit\s*amt|paid\s*in|money\s*in|deposit\s*amt|deposit\s*\(cr\))/i },
  { field: "type", re: /(dr\s*\/?\s*cr|cr\s*\/?\s*dr|txn\s*type|transaction\s*type|type|indicator|debit\/credit)/i },
  { field: "date", re: /(txn\s*date|transaction\s*date|value\s*date|posting\s*date|^date$|date\b|timestamp)/i },
  { field: "description", re: /(narration|particulars|description|merchant|remarks|details|payee|transaction\s*remarks|to\s*\/\s*from)/i },
  { field: "amount", re: /(amount|amt|value|transaction\s*amount)/i },
  { field: "method", re: /(payment\s*method|mode|channel|payment\s*mode|instrument)/i },
];

const IGNORE_RE = /(balance|closing|opening|ref(erence)?\s*(no|number)|cheque|chq|serial|s\.?\s*no|sr\.?\s*no|utr)/i;

export function guessField(header: string): FieldKey | null {
  const h = header.trim();
  if (!h) return null;
  if (IGNORE_RE.test(h) && !/amount|debit|credit/i.test(h)) return null;
  for (const p of PATTERNS) if (p.re.test(h)) return p.field;
  return null;
}

function looksNumeric(values: string[]): boolean {
  const nums = values.filter((v) => v.trim().length > 0);
  if (nums.length === 0) return false;
  return nums.filter((v) => parseAmount(v) !== null).length / nums.length > 0.7;
}

function looksLikeDate(values: string[]): boolean {
  const vals = values.filter((v) => v.trim().length > 0);
  if (vals.length === 0) return false;
  return vals.filter((v) => parseDate(v, true) !== null).length / vals.length > 0.7;
}

export function detectMapping(sheet: ParsedSheet): { mapping: Mapping; uncertain: boolean } {
  const mapping: Mapping = {};
  const used = new Set<FieldKey>();
  const sample = sheet.rows.slice(0, 30);

  sheet.headers.forEach((h, i) => {
    const g = guessField(h);
    if (g && (g === "ignore" || !used.has(g))) {
      mapping[i] = g;
      if (g !== "ignore") used.add(g);
    } else {
      mapping[i] = "ignore";
    }
  });

  // content-based fallbacks
  if (!used.has("date")) {
    const i = sheet.headers.findIndex(
      (_, idx) => mapping[idx] === "ignore" && looksLikeDate(sample.map((r) => r[idx] ?? "")),
    );
    if (i >= 0) {
      mapping[i] = "date";
      used.add("date");
    }
  }
  if (!used.has("amount") && !used.has("debit") && !used.has("credit")) {
    const i = sheet.headers.findIndex(
      (_, idx) => mapping[idx] === "ignore" && looksNumeric(sample.map((r) => r[idx] ?? "")),
    );
    if (i >= 0) {
      mapping[i] = "amount";
      used.add("amount");
    }
  }
  if (!used.has("description")) {
    const i = sheet.headers.findIndex(
      (_, idx) =>
        mapping[idx] === "ignore" &&
        !looksNumeric(sample.map((r) => r[idx] ?? "")) &&
        sample.some((r) => (r[idx] ?? "").length > 3),
    );
    if (i >= 0) {
      mapping[i] = "description";
      used.add("description");
    }
  }

  const hasAmount = used.has("amount") || used.has("debit") || used.has("credit");
  const uncertain = !used.has("date") || !used.has("description") || !hasAmount;
  return { mapping, uncertain };
}

/* ---------------- value normalization ---------------- */

export function parseAmount(input: string): number | null {
  if (input === null || input === undefined) return null;
  let s = input.toString().trim();
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (/\b(dr|debit)\b\.?$/i.test(s)) negative = true;
  s = s.replace(/\b(dr|cr|debit|credit)\b\.?/gi, "");
  s = s.replace(/[₹$€£,\s]/g, "");
  if (s.startsWith("-")) {
    negative = true;
    s = s.slice(1);
  } else if (s.startsWith("+")) s = s.slice(1);
  if (!s || !/^\d*\.?\d+$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11,
};

export function parseDate(input: string, dayFirst = true): Date | null {
  const s = (input ?? "").toString().trim();
  if (!s) return null;

  // ISO / datetime
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})([T ].*)?$/);
  if (iso) {
    const d = new Date(s.includes("T") ? s : `${iso[1]}-${iso[2]}-${iso[3]}T00:00:00Z`);
    return isNaN(d.getTime()) ? null : d;
  }

  // dd-MMM-yyyy / 12 Jan 2025
  const alpha = s.match(/^(\d{1,2})[\s\-/]([A-Za-z]{3,9})[\s\-/](\d{2,4})/);
  if (alpha) {
    const m = MONTHS[alpha[2].slice(0, 4).toLowerCase()] ?? MONTHS[alpha[2].slice(0, 3).toLowerCase()];
    if (m !== undefined) {
      const y = normYear(alpha[3]);
      return utc(y, m, Number(alpha[1]), s);
    }
  }

  // numeric separated
  const num = s.match(/^(\d{1,4})[/\-.](\d{1,2})[/\-.](\d{2,4})(?:[\s,T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (num) {
    let a = Number(num[1]);
    const b = Number(num[2]);
    let c = num[3];
    if (num[1].length === 4) {
      // yyyy/mm/dd
      return utc(Number(num[1]), b - 1, Number(c), s, num);
    }
    const year = normYear(c);
    let day = a;
    let month = b;
    if (!dayFirst || a > 12) {
      if (a > 12) {
        day = a;
        month = b;
      } else {
        day = b;
        month = a;
      }
    }
    if (month > 12) {
      const t = day;
      day = month;
      month = t;
    }
    return utc(year, month - 1, day, s, num);
  }

  const fallback = new Date(s);
  return isNaN(fallback.getTime()) ? null : fallback;
}

function normYear(y: string): number {
  const n = Number(y);
  if (y.length <= 2) return n + (n < 70 ? 2000 : 1900);
  return n;
}

function utc(y: number, m: number, d: number, _s: string, timeMatch?: RegExpMatchArray | null): Date | null {
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  if (m < 0 || m > 11 || d < 1 || d > 31) return null;
  const hh = timeMatch?.[4] ? Number(timeMatch[4]) : 0;
  const mm = timeMatch?.[5] ? Number(timeMatch[5]) : 0;
  const ss = timeMatch?.[6] ? Number(timeMatch[6]) : 0;
  const date = new Date(Date.UTC(y, m, d, hh, mm, ss));
  return isNaN(date.getTime()) ? null : date;
}

function detectDayFirst(values: string[]): boolean {
  for (const v of values) {
    const m = (v ?? "").match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/);
    if (!m) continue;
    if (Number(m[1]) > 12) return true;
    if (Number(m[2]) > 12) return false;
  }
  return true; // India-first default
}

function normalizeType(raw: string): "Debit" | "Credit" | null {
  const s = (raw ?? "").trim().toLowerCase();
  if (!s) return null;
  if (/^(dr|debit|debited|withdrawal|withdrawn|paid|out|w)$/.test(s) || /debit|withdraw/.test(s))
    return "Debit";
  if (/^(cr|credit|credited|deposit|received|in|c)$/.test(s) || /credit|deposit|received/.test(s))
    return "Credit";
  return null;
}

function inferMethod(explicit: string, description: string): string {
  const e = (explicit ?? "").trim();
  if (e) return e;
  const d = (description ?? "").toLowerCase();
  if (/upi|vpa|@ok|@ybl|@paytm|gpay|phonepe/.test(d)) return "UPI";
  if (/imps/.test(d)) return "IMPS";
  if (/neft/.test(d)) return "NEFT";
  if (/rtgs/.test(d)) return "RTGS";
  if (/atm|cash/.test(d)) return "Cash";
  if (/card|pos|visa|mastercard|rupay/.test(d)) return "Card";
  if (/nach|ach|si\b|mandate|emi/.test(d)) return "Auto Debit";
  return "Bank Transfer";
}

export function dupKey(r: { transaction_date: string; merchant_raw: string; amount: number; transaction_type: string }) {
  return [
    r.transaction_date.slice(0, 10),
    r.merchant_raw.trim().toLowerCase(),
    Math.round(r.amount * 100),
    r.transaction_type,
  ].join("|");
}

/* ---------------- row normalization ---------------- */

export function normalizeRows(
  sheet: ParsedSheet,
  mapping: Mapping,
  existingKeys: Set<string>,
): RowResult[] {
  const col = (field: FieldKey) =>
    Object.keys(mapping)
      .map(Number)
      .find((i) => mapping[i] === field);

  const dateCol = col("date");
  const descCol = col("description");
  const amountCol = col("amount");
  const debitCol = col("debit");
  const creditCol = col("credit");
  const typeCol = col("type");
  const methodCol = col("method");

  const dayFirst =
    dateCol !== undefined ? detectDayFirst(sheet.rows.map((r) => r[dateCol] ?? "")) : true;

  const seen = new Set(existingKeys);
  const results: RowResult[] = [];

  sheet.rows.forEach((raw, index) => {
    const reasons: string[] = [];

    const dateVal = dateCol !== undefined ? raw[dateCol] : "";
    const date = parseDate(dateVal ?? "", dayFirst);
    if (!date) reasons.push(dateVal ? `Unrecognized date "${dateVal}"` : "Missing date");

    const merchant = (descCol !== undefined ? raw[descCol] : "")?.trim() ?? "";
    if (!merchant) reasons.push("Missing description");

    let amount: number | null = null;
    let type: "Debit" | "Credit" | null = null;

    const debitVal = debitCol !== undefined ? parseAmount(raw[debitCol] ?? "") : null;
    const creditVal = creditCol !== undefined ? parseAmount(raw[creditCol] ?? "") : null;

    if (debitVal !== null && Math.abs(debitVal) > 0) {
      amount = Math.abs(debitVal);
      type = "Debit";
    } else if (creditVal !== null && Math.abs(creditVal) > 0) {
      amount = Math.abs(creditVal);
      type = "Credit";
    } else if (amountCol !== undefined) {
      const parsed = parseAmount(raw[amountCol] ?? "");
      if (parsed !== null) {
        amount = Math.abs(parsed);
        if (typeCol !== undefined) type = normalizeType(raw[typeCol] ?? "");
        if (!type) type = parsed < 0 ? "Debit" : "Credit";
        if (!type && /\bcr\b/i.test(raw[amountCol] ?? "")) type = "Credit";
      }
    }

    if (amount === null || !(amount > 0)) reasons.push("Missing or invalid amount");
    if (amount !== null && !type) reasons.push("Could not determine Debit/Credit");

    if (reasons.length > 0 || !date || !type || amount === null) {
      results.push({ status: "review", raw, index, reason: reasons.join(" · ") });
      return;
    }

    const row: NormalizedRow = {
      index,
      transaction_date: date.toISOString(),
      merchant_raw: merchant,
      amount,
      transaction_type: type,
      payment_method: inferMethod(methodCol !== undefined ? raw[methodCol] ?? "" : "", merchant),
    };

    const key = dupKey(row);
    if (seen.has(key)) {
      results.push({ status: "duplicate", raw, row, reason: "Already imported or repeated in file" });
      return;
    }
    seen.add(key);
    results.push({ status: "valid", row, raw });
  });

  return results;
}
