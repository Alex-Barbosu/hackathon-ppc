# Zone B. FTPS server (vsftpd) on Debian slim, multi-arch, so it runs natively on amd64
# and arm64 (Apple Silicon). The previous pure-ftpd image was amd64-only and crashed under
# emulation; Alpine's vsftpd build segfaulted after TLS downloads.
FROM debian:bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends vsftpd openssl netcat-openbsd \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /var/run/vsftpd/empty
COPY vsftpd.conf /etc/vsftpd.conf
COPY pam-filegrid /etc/pam.d/vsftpd-filegrid
COPY start.sh /usr/local/bin/start-ftp.sh
EXPOSE 21 30000-30009
ENTRYPOINT ["/bin/sh", "/usr/local/bin/start-ftp.sh"]
