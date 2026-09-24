#include "helper_archive_utils.h"
#include "ace_limits.h"

#include <nlohmann/json.hpp>

#include <algorithm>
#include <cerrno>
#include <clocale>
#include <csignal>
#include <cstdio>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <sstream>
#include <string>
#include <system_error>
#include <utility>
#include <vector>

#include <limits.h>
#include <poll.h>
#include <sys/wait.h>
#include <unistd.h>
#ifdef __CYGWIN__
#include <sys/cygwin.h>
#endif

namespace fs = std::filesystem;
using json = nlohmann::json;

namespace {

static volatile sig_atomic_t cancelled = 0;

struct CliArgs {
    std::string input;
    std::string output;
    std::string mode = "extract-all";
};

struct ProcessResult {
    int exitCode = -1;
    std::string output;
};

struct ListedEntry {
    std::string originalPath;
    std::string archivePath;
    uint64_t bytes = 0;
};

void signalHandler(int) {
    cancelled = 1;
}

std::string decoderPath(const std::string& path) {
#ifdef __CYGWIN__
    // Native Windows callers pass drive/UNC paths. The portable MSYS runtime
    // has its own mount prefix; do not assume an installed MSYS2 /c mount.
    if (path.find('\\') != std::string::npos ||
        (path.size() > 1 && path[1] == ':') || path.rfind("//", 0) == 0) {
        const auto size = cygwin_conv_path(CCP_WIN_A_TO_POSIX, path.c_str(), nullptr, 0);
        if (size <= 0) throw std::runtime_error("No se pudo convertir la ruta ACE");
        std::string converted(static_cast<size_t>(size), '\0');
        if (cygwin_conv_path(CCP_WIN_A_TO_POSIX, path.c_str(), converted.data(), converted.size()) != 0)
            throw std::runtime_error("No se pudo convertir la ruta ACE");
        converted.pop_back();
        return converted;
    }
#endif
    return path;
}

std::string trimLine(std::string line) {
    while (!line.empty() && (line.back() == '\r' || line.back() == '\n')) {
        line.pop_back();
    }
    return line;
}

std::string formatIndex(int index) {
    char buf[16];
    std::snprintf(buf, sizeof(buf), "%06d", index);
    return std::string(buf);
}

void emitJson(const json& j) {
    std::cout << j.dump() << '\n';
    std::cout.flush();
}

void emitError(const std::string& message) {
    emitJson(json{
        {"type", "error"},
        {"message", message},
    });
}

bool parseArgs(int argc, char* argv[], CliArgs& args) {
    for (int i = 1; i < argc; i++) {
        const std::string arg = argv[i];
        if (arg == "--input" && i + 1 < argc) args.input = argv[++i];
        else if (arg == "--output" && i + 1 < argc) args.output = argv[++i];
        else if (arg == "--mode" && i + 1 < argc) args.mode = argv[++i];
        else if (arg == "--help" || arg == "-h") return false;
        else return false;
    }
    return !args.input.empty() && !args.output.empty();
}

std::string currentExecutablePath() {
    char buffer[PATH_MAX];
    const ssize_t length = ::readlink("/proc/self/exe", buffer, sizeof(buffer) - 1);
    if (length <= 0) {
        throw std::runtime_error("No se pudo resolver /proc/self/exe");
    }
    buffer[length] = '\0';
    return std::string(buffer);
}

fs::path findBundledUnaceBinary() {
    if (const char* envPath = std::getenv("COMISCOPIO_UNACE_BINARY")) {
        fs::path envBinary(envPath);
        if (fs::exists(envBinary)) return envBinary;
    }

    const fs::path selfPath(currentExecutablePath());
    const fs::path sibling = selfPath.parent_path() / "comiscopio-unace";
    if (fs::exists(sibling)) return sibling;

    throw std::runtime_error("No se encontro comiscopio-unace junto a comiscopio-ace-helper");
}

ProcessResult runProcessCapture(
    const fs::path& executable,
    const std::vector<std::string>& args,
    const std::vector<std::pair<std::string, std::string>>& extraEnv = {},
    size_t maxOutputBytes = 64 * 1024) {
    int pipefd[2];
    if (pipe(pipefd) != 0) {
        throw std::runtime_error("No se pudo crear pipe para proceso hijo");
    }

    const pid_t pid = fork();
    if (pid < 0) {
        close(pipefd[0]);
        close(pipefd[1]);
        throw std::runtime_error("No se pudo crear proceso hijo");
    }

    if (pid == 0) {
        dup2(pipefd[1], STDOUT_FILENO);
        dup2(pipefd[1], STDERR_FILENO);
        close(pipefd[0]);
        close(pipefd[1]);

        for (const auto& [key, value] : extraEnv) {
            setenv(key.c_str(), value.c_str(), 1);
        }

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

    close(pipefd[1]);

    ProcessResult result;
    int status = 0;
    bool reaped = false;
    try {
        while (pipefd[0] >= 0 || !reaped) {
            if (cancelled) throw std::runtime_error("Extraccion ACE cancelada");
            struct pollfd descriptor{pipefd[0], POLLIN | POLLHUP, 0};
            const int ready = poll(&descriptor, 1, 100);
            if (ready < 0 && errno != EINTR) throw std::runtime_error("No se pudo leer la salida del decoder ACE");
            if (ready > 0 && descriptor.revents) {
                char buffer[4096];
                const ssize_t bytesRead = read(pipefd[0], buffer, sizeof(buffer));
                if (bytesRead > 0) {
                    if (static_cast<size_t>(bytesRead) > maxOutputBytes - result.output.size()) {
                        throw std::runtime_error("ACE supera el limite de salida de diagnostico del decoder");
                    }
                    result.output.append(buffer, static_cast<size_t>(bytesRead));
                } else if (bytesRead == 0) {
                    close(pipefd[0]);
                    pipefd[0] = -1;
                } else if (errno != EINTR) throw std::runtime_error("No se pudo leer la salida del decoder ACE");
            }
            if (!reaped) {
                const auto waited = waitpid(pid, &status, WNOHANG);
                if (waited == pid) reaped = true;
                else if (waited < 0 && errno != EINTR) throw std::runtime_error("No se pudo esperar al decoder ACE");
            }
        }
    } catch (...) {
        if (pipefd[0] >= 0) close(pipefd[0]);
        if (!reaped) {
            kill(pid, SIGKILL);
            while (waitpid(pid, &status, 0) < 0 && errno == EINTR) {}
        }
        throw;
    }
    if (WIFEXITED(status)) {
        result.exitCode = WEXITSTATUS(status);
    } else if (WIFSIGNALED(status)) {
        result.exitCode = 128 + WTERMSIG(status);
    }

    return result;
}

void checkDecoderLimit(const ProcessResult& result, const AceLimits& limits) {
    if (result.output.find("COMISCOPIO_LIMIT:") == std::string::npos) return;
    if (result.output.find("COMISCOPIO_LIMIT:entries") != std::string::npos)
        throw std::runtime_error("ACE supera el limite de entradas (" + std::to_string(limits.entries) + ")");
    if (result.output.find("COMISCOPIO_LIMIT:entry_bytes") != std::string::npos)
        throw std::runtime_error("ACE supera el limite por archivo (" + std::to_string(limits.entryBytes) + " bytes)");
    if (result.output.find("COMISCOPIO_LIMIT:total_bytes") != std::string::npos)
        throw std::runtime_error("ACE supera el limite total (" + std::to_string(limits.totalBytes) + " bytes)");
    throw std::runtime_error("ACE supera el presupuesto de escritura o contiene limites no validos");
}

std::string decodeListedName(const std::string& hex) {
    if (hex.empty() || hex.size() >= 640 || hex.size() % 2) throw std::runtime_error("Listado ACE no valido");
    auto digit = [](char c) -> unsigned {
        if (c >= '0' && c <= '9') return c - '0';
        if (c >= 'a' && c <= 'f') return c - 'a' + 10;
        if (c >= 'A' && c <= 'F') return c - 'A' + 10;
        throw std::runtime_error("Listado ACE no valido");
    };
    std::string result;
    for (size_t i = 0; i < hex.size(); i += 2) result += static_cast<char>((digit(hex[i]) << 4) | digit(hex[i + 1]));
    return result;
}

std::vector<ListedEntry> listArchiveEntries(const fs::path& unaceBinary, const std::string& archivePath, const AceLimits& limits) {
    static const std::string kPrefix = "COMISCOPIO_FILE\t";

    ProcessResult result = runProcessCapture(
        unaceBinary,
        {"v", "-y", "-c-", archivePath},
        {{"COMISCOPIO_UNACE_LIST_PREFIX", kPrefix},
         {"COMISCOPIO_UNACE_MAX_ENTRIES", std::to_string(limits.entries)},
         {"COMISCOPIO_UNACE_MAX_ENTRY_BYTES", std::to_string(limits.entryBytes)},
         {"COMISCOPIO_UNACE_MAX_TOTAL_BYTES", std::to_string(limits.totalBytes)}}, 8 * 1024 * 1024);

    checkDecoderLimit(result, limits);
    if (result.exitCode != 0) {
        throw std::runtime_error("unace no pudo listar el archivo ACE");
    }

    std::vector<ListedEntry> entries;
    uint64_t count = 0, total = 0;
    std::istringstream listing(result.output);
    std::string line;
    while (std::getline(listing, line)) {
        line = trimLine(line);
        if (line.rfind(kPrefix, 0) != 0) continue;
        const auto first = line.find('\t', kPrefix.size());
        const auto second = first == std::string::npos ? first : line.find('\t', first + 1);
        if (first == std::string::npos || second == std::string::npos) throw std::runtime_error("Listado ACE no valido");
        const auto bytes = aceUnsigned(line.substr(kPrefix.size(), first - kPrefix.size()));
        const auto directory = line.substr(first + 1, second - first - 1);
        if (directory != "0" && directory != "1") throw std::runtime_error("Listado ACE no valido");
        const std::string originalPath = decodeListedName(line.substr(second + 1));
        limits.add(bytes, count, total); // Count sidecars, junk and directories too.
        if (directory == "1") continue;
        const std::string archivePathNormalized = normalizeArchivePath(originalPath);
        if (!isImageArchiveEntry(archivePathNormalized)) continue;
        // UnACE uses 320-byte path buffers. Reject unsafe names before invoking
        // extraction, including Windows drive paths and wildcard selectors.
        if (originalPath.size() >= 320 || archivePathNormalized.empty() ||
            originalPath.front() == '/' || originalPath.front() == '\\' || archivePathNormalized.front() == '-' ||
            originalPath.find_first_of(":*?") != std::string::npos || originalPath.find('\0') != std::string::npos) {
            throw std::runtime_error("ACE contiene una ruta no admitida");
        }
        std::istringstream components(archivePathNormalized);
        std::string component;
        while (std::getline(components, component, '/')) {
            if (component == "." || component == "..") throw std::runtime_error("ACE contiene una ruta no admitida");
        }

        entries.push_back({originalPath, archivePathNormalized, bytes});
    }

    std::sort(entries.begin(), entries.end(), [](const ListedEntry& lhs, const ListedEntry& rhs) {
        return naturalArchivePathLess(lhs.archivePath, rhs.archivePath);
    });

    return entries;
}

std::vector<fs::path> collectRegularFiles(const fs::path& root) {
    std::vector<fs::path> files;
    if (!fs::exists(root)) return files;

    for (const auto& item : fs::recursive_directory_iterator(root)) {
        if (item.is_regular_file()) {
            files.push_back(item.path());
        }
    }
    return files;
}

bool extractSingleEntry(
    const fs::path& unaceBinary,
    const std::string& archivePath,
    const std::string& originalEntryPath,
    const fs::path& workDir,
    fs::path& extractedFile,
    uint64_t budget,
    const AceLimits& limits) {
    std::error_code ec;
    fs::remove_all(workDir, ec);
    fs::create_directories(workDir, ec);
    if (ec) return false;

    std::string targetDir = workDir.string();
    if (!targetDir.empty() && targetDir.back() != fs::path::preferred_separator) {
        targetDir.push_back(fs::path::preferred_separator);
    }

    ProcessResult result = runProcessCapture(
        unaceBinary,
        {"e", "-y", "-f", "-c-", archivePath, targetDir, originalEntryPath},
        {{"COMISCOPIO_UNACE_MAX_OUTPUT_BYTES", std::to_string(budget)}});

    checkDecoderLimit(result, limits);
    if (result.exitCode != 0) {
        return false;
    }

    std::vector<fs::path> files = collectRegularFiles(workDir);
    if (files.size() != 1) {
        return false;
    }

    extractedFile = files.front();
    return true;
}

struct ExtractionCleanup {
    fs::path temporary;
    std::vector<fs::path> created;
    bool keepOutputs = false;
    ~ExtractionCleanup() {
        std::error_code ec;
        fs::remove_all(temporary, ec);
        if (!keepOutputs) for (const auto& file : created) fs::remove(file, ec);
    }
};

}  // namespace

int main(int argc, char* argv[]) {
#ifdef __CYGWIN__
    std::setlocale(LC_CTYPE, "C.UTF-8");
#endif
    signal(SIGINT, signalHandler);
    signal(SIGTERM, signalHandler);

    CliArgs args;
    if (!parseArgs(argc, argv, args) || args.mode != "extract-all") {
        std::cerr << "Usage: " << argv[0] << " --input FILE --output RAW_DIR [--mode extract-all]\n";
        return 1;
    }

    try {
        const AceLimits limits;
        args.input = decoderPath(args.input);
        args.output = decoderPath(args.output);
        if (args.input.size() >= 320 || args.output.size() + 32 >= 320) {
            throw std::runtime_error("La ruta es demasiado larga para el decodificador ACE");
        }
        const fs::path rawDir(args.output);
        const fs::path tempRoot = rawDir.parent_path() / ".ace-work";
        const fs::path unaceBinary = findBundledUnaceBinary();

        std::error_code ec;
        fs::create_directories(rawDir, ec);
        if (ec) {
            emitError("No se pudo crear el directorio raw para ACE");
            return 1;
        }

        if (!fs::is_empty(rawDir)) throw std::runtime_error("El directorio raw para ACE debe estar vacio");

        fs::remove_all(tempRoot, ec);
        fs::create_directories(tempRoot, ec);
        if (ec) {
            emitError("No se pudo crear el directorio temporal de trabajo ACE");
            return 1;
        }
        ExtractionCleanup cleanup{tempRoot, {}, false};

        std::vector<ListedEntry> entries = listArchiveEntries(unaceBinary, args.input, limits);
        if (entries.empty()) {
            emitError("El archivo ACE no contiene imagenes reconocidas");
            fs::remove_all(tempRoot, ec);
            return 1;
        }

        emitJson(json{
            {"type", "archive"},
            {"totalPages", static_cast<int>(entries.size())},
        });

        int failedCount = 0;
        uint64_t totalWritten = 0;
        for (std::size_t i = 0; i < entries.size(); i++) {
            if (cancelled) {
                fs::remove_all(tempRoot, ec);
                return 130;
            }

            const auto& entry = entries[i];
            emitJson(json{
                {"type", "extracting"},
                {"current", static_cast<int>(i)},
                {"total", static_cast<int>(entries.size())},
                {"name", entry.archivePath},
            });

            const fs::path workDir = tempRoot / formatIndex(static_cast<int>(i));
            fs::path extractedFile;
            std::string rawFile;

            const auto budget = std::min({entry.bytes, limits.entryBytes, limits.totalBytes - totalWritten});
            if (extractSingleEntry(unaceBinary, args.input, entry.originalPath, workDir, extractedFile, budget, limits)) {
                const auto actualBytes = fs::file_size(extractedFile);
                if (actualBytes > budget) throw std::runtime_error("ACE supera el presupuesto de escritura");
                if (actualBytes != entry.bytes) throw std::runtime_error("ACE contiene un tamano extraido distinto del declarado");
                totalWritten += actualBytes;
                std::string ext = archiveExtension(entry.archivePath);
                if (ext.empty()) ext = ".bin";

                rawFile = formatIndex(static_cast<int>(i)) + ext;
                const fs::path finalPath = rawDir / rawFile;
                cleanup.created.push_back(finalPath);

                std::error_code moveEc;
                fs::rename(extractedFile, finalPath, moveEc);
                if (moveEc) {
                    fs::copy_file(extractedFile, finalPath, fs::copy_options::overwrite_existing, moveEc);
                    if (!moveEc) {
                        fs::remove(extractedFile, moveEc);
                    }
                }
                if (moveEc) {
                    rawFile.clear();
                    failedCount++;
                }
            } else {
                failedCount++;
            }

            emitJson(json{
                {"type", "entry"},
                {"index", static_cast<int>(i)},
                {"name", entry.archivePath},
                {"rawFile", rawFile},
            });

            fs::remove_all(workDir, ec);
        }

        fs::remove_all(tempRoot, ec);
        emitJson(json{
            {"type", "done"},
            {"failed", failedCount},
        });
        cleanup.keepOutputs = true;
        return 0;
    } catch (const std::exception& e) {
        emitError(e.what());
        return 1;
    }
}
