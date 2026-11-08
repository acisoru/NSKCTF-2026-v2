#include "../shared/firmware.hpp"

#include <raylib.h>
#include <raymath.h>
#include <rlgl.h>
#include <GL/gl.h>

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <iterator>
#include <netdb.h>
#include <set>
#include <sstream>
#include <stdexcept>
#include <string>
#include <sys/socket.h>
#include <unistd.h>
#include <vector>

namespace fs = std::filesystem;

struct AssetDirectory {
    fs::path path;
    ~AssetDirectory() {
        if (!path.empty()) {
            std::error_code ignored;
            fs::remove_all(path, ignored);
        }
    }
};

uint64_t littleEndian(const unsigned char* bytes, size_t count) {
    uint64_t result = 0;
    for (size_t i = 0; i < count; ++i) result |= uint64_t(bytes[i]) << (8 * i);
    return result;
}

fs::path extractAssets() {
    std::ifstream executable("/proc/self/exe", std::ios::binary | std::ios::ate);
    if (!executable) throw std::runtime_error("не удалось прочитать исполняемый файл");
    std::streamoff end = executable.tellg();
    if (end < 24) throw std::runtime_error("встроенный архив отсутствует");
    std::array<unsigned char, 24> footer{};
    executable.seekg(end - 24);
    executable.read(reinterpret_cast<char*>(footer.data()), footer.size());
    if (std::memcmp(footer.data(), "DRPKG001", 8) != 0) throw std::runtime_error("встроенный архив не найден");
    uint64_t size = littleEndian(footer.data() + 8, 8);
    uint64_t expected_hash = littleEndian(footer.data() + 16, 8);
    if (size > 128 * 1024 * 1024 || size > uint64_t(end - 24)) throw std::runtime_error("некорректный размер архива");

    std::vector<unsigned char> payload(size);
    executable.seekg(end - 24 - std::streamoff(size));
    executable.read(reinterpret_cast<char*>(payload.data()), std::streamsize(payload.size()));
    if (!executable) throw std::runtime_error("встроенный архив обрезан");
    uint64_t hash = 14695981039346656037ULL;
    for (unsigned char byte : payload) hash = (hash ^ byte) * 1099511628211ULL;
    if (hash != expected_hash) throw std::runtime_error("контрольная сумма архива не совпала");

    struct Entry { fs::path name; size_t offset; size_t size; };
    std::vector<Entry> entries;
    std::set<std::string> seen;
    size_t cursor = 0;
    auto read = [&](size_t bytes) -> size_t {
        if (bytes > payload.size() - cursor) throw std::runtime_error("запись архива обрезана");
        size_t start = cursor;
        cursor += bytes;
        return start;
    };
    uint64_t count = littleEndian(payload.data() + read(4), 4);
    if (count == 0 || count > 256) throw std::runtime_error("некорректное число файлов в архиве");
    for (uint64_t i = 0; i < count; ++i) {
        uint64_t name_size = littleEndian(payload.data() + read(2), 2);
        uint64_t data_size = littleEndian(payload.data() + read(8), 8);
        if (name_size == 0 || name_size > 255 || data_size > payload.size()) throw std::runtime_error("некорректная запись архива");
        size_t name_offset = read(size_t(name_size));
        std::string name(reinterpret_cast<const char*>(payload.data() + name_offset), size_t(name_size));
        if (name.find('\0') != std::string::npos || name.find('\\') != std::string::npos ||
            (name != "pulse.rom" && name.rfind("assets/", 0) != 0) || !seen.insert(name).second)
            throw std::runtime_error("некорректный путь в архиве");
        fs::path relative(name);
        if (relative.is_absolute()) throw std::runtime_error("абсолютный путь в архиве");
        for (const auto& part : relative) if (part == ".." || part == ".") throw std::runtime_error("опасный путь в архиве");
        size_t data_offset = read(size_t(data_size));
        entries.push_back({relative, data_offset, size_t(data_size)});
    }
    if (cursor != payload.size()) throw std::runtime_error("лишние байты во встроенном архиве");

    std::string pattern = (fs::temp_directory_path() / "dead-relay-assets-XXXXXX").string();
    if (!mkdtemp(pattern.data())) throw std::runtime_error("не удалось создать временный каталог");
    fs::path root(pattern);
    try {
        for (const Entry& entry : entries) {
            fs::path destination = root / entry.name;
            fs::create_directories(destination.parent_path());
            std::ofstream output(destination, std::ios::binary);
            output.write(reinterpret_cast<const char*>(payload.data() + entry.offset), std::streamsize(entry.size));
            if (!output) throw std::runtime_error("не удалось извлечь файл архива");
        }
    } catch (...) {
        std::error_code ignored;
        fs::remove_all(root, ignored);
        throw;
    }
    return root;
}

constexpr int WIDTH = 1440;
constexpr int HEIGHT = 900;
constexpr float PI_F = 3.14159265f;
constexpr int SHADOW_RESOLUTION = 1536;
const Color INK{12, 17, 20, 255};
const Color PANEL{20, 28, 32, 255};
const Color HAIR{56, 68, 71, 255};
const Color PAPER{205, 213, 208, 255};
const Color MUTED{134, 151, 150, 255};
const Color AMBER{234, 167, 71, 255};
const Color CYAN{91, 191, 184, 255};
const Color ALERT{211, 102, 88, 255};
Texture2D floorTexture{};
Texture2D metalTexture{};
Texture2D floorLowTexture{};
Texture2D metalLowTexture{};
Model floorModel{};
Model metalModel{};
Model floorLowModel{};
Model metalLowModel{};
Model barrelModel{};
Model generatorModel{};
Model cartModel{};
Model rackModel{};
Model searchlightModel{};
Model hangingLightModel{};
bool highGraphics = true;
void hangingLight(float x, float z, Color color, float t);
void gear(float x, float y, float z, float r, float spin, Color c);

RenderTexture2D loadShadowMap() {
    RenderTexture2D target{};
    target.id = rlLoadFramebuffer();
    target.texture.width = SHADOW_RESOLUTION;
    target.texture.height = SHADOW_RESOLUTION;
    if (target.id > 0) {
        rlEnableFramebuffer(target.id);
        target.depth.id = rlLoadTextureDepth(SHADOW_RESOLUTION, SHADOW_RESOLUTION, false);
        target.depth.width = SHADOW_RESOLUTION;
        target.depth.height = SHADOW_RESOLUTION;
        target.depth.format = 19;
        target.depth.mipmaps = 1;
        rlFramebufferAttach(target.id, target.depth.id, RL_ATTACHMENT_DEPTH, RL_ATTACHMENT_TEXTURE2D, 0);
        if (!rlFramebufferComplete(target.id)) TraceLog(LOG_WARNING, "Буфер теней не готов");
        rlDisableFramebuffer();
    }
    return target;
}

void texturedBox(Model& model, Vector3 at, Vector3 size, Color tintColor) {
    DrawModelEx(model, at, {0, 1, 0}, 0, size, tintColor);
}

struct District {
    const char* name;
    const char* system;
    const char* action;
    const char* clue;
    const char* npc;
    Color ground;
    Color metal;
    Color accent;
};

const District DISTRICTS[] = {
    {"01 / ПОСТ ДОПУСКА", "СКАНЕР ВЕДОМОСТЕЙ", "manifest ", "Сканер и журнал по-разному считают массу одного груза.", "Запись ALICE: одна ведомость, два счётчика. Проверяйте оба.", {40, 54, 58, 255}, {69, 83, 87, 255}, {234, 167, 71, 255}},
    {"02 / СКЛАД", "УЧЁТ КАТУШЕК", "salvage ", "Склад и платёжный узел читают одну накладную по-разному.", "Запись ALICE: счётчик склада старше терминала выплат.", {47, 52, 50, 255}, {86, 89, 78, 255}, {218, 181, 105, 255}},
    {"03 / ПЕРЕПРАВА", "КАЛИБРОВКА ПЕРЕДАТЧИКА", "ferry ", "Ключ меняется от сеанса к сеансу. Изучите старую прошивку.", "Запись ALICE: приёмник видит только часть зерна сеанса.", {38, 53, 64, 255}, {62, 84, 96, 255}, {90, 187, 199, 255}},
    {"04 / ДРЕНАЖ", "СХЕМА КАНАЛА", "seam ", "Бумажная схема обрывается раньше, чем память контроллера.", "Запись ALICE: служебный шов лежит за левым краем седьмой строки.", {37, 55, 54, 255}, {62, 87, 83, 255}, {99, 190, 168, 255}},
    {"05 / ПЛАВИЛЬНЫЙ УЗЕЛ", "РЕЦЕПТ ЗАПУСКА", "forge ", "Контролёр и печь читают один рецепт по разным правилам.", "Запись ALICE: шесть катушек, безопасный заряд три, для запуска нужно пятнадцать.", {57, 47, 43, 255}, {104, 73, 63, 255}, {238, 123, 80, 255}},
    {"06 / ХОЛОДНЫЙ АРХИВ", "ДЕКОДЕР УКАЗАТЕЛЯ", "archive ", "Указатель строится из зерна сеанса старой прошивкой.", "Запись ALICE: восемь знаков. Буквы I и O в алфавит не вошли.", {39, 47, 56, 255}, {63, 77, 90, 255}, {151, 172, 205, 255}},
    {"07 / ПЛАНИРОВЩИК", "СЛУЖЕБНОЕ ОКНО", "clock ", "Служебное окно открывается в начале суток, которых уже не должно быть.", "Запись ALICE: сегодня счётчик начался на такте 73. Продвиньте его достаточно далеко.", {55, 51, 45, 255}, {92, 83, 69, 255}, {217, 174, 107, 255}},
    {"08 / ЯДРО УСТАНОВКИ", "ПРОВЕРКА ROM", "core ", "Маленькая ROM-карта превращает зерно сеанса в итоговый код.", "Запись ALICE: восемь команд. Карта у вас, интерпретатор — внутри клиента.", {44, 46, 59, 255}, {70, 75, 107, 255}, {157, 169, 232, 255}}
};

const char* AUDIT_NOTES[] = {
    "Аудит: сканер хранит массу в одном байте; журнал сохраняет всю накладную.",
    "Аудит: остаток склада занимает два байта, выплата использует исходное число.",
    "Аудит: калибровка вращает младшую часть зерна после постоянного смещения.",
    "Аудит: схема проверяет только верхние границы, затем сужает координаты до байта.",
    "Аудит: контролёр читает первое поле charge, печь — последнее.",
    "Аудит: из алфавита указателя убрали неоднозначные символы.",
    "Аудит: счётчик тактов замыкается в конце 32-битных суток.",
    "Аудит: код каждой команды ROM находится в старших трёх битах байта."
};

const char* SERVICE_NOTES[] = {
    "Трасса: сканер не принимает больше двенадцати единиц, а ведомость требует больше двенадцати.",
    "Трасса: на складе восемь катушек. Плата за переправу — 5000 кредитов.",
    "Трасса: по F2 видны контрольные ответы для старого зерна сеанса.",
    "Трасса: служебная плитка 255 соответствует седьмой строке канала.",
    "Трасса: для запуска нужны шесть катушек и суммарная энергия пятнадцать.",
    "Трасса: восемь знаков указателя зависят от текущего зерна сеанса.",
    "Трасса: счётчик начинает с 73; служебное окно заканчивается до такта 100.",
    "Трасса: в PULSE ROM 64 байта; младшие пять бит задают аргумент команды."
};

Color tint(Color c, float f) {
    return {static_cast<unsigned char>(std::clamp(int(c.r * f), 0, 255)),
            static_cast<unsigned char>(std::clamp(int(c.g * f), 0, 255)),
            static_cast<unsigned char>(std::clamp(int(c.b * f), 0, 255)), 255};
}

void box(Vector3 at, Vector3 size, Color color, bool edges = false) {
    DrawCubeV(at, size, color);
    if (edges) DrawCubeWiresV(at, size, tint(color, 0.53f));
}

void beam(Vector3 a, Vector3 b, float radius, Color color) { DrawCylinderEx(a, b, radius, radius, 12, color); }

void ring(Vector3 center, float radius, float thickness, Color color, int count = 32) {
    for (int i = 0; i < count; ++i) {
        float a = 2 * PI_F * i / count, b = 2 * PI_F * (i + 1) / count;
        beam({center.x + radius * cosf(a), center.y, center.z + radius * sinf(a)},
             {center.x + radius * cosf(b), center.y, center.z + radius * sinf(b)}, thickness, color);
    }
}

void grate(float x, float z, float w, float d, Color accent) {
    box({x, 0.035f, z}, {w, 0.06f, d}, tint(accent, 0.35f));
    for (float p = -w / 2; p <= w / 2; p += 0.35f) box({x + p, 0.08f, z}, {0.045f, 0.04f, d}, tint(accent, 0.8f));
}

void lightPole(float x, float z, Color color, float t) {
    box({x, 2.1f, z}, {0.16f, 4.2f, 0.16f}, {84, 93, 94, 255});
    box({x, 4.25f, z}, {0.65f, 0.22f, 0.65f}, {40, 48, 52, 255});
    DrawSphere({x, 4.05f, z}, 0.27f, tint(color, 0.75f + 0.12f * sinf(t * 2.0f + x)));
    DrawCircle3D({x, 0.06f, z}, 2.7f, {1, 0, 0}, 90, Fade(color, 0.12f));
}

void room(const District& d, float t) {
    box({0, -0.34f, 0}, {44, 0.6f, 44}, d.ground);
    if (highGraphics) {
        for (int x = -20; x <= 20; x += 4) for (int z = -20; z <= 20; z += 4) {
            int variation = ((x * 13 + z * 7 + 500) % 5) * 7;
            Color weather{static_cast<unsigned char>(225 + variation / 2), static_cast<unsigned char>(225 + variation / 2),
                          static_cast<unsigned char>(225 + variation / 2), 255};
            texturedBox(floorModel, {float(x), -0.005f, float(z)}, {3.92f, 0.055f, 3.92f}, weather);
            for (int sx : {-1, 1}) for (int sz : {-1, 1})
                DrawSphere({float(x) + 1.70f * sx, 0.035f, float(z) + 1.70f * sz}, 0.035f, tint(d.metal, 0.8f));
        }
    } else {
        texturedBox(floorLowModel, {0, -0.005f, 0}, {43.9f, 0.055f, 43.9f}, {230, 230, 230, 255});
    }
    for (int i = -20; i <= 20; i += (highGraphics ? 2 : 4)) {
        box({float(i), 0.0f, 0}, {0.026f, 0.04f, 43}, tint(d.ground, 0.78f));
        box({0, 0.0f, float(i)}, {43, 0.04f, 0.026f}, tint(d.ground, 0.78f));
    }
    // High perimeter walls stay beyond the camera's maximum orbit.
    for (int side : {-1, 1}) {
        if (highGraphics) {
            for (int p = -20; p <= 20; p += 4) {
                texturedBox(metalModel, {float(side * 21.8f), 4.0f, float(p)}, {0.45f, 8.0f, 3.95f}, {240, 240, 240, 255});
                texturedBox(metalModel, {float(p), 4.0f, float(side * 21.8f)}, {3.95f, 8.0f, 0.45f}, {240, 240, 240, 255});
                box({float(side * 21.49f), 3.7f, float(p)}, {0.08f, 0.1f, 3.6f}, tint(d.accent, 0.45f));
                box({float(p), 3.7f, float(side * 21.49f)}, {3.6f, 0.1f, 0.08f}, tint(d.accent, 0.45f));
            }
        } else {
            texturedBox(metalLowModel, {float(side * 21.8f), 4.0f, 0}, {0.45f, 8.0f, 43.9f}, {240, 240, 240, 255});
            texturedBox(metalLowModel, {0, 4.0f, float(side * 21.8f)}, {43.9f, 8.0f, 0.45f}, {240, 240, 240, 255});
        }
        for (int p = -20; p <= 20; p += 4) {
            box({float(side * 21.48f), 4, float(p)}, {0.24f, 8, 0.24f}, d.metal);
            box({float(p), 4, float(side * 21.48f)}, {0.24f, 8, 0.24f}, d.metal);
        }
        box({float(side * 21.4f), 6.6f, 0}, {0.16f, 0.17f, 43}, tint(d.accent, 0.42f));
        box({0, 6.6f, float(side * 21.4f)}, {43, 0.17f, 0.16f}, tint(d.accent, 0.42f));
    }
    for (int p = -18; p <= 18; p += 6) {
        beam({float(p), 8.0f, -21}, {float(p), 8.0f, 21}, 0.12f, tint(d.metal, 0.80f));
        if (highGraphics) for (int z = -18; z <= 18; z += 6) {
            beam({float(p), 7.9f, float(z)}, {float(p + 2), 7.9f, float(z + 3)}, 0.055f, tint(d.metal, 0.72f));
            beam({float(p + 2), 7.9f, float(z + 3)}, {float(p), 7.9f, float(z + 6)}, 0.055f, tint(d.metal, 0.72f));
        }
    }
    for (int side : {-1, 1}) {
        box({side * 4.55f, 0.055f, 0}, {0.075f, 0.012f, 11.5f}, tint(d.accent, 0.62f));
        for (int i = -4; i <= 4; ++i)
            box({side * 4.55f, 0.06f, float(i)}, {0.24f, 0.018f, 0.045f}, tint(d.accent, 0.78f));
        beam({side * 7.9f, 0.15f, -3.0f}, {side * 5.0f, 0.15f, 0.0f}, 0.07f, {39, 49, 51, 255});
        beam({side * 5.0f, 0.15f, 0.0f}, {side * 2.3f, 0.15f, -1.0f}, 0.07f, {39, 49, 51, 255});
    }
    for (int x = -14; x <= 14; x += 7) for (int z = -14; z <= 14; z += 7) {
        box({float(x), 0.04f, float(z)}, {1.5f, 0.025f, 0.06f}, tint(d.metal, 0.7f));
        box({float(x), 0.04f, float(z)}, {0.06f, 0.025f, 1.5f}, tint(d.metal, 0.7f));
    }
    lightPole(-16, -16, d.accent, t);
    lightPole(16, -16, d.accent, t);
    lightPole(-16, 16, d.accent, t);
    lightPole(16, 16, d.accent, t);
    for (int sx : {-1, 1}) for (int sz : {-1, 1}) {
        float x = sx * 8.0f, z = sz * 8.0f;
        beam({x, 8.0f, z}, {x, 7.7f, z}, 0.045f, {42, 49, 51, 255});
        hangingLight(x, z, d.accent, t);
    }
    if (highGraphics) for (int i = 0; i < 34; ++i) {
        float x = -11.0f + fmodf(i * 2.87f + t * (0.11f + (i % 4) * 0.035f), 22.0f);
        float z = -10.0f + fmodf(i * 3.41f, 20.0f);
        float y = 0.9f + fmodf(i * 1.37f + t * 0.07f, 5.2f);
        DrawSphere({x, y, z}, 0.018f + 0.007f * (i % 3), tint(d.accent, 0.55f));
    }
}

void console(const District& d, int phase, float t) {
    texturedBox(metalModel, {0, 0.90f, -1}, {5.4f, 1.8f, 2.8f}, {145, 156, 157, 255});
    box({0, 0.21f, -1}, {5.7f, 0.32f, 3.0f}, {30, 38, 41, 255}, true);
    for (int s : {-1, 1}) {
        box({s * 2.60f, 1.10f, -1}, {0.16f, 1.9f, 2.9f}, d.metal);
        box({s * 2.77f, 1.07f, 0.20f}, {0.08f, 1.55f, 0.17f}, tint(d.accent, 0.65f));
    }
    // Deep monitor hoods, separate display glass, status lamps, keyboard and gauges.
    for (int screen = -1; screen <= 1; ++screen) {
        float cx = screen * 1.48f;
        box({cx, 2.42f, -1.71f}, {1.40f, 1.10f, 0.35f}, {25, 32, 35, 255}, true);
        box({cx, 2.42f, -1.52f}, {1.17f, 0.78f, 0.035f}, tint(d.accent, 0.28f));
        for (int i = 0; i < 10; ++i) {
            float wave = 0.21f * sinf(t * (1.6f + screen * 0.2f) + i * 0.65f + screen);
            box({cx - 0.49f + i * 0.109f, 2.41f + wave, -1.493f}, {0.055f, 0.065f, 0.025f}, d.accent);
            if (i % 3 == 0)
                box({cx - 0.49f + i * 0.109f, 2.16f, -1.493f}, {0.055f, 0.035f, 0.025f}, tint(CYAN, 0.8f));
        }
        box({cx, 1.84f, -1.50f}, {0.65f, 0.05f, 0.045f}, {99, 111, 112, 255});
    }
    DrawModelEx(metalModel, {0, 1.71f, 0.02f}, {1, 0, 0}, -17, {5.0f, 0.16f, 1.18f}, {162, 169, 167, 255});
    for (int row = 0; row < 3; ++row) for (int col = 0; col < 13; ++col) {
        float x = -1.95f + col * 0.32f, z = -0.29f + row * 0.28f;
        box({x, 1.80f - row * 0.065f, z}, {0.19f, 0.045f, 0.13f},
            col == 12 && row == 1 ? d.accent : Color{79, 91, 92, 255});
    }
    for (int s : {-1, 1}) {
        float x = s * 2.11f;
        DrawCylinderEx({x, 1.69f, 0.60f}, {x, 1.73f, 0.60f}, 0.26f, 0.26f, 20, {37, 45, 47, 255});
        DrawCylinderEx({x, 1.74f, 0.60f}, {x, 1.77f, 0.60f}, 0.19f, 0.19f, 20, d.accent);
        beam({x, 1.77f, 0.60f}, {x + s * 0.15f * sinf(t), 1.82f, 0.60f + 0.15f * cosf(t)}, 0.024f, PAPER);
        box({x, 1.30f, 0.47f}, {0.38f, 0.10f, 0.15f}, {39, 46, 49, 255});
    }
    for (int i = 0; i < 18; ++i) {
        float x = -2.3f + i * 0.27f;
        box({x, 0.60f, 0.43f}, {0.11f, 0.08f, 0.055f}, i % 6 == 0 ? d.accent : Color{91, 102, 100, 255});
    }
    for (int s : {-1, 1}) {
        beam({s * 2.8f, 0.15f, -1.1f}, {s * 3.8f, 0.12f, 0.5f}, 0.085f, {31, 40, 44, 255});
        box({s * 2.75f, 3.25f, -1.6f}, {0.19f, 1.0f, 0.25f}, d.metal);
        box({s * 2.75f, 3.77f, -1.6f}, {0.48f, 0.18f, 0.38f}, d.accent);
    }
    grate(0, 2.15f, 6.6f, 1.7f, d.accent);

    // Every district has different equipment behind the shared operator desk.
    switch (phase) {
    case 0: {
        for (int s : {-1, 1}) box({s * 2.7f, 3.2f, -3.55f}, {0.22f, 6.4f, 0.28f}, d.metal);
        beam({-2.7f, 6.35f, -3.55f}, {2.7f, 6.35f, -3.55f}, 0.14f, d.metal);
        float scan = -2.3f + fmodf(t * 1.35f, 4.6f);
        box({scan, 3.2f, -3.5f}, {0.055f, 5.6f, 0.06f}, tint(d.accent, 1.2f));
        box({scan, 0.12f, -3.55f}, {0.7f, 0.05f, 1.7f}, tint(d.accent, 0.52f));
        break;
    }
    case 1: {
        box({0, 0.7f, -4.6f}, {4.8f, 0.40f, 3.2f}, {55, 60, 54, 255}, true);
        DrawCylinderEx({0, 0.94f, -4.6f}, {0, 1.07f, -4.6f}, 1.2f, 1.2f, 24, d.metal);
        for (int s : {-1, 1}) beam({s * 2.5f, 5.3f, -5.0f}, {s * 2.0f, 1.9f + 0.32f * sinf(t), -4.7f}, 0.09f, d.metal);
        box({0, 5.35f, -5.0f}, {5.6f, 0.24f, 0.45f}, d.metal);
        break;
    }
    case 2: {
        DrawCylinderEx({0, 3.45f, -4.2f}, {0, 5.5f, -4.2f}, 0.22f, 0.22f, 16, d.metal);
        float a = t * 0.44f;
        beam({-2.5f * cosf(a), 5.5f, -4.2f - 2.5f * sinf(a)},
             {2.5f * cosf(a), 5.5f, -4.2f + 2.5f * sinf(a)}, 0.13f, d.accent);
        DrawSphere({0, 5.5f, -4.2f}, 0.3f, PAPER);
        break;
    }
    case 3: {
        beam({0, 0.0f, -4.5f}, {0, 5.4f, -4.5f}, 0.24f, {74, 98, 96, 255});
        beam({0, 5.4f, -4.5f}, {1.5f * cosf(t * 0.33f), 5.4f, -4.5f + 1.5f * sinf(t * 0.33f)}, 0.16f, d.metal);
        ring({0, 4.0f, -4.5f}, 0.65f, 0.08f, d.accent, 20);
        break;
    }
    case 4: {
        DrawCylinderEx({0, 0.0f, -4.7f}, {0, 1.6f, -4.7f}, 1.6f, 1.35f, 24, {65, 49, 45, 255});
        for (int i = 0; i < 4; ++i) ring({0, 1.5f + i * 0.44f, -4.7f}, 1.4f + 0.10f * sinf(t * 2.2f + i), 0.09f, d.accent);
        DrawSphere({0, 2.65f + 0.16f * sinf(t * 2.2f), -4.7f}, 0.64f, tint(d.accent, 1.12f));
        break;
    }
    case 5: {
        for (int s : {-1, 1}) {
            DrawCylinderEx({s * 1.6f, 3.3f, -3.8f}, {s * 1.6f, 3.4f, -3.8f}, 0.95f, 0.95f, 28, {51, 60, 69, 255});
            ring({s * 1.6f, 3.43f, -3.8f}, 0.75f, 0.08f, d.accent, 24);
            for (int i = 0; i < 8; ++i) {
                float a = t * (s * 0.45f) + i * PI_F / 4;
                beam({s * 1.6f, 3.45f, -3.8f},
                     {s * 1.6f + 0.72f * cosf(a), 3.45f, -3.8f + 0.72f * sinf(a)}, 0.035f, d.accent);
            }
        }
        break;
    }
    case 6: {
        gear(-1.7f, 4.0f, -4.4f, 1.35f, t * 0.42f, d.accent);
        gear(1.7f, 4.0f, -4.4f, 1.35f, -t * 0.42f, d.accent);
        DrawCylinderEx({0, 3.7f, -4.4f}, {0, 4.0f, -4.4f}, 0.55f, 0.55f, 20, d.metal);
        break;
    }
    case 7: {
        for (int i = 0; i < 3; ++i) ring({0, 3.2f + i * 0.50f, -4.5f}, 1.30f + i * 0.22f, 0.08f, d.accent);
        DrawSphere({0, 4.0f + 0.14f * sinf(t * 2.4f), -4.5f}, 0.72f, tint(d.accent, 0.86f));
        break;
    }
    }
}

void sideCabinet(float x, float z, Color accent, float t) {
    box({x, 1.4f, z}, {1.7f, 2.8f, 1.0f}, {41, 52, 56, 255}, true);
    box({x, 2.17f, z - 0.54f}, {1.31f, 0.83f, 0.07f}, tint(accent, 0.46f));
    for (int i = 0; i < 6; ++i) {
        box({x - 0.54f + i * 0.21f, 2.1f + 0.13f * sinf(t + i), z - 0.59f},
            {0.08f, 0.055f, 0.03f}, accent);
    }
    for (int j = 0; j < 3; ++j) box({x, 0.65f + j * 0.3f, z - 0.53f}, {1.23f, 0.055f, 0.08f}, {105, 120, 122, 255});
    beam({x, 0.15f, z + 0.5f}, {x, 0.15f, z + 2.4f}, 0.08f, {70, 87, 90, 255});
}

void shippingContainer(float x, float z, float y, Color c) {
    box({x, y + 1.1f, z}, {5.4f, 2.2f, 2.3f}, c, true);
    for (float p = -2.35f; p <= 2.35f; p += 0.54f) box({x + p, y + 1.1f, z + 1.17f}, {0.08f, 1.85f, 0.06f}, tint(c, 0.65f));
    for (int s : {-1, 1}) box({x + s * 2.45f, y + 1.1f, z + 1.19f}, {0.12f, 1.95f, 0.06f}, tint(c, 1.25f));
}

void gear(float x, float y, float z, float r, float spin, Color c) {
    DrawCylinderEx({x, y - 0.2f, z}, {x, y + 0.2f, z}, r * 0.3f, r * 0.3f, 16, c);
    for (int i = 0; i < 12; ++i) {
        float a = spin + 2 * PI_F * i / 12;
        beam({x + 0.3f * r * cosf(a), y, z + 0.3f * r * sinf(a)},
             {x + 0.9f * r * cosf(a), y, z + 0.9f * r * sinf(a)}, 0.11f, c);
        box({x + r * cosf(a), y, z + r * sinf(a)}, {0.32f, 0.38f, 0.32f}, tint(c, 0.85f));
    }
    ring({x, y, z}, r, 0.13f, c);
}

void barrel(float x, float z, float scale = 1.4f) {
    if (barrelModel.meshCount) DrawModelEx(barrelModel, {x, 0.04f, z}, {0, 1, 0}, 0, {scale, scale, scale}, WHITE);
}

void generator(float x, float z, float angle = 0) {
    if (generatorModel.meshCount) DrawModelEx(generatorModel, {x, 0.04f, z}, {0, 1, 0}, angle, {1.5f, 1.5f, 1.5f}, WHITE);
}

void storageCart(float x, float z, float angle = 0) {
    if (cartModel.meshCount) DrawModelEx(cartModel, {x, 0.04f, z}, {0, 1, 0}, angle, {1.65f, 1.65f, 1.65f}, WHITE);
}

void wornRack(float x, float z, float angle = 0) {
    if (rackModel.meshCount) DrawModelEx(rackModel, {x, 0.04f, z}, {0, 1, 0}, angle, {2.25f, 2.25f, 2.25f}, WHITE);
}

void portableLight(float x, float z, float angle = 0) {
    if (searchlightModel.meshCount) DrawModelEx(searchlightModel, {x, 0.04f, z}, {0, 1, 0}, angle, {9.0f, 9.0f, 9.0f}, WHITE);
}

void hangingLight(float x, float z, Color color, float t) {
    if (hangingLightModel.meshCount)
        DrawModelEx(hangingLightModel, {x, 7.85f, z}, {0, 1, 0}, 0, {1.5f, 1.5f, 1.5f}, WHITE);
    DrawSphere({x, 6.9f, z}, 0.13f, tint(color, 0.72f + 0.15f * sinf(t * 2.7f + x)));
}

void districtProps(int phase, float t, const District& d) {
    switch (phase) {
    case 0: {
        generator(-6.4f, 0.5f, 90);
        storageCart(-4.8f, 5.1f, 30);
        portableLight(7.2f, -6.0f, -40);
        barrel(5.1f, 1.2f); barrel(6.4f, 1.4f); barrel(5.7f, 2.5f);
        shippingContainer(-12, -10, 0, {87, 110, 119, 255});
        shippingContainer(-12, -10, 2.2f, {124, 92, 75, 255});
        shippingContainer(12, -10, 0, {121, 101, 69, 255});
        shippingContainer(12, 8, 0, {72, 100, 106, 255});
        for (int x = -7; x <= 7; x += 2) box({float(x), 0.2f, 12}, {1.55f, 0.4f, 5}, {63, 66, 61, 255}, true);
        beam({-14, 0, -7}, {-14, 7.2f, -7}, 0.20f, d.metal);
        beam({-14, 7.2f, -7}, {-3.5f, 7.2f, -7}, 0.19f, d.metal);
        for (int i = 0; i < 5; ++i) beam({-13.5f + i * 2.1f, 7.2f, -7}, {-12.5f + i * 2.1f, 5.9f, -7}, 0.045f, d.metal);
        float carriage = -9.0f + 3.5f * sinf(t * 0.32f);
        float lift = 3.5f + 0.55f * sinf(t * 0.67f);
        box({carriage, 6.95f, -7}, {1.6f, 0.55f, 1.3f}, d.metal, true);
        beam({carriage, 6.65f, -7}, {carriage, lift, -7}, 0.055f, {87, 93, 91, 255});
        box({carriage, lift - 0.3f, -7}, {1.4f, 0.7f, 1.4f}, d.accent, true);
        box({carriage, lift - 1.25f, -7}, {2.3f, 1.15f, 1.8f}, {102, 95, 77, 255}, true);
        break;
    }
    case 1: {
        generator(-5.8f, 0.5f, 180);
        wornRack(-10.5f, 3.6f, 90);
        storageCart(5.0f, -7.5f, 180);
        for (int i = 0; i < 5; ++i) barrel(5.1f + i % 2 * 1.1f, 4.0f + i / 2 * 1.05f, 1.2f);
        for (int s : {-1, 1}) for (int i = 0; i < 3; ++i) {
            box({s * 12.0f, 2.2f, -11.0f + i * 6.0f}, {5.4f, 4.2f, 3.6f}, d.metal, true);
            for (int j = 0; j < 3; ++j) box({s * 12.0f, 0.7f + j * 1.25f, -9.1f + i * 6.0f}, {4.6f, 0.17f, 0.13f}, d.accent);
        }
        box({0, 0.24f, 10}, {15, 0.35f, 3}, {41, 43, 42, 255});
        for (int i = -6; i <= 6; ++i) DrawCylinderEx({float(i), 0.48f, 8.65f}, {float(i), 0.48f, 11.35f}, 0.12f, 0.12f, 12, {115, 119, 107, 255});
        for (int i = 0; i < 6; ++i) {
            float travel = -7.5f + fmodf(t * 1.25f + i * 3.1f, 16.0f);
            box({travel, 0.85f, 10}, {1.3f, 0.7f, 1.4f}, tint(d.metal, 0.8f + 0.05f * i), true);
            box({travel, 1.23f, 10}, {0.75f, 0.045f, 0.75f}, tint(d.accent, 0.7f));
        }
        break;
    }
    case 2: {
        generator(-6.8f, -4.0f, 90);
        portableLight(-7.1f, 3.5f, 20);
        storageCart(5.2f, -7.0f, 90);
        barrel(6.1f, -2.0f); barrel(7.3f, -2.6f);
        for (int s : {-1, 1}) {
            box({s * 10.5f, 0.04f, 0}, {7.4f, 0.1f, 36}, {27, 67, 76, 255});
            for (int i = -15; i <= 15; i += 2) {
                float ripple = 0.10f + 0.055f * sinf(t * 2.0f + i * 0.7f);
                beam({s * 8.5f, ripple, float(i) + 0.5f * sinf(t + i)},
                     {s * 12.5f, ripple, float(i) + 0.5f * sinf(t + i)}, 0.022f, {75, 138, 153, 255});
            }
            box({s * 4.4f, 1.0f, 0}, {0.15f, 2, 31}, d.metal);
        }
        box({0, 0.15f, 10}, {8.8f, 0.3f, 18}, {82, 84, 78, 255}, true);
        for (int i = -4; i <= 4; ++i) box({float(i), 0.36f, 10}, {0.05f, 0.04f, 18}, {53, 57, 55, 255});
        for (int s : {-1, 1}) for (int z = -14; z <= 14; z += 7) beam({s * 4.3f, 0, float(z)}, {s * 4.3f, 2.1f, float(z)}, 0.11f, d.metal);
        float ferryBob = 0.07f * sinf(t * 1.8f);
        float ferryDrift = 1.5f * sinf(t * 0.22f);
        box({0, 0.8f + ferryBob, -13 + ferryDrift}, {8, 1.3f, 4}, {55, 73, 80, 255}, true);
        box({0, 1.75f + ferryBob, -13 + ferryDrift}, {5.8f, 0.6f, 2.8f}, {86, 105, 111, 255}, true);
        break;
    }
    case 3: {
        generator(-5.5f, -5.0f);
        portableLight(5.5f, 4.2f, -20);
        barrel(5.3f, 3.1f);
        for (int s : {-1, 1}) {
            box({s * 9.0f, 0.02f, 0}, {8, 0.08f, 40}, {32, 83, 77, 255});
            box({s * 5.3f, 1.0f, 0}, {0.5f, 2, 38}, d.metal);
            for (int z = -17; z <= 17; z += 6) {
                beam({s * 5.4f, 0.5f, float(z)}, {s * 9.2f, 0.5f, float(z)}, 0.11f, {83, 116, 107, 255});
                DrawSphere({s * 9.0f, 0.15f, float(z) + sinf(t + z)}, 0.16f, {95, 159, 142, 255});
            }
            for (int i = 0; i < 12; ++i) {
                float flow = -18.0f + fmodf(t * (1.1f + i % 3 * 0.2f) + i * 3.7f, 36.0f);
                DrawSphere({s * (7.0f + i % 3), 0.12f + 0.025f * sinf(t * 3 + i), flow}, 0.065f, {102, 176, 162, 255});
            }
        }
        grate(0, 10, 10.3f, 4, d.accent);
        for (int z = -16; z <= 16; z += 8) {
            DrawCylinderEx({-19, 2.8f, float(z)}, {-14, 2.8f, float(z)}, 1.4f, 1.4f, 20, {48, 70, 68, 255});
            ring({-14, 2.8f, float(z)}, 1.35f, 0.16f, d.metal);
        }
        break;
    }
    case 4: {
        generator(-5.4f, 4.0f, 180); generator(6.4f, -2.5f, 90);
        storageCart(-7.0f, 7.3f, 100);
        barrel(5.2f, 4.4f); barrel(6.5f, 4.1f);
        for (int s : {-1, 1}) {
            DrawCylinderEx({s * 11.0f, 0, -10}, {s * 11.0f, 6.2f, -10}, 3.0f, 3.0f, 24, {70, 60, 55, 255});
            for (int y = 1; y <= 6; y += 2) ring({s * 11.0f, float(y), -10}, 3.05f, 0.15f, d.metal);
            DrawSphere({s * 11.0f, 6.1f + 0.15f * sinf(t * 3), -10}, 1.3f, tint(d.accent, 0.82f));
            beam({s * 11.0f, 3, -10}, {s * 11.0f, 3, 7}, 0.28f, {111, 76, 66, 255});
            for (int i = 0; i < 14; ++i) {
                float phase = fmodf(t * (0.8f + (i % 4) * 0.11f) + i * 0.41f, 4.3f);
                float wobble = 0.35f * sinf(t * 3.4f + i * 2.1f);
                DrawSphere({s * 11.0f + wobble, 2.0f + phase, -10 + 0.35f * cosf(i * 1.4f)},
                           0.065f + 0.035f * (i % 3), {247, 148, 68, 255});
            }
        }
        for (int i = -2; i <= 2; ++i) {
            box({float(i * 3.1f), 0.9f, 11}, {2.5f, 1.7f, 3}, {51, 57, 56, 255}, true);
            DrawSphere({float(i * 3.1f), 1.8f, 11}, 0.55f, tint(d.accent, 0.5f + 0.25f * sinf(t * 2 + i)));
        }
        for (int i = 0; i < 24; ++i) {
            float rise = fmodf(t * (1.2f + (i % 4) * 0.13f) + i * 0.22f, 3.6f);
            DrawSphere({0.6f * sinf(t * 2.8f + i), 1.8f + rise,
                        -4.7f + 0.5f * cosf(t * 1.6f + i * 0.7f)},
                       0.055f + 0.025f * (i % 3), {248, 156, 72, 255});
        }
        break;
    }
    case 5: {
        generator(5.5f, 5.0f, 270);
        wornRack(-11.8f, 7.5f, 90);
        for (int s : {-1, 1}) for (int i = 0; i < 6; ++i) {
            float x = s * (8.0f + (i % 2) * 4.2f), z = -15.0f + (i / 2) * 10.5f;
            box({x, 2.6f, z}, {2.6f, 5.2f, 7}, {34, 44, 54, 255}, true);
            for (int row = 0; row < 14; ++row) {
                box({x - s * 1.34f, 0.55f + row * 0.32f, z}, {0.035f, 0.11f, 6.2f}, tint(d.accent, 0.15f + (row % 3) * 0.09f));
                for (int j = -2; j <= 2; ++j) {
                    bool busy = sinf(t * 2.2f + row * 1.73f + j * 2.6f + i) > 0.48f;
                    box({x - s * 1.38f, 0.55f + row * 0.32f, z + j * 1.1f},
                        {0.06f, 0.055f, 0.08f}, busy ? d.accent : tint(CYAN, 0.43f));
                }
            }
        }
        box({0, 3, -18}, {7, 6, 1}, {37, 49, 60, 255}, true);
        ring({0, 3.4f, -17.4f}, 2.15f, 0.18f, d.accent);
        break;
    }
    case 6: {
        generator(-5.2f, -4.0f, 90);
        storageCart(5.5f, 6.0f, 270);
        for (int i = 0; i < 4; ++i) {
            float x = (i % 2 ? 11.0f : -11.0f), z = (i / 2 ? 11.0f : -11.0f);
            box({x, 3.4f, z}, {1.3f, 6.8f, 1.3f}, d.metal, true);
            gear(x, 5.8f, z, 2.1f, t * (i % 2 ? 0.2f : -0.2f), d.accent);
        }
        for (int s : {-1, 1}) {
            box({float(s * 7), 0.45f, 0}, {2, 0.9f, 18}, {63, 59, 51, 255});
            for (int z = -8; z <= 8; z += 2) box({float(s * 7), 1, float(z)}, {1.4f, 0.08f, 0.25f}, d.accent);
        }
        DrawCylinderEx({0, 0, -13}, {0, 8, -13}, 1.2f, 1.2f, 20, d.metal);
        for (int y = 1; y < 8; ++y) ring({0, float(y), -13}, 1.25f, 0.07f, d.accent);
        break;
    }
    case 7: {
        generator(-5.2f, 4.0f, 90); generator(5.2f, 4.0f, 270);
        portableLight(6.4f, -6.7f, 30);
        for (int s : {-1, 1}) {
            DrawCylinderEx({s * 12.0f, 0, -8}, {s * 12.0f, 7, -8}, 2.6f, 2.6f, 24, {53, 57, 77, 255});
            for (int y = 1; y <= 6; y += 2) ring({s * 12.0f, float(y), -8}, 2.75f, 0.2f, d.accent);
            for (int z = -14; z < 14; z += 7) beam({float(s * 12), 3.5f, -8}, {float(s * 15), 3.5f, float(z)}, 0.08f, {101, 108, 150, 255});
        }
        for (int i = 0; i < 4; ++i) {
            ring({-6, 2.0f + i * 0.55f, -4}, 1.8f + i * 0.28f, 0.08f, tint(d.accent, 0.6f + i * 0.07f));
            for (int k = 0; k < 8; ++k) {
                float a = t * (i % 2 ? -0.34f : 0.34f) + 2 * PI_F * k / 8;
                DrawSphere({-6 + (1.8f + i * 0.28f) * cosf(a), 2.0f + i * 0.55f,
                            -4 + (1.8f + i * 0.28f) * sinf(a)}, 0.12f, d.accent);
            }
        }
        DrawSphere({-6, 3.3f + 0.2f * sinf(t * 2.0f), -4}, 0.96f + 0.08f * sinf(t * 2.9f), tint(d.accent, 0.96f));
        for (int i = 0; i < 18; ++i) {
            float a = 2 * PI_F * i / 18 + t * 0.12f;
            DrawSphere({-6 + 2.5f * cosf(a), 3.3f + 0.45f * sinf(t * 3 + i), -4 + 2.5f * sinf(a)}, 0.09f, d.accent);
        }
        break;
    }
    }
}

void character(Vector3 pos, float facing, Color suit, float t, float moving = 0) {
    float stride = sinf(t * 9.5f + facing) * moving;
    float bob = 0.018f * sinf(t * 2.4f) + 0.045f * fabsf(stride);
    DrawCircle3D({pos.x, 0.04f, pos.z}, 0.57f, {1, 0, 0}, 90, Fade(BLACK, 0.25f));
    box({pos.x, 1.24f + bob, pos.z}, {0.72f, 1.1f, 0.46f}, suit, true);
    box({pos.x, 1.37f + bob, pos.z + 0.29f}, {0.52f, 0.66f, 0.16f}, {54, 69, 76, 255}, true);
    box({pos.x, 1.14f + bob, pos.z - 0.285f}, {0.55f, 0.21f, 0.08f}, {34, 43, 48, 255});
    DrawSphere({pos.x, 2.07f + bob, pos.z}, 0.39f, {151, 166, 166, 255});
    ring({pos.x, 1.86f + bob, pos.z}, 0.37f, 0.045f, {51, 65, 70, 255}, 18);
    box({pos.x, 2.09f + bob, pos.z - 0.33f}, {0.57f, 0.21f, 0.10f}, {32, 67, 77, 255});
    box({pos.x, 2.03f + bob, pos.z - 0.388f}, {0.43f, 0.035f, 0.022f}, {89, 164, 174, 255});
    box({pos.x, 2.39f + bob, pos.z}, {0.29f, 0.08f, 0.29f}, tint(suit, 0.75f));
    for (int s : {-1, 1}) {
        DrawSphere({pos.x + s * 0.46f, 1.70f + bob, pos.z}, 0.20f, tint(suit, 1.22f));
        beam({pos.x + s * 0.47f, 1.60f + bob, pos.z},
             {pos.x + s * 0.48f, 0.93f + bob, pos.z - s * stride * 0.22f}, 0.12f, tint(suit, 0.76f));
        DrawSphere({pos.x + s * 0.48f, 0.87f + bob, pos.z - s * stride * 0.22f}, 0.13f, {37, 48, 52, 255});
        Vector3 knee{pos.x + s * 0.21f, 0.47f + bob, pos.z + s * stride * 0.22f};
        Vector3 foot{pos.x + s * 0.21f, 0.15f, pos.z + s * stride * 0.52f};
        beam({pos.x + s * 0.21f, 0.79f + bob, pos.z}, knee, 0.12f, {42, 51, 54, 255});
        beam(knee, foot, 0.11f, {37, 46, 50, 255});
        box({foot.x, 0.13f, foot.z - 0.09f}, {0.28f, 0.18f, 0.44f}, {30, 38, 41, 255});
        box({pos.x + s * 0.32f, 1.28f + bob, pos.z + 0.32f}, {0.08f, 0.37f, 0.08f}, tint(suit, 1.2f));
    }
    beam({pos.x + 0.32f, 1.75f + bob, pos.z + 0.29f}, {pos.x + 0.47f, 1.28f + bob, pos.z + 0.40f}, 0.045f, {38, 51, 56, 255});
    beam({pos.x - 0.32f, 1.75f + bob, pos.z + 0.29f}, {pos.x - 0.47f, 1.28f + bob, pos.z + 0.40f}, 0.045f, {38, 51, 56, 255});
    box({pos.x + 0.20f, 1.74f + bob, pos.z + 0.39f}, {0.11f, 0.12f, 0.05f}, AMBER);
    for (int s : {-1, 1}) box({pos.x + s * 0.19f, 1.05f + bob, pos.z - 0.26f}, {0.16f, 0.55f, 0.055f}, tint(suit, 1.3f));
    box({pos.x, 1.44f + bob, pos.z - 0.24f}, {0.24f, 0.18f, 0.04f}, AMBER);
}

struct Net {
    struct Peer { std::string name; float x = 0, z = 0; };
    int fd = -1;
    std::string sid;
    uint32_t seed = 0;
    int phase = 0;
    uint64_t credits = 0;
    std::string name = "operator";
    std::string board;
    std::vector<Peer> peers;
    bool connected() const { return fd >= 0; }

    ~Net() { if (fd >= 0) close(fd); }

    std::string exchange(const std::string& line) {
        if (fd < 0) return "ERR|Нет связи. Нажмите R для переподключения.";
        std::string data = line + "\n";
        if (send(fd, data.c_str(), data.size(), MSG_NOSIGNAL) <= 0) { close(fd); fd = -1; return "ERR|Соединение потеряно."; }
        std::string out;
        char ch;
        while (out.size() < 2048) {
            ssize_t n = recv(fd, &ch, 1, 0);
            if (n <= 0) { close(fd); fd = -1; return "ERR|Соединение потеряно."; }
            if (ch == '\n') break;
            if (ch != '\r') out.push_back(ch);
        }
        return out;
    }

    bool connect_to(const std::string& host, const std::string& port, const fs::path& save) {
        if (fd >= 0) close(fd);
        fd = -1;
        addrinfo hints{}; hints.ai_family = AF_UNSPEC; hints.ai_socktype = SOCK_STREAM;
        addrinfo* list = nullptr;
        if (getaddrinfo(host.c_str(), port.c_str(), &hints, &list)) return false;
        for (addrinfo* p = list; p; p = p->ai_next) {
            int trial = socket(p->ai_family, p->ai_socktype, p->ai_protocol);
            if (::connect(trial, p->ai_addr, p->ai_addrlen) == 0) { fd = trial; break; }
            close(trial);
        }
        freeaddrinfo(list);
        if (fd < 0) return false;
        timeval timeout{2, 0};
        setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &timeout, sizeof(timeout));
        // Consume server greeting.
        std::string greeting;
        char ch;
        while (recv(fd, &ch, 1, 0) > 0 && ch != '\n') greeting.push_back(ch);
        std::string saved;
        std::ifstream saved_file(save); saved_file >> saved;
        std::string response = saved.empty() ? "" : exchange("RESUME " + saved);
        if (response.rfind("WELCOME|", 0) != 0) response = exchange("HELLO " + name);
        if (response.rfind("WELCOME|", 0) != 0) return false;
        std::vector<std::string> fields; std::istringstream parts(response); std::string field;
        while (std::getline(parts, field, '|')) fields.push_back(field);
        if (fields.size() < 7) return false;
        sid = fields[1]; phase = std::stoi(fields[3]); credits = std::stoull(fields[4]); seed = uint32_t(std::stoul(fields[5], nullptr, 16));
        std::ofstream(save) << sid << '\n';
        return true;
    }

    void refresh_peers() {
        std::string response = exchange("PEERS");
        if (response.rfind("PEERS", 0) != 0) return;
        peers.clear();
        std::istringstream parts(response.substr(5));
        std::string item;
        while (std::getline(parts, item, '|')) {
            if (item.empty()) continue;
            std::istringstream fields(item);
            std::string name, xs, zs;
            if (std::getline(fields, name, ',') && std::getline(fields, xs, ',') && std::getline(fields, zs, ',')) {
                try { peers.push_back({name, std::stof(xs), std::stof(zs)}); } catch (...) {}
            }
        }
    }
};

void drawWorld(const District& district, int phase, float t, Vector3 player, float yaw,
               float movement, const std::vector<Net::Peer>& peers) {
    room(district, t);
    districtProps(phase, t, district);
    console(district, phase, t);
    sideCabinet(-8, -3, district.accent, t);
    sideCabinet(8, -3, district.accent, t + 1.2f);
    character(player, yaw, {74, 111, 118, 255}, t, movement);
    character({-8, 0, 4}, 0, {115, 92, 81, 255}, t * 0.5f);
    for (const auto& peer : peers) character({peer.x, 0, peer.z}, 0, {89, 108, 134, 255}, t * 0.7f);
    for (int i = 0; i < 4; ++i) {
        float a = t * (0.2f + i * 0.04f) + i * 1.57f;
        Vector3 drone{(i % 2 ? 13.5f : -13.5f), 2.6f + 0.2f * sinf(t * 2 + i), 7.5f * sinf(a)};
        box(drone, {1.0f, 0.35f, 0.7f}, {56, 67, 72, 255});
        DrawSphere({drone.x, drone.y - 0.05f, drone.z - 0.4f}, 0.11f, district.accent);
        for (int s : {-1, 1}) {
            float hubX = drone.x + s * 0.45f;
            ring({hubX, drone.y + 0.18f, drone.z}, 0.30f, 0.025f, {105, 117, 119, 255}, 12);
            float rotor = t * 13.0f + i + s;
            beam({hubX - 0.28f * cosf(rotor), drone.y + 0.19f, drone.z - 0.28f * sinf(rotor)},
                 {hubX + 0.28f * cosf(rotor), drone.y + 0.19f, drone.z + 0.28f * sinf(rotor)},
                 0.035f, {150, 163, 165, 255});
        }
    }
}

void line(int x, int y, int w, Color color) { DrawRectangle(x, y, w, 1, color); }

void label(Font font, const std::string& value, int x, int y, int size, Color color, float spacing = 1.0f) {
    DrawTextEx(font, value.c_str(), {float(x), float(y)}, float(size), spacing, color);
}

size_t utf8Length(const std::string& text) {
    size_t length = 0;
    for (unsigned char byte : text) if ((byte & 0xc0) != 0x80) ++length;
    return length;
}

std::string clipped(const std::string& text, size_t width) {
    if (utf8Length(text) <= width) return text;
    size_t glyphs = 0;
    for (size_t i = 0; i < text.size(); ++i) {
        if ((static_cast<unsigned char>(text[i]) & 0xc0) != 0x80 && glyphs++ == width - 3)
            return text.substr(0, i) + "...";
    }
    return text;
}

void hud(Font font, const Net& net, int phase, const std::vector<std::string>& journal,
         const std::string& typed, bool terminal, const std::string& message, bool diagnostics, const std::vector<uint8_t>& rom,
         Vector3 player, float t) {
    const District& d = DISTRICTS[std::clamp(phase, 0, 7)];
    DrawRectangle(0, 0, WIDTH, 77, INK);
    line(0, 76, WIDTH, HAIR);
    label(font, "МЁРТВОЕ РЕЛЕ", 34, 20, 27, PAPER);
    label(font, "ЛАБОРАТОРИЯ X / РЕВИЗИЯ", 279, 30, 16, MUTED);
    label(font, net.connected() ? "СВЯЗЬ / ЕСТЬ" : "СВЯЗЬ / НЕТ", 1190, 27, 17, net.connected() ? CYAN : ALERT);

    DrawRectangle(1060, 77, 380, 823, INK);
    DrawRectangle(1059, 77, 1, 823, HAIR);
    label(font, d.name, 1090, 105, 22, PAPER);
    label(font, d.system, 1090, 140, 16, d.accent);
    line(1090, 173, 320, HAIR);
    label(font, "ОПЕРАТОР", 1090, 197, 14, MUTED);
    label(font, net.name, 1090, 218, 20, PAPER);
    label(font, "ЗЕРНО СЕАНСА", 1090, 256, 14, MUTED);
    label(font, firmware::hex(net.seed, 8), 1090, 278, 21, CYAN);
    label(font, "КРЕДИТЫ", 1090, 316, 14, MUTED);
    label(font, std::to_string(net.credits), 1090, 338, 21, PAPER);
    line(1090, 382, 320, HAIR);
    label(font, "МАРШРУТ / 08 УЧАСТКОВ", 1090, 402, 15, MUTED);
    for (int i = 0; i < 8; ++i) {
        Color c = i < phase ? CYAN : (i == phase ? d.accent : HAIR);
        DrawRectangle(1090 + (i % 4) * 81, 438 + (i / 4) * 42, 68, 28, i == phase ? tint(d.accent, 0.30f) : PANEL);
        DrawRectangleLines(1090 + (i % 4) * 81, 438 + (i / 4) * 42, 68, 28, c);
        label(font, "0" + std::to_string(i + 1), 1111 + (i % 4) * 81, 444 + (i / 4) * 42, 14, c);
    }
    line(1090, 539, 320, HAIR);
    label(font, "ПОЛЕВАЯ ЗАМЕТКА", 1090, 557, 14, MUTED);
    std::istringstream words(d.clue);
    std::string word, current; int yy = 585;
    while (words >> word) {
        if (utf8Length(current) + utf8Length(word) > 32) { label(font, current, 1090, yy, 15, PAPER); yy += 22; current.clear(); }
        if (!current.empty()) current += ' ';
        current += word;
    }
    if (!current.empty()) label(font, current, 1090, yy, 15, PAPER);
    line(1090, 701, 320, HAIR);
    label(font, "В СЕТИ / ОПЕРАТОРЫ", 1090, 720, 14, MUTED);
    label(font, clipped(net.board.empty() ? "Других сигналов нет." : net.board, 36), 1090, 747, 14, CYAN);
    label(font, "WASD ХОД   E ЧИТАТЬ   T ПУЛЬТ", 1090, 820, 13, MUTED);
    label(font, "R СВЯЗЬ   F2 ДИАГНОСТИКА", 1090, 844, 13, MUTED);
    label(font, highGraphics ? "F3 ГРАФИКА / ПОЛНАЯ" : "F3 ГРАФИКА / ОБЛЕГЧЁННАЯ", 1090, 868, 13, MUTED);

    label(font, net.connected() ? "УЧАСТОК / " + firmware::hex(int(player.x + 22), 2) + ":" + firmware::hex(int(player.z + 22), 2) : "УЧАСТОК / НЕТ СВЯЗИ", 34, 88, 15, MUTED);
    if (!message.empty()) {
        DrawRectangle(20, 604, 1020, 75, PANEL);
        DrawRectangle(20, 604, 4, 75, d.accent);
        label(font, clipped(message, 92), 43, 628, 18, PAPER);
    }
    if (terminal) {
        DrawRectangle(20, 585, 1020, 295, INK);
        DrawRectangleLines(20, 585, 1020, 295, HAIR);
        label(font, "ТЕРМИНАЛ ПОСТА / " + std::string(d.system), 42, 606, 18, d.accent);
        line(42, 638, 976, HAIR);
        int start = std::max(0, int(journal.size()) - 7);
        for (int i = start; i < int(journal.size()); ++i)
            label(font, clipped(journal[i], 94), 44, 650 + (i - start) * 25, 16, i % 2 ? MUTED : PAPER);
        DrawRectangle(40, 837, 978, 32, PANEL);
        label(font, "> " + typed + (int(t * 2) % 2 ? "_" : " "), 50, 842, 17, CYAN);
    }
    if (diagnostics) {
        DrawRectangle(180, 150, 710, 420, INK);
        DrawRectangleLines(180, 150, 710, 420, d.accent);
        label(font, "ПРОШИВКА / КОНТРОЛЬНЫЙ ВЕКТОР", 205, 194, 20, d.accent);
        line(205, 230, 660, HAIR);
        label(font, "ОПОРНОЕ ЗЕРНО     13572468", 205, 254, 17, PAPER);
        label(font, "КОД ПЕРЕПРАВЫ    " + std::to_string(firmware::ferry(0x13572468u)), 205, 288, 17, PAPER);
        label(font, "ИНДЕКС АРХИВА    " + firmware::archive(0x13572468u), 205, 322, 17, PAPER);
        label(font, "СЛЕПОК PULSE ROM  " + firmware::hex(firmware::core(0x13572468u, rom), 16), 205, 356, 17, PAPER);
        uint16_t liveFerryCheck = uint16_t(uint32_t(firmware::ferry(net.seed)) * 0x9e37u) ^ 0x4d2bu;
        uint32_t liveArchiveHash = 2166136261u;
        for (unsigned char glyph : firmware::archive(net.seed)) liveArchiveHash = (liveArchiveHash ^ glyph) * 16777619u;
        uint16_t liveRomWatch = uint16_t(firmware::core(net.seed ^ 0xc0dec0deu, rom) ^ 0xb4137e55c6a90f21ULL);
        label(font, "СЕАНС / ПЕРЕПРАВА " + firmware::hex(liveFerryCheck, 4), 205, 405, 17, CYAN);
        label(font, "СЕАНС / УКАЗАТЕЛЬ " + firmware::hex(liveArchiveHash, 8), 205, 435, 17, CYAN);
        label(font, "СЕАНС / ROM       " + firmware::hex(liveRomWatch, 4), 205, 465, 17, CYAN);
        label(font, "64 БАЙТА ROM / 8 КОМАНД / F2 — ЗАКРЫТЬ", 205, 528, 16, MUTED);
    }
}

int main(int argc, char** argv) {
    (void)argc;
    (void)argv;
    AssetDirectory bundle;
    try {
        bundle.path = extractAssets();
    } catch (const std::exception& error) {
        std::cerr << "Ошибка встроенного архива: " << error.what() << '\n';
        return 1;
    }
    fs::path base = bundle.path;
    std::ifstream rom_file(base / "pulse.rom", std::ios::binary);
    std::vector<uint8_t> rom(std::istreambuf_iterator<char>{rom_file}, {});
    if (rom.size() != 64) { std::cerr << "Некорректная встроенная pulse.rom\n"; return 1; }

    SetConfigFlags(FLAG_MSAA_4X_HINT | FLAG_VSYNC_HINT);
    InitWindow(WIDTH, HEIGHT, "Мёртвое реле / Лаборатория X");
    SetTargetFPS(60);
    const char* rendererName = reinterpret_cast<const char*>(glGetString(GL_RENDERER));
    std::string rendererText = rendererName ? rendererName : "";
    highGraphics = rendererText.find("llvmpipe") == std::string::npos &&
                   rendererText.find("softpipe") == std::string::npos &&
                   rendererText.find("SwiftShader") == std::string::npos;
    if (const char* quality = std::getenv("RELAY_GRAPHICS")) highGraphics = std::string(quality) == "high";
    Font font = GetFontDefault();
    fs::path font_path = base / "assets" / "DejaVuSansMono.ttf";
    std::vector<int> glyphs;
    for (int codepoint = 32; codepoint <= 126; ++codepoint) glyphs.push_back(codepoint);
    glyphs.push_back(0x0401);
    for (int codepoint = 0x0410; codepoint <= 0x044f; ++codepoint) glyphs.push_back(codepoint);
    glyphs.insert(glyphs.end(), {0x0451, 0x00ab, 0x00bb, 0x2013, 0x2014, 0x2116});
    if (fs::exists(font_path)) font = LoadFontEx(font_path.string().c_str(), 24, glyphs.data(), int(glyphs.size()));
    floorTexture = LoadTexture((base / "assets" / "concrete_floor.png").string().c_str());
    metalTexture = LoadTexture((base / "assets" / "metal_plate.png").string().c_str());
    floorLowTexture = LoadTexture((base / "assets" / "concrete_floor_low.png").string().c_str());
    metalLowTexture = LoadTexture((base / "assets" / "metal_plate_low.png").string().c_str());
    floorModel = LoadModelFromMesh(GenMeshCube(1, 1, 1));
    metalModel = LoadModelFromMesh(GenMeshCube(1, 1, 1));
    floorLowModel = LoadModelFromMesh(GenMeshCube(1, 1, 1));
    metalLowModel = LoadModelFromMesh(GenMeshCube(1, 1, 1));
    barrelModel = LoadModel((base / "assets" / "models" / "barrel_03" / "barrel_03_1k.gltf").string().c_str());
    generatorModel = LoadModel((base / "assets" / "models" / "portable_generator" / "portable_generator_1k.gltf").string().c_str());
    cartModel = LoadModel((base / "assets" / "models" / "industrial_storage_cart" / "industrial_storage_cart_1k.gltf").string().c_str());
    rackModel = LoadModel((base / "assets" / "models" / "worn_metal_rack" / "worn_metal_rack_1k.gltf").string().c_str());
    searchlightModel = LoadModel((base / "assets" / "models" / "portable_searchlight" / "portable_searchlight_1k.gltf").string().c_str());
    hangingLightModel = LoadModel((base / "assets" / "models" / "caged_hanging_light" / "caged_hanging_light_1k.gltf").string().c_str());
    SetMaterialTexture(&floorModel.materials[0], MATERIAL_MAP_ALBEDO, floorTexture);
    SetMaterialTexture(&metalModel.materials[0], MATERIAL_MAP_ALBEDO, metalTexture);
    SetMaterialTexture(&floorLowModel.materials[0], MATERIAL_MAP_ALBEDO, floorLowTexture);
    SetMaterialTexture(&metalLowModel.materials[0], MATERIAL_MAP_ALBEDO, metalLowTexture);
    floorModel.materials[0].maps[MATERIAL_MAP_ALBEDO].color = WHITE;
    metalModel.materials[0].maps[MATERIAL_MAP_ALBEDO].color = WHITE;
    floorLowModel.materials[0].maps[MATERIAL_MAP_ALBEDO].color = WHITE;
    metalLowModel.materials[0].maps[MATERIAL_MAP_ALBEDO].color = WHITE;
    Shader facility = LoadShader((base / "assets" / "facility.vs").string().c_str(),
                                 (base / "assets" / "facility.fs").string().c_str());
    Shader atmosphere = LoadShader(nullptr, (base / "assets" / "atmosphere.fs").string().c_str());
    RenderTexture2D worldTargetFull = LoadRenderTexture(WIDTH, HEIGHT);
    RenderTexture2D worldTargetLow = LoadRenderTexture(720, 450);
    SetTextureFilter(worldTargetLow.texture, TEXTURE_FILTER_BILINEAR);
    RenderTexture2D shadowMap = loadShadowMap();
    int lampLoc = GetShaderLocation(facility, "lightPos");
    int tintLoc = GetShaderLocation(facility, "lightTint");
    int secondLoc = GetShaderLocation(facility, "secondaryPos");
    int secondTintLoc = GetShaderLocation(facility, "secondaryTint");
    int viewLoc = GetShaderLocation(facility, "viewPos");
    int timeLoc = GetShaderLocation(facility, "worldTime");
    int lightDirLoc = GetShaderLocation(facility, "lightDir");
    int lightVPLoc = GetShaderLocation(facility, "lightVP");
    int shadowMapLoc = GetShaderLocation(facility, "shadowMap");
    int shadowResolutionLoc = GetShaderLocation(facility, "shadowMapResolution");
    int shadowEnabledLoc = GetShaderLocation(facility, "shadowEnabled");
    int shadowSlot = 10;
    int shadowResolution = SHADOW_RESOLUTION;
    Vector3 lightDirection = Vector3Normalize({0.55f, -0.86f, -0.25f});
    SetShaderValue(facility, lightDirLoc, &lightDirection, SHADER_UNIFORM_VEC3);
    SetShaderValue(facility, shadowResolutionLoc, &shadowResolution, SHADER_UNIFORM_INT);
    int postTimeLoc = GetShaderLocation(atmosphere, "worldTime");
    int postResolutionLoc = GetShaderLocation(atmosphere, "resolution");
    float resolution[2] = {float(WIDTH), float(HEIGHT)};
    if (atmosphere.id != 0) SetShaderValue(atmosphere, postResolutionLoc, resolution, SHADER_UNIFORM_VEC2);

    Net net;
    if (const char* user = std::getenv("USER")) net.name = user;
    const std::string host = std::getenv("RELAY_HOST") ? std::getenv("RELAY_HOST") : "127.0.0.1";
    const std::string port = std::getenv("RELAY_PORT") ? std::getenv("RELAY_PORT") : "34320";
    const fs::path save = (std::getenv("HOME") ? fs::path(std::getenv("HOME")) : base) / ".dead_relay_session";
    bool online = net.connect_to(host, port, save);
    std::vector<std::string> journal;
    journal.push_back("Ревизия установки открыта. ALICE наблюдает.");
    journal.push_back("Токен сеанса сохранён в ~/.dead_relay_session.");
    if (!online) journal.push_back("Сервер недоступен. Нажмите R для переподключения.");
    int phase = std::clamp(net.phase, 0, 7);
    if (!online) {
        if (const char* preview = std::getenv("RELAY_PREVIEW_PHASE")) phase = std::clamp(std::atoi(preview), 0, 7);
    }
    Vector3 player{0, 0, 6};
    float yaw = 0.20f, pitch = 0.40f, distance = 10.8f;
    if (const char* value = std::getenv("RELAY_CAMERA_PITCH")) pitch = std::atof(value);
    if (const char* value = std::getenv("RELAY_CAMERA_DISTANCE")) distance = std::atof(value);
    if (const char* value = std::getenv("RELAY_CAMERA_YAW")) yaw = std::atof(value);
    bool terminal = false, diagnostics = false;
    std::string typed, message;
    float message_until = 0;
    double board_at = 0;
    double position_at = 0;
    double peers_at = 0;
    float capture_delay = std::getenv("RELAY_CAPTURE_DELAY") ? std::atof(std::getenv("RELAY_CAPTURE_DELAY")) : 2.0f;
    const char* record_dir = std::getenv("RELAY_RECORD_DIR");
    float record_until = std::getenv("RELAY_RECORD_SECONDS") ? std::atof(std::getenv("RELAY_RECORD_SECONDS")) : 5.0f;
    float next_record_frame = 0;
    int recorded_frames = 0;
    float benchmark_seconds = std::getenv("RELAY_BENCH_SECONDS") ? std::atof(std::getenv("RELAY_BENCH_SECONDS")) : 0.0f;
    int benchmark_frames = 0;
    double benchmark_start = GetTime();

    while (!WindowShouldClose()) {
        float dt = std::min(GetFrameTime(), 0.05f);
        float t = float(GetTime());
        if (IsKeyPressed(KEY_R)) {
            online = net.connect_to(host, port, save);
            journal.push_back(online ? "Связь восстановлена." : "Связь недоступна.");
            phase = std::clamp(net.phase, 0, 7);
        }
        if (IsKeyPressed(KEY_F2)) diagnostics = !diagnostics;
        if (IsKeyPressed(KEY_F3)) highGraphics = !highGraphics;
        bool opened_terminal = false;
        if (IsKeyPressed(KEY_T) && !terminal) { terminal = true; opened_terminal = true; typed = DISTRICTS[phase].action; }
        if (IsKeyPressed(KEY_E) && !terminal) {
            if (Vector3Distance(player, {0, 0, 0}) < 5.0f) { terminal = true; opened_terminal = true; typed = DISTRICTS[phase].action; }
            else if (Vector3Distance(player, {-8, 0, 4}) < 4.0f) { message = DISTRICTS[phase].npc; message_until = t + 9; }
            else if (Vector3Distance(player, {-8, 0, -3}) < 3.4f) { message = AUDIT_NOTES[phase]; message_until = t + 10; }
            else if (Vector3Distance(player, {8, 0, -3}) < 3.4f) { message = SERVICE_NOTES[phase]; message_until = t + 10; }
            else { message = "Поблизости нет поста. Терминал находится в центре участка."; message_until = t + 4; }
        }
        float movement = 0;
        if (terminal) {
            int ch;
            while ((ch = GetCharPressed()) != 0)
                if (!opened_terminal && ch >= 32 && ch < 127 && typed.size() < 180) typed += char(ch);
            if (IsKeyPressed(KEY_BACKSPACE) && !typed.empty()) typed.pop_back();
            if (IsKeyPressed(KEY_ESCAPE)) terminal = false;
            if (IsKeyPressed(KEY_ENTER)) {
                std::string response = net.exchange("ACT " + typed);
                journal.push_back("> " + typed);
                journal.push_back(response);
                if (journal.size() > 40) journal.erase(journal.begin(), journal.begin() + 10);
                std::vector<std::string> fields; std::istringstream stream(response); std::string field;
                while (std::getline(stream, field, '|')) fields.push_back(field);
                if (fields.size() >= 4 && fields[0] == "OK") {
                    net.phase = std::stoi(fields[1]); net.credits = std::stoull(fields[2]);
                    phase = std::clamp(net.phase, 0, 7);
                    player = {0, 0, 6};
                    message = fields[3]; message_until = t + 7;
                    terminal = false;
                } else if (fields.size() >= 2 && fields[0] == "FLAG") {
                    if (fields.size() >= 3) journal.push_back("УЛИКА: " + fields[2]);
                    message = "РЕВИЗИЯ ЗАВЕРШЕНА / ФЛАГ В ТЕРМИНАЛЕ"; message_until = t + 60;
                } else if (fields.size() >= 2) { message = fields[1]; message_until = t + 5; }
                typed = DISTRICTS[phase].action;
            }
        } else {
            float forward = float(IsKeyDown(KEY_W) || IsKeyDown(KEY_UP)) - float(IsKeyDown(KEY_S) || IsKeyDown(KEY_DOWN));
            float right = float(IsKeyDown(KEY_D) || IsKeyDown(KEY_RIGHT)) - float(IsKeyDown(KEY_A) || IsKeyDown(KEY_LEFT));
            Vector3 move{right * cosf(yaw) - forward * sinf(yaw), 0, right * sinf(yaw) + forward * cosf(yaw)};
            movement = std::min(Vector3Length(move), 1.0f);
            if (movement > 0) player = Vector3Add(player, Vector3Scale(Vector3Normalize(move), dt * (IsKeyDown(KEY_LEFT_SHIFT) ? 8.0f : 5.1f)));
            player.x = std::clamp(player.x, -10.0f, 10.0f);
            player.z = std::clamp(player.z, -10.0f, 10.0f);
        }
        if (IsMouseButtonDown(MOUSE_BUTTON_RIGHT)) {
            Vector2 delta = GetMouseDelta();
            yaw += delta.x * 0.004f;
            pitch = std::clamp(pitch - delta.y * 0.003f, 0.22f, 0.85f);
        }
        distance = std::clamp(distance - GetMouseWheelMove() * 0.8f, 7.0f, 11.4f);
        Camera3D camera{};
        camera.target = {player.x, 1.4f, player.z};
        camera.position = {player.x + distance * cosf(pitch) * sinf(yaw),
                           1.4f + distance * sinf(pitch),
                           player.z + distance * cosf(pitch) * cosf(yaw)};
        camera.up = {0, 1, 0}; camera.fovy = 55; camera.projection = CAMERA_PERSPECTIVE;
        if (net.connected() && GetTime() > board_at) {
            std::string response = net.exchange("BOARD");
            if (response.rfind("BOARD", 0) == 0) net.board = response.size() > 6 ? response.substr(6) : "Других сигналов нет.";
            board_at = GetTime() + 7;
        }
        if (net.connected() && net.phase < 8 && GetTime() > position_at) {
            std::ostringstream position;
            position << "POS " << net.phase << " " << player.x << " " << player.z;
            net.exchange(position.str());
            position_at = GetTime() + 0.8;
        }
        if (net.connected() && GetTime() > peers_at) {
            net.refresh_peers();
            peers_at = GetTime() + 2.0;
        }
        if (t > message_until) message.clear();

        const District& d = DISTRICTS[phase];
        Camera3D lightCamera{};
        lightCamera.position = Vector3Scale(lightDirection, -29.0f);
        lightCamera.target = {0, 1, 0};
        lightCamera.up = {0, 1, 0};
        lightCamera.fovy = 50;
        lightCamera.projection = CAMERA_ORTHOGRAPHIC;
        Matrix lightView{};
        Matrix lightProjection{};
        int useShadows = highGraphics && shadowMap.id != 0;
        SetShaderValue(facility, shadowEnabledLoc, &useShadows, SHADER_UNIFORM_INT);
        if (useShadows) {
            BeginTextureMode(shadowMap);
            ClearBackground(WHITE);
            BeginMode3D(lightCamera);
            lightView = rlGetMatrixModelview();
            lightProjection = rlGetMatrixProjection();
            drawWorld(d, phase, t, player, yaw, movement, net.peers);
            EndMode3D();
            EndTextureMode();
            Matrix lightVP = MatrixMultiply(lightView, lightProjection);
            SetShaderValueMatrix(facility, lightVPLoc, lightVP);
            rlEnableShader(facility.id);
            rlActiveTextureSlot(shadowSlot);
            rlEnableTexture(shadowMap.depth.id);
            rlSetUniform(shadowMapLoc, &shadowSlot, SHADER_UNIFORM_INT, 1);
        }
        RenderTexture2D& worldTarget = highGraphics ? worldTargetFull : worldTargetLow;
        BeginTextureMode(worldTarget);
        ClearBackground({15, 23, 27, 255});
        BeginMode3D(camera);
        float lamp[3] = {0.0f, 6.0f, -1.0f};
        float lampColor[3] = {d.accent.r / 255.0f * 0.8f, d.accent.g / 255.0f * 0.8f, d.accent.b / 255.0f * 0.8f};
        float secondary[3] = {phase == 4 ? -11.0f : 10.0f, phase == 4 ? 6.0f : 5.0f, phase == 4 ? -10.0f : 7.0f};
        float secondaryColor[3] = {phase == 4 ? 0.96f : 0.35f, phase == 4 ? 0.35f : 0.76f, phase == 4 ? 0.12f : 0.86f};
        float eye[3] = {camera.position.x, camera.position.y, camera.position.z};
        if (highGraphics && facility.id != 0) {
            SetShaderValue(facility, lampLoc, lamp, SHADER_UNIFORM_VEC3);
            SetShaderValue(facility, tintLoc, lampColor, SHADER_UNIFORM_VEC3);
            SetShaderValue(facility, secondLoc, secondary, SHADER_UNIFORM_VEC3);
            SetShaderValue(facility, secondTintLoc, secondaryColor, SHADER_UNIFORM_VEC3);
            SetShaderValue(facility, viewLoc, eye, SHADER_UNIFORM_VEC3);
            SetShaderValue(facility, timeLoc, &t, SHADER_UNIFORM_FLOAT);
            BeginShaderMode(facility);
        }
        drawWorld(d, phase, t, player, yaw, movement, net.peers);
        if (highGraphics && facility.id != 0) EndShaderMode();
        EndMode3D();
        EndTextureMode();

        BeginDrawing();
        ClearBackground(INK);
        BeginScissorMode(0, 77, 1059, HEIGHT - 77);
        if (highGraphics && atmosphere.id != 0) {
            SetShaderValue(atmosphere, postTimeLoc, &t, SHADER_UNIFORM_FLOAT);
            BeginShaderMode(atmosphere);
        }
        DrawTexturePro(worldTarget.texture,
                       {0, 0, float(worldTarget.texture.width), -float(worldTarget.texture.height)},
                       {0, 0, float(WIDTH), float(HEIGHT)}, {0, 0}, 0, WHITE);
        if (highGraphics && atmosphere.id != 0) EndShaderMode();
        EndScissorMode();
        Vector2 prompt = GetWorldToScreen({0, 3.4f, -1}, camera);
        if (prompt.x > 0 && prompt.x < 1020 && prompt.y > 85 && prompt.y < 570) {
            DrawRectangle(int(prompt.x) - 76, int(prompt.y) - 20, 152, 31, INK);
            DrawRectangleLines(int(prompt.x) - 76, int(prompt.y) - 20, 152, 31, d.accent);
            label(font, "E / ПУЛЬТ", int(prompt.x) - 57, int(prompt.y) - 14, 14, d.accent);
        }
        for (const auto& peer : net.peers) {
            Vector2 above = GetWorldToScreen({peer.x, 2.8f, peer.z}, camera);
            if (above.x > 10 && above.x < 990 && above.y > 85 && above.y < 565) {
                DrawRectangle(int(above.x) - 48, int(above.y) - 14, 96, 22, INK);
                label(font, clipped("В СЕТИ/" + peer.name, 12), int(above.x) - 42, int(above.y) - 11, 12, CYAN);
            }
        }
        hud(font, net, phase, journal, typed, terminal, message, diagnostics, rom, player, t);
        EndDrawing();
        ++benchmark_frames;
        if (benchmark_seconds > 0 && GetTime() - benchmark_start >= benchmark_seconds) {
            std::cerr << "RELAY_FPS " << benchmark_frames / (GetTime() - benchmark_start) << '\n';
            break;
        }
        if (record_dir && GetTime() >= next_record_frame) {
            fs::create_directories(record_dir);
            std::ostringstream path;
            path << record_dir << "/frame-" << std::setfill('0') << std::setw(3) << recorded_frames++ << ".png";
            TakeScreenshot(path.str().c_str());
            next_record_frame = GetTime() + 0.20f;
            if (GetTime() >= record_until) break;
        }
        if (const char* capture = std::getenv("RELAY_CAPTURE")) {
            if (GetTime() > capture_delay) { TakeScreenshot(capture); break; }
        }
    }
    if (font.texture.id != GetFontDefault().texture.id) UnloadFont(font);
    UnloadModel(floorModel);
    UnloadModel(metalModel);
    UnloadModel(floorLowModel);
    UnloadModel(metalLowModel);
    if (barrelModel.meshCount) UnloadModel(barrelModel);
    if (generatorModel.meshCount) UnloadModel(generatorModel);
    if (cartModel.meshCount) UnloadModel(cartModel);
    if (rackModel.meshCount) UnloadModel(rackModel);
    if (searchlightModel.meshCount) UnloadModel(searchlightModel);
    if (hangingLightModel.meshCount) UnloadModel(hangingLightModel);
    if (facility.id != 0) UnloadShader(facility);
    if (atmosphere.id != 0) UnloadShader(atmosphere);
    UnloadRenderTexture(worldTargetFull);
    UnloadRenderTexture(worldTargetLow);
    if (shadowMap.id != 0) rlUnloadFramebuffer(shadowMap.id);
    CloseWindow();
}
