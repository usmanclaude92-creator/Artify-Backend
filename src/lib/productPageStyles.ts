/** Public page layouts a product/service/solution can use on the website. Keep in sync with PRODUCT_PAGE_STYLES (server) and the website's styles registry. */
export const PRODUCT_PAGE_STYLES: { value: string; label: string; hint: string }[] = [
  { value: "classic", label: "Classic (current)", hint: "Simple headline, banner, two-column text and a side form." },
  { value: "executive", label: "Executive", hint: "Light hero with banner, key-facts strip, sticky consultation card." },
  { value: "showcase", label: "Showcase", hint: "Centred hero with a glowing banner frame, section tabs, pull-quote problem." },
  { value: "editorial", label: "Editorial", hint: "Case-study layout: spec row, full-width banner, problem → solution → outcome." },
  { value: "story", label: "Story (split screen)", hint: "Fixed brand panel on the left, numbered story steps on the right." },
  { value: "bento", label: "Bento", hint: "Modern tile grid with big headline, banner and benefit tiles." },
  { value: "tabbed", label: "Tabbed panel", hint: "Brand-gradient hero with an overlapping panel and feature side column." },
  { value: "workflow", label: "Workflow", hint: "Highlights how the product works as a step-by-step flow (best for process products)." },
  { value: "cinematic", label: "Cinematic", hint: "Full-bleed banner hero. Best with a banner that has no text on it." },
  { value: "datasheet", label: "Datasheet", hint: "App-style header, section menu, cards and an at-a-glance spec panel." },
];
