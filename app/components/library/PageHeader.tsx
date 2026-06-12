interface PageHeaderProps {
  title: string;
  subtitle: string;
}

/** Centered page title and one-line intro shared by the public content pages. */
export default function PageHeader({ title, subtitle }: PageHeaderProps) {
  return (
    <header className="text-center">
      <h1 className="text-4xl font-bold tracking-tight">{title}</h1>
      <p className="mt-3 text-ink/70">{subtitle}</p>
    </header>
  );
}
