#pragma once
#ifdef _WIN32
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#include <algorithm>
#include <csignal>
#include <filesystem>
#include <functional>
#include <stdexcept>
#include <string>
#include <vector>

namespace windows_process {
class Handle {
    HANDLE value = nullptr;
public:
    Handle() = default;
    explicit Handle(HANDLE handle) : value(handle) {}
    ~Handle() { reset(); }
    Handle(const Handle&) = delete;
    Handle& operator=(const Handle&) = delete;
    HANDLE get() const { return value; }
    void reset(HANDLE next = nullptr) {
        if (value && value != INVALID_HANDLE_VALUE) CloseHandle(value);
        value = next;
    }
};

inline std::wstring quote(const std::wstring& argument) {
    std::wstring result = L"\"";
    size_t slashes = 0;
    for (wchar_t c : argument) {
        if (c == L'\\') { ++slashes; continue; }
        result.append(c == L'"' ? slashes * 2 + 1 : slashes, L'\\');
        result += c;
        slashes = 0;
    }
    result.append(slashes * 2, L'\\');
    return result + L'"';
}

inline std::filesystem::path executablePath() {
    std::wstring path(32768, L'\0');
    DWORD length = GetModuleFileNameW(nullptr, path.data(), static_cast<DWORD>(path.size()));
    if (!length || length >= path.size()) throw std::runtime_error("Cannot locate worker executable");
    path.resize(length);
    return std::filesystem::path(path);
}

// Keep ACE and its descendants in a job: killing the worker also kills helpers.
inline int capture(const std::filesystem::path& executable, const std::vector<std::string>& args,
                   const std::function<void(const std::string&)>& onOutput,
                   std::string& diagnostics, volatile sig_atomic_t* cancelled) {
    SECURITY_ATTRIBUTES attributes{sizeof(SECURITY_ATTRIBUTES), nullptr, TRUE};
    Handle outputRead, outputWrite, errorRead, errorWrite;
    auto pipe = [&](Handle& read, Handle& write) {
        HANDLE r, w;
        if (!CreatePipe(&r, &w, &attributes, 0)) throw std::runtime_error("Cannot create helper pipe");
        read.reset(r); write.reset(w);
        if (!SetHandleInformation(r, HANDLE_FLAG_INHERIT, 0)) throw std::runtime_error("Cannot protect helper pipe");
    };
    pipe(outputRead, outputWrite); pipe(errorRead, errorWrite);
    Handle input(CreateFileW(L"NUL", GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE, &attributes, OPEN_EXISTING, 0, nullptr));
    if (input.get() == INVALID_HANDLE_VALUE) throw std::runtime_error("Cannot open helper input");
    Handle job(CreateJobObjectW(nullptr, nullptr));
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits{};
    limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    if (!job.get() || !SetInformationJobObject(job.get(), JobObjectExtendedLimitInformation, &limits, sizeof(limits))) {
        throw std::runtime_error("Cannot create helper process job");
    }
    std::wstring command = quote(executable.wstring());
    for (const auto& arg : args) command += L" " + quote(std::filesystem::u8path(arg).wstring());
    STARTUPINFOW startup{};
    startup.cb = sizeof(startup);
    startup.dwFlags = STARTF_USESTDHANDLES;
    startup.hStdInput = input.get(); startup.hStdOutput = outputWrite.get(); startup.hStdError = errorWrite.get();
    PROCESS_INFORMATION info{};
    if (!CreateProcessW(executable.c_str(), command.data(), nullptr, nullptr, TRUE,
                        CREATE_NO_WINDOW | CREATE_SUSPENDED, nullptr, nullptr, &startup, &info)) {
        throw std::runtime_error("Cannot start ACE helper: " + std::to_string(GetLastError()));
    }
    Handle process(info.hProcess), thread(info.hThread);
    if (!AssignProcessToJobObject(job.get(), process.get())) {
        TerminateProcess(process.get(), 1);
        throw std::runtime_error("Cannot assign ACE helper to process job");
    }
    if (ResumeThread(thread.get()) == static_cast<DWORD>(-1)) throw std::runtime_error("Cannot resume ACE helper");
    outputWrite.reset(); errorWrite.reset(); input.reset();
    bool outputClosed = false, errorClosed = false;
    auto drain = [](Handle& pipe, bool& closed, const std::function<void(const std::string&)>& accept) {
        DWORD available = 0;
        if (!PeekNamedPipe(pipe.get(), nullptr, 0, nullptr, &available, nullptr)) { closed = true; return; }
        while (available > 0) {
            char buffer[4096]; DWORD count = 0;
            if (!ReadFile(pipe.get(), buffer, std::min<DWORD>(available, sizeof(buffer)), &count, nullptr) || !count) {
                closed = true; return;
            }
            accept(std::string(buffer, count));
            available -= count;
        }
    };
    for (;;) {
        if (cancelled && *cancelled) throw std::runtime_error("ACE extraction cancelled");
        if (!outputClosed) drain(outputRead, outputClosed, onOutput);
        if (!errorClosed) drain(errorRead, errorClosed, [&](const std::string& chunk) {
            diagnostics += chunk;
            if (diagnostics.size() > 65536) diagnostics.erase(0, diagnostics.size() - 65536);
        });
        if (WaitForSingleObject(process.get(), 0) == WAIT_OBJECT_0 && outputClosed && errorClosed) break;
        Sleep(10);
    }
    DWORD code = 1;
    if (!GetExitCodeProcess(process.get(), &code)) throw std::runtime_error("Cannot read ACE helper status");
    return static_cast<int>(code);
}
} // namespace windows_process
#endif
