# Listening fixtures (Step 10)

HAND-AUTHORED from Meta's documentation (docs/SOCIAL_LISTENING.md §1), not recordings. Shapes that no current official page describes
(Facebook `mention` webhook payload, `overall_star_rating`) are marked `[ ]` in the docs and are exercised here only as defensive inputs.

- `instagram.json` — `mentions` webhook (comment and caption mention, empty value), the `mentioned_comment` / `mentioned_media` responses, the `/tags` list.
- `facebook.json` — `feed` webhook for a visitor post and for the Page's own post, a feed-like `mention` payload, the `/tagged` and `/feed` edges, the Page rating fields, error bodies.
