#ifndef HTTP_H
#define HTTP_H

#include <stddef.h>

#define HTTP_MAX_RESPONSE (4 * 1024 * 1024)

typedef struct
{
    void *ctx;
    void *ssl;
    int fd;
} http_conn;

int http_open(http_conn *conn);
void http_close(http_conn *conn);
/* Sends method/path with optional body; response buffer receives the
 * response body. Returns HTTP status or -1 on transport failure. */
int http_request(const http_conn *conn, const char *method, const char *path,
                 const unsigned char *body, size_t body_len, int *status,
                 unsigned char *response, size_t response_size,
                 size_t *response_len);

#endif
