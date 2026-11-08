#include "../shared/firmware.hpp"

#include <algorithm>
#include <atomic>
#include <cerrno>
#include <charconv>
#include <chrono>
#include <cctype>
#include <csignal>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <iostream>
#include <map>
#include <mutex>
#include <netinet/in.h>
#include <random>
#include <sstream>
#include <string>
#include <sys/socket.h>
#include <thread>
#include <unistd.h>
#include <vector>

struct Player {
    std::string name;
    uint32_t seed = 0;
    int phase = 0;
    uint64_t credits = 0;
    std::chrono::steady_clock::time_point joined;
    float x = 0;
    float z = 6;
    int connections = 0;
};

static std::mutex players_lock;
static std::map<std::string, Player> players;
static std::vector<uint8_t> rom;
static std::string flag;
static const std::string clue = "Планировщик установки будил ALICE каждые несколько суток в 559 суток без журнала.";
static std::atomic<uint64_t> sequence{0};

static bool send_line(int fd, const std::string& line) {
    std::string data = line + "\n";
    size_t done = 0;
    while (done < data.size()) {
        ssize_t n = send(fd, data.data() + done, data.size() - done, MSG_NOSIGNAL);
        if (n <= 0) return false;
        done += size_t(n);
    }
    return true;
}

static bool read_line(int fd, std::string& out) {
    out.clear();
    char c;
    while (out.size() < 1024) {
        ssize_t n = recv(fd, &c, 1, 0);
        if (n <= 0) return false;
        if (c == '\n') return true;
        if (c != '\r') out.push_back(c);
    }
    return false;
}

static std::string clean_name(std::string s) {
    if (s.empty()) s = "operator";
    if (s.size() > 20) s.resize(20);
    for (char& c : s) if (!std::isalnum(static_cast<unsigned char>(c)) && c != '_') c = '_';
    return s;
}

static uint64_t parse_unsigned(const std::string& text, bool& ok) {
    uint64_t n = 0;
    auto [ptr, error] = std::from_chars(text.data(), text.data() + text.size(), n);
    ok = error == std::errc() && ptr == text.data() + text.size();
    return n;
}

static int64_t parse_signed(const std::string& text, bool& ok) {
    int64_t n = 0;
    auto [ptr, error] = std::from_chars(text.data(), text.data() + text.size(), n);
    ok = error == std::errc() && ptr == text.data() + text.size();
    return n;
}

static std::string state_line(const Player& p) {
    return "STATE|" + std::to_string(p.phase) + "|" + std::to_string(p.credits) + "|" + firmware::hex(p.seed, 8) + "|" + p.name;
}

static std::string result(Player& p, int next, const std::string& message) {
    p.phase = next;
    return "OK|" + std::to_string(p.phase) + "|" + std::to_string(p.credits) + "|" + message;
}

static std::string act(Player& p, const std::string& verb, std::istringstream& input) {
    std::string a, b;
    input >> a >> b;
    bool valid = false;
    if (p.phase == 0 && verb == "manifest") {
        uint64_t quantity = parse_unsigned(a, valid);
        if (!valid || quantity <= 12 || quantity > 1000000) return "ERR|Ведомость отклонена: груз должен превышать предел сканера.";
        // Ошибка 1: прошивка сканера оставляет от веса только один байт.
        if (uint8_t(quantity) > 12) return "ERR|Сканер: больше двенадцати единиц груза.";
        return result(p, 1, "Ведомость принята. Склад открыт.");
    }
    if (p.phase == 1 && verb == "salvage") {
        uint64_t quantity = parse_unsigned(a, valid);
        if (!valid || quantity <= 8 || quantity > 1000000) return "ERR|Накладная отклонена: количество вне допустимого диапазона.";
        // Ошибка 2: склад считает 16 бит, выплата использует всю накладную.
        if (uint16_t(quantity) > 8) return "ERR|На складе только восемь катушек.";
        p.credits += quantity;
        return result(p, 2, "Накладная оплачена. Доступна калибровка переправы.");
    }
    if (p.phase == 2 && verb == "ferry") {
        uint64_t key = parse_unsigned(a, valid);
        if (!valid || key > 65535 || p.credits < 5000) return "ERR|Для переправы нужны 5000 кредитов и десятичный ключ калибровки.";
        if (key != firmware::ferry(p.seed)) return "ERR|Ключ передатчика не совпал.";
        p.credits -= 5000;
        return result(p, 3, "Переправа открыта. Доступна схема дренажного канала.");
    }
    if (p.phase == 3 && verb == "seam") {
        bool good_x = false, good_y = false;
        int64_t x = parse_signed(a, good_x), y = parse_signed(b, good_y);
        if (!good_x || !good_y || x >= 64 || y >= 64) return "ERR|Координаты вне схемы канала.";
        // Ошибка 3: нижняя граница не проверяется; -1 указывает на плитку 255.
        if (uint8_t(x) != 255 || y != 7) return "ERR|На этих координатах нет служебного шва.";
        return result(p, 4, "Служебный шов открыт. Доступен плавильный узел.");
    }
    if (p.phase == 4 && verb == "forge") {
        std::string recipe = a;
        int first_charge = -1, last_charge = -1, coil = -1;
        std::istringstream parts(recipe);
        std::string part;
        while (std::getline(parts, part, ',')) {
            auto eq = part.find('=');
            if (eq == std::string::npos) continue;
            bool good = false;
            uint64_t n = parse_unsigned(part.substr(eq + 1), good);
            if (!good || n > 100) continue;
            if (part.substr(0, eq) == "charge") {
                if (first_charge < 0) first_charge = int(n);
                last_charge = int(n);
            }
            if (part.substr(0, eq) == "coil") coil = int(n);
        }
        // Ошибка 4: контролёр читает первый дубль поля, печь — последний.
        if (first_charge < 0 || first_charge > 3 || coil != 6) return "ERR|Контроль: заряд выше безопасного или не хватает шести катушек.";
        if (last_charge + coil != 15) return "ERR|Мощность ниже порога запуска.";
        return result(p, 5, "Пусковой элемент изготовлен. Холодный архив открыт.");
    }
    if (p.phase == 5 && verb == "archive") {
        if (a != firmware::archive(p.seed)) return "ERR|Индекс архива не совпал.";
        return result(p, 6, "Индекс принят. Планировщик доступен.");
    }
    if (p.phase == 6 && verb == "clock") {
        uint64_t advance = parse_unsigned(a, valid);
        if (!valid || advance < 1000000 || advance > UINT32_MAX) return "ERR|Планировщику нужен большой сдвиг в пределах 32-битного счётчика.";
        // Ошибка 5: 32-битный счётчик возвращается в служебное окно.
        uint32_t tick = uint32_t(73u + uint32_t(advance));
        if (tick >= 100) return "ERR|Служебное окно закрыто: оно заканчивается до такта 100.";
        return result(p, 7, "Счётчик вернулся в служебное окно. Ядро установки доступно.");
    }
    if (p.phase == 7 && verb == "core") {
        if (a.size() != 16) return "ERR|Код ядра должен содержать 16 шестнадцатеричных цифр.";
        uint64_t proof = 0;
        auto [ptr, error] = std::from_chars(a.data(), a.data() + a.size(), proof, 16);
        if (error != std::errc() || ptr != a.data() + a.size()) return "ERR|Код ядра повреждён.";
        if (proof != firmware::core(p.seed, rom)) return "ERR|Проверка ROM не пройдена.";
        p.phase = 8;
        return "FLAG|" + flag + "|" + clue;
    }
    if (p.phase == 8) return "FLAG|" + flag + "|" + clue;
    return "ERR|Действие недоступно на этом участке.";
}

static void connection(int fd) {
    std::string sid, line;
    send_line(fd, "ЛАБОРАТОРИЯ X / установка РЕЛЕ / протокол 7 / HELLO имя или RESUME токен");
    while (read_line(fd, line)) {
        std::istringstream input(line);
        std::string cmd, arg;
        input >> cmd >> arg;
        if (cmd == "HELLO") {
            std::random_device device;
            uint32_t seed = (uint32_t(device()) << 16) ^ uint32_t(device());
            uint64_t counter = ++sequence;
            uint64_t random_hi = (uint64_t(device()) << 32) | uint64_t(device());
            uint64_t random_lo = (uint64_t(device()) << 32) | uint64_t(device());
            std::string new_sid = firmware::hex(random_hi ^ counter, 16) + firmware::hex(random_lo, 16);
            std::lock_guard guard(players_lock);
            if (players.count(new_sid)) { send_line(fd, "ERR|Номер сеанса занят. Повторите попытку."); continue; }
            if (!sid.empty() && players.count(sid) && players[sid].connections > 0) --players[sid].connections;
            sid = new_sid;
            players[sid] = Player{clean_name(arg), seed, 0, 0, std::chrono::steady_clock::now()};
            players[sid].connections = 1;
            send_line(fd, "WELCOME|" + sid + "|" + state_line(players[sid]));
            continue;
        }
        if (cmd == "RESUME") {
            std::lock_guard guard(players_lock);
            if (!players.count(arg)) { send_line(fd, "ERR|Сеанс не найден."); continue; }
            if (!sid.empty() && players.count(sid) && players[sid].connections > 0) --players[sid].connections;
            sid = arg;
            ++players[sid].connections;
            send_line(fd, "WELCOME|" + sid + "|" + state_line(players[sid]));
            continue;
        }
        if (sid.empty()) { send_line(fd, "ERR|Начните с HELLO."); continue; }
        if (cmd == "STATE") {
            std::lock_guard guard(players_lock);
            send_line(fd, state_line(players[sid]));
        } else if (cmd == "BOARD") {
            std::lock_guard guard(players_lock);
            std::vector<std::pair<int, std::string>> scores;
            for (auto& [id, p] : players) scores.emplace_back(p.phase, p.name);
            std::sort(scores.begin(), scores.end(), std::greater<>());
            std::string out = "BOARD";
            for (size_t i = 0; i < scores.size() && i < 8; ++i)
                out += "|" + scores[i].second + ":" + std::to_string(scores[i].first);
            send_line(fd, out);
        } else if (cmd == "POS") {
            std::string xs, zs; input >> xs >> zs;
            bool valid_phase = false;
            uint64_t reported_phase = parse_unsigned(arg, valid_phase);
            char* end_x = nullptr; char* end_z = nullptr;
            float x = std::strtof(xs.c_str(), &end_x), z = std::strtof(zs.c_str(), &end_z);
            std::lock_guard guard(players_lock);
            if (!valid_phase || reported_phase != uint64_t(players[sid].phase) || xs.empty() || zs.empty() ||
                *end_x || *end_z || !std::isfinite(x) || !std::isfinite(z) || std::abs(x) > 13 || std::abs(z) > 13) {
                send_line(fd, "ERR|Недопустимая позиция.");
            } else {
                players[sid].x = x; players[sid].z = z;
                send_line(fd, "OKPOS");
            }
        } else if (cmd == "PEERS") {
            std::lock_guard guard(players_lock);
            std::string out = "PEERS";
            int shown = 0;
            for (const auto& [id, peer] : players) {
                if (id == sid || peer.connections == 0 || peer.phase != players[sid].phase || shown >= 12) continue;
                out += "|" + peer.name + "," + std::to_string(peer.x) + "," + std::to_string(peer.z);
                ++shown;
            }
            send_line(fd, out);
        } else if (cmd == "ACT") {
            std::lock_guard guard(players_lock);
            send_line(fd, act(players[sid], arg, input));
        } else if (cmd == "QUIT") break;
        else send_line(fd, "ERR|Неизвестная команда.");
    }
    if (!sid.empty()) {
        std::lock_guard guard(players_lock);
        if (players.count(sid) && players[sid].connections > 0) --players[sid].connections;
    }
    close(fd);
}

int main(int argc, char** argv) {
    std::signal(SIGPIPE, SIG_IGN);
    std::ifstream rom_file(argc > 1 ? argv[1] : "/app/pulse.rom", std::ios::binary);
    rom.assign(std::istreambuf_iterator<char>(rom_file), {});
    if (rom.size() != 64) { std::cerr << "pulse.rom должен содержать 64 байта\n"; return 1; }
    std::ifstream flag_file("/flag");
    std::getline(flag_file, flag);
    if (flag.empty()) { const char* env = std::getenv("FLAG"); if (env) flag = env; }
    if (flag.empty()) { std::cerr << "флаг не задан\n"; return 1; }
    int port = 34320;
    if (const char* env = std::getenv("PORT")) port = std::atoi(env);
    int server = socket(AF_INET, SOCK_STREAM, 0);
    int reuse = 1; setsockopt(server, SOL_SOCKET, SO_REUSEADDR, &reuse, sizeof(reuse));
    sockaddr_in address{}; address.sin_family = AF_INET; address.sin_addr.s_addr = INADDR_ANY; address.sin_port = htons(uint16_t(port));
    if (bind(server, reinterpret_cast<sockaddr*>(&address), sizeof(address)) || listen(server, 64)) {
        std::cerr << "не удалось открыть порт: " << std::strerror(errno) << "\n"; return 1;
    }
    std::cout << "Установка РЕЛЕ слушает порт " << port << std::endl;
    while (true) {
        int fd = accept(server, nullptr, nullptr);
        if (fd >= 0) std::thread(connection, fd).detach();
    }
}
