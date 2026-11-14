# Zone A. Multi-stage: Maven build, then a small JRE image.
FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /src
COPY pom.xml .
RUN mvn -q -B dependency:go-offline
COPY src ./src
RUN mvn -q -B -DskipTests package

FROM eclipse-temurin:21-jre-alpine
# su-exec lets the entrypoint fix the owner of the spool volume, then run the JVM as "app".
RUN apk add --no-cache su-exec && addgroup -S app && adduser -S app -G app
WORKDIR /app
COPY --from=build /src/target/filegrid-api-*.jar app.jar
COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod 0755 /app/docker-entrypoint.sh
EXPOSE 8080
# A named volume mounted over /var/filegrid/spool is owned by root the first time, and stays so
# for volumes made before this entrypoint existed. The entrypoint chowns it and drops privileges.
# MaxRAMPercentage keeps the heap bounded so "1 GB uploads with flat memory" is provable.
ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["java", "-XX:MaxRAMPercentage=60", "-jar", "/app/app.jar"]
