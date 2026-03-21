export function ProtocolChip({ slug }: { slug: string }) {
  const name = slug.charAt(0).toUpperCase() + slug.slice(1);
  return (
    <span className="bg-secondary text-secondary-text rounded-sm px-2.5 py-0.5 text-[0.65rem] font-sans uppercase tracking-[0.05em]">
      {name}
    </span>
  );
}
