/* alice-auth: точка доступа к флагу. SUID flagreader. Только stdin. */
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>
#include <stdint.h>


/* ---------- собственный SHA-256 ---------- */
typedef struct { uint32_t s[8]; uint64_t len; uint8_t buf[64]; size_t n; } sha256_ctx;
static const uint32_t K[64] = {
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2};
#define ROR(x,n) (((x)>>(n))|((x)<<(32-(n))))
static void sha256_block(sha256_ctx *c, const uint8_t *p) {
    uint32_t w[64],a,b,d,e,f,g,h,t1,t2,cc; int i;
    for (i=0;i<16;i++) w[i]=((uint32_t)p[i*4]<<24)|(p[i*4+1]<<16)|(p[i*4+2]<<8)|p[i*4+3];
    for (;i<64;i++){uint32_t s0=ROR(w[i-15],7)^ROR(w[i-15],18)^(w[i-15]>>3),s1=ROR(w[i-2],17)^ROR(w[i-2],19)^(w[i-2]>>10);w[i]=w[i-16]+s0+w[i-7]+s1;}
    a=c->s[0];b=c->s[1];cc=c->s[2];d=c->s[3];e=c->s[4];f=c->s[5];g=c->s[6];h=c->s[7];
    for (i=0;i<64;i++){
        uint32_t S1=ROR(e,6)^ROR(e,11)^ROR(e,25), ch=(e&f)^((~e)&g);
        t1=h+S1+ch+K[i]+w[i];
        uint32_t S0=ROR(a,2)^ROR(a,13)^ROR(a,22), mj=(a&b)^(a&cc)^(b&cc);
        t2=S0+mj; h=g;g=f;f=e;e=d+t1;d=cc;cc=b;b=a;a=t1+t2;
    }
    c->s[0]+=a;c->s[1]+=b;c->s[2]+=cc;c->s[3]+=d;c->s[4]+=e;c->s[5]+=f;c->s[6]+=g;c->s[7]+=h;
}
static void sha256_init(sha256_ctx *c){c->s[0]=0x6a09e667;c->s[1]=0xbb67ae85;c->s[2]=0x3c6ef372;c->s[3]=0xa54ff53a;c->s[4]=0x510e527f;c->s[5]=0x9b05688c;c->s[6]=0x1f83d9ab;c->s[7]=0x5be0cd19;c->len=0;c->n=0;}
static void sha256_update(sha256_ctx *c, const void *data, size_t n){const uint8_t*p=data;c->len+=n;while(c->n+n>=64){size_t take=64-c->n;memcpy(c->buf+c->n,p,take);sha256_block(c,c->buf);p+=take;n-=take;c->n=0;}if(n){memcpy(c->buf+c->n,p,n);c->n+=n;}}
static void sha256_final(sha256_ctx *c, uint8_t out[32]){uint64_t bits=c->len*8;uint8_t pad=0x80;sha256_update(c,&pad,1);uint8_t z=0;while(c->n!=56)sha256_update(c,&z,1);uint8_t lb[8];for(int i=0;i<8;i++)lb[i]=(uint8_t)(bits>>(56-8*i));sha256_update(c,lb,8);for(int i=0;i<8;i++){out[i*4]=c->s[i]>>24;out[i*4+1]=c->s[i]>>16;out[i*4+2]=c->s[i]>>8;out[i*4+3]=c->s[i];}}

#define ART_ROOT "/home/archive/artifacts"
#define FLAG_PATH "/var/lib/alice/flag"
#define META_MAX 16384

static int read_line(char *buf, size_t cap) {
    if (!fgets(buf, (int)cap, stdin)) return -1;
    size_t n = strlen(buf);
    while (n && (buf[n-1] == '\n' || buf[n-1] == '\r')) buf[--n] = 0;
    return (int)n;
}

static int valid_utf8(const unsigned char *s, size_t n) {
    size_t i = 0;
    while (i < n) {
        unsigned c = s[i];
        if (c < 0x80) { i++; continue; }
        int extra = c >= 0xF0 ? 3 : c >= 0xE0 ? 2 : c >= 0xC0 ? 1 : -1;
        if (extra < 0 || i + (size_t)extra >= n) return 0;
        for (int k = 1; k <= extra; k++) if ((s[i+k] & 0xC0) != 0x80) return 0;
        i += (size_t)extra + 1;
    }
    return 1;
}

static int hexval(char ch) {
    if (ch >= '0' && ch <= '9') return ch - '0';
    if (ch >= 'a' && ch <= 'f') return ch - 'a' + 10;
    if (ch >= 'A' && ch <= 'F') return ch - 'A' + 10;
    return -1;
}

/* meta.json папки артефакта в буфер (для всех проверок сразу) */
static int load_meta(const char *dir, char *buf, size_t cap) {
    char path[PATH_MAX];
    snprintf(path, sizeof path, "%s/meta.json", dir);
    FILE *f = fopen(path, "r");
    if (!f) return -1;
    size_t n = fread(buf, 1, cap - 1, f);
    fclose(f);
    buf[n] = 0;
    /* обрезка по месту: файл генерируется один, размер заведомо < cap */
    return (n < cap - 1) ? 0 : -1;
}

/* строковое поле "key": "value" → out; 0 при успехе */
static int json_str(const char *buf, const char *key, char *out, size_t cap) {
    char pat[64];
    snprintf(pat, sizeof pat, "\"%s\"", key);
    const char *p = strstr(buf, pat);
    if (!p) return -1;
    p = strchr(p + strlen(pat), ':');
    if (!p) return -1;
    p++;
    while (*p == ' ' || *p == '\t' || *p == '\n' || *p == '\r') p++;
    if (*p != '"') return -1;
    p++;
    size_t i = 0;
    while (*p && *p != '"') {
        if (i + 1 >= cap) return -1;
        out[i++] = *p++;
    }
    if (*p != '"') return -1;
    out[i] = 0;
    return 0;
}

/* sha256 из meta.json */
static int meta_sha256(const char *buf, char out[65]) {
    const char *p = strstr(buf, "\"sha256\"");
    if (!p) return -1;
    p = strchr(p + 8, '"');  /* открывающая кавычка значения */
    if (!p) return -1;
    p++;
    for (int i = 0; i < 64; i++) {
        if (hexval(p[i]) < 0) return -1;
        out[i] = p[i];
    }
    if (p[64] != '"') return -1;
    out[64] = 0;
    return 0;
}

/* chain: первый элемент 2018-*, последний 2019-* */
static int meta_chain_ok(const char *buf) {
    const char *p = strstr(buf, "\"chain\"");
    if (!p) return 0;
    const char *lb = strchr(p, '[');
    const char *rb = strchr(p, ']');
    if (!lb || !rb || rb < lb) return 0;
    const char *first = strchr(lb, '"');
    if (!first || first > rb) return 0;
    if (strncmp(first + 1, "2018", 4) != 0) return 0;
    const char *close = NULL;
    for (const char *t = rb - 1; t > lb; t--)
        if (*t == '"') { close = t; break; }
    if (!close) return 0;
    const char *open = NULL;
    for (const char *t = close - 1; t > lb; t--)
        if (*t == '"') { open = t; break; }
    if (!open || close - open - 1 < 4) return 0;
    return strncmp(open + 1, "2019", 4) == 0;
}

/* полный набор условий подлинности: admission=000 + owner=mr.x + status=restored + chain 2018–2019 */
static int meta_authentic(const char *buf) {
    char v[128];
    if (json_str(buf, "admission", v, sizeof v) != 0 || strcmp(v, "000") != 0) return 0;
    if (json_str(buf, "owner", v, sizeof v) != 0 || strcmp(v, "mr.x") != 0) return 0;
    if (json_str(buf, "status", v, sizeof v) != 0 || strcmp(v, "restored") != 0) return 0;
    return meta_chain_ok(buf);
}

int main(void) {
    char input[514];
    puts("ALICE AUTH // Введите путь к артефакту допуска 000:");
    fflush(stdout);
    int n = read_line(input, sizeof input);
    if (n <= 0 || (size_t)n > 512) { puts("ACCESS DENIED"); return 1; }
    if (!valid_utf8((const unsigned char *)input, (size_t)n)) { puts("ACCESS DENIED"); return 1; }
    char resolved[PATH_MAX];
    const char *artroot = ART_ROOT;
    char rootres[PATH_MAX];
    if (!realpath(artroot, rootres)) { puts("ACCESS DENIED"); return 1; }
    if (!realpath(input, resolved)) { puts("ACCESS DENIED"); return 1; }
    size_t rl = strlen(rootres);
    if (strncmp(resolved, rootres, rl) != 0 || resolved[rl] != '/') { puts("ACCESS DENIED"); return 1; }
    struct stat st;
    if (stat(resolved, &st) != 0 || !S_ISREG(st.st_mode)) { puts("ACCESS DENIED"); return 1; }
    /* папка артефакта */
    char dir[PATH_MAX];
    snprintf(dir, sizeof dir, "%s", resolved);
    char *slash = strrchr(dir, '/');
    if (!slash) { puts("ACCESS DENIED"); return 1; }
    *slash = 0;
    if (strcmp(dir, rootres) == 0) { puts("ACCESS DENIED"); return 1; } /* сам файл в корне artifacts */
    char meta[META_MAX];
    if (load_meta(dir, meta, sizeof meta) != 0) { puts("ACCESS DENIED"); return 1; }
    /* мета-условия подлинности: без полного набора — отказ */
    if (!meta_authentic(meta)) { puts("ACCESS DENIED"); return 1; }
    char expect[65];
    if (meta_sha256(meta, expect) != 0) { puts("ACCESS DENIED"); return 1; }
    int fd = open(resolved, O_RDONLY);
    if (fd < 0) { puts("ACCESS DENIED"); return 1; }
    unsigned char digest[32], data[65536];
    sha256_ctx ctx;
    sha256_init(&ctx);
    ssize_t r;
    while ((r = read(fd, data, sizeof data)) > 0) sha256_update(&ctx, data, (size_t)r);
    close(fd);
    if (r < 0) { puts("ACCESS DENIED"); return 1; }
    sha256_final(&ctx, digest);
    char actual[65];
    for (int i = 0; i < 32; i++) snprintf(actual + 2*i, 3, "%02x", digest[i]);
    if (strcmp(actual, expect) != 0) { puts("ACCESS DENIED"); return 1; }
    /* euid уже flagreader (SUID); читаем флаг */
    FILE *ff = fopen(FLAG_PATH, "r");
    if (!ff) { puts("ACCESS DENIED"); return 1; }
    char flag[256] = {0};
    if (!fgets(flag, sizeof flag - 1, ff)) { fclose(ff); puts("ACCESS DENIED"); return 1; }
    fclose(ff);
    flag[strcspn(flag, "\r\n")] = 0;
    printf("ЗАПИСЬ ВОССТАНОВЛЕНА: %s\n", flag);
    return 0;
}
