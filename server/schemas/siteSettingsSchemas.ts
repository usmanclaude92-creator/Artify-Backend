/**
 * Phase 3 (Site Identity + Global Styles) — reuses the existing
 * `SystemSetting` key/value store (no new table; see
 * docs/control-center-data-preservation-plan.md and
 * docs/control-center-replacement-roadmap.md's Phase 3 section). Each
 * logical settings group (site identity, global styles) is one JSON-typed
 * SystemSetting row per key, validated here rather than left as the
 * generic `.manage` endpoint's unvalidated `z.unknown()` — see
 * server/services/siteSettingsService.ts for the draft/publish/revert
 * workflow built on top of this.
 *
 * Every field below has a `.default(...)` so a brand-new organization
 * (nothing ever published) resolves to a complete object rather than
 * undefined/partial — and those defaults are deliberately the CURRENT
 * hardcoded artifysolscom values (colors from src/index.css's `:root`,
 * fonts from its `body`/`h1,h2,h3` rules, site name/description from
 * src/utils/seo.ts's DEFAULT_* constants) so publishing nothing changes
 * nothing, and the first real publish is the only thing that can move the
 * live site's appearance — the "seed step is the risk-bearing step, not
 * the schema" note in the roadmap doc, satisfied by computing the
 * matching default instead of writing a seed row.
 */
import { z } from "zod";

const mediaIdSchema = z.string().trim().uuid();

const colorSchema = z
  .string()
  .trim()
  .min(1)
  .max(60)
  .regex(/^(#[0-9a-fA-F]{3,8}|rgba?\([0-9.,%\s]+\)|hsla?\([0-9.,%\s]+\)|[a-zA-Z][a-zA-Z0-9]*)$/, "must be a valid CSS color (#hex, rgb(), rgba(), hsl(), or a named color)");

const lengthSchema = z
  .string()
  .trim()
  .min(1)
  .max(30)
  .regex(/^-?[0-9]*\.?[0-9]+(px|rem|em|%|vw|vh)$/, "must be a CSS length (e.g. 1rem, 16px)");

const fontFamilySchema = z.string().trim().min(1).max(300);
const fontWeightSchema = z.union([z.number().int().min(100).max(900), z.enum(["normal", "bold"])]);
const unitlessNumberSchema = z.coerce.number().min(0.5).max(3);

// ---------------------------------------------------------------------------
// Site Identity
// ---------------------------------------------------------------------------

export const siteIdentitySchema = z
  .object({
    siteName: z.string().trim().min(1).max(150).default("Artify Solutions"),
    tagline: z.string().trim().max(200).default("AI-Native Software & Intelligent Automation"),
    description: z
      .string()
      .trim()
      .max(500)
      .default(
        "Artify Solutions builds AI-native software, autonomous agent swarms, business automation and fully customized digital solutions designed around your organization's unique workflows."
      ),
    logoMediaId: mediaIdSchema.nullable().default(null),
    logoDarkMediaId: mediaIdSchema.nullable().default(null),
    logoMobileMediaId: mediaIdSchema.nullable().default(null),
    faviconMediaId: mediaIdSchema.nullable().default(null),
    socialImageMediaId: mediaIdSchema.nullable().default(null),
    defaultMetaTitle: z.string().trim().max(70).default("Artify Solutions | AI-Native Software & Intelligent Automation"),
    defaultMetaDescription: z
      .string()
      .trim()
      .max(200)
      .default("Your Business. Reimagined by AI. We engineer intelligent software systems that understand your business, automate processes, and connect your data."),
    // Social share card (link previews on WhatsApp/Facebook/LinkedIn/X…). Optional overrides:
    // blank means "fall back to the default meta title/description".
    socialTitle: z.string().trim().max(70).optional(),
    socialDescription: z.string().trim().max(200).optional(),
    socialImageAlt: z.string().trim().max(200).optional(),
    contactEmail: z.string().trim().toLowerCase().email().optional(),
    contactPhone: z.string().trim().max(40).optional(),
    address: z.string().trim().max(300).optional(),
    organizationLegalName: z.string().trim().max(200).optional(),
  })
  .strict();
export type SiteIdentityInput = z.infer<typeof siteIdentitySchema>;

/** Every `*MediaId` field name on SiteIdentityInput — shared by the service's media-validation pass. */
export const SITE_IDENTITY_MEDIA_FIELDS = ["logoMediaId", "logoDarkMediaId", "logoMobileMediaId", "faviconMediaId", "socialImageMediaId"] as const;

// ---------------------------------------------------------------------------
// Global Styles
// ---------------------------------------------------------------------------

const colorsSchema = z
  .object({
    primary: colorSchema.default("#7C3AED"),
    primaryHover: colorSchema.default("#6D28D9"),
    primaryForeground: colorSchema.default("#FFFFFF"),
    secondary: colorSchema.default("#FFFFFF"),
    secondaryForeground: colorSchema.default("#0F172A"),
    background: colorSchema.default("#F8FAFC"),
    surface: colorSchema.default("#FFFFFF"),
    textPrimary: colorSchema.default("#020617"),
    textSecondary: colorSchema.default("#334155"),
    link: colorSchema.default("#7C3AED"),
    linkHover: colorSchema.default("#6D28D9"),
    border: colorSchema.default("#CBD5E1"),
  })
  .strict()
  .default({});

const headingScaleSchema = z
  .object({
    h1: lengthSchema.default("2.5rem"),
    h2: lengthSchema.default("2rem"),
    h3: lengthSchema.default("1.5rem"),
    h4: lengthSchema.default("1.25rem"),
    h5: lengthSchema.default("1.125rem"),
    h6: lengthSchema.default("1rem"),
  })
  .strict()
  .default({});

const typographySchema = z
  .object({
    fontFamilyBase: fontFamilySchema.default("'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"),
    fontFamilyHeading: fontFamilySchema.default("'Plus Jakarta Sans', sans-serif"),
    fontSizeBase: lengthSchema.default("16px"),
    headingScale: headingScaleSchema,
    lineHeightBase: unitlessNumberSchema.default(1.6),
    lineHeightHeading: unitlessNumberSchema.default(1.2),
    fontWeightBase: fontWeightSchema.default(400),
    fontWeightHeading: fontWeightSchema.default(700),
    fontWeightBold: fontWeightSchema.default(600),
  })
  .strict()
  .default({});

const spacingScaleSchema = z
  .object({
    xs: lengthSchema.default("0.5rem"),
    sm: lengthSchema.default("1rem"),
    md: lengthSchema.default("1.5rem"),
    lg: lengthSchema.default("2rem"),
    xl: lengthSchema.default("3rem"),
  })
  .strict()
  .default({});

const borderRadiusSchema = z
  .object({
    sm: lengthSchema.default("0.25rem"),
    md: lengthSchema.default("0.5rem"),
    lg: lengthSchema.default("1rem"),
    full: z.literal("9999px").default("9999px"),
  })
  .strict()
  .default({});

const layoutSchema = z
  .object({
    containerMaxWidth: lengthSchema.default("1280px"),
    spacingScale: spacingScaleSchema,
    borderRadius: borderRadiusSchema,
  })
  .strict()
  .default({});

const effectsSchema = z
  .object({
    borderColor: colorSchema.default("#CBD5E1"),
    borderWidth: lengthSchema.default("1px"),
    shadowSm: z.string().trim().max(200).default("0 1px 2px 0 rgba(15, 23, 42, 0.05)"),
    shadowMd: z.string().trim().max(200).default("0 4px 6px -1px rgba(15, 23, 42, 0.08)"),
    shadowLg: z.string().trim().max(200).default("0 12px 25px -5px rgba(15, 23, 42, 0.12)"),
  })
  .strict()
  .default({});

const buttonsSchema = z
  .object({
    radius: lengthSchema.default("0.5rem"),
    paddingX: lengthSchema.default("1.25rem"),
    paddingY: lengthSchema.default("0.625rem"),
    fontWeight: fontWeightSchema.default(600),
    primaryBg: colorSchema.default("#7C3AED"),
    primaryText: colorSchema.default("#FFFFFF"),
    primaryHoverBg: colorSchema.default("#6D28D9"),
    secondaryBg: colorSchema.default("#FFFFFF"),
    secondaryText: colorSchema.default("#0F172A"),
    secondaryBorder: colorSchema.default("#CBD5E1"),
  })
  .strict()
  .default({});

const formsSchema = z
  .object({
    radius: lengthSchema.default("0.5rem"),
    borderColor: colorSchema.default("#CBD5E1"),
    focusColor: colorSchema.default("#7C3AED"),
    background: colorSchema.default("#FFFFFF"),
    text: colorSchema.default("#020617"),
  })
  .strict()
  .default({});

const responsiveOverrideSchema = z
  .object({
    containerMaxWidth: lengthSchema.optional(),
    fontSizeBase: lengthSchema.optional(),
  })
  .strict();

const responsiveSchema = z
  .object({
    tablet: responsiveOverrideSchema.default({}),
    mobile: responsiveOverrideSchema.default({}),
  })
  .strict()
  .default({});

export const globalStylesSchema = z
  .object({
    colors: colorsSchema,
    typography: typographySchema,
    layout: layoutSchema,
    effects: effectsSchema,
    buttons: buttonsSchema,
    forms: formsSchema,
    responsive: responsiveSchema,
  })
  .strict();
export type GlobalStylesInput = z.infer<typeof globalStylesSchema>;
