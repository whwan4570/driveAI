export interface Caption {
  who: "me" | "carmori";
  text: string;
  sourceUrl?: string;
  sourceLabel?: string;
}

export function Captions({ items }: { items: Caption[] }) {
  return (
    <ol className="captions">
      {items.slice(-6).map((c, i) => (
        <li key={i} className={c.who}>
          {c.text}
          {c.sourceUrl && <a href={c.sourceUrl} target="_blank" rel="noopener noreferrer">{c.sourceLabel || "Source"}</a>}
        </li>
      ))}
    </ol>
  );
}
