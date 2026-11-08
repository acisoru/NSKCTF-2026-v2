/* alice-link: служебный клиент канала ALICE. */
#define _GNU_SOURCE
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <netdb.h>
#include <netinet/in.h>
#include <sys/prctl.h>
#include <sys/socket.h>
#include <time.h>

#define DEFAULT_HOST "127.0.0.1"
#define DEFAULT_PORT 23231

/* ---------- SHA-256 / HMAC (self-contained) ---------- */
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
    uint32_t w[64], a,b,d,e,f,g,h,t1,t2,cc; int i;
    for (i=0;i<16;i++) w[i]=((uint32_t)p[i*4]<<24)|(p[i*4+1]<<16)|(p[i*4+2]<<8)|p[i*4+3];
    for (;i<64;i++){uint32_t s0=ROR(w[i-15],7)^ROR(w[i-15],18)^(w[i-15]>>3),s1=ROR(w[i-2],17)^ROR(w[i-2],19)^(w[i-2]>>10);w[i]=w[i-16]+s0+w[i-7]+s1;}
    a=c->s[0];b=c->s[1];cc=c->s[2];d=c->s[3];e=c->s[4];f=c->s[5];g=c->s[6];h=c->s[7];
    for (i=0;i<64;i++){
        uint32_t S1=ROR(e,6)^ROR(e,11)^ROR(e,25), ch=(e&f)^((~e)&g);
        t1=h+S1+ch+K[i]+w[i];
        uint32_t S0=ROR(a,2)^ROR(a,13)^ROR(a,22), mj=(a&b)^(a&cc)^(b&cc);
        t2=S0+mj;
        h=g;g=f;f=e;e=d+t1;d=cc;cc=b;b=a;a=t1+t2;
    }
    c->s[0]+=a;c->s[1]+=b;c->s[2]+=cc;c->s[3]+=d;c->s[4]+=e;c->s[5]+=f;c->s[6]+=g;c->s[7]+=h;
}
static void sha256_init(sha256_ctx *c){c->s[0]=0x6a09e667;c->s[1]=0xbb67ae85;c->s[2]=0x3c6ef372;c->s[3]=0xa54ff53a;c->s[4]=0x510e527f;c->s[5]=0x9b05688c;c->s[6]=0x1f83d9ab;c->s[7]=0x5be0cd19;c->len=0;c->n=0;}
static void sha256_update(sha256_ctx *c, const void *data, size_t n){const uint8_t*p=data;c->len+=n;while(c->n+n>=64){size_t take=64-c->n;memcpy(c->buf+c->n,p,take);sha256_block(c,c->buf);p+=take;n-=take;c->n=0;}if(n){memcpy(c->buf+c->n,p,n);c->n+=n;}}
static void sha256_final(sha256_ctx *c, uint8_t out[32]){uint64_t bits=c->len*8;uint8_t pad=0x80;sha256_update(c,&pad,1);uint8_t z=0;while(c->n!=56)sha256_update(c,&z,1);uint8_t lb[8];for(int i=0;i<8;i++)lb[i]=(uint8_t)(bits>>(56-8*i));sha256_update(c,lb,8);for(int i=0;i<8;i++){out[i*4]=c->s[i]>>24;out[i*4+1]=c->s[i]>>16;out[i*4+2]=c->s[i]>>8;out[i*4+3]=c->s[i];}}
static void hmac_sha256(const uint8_t *key, size_t klen, const uint8_t *msg, size_t mlen, uint8_t out[32]){
    uint8_t k[64]={0}, ki[64], ko[64], inner[32]; sha256_ctx c;
    if (klen>64){sha256_init(&c);sha256_update(&c,key,klen);sha256_final(&c,k);}
    else memcpy(k,key,klen);
    for(int i=0;i<64;i++){ki[i]=k[i]^0x36;ko[i]=k[i]^0x5c;}
    sha256_init(&c);sha256_update(&c,ki,64);sha256_update(&c,msg,mlen);sha256_final(&c,inner);
    sha256_init(&c);sha256_update(&c,ko,64);sha256_update(&c,inner,32);sha256_final(&c,out);
}

/* ---------- сборка сессионного ключа ---------- */
static const uint8_t KEY_BLOB[32] = {
    0xe4, 0xb1, 0x6a, 0xc6, 0x0c, 0x6e, 0x4a, 0x87,
    0x29, 0xb6, 0xf6, 0x10, 0xe8, 0x2b, 0xe6, 0x57,
    0x31, 0xa6, 0xde, 0x0c, 0xbc, 0x08, 0xf3, 0x03,
    0x32, 0xa7, 0x72, 0x44, 0x52, 0x3b, 0xc1, 0x76,
};
static const uint8_t KEY_MASK[32] = {
    0xc4, 0x21, 0x11, 0x11, 0x8d, 0x53, 0xdf, 0xbc,
    0x64, 0x37, 0xba, 0xc4, 0x5c, 0x64, 0x47, 0x1a,
    0x22, 0x1a, 0x1a, 0x03, 0x64, 0x0c, 0xae, 0xa6,
    0x71, 0x63, 0x95, 0x0c, 0x35, 0xf6, 0xc2, 0xd4,
};

static void derive_master(uint8_t out[32]) {
    for (int i = 0; i < 32; i++) {
        out[i] = KEY_BLOB[i] ^ KEY_MASK[i] ^ (uint8_t)(0x5a + i * 13);
    }
}

static void derive_key(const uint8_t challenge[16], uint8_t out[32]) {
    uint8_t master[32];
    uint8_t material[7 + 16];
    derive_master(master);
    memcpy(material, "AL1C/3/", 7);
    memcpy(material + 7, challenge, 16);
    hmac_sha256(master, sizeof master, material, sizeof material, out);
    memset(master, 0, sizeof master);
}

static int debugger_present(void) {
    prctl(PR_SET_DUMPABLE, 0, 0, 0, 0);
    FILE *status = fopen("/proc/self/status", "r");
    if (!status) return 0;
    char line[256];
    int traced = 0;
    while (fgets(line, sizeof line, status)) {
        if (!strncmp(line, "TracerPid:", 10)) {
            traced = atoi(line + 10) != 0;
            break;
        }
    }
    fclose(status);
    return traced;
}

/* ---------- протокол ---------- */
static int dial(const char *host, int port) {
    char svc[8]; snprintf(svc, sizeof svc, "%d", port);
    struct addrinfo hints = {0}, *res;
    hints.ai_family = AF_INET; hints.ai_socktype = SOCK_STREAM;
    if (getaddrinfo(host, svc, &hints, &res) || !res) return -1;
    int fd = socket(res->ai_family, res->ai_socktype, res->ai_protocol);
    if (fd < 0 || connect(fd, res->ai_addr, res->ai_addrlen) < 0) { freeaddrinfo(res); if (fd >= 0) close(fd); return -1; }
    freeaddrinfo(res);
    return fd;
}

static int read_line(int fd, char *buf, size_t cap) {
    size_t n = 0; char ch;
    while (n + 1 < cap) {
        ssize_t r = recv(fd, &ch, 1, 0);
        if (r <= 0) return -1;
        if (ch == '\n') { buf[n] = 0; return (int)n; }
        buf[n++] = ch;
    }
    buf[cap-1] = 0; return (int)n;
}

static void put16(uint8_t *p, uint16_t v){p[0]=v>>8;p[1]=v;}
static void put32(uint8_t *p, uint32_t v){p[0]=v>>24;p[1]=v>>16;p[2]=v>>8;p[3]=v;}

/* Устаревший дефолтный payload: отправляется как есть, сервер его отвергает. */
static void legacy_payload(uint8_t *out /*12*/) {
    put32(out, 0x3E7); put32(out+4, 0x4C4142); put32(out+8, 0x5A1F3000);
}

static int hexval(int ch) {
    if (ch >= '0' && ch <= '9') return ch - '0';
    if (ch >= 'a' && ch <= 'f') return ch - 'a' + 10;
    if (ch >= 'A' && ch <= 'F') return ch - 'A' + 10;
    return -1;
}

static int b64val(int ch) {
    if (ch >= 'A' && ch <= 'Z') return ch - 'A';
    if (ch >= 'a' && ch <= 'z') return ch - 'a' + 26;
    if (ch >= '0' && ch <= '9') return ch - '0' + 52;
    if (ch == '+') return 62;
    if (ch == '/') return 63;
    return -1;
}

/* --data: hex или base64. Возвращает длину payload или -1. */
static int decode_data(const char *s, uint8_t *out, size_t cap) {
    size_t n = strlen(s), olen = 0;
    int is_hex = (n > 0 && n % 2 == 0);
    for (size_t i = 0; is_hex && i < n; i++) if (hexval((unsigned char)s[i]) < 0) is_hex = 0;
    if (is_hex) {
        if (n / 2 > cap) return -1;
        for (size_t i = 0; i < n; i += 2)
            out[olen++] = (uint8_t)((hexval((unsigned char)s[i]) << 4) | hexval((unsigned char)s[i+1]));
        return (int)olen;
    }
    int quad[4], qn = 0;
    for (size_t i = 0; i < n; i++) {
        int ch = (unsigned char)s[i];
        if (ch == '=' || ch == '\n' || ch == '\r' || ch == ' ' || ch == '\t') continue;
        int v = b64val(ch);
        if (v < 0) return -1;
        quad[qn++] = v;
        if (qn == 4) {
            if (olen + 3 > cap) return -1;
            out[olen++] = (uint8_t)((quad[0] << 2) | (quad[1] >> 4));
            out[olen++] = (uint8_t)(((quad[1] & 0xF) << 4) | (quad[2] >> 2));
            out[olen++] = (uint8_t)(((quad[2] & 0x3) << 6) | quad[3]);
            qn = 0;
        }
    }
    if (qn == 2) { if (olen + 1 > cap) return -1; out[olen++] = (uint8_t)((quad[0] << 2) | (quad[1] >> 4)); }
    else if (qn == 3) {
        if (olen + 2 > cap) return -1;
        out[olen++] = (uint8_t)((quad[0] << 2) | (quad[1] >> 4));
        out[olen++] = (uint8_t)(((quad[1] & 0xF) << 4) | (quad[2] >> 2));
    } else if (qn != 0) return -1;
    return (int)olen;
}

int main(int argc, char **argv) {
    const char *host = DEFAULT_HOST; int port = DEFAULT_PORT;
    const char *mode = NULL, *data = NULL;
    for (int i = 1; i < argc; i++) {
        if (!strcmp(argv[i], "--host") && i+1 < argc) host = argv[++i];
        else if (!strcmp(argv[i], "--port") && i+1 < argc) port = atoi(argv[++i]);
        else if (!strcmp(argv[i], "--help")) { puts("alice-link [--host H] [--port P] connect\nalice-link [options] send --data <hex|base64>\nalice-link [options] status"); return 0; }
        else if (!strcmp(argv[i], "connect") || !strcmp(argv[i], "send") || !strcmp(argv[i], "status")) mode = argv[i];
        else if (!strcmp(argv[i], "--data") && i+1 < argc) data = argv[++i];
    }
    if (!mode) { fprintf(stderr, "usage: alice-link [--host H] [--port P] connect|send --data <hex|base64>|status\n"); return 2; }
    if (debugger_present()) { fprintf(stderr, "ERR link unavailable\n"); return 1; }
    int fd = dial(host, port);
    if (fd < 0) { fprintf(stderr, "ERR link unavailable\n"); return 1; }
    char line[512];
    if (read_line(fd, line, sizeof line) < 0) { close(fd); fprintf(stderr, "ERR link unavailable\n"); return 1; }
    if (!strcmp(mode, "connect") || !strcmp(mode, "status")) {
        if (send(fd, "CONNECT\n", 8, 0) != 8) { close(fd); return 1; }
        if (read_line(fd, line, sizeof line) < 0) { close(fd); return 1; }
        fputs(line, stdout); fputc('\n', stdout);
        close(fd); return 0;
    }
    /* send: пакет по восстановленному формату, nonce из connect в рамках того же соединения */
    if (send(fd, "CONNECT\n", 8, 0) != 8) { close(fd); return 1; }
    if (read_line(fd, line, sizeof line) < 0) { close(fd); return 1; }
    uint8_t nonce[16] = {0};
    uint8_t challenge[16] = {0};
    const char *np = strstr(line, "nonce=");
    const char *cp = strstr(line, "challenge=");
    if (!np || !cp) { close(fd); fprintf(stderr, "ERR invalid combination\n"); return 1; }
    for (int i = 0; i < 16; i++) sscanf(np + 6 + 2*i, "%2hhx", &nonce[i]);
    for (int i = 0; i < 16; i++) sscanf(cp + 10 + 2*i, "%2hhx", &challenge[i]);
    uint8_t payload[256]; int plen = 12;
    if (data) {
        plen = decode_data(data, payload, sizeof payload);
        if (plen < 0) { close(fd); fprintf(stderr, "ERR invalid data\n"); return 2; }
    } else legacy_payload(payload);
    uint8_t pkt[10 + sizeof payload + 16 + 32];
    memcpy(pkt, "AL1C", 4);
    put16(pkt+4, 3); pkt[6] = 0x10; pkt[7] = 0; put16(pkt+8, (uint16_t)plen);
    memcpy(pkt+10, payload, (size_t)plen); memcpy(pkt+10+plen, nonce, 16);
    uint8_t key[32]; derive_key(challenge, key);
    uint8_t mac[32]; hmac_sha256(key, 32, pkt, 10+(size_t)plen+16, mac);
    memcpy(pkt+10+(size_t)plen+16, mac, 32);
    size_t pktlen = 10 + (size_t)plen + 16 + 32;
    size_t hexlen = 2*pktlen; char hex[2*sizeof pkt + 2];
    for (size_t i = 0; i < pktlen; i++) sprintf(hex + 2*i, "%02x", pkt[i]);
    hex[hexlen] = 0;
    char msg[1024]; snprintf(msg, sizeof msg, "SEND %s\n", hex);
    if (send(fd, msg, strlen(msg), 0) < 0) { close(fd); return 1; }
    if (read_line(fd, line, sizeof line) < 0) { close(fd); return 1; }
    fputs(line, stdout); fputc('\n', stdout);
    close(fd); return 0;
}
