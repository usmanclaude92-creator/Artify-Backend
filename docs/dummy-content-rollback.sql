-- Step 15 follow-up: the seeded "dummy-test" content was archived (not deleted) on 2026-10-09 so it no longer shows on artifysols.com.
-- To bring it back (not recommended for a site Meta reviewers will visit), run this in the Supabase SQL editor:
UPDATE products     SET status = 'ACTIVE'    WHERE id IN ('dddddddd-dddd-4ddd-8ddd-000000000041','dddddddd-dddd-4ddd-8ddd-000000000042','dddddddd-dddd-4ddd-8ddd-000000000043');
UPDATE posts        SET status = 'PUBLISHED' WHERE id IN ('dddddddd-dddd-4ddd-8ddd-000000000091','dddddddd-dddd-4ddd-8ddd-000000000092');
UPDATE case_studies SET status = 'PUBLISHED' WHERE id = 'dddddddd-dddd-4ddd-8ddd-0000000000c1';
UPDATE pages        SET status = 'PUBLISHED' WHERE id IN ('dddddddd-dddd-4ddd-8ddd-000000000071','dddddddd-dddd-4ddd-8ddd-000000000072');

-- NOT done by Claude (the delete needed your approval): the seeded test category and tags. The category still appears in the sitemap as /blog?category=dummy-ai-strategy.
-- Either delete them in Control Center (Website → Taxonomy), or run:
-- DELETE FROM categories WHERE id = 'dddddddd-dddd-4ddd-8ddd-000000000010' AND slug = 'dummy-ai-strategy';
-- DELETE FROM tags WHERE id IN ('dddddddd-dddd-4ddd-8ddd-000000000011','dddddddd-dddd-4ddd-8ddd-000000000012') AND slug LIKE 'dummy-%';
