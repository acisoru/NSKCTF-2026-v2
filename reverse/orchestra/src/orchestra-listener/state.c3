module orchestra::vm;
import orchestra::score;
import libc;

struct Machine
{
    Score* score;
    Wide[12] memory;
    Version[2] latest;
    Version[38] history;
    Continuation[256] pending;
    bool[256] live;
    bool[256] publications;
    Frame[4] frames;
    int depth;
    int next_owner;
    int ready;
    int deadline;
    int[3] begun;
    int[3] completed;
    int[4] quotas;
    int[144] edge_age;
    int[16] bar_charge;
    int peak_frames;
    int maximum_frame_age;
    int maximum_version_lag;
    int maximum_edge_age;
    int microsteps;
    int rounds;
    ZString error_reason;
}

fn bool fail(Machine* m, ZString reason)
{
    m.error_reason = reason;
    return false;
}
