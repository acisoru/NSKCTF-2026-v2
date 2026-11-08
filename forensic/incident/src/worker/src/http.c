/* Hand-written HTTP/1.1 client over OpenSSL TLS 1.3 mTLS. */
#define _GNU_SOURCE
#include "http.h"
#include "obfuscate.h"

#include <openssl/bio.h>
#include <openssl/err.h>
#include <openssl/pem.h>
#include <openssl/ssl.h>
#include <openssl/x509.h>
#include <netdb.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <unistd.h>

#define HTTP_MAX_HEAD 16384

static X509 *pem_x509(const unsigned char *data, size_t len)
{
    X509 *cert;
    BIO *bio = BIO_new_mem_buf(data, (int)len);

    cert = PEM_read_bio_X509(bio, NULL, NULL, NULL);
    BIO_free(bio);
    return cert;
}

static EVP_PKEY *pem_key(const unsigned char *data, size_t len)
{
    EVP_PKEY *key;
    BIO *bio = BIO_new_mem_buf(data, (int)len);

    key = PEM_read_bio_PrivateKey(bio, NULL, NULL, NULL);
    BIO_free(bio);
    return key;
}

static int load_identity(SSL_CTX *ctx)
{
    size_t len;
    const unsigned char *cert_der = agent_unseal_blob(BLOB_CERT, &len);
    X509 *cert = pem_x509(cert_der, len);
    const unsigned char *key_der = agent_unseal_blob(BLOB_KEY, &len);
    EVP_PKEY *key = pem_key(key_der, len);
    const unsigned char *ca_der = agent_unseal_blob(BLOB_CA, &len);
    X509 *ca = pem_x509(ca_der, len);
    X509_STORE *store = ca ? SSL_CTX_get_cert_store(ctx) : NULL;
    int result = -1;

    /* Parsed objects own copies of the material; the sealed storage can
     * go back to ciphertext before the TLS context is used. */
    agent_reseal();
    if (cert && key && store && X509_STORE_add_cert(store, ca) == 1 &&
        SSL_CTX_use_certificate(ctx, cert) == 1 &&
        SSL_CTX_use_PrivateKey(ctx, key) == 1)
        result = 0;
    X509_free(ca);
    X509_free(cert);
    EVP_PKEY_free(key);
    return result;
}

static int connect_tcp(void)
{
    struct addrinfo hints = {.ai_socktype = SOCK_STREAM}, *list, *item;
    const char *host = agent_unseal_string(STR_HOST);
    const char *port = agent_unseal_string(STR_PORT);
    int fd = -1;

    if (getaddrinfo(host, port, &hints, &list) != 0)
    {
        agent_reseal();
        return -1;
    }
    agent_reseal();
    for (item = list; item; item = item->ai_next)
    {
        fd = socket(item->ai_family, item->ai_socktype, item->ai_protocol);
        if (fd >= 0 && connect(fd, item->ai_addr, item->ai_addrlen) == 0)
            break;
        if (fd >= 0)
            close(fd);
        fd = -1;
    }
    freeaddrinfo(list);
    return fd;
}

int http_open(http_conn *conn)
{
    SSL_CTX *ctx = SSL_CTX_new(TLS_client_method());
    const char *sni;
    SSL *ssl = NULL;
    int fd = -1;

    conn->ctx = NULL;
    conn->ssl = NULL;
    conn->fd = -1;
    if (!ctx || SSL_CTX_set_min_proto_version(ctx, TLS1_3_VERSION) != 1 ||
        load_identity(ctx) != 0)
        goto fail;
    SSL_CTX_set_verify(ctx, SSL_VERIFY_PEER, NULL);
    fd = connect_tcp();
    if (fd < 0)
        goto fail;
    ssl = SSL_new(ctx);
    if (!ssl || SSL_set_fd(ssl, fd) != 1)
        goto fail;
    /* OpenSSL copies the name into the extension and the peer check,
     * so the sealed record can be restored right after. */
    sni = agent_unseal_string(STR_SNI);
    SSL_set_tlsext_host_name(ssl, sni);
    SSL_set1_host(ssl, sni);
    agent_reseal();
    if (SSL_set_alpn_protos(ssl, (const unsigned char *)"\x08http/1.1", 9) != 0 ||
        SSL_connect(ssl) != 1)
        goto fail;
    conn->ctx = ctx;
    conn->ssl = ssl;
    conn->fd = fd;
    return 0;
fail:
    ERR_clear_error();
    SSL_free(ssl);
    SSL_CTX_free(ctx);
    if (fd >= 0)
        close(fd);
    return -1;
}

void http_close(http_conn *conn)
{
    SSL_free(conn->ssl);
    SSL_CTX_free(conn->ctx);
    if (conn->fd >= 0)
        close(conn->fd);
    conn->ctx = NULL;
    conn->ssl = NULL;
    conn->fd = -1;
}

static int send_request(const http_conn *conn, const char *method,
                        const char *path, const unsigned char *body,
                        size_t body_len)
{
    char head[1024];
    const char *sni = agent_unseal_string(STR_SNI);
    const char *port = agent_unseal_string(STR_PORT);
    int head_len;

    head_len = snprintf(head, sizeof(head),
                        "%s %s HTTP/1.1\r\nHost: %s:%s\r\n"
                        "User-Agent: ks-worker/2.0\r\nConnection: close\r\n"
                        "Content-Length: %zu\r\n\r\n",
                        method, path, sni, port, body_len);
    agent_reseal();
    if (head_len <= 0 || (size_t)head_len >= sizeof(head))
        return -1;
    if (SSL_write(conn->ssl, head, head_len) != head_len)
    {
        OPENSSL_cleanse(head, sizeof(head));
        return -1;
    }
    OPENSSL_cleanse(head, sizeof(head));
    if (body_len &&
        SSL_write(conn->ssl, body, (int)body_len) != (int)body_len)
        return -1;
    return 0;
}

static int read_response(const http_conn *conn, int *status,
                         unsigned char *response, size_t response_size,
                         size_t *response_len)
{
    char head[HTTP_MAX_HEAD];
    size_t received = 0, body_start = 0, body_len = 0, have;
    char *split, *length;
    int count;

    while (received < sizeof(head) - 1U)
    {
        count = SSL_read(conn->ssl, head + received,
                         (int)(sizeof(head) - 1U - received));
        if (count <= 0)
            return -1;
        received += (size_t)count;
        head[received] = '\0';
        split = strstr(head, "\r\n\r\n");
        if (split)
        {
            body_start = (size_t)(split - head) + 4;
            break;
        }
    }
    if (sscanf(head, "HTTP/1.1 %d", status) != 1)
        return -1;
    length = strcasestr(head, "content-length:");
    if (length)
        body_len = (size_t)strtoul(length + 15, NULL, 10);
    if (body_len > response_size)
        return -1;
    have = received - body_start;
    if (have > body_len)
        have = body_len;
    memcpy(response, head + body_start, have);
    while (have < body_len)
    {
        count = SSL_read(conn->ssl, response + have,
                         (int)(body_len - have));
        if (count <= 0)
            return -1;
        have += (size_t)count;
    }
    *response_len = have;
    return 0;
}

int http_request(const http_conn *conn, const char *method, const char *path,
                 const unsigned char *body, size_t body_len, int *status,
                 unsigned char *response, size_t response_size,
                 size_t *response_len)
{
    if (send_request(conn, method, path, body, body_len) != 0)
        return -1;
    return read_response(conn, status, response, response_size, response_len);
}
