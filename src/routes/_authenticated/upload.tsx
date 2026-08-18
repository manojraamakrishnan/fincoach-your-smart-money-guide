import { useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  UploadCloud,
  FileText,
  X,
  Download,
  Trash2,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Copy,
  Wand2,
} from "lucide-react";
import { toast } from "sonner";
import { ClayCard } from "@/components/ClayCard";
import { supabase } from "@/integrations/supabase/client";
import {
  FIELD_LABELS,
  detectMapping,
  dupKey,
  normalizeRows,
  parseFile,
  type FieldKey,
  type Mapping,
  type ParsedSheet,
  type RowResult,
} from "@/lib/smart-import";
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
      { title: "Import Statement — FinCoach" },
      {
        name: "description",
        content:
          "Upload any bank, credit card or UPI statement — FinCoach detects the columns and imports it for you.",
      },
      { property: "og:title", content: "Import Statement — FinCoach" },
      {
        property: "og:description",
        content: "Smart CSV & XLSX statement import with automatic column detection.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: UploadPage,
});

const SAMPLE_CSV = `Txn Date,Narration,Withdrawal Amt,Deposit Amt,Mode
01/07/2025,UPI/SWIGGY/Order payment,450.00,,UPI
02/07/2025,SALARY CREDIT JULY,,75000.00,Bank Transfer
03/07/2025,POS/BIGBASKET RETAIL,1250.50,,Card
`;

const FIELD_OPTIONS: FieldKey[] = [
  "ignore",
  "date",
  "description",
  "amount",
  "debit",
  "credit",
  "type",
  "method",
];

const currency = (n: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(n);

function UploadPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [sheet, setSheet] = useState<ParsedSheet | null>(null);
  const [mapping, setMapping] = useState<Mapping>({});
  const [uncertain, setUncertain] = useState(false);
  const [existingKeys, setExistingKeys] = useState<Set<string>>(new Set());
  const [parseError, setParseError] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showReview, setShowReview] = useState(false);

  const results: RowResult[] = useMemo(() => {
    if (!sheet) return [];
    return normalizeRows(sheet, mapping, existingKeys);
  }, [sheet, mapping, existingKeys]);

  const valid = results.filter((r) => r.status === "valid");
  const duplicates = results.filter((r) => r.status === "duplicate");
  const review = results.filter((r) => r.status === "review");

  async function pickFile(f: File | undefined | null) {
    if (!f) return;
    const name = f.name.toLowerCase();
    if (!/\.(csv|xlsx|xls|txt)$/.test(name)) {
      toast.error("Please upload a CSV or XLSX file.");
      return;
    }
    setFile(f);
    setParseError(null);
    setSheet(null);
    setShowReview(false);
    setAnalyzing(true);
    try {
      const parsed = await parseFile(f);
      if (parsed.rows.length === 0) {
        setParseError("We couldn't find any data rows in this file.");
        return;
      }
      const { mapping: guess, uncertain: unsure } = detectMapping(parsed);

      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;
      const keys = new Set<string>();
      if (userId) {
        const { data: existing } = await supabase
          .from("transactions")
          .select("transaction_date, merchant_raw, amount, transaction_type")
          .eq("user_id", userId);
        for (const t of existing ?? []) {
          keys.add(
            dupKey({
              transaction_date: t.transaction_date,
              merchant_raw: t.merchant_raw,
              amount: Number(t.amount),
              transaction_type: t.transaction_type,
            }),
          );
        }
      }

      setExistingKeys(keys);
      setMapping(guess);
      setUncertain(unsure);
      setSheet(parsed);
    } catch (e) {
      setParseError(e instanceof Error ? e.message : "Failed to read this file");
    } finally {
      setAnalyzing(false);
    }
  }

  function clearFile() {
    setFile(null);
    setSheet(null);
    setMapping({});
    setParseError(null);
    setShowReview(false);
    if (inputRef.current) inputRef.current.value = "";
  }

  function setColumn(index: number, field: FieldKey) {
    setMapping((prev) => {
      const next = { ...prev, [index]: field };
      if (field !== "ignore") {
        for (const k of Object.keys(next).map(Number)) {
          if (k !== index && next[k] === field) next[k] = "ignore";
        }
      }
      return next;
    });
  }

  function downloadSample() {
    const blob = new Blob([SAMPLE_CSV], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "fincoach_sample_statement.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function confirmImport() {
    if (valid.length === 0) return;
    setImporting(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;
      if (!userId) {
        toast.error("Not signed in.");
        return;
      }

      const payload = valid.map((r) => ({
        user_id: userId,
        transaction_date: r.row.transaction_date,
        merchant_raw: r.row.merchant_raw,
        amount: r.row.amount,
        transaction_type: r.row.transaction_type,
        payment_method: r.row.payment_method,
        category: null,
      }));

      for (let i = 0; i < payload.length; i += 500) {
        const { error } = await supabase.from("transactions").insert(payload.slice(i, i + 500));
        if (error) throw error;
      }

      toast.success(
        `${payload.length} imported · ${duplicates.length} duplicates skipped · ${review.length} needed review`,
      );
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

  const previewRows = valid.slice(0, 5);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-extrabold tracking-tight text-foreground">Import Statement</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Upload your bank, card or UPI statement as-is — we detect the format for you
        </p>
      </header>

      <ClayCard className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">Not sure what to upload?</p>
          <p className="text-xs text-muted-foreground">
            Any CSV or XLSX statement works. Grab a sample if you need one.
          </p>
        </div>
        <button
          type="button"
          onClick={downloadSample}
          className="clay-hover flex shrink-0 items-center gap-2 rounded-2xl bg-secondary px-3 py-2 text-xs font-semibold text-foreground"
        >
          <Download className="h-3.5 w-3.5" />
          Sample
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
            {analyzing ? (
              <Loader2 className="h-8 w-8 animate-spin" strokeWidth={2} />
            ) : (
              <UploadCloud className="h-8 w-8" strokeWidth={2} />
            )}
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">
              {analyzing ? "Reading your file…" : "Tap to browse or drag & drop"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">CSV or XLSX · any bank format</p>
          </div>
          <input
            ref={inputRef}
            type="file"
            accept=".csv,.xlsx,.xls,text/csv"
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
                {sheet ? ` · ${sheet.rows.length} row${sheet.rows.length === 1 ? "" : "s"}` : ""}
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

      {sheet ? (
        <>
          <ClayCard className="space-y-3">
            <div className="flex items-center gap-2">
              <Wand2 className="h-4 w-4 text-primary" />
              <h2 className="text-base font-bold text-foreground">Detected columns</h2>
            </div>
            <p className="text-xs text-muted-foreground">
              We matched your file's columns automatically. Adjust any that look wrong.
            </p>
            {uncertain ? (
              <div className="flex items-start gap-2 rounded-2xl border border-warning/30 bg-warning/5 p-3 text-xs text-foreground">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
                <span>
                  Some fields weren't confidently detected. Please check date, description and
                  amount below.
                </span>
              </div>
            ) : null}

            <div className="space-y-2">
              {sheet.headers.map((h, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 rounded-2xl bg-secondary/50 p-2.5 clay-inset"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-semibold text-foreground">{h}</p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {sheet.rows.find((r) => (r[i] ?? "").length > 0)?.[i] ?? "—"}
                    </p>
                  </div>
                  <select
                    value={mapping[i] ?? "ignore"}
                    onChange={(e) => setColumn(i, e.target.value as FieldKey)}
                    className="shrink-0 rounded-xl border border-border bg-card px-2 py-1.5 text-xs font-medium text-foreground"
                    aria-label={`Map column ${h}`}
                  >
                    {FIELD_OPTIONS.map((f) => (
                      <option key={f} value={f}>
                        {FIELD_LABELS[f]}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </ClayCard>

          <div className="grid grid-cols-3 gap-3">
            <ClayCard className="p-3 text-center">
              <CheckCircle2 className="mx-auto h-4 w-4 text-success" />
              <p className="mt-1 text-lg font-extrabold tabular-nums text-foreground">
                {valid.length}
              </p>
              <p className="text-[11px] text-muted-foreground">Ready</p>
            </ClayCard>
            <ClayCard className="p-3 text-center">
              <Copy className="mx-auto h-4 w-4 text-muted-foreground" />
              <p className="mt-1 text-lg font-extrabold tabular-nums text-foreground">
                {duplicates.length}
              </p>
              <p className="text-[11px] text-muted-foreground">Duplicates</p>
            </ClayCard>
            <ClayCard className="p-3 text-center">
              <AlertTriangle className="mx-auto h-4 w-4 text-warning" />
              <p className="mt-1 text-lg font-extrabold tabular-nums text-foreground">
                {review.length}
              </p>
              <p className="text-[11px] text-muted-foreground">Need review</p>
            </ClayCard>
          </div>

          {previewRows.length > 0 ? (
            <ClayCard className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-bold text-foreground">Preview</h2>
                <span className="rounded-full bg-secondary px-3 py-1 text-xs font-medium text-muted-foreground">
                  First {previewRows.length} of {valid.length}
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
                    {previewRows.map((r, i) => (
                      <tr key={i} className="text-foreground">
                        <td className="px-2 py-2 whitespace-nowrap">
                          {r.row.transaction_date.slice(0, 10)}
                        </td>
                        <td className="max-w-[160px] truncate px-2 py-2">{r.row.merchant_raw}</td>
                        <td className="px-2 py-2 tabular-nums whitespace-nowrap">
                          {currency(r.row.amount)}
                        </td>
                        <td className="px-2 py-2">{r.row.transaction_type}</td>
                        <td className="px-2 py-2">{r.row.payment_method}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </ClayCard>
          ) : null}

          {review.length > 0 ? (
            <ClayCard className="space-y-3">
              <button
                type="button"
                onClick={() => setShowReview((v) => !v)}
                className="flex w-full items-center justify-between text-left"
              >
                <span className="text-base font-bold text-foreground">
                  {review.length} row{review.length === 1 ? "" : "s"} need review
                </span>
                <span className="text-xs font-semibold text-primary">
                  {showReview ? "Hide" : "Show"}
                </span>
              </button>
              <p className="text-xs text-muted-foreground">
                These rows will be skipped. Fix the column mapping above if this looks wrong.
              </p>
              {showReview ? (
                <ul className="space-y-2">
                  {review.slice(0, 20).map((r) => (
                    <li
                      key={r.index}
                      className="rounded-2xl bg-secondary/50 p-2.5 text-[11px] clay-inset"
                    >
                      <p className="truncate font-medium text-foreground">
                        Row {r.index + 2}: {r.raw.filter(Boolean).slice(0, 3).join(" · ") || "empty"}
                      </p>
                      <p className="mt-0.5 text-warning">{r.reason}</p>
                    </li>
                  ))}
                </ul>
              ) : null}
            </ClayCard>
          ) : null}
        </>
      ) : null}

      <button
        type="button"
        disabled={valid.length === 0 || importing || !!parseError}
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
            {valid.length > 0 ? `Confirm & Import ${valid.length}` : "Confirm & Import"}
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
                This will permanently remove every transaction on your account. Your dashboard and
                insights will reset to an empty state.
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
