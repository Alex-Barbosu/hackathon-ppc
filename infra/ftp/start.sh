#!/bin/sh
# Zone B. Creates the FileGrid FTP user from the env and a self-signed TLS certificate,
# then runs vsftpd in the foreground (setup here, not in an init container: see infra/CLAUDE.md).
set -eu
: "${FTP_USER_NAME:?}" "${FTP_USER_PASS:?}"
home="/home/ftpusers/${FTP_USER_NAME}"
if ! id "$FTP_USER_NAME" >/dev/null 2>&1; then
  useradd --no-create-home --home-dir "$home" --shell /usr/sbin/nologin "$FTP_USER_NAME"
fi
echo "${FTP_USER_NAME}:${FTP_USER_PASS}" | chpasswd >/dev/null
mkdir -p "$home"
# Files written by an earlier image may belong to another uid.
chown -R "$FTP_USER_NAME:$FTP_USER_NAME" "$home"
mkdir -p /etc/vsftpd/tls
if [ ! -f /etc/vsftpd/tls/cert.pem ]; then
  openssl req -x509 -nodes -newkey rsa:2048 -days 825 -subj "/CN=${TLS_CN:-ftp}/O=FileGrid/C=RO" \
    -keyout /etc/vsftpd/tls/key.pem -out /etc/vsftpd/tls/cert.pem 2>/dev/null
  chmod 600 /etc/vsftpd/tls/key.pem
fi
touch /var/log/vsftpd.log
# Sessions write to a file (they cannot open /dev/stdout); tail it so `docker logs` shows
# transfers. tail runs beside vsftpd, not as its child, so vsftpd never reaps a stranger.
tail -F /var/log/vsftpd.log &
vsftpd /etc/vsftpd.conf &
ftpd=$!
wait "$ftpd"
