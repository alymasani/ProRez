/**
 * Converts provider HTML (untrusted) to plain text. ProRez never renders
 * provider HTML; it stores and displays text only. Pure, no DOM. Headings,
 * paragraphs and list items become separate lines ("- " for items) and link
 * targets are kept inline, so lib/jobs/description.ts can rebuild the layout.
 */
const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—",
  hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", bull: "•", eacute: "é", egrave: "è", agrave: "à",
  ccedil: "ç", ecirc: "ê", ocirc: "ô", icirc: "î", ucirc: "û", euml: "ë", iuml: "ï", copy: "©", reg: "®", trade: "™",
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === "#") {
      const code = entity[1]?.toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    }
    return NAMED[entity.toLowerCase()] ?? match;
  });
}

export function htmlToText(html: string | null | undefined): string {
  if (!html) return "";
  // Greenhouse returns entity-encoded HTML ("&lt;p&gt;"); decode that layer first.
  const source = /&lt;\/?[a-z]/i.test(html) && !/<[a-z]/i.test(html) ? decodeEntities(html) : html;
  const text = source
    .replace(/<(script|style|noscript|iframe|svg)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    // Keep link targets as text ("Apply here (https://…)"); only absolute http(s) URLs.
    .replace(/<a\b[^>]*?\bhref\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi, (_m, _q: string, href: string, inner: string) => {
      const url = decodeEntities(href).trim();
      const label = inner.replace(/<[^>]+>/g, "").trim();
      if (!/^https?:\/\/[^\s<>"']+$/i.test(url)) return inner;
      return label && !decodeEntities(label).includes(url) ? `${inner} (${url})` : url;
    })
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|ul|ol|section|tr|table|blockquote)>/gi, "\n")
    .replace(/<(p|div|h[1-6]|ul|ol|section|table|blockquote)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  return decodeEntities(text)
    .replace(/ /g, " ")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}
