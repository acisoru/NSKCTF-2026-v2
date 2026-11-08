module orchestra::vm;
import orchestra::score;

fn bool run_score(Machine* m, Score* score)
{
	*m = {};
	m.score = score;
	m.next_owner = 1;
	m.deadline = 8;
	for (int i = 0; i < 12; i++) m.memory[i].limbs[0] = 1;
	m.latest[0] = { 0, 0, 0, 0 };
	m.latest[1] = { 1, 0, 0, 0 };
	m.history[0] = m.latest[0];
	m.history[19] = m.latest[1];
	for (int tick = 0; tick <= 384; tick++)
	{
		m.rounds++;
		// End tokens and publish all accompaniment versions first.
		for (int i = 0; i < m.score.event_count; i++)
		{
			Event e = m.score.events[i];
			if (e.end != tick) continue;
			if (!m.live[i]) return fail(m, "missing linear note token");
			m.live[i] = false;
			m.completed[e.voice]++;
			if (e.voice != 0)
			{
				if (!m.publications[i]) return fail(m, "missing deferred publication");
				m.publications[i] = false;
				int source = e.voice - 1;
				int gen    = m.latest[source].generation + 1;
				m.latest[source] = { source, gen, tick, e.pitch };
				m.history[source * 19 + gen % 19] = m.latest[source];
			}
		}
		// Input is start/end/pitch sorted; among equal ends this gives exactly
		// the canonical (start,pitch) transaction order.
		for (int i = 0; i < m.score.event_count; i++)
		{
			if (m.score.events[i].voice == 0 && m.score.events[i].end == tick && !commit(m, i, tick)) return false;
		}
		for (int i = 0; i < m.depth; i++)
		{
			if (tick - m.frames[i].born > 144) return fail(m, "frame deadline");
		}
		bool has_melody;
		int packet_end;
		for (int i = 0; i < m.score.event_count; i++)
		{
			Event e = m.score.events[i];
			if (e.start != tick) continue;
			m.live[i] = true;
			m.begun[e.voice]++;
			if (e.voice == 0)
			{
				has_melody = true;
				if (e.end > packet_end) packet_end = e.end;
			}
		}
		if (has_melody)
		{
			if (tick < m.ready || tick > m.deadline) return fail(m, "phrase continuation window");
			if (tick - m.latest[0].tick > 24 || tick - m.latest[1].tick > 8) return fail(m, "accompaniment lease");
		}
		for (int voice = 0; voice < 3; voice++)
		{
			for (int i = 0; i < m.score.event_count; i++)
			{
				if (m.score.events[i].voice == voice && m.score.events[i].start == tick && !onset(m, i, tick)) return false;
			}
		}
		if (has_melody)
		{
			m.ready = packet_end;
			m.deadline = m.ready + 8;
		}
		if (tick < 384 && !harmonic(m, tick)) return false;
	}
	if (m.depth != 0 || m.ready > 384 || m.deadline < 384) return fail(m, "unfinished frame or phrase");
	for (int i = 0; i < m.score.event_count; i++)
	{
		if (m.live[i] || m.pending[i].active || m.publications[i]) return fail(m, "unfinished note or publication");
	}
	for (int i = 0; i < 3; i++)
	{
		if (m.begun[i] != m.completed[i] || m.completed[i] == 0) return fail(m, "incomplete voice");
	}
	for (int i = 0; i < 12; i++) for (int j = 0; j < 6; j++)
	{
		if (m.memory[i].limbs[j] != EXPECTED[i].limbs[j]) return fail(m, "return mismatch");
	}
	return true;
}
