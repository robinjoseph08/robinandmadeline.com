interface PageHeaderProps {
  title: string;
  subtitle: string;
}

/** Centered page title and one-line intro shared by the public content pages. */
export default function PageHeader({ title, subtitle }: PageHeaderProps) {
  return (
    <header className="text-center">
      <h1 className="font-display text-4xl font-normal text-ink">{title}</h1>
      <p className="mt-3 text-ink-muted">{subtitle}</p>
    </header>
  );
}
