/**
 * Server-side sanitization for CMS Post/Page body HTML (docs/CMS_ARCHITECTURE.md).
 * The Control Center composer now stores real HTML (TipTap's output), and
 * this is the last line of defense before it's persisted — never trust the
 * Control Center client alone: a compromised/scripted client (or the AI
 * Copilot tool that can also create/update posts — server/ai/toolRegistry.ts)
 * could otherwise smuggle a <script>, an event handler attribute, or a
 * javascript: URL straight into every visitor's browser on the public site,
 * which renders this body via dangerouslySetInnerHTML.
 *
 * Deliberately conservative: allows the structural/formatting elements a
 * real article needs (matching what the TipTap editor's configured
 * extensions can actually produce) and nothing that can execute code or
 * load a cross-origin frame. `style` and `on*` attributes are never
 * allowed — DOMPurify strips the latter unconditionally regardless of
 * config.
 */
import DOMPurify from "isomorphic-dompurify";

const ALLOWED_TAGS = [
  "p",
  "br",
  "hr",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "s",
  "strike",
  "sub",
  "sup",
  "a",
  "ul",
  "ol",
  "li",
  "blockquote",
  "pre",
  "code",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "img",
  "figure",
  "figcaption",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "span",
];

const ALLOWED_ATTR = ["href", "title", "target", "rel", "src", "alt", "width", "height", "class", "colspan", "rowspan"];

export function sanitizeContentHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
  }).trim();
}
