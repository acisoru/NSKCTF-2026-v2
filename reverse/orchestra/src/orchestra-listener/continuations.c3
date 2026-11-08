module orchestra::vm;
import orchestra::score;

fn bool commit(Machine* m, int eid, int tick)
{
	Event e           = m.score.events[eid];
	Continuation cont = m.pending[eid];
	if (!cont.active || cont.due != tick || cont.owner <= 0)
	{
		return fail(m, "continuation type or deadline");
	}
	m.pending[eid].active = false;
	Version bass;
	Version piano;
	if (!read_cap(m, cont.bass, cont.owner, 0, &bass) || !read_cap(m, cont.piano, cont.owner, 1, &piano))
	{
		return false;
	}
	int region   = bass.pitch % 4;
	int a        = selected_pair(bass, piano);
	int b        = (a + 1) % 3;
	WriteCap cap = cont.write;
	if (cap.owner != cont.owner || cap.region != region || cap.a != a || cap.b != b || cap.permission != 1)
	{
		return fail(m, "write permission mismatch");
	}
	if (++m.quotas[region] > 38) return fail(m, "region instruction quota");
	int word = (e.pitch - bass.pitch + 128) % 32;
	for (int bit = 4; bit >= 0; bit--)
	{
		int dst = (word >> bit & 1) != 0 ? b : a;
		int src = dst == a ? b : a;
		if (!add_cells(m, region * 3 + dst, region * 3 + src)) return false;
	}
	return true;
}

fn bool onset(Machine* m, int eid, int tick)
{
	Event e = m.score.events[eid];
	if (e.voice != 0)
	{
		m.publications[eid] = true;
		return true;
	}
	int owner      = m.next_owner++;
	ReadCap bass   = { owner, 0, m.latest[0].generation };
	ReadCap piano  = { owner, 1, m.latest[1].generation };
	int region     = m.latest[0].pitch % 4;
	int a          = selected_pair(m.latest[0], m.latest[1]);
	int b          = (a + 1) % 3;
	WriteCap write = { owner, region, a, b, 1 };
	m.pending[eid] = { true, owner, e.end, bass, piano, write };
	int pc = e.pitch % 12;
	if (pc == 2 || pc == 4)
	{
		if (m.depth == 4) return fail(m, "frame stack overflow");
		m.frames[m.depth++] = { owner, tick, bass, piano };
		if (m.depth > m.peak_frames) m.peak_frames = m.depth;
	}
	else if (pc == 0 || pc == 1 || pc == 7 || pc == 10)
	{
		if (m.depth == 0) return fail(m, "frame stack underflow");
		Frame f = m.frames[--m.depth];
		Version unused;
		if (!read_cap(m, f.bass, f.owner, 0, &unused) || !read_cap(m, f.piano, f.owner, 1, &unused))
		{
			return false;
		}
		if (tick - f.born > m.maximum_frame_age) m.maximum_frame_age = tick - f.born;
	}
	return true;
}
