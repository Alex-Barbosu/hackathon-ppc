import { Stagger, StaggerItem } from "../../components/motion/Reveal";
import { SectionTitle } from "../../components/PageHero";
import { TEX_CLASS, type TextureName } from "../../components/Texture";

const STEPS: { n: string; title: string; body: string; tex: TextureName }[] = [
  { n: "01", title: "Hashed on arrival", body: "FileGrid computes the SHA-256 while the bytes stream in, before anything is stored.", tex: "lines-dusk" },
  { n: "02", title: "Stored by policy", body: "Each category goes to its own storage, with a fallback if that storage is down.", tex: "lines-sky" },
  { n: "03", title: "Verified on download", body: "Every download is re-hashed. A mismatch stops it and raises an alert.", tex: "forest" },
];

// Origin's "How it works" row: three photo cards that explain the guarantee before anyone asks.
export function HowItWorks() {
  return (
    <section className="space-y-10 pt-8">
      <SectionTitle sub="The same three steps for every category.">How a file is <em>kept</em>.</SectionTitle>
      <Stagger as="ol" className="grid gap-6 md:grid-cols-3">
        {STEPS.map((s) => (
          <StaggerItem as="li" key={s.n} className="group overflow-hidden rounded-card border-[0.8px] border-line bg-surface transition-colors duration-500 hover:border-white/20">
            <div className="relative h-56 overflow-hidden">
              {/* The picture eases closer on hover, slowly, like a lens. */}
              <div aria-hidden className={`absolute inset-0 transition-transform duration-[1400ms] ease-out group-hover:scale-[1.07] ${TEX_CLASS[s.tex]}`} />
              <span className="label absolute top-5 left-5 rounded-md bg-black/45 px-2 py-1 text-white backdrop-blur-sm">{s.n}</span>
            </div>
            <div className="p-6">
              <h3 className="text-xl tracking-[-0.2px]">{s.title}</h3>
              <p className="mt-2 text-base text-faint">{s.body}</p>
            </div>
          </StaggerItem>
        ))}
      </Stagger>
    </section>
  );
}
