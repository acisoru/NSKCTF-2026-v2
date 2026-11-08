module orchestra;
import orchestra::abc;
import orchestra::score;
import orchestra::vm;
import libc;

fn int main(String[] args)
{
    if (args.len == 2 && (abc::abc_equal(args[1], "--help") || abc::abc_equal(args[1], "-h"))) return usage(0);
    Options options;
    if (!parse_arguments(args, &options)) return usage(2);
    Score score;
    Machine machine;
    bool ok = true;
    for (int voice = 0; voice < 3; voice++)
    {
        if (!abc::abc_read_file(&score, options.score_paths[voice], voice)) { ok = false; break; }
    }
    ok = ok && score::validate_score(&score);
    if (ok)
    {
        ok = vm::run_score(&machine, &score);
    }
    else
    {
        machine.error_reason = score.error_reason;
    }
    if (!ok || options.check_only)
    {
        vm::print_report(&machine, ok);
        return ok ? 0 : 1;
    }
    ZString flag = libc::getenv("FLAG");
    if (flag == null || flag[0] == 0)
    {
        vm::fail(&machine, "FLAG configuration missing");
        vm::print_report(&machine, false);
        return 1;
    }
    libc::puts(flag);
    return 0;
}
