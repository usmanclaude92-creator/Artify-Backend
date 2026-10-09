-- Removes ALL test data created by the Step 12 and Step 13 live tests (QA_TEST_2026_ / qa-test-2026). Run once in the Supabase SQL editor for project cfkymotcnccgvkpmcevp.
-- PRIVACY_* audit rows are immutable by design and stay (they hold a pseudonymous ref and counts only, no personal data).
begin;
delete from form_submissions where form_id in (select id from forms where landing_page_id in (select id from pages where slug ilike 'qa-test-2026%'));
delete from consent_records where lead_id in (select id from leads where email ilike 'qa_test_2026%' or company_name ilike 'QA_TEST_2026%' or id = 'e9705816-4cc0-4dce-9582-022888c1e8cd') or source like 'landing:lp-%';
delete from leads where email ilike 'qa_test_2026%' or company_name ilike 'QA_TEST_2026%' or id = 'e9705816-4cc0-4dce-9582-022888c1e8cd';
delete from analytics_events where path ilike '/lp/qa-test-2026%';
delete from automation_approvals where entity_type in ('landing_page','privacy_erasure');
delete from automation_executions where entity_type in ('landing_page','privacy_erasure');
delete from privacy_requests where id = '08342e34-9884-4df8-bea5-ac4bd79f1790';
delete from landing_preview_tokens where page_id in (select id from pages where slug ilike 'qa-test-2026%');
delete from forms where landing_page_id in (select id from pages where slug ilike 'qa-test-2026%');
update pages set current_revision_id = null, landing_live_revision_id = null where slug ilike 'qa-test-2026%';
delete from content_revisions where page_id in (select id from pages where slug ilike 'qa-test-2026%');
delete from pages where slug ilike 'qa-test-2026%';
delete from social_post_targets where post_id in (select id from social_posts where title like 'QA_TEST_2026_%');
delete from social_posts where title like 'QA_TEST_2026_%';
delete from notifications where type = 'system_health_alert' or user_id in (select id from users where email like 'qa_test_2026%');
delete from sessions where user_id in (select id from users where email like 'qa_test_2026%');
delete from organization_memberships where user_id in (select id from users where email like 'qa_test_2026%');
delete from users where email like 'qa_test_2026%';
commit;
-- Check afterwards (all should be 0):
-- select (select count(*) from users where email like 'qa_test_2026%') u, (select count(*) from pages where slug ilike 'qa-test-2026%') p, (select count(*) from leads where email ilike 'qa_test_2026%') l, (select count(*) from social_posts where title like 'QA_TEST_2026_%') s;
