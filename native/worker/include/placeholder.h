#pragma once

#include <string>

/**
 * Generate placeholder images for pages that failed to decode.
 * Creates a dark image with error indication.
 */
void generatePlaceholder(
    const std::string& thumbPath,
    const std::string& pagePath,
    int thumbWidth,
    int thumbQuality,
    int readerQuality
);
