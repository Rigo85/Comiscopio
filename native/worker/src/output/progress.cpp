#include "progress.h"
#include <nlohmann/json.hpp>
#include <cstdio>

using json = nlohmann::json;

void emitProgress(int pageIndex, int total, const std::string& stage, const std::string& file) {
    json j;
    j["type"] = "progress";
    j["page"] = pageIndex;
    j["total"] = total;
    j["stage"] = stage;
    j["file"] = file;
    fprintf(stdout, "%s\n", j.dump().c_str());
    fflush(stdout);
}

void emitError(int pageIndex, const std::string& message) {
    json j;
    j["type"] = "error";
    j["page"] = pageIndex;
    j["message"] = message;
    fprintf(stdout, "%s\n", j.dump().c_str());
    fflush(stdout);
}

void emitDone(int total, double elapsedMs) {
    json j;
    j["type"] = "done";
    j["total"] = total;
    j["elapsed_ms"] = elapsedMs;
    fprintf(stdout, "%s\n", j.dump().c_str());
    fflush(stdout);
}
