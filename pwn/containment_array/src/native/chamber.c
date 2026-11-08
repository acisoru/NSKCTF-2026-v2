#define _GNU_SOURCE
#include <errno.h>
#include <linux/audit.h>
#include <linux/filter.h>
#include <linux/seccomp.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/prctl.h>
#include <sys/syscall.h>
#include <unistd.h>

#define INSTALLED_SENSORS 8
#define LOGICAL_CHANNELS 32
#define MAX_FRAME 512

const char flag_path[] = "/srv/chamber/flag.txt";

static void isolation_filter(void) {
    struct sock_filter rules[] = {
        BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, arch)),
        BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, AUDIT_ARCH_X86_64, 1, 0),
        BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_KILL_PROCESS),
        BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, nr)),
        BPF_JUMP(BPF_JMP | BPF_JGE | BPF_K, 0x40000000U, 0, 1),
        BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_KILL_PROCESS),
        BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, SYS_execve, 0, 1),
        BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | EPERM),
        BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, SYS_execveat, 0, 1),
        BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | EPERM),
        BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW),
    };
    struct sock_fprog program = { .len = sizeof(rules) / sizeof(rules[0]), .filter = rules };
    if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) ||
        prctl(PR_SET_SECCOMP, SECCOMP_MODE_FILTER, &program)) {
        _exit(111);
    }
}

static ssize_t read_exact(void *destination, size_t length) {
    size_t count = 0;
    while (count < length) {
        ssize_t got = read(STDIN_FILENO, (char *)destination + count, length - count);
        if (got <= 0) return -1;
        count += (size_t)got;
    }
    return (ssize_t)count;
}

__attribute__((noinline)) static void inspect_channel(int index) {
    volatile uint64_t sensors[INSTALLED_SENSORS];
    for (int i = 0; i < INSTALLED_SENSORS; ++i) {
        sensors[i] = 0x4100000000000000ULL | ((uint64_t)i << 16) | (uint64_t)(i * 17 + 3);
    }
    /* Физически подключено восемь датчиков, но обработчик доверяет
       спецификации контроллера с тридцатью двумя каналами. */
    printf("КАНАЛ %02d = %016llx\n", index, (unsigned long long)sensors[index]);
}

__attribute__((noinline)) static void calibrate_frame(size_t length) {
    char frame[96];
    memset(frame, 0, sizeof(frame));
    puts("БАЙТЫ КАДРА:");
    if (read_exact(frame, length) < 0) _exit(0);
    puts("КАЛИБРОВКА ПРИНЯТА");
}

static void banner(void) {
    puts("[ ЛАБОРАТОРИЯ X / КАРАНТИННЫЙ КОНТУР ]");
    puts("Установлено датчиков: 08  |  Адресуемых каналов: 32");
    puts("Команды: VIEW <канал>  |  CAL <длина>  |  HELP  |  QUIT");
}

int main(void) {
    char command[96];
    setvbuf(stdin, NULL, _IONBF, 0);
    setvbuf(stdout, NULL, _IONBF, 0);
    alarm(120);
    /* Слушатель может передать дочернему процессу лишние дескрипторы.
       Для предсказуемого протокола оставляем только стандартные потоки. */
    for (int fd = 3; fd < 64; ++fd) close(fd);
    isolation_filter();
    banner();
    for (;;) {
        fputs("КОНТУР> ", stdout);
        if (!fgets(command, sizeof(command), stdin)) break;
        if (!strncmp(command, "VIEW ", 5)) {
            char *end;
            long index = strtol(command + 5, &end, 10);
            if (end == command + 5 || index < 0 || index >= LOGICAL_CHANNELS) {
                puts("КАНАЛ ВНЕ ДИАПАЗОНА");
                continue;
            }
            inspect_channel((int)index);
        } else if (!strncmp(command, "CAL ", 4)) {
            char *end;
            unsigned long length = strtoul(command + 4, &end, 10);
            if (end == command + 4 || length == 0 || length > MAX_FRAME) {
                puts("ДЛИНА КАДРА ОТКЛОНЕНА");
                continue;
            }
            calibrate_frame((size_t)length);
        } else if (!strncmp(command, "HELP", 4)) {
            banner();
        } else if (!strncmp(command, "QUIT", 4)) {
            puts("НАБЛЮДЕНИЕ ЗАКРЫТО");
            break;
        } else {
            puts("НЕИЗВЕСТНАЯ КОМАНДА");
        }
    }
    return 0;
}
