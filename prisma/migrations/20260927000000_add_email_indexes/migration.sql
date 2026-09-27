-- Lead/Client/Contact lookups by email (dedup checks, search, portal
-- account resolution) were doing full table scans. Add supporting indexes.
CREATE INDEX "leads_email_idx" ON "leads"("email");
CREATE INDEX "clients_email_idx" ON "clients"("email");
CREATE INDEX "contacts_email_idx" ON "contacts"("email");
