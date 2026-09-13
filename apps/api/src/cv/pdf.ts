import { PDFParse } from 'pdf-parse';

export async function extractPdfText(data: Uint8Array): Promise<string> {
  const parser = new PDFParse({ data });
  try {
    const result = await parser.getText();
    return result.text;
  } finally {
    await parser.destroy();
  }
}
