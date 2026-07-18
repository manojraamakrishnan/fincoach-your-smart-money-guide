import { useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { UploadCloud, FileText, X, Download, Trash2, Loader2, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { ClayCard } from "@/components/ClayCard";
import { supabase } from "@/integrations/supabase/client";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/_authenticated/upload")({
  head: () => ({
    meta: [
      { title: "Upload Statement — FinCoach" },
      { name: "description", content: "Upload your UPI transaction statement." },
    ],
  }),
  component: UploadPage,
});

const REQUIRED_COLS = [
  "transaction_date",
  "merchant_raw",
  "amount",
  "transaction_type",
  "payment_method",
] as const;

type Row = Record<(typeof REQUIRED_COLS)[number], string>;

const SAMPLE_CSV = `transaction_date,merchant_raw,amount,transaction_type,payment_method
2025-07-01T10:30:00Z,Swiggy,450,Debit,UPI
2025-07-02T14:15:00Z,Salary Credit,75000,Credit,Bank Transfer
2025-07-03T19:45:00Z,BigBasket,1250.50,Debit,UPI
`;

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
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function parseCsv(text: string): { headers: string[]; rows: Row[] } {
  const lines = text.replace(/\r\n/g, "\n").split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };
  const headers = parseCsvLine(lines[0]).map((h) => h.toLowerCase());
  const rows: Row[] = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = parseCsvLine(lines[i]);
    const row = {} as Row;
    for (const col of REQUIRED_COLS) {
      const idx = headers.indexOf(col);
      row[col] = idx >= 0 ? vals[idx] ?? "" : "";
    }
    rows.push(row);
  }
  return { headers, rows };
}

function UploadPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function pickFile(f: File | undefined | null) {
    if (!f) return;
    if (!f.name.toLowerCase().endsWith(".csv")) {
      toast.error("Please upload a CSV file.");
      return;
    }
    setFile(f);
    setParseError(null);
    setRows(null);
    try {
      const text = await f.text();
      const { headers, rows } = parseCsv(text);
      const missing = REQUIRED_COLS.filter((c) => !headers.includes(c));
      if (missing.length) {
        setParseError(`Missing required column(s): ${missing.join(", ")}`);
        return;
      }
      if (rows.length === 0) {
        setParseError("CSV has no data rows.");
        return;
      }
      setRows(rows);
    } catch (e) {
      setParseError(e instanceof Error ? e.message : "Failed to parse CSV");
    }
  }

  function clearFile() {
    setFile(null);
    setRows(null);
    setParseError(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  function downloadSample() {
    const blob = new Blob([SAMPLE_CSV], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "fincoach_sample_transactions.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function confirmImport() {
    if (!rows) return;
    setImporting(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;
      if (!userId) {
        toast.error("Not signed in.");
        return;
      }

      const valid: Array<{
        user_id: string;
        transaction_date: string;
        merchant_raw: string;
        amount: number;
        transaction_type: string;
        payment_method: string;
        category: null;
      }> = [];
      let skipped = 0;

      for (const r of rows) {
        const amt = Number(r.amount);
        const type = r.transaction_type?.trim();
        const date = r.transaction_date?.trim();
        const merchant = r.merchant_raw?.trim();
        const method = r.payment_method?.trim();
        if (
          !date ||
          !merchant ||
          !method ||
          !Number.isFinite(amt) ||
          !(type === "Debit" || type === "Credit")
        ) {
          skipped++;
          continue;
        }
        valid.push({
          user_id: userId,
          transaction_date: new Date(date).toISOString(),
          merchant_raw: merchant,
          amount: amt,
          transaction_type: type,
          payment_method: method,
          category: null,
        });
      }

      if (valid.length > 0) {
        const { error } = await supabase.from("transactions").insert(valid);
        if (error) throw error;
      }

      toast.success(`${valid.length} imported, ${skipped} skipped`);
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["insights"] });
      clearFile();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed");
    } finally {
      setImporting(false);
    }
  }

  async function deleteAll() {
    setDeleting(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;
      if (!userId) {
        toast.error("Not signed in.");
        return;
      }
      const { error } = await supabase.from("transactions").delete().eq("user_id", userId);
      if (error) throw error;
      toast.success("All your transactions were deleted.");
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["insights"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeleting(false);
    }
  }

  const preview = rows?.slice(0, 5) ?? [];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-extrabold tracking-tight text-foreground">
          Upload Statement
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Upload your UPI transaction statement to get started
        </p>
      </header>

      <ClayCard className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">Need a template?</p>
          <p className="text-xs text-muted-foreground">
            Download the sample CSV with required columns
          </p>
        </div>
        <button
          type="button"
          onClick={downloadSample}
          className="clay-hover flex shrink-0 items-center gap-2 rounded-2xl bg-secondary px-3 py-2 text-xs font-semibold text-foreground"
        >
          <Download className="h-3.5 w-3.5" />
          Sample CSV
        </button>
      </ClayCard>

      <ClayCard>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            pickFile(e.dataTransfer.files?.[0]);
          }}
          className={`flex w-full flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed px-6 py-12 text-center transition-colors ${
            dragging ? "border-primary bg-primary/5" : "border-border bg-secondary/50"
          }`}
        >
          <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-primary/10 text-primary">
            <UploadCloud className="h-8 w-8" strokeWidth={2} />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">
              Tap to browse or drag & drop
            </p>
            <p className="mt-1 text-xs text-muted-foreground">CSV files only</p>
          </div>
          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => pickFile(e.target.files?.[0])}
          />
        </button>

        {file ? (
          <div className="mt-4 flex items-center gap-3 rounded-2xl bg-secondary/60 p-3 clay-inset">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-success/10 text-success">
              <FileText className="h-5 w-5" strokeWidth={2.2} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">{file.name}</p>
              <p className="text-xs text-muted-foreground">
                {(file.size / 1024).toFixed(1)} KB
                {rows ? ` · ${rows.length} row${rows.length === 1 ? "" : "s"}` : ""}
              </p>
            </div>
            <button
              type="button"
              onClick={clearFile}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
              aria-label="Remove file"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : null}

        {parseError ? (
          <div className="mt-4 rounded-2xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            {parseError}
          </div>
        ) : null}
      </ClayCard>

      {rows && preview.length > 0 ? (
        <ClayCard className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-foreground">Preview</h2>
            <span className="rounded-full bg-secondary px-3 py-1 text-xs font-medium text-muted-foreground">
              First 5 of {rows.length}
            </span>
          </div>
          <div className="-mx-2 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="text-muted-foreground">
                  <th className="px-2 py-2 font-medium">Date</th>
                  <th className="px-2 py-2 font-medium">Merchant</th>
                  <th className="px-2 py-2 font-medium">Amount</th>
                  <th className="px-2 py-2 font-medium">Type</th>
                  <th className="px-2 py-2 font-medium">Method</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {preview.map((r, i) => (
                  <tr key={i} className="text-foreground">
                    <td className="px-2 py-2 whitespace-nowrap">{r.transaction_date}</td>
                    <td className="px-2 py-2">{r.merchant_raw}</td>
                    <td className="px-2 py-2 tabular-nums">{r.amount}</td>
                    <td className="px-2 py-2">{r.transaction_type}</td>
                    <td className="px-2 py-2">{r.payment_method}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ClayCard>
      ) : null}

      <button
        type="button"
        disabled={!rows || importing || !!parseError}
        onClick={confirmImport}
        className="clay-hover flex w-full items-center justify-center gap-2 rounded-2xl bg-primary py-3.5 text-sm font-semibold text-primary-foreground shadow-[var(--clay-primary-shadow)] transition-all active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
      >
        {importing ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Importing…
          </>
        ) : (
          <>
            <CheckCircle2 className="h-4 w-4" />
            Confirm & Import
          </>
        )}
      </button>

      <ClayCard className="space-y-3">
        <div>
          <h2 className="text-base font-bold text-foreground">Danger zone</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Permanently remove all your transactions. This cannot be undone.
          </p>
        </div>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <button
              type="button"
              disabled={deleting}
              className="clay-hover flex w-full items-center justify-center gap-2 rounded-2xl bg-destructive/10 py-3 text-sm font-semibold text-destructive disabled:opacity-60"
            >
              {deleting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              Delete All My Transactions
            </button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete all your transactions?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently remove every transaction on your account. Your
                dashboard and insights will reset to an empty state.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={deleteAll}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Yes, delete everything
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </ClayCard>
    </div>
  );
}
