module orchestra::score;
import libc;

struct Event
{
    int voice;
    int pitch;
    int start;
    int end;
}

struct Score
{
    Event[256] events;
    int event_count;
    ZString error_reason;
}

fn bool reject(Score* score, ZString reason)
{
    score.error_reason = reason;
    return false;
}
