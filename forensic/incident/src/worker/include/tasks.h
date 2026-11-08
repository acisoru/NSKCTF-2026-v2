#ifndef TASKS_H
#define TASKS_H

#include <stddef.h>

enum task_type {
    TASK_EX_COMMAND,
    TASK_UPLOAD,
    TASK_DOWNLOAD,
};

typedef struct {
    long id;
    int type;
    char command[513];
    char path[257];
    long file_id;
} worker_task;

/* Parses a control-plane task JSON body; validates every field before
 * use. Returns 0 on success. */
int task_parse(const char *body, size_t body_len, worker_task *task);

/* Executes the task and returns 0 on success. */
int task_run(const worker_task *task);

#endif
