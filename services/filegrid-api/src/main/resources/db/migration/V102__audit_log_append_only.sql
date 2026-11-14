-- Zone A. audit_log is append only (contracts/db.md). The hash chain makes a change visible;
-- these triggers make an accidental or casual change fail in the first place. The table owner
-- can still drop a trigger, which is why the chain exists: that edit would break the chain.

CREATE FUNCTION audit_log_reject_change() RETURNS trigger
    LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'audit_log is append only (% refused)', TG_OP;
END;
$$;

CREATE TRIGGER audit_log_no_update_delete
    BEFORE UPDATE OR DELETE ON audit_log
    FOR EACH ROW EXECUTE FUNCTION audit_log_reject_change();

CREATE TRIGGER audit_log_no_truncate
    BEFORE TRUNCATE ON audit_log
    FOR EACH STATEMENT EXECUTE FUNCTION audit_log_reject_change();
