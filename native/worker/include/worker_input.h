#pragma once
#include <nlohmann/json.hpp>
#include <string>
#include <thread>
#include <chrono>
#ifdef _WIN32
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#include <psapi.h>
#else
#include <poll.h>
#include <unistd.h>
#endif

// Consume complete JSON lines without blocking on partial pipe writes or hiding
// subsequent commands in std::cin's userspace buffer.
inline bool readWorkerCommand(nlohmann::json& command) {
    static std::string pending;
    for (;;) {
        auto end = pending.find('\n');
        if (end != std::string::npos) {
            auto line = pending.substr(0, end);
            pending.erase(0, end + 1);
            auto parsed = nlohmann::json::parse(line, nullptr, false);
            if (!parsed.is_object() || !parsed.contains("type") || !parsed["type"].is_string()) continue;
            if (parsed["type"] == "focus" && (!parsed.contains("page") || !parsed["page"].is_number_integer())) continue;
            command = std::move(parsed);
            return true;
        }
        char bytes[4096];
#ifdef _WIN32
        HANDLE input = GetStdHandle(STD_INPUT_HANDLE);
        DWORD available = 0, count = 0;
        if (GetFileType(input) == FILE_TYPE_PIPE) {
            if (!PeekNamedPipe(input, nullptr, 0, nullptr, &available, nullptr) || available == 0) return false;
        } else if (GetFileType(input) != FILE_TYPE_DISK) return false;
        if (!ReadFile(input, bytes, sizeof(bytes), &count, nullptr) || count == 0) return false;
#else
        pollfd input{STDIN_FILENO, POLLIN, 0};
        if (poll(&input, 1, 0) <= 0 || !(input.revents & POLLIN)) return false;
        const auto count = read(STDIN_FILENO, bytes, sizeof(bytes));
        if (count <= 0) return false;
#endif
        pending.append(bytes, static_cast<size_t>(count));
        if (pending.size() > 65536) pending.clear();
    }
}

inline void waitForWorkerCommand(int milliseconds) {
#ifndef _WIN32
    pollfd input{STDIN_FILENO, POLLIN, 0};
    if (poll(&input, 1, milliseconds) >= 0 && !(input.revents & POLLHUP)) return;
#endif
    // Windows anonymous pipes do not provide poll(); also avoid spinning on EOF.
    std::this_thread::sleep_for(std::chrono::milliseconds(milliseconds));
}
