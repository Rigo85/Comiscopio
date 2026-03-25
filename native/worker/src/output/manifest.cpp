#include "manifest.h"
#include <fstream>

using json = nlohmann::json;

Manifest::Manifest(const std::string& outputDir, const std::string& sourcePath,
                   const std::string& backend, const json& config)
    : outputDir(outputDir) {
    root["version"] = 1;
    root["source"] = sourcePath;
    root["backend"] = backend;
    root["status"] = "processing";
    root["config"] = config;
    root["pages"] = json::array();
}

void Manifest::addPage(int index, const std::string& originalName,
                       const ImageResult& result,
                       const std::string& thumbFile, const std::string& pageFile) {
    json page;
    page["index"] = index;
    page["status"] = "ok";
    page["originalName"] = originalName;
    page["originalWidth"] = result.originalWidth;
    page["originalHeight"] = result.originalHeight;
    page["thumb"] = thumbFile;
    page["page"] = pageFile;
    page["pageWidth"] = result.pageWidth;
    page["pageHeight"] = result.pageHeight;
    page["bypassed"] = result.bypassed;
    root["pages"].push_back(page);
}

void Manifest::addErrorPage(int index, const std::string& originalName,
                            const std::string& errorMessage,
                            const std::string& thumbFile, const std::string& pageFile) {
    json page;
    page["index"] = index;
    page["status"] = "error";
    page["originalName"] = originalName;
    page["errorMessage"] = errorMessage;
    page["thumb"] = thumbFile;
    page["page"] = pageFile;
    root["pages"].push_back(page);
}

void Manifest::write() {
    std::string path = outputDir + "/manifest.json";
    std::ofstream out(path);
    out << root.dump(2) << std::endl;
}

void Manifest::finalize(int totalPages) {
    root["totalPages"] = totalPages;
    root["status"] = "complete";
    write();
}
