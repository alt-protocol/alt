/* eslint-disable @next/next/no-img-element */

const LOCAL_LOGOS: Record<string, string> = {
  kamino: "/logos/kamino.svg",
  drift: "/logos/drift.svg",
  jupiter: "/logos/jupiter.svg",
  exponent: "/logos/exponent.png",
  "exponent finance": "/logos/exponent.png",
};

export function ProtocolChip({ slug, logoUrl }: { slug: string; logoUrl?: string | null }) {
  const name = slug.charAt(0).toUpperCase() + slug.slice(1);
  const src = LOCAL_LOGOS[slug.toLowerCase()] ?? logoUrl;

  return (
    <span className="inline-flex items-center gap-1.5 text-foreground-muted text-[0.65rem] font-sans uppercase tracking-[0.05em]">
      {src && (
        <img
          src={src}
          alt={name}
          width={16}
          height={16}
          className="rounded-sm"
        />
      )}
      {name}
    </span>
  );
}
