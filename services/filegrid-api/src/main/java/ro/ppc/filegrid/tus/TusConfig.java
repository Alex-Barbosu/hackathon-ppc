package ro.ppc.filegrid.tus;

import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;

/** Turns on {@code @Scheduled}, used to expire abandoned uploads. */
@Configuration
@EnableScheduling
public class TusConfig {
}
