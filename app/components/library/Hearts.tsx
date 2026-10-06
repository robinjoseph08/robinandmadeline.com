import { Heart } from "lucide-react";

/**
 * Our blue and pink hearts, set inline at the end of a sentence. Sized in em so
 * they track the surrounding text, and nudged down just enough that the heart
 * shapes (which sit inset in Lucide's 24px box) rest on the text baseline.
 */
export function Hearts() {
  return (
    <span className="inline-flex items-center gap-0.5 align-[-0.05em]">
      <Heart aria-hidden className="size-[0.8em] fill-blue text-blue" />
      <Heart aria-hidden className="size-[0.8em] fill-rose text-rose" />
    </span>
  );
}
