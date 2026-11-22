/**
 * Spreadsheet extraction — sheet names, columns, rows as markdown tables.
 */

export interface SpreadsheetExtractionResult {
  sheets: { name: string; columns: string[]; rowCount: number; preview: string[][] }[];
  totalSheets: number;
  markdown: string;
}

/** Extract structured content from an Excel/CSV buffer. */
export async function extractSpreadsheet(buffer: Buffer, fileName: string, mimeType: string): Promise<SpreadsheetExtractionResult> {
  // CSV: parse directly
  if (mimeType === "text/csv" || fileName.endsWith(".csv")) {
    return extractCsv(buffer.toString("utf-8"), fileName);
  }

  // Excel: use xlsx library
  let XLSX: any;
  try {
    // @ts-ignore — xlsx is an optional dependency
    XLSX = await import("xlsx");
  } catch {
    return {
      sheets: [],
      totalSheets: 0,
      markdown: `[Spreadsheet: ${fileName}, content extraction unavailable — install xlsx]`,
    };
  }

  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheets: SpreadsheetExtractionResult["sheets"] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const data: string[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
    const columns = data[0]?.map(String) || [];
    const rows = data.slice(1);

    sheets.push({
      name: sheetName,
      columns,
      rowCount: rows.length,
      preview: rows.slice(0, 20).map(r => r.map(String)), // first 20 rows
    });
  }

  return {
    sheets,
    totalSheets: sheets.length,
    markdown: sheetsToMarkdown(sheets, fileName),
  };
}

/** Parse CSV text into the same format. */
function extractCsv(text: string, fileName: string): SpreadsheetExtractionResult {
  const lines = text.split("\n").map(l => l.split(",").map(c => c.trim().replace(/^"|"$/g, "")));
  const columns = lines[0] || [];
  const rows = lines.slice(1).filter(r => r.some(c => c));

  const sheet = {
    name: "Sheet1",
    columns,
    rowCount: rows.length,
    preview: rows.slice(0, 20),
  };

  return {
    sheets: [sheet],
    totalSheets: 1,
    markdown: sheetsToMarkdown([sheet], fileName),
  };
}

/** Convert sheets to markdown tables. */
function sheetsToMarkdown(sheets: SpreadsheetExtractionResult["sheets"], fileName: string): string {
  const lines = [`# ${fileName}\n`];

  for (const sheet of sheets) {
    lines.push(`\n## Sheet: ${sheet.name} (${sheet.rowCount} rows)\n`);

    if (sheet.columns.length) {
      lines.push("| " + sheet.columns.join(" | ") + " |");
      lines.push("|" + sheet.columns.map(() => "---").join("|") + "|");

      for (const row of sheet.preview) {
        lines.push("| " + row.map(c => (c || "").slice(0, 100)).join(" | ") + " |");
      }

      if (sheet.rowCount > 20) {
        lines.push(`\n*... ${sheet.rowCount - 20} more rows*`);
      }
    }
  }

  return lines.join("\n");
}
