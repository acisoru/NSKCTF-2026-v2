module orchestra::score;
import libc;

fn bool pitch_allowed(int pitch)
{
	foreach (p : PITCHES) if (pitch == p) return true;
	return false;
}

fn bool before(Event a, Event b)
{
	if (a.voice != b.voice) return a.voice < b.voice;
	if (a.start != b.start) return a.start < b.start;
	if (a.end != b.end) return a.end < b.end;
	return a.pitch < b.pitch;
}

fn bool validate_score(Score* score)
{
    if (score.event_count != 173) return reject(score, "event count changed");
    for (int i = 0; i < score.event_count; i++)
    {
        Event e = score.events[i];
        if (e.voice < 0 || e.voice > 2 || e.pitch < 0 || e.pitch > 127
            || e.start < 0 || e.start >= e.end || e.end > 384) return reject(score, "event shape");
        if (e.voice == 0 && !pitch_allowed(e.pitch)) return reject(score, "pitch alphabet");
    }
	// Sort before shape validation: record order has no musical significance.
	for (int i = 1; i < score.event_count; i++)
	{
		Event value = score.events[i];
		int j       = i;
		while (j > 0 && before(value, score.events[j - 1]))
		{
			score.events[j] = score.events[j - 1];
			j--;
		}
		score.events[j] = value;
	}
	for (int i = 0; i < score.event_count; i++)
	{
		Event a = score.events[i];
		Event b = PUBLIC_SCORE[i];
		if (a.voice != b.voice || a.start != b.start || a.end != b.end || (b.pitch >= 0 && a.pitch != b.pitch))
		{
			return reject(score, "fixed score or rhythm changed");
		}
	}
	return true;
}
