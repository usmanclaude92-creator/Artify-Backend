-- Step 14 live-test cleanup. Run in the Supabase SQL editor (project artifysols-backend) AFTER you have downloaded the test report
-- (it lives in the notification bell / "Reports sent to you" on the Dashboard; deleting the schedule deletes the stored report).
-- The QA sessions are already revoked and the QA schedule is already disabled.
DELETE FROM notifications WHERE type = 'dashboard_report' AND title LIKE 'QA_TEST_2026%';
DELETE FROM dashboard_report_schedules WHERE name LIKE 'QA_TEST_2026%';          -- cascades runs + deliveries
DELETE FROM dashboard_report_settings;                                            -- optional: back to default (kill switch off)
DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'qa_test_2026_s14_%');
DELETE FROM organization_memberships WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'qa_test_2026_s14_%');
DELETE FROM users WHERE email LIKE 'qa_test_2026_s14_%';
-- Step 13 leftovers (QA page/lead/post/users) are in docs/ops-qa-cleanup.sql. The six "phase1-…@example.com" ADMIN preview accounts are not QA_TEST_2026 data; remove them only if you agree:
-- DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'phase1%@example.com');
-- DELETE FROM organization_memberships WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'phase1%@example.com');
-- DELETE FROM users WHERE email LIKE 'phase1%@example.com';
