-- Step 15 live-test cleanup. Run in the Supabase SQL editor (project artifysols-backend). The demo workspace itself was already removed through the app.
-- Rejected forged callbacks wrote audit rows (action META_CALLBACK_REJECTED): audit rows are kept on purpose.
DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email = 'qa_test_2026_s15_super@invalid.example');
DELETE FROM organization_memberships WHERE user_id IN (SELECT id FROM users WHERE email = 'qa_test_2026_s15_super@invalid.example');
DELETE FROM users WHERE email = 'qa_test_2026_s15_super@invalid.example';
