/** Crew measures each result text in UTF-8 bytes, independently from the provider response ceiling. */
export const CONNECTION_TEXT_MAX_BYTES = 32_768;
const CONNECTION_RESPONSE_MAX_BYTES = 65_536;
const TRUNCATION_NOTICE = "\n\n[Content truncated because it exceeds the result limit.]";

/** Account for both the text block and its JSON escaping in Crew's execution response. */
export function connectionTextFits(text: string): boolean {
  if (Buffer.byteLength(text, "utf8") > CONNECTION_TEXT_MAX_BYTES) return false;
  const response = {
    schema: "crew.connections-execution-result/v1",
    content: [{ type: "text", text }],
    isError: false,
  };
  return Buffer.byteLength(JSON.stringify(response), "utf8") <= CONNECTION_RESPONSE_MAX_BYTES;
}

/** Fit a visible prefix without splitting a Unicode character or hiding truncation. */
export function boundedConnectionText(
  text: string,
  project: (candidate: string) => string = (candidate) => candidate,
): string {
  const fits = (candidate: string) => connectionTextFits(project(candidate));
  if (fits(text)) return text;
  if (!fits(TRUNCATION_NOTICE))
    throw new RangeError("Connection result metadata exceeds the text limit");
  const prefix = (length: number) => {
    const end = text.charCodeAt(length - 1);
    return text.slice(0, end >= 0xd800 && end <= 0xdbff ? length - 1 : length);
  };
  let lower = 0;
  let upper = text.length;
  while (lower < upper) {
    const middle = Math.ceil((lower + upper) / 2);
    if (fits(prefix(middle) + TRUNCATION_NOTICE)) lower = middle;
    else upper = middle - 1;
  }
  return prefix(lower) + TRUNCATION_NOTICE;
}
