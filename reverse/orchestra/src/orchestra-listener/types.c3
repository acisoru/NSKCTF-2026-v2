module orchestra::vm;

struct Wide
{
	uint[6] limbs;
}
struct Version
{
	int source;
	int generation;
	int tick;
	int pitch;
}
struct ReadCap
{
	int owner;
	int source;
	int generation;
}
struct WriteCap
{
	int owner;
	int region;
	int a;
	int b;
	int permission;
}
struct Continuation
{
	bool active;
	int owner;
	int due;
	ReadCap bass;
	ReadCap piano;
	WriteCap write;
}
struct Frame
{
	int owner;
	int born;
	ReadCap bass;
	ReadCap piano;
}
