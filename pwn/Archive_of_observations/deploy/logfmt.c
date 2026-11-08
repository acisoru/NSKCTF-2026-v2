#define _GNU_SOURCE
#include <errno.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/un.h>
#include <sys/wait.h>
#include <unistd.h>

#define SOCKET_PATH "/run/alice/logfmt.sock"
#define SECRET_CAP 128

static char *heap_secret;

static int read_full(int fd, void *buf, size_t len) {
    char *p = buf;
    while (len) {
        ssize_t n = read(fd, p, len);
        if (n <= 0) return -1;
        p += n;
        len -= (size_t)n;
    }
    return 0;
}

static void serve(int fd) {
    heap_secret = calloc(1, SECRET_CAP);
    if (!heap_secret) return;
    FILE *sf = fopen("/formatter-secret/secret", "r");
    if (!sf || !fgets(heap_secret, SECRET_CAP, sf)) {
        if (sf) fclose(sf);
        explicit_bzero(heap_secret, SECRET_CAP);
        free(heap_secret);
        heap_secret = NULL;
        return;
    }
    fclose(sf);
    heap_secret[strcspn(heap_secret, "\r\n")] = '\0';

    uint16_t length;
    char template[513];
    char output[4096];
    if (read_full(fd, &length, sizeof(length)) || length > 512 || !length ||
        read_full(fd, template, length)) return;
    template[length] = '\0';
    if (memchr(template, '\0', length)) return;

    volatile int unlock = 0;
    volatile int *volatile unlock_ref = &unlock;
    __asm__ volatile("" : : "m"(unlock_ref));

    FILE *stream = fmemopen(output, sizeof(output), "w");
    if (!stream) return;
    fprintf(stream, template);
    fclose(stream);
    output[sizeof(output) - 1] = '\0';

    size_t out_len = strnlen(output, sizeof(output) - 1);
    if (unlock && out_len < sizeof(output) - 1) {
        output[out_len++] = '\n';
        size_t secret_len = strnlen(heap_secret, SECRET_CAP - 1);
        if (secret_len > sizeof(output) - 1 - out_len) {
            secret_len = sizeof(output) - 1 - out_len;
        }
        memcpy(output + out_len, heap_secret, secret_len);
        out_len += secret_len;
    }
    write(fd, output, out_len);

    explicit_bzero(heap_secret, SECRET_CAP);
    free(heap_secret);
    heap_secret = NULL;
}

int main(void) {
    int server = socket(AF_UNIX, SOCK_STREAM, 0);
    struct sockaddr_un addr = {.sun_family = AF_UNIX};
    strncpy(addr.sun_path, SOCKET_PATH, sizeof(addr.sun_path) - 1);
    unlink(SOCKET_PATH);
    if (bind(server, (struct sockaddr *)&addr, sizeof(addr)) || listen(server, 16)) return 1;
    chmod(SOCKET_PATH, 0666);
    signal(SIGCHLD, SIG_IGN);
    while (1) {
        int fd = accept(server, NULL, NULL);
        if (fd < 0) continue;
        pid_t child = fork();
        if (child == 0) {
            close(server);
            alarm(2);
            serve(fd);
            close(fd);
            _exit(0);
        }
        close(fd);
    }
}
