/**
 * DOCX extraction — headings, paragraphs, lists, tables (preserves structure).
 */

export interface DocxExtractionResult {
  html: string;
  markdown: string;
  headings: string[];
  hasTables: boolean;
  hasLists: boolean;
}

/** Extract structured content from a DOCX buffer. */
export async function extractDocx(buffer: Buffer, fileName: string): Promise<DocxExtractionResult> {
  let mammoth: { convertToHtml: (input: { buffer: Buffer }) => Promise<{ value: string }> };
  try {
    // @ts-ignore — mammoth is an optional dependency
    mammoth = await import("mammoth");
  } catch {
    return {
      html: "",
      markdown: `[DOCX: ${fileName}, content extraction unavailable — install mammoth]`,
      headings: [],
      hasTables: false,
      hasLists: false,
    };
  }

  const result = await mammoth.convertToHtml({ buffer });
  const html = result.value;

  // Extract headings
  const headingMatches = html.matchAll(/<h[1-6][^>]*>(.*?)<\/h[1-6]>/gi);
  const headings = [...headingMatches].map(m => stripHtml(m[1]));

  // Convert HTML to markdown-like text
  const markdown = htmlToMarkdown(html, fileName);

  return {
    html,
    markdown,
    headings,
    hasTables: html.includes("<table"),
    hasLists: html.includes("<li"),
  };
}

/** Format DOCX extraction as markdown. */
export function docxToMarkdown(result: DocxExtractionResult): string {
  return result.markdown;
}

/** Simple HTML to Markdown converter (no external deps). */
function htmlToMarkdown(html: string, fileName: string): string {
  let md = `# ${fileName}\n\n`;

  md += html
    // Headings
    .replace(/<h1[^>]*>(.*?)<\/h1>/gi, "\n# $1\n")
    .replace(/<h2[^>]*>(.*?)<\/h2>/gi, "\n## $1\n")
    .replace(/<h3[^>]*>(.*?)<\/h3>/gi, "\n### $1\n")
    .replace(/<h4[^>]*>(.*?)<\/h4>/gi, "\n#### $1\n")
    .replace(/<h5[^>]*>(.*?)<\/h5>/gi, "\n##### $1\n")
    .replace(/<h6[^>]*>(.*?)<\/h6>/gi, "\n###### $1\n")
    // Bold, italic
    .replace(/<strong[^>]*>(.*?)<\/strong>/gi, "**$1**")
    .replace(/<b[^>]*>(.*?)<\/b>/gi, "**$1**")
    .replace(/<em[^>]*>(.*?)<\/em>/gi, "*$1*")
    .replace(/<i[^>]*>(.*?)<\/i>/gi, "*$1*")
    // Lists
    .replace(/<li[^>]*>(.*?)<\/li>/gi, "- $1\n")
    .replace(/<\/?[ou]l[^>]*>/gi, "\n")
    // Tables (preserve as best we can)
    .replace(/<tr[^>]*>(.*?)<\/tr>/gi, (_, row: string) => {
      const cells = [...row.matchAll(/<t[dh][^>]*>(.*?)<\/t[dh]>/gi)].map(m => stripHtml(m[1]));
      return "| " + cells.join(" | ") + " |\n";
    })
    .replace(/<\/?table[^>]*>/gi, "\n")
    .replace(/<\/?thead[^>]*>/gi, "")
    .replace(/<\/?tbody[^>]*>/gi, "")
    // Paragraphs and line breaks
    .replace(/<p[^>]*>(.*?)<\/p>/gi, "$1\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    // Strip remaining tags
    .replace(/<[^>]+>/g, "")
    // Clean up whitespace
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return md;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, "").trim();
}
