/* Task JSON: {"id":N,"type":...} with ex_command/command, upload/path
 * or download/file_id */
#include "tasks.h"

#include <ctype.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static const char *json_find(const char *body, const char *key)
{
    char pattern[64];
    const char *value;

    snprintf(pattern, sizeof(pattern), "\"%s\":", key);
    value = strstr(body, pattern);
    if (!value)
        return NULL;
    value += strlen(pattern);
    while (*value == ' ' || *value == '\t')
        value++;
    return value;
}

static long json_long(const char *body, const char *key)
{
    const char *value = json_find(body, key);

    return value ? strtol(value, NULL, 10) : -1;
}

static int json_string(const char *body, const char *key, char *out,
                       size_t size)
{
    const char *value = json_find(body, key);
    size_t i = 0;

    if (!value || *value != '"')
        return -1;
    value++;
    for (; i + 1 < size && value[i] && value[i] != '"'; i++)
        out[i] = value[i];
    if (i + 1 >= size && value[i] != '"')
        return -1;
    out[i] = '\0';
    return 0;
}

static int printable_ascii(const char *text)
{
    for (const char *c = text; *c; c++)
        if (!isprint((unsigned char)*c))
            return 0;
    return 1;
}

int task_parse(const char *body, size_t body_len, worker_task *task)
{
    char type[16] = {0};

    memset(task, 0, sizeof(*task));
    if (!body_len || body_len > 4096)
        return -1;
    task->id = json_long(body, "id");
    if (task->id < 1 || task->id > 1000000)
        return -1;
    if (json_string(body, "type", type, sizeof(type)) != 0)
        return -1;
    if (!strcmp(type, "ex_command"))
    {
        task->type = TASK_EX_COMMAND;
        if (json_string(body, "command", task->command,
                        sizeof(task->command)) != 0)
            return -1;
        if (strlen(task->command) > 512 || !printable_ascii(task->command))
            return -1;
    }
    else if (!strcmp(type, "upload"))
    {
        task->type = TASK_UPLOAD;
        if (json_string(body, "path", task->path, sizeof(task->path)) != 0)
            return -1;
        if (task->path[0] != '/' || strlen(task->path) > 256 ||
            strstr(task->path, "..") || !printable_ascii(task->path))
            return -1;
    }
    else if (!strcmp(type, "download"))
    {
        task->type = TASK_DOWNLOAD;
        task->file_id = json_long(body, "file_id");
        if (task->file_id < 1 || task->file_id > 999999)
            return -1;
    }
    else
    {
        return -1;
    }
    return 0;
}
