interface PagePlaceholderProps {
  title: string;
  description: string;
  children?: React.ReactNode;
}

/**
 * Shared scaffold for placeholder pages: a heading, a short description, and
 * optional extra content (e.g. links to deeper routes). Real page content
 * lands in later issues.
 */
export default function PagePlaceholder({
  title,
  description,
  children,
}: PagePlaceholderProps) {
  return (
    <section className="mx-auto max-w-2xl py-8">
      <h1 className="text-3xl font-bold">{title}</h1>
      <p className="mt-3 text-muted-foreground">{description}</p>
      {children ? <div className="mt-6">{children}</div> : null}
    </section>
  );
}
