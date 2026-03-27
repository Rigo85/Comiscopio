#include "image_pipeline.h"
#include <vips/vips.h>
#include <chrono>
#include <fstream>
#include <algorithm>
#include <cstring>

static double nowMs() {
    return std::chrono::duration<double, std::milli>(
        std::chrono::steady_clock::now().time_since_epoch()
    ).count();
}

static std::string getExtension(const std::string& filename) {
    auto pos = filename.rfind('.');
    if (pos == std::string::npos) return "";
    std::string ext = filename.substr(pos);
    std::transform(ext.begin(), ext.end(), ext.begin(), ::tolower);
    return ext;
}

ImageResult processImage(
    const std::vector<uint8_t>& data,
    const std::string& name,
    const ImageConfig& config,
    const std::string& thumbPath,
    const std::string& pagePath
) {
    ImageResult result;

    // --- Decode header only for dimensions (no pixel decode) ---
    double t0 = nowMs();

    const char* loader = vips_foreign_find_load_buffer(data.data(), data.size());
    if (!loader) {
        result.ok = false;
        result.errorMessage = "Failed to detect image format: " + std::string(vips_error_buffer());
        vips_error_clear();
        return result;
    }

    VipsImage* header = vips_image_new_from_buffer(data.data(), data.size(), "",
        "access", VIPS_ACCESS_SEQUENTIAL, nullptr);
    if (!header) {
        result.ok = false;
        result.errorMessage = "Failed to read image header: " + std::string(vips_error_buffer());
        vips_error_clear();
        return result;
    }

    result.originalWidth = vips_image_get_width(header);
    result.originalHeight = vips_image_get_height(header);
    result.decodeMs = nowMs() - t0;

    g_object_unref(header);
    header = nullptr;

    // --- Generate thumbnail ---
    double t1 = nowMs();

    VipsImage* thumb = nullptr;
    if (vips_thumbnail_buffer(
            const_cast<void*>(static_cast<const void*>(data.data())),
            data.size(),
            &thumb,
            config.thumbWidth,
            "height", config.thumbWidth * 3 / 2,  // max height = 1.5x width
            "size", VIPS_SIZE_DOWN,                // only shrink, never enlarge
            nullptr
        ) != 0) {
        result.ok = false;
        result.errorMessage = "Failed to generate thumbnail: " + std::string(vips_error_buffer());
        vips_error_clear();
        return result;
    }

    if (vips_jpegsave(thumb, thumbPath.c_str(), "Q", config.thumbQuality, nullptr) != 0) {
        g_object_unref(thumb);
        result.ok = false;
        result.errorMessage = "Failed to save thumbnail: " + std::string(vips_error_buffer());
        vips_error_clear();
        return result;
    }

    g_object_unref(thumb);
    result.thumbMs = nowMs() - t1;

    // --- Generate reader page ---
    double t2 = nowMs();

    int maxDim = std::max(result.originalWidth, result.originalHeight);

    if (maxDim <= config.readerMaxDimension) {
        // Bypass: copy original bytes directly, no re-encoding
        std::ofstream out(pagePath, std::ios::binary);
        if (!out) {
            result.ok = false;
            result.errorMessage = "Failed to write page file: " + pagePath;
            return result;
        }
        out.write(reinterpret_cast<const char*>(data.data()), data.size());
        out.close();

        result.pageWidth = result.originalWidth;
        result.pageHeight = result.originalHeight;
        result.bypassed = true;
    } else {
        // Resize and encode as the configured reader format.
        VipsImage* page = nullptr;
        if (vips_thumbnail_buffer(
                const_cast<void*>(static_cast<const void*>(data.data())),
                data.size(),
                &page,
                config.readerMaxDimension,
                "height", config.readerMaxDimension,
                "size", VIPS_SIZE_DOWN,
                nullptr
            ) != 0) {
            result.ok = false;
            result.errorMessage = "Failed to resize page: " + std::string(vips_error_buffer());
            vips_error_clear();
            return result;
        }

        int saveStatus = 0;
        if (config.readerFormat == "jpeg") {
            saveStatus = vips_jpegsave(
                page,
                pagePath.c_str(),
                "Q", config.readerQuality,
                "strip", TRUE,
                nullptr);
        } else {
            saveStatus = vips_webpsave(
                page,
                pagePath.c_str(),
                "Q", config.readerQuality,
                "effort", 1,
                "strip", TRUE,
                nullptr);
        }

        if (saveStatus != 0) {
          g_object_unref(page);
          result.ok = false;
          result.errorMessage = "Failed to save page: " + std::string(vips_error_buffer());
          vips_error_clear();
          return result;
        }

        result.pageWidth = vips_image_get_width(page);
        result.pageHeight = vips_image_get_height(page);
        g_object_unref(page);
        result.bypassed = false;
    }

    result.pageMs = nowMs() - t2;
    result.ok = true;
    return result;
}
