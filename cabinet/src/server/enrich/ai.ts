// Optional AI enrichment with Claude: tags, a short summary, and for images a
// description plus any legible text, so pictures become searchable by what
// is in them. Runs only when the user has enabled it and added an API key.

import Anthropic from "@anthropic-ai/sdk";
import { betaJSONSchemaOutputFormat } from "@anthropic-ai/sdk/helpers/beta/json-schema";

export const AI_MODELS = [
  { id: "claude-opus-5", label: "Claude Opus 5" },
  { id: "claude-sonnet-5", label: "Claude Sonnet 5" },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
] as const;

export interface AiInput {
  kind: string;
  linkType: string | null;
  title: string | null;
  description: string | null;
  url: string | null;
  siteName: string | null;
  text: string | null;
  note: string | null;
  image?: { data: string; mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif" };
  /** Tags already used in the library, so the model can reuse them. */
  vocabulary: string[];
}

export interface AiResult {
  tags: string[];
  summary: string | null;
  imageDescription: string | null;
  imageText: string | null;
}

export class AiError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

const SCHEMA = {
  type: "object",
  properties: {
    tags: { type: "array", items: { type: "string" } },
    summary: { type: "string" },
    image_description: { type: "string" },
    image_text: { type: "string" },
  },
  required: ["tags", "summary", "image_description", "image_text"],
  additionalProperties: false,
} as const;

const SYSTEM = `You file things for a private, personal library where people save images, links, articles, products, recipes, quotes and notes to find again later. There are no folders, so your tags and descriptions are how items get found.

For each item, return:
- tags: 3 to 7 short lowercase tags (one or two words each) that someone would plausibly type when searching for this item later: subject, style, medium, mood, setting, category or brand. Prefer reusing tags from the provided vocabulary when they fit. No hashtags, no generic tags like "image", "link", "website" or "content".
- summary: for articles, links, documents and notes, one or two plain sentences on what it is about. Empty string if there is nothing to summarise.
- image_description: when an image is attached, one or two sentences describing what is visible (objects, colours, composition, style) so it can be found by describing it. Empty string otherwise.
- image_text: legible text that appears in the attached image, verbatim, trimmed to the meaningful part (at most about 600 characters). Empty string if there is no text or no image.`;

function supportsEffort(model: string): boolean {
  return /^claude-(opus-(5|4-[5-9])|sonnet-5|fable|mythos)/.test(model);
}

function supportsFallbacks(model: string): boolean {
  return /^claude-(opus-5|fable)/.test(model);
}

function describe(input: AiInput): string {
  const lines: string[] = [];
  lines.push(`Kind: ${input.kind}${input.linkType ? ` (${input.linkType})` : ""}`);
  if (input.title) lines.push(`Title: ${input.title}`);
  if (input.siteName) lines.push(`Site: ${input.siteName}`);
  if (input.url) lines.push(`URL: ${input.url}`);
  if (input.description) lines.push(`Description: ${input.description}`);
  if (input.note) lines.push(`Owner's note: ${input.note}`);
  if (input.text) lines.push(`Content:\n${input.text}`);
  if (input.image) lines.push("The item's image is attached.");
  lines.push("");
  lines.push(`Existing tags in the library: ${input.vocabulary.length ? input.vocabulary.join(", ") : "(none yet)"}`);
  return lines.join("\n");
}

export async function enrichWithClaude(apiKey: string, model: string, input: AiInput): Promise<AiResult> {
  const client = new Anthropic({ apiKey, maxRetries: 2, timeout: 120_000 });
  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  if (input.image) {
    content.push({ type: "image", source: { type: "base64", media_type: input.image.mediaType, data: input.image.data } });
  }
  content.push({ type: "text", text: describe(input) });

  let response;
  try {
    response = await client.beta.messages.parse({
      model,
      max_tokens: 4000,
      system: SYSTEM,
      messages: [{ role: "user", content }],
      output_config: {
        format: betaJSONSchemaOutputFormat(SCHEMA),
        ...(supportsEffort(model) ? { effort: "low" as const } : {}),
      },
      ...(supportsFallbacks(model) ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw new AiError("The Anthropic API key was rejected. Check it in Settings.", false);
    if (err instanceof Anthropic.PermissionDeniedError) throw new AiError("This API key cannot use the selected model.", false);
    if (err instanceof Anthropic.NotFoundError) throw new AiError(`Model "${model}" was not found.`, false);
    if (err instanceof Anthropic.BadRequestError) throw new AiError(`The request was rejected: ${err.message}`, false);
    if (err instanceof Anthropic.RateLimitError) throw new AiError("Rate limited by the Anthropic API; will retry.", true);
    if (err instanceof Anthropic.APIConnectionError) throw new AiError("Could not reach the Anthropic API; will retry.", true);
    if (err instanceof Anthropic.APIError) throw new AiError(`Anthropic API error ${err.status ?? ""}: ${err.message}`, (err.status ?? 500) >= 500);
    throw err;
  }

  if (response.stop_reason === "refusal") throw new AiError("The model declined to describe this item.", false);
  const parsed = response.parsed_output;
  if (!parsed) throw new AiError("The model returned no usable result.", response.stop_reason === "max_tokens");

  const tags = [...new Set(parsed.tags.map((t) => t.toLowerCase().replace(/^#/, "").trim()).filter((t) => t && t.length <= 40))].slice(0, 8);
  const orNull = (s: string) => (s.trim() ? s.trim() : null);
  return {
    tags,
    summary: orNull(parsed.summary),
    imageDescription: orNull(parsed.image_description),
    imageText: orNull(parsed.image_text),
  };
}
