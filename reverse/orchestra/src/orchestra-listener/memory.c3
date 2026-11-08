module orchestra::vm;
import orchestra::score;

fn bool read_cap(Machine* m, ReadCap cap, int owner, int source, Version* value)
{
	if (cap.owner != owner || cap.source != source || source < 0 || source > 1)
	{
		return fail(m, "read capability owner or type");
	}
	int lag = m.latest[source].generation - cap.generation;
	if (lag < 0 || lag >= 19) return fail(m, "expired memory version");
	Version saved = m.history[source * 19 + cap.generation % 19];
	if (saved.generation != cap.generation || saved.source != source)
	{
		return fail(m, "version generation mismatch");
	}
	if (lag > m.maximum_version_lag) m.maximum_version_lag = lag;
	*value = saved;
	return true;
}

fn int selected_pair(Version bass, Version piano)
{
	return (piano.pitch - bass.pitch + 384) % 3;
}

fn bool add_cells(Machine* m, int dst, int src)
{
	ulong carry;
	for (int i = 0; i < 6; i++)
	{
		ulong total = (ulong)m.memory[dst].limbs[i] + (ulong)m.memory[src].limbs[i] + carry;
		m.memory[dst].limbs[i] = (uint)(total & 0xffffffff);
		carry = total >> 32;
	}
	if (carry != 0) return fail(m, "positive register overflow");
	m.microsteps++;
	return true;
}
