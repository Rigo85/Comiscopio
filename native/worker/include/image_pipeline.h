#pragma once

#include <cstdint>
#include <string>
#include <vector>

struct ImageConfig {
    int thumbWidth = 180;
    int thumbQuality = 60;
    int readerMaxDimension = 2400;
    int readerQuality = 82;
};

struct ImageResult {
    bool ok = false;
    std::string errorMessage;

    int originalWidth = 0;
    int originalHeight = 0;
    int pageWidth = 0;
    int pageHeight = 0;
    bool bypassed = false;  // true if page was copied without re-encoding

    double decodeMs = 0;
    double thumbMs = 0;
    double pageMs = 0;
};

/**
 * Process raw image bytes: decode once, produce thumb + reader page.
 *
 * @param data        Raw image bytes from the archive
 * @param name        Original filename (for format hint)
 * @param config      Processing parameters
 * @param thumbPath   Output path for thumbnail JPEG
 * @param pagePath    Output path for reader page (WebP or copy)
 * @return            Result with dimensions, timing, error info
 */
ImageResult processImage(
    const std::vector<uint8_t>& data,
    const std::string& name,
    const ImageConfig& config,
    const std::string& thumbPath,
    const std::string& pagePath
);
