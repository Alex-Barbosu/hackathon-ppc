package ro.ppc.filegrid.spool;

import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import java.util.EnumMap;
import java.util.Map;
import java.util.concurrent.atomic.AtomicLong;
import org.springframework.stereotype.Component;
import ro.ppc.filegrid.domain.Category;

/**
 * {@code filegrid_spool_pending{category}}: how many items are parked per category. Held in one
 * place because two jobs feed it (files via the database, meter readings via the spool directory)
 * and a gauge name with the same tags can only be registered once. The value is a cached number
 * refreshed by those jobs, so a Prometheus scrape never queries the database.
 */
@Component
public class SpoolGauges {

    private final Map<Category, AtomicLong> pending = new EnumMap<>(Category.class);

    public SpoolGauges(MeterRegistry registry) {
        for (Category c : Category.values()) {
            AtomicLong value = new AtomicLong();
            pending.put(c, value);
            Gauge.builder("filegrid.spool.pending", value, AtomicLong::get)
                    .description("Items parked in the fallback spool")
                    .tag("category", c.slug()).register(registry);
        }
    }

    public void set(Category category, long count) {
        pending.get(category).set(count);
    }

    public long get(Category category) {
        return pending.get(category).get();
    }
}
