export interface Caption {
  who: "me" | "carmori";
  text: string;
}

export function Captions({ items }: { items: Caption[] }) {
  return (
    <ol className="captions">
      {items.slice(-6).map((c, i) => (
        <li key={i} className={c.who}>
          {c.text}
        </li>
      ))}
    </ol>
  );
}
