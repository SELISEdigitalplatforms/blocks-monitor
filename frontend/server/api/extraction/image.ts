/**
 * Image extraction — uses Claude Vision API to describe screens, controls, flows, diagrams.
 *
 * Returns structured description with UI elements, text content, and layout observations.
 */

export interface ImageExtractionResult {
  description: string;
  textContent: string;
  uiElements: string[];
  isScreenshot: boolean;
  isDiagram: boolean;
}

/** Extract content from an image using Claude Vision API. */
export async function extractImage(
  buffer: Buffer,
  mimeType: string,
  fileName: string,
  callClaude: (prompt: string, imageBase64: string, imageMimeType: string) => Promise<string>,
): Promise<ImageExtractionResult> {
  const base64 = buffer.toString("base64");

  const prompt = `Analyze this image and return a JSON object with these fields:
{
  "description": "A detailed description of what the image shows (1-3 paragraphs)",
  "textContent": "All visible text in the image, preserving layout with newlines",
  "uiElements": ["list", "of", "UI elements or controls visible"],
  "isScreenshot": true/false,
  "isDiagram": true/false
}

If this is a UI screenshot or mockup, describe:
- The screen's purpose and main action
- All visible form fields, buttons, links, and navigation
- The layout and visual hierarchy
- Any status indicators, notifications, or error states

If this is a diagram (flowchart, architecture, wireframe):
- The entities/nodes and their relationships
- The flow direction and decision points
- Labels and annotations

Return only valid JSON, no markdown.`;

  try {
    const response = await callClaude(prompt, base64, mimeType);
    // Parse the JSON response
    const cleaned = response.replace(/```json\n?|\n?```/g, "").trim();
    const result = JSON.parse(cleaned);
    return {
      description: result.description || `Image: ${fileName}`,
      textContent: result.textContent || "",
      uiElements: Array.isArray(result.uiElements) ? result.uiElements : [],
      isScreenshot: Boolean(result.isScreenshot),
      isDiagram: Boolean(result.isDiagram),
    };
  } catch {
    // Fallback if Claude call fails or returns invalid JSON
    return {
      description: `Image file: ${fileName} (${mimeType}). Automated analysis unavailable.`,
      textContent: "",
      uiElements: [],
      isScreenshot: false,
      isDiagram: false,
    };
  }
}

/** Format image extraction as markdown. */
export function imageToMarkdown(result: ImageExtractionResult, fileName: string): string {
  const lines = [`# ${fileName}\n`];
  if (result.isScreenshot) lines.push(`> Type: UI Screenshot\n`);
  else if (result.isDiagram) lines.push(`> Type: Diagram\n`);
  else lines.push(`> Type: Image\n`);

  lines.push(`## Description\n${result.description}\n`);

  if (result.textContent) {
    lines.push(`## Visible Text\n\`\`\`\n${result.textContent}\n\`\`\`\n`);
  }

  if (result.uiElements.length) {
    lines.push(`## UI Elements\n`);
    for (const el of result.uiElements) {
      lines.push(`- ${el}`);
    }
  }

  return lines.join("\n");
}
