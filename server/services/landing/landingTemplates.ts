/**
 * Three starter templates in the website's brand. They ship STRUCTURE and neutral wording only: anything that makes a claim
 * (benefits, features, quotes, prices, FAQ answers, company line) is a clearly marked [[placeholder]] on a block flagged
 * `placeholder: true`, and publishing is blocked until each is replaced and confirmed. No invented testimonials, numbers or logos.
 */
import type { LandingDocument, LandingTemplateKey } from "../../schemas/landingSchemas";

type Block = LandingDocument["blocks"][number];
let seq = 0;
const id = (p: string) => `${p}-${(++seq).toString(36)}`;
const ph = (what: string) => `[[Replace: ${what}]]`;

const hero = (): Block => ({ id: id("hero"), type: "lp_hero", placeholder: true, props: { eyebrow: undefined, headline: ph("your headline"), subheadline: ph("one sentence that says who this is for and what they get"), primaryCta: { label: "Get started", href: "#lead-form" } } });
const benefits = (): Block => ({ id: id("benefits"), type: "lp_benefits", placeholder: true, props: { heading: "Why people choose this", items: [1, 2, 3].map((n) => ({ title: ph(`benefit ${n}`), text: ph(`one honest sentence about benefit ${n}`) })) } });
const features = (n = 3): Block => ({ id: id("features"), type: "lp_features", placeholder: true, props: { heading: "What you get", items: Array.from({ length: n }, (_, i) => ({ title: ph(`feature ${i + 1}`), text: ph(`describe feature ${i + 1} in one or two sentences`) })) } });
const testimonials = (): Block => ({ id: id("proof"), type: "lp_testimonials", placeholder: true, props: { heading: "What customers say", confirmedReal: false, items: [{ quote: ph("a REAL customer quote you have permission to use"), authorName: ph("customer name"), authorRole: ph("role"), company: undefined }] } });
const pricing = (): Block => ({ id: id("pricing"), type: "lp_pricing", placeholder: true, props: { heading: "Pricing", plans: [{ name: ph("plan name"), price: ph("price"), period: undefined, features: [ph("what is included")], cta: { label: "Choose plan", href: "#lead-form" } }] } });
const faq = (): Block => ({ id: id("faq"), type: "lp_faq", placeholder: true, props: { heading: "Frequently asked questions", items: [{ question: ph("question"), answer: ph("answer") }, { question: ph("question"), answer: ph("answer") }] } });
const cta = (): Block => ({ id: id("cta"), type: "lp_cta", placeholder: true, props: { heading: ph("closing call to action"), text: undefined, cta: { label: "Talk to us", href: "#lead-form" } } });
const form = (message = true): Block => ({
  id: id("form"), type: "lp_form",
  props: {
    heading: "Get in touch", intro: "Leave your details and we will reply.",
    fields: [
      { key: "name", label: "Your name", type: "text", required: true },
      { key: "email", label: "Email", type: "email", required: true },
      { key: "company", label: "Company", type: "text", required: false },
      ...(message ? [{ key: "message", label: "How can we help?", type: "textarea" as const, required: false }] : []),
    ],
    consent: { enabled: true, text: "I agree to be contacted about my enquiry. I can withdraw this at any time.", privacyUrl: "/privacy" },
    submitLabel: "Send", successMessage: "Thank you. We will be in touch shortly.",
  },
});
const footer = (): Block => ({ id: id("footer"), type: "lp_footer", placeholder: true, props: { text: ph("legal or company line"), links: [{ label: "Privacy policy", href: "/privacy" }, { label: "Terms", href: "/terms" }] } });

export interface LandingTemplateInfo { key: LandingTemplateKey; name: string; description: string }
export const LANDING_TEMPLATES: LandingTemplateInfo[] = [
  { key: "lead-gen", name: "Lead generation", description: "Hero, benefits, social proof, FAQ and a contact form. For a service offer." },
  { key: "product-launch", name: "Product launch", description: "Hero, features, pricing, FAQ, call to action and an enquiry form." },
  { key: "consultation", name: "Book a consultation", description: "A short page: hero, benefits, call to action and a form. For one clear ask." },
];

export function buildTemplateDocument(key: LandingTemplateKey): LandingDocument {
  seq = 0;
  const blocks: Block[] =
    key === "lead-gen" ? [hero(), benefits(), testimonials(), faq(), form(), footer()]
    : key === "product-launch" ? [hero(), features(4), pricing(), faq(), cta(), form(), footer()]
    : [hero(), benefits(), cta(), form(false), footer()];
  return { version: 1, blocks } as LandingDocument;
}
