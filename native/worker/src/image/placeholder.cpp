#include "placeholder.h"
#include <vips/vips.h>

void generatePlaceholder(
    const std::string& thumbPath,
    const std::string& pagePath,
    int thumbWidth,
    int thumbQuality,
    int readerQuality
) {
    int thumbHeight = thumbWidth * 3 / 2;  // 2:3 aspect
    int pageWidth = 800;
    int pageHeight = 1200;

    // Generate dark gray placeholder for thumbnail
    VipsImage* thumbImg = vips_image_new_from_image1(
        vips_image_new_temp_file("%s.v"),
        30.0  // dark gray
    );

    // Simpler approach: create a black image
    VipsImage* black = nullptr;
    if (vips_black(&black, thumbWidth, thumbHeight, "bands", 3, nullptr) == 0) {
        // Add a slight gray tint
        double add[] = {40, 40, 40};
        VipsImage* gray = nullptr;
        if (vips_linear1(black, &gray, 1.0, 40.0, nullptr) == 0) {
            vips_jpegsave(gray, thumbPath.c_str(), "Q", thumbQuality, nullptr);
            g_object_unref(gray);
        } else {
            vips_jpegsave(black, thumbPath.c_str(), "Q", thumbQuality, nullptr);
        }
        g_object_unref(black);
    }

    // Generate placeholder for reader page
    VipsImage* pageBlack = nullptr;
    if (vips_black(&pageBlack, pageWidth, pageHeight, "bands", 3, nullptr) == 0) {
        VipsImage* pageGray = nullptr;
        if (vips_linear1(pageBlack, &pageGray, 1.0, 40.0, nullptr) == 0) {
            vips_webpsave(pageGray, pagePath.c_str(), "Q", readerQuality, nullptr);
            g_object_unref(pageGray);
        } else {
            vips_webpsave(pageBlack, pagePath.c_str(), "Q", readerQuality, nullptr);
        }
        g_object_unref(pageBlack);
    }

    if (thumbImg) g_object_unref(thumbImg);
}
