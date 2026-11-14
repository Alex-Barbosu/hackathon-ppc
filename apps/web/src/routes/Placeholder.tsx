export function Placeholder({ title, line }: { title: string; line: string }) {
  return (
    <div className="max-w-3xl">
      <h1 className="font-display text-4xl font-semibold sm:text-5xl">{title}</h1>
      <p className="mt-3 max-w-xl text-muted">{line}</p>
    </div>
  );
}
