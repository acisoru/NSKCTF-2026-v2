#pragma once

#include <array>
#include <cstdint>
#include <iomanip>
#include <sstream>
#include <string>
#include <vector>

namespace firmware {

inline uint16_t rol16(uint16_t x, unsigned n) { return uint16_t((x << n) | (x >> (16 - n))); }
inline uint64_t rol64(uint64_t x, unsigned n) { return (x << n) | (x >> (64 - n)); }

inline uint16_t ferry(uint32_t seed) {
    uint16_t a = uint16_t(seed) ^ 0x9d7b;
    return rol16(uint16_t(a + 0x2143), 5) ^ 0x6a31;
}

inline std::string archive(uint32_t seed) {
    constexpr char alphabet[] = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    uint32_t x = seed ^ 0xcade45f3u;
    std::string out;
    for (int i = 0; i < 8; ++i) {
        x = x * 1664525u + 1013904223u;
        out.push_back(alphabet[((x >> 21) ^ (x >> 9) ^ (x >> 3)) & 31]);
    }
    return out;
}

inline uint64_t core(uint32_t seed, const std::vector<uint8_t>& rom) {
    uint64_t state = (uint64_t(seed) << 32) | (seed ^ 0xa5b35791u);
    for (size_t i = 0; i < rom.size(); ++i) {
        uint8_t op = rom[i] >> 5;
        uint8_t arg = rom[i] & 31;
        uint64_t salt = 0x9e3779b97f4a7c15ULL ^ (uint64_t(i + 1) * 0x100000001b3ULL);
        switch (op) {
        case 0: state += salt + arg; break;
        case 1: state ^= rol64(salt, (arg % 63) + 1); break;
        case 2: state = rol64(state, (arg % 31) + 1); break;
        case 3: state *= (salt | 1); break;
        case 4: state ^= state >> ((arg % 13) + 1); break;
        case 5: state += rol64(state, (arg % 17) + 1); break;
        case 6: state = ~state ^ (salt >> (arg % 17)); break;
        case 7: state = (state ^ (state << ((arg % 11) + 1))) + salt; break;
        }
    }
    return state ^ 0xd6e8feb86659fd93ULL;
}

inline std::string hex(uint64_t value, int width) {
    std::ostringstream out;
    out << std::uppercase << std::hex << std::setfill('0') << std::setw(width) << value;
    return out.str();
}

} // namespace firmware
