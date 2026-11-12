import { linkify, parseDescription } from "@/lib/jobs/description";

/**
 * Renders a stored plain-text job description with its headings, paragraphs,
 * lists and links. Text is passed to React as children (escaped), never as
 * HTML, so provider content cannot inject markup or scripts.
 */
export function JobDescription({ text }: { text: string }) {
  const blocks = parseDescription(text);
  return (
    <div className="space-y-3 text-sm leading-relaxed" data-testid="job-description">
      {blocks.map((block, i) => {
        if (block.kind === "heading") {
          return (
            <h3 key={i} className="pt-2 font-medium text-foreground first:pt-0">
              <Inline text={block.text} />
            </h3>
          );
        }
        if (block.kind === "list") {
          return (
            <ul key={i} className="list-disc space-y-1.5 pl-5 text-muted-foreground">
              {block.items.map((item, j) => (
                <li key={j}>
                  <Inline text={item} />
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p key={i} className="text-muted-foreground">
            <Inline text={block.text} />
          </p>
        );
      })}
    </div>
  );
}

function Inline({ text }: { text: string }) {
  return linkify(text).map((segment, i) =>
    segment.kind === "link" ? (
      <a
        key={i}
        href={segment.href}
        target="_blank"
        rel="noopener noreferrer nofollow"
        className="break-all text-foreground underline underline-offset-2"
      >
        {segment.text}
      </a>
    ) : (
      segment.text
    ),
  );
}
