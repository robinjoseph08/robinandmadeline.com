import pattern from "@/assets/floral/pattern.webp";

/**
 * Faint floral patterns in the outer page margins (outside the max-w-5xl reading
 * column), fading into the solid #f5f5f5 toward the content so the reading area
 * stays clean. They scroll with the page (absolute, not fixed) and only show on
 * wide screens that have real margin. Purely decorative.
 */
export default function BackgroundPattern() {
  const strip = {
    backgroundImage: `url(${pattern})`,
    backgroundRepeat: "repeat",
    backgroundSize: "300px auto",
    opacity: 0.15,
    width: "calc((100vw - 64rem) / 2)",
  } as const;

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 z-0 hidden select-none xl:block"
    >
      <div
        className="absolute inset-y-0 left-0"
        style={{
          ...strip,
          maskImage: "linear-gradient(to left, transparent, black 55%)",
          WebkitMaskImage: "linear-gradient(to left, transparent, black 55%)",
        }}
      />
      <div
        className="absolute inset-y-0 right-0"
        style={{
          ...strip,
          maskImage: "linear-gradient(to right, transparent, black 55%)",
          WebkitMaskImage: "linear-gradient(to right, transparent, black 55%)",
        }}
      />
    </div>
  );
}
