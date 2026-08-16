const DISCLAIMERS = [
  "Based on historical average returns — not guaranteed.",
  "Illustrative only, not personalized investment advice. Consult a SEBI-registered advisor.",
];

function Inline({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("**") && p.endsWith("**") ? (
          <strong key={i} className="font-bold text-foreground">
            {p.slice(2, -2)}
          </strong>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

export function GoalMarkdown({ content }: { content: string }) {
  const lines = content.split("\n").map((l) => l.trim());
  const blocks: React.ReactNode[] = [];
  let bullets: string[] = [];

  const flush = (key: string) => {
    if (bullets.length === 0) return;
    blocks.push(
      <ul key={key} className="space-y-1.5 pl-1">
        {bullets.map((b, i) => (
          <li key={i} className="flex gap-2 text-sm text-foreground/90">
            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
            <span>
              <Inline text={b} />
            </span>
          </li>
        ))}
      </ul>,
    );
    bullets = [];
  };

  lines.forEach((line, idx) => {
    if (!line) {
      flush(`u${idx}`);
      return;
    }
    if (DISCLAIMERS.includes(line.replace(/^['"]|['"]$/g, ""))) {
      flush(`u${idx}`);
      blocks.push(
        <p key={`d${idx}`} className="text-[11px] leading-snug text-muted-foreground/80">
          {line.replace(/^['"]|['"]$/g, "")}
        </p>,
      );
      return;
    }
    if (/^[-*]\s+/.test(line)) {
      bullets.push(line.replace(/^[-*]\s+/, ""));
      return;
    }
    flush(`u${idx}`);
    const isHeadline = /^\*\*[^*]+\*\*$/.test(line);
    blocks.push(
      <p
        key={`p${idx}`}
        className={
          isHeadline
            ? "text-base font-bold leading-snug text-foreground"
            : "text-sm leading-relaxed text-foreground/90"
        }
      >
        <Inline text={line} />
      </p>,
    );
  });
  flush("last");

  return <div className="space-y-3">{blocks}</div>;
}
