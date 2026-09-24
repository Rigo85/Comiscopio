#include "placeholder.h"
#include <vips/vips.h>

bool generateThumbnailPlaceholder(const std::string& thumbPath, int thumbWidth, int thumbQuality) {
    int thumbHeight = thumbWidth * 3 / 2;  // 2:3 aspect
    bool saved = false;

    // Create placeholders without a temporary image or file.
    VipsImage* black = nullptr;
    if (vips_black(&black, thumbWidth, thumbHeight, "bands", 3, nullptr) == 0) {
        // Add a slight gray tint
        VipsImage* gray = nullptr;
        if (vips_linear1(black, &gray, 1.0, 40.0, nullptr) == 0) {
            saved = vips_jpegsave(gray, thumbPath.c_str(), "Q", thumbQuality, nullptr) == 0;
            g_object_unref(gray);
        } else {
            saved = vips_jpegsave(black, thumbPath.c_str(), "Q", thumbQuality, nullptr) == 0;
        }
        g_object_unref(black);
    }

    return saved;
}

void generatePlaceholder(
    const std::string& thumbPath,
    const std::string& pagePath,
    int thumbWidth,
    int thumbQuality,
    int readerQuality
) {
    generateThumbnailPlaceholder(thumbPath, thumbWidth, thumbQuality);
    int pageWidth = 800;
    int pageHeight = 1200;
    // Generate placeholder for reader page
    VipsImage* pageBlack = nullptr;
    if (vips_black(&pageBlack, pageWidth, pageHeight, "bands", 3, nullptr) == 0) {
        VipsImage* pageGray = nullptr;
        if (vips_linear1(pageBlack, &pageGray, 1.0, 40.0, nullptr) == 0) {
            vips_image_write_to_file(pageGray, pagePath.c_str(), "Q", readerQuality, nullptr);
            g_object_unref(pageGray);
        } else {
            vips_image_write_to_file(pageBlack, pagePath.c_str(), "Q", readerQuality, nullptr);
        }
        g_object_unref(pageBlack);
    }

}
