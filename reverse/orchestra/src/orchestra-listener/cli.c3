module orchestra;
import orchestra::abc;
import libc;

struct Options
{
    bool check_only;
    ZString[3] score_paths;
}

fn int usage(int code)
{
    libc::puts("usage: lead-part-tester [--check] melody.abc bass.abc rhythm.abc");
    return code;
}

fn bool parse_arguments(String[] args, Options* options)
{
    int count;
    bool filenames;
    for (usz i = 1; i < args.len; i++)
    {
        String arg = args[i];
        if (!filenames && abc::abc_equal(arg, "--")) { filenames = true; continue; }
        if (!filenames && abc::abc_equal(arg, "--check")) { options.check_only = true; continue; }
        if ((!filenames && arg.len != 0 && arg[0] == '-') || count == 3) return false;
        options.score_paths[count++] = (ZString)arg.ptr;
    }
    return count == 3;
}
