package ro.ppc.filegrid.policy;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.sql.Timestamp;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowCallbackHandler;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

@Repository
public class JdbcPolicyStore implements PolicyStore {

    /** Arbitrary constant, the same on every replica. Not the audit log's key. */
    private static final long LOCK_KEY = 7_266_180L;

    private final JdbcTemplate jdbc;
    private final ObjectMapper json;

    public JdbcPolicyStore(JdbcTemplate jdbc, ObjectMapper json) {
        this.jdbc = jdbc;
        this.json = json;
    }

    private RowMapper<PolicyVersion> mapper() {
        return (rs, i) -> {
        try {
            return new PolicyVersion(rs.getInt("version"),
                    rs.getTimestamp("applied_at").toInstant().atOffset(ZoneOffset.UTC),
                    rs.getString("applied_by"), json.readValue(rs.getString("policy"), Policy.class));
        } catch (java.io.IOException e) {
            throw new IllegalStateException("stored policy is not readable, version " + rs.getInt("version"), e);
        }
        };
    }

    @Override
    public void lock() {
        jdbc.query("SELECT pg_advisory_xact_lock(?)", (RowCallbackHandler) rs -> { }, LOCK_KEY);
    }

    @Override
    public Optional<PolicyVersion> latest() {
        return history(1).stream().findFirst();
    }

    @Override
    public List<PolicyVersion> history(int limit) {
        return jdbc.query("SELECT version, applied_at, applied_by, policy::text AS policy FROM policy_versions "
                + "ORDER BY version DESC LIMIT ?", mapper(), limit);
    }

    @Override
    public void insert(PolicyVersion v) {
        try {
            jdbc.update("INSERT INTO policy_versions (version, applied_at, applied_by, policy) VALUES (?,?,?,?::jsonb)",
                    v.version(), Timestamp.from(v.appliedAt().toInstant()), v.appliedBy(), json.writeValueAsString(v.policy()));
        } catch (com.fasterxml.jackson.core.JsonProcessingException e) {
            throw new IllegalStateException("cannot serialise the policy", e);
        }
    }
}
