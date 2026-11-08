#ifndef OBFUSCATE_H
#define OBFUSCATE_H

#include <stddef.h>

enum agent_string_id {
    STR_HOST,
    STR_PORT,
    STR_SNI,
    STR_TASKS,
    STR_RESULT,
    STR_FILES,
};

enum agent_blob_id {
    BLOB_CA,
    BLOB_CERT,
    BLOB_KEY,
};

const char *agent_unseal_string(enum agent_string_id id);
const unsigned char *agent_unseal_blob(enum agent_blob_id id, size_t *len);
void agent_reseal(void);

#endif
