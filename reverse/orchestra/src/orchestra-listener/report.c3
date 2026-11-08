module orchestra::vm;
import libc;

fn void print_word(Wide word)
{
	libc::printf("\"");
	for (int i = 5; i >= 0; i--) libc::printf("%08x", word.limbs[i]);
	libc::printf("\"");
}

fn void print_memory(Wide[12] values)
{
	libc::printf("[");
	for (int i = 0; i < 12; i++)
	{
		if (i != 0) libc::printf(",");
		print_word(values[i]);
	}
	libc::printf("]");
}

fn void print_report(Machine* m, bool ok)
{
	libc::printf(
		"{\"accepted\":%s,\"rounds\":%d,\"completed\":[%d,%d,%d],\"microsteps\":%d,",
		ok ? "true" : "false",
		m.rounds,
		m.completed[0],
		m.completed[1],
		m.completed[2],
		m.microsteps
	);
	libc::printf(
		"\"region_commits\":[%d,%d,%d,%d],\"peak_frames\":%d,\"max_frame_age\":%d,\"max_version_lag\":%d,",
		m.quotas[0],
		m.quotas[1],
		m.quotas[2],
		m.quotas[3],
		m.peak_frames,
		m.maximum_frame_age,
		m.maximum_version_lag
	);
	libc::printf("\"maximum_edge_age\":%d,\"bar_charge\":[", m.maximum_edge_age);
	for (int i = 0; i < 16; i++)
	{
		if (i != 0) libc::printf(",");
		libc::printf("%d", m.bar_charge[i]);
	}
	libc::printf("],\"return\":");
	print_memory(m.memory);
	if (m.error_reason != null) libc::printf(",\"fault\":\"%s\"", m.error_reason);
	libc::printf("}\n");
}
