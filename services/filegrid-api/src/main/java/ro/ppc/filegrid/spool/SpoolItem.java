package ro.ppc.filegrid.spool;

import java.util.UUID;
import ro.ppc.filegrid.domain.Category;
import ro.ppc.filegrid.domain.Storage;

/**
 * A parked file waiting for its real storage. {@code target} is where it belongs and
 * {@code path} is its spool key ({@code <category>/<file id>}).
 */
public record SpoolItem(long id, UUID fileId, Category category, Storage target, String path, int attempts) {
}
