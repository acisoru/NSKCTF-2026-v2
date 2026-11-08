module orchestra::vm;
import orchestra::score;

fn bool harmonic(Machine* m, int tick)
{
	int[12] counts;
	for (int i = 0; i < m.score.event_count; i++)
	{
		Event e = m.score.events[i];
		if (e.start <= tick && tick < e.end) counts[e.pitch % 12]++;
	}
	int charge;
	for (int a = 0; a < 12; a++) for (int b = a + 1; b < 12; b++)
	{
		int diff = b - a;
		if (diff != 1 && diff != 6 && diff != 11) continue;
		int pairs = counts[a] * counts[b];
		int idx   = a * 12 + b;
		m.edge_age[idx] = pairs != 0 ? m.edge_age[idx] + 1 : 0;
		if (m.edge_age[idx] > m.maximum_edge_age) m.maximum_edge_age = m.edge_age[idx];
		if (m.edge_age[idx] > 8) return fail(m, "harmonic edge timeout");
		charge += pairs * (diff == 6 ? 2 : 1);
	}
	m.bar_charge[tick / 24] += charge;
	if (m.bar_charge[tick / 24] > 24) return fail(m, "harmonic arena exhausted");
	return true;
}
