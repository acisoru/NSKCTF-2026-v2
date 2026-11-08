module orchestra::abc;
import orchestra::score;
import libc;

fn bool abc_header(Score* score, String line, int* headers)
{
    int bit;
    switch (line[0])
    {
        case 'X': bit = 1;
        case 'T': bit = 2;
        case 'M': bit = 4;
        case 'L': bit = 8;
        case 'K': bit = 16;
        case 'Q': bit = 32;
        default: return score::reject(score, "unsupported ABC header");
    }
    if ((*headers & bit) != 0) return score::reject(score, "duplicate ABC header");
    *headers |= bit;
    String value = abc_trim(line[2..]);
    if ((bit == 4 && !abc_equal(value, "3/4")) || (bit == 8 && !abc_equal(value, "1/8"))
        || (bit == 16 && !abc_equal(value, "Dm"))) return score::reject(score, "required headers: M:3/4 L:1/8 K:Dm");
    if (bit == 1)
    {
        if (value.len == 0) return score::reject(score, "X tune number is required");
        foreach (c : value) if (!abc_digit(c)) return score::reject(score, "X tune number is required");
    }
    return true;
}

fn bool parse_abc(Score* score, String text, int voice)
{
    char[16385] abc_body;
    usz begin;
    usz used;
    int headers;
    bool body;
    foreach (c : text) if (c == 0) return score::reject(score, "NUL in ABC input");
    for (usz i = 0; i <= text.len; i++)
    {
        if (i != text.len && text[i] != '\n' && text[i] != '\r') continue;
        String line = abc_trim(text[begin:i - begin]);
        begin = i + 1;
        if (line.len >= 2 && line[0] == '%' && line[1] == '%') return score::reject(score, "ABC directives are unsupported");
        for (usz j = 0; j < line.len; j++)
        {
            if (line[j] == '%') { line = abc_trim(line[:j]); break; }
        }
        if (line.len == 0) continue;
        if (line.len >= 2 && abc_alpha(line[0]) && line[1] == ':')
        {
            if (body) return score::reject(score, "inline headers and extra voices are unsupported");
            if (!abc_header(score, line, &headers)) return false;
        }
        else
        {
            body = true;
            if (used + line.len + 1 > 16385) return score::reject(score, "ABC body capacity");
            foreach (c : line) abc_body[used++] = c;
            abc_body[used++] = ' ';
        }
    }
    if ((headers & 29) != 29) return score::reject(score, "required headers: X M:3/4 L:1/8 K:Dm");
    return abc_music(score, (String)abc_body[:used], voice);
}

fn bool abc_read_file(Score* score, ZString filename, int voice)
{
    char[16385] abc_file;
    libc::CFile file = libc::fopen(filename, "rb");
    if (file == null) return score::reject(score, "cannot open ABC file");
    usz size = libc::fread(&abc_file, 1, 16385, file);
    bool io_error = libc::ferror(file) != 0;
    libc::fclose(file);
    if (io_error) return score::reject(score, "cannot read ABC file");
    if (size > 16384) return score::reject(score, "ABC part size exceeded");
    return parse_abc(score, (String)abc_file[:size], voice);
}
