module orchestra::abc;
import orchestra::score;

fn bool abc_append(AbcCursor* p, int pitch, int duration)
{
    if (p.score.event_count == 256) return score::reject(p.score, "event capacity exceeded");
    p.score.events[p.score.event_count++] = {p.voice, pitch, p.offset + p.cursor, p.offset + p.cursor + duration};
    return true;
}

fn bool abc_sequence(Score* score, String text, int voice, int offset)
{
    AbcCursor p;
    p.score = score;
    p.text = text;
    p.voice = voice;
    p.offset = offset;
    while (p.pos < text.len)
    {
        if (abc_space(text[p.pos])) { p.pos++; continue; }
        int duration;
        int pitch;
        if (text[p.pos] == '[')
        {
            p.pos++;
            int[16] chord;
            int count;
            while (p.pos < text.len && text[p.pos] != ']')
            {
                if (abc_space(text[p.pos])) { p.pos++; continue; }
                if (!abc_note(&p, &pitch, &duration)) return false;
                if (pitch < 0 || duration != 4) return score::reject(score, "use equal-duration chords or overlays");
                if (count == 16) return score::reject(score, "chord capacity exceeded");
                chord[count++] = pitch;
            }
            if (p.pos == text.len || count == 0) return score::reject(score, "unclosed or empty chord");
            p.pos++;
            if (!abc_length(&p, &duration)) return false;
            for (int i = 0; i < count; i++)
            {
                if (!abc_append(&p, chord[i], duration)) return false;
            }
        }
        else
        {
            if (!abc_note(&p, &pitch, &duration)) return false;
            if (pitch >= 0 && !abc_append(&p, pitch, duration)) return false;
        }
        p.cursor += duration;
        if (p.cursor > 24) return score::reject(score, "ABC bar overrun");
    }
    if (p.cursor != 24) return score::reject(score, "each overlay must fill one 3/4 bar");
    return true;
}

fn bool abc_bar(Score* score, String text, int voice, int bar)
{
    usz begin;
    int count;
    for (usz i = 0; i <= text.len; i++)
    {
        if (i != text.len && text[i] != '&') continue;
        if (++count > 4) return score::reject(score, "overlay capacity exceeded");
        if (!abc_sequence(score, abc_trim(text[begin:i - begin]), voice, bar * 24)) return false;
        begin = i + 1;
    }
    return true;
}

fn bool abc_music(Score* score, String music, int voice)
{
    music = abc_trim(music);
    if (music.len >= 2 && music[0] == '|' && music[1] == ':') music = music[2..];
    foreach (c : music) if (c == ':') return score::reject(score, "ABC repeats are unsupported");
    usz begin;
    usz pos;
    int bar;
    while (pos <= music.len)
    {
        if (pos != music.len && music[pos] != '|') { pos++; continue; }
        String content = abc_trim(music[begin:pos - begin]);
        if (content.len != 0)
        {
            if (bar == 16) return score::reject(score, "exactly sixteen bars are required");
            if (!abc_bar(score, content, voice, bar++)) return false;
        }
        if (pos == music.len) break;
        pos++;
        if (pos < music.len && (music[pos] == ']' || music[pos] == '|')) pos++;
        begin = pos;
    }
    if (bar != 16) return score::reject(score, "exactly sixteen bars are required");
    return true;
}
