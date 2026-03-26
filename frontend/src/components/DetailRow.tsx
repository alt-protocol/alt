export function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between items-center py-2">
      <span className="uppercase text-[0.6rem] tracking-[0.05em] text-foreground-muted font-sans">{label}</span>
      <span className="font-sans text-[0.8rem] text-foreground">{value}</span>
    </div>
  );
}
