#pragma once

#include "image_pipeline.h"
#include <nlohmann/json.hpp>
#include <string>
#include <vector>

struct PageEntry {
    int index;
    std::string status;        // "ok" or "error"
    std::string originalName;
    int originalWidth;
    int originalHeight;
    std::string thumb;
    std::string page;
    int pageWidth;
    int pageHeight;
    bool bypassed;
    std::string errorMessage;
};

class Manifest {
public:
    Manifest(const std::string& outputDir, const std::string& sourcePath,
             const std::string& backend, const nlohmann::json& config);

    /// Add a successfully processed page
    void addPage(int index, const std::string& originalName,
                 const ImageResult& result,
                 const std::string& thumbFile, const std::string& pageFile);

    /// Add a failed page
    void addErrorPage(int index, const std::string& originalName,
                      const std::string& errorMessage,
                      const std::string& thumbFile, const std::string& pageFile);

    /// Write manifest.json to disk (called after each page for incremental updates)
    void write();

    /// Mark processing as complete and write final manifest
    void finalize(int totalPages);

private:
    std::string outputDir;
    nlohmann::json root;
};
