#include "archive_backend.h"
#include "archive_entry_utils.h"

#include <nlohmann/json.hpp>

#include <cerrno>
#include <csignal>
#include <cstdio>
#include <filesystem>
#include <fstream>
#include <stdexcept>
#include <string>
#include <system_error>
#include <vector>

#ifndef _WIN32
#include <limits.h>
#include <poll.h>
#include <sys/wait.h>
#include <unistd.h>
#endif

namespace fs = std::filesystem;
using json = nlohmann::json;

namespace {

struct HelperProcess {
#ifndef _WIN32
    pid_t pid = -1;
    int stdoutFd = -1;
    int stderrFd = -1;
#endif
};

std::string trimLine(std::string line) {
    while (!line.empty() && (line.back() == '\r' || line.back() == '\n')) {
        line.pop_back();
    }
    return line;
}

#ifndef _WIN32
std::string currentExecutablePath() {
    char buffer[PATH_MAX];
    const ssize_t length = ::readlink("/proc/self/exe", buffer, sizeof(buffer) - 1);
    if (length <= 0) {
        throw std::runtime_error("Unable to resolve /proc/self/exe");
    }
    buffer[length] = '\0';
    return std::string(buffer);
}

fs::path findAncestorNamed(fs::path current, const std::string& name) {
    while (!current.empty()) {
        if (current.filename() == name) return current;
        current = current.parent_path();
    }
    return {};
}

fs::path findAceHelperBinary() {
    if (const char* envPath = std::getenv("COMISCOPIO_ACE_HELPER_BINARY")) {
        fs::path envBinary(envPath);
        if (fs::exists(envBinary)) return envBinary;
    }

    const fs::path selfPath(currentExecutablePath());
    const fs::path selfDir = selfPath.parent_path();
    const fs::path nativeDir = findAncestorNamed(selfDir, "native");

    std::vector<fs::path> candidates = {
        selfDir / "comiscopio-ace-helper",
    };

    if (!nativeDir.empty()) {
        candidates.push_back(nativeDir / "vendor" / "linux-x64" / "bin" / "comiscopio-ace-helper");
        candidates.push_back(nativeDir / "ace-helper" / "build" / "comiscopio-ace-helper");
        candidates.push_back(nativeDir / "ace-helper" / "build-debug" / "comiscopio-ace-helper");
        candidates.push_back(nativeDir / "ace-helper" / "build-release" / "comiscopio-ace-helper");
    }

    for (const auto& candidate : candidates) {
        if (fs::exists(candidate)) return candidate;
    }

    throw std::runtime_error("ACE helper binary not found");
}

HelperProcess spawnHelper(const fs::path& executable, const std::vector<std::string>& args) {
    int stdoutPipe[2];
    int stderrPipe[2];
    if (pipe(stdoutPipe) != 0 || pipe(stderrPipe) != 0) {
        throw std::runtime_error("Failed to create ACE helper pipes");
    }

    const pid_t pid = fork();
    if (pid < 0) {
        close(stdoutPipe[0]);
        close(stdoutPipe[1]);
        close(stderrPipe[0]);
        close(stderrPipe[1]);
        throw std::runtime_error("Failed to spawn ACE helper");
    }

    if (pid == 0) {
        setpgid(0, 0);
        dup2(stdoutPipe[1], STDOUT_FILENO);
        dup2(stderrPipe[1], STDERR_FILENO);

        close(stdoutPipe[0]);
        close(stdoutPipe[1]);
        close(stderrPipe[0]);
        close(stderrPipe[1]);

        std::vector<char*> argv;
        argv.reserve(args.size() + 2);
        argv.push_back(const_cast<char*>(executable.c_str()));
        for (const auto& arg : args) {
            argv.push_back(const_cast<char*>(arg.c_str()));
        }
        argv.push_back(nullptr);

        execv(executable.c_str(), argv.data());
        _exit(127);
    }

    setpgid(pid, pid);
    close(stdoutPipe[1]);
    close(stderrPipe[1]);

    HelperProcess process;
    process.pid = pid;
    process.stdoutFd = stdoutPipe[0];
    process.stderrFd = stderrPipe[0];
    return process;
}

void killHelperProcess(const HelperProcess& process) {
    if (process.pid > 0) {
        kill(-process.pid, SIGTERM);
    }
}

std::string readAvailable(int fd, bool& closed) {
    std::string out;
    char buffer[4096];
    while (true) {
        const ssize_t bytesRead = ::read(fd, buffer, sizeof(buffer));
        if (bytesRead > 0) {
            out.append(buffer, static_cast<std::size_t>(bytesRead));
            if (bytesRead < static_cast<ssize_t>(sizeof(buffer))) {
                break;
            }
            continue;
        }
        if (bytesRead == 0) {
            closed = true;
        }
        break;
    }
    return out;
}
#endif

}  // namespace

class AceBackend : public ArchiveBackend {
public:
    int open(const std::string& archivePath, const std::string& rawDir,
             ProgressCb progressCb, void* userData) override {
#ifdef _WIN32
        throw std::runtime_error("ACE backend is not supported on Windows");
#else
        this->rawDir = rawDir;
        entries.clear();
        fs::create_directories(rawDir);

        auto* cancelContext = reinterpret_cast<ArchiveCancelContext*>(userData);
        cancelFlag = cancelContext ? cancelContext->flag : nullptr;

        const fs::path helperBinary = findAceHelperBinary();
        HelperProcess process = spawnHelper(helperBinary, {
            "--input", archivePath,
            "--output", rawDir,
            "--mode", "extract-all",
        });

        std::string stdoutBuffer;
        std::string stderrBuffer;
        std::string lastError;
        bool stdoutClosed = false;
        bool stderrClosed = false;
        bool helperExited = false;
        bool done = false;
        int helperStatus = 0;

        auto processStdoutLine = [&](const std::string& line) {
            if (line.empty()) return;

            json event;
            try {
                event = json::parse(line);
            } catch (...) {
                return;
            }

            const std::string type = event.value("type", "");
            if (type == "extracting") {
                if (progressCb) {
                    progressCb(
                        event.value("current", 0),
                        event.value("total", -1),
                        event.value("name", std::string{}),
                        userData);
                }
            } else if (type == "entry") {
                const std::string rawFile = event.value("rawFile", std::string{});
                entries.push_back({
                    event.value("name", std::string{}),
                    event.value("name", std::string{}),
                    rawFile.empty() ? std::string{} : (this->rawDir + "/" + rawFile),
                });
            } else if (type == "error") {
                lastError = event.value("message", std::string("ACE helper failed"));
            } else if (type == "done") {
                done = true;
            }
        };

        while (!(helperExited && stdoutClosed && stderrClosed)) {
            if (cancelFlag && *cancelFlag != 0) {
                killHelperProcess(process);
                waitpid(process.pid, &helperStatus, 0);
                ::close(process.stdoutFd);
                ::close(process.stderrFd);
                cancelFlag = nullptr;
                throw std::runtime_error("ACE extraction cancelled");
            }

            struct pollfd fds[2];
            fds[0].fd = process.stdoutFd;
            fds[0].events = stdoutClosed ? 0 : (POLLIN | POLLHUP);
            fds[0].revents = 0;
            fds[1].fd = process.stderrFd;
            fds[1].events = stderrClosed ? 0 : (POLLIN | POLLHUP);
            fds[1].revents = 0;

            const int pollResult = poll(fds, 2, 100);
            if (pollResult > 0) {
                if (!stdoutClosed && (fds[0].revents & (POLLIN | POLLHUP))) {
                    bool justClosed = false;
                    stdoutBuffer += readAvailable(process.stdoutFd, justClosed);
                    if (justClosed) {
                        ::close(process.stdoutFd);
                        stdoutClosed = true;
                    }
                    std::size_t pos = 0;
                    while ((pos = stdoutBuffer.find('\n')) != std::string::npos) {
                        const std::string line = trimLine(stdoutBuffer.substr(0, pos));
                        stdoutBuffer.erase(0, pos + 1);
                        processStdoutLine(line);
                    }
                }

                if (!stderrClosed && (fds[1].revents & (POLLIN | POLLHUP))) {
                    bool justClosed = false;
                    stderrBuffer += readAvailable(process.stderrFd, justClosed);
                    if (justClosed) {
                        ::close(process.stderrFd);
                        stderrClosed = true;
                    }
                }
            }

            if (!helperExited) {
                const pid_t waitResult = waitpid(process.pid, &helperStatus, WNOHANG);
                if (waitResult == process.pid) {
                    helperExited = true;
                }
            }
        }

        cancelFlag = nullptr;

        if (!stdoutBuffer.empty()) {
            processStdoutLine(trimLine(stdoutBuffer));
        }

        if (!helperExited) {
            waitpid(process.pid, &helperStatus, 0);
        }

        const bool exitedOk = WIFEXITED(helperStatus) && WEXITSTATUS(helperStatus) == 0;
        if (!exitedOk) {
            if (lastError.empty()) {
                lastError = !stderrBuffer.empty() ? trimLine(stderrBuffer) : "ACE helper exited with error";
            }
            throw std::runtime_error(lastError);
        }

        if (!done) {
            throw std::runtime_error("ACE helper ended without completion event");
        }

        return static_cast<int>(entries.size());
#endif
    }

    bool extractPreview(const std::string&, const std::string&,
                        int, std::string&, std::string&) override {
        return false;
    }

    int entryCount() const override {
        return static_cast<int>(entries.size());
    }

    std::string entryName(int index) const override {
        if (index < 0 || index >= static_cast<int>(entries.size())) return "";
        return entries[index].archivePath;
    }

    bool getEntry(int index, std::vector<uint8_t>& outData) const override {
        if (index < 0 || index >= static_cast<int>(entries.size())) return false;

        const auto& entry = entries[index];
        if (entry.rawPath.empty() || !fs::exists(entry.rawPath)) return false;

        const auto fileSize = fs::file_size(entry.rawPath);
        outData.resize(fileSize);
        std::ifstream in(entry.rawPath, std::ios::binary);
        if (!in) return false;
        in.read(reinterpret_cast<char*>(outData.data()), static_cast<std::streamsize>(fileSize));
        return true;
    }

    void close() override {
        entries.clear();
        cancelFlag = nullptr;
    }

private:
    std::string rawDir;
    std::vector<CanonicalArchiveEntry> entries;
    volatile sig_atomic_t* cancelFlag = nullptr;
};

std::unique_ptr<ArchiveBackend> createAceBackend() {
    return std::make_unique<AceBackend>();
}
