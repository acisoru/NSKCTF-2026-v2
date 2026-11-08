module orchestra::abc;
import orchestra::score;
import libc;

struct AbcCursor
{
    Score* score;
    String text;
    usz pos;
    int voice;
    int offset;
    int cursor;
    int[7] accidentals;
    bool[7] altered;
}

fn bool abc_space(char c)
{
    return c == ' ' || (c >= 9 && c <= 13);
}

fn bool abc_digit(char c) { return c >= '0' && c <= '9'; }
fn bool abc_alpha(char c) { return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z'); }

fn String abc_trim(String text)
{
    usz left;
    usz right = text.len;
    while (left < right && abc_space(text[left])) left++;
    while (right > left && abc_space(text[right - 1])) right--;
    return text[left:right - left];
}

fn bool abc_equal(String a, String b)
{
    return a.len == b.len && (a.len == 0 || libc::memcmp(a.ptr, b.ptr, a.len) == 0);
}

fn bool abc_length(AbcCursor* p, int* duration)
{
    usz begin = p.pos;
    ulong numerator;
    ulong denominator = 1;
    while (p.pos < p.text.len && abc_digit(p.text[p.pos]))
    {
        if (p.pos - begin >= 12) return score::reject(p.score, "duration too large");
        numerator = numerator * 10 + (ulong)(p.text[p.pos++] - '0');
    }
    if (p.pos == begin) numerator = 1;
    if (p.pos < p.text.len && p.text[p.pos] == '/')
    {
        p.pos++;
        usz digits = p.pos;
        denominator = 0;
        while (p.pos < p.text.len && abc_digit(p.text[p.pos]))
        {
            if (p.pos - begin >= 12) return score::reject(p.score, "duration too large");
            denominator = denominator * 10 + (ulong)(p.text[p.pos++] - '0');
        }
        if (p.pos == digits) denominator = 2;
    }
    if (p.pos - begin > 12 || denominator == 0 || numerator == 0
        || (4 * numerator) % denominator != 0 || (4 * numerator) / denominator > 384)
    {
        return score::reject(p.score, "duration outside positive 1/32 grid");
    }
    *duration = (int)((4 * numerator) / denominator);
    return true;
}

fn bool abc_note(AbcCursor* p, int* pitch, int* duration)
{
    int sign = 2;
    if (p.pos < p.text.len)
    {
        char c = p.text[p.pos];
        if (c == '^' || c == '_' || c == '=')
        {
            sign = c == '^' ? 1 : c == '_' ? -1 : 0;
            p.pos++;
        }
    }
    if (p.pos == p.text.len) return score::reject(p.score, "missing ABC note");
    char letter = p.text[p.pos++];
    bool rest = letter == 'z';
    bool lower = letter >= 'a' && letter <= 'g';
    char upper = lower ? (char)(letter - 32) : letter;
    if (!rest && (upper < 'A' || upper > 'G')) return score::reject(p.score, "unsupported ABC token");
    int octaves;
    bool marked;
    while (p.pos < p.text.len && (p.text[p.pos] == '\'' || p.text[p.pos] == ','))
    {
        marked = true;
        octaves += p.text[p.pos++] == '\'' ? 12 : -12;
    }
    if (!abc_length(p, duration)) return false;
    if (rest)
    {
        if (sign != 2 || marked) return score::reject(p.score, "invalid ABC rest");
        *pitch = -1;
        return true;
    }
    int[7] natural = { 9, 11, 0, 2, 4, 5, 7 };
    int index = (int)(upper - 'A');
    if (sign != 2)
    {
        p.accidentals[index] = sign;
        p.altered[index] = true;
    }
    int alteration = p.altered[index] ? p.accidentals[index] : upper == 'B' ? -1 : 0;
    *pitch = 60 + natural[index] + (lower ? 12 : 0) + octaves + alteration;
    if (*pitch < 0 || *pitch > 127) return score::reject(p.score, "MIDI pitch out of range");
    return true;
}
