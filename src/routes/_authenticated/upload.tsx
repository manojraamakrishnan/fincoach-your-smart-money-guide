import { useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { UploadCloud, FileText, X } from "lucide-react";
import { toast } from "sonner";
import { ClayCard } from "@/components/ClayCard";

export const Route = createFileRoute("/_authenticated/upload")({
  head: () => ({
    meta: [
      { title: "Upload Statement — FinCoach" },
      { name: "description", content: "Upload your UPI transaction statement." },
    ],
  }),
  component: UploadPage,
});

function UploadPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);

  function pickFile(f: File | undefined | null) {
    if (!f) return;
    if (!f.name.toLowerCase().endsWith(".csv")) {
      toast.error("Please upload a CSV file.");
      return;
    }
    setFile(f);
  }

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
              </p>
            </div>
            <button
              type="button"
              onClick={() => setFile(null)}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
              aria-label="Remove file"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : null}
      </ClayCard>

      <button
        type="button"
        disabled={!file}
        onClick={() => toast.info("Analysis coming soon — this is a demo.")}
        className="w-full rounded-2xl bg-primary py-3.5 text-sm font-semibold text-primary-foreground shadow-[var(--clay-primary-shadow)] transition-all hover:brightness-105 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
      >
        Analyze Transactions
      </button>
    </div>
  );
}
